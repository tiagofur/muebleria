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
import type { MaterialRequirementsSnapshot } from './materialPlanning';
import {
  releaseAuthorityOf,
  type ProductionReleaseAuthority,
} from './releaseAuthority';

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
 * Whether the project's frozen material requirements are CORRELATED with the
 * exact canonical release authority being projected (#738 review): they must
 * have been derived from THAT release (matching releaseId) and carry its
 * manufacturing BOM fingerprint. Requirements from another release, without
 * identity, or with an incompatible fingerprint are real progress of ANOTHER
 * context — the current release's stage must not inherit them (the evidence
 * stays untouched; it simply doesn't advance this authority).
 */
export function materialEvidenceCorrelatesWithRelease(
  requirements: MaterialRequirementsSnapshot | undefined,
  authority: ProductionReleaseAuthority,
): boolean {
  if (!requirements?.releaseId || requirements.releaseId !== authority.releaseId) {
    return false;
  }
  if (
    authority.manufacturingFingerprint &&
    requirements.bomFingerprint !== authority.manufacturingFingerprint
  ) {
    return false;
  }
  return true;
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
 *    authorizes materials nor starts fabrication — only material evidence
 *    CORRELATED with the exact release advances the obra past `ingenieria`
 *    (see materialEvidenceCorrelatesWithRelease): frozen requirements
 *    derived from that release (→ `almacen`) plus the audited material
 *    authorization stamp (→ `produccion`). Evidence of another release, or
 *    a legacy per-project stamp without correlation, never advances the
 *    current authority (#740 owns the durable completion).
 * 3. The legacy chain applies ONLY to positively identified pre-Digital
 *    Thread context (`hasDigitalThreadContext === false`, set by the
 *    server on API reads and by the local producers for the DT-free local
 *    tool). A modern project (`=== true`) with a residual accepted/produced
 *    stamp and no release fails closed, and so does UNKNOWN provenance
 *    (`undefined` = a payload nobody vouched for): commercial acceptance
 *    never substitutes a release (#642/#673/#697).
 */
export function projectProcessStage(project: Project): ProjectProcessStage {
  if (project.cancelledAt) return 'ventas';
  const authority = releaseAuthorityOf(project);
  if (authority?.source === 'canonical') {
    const correlated = materialEvidenceCorrelatesWithRelease(
      project.materialPlanning?.requirements,
      authority,
    );
    if (correlated && project.materialsRelease) return 'produccion';
    if (correlated) return 'almacen';
    return 'ingenieria';
  }
  if (project.hasDigitalThreadContext !== false) return 'ventas';
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
 * positively identified pre-Digital-Thread legacy flow only (engineering
 * already sent it and materials weren't released yet). A canonical release
 * is not legacy material evidence — material authorization for a release is
 * durable evidence (#740) — and unknown provenance fails closed.
 */
export function canReleaseMaterials(project: Project): boolean {
  // A canonical obra never receives the legacy per-project stamp — material
  // authorization for a release is durable release-scoped evidence (#740),
  // and an uncorrelated legacy log doesn't turn the stamp applicable.
  if (releaseAuthorityOf(project)?.source === 'canonical') return false;
  return (
    project.hasDigitalThreadContext === false &&
    (project.status === 'accepted' || project.status === 'produced') &&
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
