import { useQuery, type QueryKey } from '@tanstack/react-query';
import {
  GraneteApiClient,
  type ReleaseEngineeringState as GeneratedReleaseEngineeringState,
} from '@granete/storage';

/**
 * #740 — the durable per-release Engineering state of the EXACT pinned
 * release, read through the generated client
 * (getProjectProductionReleaseEngineering). Reading never writes; the
 * commands below are the only writers and they are explicit user actions.
 */

export type EngineeringStatePhase = 'pending' | 'in_progress' | 'completed';

export interface EngineeringStateView {
  readonly releaseId: string;
  readonly phase: EngineeringStatePhase;
  readonly version: number;
  readonly startedBy: string | null;
  readonly startedAt: string | null;
  readonly completedBy: string | null;
  readonly completedAt: string | null;
}

export type EngineeringStateContext =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly retry: () => void }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly retry: () => void;
    }
  | {
      readonly kind: 'ready';
      readonly state: EngineeringStateView;
      readonly retry: () => void;
    };

export function engineeringStateQueryKey(
  scope: readonly unknown[],
  projectId: string,
  releaseId: string,
): QueryKey {
  return [...scope, 'projects', projectId, 'production-releases', releaseId, 'engineering-state'];
}

/** Normalize the generated snake_case contract into the domain view. */
export function engineeringStateViewFromApi(
  raw: GeneratedReleaseEngineeringState,
): EngineeringStateView {
  return {
    releaseId: raw.release_id,
    phase: raw.status,
    version: raw.version,
    startedBy: raw.started_by ?? null,
    startedAt: raw.started_at ?? null,
    completedBy: raw.completed_by ?? null,
    completedAt: raw.completed_at ?? null,
  };
}

export async function fetchEngineeringState(args: {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string;
  readonly releaseId: string;
  readonly signal?: AbortSignal;
}): Promise<EngineeringStateView> {
  const client = new GraneteApiClient(args.baseUrl);
  const raw = await client.getProjectProductionReleaseEngineering(
    args.token,
    args.projectId,
    args.releaseId,
    args.signal,
  );
  if (raw.release_id !== args.releaseId) {
    throw new Error('El estado de Ingeniería no corresponde a la liberación solicitada');
  }
  return engineeringStateViewFromApi(raw);
}

export function useEngineeringState(args: {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly projectId: string | null;
  readonly releaseId: string | null;
  readonly queryKey: QueryKey;
}): EngineeringStateContext {
  const query = useQuery({
    queryKey: args.queryKey,
    queryFn: ({ signal }) =>
      fetchEngineeringState({
        baseUrl: args.baseUrl,
        token: args.token as string,
        projectId: args.projectId as string,
        releaseId: args.releaseId as string,
        signal,
      }),
    enabled: Boolean(args.token && args.projectId && args.releaseId),
    retry: false,
  });

  const retry = () => void query.refetch();
  if (!args.projectId || !args.token || !args.releaseId) {
    return { kind: 'idle' };
  }
  if (query.isPending) return { kind: 'loading', retry };
  if (query.isError || !query.data) {
    return {
      kind: 'error',
      message:
        'No se pudo leer el estado de Ingeniería de esta liberación. Puede no estar disponible para tu taller.',
      retry,
    };
  }
  return { kind: 'ready', state: query.data, retry };
}

/**
 * User-driven start of the engineering preparation of the EXACT release.
 * Returns the durable state; idempotency is server-side (the first recorded
 * fact wins). NEVER call this from a read/navigation path.
 */
export async function startEngineeringCommand(args: {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string;
  readonly releaseId: string;
}): Promise<EngineeringStateView> {
  const client = new GraneteApiClient(args.baseUrl);
  const raw = await client.startProjectProductionReleaseEngineering(
    args.token,
    args.projectId,
    args.releaseId,
  );
  return engineeringStateViewFromApi(raw);
}

/**
 * User-driven final completion of the engineering preparation of the EXACT
 * release, guarded by the expected version read from the current state. A
 * stale version rejects with 409 — the caller refreshes and asks the user
 * again; it never retries silently.
 */
export async function completeEngineeringCommand(args: {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string;
  readonly releaseId: string;
  readonly expectedVersion: number;
}): Promise<EngineeringStateView> {
  const client = new GraneteApiClient(args.baseUrl);
  const raw = await client.completeProjectProductionReleaseEngineering(
    args.token,
    args.projectId,
    args.releaseId,
    args.expectedVersion,
  );
  return engineeringStateViewFromApi(raw);
}
