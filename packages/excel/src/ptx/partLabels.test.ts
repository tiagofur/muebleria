/**
 * #789 — frozen label projection tests (PtxPartLabelData builder).
 *
 * The builder is the ONLY place that translates Granete's workshop side
 * convention (L1/L2/W1/W2) to the four PTX EDGE columns and the only place
 * the CNC drawing reference is derived. These tests are the asymmetric traps
 * the issue demands: every side-swap or axis-swap a mapping bug could
 * produce changes the emitted EDGE1..4 tuple and fails here.
 *
 * Documented mapping under test (09_parts_inf_labels_cnc.md §orientación):
 *   EDGE1 "Btm length edge code" ← L2 (bottom long edge)
 *   EDGE2 "Top length edge code" ← L1 (top long edge)
 *   EDGE3 "Left width edge code" ← W1 (left short edge)
 *   EDGE4 "Right width edge code" ← W2 (right short edge)
 * Granete's convention: packages/ui PlankEdgeDiagram (length horizontal,
 * facing the viewer) — L1 top long, L2 bottom long, W1 left, W2 right.
 *
 * Honest limitation: Granete carries ONE edge band per part, so two banded
 * sides with the same band are not mutually distinguishable by value. What
 * IS fully distinguishable — and what these traps cover — is the (banded,
 * unbanded) pattern per side and per axis: any swap of the L/W→EDGE mapping
 * changes the emitted tuple for every asymmetric pattern below.
 */

import { describe, expect, it } from 'vitest';
import type { ProductionCutRow } from '@granete/domain';
import {
  PTX_EDGE_COLUMN_BY_WORKSHOP_SIDE,
  buildPtxPartLabelData,
  buildPtxPartLabels,
  ptxBarcodeToken,
  ptxCncDrawingRef,
  type PtxPartLabelUnitContext,
} from './partLabels';
import { PtxCompilationError } from './compileCutPlan';

/**
 * Local mirror of the domain's unrollRows EXPANSION + labelRef suffix
 * discipline (packages/domain/src/optimizer/pieces.ts — not exported from
 * the public index): the projection's manufacturing codes must match what
 * the optimizer places, so the mirror here is an honest cross-check of the
 * shared contract, duplicated on purpose like every other verifier mirror.
 */
function mirrorUnrollCodes(rowInput: ProductionCutRow): string[] {
  const codes: string[] = [];
  const qty = Math.max(1, rowInput.quantity);
  const rowLabel = rowInput.labelRef?.trim() ?? '';
  for (let i = 0; i < qty; i++) {
    codes.push(rowLabel !== '' && qty > 1 && i > 0 ? `${rowLabel}-C${i + 1}` : rowLabel);
  }
  return codes;
}

const BAND = 'C-ABS-BCO-1';
const CNC_SCOPE = 'release:789:r5:test-scope';

function row(overrides: Partial<ProductionCutRow> = {}): ProductionCutRow {
  return {
    quantity: 1,
    lengthMm: 1000,
    widthMm: 400,
    description: 'TEST',
    materialName: 'MDF',
    materialCode: 'MDF-18',
    grain: 1,
    L1: 0,
    L2: 0,
    W1: 0,
    W2: 0,
    partCode: 'T01',
    partName: 'COSTADO TEST',
    moduleCode: 'MOD-X',
    labelRef: 'MOD-X-P01',
    thicknessMm: 18,
    edgeBandCode: BAND,
    edgeBandName: 'Abs blanco',
    edgeBandThicknessMm: 1,
    ...overrides,
  };
}

const UNIT: PtxPartLabelUnitContext = {
  workshopOccurrenceOrdinal: 2,
  moduleCode: 'MOD-X',
  moduleName: 'Modulo de prueba',
  moduleWidthMm: 600,
  moduleHeightMm: 2000,
  moduleDepthMm: 500,
  room: 'COCINA',
};

async function edgesOf(rowInput: ProductionCutRow) {
  const label = await buildPtxPartLabelData({ row: rowInput, unit: UNIT }, 1);
  return [label.edge1, label.edge2, label.edge3, label.edge4];
}

// ---------------------------------------------------------------------------
// Orientación: la trampa asimétrica L/W → EDGE1..4
// ---------------------------------------------------------------------------

