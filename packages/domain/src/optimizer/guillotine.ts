/**
 * 2D Guillotine Optimization Engine for Board Sheet Cutting.
 *
 * Implements multi-heuristic guillotine packing with strict saw kerf,
 * 4-sided trim margins, grain direction, edge band deduction, and remnant detection.
 *
 * Since #650 PR 2, the heuristics register their real divisions while packing
 * (CutProgramSheetBuilder) and every accepted candidate carries the validated
 * CutProgramInput of the placement that candidate produced. The program is
 * never reconstructed from piece coordinates after the fact.
 */

import type { MaterialBoard, ProductionCutRow } from '../types';
import { ValidationError } from '../errors';
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
import {
  checkExpectedPieces,
  cutProgramRectMatches,
  executeCutProgram,
  type CutProgramInput,
  type CutProgramRect,
} from './cutProgram';
import {
  CutProgramSheetBuilder,
  registerTrimDivisions,
  type RegisteredRegion,
} from './cutProgramBuilder';
import { optimizeSingleMaterialNesting } from './nesting';
import { isUsefulRemnant, unrollRows, type PieceToPlace, type PlacementResult } from './pieces';

/**
 * One source of truth for remnants (#654 R3): derives the sheet remnant list
 * from the program's own terminal regions. Useful leftovers are the
 * 'remnant'-kind terminals (classified by the shared isUsefulRemnant policy
 * when the program registered them); waste leftovers above the historical
 * presentation threshold stay visible for continuity. Trim garbage stays out
 * of the presentation list while the program still accounts for it. Candidate
 * comparison and result statistics consume this same list, so program and
 * metrics cannot disagree. No coordinate reconstruction, no duplicated
 * usefulness rules, no duplicates.
 */
function deriveSheetRemnants(
  cutProgram: CutProgramInput,
  trimRegionIds: ReadonlySet<string>,
  sheetIndex: number,
  materialCode: string,
  materialName: string,
  presentationMinMm: number,
): CutPlanRemnant[] {
  const rectByRegion = new Map(cutProgram.regions.map((region) => [region.regionId, region.rect]));
  const derived: CutPlanRemnant[] = [];
  for (const terminal of cutProgram.terminals) {
    if (terminal.kind === 'piece' || trimRegionIds.has(terminal.regionId)) {
      continue;
    }
    const rect = rectByRegion.get(terminal.regionId);
    if (!rect) {
      continue;
    }
    const isUseful = terminal.kind === 'remnant';
    if (!isUseful && (rect.lengthMm <= presentationMinMm || rect.widthMm <= presentationMinMm)) {
      continue;
    }
    derived.push({
      id: `rem-s${sheetIndex}-${derived.length + 1}`,
      sheetIndex,
      xMm: rect.xMm,
      yMm: rect.yMm,
      lengthMm: rect.lengthMm,
      widthMm: rect.widthMm,
      areaM2: (rect.lengthMm * rect.widthMm) / 1_000_000,
      materialName,
      materialCode,
      isUseful,
    });
  }
  return derived.sort((a, b) => b.areaM2 - a.areaM2);
}

/**
 * Packs pieces onto a single sheet using Guillotine Best-Fit with axis-aligned splits.
 *
 * The two separations that isolate each piece are registered as real program
 * divisions while packing: variant `preferVerticalSplit` separates on X first
 * (piece column with a full-height rest to the right, then the piece within
 * the column), the other variant separates on Y first (piece band with a
 * full-width rest below, then the piece within the band). The free rects the
 * heuristic keeps iterating on ARE the program regions those divisions
 * produce, so placement and program share one geometry source.
 *
 * @internal Exported for bounded tests of the packing instrumentation only.
 */
