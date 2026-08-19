/**
 * 2D Guillotine Cut Plan & Optimization Types.
 *
 * Designed for professional cabinetmaking workshops (manual table saws,
 * vertical panel saws, beam saws, and CNC machine post-processing).
 */

import type { Grain, ProductionCutRow } from '../types';

/**
 * Configurable trim (refilado) margins per side (mm).
 * Can be specified individually for each of the 4 borders:
 * - top / bottom (largo)
 * - left / right (ancho)
 */
export interface CutTrimMargins {
  /** Top edge trim (mm) — largo superior */
  readonly topMm: number;
  /** Bottom edge trim (mm) — largo inferior */
  readonly bottomMm: number;
  /** Left edge trim (mm) — ancho izquierdo */
  readonly leftMm: number;
  /** Right edge trim (mm) — ancho derecho */
  readonly rightMm: number;
}

export const DEFAULT_CUT_TRIM_MARGINS: CutTrimMargins = {
  topMm: 10,
  bottomMm: 10,
  leftMm: 10,
  rightMm: 10,
};

export const DEFAULT_SAW_KERF_MM = 4;
export const DEFAULT_MIN_REMNANT_LENGTH_MM = 600;
export const DEFAULT_MIN_REMNANT_WIDTH_MM = 400;

export interface CutPlanConfig {
  /** Saw blade kerf thickness (mm) — espesor de disco de corte */
  readonly sawKerfMm: number;
  /** Refilado / trim margins around the raw board */
  readonly trim: CutTrimMargins;
  /**
   * Descontar grosor de cintilla / tapacanto en el corte en crudo (sobrecorte negativo).
   * - true (default en pegado manual o estándar): descuenta el grosor del canto en cada lado aplicado (L1, L2, W1, W2).
   * - false (máquina enchapadora con pre-fresado / tupi): la pieza se corta exactamente a la medida final.
   */
  readonly deductEdgeBand: boolean;
  /** Allow 90° rotation when grain is 0 (sin veta / libre) */
  readonly allowRotationNoGrain: boolean;
  /** Minimum dimension to consider a leftover piece as a useful remnant (retazo útil) */
  readonly minRemnantWidthMm: number;
  readonly minRemnantLengthMm: number;
  /** When true, prefers longitudinal strip cuts first (rip cuts along length) */
  readonly preferLongitudinalRips: boolean;
  /** Name of the optimization heuristic used */
  readonly heuristic?: 'guillotine-strip' | 'guillotine-best-fit' | 'guillotine-hybrid';
}

export const DEFAULT_CUT_PLAN_CONFIG: CutPlanConfig = {
  sawKerfMm: DEFAULT_SAW_KERF_MM,
  trim: DEFAULT_CUT_TRIM_MARGINS,
  deductEdgeBand: true,
  allowRotationNoGrain: true,
  minRemnantWidthMm: DEFAULT_MIN_REMNANT_WIDTH_MM,
  minRemnantLengthMm: DEFAULT_MIN_REMNANT_LENGTH_MM,
  preferLongitudinalRips: true,
  heuristic: 'guillotine-hybrid',
};

/**
 * A piece placed on a board in the cut plan.
 */
export interface CutPlanPlacedPiece {
  readonly id: string;
  readonly partCode: string;
  readonly partName: string;
  readonly moduleCode: string;
  readonly labelRef: string;
  readonly materialName: string;
  readonly materialCode?: string;
  /** X coordinate on board (mm), relative to raw board corner */
  readonly xMm: number;
  /** Y coordinate on board (mm), relative to raw board corner */
  readonly yMm: number;
  /** Cut length along X (mm) */
  readonly lengthMm: number;
  /** Cut width along Y (mm) */
  readonly widthMm: number;
  /** Original piece length before rotation */
  readonly originalLengthMm: number;
  /** Original piece width before rotation */
  readonly originalWidthMm: number;
  readonly grain: Grain;
  readonly rotated: boolean;
  /** Edge banding flags for the 4 sides */
  readonly L1: 0 | 1;
  readonly L2: 0 | 1;
  readonly W1: 0 | 1;
  readonly W2: 0 | 1;
  readonly edgeBandCode?: string;
  readonly edgeBandName?: string;
  readonly edgeBandThicknessMm?: number;
  readonly thicknessMm?: number;
  /** Sheet index (0-based) */
  readonly sheetIndex: number;
  /** Strip / rip index within sheet */
  readonly stripIndex: number;
  /** Order in which this piece is cut */
  readonly cutSequenceNumber: number;
  /** Workshop status tracking */
  readonly status?: 'pending' | 'cut' | 'damaged';
}

