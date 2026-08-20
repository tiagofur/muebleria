/**
 * 2D Guillotine Optimization Engine for Board Sheet Cutting.
 *
 * Implements multi-heuristic guillotine packing with strict saw kerf,
 * 4-sided trim margins, grain direction, edge band deduction, and remnant detection.
 */

import type { MaterialBoard, ProductionCutRow } from '../types';
import type {
  CutInstruction,
  CutPlanConfig,
  CutPlanMaterialStat,
  CutPlanPlacedPiece,
  CutPlanRemnant,
  CutPlanSheet,
  CutPlanStats,
} from './types';
import { DEFAULT_CUT_PLAN_CONFIG } from './types';
import { optimizeSingleMaterialNesting } from './nesting';
import { unrollRows, type PieceToPlace, type PlacementResult } from './pieces';

interface FreeRect {
  x: number;
  y: number;
  length: number; // Dimension along board length (X)
  width: number;  // Dimension along board width (Y)
}

/**
 * Packs pieces onto a single sheet using Guillotine Best-Fit with axis-aligned splits.
 */
function packSingleSheetGuillotineBestFit(
  piecesRemaining: PieceToPlace[],
  sheetIndex: number,
  sheetLengthMm: number,
  sheetWidthMm: number,
  config: CutPlanConfig,
  materialCode: string,
  materialName: string,
  thicknessMm?: number,
  preferVerticalSplit = true,
): { sheet: PlacementResult; remaining: PieceToPlace[] } {
  const kerf = config.sawKerfMm;
  const trim = config.trim;

  const minX = trim.leftMm;
  const minY = trim.bottomMm;
  const usableLength = Math.max(0, sheetLengthMm - trim.leftMm - trim.rightMm);
  const usableWidth = Math.max(0, sheetWidthMm - trim.topMm - trim.bottomMm);

  const freeRects: FreeRect[] = [
    {
      x: minX,
      y: minY,
      length: usableLength,
      width: usableWidth,
    },
  ];

  const placedPieces: CutPlanPlacedPiece[] = [];
  const notPlaced: PieceToPlace[] = [];
  let cutSequence = 0;

  for (const piece of piecesRemaining) {
    let bestRectIdx = -1;
    let bestFitScore = Number.POSITIVE_INFINITY;
    let bestRotated = false;
    let placedL = piece.length;
    let placedW = piece.width;

    for (let r = 0; r < freeRects.length; r++) {
      const rect = freeRects[r]!;

      // Normal orientation
      if (piece.length <= rect.length && piece.width <= rect.width) {
        const remainingArea = rect.length * rect.width - piece.length * piece.width;
        if (remainingArea < bestFitScore) {
          bestFitScore = remainingArea;
          bestRectIdx = r;
          bestRotated = false;
          placedL = piece.length;
          placedW = piece.width;
        }
      }

      // Rotated orientation (only if grain is 0 / no grain)
      if (
        config.allowRotationNoGrain &&
        piece.grain === 0 &&
        piece.width <= rect.length &&
        piece.length <= rect.width
      ) {
        const remainingArea = rect.length * rect.width - piece.width * piece.length;
        if (remainingArea < bestFitScore) {
          bestFitScore = remainingArea;
          bestRectIdx = r;
          bestRotated = true;
          placedL = piece.width;
          placedW = piece.length;
        }
      }
    }

    if (bestRectIdx >= 0) {
      const rect = freeRects.splice(bestRectIdx, 1)[0]!;
      cutSequence++;

      placedPieces.push({
        id: `${piece.id}-s${sheetIndex}`,
        partCode: piece.originalRow.partCode || `P${cutSequence}`,
        partName: piece.originalRow.partName || piece.originalRow.description || 'Pieza',
        moduleCode: piece.originalRow.moduleCode || '',
        labelRef: piece.originalRow.labelRef || piece.id,
        materialName: piece.originalRow.materialName || materialName,
        materialCode: piece.originalRow.materialCode || materialCode,
        xMm: rect.x,
        yMm: rect.y,
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
        cutSequenceNumber: cutSequence,
        status: 'pending',
      });

      // Guillotine Split of the remaining free rectangle into 2 sub-rectangles
      const remL = rect.length - placedL - kerf;
      const remW = rect.width - placedW - kerf;

      if (preferVerticalSplit) {
        // Cut along length first (X split)
        if (remL > 0) {
          freeRects.push({
            x: rect.x + placedL + kerf,
            y: rect.y,
            length: remL,
            width: rect.width,
          });
        }
        if (remW > 0) {
          freeRects.push({
            x: rect.x,
            y: rect.y + placedW + kerf,
            length: placedL,
            width: remW,
          });
        }
      } else {
        // Cut along width first (Y split)
        if (remW > 0) {
          freeRects.push({
            x: rect.x,
            y: rect.y + placedW + kerf,
            length: rect.length,
            width: remW,
          });
        }
        if (remL > 0) {
          freeRects.push({
            x: rect.x + placedL + kerf,
            y: rect.y,
            length: remL,
            width: placedW,
          });
        }
      }
    } else {
      notPlaced.push(piece);
    }
  }

  // Convert remaining free rectangles to remnants
  const remnants: CutPlanRemnant[] = freeRects
    .filter((r) => r.length > 5 && r.width > 5)
    .map((r, idx) => {
      const isUseful =
        ((r.length >= config.minRemnantLengthMm && r.width >= config.minRemnantWidthMm) ||
         (r.length >= config.minRemnantWidthMm && r.width >= config.minRemnantLengthMm)) &&
        (r.length * r.width) / 1_000_000 >= 0.24;
      return {
        id: `rem-s${sheetIndex}-${idx + 1}`,
        sheetIndex,
        xMm: r.x,
        yMm: r.y,
        lengthMm: r.length,
        widthMm: r.width,
        areaM2: (r.length * r.width) / 1_000_000,
        materialName,
        materialCode,
        isUseful,
      };
    })
    .sort((a, b) => b.areaM2 - a.areaM2);

  // Generate step-by-step cutting instructions
  const instructions = generateCuttingInstructions(placedPieces, config, sheetLengthMm, sheetWidthMm);

  return {
    sheet: {
      pieces: placedPieces,
      remnants,
      instructions,
      sheetIndex,
      sheetLengthMm,
      sheetWidthMm,
      materialCode,
      materialName,
      thicknessMm,
    },
    remaining: notPlaced,
  };
}

