import { describe, expect, it } from 'vitest';
import type { MachineOutputSelection, ResolvedMachiningJob } from '@granete/domain';
import { buildFixtureMachiningJob, FIXTURE_JOB_GENERATED_AT } from './machineOutputFixtures';
import {
  generateSelectedMachiningOutput,
  kdtArtifactFileName,
} from './outputSelectionResolver';
import { KDT_FLEXDRILL_1200_PROFILE, MPR_WOODWOP_PROFILE } from './profiles';
import { KDT_POSTPROCESSOR_ADAPTER } from './kdtAdapter';
import { sha256Hex } from './digest';

/** The exact catalog tuple for the kdt-flexdrill-1200 r2 target. */
function kdtMachiningSelection(): MachineOutputSelection {
  return {
    operation: 'machining',
    machineProfileId: 'client-b-machine-c-kdt-flexdrill1200',
    machineProfileRevisionId: 'r1',
    outputCompatibilityProfileId: 'kdt-flexdrill-1200',
    outputCompatibilityProfileRevisionId: 'r2',
    outputCompatibilityProfileDigest: KDT_FLEXDRILL_1200_PROFILE.digest,
    postprocessorAdapterId: KDT_POSTPROCESSOR_ADAPTER.postprocessorAdapterId,
    postprocessorAdapterVersion: KDT_POSTPROCESSOR_ADAPTER.adapterVersion,
    postprocessorImplementationDigest: KDT_POSTPROCESSOR_ADAPTER.implementationDigest,
  };
}

function mprMachiningSelection(): MachineOutputSelection {
  return {
    operation: 'machining',
    machineProfileId: 'client-a-machine-a-bhx050',
    machineProfileRevisionId: 'r1',
    outputCompatibilityProfileId: 'mpr-woodwop',
    outputCompatibilityProfileRevisionId: MPR_WOODWOP_PROFILE.ref.revisionId,
    outputCompatibilityProfileDigest: MPR_WOODWOP_PROFILE.digest,
    postprocessorAdapterId: 'woodwop-mpr',
    postprocessorAdapterVersion: '0.1.0',
    postprocessorImplementationDigest: '4ae7d19fb29c555c5de0346d06ae88cbc47bfa043b80222b9d427705c5c7e782',
  };
}

describe('generateSelectedMachiningOutput (#1005 K3)', () => {
  it('genera un bundle por pieza/cara con manifest by-piece y pins exactos', async () => {
    const job = buildFixtureMachiningJob();
    const bundles = await generateSelectedMachiningOutput(job, kdtMachiningSelection());
    expect(bundles).toHaveLength(1);
    const bundle = bundles[0]!;
    expect(new TextDecoder().decode(bundle.artifact.bytes)).toContain('<KDTPanelFormat>');
    expect(bundle.artifact.fileName).toMatch(/^K[0-9A-F]{12}\.xml$/);
    expect(bundle.manifest.delivery).toEqual({
      mode: 'by-piece',
      piece: { code: 'fixture-module-m.fixture-panel-001', machiningFace: 'back' },
    });
    // Pins congelados del provenance del caller (path frozen de #995).
    expect(bundle.manifest.provenance.productionReleaseId).toBe('fixture-release-001');
    expect(bundle.manifest.outputCompatibilityProfile).toEqual(KDT_FLEXDRILL_1200_PROFILE.ref);
    expect(bundle.manifest.outputCompatibilityProfileDigest).toBe(KDT_FLEXDRILL_1200_PROFILE.digest);
    expect(bundle.manifest.postprocessorAdapter.postprocessorAdapterId).toBe('granete-kdt');
    expect(bundle.manifest.machineProfile?.machineProfileId).toBe(
      'client-b-machine-c-kdt-flexdrill1200',
    );
    expect(bundle.manifest.nonProductionValidationArtifact).toBe(true);
  });

  it('una pieza con agujeros en ambas caras produce dos bundles distintos (Face A/B)', async () => {
    const job = buildFixtureMachiningJob();
    const bothFaces: ResolvedMachiningJob = {
      ...job,
      drilling: {
        ...job.drilling,
        totalHolesCount: 8,
        patterns: [
          {
            ...job.drilling.patterns[0]!,
            holes: [
              ...job.drilling.patterns[0]!.holes,
              { face: 'front', xMm: 120, yMm: 480, diameterMm: 5, depthMm: 10, type: 'shelf' },
            ],
          },
        ],
      },
    };
    const bundles = await generateSelectedMachiningOutput(bothFaces, kdtMachiningSelection());
    expect(bundles).toHaveLength(2);
    const faces = bundles.map((bundle) =>
      bundle.manifest.delivery.mode === 'by-piece' ? bundle.manifest.delivery.piece?.machiningFace : undefined,
    );
    expect(faces.sort()).toEqual(['back', 'front']);
    const artifactIds = new Set(bundles.map((bundle) => bundle.manifest.artifactSetId));
    expect(artifactIds.size).toBe(2);
    const fileNames = new Set(bundles.map((bundle) => bundle.artifact.fileName));
    expect(fileNames.size).toBe(2);
  });

  it('es determinista: mismo trabajo → mismos bytes, nombres y hashes', async () => {
    const job = buildFixtureMachiningJob();
    const first = await generateSelectedMachiningOutput(job, kdtMachiningSelection());
    const second = await generateSelectedMachiningOutput(job, kdtMachiningSelection());
    expect(await sha256Hex(first[0]!.artifact.bytes)).toBe(
      await sha256Hex(second[0]!.artifact.bytes),
    );
    expect(first[0]!.artifact.fileName).toBe(second[0]!.artifact.fileName);
    expect(first[0]!.manifestJson).toBe(second[0]!.manifestJson);
  });

  it('bloquea sin fallback: familia sin serializer, selección ausente y digest stale', async () => {
    const job = buildFixtureMachiningJob();
    await expect(
      generateSelectedMachiningOutput(job, mprMachiningSelection()),
    ).rejects.toThrow(/el serializador todavía no está implementado/);
    await expect(
      generateSelectedMachiningOutput(job, {
        ...kdtMachiningSelection(),
        outputCompatibilityProfileRevisionId: 'r1',
        outputCompatibilityProfileDigest: '6a3015f7462772696d8fb64a22da90065ac7a863758229b9fab56a2710ad7055',
      }),
    ).rejects.toThrow(/PROFILE_DIGEST_MISMATCH|no coincide/);
    await expect(
      generateSelectedMachiningOutput(job, {
        ...kdtMachiningSelection(),
        outputCompatibilityProfileDigest: 'deadbeef',
      }),
    ).rejects.toThrow();
  });

  it('bloquea un trabajo sin programas (0 piezas con operaciones)', async () => {
    const job = buildFixtureMachiningJob();
    const empty: ResolvedMachiningJob = {
      ...job,
      drilling: { ...job.drilling, patterns: [], totalPiecesCount: 0, totalHolesCount: 0 },
    };
    await expect(
      generateSelectedMachiningOutput(empty, kdtMachiningSelection()),
    ).rejects.toThrow(/no produce programas KDT/);
  });

  it('kdtArtifactFileName es determinista y sensible a pieza/cara', async () => {
    const a = await kdtArtifactFileName('job-1', 'MOD-1-P01', 'front');
    const b = await kdtArtifactFileName('job-1', 'MOD-1-P01', 'back');
    const c = await kdtArtifactFileName('job-1', 'MOD-1-P01', 'front');
    expect(a).toMatch(/^K[0-9A-F]{12}\.xml$/);
    expect(a).not.toBe(b);
    expect(a).toBe(c);
  });
});
