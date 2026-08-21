/**
 * Installation domain (OC-070..OC-074) — installation job per project with
 * multiple visits, field issues, punch items and audited client closeout.
 *
 * Reference: docs/operational-core-v1.md §10, docs/production-flow-v2.md §13,
 * docs/project-lifecycle.md §11. `installed` units never close a project by
 * themselves: closeout is a separate gated decision.
 */

import { ValidationError } from './errors';
import type { Project } from './types';
import {
  appendProjectEvent,
  createProjectEvent,
  isEventRecorded,
  type ProjectEvent,
  type ProjectEventSource,
} from './projectLifecycle';

/* ── Status vocabularies (parity: contracts/installationStatuses.json) ────── */

export const INSTALLATION_JOB_STATUSES = ['planned', 'in_progress', 'completed'] as const;
export type InstallationJobStatus = (typeof INSTALLATION_JOB_STATUSES)[number];

export const INSTALLATION_VISIT_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const;
export type InstallationVisitStatus = (typeof INSTALLATION_VISIT_STATUSES)[number];

export const INSTALLATION_VISIT_RESULTS = ['finished', 'partial', 'blocked'] as const;
export type InstallationVisitResult = (typeof INSTALLATION_VISIT_RESULTS)[number];

export const FIELD_ISSUE_STATUSES = ['open', 'action_required', 'blocked', 'resolved', 'verified'] as const;
export type FieldIssueStatus = (typeof FIELD_ISSUE_STATUSES)[number];

/**
 * Allowed field issue transitions (OC-072). `resolved → open` and
 * `verified → open` model a failed verification that reopens the issue.
 */
export const FIELD_ISSUE_STATUS_TRANSITIONS: Readonly<
  Record<FieldIssueStatus, readonly FieldIssueStatus[]>
> = {
  open: ['action_required', 'blocked', 'resolved'],
  action_required: ['blocked', 'resolved'],
  blocked: ['action_required', 'resolved'],
  resolved: ['verified', 'open'],
  verified: ['open'],
};

export const PUNCH_ITEM_STATUSES = ['open', 'closed'] as const;
export type PunchItemStatus = (typeof PUNCH_ITEM_STATUSES)[number];

export const PUNCH_SEVERITIES = ['minor', 'major', 'critical'] as const;
export type PunchSeverity = (typeof PUNCH_SEVERITIES)[number];

/* ── UI labels (Spanish) ───────────────────────────────────────────────────── */

export const INSTALLATION_JOB_STATUS_LABELS_ES: Readonly<Record<InstallationJobStatus, string>> = {
  planned: 'Planificada',
  in_progress: 'En curso',
  completed: 'Completada',
};

