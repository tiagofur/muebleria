/**
 * Quality & rework domain (OC-060..OC-062) — traceable quality issues linked
 * to pieces/units, rework actions with job-costing impact, and a per-unit QC
 * gate that blocks packaging until the checklist passes (audited supervisor
 * override allowed).
 *
 * Reference: docs/operational-core-v1.md §9, docs/prd-v2.md §11.1,
 * docs/production-flow-v2.md §10/§14.
 */

import { ValidationError } from './errors';
import type { Project } from './types';
import type { PartOperationType, PartInstance, ModuleUnitExecution } from './partExecution';
import { triggerPartRework } from './partExecution';
import {
  appendProjectEvent,
  createProjectEvent,
  type ProjectEvent,
  type ProjectEventSource,
} from './projectLifecycle';

/* ── Status vocabularies (parity: contracts/qualityStatuses.json) ─────────── */

export const QUALITY_ISSUE_CATEGORIES = [
  'dimensional',
  'acabado_canto',
  'mecanizado',
  'dano',
  'faltante',
  'armado',
  'otro',
] as const;
export type QualityIssueCategory = (typeof QUALITY_ISSUE_CATEGORIES)[number];

export const QUALITY_ISSUE_CATEGORY_LABELS_ES: Readonly<Record<QualityIssueCategory, string>> = {
  dimensional: 'Dimensional',
  acabado_canto: 'Acabado/Canto',
  mecanizado: 'Mecanizado',
  dano: 'Daño',
  faltante: 'Faltante',
  armado: 'Armado',
  otro: 'Otro',
};

export const QUALITY_ISSUE_STATUSES = ['open', 'resolved', 'verified'] as const;
export type QualityIssueStatus = (typeof QUALITY_ISSUE_STATUSES)[number];

/**
 * Allowed quality issue transitions: resolution closes the issue,
 * verification confirms it, and a failed verification reopens it.
 */
export const QUALITY_ISSUE_STATUS_TRANSITIONS: Readonly<
  Record<QualityIssueStatus, readonly QualityIssueStatus[]>
> = {
  open: ['resolved'],
  resolved: ['verified', 'open'],
  verified: ['open'],
};

export const QUALITY_ISSUE_STATUS_LABELS_ES: Readonly<Record<QualityIssueStatus, string>> = {
  open: 'Abierto',
  resolved: 'Resuelto',
  verified: 'Verificado',
};

export const REWORK_ACTION_TYPES = ['rework', 'refabricate', 'scrap', 'accept_as_is'] as const;
export type ReworkActionType = (typeof REWORK_ACTION_TYPES)[number];

export const REWORK_ACTION_LABELS_ES: Readonly<Record<ReworkActionType, string>> = {
  rework: 'Retrabajar',
  refabricate: 'Refabricar',
  scrap: 'Chatarrear',
  accept_as_is: 'Aceptar como está',
};

/** Checklist items of the per-unit QC (production-flow-v2.md §10). */
export const QC_CHECK_CODES = [
  'square',
  'dimensions',
  'hardware',
  'doors_drawers',
  'finish',
  'identification',
] as const;
export type QcCheckCode = (typeof QC_CHECK_CODES)[number];

export const QC_CHECK_LABELS_ES: Readonly<Record<QcCheckCode, string>> = {
  square: 'Escuadra',
  dimensions: 'Dimensiones',
  hardware: 'Herrajes',
  doors_drawers: 'Puertas/Cajones',
  finish: 'Acabado',
  identification: 'Identificación',
};

export type QualityStation =
  | 'cutting'
  | 'cnc'
  | 'edge_banding'
  | 'assembly'
  | 'module_qc'
  | 'packaging'
  | 'installation';

/* ── Entities ──────────────────────────────────────────────────────────────── */

