/**
 * Pure presentation mappers for QuoteRevision commercial authority (#642).
 *
 * Joins frozen QuoteCommercialSnapshot lines and units with QuoteRevision items
 * strictly by quoteLineId and furnitureInstanceId. Never by name, index,
 * geometry, or live catalog defaults.
 */

import type {
  QuoteCommercialOption,
  QuoteCommercialSnapshot,
  QuoteRevisionItem,
} from '@granete/storage';

export interface ProjectRevisionUnitView {
  readonly furnitureInstanceId: string;
  readonly quoteLineId: string;
  readonly moduleCode: string;
  readonly moduleName: string;
  readonly lifecycleStatus: string;
  readonly dimensionsFormatted: string | null;
  readonly options: ReadonlyArray<QuoteCommercialOption>;
}

export interface ProjectRevisionLineView {
  readonly quoteLineId: string;
  readonly quantity: number;
  readonly furnitureInstanceIds: ReadonlyArray<string>;
  readonly moduleName: string;
  readonly moduleCode: string;
  readonly salePrice: number | null;
  readonly units: ReadonlyArray<ProjectRevisionUnitView>;
  readonly isMultiUnit: boolean;
}

function parseFiniteDim(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const num = Number(val);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
}

/**
 * Formats dimensions from item parameters.
 * Returns `${w}×${h}×${d} mm` when all 3 dimensions are present, or null.
 * Shows honest absence instead of falling back to catalog presets or project items.
 */
export function formatRevisionUnitDimensions(
  parameters?: Record<string, unknown> | null,
): string | null {
  if (!parameters) return null;
  const width = parseFiniteDim(parameters.widthMm ?? parameters.width);
  const height = parseFiniteDim(parameters.heightMm ?? parameters.height);
  const depth = parseFiniteDim(parameters.depthMm ?? parameters.depth);
  if (width == null || height == null || depth == null) return null;
  return `${width}×${height}×${depth} mm`;
}

/**
 * Builds coherent presentation lines from the exact commercial snapshot and items.
 *
 * Rules:
 * 1. Each line in snapshot.lines maps to one ProjectRevisionLineView keyed by quoteLineId.
 * 2. Units match strictly by u.quoteLineId === line.quoteLineId.
 * 3. Parameters match strictly by item.furnitureInstanceId === unit.furnitureInstanceId.
 * 4. salePrice is included only when authorized (> 0); redacted or zero prices are null
 *    to prevent misleading customers with "$0.00" items.
 * 5. Distinct lines with identical module names remain distinct.
 */
export function buildRevisionLines(
  snapshot: QuoteCommercialSnapshot,
  items?: ReadonlyArray<QuoteRevisionItem>,
): ReadonlyArray<ProjectRevisionLineView> {
  const itemByInstance = new Map<string, QuoteRevisionItem>();
  if (items) {
    for (const item of items) {
      if (item.furnitureInstanceId) {
        itemByInstance.set(item.furnitureInstanceId, item);
      }
    }
  }

  return snapshot.lines.map((line) => {
    const lineUnits = snapshot.units.filter(
      (u) => u.quoteLineId === line.quoteLineId,
    );

    const units: ProjectRevisionUnitView[] = lineUnits.map((u) => {
      const item = itemByInstance.get(u.furnitureInstanceId);
      return {
        furnitureInstanceId: u.furnitureInstanceId,
        quoteLineId: u.quoteLineId,
        moduleCode: u.moduleCode,
        moduleName: u.moduleName,
        lifecycleStatus: u.lifecycleStatus,
        dimensionsFormatted: formatRevisionUnitDimensions(item?.parameters),
        options: u.options ?? [],
      };
    });

    const firstUnit = units[0];
    const moduleName = firstUnit?.moduleName ?? 'Mueble';
    const moduleCode = firstUnit?.moduleCode ?? '';
    const salePrice =
      line.amounts && line.amounts.salePrice > 0 ? line.amounts.salePrice : null;

    return {
      quoteLineId: line.quoteLineId,
      quantity: line.quantity,
      furnitureInstanceIds: line.furnitureInstanceIds,
      moduleName,
      moduleCode,
      salePrice,
      units,
      isMultiUnit: line.quantity > 1 || units.length > 1,
    };
  });
}