export function packSingleSheetGuillotineBestFit(
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

  const program = new CutProgramSheetBuilder({
    boardRegionId: 'board',
    x: 0,
    y: 0,
    length: sheetLengthMm,
    width: sheetWidthMm,
  });
  const usableRegion = registerTrimDivisions(program, trim, kerf);

  const freeRects: RegisteredRegion[] = [usableRegion];

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
      const placementRef = `${piece.id}-s${sheetIndex}`;

      placedPieces.push({
        id: placementRef,
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

      // Guillotine split of the consumed free rectangle, registered as the
      // real program divisions. Variant V splits on X first, variant H on Y
      // first; the rests become the next free rects with their program
      // identity. Exact fits register no pass; a remainder smaller than the
      // blade band fails with an identified non-representable placement.
      const firstAxis = preferVerticalSplit ? 'x' : 'y';
      const secondAxis = preferVerticalSplit ? 'y' : 'x';
      const first = program.divide({
        parentRegionId: rect.regionId,
        axis: firstAxis,
        keptExtentMm: firstAxis === 'x' ? placedL : placedW,
        kerfMm: kerf,
        cutId: `place-${cutSequence}-1`,
        keptRegionId: `piece:${placementRef}:column`,
        pieceRef: placementRef,
      });
      if (first.rest) {
        freeRects.push(first.rest);
      }
      const second = program.divide({
        parentRegionId: first.kept.regionId,
        axis: secondAxis,
        keptExtentMm: secondAxis === 'x' ? placedL : placedW,
        kerfMm: kerf,
        cutId: `place-${cutSequence}-2`,
        keptRegionId: `piece:${placementRef}`,
        pieceRef: placementRef,
      });
      if (second.rest) {
        freeRects.push(second.rest);
      }
      program.markPieceTerminal(second.kept.regionId, placementRef);
    } else {
      notPlaced.push(piece);
    }
  }

  // Every unconsumed region is a real terminal in the program — including
  // leftovers the presentation list omits for readability.
  for (const freeRect of freeRects) {
    program.markLeftoverTerminal(freeRect, config);
  }

  const cutProgram = program.build();
  const remnants = deriveSheetRemnants(
    cutProgram,
    program.getLiberatedWasteRegionIds(),
    sheetIndex,
    materialCode,
    materialName,
    5,
  );

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
      cutProgram,
    },
    remaining: notPlaced,
  };
}

/**
 * Packs pieces onto a sheet using Strip / Shelf Guillotine layout (longitudinal rips).
 *
 * Program registration happens while packing: each strip is separated from the
 * region above it with a real kerf pass; each in-strip placement separates its
 * column along X and then the piece within the column along Y — that second
 * pass is the explicit recut required when a piece is narrower than its strip
 * (e.g. a 210 mm piece in a 320 mm strip leaves a 106 mm solid remainder plus
 * the blade). Strip leftovers and the final top leftover are real terminals,
 * never erased to balance figures.
 *
 * @internal Exported for bounded tests of the packing instrumentation only.
 */
