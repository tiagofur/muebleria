/**
 * Status badge for authoritative QuoteRevision commercial status (#642 / 2A).
 */

import type { ReactNode } from 'react';
import type { ProjectCommercialSummary } from '@granete/storage';
import { formatCommercialSummaryBadge } from '../quoteRevisionPresentation';

export interface CommercialStatusBadgeProps {
  readonly summary?: ProjectCommercialSummary;
  readonly loading?: boolean;
}

export function CommercialStatusBadge({
  summary,
  loading,
}: CommercialStatusBadgeProps): ReactNode {
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
