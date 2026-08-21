/**
 * Project Lifecycle — Append-only events, commercial status, derived stage,
 * real deposit tracking, and audit-grade lifecycle KPIs (OC-010..OC-013).
 *
 * Reference: docs/operational-core-v1.md & docs/project-lifecycle.md
 */

import type { Project, ProjectStatus } from './types';
import type { DataTruthMetric } from './dataTruth';
import { computeProductionDesignFingerprint } from './productionRevision';

/* ── Event Types & Structures ─────────────────────────────────────────────── */

export type ProjectEventSource = 'web' | 'desktop' | 'mobile' | 'api' | 'backfill';

export type CommercialEventType =
  | 'quote_created'
  | 'quote_sent'
  | 'quote_won'
  | 'quote_lost'
  | 'quote_expired'
  | 'quote_cancelled'
  | 'deposit_received';

export type SurveyDesignApprovalEventType =
  | 'survey_started'
  | 'survey_completed'
  | 'design_revision_created'
  | 'design_submitted'
  | 'design_approved'
  | 'design_changes_requested'
  | 'customer_approved'
  | 'customer_rejected'
  | 'engineering_approved'
  | 'engineering_rejected'
  | 'project_approved'
  | 'change_order_created'
  | 'change_order_submitted'
  | 'change_order_approved'
  | 'change_order_rejected'
  | 'change_order_cancelled';

export type EngineeringReleaseEventType =
  | 'engineering_started'
  | 'engineering_documented'
  | 'production_released'
  | 'production_release_revoked';

export type MaterialsEventType =
  | 'materials_required'
  | 'materials_reserved'
  | 'materials_shortage_detected'
  | 'materials_ready'
  | 'materials_release_overridden';

export type ProductionLogisticsEventType =
  | 'production_started'
  | 'production_completed'
  | 'shipment_loaded'
  | 'shipment_departed';

export type QualityEventType = 'quality_issue_reported' | 'rework_started';

export type InstallationCloseEventType =
  | 'installation_started'
  | 'installation_completed'
  | 'punch_opened'
  | 'punch_closed'
  | 'client_signed_off'
  | 'project_closed'
  | 'warranty_opened';

export type ProjectEventType =
  | CommercialEventType
  | SurveyDesignApprovalEventType
  | EngineeringReleaseEventType
  | MaterialsEventType
  | ProductionLogisticsEventType
  | QualityEventType
  | InstallationCloseEventType;

/**
 * Canonical event vocabulary (OC-010). Kept in parity with
 * backend-go/internal/domain/projectEvents.go via the shared contract fixture
 * `contracts/projectEventTypes.json` (AGENTS.md: rules living in TS and Go
 * need a parity fixture).
 */
export const PROJECT_EVENT_TYPES: readonly ProjectEventType[] = [
  'quote_created',
  'quote_sent',
  'quote_won',
  'quote_lost',
  'quote_expired',
  'quote_cancelled',
  'deposit_received',
  'survey_started',
  'survey_completed',
  'design_revision_created',
  'design_submitted',
  'design_approved',
  'design_changes_requested',
  'customer_approved',
  'customer_rejected',
  'engineering_approved',
  'engineering_rejected',
  'project_approved',
  'change_order_created',
  'change_order_submitted',
  'change_order_approved',
  'change_order_rejected',
  'change_order_cancelled',
  'engineering_started',
  'engineering_documented',
  'production_released',
  'production_release_revoked',
  'materials_required',
  'materials_reserved',
  'materials_shortage_detected',
  'materials_ready',
  'materials_release_overridden',
  'production_started',
  'production_completed',
  'quality_issue_reported',
  'rework_started',
  'shipment_loaded',
  'shipment_departed',
  'installation_started',
  'installation_completed',
  'punch_opened',
  'punch_closed',
  'client_signed_off',
  'project_closed',
  'warranty_opened',
];

export function isProjectEventType(type: string): type is ProjectEventType {
  return (PROJECT_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Append-only immutable project lifecycle event.
 */
export interface ProjectEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  readonly id: string;
  readonly projectId: string;
  readonly type: ProjectEventType;
  readonly at: string; // ISO 8601 string
  readonly byUserId?: string;
  readonly source?: ProjectEventSource;
  readonly note?: string;
  readonly payload?: TPayload;
}

/**
 * Structured payload for `deposit_received` events (OC-013).
 */
export interface DepositReceivedPayload extends Record<string, unknown> {
  readonly amount: number;
  readonly currency: string;
  readonly paymentMethod?: string;
  readonly reference?: string;
  readonly receiptUrl?: string;
}

/* ── Commercial Status & Project Stage ────────────────────────────────────── */

/**
 * Commercial status separating business outcome from physical manufacturing (OC-011).
 */
export type CommercialStatus =
  | 'draft'
  | 'sent'
  | 'won'
  | 'lost'
  | 'expired'
  | 'cancelled';

/**
 * Derived operational stage for project view and navigation (OC-012).
 */
export type ProjectStage =
  | 'sales'
  | 'survey'
  | 'design'
  | 'approval'
  | 'engineering'
  | 'procurement'
  | 'production'
  | 'shipping'
  | 'installation'
  | 'punch'
  | 'completed'
  | 'warranty';

/* ── UI Display Labels ─────────────────────────────────────────────────────── */

export const COMMERCIAL_STATUS_LABELS_ES: Readonly<Record<CommercialStatus, string>> = {
  draft: 'Borrador',
  sent: 'Cotizado',
  won: 'Ganado',
  lost: 'Perdido',
  expired: 'Vencido',
  cancelled: 'Cancelado',
};

export const PROJECT_STAGE_LABELS_ES: Readonly<Record<ProjectStage, string>> = {
  sales: 'Ventas',
  survey: 'Levantamiento',
  design: 'Diseño',
  approval: 'Aprobación',
  engineering: 'Ingeniería',
  procurement: 'Abastecimiento / Almacén',
  production: 'Producción',
  shipping: 'Embarque',
  installation: 'Instalación',
  punch: 'Detalles / Punch List',
  completed: 'Completado',
  warranty: 'Garantía',
};

export const PROJECT_EVENT_TYPE_LABELS_ES: Readonly<Record<ProjectEventType, string>> = {
  quote_created: 'Cotización creada',
  quote_sent: 'Cotización enviada al cliente',
  quote_won: 'Cotización aceptada / ganada',
  quote_lost: 'Cotización perdida',
  quote_expired: 'Cotización vencida',
  quote_cancelled: 'Cotización cancelada',
  deposit_received: 'Anticipo recibido',
  survey_started: 'Levantamiento iniciado',
  survey_completed: 'Levantamiento completado',
  design_revision_created: 'Revisión de diseño creada',
  design_submitted: 'Diseño presentado a revisión',
  design_approved: 'Diseño aprobado',
  design_changes_requested: 'Cambios de diseño solicitados',
  customer_approved: 'Aprobación formal del cliente',
  customer_rejected: 'Diseño rechazado por el cliente',
  engineering_approved: 'Ingeniería técnica aprobada',
  engineering_rejected: 'Ingeniería técnica rechazada',
  project_approved: 'Proyecto aprobado por supervisión',
  change_order_created: 'Orden de cambio creada',
  change_order_submitted: 'Orden de cambio enviada a revisión',
  change_order_approved: 'Orden de cambio aprobada',
  change_order_rejected: 'Orden de cambio rechazada',
  change_order_cancelled: 'Orden de cambio cancelada',
  engineering_started: 'Ingeniería iniciada',
  engineering_documented: 'Documentación técnica generada',
  production_released: 'Liberado a producción',
  production_release_revoked: 'Liberación a producción revocada',
  materials_required: 'Materiales requeridos por BOM',
  materials_reserved: 'Materiales reservados en stock',
  materials_shortage_detected: 'Faltante de materiales detectado',
  materials_ready: 'Materiales listos en almacén',
  materials_release_overridden: 'Liberación de materiales con excepción',
  production_started: 'Producción iniciada',
  production_completed: 'Producción completada',
  quality_issue_reported: 'Problema de calidad reportado',
  rework_started: 'Retrabajo iniciado',
  shipment_loaded: 'Cargado para despacho',
  shipment_departed: 'Despacho enviado a obra',
  installation_started: 'Instalación iniciada en obra',
  installation_completed: 'Instalación completada',
  punch_opened: 'Detalles pendientes abiertos (Punch List)',
  punch_closed: 'Detalles pendientes resueltos',
  client_signed_off: 'Conformidad final firmada por cliente',
  project_closed: 'Proyecto cerrado',
  warranty_opened: 'Reclamo de garantía abierto',
};

/* ── Event Management & Pure Helpers ──────────────────────────────────────── */

/**
 * Generate a unique event ID if none is supplied.
 */
export function generateEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a validated ProjectEvent object.
 */
export function createProjectEvent<TPayload extends Record<string, unknown> = Record<string, unknown>>(
  params: {
    readonly id?: string;
    readonly projectId: string;
    readonly type: ProjectEventType;
    readonly at?: string;
    readonly byUserId?: string;
    readonly source?: ProjectEventSource;
    readonly note?: string;
    readonly payload?: TPayload;
  },
): ProjectEvent<TPayload> {
  return {
    id: params.id ?? generateEventId(),
    projectId: params.projectId,
    type: params.type,
    at: params.at ?? new Date().toISOString(),
    byUserId: params.byUserId,
    source: params.source ?? 'web',
    note: params.note?.trim() || undefined,
    payload: params.payload,
  };
}

/**
 * Append an event to a project immutably, ensuring chronological order (oldest to newest).
 */
export function appendProjectEvent(project: Project, event: ProjectEvent): Project {
  const existing = project.events ?? [];
  const updatedEvents = [...existing, event].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );

  return {
    ...project,
    events: updatedEvents,
    updatedAt: event.at > project.updatedAt ? event.at : project.updatedAt,
  };
}

