/**
 * Job costing domain (OC-080..OC-084) — cost baseline frozen from the quote
 * snapshot + released engineering revision, time entries per category, other
 * actual costs (freight/outsource/external installation/consumables), material
 * actuals from stock consumption assigned to the job, and the estimate vs
 * actual summary with variance and gross margins. Every figure keeps a
 * traceable source; no fiscal accounting or payroll (issue #304 anti-scope).
 *
 * Reference: docs/operational-core-v1.md §11, docs/prd-v2.md §12,
 * docs/architecture.md §3 (Costing bounded context).
 */

import { ValidationError } from './errors';
import type { Project } from './types';
import {
  appendProjectEvent,
  createProjectEvent,
  type CostEventType,
  type ProjectEvent,
  type ProjectEventSource,
} from './projectLifecycle';

/* ── Vocabularies (parity: contracts/jobCosting.json) ─────────────────────── */

/**
 * OC-081 labor categories. `sales_design` is optional to measure but part of
 * the canonical vocabulary from day one.
 */
export const TIME_ENTRY_CATEGORIES = [
  'sales_design',
  'engineering',
  'cut',
  'cnc',
  'edge_banding',
  'assembly',
  'qc_rework',
  'shipping',
  'installation',
  'warranty',
] as const;
export type TimeEntryCategory = (typeof TIME_ENTRY_CATEGORIES)[number];

export const TIME_ENTRY_CATEGORY_LABELS_ES: Readonly<Record<TimeEntryCategory, string>> = {
  sales_design: 'Ventas/Diseño',
  engineering: 'Ingeniería',
  cut: 'Corte',
  cnc: 'CNC',
  edge_banding: 'Enchape',
  assembly: 'Armado',
  qc_rework: 'QC/Retrabajo',
  shipping: 'Embarque',
  installation: 'Instalación',
  warranty: 'Garantía',
};

/** OC-083 other actual cost kinds. `consumable` covers configurable shop supplies. */
export const OTHER_COST_KINDS = ['freight', 'outsource', 'external_installation', 'consumable'] as const;
export type OtherCostKind = (typeof OTHER_COST_KINDS)[number];

export const OTHER_COST_KIND_LABELS_ES: Readonly<Record<OtherCostKind, string>> = {
  freight: 'Flete',
  outsource: 'Tercerización',
  external_installation: 'Instalación externa',
  consumable: 'Consumible',
};

/**
 * Valuation basis for consumed material (OC-082). `po_unit_cost` is the real
 * price paid (received PO snapshot), `catalog` is the current catalog price —
 * a proxy when the material was not bought for this job (Data Truth Contract,
 * docs/architecture.md §9).
 */
export const MATERIAL_VALUATION_BASES = ['po_unit_cost', 'catalog'] as const;
export type MaterialValuationBasis = (typeof MATERIAL_VALUATION_BASES)[number];

export type CostTruth = 'actual' | 'proxy' | 'missing';

/* ── Entities ──────────────────────────────────────────────────────────────── */

/**
 * Official estimated cost of a job (OC-080), frozen from the quote snapshot
 * and the production release that engineering put on the floor. Replacing the
 * baseline is only allowed when the release changed (change orders).
 */
export interface CostBaseline {
  readonly id: string;
  readonly projectId: string;
  readonly capturedAt: string;
  readonly capturedByUserId?: string;
  /** Traceable sources: which snapshot and which release were used. */
  readonly source: {
    readonly quoteSnapshotCapturedAt: string;
    readonly projectVersion: number;
    readonly releaseId: string;
    readonly bomFingerprint: string;
  };
  /** Sale price frozen in the quote snapshot (revenue). */
  readonly revenue: number;
  readonly materialsCost: number;
  readonly edgeTotal: number;
  readonly hardwareTotal: number;
  readonly laborModular: number;
  readonly laborFixedCost: number;
  /** materials + edges + hardware + estimated labor (PRD-v2 §12.1). */
  readonly estimatedDirectCost: number;
  readonly expectedGrossMargin: number;
  readonly expectedMarginPercent: number;
}