export const INSTALLATION_VISIT_STATUS_LABELS_ES: Readonly<Record<InstallationVisitStatus, string>> = {
  scheduled: 'Planificada',
  in_progress: 'En curso',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

export const INSTALLATION_VISIT_RESULT_LABELS_ES: Readonly<Record<InstallationVisitResult, string>> = {
  finished: 'Terminada',
  partial: 'Parcial',
  blocked: 'Bloqueada',
};

export const FIELD_ISSUE_STATUS_LABELS_ES: Readonly<Record<FieldIssueStatus, string>> = {
  open: 'Abierta',
  action_required: 'Requiere acción',
  blocked: 'Bloqueada',
  resolved: 'Resuelta',
  verified: 'Verificada',
};

export const PUNCH_ITEM_STATUS_LABELS_ES: Readonly<Record<PunchItemStatus, string>> = {
  open: 'Abierto',
  closed: 'Cerrado',
};

export const PUNCH_SEVERITY_LABELS_ES: Readonly<Record<PunchSeverity, string>> = {
  minor: 'Menor',
  major: 'Mayor',
  critical: 'Crítica',
};

/* ── Entities ──────────────────────────────────────────────────────────────── */

export interface InstallationVisit {
  readonly id: string;
  /** Planned visit date (YYYY-MM-DD). */
  readonly date: string;
  /** Crew member names assigned to the visit. */
  readonly crew: readonly string[];
  readonly arrivalAt?: string;
  readonly startAt?: string;
  readonly endAt?: string;
  readonly notes?: string;
  /** Photos taken during the visit (project photo ids). */
  readonly photoIds?: readonly string[];
  /** Module units / items worked during the visit. */
  readonly unitIds?: readonly string[];
  readonly status: InstallationVisitStatus;
  readonly result?: InstallationVisitResult;
  readonly resultNotes?: string;
  readonly createdAt: string;
}

export interface FieldIssue {
  readonly id: string;
  readonly description: string;
  readonly status: FieldIssueStatus;
  /** Linked furniture item (ProjectItem id) when the issue affects a mueble. */
  readonly projectItemId?: string;
  /** Linked piece (PartInstance id) when the issue affects a pieza. */
  readonly partInstanceId?: string;
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

export interface PunchItem {
  readonly id: string;
  readonly description: string;
  /** Owner responsible for resolving the punch (user id or name). */
  readonly owner: string;
  /** Due date (YYYY-MM-DD). */
  readonly dueDate?: string;
  readonly severity: PunchSeverity;
  /** When true, this punch blocks project closeout (OC-074). */
  readonly isBlocker: boolean;
  readonly status: PunchItemStatus;
  readonly photoIds?: readonly string[];
  readonly openedBy?: string;
  readonly openedAt: string;
  readonly closedAt?: string;
  readonly closedBy?: string;
  /** Resolution evidence: notes and/or photos are required to close (OC-073). */
  readonly resolutionNotes?: string;
  readonly resolutionPhotoIds?: readonly string[];
}

export interface ClientCloseout {
  /** Client (or representative) name that signed the conformity. */
  readonly signedOffBy: string;
  readonly signedOffAt: string;
  readonly signedOffByUserId?: string;
  readonly signedOffNotes?: string;
  readonly signedOffPhotoIds?: readonly string[];
  readonly closedAt?: string;
  readonly closedByUserId?: string;
  readonly closedWithEventId?: string;
}

export interface InstallationJob {
  readonly id: string;
  readonly projectId: string;
  readonly visits: readonly InstallationVisit[];
  readonly fieldIssues: readonly FieldIssue[];
  readonly punchItems: readonly PunchItem[];
  readonly closeout?: ClientCloseout;
  readonly createdAt: string;
}

/* ── Open work selectors ───────────────────────────────────────────────────── */

export function openInstallationVisits(job: InstallationJob | undefined): readonly InstallationVisit[] {
  if (!job) return [];
  return job.visits.filter((v) => v.status === 'scheduled' || v.status === 'in_progress');
}

export function openFieldIssues(job: InstallationJob | undefined): readonly FieldIssue[] {
  if (!job) return [];
  return job.fieldIssues.filter(
    (issue) => issue.status !== 'resolved' && issue.status !== 'verified',
  );
}

export function openPunchItems(job: InstallationJob | undefined): readonly PunchItem[] {
  if (!job) return [];
  return job.punchItems.filter((p) => p.status === 'open');
}

export function blockingPunchItems(job: InstallationJob | undefined): readonly PunchItem[] {
  return openPunchItems(job).filter((p) => p.isBlocker);
}

export function isInstallationCloseoutSigned(job: InstallationJob | undefined): boolean {
  return Boolean(job?.closeout?.signedOffAt);
}

export function isInstallationClosed(job: InstallationJob | undefined): boolean {
  return Boolean(job?.closeout?.closedAt);
}

/**
 * Derived job status (never stored): a job is `in_progress` once any visit
 * started or completed, and `completed` only via the audited
 * `installation_completed` lifecycle event.
 */
export function deriveInstallationJobStatus(project: Project): InstallationJobStatus {
  if (isEventRecorded(project, 'installation_completed')) return 'completed';
  const visits = project.installation?.visits ?? [];
  if (visits.some((v) => v.status === 'in_progress' || v.status === 'completed')) {
    return 'in_progress';
  }
  return 'planned';
}

/* ── Units installed summary (physical first, legacy fallback) ────────────── */

export interface InstallationUnitsSummary {
  readonly mode: 'physical' | 'legacy' | 'none';
  readonly installed: number;
  readonly total: number;
}

export function installationUnitsSummary(project: Project): InstallationUnitsSummary {
  const units = project.moduleUnits;
  if (units && units.length > 0) {
    return {
      mode: 'physical',
      installed: units.filter((u) => u.status === 'installed').length,
      total: units.length,
    };
  }
  const items = project.items ?? [];
  if (items.length === 0) {
    return { mode: 'none', installed: 0, total: 0 };
  }
  return {
    mode: 'legacy',
    installed: items.filter((it) => it.floorStatus === 'installed').length,
    total: items.length,
  };
}

/* ── Closeout gates (OC-074) ───────────────────────────────────────────────── */

export type CloseoutCheckCode =
  | 'units_installed'
  | 'field_issues_resolved'
  | 'punch_blockers_closed'
  | 'visits_completed'
  | 'client_signoff';

export interface CloseoutCheck {
  readonly code: CloseoutCheckCode;
  readonly label: string;
  readonly passed: boolean;
  readonly required: boolean;
  /** When failing, explains how to resolve the blocker. */
  readonly details: string;
}

export const CLOSEOUT_CHECK_LABELS_ES: Readonly<Record<CloseoutCheckCode, string>> = {
  units_installed: 'Todas las unidades instaladas',
  field_issues_resolved: 'Incidencias de campo resueltas',
  punch_blockers_closed: 'Pendientes bloqueantes de punch list cerrados',
  visits_completed: 'Visitas de instalación cerradas',
  client_signoff: 'Conformidad firmada por el cliente',
};

/**
 * Evaluate the four physical/operational closeout gates. Client sign-off is
 * evaluated separately because it is the act gated by these checks.
 */
export function evaluateCloseoutGates(project: Project): readonly CloseoutCheck[] {
  const job = project.installation;
  const units = installationUnitsSummary(project);
  const unitsPassed = units.total > 0 && units.installed === units.total;

  const openIssues = openFieldIssues(job);
  const blockers = blockingPunchItems(job);
  const openNonBlocking = openPunchItems(job).filter((p) => !p.isBlocker);
  const openVisits = openInstallationVisits(job);

  const checks: CloseoutCheck[] = [
    {
      code: 'units_installed',
      label: CLOSEOUT_CHECK_LABELS_ES.units_installed,
      passed: unitsPassed,
      required: true,
      details: unitsPassed
        ? `${units.installed} de ${units.total} unidades instaladas`
        : units.total === 0
          ? 'El proyecto no tiene unidades registradas para instalar'
          : `Faltan instalar ${units.total - units.installed} de ${units.total} unidades`,
    },
    {
      code: 'field_issues_resolved',
      label: CLOSEOUT_CHECK_LABELS_ES.field_issues_resolved,
      passed: openIssues.length === 0,
      required: true,
      details:
        openIssues.length === 0
          ? 'Sin incidencias de campo abiertas'
          : `${openIssues.length} incidencia(s) sin resolver: resolver o verificar antes del cierre`,
    },
    {
      code: 'punch_blockers_closed',
      label: CLOSEOUT_CHECK_LABELS_ES.punch_blockers_closed,
      passed: blockers.length === 0,
      required: true,
      details:
        blockers.length === 0
          ? openNonBlocking.length === 0
            ? 'Punch list cerrado'
            : `${openNonBlocking.length} pendiente(s) no bloqueante(s) abierto(s)`
          : `${blockers.length} pendiente(s) bloqueante(s) del punch list: cerrar con evidencia antes del cierre`,
    },
    {
      code: 'visits_completed',
      label: CLOSEOUT_CHECK_LABELS_ES.visits_completed,
      passed: openVisits.length === 0,
      required: true,
      details:
        openVisits.length === 0
          ? 'Sin visitas pendientes'
          : `${openVisits.length} visita(s) en curso o planificada(s): completar o cancelar antes del cierre`,
    },
  ];
  return checks;
}

export interface CloseoutReadiness {
  readonly ready: boolean;
  readonly checks: readonly CloseoutCheck[];
  readonly failing: readonly CloseoutCheck[];
}

/**
 * Readiness for recording client sign-off (gates) and, with
 * `requireSignOff`, for closing the project (OC-074).
 */
export function evaluateCloseoutReadiness(
  project: Project,
  options?: { readonly requireSignOff?: boolean },
): CloseoutReadiness {
  const checks = [...evaluateCloseoutGates(project)];
  if (options?.requireSignOff) {
    checks.push({
      code: 'client_signoff',
      label: CLOSEOUT_CHECK_LABELS_ES.client_signoff,
      passed: isInstallationCloseoutSigned(project.installation),
      required: true,
      details: isInstallationCloseoutSigned(project.installation)
        ? 'Conformidad registrada'
        : 'Registrar primero la conformidad firmada por el cliente',
    });
  }
  const failing = checks.filter((c) => c.required && !c.passed);
  return { ready: failing.length === 0, checks, failing };
}

/* ── Validation helpers ────────────────────────────────────────────────────── */

export function canTransitionFieldIssueStatus(from: FieldIssueStatus, to: FieldIssueStatus): boolean {
  return FIELD_ISSUE_STATUS_TRANSITIONS[from].includes(to);
}

function requireJob(project: Project): InstallationJob {
  const job = project.installation;
  if (!job) {
    throw new ValidationError('El proyecto no tiene trabajo de instalación registrado');
  }
  return job;
}

function findVisit(job: InstallationJob, visitId: string): InstallationVisit {
  const visit = job.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new ValidationError(`Visita de instalación no encontrada: ${visitId}`);
  }
  return visit;
}

function findFieldIssue(job: InstallationJob, issueId: string): FieldIssue {
  const issue = job.fieldIssues.find((i) => i.id === issueId);
  if (!issue) {
    throw new ValidationError(`Incidencia de campo no encontrada: ${issueId}`);
  }
  return issue;
}

function findPunchItem(job: InstallationJob, punchItemId: string): PunchItem {
  const punch = job.punchItems.find((p) => p.id === punchItemId);
  if (!punch) {
    throw new ValidationError(`Pendiente de punch list no encontrado: ${punchItemId}`);
  }
  return punch;
}

function generateInstallationId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Existing job or a fresh one — field issues and punch items may be recorded on
 * legacy projects that never scheduled a visit (OC-074 applies regardless).
 */
function ensureJob(project: Project, at: string): InstallationJob {
  return (
    project.installation ?? {
      id: generateInstallationId('ijob'),
      projectId: project.id,
      visits: [],
      fieldIssues: [],
      punchItems: [],
      createdAt: at,
    }
  );
}

function withJob(project: Project, job: InstallationJob): Project {
  return { ...project, installation: job };
}

function installationEvent(
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

/* ── Visit actions (OC-070/OC-071) ─────────────────────────────────────────── */

export interface ScheduleVisitParams {
  readonly date: string;
  readonly crew: readonly string[];
  readonly notes?: string;
  readonly unitIds?: readonly string[];
  readonly byUserId?: string;
  readonly at?: string;
  readonly source?: ProjectEventSource;
}

export function scheduleInstallationVisit(
  project: Project,
  params: ScheduleVisitParams,
): { project: Project; job: InstallationJob; visit: InstallationVisit } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
    throw new ValidationError('La fecha de la visita debe tener formato YYYY-MM-DD');
  }
  if (params.crew.length === 0) {
    throw new ValidationError('La visita requiere al menos un integrante de crew');
  }

  const at = params.at ?? new Date().toISOString();
  const visit: InstallationVisit = {
    id: generateInstallationId('ivis'),
    date: params.date,
    crew: params.crew,
    notes: params.notes?.trim() || undefined,
    unitIds: params.unitIds?.length ? params.unitIds : undefined,
    status: 'scheduled',
    createdAt: at,
  };

  const existingJob = project.installation;
  const job: InstallationJob = existingJob
    ? { ...existingJob, visits: [...existingJob.visits, visit] }
    : {
        id: generateInstallationId('ijob'),
        projectId: project.id,
        visits: [visit],
        fieldIssues: [],
        punchItems: [],
        createdAt: at,
      };

  return { project: withJob(project, job), job, visit };
}

