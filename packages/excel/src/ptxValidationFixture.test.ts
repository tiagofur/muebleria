import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generatePtxString } from './ptxCutPlanExport';
import {
  buildExpectedPtxReadback,
  buildPtxValidationCutPlan,
  buildPtxValidationExportInput,
  PTX_VALIDATION_FIXTURE_ID,
  PTX_VALIDATION_FIXTURE_REVISION,
  serializeExpectedReadback,
} from './ptxValidationFixture';
import { buildActualReadbackTemplate } from './ptxReadback';
import type { CutPlan } from '@granete/domain';

const GOLDEN_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__/ptx/fixture-board-001.ptx');

/**
 * SHA-256 of the frozen golden PTX. Changing the fixture or the serializer
 * changes this hash: that is a NEW fixture revision, never an in-place edit.
 */
const GOLDEN_SHA256 = '544dcae574bc19e19f934f96b2ad1dc104a2d7b1f668262a83ae09df72510f09';

function generateFixturePtx(): string {
  return generatePtxString(buildPtxValidationExportInput());
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

describe('ptxValidationFixture', () => {
  it('builds a fully synthetic, self-consistent CutPlan with the frozen identity', () => {
    const plan = buildPtxValidationCutPlan();
    expect(plan.projectId).toBe(PTX_VALIDATION_FIXTURE_ID);
    expect(plan.projectName).toBe(PTX_VALIDATION_FIXTURE_ID);
    expect(plan.isFrozen).toBe(true);
    expect(plan.sheets).toHaveLength(2);
    expect(plan.sheets.flatMap((s) => s.pieces)).toHaveLength(7);
    expect(plan.config.sawKerfMm).toBe(4.4);
  });

  it('keeps the coverage contract: duplicates, quantity>1, rotation and grain variants', () => {
    const plan = buildPtxValidationCutPlan();
    const pieces = plan.sheets.flatMap((s) => s.pieces);

    // Duplicate dimensions with distinct identities (part-001 vs part-002).
    const p1 = pieces.find((p) => p.partCode === 'fixture-part-001')!;
    const p2 = pieces.find((p) => p.partCode === 'fixture-part-002')!;
    expect(p1.lengthMm).toBe(p2.lengthMm);
    expect(p1.widthMm).toBe(p2.widthMm);
    expect(p1.partCode).not.toBe(p2.partCode);
    expect(p1.labelRef).not.toBe(p2.labelRef);

    // Quantity 2 as two placements with distinct barcodes, exactly one rotated.
    const p4 = pieces.filter((p) => p.partCode === 'fixture-part-004');
    expect(p4).toHaveLength(2);
    expect(p4.map((p) => p.labelRef).sort()).toEqual(['fixture-label-004-1', 'fixture-label-004-2']);
    expect(p4.filter((p) => p.rotated)).toHaveLength(1);
    expect(p4.every((p) => p.grain === 0)).toBe(true);

    // Grain-1 pieces are never rotated.
    expect(pieces.filter((p) => p.grain === 1 && p.rotated)).toHaveLength(0);

    // Grain variation present.
    expect(pieces.some((p) => p.grain === 1)).toBe(true);
    expect(pieces.some((p) => p.grain === 0)).toBe(true);

    // Every banded piece carries an explicit thickness (no serializer fallback).
    for (const piece of pieces) {
      const banded = piece.L1 || piece.L2 || piece.W1 || piece.W2;
      if (banded) {
        expect(piece.edgeBandThicknessMm, `${piece.partCode} sin espesor de canto`).toBeDefined();
      }
    }

    // Useful and scrap remnants exist.
    const remnants = plan.sheets.flatMap((s) => s.remnants);
    expect(remnants.some((r) => r.isUseful)).toBe(true);
    expect(remnants.some((r) => !r.isUseful)).toBe(true);
  });

  it('is deterministic: two builds and two serializations are byte-identical', () => {
    const a = JSON.stringify(buildPtxValidationCutPlan());
    const b = JSON.stringify(buildPtxValidationCutPlan());
    expect(a).toBe(b);

    const ptxA = generatePtxString({ cutPlan: buildPtxValidationCutPlan() as CutPlan });
    const ptxB = generatePtxString({ cutPlan: buildPtxValidationCutPlan() as CutPlan });
    expect(ptxA).toBe(ptxB);
  });

  it('matches the frozen golden PTX byte-for-byte with the recorded SHA-256', () => {
    const ptx = generateFixturePtx();
    const golden = readFileSync(GOLDEN_PATH, 'utf8');

    expect(ptx).toBe(golden);
    expect(sha256(golden)).toBe(GOLDEN_SHA256);

    // Core markers the operator will check first in the receiving software.
    expect(ptx).toContain('UNIT=MM');
    expect(ptx).toContain('KERF=4.4');
    expect(ptx).toContain('JOB_NAME=fixture-board-001');
    expect(ptx).toContain('CUSTOMER=Fixture Operator');
    expect(ptx).toContain('TOTAL_SHEETS=2');
    expect(ptx).toContain('TOTAL_PIECES=7');
    expect(ptx).toContain('"sample-material-a"');
    expect(ptx).toContain('"sample-material-b"');
    expect(ptx).toContain('"fixture-part-004"');
    expect(ptx).toContain('"fixture-label-004-1"');
  });

  it('builds the expected readback from the same frozen fixture data', () => {
    const expected = buildExpectedPtxReadback();
    expect(expected.fixture.id).toBe(PTX_VALIDATION_FIXTURE_ID);
    expect(expected.fixture.revision).toBe(PTX_VALIDATION_FIXTURE_REVISION);
    expect(expected.job.placedPieceCount).toBe(7);
    expect(expected.materials).toHaveLength(2);
    expect(expected.parts.map((p) => p.partCode)).toEqual([
      'fixture-part-001',
      'fixture-part-002',
      'fixture-part-003',
      'fixture-part-004',
      'fixture-part-005',
      'fixture-part-006',
    ]);
    expect(expected.parts.find((p) => p.partCode === 'fixture-part-004')!.quantity).toBe(2);
    // Provenance is NOT representable by current PTX and must stay listed.
    expect(expected.notRepresentedByCurrentPtx).toContain('bomFingerprint');
    expect(expected.notRepresentedByCurrentPtx).toContain('productionReleaseId');
    // Expected serialization is deterministic too.
    expect(serializeExpectedReadback(expected)).toBe(serializeExpectedReadback(buildExpectedPtxReadback()));
  });

  it.runIf(Boolean(process.env.PTX_EMIT_FIXTURE_DIR))(
    'emits the validation bundle (fixture PTX + expected readback JSON)',
    () => {
      const outDir = process.env.PTX_EMIT_FIXTURE_DIR!;
      mkdirSync(outDir, { recursive: true });

      const ptx = generateFixturePtx();
      const ptxPath = resolve(outDir, `${PTX_VALIDATION_FIXTURE_ID}.ptx`);
      writeFileSync(ptxPath, Buffer.from(new TextEncoder().encode(ptx)));

      const expectedPath = resolve(outDir, `${PTX_VALIDATION_FIXTURE_ID}.expected.json`);
      writeFileSync(expectedPath, serializeExpectedReadback(buildExpectedPtxReadback()), 'utf8');

      // Operator starting point in the CORRECT actual-readback shape (the
      // expected JSON nests data differently and must not be fed as actual).
      const templatePath = resolve(outDir, `${PTX_VALIDATION_FIXTURE_ID}.actual-template.json`);
      writeFileSync(
        templatePath,
        `${JSON.stringify(buildActualReadbackTemplate(buildExpectedPtxReadback()), null, 2)}\n`,
        'utf8',
      );

      console.log(`[ptx-validation] PTX: ${ptxPath}`);
      console.log(`[ptx-validation] SHA-256: ${sha256(ptx)}`);
      console.log(`[ptx-validation] Expected readback: ${expectedPath}`);
      console.log(`[ptx-validation] Actual-readback template: ${templatePath}`);
    },
  );
});