/** OC-081 labor time actually spent on the job. Cost is frozen per entry. */
export interface TimeEntry {
  readonly id: string;
  readonly category: TimeEntryCategory;
  readonly minutes: number;
  readonly at: string;
  readonly byUserId?: string;
  readonly byName?: string;
  readonly note?: string;
  /** Hourly rate frozen at record time (currency/hour). */
  readonly ratePerHour: number;
  readonly removedAt?: string;
  readonly removedByUserId?: string;
  readonly removedByName?: string;
}

/** OC-083 out-of-production actual costs. */
export interface OtherActualCost {
  readonly id: string;
  readonly kind: OtherCostKind;
  readonly amount: number;
  readonly at: string;
  readonly byUserId?: string;
  readonly byName?: string;
  readonly vendor?: string;
  readonly note?: string;
  readonly removedAt?: string;
  readonly removedByUserId?: string;
  readonly removedByName?: string;
}

/** Costing subprocess of one project. */
export interface JobCosting {
  readonly id: string;
  readonly projectId: string;
  readonly baseline?: CostBaseline;
  /** Shop hourly rate in force for new time entries (currency/hour, 0 = unset). */
  readonly laborRatePerHour: number;
  readonly timeEntries: readonly TimeEntry[];
  readonly otherCosts: readonly OtherActualCost[];
  readonly createdAt: string;
}

/* ── Guards ────────────────────────────────────────────────────────────────── */

export function isTimeEntryCategory(value: string): value is TimeEntryCategory {
  return (TIME_ENTRY_CATEGORIES as readonly string[]).includes(value);
}

export function isOtherCostKind(value: string): value is OtherCostKind {
  return (OTHER_COST_KINDS as readonly string[]).includes(value);
}

export function activeTimeEntries(costing: JobCosting | undefined): readonly TimeEntry[] {
  return costing?.timeEntries.filter((e) => !e.removedAt) ?? [];
}

export function activeOtherCosts(costing: JobCosting | undefined): readonly OtherActualCost[] {
  return costing?.otherCosts.filter((c) => !c.removedAt) ?? [];
}

/* ── Material actual (OC-082) ──────────────────────────────────────────────── */

/**
 * One material consumption assigned to the job. Quantity and unit cost must
 * be expressed in the same unit (sheets, m2, ml or pieces) — the caller
 * (server / planning view) is responsible for aligning units.
 */
export interface MaterialConsumptionInput {
  readonly materialId: string;
  readonly quantity: number;
  /** Latest received-PO unit cost for the material, when it exists. */
  readonly poUnitCost?: number;
  /** Current catalog unit cost fallback (costPerM2/costPerMl/costPerUnit). */
  readonly catalogUnitCost?: number;
  readonly at?: string;
}

export interface ValuedMaterialLine {
  readonly materialId: string;
  readonly quantity: number;
  readonly unitCost: number;
  readonly amount: number;
  readonly basis: MaterialValuationBasis;
  readonly truth: CostTruth;
}

export interface MaterialCostValuation {
  readonly lines: readonly ValuedMaterialLine[];
  readonly total: number;
  /** `actual` only when every line used a real PO price; `proxy` otherwise. */
  readonly truth: CostTruth;
  readonly missingValuationMaterialIds: readonly string[];
}

/**
 * Value consumed material (OC-082): prefer the real price paid (received PO
 * unit cost), fall back to catalog price labelled as proxy, and surface the
 * materials that could not be valued at all instead of hiding them.
 */
