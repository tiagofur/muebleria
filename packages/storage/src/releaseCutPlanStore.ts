import type { CutPlan } from '@granete/domain';

/**
 * #739 — release-scoped cut plan persistence.
 *
 * The legacy project.cutPlan slot is a single blob per project; a canonical
 * obra needs one plan per EXACT release so switching liberations never mixes
 * results (acceptance: recargar recupera el plan con su base exacta; cambiar
 * release/organización/sesión no mezcla). Plans are stored keyed by
 * organization + project + release and always carry their releaseBase pin —
 * consumers must revalidate the pin before applying a stored plan.
 */

const RELEASE_CUT_PLANS_KEY = 'granete_release_cut_plans_v1';

export interface ReleaseCutPlanScope {
  readonly organizationId: string;
}

function storageKey(scope: ReleaseCutPlanScope, projectId: string, releaseId: string): string {
  return `${scope.organizationId}:${projectId}:${releaseId}`;
}

function readStore(): Record<string, CutPlan> {
  try {
    const raw = globalThis.localStorage?.getItem(RELEASE_CUT_PLANS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, CutPlan>) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, CutPlan>): void {
  try {
    globalThis.localStorage?.setItem(RELEASE_CUT_PLANS_KEY, JSON.stringify(store));
  } catch {
    // Quota/unavailable storage must not break the workspace; the plan stays
    // in memory for this session.
  }
}

export function loadReleaseCutPlan(
  scope: ReleaseCutPlanScope,
  projectId: string,
  releaseId: string,
): CutPlan | null {
  const plan = readStore()[storageKey(scope, projectId, releaseId)];
  // A stored plan without its exact base pin cannot prove provenance — treat
  // as absent rather than retarget it to the current release.
  if (!plan || !plan.releaseBase || plan.releaseBase.releaseId !== releaseId) return null;
  return plan;
}

export function saveReleaseCutPlan(
  scope: ReleaseCutPlanScope,
  projectId: string,
  releaseId: string,
  plan: CutPlan,
): void {
  if (plan.releaseBase?.releaseId !== releaseId) {
    throw new Error('El plan no lleva el pin de esta liberación; regenerá el plan antes de guardarlo');
  }
  const store = readStore();
  store[storageKey(scope, projectId, releaseId)] = plan;
  writeStore(store);
}