export function packSingleSheetStrip(
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

  const program = new CutProgramSheetBuilder({
    boardRegionId: 'board',
    x: 0,
    y: 0,
    length: sheetLengthMm,
    width: sheetWidthMm,
  });
  let sheetRestRegion: RegisteredRegion | null = registerTrimDivisions(program, trim, kerf);

  let currentY = minY;
  let cutSequence = 0;
  let stripIdx = 0;

  const placedPieces: CutPlanPlacedPiece[] = [];
  const placedIds = new Set<string>();

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

    // Separate the strip from the region above with a real kerf pass.
    const stripSep = program.divide({
      parentRegionId: sheetRestRegion!.regionId,
      axis: 'y',
      keptExtentMm: stripHeight,
      kerfMm: kerf,
      cutId: `strip-${stripIdx}`,
      keptRegionId: `strip-${stripIdx}:body`,
    });
    let stripRestRegion: RegisteredRegion | null = stripSep.kept;
    sheetRestRegion = stripSep.rest;

    const placeOnStrip = (piece: PieceToPlace, rotated: boolean, candL: number, candW: number, x: number): void => {
      cutSequence++;
      placedIds.add(piece.id);
      const placementRef = `${piece.id}-s${sheetIndex}`;

      placedPieces.push({
        id: placementRef,
        partCode: piece.originalRow.partCode || `P${cutSequence}`,
        partName: piece.originalRow.partName || piece.originalRow.description || 'Pieza',
        moduleCode: piece.originalRow.moduleCode || '',
        labelRef: piece.originalRow.labelRef || piece.id,
        materialName: piece.originalRow.materialName || materialName,
        materialCode: piece.originalRow.materialCode || materialCode,
        xMm: x,
        yMm: currentY,
        lengthMm: candL,
        widthMm: candW,
        originalLengthMm: piece.originalRow.lengthMm,
        originalWidthMm: piece.originalRow.widthMm,
        grain: piece.grain,
        rotated: rotated,
        L1: piece.originalRow.L1,
        L2: piece.originalRow.L2,
        W1: piece.originalRow.W1,
        W2: piece.originalRow.W2,
        edgeBandCode: piece.originalRow.edgeBandCode,
        edgeBandName: piece.originalRow.edgeBandName,
        edgeBandThicknessMm: piece.originalRow.edgeBandThicknessMm,
        thicknessMm: piece.originalRow.thicknessMm ?? thicknessMm,
        sheetIndex,
        stripIndex: stripIdx,
        cutSequenceNumber: cutSequence,
        status: 'pending',
      });

      if (!stripRestRegion) {
        throw new ValidationError(
          'Colocación sin región de franja disponible: el programa y la colocación divergen',
          {
            code: 'cut_plan.placement_not_representable',
            pieceRef: placementRef,
            stripIndex: stripIdx,
          },
        );
      }

      // Column separation along X within the strip...
      const column = program.divide({
        parentRegionId: stripRestRegion.regionId,
        axis: 'x',
        keptExtentMm: candL,
        kerfMm: kerf,
        cutId: `place-${cutSequence}-x`,
        keptRegionId: `piece:${placementRef}:column`,
        pieceRef: placementRef,
      });
      stripRestRegion = column.rest;
      // ...and the piece inside its column along Y — the explicit recut when
      // the piece is narrower than the strip, with its blade accounted for.
      const pieceSep = program.divide({
        parentRegionId: column.kept.regionId,
        axis: 'y',
        keptExtentMm: candW,
        kerfMm: kerf,
        cutId: `place-${cutSequence}-y`,
        keptRegionId: `piece:${placementRef}`,
        pieceRef: placementRef,
      });
      if (pieceSep.rest) {
        program.markLeftoverTerminal(pieceSep.rest, config);
      }
      program.markPieceTerminal(pieceSep.kept.regionId, placementRef);
    };

    // First, place the seed piece
    const seedL = bestSeedRotated ? bestSeedPiece.width : bestSeedPiece.length;
    const seedW = bestSeedRotated ? bestSeedPiece.length : bestSeedPiece.width;
    placeOnStrip(bestSeedPiece, bestSeedRotated, seedL, seedW, currentX);

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
        placeOnStrip(bestCand, candRotated, candL, candW, currentX);
        currentX += candL + kerf;
        foundNextInStrip = true;
      }
    }

    // Program truth: the strip leftover is a real terminal of any size; the
    // presentation-level remnant list is derived from the program terminals
    // once packing finishes (deriveSheetRemnants below).
    if (stripRestRegion) {
      program.markLeftoverTerminal(stripRestRegion, config);
    }

    currentY += stripHeight + kerf;
  }

  if (sheetRestRegion) {
    program.markLeftoverTerminal(sheetRestRegion, config);
  }

  const notPlaced = piecesRemaining.filter((p) => !placedIds.has(p.id));
  const cutProgram = program.build();
  const remnants = deriveSheetRemnants(
    cutProgram,
    program.getLiberatedWasteRegionIds(),
    sheetIndex,
    materialCode,
    materialName,
    10,
  );
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
      cutProgram,
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

/** Rejection cause of a packing candidate: identifiable, never silent. */
export interface StrategyCandidateRejection {
  readonly code: string;
  readonly message: string;
  readonly context?: Record<string, unknown>;
}

/**
 * One complete packing candidate: placed pieces, its own registered program,
 * terminals, remnants and any unplaced demand — all from the same strategy
 * run. Pieces of one candidate are never combined with the program of
 * another.
 */
export interface StrategyCandidate {
  readonly strategy: 'best-fit-v' | 'best-fit-h' | 'strip';
  readonly sheets: PlacementResult[];
  readonly remaining: PieceToPlace[];
  readonly rejection?: StrategyCandidateRejection;
}

