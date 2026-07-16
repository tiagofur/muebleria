/**
 * Empty list state — design.md §4.5.
 * Dual standard: workspace empty vs filter/search with no matches.
 */

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Plus, SearchX } from 'lucide-react';
import './emptyState.css';

export type EmptyStateVariant = 'empty' | 'no-results';

export type EmptyStateProps = {
  readonly icon?: LucideIcon;
  readonly title: string;
  readonly description?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  /**
   * `empty` — no data in workspace (primary CTA with +).
   * `no-results` — data exists but filters/search match nothing (clear filters).
   */
  readonly variant?: EmptyStateVariant;
};

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  variant = 'empty',
}: EmptyStateProps): ReactNode {
  const isNoResults = variant === 'no-results';
  const Icon = icon ?? (isNoResults ? SearchX : Plus);
  const rootClass = isNoResults ? 'ui-empty ui-empty--no-results' : 'ui-empty';
  const buttonClass = isNoResults ? 'btn' : 'btn btn--primary';

  return (
    <div
      className={rootClass}
      role="status"
      data-testid={isNoResults ? 'empty-state-no-results' : 'empty-state'}
      data-variant={variant}
    >
      <div className="ui-empty__icon-wrap" aria-hidden>
        <Icon className="ui-empty__icon" size={48} strokeWidth={1.5} />
      </div>
      <h3 className="ui-empty__title">{title}</h3>
      {description ? (
        <p className="ui-empty__description">{description}</p>
      ) : null}
      {actionLabel && onAction ? (
        <button type="button" className={buttonClass} onClick={onAction}>
          {!isNoResults ? (
            <Plus size={16} strokeWidth={1.5} aria-hidden />
          ) : null}
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