export function startInstallationVisit(
  project: Project,
  visitId: string,
  params: { readonly arrivalAt?: string; readonly startAt?: string; readonly byUserId?: string; readonly at?: string; readonly source?: ProjectEventSource },
): { project: Project; job: InstallationJob; events: readonly ProjectEvent[] } {
  const job = requireJob(project);
  const visit = findVisit(job, visitId);
  if (visit.status !== 'scheduled') {
    throw new ValidationError(
      `Sólo se pueden iniciar visitas planificadas (estado actual: ${INSTALLATION_VISIT_STATUS_LABELS_ES[visit.status]})`,
    );
  }

  const at = params.at ?? new Date().toISOString();
  const events: ProjectEvent[] = [];
  if (!isEventRecorded(project, 'installation_started')) {
    events.push(
      installationEvent(project, 'installation_started', {
        byUserId: params.byUserId,
        at,
        source: params.source,
        note: `Primera visita de instalación iniciada (${visit.date})`,
        payload: { visitId: visit.id, visitDate: visit.date },
      }),
    );
  }

  const updatedVisit: InstallationVisit = {
    ...visit,
    status: 'in_progress',
    arrivalAt: params.arrivalAt ?? visit.arrivalAt,
    startAt: params.startAt ?? at,
  };
  const updatedJob: InstallationJob = {
    ...job,
    visits: job.visits.map((v) => (v.id === visitId ? updatedVisit : v)),
  };

  let updatedProject = withJob(project, updatedJob);
  for (const event of events) {
    updatedProject = appendProjectEvent(updatedProject, event);
  }
  return { project: updatedProject, job: updatedJob, events };
}

