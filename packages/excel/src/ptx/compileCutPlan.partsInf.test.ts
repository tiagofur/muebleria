/**
 * #789 — PARTS_INF/PARTS_UDI label compilation tests.
 *
 * Two groups:
 *
 * 1. The ANTISYMMETRIC GOLDEN SCENARIO (cutPlanPtxLabelsGolden.ts): two
 *    furniture modules, three physical units and a REPEATED occurrence whose
 *    lexical module order is deliberately OPPOSITE to the frozen occurrence
 *    order. Every label carries the data of ITS physical occurrence:
 *    PROD_NUM follows the frozen ordinal, the -L2 code suffix follows the
 *    occurrence count of the module, and no label crosses occurrences. Under
 *    any array/lexical-order derivation the codes and PROD_NUMs swap and the
 *    assertions fail.
 *
 * 2. Compiler fail-closed identity gates: a label without a placed piece, a
 *    placed piece without a label, duplicated codes, duplicated CNC drawing
 *    refs, duplicated BARCODE1 tokens and the option wiring contract.
 *
 * The scenario is NOT a receiver validation: NOT_TESTED/notClaimed stand,
 * and the serialized bytes only prove the internal contract (strict spec
 * preflight + independent readback === []).
 */

import { describe, expect, it } from 'vitest';
import { optimizeCutPlan } from '@granete/domain';
import type { CutPlanConfig, MaterialBoard, ProductionCutRow } from '@granete/domain';
import { parsePtxDocumentBytes } from './parse';
import { serializePtxDocument } from './serialize';
import { validatePtxDocument } from './validate';
import { ptxSpecPreflightDocument, serializePtxDocumentBytesSpecChecked } from './specPreflight';
import { buildPtxPartLabels, ptxBarcodeToken, type PtxPartLabelData } from './partLabels';
import { compileCutPlanToPtxDocument, PtxCompilationError, type CompileCutPlanToPtxOptions } from './compileCutPlan';
import { verifyCutPlanPtxReadback } from './verifyCutPlanPtxReadback';
import type { PtxPartsInfRecord, PtxPartsReqRecord, PtxPartsUdiRecord, PtxRecord } from './records';
import {
  AA_MODULE_CODE,
  AA_UNIT_2,
  BAND_ABS_1MM,
  BAND_PVC_2MM,
  LABELS_GOLDEN_CONFIG,
  LABELS_GOLDEN_MATERIALS,
  LABELS_GOLDEN_OPTIONS,
  LABELS_GOLDEN_PROJECT_ID,
  ZZ_MODULE_CODE,
  aaRows,
  labelInputs,
  scenarioRows,
} from './cutPlanPtxLabelsGolden';

async function buildScenario() {
  const labels = await buildPtxPartLabels(labelInputs());
  const plan = optimizeCutPlan(
    LABELS_GOLDEN_PROJECT_ID,
    scenarioRows(),
    LABELS_GOLDEN_MATERIALS,
    LABELS_GOLDEN_CONFIG,
  );
  const compiled = compileCutPlanToPtxDocument(plan, {
    ...LABELS_GOLDEN_OPTIONS,
    partLabels: labels,
  });
  return { labels, plan, compiled };
}

// ---------------------------------------------------------------------------
// Golden scenario
// ---------------------------------------------------------------------------