/**
 * Find the most recent event of a given type.
 */
export function findLatestEvent<TPayload extends Record<string, unknown> = Record<string, unknown>>(
  project: Project,
  type: ProjectEventType,
): ProjectEvent<TPayload> | undefined {
  const events = project.events;
  if (!events || events.length === 0) return undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i];
    if (evt && evt.type === type) {
      return evt as ProjectEvent<TPayload>;
    }
  }
  return undefined;
}

/**
 * Filter events by multiple types.
 */
export function filterEventsByType(
  project: Project,
  types: readonly ProjectEventType[],
): readonly ProjectEvent[] {
  const set = new Set(types);
  return (project.events ?? []).filter((e) => set.has(e.type));
}

/**
 * Check if a specific event type was recorded.
 */
export function isEventRecorded(project: Project, type: ProjectEventType): boolean {
  return (project.events ?? []).some((e) => e.type === type);
}

/* ── Commercial Status Derivation & Bridge ────────────────────────────────── */

/**
 * Derive commercial status from project events or legacy fields (OC-011).
 */
export function deriveCommercialStatus(project: Project): CommercialStatus {
  // If explicitly set on the project entity, use it
  if (project.commercialStatus) {
    return project.commercialStatus;
  }

  // Explicit cancellation
  if (project.cancelledAt) {
    return 'cancelled';
  }

  // Check event stream (newest first)
  const events = project.events;
  if (events && events.length > 0) {
    for (let i = events.length - 1; i >= 0; i--) {
      const evt = events[i];
      if (evt) {
        const t = evt.type;
        if (t === 'quote_lost') return 'lost';
        if (t === 'quote_expired') return 'expired';
        if (t === 'quote_won' || t === 'deposit_received') return 'won';
        if (t === 'quote_sent') return 'sent';
        if (t === 'quote_created') return 'draft';
      }
    }
  }

  // Fallback to legacy status
  return mapLegacyStatusToCommercial(project.status);
}

/**
 * Map legacy ProjectStatus to CommercialStatus.
 */
export function mapLegacyStatusToCommercial(status: ProjectStatus): CommercialStatus {
  switch (status) {
    case 'draft':
      return 'draft';
    case 'quoted':
      return 'sent';
    case 'accepted':
    case 'produced':
      return 'won';
  }
}

/**
 * Map CommercialStatus to legacy ProjectStatus for backward compatibility.
 */
export function mapCommercialToLegacyStatus(commercial: CommercialStatus): ProjectStatus {
  switch (commercial) {
    case 'draft':
    case 'lost':
    case 'expired':
    case 'cancelled':
      return 'draft';
    case 'sent':
      return 'quoted';
    case 'won':
      return 'accepted';
  }
}

/**
 * Update project commercial status and emit corresponding lifecycle event (OC-011).
 */
