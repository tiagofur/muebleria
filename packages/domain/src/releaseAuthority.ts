/**
 * Release authority projection (#577 / OPS-DT-1).
 *
 * The operational Web must not gate on the legacy OC-022
 * `project.productionRelease` blob: the server resolves ONE release authority
 * per project — the canonical #395 ProductionRelease when one exists, the
 * legacy blob through the compatibility adapter otherwise — and exposes it as
 * the server-owned `resolved_production_release` projection on the project
 * read model. UI gates (canDerive, part-execution generation, process stage)
 * consume THIS projection; the server keeps enforcing the authority on every
 * command regardless of what the browser shows.
 */

export type ProductionReleaseAuthoritySource = 'canonical' | 'legacy';

/** Server-owned projection of the project's release authority. */
export interface ProductionReleaseAuthority {
  /** Which side of the compatibility seam won the resolution. */
  readonly source: ProductionReleaseAuthoritySource;
  readonly releaseId: string;
  readonly releaseNumber?: number;
  readonly designRevisionId?: string;
  readonly designRevisionNumber?: number;
  readonly quoteRevisionId?: string;
  readonly manufacturingFingerprint?: string;
  /**
   * #577: the exact canonical release froze the machine-neutral
   * routing/machining program (snapshot schema v2), so canonical physical
   * execution is authorized. Absent/false keeps surfacing the routing
   * blocker; legacy authorities never set it.
   */
  readonly frozenRouting?: boolean;
  readonly status?: string;
  readonly releasedBy?: string;
  readonly releasedAt?: string;
}

/** Inputs of {@link releaseAuthorityOf}. */
export type ReleaseAuthorityInput = {
  readonly resolvedProductionRelease?: ProductionReleaseAuthority;
  readonly productionRelease?: {
    readonly id: string;
    readonly designRevisionId?: string;
    readonly bomFingerprint?: string;
  };
};

/**
 * Resolve the release authority of a project from its read-model state:
 * the server projection wins (canonical or legacy as the server decided);
 * when the projection is absent (local mode / old payloads) the legacy blob
 * remains the compatibility fallback. `undefined` = no release authority.
 */
export function releaseAuthorityOf(
  project: ReleaseAuthorityInput,
): ProductionReleaseAuthority | undefined {
  if (project.resolvedProductionRelease) {
    return project.resolvedProductionRelease;
  }
  const legacy = project.productionRelease;
  if (legacy) {
    return {
      source: 'legacy',
      releaseId: legacy.id,
      designRevisionId: legacy.designRevisionId,
      manufacturingFingerprint: legacy.bomFingerprint,
    };
  }
  return undefined;
}

/**
 * Human-readable release label for operational surfaces (#577): the user sees
 * `Liberación #1 · Diseño R2` — never raw fingerprints or the legacy blob.
 */
export function releaseAuthorityLabel(
  project: ReleaseAuthorityInput,
): string {
  const authority = releaseAuthorityOf(project);
  if (!authority) return '';
  const releasePart =
    authority.releaseNumber !== undefined
      ? `Liberación #${authority.releaseNumber}`
      : 'Liberada';
  const designPart =
    authority.designRevisionNumber !== undefined
      ? ` · Diseño R${authority.designRevisionNumber}`
      : '';
  return `${releasePart}${designPart}`;
}

/**
 * #697 review — ONE production-access rule over the release authority.
 *
 * `Project.status = accepted|produced` is compatibility-only and applies
 * EXCLUSIVELY to projects positively identified as pre-Digital-Thread via
 * the server-owned `hasDigitalThreadContext` projection (bare project: no
 * FurnitureInstances, quote revisions, DT designs or canonical release). A
 * modern Digital Thread project with a residual accepted/produced stamp and no canonical
 * ProductionRelease fails closed — commercial acceptance is a precondition
 * for creating a release, never a substitute for having one (#642/#673).
 *
 * `hasDigitalThreadContext === undefined` (local mode / stale payloads
 * without the projection) fails closed. Compatibility requires an explicit
 * server-owned `false`; absence is not evidence that a project is pre-DT.
 */
export type ProductionAccessInput = ReleaseAuthorityInput & {
  readonly status?: string;
  readonly hasDigitalThreadContext?: boolean;
};

/**
 * THE shared production workspace access rule: a canonical ProductionRelease
 * (modern manufacturing authority) OR pre-DT compatibility. Every surface
 * (queue filter, order hub access) consumes this one helper — never a local
 * restatement.
 */
export function projectAllowsProductionAccess(
  project: ProductionAccessInput,
): boolean {
  if (releaseAuthorityOf(project)?.source === 'canonical') return true;
  return (
    project.hasDigitalThreadContext === false &&
    (project.status === 'accepted' || project.status === 'produced')
  );
}

/**
 * #741 PR 1 — work-release continuity signal.
 *
 * The latest release authority answers which release governs the project
 * NOW; the materialized executions answer which release OWNS the work in
 * progress. When the whole execution set pins a release OLDER than the
 * canonical authority there is a discontinuity no surface may resolve
 * implicitly: the server blocks the dangerous commands with the continuity
 * copy, and the operational UI informs the user (never retargets, never
 * offers automatic replacement).
 */
export interface ReleaseWorkContinuity {
  /** The release the materialized executions belong to (older release). */
  readonly workReleaseId: string;
  /** The current canonical authority (the newer release). */
  readonly authorityReleaseId: string;
  readonly authorityReleaseNumber?: number;
  /** Any completed/in-progress/rework operation or advanced unit exists. */
  readonly hasPhysicalProgress: boolean;
}

/** Inputs of {@link releaseWorkContinuityOf}. */
export type ReleaseWorkContinuityInput = ReleaseAuthorityInput & {
  readonly partInstances?: readonly {
    readonly productionRevision: string;
    readonly requiredOperations?: readonly { readonly status: string }[];
  }[];
  readonly moduleUnits?: readonly {
    readonly productionRevision: string;
    readonly status?: string;
  }[];
};

/**
 * Resolve the work-release continuity of a project: defined ONLY when a
 * canonical authority exists, executions are materialized, they ALL belong
 * to one release and that release is not the authority. Mixed or absent
 * provenance is `undefined` (the server keeps failing those closed per
 * target); executions matching the authority are the normal path.
 */
export function releaseWorkContinuityOf(
  project: ReleaseWorkContinuityInput,
): ReleaseWorkContinuity | undefined {
  const authority = releaseAuthorityOf(project);
  if (!authority || authority.source !== 'canonical') return undefined;
  const workReleases = new Set<string>();
  for (const part of project.partInstances ?? []) {
    if (part.productionRevision) workReleases.add(part.productionRevision);
  }
  for (const unit of project.moduleUnits ?? []) {
    if (unit.productionRevision) workReleases.add(unit.productionRevision);
  }
  if (workReleases.size !== 1) return undefined;
  const workReleaseId = [...workReleases][0];
  if (!workReleaseId || workReleaseId === authority.releaseId) return undefined;
  let hasPhysicalProgress = false;
  for (const part of project.partInstances ?? []) {
    for (const op of part.requiredOperations ?? []) {
      if (op.status === 'completed' || op.status === 'in_progress' || op.status === 'rework') {
        hasPhysicalProgress = true;
      }
    }
  }
  for (const unit of project.moduleUnits ?? []) {
    if (unit.status && unit.status !== 'awaiting_parts') hasPhysicalProgress = true;
  }
  return {
    workReleaseId,
    authorityReleaseId: authority.releaseId,
    authorityReleaseNumber: authority.releaseNumber,
    hasPhysicalProgress,
  };
}