export function valueMaterialConsumptions(
  inputs: readonly MaterialConsumptionInput[],
): MaterialCostValuation {
  const lines: ValuedMaterialLine[] = [];
  const missing: string[] = [];
  for (const input of inputs) {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) continue;
    const poUnitCost = input.poUnitCost ?? undefined;
    const catalogUnitCost = input.catalogUnitCost ?? undefined;
    if (poUnitCost !== undefined && poUnitCost > 0) {
      lines.push({
        materialId: input.materialId,
        quantity: input.quantity,
        unitCost: poUnitCost,
        amount: round2(input.quantity * poUnitCost),
        basis: 'po_unit_cost',
        truth: 'actual',
      });
    } else if (catalogUnitCost !== undefined && catalogUnitCost > 0) {
      lines.push({
        materialId: input.materialId,
        quantity: input.quantity,
        unitCost: catalogUnitCost,
        amount: round2(input.quantity * catalogUnitCost),
        basis: 'catalog',
        truth: 'proxy',
      });
    } else {
      missing.push(input.materialId);
    }
  }
  const total = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const truth: CostTruth =
    lines.length === 0 ? 'missing' : lines.every((l) => l.truth === 'actual') ? 'actual' : 'proxy';
  return { lines, total, truth, missingValuationMaterialIds: missing };
}

/* ── Summary (OC-084) ──────────────────────────────────────────────────────── */

/** Rework cost input — use reworkCostSummary(project.quality) on the caller side. */
export interface ReworkCostInput {
  readonly materialCost: number;
  readonly laborMinutes: number;
}

export interface JobCostSummaryInput {
  readonly baseline?: CostBaseline;
  readonly timeEntries: readonly TimeEntry[];
  readonly laborRatePerHour: number;
  readonly rework?: ReworkCostInput;
  readonly material?: MaterialCostValuation;
  readonly otherCosts: readonly OtherActualCost[];
}

export interface JobCostSummary {
  readonly revenue: number | null;
  readonly estimatedDirectCost: number | null;
  readonly actualMaterialCost: number;
  readonly actualMaterialTruth: CostTruth;
  readonly actualLaborMinutes: number;
  /** Null while no hourly rate is configured — labor cannot be priced honestly. */
  readonly actualLaborCost: number | null;
  readonly actualOtherCost: number;
  /** Null when labor cost is unknown (Data Truth: never hide a missing input). */
  readonly actualDirectCost: number | null;
  /** actual − estimated; negative = under budget. */
  readonly variance: number | null;
  readonly expectedGrossMargin: number | null;
  readonly expectedMarginPercent: number | null;
  readonly actualGrossMargin: number | null;
  readonly actualMarginPercent: number | null;
  readonly minutesByCategory: Readonly<Record<TimeEntryCategory, number>>;
  readonly otherCostByKind: Readonly<Record<OtherCostKind, number>>;
}

/**
 * Estimate vs actual for one job (OC-084). Revenue and estimated figures come
 * from the captured baseline (null before capture); actuals aggregate material
 * consumption + rework, time entries (and rework minutes) valued at each
 * entry's frozen rate, and other actual costs. Missing inputs stay explicit
 * instead of being silently reported as zero.
 */
