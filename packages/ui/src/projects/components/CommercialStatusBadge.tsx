/**
 * Status badge for authoritative QuoteRevision commercial status (#642 / 2A).
 *
 * The dataset states (loading / error / unavailable) are rendered before any
 * per-project interpretation: a failed batch request must never degrade into
 * "Sin cotización" per card — that verdict is only valid when the dataset is
 * ready and the server answered quoteStatus='none'. `unavailable` marks a
 * session with no remote commercial dataset at all (guest/local): no request
 * is pending and none can resolve it in this session (#642 / 2C round 2).
 */

import type { ReactNode } from 'react';
import type { ProjectCommercialSummary } from '@granete/storage';
import { formatCommercialSummaryBadge } from '../quoteRevisionPresentation';

export interface CommercialStatusBadgeProps {
  readonly summary?: ProjectCommercialSummary;
  readonly loading?: boolean;
  readonly error?: boolean;
  /** Guest/local session: no remote commercial dataset exists (#642). */
  readonly unavailable?: boolean;
}

export function CommercialStatusBadge({
  summary,
  loading,
  error,
  unavailable,
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

  if (unavailable) {
    return (
      <span
        className="status-badge status-badge--draft"
        aria-label="Estado comercial no disponible en esta sesión"
        data-testid="commercial-status-badge-unavailable"
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
