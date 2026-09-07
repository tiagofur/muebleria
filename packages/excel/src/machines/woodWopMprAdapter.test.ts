import { describe, expect, it } from 'vitest';
import {
  AdapterSerializationBlocked,
  type OutputCompatibilityProfile,
} from '@granete/domain';
import { buildFixtureMachiningJob } from './machineOutputFixtures';
import {
  describeMachiningOperations,
  describeUnrepresentableOperations,
  MPR_ADAPTER_IMPLEMENTATION_DESCRIPTOR,
  WOODWOP_MPR_POSTPROCESSOR_ADAPTER,
} from './woodWopMprAdapter';
import { MPR_WOODWOP_PROFILE, PTX_GENERIC_PROFILE } from './profiles';
import { canonicalJson, sha256Hex } from './digest';

describe('WOODWOP_MPR_POSTPROCESSOR_ADAPTER (evidence gate)', () => {
  it('fails closed: no evidenced MPR dimensions', () => {
    const job = buildFixtureMachiningJob();
    const readiness = WOODWOP_MPR_POSTPROCESSOR_ADAPTER.canSerialize(job, MPR_WOODWOP_PROFILE);
    expect(readiness.ready).toBe(false);
    expect(
      readiness.reasons.filter((r) => r.code === 'FIELD_FORMAT_EVIDENCE_REQUIRED').length,
    ).toBe(WOODWOP_MPR_POSTPROCESSOR_ADAPTER.requiredDimensions.length);
    expect(() => WOODWOP_MPR_POSTPROCESSOR_ADAPTER.serialize(job, MPR_WOODWOP_PROFILE)).toThrow(
      AdapterSerializationBlocked,
    );
  });

  it('reports every machining operation as unrepresentable — nothing silently dropped', () => {
    const job = buildFixtureMachiningJob();
    const operations = describeMachiningOperations(job);
    expect(operations).toHaveLength(6);

    const unrepresentable = describeUnrepresentableOperations(job, MPR_WOODWOP_PROFILE);
    const total = unrepresentable.reduce((sum, entry) => sum + entry.count, 0);
    expect(total).toBe(operations.length);
    expect(unrepresentable.map((u) => u.kind)).toContain('vertical-drilling');
    expect(unrepresentable.map((u) => u.kind)).toContain('horizontal-drilling');

    const readiness = WOODWOP_MPR_POSTPROCESSOR_ADAPTER.canSerialize(job, MPR_WOODWOP_PROFILE);
    const operationReasons = readiness.reasons.filter(
      (r) => r.code === 'OPERATION_NOT_REPRESENTABLE',
    );
    expect(operationReasons.length).toBeGreaterThan(0);
    expect(operationReasons.every((r) => r.detail.includes('refusing'))).toBe(true);
  });

  it('a partially evidenced profile still lists the uncovered remainder (no silent drop)', () => {
    const job = buildFixtureMachiningJob();
    // Test-only future shape: vertical drilling macros evidenced, horizontal not.
    const partial: OutputCompatibilityProfile = {
      ...MPR_WOODWOP_PROFILE,
      ref: { outputCompatibilityProfileId: 'mpr-woodwop-test', revisionId: 'rX' },
      dimensions: {
        fileExtension: 'mpr',
        encoding: 'ascii',
        versionHeader: 'sample',
        coordinateConvention: 'sample',
        faceConvention: 'sample',
        toolIdConvention: 'sample',
        macroSyntax: 'sample',
        operationMacros: 'vertical-drilling',
      },
      pendingEvidence: ['horizontalDrillingSyntax'],
    };
    const unrepresentable = describeUnrepresentableOperations(job, partial);
    expect(unrepresentable).toEqual([{ kind: 'horizontal-drilling', count: 2 }]);

    const readiness = WOODWOP_MPR_POSTPROCESSOR_ADAPTER.canSerialize(job, partial);
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons.map((r) => r.code)).toContain('OPERATION_NOT_REPRESENTABLE');
    expect(
      readiness.reasons.find((r) => r.code === 'OPERATION_NOT_REPRESENTABLE')?.detail,
    ).toContain('2 horizontal-drilling');
  });

  it('rejects wrong format family (never serializes machining through PTX)', () => {
    const job = buildFixtureMachiningJob() as never;
    const readiness = WOODWOP_MPR_POSTPROCESSOR_ADAPTER.canSerialize(job, PTX_GENERIC_PROFILE);
    expect(readiness.reasons.map((r) => r.code)).toContain('FORMAT_FAMILY_MISMATCH');
  });

  it('implementation digest matches its canonical descriptor', async () => {
    expect(await sha256Hex(canonicalJson(MPR_ADAPTER_IMPLEMENTATION_DESCRIPTOR))).toBe(
      WOODWOP_MPR_POSTPROCESSOR_ADAPTER.implementationDigest,
    );
  });
});