export function computeJobCostSummary(input: JobCostSummaryInput): JobCostSummary {
  const minutesByCategory = emptyMinutesByCategory();
  let laborMinutes = 0;
  let laborCost = 0;
  for (const entry of input.timeEntries) {
    if (entry.removedAt) continue;
    laborMinutes += entry.minutes;
    laborCost += timeEntryCost(entry);
    minutesByCategory[entry.category] += entry.minutes;
  }
  const reworkMaterialCost = Math.max(0, input.rework?.materialCost ?? 0);
  const reworkLaborMinutes = Math.max(0, input.rework?.laborMinutes ?? 0);
  if (reworkLaborMinutes > 0) {
    laborMinutes += reworkLaborMinutes;
    laborCost += round2((reworkLaborMinutes / 60) * input.laborRatePerHour);
  }

  const otherCostByKind = emptyOtherCostByKind();
  let otherCost = 0;
  for (const cost of input.otherCosts) {
    if (cost.removedAt) continue;
    otherCostByKind[cost.kind] = round2(otherCostByKind[cost.kind] + cost.amount);
    otherCost += cost.amount;
  }

  const materialTotal = input.material?.total ?? 0;
  const materialTruth: CostTruth = input.material
    ? input.material.lines.length === 0 && input.material.missingValuationMaterialIds.length > 0
      ? 'missing'
      : input.material.truth
    : 'missing';
  const actualMaterialCost = round2(materialTotal + reworkMaterialCost);

  const laborConfigured = input.laborRatePerHour > 0 || laborMinutes === 0;
  const actualLaborCost = laborConfigured ? round2(laborCost) : null;
  const actualDirectCost =
    actualLaborCost === null ? null : round2(actualMaterialCost + actualLaborCost + otherCost);

  const baseline = input.baseline;
  const variance =
    baseline && actualDirectCost !== null ? round2(actualDirectCost - baseline.estimatedDirectCost) : null;
  const actualGrossMargin =
    baseline && actualDirectCost !== null ? round2(baseline.revenue - actualDirectCost) : null;

  return {
    revenue: baseline?.revenue ?? null,
    estimatedDirectCost: baseline?.estimatedDirectCost ?? null,
    actualMaterialCost,
    actualMaterialTruth: materialTruth,
    actualLaborMinutes: Math.round(laborMinutes * 10) / 10,
    actualLaborCost,
    actualOtherCost: round2(otherCost),
    actualDirectCost,
    variance,
    expectedGrossMargin: baseline?.expectedGrossMargin ?? null,
    expectedMarginPercent: baseline?.expectedMarginPercent ?? null,
    actualGrossMargin,
    actualMarginPercent:
      actualGrossMargin !== null && baseline && baseline.revenue > 0
        ? round2((actualGrossMargin / baseline.revenue) * 100)
        : null,
    minutesByCategory,
    otherCostByKind,
  };
}

export function timeEntryCost(entry: Pick<TimeEntry, 'minutes' | 'ratePerHour'>): number {
  return round2((entry.minutes / 60) * entry.ratePerHour);
}

function emptyMinutesByCategory(): Record<TimeEntryCategory, number> {
  const record = {} as Record<TimeEntryCategory, number>;
  for (const category of TIME_ENTRY_CATEGORIES) record[category] = 0;
  return record;
}