/** A defect detected before delivery, linked to a piece and/or unit (OC-060). */
export interface QualityIssue {
  readonly id: string;
  readonly description: string;
  readonly category: QualityIssueCategory;
  readonly status: QualityIssueStatus;
  /** Linked furniture item (ProjectItem id). */
  readonly projectItemId?: string;
  /** Linked piece (PartInstance id). */
  readonly partInstanceId?: string;
  /** Linked module unit (ModuleUnitExecution id). */
  readonly moduleUnitId?: string;
  /** Station where the defect was detected. */
  readonly station?: QualityStation;
  readonly photoIds?: readonly string[];
  readonly notes?: string;
  readonly reportedBy?: string;
  readonly reportedAt: string;
  readonly resolvedAt?: string;
  readonly resolvedBy?: string;
  readonly resolutionNotes?: string;
  readonly verifiedAt?: string;
  readonly verifiedBy?: string;
}

/**
 * The resolution of a quality issue (OC-061): what was done with the defective
 * piece/unit and how much material/time it cost — the input for job costing.
 */
export interface ReworkAction {
  readonly id: string;
  readonly issueId: string;
  readonly action: ReworkActionType;
  readonly reason?: string;
  /** Material lost/affected (cost in currency units). */
  readonly materialCost: number;
  /** Labor time lost/affected (minutes). */
  readonly laborMinutes: number;
  /** Affected piece when the action operates on a PartInstance. */
  readonly partInstanceId?: string;
  readonly byUserId?: string;
  readonly at: string;
}

export interface UnitQcChecklistItem {
  readonly code: QcCheckCode;
  readonly passed: boolean;
}

/** Per-unit QC result (OC-062): checklist evidence or an audited override. */
export interface UnitQcRecord {
  readonly unitId: string;
  readonly checklist: readonly UnitQcChecklistItem[];
  readonly passedAt?: string;
  readonly passedBy?: string;
  readonly notes?: string;
  readonly photoIds?: readonly string[];
  /** Supervisor override allowing packaging without approved QC (OC-062). */
  readonly override?: {
    readonly reason: string;
    readonly byUserId?: string;
    readonly at: string;
  };
}

/** Quality subprocess of one project. */
export interface QualityJob {
  readonly id: string;
  readonly projectId: string;
  readonly issues: readonly QualityIssue[];
  readonly reworkActions: readonly ReworkAction[];
  readonly unitQc: readonly UnitQcRecord[];
  readonly createdAt: string;
}

/* ── Open work selectors ───────────────────────────────────────────────────── */

export function openQualityIssues(job: QualityJob | undefined): readonly QualityIssue[] {
  return job?.issues.filter((i) => i.status === 'open') ?? [];
}

/** Open issues linked to a unit directly or through its mueble (projectItem). */
export function openIssuesForUnit(
  job: QualityJob | undefined,
  unit: Pick<ModuleUnitExecution, 'id' | 'projectItemId'>,
): readonly QualityIssue[] {
  return openQualityIssues(job).filter(
    (i) => i.moduleUnitId === unit.id || (!i.moduleUnitId && i.projectItemId === unit.projectItemId),
  );
}

export function unitQcRecord(
  job: QualityJob | undefined,
  unitId: string,
): UnitQcRecord | undefined {
  return job?.unitQc.find((r) => r.unitId === unitId);
}

export function reworkCostSummary(
  job: QualityJob | undefined,
): { readonly materialCost: number; readonly laborMinutes: number } {
  let materialCost = 0;
  let laborMinutes = 0;
  for (const a of job?.reworkActions ?? []) {
    materialCost += a.materialCost;
    laborMinutes += a.laborMinutes;
  }
  return {
    materialCost: Math.round(materialCost * 100) / 100,
    laborMinutes: Math.round(laborMinutes * 10) / 10,
  };
}

/* ── QC gate (OC-062) ──────────────────────────────────────────────────────── */

export type QcGateCheckCode = 'qc_passed' | 'no_open_issues';

export interface QcGateCheck {
  readonly code: QcGateCheckCode;
  readonly label: string;
  readonly passed: boolean;
  readonly required: boolean;
  readonly details: string;
}