/**
 * Packs pieces onto a sheet using Strip / Shelf Guillotine layout (longitudinal rips).
 */
function packSingleSheetStrip(
  piecesRemaining: PieceToPlace[],
  sheetIndex: number,
  sheetLengthMm: number,
  sheetWidthMm: number,
  config: CutPlanConfig,
  materialCode: string,
  materialName: string,
  thicknessMm?: number,
): { sheet: PlacementResult; remaining: PieceToPlace[] } {
  const kerf = config.sawKerfMm;
  const trim = config.trim;

  const minX = trim.leftMm;
  const minY = trim.bottomMm;
  const maxX = sheetLengthMm - trim.rightMm;
  const maxY = sheetWidthMm - trim.topMm;

  let currentY = minY;
  let cutSequence = 0;
  let stripIdx = 0;

  const placedPieces: CutPlanPlacedPiece[] = [];
  const placedIds = new Set<string>();
  const remnants: CutPlanRemnant[] = [];

  while (currentY < maxY) {
    const unplaced = piecesRemaining.filter((p) => !placedIds.has(p.id));
    if (unplaced.length === 0) break;

    // Pick tallest piece that fits in remaining Y space
    let bestSeedPiece: PieceToPlace | null = null;
    let bestSeedRotated = false;
    let bestSeedWidth = 0;

    for (const p of unplaced) {
      if (p.width <= maxY - currentY && p.length <= maxX - minX) {
        if (p.width > bestSeedWidth) {
          bestSeedWidth = p.width;
          bestSeedPiece = p;
          bestSeedRotated = false;
        }
      }
      if (
        config.allowRotationNoGrain &&
        p.grain === 0 &&
        p.length <= maxY - currentY &&
        p.width <= maxX - minX
      ) {
        if (p.length > bestSeedWidth) {
          bestSeedWidth = p.length;
          bestSeedPiece = p;
          bestSeedRotated = true;
        }
      }
    }

    if (!bestSeedPiece) {
      // No more pieces fit in vertical space
      break;
    }

    stripIdx++;
    const stripHeight = bestSeedWidth;
    let currentX = minX;

    // First, place the seed piece
    placedIds.add(bestSeedPiece.id);
    cutSequence++;
    const seedL = bestSeedRotated ? bestSeedPiece.width : bestSeedPiece.length;
    const seedW = bestSeedRotated ? bestSeedPiece.length : bestSeedPiece.width;

    placedPieces.push({
      id: `${bestSeedPiece.id}-s${sheetIndex}`,
      partCode: bestSeedPiece.originalRow.partCode || `P${cutSequence}`,
      partName: bestSeedPiece.originalRow.partName || bestSeedPiece.originalRow.description || 'Pieza',
      moduleCode: bestSeedPiece.originalRow.moduleCode || '',
      labelRef: bestSeedPiece.originalRow.labelRef || bestSeedPiece.id,
      materialName: bestSeedPiece.originalRow.materialName || materialName,
      materialCode: bestSeedPiece.originalRow.materialCode || materialCode,
      xMm: currentX,
      yMm: currentY,
      lengthMm: seedL,
      widthMm: seedW,
      originalLengthMm: bestSeedPiece.originalRow.lengthMm,
      originalWidthMm: bestSeedPiece.originalRow.widthMm,
      grain: bestSeedPiece.grain,
      rotated: bestSeedRotated,
      L1: bestSeedPiece.originalRow.L1,
      L2: bestSeedPiece.originalRow.L2,
      W1: bestSeedPiece.originalRow.W1,
      W2: bestSeedPiece.originalRow.W2,
      edgeBandCode: bestSeedPiece.originalRow.edgeBandCode,
      edgeBandName: bestSeedPiece.originalRow.edgeBandName,
      edgeBandThicknessMm: bestSeedPiece.originalRow.edgeBandThicknessMm,
      thicknessMm: bestSeedPiece.originalRow.thicknessMm ?? thicknessMm,
      sheetIndex,
      stripIndex: stripIdx,
      cutSequenceNumber: cutSequence,
      status: 'pending',
    });

    currentX += seedL + kerf;

    // Fill the rest of the horizontal strip with pieces that fit height <= stripHeight
    let foundNextInStrip = true;
    while (foundNextInStrip && currentX < maxX) {
      foundNextInStrip = false;
      const candidates = piecesRemaining.filter((p) => !placedIds.has(p.id));

      let bestCand: PieceToPlace | null = null;
      let candRotated = false;
      let candL = 0;
      let candW = 0;
      let bestFit = -1;

      for (const p of candidates) {
        // Normal
        if (p.length <= maxX - currentX && p.width <= stripHeight) {
          const score = p.width; // closer to stripHeight is better
          if (score > bestFit) {
            bestFit = score;
            bestCand = p;
            candRotated = false;
            candL = p.length;
            candW = p.width;
          }
        }
        // Rotated
        if (
          config.allowRotationNoGrain &&
          p.grain === 0 &&
          p.width <= maxX - currentX &&
          p.length <= stripHeight
        ) {
          const score = p.length;
          if (score > bestFit) {
            bestFit = score;
            bestCand = p;
            candRotated = true;
            candL = p.width;
            candW = p.length;
          }
        }
      }

      if (bestCand) {
        placedIds.add(bestCand.id);
        cutSequence++;
        placedPieces.push({
          id: `${bestCand.id}-s${sheetIndex}`,
          partCode: bestCand.originalRow.partCode || `P${cutSequence}`,
          partName: bestCand.originalRow.partName || bestCand.originalRow.description || 'Pieza',
          moduleCode: bestCand.originalRow.moduleCode || '',
          labelRef: bestCand.originalRow.labelRef || bestCand.id,
          materialName: bestCand.originalRow.materialName || materialName,
          materialCode: bestCand.originalRow.materialCode || materialCode,
          xMm: currentX,
          yMm: currentY,
          lengthMm: candL,
          widthMm: candW,
          originalLengthMm: bestCand.originalRow.lengthMm,
          originalWidthMm: bestCand.originalRow.widthMm,
          grain: bestCand.grain,
          rotated: candRotated,
          L1: bestCand.originalRow.L1,
          L2: bestCand.originalRow.L2,
          W1: bestCand.originalRow.W1,
          W2: bestCand.originalRow.W2,
          edgeBandCode: bestCand.originalRow.edgeBandCode,
          edgeBandName: bestCand.originalRow.edgeBandName,
          edgeBandThicknessMm: bestCand.originalRow.edgeBandThicknessMm,
          thicknessMm: bestCand.originalRow.thicknessMm ?? thicknessMm,
          sheetIndex,
          stripIndex: stripIdx,
          cutSequenceNumber: cutSequence,
          status: 'pending',
        });

        currentX += candL + kerf;
        foundNextInStrip = true;
      }
    }

    // Leftover in this strip at the right end
    if (maxX - currentX > 10) {
      const remL = maxX - currentX;
      const remW = stripHeight;
      const isUseful =
        ((remL >= config.minRemnantLengthMm && remW >= config.minRemnantWidthMm) ||
         (remL >= config.minRemnantWidthMm && remW >= config.minRemnantLengthMm)) &&
        (remL * remW) / 1_000_000 >= 0.24;
      remnants.push({
        id: `rem-s${sheetIndex}-str${stripIdx}`,
        sheetIndex,
        xMm: currentX,
        yMm: currentY,
        lengthMm: remL,
        widthMm: remW,
        areaM2: (remL * remW) / 1_000_000,
        materialName,
        materialCode,
        isUseful,
      });
    }

    currentY += stripHeight + kerf;
  }

  // Leftover at the top of the board
  if (maxY - currentY > 10) {
    const remL = maxX - minX;
    const remW = maxY - currentY;
    const isUseful =
      ((remL >= config.minRemnantLengthMm && remW >= config.minRemnantWidthMm) ||
       (remL >= config.minRemnantWidthMm && remW >= config.minRemnantLengthMm)) &&
      (remL * remW) / 1_000_000 >= 0.24;
    remnants.push({
      id: `rem-s${sheetIndex}-top`,
      sheetIndex,
      xMm: minX,
      yMm: currentY,
      lengthMm: remL,
      widthMm: remW,
      areaM2: (remL * remW) / 1_000_000,
      materialName,
      materialCode,
      isUseful,
    });
  }

  const notPlaced = piecesRemaining.filter((p) => !placedIds.has(p.id));
  const instructions = generateCuttingInstructions(placedPieces, config, sheetLengthMm, sheetWidthMm);

  return {
    sheet: {
      pieces: placedPieces,
      remnants,
      instructions,
      sheetIndex,
      sheetLengthMm,
      sheetWidthMm,
      materialCode,
      materialName,
      thicknessMm,
    },
    remaining: notPlaced,
  };
}

