/**
 * #661 — golden r3 candidate fixture test (positive trims).
 *
 * Freezes a REAL optimizeCutPlan result end to end under the r3 candidate
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
import { compileCutPlanToPtxDocument, type PtxCompilationMapping } from './compileCutPlan';
import type { PtxCutRecord } from './records';
import { verifyCutPlanPtxReadback } from './verifyCutPlanPtxReadback';
import {
  GOLDEN_R3_CONFIG,
  GOLDEN_R3_DOCUMENT,
  GOLDEN_R3_MAPPING,
  GOLDEN_R3_MATERIALS,
  GOLDEN_R3_OPTIONS,
  GOLDEN_R3_PROJECT_ID,
  GOLDEN_R3_ROWS,
  GOLDEN_R3_TEXT,
} from './cutPlanPtxGoldenR3';

function buildGoldenR3Plan() {
  return optimizeCutPlan(GOLDEN_R3_PROJECT_ID, GOLDEN_R3_ROWS, GOLDEN_R3_MATERIALS, GOLDEN_R3_CONFIG);
}

function buildGoldenR3Mapping(): PtxCompilationMapping {
  return {
    jobIndex: GOLDEN_R3_MAPPING.jobIndex,
    materialIndexByCode: new Map(Object.entries(GOLDEN_R3_MAPPING.materialIndexByCode)),
    partIndexByPieceRef: new Map(Object.entries(GOLDEN_R3_MAPPING.partIndexByPieceRef)),
    pieceRefByPartIndex: [...GOLDEN_R3_MAPPING.pieceRefByPartIndex],
    offcutRegionRefByOffcutIndex: [...GOLDEN_R3_MAPPING.offcutRegionRefByOffcutIndex],
    sheetIndexByPatternIndex: [...GOLDEN_R3_MAPPING.sheetIndexByPatternIndex],
    sheets: GOLDEN_R3_MAPPING.sheets.map((sheet) => ({
      sheetIndex: sheet.sheetIndex,
      boardIndex: sheet.boardIndex,
      patternIndex: sheet.patternIndex,
      patternType: sheet.patternType,
      cutIndexByCutId: new Map(Object.entries(sheet.cutIndexByCutId)),
      cutIdByCutIndex: [...sheet.cutIdByCutIndex],
      releaseCutIndexByRegionId: new Map(Object.entries(sheet.releaseCutIndexByRegionId)),
      offcutIndexByRegionId: new Map(Object.entries(sheet.offcutIndexByRegionId)),
    })),
  };
}

describe('golden r3 candidato LAB_FIXTURE NOT_MACHINE_VALIDATED (trim positivo)', () => {
  it('recompila el mismo plan real al documento, mapping y bytes congelados', () => {
    const plan = buildGoldenR3Plan();
    const compiled = compileCutPlanToPtxDocument(plan, GOLDEN_R3_OPTIONS);

    expect(compiled.document).toEqual(GOLDEN_R3_DOCUMENT);
    expect(compiled.mapping.jobIndex).toBe(GOLDEN_R3_MAPPING.jobIndex);
    expect([...compiled.mapping.partIndexByPieceRef]).toEqual(
      Object.entries(GOLDEN_R3_MAPPING.partIndexByPieceRef),
    );
    expect(compiled.mapping.offcutRegionRefByOffcutIndex).toEqual([
      ...GOLDEN_R3_MAPPING.offcutRegionRefByOffcutIndex,
    ]);

    expect(serializePtxDocument(compiled.document, { decimalPlaces: GOLDEN_R3_OPTIONS.decimalPlaces }))
      .toBe(GOLDEN_R3_TEXT);
  });

  it('el texto congelado parsea de vuelta al documento congelado y verifica semánticamente', () => {
    const parsed = parsePtxDocumentBytes(new TextEncoder().encode(GOLDEN_R3_TEXT));
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxDocumentsEqual(parsed, GOLDEN_R3_DOCUMENT)).toBe(true);
    expect(parsed).toEqual(GOLDEN_R3_DOCUMENT);

    const plan = buildGoldenR3Plan();
    const issues = verifyCutPlanPtxReadback(parsed, plan, buildGoldenR3Mapping(), GOLDEN_R3_OPTIONS);
    expect(issues).toEqual([]);
  });

  it('demuestra el subconjunto r3 completo (#661 caso mínimo)', () => {
    const doc = GOLDEN_R3_DOCUMENT;
    const material = doc.records.find((r) => r.type === 'MATERIALS') as {
      trimFRip?: number;
      trimVRip?: number;
      trimFXct?: number;
      trimVXct?: number;
      trimHead?: number;
      trimFRct?: number;
      trimVRct?: number;
    };
    // MATERIALS.TRIM_* totales (incluyen kerf) y HEAD/FRCT/VRCT ausentes.
    expect(material.trimFRip).toBe(10);
    expect(material.trimVRip).toBe(10);
    expect(material.trimFXct).toBe(10);
    expect(material.trimVXct).toBe(10);
    expect(material.trimHead).toBeUndefined();
    expect(material.trimFRct).toBeUndefined();
    expect(material.trimVRct).toBeUndefined();

    const cuts = doc.records.filter((r) => r.type === 'CUTS') as { comment?: string; functionCode: number }[];
    // Ninguna fila CUTS perimetral de trim (sin double counting).
    for (const side of ['left', 'right', 'bottom', 'top']) {
      expect(cuts.some((row) => row.comment === `trim:${side}`)).toBe(false);
    }
    // FUNCTION 92/X1 presente, única, con QTY_RPT=1.
    const fn92 = doc.records.filter(
      (r) => r.type === 'CUTS' && r.functionCode === 92,
    ) as { repeatQuantity: number; producedQuantity?: number; partReference: { kind: string } }[];
    expect(fn92).toHaveLength(1);
    expect(fn92[0]!.repeatQuantity).toBe(1);
    expect(fn92[0]!.producedQuantity).toBeUndefined();
    expect(fn92[0]!.partReference).toEqual({ kind: 'offcut', offcutIndex: 1 });

    const text = GOLDEN_R3_TEXT;
    // La fila 92 lleva QTY_PARTS ausente (celda vacía, no 0).
    const row92 = text.split('\r\n').find((line) => line.includes(',92,'))!;
    expect(row92).toMatch(/,92,\d+(\.\d+)?,1,X1,,/);
  });

  it('CUT_INDEX (preorder) y SEQUENCE (schedule) divergen en el golden congelado', () => {
    const rows = GOLDEN_R3_DOCUMENT.records.filter(
      (r): r is PtxCutRecord => r.type === 'CUTS',
    );
    const place31 = rows.find((r) => r.comment === 'place-3-1')!;
    const release92 = rows.find((r) => r.comment === 'place-3-1:rest')!;
    const place32 = rows.find((r) => r.comment === 'place-3-2')!;
    // Preorder: place-3-2 (hijo kept) precede a la liberación; schedule: la 92
    // va tras su productor y antes del recut dependiente.
    expect(place32.cutIndex).toBeLessThan(release92.cutIndex);
    expect(release92.sequence).toBe(place31.sequence + 1);
    expect(release92.sequence).toBeLessThan(place32.sequence);
  });

  it('responde las preguntas de la tabla inversa', () => {
    const mapping = buildGoldenR3Mapping();
    expect(mapping.offcutRegionRefByOffcutIndex[0]).toEqual({
      sheetIndex: 0,
      regionId: 'place-3-1:rest',
    });
    expect(mapping.sheets[0]!.offcutIndexByRegionId.get('place-3-1:rest')).toBe(1);
  });

  it('está etiquetado como candidato de laboratorio sin claims de receptor', () => {
    expect(GOLDEN_R3_DOCUMENT.header.title).toBe('LAB_FIXTURE NOT_MACHINE_VALIDATED');
    expect(GOLDEN_R3_TEXT).not.toContain('CADmatic accepted');
    expect(GOLDEN_R3_TEXT).not.toContain('CADMATIC');
    expect(GOLDEN_R3_TEXT).not.toMatch(/(^|[^_])VALIDATED/); // sólo el sello NOT_MACHINE_VALIDATED
    const job = GOLDEN_R3_DOCUMENT.records.find((r) => r.type === 'JOBS') as { description?: string };
    expect(job.description).toBe('GRANETE NON-PRODUCTION PTX CANDIDATE');
  });
});
