/**
 * Material planning / MRP ligero (OC-050..OC-054) — requirements derived from
 * the released BOM, per-project reservations, honest availability
 * (onHand/reserved/available/incoming/required/shortage) and an
 * evidence-backed materials release with audited override.
 *
 * Reference: docs/operational-core-v1.md §8, docs/prd-v2.md §10.
 * Demand never comes from dashboard heuristics: a MaterialRequirementsSnapshot
 * only exists when derived from a real ProductionRelease (bomFingerprint).
 */

import { ValidationError } from './errors';
import type { MaterialStock, StockMaterialKind } from './stock';
import type { PurchaseOrder } from './purchasingOrders';
import { poRemaining } from './purchasingOrders';
import type { Project } from './types';
import {
  appendProjectEvent,
  createProjectEvent,
  isEventRecorded,
  type ProjectEvent,
  type ProjectEventSource,
} from './projectLifecycle';

/* ── Status vocabularies (parity: contracts/materialPlanning.json) ────────── */

export const MATERIAL_RESERVATION_STATUSES = ['active', 'released', 'consumed'] as const;
export type MaterialReservationStatus = (typeof MATERIAL_RESERVATION_STATUSES)[number];

export const MATERIAL_RESERVATION_STATUS_LABELS_ES: Readonly<Record<MaterialReservationStatus, string>> = {
  active: 'Activa',
  released: 'Liberada a piso',
  consumed: 'Consumida',
};

export type MaterialsReleaseCheckCode =
  | 'requirements_derived'
  | 'lines_reserved'
  | 'reservations_backed';

export const MATERIALS_RELEASE_CHECK_LABELS_ES: Readonly<Record<MaterialsReleaseCheckCode, string>> = {
  requirements_derived: 'Requerimientos derivados del BOM liberado',
  lines_reserved: 'Todas las líneas cubiertas con reservas',
  reservations_backed: 'Reservas respaldadas por stock físico',
};

/* ── Entities ──────────────────────────────────────────────────────────────── */

/** One material line of the released-BOM requirement (kind+materialId unique). */
export interface MaterialRequirementLine {
  readonly kind: StockMaterialKind;
  readonly materialId: string;
  readonly quantity: number;
}

/**
 * Requirements snapshot materialized from the released BOM (OC-050). Bound to
 * the ProductionRelease it was derived from — never to dashboard heuristics.
 */
export interface MaterialRequirementsSnapshot {
  readonly releaseId?: string;
  readonly bomFingerprint?: string;
  readonly derivedAt: string;
  readonly derivedBy?: string;
  readonly lines: readonly MaterialRequirementLine[];
}

/** A warehouse reservation of material for one project (OC-051). */
export interface MaterialReservation {
  readonly id: string;
  readonly kind: StockMaterialKind;
  readonly materialId: string;
  readonly quantity: number;
  readonly status: MaterialReservationStatus;
  readonly reservedBy?: string;
  readonly reservedAt: string;
  readonly releasedAt?: string;
  readonly consumedAt?: string;
}

/** Evidence + audited override backing a materials release (OC-054). */
export interface MaterialsReleaseEvidence {
  readonly releasedBy?: string;
  readonly releasedAt: string;
  readonly override?: {
    readonly reason: string;
    readonly byUserId?: string;
    readonly at: string;
    /** Release check codes that were failing when the override was recorded. */
    readonly failingChecks: readonly MaterialsReleaseCheckCode[];
  };
}

/** Material planning subprocess of one project. */
export interface MaterialPlanning {
  readonly id: string;
  readonly projectId: string;
  readonly requirements?: MaterialRequirementsSnapshot;
  readonly reservations: readonly MaterialReservation[];
  readonly release?: MaterialsReleaseEvidence;
  readonly createdAt: string;
}

/* ── Requirements derivation (OC-050) ─────────────────────────────────────── */

