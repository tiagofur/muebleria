/**
 * Frozen synthetic fixture for #348 PTX import/readback validation.
 *
 * This fixture is the ONLY sanctioned input for the first real import into
 * receiving software. It is hand-laid-out (not optimizer output) so that every
 * serialized value is deliberate and inspectable, and it must never change
 * in place: a change requires a new fixture revision and a new frozen golden.
 *
 * Coverage (why each piece exists):
 * - 2 materials with different board sizes and thicknesses → material mix-ups.
 * - fixture-part-001/002: identical dimensions, distinct identities → detects
 *   receivers that collapse duplicate parts or drop identity.
 * - fixture-part-004 quantity 2 (one rotated, one not) → detects quantity
 *   collapse and rotation handling; grain 0 so both orientations are legal.
 * - fixture-part-001/005: grain 1, never rotated → catches illegal rotation.
 * - Non-integer coordinates from kerf (4.4mm) and edge-band deduction
 *   (0.8mm / 1.0mm) → catches unit, rounding and kerf handling errors.
 * - Useful + scrap remnants → remnant semantics.
 *
 * All identifiers, names and metadata are synthetic. No customer data.
 */

import type { CutPlan, CutPlanPlacedPiece, CutPlanRemnant, CutPlanSheet } from '@granete/domain';
import type { PtxExpectedReadback } from './ptxReadback';

export const PTX_VALIDATION_FIXTURE_ID = 'fixture-board-001';
export const PTX_VALIDATION_FIXTURE_REVISION = 'r1';

/** Fixed timestamp so the generated PTX is byte-deterministic. */
export const PTX_VALIDATION_FIXTURE_GENERATED_AT = '2026-09-06T00:00:00.000Z';

const MATERIAL_A_CODE = 'sample-material-a';
const MATERIAL_A_NAME = 'Tablero Sintetico A 18mm';
const MATERIAL_B_CODE = 'sample-material-b';
const MATERIAL_B_NAME = 'Tablero Sintetico B 16mm';

const BAND_10_CODE = 'sample-band-10';
const BAND_10_NAME = 'Cinta Sintetica 1.0mm';
const BAND_08_CODE = 'sample-band-08';
const BAND_08_NAME = 'Cinta Sintetica 0.8mm';

function piece(input: {
  id: string;
  partCode: string;
  labelRef: string;
  materialCode: string;
  moduleCode: string;
  xMm: number;
  yMm: number;
  placedLengthMm: number;
  placedWidthMm: number;
  finishedLengthMm: number;
  finishedWidthMm: number;
  grain: 0 | 1;
  rotated: boolean;
  bandSides?: { L1?: boolean; L2?: boolean; W1?: boolean; W2?: boolean };
  bandThicknessMm?: number;
  bandCode?: string;
  bandName?: string;
  thicknessMm: number;
  sheetIndex: number;
  stripIndex: number;
  cutSequenceNumber: number;
}): CutPlanPlacedPiece {
  const band = input.bandSides ?? {};
  const hasBand = Boolean(input.bandThicknessMm);
  return {
    id: input.id,
    partCode: input.partCode,
    partName: `Pieza Sintetica ${input.partCode.replace('fixture-part-', '')}`,
    moduleCode: input.moduleCode,
    labelRef: input.labelRef,
    materialName: input.materialCode === MATERIAL_A_CODE ? MATERIAL_A_NAME : MATERIAL_B_NAME,
    materialCode: input.materialCode,
    xMm: input.xMm,
    yMm: input.yMm,
    lengthMm: input.placedLengthMm,
    widthMm: input.placedWidthMm,
    originalLengthMm: input.finishedLengthMm,
    originalWidthMm: input.finishedWidthMm,
    grain: input.grain,
    rotated: input.rotated,
    L1: band.L1 ? 1 : 0,
    L2: band.L2 ? 1 : 0,
    W1: band.W1 ? 1 : 0,
    W2: band.W2 ? 1 : 0,
    edgeBandCode: hasBand ? (input.bandCode ?? '') : undefined,
    edgeBandName: hasBand ? (input.bandName ?? '') : undefined,
    edgeBandThicknessMm: input.bandThicknessMm,
    thicknessMm: input.thicknessMm,
    sheetIndex: input.sheetIndex,
    stripIndex: input.stripIndex,
    cutSequenceNumber: input.cutSequenceNumber,
    status: 'pending',
  };
}

