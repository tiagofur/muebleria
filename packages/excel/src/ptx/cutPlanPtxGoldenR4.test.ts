/**
 * #781 — golden r4 candidate fixture test (field dialect).
 *
 * Freezes a REAL optimizeCutPlan result end to end under the r4 candidate
 * policy: same deterministic input (rows + catalog + config + options) must
 * always compile to the frozen document, mapping and bytes; the frozen text
 * must parse back to the frozen document and verify semantically against the
 * executed program. LAB_FIXTURE / NOT_MACHINE_VALIDATED: this is a lab
 * candidate, not a CADmatic acceptance and not one of the five kitchens.
 */

import { describe, expect, it } from 'vitest';
import { optimizeCutPlan } from '@granete/domain';
import { parsePtxDocumentBytes } from './parse';
import { serializePtxDocument } from './serialize';
import { validatePtxDocument } from './validate';
import { ptxDocumentsEqual } from './equivalence';
import { compileCutPlanToPtxDocument, type PtxCompilationMapping, type PtxCompiledSheetMapping } from './compileCutPlan';
import type { PtxCutRecord, PtxOffcutRecord } from './records';
import { verifyCutPlanPtxReadback } from './verifyCutPlanPtxReadback';
import {
  GOLDEN_R4_CONFIG,
  GOLDEN_R4_DOCUMENT,
  GOLDEN_R4_MAPPING,
  GOLDEN_R4_MATERIALS,
  GOLDEN_R4_OPTIONS,
  GOLDEN_R4_PROJECT_ID,
  GOLDEN_R4_ROWS,
  GOLDEN_R4_TEXT,
} from './cutPlanPtxGoldenR4';

function buildGoldenR4Plan() {
  return optimizeCutPlan(GOLDEN_R4_PROJECT_ID, GOLDEN_R4_ROWS, GOLDEN_R4_MATERIALS, GOLDEN_R4_CONFIG);
}

function buildGoldenR4Mapping(): PtxCompilationMapping {
  return {
    jobIndex: GOLDEN_R4_MAPPING.jobIndex,
    materialIndexByCode: new Map(Object.entries(GOLDEN_R4_MAPPING.materialIndexByCode)),
    partIndexByPieceRef: new Map(Object.entries(GOLDEN_R4_MAPPING.partIndexByPieceRef)),
    pieceRefByPartIndex: [...GOLDEN_R4_MAPPING.pieceRefByPartIndex],
    offcutRegionRefByOffcutIndex: [...GOLDEN_R4_MAPPING.offcutRegionRefByOffcutIndex],
    sheetIndexByPatternIndex: [...GOLDEN_R4_MAPPING.sheetIndexByPatternIndex],
    sheets: GOLDEN_R4_MAPPING.sheets.map((sheet) => ({
      sheetIndex: sheet.sheetIndex,
      boardIndex: sheet.boardIndex,
      patternIndex: sheet.patternIndex,
      patternType: sheet.patternType as PtxCompiledSheetMapping['patternType'],
      cutIndexByCutId: new Map(Object.entries(sheet.cutIndexByCutId)),
      cutIdByCutIndex: [...sheet.cutIdByCutIndex],
      releaseCutIndexByRegionId: new Map(Object.entries(sheet.releaseCutIndexByRegionId)),
      offcutIndexByRegionId: new Map(Object.entries(sheet.offcutIndexByRegionId)),
    })),
  };
}