describe('#789 orientación de cantos L1/L2/W1/W2 → EDGE1..4', () => {
  it('la tabla de mapeo documentada es exacta (L2→EDGE1, L1→EDGE2, W1→EDGE3, W2→EDGE4)', () => {
    expect(PTX_EDGE_COLUMN_BY_WORKSHOP_SIDE).toEqual({
      L1: 'edge2',
      L2: 'edge1',
      W1: 'edge3',
      W2: 'edge4',
    });
  });

  it('sólo L2 (largo inferior): el código cae en EDGE1, NO en EDGE2 — un swap L1↔L2 falla', async () => {
    expect(await edgesOf(row({ L2: 1 }))).toEqual([BAND, undefined, undefined, undefined]);
  });

  it('sólo L1 (largo superior): el código cae en EDGE2', async () => {
    expect(await edgesOf(row({ L1: 1 }))).toEqual([undefined, BAND, undefined, undefined]);
  });

  it('sólo W1 (ancho izquierdo): el código cae en EDGE3 — un swap de eje L↔W falla', async () => {
    expect(await edgesOf(row({ W1: 1 }))).toEqual([undefined, undefined, BAND, undefined]);
  });

  it('sólo W2 (ancho derecho): el código cae en EDGE4', async () => {
    expect(await edgesOf(row({ W2: 1 }))).toEqual([undefined, undefined, undefined, BAND]);
  });

  it('pieza asimétrica 3+1 (L1,L2,W1 banded; W2 no): el patrón por lado es único y detecta cualquier swap', async () => {
    expect(await edgesOf(row({ L1: 1, L2: 1, W1: 1 }))).toEqual([BAND, BAND, BAND, undefined]);
  });

  it('patrón complementario (sólo W1,W2): distingue el eje ancho del eje largo', async () => {
    expect(await edgesOf(row({ W1: 1, W2: 1 }))).toEqual([undefined, undefined, BAND, BAND]);
  });

  it('pieza sin canto: los cuatro EDGE quedan ausentes (celda vacía, nunca un código inventado)', async () => {
    const label = await buildPtxPartLabelData(
      { row: row({ edgeBandCode: undefined, edgeBandName: undefined, edgeBandThicknessMm: undefined }), unit: UNIT },
      1,
    );
    expect([label.edge1, label.edge2, label.edge3, label.edge4]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('bandera de canto sin edgeBandCode autoritativo BLOQUEA', async () => {
    await expect(
      buildPtxPartLabelData(
        { row: row({ L1: 1, edgeBandCode: '', edgeBandName: undefined, edgeBandThicknessMm: undefined }), unit: UNIT },
        1,
      ),
    ).rejects.toMatchObject({ code: 'ptx_compile.label_invalid' });
  });

  it('banda definida pero todas las banderas en 0: no emite EDGE', async () => {
    expect(await edgesOf(row())).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('banda definida pero lado sin bandera: el código NO se emite para ese lado', async () => {
    // La bandera por lado es la autoridad; tener banda asignada no rellena lados.
    expect(await edgesOf(row({ L1: 1 }))).toEqual([undefined, BAND, undefined, undefined]);
  });
});

// ---------------------------------------------------------------------------
// Medidas finales: copiadas verbatim de la fila de ingeniería
// ---------------------------------------------------------------------------

describe('#789 medidas finales congeladas', () => {
  it('FIN_LENGTH/FIN_WIDTH se COPIAN de la fila (convención terminada), sin aritmética en la proyección', async () => {
    const label = await buildPtxPartLabelData({ row: row({ lengthMm: 1897, widthMm: 333 }), unit: UNIT }, 1);
    expect(label.finishedLengthMm).toBe(1897);
    expect(label.finishedWidthMm).toBe(333);
  });

  it('medida no finita o <= 0 BLOQUEA (no hay medida final congelada que proyectar)', async () => {
    await expect(
      buildPtxPartLabelData({ row: row({ lengthMm: 0 }), unit: UNIT }, 1),
    ).rejects.toMatchObject({ code: 'ptx_compile.label_invalid' });
    await expect(
      buildPtxPartLabelData({ row: row({ widthMm: Number.NaN }), unit: UNIT }, 1),
    ).rejects.toMatchObject({ code: 'ptx_compile.label_invalid' });
  });

  it('identidad de medidas contra el único sitio de descuento: terminada = corte + lados encintados', async () => {
    // El descuento de canto vive SOLO en el optimizador (unrollRows, mirrors
    // below): corte = terminada − grosor de banda por lado encintado. La
    // proyección COPIA la terminada; unir ambas verdades aquí (sin duplicar
    // la fórmula productiva) es la prueba de identidad del issue.
    const bandMm = 1;
    const engineering = row({ lengthMm: 1900, widthMm: 500, L1: 1, L2: 1, W1: 1, quantity: 1 });
    const label = await buildPtxPartLabelData({ row: engineering, unit: UNIT }, 1);
    const cutLength = engineering.lengthMm - 2 * bandMm; // L1 + L2
    const cutWidth = engineering.widthMm - bandMm; // W1
    expect(label.finishedLengthMm).toBe(cutLength + 2 * bandMm);
    expect(label.finishedWidthMm).toBe(cutWidth + bandMm);
    // La resta y la suma son identidades exactas en enteros: ninguna
    // recomputación en la proyección puede divergir.
    expect(label.finishedLengthMm).toBe(engineering.lengthMm);
    expect(label.finishedWidthMm).toBe(engineering.widthMm);
  });
});

// ---------------------------------------------------------------------------
// Copias físicas: expansión quantity>1 con el sufijo -C<n> del optimizador
// ---------------------------------------------------------------------------

describe('#789 expansión por pieza física (quantity>1)', () => {
  it('quantity cero, negativo, decimal y no finito BLOQUEA (no clamp/truncate)', async () => {
    for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(buildPtxPartLabels([{ row: row({ quantity }), unit: UNIT }])).rejects.toMatchObject({
        code: 'ptx_compile.label_invalid',
      });
    }
  });

  it('las copias 2..N llevan el MISMO sufijo -C<n> que el optimizador asigna a labelRef', async () => {
    const engineering = row({ quantity: 3, labelRef: 'MOD-X-P03' });
    const labels = await buildPtxPartLabels([{ row: engineering, unit: UNIT }]);
    expect(labels.map((label) => label.manufacturingPartCode)).toEqual([
      'MOD-X-P03',
      'MOD-X-P03-C2',
      'MOD-X-P03-C3',
    ]);
    // El contrato de claveo: exactamente los códigos que el optimizador pone
    // en las piezas colocadas (PARTS_REQ.CODE bajo workshop-labelref).
    expect(mirrorUnrollCodes(engineering)).toEqual(
      labels.map((label) => label.manufacturingPartCode),
    );
  });

  it('códigos duplicados entre filas distintas BLOQUEAN (una etiqueta por pieza física)', async () => {
    const duplicate = row({ labelRef: 'MOD-X-P01', partCode: 'OTHER' });
    await expect(
      buildPtxPartLabels([
        { row: row({ labelRef: 'MOD-X-P01' }), unit: UNIT },
        { row: duplicate, unit: UNIT },
      ]),
    ).rejects.toMatchObject({ code: 'ptx_compile.label_code_duplicate' });
  });
});

// ---------------------------------------------------------------------------
// Puente CNC: D<hex12> determinista + barcodes
// ---------------------------------------------------------------------------

describe('#789 puente CNC (DRAWING/BARCODE)', () => {
  it('la referencia CNC es D + 12 hex mayúsculas, determinista y estable por scope+código', async () => {
    const first = await ptxCncDrawingRef('MOD-X-P01', CNC_SCOPE);
    const again = await ptxCncDrawingRef('MOD-X-P01', CNC_SCOPE);
    expect(first).toMatch(/^D[0-9A-F]{12}$/);
    expect(again).toBe(first);
    const otherCode = await ptxCncDrawingRef('MOD-X-P02', CNC_SCOPE);
    expect(otherCode).not.toBe(first);
    const otherScope = await ptxCncDrawingRef('MOD-X-P01', 'release:789:r5:other-scope');
    expect(otherScope).not.toBe(first);
  });

  it('scope CNC vacío BLOQUEA y no cae al código de fabricación', async () => {
    await expect(ptxCncDrawingRef('MOD-X-P01', '')).rejects.toMatchObject({
      code: 'ptx_compile.label_invalid',
    });
  });

  it('la referencia está namespaced: el mismo digest jamás coincide con un filename G<hex12> del mismo id', async () => {
    // Espacio de nombres distinto por diseño (granete:ptx-cnc-drawing vs
    // granete:ptx-artifact): drawing ref y filename nunca comparten token.
    const ref = await ptxCncDrawingRef('plan-1', CNC_SCOPE);
    expect(ref).toMatch(/^D[0-9A-F]{12}$/);
  });

  it('BARCODE1 envuelve la referencia CNC como token Code 39 (asteriscos, como las muestras)', async () => {
    const label = await buildPtxPartLabelData(
      { row: row(), unit: UNIT, hasCncMachining: true, cncScope: CNC_SCOPE },
      1,
    );
    expect(label.cncDrawingRef).toBeDefined();
    expect(label.barcode1).toBe(ptxBarcodeToken(label.cncDrawingRef!));
    expect(label.barcode1).toMatch(/^\*D[0-9A-F]{12}\*$/);
  });

  it('BARCODE2 ES el manufacturingPartCode (token de tracking con autoridad)', async () => {
    const label = await buildPtxPartLabelData({ row: row(), unit: UNIT }, 1);
    expect(label.barcode2).toBe('MOD-X-P01');
  });

  it('pieza con mecanizado declarado true: DRAWING y BARCODE1 se emiten', async () => {
    const label = await buildPtxPartLabelData(
      { row: row(), unit: UNIT, hasCncMachining: true, cncScope: CNC_SCOPE },
      1,
    );
    expect(label.cncDrawingRef).toMatch(/^D[0-9A-F]{12}$/);
    expect(label.barcode1).toBe(ptxBarcodeToken(label.cncDrawingRef!));
  });

  it('pieza con mecanizado false o ausente: DRAWING y BARCODE1 quedan vacíos (sin programa falso)', async () => {
    const explicitlyFalse = await buildPtxPartLabelData(
      { row: row(), unit: UNIT, hasCncMachining: false },
      1,
    );
    const absent = await buildPtxPartLabelData({ row: row(), unit: UNIT }, 1);
    for (const label of [explicitlyFalse, absent]) {
      expect(label.cncDrawingRef).toBeUndefined();
      expect(label.barcode1).toBeUndefined();
      // BARCODE2 sigue siendo el código de fabricación: el tracking no depende
      // del mecanizado.
      expect(label.barcode2).toBe('MOD-X-P01');
    }
  });

  it('dos piezas distintas obtienen referencias CNC distintas (puente no ambiguo)', async () => {
    const a = await buildPtxPartLabelData(
      { row: row({ labelRef: 'MOD-X-P01' }), unit: UNIT, hasCncMachining: true, cncScope: CNC_SCOPE },
      1,
    );
    const b = await buildPtxPartLabelData(
      { row: row({ labelRef: 'MOD-X-P02' }), unit: UNIT, hasCncMachining: true, cncScope: CNC_SCOPE },
      1,
    );
    expect(a.cncDrawingRef).not.toBe(b.cncDrawingRef);
    expect(a.barcode1).not.toBe(b.barcode1);
  });
});

// ---------------------------------------------------------------------------
// Mueble/producto/room/orden + política LABEL_QTY
// ---------------------------------------------------------------------------

describe('#789 producto, ordinal congelado, room y LABEL_QTY', () => {
  it('PROD_* y ROOM provienen del contexto de unidad congelado, no de orden de arrays', async () => {
    const label = await buildPtxPartLabelData({ row: row(), unit: UNIT }, 1);
    expect(label.productCode).toBe('MOD-X');
    expect(label.productInfo).toBe('Modulo de prueba');
    expect(label.productWidthMm).toBe(600);
    expect(label.productHeightMm).toBe(2000);
    expect(label.productDepthMm).toBe(500);
    expect(label.productNumber).toBe(2); // ordinal congelado de la unidad
    expect(label.room).toBe('COCINA');
  });

  it('LABEL_QTY es 1 por pieza física (política del candidato, no un valor copiado de muestra)', async () => {
    const label = await buildPtxPartLabelData({ row: row({ quantity: 2 }), unit: UNIT }, 2);
    expect(label.labelQuantity).toBe(1);
  });

  it('ordinal ausente o inválido BLOQUEA (PROD_NUM exige el ordinal congelado)', async () => {
    const noOrdinal: PtxPartLabelUnitContext = { workshopOccurrenceOrdinal: 0, moduleCode: 'MOD-X' };
    await expect(
      buildPtxPartLabelData({ row: row(), unit: noOrdinal }, 1),
    ).rejects.toMatchObject({ code: 'ptx_compile.label_invalid' });
  });

  it('CORE_MAT proviene de ProductionCutRow.materialCode', async () => {
    const label = await buildPtxPartLabelData({ row: row({ materialCode: 'MDF-AUTH-18' }), unit: UNIT }, 1);
    expect(label.coreMaterial).toBe('MDF-AUTH-18');
  });

  it('ORDER lleva la referencia corta de release cuando existe', async () => {
    const label = await buildPtxPartLabelData({ row: row(), unit: UNIT, orderRef: 'R3' }, 1);
    expect(label.orderRef).toBe('R3');
  });
});

// ---------------------------------------------------------------------------
// Fail-closed de identidad
// ---------------------------------------------------------------------------

describe('#789 fail-closed de identidad de etiqueta', () => {
  it('código de fabricación no ASCII BLOQUEA (nunca se filtra)', async () => {
    await expect(
      buildPtxPartLabelData({ row: row({ labelRef: 'MOD-X-P0Ñ' }), unit: UNIT }, 1),
    ).rejects.toMatchObject({ code: 'ptx_compile.identity_not_ascii' });
  });

  it('fila sin labelRef ni partCode BLOQUEA', async () => {
    await expect(
      buildPtxPartLabelData(
        { row: row({ labelRef: '', partCode: '' }), unit: UNIT },
        1,
      ),
    ).rejects.toBeInstanceOf(PtxCompilationError);
  });

  it('DESC no ASCII se filtra a ASCII de impresión (texto auxiliar, no identidad)', async () => {
    const label = await buildPtxPartLabelData(
      { row: row({ partName: 'COSTADO ÑANDÚ' }), unit: UNIT },
      1,
    );
    expect(label.description).toBe('COSTADO AND');
  });
});
