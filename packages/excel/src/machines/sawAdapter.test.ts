import { describe, expect, it } from 'vitest';
import {
  AdapterSerializationBlocked,
  type OutputCompatibilityProfile,
} from '@granete/domain';
import { buildFixtureCuttingJob } from './machineOutputFixtures';
import { SAW_ADAPTER_IMPLEMENTATION_DESCRIPTOR, SAW_POSTPROCESSOR_ADAPTER } from './sawAdapter';
import { SAW_HOMAG_PROFILE, SAW_REQUIRED_DIMENSIONS } from './profiles';
import { canonicalJson, sha256Hex } from './digest';

/** Fully evidenced synthetic profile: every required dimension present. */
function completeSawProfile(): OutputCompatibilityProfile {
  return {
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
}

describe('SAW_POSTPROCESSOR_ADAPTER (evidence gate)', () => {
  it('fails closed with FIELD_FORMAT_EVIDENCE_REQUIRED for saw-homag r1', () => {
    const job = buildFixtureCuttingJob();
    const readiness = SAW_POSTPROCESSOR_ADAPTER.canSerialize(job, SAW_HOMAG_PROFILE);
    expect(readiness.ready).toBe(false);
    expect(
      readiness.reasons.filter((r) => r.code === 'FIELD_FORMAT_EVIDENCE_REQUIRED').length,
    ).toBe(SAW_POSTPROCESSOR_ADAPTER.requiredDimensions.length);
    expect(() => SAW_POSTPROCESSOR_ADAPTER.serialize(job, SAW_HOMAG_PROFILE)).toThrow(
      AdapterSerializationBlocked,
    );
  });

  it('names the real .saw sample as the missing evidence (no invented format)', () => {
    const readiness = SAW_POSTPROCESSOR_ADAPTER.canSerialize(
      buildFixtureCuttingJob(),
      SAW_HOMAG_PROFILE,
    );
    expect(
      readiness.reasons
        .filter((r) => r.code === 'FIELD_FORMAT_EVIDENCE_REQUIRED')
        .every((r) => r.detail.includes('Client A')),
    ).toBe(true);
  });

  it('NEVER advertises ready while the serializer is unimplemented, even on a complete profile', () => {
    const job = buildFixtureCuttingJob();
    const profile = completeSawProfile();
    expect(Object.keys(profile.dimensions).sort()).toEqual(
      [...SAW_REQUIRED_DIMENSIONS].slice().sort(),
    );

    const readiness = SAW_POSTPROCESSOR_ADAPTER.canSerialize(job, profile);
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContainEqual(
      expect.objectContaining({ code: 'SERIALIZER_NOT_IMPLEMENTED' }),
    );
    // The blocker is implementation, not missing evidence.
    expect(readiness.reasons).toHaveLength(1);

    let threw: unknown;
    try {
      SAW_POSTPROCESSOR_ADAPTER.serialize(job, profile);
    } catch (error) {
      threw = error;
    }
    expect(threw).toBeInstanceOf(AdapterSerializationBlocked);
    expect((threw as Error).message).toContain('SERIALIZER_NOT_IMPLEMENTED');
  });

  it('implementation digest matches its canonical descriptor', async () => {
    expect(await sha256Hex(canonicalJson(SAW_ADAPTER_IMPLEMENTATION_DESCRIPTOR))).toBe(
      SAW_POSTPROCESSOR_ADAPTER.implementationDigest,
    );
  });
});
