/**
 * Shop-floor progress per project line item (PROD-3.1 / #226).
 * Does not alter BOM or design — factory-only state.
 */

import type { Project, ProjectItem } from './types';

/** Ordered shop-floor pipeline for a line item. */
export const ITEM_FLOOR_STATUSES = [
  'pending',
  'cut',
  'edged',
  'assembled',
  'packaged',
  'loaded',
  'installed',
] as const;

export type ItemFloorStatus = (typeof ITEM_FLOOR_STATUSES)[number];

export const ITEM_FLOOR_STATUS_LABELS_ES: Readonly<
  Record<ItemFloorStatus, string>
> = {
  pending: 'Pendiente',
  cut: 'Cortado',
  edged: 'Encintado',
  assembled: 'Armado',
  packaged: 'Embalado',
  loaded: 'Cargado',
  installed: 'Instalado',
};

export function isItemFloorStatus(value: string): value is ItemFloorStatus {
  return (ITEM_FLOOR_STATUSES as readonly string[]).includes(value);
}

export function normalizeItemFloorStatus(
  value: string | null | undefined,
): ItemFloorStatus {
  if (value && isItemFloorStatus(value)) return value;
  return 'pending';
}

/** Next status in the pipeline, or null if already installed. */
export function nextItemFloorStatus(
  current: ItemFloorStatus | undefined,
): ItemFloorStatus | null {
  const cur = normalizeItemFloorStatus(current);
  const idx = ITEM_FLOOR_STATUSES.indexOf(cur);
  if (idx < 0 || idx >= ITEM_FLOOR_STATUSES.length - 1) return null;
  return ITEM_FLOOR_STATUSES[idx + 1]!;
}

/**
 * Set floor status for one project item. No-op if item missing or status invalid.
 * Updates `updatedAt` so production revision heuristics can detect plant activity
 * separately from design (callers may pass prior updatedAt if desired).
 */
export function setProjectItemFloorStatus(
  project: Project,
  itemId: string,
  status: ItemFloorStatus,
  updatedAt?: string,
): Project {
  if (!isItemFloorStatus(status)) return project;
  let changed = false;
  const items = project.items.map((item): ProjectItem => {
    if (item.id !== itemId) return item;
    const prev = normalizeItemFloorStatus(item.floorStatus);
    if (prev === status) return item;
    changed = true;
    return { ...item, floorStatus: status };
  });
  if (!changed) return project;
  return {
    ...project,
    items,
    updatedAt: updatedAt ?? new Date().toISOString(),
  };
}

/** Counts per status for hub summary. */
export function countFloorStatuses(
  project: Project,
): Record<ItemFloorStatus, number> {
  const counts: Record<ItemFloorStatus, number> = {
    pending: 0,
    cut: 0,
    edged: 0,
    assembled: 0,
    packaged: 0,
    loaded: 0,
    installed: 0,
  };
  for (const item of project.items) {
    counts[normalizeItemFloorStatus(item.floorStatus)] += 1;
  }
  return counts;
}

/**
 * Whether all items in the project have reached at least 'packaged' (or 'loaded'/'installed').
 */
export function allModulesPackaged(project: Project): boolean {
  if (project.items.length === 0) return false;
  return project.items.every((item) => {
    const s = normalizeItemFloorStatus(item.floorStatus);
    return s === 'packaged' || s === 'loaded' || s === 'installed';
  });
}

/**
 * Whether all items in the project have reached at least 'loaded' (or 'installed').
 */
export function allModulesLoaded(project: Project): boolean {
  if (project.items.length === 0) return false;
  return project.items.every((item) => {
    const s = normalizeItemFloorStatus(item.floorStatus);
    return s === 'loaded' || s === 'installed';
  });
}

export type LoadingProgressResult = {
  readonly totalUnits: number;
  readonly loadedUnits: number;
  readonly percentage: number;
  readonly isComplete: boolean;
  readonly totalPackages?: number;
  readonly packagedPackages?: number;
  readonly loadedPackages?: number;
  readonly installedPackages?: number;
  readonly packagingPercentage?: number;
  readonly loadingPercentage?: number;
  readonly allPackaged?: boolean;
  readonly allLoaded?: boolean;
  readonly canReleaseToDelivery?: boolean;
};

export type LoadingProgress = LoadingProgressResult;

/**
 * Calculate progress of physical units loaded onto dispatch/freight.
 */
export function calculateLoadingProgress(
  project: Project,
): LoadingProgressResult {
  let totalUnits = 0;
  let packagedUnits = 0;
  let loadedUnits = 0;
  let installedUnits = 0;

  for (const item of project.items) {
    const qty = Math.max(1, Math.floor(item.quantity || 1));
    totalUnits += qty;
    const s = normalizeItemFloorStatus(item.floorStatus);
    if (s === 'packaged' || s === 'loaded' || s === 'installed') {
      packagedUnits += qty;
    }
    if (s === 'loaded' || s === 'installed') {
      loadedUnits += qty;
    }
    if (s === 'installed') {
      installedUnits += qty;
    }
  }

  const loadingPercentage =
    totalUnits > 0 ? Math.round((loadedUnits / totalUnits) * 100) : 0;
  const packagingPercentage =
    totalUnits > 0 ? Math.round((packagedUnits / totalUnits) * 100) : 0;
  const allPack = totalUnits > 0 && packagedUnits === totalUnits;
  const allLoad = totalUnits > 0 && loadedUnits === totalUnits;

  return {
    totalUnits,
    loadedUnits,
    percentage: loadingPercentage,
    isComplete: allLoad,
    totalPackages: totalUnits,
    packagedPackages: packagedUnits,
    loadedPackages: loadedUnits,
    installedPackages: installedUnits,
    packagingPercentage,
    loadingPercentage,
    allPackaged: allPack,
    allLoaded: allLoad,
    canReleaseToDelivery: allLoad,
  };
}
