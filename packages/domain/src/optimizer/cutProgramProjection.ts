/**
 * Authoritative UI and human-instruction projection for executed guillotine cut programs (#650 PR 3).
 *
 * Transforms the validated CutProgramTrace from executeCutProgram into:
 * 1. Step-by-step guillotine cutting instructions (CutInstruction[]) with exact
 *    relative measures (never global board coordinates), parent region bounds,
 *    blade kerfs, and expected piece references.
 * 2. Visual layout projections for ProductionBoardView / ProductionBoardSvg:
 *    - Cut lines and kerf bands strictly bounded to their active parent regions.
 *    - Primary 1st cut marker directly derived from the program's first division.
 *    - Full nominal tool footprint vs consumed material band (including blade exits).
 *    - Explicit status classification (valid / missing / invalid / cnc-nesting).
 *
 * This module does NOT reoptimize, does NOT group pieces by X/Y coordinates,
 * does NOT invent operations, and does NOT alter geometry.
 */

import { ValidationError } from '../errors';
import {
  executeCutProgram,
  type CutProgramAxis,
  type CutProgramInput,
  type CutProgramRect,
  type CutProgramTrace,
  type CutProgramTraceDivision,
} from './cutProgram';
import type { PlacementResult } from './pieces';
import type {
  CutInstruction,
  CutPlanPlacedPiece,
  CutPlanRemnant,
  CutPlanSheet,
} from './types';

/**
 * Step view for step-by-step navigation in manual saw cutting.
 */
export interface CutProgramStepView {
  readonly stepIndex: number; // 0-based index
  readonly stepNumber: number; // 1-based order
  readonly cutId: string;
  readonly parentRegionId: string;
  readonly axis: CutProgramAxis;
  readonly parentRect: CutProgramRect;
  /** Relative measure (mm) kept from the parent origin along the advance axis. */
  readonly relativeMeasureMm: number;
  /** Nominal saw blade kerf (mm). */
  readonly nominalKerfMm: number;
  /** Actual kerf consumed from the parent (mm). */
  readonly consumedKerfMm: number;
  /** Consumed blade band inside the parent. */
  readonly kerfBandRect: CutProgramRect;
  /**
   * Full nominal tool footprint spanning across the parent on the other axis,
   * extending by nominalKerfMm along the advance axis. When bladeExitsParent
   * is true, this extends beyond parentRect into verified free space / exterior.
   */
  readonly toolFootprintRect: CutProgramRect;
  /** Kept child region resulting from the cut. */
  readonly keptRect: CutProgramRect;
  readonly keptRegionId: string;
  /** Solid remainder child region, or null if kerf-only / blade-exit. */
  readonly restRect: CutProgramRect | null;
  readonly restRegionId?: string;
  /** True when the blade overhangs the parent. */
  readonly bladeExitsParent: boolean;
  /** True for near-side trims with mirrored layout ([rest][band][kept]). */
  readonly leadingBand: boolean;
  /** True if this pass is a perimeter trim (refilado). */
  readonly isTrim: boolean;
  /** True if this is the first cut of the program. */
  readonly isPrimaryCut: boolean;
  /** Cut line segment across parent rect (leading/cutting edge). */
  readonly cutLine: {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
  };
  /** Piece obtained by this cut, if a piece terminal is directly isolated. */
  readonly producedPiece?: CutPlanPlacedPiece | null;
  /** Remnant obtained by this cut, if an offcut terminal is directly isolated. */
  readonly producedRemnant?: CutPlanRemnant | null;
  /** Human-readable instruction describing this step. */
  readonly instruction: CutInstruction;
}

/**
 * Single cut entry for general view rendering.
 */
export interface CutProgramCutView {
  readonly cutId: string;
  readonly order: number;
  readonly axis: CutProgramAxis;
  readonly parentRegionId: string;
  readonly parentRect: CutProgramRect;
  readonly cutLine: {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
  };
  readonly kerfBandRect: CutProgramRect;
  readonly toolFootprintRect: CutProgramRect;
  readonly nominalKerfMm: number;
  readonly consumedKerfMm: number;
  readonly bladeExitsParent: boolean;
  readonly leadingBand: boolean;
  readonly isTrim: boolean;
  readonly isPrimaryCut: boolean;
}