function remnant(input: {
  id: string;
  sheetIndex: number;
  xMm: number;
  yMm: number;
  lengthMm: number;
  widthMm: number;
  materialCode: string;
  isUseful: boolean;
}): CutPlanRemnant {
  return {
    id: input.id,
    sheetIndex: input.sheetIndex,
    xMm: input.xMm,
    yMm: input.yMm,
    lengthMm: input.lengthMm,
    widthMm: input.widthMm,
    areaM2: Math.round((input.lengthMm * input.widthMm) / 1_000_000 * 10_000) / 10_000,
    materialName: input.materialCode === MATERIAL_A_CODE ? MATERIAL_A_NAME : MATERIAL_B_NAME,
    materialCode: input.materialCode,
    isUseful: input.isUseful,
  };
}

/**
 * Builds the frozen CutPlan fixture. Deterministic: no clocks, no randomness,
 * no dependency on catalog or project state.
 */
export function buildPtxValidationCutPlan(): CutPlan {
  const sheetA: CutPlanSheet = {
    sheetIndex: 0,
    strategy: 'saw-guillotine',
    materialCode: MATERIAL_A_CODE,
    materialName: MATERIAL_A_NAME,
    sheetLengthMm: 2750,
    sheetWidthMm: 1830,
    thicknessMm: 18,
    netPiecesAreaM2: 1.4145,
    grossSheetAreaM2: 5.0325,
    usableRemnantAreaM2: 0.3468,
    wasteAreaM2: 3.2712,
    wastePercent: 65,
    yieldPercent: 28.1,
    instructions: [],
    remnants: [
      remnant({
        id: 'fixture-rem-a-useful',
        sheetIndex: 0,
        xMm: 2051.2,
        yMm: 10,
        lengthMm: 600,
        widthMm: 578,
        materialCode: MATERIAL_A_CODE,
        isUseful: true,
      }),
      remnant({
        id: 'fixture-rem-a-scrap',
        sheetIndex: 0,
        xMm: 718,
        yMm: 592.4,
        lengthMm: 300,
        widthMm: 150,
        materialCode: MATERIAL_A_CODE,
        isUseful: false,
      }),
      remnant({
        id: 'fixture-rem-a-scrap-2',
        sheetIndex: 0,
        xMm: 10,
        yMm: 996.8,
        lengthMm: 200,
        widthMm: 100,
        materialCode: MATERIAL_A_CODE,
        isUseful: false,
      }),
    ],
    pieces: [
      // Strip 1 (y=10, width 578). Kerf-sensitive spacing: x gaps include 4.4mm kerf.
      piece({
        id: 'fixture-part-001-s0',
        partCode: 'fixture-part-001',
        labelRef: 'fixture-label-001',
        materialCode: MATERIAL_A_CODE,
        moduleCode: 'fixture-module-a',
        xMm: 10,
        yMm: 10,
        // deductEdgeBand: 716 finished − 1.0 (L1) − 1.0 (L2) = 714 cut
        placedLengthMm: 714,
        placedWidthMm: 578,
        finishedLengthMm: 716,
        finishedWidthMm: 578,
        grain: 1,
        rotated: false,
        bandSides: { L1: true, L2: true },
        bandThicknessMm: 1.0,
        bandCode: BAND_10_CODE,
        bandName: BAND_10_NAME,
        thicknessMm: 18,
        sheetIndex: 0,
        stripIndex: 0,
        cutSequenceNumber: 1,
      }),
      piece({
        // Duplicate dimensions of part-001, distinct identity.
        id: 'fixture-part-002-s0',
        partCode: 'fixture-part-002',
        labelRef: 'fixture-label-002',
        materialCode: MATERIAL_A_CODE,
        moduleCode: 'fixture-module-a',
        xMm: 728.4,
        yMm: 10,
        placedLengthMm: 714,
        placedWidthMm: 578,
        finishedLengthMm: 716,
        finishedWidthMm: 578,
        grain: 1,
        rotated: false,
        bandSides: { L1: true, L2: true },
        bandThicknessMm: 1.0,
        bandCode: BAND_10_CODE,
        bandName: BAND_10_NAME,
        thicknessMm: 18,
        sheetIndex: 0,
        stripIndex: 0,
        cutSequenceNumber: 2,
      }),
      piece({
        id: 'fixture-part-003-s0',
        partCode: 'fixture-part-003',
        labelRef: 'fixture-label-003',
        materialCode: MATERIAL_A_CODE,
        moduleCode: 'fixture-module-a',
        xMm: 1446.8,
        yMm: 10,
        placedLengthMm: 600,
        placedWidthMm: 578,
        finishedLengthMm: 600,
        finishedWidthMm: 578,
        grain: 0,
        rotated: false,
        thicknessMm: 18,
        sheetIndex: 0,
        stripIndex: 0,
        cutSequenceNumber: 3,
      }),
      // Strip 2 (y=592.4). part-004 qty 2: one rotated, one not (grain 0).
      piece({
        id: 'fixture-part-004-s0-i1',
        partCode: 'fixture-part-004',
        labelRef: 'fixture-label-004-1',
        materialCode: MATERIAL_A_CODE,
        moduleCode: 'fixture-module-a',
        xMm: 10,
        yMm: 592.4,
        // Rotated: cut width 299.2 (300 − 0.8 band) placed along X.
        placedLengthMm: 299.2,
        placedWidthMm: 400,
        finishedLengthMm: 400,
        finishedWidthMm: 300,
        grain: 0,
        rotated: true,
        bandSides: { W1: true },
        bandThicknessMm: 0.8,
        bandCode: BAND_08_CODE,
        bandName: BAND_08_NAME,
        thicknessMm: 18,
        sheetIndex: 0,
        stripIndex: 1,
        cutSequenceNumber: 4,
      }),
      piece({
        id: 'fixture-part-004-s0-i2',
        partCode: 'fixture-part-004',
        labelRef: 'fixture-label-004-2',
        materialCode: MATERIAL_A_CODE,
        moduleCode: 'fixture-module-a',
        xMm: 313.6,
        yMm: 592.4,
        // Same part, not rotated: cut 400 × 299.2.
        placedLengthMm: 400,
        placedWidthMm: 299.2,
        finishedLengthMm: 400,
        finishedWidthMm: 300,
        grain: 0,
        rotated: false,
        bandSides: { W1: true },
        bandThicknessMm: 0.8,
        bandCode: BAND_08_CODE,
        bandName: BAND_08_NAME,
        thicknessMm: 18,
        sheetIndex: 0,
        stripIndex: 1,
        cutSequenceNumber: 5,
      }),
    ],
  };

  const sheetB: CutPlanSheet = {
    sheetIndex: 1,
    strategy: 'saw-guillotine',
    materialCode: MATERIAL_B_CODE,
    materialName: MATERIAL_B_NAME,
    sheetLengthMm: 2440,
    sheetWidthMm: 1220,
    thicknessMm: 16,
    netPiecesAreaM2: 0.78,
    grossSheetAreaM2: 2.9768,
    usableRemnantAreaM2: 0,
    wasteAreaM2: 2.1968,
    wastePercent: 73.8,
    yieldPercent: 26.2,
    instructions: [],
    remnants: [
      remnant({
        id: 'fixture-rem-b-scrap',
        sheetIndex: 1,
        xMm: 1318.8,
        yMm: 10,
        lengthMm: 400,
        widthMm: 300,
        materialCode: MATERIAL_B_CODE,
        isUseful: false,
      }),
    ],
    pieces: [
      piece({
        id: 'fixture-part-005-s1',
        partCode: 'fixture-part-005',
        labelRef: 'fixture-label-005',
        materialCode: MATERIAL_B_CODE,
        moduleCode: 'fixture-module-b',
        xMm: 10,
        yMm: 10,
        // deductEdgeBand: 600 finished − 0.8 (W1) = 599.2 cut
        placedLengthMm: 800,
        placedWidthMm: 599.2,
        finishedLengthMm: 800,
        finishedWidthMm: 600,
        grain: 1,
        rotated: false,
        bandSides: { W1: true },
        bandThicknessMm: 0.8,
        bandCode: BAND_08_CODE,
        bandName: BAND_08_NAME,
        thicknessMm: 16,
        sheetIndex: 1,
        stripIndex: 0,
        cutSequenceNumber: 1,
      }),
      piece({
        id: 'fixture-part-006-s1',
        partCode: 'fixture-part-006',
        labelRef: 'fixture-label-006',
        materialCode: MATERIAL_B_CODE,
        moduleCode: 'fixture-module-b',
        xMm: 814.4,
        yMm: 10,
        placedLengthMm: 500,
        placedWidthMm: 600,
        finishedLengthMm: 500,
        finishedWidthMm: 600,
        grain: 0,
        rotated: false,
        thicknessMm: 16,
        sheetIndex: 1,
        stripIndex: 0,
        cutSequenceNumber: 2,
      }),
    ],
  };

  return {
    id: `cutplan-${PTX_VALIDATION_FIXTURE_ID}`,
    projectId: PTX_VALIDATION_FIXTURE_ID,
    projectName: PTX_VALIDATION_FIXTURE_ID,
    generatedAt: PTX_VALIDATION_FIXTURE_GENERATED_AT,
    version: 1,
    isFrozen: true,
    config: {
      sawKerfMm: 4.4,
      trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      deductEdgeBand: true,
      allowRotationNoGrain: true,
      minRemnantWidthMm: 400,
      minRemnantLengthMm: 600,
      preferLongitudinalRips: true,
      heuristic: 'guillotine-hybrid',
    },
    sheets: [sheetA, sheetB],
    stats: {
      totalSheets: 2,
      totalPieces: 7,
      totalGrossAreaM2: 8.0093,
      totalNetPiecesAreaM2: 2.1945,
      totalUsefulRemnantsAreaM2: 0.3468,
      totalWasteAreaM2: 5.468,
      globalWastePercent: 68.3,
      globalYieldPercent: 27.4,
      byMaterial: [
        {
          materialCode: MATERIAL_A_CODE,
          materialName: MATERIAL_A_NAME,
          sheetsNeeded: 1,
          piecesCount: 5,
          netAreaM2: 1.4145,
          grossAreaM2: 5.0325,
          wastePercent: 65,
          yieldPercent: 28.1,
          usefulRemnantsCount: 1,
          usefulRemnantsAreaM2: 0.3468,
        },
        {
          materialCode: MATERIAL_B_CODE,
          materialName: MATERIAL_B_NAME,
          sheetsNeeded: 1,
          piecesCount: 2,
          netAreaM2: 0.78,
          grossAreaM2: 2.9768,
          wastePercent: 73.8,
          yieldPercent: 26.2,
          usefulRemnantsCount: 0,
          usefulRemnantsAreaM2: 0,
        },
      ],
    },
    usefulRemnants: [
      remnant({
        id: 'fixture-rem-a-useful',
        sheetIndex: 0,
        xMm: 2051.2,
        yMm: 10,
        lengthMm: 600,
        widthMm: 578,
        materialCode: MATERIAL_A_CODE,
        isUseful: true,
      }),
    ],
  };
}

