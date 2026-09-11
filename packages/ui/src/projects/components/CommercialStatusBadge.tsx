/**
 * Status badge for authoritative QuoteRevision commercial status (#642 / 2A).
 *
 * The dataset states (loading / error) are rendered before any per-project
 * interpretation: a failed batch request must never degrade into
 * "Sin cotización" per card — that verdict is only valid when the dataset is
 * ready and the server answered quoteStatus='none'.
 */

import type { ReactNode } from 'react';
import type { ProjectCommercialSummary } from '@granete/storage';
import { formatCommercialSummaryBadge } from '../quoteRevisionPresentation';

export interface CommercialStatusBadgeProps {
  readonly summary?: ProjectCommercialSummary;
  readonly loading?: boolean;
  readonly error?: boolean;
}

export function CommercialStatusBadge({
  summary,
  loading,
  error,
}: CommercialStatusBadgeProps): ReactNode {
  if (error) {
    return (
      <span
        className="status-badge status-badge--draft"
        aria-label="Estado comercial no disponible"
        data-testid="commercial-status-badge-error"
      >
        <span className="status-badge__dot" aria-hidden>
          ●
        </span>
        No disponible
      </span>
    );
  }

  if (loading && !summary) {
    return (
      <span
        className="status-badge status-badge--draft"
        aria-label="Cargando estado comercial…"
        data-testid="commercial-status-badge-loading"
      >
        <span className="status-badge__dot" aria-hidden>
          ●
        </span>
        Cargando…
      </span>
    );
  }

  const { label, modifier, ariaLabel } = formatCommercialSummaryBadge(summary);

  return (
    <span
      className={`status-badge ${modifier}`}
      aria-label={ariaLabel}
      data-testid="commercial-status-badge"
    >
      <span className="status-badge__dot" aria-hidden>
        ●
      </span>
      {label}
    </span>
  );
}