/**
 * Primary 1st cut marker information.
 */
export interface CutProgramPrimaryCutInfo {
  readonly axis: CutProgramAxis;
  readonly coordinateMm: number;
  readonly label: string;
  readonly line: {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
  };
  readonly kerfBandRect: CutProgramRect;
}

/**
 * Complete projection of an executed cut program for board views.
 */
export interface CutProgramBoardProjection {
  readonly status: 'valid' | 'missing' | 'invalid' | 'cnc-nesting';
  readonly errorMessage?: string;
  readonly boardRect?: CutProgramRect;
  readonly steps: readonly CutProgramStepView[];
  readonly cuts: readonly CutProgramCutView[];
  readonly primaryCut: CutProgramPrimaryCutInfo | null;
  readonly usefulRemnants: readonly CutPlanRemnant[];
  readonly wasteLeaves: readonly {
    readonly regionId: string;
    readonly rect: CutProgramRect;
    readonly liberated?: boolean;
  }[];
  readonly trace?: CutProgramTrace;
}

/**
 * Calculates the cut edge coordinate and line across the parent region.
 */
function computeDivisionCutGeometry(division: CutProgramTraceDivision): {
  readonly cutCoordinate: number;
  readonly cutLine: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
  readonly nominalFootprintRect: CutProgramRect;
  readonly consumedKerfMm: number;
} {
  const { axis, parentRect, keptExtentMm, kerfMm, leadingBand } = division;
  if (axis === 'x') {
    const consumedKerfMm = division.kerfBandRect.lengthMm;
    const cutCoordinate = leadingBand
      ? parentRect.xMm + parentRect.lengthMm - keptExtentMm
      : parentRect.xMm + keptExtentMm;

    const cutLine = {
      x1: cutCoordinate,
      y1: parentRect.yMm,
      x2: cutCoordinate,
      y2: parentRect.yMm + parentRect.widthMm,
    };

    const nominalFootprintRect: CutProgramRect = {
      xMm: leadingBand ? cutCoordinate - kerfMm : cutCoordinate,
      yMm: parentRect.yMm,
      lengthMm: kerfMm,
      widthMm: parentRect.widthMm,
    };

    return { cutCoordinate, cutLine, nominalFootprintRect, consumedKerfMm };
  } else {
    const consumedKerfMm = division.kerfBandRect.widthMm;
    const cutCoordinate = leadingBand
      ? parentRect.yMm + parentRect.widthMm - keptExtentMm
      : parentRect.yMm + keptExtentMm;

    const cutLine = {
      x1: parentRect.xMm,
      y1: cutCoordinate,
      x2: parentRect.xMm + parentRect.lengthMm,
      y2: cutCoordinate,
    };

    const nominalFootprintRect: CutProgramRect = {
      xMm: parentRect.xMm,
      yMm: leadingBand ? cutCoordinate - kerfMm : cutCoordinate,
      lengthMm: parentRect.lengthMm,
      widthMm: kerfMm,
    };

    return { cutCoordinate, cutLine, nominalFootprintRect, consumedKerfMm };
  }
}

/**
 * Checks whether a division represents a perimeter trim (refilado).
 *
 * Structured signals only: the neutral `trim` declaration (covers kerf-only
 * and blade-exit passes, which leave no liberated waste leaf to derive from)
 * or a liberated waste leaf on either child of a legacy program. cutId names
 * are never interpreted as industrial authority (#650 PR 3 review).
 */
function isTrimDivision(
  division: CutProgramTraceDivision,
  liberatedWasteRegionIds: ReadonlySet<string>,
): boolean {
  if (division.trim) {
    return true;
  }
  if (division.restRegionId && liberatedWasteRegionIds.has(division.restRegionId)) {
    return true;
  }
  if (liberatedWasteRegionIds.has(division.keptRegionId)) {
    return true;
  }
  return false;
}

