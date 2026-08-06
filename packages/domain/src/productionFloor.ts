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
    installed: 0,
  };
  for (const item of project.items) {
    counts[normalizeItemFloorStatus(item.floorStatus)] += 1;
  }
  return counts;
}
