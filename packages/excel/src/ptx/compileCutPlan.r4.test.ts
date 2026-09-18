/**
 * #781 — r4 field-dialect candidate policy (compile + serialize + readback).
 *
 * Covers the deltas the second CADLink candidate introduces over r2/r3:
 * - OFFCUTS.OFC_QTY = 1 (evidenced column; R2201/R7301 sanitized samples);
 * - OFFCUTS declared BEFORE the PATTERNS/CUTS blocks (no forward Xn refs);
 * - NO Xn marker rows outside FUNCTION 92 (non-92 remnants are OFFCUTS-only);
 * - PARTS_REQ.CODE = workshop manufacturing code (clean labelRef, one per
 *   physical piece), with fail-closed length/duplicate guards.
 *
 * The same plan compiled WITHOUT the r4 options keeps the r2/r3 shape
 * (OFC_QTY cell absent, OFFCUTS last, marker rows present) — byte history is
 * never mutated in place.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUT_PLAN_CONFIG,
  executeCutProgram,
  packSingleSheetStrip,
} from '@granete/domain';
import type {
  CutInstruction,
  CutPlan,
  CutPlanConfig,
  CutPlanPlacedPiece,
  CutPlanRemnant,
  CutPlanSheet,
  CutProgramInput,
  ProductionCutRow,
} from '@granete/domain';
import type { PtxCutRecord, PtxOffcutRecord, PtxRecord } from './records';
import { parsePtxDocumentBytes } from './parse';
import { serializePtxDocumentBytes } from './serialize';
import { validatePtxDocument } from './validate';
import {
  compileCutPlanToPtxDocument,
  PtxCompilationError,
  type CompileCutPlanToPtxOptions,
} from './compileCutPlan';
import { verifyCutPlanPtxReadback } from './verifyCutPlanPtxReadback';
import { PTX_POSTPROCESSOR_ADAPTER } from '../machines/ptxAdapter';
import { PTX_CADMATIC_4_R4_PROFILE } from '../machines/profiles';

const R4_OPTIONS: CompileCutPlanToPtxOptions = {
  headerVersion: 1,
  headerOrigin: 0,
  trimType: 0,
  title: 'LAB_R4_FIXTURE NOT_MACHINE_VALIDATED',
  decimalPlaces: 2,
  offcutsWithQuantity: true,
  offcutsBeforePatterns: true,
  offcutCutMarkers: 'function92-only',
  partCodeAuthority: 'workshop-labelref',
  partCodeMaxLength: 50,
};

const R3_LIKE_OPTIONS: CompileCutPlanToPtxOptions = {
  headerVersion: 1,
  headerOrigin: 0,
  trimType: 0,
  title: 'LAB_R4_FIXTURE NOT_MACHINE_VALIDATED',
  decimalPlaces: 2,
};

const BASE_CONFIG: CutPlanConfig = {
  ...DEFAULT_CUT_PLAN_CONFIG,
  sawKerfMm: 4,
  trim: { topMm: 0, bottomMm: 0, leftMm: 0, rightMm: 0 },
};

/** Remnant threshold low enough that the 1200×376 sheet rest stays useful. */
const DIDACTIC_CONFIG: CutPlanConfig = {
  ...BASE_CONFIG,
  minRemnantLengthMm: 400,
  minRemnantWidthMm: 300,
};

function makeRow(params: {
  quantity: number;
  lengthMm: number;
  widthMm: number;
  grain: 0 | 1;
  partCode: string;
  labelRef?: string;
  materialCode?: string;
}): ProductionCutRow {
  return {
    quantity: params.quantity,
    lengthMm: params.lengthMm,
    widthMm: params.widthMm,
    description: `${params.partCode} lab`,
    materialName: 'Lab Board 18',
    materialCode: params.materialCode ?? 'LAB18',
    grain: params.grain,
    L1: 0,
    L2: 0,
    W1: 0,
    W2: 0,
    partCode: params.partCode,
    partName: params.partCode,
    moduleCode: 'M01',
    labelRef: params.labelRef ?? '',
    thicknessMm: 18,
  };
}

/**
 * Local mirror of the domain's unrollRows (#781 labelRef semantics included):
 * copies 2..N of a row with quantity > 1 get the `-C<n>` suffix so every
 * physical piece keeps a unique workshop code.
 */