export const QC_GATE_CHECK_LABELS_ES: Readonly<Record<QcGateCheckCode, string>> = {
  qc_passed: 'QC de la unidad aprobado',
  no_open_issues: 'Sin problemas de calidad abiertos',
};

export interface UnitQcGateResult {
  readonly ready: boolean;
  readonly checks: readonly QcGateCheck[];
  readonly failing: readonly QcGateCheck[];
  /** True when packaging proceeds through an audited supervisor override. */
  readonly overridden: boolean;
}

/**
 * QC gate evaluated before a unit may leave module_qc → packaged (OC-062).
 * The checklist must be approved and no open issue may hang over the unit;
 * a recorded supervisor override lets packaging proceed auditably.
 */
export function evaluateUnitQcGate(
  unit: Pick<ModuleUnitExecution, 'id' | 'projectItemId'>,
  quality: QualityJob | undefined,
): UnitQcGateResult {
  const record = unitQcRecord(quality, unit.id);
  const hasPass = Boolean(record?.passedAt);
  const overridden = Boolean(record?.override);
  const openIssues = openIssuesForUnit(quality, unit);

  const checks: QcGateCheck[] = [
    {
      code: 'qc_passed',
      label: QC_GATE_CHECK_LABELS_ES.qc_passed,
      passed: hasPass,
      required: true,
      details: hasPass
        ? `Checklist aprobado (${record!.checklist.filter((c) => c.passed).length}/${record!.checklist.length} puntos)`
        : overridden
          ? `Sin checklist aprobado — Packaging habilitado por override de supervisor: ${record!.override!.reason}`
          : 'Registrar el checklist de QC de la unidad con todos los puntos aprobados',
    },
    {
      code: 'no_open_issues',
      label: QC_GATE_CHECK_LABELS_ES.no_open_issues,
      passed: openIssues.length === 0,
      required: true,
      details:
        openIssues.length === 0
          ? 'Sin problemas de calidad abiertos para la unidad'
          : `${openIssues.length} problema(s) de calidad abierto(s): resolver o verificar antes de empaquetar`,
    },
  ];
  const failing = checks.filter((c) => c.required && !c.passed);
  return { ready: failing.length === 0 || overridden, checks, failing, overridden };
}

/* ── Validation helpers ────────────────────────────────────────────────────── */

export function isQualityIssueCategory(value: string): value is QualityIssueCategory {
  return (QUALITY_ISSUE_CATEGORIES as readonly string[]).includes(value);
}

export function isReworkActionType(value: string): value is ReworkActionType {
  return (REWORK_ACTION_TYPES as readonly string[]).includes(value);
}

export function canTransitionQualityIssueStatus(from: QualityIssueStatus, to: QualityIssueStatus): boolean {
  return QUALITY_ISSUE_STATUS_TRANSITIONS[from].includes(to);
}

function requireJob(project: Project): QualityJob {
  const job = project.quality;
  if (!job) {
    throw new ValidationError('El proyecto no tiene registro de calidad');
  }
  return job;
}

function findIssue(job: QualityJob, issueId: string): QualityIssue {
  const issue = job.issues.find((i) => i.id === issueId);
  if (!issue) {
    throw new ValidationError(`Problema de calidad no encontrado: ${issueId}`);
  }
  return issue;
}

function findPart(project: Project, partInstanceId: string): PartInstance {
  const part = project.partInstances?.find((p) => p.id === partInstanceId);
  if (!part) {
    throw new ValidationError(`Pieza no encontrada: ${partInstanceId}`);
  }
  return part;
}

function generateQualityId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function ensureJob(project: Project, at: string): QualityJob {
  return (
    project.quality ?? {
      id: generateQualityId('qjob'),
      projectId: project.id,
      issues: [],
      reworkActions: [],
      unitQc: [],
      createdAt: at,
    }
  );
}

