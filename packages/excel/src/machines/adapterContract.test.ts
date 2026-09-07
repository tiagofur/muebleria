import { describe, expect, it } from 'vitest';
import {
  AdapterSerializationBlocked,
  type OutputCompatibilityProfile,
  type PostprocessorAdapter,
} from '@granete/domain';
import { buildFixtureCuttingJob, buildFixtureMachiningJob } from './machineOutputFixtures';
import { PTX_POSTPROCESSOR_ADAPTER } from './ptxAdapter';
import { SAW_POSTPROCESSOR_ADAPTER } from './sawAdapter';
import { WOODWOP_MPR_POSTPROCESSOR_ADAPTER } from './woodWopMprAdapter';
import { PTX_GENERIC_PROFILE, SAW_HOMAG_PROFILE } from './profiles';
import { sha256Hex } from './digest';

/**
 * Contract invariant: for every adapter, `canSerialize(job, profile).ready
 * === true` MUST guarantee that `serialize(job, profile)` executes without
 * throwing AdapterSerializationBlocked. Ready means serializable — never
 * "dimensions known but serializer missing".
 */
function assertReadyImpliesSerializable<Job>(
  adapter: PostprocessorAdapter<Job>,
  job: Job,
  profile: OutputCompatibilityProfile,
): void {
  const readiness = adapter.canSerialize(job, profile);
  if (!readiness.ready) return;
  let serialized: Uint8Array | undefined;
  expect(() => {
    serialized = adapter.serialize(job, profile);
  }, `ready=true must be serializable; reasons: ${JSON.stringify(readiness.reasons)}`).not.toThrow(
    AdapterSerializationBlocked,
  );
  expect(serialized).toBeDefined();
  expect(serialized!.length).toBeGreaterThan(0);
}

describe('PostprocessorAdapter contract invariant', () => {
  it('PTX generic: ready=true → serialize executes (byte identity with golden #348 preserved)', async () => {
    const job = buildFixtureCuttingJob();
    assertReadyImpliesSerializable(PTX_POSTPROCESSOR_ADAPTER, job, PTX_GENERIC_PROFILE);

    const bytes = PTX_POSTPROCESSOR_ADAPTER.serialize(job, PTX_GENERIC_PROFILE);
    expect(await sha256Hex(bytes)).toBe(
      '544dcae574bc19e19f934f96b2ad1dc104a2d7b1f668262a83ae09df72510f09',
    );
  });

  it('SAW on a fully evidenced synthetic profile: ready stays false (serializer unimplemented)', () => {
    const job = buildFixtureCuttingJob();
    const complete: OutputCompatibilityProfile = {
      ...SAW_HOMAG_PROFILE,
      ref: { outputCompatibilityProfileId: 'saw-homag-test-complete', revisionId: 'rX' },
      dimensions: {
        fileExtension: 'saw',
        encoding: 'ascii',
        lineEnding: 'crlf',
        recordSyntax: 'sample',
        coordinateConvention: 'sample',
        kerfSemantics: 'sample',
        sheetIdentity: 'sample',
      },
      pendingEvidence: [],
    };
    const readiness = SAW_POSTPROCESSOR_ADAPTER.canSerialize(job, complete);
    expect(readiness.ready).toBe(false);
    assertReadyImpliesSerializable(SAW_POSTPROCESSOR_ADAPTER, job, complete);
  });

  it('MPR on a fully evidenced synthetic profile: ready stays false (serializer unimplemented)', () => {
    const job = buildFixtureMachiningJob();
    const complete: OutputCompatibilityProfile = {
      ref: { outputCompatibilityProfileId: 'mpr-woodwop-test-complete', revisionId: 'rX' },
      formatFamily: 'mpr',
      dimensions: {
        fileExtension: 'mpr',
        encoding: 'ascii',
        versionHeader: 'sample',
        coordinateConvention: 'sample',
        faceConvention: 'sample',
        toolIdConvention: 'sample',
        macroSyntax: 'sample',
        operationMacros: 'vertical-drilling,horizontal-drilling',
      },
      pendingEvidence: [],
      supportStatus: 'NOT_TESTED',
      digest: 'test-only',
    };
    const readiness = WOODWOP_MPR_POSTPROCESSOR_ADAPTER.canSerialize(job, complete);
    expect(readiness.ready).toBe(false);
    assertReadyImpliesSerializable(WOODWOP_MPR_POSTPROCESSOR_ADAPTER, job, complete);
  });
});
