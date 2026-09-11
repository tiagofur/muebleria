import { describe, expect, it } from 'vitest';
import type { MachineOutputSelection } from '@granete/domain';
import {
  KNOWN_MACHINE_PROFILES,
  KNOWN_OUTPUT_PROFILES,
  generateSelectedCuttingOutput,
  resolveManufacturingOutputTarget,
} from './outputSelectionResolver';
import {
  CLIENT_A_HPP250_PROFILE,
  MPR_WOODWOP_PROFILE,
  PTX_CADMATIC_4_PROFILE,
  PTX_GENERIC_PROFILE,
} from './profiles';
import { PTX_ADAPTER_IMPLEMENTATION_DESCRIPTOR, PTX_POSTPROCESSOR_ADAPTER } from './ptxAdapter';
import { buildFixtureCuttingJob } from './machineOutputFixtures';
import { generateMachineArtifact } from './machineArtifacts';

function cuttingSelection(profileId: string): MachineOutputSelection {
  const profile = KNOWN_OUTPUT_PROFILES.find(
    (p) => p.ref.outputCompatibilityProfileId === profileId,
  )!;
  return {
    operation: 'cutting',
    machineProfileId: CLIENT_A_HPP250_PROFILE.ref.machineProfileId,
    machineProfileRevisionId: CLIENT_A_HPP250_PROFILE.ref.machineProfileRevisionId,
    outputCompatibilityProfileId: profile.ref.outputCompatibilityProfileId,
    outputCompatibilityProfileRevisionId: profile.ref.revisionId,
    postprocessorAdapterId: PTX_POSTPROCESSOR_ADAPTER.postprocessorAdapterId,
    postprocessorAdapterVersion: PTX_POSTPROCESSOR_ADAPTER.adapterVersion,
    postprocessorImplementationDigest: PTX_POSTPROCESSOR_ADAPTER.implementationDigest,
  };
}

