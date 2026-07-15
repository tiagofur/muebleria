/**
 * Empty list state — design.md §4.5.
 * Large Lucide icon, title, optional description, CTA button.
 */

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import './emptyState.css';

export type EmptyStateProps = {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps): ReactNode {
  return (
    <div className="ui-empty" role="status">
      <div className="ui-empty__icon-wrap" aria-hidden>
        <Icon className="ui-empty__icon" size={48} strokeWidth={1.5} />
      </div>
      <h3 className="ui-empty__title">{title}</h3>
      {description ? (
        <p className="ui-empty__description">{description}</p>
      ) : null}
      {actionLabel && onAction ? (
        <button type="button" className="btn btn--primary" onClick={onAction}>
          <Plus size={16} strokeWidth={1.5} aria-hidden />
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
