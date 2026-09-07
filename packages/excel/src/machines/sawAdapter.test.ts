import { describe, expect, it } from 'vitest';
import { AdapterSerializationBlocked } from '@granete/domain';
import { buildFixtureCuttingJob } from './machineOutputFixtures';
import { SAW_ADAPTER_IMPLEMENTATION_DESCRIPTOR, SAW_POSTPROCESSOR_ADAPTER } from './sawAdapter';
import { SAW_HOMAG_PROFILE } from './profiles';
import { canonicalJson, sha256Hex } from './digest';

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
    expect(readiness.reasons.every((r) => r.detail.includes('Client A'))).toBe(true);
  });

  it('implementation digest matches its canonical descriptor', async () => {
    expect(await sha256Hex(canonicalJson(SAW_ADAPTER_IMPLEMENTATION_DESCRIPTOR))).toBe(
      SAW_POSTPROCESSOR_ADAPTER.implementationDigest,
    );
  });
});
