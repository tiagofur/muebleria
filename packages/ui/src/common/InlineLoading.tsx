/**
 * Compact inline loading (panels, toolbars) — issue #30.
 */

import type { ReactNode } from 'react';
import { Spinner } from './Spinner';
import './loading.css';

export type InlineLoadingProps = {
  readonly label?: string;
  readonly 'data-testid'?: string;
};

export function InlineLoading({
  label = 'Cargando…',
  'data-testid': dataTestId = 'inline-loading',
}: InlineLoadingProps): ReactNode {
  return (
    <p
      className="ui-inline-loading"
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-testid={dataTestId}
    >
      <Spinner size="sm" />
      <span>{label}</span>
    </p>
  );
}