/**
 * Builds a structured CutInstruction from a trace division.
 */
function buildCutInstruction(
  division: CutProgramTraceDivision,
  isTrim: boolean,
  cutLineLengthMm: number,
  consumedKerfMm: number,
  producedPiece?: CutPlanPlacedPiece | null,
  producedRemnant?: CutPlanRemnant | null,
): CutInstruction {
  let phase: 1 | 2 | 3 = 2;
  let cutType: 'trim' | 'rip' | 'cross' = 'rip';
  let description = '';

  const parentDesc = `${Math.round(division.parentRect.lengthMm)}×${Math.round(division.parentRect.widthMm)} mm`;
  const kerfDesc = `disco: ${division.kerfMm} mm`;
  const exitNote = division.bladeExitsParent ? ' [salida de disco verificada]' : '';

  if (isTrim) {
    phase = 1;
    cutType = 'trim';
    const trimSide = division.axis === 'x'
      ? (division.leadingBand ? 'izquierdo (X=0)' : 'derecho')
      : (division.leadingBand ? 'inferior (Y=0)' : 'superior');
    const trimMm = division.axis === 'x'
      ? division.parentRect.lengthMm - division.keptExtentMm
      : division.parentRect.widthMm - division.keptExtentMm;
    description = `Refilar borde ${trimSide}: ${Math.round(trimMm)} mm (${kerfDesc})${exitNote}`;
  } else if (producedPiece) {
    phase = 3;
    cutType = 'cross';
    description = `Trocear pieza [${producedPiece.partCode}] ${producedPiece.partName} a ${Math.round(division.keptExtentMm)} mm (${producedPiece.lengthMm}×${producedPiece.widthMm} mm, ${kerfDesc})${exitNote}`;
  } else if (producedRemnant) {
    phase = 2;
    cutType = 'rip';
    const orientation = division.axis === 'x' ? 'columna' : 'tira';
    description = `Separar ${orientation} a ${Math.round(division.keptExtentMm)} mm sobre región de ${parentDesc} (${kerfDesc}) · retazo útil ${Math.round(producedRemnant.lengthMm)}×${Math.round(producedRemnant.widthMm)} mm${exitNote}`;
  } else {
    phase = 2;
    cutType = 'rip';
    const orientation = division.axis === 'x' ? 'columna' : 'tira';
    description = `Separar ${orientation} a ${Math.round(division.keptExtentMm)} mm sobre región de ${parentDesc} (${kerfDesc})${exitNote}`;
  }

  return {
    step: division.order,
    phase,
    cutType,
    description,
    positionMm: division.keptExtentMm,
    lengthMm: cutLineLengthMm,
    cutId: division.cutId,
    parentRegionId: division.parentRegionId,
    axis: division.axis,
    relativeMeasureMm: division.keptExtentMm,
    kerfMm: division.kerfMm,
    nominalKerfMm: division.kerfMm,
    consumedKerfMm,
    bladeExitsParent: division.bladeExitsParent,
    leadingBand: division.leadingBand,
    pieceRef: producedPiece?.id ?? producedPiece?.partCode,
    partCode: producedPiece?.partCode,
    partName: producedPiece?.partName,
    parentRect: division.parentRect,
    keptRect: division.keptRect,
    restRect: division.restRect,
    kerfBandRect: division.kerfBandRect,
  };
}

/**
 * Projects a validated CutProgramTrace and placed pieces into a board preview projection.
 */
