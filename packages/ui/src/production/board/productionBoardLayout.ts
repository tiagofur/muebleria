/**
 * Pure layout algorithms for 2D guillotine cutting board views (ProductionBoardView).
 */

import type {
  ProductionCutRow,
  CutPlanSheet,
  CutPlanPlacedPiece,
} from '@muebles/domain';

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
}

export function computeBoardCutLayout(
  sheet: CutPlanSheet | undefined,
  lengthMm: number,
  widthMm: number,
): BoardCutLayout {
  if (!sheet || !sheet.pieces || sheet.pieces.length === 0) {
    return {
      layoutDirection: 'horizontal',
      strips: [],
      crossCuts: [],
      wasteBlocks: [],
      primaryCut: null,
    };
  }

  const pieces = sheet.pieces;

  // Determine layout direction: group by yMm (horizontal rows) vs xMm (vertical cols)
  const yClusters = new Map<number, CutPlanPlacedPiece[]>();
  const xClusters = new Map<number, CutPlanPlacedPiece[]>();

  for (const p of pieces) {
    // Y clustering
    let foundYKey: number | null = null;
    for (const k of yClusters.keys()) {
      if (Math.abs(k - p.yMm) <= 2) {
        foundYKey = k;
        break;
      }
    }
    if (foundYKey !== null) {
      yClusters.get(foundYKey)!.push(p);
    } else {
      yClusters.set(p.yMm, [p]);
    }

    // X clustering
    let foundXKey: number | null = null;
    for (const k of xClusters.keys()) {
      if (Math.abs(k - p.xMm) <= 2) {
        foundXKey = k;
        break;
      }
    }
    if (foundXKey !== null) {
      xClusters.get(foundXKey)!.push(p);
    } else {
      xClusters.set(p.xMm, [p]);
    }
  }

  const avgPiecesPerY = pieces.length / Math.max(1, yClusters.size);
  const avgPiecesPerX = pieces.length / Math.max(1, xClusters.size);

  const isHorizontal = avgPiecesPerY >= avgPiecesPerX;
  const computedStrips: StripInfo[] = [];
  const computedCrossCuts: CrossCutLine[] = [];
  const computedWaste: WasteBlock[] = [];
  let primCut: PrimaryCutInfo | null = null;

  if (isHorizontal) {
    // HORIZONTAL STRIPS (Layout in Rows)
    const sortedYKeys = [...yClusters.keys()].sort((a, b) => a - b);
    let maxUsedY = 0;

    for (const yKey of sortedYKeys) {
      const rowPieces = yClusters.get(yKey)!;
      const minY = Math.min(...rowPieces.map((p) => p.yMm));
      const maxY = Math.max(...rowPieces.map((p) => p.yMm + p.widthMm));
      const minX = Math.min(...rowPieces.map((p) => p.xMm));
      const maxX = Math.max(...rowPieces.map((p) => p.xMm + p.lengthMm));
      const rowHeight = maxY - minY;

      if (maxY > maxUsedY) maxUsedY = maxY;

      computedStrips.push({
        axis: 'horizontal',
        minX,
        maxX,
        minY,
        maxY,
        cutCoordinate: maxY,
      });

      // Vertical cross cuts between pieces in this horizontal row
      const sortedPiecesInRow = [...rowPieces].sort((a, b) => a.xMm - b.xMm);
      for (const p of sortedPiecesInRow) {
        const cutX = p.xMm + p.lengthMm;
        computedCrossCuts.push({
          x1: cutX,
          y1: minY,
          x2: cutX,
          y2: maxY,
        });

        // If piece height is less than row height, there is a waste strip above it
        if (p.widthMm < rowHeight - 1) {
          computedWaste.push({
            x: p.xMm,
            y: p.yMm + p.widthMm,
            w: p.lengthMm,
            h: rowHeight - p.widthMm,
          });
        }
      }

      // Leftover at the end of the row
      if (maxX < lengthMm - 15) {
        computedWaste.push({
          x: maxX,
          y: minY,
          w: lengthMm - maxX,
          h: rowHeight,
        });
      }
    }

    // Check if there is a large useful remnant below/above the rows
    const largeUsefulRemnant = sheet.remnants.find(
      (r) => r.isUseful && r.yMm >= maxUsedY - 5 && r.areaM2 >= 0.24,
    );

    if (largeUsefulRemnant) {
      primCut = {
        axis: 'horizontal',
        coordinateMm: largeUsefulRemnant.yMm,
        label: `✂ 1er CORTE: Y = ${Math.round(largeUsefulRemnant.yMm)} mm`,
      };
    } else if (computedStrips.length > 0) {
      const firstStrip = computedStrips[0]!;
      primCut = {
        axis: 'horizontal',
        coordinateMm: firstStrip.maxY,
        label: `✂ 1er CORTE: Y = ${Math.round(firstStrip.maxY)} mm`,
      };
    }
  } else {
    // VERTICAL STRIPS (Layout in Columns)
    const sortedXKeys = [...xClusters.keys()].sort((a, b) => a - b);
    let maxUsedX = 0;

    for (const xKey of sortedXKeys) {
      const colPieces = xClusters.get(xKey)!;
      const minX = Math.min(...colPieces.map((p) => p.xMm));
      const maxX = Math.max(...colPieces.map((p) => p.xMm + p.lengthMm));
      const minY = Math.min(...colPieces.map((p) => p.yMm));
      const maxY = Math.max(...colPieces.map((p) => p.yMm + p.widthMm));
      const colWidth = maxX - minX;

      if (maxX > maxUsedX) maxUsedX = maxX;

      computedStrips.push({
        axis: 'vertical',
        minX,
        maxX,
        minY,
        maxY,
        cutCoordinate: maxX,
      });

      // Horizontal cross cuts between pieces in this vertical column
      const sortedPiecesInCol = [...colPieces].sort((a, b) => a.yMm - b.yMm);
      for (const p of sortedPiecesInCol) {
        const cutY = p.yMm + p.widthMm;
        computedCrossCuts.push({
          x1: minX,
          y1: cutY,
          x2: maxX,
          y2: cutY,
        });

        // If piece length is less than column width, there is a waste strip to the right of it
        if (p.lengthMm < colWidth - 1) {
          computedWaste.push({
            x: p.xMm + p.lengthMm,
            y: p.yMm,
            w: colWidth - p.lengthMm,
            h: p.widthMm,
          });
        }
      }

      // Leftover at the bottom of the column
      if (maxY < widthMm - 15) {
        computedWaste.push({
          x: minX,
          y: maxY,
          w: colWidth,
          h: widthMm - maxY,
        });
      }
    }

    // Check if there is a large useful remnant to the right
    const largeUsefulRemnant = sheet.remnants.find(
      (r) => r.isUseful && r.xMm >= maxUsedX - 5 && r.areaM2 >= 0.24,
    );

    if (largeUsefulRemnant) {
      primCut = {
        axis: 'vertical',
        coordinateMm: largeUsefulRemnant.xMm,
        label: `✂ 1er CORTE: X = ${Math.round(largeUsefulRemnant.xMm)} mm`,
      };
    } else if (computedStrips.length > 0) {
      const firstStrip = computedStrips[0]!;
      primCut = {
        axis: 'vertical',
        coordinateMm: firstStrip.maxX,
        label: `✂ 1er CORTE: X = ${Math.round(firstStrip.maxX)} mm`,
      };
    }
  }

  return {
    layoutDirection: isHorizontal ? 'horizontal' : 'vertical',
    strips: computedStrips,
    crossCuts: computedCrossCuts,
    wasteBlocks: computedWaste,
    primaryCut: primCut,
  };
}
