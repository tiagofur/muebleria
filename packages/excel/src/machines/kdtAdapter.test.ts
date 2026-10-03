import { describe, expect, it } from 'vitest';
import {
  AdapterSerializationBlocked,
  type OutputCompatibilityProfile,
} from '@granete/domain';
import { buildFixtureMachiningJob } from './machineOutputFixtures';
import { KDT_ADAPTER_IMPLEMENTATION_DESCRIPTOR, KDT_POSTPROCESSOR_ADAPTER } from './kdtAdapter';
import { KDT_FLEXDRILL_1200_PROFILE, KDT_REQUIRED_DIMENSIONS } from './profiles';
import { canonicalJson, sha256Hex } from './digest';

/** Fully evidenced synthetic profile: every required dimension present. */
function completeKdtProfile(): OutputCompatibilityProfile {
  return {
    ...KDT_FLEXDRILL_1200_PROFILE,
    ref: { outputCompatibilityProfileId: 'kdt-flexdrill-1200-test-complete', revisionId: 'rX' },
    dimensions: {
      fileExtension: 'xml',
      encoding: 'utf-8',
      lineEnding: 'crlf',
      decimalPlaces: 0,
      unit: 'mm',
      coordinateConvention: 'bottom-left-top-face',
      operationTypeNos: '1,2',
      alignmentFacePolicy: 'sample',
    },
    pendingEvidence: [],
  };
}

describe('KDT_POSTPROCESSOR_ADAPTER (evidence gate, #1005 K1)', () => {
  it('fails closed with FIELD_FORMAT_EVIDENCE_REQUIRED for kdt-flexdrill-1200 r1', () => {
    const job = buildFixtureMachiningJob();
    const readiness = KDT_POSTPROCESSOR_ADAPTER.canSerialize(job, KDT_FLEXDRILL_1200_PROFILE);
    expect(readiness.ready).toBe(false);
    expect(
      readiness.reasons.filter((r) => r.code === 'FIELD_FORMAT_EVIDENCE_REQUIRED').length,
    ).toBe(KDT_POSTPROCESSOR_ADAPTER.requiredDimensions.length);
    expect(() => KDT_POSTPROCESSOR_ADAPTER.serialize(job, KDT_FLEXDRILL_1200_PROFILE)).toThrow(
      AdapterSerializationBlocked,
    );
  });

  it('NEVER advertises ready while the serializer is unimplemented, even on a complete profile', () => {
    const job = buildFixtureMachiningJob();
    const profile = completeKdtProfile();
    expect(Object.keys(profile.dimensions).sort()).toEqual(
      [...KDT_REQUIRED_DIMENSIONS].slice().sort(),
    );

    const readiness = KDT_POSTPROCESSOR_ADAPTER.canSerialize(job, profile);
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContainEqual(
      expect.objectContaining({ code: 'SERIALIZER_NOT_IMPLEMENTED' }),
    );
    // The blocker is implementation, not missing evidence.
    expect(readiness.reasons).toHaveLength(1);

    let threw: unknown;
    try {
      KDT_POSTPROCESSOR_ADAPTER.serialize(job, profile);
    } catch (error) {
      threw = error;
    }
    expect(threw).toBeInstanceOf(AdapterSerializationBlocked);
    expect((threw as Error).message).toContain('SERIALIZER_NOT_IMPLEMENTED');
  });

  it('refuses operations outside the evidenced TypeNo subset instead of dropping them', () => {
    const job = buildFixtureMachiningJob();
    const partial: OutputCompatibilityProfile = {
      ...completeKdtProfile(),
      dimensions: { ...completeKdtProfile().dimensions, operationTypeNos: '1' },
    };
    const readiness = KDT_POSTPROCESSOR_ADAPTER.canSerialize(job, partial);
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContainEqual(
      expect.objectContaining({
        code: 'OPERATION_NOT_REPRESENTABLE',
        dimension: 'operationTypeNos',
      }),
    );
  });

  it('implementation digest matches its canonical descriptor', async () => {
    expect(await sha256Hex(canonicalJson(KDT_ADAPTER_IMPLEMENTATION_DESCRIPTOR))).toBe(
      KDT_POSTPROCESSOR_ADAPTER.implementationDigest,
    );
  });
});