export interface BuildRequirementsInput {
  /** Hardware demand (e.g. generateHardwareList): purchaseQuantity per hardwareId. */
  readonly hardware: readonly { readonly hardwareId: string; readonly purchaseQuantity: number }[];
  /** Board demand (e.g. estimateBoardSheets): estimatedSheets per materialId. */
  readonly sheetEstimates: readonly { readonly materialId: string; readonly estimatedSheets: number }[];
  /** Edge band demand (e.g. computeProductionTotals edges): ml per edge materialId. */
  readonly edgeMeters: readonly { readonly materialId: string; readonly ml: number }[];
  readonly derivedBy?: string;
  readonly at?: string;
}

function roundQty(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build the requirement lines from the released-BOM aggregates. The caller
 * resolves the demand with the domain engine (hardware list, sheet estimates,
 * edge totals); this function normalizes, dedupes and validates the snapshot.
 */
export function buildMaterialRequirements(
  input: BuildRequirementsInput,
): readonly MaterialRequirementLine[] {
  const byKey = new Map<string, MaterialRequirementLine>();
  const add = (kind: StockMaterialKind, materialId: string, quantity: number): void => {
    const id = materialId.trim();
    if (!id) {
      throw new ValidationError(`Línea de requerimiento sin material (${kind})`);
    }
    if (!(quantity > 0)) {
      throw new ValidationError(`La cantidad de ${kind} ${id} debe ser mayor a cero`);
    }
    const key = `${kind}:${id}`;
    const prev = byKey.get(key);
    byKey.set(key, {
      kind,
      materialId: id,
      quantity: roundQty((prev?.quantity ?? 0) + quantity),
    });
  };

  for (const h of input.hardware) add('herrajes', h.hardwareId, h.purchaseQuantity);
  for (const s of input.sheetEstimates) add('tableros', s.materialId, s.estimatedSheets);
  for (const e of input.edgeMeters) add('cintillas', e.materialId, e.ml);

  if (byKey.size === 0) {
    throw new ValidationError('El BOM liberado no produjo líneas de requerimiento');
  }
  return [...byKey.values()];
}

/**
 * Materialize the requirements snapshot on a project. OC-050: only a released
 * project (ProductionRelease with bomFingerprint) can materialize requirements
 * — there is no heuristic path.
 */
export function materializeRequirements(
  project: Project,
  params: {
    readonly lines: readonly MaterialRequirementLine[];
    readonly derivedBy?: string;
    readonly at?: string;
    readonly source?: ProjectEventSource;
  },
): { project: Project; planning: MaterialPlanning; events: readonly ProjectEvent[] } {
  const release = project.productionRelease;
  if (!release) {
    throw new ValidationError(
      'Los requerimientos se derivan del BOM liberado: la obra no tiene liberación de producción',
    );
  }
  const at = params.at ?? new Date().toISOString();
  const lines = buildMaterialRequirements({
    hardware: params.lines.filter((l) => l.kind === 'herrajes').map((l) => ({
      hardwareId: l.materialId,
      purchaseQuantity: l.quantity,
    })),
    sheetEstimates: params.lines.filter((l) => l.kind === 'tableros').map((l) => ({
      materialId: l.materialId,
      estimatedSheets: l.quantity,
    })),
    edgeMeters: params.lines.filter((l) => l.kind === 'cintillas').map((l) => ({
      materialId: l.materialId,
      ml: l.quantity,
    })),
    derivedBy: params.derivedBy,
    at,
  });

  const planning: MaterialPlanning = project.materialPlanning ?? {
    id: generatePlanningId(),
    projectId: project.id,
    reservations: [],
    createdAt: at,
  };
  const next: MaterialPlanning = {
    ...planning,
    requirements: {
      releaseId: release.id,
      bomFingerprint: release.bomFingerprint,
      derivedAt: at,
      derivedBy: params.derivedBy,
      lines,
    },
  };

  const event = planningEvent(project, 'materials_required', {
    byUserId: params.derivedBy,
    at,
    source: params.source,
    note: `Requerimientos derivados del BOM liberado (${lines.length} líneas)`,
    payload: { releaseId: release.id, bomFingerprint: release.bomFingerprint, lineCount: lines.length },
  });
  const updatedProject = appendProjectEvent(withPlanning(project, next), event);
  return { project: updatedProject, planning: next, events: [event] };
}

/* ── Availability (OC-051) ─────────────────────────────────────────────────── */

/** The six honest quantities for one material across the warehouse. */
export interface MaterialAvailability {
  readonly kind: StockMaterialKind;
  readonly materialId: string;
  readonly onHand: number;
  readonly reserved: number;
  readonly available: number;
  readonly incoming: number;
  readonly required: number;
  readonly shortage: number;
}

export interface WarehouseAvailabilityInput {
  readonly stock: readonly MaterialStock[];
  /** All project plannings; a planning counts toward `required` until its release. */
  readonly plannings: readonly MaterialPlanning[];
  readonly purchaseOrders: readonly PurchaseOrder[];
}

function keyOf(kind: StockMaterialKind, materialId: string): string {
  return `${kind}:${materialId}`;
}

/**
 * Warehouse availability per material: available = onHand − reserved;
 * incoming = pending reception of emitted POs; shortage = what neither stock
 * nor already-ordered incoming can cover (OC-051, docs/prd-v2.md §10).
 */
export function computeWarehouseAvailability(
  input: WarehouseAvailabilityInput,
): readonly MaterialAvailability[] {
  type MutableRow = {
    kind: StockMaterialKind;
    materialId: string;
    onHand: number;
    reserved: number;
    incoming: number;
    required: number;
  };
  const acc = new Map<string, MutableRow>();
  const touch = (kind: StockMaterialKind, materialId: string): MutableRow => {
    const key = keyOf(kind, materialId);
    let row = acc.get(key);
    if (!row) {
      row = { kind, materialId, onHand: 0, reserved: 0, incoming: 0, required: 0 };
      acc.set(key, row);
    }
    return row;
  };

  for (const s of input.stock) {
    touch(s.kind, s.materialId).onHand += s.quantity;
  }
  for (const plan of input.plannings) {
    for (const r of plan.reservations) {
      if (r.status === 'active') touch(r.kind, r.materialId).reserved += r.quantity;
    }
    if (!plan.release?.releasedAt) {
      for (const line of plan.requirements?.lines ?? []) {
        touch(line.kind, line.materialId).required += line.quantity;
      }
    }
  }
  for (const po of input.purchaseOrders) {
    if (po.status !== 'emitida') continue;
    for (const item of po.items) {
      touch(item.kind, item.materialId).incoming += poRemaining(item);
    }
  }

  return [...acc.values()].map((row) => ({
    kind: row.kind,
    materialId: row.materialId,
    onHand: roundQty(row.onHand),
    reserved: roundQty(row.reserved),
    available: roundQty(row.onHand - row.reserved),
    incoming: roundQty(row.incoming),
    required: roundQty(row.required),
    shortage: roundQty(Math.max(0, row.required - row.onHand - row.incoming)),
  }));
}

/* ── Per-project coverage (OC-051/052) ────────────────────────────────────── */

export interface ProjectMaterialLineCoverage {
  readonly kind: StockMaterialKind;
  readonly materialId: string;
  readonly required: number;
  /** This project's active reservations for the line. */
  readonly reserved: number;
  /** What is still missing to reserve. */
  readonly pendingReserve: number;
  /** Warehouse availability for the material (after every project's reservations). */
  readonly available: number;
  /** Pending reception of emitted PO lines allocated to this project. */
  readonly incomingAllocated: number;
  /** What neither stock nor allocated incoming covers → buy (OC-052). */
  readonly shortage: number;
  readonly covered: boolean;
}

export interface ProjectCoverageInput {
  readonly stock: readonly MaterialStock[];
  readonly plannings: readonly MaterialPlanning[];
  readonly purchaseOrders: readonly PurchaseOrder[];
}

/**
 * Coverage of one project's requirement lines: reserved vs required vs what
 * must be purchased. This is the evidence the release UI shows (OC-054).
 */
export function computeProjectMaterialCoverage(
  projectId: string,
  input: ProjectCoverageInput,
): readonly ProjectMaterialLineCoverage[] {
  const availability = new Map(
    computeWarehouseAvailability(input).map((row) => [keyOf(row.kind, row.materialId), row]),
  );
  const planning = input.plannings.find((p) => p.projectId === projectId);
  const lines = planning?.requirements?.lines ?? [];
  if (lines.length === 0) return [];

  // Coverage counts every reservation status: active (earmarked) and
  // released/consumed (already handed to the project) all satisfy the line.
  const coveredQty = new Map<string, number>();
  for (const r of planning?.reservations ?? []) {
    const key = keyOf(r.kind, r.materialId);
    coveredQty.set(key, (coveredQty.get(key) ?? 0) + r.quantity);
  }
  const incomingAllocated = new Map<string, number>();
  for (const po of input.purchaseOrders) {
    if (po.status !== 'emitida') continue;
    for (const item of po.items) {
      if (item.allocatedProjectId !== projectId) continue;
      const key = keyOf(item.kind, item.materialId);
      incomingAllocated.set(key, (incomingAllocated.get(key) ?? 0) + poRemaining(item));
    }
  }

  return lines.map((line) => {
    const key = keyOf(line.kind, line.materialId);
    const reserved = roundQty(coveredQty.get(key) ?? 0);
    const available = availability.get(key)?.available ?? 0;
    const allocated = roundQty(incomingAllocated.get(key) ?? 0);
    const pendingReserve = roundQty(Math.max(0, line.quantity - reserved));
    return {
      kind: line.kind,
      materialId: line.materialId,
      required: line.quantity,
      reserved,
      pendingReserve,
      available,
      incomingAllocated: allocated,
      shortage: roundQty(Math.max(0, pendingReserve - available - allocated)),
      covered: reserved >= line.quantity,
    };
  });
}

/* ── Shortage → purchase order draft lines (OC-052/053) ───────────────────── */

export interface ShortagePurchaseLine {
  readonly kind: StockMaterialKind;
  readonly materialId: string;
  readonly quantity: number;
  readonly allocatedProjectId: string;
  readonly requiredBy?: string;
}

/**
 * Turn a project's shortage into PO draft lines (OC-052): purchases are born
 * from real need with allocation to the obra, not from min-stock proxies.
 */
export function planShortagePurchaseLines(
  coverage: readonly ProjectMaterialLineCoverage[],
  projectId: string,
  opts: { readonly requiredBy?: string } = {},
): readonly ShortagePurchaseLine[] {
  return coverage
    .filter((line) => line.shortage > 0)
    .map((line) => ({
      kind: line.kind,
      materialId: line.materialId,
      quantity: line.shortage,
      allocatedProjectId: projectId,
      requiredBy: opts.requiredBy,
    }));
}

/* ── Reservations (OC-051) ─────────────────────────────────────────────────── */

export interface ReserveResult {
  readonly project: Project;
  readonly planning: MaterialPlanning;
  readonly events: readonly ProjectEvent[];
  readonly reservedLines: readonly { readonly kind: StockMaterialKind; readonly materialId: string; readonly quantity: number }[];
  readonly shortLines: readonly { readonly kind: StockMaterialKind; readonly materialId: string; readonly quantity: number }[];
}

/**
 * Reserve material for the project against warehouse availability. Without
 * explicit lines, reserves every pending requirement line. Reservations are
 * capped by what is physically available — the remainder is reported as
 * shortage (and audited via materials_shortage_detected).
 */
export function reserveProjectMaterials(
  project: Project,
  params: {
    readonly lines?: readonly { readonly kind: StockMaterialKind; readonly materialId: string; readonly quantity: number }[];
    readonly stock: readonly MaterialStock[];
    readonly plannings: readonly MaterialPlanning[];
    readonly byUserId?: string;
    readonly at?: string;
    readonly source?: ProjectEventSource;
  },
): ReserveResult {
  const planning = project.materialPlanning;
  if (!planning?.requirements) {
    throw new ValidationError('Derivar los requerimientos del BOM liberado antes de reservar material');
  }
  if (planning.release) {
    throw new ValidationError('El material de esta obra ya fue liberado');
  }

  const coverage = computeProjectMaterialCoverage(project.id, {
    stock: params.stock,
    plannings: params.plannings,
    purchaseOrders: [],
  });
  const coverageBy = new Map(
    coverage.map((line) => [keyOf(line.kind, line.materialId), line] as const),
  );

  const wanted =
    params.lines ??
    coverage
      .filter((line) => line.pendingReserve > 0)
      .map((line) => ({ kind: line.kind, materialId: line.materialId, quantity: line.pendingReserve }));

  const at = params.at ?? new Date().toISOString();
  const reservations: MaterialReservation[] = [...planning.reservations];
  const reservedLines: Array<{ kind: StockMaterialKind; materialId: string; quantity: number }> = [];
  const shortLines: Array<{ kind: StockMaterialKind; materialId: string; quantity: number }> = [];

  for (const line of wanted) {
    if (!(line.quantity > 0)) continue;
    const cov = coverageBy.get(keyOf(line.kind, line.materialId));
    const canReserve = Math.min(line.quantity, Math.max(0, cov?.available ?? 0));
    if (canReserve > 0) {
      reservations.push({
        id: generatePlanningId('mres'),
        kind: line.kind,
        materialId: line.materialId,
        quantity: roundQty(canReserve),
        status: 'active',
        reservedBy: params.byUserId,
        reservedAt: at,
      });
      reservedLines.push({ kind: line.kind, materialId: line.materialId, quantity: roundQty(canReserve) });
    }
    const stillMissing = roundQty(line.quantity - canReserve);
    if (stillMissing > 0) {
      shortLines.push({ kind: line.kind, materialId: line.materialId, quantity: stillMissing });
    }
  }

  const next: MaterialPlanning = { ...planning, reservations };
  const events: ProjectEvent[] = [];
  if (reservedLines.length > 0 && !isEventRecorded(project, 'materials_reserved')) {
    events.push(
      planningEvent(project, 'materials_reserved', {
        byUserId: params.byUserId,
        at,
        source: params.source,
        note: `Material reservado (${reservedLines.length} líneas)`,
        payload: { lines: reservedLines },
      }),
    );
  }
  if (shortLines.length > 0) {
    events.push(
      planningEvent(project, 'materials_shortage_detected', {
        byUserId: params.byUserId,
        at,
        source: params.source,
        note: `Faltante de material detectado (${shortLines.length} líneas)`,
        payload: { lines: shortLines },
      }),
    );
  }

  let updatedProject = withPlanning(project, next);
  for (const event of events) {
    updatedProject = appendProjectEvent(updatedProject, event);
  }
  return { project: updatedProject, planning: next, events, reservedLines, shortLines };
}

/**
 * Mark reservations consumed by a picking despacho (quantity per material,
 * oldest reservations first). Returns the planning unchanged when there is
 * nothing to consume.
 */
export function consumePlannedMaterials(
  planning: MaterialPlanning | undefined,
  debitLines: readonly { readonly kind: StockMaterialKind; readonly materialId: string; readonly quantity: number }[],
  at?: string,
): MaterialPlanning | undefined {
  if (!planning) return planning;
  const remaining = new Map(
    debitLines
      .filter((l) => l.quantity > 0)
      .map((l) => [keyOf(l.kind, l.materialId), l.quantity] as const),
  );
  if (remaining.size === 0) return planning;
  const timestamp = at ?? new Date().toISOString();

  const reservations = planning.reservations.map((r) => {
    const key = keyOf(r.kind, r.materialId);
    const pending = remaining.get(key);
    if (r.status !== 'active' || !pending || pending <= 0) return r;
    const consume = Math.min(r.quantity, pending);
    remaining.set(key, roundQty(pending - consume));
    return consume >= r.quantity
      ? { ...r, status: 'consumed' as const, consumedAt: timestamp }
      : { ...r, quantity: roundQty(r.quantity - consume) };
  });
  return { ...planning, reservations };
}

/* ── Materials release gates (OC-054) ─────────────────────────────────────── */

export interface MaterialsReleaseCheck {
  readonly code: MaterialsReleaseCheckCode;
  readonly label: string;
  readonly passed: boolean;
  readonly required: boolean;
  /** When failing, explains how to resolve the blocker. */
  readonly details: string;
}

export interface MaterialsReleaseReadiness {
  readonly ready: boolean;
  readonly checks: readonly MaterialsReleaseCheck[];
  readonly failing: readonly MaterialsReleaseCheck[];
}

/**
 * Evidence-based release readiness (OC-054): requirements derived from the
 * released BOM, every line covered by reservations, and reservations backed
 * by physical stock. `materialsRelease` may still happen as the human
 * confirmation, but only with an audited override when evidence is missing.
 */
export function evaluateMaterialsReleaseReadiness(input: {
  readonly planning: MaterialPlanning | undefined;
  readonly stock: readonly MaterialStock[];
  readonly plannings: readonly MaterialPlanning[];
}): MaterialsReleaseReadiness {
  const planning = input.planning;
  const lines = planning?.requirements?.lines ?? [];
  const requirementsPassed = lines.length > 0;

  const coverage = planning
    ? computeProjectMaterialCoverage(planning.projectId, {
        stock: input.stock,
        plannings: input.plannings,
        purchaseOrders: [],
      })
    : [];
  const uncovered = coverage.filter((line) => !line.covered);

  // Overcommitment: total active reservations per material vs physical stock.
  const onHandBy = new Map<string, number>();
  for (const s of input.stock) onHandBy.set(keyOf(s.kind, s.materialId), s.quantity);
  const reservedBy = new Map<string, { kind: StockMaterialKind; materialId: string; total: number }>();
  for (const plan of input.plannings) {
    for (const r of plan.reservations) {
      if (r.status !== 'active') continue;
      const key = keyOf(r.kind, r.materialId);
      const row = reservedBy.get(key) ?? { kind: r.kind, materialId: r.materialId, total: 0 };
      row.total += r.quantity;
      reservedBy.set(key, row);
    }
  }
  const projectMaterialKeys = new Set(coverage.map((line) => keyOf(line.kind, line.materialId)));
  const overcommitted = [...reservedBy.values()].filter(
    (row) => projectMaterialKeys.has(keyOf(row.kind, row.materialId)) &&
      row.total > (onHandBy.get(keyOf(row.kind, row.materialId)) ?? 0),
  );

  const checks: MaterialsReleaseCheck[] = [
    {
      code: 'requirements_derived',
      label: MATERIALS_RELEASE_CHECK_LABELS_ES.requirements_derived,
      passed: requirementsPassed,
      required: true,
      details: requirementsPassed
        ? `Requerimientos derivados del BOM liberado (${lines.length} líneas)`
        : 'Derivar los requerimientos del BOM liberado antes de liberar material',
    },
    {
      code: 'lines_reserved',
      label: MATERIALS_RELEASE_CHECK_LABELS_ES.lines_reserved,
      passed: uncovered.length === 0 && requirementsPassed,
      required: true,
      details:
        uncovered.length === 0
          ? requirementsPassed
            ? 'Todas las líneas cubiertas con reservas'
            : 'Sin requerimientos derivados'
          : `${uncovered.length} línea(s) sin reservar completo: reservar o generar compra del faltante`,
    },
    {
      code: 'reservations_backed',
      label: MATERIALS_RELEASE_CHECK_LABELS_ES.reservations_backed,
      passed: overcommitted.length === 0,
      required: true,
      details:
        overcommitted.length === 0
          ? 'Las reservas están respaldadas por stock físico'
          : `${overcommitted.length} material(es) con reservas mayores al stock físico: registrar recepciones (entradas) antes de liberar`,
    },
  ];
  const failing = checks.filter((c) => c.required && !c.passed);
  return { ready: failing.length === 0, checks, failing };
}

/**
 * Release the project's materials to the production floor with evidence
 * (OC-054). When gates fail, an explicit override reason is required and both
 * materials_release_overridden and materials_ready are audited. The release
 * also stamps project.materialsRelease (the processStage gate) and moves this
 * project's active reservations to `released`.
 */
export function releaseProjectMaterials(
  project: Project,
  params: {
    readonly stock: readonly MaterialStock[];
    readonly plannings: readonly MaterialPlanning[];
    readonly byUserId?: string;
    readonly at?: string;
    readonly source?: ProjectEventSource;
    readonly overrideReason?: string;
  },
): { project: Project; planning: MaterialPlanning; events: readonly ProjectEvent[] } {
  if (project.materialsRelease) {
    throw new ValidationError('El material de esta obra ya fue liberado');
  }

  const at = params.at ?? new Date().toISOString();
  const { ready, failing } = evaluateMaterialsReleaseReadiness({
    planning: project.materialPlanning,
    stock: params.stock,
    plannings: params.plannings,
  });
  const overrideReason = params.overrideReason?.trim();
  if (!ready && !overrideReason) {
    const reasons = failing.map((c) => c.label).join(', ');
    throw new ValidationError(`No se puede liberar el material sin evidencia: faltan gates (${reasons}); usar override con motivo`);
  }

  const existing = project.materialPlanning;
  const planning: MaterialPlanning = existing ?? {
    id: generatePlanningId(),
    projectId: project.id,
    reservations: [],
    createdAt: at,
  };
  const next: MaterialPlanning = {
    ...planning,
    reservations: planning.reservations.map((r) =>
      r.status === 'active' ? { ...r, status: 'released', releasedAt: at } : r,
    ),
    release: {
      releasedAt: at,
      releasedBy: params.byUserId,
      ...(ready || !overrideReason
        ? {}
        : {
            override: {
              reason: overrideReason,
              byUserId: params.byUserId,
              at,
              failingChecks: failing.map((c) => c.code),
            },
          }),
    },
  };

  const events: ProjectEvent[] = [];
  if (!ready && overrideReason) {
    events.push(
      planningEvent(project, 'materials_release_overridden', {
        byUserId: params.byUserId,
        at,
        source: params.source,
        note: `Liberación con faltantes (override): ${overrideReason}`,
        payload: { reason: overrideReason, failingChecks: failing.map((c) => c.code) },
      }),
    );
  }
  events.push(
    planningEvent(project, 'materials_ready', {
      byUserId: params.byUserId,
      at,
      source: params.source,
      note: 'Material completo — liberado a producción',
      payload: { lineCount: planning.requirements?.lines.length ?? 0 },
    }),
  );

  let updatedProject: Project = {
    ...withPlanning(project, next),
    materialsRelease: { releasedBy: params.byUserId ?? '', releasedAt: at },
  };
  for (const event of events) {
    updatedProject = appendProjectEvent(updatedProject, event);
  }
  return { project: updatedProject, planning: next, events };
}

/* ── Validation helpers ────────────────────────────────────────────────────── */

export function isMaterialReservationStatus(value: string): value is MaterialReservationStatus {
  return (MATERIAL_RESERVATION_STATUSES as readonly string[]).includes(value);
}

export function activeReservations(planning: MaterialPlanning | undefined): readonly MaterialReservation[] {
  return planning?.reservations.filter((r) => r.status === 'active') ?? [];
}

function generatePlanningId(prefix = 'mplan'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function withPlanning(project: Project, planning: MaterialPlanning): Project {
  return { ...project, materialPlanning: planning };
}

function planningEvent(
  project: Project,
  type: ProjectEvent['type'],
  params: {
    readonly byUserId?: string;
    readonly at?: string;
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
