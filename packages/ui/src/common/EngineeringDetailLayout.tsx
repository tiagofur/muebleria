/**
 * EngineeringDetailLayout — read-only detail body shell for engineering entities
 * (components, structures, modules). Chrome stays in workspace-chrome; this
 * component owns notes + primary/secondary columns.
 */

import type { ReactNode } from 'react';
import './engineeringDetail.css';

export type EngineeringDetailLayoutProps = {
  readonly dataTestId?: string;
  readonly className?: string;
  /** Sticky chrome (typically `.workspace-chrome`). Rendered above the body. */
  readonly chrome: ReactNode;
  /** Optional notes / description under chrome. */
  readonly notes?: ReactNode;
  /** High-signal column: dimensions, diagram, BOM, cost. */
  readonly primary: ReactNode;
  /** Secondary column: pose, history, roles (prefer disclosure). */
  readonly secondary?: ReactNode;
};

export function EngineeringDetailLayout({
  dataTestId,
  className,
  chrome,
  notes,
  primary,
  secondary,
}: EngineeringDetailLayoutProps): ReactNode {
  const rootClass = className
    ? `eng-detail ${className}`
    : 'eng-detail';

  return (
    <div className={rootClass} data-testid={dataTestId}>
      {chrome}
      {notes ? (
        <div className="eng-detail__notes-slot">{notes}</div>
      ) : null}
      <div className="eng-detail__body">
        <div className="eng-detail__primary">{primary}</div>
        {secondary ? (
          <div className="eng-detail__secondary">{secondary}</div>
        ) : null}
      </div>
    </div>
  );
}