/**
 * Leftover rectangular area on a sheet.
 */
export interface CutPlanRemnant {
  readonly id: string;
  readonly sheetIndex: number;
  readonly xMm: number;
  readonly yMm: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly areaM2: number;
  readonly materialName: string;
  readonly materialCode?: string;
  readonly isUseful: boolean;
}

/**
 * Step-by-step guillotine cutting instruction for manual saw operators.
 */
export interface CutInstruction {
  readonly step: number;
  readonly phase: 1 | 2 | 3; // 1: Trim, 2: Rip strip, 3: Cross cut
  readonly cutType: 'trim' | 'rip' | 'cross';
  readonly description: string;
  readonly positionMm: number;
  readonly lengthMm: number;
}

/**
 * A single board sheet in the cut plan.
 */
export interface CutPlanSheet {
  readonly sheetIndex: number;
  readonly materialId?: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly sheetWidthMm: number;
  readonly sheetLengthMm: number;
  readonly thicknessMm?: number;
  readonly pieces: readonly CutPlanPlacedPiece[];
  readonly remnants: readonly CutPlanRemnant[];
  readonly instructions: readonly CutInstruction[];
  /** Sum of placed piece areas (m²) */
  readonly netPiecesAreaM2: number;
  /** Total sheet area (m²) */
  readonly grossSheetAreaM2: number;
  /** Usable leftover area (m²) for remnants >= threshold */
  readonly usableRemnantAreaM2: number;
  /** Pure scrap waste area (m²) */
  readonly wasteAreaM2: number;
  /** Waste percentage (0–100%) */
  readonly wastePercent: number;
  /** Material yield percentage (net area / gross area * 100) */
  readonly yieldPercent: number;
}

/**
 * Aggregate material summary for warehouse requisition.
 */
export interface CutPlanMaterialStat {
  readonly materialCode: string;
  readonly materialName: string;
  /** Exact full boards required by the 2D guillotine nesting */
  readonly sheetsNeeded: number;
  readonly piecesCount: number;
  readonly netAreaM2: number;
  readonly grossAreaM2: number;
  readonly wastePercent: number;
  readonly yieldPercent: number;
  readonly usefulRemnantsCount: number;
  readonly usefulRemnantsAreaM2: number;
}

/**
 * Global cut plan statistics.
 */
export interface CutPlanStats {
  readonly totalSheets: number;
  readonly totalPieces: number;
  readonly totalGrossAreaM2: number;
  readonly totalNetPiecesAreaM2: number;
  readonly totalUsefulRemnantsAreaM2: number;
  readonly totalWasteAreaM2: number;
  readonly globalWastePercent: number;
  readonly globalYieldPercent: number;
  readonly byMaterial: readonly CutPlanMaterialStat[];
}

/**
 * Complete immutable Cut Plan data model.
 */
export interface CutPlan {
  readonly id: string;
  readonly projectId: string;
  readonly projectName?: string;
  readonly generatedAt: string; // ISO
  readonly version: number;
  readonly isFrozen: boolean;
  readonly config: CutPlanConfig;
  readonly sheets: readonly CutPlanSheet[];
  readonly stats: CutPlanStats;
  readonly usefulRemnants: readonly CutPlanRemnant[];
}