export function setProjectCommercialStatus(
  project: Project,
  status: CommercialStatus,
  byUserId?: string,
  note?: string,
  at?: string,
): { project: Project; event: ProjectEvent } {
  const timestamp = at ?? new Date().toISOString();
  let eventType: ProjectEventType = 'quote_created';
  if (status === 'sent') eventType = 'quote_sent';
  else if (status === 'won') eventType = 'quote_won';
  else if (status === 'lost') eventType = 'quote_lost';
  else if (status === 'expired') eventType = 'quote_expired';
  else if (status === 'cancelled') eventType = 'quote_cancelled';

  const event: ProjectEvent = {
    id: `evt_cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: project.id,
    type: eventType,
    at: timestamp,
    byUserId,
    source: 'web',
    note: note ?? `Estado comercial: ${COMMERCIAL_STATUS_LABELS_ES[status]}`,
    payload: { commercialStatus: status },
  };

  const updatedProject = appendProjectEvent(
    {
      ...project,
      commercialStatus: status,
    },
    event,
  );

  return { project: updatedProject, event };
}

/* ── Project Stage Derivation ─────────────────────────────────────────────── */

/**
 * Derive the current operational ProjectStage (OC-012).
 * Evaluates gates sequentially from final stages backwards.
 */
export function deriveProjectStage(project: Project): ProjectStage {
  const events = project.events ?? [];
  const eventTypes = new Set(events.map((e) => e.type));

  // 1. Warranty
  if (eventTypes.has('warranty_opened')) {
    return 'warranty';
  }

  // 2. Completed / Closed
  if (eventTypes.has('project_closed') || eventTypes.has('client_signed_off')) {
    return 'completed';
  }

  // 3. Punch List
  if (eventTypes.has('punch_opened') && !eventTypes.has('punch_closed')) {
    return 'punch';
  }

  // 4. Installation
  if (eventTypes.has('installation_started') && !eventTypes.has('installation_completed')) {
    return 'installation';
  }

  // 5. Shipping
  if (eventTypes.has('shipment_loaded') && !eventTypes.has('shipment_departed')) {
    return 'shipping';
  }

  // 6. Production
  if (
    eventTypes.has('production_started') ||
    Boolean(project.materialsRelease) ||
    eventTypes.has('materials_ready') ||
    project.status === 'produced'
  ) {
    if (!eventTypes.has('production_completed')) {
      return 'production';
    }
  }

  // 7. Procurement / Almacén
  if (
    eventTypes.has('production_released') ||
    Boolean(project.engineeringLog?.sentToProductionAt) ||
    eventTypes.has('materials_required') ||
    eventTypes.has('materials_reserved')
  ) {
    return 'procurement';
  }

  // 8. Engineering
  if (
    eventTypes.has('engineering_started') ||
    eventTypes.has('engineering_documented') ||
    Boolean(project.engineeringLog?.startedAt)
  ) {
    return 'engineering';
  }

  // 9. Approval
  if (
    eventTypes.has('design_submitted') ||
    eventTypes.has('design_changes_requested')
  ) {
    return 'approval';
  }

  // 10. Design
  if (eventTypes.has('design_revision_created') || Boolean(project.kitchenLayout)) {
    // If quote is already won or deposit received, advance to engineering if design approved
    if (eventTypes.has('design_approved')) {
      return 'engineering';
    }
    // Otherwise in design
    if (eventTypes.has('quote_won') || project.status === 'accepted') {
      return 'design';
    }
  }

  // 11. Survey
  if (
    eventTypes.has('survey_started') ||
    (Boolean(project.surveyCompletedAt) && !eventTypes.has('quote_won') && project.status === 'draft')
  ) {
    if (!eventTypes.has('survey_completed') && !project.surveyCompletedAt) {
      return 'survey';
    }
  }

  // 12. Sales (Default)
  return 'sales';
}

/* ── Deposit Helpers (OC-013) ─────────────────────────────────────────────── */

/**
 * Record a real deposit received event.
 */
export function recordDepositReceived(
  project: Project,
  payload: DepositReceivedPayload,
  byUserId?: string,
  at?: string,
  source?: ProjectEventSource,
  note?: string,
): Project {
  const event = createProjectEvent<DepositReceivedPayload>({
    projectId: project.id,
    type: 'deposit_received',
    at,
    byUserId,
    source,
    note,
    payload,
  });

  return appendProjectEvent(project, event);
}

/**
 * Get the latest deposit details from the project events.
 */
export function getLatestDeposit(
  project: Project,
): { readonly event: ProjectEvent<DepositReceivedPayload>; readonly payload: DepositReceivedPayload } | null {
  const event = findLatestEvent<DepositReceivedPayload>(project, 'deposit_received');
  if (!event || !event.payload) return null;
  return {
    event,
    payload: event.payload,
  };
}

/* ── Legacy Backfill Helper ───────────────────────────────────────────────── */

/**
 * Infer backfill events from legacy project fields without inventing timestamps (OC-010 / docs/project-lifecycle.md §13).
 */
export function inferBackfillEvents(project: Project): readonly ProjectEvent[] {
  const events: ProjectEvent[] = [];

  // Quote created
  if (project.createdAt) {
    events.push(
      createProjectEvent({
        projectId: project.id,
        type: 'quote_created',
        at: project.createdAt,
        byUserId: project.createdBy,
        source: 'backfill',
        note: 'Backfill desde fecha de creación del proyecto',
      }),
    );
  }

  // Quote sent
  if (project.status === 'quoted') {
    events.push(
      createProjectEvent({
        projectId: project.id,
        type: 'quote_sent',
        at: project.updatedAt,
        source: 'backfill',
        note: 'Backfill desde status cotizado',
      }),
    );
  }

  // Quote won
  if (project.status === 'accepted' || project.status === 'produced') {
    events.push(
      createProjectEvent({
        projectId: project.id,
        type: 'quote_won',
        at: project.updatedAt,
        source: 'backfill',
        note: 'Backfill desde status aceptado',
      }),
    );
  }

  // Survey completed
  if (project.surveyCompletedAt) {
    events.push(
      createProjectEvent({
        projectId: project.id,
        type: 'survey_completed',
        at: project.surveyCompletedAt,
        source: 'backfill',
        note: 'Backfill desde fecha de levantamiento',
      }),
    );
  }

  // Engineering started
  if (project.engineeringLog?.startedAt) {
    events.push(
      createProjectEvent({
        projectId: project.id,
        type: 'engineering_started',
        at: project.engineeringLog.startedAt,
        byUserId: project.engineeringLog.startedBy,
        source: 'backfill',
        note: 'Backfill desde inicio de ingeniería',
      }),
    );
  }

  // Engineering documented
  if (project.engineeringLog?.generatedAt) {
    events.push(
      createProjectEvent({
        projectId: project.id,
        type: 'engineering_documented',
        at: project.engineeringLog.generatedAt,
        byUserId: project.engineeringLog.generatedBy,
        source: 'backfill',
        note: 'Backfill desde generación de documentación',
      }),
    );
  }

  // Production released
  if (project.engineeringLog?.sentToProductionAt) {
    events.push(
      createProjectEvent({
        projectId: project.id,
        type: 'production_released',
        at: project.engineeringLog.sentToProductionAt,
        byUserId: project.engineeringLog.sentToProductionBy,
        source: 'backfill',
        note: 'Backfill desde envío a producción',
      }),
    );
  }

  // Materials ready
  if (project.materialsRelease?.releasedAt) {
    events.push(
      createProjectEvent({
        projectId: project.id,
        type: 'materials_ready',
        at: project.materialsRelease.releasedAt,
        byUserId: project.materialsRelease.releasedBy,
        source: 'backfill',
        note: 'Backfill desde liberación de materiales',
      }),
    );
  }

  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/* ── Lifecycle KPIs (project-lifecycle.md §12) ────────────────────────────── */

export interface LifecycleKpiResult {
  /** Ciclo de venta: quote_created → quote_won / quote_lost */
  readonly salesCycleHours: DataTruthMetric<number | null>;
  /** Tiempo a anticipo: quote_won → deposit_received */
  readonly timeToDepositHours: DataTruthMetric<number | null>;
  /** Espera Ingeniería: gate de entrada (deposit_received o quote_won) → engineering_started */
  readonly engineeringWaitHours: DataTruthMetric<number | null>;
  /** Ciclo Ingeniería: engineering_started → production_released */
  readonly engineeringCycleHours: DataTruthMetric<number | null>;
  /** Espera Material: production_released → materials_ready */
  readonly materialWaitHours: DataTruthMetric<number | null>;
  /** Ciclo Producción: production_started → production_completed */
  readonly productionCycleHours: DataTruthMetric<number | null>;
  /** Espera embarque: production_completed → shipment_departed */
  readonly shippingWaitHours: DataTruthMetric<number | null>;
  /** Instalación: installation_started → installation_completed */
  readonly installationHours: DataTruthMetric<number | null>;
  /** Cierre: installation_completed → project_closed */
  readonly closeoutHours: DataTruthMetric<number | null>;
  /** Lead time completo: quote_created → project_closed */
  readonly leadTimeHours: DataTruthMetric<number | null>;
}

function hoursBetween(earlierIso: string, laterIso: string): number {
  const ms = new Date(laterIso).getTime() - new Date(earlierIso).getTime();
  return Math.max(0, Math.round((ms / (1000 * 60 * 60)) * 10) / 10);
}

/**
 * A lifecycle duration is only `actual` when both endpoint events were
 * recorded live. Durations resting on backfill-inferred events (legacy
 * timestamps proxied by createdAt/updatedAt) must surface as `proxy`
 * (OC-006 data truth contract — never present a proxy as fact).
 */
function durationMetric(
  earlier: ProjectEvent | undefined,
  later: ProjectEvent | undefined,
): DataTruthMetric<number | null> {
  if (!earlier || !later) {
    return { value: null, origin: 'missing' };
  }
  const origin =
    earlier.source === 'backfill' || later.source === 'backfill' ? 'proxy' : 'actual';
  return { value: hoursBetween(earlier.at, later.at), origin };
}

/**
 * Calculate honest lifecycle KPIs based exclusively on logged events (OC-010..OC-013 / §12).
 */
export function calcLifecycleKpis(events: readonly ProjectEvent[] | undefined): LifecycleKpiResult {
  const evts = events ?? [];

  // Helper to find earliest or latest event
  const findFirst = (type: ProjectEventType) => evts.find((e) => e.type === type);
  const findLast = (type: ProjectEventType) => {
    for (let i = evts.length - 1; i >= 0; i--) {
      const evt = evts[i];
      if (evt && evt.type === type) return evt;
    }
    return undefined;
  };

  const quoteCreated = findFirst('quote_created');
  const quoteWon = findFirst('quote_won');
  const quoteLost = findFirst('quote_lost');
  const depositReceived = findFirst('deposit_received');
  const engStarted = findFirst('engineering_started');
  const prodReleased = findFirst('production_released');
  const materialsReady = findFirst('materials_ready');
  const prodStarted = findFirst('production_started');
  const prodCompleted = findFirst('production_completed');
  const shipmentDeparted = findFirst('shipment_departed');
  const installStarted = findFirst('installation_started');
  const installCompleted = findFirst('installation_completed');
  const projectClosed = findLast('project_closed');

  // Sales cycle: quote_created -> quote_won | quote_lost
  const outcomeEvent = quoteWon ?? quoteLost;
  const salesCycleHours = durationMetric(quoteCreated, outcomeEvent);

  // Time to deposit: quote_won -> deposit_received
  const timeToDepositHours = durationMetric(quoteWon, depositReceived);

  // Engineering wait: (deposit_received || quote_won) -> engineering_started
  const engGate = depositReceived ?? quoteWon;
  const engineeringWaitHours = durationMetric(engGate, engStarted);

  // Engineering cycle: engineering_started -> production_released
  const engineeringCycleHours = durationMetric(engStarted, prodReleased);

  // Material wait: production_released -> materials_ready
  const materialWaitHours = durationMetric(prodReleased, materialsReady);

  // Production cycle: production_started -> production_completed
  const productionCycleHours = durationMetric(prodStarted, prodCompleted);

  // Shipping wait: production_completed -> shipment_departed
  const shippingWaitHours = durationMetric(prodCompleted, shipmentDeparted);

  // Installation: installation_started -> installation_completed
  const installationHours = durationMetric(installStarted, installCompleted);

  // Closeout: installation_completed -> project_closed
  const closeoutHours = durationMetric(installCompleted, projectClosed);

  // Full lead time: quote_created -> project_closed
  const leadTimeHours = durationMetric(quoteCreated, projectClosed);

  return {
    salesCycleHours,
    timeToDepositHours,
    engineeringWaitHours,
    engineeringCycleHours,
    materialWaitHours,
    productionCycleHours,
    shippingWaitHours,
    installationHours,
    closeoutHours,
    leadTimeHours,
  };
}

/* ── Design Revisions, Approvals & Production Release (OC-020..OC-022) ────── */

export interface DesignRevision {
  readonly id: string;
  readonly projectId: string;
  readonly revision: number;
  readonly name?: string;
  readonly description?: string;
  readonly bomFingerprint: string;
  readonly layoutSnapshot?: Record<string, unknown>;
  readonly createdBy: string;
  readonly createdAt: string;
}

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'approved_with_notes'
  | 'changes_requested'
  | 'rejected';

export type ApprovalType = 'customer' | 'technical' | 'supervisor';

export interface Approval {
  readonly id: string;
  readonly projectId: string;
  readonly designRevisionId?: string;
  readonly type: ApprovalType;
  readonly status: ApprovalStatus;
  readonly notes?: string;
  readonly decidedBy?: string;
  readonly decidedAt?: string;
  readonly createdAt: string;
}

export const APPROVAL_STATUS_LABELS_ES: Readonly<Record<ApprovalStatus, string>> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  approved_with_notes: 'Aprobado con observaciones',
  changes_requested: 'Cambios solicitados',
  rejected: 'Rechazado',
};

export const APPROVAL_TYPE_LABELS_ES: Readonly<Record<ApprovalType, string>> = {
  customer: 'Cliente / Comercial',
  technical: 'Técnica / Ingeniería',
  supervisor: 'Supervisor / Taller',
};

export type ProductionReleaseCheckCode =
  | 'commercial_won'
  | 'deposit_received'
  | 'survey_verified'
  | 'customer_approved'
  | 'technical_approved'
  | 'bom_valid';

export interface ProductionReleaseCheck {
  readonly code: ProductionReleaseCheckCode;
  readonly label: string;
  readonly passed: boolean;
  readonly required: boolean;
  readonly details?: string;
}

export interface ProductionRelease {
  readonly id: string;
  readonly projectId: string;
  readonly projectVersion: number;
  readonly designRevisionId: string;
  readonly bomFingerprint: string;
  readonly releasedBy: string;
  readonly releasedAt: string;
  readonly checks: readonly ProductionReleaseCheck[];
  readonly note?: string;
}

export const RELEASE_CHECK_LABELS_ES: Readonly<Record<ProductionReleaseCheckCode, string>> = {
  commercial_won: 'Estado comercial ganado / Cotización aceptada',
  deposit_received: 'Anticipo requerido registrado',
  survey_verified: 'Levantamiento / Medidas en sitio verificado',
  customer_approved: 'Aprobación formal del cliente',
  technical_approved: 'Aprobación técnica de ingeniería',
  bom_valid: 'Lista de materiales (BOM) completa y válida',
};

/**
 * Calculates deterministic BOM and design fingerprint.
 */
export function calcBomFingerprint(project: Project): string {
  return computeProductionDesignFingerprint(project);
}

/**
 * Create a formal design revision (OC-020).
 */
export function createDesignRevision(
  project: Project,
  createdBy: string,
  options?: { name?: string; description?: string; at?: string },
): { project: Project; revision: DesignRevision; event: ProjectEvent } {
  const at = options?.at ?? new Date().toISOString();
  const revisionNumber = (project.designRevisions?.length ?? 0) + 1;
  const id = `drev_${Date.now().toString(36)}_${revisionNumber}`;
  const bomFingerprint = calcBomFingerprint(project);

  const revision: DesignRevision = {
    id,
    projectId: project.id,
    revision: revisionNumber,
    name: options?.name ?? `Revisión ${revisionNumber}`,
    description: options?.description,
    bomFingerprint,
    layoutSnapshot: project.kitchenLayout
      ? (JSON.parse(JSON.stringify(project.kitchenLayout)) as Record<string, unknown>)
      : undefined,
    createdBy,
    createdAt: at,
  };

  const event: ProjectEvent = {
    id: `evt_drev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: project.id,
    type: 'design_revision_created',
    at,
    byUserId: createdBy,
    source: 'web',
    note: options?.name ? `Revisión ${revisionNumber}: ${options.name}` : `Revisión de diseño ${revisionNumber}`,
    payload: {
      designRevisionId: revision.id,
      revision: revision.revision,
      bomFingerprint: revision.bomFingerprint,
    },
  };

  const updatedProject = appendProjectEvent(
    {
      ...project,
      designRevisions: [...(project.designRevisions ?? []), revision],
    },
    event,
  );

  return { project: updatedProject, revision, event };
}