function generateCuttingInstructions(
  pieces: readonly CutPlanPlacedPiece[],
  config: CutPlanConfig,
  sheetLengthMm: number,
  sheetWidthMm: number,
): CutInstruction[] {
  const instructions: CutInstruction[] = [];
  let step = 1;

  // Phase 1: Trims / Refilados
  const trim = config.trim;
  if (trim.topMm > 0 || trim.bottomMm > 0 || trim.leftMm > 0 || trim.rightMm > 0) {
    instructions.push({
      step: step++,
      phase: 1,
      cutType: 'trim',
      description: `Refilar bordes perimetrales: Sup=${trim.topMm}mm, Inf=${trim.bottomMm}mm, Izq=${trim.leftMm}mm, Der=${trim.rightMm}mm`,
      positionMm: 0,
      lengthMm: sheetLengthMm + sheetWidthMm,
    });
  }

  // Phase 2: Rips / Tiras longitudinales
  // Group pieces by Y position
  const ySet = [...new Set(pieces.map((p) => p.yMm))].sort((a, b) => a - b);
  for (let i = 0; i < ySet.length; i++) {
    const y = ySet[i]!;
    const rowPieces = pieces.filter((p) => p.yMm === y);
    const maxW = Math.max(...rowPieces.map((p) => p.widthMm));
    instructions.push({
      step: step++,
      phase: 2,
      cutType: 'rip',
      description: `Corte longitudinal tira #${i + 1} a Y=${y}mm (ancho tira: ${maxW}mm, ${rowPieces.length} piezas)`,
      positionMm: y + maxW,
      lengthMm: sheetLengthMm,
    });

    // Phase 3: Cross cuts / Troceado
    for (const p of rowPieces) {
      instructions.push({
        step: step++,
        phase: 3,
        cutType: 'cross',
        description: `Trocear pieza [${p.partCode}] ${p.partName} a X=${p.xMm + p.lengthMm}mm (${p.lengthMm}×${p.widthMm}mm)`,
        positionMm: p.xMm + p.lengthMm,
        lengthMm: p.widthMm,
      });
    }
  }

  return instructions;
}

