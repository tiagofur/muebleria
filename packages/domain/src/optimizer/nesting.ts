/**
 * 2D MaxRects nesting engine for CNC routers (non-guillotine placement).
 *
 * Unlike the guillotine engine (saw cuts spanning the full board), MaxRects
 * places rectangular pieces freely, mixing large and small parts on the same
 * sheet. Uses tool spacing between pieces instead of saw kerf and produces no
 * cutting sequence — the CNC consumes the DXF layout, not manual instructions.
 */

import type { ProductionCutRow } from '../types';
import type { PieceToPlace, PlacementResult } from './pieces';
import { isUsefulRemnant, unrollRows } from './pieces';
import type { CutPlanConfig, CutPlanPlacedPiece, CutPlanRemnant } from './types';
import { DEFAULT_TOOL_SPACING_MM } from './types';

interface FreeRect {
  x: number;
  y: number;
  length: number; // Dimension along board length (X)
  width: number;  // Dimension along board width (Y)
}

function rectsIntersect(a: FreeRect, b: FreeRect): boolean {
  return (
    a.x < b.x + b.length &&
    a.x + a.length > b.x &&
    a.y < b.y + b.width &&
    a.y + a.width > b.y
  );
}

function rectContains(outer: FreeRect, inner: FreeRect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.length >= inner.x + inner.length &&
    outer.y + outer.width >= inner.y + inner.width
  );
}

/**
 * MaxRects split: every free rect intersecting the used rect is replaced by up
 * to 4 remainders, then rects contained in others are pruned. The used rect is
 * inflated by the tool spacing on ALL four sides so any piece placed later in
 * a surviving rect keeps at least one axis of clearance >= spacing.
 */
function splitFreeRects(free: FreeRect[], used: FreeRect): void {
  const next: FreeRect[] = [];
  for (const f of free) {
    if (!rectsIntersect(f, used)) {
      next.push(f);
      continue;
    }
    if (f.x < used.x) {
      next.push({ x: f.x, y: f.y, length: used.x - f.x, width: f.width });
    }
    if (f.x + f.length > used.x + used.length) {
      next.push({
        x: used.x + used.length,
        y: f.y,
        length: f.x + f.length - (used.x + used.length),
        width: f.width,
      });
    }
    if (f.y < used.y) {
      next.push({ x: f.x, y: f.y, length: f.length, width: used.y - f.y });
    }
    if (f.y + f.width > used.y + used.width) {
      next.push({
        x: f.x,
        y: used.y + used.width,
        length: f.length,
        width: f.y + f.width - (used.y + used.width),
      });
    }
  }
  free.length = 0;
  for (const r of next) {
    if (r.length <= 0 || r.width <= 0) continue;
    if (next.some((o) => o !== r && rectContains(o, r))) continue;
    free.push(r);
  }
}

/**
 * MaxRects free rects overlap each other by design; pick a disjoint subset
 * (greedy by area) so remnant areas and stats never double-count.
 */
function selectDisjointRemnants(free: readonly FreeRect[]): FreeRect[] {
  const sorted = [...free].sort((a, b) => b.length * b.width - a.length * a.width);
  const kept: FreeRect[] = [];
  for (const r of sorted) {
    if (!kept.some((k) => rectsIntersect(k, r))) {
      kept.push(r);
    }
  }
  return kept;
}

/**
 * Packs pieces onto a single sheet using MaxRects Best Short Side Fit.
 */