/**
 * Returns the most recent design revision of the project.
 */
export function getLatestDesignRevision(project: Project): DesignRevision | undefined {
  const revs = project.designRevisions ?? [];
  if (revs.length === 0) return undefined;
  return revs[revs.length - 1];
}

/**
 * Return all design revisions for a project.
 */
export function getProjectDesignRevisions(project: Project): readonly DesignRevision[] {
  return project.designRevisions ?? [];
}

/**
 * Record a multi-role approval (OC-021: customer, technical, supervisor).
 */
export function createApproval(
  project: Project,
  params: {
    type: ApprovalType;
    status: ApprovalStatus;
    decidedBy: string;
    notes?: string;
    designRevisionId?: string;
    at?: string;
  },
): { project: Project; approval: Approval; event: ProjectEvent } {
  const at = params.at ?? new Date().toISOString();
  const id = `appr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const designRevisionId = params.designRevisionId ?? getLatestDesignRevision(project)?.id;

  const approval: Approval = {
    id,
    projectId: project.id,
    designRevisionId,
    type: params.type,
    status: params.status,
    notes: params.notes,
    decidedBy: params.decidedBy,
    decidedAt: at,
    createdAt: at,
  };

  // Determine corresponding lifecycle event type
  let eventType: ProjectEventType = 'design_submitted';
  if (params.type === 'customer') {
    if (params.status === 'approved' || params.status === 'approved_with_notes') {
      eventType = 'customer_approved';
    } else if (params.status === 'rejected' || params.status === 'changes_requested') {
      eventType = 'customer_rejected';
    }
  } else if (params.type === 'technical') {
    if (params.status === 'approved' || params.status === 'approved_with_notes') {
      eventType = 'engineering_approved';
    } else if (params.status === 'rejected' || params.status === 'changes_requested') {
      eventType = 'engineering_rejected';
    }
  } else if (params.type === 'supervisor') {
    if (params.status === 'approved' || params.status === 'approved_with_notes') {
      eventType = 'project_approved';
    }
  }

  const event: ProjectEvent = {
    id: `evt_appr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: project.id,
    type: eventType,
    at,
    byUserId: params.decidedBy,
    source: 'web',
    note: params.notes ?? `${APPROVAL_TYPE_LABELS_ES[params.type]}: ${APPROVAL_STATUS_LABELS_ES[params.status]}`,
    payload: {
      approvalId: approval.id,
      type: approval.type,
      status: approval.status,
      designRevisionId: approval.designRevisionId,
    },
  };

  const updatedProject = appendProjectEvent(
    {
      ...project,
      approvals: [...(project.approvals ?? []), approval],
    },
    event,
  );

  return { project: updatedProject, approval, event };
}

