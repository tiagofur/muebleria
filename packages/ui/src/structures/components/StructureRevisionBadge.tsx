/**
 * #108 — Structure revision badge. Renders "Rev N" using the revision the
 * domain normalizes for legacy data (`revision ?? 1`). Pure presentation: the
 * caller passes the raw `Structure` (or an explicit number) and the component
 * does no domain math beyond the legacy fallback.
 *
 * Variants:
 *  - `default`: informative (live revision, editable context).
 *  - `pinned`: muted (audit / closed-quote context — the item is frozen at
 *    an older revision).
 */

import type { ReactNode } from 'react';
import type { Structure } from '@muebles/domain';

export type StructureRevisionBadgeVariant = 'default' | 'pinned';

export type StructureRevisionBadgeProps = {
  /** Raw structure (uses `revision ?? 1`) or an explicit revision number. */
  readonly structure?: Structure;
  readonly revision?: number;
  readonly variant?: StructureRevisionBadgeVariant;
  /** Optional suffix appended after the number (e.g. "(cerrada)"). */
  readonly suffix?: string;
  readonly className?: string;
  readonly testId?: string;
};

function resolveRevision(
  structure: Structure | undefined,
  revision: number | undefined,
): number {
  if (typeof revision === 'number') return revision;
  if (structure) return structure.revision ?? 1;
  return 1;
}

export function StructureRevisionBadge({
  structure,
  revision,
  variant = 'default',
  suffix,
  className,
  testId,
}: StructureRevisionBadgeProps): ReactNode {
  const value = resolveRevision(structure, revision);
  const classes = ['structure-revision-badge'];
  if (variant === 'pinned') classes.push('structure-revision-badge--pinned');
  if (className) classes.push(className);
  return (
    <span className={classes.join(' ')} data-testid={testId}>
      {`Rev ${value}`}
      {suffix ? ` ${suffix}` : ''}
    </span>
  );
}