describe('golden r4 candidato LAB_FIXTURE NOT_MACHINE_VALIDATED (dialecto de campo #781)', () => {
  it('recompila el mismo plan real al documento, mapping y bytes congelados', () => {
    const plan = buildGoldenR4Plan();
    const compiled = compileCutPlanToPtxDocument(plan, GOLDEN_R4_OPTIONS);
    expect(compiled.document).toEqual(GOLDEN_R4_DOCUMENT);
    expect(compiled.mapping.partIndexByPieceRef).toEqual(
      buildGoldenR4Mapping().partIndexByPieceRef,
    );
    expect(serializePtxDocument(compiled.document, { decimalPlaces: 2 })).toBe(GOLDEN_R4_TEXT);
  });

  it('el texto congelado parsea de vuelta al documento congelado y verifica semánticamente', () => {
    const bytes = new TextEncoder().encode(GOLDEN_R4_TEXT);
    const parsed = parsePtxDocumentBytes(bytes);
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxDocumentsEqual(parsed, GOLDEN_R4_DOCUMENT)).toBe(true);

    const plan = buildGoldenR4Plan();
    const issues = verifyCutPlanPtxReadback(parsed, plan, buildGoldenR4Mapping(), GOLDEN_R4_OPTIONS);
    expect(issues).toEqual([]);
  });

  it('demuestra el subconjunto r4 completo (#781: códigos, OFC_QTY, orden, Xn/92)', () => {
    const doc = GOLDEN_R4_DOCUMENT;

    // PARTS_REQ.CODE = workshop manufacturing codes; one per physical piece,
    // copy suffix -C2 for the second instance of the qty-2 row.
    const codes = doc.records
      .filter((r) => r.type === 'PARTS_REQ')
      .map((r) => (r as { code: string }).code);
    expect(codes).toEqual([
      'MOD-CAJ-01-P01',
      'MOD-CAJ-01-P02',
      'MOD-CAJ-01-P03',
      'MOD-CAJ-01-P04',
      'MOD-CAJ-01-P04-C2',
    ]);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code.length).toBeLessThanOrEqual(50);
    }

    // ONLY the demonstrated OFFCUTS↔FUNCTION-92 pairing is emitted (review
    // §3): the sheets' non-92 remnants stay undeclared in the industrial
    // file, so this plan declares exactly the one 92-released offcut.
    const offcuts = doc.records.filter(
      (r): r is PtxOffcutRecord => r.type === 'OFFCUTS',
    );
    expect(offcuts).toHaveLength(1);
    // #781 r4 micro-fix: the functional field samples carry an EMPTY
    // OFFCUTS.CODE cell — the internal remnant identity stays in the mapping.
    expect(offcuts[0]).toMatchObject({ producedQuantity: 1 });
    expect(offcuts[0]!.code).toBeUndefined();

    // …and all of them are declared BEFORE the first BOARDS/PATTERNS/CUTS
    // record in the byte stream (no forward Xn references).
    const lines = GOLDEN_R4_TEXT.split('\r\n').filter((line) => line !== '');
    const firstOffcut = lines.findIndex((line) => line.startsWith('OFFCUTS'));
    const firstPatternBlock = lines.findIndex(
      (line) => line.startsWith('BOARDS') || line.startsWith('PATTERNS') || line.startsWith('CUTS'),
    );
    expect(firstOffcut).toBeGreaterThanOrEqual(0);
    expect(firstOffcut).toBeLessThan(firstPatternBlock);

    // Xn appears ONLY on FUNCTION 92 rows; other remnants are OFFCUTS-only.
    const cuts = doc.records.filter((r): r is PtxCutRecord => r.type === 'CUTS');
    const xnRows = cuts.filter((r) => r.partReference.kind === 'offcut');
    expect(xnRows).toHaveLength(1);
    expect(xnRows[0]!.functionCode).toBe(92);
    expect(xnRows[0]!.repeatQuantity).toBe(1);
    expect(xnRows[0]!.producedQuantity).toBeUndefined();
    // No pseudo-physical QTY_RPT=0/SEQUENCE=0 markers survive in r4.
    expect(cuts.some((r) => r.sequence === 0 && r.repeatQuantity === 0)).toBe(false);

    // CUT_INDEX (preorder) diverges from SEQUENCE (schedule): the phase-3
    // recut place-3-2 keeps structural index 4 with scheduled order 7.
    const place32 = cuts.find((r) => r.comment === 'place-3-2')!;
    expect(place32.cutIndex).toBe(4);
    expect(place32.sequence).toBe(7);
  });
});
