/**
 * Page header — title context and page-level action hierarchy.
 */

import type { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  type DropdownMenuItem,
} from './DropdownMenu';
import './pageHeader.css';

export type PageHeaderProps = {
  readonly title: string;
  readonly subtitle?: ReactNode;
  readonly icon?: ReactNode;
  readonly headingLevel?: 2 | 3;
  /** The only visible primary action owned by this page context. */
  readonly primaryAction?: ReactNode;
  /** Frequent, non-destructive actions that remain visible beside the primary. */
  readonly secondaryActions?: ReactNode;
  /** Low-frequency or destructive non-primary actions, exposed through a menu. */
  readonly overflowActions?: readonly DropdownMenuItem[];
  /** Contextual controls that belong to the header rather than the toolbar. */
  readonly contextualControls?: ReactNode;
  readonly actionsLabel?: string;
};

export function PageHeader({
  title,
  subtitle,
  icon,
  headingLevel = 2,
  primaryAction,
  secondaryActions,
  overflowActions = [],
  contextualControls,
  actionsLabel = `Acciones de ${title}`,
}: PageHeaderProps): ReactNode {
  const heading = headingLevel === 2
    ? <h2 className="page-header__title">{title}</h2>
    : <h3 className="page-header__title">{title}</h3>;
  const hasActions = primaryAction || secondaryActions || overflowActions.length > 0;

  return (
    <header className="page-header" data-testid="page-header">
      <div className="page-header__identity">
        {icon ? <span className="page-header__icon" aria-hidden>{icon}</span> : null}
        <div className="page-header__copy">
          {heading}
          {subtitle ? <p className="page-header__subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {hasActions || contextualControls ? (
        <div className="page-header__action-slot" aria-label={actionsLabel}>
          {contextualControls ? (
            <div className="page-header__contextual-controls">{contextualControls}</div>
          ) : null}
          {secondaryActions ? (
            <div className="page-header__secondary-actions">{secondaryActions}</div>
          ) : null}
          {overflowActions.length > 0 ? (
            <DropdownMenu
              ariaLabel={actionsLabel}
              triggerLabel="Más acciones"
              triggerIcon={<MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />}
              triggerClassName="btn btn--ghost page-header__overflow-trigger"
              sections={[{ id: 'page-actions', items: overflowActions }]}
            />
          ) : null}
          {primaryAction ? <div className="page-header__primary-action">{primaryAction}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
