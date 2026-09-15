import { useQuery, type QueryKey } from '@tanstack/react-query';
import {
  GraneteApiClient,
  type ProductionRelease,
} from '@granete/storage';

/**
 * #738 — the EXACT ProductionRelease context the Engineering workspace was
 * opened with. The `release` URL param names the requested resource; this
 * hook resolves it (and its Q reference) from authoritative read models —
 * the URL never grants permissions (the server enforces ownership/tenancy
 * on `GET /projects/:id/production-releases/:releaseId`, so an unknown or
 * foreign selection surfaces as an error, never as silent "latest").
 */
export type EngineeringReleaseContext =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly retry: () => void }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly retry: () => void;
    }
  | {
      readonly kind: 'ready';
      readonly release: ProductionRelease;
      /** Human label of the quote revision pinned by the release ('Q2'). */
      readonly quoteLabel: string | null;
    };

export function engineeringReleaseQueryKey(
  scope: readonly unknown[],
  projectId: string,
  releaseId: string,
): QueryKey {
  return [...scope, 'projects', projectId, 'production-releases', releaseId, 'engineering-context'];
}

/**
 * Authoritative resolution of the pinned release context: the EXACT
 * project-scoped release plus its quote reference label. Throws when the
 * release does not belong to the requested project — the URL names a
 * resource, it never reinterprets it as someone else's (or as "latest").
 */
export async function fetchEngineeringReleaseContext(args: {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string;
  readonly releaseId: string;
  readonly signal?: AbortSignal;
}): Promise<{ readonly release: ProductionRelease; readonly quoteLabel: string | null }> {
  const client = new GraneteApiClient(args.baseUrl);
  // Project-scoped exact release read + the project's quote revisions (to
  // resolve the release's quote reference label). Both authoritative.
  const [release, quoteRevisions] = await Promise.all([
    client.getProjectProductionRelease(
      args.token,
      args.projectId,
      args.releaseId,
      args.signal,
    ),
    client.listProjectQuoteRevisions(
      args.token,
      args.projectId,
      args.signal,
    ),
  ]);
  if (release.project_id !== args.projectId || release.id !== args.releaseId) {
    throw new Error('La liberación no corresponde a esta obra');
  }
  const quote = quoteRevisions.find(
    (revision) => revision.id === release.quote_revision_id,
  );
  return { release, quoteLabel: quote ? `Q${quote.revisionNumber}` : null };
}

export function useEngineeringReleaseContext(args: {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly projectId: string | null;
  readonly releaseId: string | null;
  readonly queryKey: QueryKey;
}): EngineeringReleaseContext {
  const query = useQuery({
    queryKey: args.queryKey,
    queryFn: ({ signal }) =>
      fetchEngineeringReleaseContext({
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
        'No se pudo verificar la liberación solicitada. Puede no existir, pertenecer a otra obra o no estar disponible para tu taller.',
      retry,
    };
  }
  return {
    kind: 'ready',
    release: query.data.release,
    quoteLabel: query.data.quoteLabel,
  };
}