/**
 * Optimizes a list of cut rows for a single material across multiple sheets.
 */
function optimizeSingleMaterial(
  materialRows: readonly ProductionCutRow[],
  sheetLengthMm: number,
  sheetWidthMm: number,
  materialCode: string,
  materialName: string,
  thicknessMm: number | undefined,
  config: CutPlanConfig,
): PlacementResult[] {
  if (config.cutStrategy === 'cnc-nesting') {
    return optimizeSingleMaterialNesting(
      materialRows,
      sheetLengthMm,
      sheetWidthMm,
      materialCode,
      materialName,
      thicknessMm,
      config,
    );
  }

  const unrolled = unrollRows(materialRows, config.deductEdgeBand ?? true);
  // Sort descending by area and longer dimension
  unrolled.sort((a, b) => b.length * b.width - a.length * a.width || b.length - a.length);

  // Strategy A: Best Fit with Vertical Splits
  const sheetsBestFitV: PlacementResult[] = [];
  let remainingA = [...unrolled];
  let sheetIdxA = 0;
  while (remainingA.length > 0) {
    const res = packSingleSheetGuillotineBestFit(
      remainingA,
      sheetIdxA,
      sheetLengthMm,
      sheetWidthMm,
      config,
      materialCode,
      materialName,
      thicknessMm,
      true,
    );
    if (res.sheet.pieces.length === 0) {
      // Piece larger than usable sheet
      break;
    }
    sheetsBestFitV.push(res.sheet);
    remainingA = res.remaining;
    sheetIdxA++;
  }

  // Strategy B: Best Fit with Horizontal Splits
  const sheetsBestFitH: PlacementResult[] = [];
  let remainingB = [...unrolled];
  let sheetIdxB = 0;
  while (remainingB.length > 0) {
    const res = packSingleSheetGuillotineBestFit(
      remainingB,
      sheetIdxB,
      sheetLengthMm,
      sheetWidthMm,
      config,
      materialCode,
      materialName,
      thicknessMm,
      false,
    );
    if (res.sheet.pieces.length === 0) break;
    sheetsBestFitH.push(res.sheet);
    remainingB = res.remaining;
    sheetIdxB++;
  }

  // Strategy C: Strip / Shelf packing
  const sheetsStrip: PlacementResult[] = [];
  let remainingC = [...unrolled];
  let sheetIdxC = 0;
  while (remainingC.length > 0) {
    const res = packSingleSheetStrip(
      remainingC,
      sheetIdxC,
      sheetLengthMm,
      sheetWidthMm,
      config,
      materialCode,
      materialName,
      thicknessMm,
    );
    if (res.sheet.pieces.length === 0) break;
    sheetsStrip.push(res.sheet);
    remainingC = res.remaining;
    sheetIdxC++;
  }

  // Pick the winning strategy: lowest sheet count, then highest useful remnants
  const candidates = [sheetsBestFitV, sheetsBestFitH, sheetsStrip].filter(
    (cand) => cand.length > 0,
  );

  candidates.sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    const remA = a.reduce(
      (sum, s) =>
        sum +
        s.remnants
          .filter((r) => r.isUseful)
          .reduce((rsum, r) => rsum + r.areaM2, 0),
      0,
    );
    const remB = b.reduce(
      (sum, s) =>
        sum +
        s.remnants
          .filter((r) => r.isUseful)
          .reduce((rsum, r) => rsum + r.areaM2, 0),
      0,
    );
    return remB - remA; // More useful remnants is better
  });

  return candidates[0] ?? [];
}

