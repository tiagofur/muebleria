/**
 * Bounded cut-program scenarios for the guillotine core tests (#650 PR 1).
 *
 * Geometry literals come from the PTX/CADmatic 4 dossier fixtures
 * (docs/machines/ptx-cadmatic4/examples/01_expected_trace.json and
 * docs/machines/ptx-cadmatic4/validation/counterexample.json). They are
 * documentation-derived test inputs, not machine programs: the Python checker
 * in that dossier is NOT a dependency of this code.
 */

import type {
  CutProgramInput,
  CutProgramExpectedPiece,
} from '../optimizer/cutProgram';
import { CUT_PROGRAM_SCHEMA_VERSION } from '../optimizer/cutProgram';

/**
 * Third-phase exercise: 1200 × 700 board, kerf 4, no outer trims.
 *
 * 1. Separate a 320 mm strip (CUT_A, advance along Y).
 * 2. From the strip, get piece A of 450 × 320 (CUT_B, advance along X).
 * 3. From the strip rest, separate the 280 × 320 block B (CUT_C: relative
 *    measure 280 — its kept edge ends at global X = 734, but the cut measure
 *    is NOT 734).
 * 4. Trim block B to obtain piece B of 280 × 210 (CUT_D, limited to the
 *    block, never spanning the whole board or piece A).
 */
export const threePhaseExerciseProgram: CutProgramInput = {
  schemaVersion: CUT_PROGRAM_SCHEMA_VERSION,
  boardRegionId: 'BOARD',
  regions: [
    { regionId: 'BOARD', rect: { xMm: 0, yMm: 0, lengthMm: 1200, widthMm: 700 } },
    { regionId: 'STRIP', rect: { xMm: 0, yMm: 0, lengthMm: 1200, widthMm: 320 } },
    { regionId: 'REM_TOP', rect: { xMm: 0, yMm: 324, lengthMm: 1200, widthMm: 376 } },
    { regionId: 'PART_A', rect: { xMm: 0, yMm: 0, lengthMm: 450, widthMm: 320 } },
    { regionId: 'STRIP_REST', rect: { xMm: 454, yMm: 0, lengthMm: 746, widthMm: 320 } },
    { regionId: 'BLOCK_B', rect: { xMm: 454, yMm: 0, lengthMm: 280, widthMm: 320 } },
    { regionId: 'REM_RIGHT', rect: { xMm: 738, yMm: 0, lengthMm: 462, widthMm: 320 } },
    { regionId: 'PART_B', rect: { xMm: 454, yMm: 0, lengthMm: 280, widthMm: 210 } },
    { regionId: 'REM_B', rect: { xMm: 454, yMm: 214, lengthMm: 280, widthMm: 106 } },
  ],
  divisions: [
    {
      cutId: 'CUT_A',
      parentRegionId: 'BOARD',
      axis: 'y',
      keptExtentMm: 320,
      kerfMm: 4,
      keptRegionId: 'STRIP',
      restRegionId: 'REM_TOP',
    },
    {
      cutId: 'CUT_B',
      parentRegionId: 'STRIP',
      axis: 'x',
      keptExtentMm: 450,
      kerfMm: 4,
      keptRegionId: 'PART_A',
      restRegionId: 'STRIP_REST',
    },
    {
      cutId: 'CUT_C',
      parentRegionId: 'STRIP_REST',
      axis: 'x',
      keptExtentMm: 280,
      kerfMm: 4,
      keptRegionId: 'BLOCK_B',
      restRegionId: 'REM_RIGHT',
    },
    {
      cutId: 'CUT_D',
      parentRegionId: 'BLOCK_B',
      axis: 'y',
      keptExtentMm: 210,
      kerfMm: 4,
      keptRegionId: 'PART_B',
      restRegionId: 'REM_B',
    },
  ],
  terminals: [
    { regionId: 'PART_A', kind: 'piece', pieceRef: 'PIEZA-A' },
    { regionId: 'PART_B', kind: 'piece', pieceRef: 'PIEZA-B' },
    { regionId: 'REM_TOP', kind: 'remnant' },
    { regionId: 'REM_RIGHT', kind: 'remnant' },
    { regionId: 'REM_B', kind: 'waste' },
  ],
};

/** Expected pieces of the third-phase exercise (placement dimensions, mm). */
export const threePhaseExerciseExpectedPieces: readonly CutProgramExpectedPiece[] = [
  { pieceRef: 'PIEZA-A', lengthMm: 450, widthMm: 320 },
  { pieceRef: 'PIEZA-B', lengthMm: 280, widthMm: 210 },
];

/**
 * Vertical scenario from the dossier counterexample: 1000 × 600 board, kerf 4.
 *
 * First separation advances along X keeping 400 mm (the left column); the
 * following cuts are limited to the right region and never span the board.
 * Piece D exactly matches the final region, so it is a terminal leaf without
 * an additional pass.
 */
export const verticalCounterexampleProgram: CutProgramInput = {
  schemaVersion: CUT_PROGRAM_SCHEMA_VERSION,
  boardRegionId: 'BOARD',
  regions: [
    { regionId: 'BOARD', rect: { xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 } },
    { regionId: 'LEFT', rect: { xMm: 0, yMm: 0, lengthMm: 400, widthMm: 600 } },
    { regionId: 'RIGHT', rect: { xMm: 404, yMm: 0, lengthMm: 596, widthMm: 600 } },
    { regionId: 'PART_B', rect: { xMm: 404, yMm: 0, lengthMm: 596, widthMm: 196 } },
    { regionId: 'MID', rect: { xMm: 404, yMm: 200, lengthMm: 596, widthMm: 400 } },
    { regionId: 'PART_C', rect: { xMm: 404, yMm: 200, lengthMm: 596, widthMm: 196 } },
    { regionId: 'PART_D', rect: { xMm: 404, yMm: 400, lengthMm: 596, widthMm: 200 } },
  ],
  divisions: [
    {
      cutId: 'CUT_1',
      parentRegionId: 'BOARD',
      axis: 'x',
      keptExtentMm: 400,
      kerfMm: 4,
      keptRegionId: 'LEFT',
      restRegionId: 'RIGHT',
    },
    {
      cutId: 'CUT_2',
      parentRegionId: 'RIGHT',
      axis: 'y',
      keptExtentMm: 196,
      kerfMm: 4,
      keptRegionId: 'PART_B',
      restRegionId: 'MID',
    },
    {
      cutId: 'CUT_3',
      parentRegionId: 'MID',
      axis: 'y',
      keptExtentMm: 196,
      kerfMm: 4,
      keptRegionId: 'PART_C',
      restRegionId: 'PART_D',
    },
  ],
  terminals: [
    { regionId: 'LEFT', kind: 'piece', pieceRef: 'PIEZA-A' },
    { regionId: 'PART_B', kind: 'piece', pieceRef: 'PIEZA-B' },
    { regionId: 'PART_C', kind: 'piece', pieceRef: 'PIEZA-C' },
    { regionId: 'PART_D', kind: 'piece', pieceRef: 'PIEZA-D' },
  ],
};

/** Expected pieces of the vertical counterexample (placement dimensions, mm). */
export const verticalCounterexampleExpectedPieces: readonly CutProgramExpectedPiece[] = [
  { pieceRef: 'PIEZA-A', lengthMm: 400, widthMm: 600 },
  { pieceRef: 'PIEZA-B', lengthMm: 596, widthMm: 196 },
  { pieceRef: 'PIEZA-C', lengthMm: 596, widthMm: 196 },
  { pieceRef: 'PIEZA-D', lengthMm: 596, widthMm: 200 },
];
