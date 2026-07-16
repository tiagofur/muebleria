/**
 * CSS spinner — design tokens only (issue #30 / design.md §4.7).
 */

import type { ReactNode } from 'react';
import './loading.css';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export type SpinnerProps = {
  readonly size?: SpinnerSize;
  readonly className?: string;
  /** Accessible label; omit when a visible text sibling provides the name. */
  readonly 'aria-label'?: string;
};

export function Spinner({
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: SpinnerProps): ReactNode {
  const classes = [
    'ui-spinner',
    `ui-spinner--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={classes}
      role={ariaLabel ? 'status' : 'presentation'}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    />
  );
}