function emptyOtherCostByKind(): Record<OtherCostKind, number> {
  const record = {} as Record<OtherCostKind, number>;
  for (const kind of OTHER_COST_KINDS) record[kind] = 0;
  return record;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ── Actions ───────────────────────────────────────────────────────────────── */

function generateCostingId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function requireCosting(project: Project): JobCosting {
  const costing = project.costing;
  if (!costing) {
    throw new ValidationError('La obra no tiene módulo de costos iniciado');
  }
  return costing;
}

function withCosting(project: Project, costing: JobCosting): Project {
  return { ...project, costing };
}

export interface CaptureCostBaselineParams {
  readonly byUserId?: string;
  readonly at?: string;
  readonly source?: ProjectEventSource;
}

/**
 * Freeze the official cost baseline of the job (OC-080) from the current quote
 * snapshot and production release. Both sources must exist; a baseline already
 * frozen for the same release is not overwritten, while a new release (change
 * order re-release) allows recapture with full traceability.
 */
export function captureCostBaseline(
  project: Project,
  params: CaptureCostBaselineParams = {},
): { project: Project; costing: JobCosting; baseline: CostBaseline; events: readonly ProjectEvent[] } {
  const snapshot = project.priceSnapshot;
  const release = project.productionRelease;
  const blockers: string[] = [];
  if (!snapshot) {
    blockers.push('capturar el snapshot de cotización (cerrar la cotización)');
  }
  if (!release) {
    blockers.push('liberar la revisión de ingeniería a producción');
  }
  if (blockers.length > 0) {
    throw new ValidationError(`Falta para capturar el baseline: ${blockers.join(' y ')}`);
  }

  const existing = project.costing?.baseline;
  if (existing && existing.source.releaseId === release!.id) {
    throw new ValidationError(
      'El baseline ya fue capturado para esta liberación; capture de nuevo sólo tras una nueva liberación',
    );
  }

  const at = params.at ?? new Date().toISOString();
  const breakdown = snapshot!.breakdown;
  const estimatedDirectCost = round2(
    breakdown.materialsCost +
      breakdown.edgeTotal +
      breakdown.hardwareTotal +
      breakdown.laborModular +
      breakdown.laborFixedCost,
  );
  const revenue = breakdown.salePrice;
  const expectedGrossMargin = round2(revenue - estimatedDirectCost);
  const baseline: CostBaseline = {
    id: generateCostingId('cb'),
    projectId: project.id,
    capturedAt: at,
    capturedByUserId: params.byUserId,
    source: {
      quoteSnapshotCapturedAt: snapshot!.capturedAt,
      projectVersion: project.version ?? 1,
      releaseId: release!.id,
      bomFingerprint: release!.bomFingerprint,
    },
    revenue,
    materialsCost: breakdown.materialsCost,
    edgeTotal: breakdown.edgeTotal,
    hardwareTotal: breakdown.hardwareTotal,
    laborModular: breakdown.laborModular,
    laborFixedCost: breakdown.laborFixedCost,
    estimatedDirectCost,
    expectedGrossMargin,
    expectedMarginPercent: revenue > 0 ? round2((expectedGrossMargin / revenue) * 100) : 0,
  };

  const previous = project.costing;
  const costing: JobCosting = {
    id: previous?.id ?? generateCostingId('jc'),
    projectId: project.id,
    baseline,
    laborRatePerHour: previous?.laborRatePerHour ?? 0,
    timeEntries: previous?.timeEntries ?? [],
    otherCosts: previous?.otherCosts ?? [],
    createdAt: previous?.createdAt ?? at,
  };

  const event = costingEvent(project, 'cost_baseline_captured', {
    byUserId: params.byUserId,
    at,
    source: params.source,
    note: 'Baseline de costos capturado',
    payload: {
      baselineId: baseline.id,
      releaseId: baseline.source.releaseId,
      bomFingerprint: baseline.source.bomFingerprint,
      revenue,
      estimatedDirectCost,
      expectedGrossMargin,
    },
  });
  const updatedProject = appendProjectEvent(withCosting(project, costing), event);
  return { project: updatedProject, costing, baseline, events: [event] };
}

export interface SetLaborRateParams {
  readonly ratePerHour: number;
  readonly at?: string;
}

/**
 * Set the shop hourly rate in force for new time entries. Existing entries
 * keep their frozen rate, so history is never rewritten.
 */
export function setLaborRate(
  project: Project,
  params: SetLaborRateParams,
): { project: Project; costing: JobCosting } {
  const costing = requireCosting(project);
  if (!Number.isFinite(params.ratePerHour) || params.ratePerHour <= 0) {
    throw new ValidationError('La tarifa horaria debe ser mayor a cero');
  }
  const updated: JobCosting = { ...costing, laborRatePerHour: params.ratePerHour };
  return { project: withCosting(project, updated), costing: updated };
}

export interface RecordTimeEntryParams {
  readonly category: TimeEntryCategory;
  readonly minutes: number;
  readonly at?: string;
  readonly byUserId?: string;
  readonly byName?: string;
  readonly note?: string;
  readonly source?: ProjectEventSource;
}

/** Record actual labor time on the job (OC-081), freezing the current hourly rate. */
export function recordTimeEntry(
  project: Project,
  params: RecordTimeEntryParams,
): { project: Project; costing: JobCosting; entry: TimeEntry; events: readonly ProjectEvent[] } {
  const costing = requireCosting(project);
  if (!isTimeEntryCategory(params.category)) {
    throw new ValidationError(`Categoría de tiempo inválida: ${String(params.category)}`);
  }
  if (!Number.isFinite(params.minutes) || params.minutes <= 0) {
    throw new ValidationError('Los minutos deben ser mayores a cero');
  }
  const at = params.at ?? new Date().toISOString();
  const entry: TimeEntry = {
    id: generateCostingId('tme'),
    category: params.category,
    minutes: params.minutes,
    at,
    byUserId: params.byUserId,
    byName: params.byName,
    note: params.note?.trim() || undefined,
    ratePerHour: costing.laborRatePerHour,
  };
  const updated: JobCosting = { ...costing, timeEntries: [...costing.timeEntries, entry] };
  const event = costingEvent(project, 'cost_time_recorded', {
    byUserId: params.byUserId,
    at,
    source: params.source,
    payload: { entryId: entry.id, category: entry.category, minutes: entry.minutes, ratePerHour: entry.ratePerHour },
  });
  const updatedProject = appendProjectEvent(withCosting(project, updated), event);
  return { project: updatedProject, costing: updated, entry, events: [event] };
}

export interface VoidEntryParams {
  readonly byUserId?: string;
  readonly byName?: string;
  readonly at?: string;
  readonly reason?: string;
  readonly source?: ProjectEventSource;
}

/** Soft-void a time entry (audit trail preserved, cost stops counting). */
export function voidTimeEntry(
  project: Project,
  entryId: string,
  params: VoidEntryParams = {},
): { project: Project; costing: JobCosting; events: readonly ProjectEvent[] } {
  const costing = requireCosting(project);
  const entry = costing.timeEntries.find((e) => e.id === entryId);
  if (!entry) {
    throw new ValidationError(`Registro de tiempo no encontrado: ${entryId}`);
  }
  if (entry.removedAt) {
    throw new ValidationError('El registro de tiempo ya está anulado');
  }
  const at = params.at ?? new Date().toISOString();
  const voided: TimeEntry = {
    ...entry,
    removedAt: at,
    removedByUserId: params.byUserId,
    removedByName: params.byName,
  };
  const updated: JobCosting = {
    ...costing,
    timeEntries: costing.timeEntries.map((e) => (e.id === entryId ? voided : e)),
  };
  const event = costingEvent(project, 'cost_entry_voided', {
    byUserId: params.byUserId,
    at,
    source: params.source,
    note: params.reason?.trim() || undefined,
    payload: { entryType: 'time', entryId, category: entry.category, minutes: entry.minutes },
  });
  const updatedProject = appendProjectEvent(withCosting(project, updated), event);
  return { project: updatedProject, costing: updated, events: [event] };
}

export interface RecordOtherCostParams {
  readonly kind: OtherCostKind;
  readonly amount: number;
  readonly at?: string;
  readonly byUserId?: string;
  readonly byName?: string;
  readonly vendor?: string;
  readonly note?: string;
  readonly source?: ProjectEventSource;
}

/** Record an out-of-production actual cost (OC-083): freight, outsource, etc. */
export function recordOtherCost(
  project: Project,
  params: RecordOtherCostParams,
): { project: Project; costing: JobCosting; cost: OtherActualCost; events: readonly ProjectEvent[] } {
  const costing = requireCosting(project);
  if (!isOtherCostKind(params.kind)) {
    throw new ValidationError(`Tipo de costo inválido: ${String(params.kind)}`);
  }
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new ValidationError('El monto debe ser mayor a cero');
  }
  const at = params.at ?? new Date().toISOString();
  const cost: OtherActualCost = {
    id: generateCostingId('oth'),
    kind: params.kind,
    amount: round2(params.amount),
    at,
    byUserId: params.byUserId,
    byName: params.byName,
    vendor: params.vendor?.trim() || undefined,
    note: params.note?.trim() || undefined,
  };
  const updated: JobCosting = { ...costing, otherCosts: [...costing.otherCosts, cost] };
  const event = costingEvent(project, 'cost_other_recorded', {
    byUserId: params.byUserId,
    at,
    source: params.source,
    payload: { costId: cost.id, kind: cost.kind, amount: cost.amount },
  });
  const updatedProject = appendProjectEvent(withCosting(project, updated), event);
  return { project: updatedProject, costing: updated, cost, events: [event] };
}

