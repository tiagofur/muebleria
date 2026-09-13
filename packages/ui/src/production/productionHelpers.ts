/**
 * Production queue helpers (F038) — pure filters, no domain costs.
 */

import { releaseAuthorityOf, type Project, type ProjectStatus } from '@granete/domain';

export type ProductionQueueTab = 'accepted' | 'produced';

export const PRODUCTION_QUEUE_STATUSES: readonly ProjectStatus[] = [
  'accepted',
  'produced',
] as const;

export function isProductionQueueStatus(
  status: ProjectStatus,
): status is 'accepted' | 'produced' {
  return status === 'accepted' || status === 'produced';
}

/** Projects ready for plant floor (accepted) or already marked produced. */
export function filterProductionQueue(
  projects: readonly Project[],
  tab: ProductionQueueTab = 'accepted',
): Project[] {
  return projects
    .filter((p) => p.status === tab)
    .sort((a, b) => {
      if (a.updatedAt < b.updatedAt) return 1;
      if (a.updatedAt > b.updatedAt) return -1;
      return 0;
    });
}

/** Full plant-visible set (accepted + produced). */
export function filterProductionVisible(
  projects: readonly Project[],
): Project[] {
  // #642/#577: production visibility follows the MANUFACTURING authority —
  // a canonical ProductionRelease keeps Digital Thread projects (status
  // `draft`) visible to the factory surfaces; legacy accepted/produced
  // statuses remain as pre-Digital-Thread compatibility.
  return projects.filter(
    (p) =>
      isProductionQueueStatus(p.status) ||
      releaseAuthorityOf(p)?.source === 'canonical',
  );
}
