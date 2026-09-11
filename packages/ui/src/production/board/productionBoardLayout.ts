/**
 * Pure layout algorithms for 2D guillotine cutting board views (ProductionBoardView).
 *
 * Since #650 PR 3, all cutting lines, 1st cut markers, kerf bands and waste
 * blocks derive strictly from the authoritative executed cut program in
 * @granete/domain (projectSheetCutProgram). Cuts are limited to their active
 * parent regions, never spanning across neighboring pieces or the full board.
 * Heuristic X/Y clustering is eliminated.
 */

import type {
  ProductionCutRow,
  CutPlanSheet,
  CutProgramBoardProjection,
  CutProgramStepView,
} from '@granete/domain';
import { projectSheetCutProgram } from '@granete/domain';

export const DEFAULT_SHEET_L = 2440;
export const DEFAULT_SHEET_W = 1830;
export const PADDING_MM = 10;

export interface PlacedPieceLegacy {
  readonly row: ProductionCutRow;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function simplePack(
  rows: readonly ProductionCutRow[],
  sheetL: number,
  sheetW: number,
): readonly PlacedPieceLegacy[] {
  const byMaterial = new Map<string, ProductionCutRow[]>();
  for (const row of rows) {
    const key = row.materialName || 'Sin material';
    const arr = byMaterial.get(key) ?? [];
    for (let i = 0; i < row.quantity; i++) {
      arr.push({ ...row, quantity: 1 });
    }
    byMaterial.set(key, arr);
  }

  const placed: PlacedPieceLegacy[] = [];
  let cursorY = PADDING_MM;

  for (const [, pieces] of byMaterial) {
    let cursorX = PADDING_MM;
    let stripHeight = 0;

    for (const piece of pieces) {
      const w = Math.min(piece.lengthMm, sheetL - PADDING_MM * 2);
      const h = Math.min(piece.widthMm, sheetW - PADDING_MM * 2);

      if (cursorX + w + PADDING_MM > sheetL) {
        cursorX = PADDING_MM;
        cursorY += stripHeight + PADDING_MM;
        stripHeight = 0;
      }

      placed.push({ row: piece, x: cursorX, y: cursorY, w, h });
      cursorX += w + PADDING_MM;
      stripHeight = Math.max(stripHeight, h);
    }
    cursorY += stripHeight + PADDING_MM * 2;
  }

  return placed;
}

export interface StripInfo {
  readonly axis: 'horizontal' | 'vertical';
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly cutCoordinate: number;
}

export interface WasteBlock {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface CrossCutLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface PrimaryCutInfo {
  readonly axis: 'horizontal' | 'vertical';
  readonly coordinateMm: number;
  readonly label: string;
}

export interface BoardCutLayout {
  readonly layoutDirection: 'horizontal' | 'vertical';
  readonly strips: readonly StripInfo[];
  readonly crossCuts: readonly CrossCutLine[];
  readonly wasteBlocks: readonly WasteBlock[];
  readonly primaryCut: PrimaryCutInfo | null;
  /** Program provenance status (#650 PR 3). */
  readonly programStatus: 'valid' | 'missing' | 'invalid' | 'cnc-nesting';
  readonly errorMessage?: string;
  readonly projection?: CutProgramBoardProjection;
}

/**
 * CNC nesting sheets carry no guillotine decoration: no strip rip lines, no
 * cross cuts, no 1st-cut marker.
 */
export const EMPTY_BOARD_CUT_LAYOUT: BoardCutLayout = {
  layoutDirection: 'horizontal',
  strips: [],
  crossCuts: [],
  wasteBlocks: [],
  primaryCut: null,
  programStatus: 'missing',
};

export function computeBoardCutLayout(
  sheet: CutPlanSheet | undefined,
  _lengthMm: number,
  _widthMm: number,
): BoardCutLayout {
  if (!sheet || !sheet.pieces || sheet.pieces.length === 0) {
    return EMPTY_BOARD_CUT_LAYOUT;
  }

  if (sheet.strategy === 'cnc-nesting') {
    return {
      ...EMPTY_BOARD_CUT_LAYOUT,
      programStatus: 'cnc-nesting',
    };
  }

  // Authoritative projection from the executed cut program
  const projection = projectSheetCutProgram(sheet);

  if (projection.status === 'valid') {
    const isHorizontal = projection.primaryCut?.axis === 'y';
    const primaryCut: PrimaryCutInfo | null = projection.primaryCut
      ? {
          axis: projection.primaryCut.axis === 'y' ? 'horizontal' : 'vertical',
          coordinateMm: projection.primaryCut.coordinateMm,
          label: projection.primaryCut.label,
        }
      : null;

    // Each cut is strictly bounded to its active parent region
    const crossCuts: CrossCutLine[] = projection.cuts.map((c) => ({
      x1: c.cutLine.x1,
      y1: c.cutLine.y1,
      x2: c.cutLine.x2,
      y2: c.cutLine.y2,
    }));

    const wasteBlocks: WasteBlock[] = projection.wasteLeaves.map((w) => ({
      x: w.rect.xMm,
      y: w.rect.yMm,
      w: w.rect.lengthMm,
      h: w.rect.widthMm,
    }));

    return {
      layoutDirection: isHorizontal ? 'horizontal' : 'vertical',
      strips: [],
      crossCuts,
      wasteBlocks,
      primaryCut,
      programStatus: 'valid',
      projection,
    };
  }

  if (projection.status === 'invalid') {
    return {
      layoutDirection: 'horizontal',
      strips: [],
      crossCuts: [],
      wasteBlocks: [],
      primaryCut: null,
      programStatus: 'invalid',
      errorMessage: projection.errorMessage,
    };
  }

  // Missing program (legacy plan): keep pieces & remnants, no invented lines or cuts
  return {
    layoutDirection: 'horizontal',
    strips: [],
    crossCuts: [],
    wasteBlocks: [],
    primaryCut: null,
    programStatus: 'missing',
  };
}
