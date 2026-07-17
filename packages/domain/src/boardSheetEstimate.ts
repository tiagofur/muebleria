/**
 * Heuristic board sheet count from material usage (#135).
 * Not nesting — estimate only for workshop planning.
 */

import type { MaterialBoard, MaterialUsageRow } from './types';

export type BoardSheetEstimate = {
  readonly materialId: string;
  readonly code: string;
  readonly name: string;
  /** Net board area from BOM (m²). */
  readonly areaM2: number;
  /** Sheet size from catalog (mm). */
  readonly sheetWidthMm: number;
  readonly sheetLengthMm: number;
  /** Useful area of one sheet (m²), raw (no waste). */
  readonly sheetAreaM2: number;
  /** Waste % from material catalog. */
  readonly wastePercent: number;
  /**
   * Estimated sheets: ceil(areaM2 * (1 + waste/100) / sheetAreaM2).
   * Minimum 1 when areaM2 > 0.
   */
  readonly estimatedSheets: number;
};

/**
 * Estimate full sheets needed per material from aggregated m² usage.
 * Uses catalog board width × length as one sheet; applies material waste %.
 */
export function estimateBoardSheets(
  materials: readonly MaterialUsageRow[],
  catalogMaterials: readonly MaterialBoard[],
): BoardSheetEstimate[] {
  const byId = new Map(catalogMaterials.map((m) => [m.id, m]));
  const out: BoardSheetEstimate[] = [];

  for (const row of materials) {
    if (!(row.areaM2 > 0)) continue;
    const mat = byId.get(row.materialId);
    const sheetWidthMm = mat && mat.widthMm > 0 ? mat.widthMm : 0;
    const sheetLengthMm = mat && mat.lengthMm > 0 ? mat.lengthMm : 0;
    const sheetAreaM2 =
      sheetWidthMm > 0 && sheetLengthMm > 0
        ? (sheetWidthMm * sheetLengthMm) / 1_000_000
        : 0;
    const wastePercent = mat?.wastePercent ?? 0;
    let estimatedSheets = 0;
    if (sheetAreaM2 > 0) {
      const withWaste = row.areaM2 * (1 + Math.max(0, wastePercent) / 100);
      estimatedSheets = Math.max(1, Math.ceil(withWaste / sheetAreaM2 - 1e-12));
    }

    out.push({
      materialId: row.materialId,
      code: row.code,
      name: row.name,
      areaM2: row.areaM2,
      sheetWidthMm,
      sheetLengthMm,
      sheetAreaM2,
      wastePercent,
      estimatedSheets,
    });
  }

  return out.sort((a, b) => a.code.localeCompare(b.code, 'es'));
}
