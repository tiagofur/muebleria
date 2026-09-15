/**
 * Process stage — sequential gating of a project across the workshop areas
 * (ventas → ingeniería → almacén → producción).
 *
 * A project appears in each area's work queue ONLY when the previous stage
 * is done; it never shows everywhere at once (project-lifecycle.md):
 *
 * - ventas:      still commercial, not in any workshop queue.
 * - ingeniería:  preparation available — a canonical ProductionRelease (#738)
 *                or, pre-Digital-Thread, an accepted obra engineering hasn't
 *                sent to production yet.
 * - almacén:     (legacy flow) engineering sent it (sentToProductionAt) but
 *                materials are not released yet.
 * - producción:  (legacy flow) warehouse released materials.
 */

import type { Project } from './types';
import { releaseAuthorityOf } from './releaseAuthority';

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
 * Whether the LEGACY OC-022 engineering handshake already sent this project
 * to production (`engineeringLog.sentToProductionAt`).
 *
 * #738: a canonical ProductionRelease is NOT interpreted as a legacy send in
 * this projection. Releasing P1 is the manufacturing authority (#577 /
 * projectAllowsProductionAccess) — it enables engineering preparation for the
 * released content, but it neither completes engineering nor authorizes
 * materials. Durable per-release completion is #740; until then a canonical
 * obra stays honestly in the engineering stage instead of skipping to
 * Almacén/Producción.
 */
export function sentToProduction(project: Project): boolean {
  return Boolean(project.engineeringLog?.sentToProductionAt);
}

/**
 * Derive the current process stage of a project.
 *
 * #738 — ONE shared entry rule:
 *
 * 1. A cancelled obra is never active workshop work (history stays
 *    queryable; queues exclude it).
 * 2. A canonical ProductionRelease puts the obra in `ingenieria` regardless
 *    of the legacy commercial stamp on Project.status: the release enables
 *    engineering preparation. P BY ITSELF neither completes engineering,
 *    authorizes materials nor starts fabrication — only EXPLICIT
 *    release-scoped material evidence advances a canonical obra past
 *    `ingenieria`: frozen requirements derived from the exact release
 *    (Almacén work started → `almacen`) and the audited material
 *    authorization stamp (`materialsRelease` → `produccion`). Durable
 *    per-release engineering completion is #740; a legacy per-project
 *    handshake log is never that evidence.
 * 3. Modern Digital Thread projects (positively `hasDigitalThreadContext`)
 *    with a residual accepted/produced stamp and NO release fail closed:
 *    commercial acceptance never substitutes a release (#642/#673/#697).
 * 4. Pre-Digital-Thread projects keep the legacy chain (accepted →
 *    engineering send → materials release). `hasDigitalThreadContext` is a
 *    server-owned projection always present in API mode; `undefined` means
 *    local mode, not a stale payload — the local legacy tool keeps working.
 */
export function projectProcessStage(project: Project): ProjectProcessStage {
  if (project.cancelledAt) return 'ventas';
  if (releaseAuthorityOf(project)?.source === 'canonical') {
    // Only release-correlated material evidence advances the obra: the
    // requirements snapshot can ONLY be derived through the release-scoped
    // command (the server rejects an implicit-latest derive), and the
    // release-scoped authorization writes the stamp on top of it. A bare
    // legacy stamp without derived frozen demand proves nothing about THIS
    // release.
    if (project.materialsRelease && project.materialPlanning?.requirements) {
      return 'produccion';
    }
    if (project.materialPlanning?.requirements) return 'almacen';
    return 'ingenieria';
  }
  if (project.hasDigitalThreadContext === true) return 'ventas';
  if (project.status !== 'accepted' && project.status !== 'produced') {
    return 'ventas';
  }
  if (!sentToProduction(project)) return 'ingenieria';
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
 * legacy flow only (engineering already sent it and materials weren't
 * released yet). A canonical release is not legacy material evidence —
 * material authorization for a release is durable evidence (#740).
 */
export function canReleaseMaterials(project: Project): boolean {
  return (
    (project.status === 'accepted' || project.status === 'produced') &&
    project.hasDigitalThreadContext !== true &&
    sentToProduction(project) &&
    !project.materialsRelease
  );
}

/**
 * Whether a project is ready for the production floor. Each prior phase
 * (ventas → ingeniería → almacén) already filters its own queue; only the
 * Almacén release stamp is needed to gate production visibility (legacy
 * flow — canonical releases authorize through the release itself, #697).
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
