import { useQuery, type QueryKey } from '@tanstack/react-query';
import {
  GraneteApiClient,
  type QuoteCommercialSnapshot,
  type QuoteRevisionDetail,
} from '@granete/storage';

export type QuoteRevisionAuthority =
  | { readonly kind: 'idle' | 'loading' }
  | { readonly kind: 'error'; readonly message: string; readonly retry: () => void }
  | { readonly kind: 'empty'; readonly message: string }
  | {
      readonly kind: 'legacy';
      readonly revision: QuoteRevisionDetail;
      /**
       * #642 legacy recovery re-entry: when a NEWER revision than this legacy
       * one already exists (e.g. a modern draft minted from it), the detail
       * must offer continuing that revision — never a second modernization
       * (the backend rejects a stale base). Data comes from the same fetched
       * revision list; no extra query.
       */
      readonly newerRevisionNumber?: number;
      readonly message: string;
      readonly staleMessage?: string;
      readonly retry: () => void;
    }
  | {
      readonly kind: 'ready';
      readonly revision: QuoteRevisionDetail;
      readonly snapshot: QuoteCommercialSnapshot;
      readonly staleMessage?: string;
      readonly retry: () => void;
    };

export function selectCommercialQuoteRevision(
  revisions: readonly QuoteRevisionDetail[],
): QuoteRevisionDetail | null {
  const accepted = revisions.find((revision) => revision.status === 'accepted');
  if (accepted) return accepted;
  return [...revisions].sort((a, b) => b.revisionNumber - a.revisionNumber)[0] ?? null;
}

export function useQuoteRevisionAuthority(args: {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly projectId: string | null;
  readonly queryKey: QueryKey;
}): QuoteRevisionAuthority {
  const query = useQuery({
    queryKey: args.queryKey,
    queryFn: ({ signal }) =>
      new GraneteApiClient(args.baseUrl).listProjectQuoteRevisions(
        args.token as string,
        args.projectId as string,
        signal,
      ),
    enabled: Boolean(args.token && args.projectId),
    retry: false,
  });
  const retry = () => void query.refetch();

  if (!args.projectId || !args.token) return { kind: 'idle' };
  if (query.isPending) return { kind: 'loading' };
  if (!query.data) {
    return {
      kind: 'error',
      message: 'No se pudo cargar la autoridad comercial de esta obra.',
      retry,
    };
  }

  const revision = selectCommercialQuoteRevision(query.data);
  if (!revision) {
    return {
      kind: 'empty',
      message: 'Esta obra todavía no tiene una revisión de cotización. Creá Q1 para fijar su verdad comercial.',
    };
  }
  const staleMessage = query.error
    ? 'No se pudo actualizar la revisión. Se muestran datos anteriores; reintentá antes de decidir.'
    : undefined;
  if (!revision.commercialSnapshot) {
    const newerRevisionNumber = query.data
      .filter((candidate) => candidate.revisionNumber > revision.revisionNumber)
      .reduce((max, candidate) => Math.max(max, candidate.revisionNumber), 0);
    return {
      kind: 'legacy',
      revision,
      newerRevisionNumber: newerRevisionNumber > 0 ? newerRevisionNumber : undefined,
      // #642 legacy recovery: user-facing copy — never technical jargon. The
      // persisted furniture/configurations ARE shown read-only elsewhere;
      // this message explains what cannot be verified, not that the quote
      // "broke".
      message:
        'Esta revisión fue creada antes del historial comercial congelado. ' +
        'Los muebles y configuraciones originales siguen disponibles; algunos datos ' +
        'históricos, como el precio total exacto, no pueden verificarse con el nuevo modelo.',
      staleMessage,
      retry,
    };
  }
  return { kind: 'ready', revision, snapshot: revision.commercialSnapshot, staleMessage, retry };
}
