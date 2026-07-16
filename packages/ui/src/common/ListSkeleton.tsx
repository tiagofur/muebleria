/**
 * Lightweight list skeleton placeholders (issue #30).
 */

import type { ReactNode } from 'react';
import './loading.css';

export type ListSkeletonProps = {
  readonly rows?: number;
  readonly 'data-testid'?: string;
};

export function ListSkeleton({
  rows = 4,
  'data-testid': dataTestId = 'list-skeleton',
}: ListSkeletonProps): ReactNode {
  const count = Math.max(1, Math.min(rows, 12));
  return (
    <div
      className="ui-list-skeleton"
      role="status"
      aria-busy="true"
      aria-label="Cargando lista"
      data-testid={dataTestId}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="ui-list-skeleton__row" />
      ))}
    </div>
  );
}
