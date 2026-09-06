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
