import { describe, expect, it } from 'vitest';
import { AdapterSerializationBlocked } from '@granete/domain';
import { buildFixtureCuttingJob } from './machineOutputFixtures';
import {
  PTX_ADAPTER_INDUSTRIAL_CONTRACT,
  PTX_ADAPTER_IMPLEMENTATION_DESCRIPTOR,
  PTX_POSTPROCESSOR_ADAPTER,
  resolvePtxCompilerRoute,
} from './ptxAdapter';
import {
  PTX_CADMATIC_3_PROFILE,
  PTX_CADMATIC_4_PROFILE,
  PTX_CADMATIC_4_CANDIDATE_PROFILE,
  PTX_CADMATIC_4_R3_PROFILE,
  PTX_CADMATIC_5_PROFILE,
  PTX_GENERIC_PROFILE,
  SAW_HOMAG_PROFILE,
} from './profiles';
import { canonicalJson, sha256Hex } from './digest';
import { generatePtxString } from '../ptxCutPlanExport';
import { GOLDEN_TEXT } from '../ptx/cutPlanPtxGolden';
import { GOLDEN_R3_TEXT } from '../ptx/cutPlanPtxGoldenR3';

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

  it('binds the implementation digest to effective r2/r3 options and stable industrial goldens', async () => {
    const contract = PTX_ADAPTER_INDUSTRIAL_CONTRACT;
    expect(contract.implementationDigest).toBe(PTX_POSTPROCESSOR_ADAPTER.implementationDigest);
    expect(await sha256Hex(canonicalJson(PTX_ADAPTER_IMPLEMENTATION_DESCRIPTOR))).toBe(
      contract.implementationDigest,
    );
    expect(contract.profiles.r2.digest).toBe(PTX_CADMATIC_4_CANDIDATE_PROFILE.digest);
    expect(contract.profiles.r3.digest).toBe(PTX_CADMATIC_4_R3_PROFILE.digest);
    expect(await sha256Hex(GOLDEN_TEXT)).toBe(contract.profiles.r2.goldenBytesSha256);
    expect(await sha256Hex(GOLDEN_R3_TEXT)).toBe(contract.profiles.r3.goldenBytesSha256);

    const legacyBytes = PTX_POSTPROCESSOR_ADAPTER.serialize(
      buildFixtureCuttingJob(),
      PTX_GENERIC_PROFILE,
    );
    expect(await sha256Hex(legacyBytes)).toBe(contract.legacyGoldenBytesSha256);

    const r2 = resolvePtxCompilerRoute(PTX_CADMATIC_4_CANDIDATE_PROFILE).config!;
    const r3 = resolvePtxCompilerRoute(PTX_CADMATIC_4_R3_PROFILE).config!;
    expect(r2.compileOptions).toMatchObject({
      trimType: 1,
      includeVectors: undefined,
      supportsPositiveTrim: undefined,
    });
    expect(r2.allowedFunctions).toEqual([0, 1, 2, 3]);
    expect(r3.compileOptions).toMatchObject({
      trimType: 1,
      includeVectors: undefined,
      supportsPositiveTrim: true,
    });
    expect(r3.allowedFunctions).toEqual([0, 1, 2, 3, 92]);
    expect(contract.behaviorMarkers).toEqual({
      compilerRoutes: ['ptx-cadmatic-4@r2', 'ptx-cadmatic-4@r3'],
      r3TrimProjection: 'fixed-frame-trim-type-1-vectors-off',
      r3ReleaseScheduling: 'phase-2-rest-remnant-function-92-before-dependent-recut',
      readback: 'parser-plus-independent-cut-program-verifier',
      legacyRoute: 'ptx-generic@r1-only',
    });
  });

  it('requires exactly the dimensions the serializer consumes', () => {
    const required = new Set(PTX_POSTPROCESSOR_ADAPTER.requiredDimensions);
    for (const dimension of Object.keys(PTX_GENERIC_PROFILE.dimensions)) {
      expect(required.has(dimension)).toBe(true);
    }
  });
});
