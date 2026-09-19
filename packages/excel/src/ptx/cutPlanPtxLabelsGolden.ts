/**
 * #789 — LABEL GOLDEN SCENARIO fixture (PARTS_INF/PARTS_UDI/CNC identity).
 *
 * Deterministic end-to-end scenario for the r5 label projection over a REAL
 * optimizeCutPlan result: same rows + catalog + config + frozen units +
 * options always produce the same bytes. LAB ONLY — NOT a machine-validated
 * program, NOT a CADLink/CADmatic acceptance; supportStatus stays
 * NOT_TESTED/notClaimed.
 *
 * What the scenario deliberately covers (issue #789 acceptance):
 * - TWO furniture modules across THREE physical units, one REPEATED
 *   occurrence (ZZ-ALTO twice → -L2 code suffix on the second unit);
 * - ANTISYMMETRIC ORDER TRAP: the lexical order of module codes (AA-BAJO <
 *   ZZ-ALTO) is OPPOSITE to the frozen occurrence order (ZZ-ALTO=1,
 *   AA-BAJO=2, ZZ-ALTO=3). PROD_NUM follows the FROZEN workshop occurrence
 *   ordinal, never lexical/array order — any array-order derivation swaps
 *   labels across occurrences and fails the golden tests;
 * - distinct part names (COSTADO/PUERTA/REPISA/FONDO/TAPA);
 * - asymmetric edge patterns: 3+1 (L1,L2,W1 banded, W2 not), all-four,
 *   single L2 (bottom-length only → EDGE1, not EDGE2), width-axis-only
 *   (W1,W2 banded → EDGE3/EDGE4), and a no-edge piece;
 * - TWO finishes: two board materials (MDF-BCO-18 / MDF-ROBLE-18) and two
 *   edge bands (1mm ABS / 2mm PVC — different deduction thicknesses);
 * - quantity>1 row (REPISA ×2) exercising the -C2 copy suffix per unit;
 * - ROOM (COCINA / LIVING — the repeated unit sits in another room), ORDER
 *   (release ref R3), manufacturing codes, D<hex12> drawing refs, scan
 *   barcodes and frozen finished measures under deductEdgeBand=true.
 */

import type { CutPlanConfig, MaterialBoard, ProductionCutRow } from '@granete/domain';
import type { CompileCutPlanToPtxOptions } from './compileCutPlan';
import type { PtxPartLabelInput, PtxPartLabelUnitContext } from './partLabels';

export const LABELS_GOLDEN_PROJECT_ID = 'lab-789-labels';

/** Lexically LAST module occurs FIRST and THIRD; lexically FIRST occurs SECOND. */
export const ZZ_MODULE_CODE = 'ZZ-ALTO';
export const AA_MODULE_CODE = 'AA-BAJO';

export const ZZ_UNIT_1: PtxPartLabelUnitContext = {
  workshopOccurrenceOrdinal: 1,
  moduleCode: ZZ_MODULE_CODE,
  moduleName: 'Modulo alto',
  moduleWidthMm: 600,
  moduleHeightMm: 2000,
  moduleDepthMm: 500,
  room: 'COCINA',
};

/** The REPEATED ZZ-ALTO occurrence: ordinal 3 (not 2 — AA-BAJO took it), different room. */
export const ZZ_UNIT_3: PtxPartLabelUnitContext = {
  ...ZZ_UNIT_1,
  workshopOccurrenceOrdinal: 3,
  room: 'LIVING',
};

export const AA_UNIT_2: PtxPartLabelUnitContext = {
  workshopOccurrenceOrdinal: 2,
  moduleCode: AA_MODULE_CODE,
  moduleName: 'Modulo bajo',
  moduleWidthMm: 800,
  moduleHeightMm: 400,
  moduleDepthMm: 450,
  room: 'COCINA',
};

export const BAND_ABS_1MM = 'C-ABS-BCO-1';
export const BAND_PVC_2MM = 'C-PVC-NEG-2';

/** ZZ-ALTO engineering rows for one unit; lineSuffix '' for occurrence 1, '-L2' for occurrence 3. */
export function zzRows(lineSuffix: '' | '-L2'): ProductionCutRow[] {
  const ref = (part: string) => `${ZZ_MODULE_CODE}${lineSuffix}-P${part}`;
  const band = {
    edgeBandCode: BAND_ABS_1MM,
    edgeBandName: 'Abs blanco 1mm',
    edgeBandThicknessMm: 1,
  };
  return [
    {
      // 3+1 asymmetric trap: L1, L2 and W1 banded, W2 NOT.
      quantity: 1,
      lengthMm: 1900,
      widthMm: 500,
      description: `COSTADO ${lineSuffix}`,
      materialName: 'MDF Blanco 18',
      materialCode: 'MDF-BCO-18',
      grain: 1,
      L1: 1,
      L2: 1,
      W1: 1,
      W2: 0,
      partCode: ref('01'),
      partName: 'COSTADO',
      moduleCode: ZZ_MODULE_CODE,
      labelRef: ref('01'),
      thicknessMm: 18,
      ...band,
    },
    {
      // The four-banded piece.
      quantity: 1,
      lengthMm: 1800,
      widthMm: 396,
      description: `PUERTA ${lineSuffix}`,
      materialName: 'MDF Blanco 18',
      materialCode: 'MDF-BCO-18',
      grain: 1,
      L1: 1,
      L2: 1,
      W1: 1,
      W2: 1,
      partCode: ref('02'),
      partName: 'PUERTA',
      moduleCode: ZZ_MODULE_CODE,
      labelRef: ref('02'),
      thicknessMm: 18,
      ...band,
    },
    {
      // quantity=2: physical copies take the optimizer's -C2 suffix per unit.
      // Only L2 banded: the code lands on EDGE1 (Btm length), never EDGE2.
      quantity: 2,
      lengthMm: 800,
      widthMm: 390,
      description: `REPISA ${lineSuffix}`,
      materialName: 'MDF Blanco 18',
      materialCode: 'MDF-BCO-18',
      grain: 1,
      L1: 0,
      L2: 1,
      W1: 0,
      W2: 0,
      partCode: ref('03'),
      partName: 'REPISA',
      moduleCode: ZZ_MODULE_CODE,
      labelRef: ref('03'),
      thicknessMm: 18,
      ...band,
    },
  ];
}

