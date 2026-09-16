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
 *
 * Storage is the browser's localStorage: browser-local, never shared with
 * other users or devices. Saving NEVER silently degrades: the caller learns
 * whether the write really happened so the UI can distinguish "guardado"
 * from "sólo disponible en esta pantalla".
 */

const RELEASE_CUT_PLANS_KEY = 'granete_release_cut_plans_v1';

export interface ReleaseCutPlanScope {
  readonly organizationId: string;
}

/**
 * Honest save outcome:
 * - `saved`: the plan is durably in this browser's storage.
 * - `memory-only`: the write could not be performed (storage unavailable or
 *   quota exceeded). The plan survives only in the caller's in-memory state;
 *   the UI must say so — never report a success that did not happen.
 */
export type ReleaseCutPlanSaveResult =
  | { readonly kind: 'saved' }
  | { readonly kind: 'memory-only'; readonly reason: string };

function storageKey(scope: ReleaseCutPlanScope, projectId: string, releaseId: string): string {
  return `${scope.organizationId}:${projectId}:${releaseId}`;
}

function readStore(): Record<string, CutPlan> | null {
  try {
    const raw = globalThis.localStorage?.getItem(RELEASE_CUT_PLANS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, CutPlan>) : {};
  } catch {
    return null;
  }
}

function writeStore(store: Record<string, CutPlan>): ReleaseCutPlanSaveResult {
  // No optional chaining: an unavailable localStorage must surface as a
  // failure, not vanish. The plan stays usable in memory — but "usable in
  // memory" is not "saved", and the caller must be able to say the difference.
  if (typeof globalThis.localStorage === 'undefined') {
    return {
      kind: 'memory-only',
      reason: 'este navegador no expone almacenamiento local',
    };
  }
  try {
    globalThis.localStorage.setItem(RELEASE_CUT_PLANS_KEY, JSON.stringify(store));
    return { kind: 'saved' };
  } catch (err) {
    return {
      kind: 'memory-only',
      reason:
        err instanceof Error && err.name === 'QuotaExceededError'
          ? 'el almacenamiento del navegador está lleno'
          : 'el navegador rechazó la escritura',
    };
  }
}

export function loadReleaseCutPlan(
  scope: ReleaseCutPlanScope,
  projectId: string,
  releaseId: string,
): CutPlan | null {
  const store = readStore();
  if (!store) return null;
  const plan = store[storageKey(scope, projectId, releaseId)];
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
): ReleaseCutPlanSaveResult {
  if (plan.releaseBase?.releaseId !== releaseId) {
    throw new Error('El plan no lleva el pin de esta liberación; regenerá el plan antes de guardarlo');
  }
  const store = readStore() ?? {};
  store[storageKey(scope, projectId, releaseId)] = plan;
  return writeStore(store);
}