/** Soft-void an other actual cost (audit trail preserved). */
export function voidOtherCost(
  project: Project,
  costId: string,
  params: VoidEntryParams = {},
): { project: Project; costing: JobCosting; events: readonly ProjectEvent[] } {
  const costing = requireCosting(project);
  const cost = costing.otherCosts.find((c) => c.id === costId);
  if (!cost) {
    throw new ValidationError(`Costo no encontrado: ${costId}`);
  }
  if (cost.removedAt) {
    throw new ValidationError('El costo ya está anulado');
  }
  const at = params.at ?? new Date().toISOString();
  const voided: OtherActualCost = {
    ...cost,
    removedAt: at,
    removedByUserId: params.byUserId,
    removedByName: params.byName,
  };
  const updated: JobCosting = {
    ...costing,
    otherCosts: costing.otherCosts.map((c) => (c.id === costId ? voided : c)),
  };
  const event = costingEvent(project, 'cost_entry_voided', {
    byUserId: params.byUserId,
    at,
    source: params.source,
    note: params.reason?.trim() || undefined,
    payload: { entryType: 'other', entryId: costId, kind: cost.kind, amount: cost.amount },
  });
  const updatedProject = appendProjectEvent(withCosting(project, updated), event);
  return { project: updatedProject, costing: updated, events: [event] };
}

