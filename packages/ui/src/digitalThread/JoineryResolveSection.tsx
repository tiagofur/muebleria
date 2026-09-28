/**
 * #875 live joinery section: resolves the REAL design state through the Go
 * authoring-resolve endpoint and renders the #898 panel. React only
 * collects state, builds the request DTO, calls the backend and renders the
 * response — never resolves contacts, plans stations, selects machining or
 * computes fingerprints.
 *
 * Lifecycle: one query per design item keyed by the item's semantic intent
 * (definition + catalog revision + parameters + material choices), so the
 * resolver runs only when a semantically relevant dependency changes. An
 * old response can never paint over a switched design: each item's query
 * key carries the design id and the item identity, and react-query drops
 * the data the moment the key changes.
 */

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import {
  type AuthoringResolveRequestV1,
  WebAuthoringResolveError,
  buildWebAuthoringResolveRequest,
  projectJoineryFromResolveResponse,
} from '@granete/domain';

import { JoineryStatusPanel } from './JoineryStatusPanel';

export interface JoineryResolveItem {
  /** Working-copy/revision item identity — scopes the query key. */
  readonly id: string;
  readonly furnitureDefinitionId: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly materialChoices: Readonly<Record<string, string>>;
  readonly displayName?: string;
}

export interface JoineryResolveSectionProps {
  readonly designId: string;
  readonly catalogRevision: string | null;
  /** True while the catalog revision pin is still being fetched. */
  readonly revisionLoading?: boolean;
  readonly revisionError?: boolean;
  readonly onRevisionRetry?: () => void;
  readonly items: readonly JoineryResolveItem[];
  /** Transport boundary: sends the built envelope and returns the raw wire response. */
  readonly resolve: (
    token: string,
    request: AuthoringResolveRequestV1,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly token: string;
}

/** Scalar parameters only — the resolve contract rejects nested values. */
function scalarParameters(parameters: Readonly<Record<string, unknown>>): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    }
  }
  return result;
}

function JoineryResolveItemSection({
  designId, item, catalogRevision, resolve, token,
}: {
  readonly designId: string;
  readonly item: JoineryResolveItem;
  readonly catalogRevision: string;
  readonly resolve: JoineryResolveSectionProps['resolve'];
  readonly token: string;
}) {
  const parameters = scalarParameters(item.parameters);
  // The query key is the semantic intent: switching designs, items,
  // definitions, parameters or materials re-keys the query; the resolver
  // never runs per render and stale responses die with their key.
  const query = useQuery({
    queryKey: [
      'joinery-resolve', designId, item.id, item.furnitureDefinitionId,
      catalogRevision, parameters, item.materialChoices,
    ],
    queryFn: async ({ signal }) => {
      const request = buildWebAuthoringResolveRequest({
        furnitureDefinitionId: item.furnitureDefinitionId,
        catalogRevision,
        parameters,
        materialChoices: item.materialChoices,
      });
      const response = await resolve(token, request, signal);
      return projectJoineryFromResolveResponse(
        response as Parameters<typeof projectJoineryFromResolveResponse>[0],
        request,
      );
    },
    retry: false,
    staleTime: Infinity,
  });

  const title = item.displayName ?? item.id;
  return (
    <div data-testid={`joinery-resolve-item-${item.id}`}>
      {item.displayName ? (
        <div className="pd-card__title"><strong>{title}</strong></div>
      ) : null}
      <JoineryStatusPanel
        joineryStatuses={query.data?.joineryStatuses ?? null}
        relationshipOperationCounts={query.data?.relationshipOperationCounts}
        loading={query.isPending}
        error={query.isError}
        onRetry={query.isError ? () => void query.refetch() : undefined}
      />
      {query.isError && query.error instanceof WebAuthoringResolveError ? (
        <p className="pd-empty-hint" data-testid={`joinery-resolve-codes-${item.id}`}>
          Códigos del servidor: {query.error.codes.join(', ')}
        </p>
      ) : null}
    </div>
  );
}

export function JoineryResolveSection({
  designId, catalogRevision, revisionLoading = false, revisionError = false, onRevisionRetry, items, resolve, token,
}: JoineryResolveSectionProps): ReactNode {
  if (!catalogRevision) {
    return (
      <section className="pd-card" data-testid="joinery-resolve-section">
        <div className="pd-card__header">
          <div className="pd-card__title"><h3>Construcción y uniones</h3></div>
        </div>
        {revisionLoading ? (
          <JoineryStatusPanel joineryStatuses={null} loading />
        ) : revisionError ? (
          <JoineryStatusPanel joineryStatuses={null} error onRetry={onRevisionRetry} />
        ) : (
          <p className="pd-empty-hint" data-testid="joinery-resolve-no-revision">
            Sin revisión de catálogo pineada no se puede resolver la construcción.
          </p>
        )}
      </section>
    );
  }
  if (items.length === 0) {
    return (
      <section className="pd-card" data-testid="joinery-resolve-section">
        <div className="pd-card__header">
          <div className="pd-card__title"><h3>Construcción y uniones</h3></div>
        </div>
        <p className="pd-empty-hint">Este diseño no tiene muebles para resolver.</p>
      </section>
    );
  }
  return (
    <section className="pd-card" data-testid="joinery-resolve-section">
      <div className="pd-card__header">
        <div className="pd-card__title"><h3>Construcción y uniones</h3></div>
      </div>
      {items.map((item) => (
        <JoineryResolveItemSection
          key={item.id}
          designId={designId}
          item={item}
          catalogRevision={catalogRevision}
          resolve={resolve}
          token={token}
        />
      ))}
    </section>
  );
}
