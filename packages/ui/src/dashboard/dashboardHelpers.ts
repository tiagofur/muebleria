/**
 * Pure dashboard helpers — counts and selection only (no cost formulas).
 */

import type { ProjectStatus } from '@muebles/domain';
import { formatMoneyDisplay } from '../common/formatMoneyDisplay';

export type ProjectLike = {
  readonly id: string;
  readonly status: ProjectStatus;
  readonly updatedAt: string;
  /** Portfolio owner (F034/F037). Empty/missing = unassigned. */
  readonly ownerUserId?: string;
};

export type OwnerDirectoryEntry = {
  readonly id: string;
  readonly name: string;
  readonly role?: string;
};

export type OwnerPortfolioRow = {
  readonly ownerUserId: string;
  readonly ownerName: string;
  /** Spanish role label or raw role code. */
  readonly ownerRoleLabel: string;
  readonly activeProjects: number;
  readonly monthlyQuotedTotal: number;
  readonly projectsTotal: number;
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
    if (
      project.status !== 'quoted' &&
      project.status !== 'accepted' &&
      project.status !== 'produced'
    ) {
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

/**
 * Format money for dashboard stats — delegates to shared formatMoneyDisplay (#51).
 */
export function formatDashboardMoney(n: number): string {
  return formatMoneyDisplay(n);
}

function isMonthlyClosedStatus(status: ProjectStatus): boolean {
  return status === 'quoted' || status === 'accepted' || status === 'produced';
}

/**
 * Portfolio breakdown by owner for gerente/admin home (F037).
 * Pure aggregation — sale estimates come from the shell.
 */
export function aggregatePortfolioByOwner(
  projects: readonly ProjectLike[],
  estimates: Readonly<Record<string, number | null | undefined>>,
  owners: readonly OwnerDirectoryEntry[],
  roleLabel: (role: string | undefined) => string,
  now: Date = new Date(),
): readonly OwnerPortfolioRow[] {
  const currentKey = yearMonthKey(now);
  const nameById = new Map(owners.map((o) => [o.id, o.name]));
  const roleById = new Map(owners.map((o) => [o.id, o.role]));

  type Acc = {
    activeProjects: number;
    monthlyQuotedTotal: number;
    projectsTotal: number;
  };
  const byOwner = new Map<string, Acc>();

  for (const project of projects) {
    const ownerId = project.ownerUserId?.trim() || '__unassigned__';
    let acc = byOwner.get(ownerId);
    if (!acc) {
      acc = { activeProjects: 0, monthlyQuotedTotal: 0, projectsTotal: 0 };
      byOwner.set(ownerId, acc);
    }
    acc.projectsTotal += 1;
    if (project.status === 'draft' || project.status === 'quoted') {
      acc.activeProjects += 1;
    }
    if (
      currentKey &&
      isMonthlyClosedStatus(project.status) &&
      yearMonthKey(project.updatedAt) === currentKey
    ) {
      const sale = estimates[project.id];
      if (typeof sale === 'number' && Number.isFinite(sale)) {
        acc.monthlyQuotedTotal += sale;
      }
    }
  }

  const rows: OwnerPortfolioRow[] = [];
  for (const [ownerUserId, acc] of byOwner) {
    const isUnassigned = ownerUserId === '__unassigned__';
    const role = isUnassigned ? undefined : roleById.get(ownerUserId);
    rows.push({
      ownerUserId,
      ownerName: isUnassigned
        ? 'Sin responsable'
        : nameById.get(ownerUserId) || ownerUserId,
      ownerRoleLabel: isUnassigned ? '—' : roleLabel(role),
      activeProjects: acc.activeProjects,
      monthlyQuotedTotal: acc.monthlyQuotedTotal,
      projectsTotal: acc.projectsTotal,
    });
  }

  return rows.sort((a, b) => {
    if (b.monthlyQuotedTotal !== a.monthlyQuotedTotal) {
      return b.monthlyQuotedTotal - a.monthlyQuotedTotal;
    }
    return a.ownerName.localeCompare(b.ownerName, 'es');
  });
}

/**
 * Fresh workspace: no modules and no projects yet.
 * Materials alone (seed/catalog) still show getting-started; power users with
 * templates or quotes do not.
 */
export function shouldShowGettingStarted(input: {
  readonly modulesCount: number;
  readonly projectsCount: number;
}): boolean {
  return input.modulesCount === 0 && input.projectsCount === 0;
}
