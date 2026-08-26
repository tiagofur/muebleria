/**
 * CostingPanelView — presentation view of a project's job costing
 * (OC-080..OC-084): frozen baseline, estimate vs actual summary, valued
 * material consumption, time entries and other actuals. The shell resolves
 * the domain summary (`computeJobCostSummary` or the server costing view);
 * this module only formats/labels — no domain math (docs/design.md §1).
 */

import { formatMoneyDisplay } from '../common/formatMoneyDisplay';
import {
  OTHER_COST_KIND_LABELS_ES,
  TIME_ENTRY_CATEGORY_LABELS_ES,
  timeEntryCost,
  type CostBaseline,
  type CostTruth,
  type JobCostSummary,
  type OtherActualCost,
  type Project,
  type TimeEntry,
} from '@granete/domain';

export const MATERIAL_BASIS_LABELS_ES: Readonly<Record<string, string>> = {
  po_unit_cost: 'Costo OC',
  catalog: 'Catálogo',
};

export const MATERIAL_TRUTH_LABELS_ES: Readonly<Record<CostTruth, string>> = {
  actual: 'Costo real (OC)',
  proxy: 'Estimado (catálogo)',
  missing: 'Sin valorizar',
};

export interface CostingPanelView {
  readonly projectId: string;
  readonly currency: string;
  readonly hasCosting: boolean;
  /** True when the sources exist and the current release has no baseline yet. */
  readonly canCaptureBaseline: boolean;
  /** Human explanation of what is missing before the baseline can be frozen. */
  readonly captureBlockers: readonly string[];
  readonly baseline: CostingBaselineView | null;
  readonly summary: CostingSummaryView;
  readonly materialLines: readonly CostingMaterialLineView[];
  readonly missingValuationMaterialIds: readonly string[];
  readonly laborRatePerHour: number | null;
  readonly laborRateLabel: string;
  readonly timeEntries: readonly CostingTimeEntryView[];
  readonly otherCosts: readonly CostingOtherCostView[];
}

export interface CostingBaselineView {
  readonly capturedAt: string;
  readonly releaseId: string;
  readonly revenue: string;
  readonly estimatedDirectCost: string;
  readonly expectedGrossMargin: string;
  readonly expectedMarginPercent: string;
  readonly breakdown: readonly { readonly label: string; readonly amount: string }[];
}

export interface CostingSummaryView {
  readonly revenue: string;
  readonly estimatedDirectCost: string;
  readonly actualDirectCost: string;
  readonly actualMaterialCost: string;
  readonly materialTruth: CostTruth;
  readonly actualLaborCost: string;
  readonly actualLaborMinutes: string;
  readonly actualOtherCost: string;
  /** Variance (actual − estimated); null until both sides exist. */
  readonly variance: string | null;
  readonly varianceOverBudget: boolean;
  readonly expectedGrossMargin: string;
  readonly expectedMarginPercent: string;
  readonly actualGrossMargin: string;
  readonly actualMarginPercent: string;
  readonly minutesByCategory: readonly { readonly label: string; readonly minutes: number }[];
  readonly otherCostByKind: readonly { readonly label: string; readonly amount: string }[];
}

export interface CostingMaterialLineView {
  readonly materialId: string;
  readonly quantity: string;
  readonly unitCost: string;
  readonly amount: string;
  readonly basisLabel: string;
  readonly truth: CostTruth;
}

export interface CostingTimeEntryView {
  readonly id: string;
  readonly categoryLabel: string;
  readonly minutes: string;
  readonly cost: string;
  readonly at: string;
  readonly byName: string;
  readonly note: string;
  readonly voided: boolean;
}

export interface CostingOtherCostView {
  readonly id: string;
  readonly kindLabel: string;
  readonly amount: string;
  readonly vendor: string;
  readonly at: string;
  readonly note: string;
  readonly voided: boolean;
}

function money(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined) return '—';
  return formatMoneyDisplay(n, { currency, showCurrency: false });
}