/**
 * Filter approvals by type or return all.
 */
export function getProjectApprovals(project: Project, type?: ApprovalType): readonly Approval[] {
  const list = project.approvals ?? [];
  if (!type) return list;
  return list.filter((a) => a.type === type);
}

/**
 * Checks if customer has approved the project design.
 */
export function isCustomerApproved(project: Project): boolean {
  const customerApprovals = getProjectApprovals(project, 'customer');
  if (customerApprovals.length > 0) {
    const latest = customerApprovals[customerApprovals.length - 1];
    return latest?.status === 'approved' || latest?.status === 'approved_with_notes';
  }
  return (project.events ?? []).some((e) => e.type === 'customer_approved' || e.type === 'design_approved');
}

/**
 * Checks if engineering has approved the technical design.
 */
export function isTechnicalApproved(project: Project): boolean {
  const techApprovals = getProjectApprovals(project, 'technical');
  if (techApprovals.length > 0) {
    const latest = techApprovals[techApprovals.length - 1];
    return latest?.status === 'approved' || latest?.status === 'approved_with_notes';
  }
  return (project.events ?? []).some((e) => e.type === 'engineering_approved');
}

/**
 * Evaluate the 6 Production Release gates (OC-022 / §7.2).
 */
export function evaluateProductionReleaseGates(
  project: Project,
  options?: { requireDeposit?: boolean; requireSurvey?: boolean },
): ProductionReleaseCheck[] {
  const requireDeposit = options?.requireDeposit ?? true;
  const requireSurvey = options?.requireSurvey ?? false;

  // 1. Commercial won
  const commercialWon =
    project.commercialStatus === 'won' ||
    project.status === 'accepted' ||
    project.status === 'produced' ||
    (project.events ?? []).some((e) => e.type === 'quote_won');

  // 2. Deposit received
  const depositReceived =
    getLatestDeposit(project) != null ||
    (project.events ?? []).some((e) => e.type === 'deposit_received');

  // 3. Survey verified
  const surveyVerified =
    Boolean(project.surveyCompletedAt) ||
    (project.events ?? []).some((e) => e.type === 'survey_completed');

  // 4. Customer approved
  const customerApproved = isCustomerApproved(project);

  // 5. Technical approved
  const technicalApproved = isTechnicalApproved(project);

  // 6. BOM valid
  const bomValid =
    Array.isArray(project.items) &&
    project.items.length > 0 &&
    project.items.every((it) => it.quantity > 0 && Boolean(it.moduleId));

  return [
    {
      code: 'commercial_won',
      label: RELEASE_CHECK_LABELS_ES.commercial_won,
      passed: commercialWon,
      required: true,
      details: commercialWon ? 'Cotización ganada/aceptada' : 'El proyecto aún no está marcado como ganado',
    },
    {
      code: 'deposit_received',
      label: RELEASE_CHECK_LABELS_ES.deposit_received,
      passed: depositReceived,
      required: requireDeposit,
      details: depositReceived ? 'Anticipo registrado' : 'No se ha registrado ningún anticipo en el proyecto',
    },
    {
      code: 'survey_verified',
      label: RELEASE_CHECK_LABELS_ES.survey_verified,
      passed: surveyVerified,
      required: requireSurvey,
      details: surveyVerified ? 'Medidas en sitio verificadas' : 'Levantamiento pendiente de confirmación',
    },
    {
      code: 'customer_approved',
      label: RELEASE_CHECK_LABELS_ES.customer_approved,
      passed: customerApproved,
      required: true,
      details: customerApproved ? 'Aprobación de cliente registrada' : 'Falta aprobación formal del cliente',
    },
    {
      code: 'technical_approved',
      label: RELEASE_CHECK_LABELS_ES.technical_approved,
      passed: technicalApproved,
      required: true,
      details: technicalApproved ? 'Ingeniería validada' : 'Falta visto bueno técnico de ingeniería',
    },
    {
      code: 'bom_valid',
      label: RELEASE_CHECK_LABELS_ES.bom_valid,
      passed: bomValid,
      required: true,
      details: bomValid ? `${project.items.length} módulos configurados` : 'El proyecto no tiene partidas válidas en BOM',
    },
  ];
}

