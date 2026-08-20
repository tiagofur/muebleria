/**
 * Types and helper functions for SalesDashboard metrics and filtering.
 */

import type { Project } from '@muebles/domain';

export type ProjectWithCustomer = Project & { readonly customerLabel?: string };

export type SalesProjectRow = {
  readonly project: Project;
  readonly customerLabel: string;
  readonly salePrice: number | null;
  readonly ownerLabel: string;
};

export type SalesAlert = {
  readonly type: 'old_quote' | 'slow_project';
  readonly projectId: string;
  readonly message: string;
};

export type StatusStats = {
  count: number;
  totalValue: number;
};

export type MonthlyStats = {
  mesActual: {
    cotizaciones: StatusStats;
    abiertas: StatusStats;
    cerradas: StatusStats;
    canceladas: StatusStats;
    instaladas: StatusStats;
  };
  total: {
    cotizaciones: StatusStats;
    abiertas: StatusStats;
    cerradas: StatusStats;
    canceladas: StatusStats;
    instaladas: StatusStats;
  };
};

export type ClientRanking = {
  readonly customerId: string;
  readonly customerLabel: string;
  readonly totalValue: number;
  readonly projectCount: number;
  readonly openCount: number;
  readonly closedCount: number;
  readonly cancelledCount: number;
};

export type VendedorOption = {
  readonly id: string;
  readonly name: string;
};

export function getSalePrice(p: Project): number | null {
  return p.priceSnapshot?.breakdown.salePrice ?? null;
}

export function daysSince(iso: string): number {
  return Math.floor(
    (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24),
  );
}

export function isCurrentMonth(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

export function isOpen(p: Project): boolean {
  if (p.cancelledAt) return false;
  return p.status === 'draft' || p.status === 'quoted' || p.status === 'accepted';
}

export function isClosed(p: Project): boolean {
  if (p.cancelledAt) return false;
  return p.status === 'produced';
}

export function isCancelled(p: Project): boolean {
  return Boolean(p.cancelledAt);
}

const MONTH_LABELS_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
] as const;

export type MonthlyActivity = {
  readonly key: string;
  readonly label: string;
  readonly created: number;
  readonly won: number;
};

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Created vs won per month over the last `months` (inclusive of the current
 * one). "Won" = priceSnapshot.capturedAt (≈ acceptance date, same honesty
 * note as workshopMetrics); drafts count as created, not as won.
 */
export function monthlyActivity(
  projects: readonly Project[],
  now: Date = new Date(),
  months = 6,
): MonthlyActivity[] {
  const buckets: Array<{
    key: string;
    label: string;
    created: number;
    won: number;
  }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: monthKey(d),
      label: MONTH_LABELS_ES[d.getMonth()] ?? String(d.getMonth() + 1),
      created: 0,
      won: 0,
    });
  }
  const index = new Map(buckets.map((b, i) => [b.key, i] as const));
  for (const p of projects) {
    const createdIdx = index.get(monthKey(new Date(p.createdAt)));
    if (createdIdx != null) buckets[createdIdx]!.created++;
    const capturedAt = p.priceSnapshot?.capturedAt;
    if (capturedAt) {
      const wonIdx = index.get(monthKey(new Date(capturedAt)));
      if (wonIdx != null) buckets[wonIdx]!.won++;
    }
  }
  return buckets;
}