function pieceToPlaceSummary(piece: PieceToPlace): Record<string, unknown> {
  return {
    id: piece.id,
    partCode: piece.originalRow.partCode ?? null,
    lengthMm: piece.length,
    widthMm: piece.width,
    grain: piece.grain,
  };
}

function rejectionFromError(error: unknown, strategy: StrategyCandidate['strategy']): StrategyCandidateRejection {
  if (error instanceof ValidationError) {
    const context = error.context ?? {};
    return {
      code: typeof context.code === 'string' ? context.code : 'cut_plan.strategy_failed',
      message: error.message,
      context: { strategy, ...context },
    };
  }
  return {
    code: 'cut_plan.strategy_failed',
    message: error instanceof Error ? error.message : 'Fallo desconocido de la estrategia',
    context: { strategy },
  };
}

/**
 * Validates the programs of one candidate against its own placements before
 * that candidate may compete: executes every sheet program, checks the
 * expected pieces by identity and placed dimensions (rotation included, edge
 * band never re-deducted), proves each executed leaf corresponds to the real
 * placement position, and confirms the expanded demand is fully covered.
 */
function validateCandidatePrograms(
  candidate: StrategyCandidate,
  unrolled: readonly PieceToPlace[],
): StrategyCandidateRejection | undefined {
  const placedTotal = candidate.sheets.reduce((sum, sheet) => sum + sheet.pieces.length, 0);
  if (placedTotal !== unrolled.length) {
    return {
      code: 'cut_plan.piece_count_mismatch',
      message: 'El número de piezas colocadas no cubre la demanda expandida',
      context: { strategy: candidate.strategy, expected: unrolled.length, placed: placedTotal },
    };
  }

  for (const sheet of candidate.sheets) {
    if (!sheet.cutProgram) {
      return {
        code: 'cut_plan.program_missing',
        message: 'Resultado guillotina aceptado sin programa de cortes',
        context: { strategy: candidate.strategy, sheetIndex: sheet.sheetIndex },
      };
    }
    try {
      const trace = executeCutProgram(sheet.cutProgram);
      checkExpectedPieces(
        trace,
        sheet.pieces.map((piece) => ({
          pieceRef: piece.id,
          lengthMm: piece.lengthMm,
          widthMm: piece.widthMm,
        })),
      );
      for (const piece of sheet.pieces) {
        const leaf = trace.terminals.find(
          (terminal) => terminal.kind === 'piece' && terminal.pieceRef === piece.id,
        );
        const claimed: CutProgramRect = {
          xMm: piece.xMm,
          yMm: piece.yMm,
          lengthMm: piece.lengthMm,
          widthMm: piece.widthMm,
        };
        if (!leaf || !cutProgramRectMatches(claimed, leaf.rect)) {
          return {
            code: 'cut_plan.placement_leaf_mismatch',
            message: 'Hoja ejecutada no corresponde con la colocación real (posición incluida)',
            context: {
              strategy: candidate.strategy,
              sheetIndex: sheet.sheetIndex,
              pieceRef: piece.id,
              claimed,
              executed: leaf?.rect ?? null,
            },
          };
        }
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        return rejectionFromError(error, candidate.strategy);
      }
      throw error;
    }
  }
  return undefined;
}