describe('#789 escenario dorado: 2 muebles, 3 ocurrencias, trampa antisimétrica', () => {
  it('10 piezas físicas con códigos únicos: -L2 sólo en la segunda ocurrencia ZZ, -C2 en copias', async () => {
    const { compiled } = await buildScenario();
    const parts = compiled.document.records.filter(
      (r): r is PtxPartsReqRecord => r.type === 'PARTS_REQ',
    );
    const codes = parts.map((r) => r.code);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes.filter((code) => code.includes('-L2-'))).toHaveLength(4); // ZZ occurrence 3
    expect(codes.filter((code) => code.endsWith('-C2'))).toHaveLength(2); // REPISA qty-2 ×2 unidades
    expect(codes).toContain('ZZ-ALTO-P01');
    expect(codes).toContain('ZZ-ALTO-L2-P01');
    expect(codes).toContain('AA-BAJO-P01');
  });

  it('serialize spec-checked → parse → verifyCutPlanPtxReadback === [] (contrato completo)', async () => {
    const { labels, plan, compiled } = await buildScenario();
    const bytes = serializePtxDocumentBytesSpecChecked(compiled.document, { decimalPlaces: 2 });
    const parsed = parsePtxDocumentBytes(bytes);
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxSpecPreflightDocument(parsed)).toEqual([]);
    const issues = verifyCutPlanPtxReadback(parsed, plan, compiled.mapping, {
      ...LABELS_GOLDEN_OPTIONS,
      partLabels: labels,
    });
    expect(issues).toEqual([]);
  });

  it('determinismo: recompilar produce bytes idénticos (misma proyección, mismo digest)', async () => {
    const first = await buildScenario();
    const second = await buildScenario();
    const bytesA = serializePtxDocument(first.compiled.document, { decimalPlaces: 2 });
    const bytesB = serializePtxDocument(second.compiled.document, { decimalPlaces: 2 });
    expect(bytesA).toBe(bytesB);
  });

  it('PARTS_INF y PARTS_UDI forman bloques contiguos inmediatamente después de PARTS_REQ', async () => {
    const { compiled } = await buildScenario();
    const families = compiled.document.records.map((r) => r.type);
    const firstReq = families.indexOf('PARTS_REQ');
    const lastReq = families.lastIndexOf('PARTS_REQ');
    const firstInf = families.indexOf('PARTS_INF');
    const lastInf = families.lastIndexOf('PARTS_INF');
    const firstUdi = families.indexOf('PARTS_UDI');
    const lastUdi = families.lastIndexOf('PARTS_UDI');
    expect(firstInf).toBe(lastReq + 1);
    expect(lastInf).toBe(firstUdi - 1);
    expect(lastUdi).toBeGreaterThan(firstUdi); // one row per piece
    // Both blocks are contiguous: nothing but PARTS_INF between PARTS_REQ and
    // the first PARTS_UDI, nothing but PARTS_UDI after it until the next family.
    expect(families.slice(lastReq + 1, firstUdi).every((f) => f === 'PARTS_INF')).toBe(true);
    expect(families.slice(firstUdi, lastUdi + 1).every((f) => f === 'PARTS_UDI')).toBe(true);
    expect(firstReq).toBeGreaterThan(families.lastIndexOf('MATERIALS'));
  });

  it('una fila PARTS_INF por pieza física, PROD_NUM = ordinal congelado de SU ocurrencia (sin cruces)', async () => {
    const { compiled } = await buildScenario();
    const inf = compiled.document.records.filter(
      (r): r is PtxPartsInfRecord => r.type === 'PARTS_INF',
    );
    expect(inf).toHaveLength(10);
    const parts = compiled.document.records.filter(
      (r): r is PtxPartsReqRecord => r.type === 'PARTS_REQ',
    );
    const byCode = new Map(parts.map((r) => [r.code, r.partIndex]));
    for (const row of inf) {
      expect(row.labelQuantity).toBe('1');
      expect(row.order).toBe('R3');
    }
    // The antisymmetric trap: ZZ-ALTO (lexically LAST) carries ordinals 1 and
    // 3; AA-BAJO (lexically FIRST) carries ordinal 2. Any lexical/array
    // derivation swaps these and fails.
    const fieldOf = (code: string, pick: (row: PtxPartsInfRecord) => string | undefined) =>
      pick(inf.find((row) => row.partIndex === byCode.get(code))!);
    expect(fieldOf('ZZ-ALTO-P01', (r) => r.productNumber)).toBe('1');
    expect(fieldOf('AA-BAJO-P01', (r) => r.productNumber)).toBe('2');
    expect(fieldOf('ZZ-ALTO-L2-P01', (r) => r.productNumber)).toBe('3');
    // ROOM follows the occurrence, not the module: the repeated ZZ unit in
    // LIVING carries LIVING.
    expect(fieldOf('ZZ-ALTO-P01', (r) => r.room)).toBe('COCINA');
    expect(fieldOf('ZZ-ALTO-L2-P01', (r) => r.room)).toBe('LIVING');
    expect(fieldOf('AA-BAJO-P01', (r) => r.room)).toBe('COCINA');
    // PROD_INFO/PRODUCT/dims follow the module of the occurrence.
    const zzRow = inf.find((row) => row.partIndex === byCode.get('ZZ-ALTO-P01'))!;
    expect(zzRow.product).toBe(ZZ_MODULE_CODE);
    expect(zzRow.productInfo).toBe('Modulo alto');
    expect(zzRow.productWidth).toBe('600');
    expect(zzRow.productHeight).toBe('2000');
    expect(zzRow.productDepth).toBe('500');
    const aaRow = inf.find((row) => row.partIndex === byCode.get('AA-BAJO-P01'))!;
    expect(aaRow.product).toBe(AA_MODULE_CODE);
    expect(aaRow.productWidth).toBe('800');
  });

  it('CORE_MAT sigue materialCode de cada fila productiva sin cruzar materiales', async () => {
    const { compiled } = await buildScenario();
    const inf = compiled.document.records.filter(
      (r): r is PtxPartsInfRecord => r.type === 'PARTS_INF',
    );
    const parts = compiled.document.records.filter(
      (r): r is PtxPartsReqRecord => r.type === 'PARTS_REQ',
    );
    const byCode = new Map(parts.map((r) => [r.code, r.partIndex]));
    const coreOf = (code: string) => inf.find((row) => row.partIndex === byCode.get(code))!.coreMaterial;
    expect(coreOf('ZZ-ALTO-P01')).toBe('MDF-BCO-18');
    expect(coreOf('ZZ-ALTO-L2-P01')).toBe('MDF-BCO-18');
    expect(coreOf('AA-BAJO-P01')).toBe('MDF-ROBLE-18');
    expect(coreOf('AA-BAJO-P02')).toBe('MDF-ROBLE-18');
  });

  it('cantos por lado correctos bajo orientación (trampas asimétrica y de eje)', async () => {
    const { compiled } = await buildScenario();
    const inf = compiled.document.records.filter(
      (r): r is PtxPartsInfRecord => r.type === 'PARTS_INF',
    );
    const parts = compiled.document.records.filter(
      (r): r is PtxPartsReqRecord => r.type === 'PARTS_REQ',
    );
    const codeToInf = new Map<string, PtxPartsInfRecord>();
    for (const row of inf) {
      codeToInf.set(parts.find((p) => p.partIndex === row.partIndex)!.code, row);
    }
    // COSTADO (L1,L2,W1 on; W2 off): EDGE1/2/3 = banda ABS, EDGE4 vacío.
    const costado = codeToInf.get('ZZ-ALTO-P01')!;
    expect([costado.edge1, costado.edge2, costado.edge3, costado.edge4]).toEqual([
      BAND_ABS_1MM,
      BAND_ABS_1MM,
      BAND_ABS_1MM,
      undefined,
    ]);
    // PUERTA: los cuatro lados encintados.
    const puerta = codeToInf.get('ZZ-ALTO-P02')!;
    expect([puerta.edge1, puerta.edge2, puerta.edge3, puerta.edge4]).toEqual([
      BAND_ABS_1MM,
      BAND_ABS_1MM,
      BAND_ABS_1MM,
      BAND_ABS_1MM,
    ]);
    // REPISA (sólo L2, largo inferior): el código cae en EDGE1 (Btm length),
    // NO en EDGE2 — un swap L1↔L2 del mapping falla aquí.
    const repisa = codeToInf.get('ZZ-ALTO-P03')!;
    expect([repisa.edge1, repisa.edge2, repisa.edge3, repisa.edge4]).toEqual([
      BAND_ABS_1MM,
      undefined,
      undefined,
      undefined,
    ]);
    // La copia -C2 de la REPISA lleva el mismo patrón lateral.
    const repisaC2 = codeToInf.get('ZZ-ALTO-P03-C2')!;
    expect([repisaC2.edge1, repisaC2.edge2]).toEqual([BAND_ABS_1MM, undefined]);
    // FONDO (sólo W1,W2): eje ancho — EDGE3/EDGE4, no los lados largo.
    const fondo = codeToInf.get('AA-BAJO-P01')!;
    expect([fondo.edge1, fondo.edge2, fondo.edge3, fondo.edge4]).toEqual([
      undefined,
      undefined,
      BAND_PVC_2MM,
      BAND_PVC_2MM,
    ]);
    // TAPA: sin canto, los cuatro vacíos.
    const tapa = codeToInf.get('AA-BAJO-P02')!;
    expect([tapa.edge1, tapa.edge2, tapa.edge3, tapa.edge4]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // EDG_PG1..4 y FACE/BACK/PALLET/COLOUR/SECOND_CUT: sin autoridad → ausentes.
    for (const row of inf) {
      expect(row.edgeProgram1).toBeUndefined();
      expect(row.edgeProgram2).toBeUndefined();
      expect(row.edgeProgram3).toBeUndefined();
      expect(row.edgeProgram4).toBeUndefined();
      expect(row.faceLaminate).toBeUndefined();
      expect(row.backLaminate).toBeUndefined();
      expect(row.coreMaterial).toBeDefined();
      expect(row.pallet).toBeUndefined();
      expect(row.colour).toBeUndefined();
      expect(row.secondCutLength).toBeUndefined();
      expect(row.secondCutWidth).toBeUndefined();
    }
  });

  it('identidad de medidas desde los BYTES: FIN_* (terminada) y PARTS_REQ (corte) convergen en la misma pieza', async () => {
    const { compiled } = await buildScenario();
    const bytes = serializePtxDocumentBytesSpecChecked(compiled.document, { decimalPlaces: 2 });
    const parsed = parsePtxDocumentBytes(bytes);
    const parts = parsed.records.filter((r): r is PtxPartsReqRecord => r.type === 'PARTS_REQ');
    const inf = parsed.records.filter((r): r is PtxPartsInfRecord => r.type === 'PARTS_INF');
    // The engineering rows keyed by their FINISHED manufacturing code base
    // (copies -C2 share the row). BARCODE2 IS the manufacturing code.
    const engineeringByBaseCode = new Map(
      scenarioRows().map((row) => [row.labelRef, row]),
    );
    expect(parts).toHaveLength(inf.length);
    for (const part of parts) {
      const row = inf.find((r) => r.partIndex === part.partIndex)!;
      const baseCode = row.barcode2!.replace(/-C\d+$/, '');
      const engineering = engineeringByBaseCode.get(baseCode)!;
      const band = engineering.edgeBandThicknessMm ?? 0;
      const lDeduct = (engineering.L1 ? band : 0) + (engineering.L2 ? band : 0);
      const wDeduct = (engineering.W1 ? band : 0) + (engineering.W2 ? band : 0);
      // PARTS_INF.FIN_* = the engineering FINISHED measure, verbatim.
      expect(Number(row.finishedLength)).toBe(engineering.lengthMm);
      expect(Number(row.finishedWidth)).toBe(engineering.widthMm);
      // PARTS_REQ dims = the CUT measure (single deduction site: unrollRows).
      // The two representations of the same physical piece meet exactly:
      // FIN (label truth) == corte (saw truth) + descuento.
      expect(part.length).toBe(engineering.lengthMm - lDeduct);
      expect(part.width).toBe(engineering.widthMm - wDeduct);
      expect(Number(row.finishedLength)).toBe(part.length + lDeduct);
      expect(Number(row.finishedWidth)).toBe(part.width + wDeduct);
    }
  });

  it('DRAWING/BARCODE desde los BYTES: D<hex12> único, BARCODE1=*D*, BARCODE2=código, ORDER=release', async () => {
    const { compiled } = await buildScenario();
    const bytes = serializePtxDocumentBytesSpecChecked(compiled.document, { decimalPlaces: 2 });
    const parsed = parsePtxDocumentBytes(bytes);
    const inf = parsed.records.filter((r): r is PtxPartsInfRecord => r.type === 'PARTS_INF');
    const drawings = new Set<string>();
    const barcodes = new Set<string>();
    for (const row of inf) {
      expect(row.drawing).toMatch(/^D[0-9A-F]{12}$/);
      expect(row.barcode1).toBe(ptxBarcodeToken(row.drawing!));
      expect(row.barcode2).toMatch(/^(ZZ-ALTO(-L2)?-P\d\d(-C2)?|AA-BAJO-P\d\d)$/);
      expect(row.order).toBe('R3');
      drawings.add(row.drawing!);
      barcodes.add(row.barcode1!);
    }
    expect(drawings.size).toBe(inf.length);
    expect(barcodes.size).toBe(inf.length);
  });

  it('PARTS_UDI estructural: una fila por pieza, INFO vacío (presencia sin semántica inventada)', async () => {
    const { compiled } = await buildScenario();
    const udi = compiled.document.records.filter(
      (r): r is PtxPartsUdiRecord => r.type === 'PARTS_UDI',
    );
    expect(udi).toHaveLength(10);
    for (const row of udi) {
      expect(row.info.every((value) => value === undefined)).toBe(true);
    }
    // Serialized shape: JOB/PART only (trailing INFO omitted — the r4
    // trailing-optional discipline; the field samples carry short rows too).
    const text = serializePtxDocument(compiled.document, { decimalPlaces: 2 });
    const udiLines = text.split('\r\n').filter((line) => line.startsWith('PARTS_UDI'));
    expect(udiLines).toHaveLength(10);
    for (const line of udiLines) {
      expect(line.split(',')).toHaveLength(3);
    }
  });

  it('sin partLabels el compilador NO emite PARTS_INF/PARTS_UDI (revisiones históricas intactas)', async () => {
    const plan = optimizeCutPlan(
      LABELS_GOLDEN_PROJECT_ID,
      scenarioRows(),
      LABELS_GOLDEN_MATERIALS,
      LABELS_GOLDEN_CONFIG,
    );
    const { partsUdi: _udi, ...optionsWithoutLabels } = LABELS_GOLDEN_OPTIONS;
    const compiled = compileCutPlanToPtxDocument(plan, optionsWithoutLabels);
    expect(compiled.document.records.filter((r) => r.type === 'PARTS_INF')).toHaveLength(0);
    expect(compiled.document.records.filter((r) => r.type === 'PARTS_UDI')).toHaveLength(0);
  });

  it('escenario real optimizer rotado: cantos y medidas siguen la pieza, no los ejes del tablero', async () => {
    const rows: ProductionCutRow[] = [
      {
        quantity: 1,
        lengthMm: 950,
        widthMm: 580,
        description: 'FIXED GRAIN',
        materialName: 'MDF Test 18',
        materialCode: 'MDF-ROT-18',
        grain: 1,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
        partCode: 'ROT-FIXED-P01',
        partName: 'FIXED',
        moduleCode: 'ROT-MOD',
        labelRef: 'ROT-MOD-P01',
        thicknessMm: 18,
      },
      {
        quantity: 1,
        lengthMm: 550,
        widthMm: 40,
        description: 'ROTATED FREE',
        materialName: 'MDF Test 18',
        materialCode: 'MDF-ROT-18',
        grain: 0,
        L1: 1,
        L2: 0,
        W1: 0,
        W2: 1,
        partCode: 'ROT-FREE-P02',
        partName: 'ROTATED',
        moduleCode: 'ROT-MOD',
        labelRef: 'ROT-MOD-P02',
        thicknessMm: 18,
        edgeBandCode: BAND_ABS_1MM,
        edgeBandName: 'ABS blanco 1mm',
        edgeBandThicknessMm: 1,
      },
    ];
    const materials: MaterialBoard[] = [
      {
        id: 'mat-rot-18',
        code: 'MDF-ROT-18',
        name: 'MDF Test 18',
        costPerM2: 10,
        wastePercent: 10,
        lengthMm: 1000,
        widthMm: 600,
        thicknessMm: 18,
        grainDefault: true,
        boardPrice: 8,
        active: true,
      },
    ];
    const config: CutPlanConfig = {
      sawKerfMm: 4,
      trim: { topMm: 0, bottomMm: 0, leftMm: 0, rightMm: 0 },
      deductEdgeBand: true,
      allowRotationNoGrain: true,
      minRemnantWidthMm: 20,
      minRemnantLengthMm: 20,
      preferLongitudinalRips: true,
      heuristic: 'guillotine-hybrid',
    };
    const plan = optimizeCutPlan('lab-789-rotated', rows, materials, config);
    const rotatedPiece = plan.sheets.flatMap((sheet) => sheet.pieces).find((piece) => piece.labelRef === 'ROT-MOD-P02')!;
    expect(rotatedPiece.rotated).toBe(true);
    expect(rotatedPiece).toMatchObject({ originalLengthMm: 550, originalWidthMm: 40, lengthMm: 39, widthMm: 549 });

    const labels = await buildPtxPartLabels(
      rows.map((row) => ({
        row,
        unit: { workshopOccurrenceOrdinal: 1, moduleCode: 'ROT-MOD', moduleName: 'Rotated module' },
        orderRef: 'R5',
        hasCncMachining: true,
        cncScope: 'release:789:r5:rotated-optimizer',
      })),
    );
    const { partsReqDimensionPolicy: _explicitPolicy, ...historicalOptions } = LABELS_GOLDEN_OPTIONS;
    const historical = compileCutPlanToPtxDocument(plan, {
      ...historicalOptions,
      title: 'LAB-ROT-R5',
      partLabels: labels,
    });
    const partIndex = historical.mapping.partIndexByPieceRef.get(rotatedPiece.id)!;
    const historicalPart = historical.document.records.find(
      (record): record is PtxPartsReqRecord => record.type === 'PARTS_REQ' && record.partIndex === partIndex,
    )!;
    expect(historicalPart).toMatchObject({ length: 39, width: 549, grain: 0 });
    expect(
      verifyCutPlanPtxReadback(
        parsePtxDocumentBytes(serializePtxDocumentBytesSpecChecked(historical.document, { decimalPlaces: 2 })),
        plan,
        historical.mapping,
        { ...historicalOptions, title: 'LAB-ROT-R5', partLabels: labels },
      ),
    ).toEqual([]);

    const compiled = compileCutPlanToPtxDocument(plan, {
      ...LABELS_GOLDEN_OPTIONS,
      title: 'LAB-ROT-R5',
      partLabels: labels,
      partsReqDimensionPolicy: 'part-local-pre-rotation-cut',
    });
    const part = compiled.document.records.find(
      (record): record is PtxPartsReqRecord => record.type === 'PARTS_REQ' && record.partIndex === partIndex,
    )!;
    const fixedPartIndex = compiled.mapping.partIndexByPieceRef.get(
      plan.sheets.flatMap((sheet) => sheet.pieces).find((piece) => piece.labelRef === 'ROT-MOD-P01')!.id,
    )!;
    const fixedPart = compiled.document.records.find(
      (record): record is PtxPartsReqRecord => record.type === 'PARTS_REQ' && record.partIndex === fixedPartIndex,
    )!;
    const inf = compiled.document.records.find(
      (record): record is PtxPartsInfRecord => record.type === 'PARTS_INF' && record.partIndex === partIndex,
    )!;
    expect(part.code).toBe('ROT-MOD-P02');
    expect(part.partIndex).toBe(partIndex);
    expect(inf.barcode2).toBe('ROT-MOD-P02');
    expect(inf.finishedLength).toBe('550');
    expect(inf.finishedWidth).toBe('40');
    expect(part.length).toBe(549);
    expect(part.width).toBe(39);
    expect(part.grain).toBe(0);
    expect(fixedPart).toMatchObject({ length: 950, width: 580, grain: 1 });
    expect([inf.edge1, inf.edge2, inf.edge3, inf.edge4]).toEqual([
      undefined,
      BAND_ABS_1MM,
      undefined,
      BAND_ABS_1MM,
    ]);
    expect(inf.coreMaterial).toBe('MDF-ROT-18');

    const bytes = serializePtxDocumentBytesSpecChecked(compiled.document, { decimalPlaces: 2 });
    const parsed = parsePtxDocumentBytes(bytes);
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxSpecPreflightDocument(parsed)).toEqual([]);
    const policyOptions: CompileCutPlanToPtxOptions = {
      ...LABELS_GOLDEN_OPTIONS,
      title: 'LAB-ROT-R5',
      partLabels: labels,
      partsReqDimensionPolicy: 'part-local-pre-rotation-cut',
    };
    expect(verifyCutPlanPtxReadback(parsed, plan, compiled.mapping, policyOptions)).toEqual([]);

    const mutated = parsePtxDocumentBytes(
      serializePtxDocumentBytesSpecChecked(
        {
          ...compiled.document,
          records: compiled.document.records.map((record): PtxRecord =>
            record.type === 'PARTS_REQ' && record.partIndex === partIndex
              ? { ...record, length: 39, width: 549 }
              : record,
          ),
        },
        { decimalPlaces: 2 },
      ),
    );
    expect(
      verifyCutPlanPtxReadback(mutated, plan, compiled.mapping, policyOptions).map((issue) => issue.code),
    ).toContain('parts.dims');
  });
});

