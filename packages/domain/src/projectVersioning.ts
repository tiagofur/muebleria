/**
 * Project versioning / history (#200).
 * Pure domain logic — no React, no storage.
 *
 * Snapshots capture the full project state at a point in time (status change
 * or manual save) so it can be restored later. Follows the same immutable
 * pattern as StructureRevision (#108).
 */

import type {
  Project,
  ProjectVersion,
  ProjectStatus,
} from './types';

/**
 * Current version number (normalizes legacy projects without version field).
 */
export function currentVersion(project: Project): number {
  return project.version ?? 1;
}

/**
 * Create a snapshot of the current project state and return the updated project
 * with the snapshot pushed onto its history.
 *
 * @param project - The project to snapshot
 * @param label   - Optional human-readable label (e.g. "Cotización enviada")
 */
export function snapshotProjectVersion(
  project: Project,
  label?: string,
): Project {
  const version = currentVersion(project);
  const snapshot: ProjectVersion = {
    version,
    name: project.name,
    status: project.status,
    items: project.items,
    projectLevelChoices: project.projectLevelChoices,
    measureDefaults: project.measureDefaults,
    kitchenLayout: project.kitchenLayout,
    notes: project.notes,
    priceSnapshot: project.priceSnapshot,
    snapshotAt: new Date().toISOString(),
    label,
  };

  // Prepend to history (newest first) and bump version.
  const history = project.history ?? [];
  return {
    ...project,
    version: version + 1,
    history: [snapshot, ...history],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Restore a project to a previous version. The current state is automatically
 * snapshotted before restore so nothing is lost.
 *
 * @param project        - The current project
 * @param targetVersion  - The version number to restore
 * @returns Updated project, or the original if version not found
 */
export function restoreProjectVersion(
  project: Project,
  targetVersion: number,
): Project {
  const history = project.history ?? [];
  const snapshot = history.find((h) => h.version === targetVersion);
  if (!snapshot) return project;

  // Snapshot current state first (auto-save before restore).
  const withSnapshot = snapshotProjectVersion(project, 'Antes de restaurar');

  return {
    ...withSnapshot,
    name: snapshot.name,
    status: snapshot.status,
    items: snapshot.items,
    projectLevelChoices: snapshot.projectLevelChoices,
    measureDefaults: snapshot.measureDefaults,
    kitchenLayout: snapshot.kitchenLayout,
    notes: snapshot.notes,
    priceSnapshot: snapshot.priceSnapshot,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Auto-snapshot on status transition. Returns the updated project with a
 * snapshot created if the status actually changed.
 */
export function snapshotOnStatusChange(
  project: Project,
  newStatus: ProjectStatus,
): Project {
  if (project.status === newStatus) return project;

  const label = statusTransitionLabel(project.status, newStatus);
  return snapshotProjectVersion(project, label);
}

/**
 * Human-readable label for a status transition.
 */
function statusTransitionLabel(
  from: ProjectStatus,
  to: ProjectStatus,
): string {
  const labels: Record<ProjectStatus, string> = {
    draft: 'Borrador',
    quoted: 'Cotizado',
    accepted: 'Aceptado',
    produced: 'Producido',
  };
  return `${labels[from]} → ${labels[to]}`;
}

/**
 * Compute a summary diff between two project versions for display.
 */
export function diffVersions(
  older: ProjectVersion,
  newer: ProjectVersion,
): {
  readonly itemAdded: boolean;
  readonly itemRemoved: boolean;
  readonly itemChanged: boolean;
  readonly statusChanged: boolean;
  readonly notesChanged: boolean;
} {
  const olderIds = new Set(older.items.map((i) => i.id));
  const newerIds = new Set(newer.items.map((i) => i.id));

  const itemAdded = newer.items.length > older.items.length;
  const itemRemoved = older.items.length > newer.items.length;
  const itemChanged = older.items.some((oi) => {
    const ni = newer.items.find((n) => n.id === oi.id);
    return !ni || JSON.stringify(ni) !== JSON.stringify(oi);
  });

  return {
    itemAdded,
    itemRemoved,
    itemChanged,
    statusChanged: older.status !== newer.status,
    notesChanged: older.notes !== newer.notes,
  };
}
