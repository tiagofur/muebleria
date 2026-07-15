/**
 * Pure dashboard helpers — counts and selection only (no cost formulas).
 */

import type { ProjectStatus } from '@muebles/domain';

export type ProjectLike = {
  readonly id: string;
  readonly status: ProjectStatus;
  readonly updatedAt: string;
};

export type ActiveFlag = {
  readonly active: boolean;
};

/** Active projects = draft + quoted (pipeline in progress). */
export function countActiveProjects(
  projects: readonly Pick<ProjectLike, 'status'>[],
): number {
  return projects.filter(
    (p) => p.status === 'draft' || p.status === 'quoted',
  ).length;
}

/** Materials with `active: true`. */
export function countActiveMaterials(materials: readonly ActiveFlag[]): number {
  return materials.filter((m) => m.active).length;
}

/** Total modules in catalog (all). */
export function countModules(modules: readonly unknown[]): number {
  return modules.length;
}

/**
 * Last N projects by `updatedAt` descending (ISO strings compare lexicographically).
 */
export function selectRecentProjects<T extends { readonly updatedAt: string }>(
  projects: readonly T[],
  limit = 5,
): T[] {
  const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;
  return [...projects]
    .sort((a, b) => {
      if (a.updatedAt < b.updatedAt) return 1;
      if (a.updatedAt > b.updatedAt) return -1;
      return 0;
    })
    .slice(0, n);
}

/**
 * Calendar YYYY-MM key for an ISO timestamp.
 * Prefers the date prefix (UTC storage) so midnight-Z edges stay stable across TZs.
 */
export function yearMonthKey(isoOrDate: string | Date): string | null {
  if (typeof isoOrDate === 'string') {
    const match = /^(\d{4})-(\d{2})/.exec(isoOrDate);
    if (match) return `${match[1]}-${match[2]}`;
    const parsed = new Date(isoOrDate);
    if (Number.isNaN(parsed.getTime())) return null;
    return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  if (Number.isNaN(isoOrDate.getTime())) return null;
  return `${isoOrDate.getUTCFullYear()}-${String(isoOrDate.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Sum sale prices for quoted/accepted projects whose `updatedAt` falls in the
 * same calendar month as `now` (UTC year-month, matching ISO storage).
 * Estimates come precomputed from the shell (domain engine / priceSnapshot)
 * — never recalculated here.
 */
export function sumMonthlyQuotedTotal(
  projects: readonly ProjectLike[],
  estimates: Readonly<Record<string, number | null | undefined>>,
  now: Date = new Date(),
): number {
  const currentKey = yearMonthKey(now);
  if (!currentKey) return 0;
  let total = 0;
  for (const project of projects) {
    if (project.status !== 'quoted' && project.status !== 'accepted') {
      continue;
    }
    if (yearMonthKey(project.updatedAt) !== currentKey) continue;
    const sale = estimates[project.id];
    if (typeof sale === 'number' && Number.isFinite(sale)) {
      total += sale;
    }
  }
  return total;
}

/** Format money for dashboard stats (2 decimals). */
export function formatDashboardMoney(n: number): string {
  return n.toFixed(2);
}
