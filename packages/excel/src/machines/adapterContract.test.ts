import { describe, expect, it } from 'vitest';
import {
  AdapterSerializationBlocked,
  type OutputCompatibilityProfile,
  type PostprocessorAdapter,
} from '@granete/domain';
import { buildFixtureCuttingJob, buildFixtureMachiningJob } from './machineOutputFixtures';
import { KDT_POSTPROCESSOR_ADAPTER } from './kdtAdapter';
import { PTX_POSTPROCESSOR_ADAPTER } from './ptxAdapter';
import { SAW_POSTPROCESSOR_ADAPTER } from './sawAdapter';
import { WOODWOP_MPR_POSTPROCESSOR_ADAPTER } from './woodWopMprAdapter';
import { KDT_FLEXDRILL_1200_PROFILE, MPR_WOODWOP_PROFILE, PTX_GENERIC_PROFILE, SAW_HOMAG_PROFILE } from './profiles';
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

  it('MPR on the real r2 profile: ready=true → serialize executes the per-piece writer (#879 B2)', async () => {
    const job = buildFixtureMachiningJob();
    assertReadyImpliesSerializable(WOODWOP_MPR_POSTPROCESSOR_ADAPTER, job, MPR_WOODWOP_PROFILE);
    const bytes = WOODWOP_MPR_POSTPROCESSOR_ADAPTER.serialize(job, MPR_WOODWOP_PROFILE);
    expect(new TextDecoder().decode(bytes)).toContain('[H');
    // One program per piece/face-group: a multi-program job NEVER serializes
    // through the interface path — it must go through serializeMprPerPiece.
    const multiPiece = {
      ...job,
      drilling: {
        ...job.drilling,
        patterns: [
          job.drilling.patterns[0]!,
          { ...job.drilling.patterns[0]!, pieceCode: 'MOD-1-P02' },
        ],
      },
    };
    const multiReadiness = WOODWOP_MPR_POSTPROCESSOR_ADAPTER.canSerialize(
      multiPiece,
      MPR_WOODWOP_PROFILE,
    );
    expect(multiReadiness.ready).toBe(false);
    expect(() => WOODWOP_MPR_POSTPROCESSOR_ADAPTER.serialize(multiPiece, MPR_WOODWOP_PROFILE)).toThrow(
      AdapterSerializationBlocked,
    );
  });

  it('KDT on the real r2 profile: ready=true → serialize executes the per-piece writer (#1005 K2)', async () => {
    // El fixture sigue la convención canónica de caras y produce EXACTAMENTE
    // un programa (grupo back-up), así que ready=true garantiza serialización.
    const job = buildFixtureMachiningJob();
    assertReadyImpliesSerializable(KDT_POSTPROCESSOR_ADAPTER, job, KDT_FLEXDRILL_1200_PROFILE);
    const bytes = KDT_POSTPROCESSOR_ADAPTER.serialize(job, KDT_FLEXDRILL_1200_PROFILE);
    expect(new TextDecoder().decode(bytes)).toContain('<KDTPanelFormat>');
    // One program per piece/face-group: a multi-program job NEVER serializes
    // through the interface path — it must go through serializePerPiece (K3).
    const multiPiece = {
      ...job,
      drilling: {
        ...job.drilling,
        patterns: [
          job.drilling.patterns[0]!,
          { ...job.drilling.patterns[0]!, pieceCode: 'MOD-1-P02' },
        ],
      },
    };
    const multiReadiness = KDT_POSTPROCESSOR_ADAPTER.canSerialize(
      multiPiece,
      KDT_FLEXDRILL_1200_PROFILE,
    );
    expect(multiReadiness.ready).toBe(false);
    expect(() => KDT_POSTPROCESSOR_ADAPTER.serialize(multiPiece, KDT_FLEXDRILL_1200_PROFILE)).toThrow(
      AdapterSerializationBlocked,
    );
  });
});