export function completeInstallationVisit(
  project: Project,
  visitId: string,
  params: {
    readonly result: InstallationVisitResult;
    readonly resultNotes?: string;
    readonly endAt?: string;
    readonly unitIds?: readonly string[];
    readonly photoIds?: readonly string[];
    readonly byUserId?: string;
    readonly at?: string;
  },
): { project: Project; job: InstallationJob } {
  const job = requireJob(project);
  const visit = findVisit(job, visitId);
  if (visit.status !== 'in_progress') {
    throw new ValidationError(
      `Sólo se pueden completar visitas en curso (estado actual: ${INSTALLATION_VISIT_STATUS_LABELS_ES[visit.status]})`,
    );
  }

  const at = params.at ?? new Date().toISOString();
  const updatedVisit: InstallationVisit = {
    ...visit,
    status: 'completed',
    result: params.result,
    resultNotes: params.resultNotes?.trim() || undefined,
    endAt: params.endAt ?? at,
    unitIds: params.unitIds?.length ? params.unitIds : visit.unitIds,
    photoIds: params.photoIds?.length ? params.photoIds : visit.photoIds,
  };
  const updatedJob: InstallationJob = {
    ...job,
    visits: job.visits.map((v) => (v.id === visitId ? updatedVisit : v)),
  };
  return { project: withJob(project, updatedJob), job: updatedJob };
}