describe('resolveManufacturingOutputTarget', () => {
  it('returns NO_OUTPUT_CONFIGURED when nothing is selected (never a silent default)', () => {
    const result = resolveManufacturingOutputTarget(undefined, 'cutting');
    expect(result.status).toBe('NO_OUTPUT_CONFIGURED');
    const wrongOperation = resolveManufacturingOutputTarget(
      cuttingSelection('ptx-generic'),
      'machining',
    );
    expect(wrongOperation.status).toBe('NO_OUTPUT_CONFIGURED');
  });

  it('resolves the exact selected generic tuple as ready with zero blockers', () => {
    const result = resolveManufacturingOutputTarget(cuttingSelection('ptx-generic'), 'cutting');
    expect(result.status).toBe('CONFIGURED');
    if (result.status !== 'CONFIGURED') return;
    expect(result.machineLabel).toBe('HOLZMA (HOMAG) HPP 250');
    expect(result.profileLabel).toBe('ptx-generic@r1');
    expect(result.adapterLabel).toBe(`granete-ptx · ${PTX_ADAPTER_IMPLEMENTATION_DESCRIPTOR.adapterVersion}`);
    expect(result.supportStatus).toBe('NOT_TESTED');
    expect(result.readiness.ready).toBe(true);
    expect(result.readiness.reasons).toEqual([]);
  });

  it('CADmatic 4: la revisión candidata r3 resuelve lista; los pins históricos r1/r2 quedan stale sin fallback', () => {
    const current = resolveManufacturingOutputTarget(cuttingSelection('ptx-cadmatic-4'), 'cutting');
    expect(current.status).toBe('CONFIGURED');
    if (current.status !== 'CONFIGURED') return;
    expect(current.profileLabel).toBe('ptx-cadmatic-4@r3');
    expect(current.supportStatus).toBe('NOT_TESTED');
    expect(current.readiness.ready).toBe(true);
    expect(current.readiness.reasons).toEqual([]);

    for (const staleRevision of ['r1', 'r2']) {
      const stale = {
        ...cuttingSelection('ptx-cadmatic-4'),
        outputCompatibilityProfileRevisionId: staleRevision,
      };
      const staleResult = resolveManufacturingOutputTarget(stale, 'cutting');
      expect(staleResult.status).toBe('CONFIGURED');
      if (staleResult.status !== 'CONFIGURED') return;
      expect(staleResult.profileLabel).toBe('ptx-cadmatic-4@r3');
      expect(staleResult.readiness.ready).toBe(false);
      expect(staleResult.readiness.reasons.map((r) => r.code)).toContain('PROFILE_DIGEST_MISMATCH');
      // Still the selected profile — no generic substitution and no automatic
      // retarget to the current revision.
      expect(staleResult.selection.outputCompatibilityProfileId).toBe('ptx-cadmatic-4');
      expect(staleResult.selection.outputCompatibilityProfileRevisionId).toBe(staleRevision);
    }
  });

  it('CADmatic 3/5 siguen bloqueados por evidencia ausente y NUNCA caen al genérico', () => {
    for (const profileId of ['ptx-cadmatic-3', 'ptx-cadmatic-5']) {
      const result = resolveManufacturingOutputTarget(cuttingSelection(profileId), 'cutting');
      expect(result.status).toBe('CONFIGURED');
      if (result.status !== 'CONFIGURED') return;
      expect(result.readiness.ready).toBe(false);
      const codes = result.readiness.reasons.map((r) => r.code);
      expect(codes).toContain('FIELD_FORMAT_EVIDENCE_REQUIRED');
      expect(codes).not.toContain('SERIALIZER_NOT_IMPLEMENTED');
      expect(result.selection.outputCompatibilityProfileId).toBe(profileId);
    }
  });

  it('machining with pending MPR serializer surfaces SERIALIZER_NOT_IMPLEMENTED', () => {
    const selection: MachineOutputSelection = {
      operation: 'machining',
      machineProfileId: 'client-a-machine-a-bhx050',
      machineProfileRevisionId: 'r1',
      outputCompatibilityProfileId: 'mpr-woodwop',
      outputCompatibilityProfileRevisionId: 'r1',
      postprocessorAdapterId: 'woodwop-mpr',
      postprocessorAdapterVersion: '0.1.0',
      postprocessorImplementationDigest: '4ae7d19fb29c555c5de0346d06ae88cbc47bfa043b80222b9d427705c5c7e782',
    };
    const result = resolveManufacturingOutputTarget(selection, 'machining');
    expect(result.status).toBe('CONFIGURED');
    if (result.status !== 'CONFIGURED') return;
    expect(result.readiness.ready).toBe(false);
    expect(result.readiness.reasons.map((r) => r.code)).toContain('SERIALIZER_NOT_IMPLEMENTED');
  });

  it('stale references surface typed blockers instead of substituting another profile', () => {
    const stale = {
      ...cuttingSelection('ptx-generic'),
      outputCompatibilityProfileRevisionId: 'r0',
    };
    const result = resolveManufacturingOutputTarget(stale, 'cutting');
    expect(result.status).toBe('CONFIGURED');
    if (result.status !== 'CONFIGURED') return;
    expect(result.readiness.ready).toBe(false);
    expect(result.readiness.reasons.map((r) => r.code)).toContain('PROFILE_DIGEST_MISMATCH');
    // Still the selected profile — never another one.
    expect(result.profileLabel).toBe('ptx-generic@r1');
    expect(result.selection.outputCompatibilityProfileRevisionId).toBe('r0');
  });

  it('at most one target per operation — the resolver returns a single tuple, never a list', () => {
    for (const machine of KNOWN_MACHINE_PROFILES) {
      expect(machine.identity.opaqueClientKey).toBe('client-a');
    }
    const result = resolveManufacturingOutputTarget(cuttingSelection('ptx-generic'), 'cutting');
    expect(Array.isArray((result as { selection?: unknown }).selection)).toBe(false);
  });

  it('generating through the resolved ready target produces exactly one output byte-identical to the golden', async () => {
    const result = resolveManufacturingOutputTarget(cuttingSelection('ptx-generic'), 'cutting');
    expect(result.status === 'CONFIGURED' && result.readiness.ready).toBe(true);
    if (result.status !== 'CONFIGURED' || !result.readiness.ready) return;

    const bundle = await generateMachineArtifact({
      job: buildFixtureCuttingJob(),
      adapter: PTX_POSTPROCESSOR_ADAPTER,
      profile: PTX_GENERIC_PROFILE,
      kind: 'ptx',
      schemaVersion: '1.14',
      fileName: 'corte-seleccionado.ptx',
      machineProfile: {
        ref: CLIENT_A_HPP250_PROFILE.ref,
        supported: CLIENT_A_HPP250_PROFILE.supported,
      },
    });
    expect(bundle.manifest.artifacts).toHaveLength(1);
    expect(bundle.artifact.sha256).toBe(
      '544dcae574bc19e19f934f96b2ad1dc104a2d7b1f668262a83ae09df72510f09',
    );
  });
});