/**
 * Check if the project is ready for formal production release.
 */
export function canReleaseToProduction(
  project: Project,
  options?: { requireDeposit?: boolean; requireSurvey?: boolean },
): { allowed: boolean; checks: ProductionReleaseCheck[]; failingChecks: ProductionReleaseCheck[] } {
  const checks = evaluateProductionReleaseGates(project, options);
  const failingChecks = checks.filter((c) => c.required && !c.passed);
  return {
    allowed: failingChecks.length === 0,
    checks,
    failingChecks,
  };
}

export type ProductionReleaseOptions = {
  readonly note?: string;
  readonly requireDeposit?: boolean;
  readonly requireSurvey?: boolean;
  readonly at?: string;
};

/**
 * Create an explicit, auditable ProductionRelease record (OC-022).
 */
export function createProductionRelease(
  project: Project,
  releasedByOrParams:
    | string
    | {
        releasedBy: string;
        note?: string;
        at?: string;
        requireDeposit?: boolean;
        requireSurvey?: boolean;
      },
  note?: string,
  options?: ProductionReleaseOptions,
): { project: Project; release: ProductionRelease; event: ProjectEvent } {
  const params =
    typeof releasedByOrParams === 'string'
      ? {
          releasedBy: releasedByOrParams,
          note: note ?? options?.note,
          at: options?.at,
          requireDeposit: options?.requireDeposit,
          requireSurvey: options?.requireSurvey,
        }
      : releasedByOrParams;

  const { allowed, checks, failingChecks } = canReleaseToProduction(project, {
    requireDeposit: params.requireDeposit,
    requireSurvey: params.requireSurvey,
  });

  if (!allowed) {
    const reasons = failingChecks.map((c) => c.label).join(', ');
    throw new Error(`No se puede liberar a producción: faltan gates obligatorios (${reasons})`);
  }

  const at = params.at ?? new Date().toISOString();
  let latestRevision = getLatestDesignRevision(project);
  let updatedProject = project;

  // Auto-create a baseline design revision if none exists yet
  if (!latestRevision) {
    const revRes = createDesignRevision(project, params.releasedBy, {
      name: 'Revisión inicial para liberación',
      at,
    });
    updatedProject = revRes.project;
    latestRevision = revRes.revision;
  }

  const bomFingerprint = calcBomFingerprint(updatedProject);
  const releaseId = `rel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  const release: ProductionRelease = {
    id: releaseId,
    projectId: project.id,
    projectVersion: updatedProject.version ?? 1,
    designRevisionId: latestRevision.id,
    bomFingerprint,
    releasedBy: params.releasedBy,
    releasedAt: at,
    checks,
    note: params.note,
  };

  const event: ProjectEvent = {
    id: `evt_rel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: project.id,
    type: 'production_released',
    at,
    byUserId: params.releasedBy,
    source: 'web',
    note: params.note ?? 'Liberación formal a producción',
    payload: {
      releaseId: release.id,
      designRevisionId: release.designRevisionId,
      bomFingerprint: release.bomFingerprint,
      checks: release.checks.map((c) => ({ code: c.code, passed: c.passed })),
    },
  };

  const finalProject = appendProjectEvent(
    {
      ...updatedProject,
      productionRelease: release,
    },
    event,
  );

  return { project: finalProject, release, event };
}

/**
 * Returns the active production release if present.
 */
export function getLatestProductionRelease(project: Project): ProductionRelease | undefined {
  return project.productionRelease;
}

/**
 * Revokes an existing production release (OC-022).
 */
