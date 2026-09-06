/**
 * Pure view selectors for the material planning panel (OC-050..OC-054).
 * The shell hands projects + warehouse context; React only renders the
 * already-resolved evidence (coverage, gates) — no domain math in components.
 */

import {
  computeProjectMaterialCoverage,
  evaluateMaterialsReleaseReadiness,
  releaseAuthorityOf,
  type MaterialPlanning,
  type MaterialStock,
  type MaterialsReleaseCheck,
  type ProjectMaterialLineCoverage,
  type Project,
  type ProductionReleaseAuthority,
  type PurchaseOrder,
  type StockMaterialKind,
} from '@granete/domain';

/** Resolved evidence for one project's planning card. */
export interface MaterialPlanningCardView {
  readonly projectId: string;
  /** True when the processStage stamp (materialsRelease) is set. */
  readonly released: boolean;
  readonly requirementsDerived: boolean;
  /**
   * False when the obra has no release authority → derive is impossible.
   * Server-owned projection first (#577): a canonical ProductionRelease
   * unlocks the derive without any legacy liberation.
   */
  readonly canDerive: boolean;
  /** Release authority backing the panel (canonical or legacy), when any. */
  readonly releaseAuthority: ProductionReleaseAuthority | undefined;
  /**
   * Human-readable provenance of the derived requirements (#577): which
   * exact release/revision the snapshot was bound to. Technical detail
   * (fingerprint/ids) travels in `detail`.
   */
  readonly provenance: { readonly label: string; readonly detail: string } | undefined;
  readonly lineCount: number;
  readonly coverage: readonly ProjectMaterialLineCoverage[];
  readonly releaseChecks: readonly MaterialsReleaseCheck[];
  readonly releaseReady: boolean;
  readonly shortageLines: readonly ProjectMaterialLineCoverage[];
}

export function materialPlanningCardView(
  project: Project,
  plannings: readonly MaterialPlanning[],
  stock: readonly MaterialStock[],
  purchaseOrders: readonly PurchaseOrder[],
): MaterialPlanningCardView {
  const planning = plannings.find((p) => p.projectId === project.id);
  const coverage = computeProjectMaterialCoverage(project.id, {
    stock,
    plannings,
    purchaseOrders,
  });
  const { checks, ready } = evaluateMaterialsReleaseReadiness({
    planning,
    stock,
    plannings,
  });
  const releaseAuthority = releaseAuthorityOf(project);
  const requirements = planning?.requirements;
  let provenance: { label: string; detail: string } | undefined;
  if (requirements && requirements.lines.length > 0) {
    const releaseLabel =
      requirements.sourceProductionReleaseNumber !== undefined
        ? `Liberación #${requirements.sourceProductionReleaseNumber}`
        : requirements.releaseId
          ? `Liberación ${requirements.releaseId.slice(0, 8)}`
          : 'BOM liberado';
    const designLabel =
      requirements.sourceDesignRevisionNumber !== undefined
        ? `Diseño R${requirements.sourceDesignRevisionNumber}`
        : undefined;
    provenance = {
      label: designLabel ? `Derivado de ${releaseLabel} · ${designLabel}` : `Derivado de ${releaseLabel}`,
      detail: [
        requirements.releaseId ? `release ${requirements.releaseId}` : undefined,
        requirements.sourceDesignRevisionId ? `diseño ${requirements.sourceDesignRevisionId}` : undefined,
        requirements.sourceQuoteRevisionId ? `cotización ${requirements.sourceQuoteRevisionId}` : undefined,
        requirements.bomFingerprint ? `fingerprint ${requirements.bomFingerprint}` : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }
  return {
    projectId: project.id,
    released: Boolean(project.materialsRelease),
    requirementsDerived: (planning?.requirements?.lines.length ?? 0) > 0,
    canDerive: releaseAuthority !== undefined,
    releaseAuthority,
    provenance,
    lineCount: planning?.requirements?.lines.length ?? 0,
    coverage,
    releaseChecks: checks,
    releaseReady: ready,
    shortageLines: coverage.filter((line) => line.shortage > 0),
  };
}

/** Shortage lines as draft PO lines (OC-052: purchase from real need). */
export function shortagePoLines(
  view: MaterialPlanningCardView,
): readonly { kind: StockMaterialKind; materialId: string; quantity: number }[] {
  return view.shortageLines.map((line) => ({
    kind: line.kind,
    materialId: line.materialId,
    quantity: line.shortage,
  }));
}