function withJob(project: Project, job: QualityJob): Project {
  return { ...project, quality: job };
}

function qualityEvent(
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

/* ── Issue actions (OC-060) ────────────────────────────────────────────────── */

export interface ReportQualityIssueParams {
  readonly description: string;
  readonly category: QualityIssueCategory;
  readonly projectItemId?: string;
  readonly partInstanceId?: string;
  readonly moduleUnitId?: string;
  readonly station?: QualityStation;
  readonly photoIds?: readonly string[];
  readonly notes?: string;
  readonly reportedBy?: string;
  readonly at?: string;
  readonly source?: ProjectEventSource;
}

export function reportQualityIssue(
  project: Project,
  params: ReportQualityIssueParams,
): { project: Project; job: QualityJob; issue: QualityIssue; events: readonly ProjectEvent[] } {
  if (!params.description.trim()) {
    throw new ValidationError('El problema de calidad requiere una descripción');
  }
  if (!isQualityIssueCategory(params.category)) {
    throw new ValidationError(`Categoría de calidad inválida: ${String(params.category)}`);
  }

  const at = params.at ?? new Date().toISOString();
  const issue: QualityIssue = {
    id: generateQualityId('qiss'),
    description: params.description.trim(),
    category: params.category,
    status: 'open',
    projectItemId: params.projectItemId,
    partInstanceId: params.partInstanceId,
    moduleUnitId: params.moduleUnitId,
    station: params.station,
    photoIds: params.photoIds?.length ? params.photoIds : undefined,
    notes: params.notes?.trim() || undefined,
    reportedBy: params.reportedBy,
    reportedAt: at,
  };

  const job = ensureJob(project, at);
  const updatedJob: QualityJob = { ...job, issues: [...job.issues, issue] };

  const event = qualityEvent(project, 'quality_issue_reported', {
    byUserId: params.reportedBy,
    at,
    source: params.source,
    note: `Problema de calidad (${QUALITY_ISSUE_CATEGORY_LABELS_ES[issue.category]}): ${issue.description}`,
    payload: {
      issueId: issue.id,
      category: issue.category,
      partInstanceId: issue.partInstanceId,
      projectItemId: issue.projectItemId,
      moduleUnitId: issue.moduleUnitId,
      station: issue.station,
    },
  });

  const updatedProject = appendProjectEvent(withJob(project, updatedJob), event);
  return { project: updatedProject, job: updatedJob, issue, events: [event] };
}

export function transitionQualityIssue(
  project: Project,
  issueId: string,
  toStatus: QualityIssueStatus,
  params: {
    readonly notes?: string;
    readonly byUserId?: string;
    readonly at?: string;
  },
): { project: Project; job: QualityJob } {
  const job = requireJob(project);
  const issue = findIssue(job, issueId);
  if (issue.status === toStatus) {
    return { project, job };
  }
  if (!canTransitionQualityIssueStatus(issue.status, toStatus)) {
    throw new ValidationError(
      `Transición inválida: ${QUALITY_ISSUE_STATUS_LABELS_ES[issue.status]} → ${QUALITY_ISSUE_STATUS_LABELS_ES[toStatus]}`,
    );
  }

  const at = params.at ?? new Date().toISOString();
  const updatedIssue: QualityIssue = {
    ...issue,
    status: toStatus,
    notes: params.notes?.trim() || issue.notes,
    resolvedAt:
      toStatus === 'resolved' ? (issue.resolvedAt ?? at) : toStatus === 'open' ? undefined : issue.resolvedAt,
    resolvedBy:
      toStatus === 'resolved' ? (issue.resolvedBy ?? params.byUserId) : toStatus === 'open' ? undefined : issue.resolvedBy,
    resolutionNotes: params.notes?.trim() || issue.resolutionNotes,
    verifiedAt: toStatus === 'verified' ? (issue.verifiedAt ?? at) : toStatus === 'open' ? undefined : issue.verifiedAt,
    verifiedBy: toStatus === 'verified' ? (issue.verifiedBy ?? params.byUserId) : toStatus === 'open' ? undefined : issue.verifiedBy,
  };
  const updatedJob: QualityJob = {
    ...job,
    issues: job.issues.map((i) => (i.id === issueId ? updatedIssue : i)),
  };
  return { project: withJob(project, updatedJob), job: updatedJob };
}

/* ── Rework actions (OC-061) ───────────────────────────────────────────────── */

export interface RecordReworkActionParams {
  readonly action: ReworkActionType;
  readonly reason?: string;
  /** Material affected (cost) — feeds job costing. */
  readonly materialCost?: number;
  /** Labor time affected (minutes) — feeds job costing. */
  readonly laborMinutes?: number;
  /** Piece to reopen/scrap (required for rework/refabricate/scrap). */
  readonly partInstanceId?: string;
  /** Operation to reopen for `rework` (defaults to last completed). */
  readonly targetOperation?: PartOperationType;
  readonly byUserId?: string;
  readonly at?: string;
  readonly source?: ProjectEventSource;
}

/**
 * Record the resolution of a quality issue (OC-061). rework/refabricate
 * reopen the piece route (triggerPartRework), scrap marks it scrapped, and
 * accept_as_is closes the deviation without physical work. The issue moves to
 * resolved with the action as its resolution; rework/refabricate/scrap audit
 * `rework_started` with the costing payload.
 */
export function recordReworkAction(
  project: Project,
  issueId: string,
  params: RecordReworkActionParams,
): { project: Project; job: QualityJob; action: ReworkAction; events: readonly ProjectEvent[] } {
  const job = requireJob(project);
  const issue = findIssue(job, issueId);
  if (!isReworkActionType(params.action)) {
    throw new ValidationError(`Acción de retrabajo inválida: ${String(params.action)}`);
  }
  if (params.action === 'accept_as_is' && !params.reason?.trim()) {
    throw new ValidationError('Aceptar como está requiere un motivo de desviación');
  }

  const at = params.at ?? new Date().toISOString();
  const materialCost = Math.max(0, params.materialCost ?? 0);
  const laborMinutes = Math.max(0, params.laborMinutes ?? 0);

  let partInstances = project.partInstances;
  if (params.action !== 'accept_as_is') {
    if (!params.partInstanceId) {
      throw new ValidationError(`${REWORK_ACTION_LABELS_ES[params.action]} requiere la pieza afectada`);
    }
    const part = findPart(project, params.partInstanceId);
    const updatedPart: PartInstance =
      params.action === 'scrap'
        ? { ...part, status: 'scrapped' }
        : triggerPartRework(part, params.action, params.reason ?? '', params.targetOperation);
    partInstances = (partInstances ?? []).map((p) => (p.id === updatedPart.id ? updatedPart : p));
  }

  const action: ReworkAction = {
    id: generateQualityId('rwrk'),
    issueId,
    action: params.action,
    reason: params.reason?.trim() || undefined,
    materialCost,
    laborMinutes,
    partInstanceId: params.partInstanceId,
    byUserId: params.byUserId,
    at,
  };

  const resolutionNote = `${REWORK_ACTION_LABELS_ES[params.action]}${params.reason?.trim() ? `: ${params.reason.trim()}` : ''}`;
  const updatedIssue: QualityIssue = {
    ...issue,
    status: 'resolved',
    resolvedAt: issue.resolvedAt ?? at,
    resolvedBy: issue.resolvedBy ?? params.byUserId,
    resolutionNotes: resolutionNote,
  };
  const updatedJob: QualityJob = {
    ...job,
    issues: job.issues.map((i) => (i.id === issueId ? updatedIssue : i)),
    reworkActions: [...job.reworkActions, action],
  };

  const events: ProjectEvent[] = [];
  if (params.action !== 'accept_as_is') {
    events.push(
      qualityEvent(project, 'rework_started', {
        byUserId: params.byUserId,
        at,
        source: params.source,
        note: `Retrabajo (${REWORK_ACTION_LABELS_ES[params.action]}): ${issue.description}`,
        payload: {
          issueId,
          action: params.action,
          partInstanceId: params.partInstanceId,
          materialCost,
          laborMinutes,
        },
      }),
    );
  }

  let updatedProject = withJob({ ...project, partInstances }, updatedJob);
  for (const event of events) {
    updatedProject = appendProjectEvent(updatedProject, event);
  }
  return { project: updatedProject, job: updatedJob, action, events };
}

/* ── Per-unit QC records (OC-062) ──────────────────────────────────────────── */

export interface RecordUnitQcParams {
  readonly checklist: readonly UnitQcChecklistItem[];
  readonly byUserId?: string;
  readonly at?: string;
  readonly notes?: string;
  readonly photoIds?: readonly string[];
}

/**
 * Record the QC checklist of a unit (OC-062). The record passes only when
 * every checklist item passed; a failing record is kept as evidence but does
 * not open the packaging gate.
 */
export function recordUnitQc(
  project: Project,
  unitId: string,
  params: RecordUnitQcParams,
): { project: Project; job: QualityJob; record: UnitQcRecord; passed: boolean } {
  if (params.checklist.length === 0) {
    throw new ValidationError('El checklist de QC requiere al menos un punto');
  }
  for (const item of params.checklist) {
    if (!(QC_CHECK_CODES as readonly string[]).includes(item.code)) {
      throw new ValidationError(`Punto de QC inválido: ${String(item.code)}`);
    }
  }
  const unit = project.moduleUnits?.find((u) => u.id === unitId);
  if (!unit) {
    throw new ValidationError(`Unidad no encontrada: ${unitId}`);
  }

  const at = params.at ?? new Date().toISOString();
  const passed = params.checklist.every((item) => item.passed);
  const job = ensureJob(project, at);
  const previous = unitQcRecord(job, unitId);
  const record: UnitQcRecord = {
    unitId,
    checklist: params.checklist,
    passedAt: passed ? (previous?.passedAt ?? at) : undefined,
    passedBy: passed ? (previous?.passedBy ?? params.byUserId) : undefined,
    notes: params.notes?.trim() || undefined,
    photoIds: params.photoIds?.length ? params.photoIds : undefined,
    override: previous?.override,
  };

  const updatedJob: QualityJob = {
    ...job,
    unitQc: [...job.unitQc.filter((r) => r.unitId !== unitId), record],
  };
  return { project: withJob(project, updatedJob), job: updatedJob, record, passed };
}

/** Audited supervisor override letting a unit package without approved QC. */
export function overrideUnitQc(
  project: Project,
  unitId: string,
  params: { readonly reason: string; readonly byUserId?: string; readonly at?: string },
): { project: Project; job: QualityJob; record: UnitQcRecord } {
  if (!params.reason.trim()) {
    throw new ValidationError('El override de QC requiere un motivo');
  }
  const unit = project.moduleUnits?.find((u) => u.id === unitId);
  if (!unit) {
    throw new ValidationError(`Unidad no encontrada: ${unitId}`);
  }

  const at = params.at ?? new Date().toISOString();
  const job = ensureJob(project, at);
  const previous = unitQcRecord(job, unitId);
  const record: UnitQcRecord = {
    unitId,
    checklist: previous?.checklist ?? [],
    passedAt: previous?.passedAt,
    passedBy: previous?.passedBy,
    notes: previous?.notes,
    photoIds: previous?.photoIds,
    override: { reason: params.reason.trim(), byUserId: params.byUserId, at },
  };
  const updatedJob: QualityJob = {
    ...job,
    unitQc: [...job.unitQc.filter((r) => r.unitId !== unitId), record],
  };
  return { project: withJob(project, updatedJob), job: updatedJob, record };
}