/** Canonical export input for the fixture (deterministic customer/project naming). */
export function buildPtxValidationExportInput() {
  return {
    cutPlan: buildPtxValidationCutPlan(),
    projectName: PTX_VALIDATION_FIXTURE_ID,
    customerName: 'Fixture Operator',
    projectCode: PTX_VALIDATION_FIXTURE_ID,
  };
}

/**
 * Machine/software-neutral expected readback for the frozen fixture.
 * Built from the same fixture data that generates the PTX, so expected and
 * exported values can never drift apart silently.
 */
export function buildExpectedPtxReadback(): PtxExpectedReadback {
  return {
    fixture: {
      id: PTX_VALIDATION_FIXTURE_ID,
      revision: PTX_VALIDATION_FIXTURE_REVISION,
      generatedAt: PTX_VALIDATION_FIXTURE_GENERATED_AT,
      sourceModule: 'packages/excel/src/ptxCutPlanExport.ts',
      exportedWith: 'generatePtxString (unified mode)',
    },
    job: {
      jobName: PTX_VALIDATION_FIXTURE_ID,
      projectCode: PTX_VALIDATION_FIXTURE_ID,
      customer: 'Fixture Operator',
      units: 'mm',
      kerfMm: 4.4,
      trimMm: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      deductEdgeBand: true,
      sheetCount: 2,
      placedPieceCount: 7,
    },
    materials: [
      {
        materialCode: MATERIAL_A_CODE,
        materialName: MATERIAL_A_NAME,
        sheetLengthMm: 2750,
        sheetWidthMm: 1830,
        thicknessMm: 18,
      },
      {
        materialCode: MATERIAL_B_CODE,
        materialName: MATERIAL_B_NAME,
        sheetLengthMm: 2440,
        sheetWidthMm: 1220,
        thicknessMm: 16,
      },
    ],
    parts: [
      {
        partCode: 'fixture-part-001',
        quantity: 1,
        materialCode: MATERIAL_A_CODE,
        finishedLengthMm: 716,
        finishedWidthMm: 578,
        cutLengthMm: 714,
        cutWidthMm: 578,
        thicknessMm: 18,
        grain: 1,
        rotatedCount: 0,
        edgeBandSides: ['L1', 'L2'],
        edgeBandThicknessMm: 1.0,
        barcodes: ['fixture-label-001'],
      },
      {
        partCode: 'fixture-part-002',
        quantity: 1,
        materialCode: MATERIAL_A_CODE,
        finishedLengthMm: 716,
        finishedWidthMm: 578,
        cutLengthMm: 714,
        cutWidthMm: 578,
        thicknessMm: 18,
        grain: 1,
        rotatedCount: 0,
        edgeBandSides: ['L1', 'L2'],
        edgeBandThicknessMm: 1.0,
        barcodes: ['fixture-label-002'],
      },
      {
        partCode: 'fixture-part-003',
        quantity: 1,
        materialCode: MATERIAL_A_CODE,
        finishedLengthMm: 600,
        finishedWidthMm: 578,
        cutLengthMm: 600,
        cutWidthMm: 578,
        thicknessMm: 18,
        grain: 0,
        rotatedCount: 0,
        edgeBandSides: [],
        edgeBandThicknessMm: undefined,
        barcodes: ['fixture-label-003'],
      },
      {
        partCode: 'fixture-part-004',
        quantity: 2,
        materialCode: MATERIAL_A_CODE,
        finishedLengthMm: 400,
        finishedWidthMm: 300,
        // Cut dims of the unrotated instance; the rotated instance swaps them.
        cutLengthMm: 400,
        cutWidthMm: 299.2,
        thicknessMm: 18,
        grain: 0,
        rotatedCount: 1,
        edgeBandSides: ['W1'],
        edgeBandThicknessMm: 0.8,
        barcodes: ['fixture-label-004-1', 'fixture-label-004-2'],
      },
      {
        partCode: 'fixture-part-005',
        quantity: 1,
        materialCode: MATERIAL_B_CODE,
        finishedLengthMm: 800,
        finishedWidthMm: 600,
        cutLengthMm: 800,
        cutWidthMm: 599.2,
        thicknessMm: 16,
        grain: 1,
        rotatedCount: 0,
        edgeBandSides: ['W1'],
        edgeBandThicknessMm: 0.8,
        barcodes: ['fixture-label-005'],
      },
      {
        partCode: 'fixture-part-006',
        quantity: 1,
        materialCode: MATERIAL_B_CODE,
        finishedLengthMm: 500,
        finishedWidthMm: 600,
        cutLengthMm: 500,
        cutWidthMm: 600,
        thicknessMm: 16,
        grain: 0,
        rotatedCount: 0,
        edgeBandSides: [],
        edgeBandThicknessMm: undefined,
        barcodes: ['fixture-label-006'],
      },
    ],
    cutOrderExpected: [
      'PAT_1:TRIM_BOTTOM',
      'PAT_1:TRIM_LEFT',
      'PAT_1:TRIM_TOP',
      'PAT_1:TRIM_RIGHT',
      'PAT_1:RIP_STRIP_1',
      'PAT_1:CROSS_CUT fixture-part-001',
      'PAT_1:CROSS_CUT fixture-part-002',
      'PAT_1:CROSS_CUT fixture-part-003',
      'PAT_1:RIP_STRIP_2',
      'PAT_1:CROSS_CUT fixture-part-004',
      'PAT_1:CROSS_CUT fixture-part-004',
      'PAT_1:REMNANT_USEFUL fixture-rem-a-useful',
      'PAT_2:TRIM_BOTTOM',
      'PAT_2:TRIM_LEFT',
      'PAT_2:TRIM_TOP',
      'PAT_2:TRIM_RIGHT',
      'PAT_2:RIP_STRIP_1',
      'PAT_2:CROSS_CUT fixture-part-005',
      'PAT_2:CROSS_CUT fixture-part-006',
    ],
    notRepresentedByCurrentPtx: [
      'bomFingerprint',
      'designRevisionId',
      'productionReleaseId',
      'cutPlanId',
      'cutPlanVersion',
      'edgeBandCode',
      'edgeBandName',
      'drilling',
      'hardware',
      'pieceLabelQrScheme',
    ],
  };
}

/** Deterministic JSON serialization for the expected readback (emitted artifact). */
export function serializeExpectedReadback(expected: PtxExpectedReadback): string {
  return `${JSON.stringify(expected, null, 2)}\n`;
}
