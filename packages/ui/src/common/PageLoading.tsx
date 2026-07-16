/**
 * Centered page/section loading state (issue #30).
 */

import type { ReactNode } from 'react';
import { Spinner } from './Spinner';
import './loading.css';

export type PageLoadingProps = {
  readonly label?: string;
  /** Full viewport (workspace gate). Default: section-sized. */
  readonly fullPage?: boolean;
  readonly 'data-testid'?: string;
};

export function PageLoading({
  label = 'Cargando…',
  fullPage = false,
  'data-testid': dataTestId = 'page-loading',
}: PageLoadingProps): ReactNode {
  return (
    <div
      className={
        fullPage
          ? 'ui-page-loading ui-page-loading--full'
          : 'ui-page-loading'
      }
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-testid={dataTestId}
    >
      <Spinner size={fullPage ? 'lg' : 'md'} />
      <p className="ui-page-loading__label">{label}</p>
    </div>
  );
}