function costingEvent(
  project: Project,
  type: CostEventType,
  params: {
    readonly byUserId?: string;
    readonly at: string;
    readonly source?: ProjectEventSource;
    readonly note?: string;
    readonly payload?: Record<string, unknown>;
  },
): ProjectEvent {
  return createProjectEvent({
    projectId: project.id,
    type,
    at: params.at,
    byUserId: params.byUserId,
    source: params.source,
    note: params.note,
    payload: params.payload,
  });
}

/* ── Validation (server shape re-check, parity with Go ValidateJobCostingShape) ─ */

/**
 * Structural validation of a JobCosting payload (server re-checks what the
 * client sends). Mirrored by backend-go ValidateJobCostingShape.
 */
export function validateJobCostingShape(costing: JobCosting | undefined): string[] {
  const errors: string[] = [];
  if (!costing) return errors;
  if (!costing.id) errors.push('costing.id requerido');
  if (!costing.projectId) errors.push('costing.projectId requerido');
  if (!(costing.laborRatePerHour >= 0)) errors.push('costing.laborRatePerHour debe ser >= 0');
  for (const entry of costing.timeEntries) {
    if (!isTimeEntryCategory(entry.category)) errors.push(`timeEntry ${entry.id}: categoría inválida`);
    if (!(entry.minutes > 0)) errors.push(`timeEntry ${entry.id}: minutos deben ser > 0`);
    if (!(entry.ratePerHour >= 0)) errors.push(`timeEntry ${entry.id}: tarifa debe ser >= 0`);
    if (entry.removedAt && !entry.removedByUserId) {
      errors.push(`timeEntry ${entry.id}: anulación sin autor`);
    }
  }
  for (const cost of costing.otherCosts) {
    if (!isOtherCostKind(cost.kind)) errors.push(`otherCost ${cost.id}: tipo inválido`);
    if (!(cost.amount > 0)) errors.push(`otherCost ${cost.id}: monto debe ser > 0`);
    if (cost.removedAt && !cost.removedByUserId) errors.push(`otherCost ${cost.id}: anulación sin autor`);
  }
  const baseline = costing.baseline;
  if (baseline) {
    if (!baseline.id) errors.push('baseline.id requerido');
    if (!baseline.source?.releaseId) errors.push('baseline.source.releaseId requerido');
    if (!baseline.source?.bomFingerprint) errors.push('baseline.source.bomFingerprint requerido');
    if (!(baseline.revenue >= 0)) errors.push('baseline.revenue debe ser >= 0');
    if (!(baseline.estimatedDirectCost >= 0)) errors.push('baseline.estimatedDirectCost debe ser >= 0');
  }
  return errors;
}