export function packSingleSheetMaxRects(
  piecesRemaining: PieceToPlace[],
  sheetIndex: number,
  sheetLengthMm: number,
  sheetWidthMm: number,
  config: CutPlanConfig,
  materialCode: string,
  materialName: string,
  thicknessMm?: number,
): { sheet: PlacementResult; remaining: PieceToPlace[] } {
  const spacing = config.toolSpacingMm ?? DEFAULT_TOOL_SPACING_MM;
  const trim = config.trim;

  const minX = trim.leftMm;
  const minY = trim.bottomMm;
  const usableLength = Math.max(0, sheetLengthMm - trim.leftMm - trim.rightMm);
  const usableWidth = Math.max(0, sheetWidthMm - trim.topMm - trim.bottomMm);

  const free: FreeRect[] = [{ x: minX, y: minY, length: usableLength, width: usableWidth }];

  const placedPieces: CutPlanPlacedPiece[] = [];
  const notPlaced: PieceToPlace[] = [];
  let placeSequence = 0;

  for (const piece of piecesRemaining) {
    let bestRect: FreeRect | null = null;
    let bestShortSide = Number.POSITIVE_INFINITY;
    let bestLongSide = Number.POSITIVE_INFINITY;
    let bestRotated = false;
    let placedL = piece.length;
    let placedW = piece.width;

    for (const rect of free) {
      // Best Short Side Fit — normal orientation
      if (piece.length <= rect.length && piece.width <= rect.width) {
        const leftoverL = rect.length - piece.length;
        const leftoverW = rect.width - piece.width;
        const shortSide = Math.min(leftoverL, leftoverW);
        const longSide = Math.max(leftoverL, leftoverW);
        if (shortSide < bestShortSide || (shortSide === bestShortSide && longSide < bestLongSide)) {
          bestRect = rect;
          bestShortSide = shortSide;
          bestLongSide = longSide;
          bestRotated = false;
          placedL = piece.length;
          placedW = piece.width;
        }
      }

      // Rotated orientation (only when grain is 0 / no grain)
      if (
        config.allowRotationNoGrain &&
        piece.grain === 0 &&
        piece.width <= rect.length &&
        piece.length <= rect.width
      ) {
        const leftoverL = rect.length - piece.width;
        const leftoverW = rect.width - piece.length;
        const shortSide = Math.min(leftoverL, leftoverW);
        const longSide = Math.max(leftoverL, leftoverW);
        if (shortSide < bestShortSide || (shortSide === bestShortSide && longSide < bestLongSide)) {
          bestRect = rect;
          bestShortSide = shortSide;
          bestLongSide = longSide;
          bestRotated = true;
          placedL = piece.width;
          placedW = piece.length;
        }
      }
    }

    if (bestRect) {
      placeSequence++;
      placedPieces.push({
        id: `${piece.id}-s${sheetIndex}`,
        partCode: piece.originalRow.partCode || `P${placeSequence}`,
        partName: piece.originalRow.partName || piece.originalRow.description || 'Pieza',
        moduleCode: piece.originalRow.moduleCode || '',
        labelRef: piece.originalRow.labelRef || piece.id,
        materialName: piece.originalRow.materialName || materialName,
        materialCode: piece.originalRow.materialCode || materialCode,
        xMm: bestRect.x,
        yMm: bestRect.y,
        lengthMm: placedL,
        widthMm: placedW,
        originalLengthMm: piece.originalRow.lengthMm,
        originalWidthMm: piece.originalRow.widthMm,
        grain: piece.grain,
        rotated: bestRotated,
        L1: piece.originalRow.L1,
        L2: piece.originalRow.L2,
        W1: piece.originalRow.W1,
        W2: piece.originalRow.W2,
        edgeBandCode: piece.originalRow.edgeBandCode,
        edgeBandName: piece.originalRow.edgeBandName,
        edgeBandThicknessMm: piece.originalRow.edgeBandThicknessMm,
        thicknessMm: piece.originalRow.thicknessMm ?? thicknessMm,
        sheetIndex,
        stripIndex: 0,
        cutSequenceNumber: placeSequence,
        status: 'pending',
      });

      splitFreeRects(free, {
        x: bestRect.x - spacing,
        y: bestRect.y - spacing,
        length: placedL + 2 * spacing,
        width: placedW + 2 * spacing,
      });
    } else {
      notPlaced.push(piece);
    }
  }

  const remnantRects = selectDisjointRemnants(free.filter((r) => r.length > 5 && r.width > 5));
  const remnants: CutPlanRemnant[] = remnantRects.map((r, idx) => ({
    id: `rem-s${sheetIndex}-${idx + 1}`,
    sheetIndex,
    xMm: r.x,
    yMm: r.y,
    lengthMm: r.length,
    widthMm: r.width,
    areaM2: (r.length * r.width) / 1_000_000,
    materialName,
    materialCode,
    isUseful: isUsefulRemnant(r.length, r.width, config),
  }));

  return {
    sheet: {
      pieces: placedPieces,
      remnants,
      instructions: [],
      sheetIndex,
      sheetLengthMm,
      sheetWidthMm,
      materialCode,
      materialName,
      thicknessMm,
      strategy: 'cnc-nesting',
    },
    remaining: notPlaced,
  };
}

/**
 * Optimizes a list of cut rows for a single material across multiple sheets
 * using MaxRects nesting.
 */
export function optimizeSingleMaterialNesting(
  materialRows: readonly ProductionCutRow[],
  sheetLengthMm: number,
  sheetWidthMm: number,
  materialCode: string,
  materialName: string,
  thicknessMm: number | undefined,
  config: CutPlanConfig,
): PlacementResult[] {
  const unrolled = unrollRows(materialRows, config.deductEdgeBand ?? true);
  // Largest first keeps early sheets dense and lets small parts fill the gaps
  // between large ones — the whole point of nesting vs strip cutting.
  unrolled.sort((a, b) => b.length * b.width - a.length * a.width || b.length - a.length);

  const results: PlacementResult[] = [];
  let remaining = [...unrolled];
  let sheetIndex = 0;
  while (remaining.length > 0) {
    const res = packSingleSheetMaxRects(
      remaining,
      sheetIndex,
      sheetLengthMm,
      sheetWidthMm,
      config,
      materialCode,
      materialName,
      thicknessMm,
    );
    if (res.sheet.pieces.length === 0) {
      // Piece larger than usable sheet
      break;
    }
    results.push(res.sheet);
    remaining = res.remaining;
    sheetIndex++;
  }
  return results;
}
