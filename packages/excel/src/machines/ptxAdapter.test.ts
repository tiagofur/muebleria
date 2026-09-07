import { describe, expect, it } from 'vitest';
import { AdapterSerializationBlocked } from '@granete/domain';
import { buildFixtureCuttingJob } from './machineOutputFixtures';
import {
  PTX_ADAPTER_IMPLEMENTATION_DESCRIPTOR,
  PTX_POSTPROCESSOR_ADAPTER,
} from './ptxAdapter';
import {
  PTX_CADMATIC_3_PROFILE,
  PTX_CADMATIC_4_PROFILE,
  PTX_CADMATIC_5_PROFILE,
  PTX_GENERIC_PROFILE,
  SAW_HOMAG_PROFILE,
} from './profiles';
import { canonicalJson, sha256Hex } from './digest';
import { generatePtxString } from '../ptxCutPlanExport';

describe('PTX_POSTPROCESSOR_ADAPTER', () => {
  it('is ready for ptx-generic and produces bytes identical to the existing serializer', () => {
    const job = buildFixtureCuttingJob();
    const readiness = PTX_POSTPROCESSOR_ADAPTER.canSerialize(job, PTX_GENERIC_PROFILE);
    expect(readiness.ready).toBe(true);
    expect(readiness.reasons).toEqual([]);

    const bytes = PTX_POSTPROCESSOR_ADAPTER.serialize(job, PTX_GENERIC_PROFILE);
    const text = new TextDecoder().decode(bytes);
    const direct = generatePtxString({
      cutPlan: job.cutPlan,
      projectName: job.presentation?.projectName,
      customerName: job.presentation?.customerName,
      projectCode: job.presentation?.projectCode,
    });
    expect(text).toBe(direct);
    // The frozen #348 golden lock: adapter output must stay byte-identical
    // to the audited fixture PTX (fixture-board-001 r1).
    expect(text).toContain('JOB_NAME=fixture-board-001');
    expect(text).toContain('TOTAL_PIECES=7');
  });

  it('is deterministic: same job + profile produce identical bytes', () => {
    const job = buildFixtureCuttingJob();
    const a = PTX_POSTPROCESSOR_ADAPTER.serialize(job, PTX_GENERIC_PROFILE);
    const b = PTX_POSTPROCESSOR_ADAPTER.serialize(job, PTX_GENERIC_PROFILE);
    expect(a).toEqual(b);
  });

  it('keeps duplicate-dimension parts distinct (identity is never collapsed)', () => {
    const job = buildFixtureCuttingJob();
    const text = new TextDecoder().decode(
      PTX_POSTPROCESSOR_ADAPTER.serialize(job, PTX_GENERIC_PROFILE),
    );
    expect(text).toContain('"fixture-part-001"');
    expect(text).toContain('"fixture-part-002"');
    expect(text).toContain('"fixture-label-001"');
    expect(text).toContain('"fixture-label-002"');
  });

  it('fails closed for every CADmatic profile (FIELD_FORMAT_EVIDENCE_REQUIRED)', () => {
    const job = buildFixtureCuttingJob();
    for (const profile of [
      PTX_CADMATIC_3_PROFILE,
      PTX_CADMATIC_4_PROFILE,
      PTX_CADMATIC_5_PROFILE,
    ]) {
      const readiness = PTX_POSTPROCESSOR_ADAPTER.canSerialize(job, profile);
      expect(readiness.ready, profile.ref.outputCompatibilityProfileId).toBe(false);
      const codes = readiness.reasons.map((r) => r.code);
      expect(codes.every((c) => c === 'FIELD_FORMAT_EVIDENCE_REQUIRED')).toBe(true);
      expect(readiness.reasons.length).toBeGreaterThanOrEqual(
        PTX_POSTPROCESSOR_ADAPTER.requiredDimensions.length,
      );

      expect(() => PTX_POSTPROCESSOR_ADAPTER.serialize(job, profile)).toThrow(
        AdapterSerializationBlocked,
      );
    }
  });

  it('rejects profiles of another format family (no extension-only compatibility)', () => {
    const job = buildFixtureCuttingJob();
    const readiness = PTX_POSTPROCESSOR_ADAPTER.canSerialize(job, SAW_HOMAG_PROFILE);
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons.map((r) => r.code)).toContain('FORMAT_FAMILY_MISMATCH');
  });

  it('implementation digest matches its canonical descriptor (behavior identity)', async () => {
    const digest = await sha256Hex(canonicalJson(PTX_ADAPTER_IMPLEMENTATION_DESCRIPTOR));
    expect(digest).toBe(PTX_POSTPROCESSOR_ADAPTER.implementationDigest);
  });

  it('requires exactly the dimensions the serializer consumes', () => {
    const required = new Set(PTX_POSTPROCESSOR_ADAPTER.requiredDimensions);
    for (const dimension of Object.keys(PTX_GENERIC_PROFILE.dimensions)) {
      expect(required.has(dimension)).toBe(true);
    }
  });
});