function unroll(rows: readonly ProductionCutRow[]): {
  originalRow: ProductionCutRow;
  indexInUnrolled: number;
  length: number;
  width: number;
  grain: 0 | 1;
  id: string;
  labelRef: string;
}[] {
  const result: {
    originalRow: ProductionCutRow;
    indexInUnrolled: number;
    length: number;
    width: number;
    grain: 0 | 1;
    id: string;
    labelRef: string;
  }[] = [];
  let seq = 0;
  for (const row of rows) {
    const qty = Math.max(1, row.quantity);
    for (let i = 0; i < qty; i++) {
      seq++;
      const rowLabel = row.labelRef?.trim() || '';
      result.push({
        originalRow: row,
        indexInUnrolled: seq,
        length: Math.max(1, row.lengthMm),
        width: Math.max(1, row.widthMm),
        grain: row.grain,
        id: `${row.partCode || 'P'}-${seq}`,
        labelRef:
          rowLabel !== '' && qty > 1 && i > 0 ? `${rowLabel}-C${i + 1}` : rowLabel,
      });
    }
  }
  return result;
}

interface LabPlacement {
  readonly pieces: readonly CutPlanPlacedPiece[];
  readonly remnants: readonly CutPlanRemnant[];
  readonly instructions: readonly CutInstruction[];
  readonly sheetIndex: number;
  readonly sheetWidthMm: number;
  readonly sheetLengthMm: number;
  readonly materialCode: string;
  readonly materialName: string;
  readonly thicknessMm?: number;
  readonly cutProgram?: CutProgramInput;
  readonly strategy?: CutPlanSheet['strategy'];
}

function sheetFromPlacement(placement: LabPlacement): CutPlanSheet {
  return {
    sheetIndex: placement.sheetIndex,
    strategy: 'saw-guillotine',
    materialCode: placement.materialCode,
    materialName: placement.materialName,
    sheetWidthMm: placement.sheetWidthMm,
    sheetLengthMm: placement.sheetLengthMm,
    thicknessMm: placement.thicknessMm,
    pieces: placement.pieces,
    remnants: placement.remnants,
    instructions: placement.instructions,
    cutProgram: placement.cutProgram,
    netPiecesAreaM2: 0,
    grossSheetAreaM2: 0,
    usableRemnantAreaM2: 0,
    wasteAreaM2: 0,
    wastePercent: 0,
    yieldPercent: 0,
  };
}

function planFromSheets(sheets: readonly CutPlanSheet[], config: CutPlanConfig): CutPlan {
  return {
    id: 'cutplan-lab-781',
    projectId: 'lab-781',
    projectName: 'Lab 781',
    generatedAt: '2026-09-17T00:00:00.000Z',
    version: 1,
    isFrozen: false,
    config,
    sheets,
    stats: {
      totalSheets: sheets.length,
      totalPieces: sheets.reduce((sum, s) => sum + s.pieces.length, 0),
      totalGrossAreaM2: 0,
      totalNetPiecesAreaM2: 0,
      totalUsefulRemnantsAreaM2: 0,
      totalWasteAreaM2: 0,
      globalWastePercent: 0,
      globalYieldPercent: 0,
      byMaterial: [],
    },
    usefulRemnants: [],
  };
}

/** Didactic dossier sheet: 1200×700, kerf 4, A 450×320 + B 280×210, useful rest. */
function buildDidacticPlan(): CutPlan {
  const rows = [
    makeRow({ quantity: 1, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'A', labelRef: 'MOD-CAJ-01-P01' }),
    makeRow({ quantity: 1, lengthMm: 280, widthMm: 210, grain: 1, partCode: 'B', labelRef: 'MOD-CAJ-01-P02' }),
  ];
  const { sheet } = packSingleSheetStrip(
    unroll(rows),
    0,
    1200,
    700,
    DIDACTIC_CONFIG,
    'LAB18',
    'Lab Board 18',
    18,
  );
  return planFromSheets([sheetFromPlacement(sheet)], DIDACTIC_CONFIG);
}

