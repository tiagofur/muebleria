/**
 * #650 PR 5 — golden candidate fixture test.
 *
 * Freezes a REAL optimizeCutPlan result end to end: same deterministic input
 * (rows + catalog + config + options) must always compile to the frozen
 * document, mapping and bytes; the frozen text must parse back to the frozen
 * document and verify semantically against the program. LAB_FIXTURE /
 * NOT_MACHINE_VALIDATED: this is a lab candidate, not a CADmatic acceptance
 * and not one of the five kitchens.
 */

import { describe, expect, it } from 'vitest';
import { optimizeCutPlan } from '@granete/domain';
import { parsePtxDocumentBytes } from './parse';
import { serializePtxDocument } from './serialize';
import { validatePtxDocument } from './validate';
import { ptxDocumentsEqual } from './equivalence';
import { compileCutPlanToPtxDocument, type PtxCompilationMapping } from './compileCutPlan';
import { verifyCutPlanPtxReadback } from './verifyCutPlanPtxReadback';
import {
  GOLDEN_CONFIG,
  GOLDEN_DOCUMENT,
  GOLDEN_MAPPING,
  GOLDEN_MATERIALS,
  GOLDEN_OPTIONS,
  GOLDEN_PROJECT_ID,
  GOLDEN_ROWS,
  GOLDEN_TEXT,
} from './cutPlanPtxGolden';

function buildGoldenPlan() {
  return optimizeCutPlan(GOLDEN_PROJECT_ID, GOLDEN_ROWS, GOLDEN_MATERIALS, GOLDEN_CONFIG);
}

function buildGoldenMapping(): PtxCompilationMapping {
  return {
    jobIndex: GOLDEN_MAPPING.jobIndex,
    materialIndexByCode: new Map(Object.entries(GOLDEN_MAPPING.materialIndexByCode)),
    partIndexByPieceRef: new Map(Object.entries(GOLDEN_MAPPING.partIndexByPieceRef)),
    pieceRefByPartIndex: [...GOLDEN_MAPPING.pieceRefByPartIndex],
    offcutRegionRefByOffcutIndex: [...GOLDEN_MAPPING.offcutRegionRefByOffcutIndex],
    sheetIndexByPatternIndex: [...GOLDEN_MAPPING.sheetIndexByPatternIndex],
    sheets: GOLDEN_MAPPING.sheets.map((sheet) => ({
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

describe('golden candidato LAB_FIXTURE NOT_MACHINE_VALIDATED', () => {
  it('recompila el mismo plan real al documento, mapping y bytes congelados', () => {
    const plan = buildGoldenPlan();
    const compiled = compileCutPlanToPtxDocument(plan, GOLDEN_OPTIONS);

    expect(compiled.document).toEqual(GOLDEN_DOCUMENT);
    expect(compiled.mapping.jobIndex).toBe(GOLDEN_MAPPING.jobIndex);
    expect([...compiled.mapping.partIndexByPieceRef]).toEqual(
      Object.entries(GOLDEN_MAPPING.partIndexByPieceRef),
    );
    expect(compiled.mapping.pieceRefByPartIndex).toEqual([...GOLDEN_MAPPING.pieceRefByPartIndex]);
    expect(compiled.mapping.offcutRegionRefByOffcutIndex).toEqual([
      ...GOLDEN_MAPPING.offcutRegionRefByOffcutIndex,
    ]);
    expect(compiled.mapping.sheets[0]!.cutIdByCutIndex).toEqual([
      ...GOLDEN_MAPPING.sheets[0]!.cutIdByCutIndex,
    ]);

    expect(serializePtxDocument(compiled.document, { decimalPlaces: GOLDEN_OPTIONS.decimalPlaces }))
      .toBe(GOLDEN_TEXT);
  });

  it('el texto congelado parsea de vuelta al documento congelado y verifica semánticamente', () => {
    const parsed = parsePtxDocumentBytes(new TextEncoder().encode(GOLDEN_TEXT));
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxDocumentsEqual(parsed, GOLDEN_DOCUMENT)).toBe(true);
    expect(parsed).toEqual(GOLDEN_DOCUMENT);

    const plan = buildGoldenPlan();
    const issues = verifyCutPlanPtxReadback(parsed, plan, buildGoldenMapping(), GOLDEN_OPTIONS);
    expect(issues).toEqual([]);
  });

  it('responde las preguntas de la tabla inversa', () => {
    const mapping = buildGoldenMapping();
    // ¿Qué cutId produjo CUT_INDEX 3?
    expect(mapping.sheets[0]!.cutIdByCutIndex[2]).toBe('place-2-1');
    // ¿Qué placement produjo PART_INDEX 2?
    expect(mapping.pieceRefByPartIndex[1]).toBe('B-2-s0');
    // ¿Qué sheet produjo PTN_INDEX 1?
    expect(mapping.sheetIndexByPatternIndex[0]).toBe(0);
    // ¿Qué remnant produjo X1?
    expect(mapping.offcutRegionRefByOffcutIndex[0]).toEqual({
      sheetIndex: 0,
      regionId: 'place-1-1:rest',
    });
  });

  it('está etiquetado como candidato de laboratorio sin claims de receptor', () => {
    expect(GOLDEN_DOCUMENT.header.title).toBe('LAB_FIXTURE NOT_MACHINE_VALIDATED');
    expect(GOLDEN_TEXT).not.toContain('CADmatic accepted');
    expect(GOLDEN_TEXT).not.toContain('CADMATIC');
    expect(GOLDEN_TEXT).not.toMatch(/(^|[^_])VALIDATED/); // sólo el sello NOT_MACHINE_VALIDATED
    const job = GOLDEN_DOCUMENT.records.find((r) => r.type === 'JOBS') as { description?: string };
    expect(job.description).toBe('GRANETE NON-PRODUCTION PTX CANDIDATE');
  });
});