// ---------------------------------------------------------------------------
// Compiler identity gates (fail closed)
// ---------------------------------------------------------------------------

async function gateFixture() {
  const labels = await buildPtxPartLabels(
    aaRows().map((row) => ({
      row,
      unit: AA_UNIT_2,
      hasCncMachining: true,
      cncScope: 'release:789:r5:gates',
    })),
  );
  const plan = optimizeCutPlan(
    'lab-789-gates',
    aaRows(),
    LABELS_GOLDEN_MATERIALS,
    LABELS_GOLDEN_CONFIG,
  );
  return { labels, plan };
}

function optionsWith(labels: readonly PtxPartLabelData[]): CompileCutPlanToPtxOptions {
  return { ...LABELS_GOLDEN_OPTIONS, partLabels: labels };
}

describe('#789 gates fail-closed del compilador', () => {
  it('pieza colocada sin proyección de etiqueta BLOQUEA (label_missing)', async () => {
    const { labels, plan } = await gateFixture();
    expect(labels).toHaveLength(2);
    expect(() => compileCutPlanToPtxDocument(plan, optionsWith([labels[0]!]))).toThrowError(
      /label_missing|PARTS_INF exige una fila por pieza física/,
    );
  });

  it('etiqueta con código sin pieza colocada BLOQUEA (label_code_unknown)', async () => {
    const { labels, plan } = await gateFixture();
    const orphan: PtxPartLabelData = { ...labels[0]!, manufacturingPartCode: 'NO-SUCH-PART' };
    expect(() =>
      compileCutPlanToPtxDocument(plan, optionsWith([...labels, orphan])),
    ).toThrowError(/label_code_unknown/);
  });

  it('dos etiquetas con el mismo código BLOQUEAN (label_code_duplicate)', async () => {
    const { labels, plan } = await gateFixture();
    expect(() =>
      compileCutPlanToPtxDocument(plan, optionsWith([...labels, labels[0]!])),
    ).toThrowError(/label_code_duplicate/);
  });

  it('dos piezas con el MISMO DRAWING BLOQUEAN (label_drawing_duplicate: puente CNC ambiguo)', async () => {
    const { labels, plan } = await gateFixture();
    const [first, second] = labels;
    const colliding: PtxPartLabelData = { ...second!, cncDrawingRef: first!.cncDrawingRef };
    expect(() =>
      compileCutPlanToPtxDocument(plan, optionsWith([first!, colliding])),
    ).toThrowError(/label_drawing_duplicate/);
  });

  it('dos piezas con el MISMO BARCODE1 BLOQUEAN (label_barcode_duplicate: scan ambiguo)', async () => {
    const { labels, plan } = await gateFixture();
    const [first, second] = labels;
    const colliding: PtxPartLabelData = { ...second!, barcode1: first!.barcode1 };
    expect(() =>
      compileCutPlanToPtxDocument(plan, optionsWith([first!, colliding])),
    ).toThrowError(/label_barcode_duplicate/);
  });

  it('BARCODE2 distinto del código de fabricación BLOQUEA (token de tracking con autoridad)', async () => {
    const { labels, plan } = await gateFixture();
    const wrong: PtxPartLabelData = { ...labels[0]!, barcode2: 'OTRO-TOKEN' };
    expect(() => compileCutPlanToPtxDocument(plan, optionsWith([wrong, labels[1]!]))).toThrowError(
      /BARCODE2 debe ser el manufacturingPartCode/,
    );
  });

  it('LABEL_QTY inválido BLOQUEA para cero, negativo, decimal y no finito', async () => {
    const { labels, plan } = await gateFixture();
    for (const labelQuantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const invalid: PtxPartLabelData = { ...labels[0]!, labelQuantity };
      expect(() => compileCutPlanToPtxDocument(plan, optionsWith([invalid, labels[1]!]))).toThrowError(
        /LABEL_QTY debe ser un entero >= 1/,
      );
    }
  });

  it('partLabels sin partCodeAuthority workshop-labelref BLOQUEA (la clave ES el CODE)', async () => {
    const { labels, plan } = await gateFixture();
    const { partCodeAuthority: _authority, partCodeMaxLength: _max, ...rest } = LABELS_GOLDEN_OPTIONS;
    expect(() =>
      compileCutPlanToPtxDocument(plan, { ...rest, partLabels: labels }),
    ).toThrowError(/partLabels requiere partCodeAuthority/);
  });

  it("partsUdi 'structural' sin partLabels BLOQUEA", async () => {
    const plan = optimizeCutPlan(
      'lab-789-gates',
      aaRows(),
      LABELS_GOLDEN_MATERIALS,
      LABELS_GOLDEN_CONFIG,
    );
    const { partCodeAuthority: _a, partCodeMaxLength: _m, ...rest } = LABELS_GOLDEN_OPTIONS;
    expect(() =>
      compileCutPlanToPtxDocument(plan, { ...rest, partsUdi: 'structural' }),
    ).toThrowError(/partsUdi 'structural' requiere partLabels/);
  });

  it('el mapeo lleva la proyección por PART_INDEX (auditoría inversa)', async () => {
    const { labels, plan } = await gateFixture();
    const compiled = compileCutPlanToPtxDocument(plan, optionsWith(labels));
    expect(compiled.mapping.partLabelByPartIndex).toBeDefined();
    expect(compiled.mapping.partLabelByPartIndex!.length).toBe(labels.length);
  });

  it('un plan irrepresentable sigue bloqueando antes que cualquier etiqueta (orden de gates)', async () => {
    // A CNC-nesting sheet is not representable — the compiler must reject it
    // regardless of labels (nesting_not_representable, not a label error).
    const labels = await buildPtxPartLabels(
      aaRows().map((row) => ({
        row,
        unit: AA_UNIT_2,
        hasCncMachining: true,
        cncScope: 'release:789:r5:gates',
      })),
    );
    const plan = optimizeCutPlan('lab-789-nesting', aaRows(), LABELS_GOLDEN_MATERIALS, {
      ...LABELS_GOLDEN_CONFIG,
      cutStrategy: 'cnc-nesting',
      toolSpacingMm: 8,
    });
    expect(plan.sheets.every((sheet) => sheet.strategy === 'cnc-nesting')).toBe(true);
    try {
      compileCutPlanToPtxDocument(plan, optionsWith(labels));
      expect.unreachable('debía bloquear por nesting');
    } catch (error) {
      expect(error).toBeInstanceOf(PtxCompilationError);
      expect((error as PtxCompilationError).code).toBe('ptx_compile.nesting_not_representable');
    }
  });
});