function runFullChain(plan: CutPlan, options: CompileCutPlanToPtxOptions): string {
  for (const sheet of plan.sheets) {
    expect(sheet.cutProgram).toBeDefined();
    expect(() => executeCutProgram(sheet.cutProgram!)).not.toThrow();
  }
  const compiled = compileCutPlanToPtxDocument(plan, options);
  expect(validatePtxDocument(compiled.document)).toEqual([]);
  const bytes = serializePtxDocumentBytes(compiled.document, {
    decimalPlaces: options.decimalPlaces,
  });
  const parsed = parsePtxDocumentBytes(bytes);
  expect(validatePtxDocument(parsed)).toEqual([]);
  expect(verifyCutPlanPtxReadback(parsed, plan, compiled.mapping, options)).toEqual([]);
  return new TextDecoder().decode(bytes);
}

function cutsOf(records: readonly PtxRecord[]): PtxCutRecord[] {
  return records.filter((r): r is PtxCutRecord => r.type === 'CUTS');
}

function offcutsOf(records: readonly PtxRecord[]): PtxOffcutRecord[] {
  return records.filter((r): r is PtxOffcutRecord => r.type === 'OFFCUTS');
}

describe('r4 (#781) — dialecto de campo: OFC_QTY + OFFCUTS declarado antes + Xn sólo en 92', () => {
  it('emite OFFCUTS con OFC_QTY=1 antes de PATTERNS/CUTS y readback verde', () => {
    const plan = buildDidacticPlan();
    const text = runFullChain(plan, R4_OPTIONS);

    // OFFCUTS row carries the evidenced 8th cell (OFC_QTY=1)…
    const offcutLine = text.split('\r\n').find((line) => line.startsWith('OFFCUTS'))!;
    expect(offcutLine).toMatch(/^OFFCUTS,1,1,.+,1,1200,376,1$/);
    // …and is declared BEFORE any PATTERNS/CUTS line (no forward Xn refs).
    const lines = text.split('\r\n').filter((line) => line !== '');
    const offcutPos = lines.findIndex((line) => line.startsWith('OFFCUTS'));
    const patternPos = lines.findIndex((line) => line.startsWith('PATTERNS') || line.startsWith('CUTS'));
    expect(offcutPos).toBeGreaterThan(-1);
    expect(offcutPos).toBeLessThan(patternPos);
  });

  it('no emite filas marcador Xn fuera de FUNCTION 92 (el resto phase-1 queda sólo como OFFCUTS)', () => {
    const plan = buildDidacticPlan();
    const compiled = compileCutPlanToPtxDocument(plan, R4_OPTIONS);

    const xnRows = cutsOf(compiled.document.records).filter(
      (r) => r.partReference.kind === 'offcut',
    );
    // The didactic sheet's only offcut (1200×376) is a phase-1 remnant —
    // NOT eligible for FUNCTION 92 — so it must have NO CUTS row at all.
    expect(xnRows).toHaveLength(0);

    // Its OFFCUTS record still exists, with OFC_QTY=1.
    const offcuts = offcutsOf(compiled.document.records);
    expect(offcuts).toHaveLength(1);
    expect(offcuts[0]).toMatchObject({ length: 1200, width: 376, producedQuantity: 1 });

    // The r2/r3 marker row (QTY_RPT=0, SEQUENCE=0, FUNCTION=1, X1) is gone.
    const marker = cutsOf(compiled.document.records).find(
      (r) => r.sequence === 0 && r.repeatQuantity === 0 && r.partReference.kind === 'offcut',
    );
    expect(marker).toBeUndefined();
  });

  it('sin las opciones r4, el mismo plan conserva la forma r2/r3 (OFC_QTY ausente, OFFCUTS al final, marcador presente)', () => {
    const plan = buildDidacticPlan();
    const text = runFullChain(plan, R3_LIKE_OPTIONS);

    const lines = text.split('\r\n').filter((line) => line !== '');
    const offcutLine = lines.find((line) => line.startsWith('OFFCUTS'))!;
    expect(offcutLine).toMatch(/^OFFCUTS,1,1,.+,1,1200,376$/);
    // OFFCUTS is the LAST record family in the byte stream…
    const offcutPos = lines.findIndex((line) => line.startsWith('OFFCUTS'));
    const patternPos = lines.findIndex((line) => line.startsWith('PATTERNS') || line.startsWith('CUTS'));
    expect(offcutPos).toBeGreaterThan(patternPos);
    // …and the phase-1 remnant marker row (QTY_RPT=0 + X1) still exists.
    expect(text).toMatch(/\r\nCUTS,1,1,5,0,1,376,0,X1,1,/);
  });
});