export function aaRows(): ProductionCutRow[] {
  return [
    {
      // Axis trap: WIDTH sides banded (2mm PVC), LENGTH sides not.
      quantity: 1,
      lengthMm: 800,
      widthMm: 400,
      description: 'FONDO',
      materialName: 'MDF Roble 18',
      materialCode: 'MDF-ROBLE-18',
      grain: 1,
      L1: 0,
      L2: 0,
      W1: 1,
      W2: 1,
      partCode: `${AA_MODULE_CODE}-P01`,
      partName: 'FONDO',
      moduleCode: AA_MODULE_CODE,
      labelRef: `${AA_MODULE_CODE}-P01`,
      thicknessMm: 18,
      edgeBandCode: BAND_PVC_2MM,
      edgeBandName: 'PVC negro 2mm',
      edgeBandThicknessMm: 2,
    },
    {
      // The no-edge piece (sin canto): every EDGE column stays empty.
      quantity: 1,
      lengthMm: 780,
      widthMm: 400,
      description: 'TAPA',
      materialName: 'MDF Roble 18',
      materialCode: 'MDF-ROBLE-18',
      grain: 1,
      L1: 0,
      L2: 0,
      W1: 0,
      W2: 0,
      partCode: `${AA_MODULE_CODE}-P02`,
      partName: 'TAPA',
      moduleCode: AA_MODULE_CODE,
      labelRef: `${AA_MODULE_CODE}-P02`,
      thicknessMm: 18,
    },
  ];
}

/** Label inputs in FROZEN OCCURRENCE order (ZZ@1, AA@2, ZZ@3) — never lexical. */
export function labelInputs(orderRef = 'R3'): readonly PtxPartLabelInput[] {
  return [
    ...zzRows('').map((row) => ({ row, unit: ZZ_UNIT_1, orderRef })),
    ...aaRows().map((row) => ({ row, unit: AA_UNIT_2, orderRef })),
    ...zzRows('-L2').map((row) => ({ row, unit: ZZ_UNIT_3, orderRef })),
  ];
}

/** All engineering rows (the optimizer demand), same occurrence order. */
export function scenarioRows(): ProductionCutRow[] {
  return labelInputs().map((input) => input.row);
}

export const LABELS_GOLDEN_MATERIALS: MaterialBoard[] = [
  {
    id: 'mat-bco-18',
    code: 'MDF-BCO-18',
    name: 'MDF Blanco 18',
    costPerM2: 10,
    wastePercent: 10,
    lengthMm: 2440,
    widthMm: 1220,
    thicknessMm: 18,
    grainDefault: true,
    boardPrice: 8,
    active: true,
  },
  {
    id: 'mat-rob-18',
    code: 'MDF-ROBLE-18',
    name: 'MDF Roble 18',
    costPerM2: 12,
    wastePercent: 10,
    lengthMm: 2440,
    widthMm: 1220,
    thicknessMm: 18,
    grainDefault: true,
    boardPrice: 9,
    active: true,
  },
];

export const LABELS_GOLDEN_CONFIG: CutPlanConfig = {
  sawKerfMm: 4,
  trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
  deductEdgeBand: true,
  allowRotationNoGrain: true,
  minRemnantWidthMm: 300,
  minRemnantLengthMm: 400,
  preferLongitudinalRips: true,
  heuristic: 'guillotine-hybrid',
};

/**
 * Candidate options WITHOUT partLabels (the label projection is passed by
 * the test as its own frozen input — the golden scenario compiles the SAME
 * plan with the SAME options plus the projection). TITLE is 13 chars, within
 * the documented 25 limit, so the strict spec preflight passes.
 */
export const LABELS_GOLDEN_OPTIONS: CompileCutPlanToPtxOptions = {
  headerVersion: 1,
  headerOrigin: 0,
  trimType: 1,
  title: 'LAB-LABELS-R5',
  decimalPlaces: 2,
  supportsPositiveTrim: true,
  offcutsWithQuantity: true,
  offcutsBeforePatterns: true,
  offcutCutMarkers: 'function92-only',
  partCodeAuthority: 'workshop-labelref',
  partCodeMaxLength: 50,
  strictSpecPreflight: 'pattern-exchange-v1',
  partsUdi: 'structural',
};
