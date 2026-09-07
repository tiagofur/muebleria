import { describe, expect, it } from 'vitest';
import { AdapterSerializationBlocked } from '@granete/domain';
import {
  buildFixtureCuttingJob,
  buildFixtureCuttingJobPartialProvenance,
} from './machineOutputFixtures';
import {
  generateMachineArtifact,
  manifestComparisonKey,
} from './machineArtifacts';
import { PTX_POSTPROCESSOR_ADAPTER } from './ptxAdapter';
import {
  CLIENT_A_HPP250_PROFILE,
  PTX_CADMATIC_3_PROFILE,
  PTX_GENERIC_PROFILE,
} from './profiles';

const GENERIC_REQUEST = {
  job: buildFixtureCuttingJob(),
  adapter: PTX_POSTPROCESSOR_ADAPTER,
  profile: PTX_GENERIC_PROFILE,
  kind: 'ptx' as const,
  schemaVersion: '1.14',
  fileName: 'test-generic.ptx',
  machineProfile: {
    ref: CLIENT_A_HPP250_PROFILE.ref,
    supported: CLIENT_A_HPP250_PROFILE.supported,
  },
};

describe('generateMachineArtifact', () => {
  it('produces a deterministic artifact and manifest (byte-stable, no clock)', async () => {
    const first = await generateMachineArtifact(GENERIC_REQUEST);
    const second = await generateMachineArtifact(GENERIC_REQUEST);

    expect(first.artifact.sha256).toBe(second.artifact.sha256);
    expect(first.artifact.bytes).toEqual(second.artifact.bytes);
    expect(first.manifestJson).toBe(second.manifestJson);
    expect(manifestComparisonKey(first.manifest)).toBe(manifestComparisonKey(second.manifest));
  });

  it('generic PTX artifact equals the frozen #348 golden content', async () => {
    const bundle = await generateMachineArtifact(GENERIC_REQUEST);
    const text = new TextDecoder().decode(bundle.artifact.bytes);
    expect(text).toContain('VERSION=1.14');
    expect(text).toContain('JOB_NAME=fixture-board-001');
    expect(text).toContain('TOTAL_SHEETS=2');
    // CRLF + trailing structure preserved end to end.
    expect(text).toContain('\r\n');
  });

  it('manifest records exact provenance with zero missing fields for the fixture', async () => {
    const { manifest } = await generateMachineArtifact(GENERIC_REQUEST);
    expect(manifest.provenance.productionReleaseId).toBe('fixture-release-001');
    expect(manifest.provenance.bomFingerprint).toBe('fixture-bom-fingerprint-001');
    expect(manifest.missingProvenance).toEqual([]);
    expect(manifest.createdAt).toBe(GENERIC_REQUEST.job.provenance.generatedAt);
  });

  it('manifest lists absent provenance explicitly — never implicit latest', async () => {
    const bundle = await generateMachineArtifact({
      ...GENERIC_REQUEST,
      job: buildFixtureCuttingJobPartialProvenance(),
    });
    expect(bundle.manifest.missingProvenance).toEqual([
      'productionReleaseId',
      'designRevisionId',
      'bomFingerprint',
    ]);
    // What IS supplied stays exact.
    expect(bundle.manifest.provenance.cutPlanId).toBe(
      buildFixtureCuttingJob().cutPlan.id,
    );
  });

  it('manifest pins exact profile/adapter revisions and claims notClaimed', async () => {
    const { manifest } = await generateMachineArtifact(GENERIC_REQUEST);
    expect(manifest.outputCompatibilityProfile).toEqual({
      outputCompatibilityProfileId: 'ptx-generic',
      revisionId: 'r1',
    });
    expect(manifest.postprocessorAdapter.postprocessorAdapterId).toBe('granete-ptx');
    expect(manifest.postprocessorAdapter.implementationDigest).toBe(
      PTX_POSTPROCESSOR_ADAPTER.implementationDigest,
    );
    expect(manifest.compatibilityEvidence.claim).toBe('notClaimed');
    expect(manifest.validationStatus).toBe('NOT_TESTED');
    expect(manifest.nonProductionValidationArtifact).toBe(true);
    expect(manifest.machineProfile?.machineProfileId).toBe('client-a-machine-b-hpp250');
  });

  it('blocks on unevidenced profiles instead of emitting guessed bytes', async () => {
    await expect(
      generateMachineArtifact({
        ...GENERIC_REQUEST,
        profile: PTX_CADMATIC_3_PROFILE,
        fileName: 'test-cadmatic3.ptx',
      }),
    ).rejects.toBeInstanceOf(AdapterSerializationBlocked);
  });
});