describe('generateSelectedCuttingOutput — bundling mode (#591)', () => {
  // The frozen validation fixture carries 2 materials, which is exactly the
  // scenario the per-material mode must split.
  function fixturePlan() {
    return buildFixtureCuttingJob().cutPlan;
  }

  function materialCodes(plan: ReturnType<typeof fixturePlan>): string[] {
    return [...new Set(plan.sheets.map((s) => s.materialCode || s.materialName || 'DEFAULT'))];
  }

  it('unified (default) produces exactly one artifact named corte-<projectId>', async () => {
    const plan = fixturePlan();
    const bundles = await generateSelectedCuttingOutput(plan, cuttingSelection('ptx-generic'));
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.artifact.fileName).toBe(`corte-${plan.projectId}.ptx`);
    expect(bundles[0]!.manifest.artifacts).toHaveLength(1);
  });

  it('by-material produces one artifact per material with isolated content', async () => {
    const plan = fixturePlan();
    const materials = materialCodes(plan);
    expect(materials.length).toBeGreaterThanOrEqual(2);

    const bundles = await generateSelectedCuttingOutput(
      plan,
      cuttingSelection('ptx-generic'),
      'by-material',
    );

    expect(bundles).toHaveLength(materials.length);
    const fileNames = bundles.map((b) => b.artifact.fileName);
    expect(new Set(fileNames).size).toBe(fileNames.length);

    // Every material code appears in exactly one file — no cross-material
    // leakage and no silently dropped material.
    const seen = new Map<string, number>();
    for (const bundle of bundles) {
      const content = new TextDecoder().decode(bundle.artifact.bytes);
      for (const code of materials) {
        if (content.includes(code)) {
          seen.set(code, (seen.get(code) ?? 0) + 1);
        }
      }
      expect(bundle.manifest.artifacts).toHaveLength(1);
    }
    for (const code of materials) {
      expect(seen.get(code)).toBe(1);
    }

    // Distinct jobIds keep the per-material manifests independently addressable.
    const jobIds = bundles.map((b) => b.manifest.jobId);
    expect(new Set(jobIds).size).toBe(jobIds.length);
  });

  it('by-material with a single material yields one file carrying the material in its name', async () => {
    const plan = fixturePlan();
    const only = materialCodes(plan)[0]!;
    const singleMaterialPlan = {
      ...plan,
      sheets: plan.sheets.filter((s) => (s.materialCode || s.materialName || 'DEFAULT') === only),
    };

    const bundles = await generateSelectedCuttingOutput(
      singleMaterialPlan,
      cuttingSelection('ptx-generic'),
      'by-material',
    );

    expect(bundles).toHaveLength(1);
    // El nombre legible del material gana sobre el código técnico.
    expect(bundles[0]!.artifact.fileName).toBe('corte-tablero-sintetico-a-18mm.ptx');
  });

  it('by-material with an empty plan throws exactly like unified (no invented output)', async () => {
    const plan = fixturePlan();
    const empty = { ...plan, sheets: [] };
    await expect(
      generateSelectedCuttingOutput(empty, cuttingSelection('ptx-generic'), 'by-material'),
    ).rejects.toThrow(/no tiene tableros/i);
    await expect(
      generateSelectedCuttingOutput(empty, cuttingSelection('ptx-generic')),
    ).rejects.toThrow(/no tiene tableros/i);
  });

  it('a blocked target still throws before any mode is applied (no silent fallback)', async () => {
    const plan = fixturePlan();
    await expect(
      generateSelectedCuttingOutput(plan, cuttingSelection('ptx-cadmatic-3'), 'by-material'),
    ).rejects.toThrow();
  });

  it('unified prefiere el nombre legible de la obra sobre el ID técnico', async () => {
    const plan = { ...fixturePlan(), projectName: 'Cocina de la Ana' };
    const bundles = await generateSelectedCuttingOutput(
      plan,
      cuttingSelection('ptx-generic'),
    );
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.artifact.fileName).toBe('corte-cocina-de-la-ana.ptx');
  });

  it('by-material resuelve colisiones de nombre con sufijo determinista', async () => {
    const plan = fixturePlan();
    // Los dos materiales del fixture pasan a llamarse igual (sanitizan igual).
    const colliding = {
      ...plan,
      sheets: plan.sheets.map((s) => ({ ...s, materialName: 'MDF Blanco' })),
    };
    const bundles = await generateSelectedCuttingOutput(
      colliding,
      cuttingSelection('ptx-generic'),
      'by-material',
    );
    expect(bundles).toHaveLength(2);
    const names = bundles.map((b) => b.artifact.fileName).sort();
    expect(names).toEqual(['corte-mdf-blanco-2.ptx', 'corte-mdf-blanco.ptx']);
  });
});