export function revokeProductionRelease(
  project: Project,
  params: { revokedBy: string; reason: string; at?: string },
): { project: Project; event: ProjectEvent } {
  const at = params.at ?? new Date().toISOString();
  const event: ProjectEvent = {
    id: `evt_rel_rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: project.id,
    type: 'production_release_revoked',
    at,
    byUserId: params.revokedBy,
    source: 'web',
    note: `Liberación revocada: ${params.reason}`,
    payload: {
      reason: params.reason,
      previousReleaseId: project.productionRelease?.id,
    },
  };

  const updatedProject = appendProjectEvent(
    {
      ...project,
      productionRelease: undefined,
    },
    event,
  );

  return { project: updatedProject, event };
}

/* ── OC-023: Staleness Detection ───────────────────────────────────────────── */

export type StalenessReason =
  | 'bom_fingerprint_mismatch'
  | 'items_count_changed'
  | 'choices_changed'
  | 'layout_modified'
  | 'release_revoked'
  | 'measure_defaults_changed';

export const STALENESS_REASON_LABELS_ES: Readonly<Record<StalenessReason, string>> = {
  bom_fingerprint_mismatch: 'El desglose de materiales o módulos no coincide con la versión liberada',
  items_count_changed: 'Se agregaron o eliminaron partidas en la lista de muebles',
  choices_changed: 'Cambiaron selecciones de materiales, cantos o herrajes',
  layout_modified: 'La distribución 3D / paredes cambió respecto a la liberación',
  release_revoked: 'La liberación previa a producción fue revocada',
  measure_defaults_changed: 'Cambiaron las medidas generales por defecto del proyecto',
};

export type ProductionStalenessReport = {
  /** True if the project has an active (non-revoked) ProductionRelease record. */
  isReleased: boolean;
  /** True if the current project state diverges from the released production state. */
  isStale: boolean;
  /** Reasons why the project is stale, empty if up to date or unreleased. */
  reasons: readonly StalenessReason[];
  /** Released BOM fingerprint if available. */
  releaseFingerprint?: string;
  /** Current BOM fingerprint computed from current project items & layout. */
  currentFingerprint: string;
  /** Release timestamp if released. */
  releasedAt?: string;
  /** User who performed the release. */
  releasedBy?: string;
};

/**
 * Compare current project state against released production state (OC-023).
 */
export function getProjectStalenessReport(project: Project): ProductionStalenessReport {
  const currentFingerprint = calcBomFingerprint(project);
  const release = project.productionRelease;

  // Check if there's a release revocation event recorded
  const hasRevocation = (project.events ?? []).some((e) => e.type === 'production_release_revoked');

  if (!release) {
    if (hasRevocation) {
      return {
        isReleased: false,
        isStale: true,
        reasons: ['release_revoked'],
        currentFingerprint,
      };
    }
    return {
      isReleased: false,
      isStale: false,
      reasons: [],
      currentFingerprint,
    };
  }

  const reasons: StalenessReason[] = [];

  if (release.bomFingerprint !== currentFingerprint) {
    reasons.push('bom_fingerprint_mismatch');
  }

  // Check layout snapshot if available on the linked design revision
  const linkedRevision = (project.designRevisions ?? []).find((r) => r.id === release.designRevisionId);
  if (linkedRevision?.layoutSnapshot && project.kitchenLayout) {
    const currentLayoutStr = JSON.stringify(project.kitchenLayout);
    const revLayoutStr = JSON.stringify(linkedRevision.layoutSnapshot);
    if (currentLayoutStr !== revLayoutStr && !reasons.includes('bom_fingerprint_mismatch')) {
      reasons.push('layout_modified');
    }
  }

  return {
    isReleased: true,
    isStale: reasons.length > 0,
    reasons,
    releaseFingerprint: release.bomFingerprint,
    currentFingerprint,
    releasedAt: release.releasedAt,
    releasedBy: release.releasedBy,
  };
}

/**
 * Returns true if the project was released but is now stale (OC-023).
 */
export function isProjectStaleForProduction(project: Project): boolean {
  return getProjectStalenessReport(project).isStale;
}

/* ── OC-024: Change Orders ─────────────────────────────────────────────────── */

export type ChangeOrderStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export const CHANGE_ORDER_STATUS_LABELS_ES: Readonly<Record<ChangeOrderStatus, string>> = {
  draft: 'Borrador',
  submitted: 'Enviada para aprobación',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
};

export type ChangeOrderImpact = {
  readonly costDelta?: number;
  readonly priceDelta?: number;
  readonly leadTimeDaysDelta?: number;
  readonly scopeDescription?: string;
};

export type ChangeOrder = {
  readonly id: string;
  readonly projectId: string;
  readonly number: number;
  readonly status: ChangeOrderStatus;
  readonly reason: string;
  readonly description?: string;
  readonly impact?: ChangeOrderImpact;
  readonly previousBomFingerprint: string;
  readonly newBomFingerprint?: string;
  readonly previousDesignRevisionId?: string;
  readonly newDesignRevisionId?: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly decidedBy?: string;
  readonly decidedAt?: string;
  readonly decisionNotes?: string;
  readonly createdAt: string;
};

/**
 * Filter change orders by status or return all.
 */
export function getProjectChangeOrders(
  project: Project,
  status?: ChangeOrderStatus,
): readonly ChangeOrder[] {
  const list = project.changeOrders ?? [];
  if (!status) return list;
  return list.filter((co) => co.status === status);
}

/**
 * Returns the currently active (draft or submitted) change order if any.
 */
export function getActiveChangeOrder(project: Project): ChangeOrder | undefined {
  const list = project.changeOrders ?? [];
  return list.find((co) => co.status === 'draft' || co.status === 'submitted');
}

/**
 * Create a new ChangeOrder in draft status (OC-024).
 */
export function createChangeOrder(
  project: Project,
  params: {
    requestedBy: string;
    reason: string;
    description?: string;
    impact?: ChangeOrderImpact;
    at?: string;
  },
): { project: Project; changeOrder: ChangeOrder; event: ProjectEvent } {
  const at = params.at ?? new Date().toISOString();
  const existingOrders = project.changeOrders ?? [];
  const nextNumber = existingOrders.length + 1;
  const id = `co_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const currentFingerprint = calcBomFingerprint(project);
  const latestRevision = getLatestDesignRevision(project);

  const changeOrder: ChangeOrder = {
    id,
    projectId: project.id,
    number: nextNumber,
    status: 'draft',
    reason: params.reason,
    description: params.description,
    impact: params.impact,
    previousBomFingerprint: project.productionRelease?.bomFingerprint ?? currentFingerprint,
    previousDesignRevisionId: latestRevision?.id,
    requestedBy: params.requestedBy,
    requestedAt: at,
    createdAt: at,
  };

  const event: ProjectEvent = {
    id: `evt_co_created_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: project.id,
    type: 'change_order_created',
    at,
    byUserId: params.requestedBy,
    source: 'web',
    note: `Orden de cambio #${nextNumber}: ${params.reason}`,
    payload: {
      changeOrderId: changeOrder.id,
      number: changeOrder.number,
      reason: changeOrder.reason,
      impact: changeOrder.impact,
    },
  };

  const updatedProject = appendProjectEvent(
    {
      ...project,
      changeOrders: [...existingOrders, changeOrder],
    },
    event,
  );

  return { project: updatedProject, changeOrder, event };
}

/**
 * Submit a draft ChangeOrder for formal approval (OC-024).
 */
export function submitChangeOrder(
  project: Project,
  changeOrderId: string,
  params: { submittedBy: string; at?: string },
): { project: Project; changeOrder: ChangeOrder; event: ProjectEvent } {
  const existingOrders = project.changeOrders ?? [];
  const target = existingOrders.find((co) => co.id === changeOrderId);
  if (!target) {
    throw new Error(`Orden de cambio con id "${changeOrderId}" no encontrada`);
  }
  if (target.status !== 'draft') {
    throw new Error(`Solo se pueden enviar órdenes de cambio en estado borrador (actual: ${target.status})`);
  }

  const at = params.at ?? new Date().toISOString();
  const currentFingerprint = calcBomFingerprint(project);

  const updatedOrder: ChangeOrder = {
    ...target,
    status: 'submitted',
    newBomFingerprint: currentFingerprint,
  };

  const event: ProjectEvent = {
    id: `evt_co_sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: project.id,
    type: 'change_order_submitted',
    at,
    byUserId: params.submittedBy,
    source: 'web',
    note: `Orden de cambio #${target.number} enviada a revisión`,
    payload: {
      changeOrderId: target.id,
      number: target.number,
    },
  };

  const updatedProject = appendProjectEvent(
    {
      ...project,
      changeOrders: existingOrders.map((co) => (co.id === changeOrderId ? updatedOrder : co)),
    },
    event,
  );

  return { project: updatedProject, changeOrder: updatedOrder, event };
}

/**
 * Approve a ChangeOrder, optionally generating a new DesignRevision and bumping project version (OC-024).
 */
export function approveChangeOrder(
  project: Project,
  changeOrderId: string,
  params: {
    approvedBy: string;
    notes?: string;
    at?: string;
    autoCreateRevision?: boolean;
  },
): { project: Project; changeOrder: ChangeOrder; revision?: DesignRevision; event: ProjectEvent } {
  const existingOrders = project.changeOrders ?? [];
  const target = existingOrders.find((co) => co.id === changeOrderId);
  if (!target) {
    throw new Error(`Orden de cambio con id "${changeOrderId}" no encontrada`);
  }
  if (target.status !== 'draft' && target.status !== 'submitted') {
    throw new Error(`No se puede aprobar una orden de cambio en estado ${target.status}`);
  }

  const at = params.at ?? new Date().toISOString();
  const currentFingerprint = calcBomFingerprint(project);

  let updatedProject = project;
  let newRevision: DesignRevision | undefined;

  // Auto-create next design revision if requested or by default
  const shouldCreateRevision = params.autoCreateRevision ?? true;
  if (shouldCreateRevision) {
    const revResult = createDesignRevision(project, params.approvedBy, {
      name: `Revisión por OC #${target.number}`,
      description: target.reason,
      at,
    });
    updatedProject = revResult.project;
    newRevision = revResult.revision;
  }

  const updatedOrder: ChangeOrder = {
    ...target,
    status: 'approved',
    newBomFingerprint: currentFingerprint,
    newDesignRevisionId: newRevision?.id,
    decidedBy: params.approvedBy,
    decidedAt: at,
    decisionNotes: params.notes,
  };

  const event: ProjectEvent = {
    id: `evt_co_appr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: project.id,
    type: 'change_order_approved',
    at,
    byUserId: params.approvedBy,
    source: 'web',
    note: params.notes
      ? `Orden de cambio #${target.number} aprobada: ${params.notes}`
      : `Orden de cambio #${target.number} aprobada`,
    payload: {
      changeOrderId: target.id,
      number: target.number,
      newDesignRevisionId: newRevision?.id,
      newBomFingerprint: currentFingerprint,
    },
  };

  const finalOrders = (updatedProject.changeOrders ?? []).map((co) =>
    co.id === changeOrderId ? updatedOrder : co,
  );

  const finalProject = appendProjectEvent(
    {
      ...updatedProject,
      // Bump project version upon approved change order
      version: (updatedProject.version ?? 1) + 1,
      changeOrders: finalOrders,
    },
    event,
  );

  return { project: finalProject, changeOrder: updatedOrder, revision: newRevision, event };
}

/**
 * Reject a ChangeOrder with explanation (OC-024).
 */
export function rejectChangeOrder(
  project: Project,
  changeOrderId: string,
  params: { rejectedBy: string; reason: string; at?: string },
): { project: Project; changeOrder: ChangeOrder; event: ProjectEvent } {
  const existingOrders = project.changeOrders ?? [];
  const target = existingOrders.find((co) => co.id === changeOrderId);
  if (!target) {
    throw new Error(`Orden de cambio con id "${changeOrderId}" no encontrada`);
  }
  if (target.status !== 'draft' && target.status !== 'submitted') {
    throw new Error(`No se puede rechazar una orden de cambio en estado ${target.status}`);
  }

  const at = params.at ?? new Date().toISOString();

  const updatedOrder: ChangeOrder = {
    ...target,
    status: 'rejected',
    decidedBy: params.rejectedBy,
    decidedAt: at,
    decisionNotes: params.reason,
  };

  const event: ProjectEvent = {
    id: `evt_co_rej_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: project.id,
    type: 'change_order_rejected',
    at,
    byUserId: params.rejectedBy,
    source: 'web',
    note: `Orden de cambio #${target.number} rechazada: ${params.reason}`,
    payload: {
      changeOrderId: target.id,
      number: target.number,
      reason: params.reason,
    },
  };

  const updatedProject = appendProjectEvent(
    {
      ...project,
      changeOrders: existingOrders.map((co) => (co.id === changeOrderId ? updatedOrder : co)),
    },
    event,
  );

  return { project: updatedProject, changeOrder: updatedOrder, event };
}

/**
 * Cancel a draft/submitted ChangeOrder (OC-024).
 */
export function cancelChangeOrder(
  project: Project,
  changeOrderId: string,
  params: { cancelledBy: string; reason?: string; at?: string },
): { project: Project; changeOrder: ChangeOrder; event: ProjectEvent } {
  const existingOrders = project.changeOrders ?? [];
  const target = existingOrders.find((co) => co.id === changeOrderId);
  if (!target) {
    throw new Error(`Orden de cambio con id "${changeOrderId}" no encontrada`);
  }
  if (target.status !== 'draft' && target.status !== 'submitted') {
    throw new Error(`No se puede cancelar una orden de cambio en estado ${target.status}`);
  }

  const at = params.at ?? new Date().toISOString();

  const updatedOrder: ChangeOrder = {
    ...target,
    status: 'cancelled',
    decidedBy: params.cancelledBy,
    decidedAt: at,
    decisionNotes: params.reason,
  };

  const event: ProjectEvent = {
    id: `evt_co_canc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: project.id,
    type: 'change_order_cancelled',
    at,
    byUserId: params.cancelledBy,
    source: 'web',
    note: params.reason
      ? `Orden de cambio #${target.number} cancelada: ${params.reason}`
      : `Orden de cambio #${target.number} cancelada`,
    payload: {
      changeOrderId: target.id,
      number: target.number,
      reason: params.reason,
    },
  };

  const updatedProject = appendProjectEvent(
    {
      ...project,
      changeOrders: existingOrders.map((co) => (co.id === changeOrderId ? updatedOrder : co)),
    },
    event,
  );

  return { project: updatedProject, changeOrder: updatedOrder, event };
}


