/**
 * Production scope filter by KitchenSpace (PROD-4.4 / #242).
 * Filters UI lists; full-project Optimizer export remains default.
 */

import type { Project } from './types';
import { ensureKitchenSpaces } from './kitchenLayout';

export type ProductionSpaceOption = {
  readonly id: string;
  readonly name: string;
  readonly itemCount: number;
};

export const PRODUCTION_SCOPE_ALL = 'all' as const;

/**
 * List spaces for OP filter. Empty when layout has no multi-space setup
 * worth filtering (0–1 spaces with no distinct content).
 */
export function listProductionSpaceOptions(
  project: Project,
): readonly ProductionSpaceOption[] {
  const layout = project.kitchenLayout;
  if (!layout) return [];
  const ensured = ensureKitchenSpaces(layout);
  const spaces = ensured.spaces ?? [];
  if (spaces.length < 2) return [];

  return spaces.map((space) => {
    const itemIds = new Set(space.placements.map((p) => p.itemId));
    return {
      id: space.id,
      name: space.name?.trim() || 'Ambiente',
      itemCount: [...itemIds].filter((id) =>
        project.items.some((it) => it.id === id),
      ).length,
    };
  });
}

/**
 * Item ids placed in a space (wall or free in that space).
 * Empty set if space unknown.
 */
export function itemIdsForProductionSpace(
  project: Project,
  spaceId: string,
): ReadonlySet<string> {
  const layout = project.kitchenLayout;
  if (!layout) return new Set();
  const ensured = ensureKitchenSpaces(layout);
  const space = (ensured.spaces ?? []).find((s) => s.id === spaceId);
  if (!space) return new Set();
  return new Set(
    space.placements
      .map((p) => p.itemId)
      .filter((id) => project.items.some((it) => it.id === id)),
  );
}

/**
 * Items not placed in any space (only meaningful when multi-space).
 */
export function unplacedItemIdsForProduction(project: Project): ReadonlySet<string> {
  const layout = project.kitchenLayout;
  if (!layout) return new Set(project.items.map((i) => i.id));
  const ensured = ensureKitchenSpaces(layout);
  const placed = new Set<string>();
  for (const space of ensured.spaces ?? []) {
    for (const p of space.placements) {
      placed.add(p.itemId);
    }
  }
  // Also count top-level placements if any
  for (const p of ensured.placements ?? []) {
    placed.add(p.itemId);
  }
  return new Set(
    project.items.filter((it) => !placed.has(it.id)).map((it) => it.id),
  );
}

/**
 * Project view with items filtered to a space (or unchanged for "all").
 * Kitchen layout walls/placements filtered to that space for elevations/planta.
 */
export function projectScopedToProductionSpace(
  project: Project,
  spaceId: string | typeof PRODUCTION_SCOPE_ALL,
): Project {
  if (spaceId === PRODUCTION_SCOPE_ALL || !spaceId) {
    return project;
  }
  const layout = project.kitchenLayout;
  if (!layout) return project;
  const ensured = ensureKitchenSpaces(layout);
  const space = (ensured.spaces ?? []).find((s) => s.id === spaceId);
  if (!space) return project;

  const itemIds = itemIdsForProductionSpace(project, spaceId);
  return {
    ...project,
    items: project.items.filter((it) => itemIds.has(it.id)),
    kitchenLayout: {
      ...ensured,
      walls: space.walls,
      placements: space.placements,
      spaces: [space],
      activeSpaceId: space.id,
      underlay: space.underlay,
      baseClearanceMm: space.baseClearanceMm ?? ensured.baseClearanceMm,
      wallCabinetZMm: space.wallCabinetZMm ?? ensured.wallCabinetZMm,
      showCountertop: space.showCountertop ?? ensured.showCountertop,
    },
  };
}
