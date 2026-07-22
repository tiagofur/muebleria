/**
 * Status badge for project status (draft/quoted/accepted/produced).
 * Extracted from ProjectsScreen.tsx (F058a).
 */

import type { ReactNode } from 'react';
import type { Project } from '@muebles/domain';
import { projectStatusBadgeClass, projectStatusLabel } from '../projectHelpers';

export function StatusBadge({
  status,
}: {
  readonly status: Project['status'];
}): ReactNode {
  return (
    <span className={`status-badge ${projectStatusBadgeClass(status)}`}>
      <span className="status-badge__dot" aria-hidden>
        ●
      </span>
      {projectStatusLabel(status)}
    </span>
  );
}