export function projectCutProgram(
  trace: CutProgramTrace,
  pieces: readonly CutPlanPlacedPiece[] = [],
  remnants: readonly CutPlanRemnant[] = [],
): CutProgramBoardProjection {
  const liberatedWasteIds = new Set<string>();
  for (const t of trace.terminals) {
    if (t.kind === 'waste' && t.liberated === true) {
      liberatedWasteIds.add(t.regionId);
    }
  }

  // Maps terminal region ID to piece/remnant
  const terminalByRegionId = new Map(trace.terminals.map((t) => [t.regionId, t]));
  const pieceByRef = new Map<string, CutPlanPlacedPiece>();
  for (const p of pieces) {
    pieceByRef.set(p.id, p);
    if (!pieceByRef.has(p.partCode)) {
      pieceByRef.set(p.partCode, p);
    }
  }

  const steps: CutProgramStepView[] = [];
  const cuts: CutProgramCutView[] = [];

  for (let i = 0; i < trace.divisions.length; i++) {
    const division = trace.divisions[i]!;
    const isTrim = isTrimDivision(division, liberatedWasteIds);
    const isPrimaryCut = i === 0;

    const { cutCoordinate, cutLine, nominalFootprintRect, consumedKerfMm } =
      computeDivisionCutGeometry(division);

    const cutLineLengthMm = division.axis === 'x'
      ? division.parentRect.widthMm
      : division.parentRect.lengthMm;

    // Detect if this cut directly produces a piece terminal
    let producedPiece: CutPlanPlacedPiece | null = null;
    const keptTerminal = terminalByRegionId.get(division.keptRegionId);
    const restTerminal = division.restRegionId
      ? terminalByRegionId.get(division.restRegionId)
      : undefined;

    if (keptTerminal && keptTerminal.kind === 'piece' && keptTerminal.pieceRef) {
      producedPiece = pieceByRef.get(keptTerminal.pieceRef) ?? null;
    } else if (restTerminal && restTerminal.kind === 'piece' && restTerminal.pieceRef) {
      producedPiece = pieceByRef.get(restTerminal.pieceRef) ?? null;
    }

    // Detect if this cut directly produces an offcut terminal
    let producedRemnant: CutPlanRemnant | null = null;
    if (keptTerminal && keptTerminal.kind === 'remnant') {
      producedRemnant = remnants.find((r) =>
        Math.abs(r.xMm - division.keptRect.xMm) < 0.1 &&
        Math.abs(r.yMm - division.keptRect.yMm) < 0.1,
      ) ?? null;
    } else if (restTerminal && restTerminal.kind === 'remnant' && division.restRect) {
      producedRemnant = remnants.find((r) =>
        Math.abs(r.xMm - division.restRect!.xMm) < 0.1 &&
        Math.abs(r.yMm - division.restRect!.yMm) < 0.1,
      ) ?? null;
    }

    const instruction = buildCutInstruction(
      division,
      isTrim,
      cutLineLengthMm,
      consumedKerfMm,
      producedPiece,
      producedRemnant,
    );

    const stepView: CutProgramStepView = {
      stepIndex: i,
      stepNumber: division.order,
      cutId: division.cutId,
      parentRegionId: division.parentRegionId,
      axis: division.axis,
      parentRect: division.parentRect,
      relativeMeasureMm: division.keptExtentMm,
      nominalKerfMm: division.kerfMm,
      consumedKerfMm,
      kerfBandRect: division.kerfBandRect,
      toolFootprintRect: nominalFootprintRect,
      keptRect: division.keptRect,
      keptRegionId: division.keptRegionId,
      restRect: division.restRect,
      restRegionId: division.restRegionId,
      bladeExitsParent: division.bladeExitsParent,
      leadingBand: division.leadingBand,
      isTrim,
      isPrimaryCut,
      cutLine,
      producedPiece,
      producedRemnant,
      instruction,
    };

    steps.push(stepView);

    cuts.push({
      cutId: division.cutId,
      order: division.order,
      axis: division.axis,
      parentRegionId: division.parentRegionId,
      parentRect: division.parentRect,
      cutLine,
      kerfBandRect: division.kerfBandRect,
      toolFootprintRect: nominalFootprintRect,
      nominalKerfMm: division.kerfMm,
      consumedKerfMm,
      bladeExitsParent: division.bladeExitsParent,
      leadingBand: division.leadingBand,
      isTrim,
      isPrimaryCut,
    });
  }

  // Primary 1st cut marker
  let primaryCut: CutProgramPrimaryCutInfo | null = null;
  if (steps.length > 0) {
    const firstStep = steps[0]!;
    const coordMm = firstStep.axis === 'x'
      ? firstStep.cutLine.x1
      : firstStep.cutLine.y1;
    const axisLabel = firstStep.axis.toUpperCase();
    const label = firstStep.isTrim
      ? `1er corte (refilado ${axisLabel}): ${axisLabel} = ${Math.round(coordMm)} mm`
      : `1er corte: ${axisLabel} = ${Math.round(coordMm)} mm`;

    primaryCut = {
      axis: firstStep.axis,
      coordinateMm: coordMm,
      label,
      line: firstStep.cutLine,
      kerfBandRect: firstStep.kerfBandRect,
    };
  }

  // Remnants and waste leaves from trace
  const usefulRemnants = remnants.filter((r) => r.isUseful);
  const wasteLeaves = trace.terminals
    .filter((t) => t.kind === 'waste')
    .map((t) => ({
      regionId: t.regionId,
      rect: t.rect,
      liberated: t.liberated,
    }));

  return {
    status: 'valid',
    boardRect: trace.boardRect,
    steps,
    cuts,
    primaryCut,
    usefulRemnants,
    wasteLeaves,
    trace,
  };
}

