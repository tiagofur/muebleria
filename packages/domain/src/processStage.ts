/**
 * Process stage — sequential gating of a project across the workshop areas
 * (ventas → ingeniería → almacén → producción).
 *
 * A project appears in each area's work queue ONLY when the previous stage
 * is done; it never shows everywhere at once (project-lifecycle.md):
 *
 * - ventas:      draft/quoted — still commercial, not in any workshop queue.
 * - ingeniería:  accepted but engineering hasn't sent it to production yet.
 * - almacén:     engineering sent it (sentToProductionAt) but materials are
 *                not released yet.
 * - producción:  warehouse released materials (materialsRelease) — it can be
 *                fabricated.
 */

import type { Project } from './types';

/** Stage of a project along the workshop process. */
export type ProjectProcessStage =
  | 'ventas'
  | 'ingenieria'
  | 'almacen'
  | 'produccion';

/**
 * Explicit "materials complete" stamp set by Almacén to release a project
 * to the production floor. Audit-friendly: who and when.
 */
export interface MaterialsRelease {
  /** User id who marked the materials as complete. */
  readonly releasedBy: string;
  /** When the materials were released (ISO 8601). */
  readonly releasedAt: string;
}

/**
 * Derive the current process stage of a project.
 *
 * Cancelled projects are not special-cased here — callers exclude them from
 * work queues the same way they do today.
 */
export function projectProcessStage(project: Project): ProjectProcessStage {
  if (project.status !== 'accepted' && project.status !== 'produced') {
    return 'ventas';
  }
  if (!project.engineeringLog?.sentToProductionAt) return 'ingenieria';
  if (!project.materialsRelease) return 'almacen';
  return 'produccion';
}

/** Projects currently in a given process stage (unchanged order). */
export function filterProjectsByProcessStage(
  projects: readonly Project[],
  stage: ProjectProcessStage,
): Project[] {
  return projects.filter((p) => projectProcessStage(p) === stage);
}

/**
 * Whether Almacén can release the project's materials to production:
 * engineering already sent it and materials weren't released yet.
 */
export function canReleaseMaterials(project: Project): boolean {
  return (
    (project.status === 'accepted' || project.status === 'produced') &&
    Boolean(project.engineeringLog?.sentToProductionAt) &&
    !project.materialsRelease
  );
}

/**
 * Whether a project is ready for the production floor. Each prior phase
 * (ventas → ingeniería → almacén) already filters its own queue; only the
 * Almacén release stamp is needed to gate production visibility.
 */
export function isProductionReady(project: Project): boolean {
  return (
    (project.status === 'accepted' || project.status === 'produced') &&
    Boolean(project.materialsRelease)
  );
}

/** Spanish labels for the process stages. */
export const PROCESS_STAGE_LABELS_ES: Readonly<Record<ProjectProcessStage, string>> = {
  ventas: 'Ventas',
  ingenieria: 'Ingeniería',
  almacen: 'Almacén',
  produccion: 'Producción',
};