function runPackingStrategy(
  strategy: StrategyCandidate['strategy'],
  unrolled: PieceToPlace[],
  sheetLengthMm: number,
  sheetWidthMm: number,
  materialCode: string,
  materialName: string,
  thicknessMm: number | undefined,
  config: CutPlanConfig,
): StrategyCandidate {
  const sheets: PlacementResult[] = [];
  let remainingToPlace = [...unrolled];
  let sheetIdx = 0;

  try {
    while (remainingToPlace.length > 0) {
      const res =
        strategy === 'strip'
          ? packSingleSheetStrip(
              remainingToPlace,
              sheetIdx,
              sheetLengthMm,
              sheetWidthMm,
              config,
              materialCode,
              materialName,
              thicknessMm,
            )
          : packSingleSheetGuillotineBestFit(
              remainingToPlace,
              sheetIdx,
              sheetLengthMm,
              sheetWidthMm,
              config,
              materialCode,
              materialName,
              thicknessMm,
              strategy === 'best-fit-v',
            );
      if (res.sheet.pieces.length === 0) {
        // Piece larger than usable sheet (or nothing placeable): the demand is
        // not satisfied on this strategy — recorded as a rejection cause, the
        // candidate must not compete as if it were complete.
        break;
      }
      sheets.push(res.sheet);
      remainingToPlace = res.remaining;
      sheetIdx++;
    }
  } catch (error) {
    // Non-representable geometry (e.g. blade would exit its parent): the
    // candidate is excluded with this identified cause; it is never hidden
    // with a silent continue. If no candidate survives, the optimizer fails
    // loudly with every cause.
    return {
      strategy,
      sheets,
      remaining: remainingToPlace,
      rejection: rejectionFromError(error, strategy),
    };
  }

  if (remainingToPlace.length > 0) {
    return {
      strategy,
      sheets,
      remaining: remainingToPlace,
      rejection: {
        code: 'cut_plan.pieces_not_placed',
        message: 'La estrategia dejó piezas de la demanda sin colocar',
        context: {
          strategy,
          pieces: remainingToPlace.map(pieceToPlaceSummary),
        },
      },
    };
  }

  const programRejection = validateCandidatePrograms({ strategy, sheets, remaining: remainingToPlace }, unrolled);
  if (programRejection) {
    return { strategy, sheets, remaining: remainingToPlace, rejection: programRejection };
  }
  return { strategy, sheets, remaining: remainingToPlace };
}

/**
 * Picks the winning candidate among complete, program-validated ones using
 * the existing deterministic criteria (fewest sheets, then most useful
 * remnant area). Incomplete or non-representable candidates are excluded
 * BEFORE comparison: none can win by sheet count while leaving demand
 * unplaced. If nothing satisfies the demand, fails with every rejection
 * cause instead of returning a partial plan presented as complete.
 *
 * @internal Exported for bounded tests of the selection policy only.
 */
export function pickWinningStrategyCandidate(candidates: StrategyCandidate[]): StrategyCandidate {
  const valid = candidates.filter((candidate) => !candidate.rejection);
  if (valid.length === 0) {
    throw new ValidationError(
      'Ninguna candidata guillotina representa la demanda completa: revisa piezas o restricciones',
      {
        code: 'cut_plan.no_representable_candidate',
        rejections: candidates.map((candidate) => ({
          strategy: candidate.strategy,
          ...(candidate.rejection ?? {}),
        })),
      },
    );
  }

  const usefulRemnantArea = (candidate: StrategyCandidate): number =>
    candidate.sheets.reduce(
      (sum, sheet) =>
        sum +
        sheet.remnants.reduce((remSum, rem) => (rem.isUseful ? remSum + rem.areaM2 : remSum), 0),
      0,
    );

  const sorted = [...valid].sort((a, b) => {
    if (a.sheets.length !== b.sheets.length) return a.sheets.length - b.sheets.length;
    return usefulRemnantArea(b) - usefulRemnantArea(a);
  });
  return sorted[0]!;
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

  // Strategy A: Best Fit with vertical (X-first) splits; B: horizontal
  // (Y-first) splits; C: Strip / Shelf packing. Each candidate keeps its own
  // placements, program, terminals and remnants together.
  const candidates = [
    runPackingStrategy('best-fit-v', unrolled, sheetLengthMm, sheetWidthMm, materialCode, materialName, thicknessMm, config),
    runPackingStrategy('best-fit-h', unrolled, sheetLengthMm, sheetWidthMm, materialCode, materialName, thicknessMm, config),
    runPackingStrategy('strip', unrolled, sheetLengthMm, sheetWidthMm, materialCode, materialName, thicknessMm, config),
  ];

  // Empty demand is a valid, compatible case: no sheets, no programs.
  if (unrolled.length === 0) {
    return [];
  }

  return pickWinningStrategyCandidate(candidates).sheets;
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
      cutProgram: p.cutProgram,
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
