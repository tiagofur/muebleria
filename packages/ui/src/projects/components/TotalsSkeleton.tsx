/**
 * TotalsSkeleton — placeholder shown while calcProjectBreakdown runs.
 * Shows animated bars matching the expected totals layout.
 */

import type { ReactNode } from 'react';

export function TotalsSkeleton(): ReactNode {
  return (
    <div
      className="project-totals__skeleton"
      role="status"
      aria-label="Calculando totales"
      aria-busy="true"
    >
      {/* Simulated total rows */}
      <div className="project-totals__skeleton-row" />
      <div className="project-totals__skeleton-row" />
      <div className="project-totals__skeleton-row" />
      <div className="project-totals__skeleton-row project-totals__skeleton-row--wide" />
      <div className="project-totals__skeleton-row project-totals__skeleton-row--highlight" />
    </div>
  );
}