export function cancelInstallationVisit(
  project: Project,
  visitId: string,
  params: { readonly reason?: string; readonly byUserId?: string; readonly at?: string },
): { project: Project; job: InstallationJob } {
  const job = requireJob(project);
  const visit = findVisit(job, visitId);
  if (visit.status === 'completed' || visit.status === 'cancelled') {
    throw new ValidationError(
      `No se puede cancelar una visita ${INSTALLATION_VISIT_STATUS_LABELS_ES[visit.status].toLowerCase()}`,
    );
  }

  const at = params.at ?? new Date().toISOString();
  const updatedVisit: InstallationVisit = {
    ...visit,
    status: 'cancelled',
    resultNotes: params.reason?.trim() || visit.resultNotes,
    endAt: visit.endAt ?? at,
  };
  const updatedJob: InstallationJob = {
    ...job,
    visits: job.visits.map((v) => (v.id === visitId ? updatedVisit : v)),
  };
  return { project: withJob(project, updatedJob), job: updatedJob };
}

/* ── Field issue actions (OC-072) ──────────────────────────────────────────── */

export interface ReportFieldIssueParams {
  readonly description: string;
  readonly projectItemId?: string;
  readonly partInstanceId?: string;
  readonly photoIds?: readonly string[];
  readonly notes?: string;
  readonly reportedBy?: string;
  readonly at?: string;
}

