/**
 * #108 — Indicator shown on a closed-quote project item when its structure was
 * pinned at an older revision. Renders "Rev N (cerrada)" in the muted/pinned
 * variant. Pure presentation: the caller passes the pinned revision number
 * taken from `ProjectItem.structureRevisionPin`.
 */

import type { ReactNode } from 'react';
import { StructureRevisionBadge } from '../../structures';

export type ProjectItemStructureRevisionIndicatorProps = {
  /** Pinned revision from `ProjectItem.structureRevisionPin`. */
  readonly pin: number;
  readonly testId?: string;
};

export function ProjectItemStructureRevisionIndicator({
  pin,
  testId,
}: ProjectItemStructureRevisionIndicatorProps): ReactNode {
  return (
    <StructureRevisionBadge
      revision={pin}
      variant="pinned"
      suffix="(cerrada)"
      testId={testId}
    />
  );
}
