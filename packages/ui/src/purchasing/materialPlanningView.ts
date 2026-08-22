/**
 * Pure view selectors for the material planning panel (OC-050..OC-054).
 * The shell hands projects + warehouse context; React only renders the
 * already-resolved evidence (coverage, gates) — no domain math in components.
 */

import {
  computeProjectMaterialCoverage,
  evaluateMaterialsReleaseReadiness,
  type MaterialPlanning,
  type MaterialStock,
  type MaterialsReleaseCheck,
  type ProjectMaterialLineCoverage,
  type Project,
  type PurchaseOrder,
  type StockMaterialKind,
} from '@muebles/domain';

/** Resolved evidence for one project's planning card. */
export interface MaterialPlanningCardView {
  readonly projectId: string;
  /** True when the processStage stamp (materialsRelease) is set. */
  readonly released: boolean;
  readonly requirementsDerived: boolean;
  /** False when the obra has no production release → derive is impossible. */
  readonly canDerive: boolean;
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
  return {
    projectId: project.id,
    released: Boolean(project.materialsRelease),
    requirementsDerived: (planning?.requirements?.lines.length ?? 0) > 0,
    canDerive: Boolean(project.productionRelease),
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