export function reportFieldIssue(
  project: Project,
  params: ReportFieldIssueParams,
): { project: Project; job: InstallationJob; issue: FieldIssue } {
  if (!params.description.trim()) {
    throw new ValidationError('La incidencia requiere una descripción');
  }

  const at = params.at ?? new Date().toISOString();
  const issue: FieldIssue = {
    id: generateInstallationId('fiss'),
    description: params.description.trim(),
    status: 'open',
    projectItemId: params.projectItemId,
    partInstanceId: params.partInstanceId,
    photoIds: params.photoIds?.length ? params.photoIds : undefined,
    notes: params.notes?.trim() || undefined,
    reportedBy: params.reportedBy,
    reportedAt: at,
  };

  const job = ensureJob(project, at);
  const updatedJob: InstallationJob = { ...job, fieldIssues: [...job.fieldIssues, issue] };
  return { project: withJob(project, updatedJob), job: updatedJob, issue };
}

export function transitionFieldIssue(
  project: Project,
  issueId: string,
  toStatus: FieldIssueStatus,
  params: {
    readonly notes?: string;
    readonly byUserId?: string;
    readonly at?: string;
  },
): { project: Project; job: InstallationJob } {
  const job = requireJob(project);
  const issue = findFieldIssue(job, issueId);
  if (issue.status === toStatus) {
    return { project, job };
  }
  if (!canTransitionFieldIssueStatus(issue.status, toStatus)) {
    throw new ValidationError(
      `Transición de incidencia inválida: ${FIELD_ISSUE_STATUS_LABELS_ES[issue.status]} → ${FIELD_ISSUE_STATUS_LABELS_ES[toStatus]}`,
    );
  }

  const at = params.at ?? new Date().toISOString();
  const updatedIssue: FieldIssue = {
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
  const updatedJob: InstallationJob = {
    ...job,
    fieldIssues: job.fieldIssues.map((i) => (i.id === issueId ? updatedIssue : i)),
  };
  return { project: withJob(project, updatedJob), job: updatedJob };
}

/* ── Punch item actions (OC-073) ───────────────────────────────────────────── */

export interface OpenPunchItemParams {
  readonly description: string;
  readonly owner: string;
  readonly dueDate?: string;
  readonly severity: PunchSeverity;
  readonly isBlocker?: boolean;
  readonly photoIds?: readonly string[];
  readonly openedBy?: string;
  readonly at?: string;
  readonly source?: ProjectEventSource;
}

export function openPunchItem(
  project: Project,
  params: OpenPunchItemParams,
): { project: Project; job: InstallationJob; punchItem: PunchItem; events: readonly ProjectEvent[] } {
  if (!params.description.trim()) {
    throw new ValidationError('El pendiente requiere una descripción');
  }
  if (!params.owner.trim()) {
    throw new ValidationError('El pendiente requiere un responsable (owner)');
  }
  if (params.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(params.dueDate)) {
    throw new ValidationError('La fecha límite debe tener formato YYYY-MM-DD');
  }

  const at = params.at ?? new Date().toISOString();
  const punchItem: PunchItem = {
    id: generateInstallationId('pnch'),
    description: params.description.trim(),
    owner: params.owner.trim(),
    dueDate: params.dueDate,
    severity: params.severity,
    isBlocker: params.isBlocker ?? false,
    status: 'open',
    photoIds: params.photoIds?.length ? params.photoIds : undefined,
    openedBy: params.openedBy,
    openedAt: at,
  };

  const job = ensureJob(project, at);
  const updatedJob: InstallationJob = { ...job, punchItems: [...job.punchItems, punchItem] };

  const event = installationEvent(project, 'punch_opened', {
    byUserId: params.openedBy,
    at,
    source: params.source,
    note: `Punch abierto: ${punchItem.description}`,
    payload: {
      punchItemId: punchItem.id,
      severity: punchItem.severity,
      isBlocker: punchItem.isBlocker,
      owner: punchItem.owner,
      dueDate: punchItem.dueDate,
    },
  });

  const updatedProject = appendProjectEvent(withJob(project, updatedJob), event);
  return { project: updatedProject, job: updatedJob, punchItem, events: [event] };
}

export function closePunchItem(
  project: Project,
  punchItemId: string,
  params: {
    readonly resolutionNotes?: string;
    readonly resolutionPhotoIds?: readonly string[];
    readonly closedBy?: string;
    readonly at?: string;
    readonly source?: ProjectEventSource;
  },
): { project: Project; job: InstallationJob; events: readonly ProjectEvent[] } {
  const job = requireJob(project);
  const punchItem = findPunchItem(job, punchItemId);
  if (punchItem.status !== 'open') {
    throw new ValidationError('El pendiente ya está cerrado');
  }
  const hasEvidence = Boolean(params.resolutionNotes?.trim()) || (params.resolutionPhotoIds?.length ?? 0) > 0;
  if (!hasEvidence) {
    throw new ValidationError('Cerrar un pendiente requiere evidencia: notas de resolución o fotos');
  }

  const at = params.at ?? new Date().toISOString();
  const updatedPunch: PunchItem = {
    ...punchItem,
    status: 'closed',
    closedAt: at,
    closedBy: params.closedBy,
    resolutionNotes: params.resolutionNotes?.trim() || punchItem.resolutionNotes,
    resolutionPhotoIds: params.resolutionPhotoIds?.length ? params.resolutionPhotoIds : punchItem.resolutionPhotoIds,
  };
  const updatedJob: InstallationJob = {
    ...job,
    punchItems: job.punchItems.map((p) => (p.id === punchItemId ? updatedPunch : p)),
  };

  const event = installationEvent(project, 'punch_closed', {
    byUserId: params.closedBy,
    at,
    source: params.source,
    note: `Punch cerrado: ${updatedPunch.description}`,
    payload: {
      punchItemId: updatedPunch.id,
      wasBlocker: updatedPunch.isBlocker,
    },
  });

  const updatedProject = appendProjectEvent(withJob(project, updatedJob), event);
  return { project: updatedProject, job: updatedJob, events: [event] };
}

/* ── Installation completion & closeout (OC-074) ───────────────────────────── */

/**
 * Mark the installation subprocess as completed. Requires every unit to be
 * installed and no open visits. Does NOT close the project: closeout remains a
 * separate gated decision (docs/project-lifecycle.md §11).
 */
export function completeInstallation(
  project: Project,
  params: { readonly byUserId?: string; readonly at?: string; readonly source?: ProjectEventSource; readonly note?: string },
): { project: Project; events: readonly ProjectEvent[] } {
  if (isEventRecorded(project, 'installation_completed')) {
    throw new ValidationError('La instalación ya fue marcada como completada');
  }

  const units = installationUnitsSummary(project);
  if (units.total === 0 || units.installed !== units.total) {
    throw new ValidationError(
      `No se puede completar la instalación: ${units.installed} de ${units.total} unidades instaladas`,
    );
  }
  const openVisits = openInstallationVisits(project.installation);
  if (openVisits.length > 0) {
    throw new ValidationError(
      `No se puede completar la instalación con ${openVisits.length} visita(s) pendiente(s)`,
    );
  }

  const event = installationEvent(project, 'installation_completed', {
    byUserId: params.byUserId,
    at: params.at,
    source: params.source,
    note: params.note ?? 'Instalación completada en obra',
    payload: { installedUnits: units.installed, totalUnits: units.total, mode: units.mode },
  });
  const updatedProject = appendProjectEvent(project, event);
  return { project: updatedProject, events: [event] };
}

/**
 * Record the client conformity sign-off. Gated by the physical closeout gates
 * (units installed, field issues resolved, blocking punch closed, visits done).
 */
export function recordClientSignOff(
  project: Project,
  params: {
    readonly signedOffBy: string;
    readonly notes?: string;
    readonly photoIds?: readonly string[];
    readonly byUserId?: string;
    readonly at?: string;
    readonly source?: ProjectEventSource;
  },
): { project: Project; events: readonly ProjectEvent[] } {
  if (!params.signedOffBy.trim()) {
    throw new ValidationError('La conformidad requiere el nombre de quien firma');
  }

  const { ready, failing } = evaluateCloseoutReadiness(project);
  if (!ready) {
    const reasons = failing.map((c) => c.label).join(', ');
    throw new ValidationError(`No se puede registrar la conformidad: faltan gates de cierre (${reasons})`);
  }

  const at = params.at ?? new Date().toISOString();
  const job = project.installation;
  const closeout: ClientCloseout = {
    ...(job?.closeout ?? {}),
    signedOffBy: params.signedOffBy.trim(),
    signedOffAt: at,
    signedOffByUserId: params.byUserId,
    signedOffNotes: params.notes?.trim() || undefined,
    signedOffPhotoIds: params.photoIds?.length ? params.photoIds : undefined,
  };
  const updatedJob: InstallationJob = job
    ? { ...job, closeout }
    : {
        id: generateInstallationId('ijob'),
        projectId: project.id,
        visits: [],
        fieldIssues: [],
        punchItems: [],
        closeout,
        createdAt: at,
      };

  const event = installationEvent(project, 'client_signed_off', {
    byUserId: params.byUserId,
    at,
    source: params.source,
    note: params.notes?.trim() || `Conformidad firmada por ${closeout.signedOffBy}`,
    payload: { signedOffBy: closeout.signedOffBy, signedOffAt: closeout.signedOffAt },
  });

  const updatedProject = appendProjectEvent(withJob(project, updatedJob), event);
  return { project: updatedProject, events: [event] };
}

/**
 * Close the project after closeout. Requires the client sign-off to be recorded
 * and the closeout gates to still pass (OC-074: `installed` alone never closes).
 */
export function closeProjectCloseout(
  project: Project,
  params: { readonly byUserId?: string; readonly at?: string; readonly source?: ProjectEventSource; readonly note?: string },
): { project: Project; events: readonly ProjectEvent[] } {
  const { ready, failing } = evaluateCloseoutReadiness(project, { requireSignOff: true });
  if (!ready) {
    const reasons = failing.map((c) => c.label).join(', ');
    throw new ValidationError(`No se puede cerrar el proyecto: faltan gates de cierre (${reasons})`);
  }

  const at = params.at ?? new Date().toISOString();
  const job = requireJob(project);
  const closeout: ClientCloseout = {
    ...job.closeout!,
    closedAt: at,
    closedByUserId: params.byUserId,
  };
  const updatedJob: InstallationJob = { ...job, closeout };

  const event = installationEvent(project, 'project_closed', {
    byUserId: params.byUserId,
    at,
    source: params.source,
    note: params.note ?? 'Proyecto cerrado tras conformidad',
    payload: { closedAt: closeout.closedAt, signedOffBy: job.closeout!.signedOffBy },
  });

  const updatedProject = appendProjectEvent(withJob(project, updatedJob), event);
  return { project: updatedProject, events: [event] };
}

/**
 * Guard for raw closeout event appends (server-side enforcement of OC-074 on
 * POST /api/projects/{id}/events and mirrored locally): `client_signed_off`
 * requires the physical gates; `project_closed` additionally requires the
 * recorded sign-off.
 */
export function validateCloseoutEventAppend(project: Project, type: string): readonly string[] {
  if (type === 'client_signed_off') {
    const { ready, failing } = evaluateCloseoutReadiness(project);
    return ready ? [] : failing.map((c) => c.label);
  }
  if (type === 'project_closed') {
    const { ready, failing } = evaluateCloseoutReadiness(project, { requireSignOff: true });
    return ready ? [] : failing.map((c) => c.label);
  }
  return [];
}