/**
 * Builds full CutPlanSheet models from placement results.
 */
function buildSheetModels(placements: readonly PlacementResult[]): CutPlanSheet[] {
  return placements.map((p, idx) => {
    const grossSheetAreaM2 = (p.sheetLengthMm * p.sheetWidthMm) / 1_000_000;
    let netPiecesAreaM2 = 0;
    for (const piece of p.pieces) {
      netPiecesAreaM2 += (piece.lengthMm * piece.widthMm) / 1_000_000;
    }

    let usableRemnantAreaM2 = 0;
    for (const r of p.remnants) {
      if (r.isUseful) usableRemnantAreaM2 += r.areaM2;
    }

    const wasteAreaM2 = Math.max(0, grossSheetAreaM2 - netPiecesAreaM2 - usableRemnantAreaM2);
    const wastePercent =
      grossSheetAreaM2 > 0
        ? Math.min(100, Math.max(0, (wasteAreaM2 / grossSheetAreaM2) * 100))
        : 0;
    const yieldPercent =
      grossSheetAreaM2 > 0
        ? Math.min(100, Math.max(0, (netPiecesAreaM2 / grossSheetAreaM2) * 100))
        : 0;

    return {
      sheetIndex: idx,
      strategy: p.strategy ?? 'saw-guillotine',
      materialId: p.pieces[0]?.materialCode,
      materialCode: p.materialCode,
      materialName: p.materialName,
      sheetWidthMm: p.sheetWidthMm,
      sheetLengthMm: p.sheetLengthMm,
      thicknessMm: p.thicknessMm,
      pieces: p.pieces,
      remnants: p.remnants,
      instructions: p.instructions,
      netPiecesAreaM2,
      grossSheetAreaM2,
      usableRemnantAreaM2,
      wasteAreaM2,
      wastePercent: Math.round(wastePercent * 10) / 10,
      yieldPercent: Math.round(yieldPercent * 10) / 10,
    };
  });
}

