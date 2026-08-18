/**
 * Production order (OP) workspace model — PROD-0.1 / PROD-0.3.
 * Pure helpers only; shell supplies cut-list result from domain.
 */

import type { Project, ProductionCutRow } from '@muebles/domain';
import { isProductionQueueStatus } from './productionHelpers';

/**
 * Sub-views of a production order hub (docs/production-module.md §5.1).
 * Documentos owns all factory downloads — former `exports` tab is an alias.
 */
export const PRODUCTION_ORDER_TABS = [
  'resumen',
  'modulos',
  'piso',
  'despacho',
  'despiece',
  'etiquetas',
  'herrajes',
  'vistas',
  'optimizacion',
  'documentos',
] as const;

export type ProductionOrderTab = (typeof PRODUCTION_ORDER_TABS)[number];

/** Spanish labels for hub sub-nav (taller copy). */
export const PRODUCTION_ORDER_TAB_LABELS: Readonly<
  Record<ProductionOrderTab, string>
> = {
  resumen: 'Resumen',
  modulos: 'Módulos',
  piso: 'Piso',
  despacho: 'Control de Carga',
  despiece: 'Despiece',
  etiquetas: 'Etiquetas',
  herrajes: 'Herrajes',
  vistas: 'Vistas',
  optimizacion: 'Optimización',
  documentos: 'Documentos',
};

/**
 * Hub-only tabs — export roles (produccion, gerente_produccion, admin, etc.).
 * Technical tabs (modulos, despiece, vistas, optimizacion) live in Engineering.
 */
export const HUB_TABS = [
  'resumen',
  'piso',
  'despacho',
  'etiquetas',
  'herrajes',
  'documentos',
] as const;

export type HubTab = (typeof HUB_TABS)[number];

/**
 * Tabs fully implemented. (Kept for call sites that gate on readiness.)
 */
export const PRODUCTION_ORDER_TABS_READY: ReadonlySet<ProductionOrderTab> =
  new Set(PRODUCTION_ORDER_TABS);

export function isProductionOrderTab(value: string): value is ProductionOrderTab {
  return (PRODUCTION_ORDER_TABS as readonly string[]).includes(value);
}

export function parseProductionOrderTab(
  value: string | null | undefined,
): ProductionOrderTab {
  // Legacy URL: /produccion/:id/exports → Documentos
  if (value === 'exports') return 'documentos';
  if (value && isProductionOrderTab(value)) return value;
  return 'resumen';
}

/** True when project status may open the factory hub. */
export function projectAllowsProductionOrder(project: Project): boolean {
  return isProductionQueueStatus(project.status);
}

export type ProductionOrderReadiness = {
  /** generateCutRows succeeded (may still be empty). */
  readonly cutListOk: boolean;
  /** Error message when cutListOk is false. */
  readonly cutListError: string | null;
  readonly cutRowCount: number;
  /** Sum of item quantities. */
  readonly moduleUnitCount: number;
  /** Number of line items. */
  readonly moduleLineCount: number;
  /** Cut list ok and at least one board part. */
  readonly materialsResolved: boolean;
  /** kitchenLayout present with at least one wall (any space). */
  readonly hasKitchenLayout: boolean;
  /** At least one placement on the layout. */
  readonly hasPlacements: boolean;
  /**
   * Layout check for "ready to cut":
   * - no layout → OK (obra lineal / sin muros)
   * - layout with walls → OK even if unplaced (warn separately)
   */
  readonly layoutCheckOk: boolean;
  readonly optimizerGenerable: boolean;
  readonly packGenerable: boolean;
  /** All hard checks green (layout optional path included). */
  readonly readyToCut: boolean;
  /** Soft warning: layout exists but some items unplaced. */
  readonly hasUnplacedItems: boolean;
};

function kitchenWallCount(project: Project): number {
  const layout = project.kitchenLayout;
  if (!layout) return 0;
  if (layout.spaces && layout.spaces.length > 0) {
    return layout.spaces.reduce((n, s) => n + (s.walls?.length ?? 0), 0);
  }
  return layout.walls?.length ?? 0;
}

function kitchenPlacementCount(project: Project): number {
  const layout = project.kitchenLayout;
  if (!layout) return 0;
  if (layout.spaces && layout.spaces.length > 0) {
    return layout.spaces.reduce((n, s) => n + (s.placements?.length ?? 0), 0);
  }
  return layout.placements?.length ?? 0;
}

/**
 * Build readiness checklist for the OP hub.
 * `cutRows` null means domain failed to resolve cut list.
 */
export function buildProductionOrderReadiness(input: {
  readonly project: Project;
  readonly cutRows: readonly ProductionCutRow[] | null;
  readonly cutListError?: string | null;
}): ProductionOrderReadiness {
  const { project, cutRows } = input;
  const cutListOk = cutRows !== null;
  const cutRowCount = cutRows?.length ?? 0;
  const moduleLineCount = project.items.length;
  const moduleUnitCount = project.items.reduce(
    (sum, item) => sum + (item.quantity > 0 ? item.quantity : 0),
    0,
  );
  const wallCount = kitchenWallCount(project);
  const placementCount = kitchenPlacementCount(project);
  const hasKitchenLayout = wallCount > 0;
  const hasPlacements = placementCount > 0;
  const layoutCheckOk = true; // soft: never block cut on layout (doc §6.1 soft checks)
  const materialsResolved = cutListOk && cutRowCount > 0;
  const optimizerGenerable = materialsResolved;
  const packGenerable = optimizerGenerable;
  const readyToCut =
    cutListOk && materialsResolved && optimizerGenerable && layoutCheckOk;

  const placedItemIds = new Set<string>();
  const layout = project.kitchenLayout;
  if (layout) {
    const placements =
      layout.spaces && layout.spaces.length > 0
        ? layout.spaces.flatMap((s) => s.placements ?? [])
        : (layout.placements ?? []);
    for (const p of placements) {
      if (p.itemId) placedItemIds.add(p.itemId);
    }
  }
  const hasUnplacedItems =
    hasKitchenLayout &&
    project.items.some((item) => !placedItemIds.has(item.id));

  return {
    cutListOk,
    cutListError: cutListOk
      ? null
      : (input.cutListError?.trim() || 'No se pudo resolver el despiece de corte'),
    cutRowCount,
    moduleUnitCount,
    moduleLineCount,
    materialsResolved,
    hasKitchenLayout,
    hasPlacements,
    layoutCheckOk,
    optimizerGenerable,
    packGenerable,
    readyToCut,
    hasUnplacedItems,
  };
}

/** Roadmap issue refs for placeholder tabs (no wrong interpretations). */
export const PRODUCTION_ORDER_TAB_ROADMAP: Readonly<
  Partial<Record<ProductionOrderTab, string>>
> = {};
