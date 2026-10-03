import { useQuery } from '@tanstack/react-query';

import { breakdownFromApi } from '@granete/storage';
import type { Project, QuoteBreakdown } from '@granete/domain';

import { calcProjectBreakdownWithProfileDemand } from '@granete/domain';

interface CatalogLike {
  readonly modules: readonly { readonly id: string }[];
}

/**
 * Speculative fetches must never produce console noise: the browser logs a
 * NATIVE console.error for any non-2xx response, and several gate surfaces
 * are console-strict. The local mirror is the parity mirror of the served
 * calculation — a project it cannot compute is exactly one the server would
 * answer 400, so it is skipped instead of fetched.
 */
export function locallyComputable(
  project: Project,
  catalog: CatalogLike | undefined,
): boolean {
  if (!catalog) return false;
  try {
    calcProjectBreakdownWithProfileDemand(project, catalog as never);
    return true;
  } catch {
    return false;
  }
}

/**
 * #989 slice 2: demand-priced estimates for the project cards. Quote-less
 * drafts have no frozen snapshot, so their card estimate was local
 * manual-lines-only while the backend quote already priced the governed
 * joinery demand — the card under-priced exactly the hardware the factory
 * now resolves. This hook fetches the EXISTING server calculation
 * (POST /projects/{id}/calculate, demand-priced since the commercial merge)
 * lazily per quote-less project, cached per server-truth fingerprint. No new
 * server surface; the selected-project detail keeps its own frozen-authority
 * flow untouched.
 */

export type ProjectsServerEstimatesStatus = 'idle' | 'loading' | 'ready' | 'partial-error' | 'error';

export interface ProjectsServerEstimates {
  /** projectId → served breakdown. Only successfully fetched projects appear. */
  readonly estimates: Readonly<Record<string, QuoteBreakdown>>;
  readonly status: ProjectsServerEstimatesStatus;
}

interface ServerEstimatesDeps {
  readonly projects: readonly Project[];
  readonly catalog: CatalogLike | undefined;
  readonly enabled: boolean;
  readonly token: string;
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

/** Quote-less projects are the ones whose card estimate comes from the live
 * calculation; projects with a frozen snapshot already carry the demand. */
export function quoteLessProjects(
  projects: readonly Project[],
  catalog: CatalogLike | undefined,
): Project[] {
  return projects.filter(
    (project) => !project.priceSnapshot && locallyComputable(project, catalog),
  );
}

export function estimateStatus(failures: number, total: number): ProjectsServerEstimatesStatus {
  if (failures === 0) return 'ready';
  return failures === total ? 'error' : 'partial-error';
}

export async function fetchProjectBreakdown(
  baseUrl: string,
  token: string,
  projectId: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<QuoteBreakdown> {
  const res = await fetchImpl(`${baseUrl}/projects/${projectId}/calculate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal,
  });
  if (!res.ok) {
    throw new Error(`calculate ${projectId}: HTTP ${res.status}`);
  }
  return breakdownFromApi((await res.json()) as Record<string, unknown>);
}

export function useProjectsServerEstimates(deps: ServerEstimatesDeps): ProjectsServerEstimates {
  const { projects, catalog, enabled, token, baseUrl, fetchImpl = globalThis.fetch } = deps;
  const targets = quoteLessProjects(projects, catalog);

  const query = useQuery({
    // The fingerprint pins the served truth: any project edit (updatedAt) or
    // membership change re-keys the query; stale responses die with their key.
    queryKey: [
      'projects-server-estimates',
      token ? 'auth' : 'guest',
      targets.map((project) => [project.id, project.updatedAt]),
    ],
    enabled: enabled && targets.length > 0,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const settled = await Promise.allSettled(
        targets.map((project) =>
          fetchProjectBreakdown(baseUrl, token, project.id, fetchImpl, signal),
        ),
      );
      const estimates: Record<string, QuoteBreakdown> = {};
      let failures = 0;
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          estimates[targets[index]!.id] = result.value;
        } else {
          failures += 1;
        }
      });
      return { estimates, failures, total: targets.length };
    },
  });

  if (!enabled || targets.length === 0) {
    return { estimates: {}, status: 'idle' };
  }
  if (query.isPending) return { estimates: {}, status: 'loading' };
  if (query.isError) return { estimates: {}, status: 'error' };

  const data = query.data ?? { estimates: {}, failures: 0, total: targets.length };
  return { estimates: data.estimates, status: estimateStatus(data.failures, data.total) };
}