function minutesLabel(minutes: number): string {
  if (minutes <= 0) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} min`;
  return `${hours} h ${rest > 0 ? `${rest} min` : ''}`.trim();
}

function baselineView(baseline: CostBaseline, currency: string): CostingBaselineView {
  return {
    capturedAt: baseline.capturedAt,
    releaseId: baseline.source.releaseId,
    revenue: money(baseline.revenue, currency),
    estimatedDirectCost: money(baseline.estimatedDirectCost, currency),
    expectedGrossMargin: money(baseline.expectedGrossMargin, currency),
    expectedMarginPercent: `${baseline.expectedMarginPercent.toFixed(1)} %`,
    breakdown: [
      { label: 'Material', amount: money(baseline.materialsCost, currency) },
      { label: 'Cantos', amount: money(baseline.edgeTotal, currency) },
      { label: 'Herrajes', amount: money(baseline.hardwareTotal, currency) },
      { label: 'MO modular', amount: money(baseline.laborModular, currency) },
      { label: 'MO fija', amount: money(baseline.laborFixedCost, currency) },
    ],
  };
}

function summaryView(
  summary: JobCostSummary,
  currency: string,
): CostingSummaryView {
  return {
    revenue: money(summary.revenue, currency),
    estimatedDirectCost: money(summary.estimatedDirectCost, currency),
    actualDirectCost: money(summary.actualDirectCost, currency),
    actualMaterialCost: money(summary.actualMaterialCost, currency),
    materialTruth: summary.actualMaterialTruth,
    actualLaborCost: money(summary.actualLaborCost, currency),
    actualLaborMinutes: minutesLabel(summary.actualLaborMinutes),
    actualOtherCost: money(summary.actualOtherCost, currency),
    variance: summary.variance === null ? null : money(summary.variance, currency),
    varianceOverBudget: (summary.variance ?? 0) > 0,
    expectedGrossMargin: money(summary.expectedGrossMargin, currency),
    expectedMarginPercent:
      summary.expectedMarginPercent === null ? '—' : `${summary.expectedMarginPercent.toFixed(1)} %`,
    actualGrossMargin: money(summary.actualGrossMargin, currency),
    actualMarginPercent:
      summary.actualMarginPercent === null ? '—' : `${summary.actualMarginPercent.toFixed(1)} %`,
    minutesByCategory: Object.entries(summary.minutesByCategory)
      .filter(([, minutes]) => minutes > 0)
      .map(([category, minutes]) => ({
        label: TIME_ENTRY_CATEGORY_LABELS_ES[category as keyof typeof TIME_ENTRY_CATEGORY_LABELS_ES] ?? category,
        minutes,
      })),
    otherCostByKind: Object.entries(summary.otherCostByKind)
      .filter(([, amount]) => amount > 0)
      .map(([kind, amount]) => ({
        label: OTHER_COST_KIND_LABELS_ES[kind as keyof typeof OTHER_COST_KIND_LABELS_ES] ?? kind,
        amount: money(amount, currency),
      })),
  };
}

function timeEntryView(entry: TimeEntry, currency: string): CostingTimeEntryView {
  const cost = timeEntryCost(entry);
  return {
    id: entry.id,
    categoryLabel: TIME_ENTRY_CATEGORY_LABELS_ES[entry.category] ?? entry.category,
    minutes: minutesLabel(entry.minutes),
    cost: entry.ratePerHour > 0 ? money(cost, currency) : '—',
    at: entry.at,
    byName: entry.byName ?? entry.byUserId ?? '—',
    note: entry.note ?? '',
    voided: Boolean(entry.removedAt),
  };
}

function otherCostView(cost: OtherActualCost, currency: string): CostingOtherCostView {
  return {
    id: cost.id,
    kindLabel: OTHER_COST_KIND_LABELS_ES[cost.kind] ?? cost.kind,
    amount: money(cost.amount, currency),
    vendor: cost.vendor ?? '',
    at: cost.at,
    note: cost.note ?? '',
    voided: Boolean(cost.removedAt),
  };
}

/**
 * Build the panel view from the project aggregate and the resolved domain
 * summary (shell computes it via `computeJobCostSummary`, or from the server
 * `GET /projects/{id}/costing` response which carries the job consumption).
 */
export function costingPanelView(
  project: Pick<Project, 'id' | 'currency' | 'priceSnapshot' | 'productionRelease' | 'costing'>,
  domain: {
    readonly summary: JobCostSummary;
    readonly materialLines?: readonly {
      readonly materialId: string;
      readonly quantity: number;
      readonly unitCost: number;
      readonly amount: number;
      readonly basisLabel: string;
      readonly truth: CostTruth;
    }[];
    readonly missingValuationMaterialIds?: readonly string[];
  },
): CostingPanelView {
  const currency = project.currency || 'MXN';
  const costing = project.costing;
  const baseline = costing?.baseline ?? null;

  const blockers: string[] = [];
  if (!project.priceSnapshot) blockers.push('capturar el snapshot de cotización (cerrar la cotización)');
  if (!project.productionRelease) blockers.push('liberar la revisión de ingeniería a producción');
  const sameRelease =
    baseline !== null &&
    project.productionRelease !== undefined &&
    baseline.source.releaseId === project.productionRelease.id;
  const canCapture = blockers.length === 0 && !sameRelease;

  return {
    projectId: project.id,
    currency,
    hasCosting: costing !== undefined,
    canCaptureBaseline: canCapture,
    captureBlockers: sameRelease ? [] : blockers,
    baseline: baseline ? baselineView(baseline, currency) : null,
    summary: summaryView(domain.summary, currency),
    materialLines: (domain.materialLines ?? []).map((line) => ({
      materialId: line.materialId,
      quantity: `${line.quantity}`,
      unitCost: money(line.unitCost, currency),
      amount: money(line.amount, currency),
      basisLabel: line.basisLabel,
      truth: line.truth,
    })),
    missingValuationMaterialIds: domain.missingValuationMaterialIds ?? [],
    laborRatePerHour: costing && costing.laborRatePerHour > 0 ? costing.laborRatePerHour : null,
    laborRateLabel:
      costing && costing.laborRatePerHour > 0 ? money(costing.laborRatePerHour, currency) : '—',
    timeEntries: (costing?.timeEntries ?? []).map((entry) => timeEntryView(entry, currency)),
    otherCosts: (costing?.otherCosts ?? []).map((cost) => otherCostView(cost, currency)),
  };
}