/**
 * Main 2D Guillotine Cut Plan Optimizer function.
 */
export function optimizeCutPlan(
  projectId: string,
  cutRows: readonly ProductionCutRow[],
  catalogMaterials: readonly MaterialBoard[],
  config: CutPlanConfig = DEFAULT_CUT_PLAN_CONFIG,
  projectName?: string,
  version = 1,
): {
  id: string;
  projectId: string;
  projectName?: string;
  generatedAt: string;
  version: number;
  isFrozen: boolean;
  config: CutPlanConfig;
  sheets: readonly CutPlanSheet[];
  stats: CutPlanStats;
  usefulRemnants: readonly CutPlanRemnant[];
} {
  const materialsByCode = new Map(catalogMaterials.map((m) => [m.code, m]));
  const materialsByName = new Map(catalogMaterials.map((m) => [m.name, m]));

  // Group cut rows by material
  const byMaterial = new Map<string, ProductionCutRow[]>();
  for (const row of cutRows) {
    const key = row.materialName || row.materialCode || 'Sin material';
    const arr = byMaterial.get(key) ?? [];
    arr.push(row);
    byMaterial.set(key, arr);
  }

  const allPlacementResults: PlacementResult[] = [];
  const materialStats: CutPlanMaterialStat[] = [];

  for (const [matKey, rows] of byMaterial) {
    const catMat = materialsByName.get(matKey) || materialsByCode.get(matKey);
    const sheetLengthMm = catMat && catMat.lengthMm > 0 ? catMat.lengthMm : 2440;
    const sheetWidthMm = catMat && catMat.widthMm > 0 ? catMat.widthMm : 1830;
    const thicknessMm = catMat?.thicknessMm ?? rows[0]?.thicknessMm;
    const matCode = catMat?.code || rows[0]?.materialCode || matKey;
    const matName = catMat?.name || rows[0]?.materialName || matKey;

    const placements = optimizeSingleMaterial(
      rows,
      sheetLengthMm,
      sheetWidthMm,
      matCode,
      matName,
      thicknessMm,
      config,
    );

    allPlacementResults.push(...placements);

    let matNetArea = 0;
    let matPiecesCount = 0;
    for (const r of rows) {
      const q = Math.max(1, r.quantity);
      matPiecesCount += q;
      matNetArea += (r.lengthMm * r.widthMm * q) / 1_000_000;
    }

    const matGrossArea = (placements.length * sheetLengthMm * sheetWidthMm) / 1_000_000;
    let matUsefulRemnantsCount = 0;
    let matUsefulRemnantsArea = 0;

    for (const p of placements) {
      for (const rem of p.remnants) {
        if (rem.isUseful) {
          matUsefulRemnantsCount++;
          matUsefulRemnantsArea += rem.areaM2;
        }
      }
    }

    const matWasteArea = Math.max(0, matGrossArea - matNetArea - matUsefulRemnantsArea);
    const matWastePct =
      matGrossArea > 0 ? Math.min(100, Math.max(0, (matWasteArea / matGrossArea) * 100)) : 0;
    const matYieldPct =
      matGrossArea > 0 ? Math.min(100, Math.max(0, (matNetArea / matGrossArea) * 100)) : 0;

    materialStats.push({
      materialCode: matCode,
      materialName: matName,
      sheetsNeeded: placements.length,
      piecesCount: matPiecesCount,
      netAreaM2: Math.round(matNetArea * 100) / 100,
      grossAreaM2: Math.round(matGrossArea * 100) / 100,
      wastePercent: Math.round(matWastePct * 10) / 10,
      yieldPercent: Math.round(matYieldPct * 10) / 10,
      usefulRemnantsCount: matUsefulRemnantsCount,
      usefulRemnantsAreaM2: Math.round(matUsefulRemnantsArea * 100) / 100,
    });
  }

  const sheets = buildSheetModels(allPlacementResults);

  // Global aggregate stats
  let totalGrossAreaM2 = 0;
  let totalNetPiecesAreaM2 = 0;
  let totalUsefulRemnantsAreaM2 = 0;
  let totalPieces = 0;
  const usefulRemnants: CutPlanRemnant[] = [];

  for (const s of sheets) {
    totalGrossAreaM2 += s.grossSheetAreaM2;
    totalNetPiecesAreaM2 += s.netPiecesAreaM2;
    totalUsefulRemnantsAreaM2 += s.usableRemnantAreaM2;
    totalPieces += s.pieces.length;
    for (const rem of s.remnants) {
      if (rem.isUseful) usefulRemnants.push(rem);
    }
  }

  const totalWasteAreaM2 = Math.max(
    0,
    totalGrossAreaM2 - totalNetPiecesAreaM2 - totalUsefulRemnantsAreaM2,
  );
  const globalWastePercent =
    totalGrossAreaM2 > 0
      ? Math.min(100, Math.max(0, (totalWasteAreaM2 / totalGrossAreaM2) * 100))
      : 0;
  const globalYieldPercent =
    totalGrossAreaM2 > 0
      ? Math.min(100, Math.max(0, (totalNetPiecesAreaM2 / totalGrossAreaM2) * 100))
      : 0;

  const stats: CutPlanStats = {
    totalSheets: sheets.length,
    totalPieces,
    totalGrossAreaM2: Math.round(totalGrossAreaM2 * 100) / 100,
    totalNetPiecesAreaM2: Math.round(totalNetPiecesAreaM2 * 100) / 100,
    totalUsefulRemnantsAreaM2: Math.round(totalUsefulRemnantsAreaM2 * 100) / 100,
    totalWasteAreaM2: Math.round(totalWasteAreaM2 * 100) / 100,
    globalWastePercent: Math.round(globalWastePercent * 10) / 10,
    globalYieldPercent: Math.round(globalYieldPercent * 10) / 10,
    byMaterial: materialStats.sort((a, b) => a.materialCode.localeCompare(b.materialCode, 'es')),
  };

  return {
    id: `cutplan-${projectId}-${Date.now()}`,
    projectId,
    projectName,
    generatedAt: new Date().toISOString(),
    version,
    isFrozen: false,
    config,
    sheets,
    stats,
    usefulRemnants,
  };
}
