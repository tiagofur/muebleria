/**
 * Batch commercial summaries of the Cotizaciones list (#642 / 2A).
 *
 * One React Query fetch per session/organization scope — never a per-card
 * request — using the generated `listProjectCommercialSummaries` client. The
 * query key embeds the full session scope, so an organization, support or
 * auth session change starts a fresh cache root instead of leaking summaries
 * across tenants (same policy as the #663 quote authority).
 *
 * The returned dataset state is authoritative: `error` must never be
 * interpreted as "Sin cotización" by consumers.
 */

import { useQuery, type QueryKey } from '@tanstack/react-query';
import { GraneteApiClient, type ProjectCommercialSummary } from '@granete/storage';

export type ProjectsCommercialSummaries =
  | { readonly kind: 'idle' | 'loading' }
  | { readonly kind: 'error'; readonly message: string; readonly retry: () => void }
  | {
      readonly kind: 'ready';
      readonly summaries: ReadonlyMap<string, ProjectCommercialSummary>;
      readonly staleMessage?: string;
      readonly retry: () => void;
    };

export function useProjectsCommercialSummaries(args: {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly queryKey: QueryKey;
}): ProjectsCommercialSummaries {
  const query = useQuery({
    queryKey: args.queryKey,
    queryFn: ({ signal }) =>
      new GraneteApiClient(args.baseUrl).listProjectCommercialSummaries(
        args.token as string,
        signal,
      ),
    enabled: Boolean(args.token),
    retry: false,
  });
  const retry = () => void query.refetch();

  if (!args.token) return { kind: 'idle' };
  if (query.isPending) return { kind: 'loading' };
  if (!query.data) {
    return {
      kind: 'error',
      message: 'No se pudo cargar la información comercial.',
      retry,
    };
  }

  const summaries = new Map<string, ProjectCommercialSummary>(
    query.data.map((summary) => [summary.projectId, summary]),
  );
  const staleMessage = query.error
    ? 'No se pudo actualizar la información comercial. Se muestran datos anteriores; reintentá antes de decidir.'
    : undefined;
  return { kind: 'ready', summaries, staleMessage, retry };
}