/**
 * Generates authoritative CutInstruction[] from a validated cut program and placed pieces.
 */
export function generateCuttingInstructionsFromProgram(
  program: CutProgramInput,
  pieces: readonly CutPlanPlacedPiece[],
  remnants: readonly CutPlanRemnant[] = [],
): CutInstruction[] {
  const trace = executeCutProgram(program);
  const projection = projectCutProgram(trace, pieces, remnants);
  return projection.steps.map((s) => s.instruction);
}

/**
 * High level resolver: projects a sheet into its cut layout view.
 * Handles valid, missing, invalid, and cnc-nesting states. Accepts both the
 * final CutPlanSheet and the PlacementResult the bounded packing tests use —
 * every field it reads exists on both.
 */
export function projectSheetCutProgram(
  sheet: CutPlanSheet | PlacementResult | undefined,
): CutProgramBoardProjection {
  if (!sheet) {
    return {
      status: 'missing',
      steps: [],
      cuts: [],
      primaryCut: null,
      usefulRemnants: [],
      wasteLeaves: [],
    };
  }

  if (sheet.strategy === 'cnc-nesting') {
    return {
      status: 'cnc-nesting',
      boardRect: { xMm: 0, yMm: 0, lengthMm: sheet.sheetLengthMm, widthMm: sheet.sheetWidthMm },
      steps: [],
      cuts: [],
      primaryCut: null,
      usefulRemnants: sheet.remnants.filter((r) => r.isUseful),
      wasteLeaves: [],
    };
  }

  if (!sheet.cutProgram) {
    return {
      status: 'missing',
      boardRect: { xMm: 0, yMm: 0, lengthMm: sheet.sheetLengthMm, widthMm: sheet.sheetWidthMm },
      steps: [],
      cuts: [],
      primaryCut: null,
      usefulRemnants: sheet.remnants.filter((r) => r.isUseful),
      wasteLeaves: [],
    };
  }

  try {
    const trace = executeCutProgram(sheet.cutProgram);
    return projectCutProgram(trace, sheet.pieces, sheet.remnants);
  } catch (error) {
    const errorMessage = error instanceof ValidationError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Programa de corte no válido';
    return {
      status: 'invalid',
      errorMessage,
      boardRect: { xMm: 0, yMm: 0, lengthMm: sheet.sheetLengthMm, widthMm: sheet.sheetWidthMm },
      steps: [],
      cuts: [],
      primaryCut: null,
      usefulRemnants: sheet.remnants.filter((r) => r.isUseful),
      wasteLeaves: [],
    };
  }
}