describe('r4 (#781) — autoridad de código de fabricación por pieza física', () => {
  it('PARTS_REQ.CODE usa el labelRef taller (una fila por pieza, sin consolidar)', () => {
    const plan = buildDidacticPlan();
    const compiled = compileCutPlanToPtxDocument(plan, R4_OPTIONS);
    const parts = compiled.document.records.filter((r) => r.type === 'PARTS_REQ') as {
      code: string;
    }[];
    expect(parts.map((p) => p.code)).toEqual(['MOD-CAJ-01-P01', 'MOD-CAJ-01-P02']);
  });

  it('piezas idénticas (quantity>1) reciben códigos distintos vía sufijo -Cn', () => {
    const rows = [
      makeRow({ quantity: 2, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'D', labelRef: 'MOD-CAJ-01-P03' }),
    ];
    const { sheet } = packSingleSheetStrip(
      unroll(rows),
      0,
      1200,
      700,
      DIDACTIC_CONFIG,
      'LAB18',
      'Lab Board 18',
      18,
    );
    const plan = planFromSheets([sheetFromPlacement(sheet)], DIDACTIC_CONFIG);
    const text = runFullChain(plan, R4_OPTIONS);
    const codes = text
      .split('\r\n')
      .filter((line) => line.startsWith('PARTS_REQ'))
      .map((line) => line.split(',')[3]);
    expect(codes).toEqual(['MOD-CAJ-01-P03', 'MOD-CAJ-01-P03-C2']);
  });

  it('dos piezas con el MISMO labelRef fallan cerrado (part_code_duplicate), no se fusionan', () => {
    const rows = [
      makeRow({ quantity: 1, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'E', labelRef: 'MOD-CAJ-01-P04' }),
      makeRow({ quantity: 1, lengthMm: 280, widthMm: 210, grain: 1, partCode: 'F', labelRef: 'MOD-CAJ-01-P04' }),
    ];
    const { sheet } = packSingleSheetStrip(
      unroll(rows),
      0,
      1200,
      700,
      DIDACTIC_CONFIG,
      'LAB18',
      'Lab Board 18',
      18,
    );
    const plan = planFromSheets([sheetFromPlacement(sheet)], DIDACTIC_CONFIG);
    let thrown: unknown;
    try {
      compileCutPlanToPtxDocument(plan, R4_OPTIONS);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PtxCompilationError);
    expect((thrown as PtxCompilationError).code).toBe('ptx_compile.part_code_duplicate');
  });

  it('un código de fabricación mayor al límite falla cerrado (part_code_too_long), sin truncar', () => {
    const longCode = `MOD-CAJ-01-${'X'.repeat(50)}`; // 60 chars > 50
    const rows = [
      makeRow({ quantity: 1, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'G', labelRef: longCode }),
    ];
    const { sheet } = packSingleSheetStrip(
      unroll(rows),
      0,
      1200,
      700,
      DIDACTIC_CONFIG,
      'LAB18',
      'Lab Board 18',
      18,
    );
    const plan = planFromSheets([sheetFromPlacement(sheet)], DIDACTIC_CONFIG);
    let thrown: unknown;
    try {
      compileCutPlanToPtxDocument(plan, R4_OPTIONS);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PtxCompilationError);
    expect((thrown as PtxCompilationError).code).toBe('ptx_compile.part_code_too_long');
  });

  it('readiness real del adapter (#781 acceptance §10): colisión de códigos bloquea ANTES de descargar', () => {
    const rows = [
      makeRow({ quantity: 1, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'E', labelRef: 'MOD-CAJ-01-P04' }),
      makeRow({ quantity: 1, lengthMm: 280, widthMm: 210, grain: 1, partCode: 'F', labelRef: 'MOD-CAJ-01-P04' }),
    ];
    const { sheet } = packSingleSheetStrip(
      unroll(rows),
      0,
      1200,
      700,
      DIDACTIC_CONFIG,
      'LAB18',
      'Lab Board 18',
      18,
    );
    const plan = planFromSheets([sheetFromPlacement(sheet)], DIDACTIC_CONFIG);
    const readiness = PTX_POSTPROCESSOR_ADAPTER.canSerialize(
      { jobId: plan.id, cutPlan: plan } as never,
      PTX_CADMATIC_4_R4_PROFILE,
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons.map((reason) => reason.code)).toContain('ptx_compile.part_code_duplicate');
  });
});
