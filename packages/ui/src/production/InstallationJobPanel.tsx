/**
 * Installation job panel (OC-070..OC-074) — the per-project installation
 * subprocess: visits, field issues, punch items and the gated client
 * closeout. Read-derive only; every mutation goes through the shell
 * callbacks so the server validates transitions and appends the audit
 * lifecycle events.
 */

import { useState, type ReactNode } from 'react';
import { CalendarDays, ListChecks, TriangleAlert, ClipboardCheck } from 'lucide-react';

import {
  FIELD_ISSUE_STATUS_LABELS_ES,
  FIELD_ISSUE_STATUS_TRANSITIONS,
  INSTALLATION_JOB_STATUS_LABELS_ES,
  INSTALLATION_VISIT_RESULT_LABELS_ES,
  INSTALLATION_VISIT_STATUS_LABELS_ES,
  PUNCH_SEVERITY_LABELS_ES,
  canTransitionFieldIssueStatus,
  type FieldIssueStatus,
  type InstallationVisitResult,
  type Project,
  type PunchSeverity,
} from '@muebles/domain';
import { canCompleteInstallationNow, installationJobCardView } from './installationJobView';

const VISIT_STATUS_BADGE: Record<string, string> = {
  scheduled: 'status-badge status-badge--open',
  in_progress: 'status-badge status-badge--progress',
  completed: 'status-badge status-badge--done',
  cancelled: 'status-badge status-badge--cancelled',
};

const ISSUE_STATUS_BADGE: Record<string, string> = {
  open: 'status-badge status-badge--open',
  action_required: 'status-badge status-badge--progress',
  blocked: 'status-badge status-badge--rejected',
  resolved: 'status-badge status-badge--done',
  verified: 'status-badge status-badge--accepted',
};

/** Calendar dates (YYYY-MM-DD) rendered in the workshop's locale, TZ-safe. */
function formatDayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const SEVERITY_BADGE: Record<PunchSeverity, string> = {
  minor: 'status-badge status-badge--cancelled',
  major: 'status-badge status-badge--progress',
  critical: 'status-badge status-badge--rejected',
};

export type InstallationJobPanelHandlers = {
  readonly onScheduleVisit?: (
    projectId: string,
    params: { date: string; crew: readonly string[]; notes?: string },
  ) => void;
  readonly onStartVisit?: (projectId: string, visitId: string) => void;
  readonly onCompleteVisit?: (
    projectId: string,
    visitId: string,
    params: { result: InstallationVisitResult; resultNotes?: string },
  ) => void;
  readonly onCancelVisit?: (projectId: string, visitId: string) => void;
  readonly onReportIssue?: (projectId: string, params: { description: string }) => void;
  readonly onTransitionIssue?: (projectId: string, issueId: string, to: FieldIssueStatus) => void;
  readonly onOpenPunch?: (
    projectId: string,
    params: {
      description: string;
      owner: string;
      dueDate?: string;
      severity: PunchSeverity;
      isBlocker: boolean;
    },
  ) => void;
  readonly onClosePunch?: (projectId: string, punchItemId: string, params: { resolutionNotes: string }) => void;
  readonly onCompleteInstallation?: (projectId: string) => void;
  readonly onSignOff?: (projectId: string, params: { signedOffBy: string }) => void;
  readonly onCloseProject?: (projectId: string) => void;
};

export function InstallationJobPanel({
  project,
  canManage,
  canCloseout,
  handlers,
  testId,
}: {
  readonly project: Project;
  /** Installation roles (installation_* event roles): visits, issues, punch. */
  readonly canManage: boolean;
  /** Closeout roles (client_signed_off/project_closed): conformidad y cierre. */
  readonly canCloseout: boolean;
  readonly handlers: InstallationJobPanelHandlers;
  readonly testId?: string;
}): ReactNode {
  const view = installationJobCardView(project);
  const job = project.installation;
  const projectId = project.id;

  const [visitFormOpen, setVisitFormOpen] = useState(false);
  const [visitDate, setVisitDate] = useState('');
  const [visitCrew, setVisitCrew] = useState('');
  const [completingVisitId, setCompletingVisitId] = useState<string | null>(null);
  const [visitResult, setVisitResult] = useState<InstallationVisitResult>('finished');
  const [visitResultNotes, setVisitResultNotes] = useState('');
  const [issueDescription, setIssueDescription] = useState('');
  const [punchFormOpen, setPunchFormOpen] = useState(false);
  const [punchDescription, setPunchDescription] = useState('');
  const [punchOwner, setPunchOwner] = useState('');
  const [punchDueDate, setPunchDueDate] = useState('');
  const [punchSeverity, setPunchSeverity] = useState<PunchSeverity>('major');
  const [punchIsBlocker, setPunchIsBlocker] = useState(true);
  const [closingPunchId, setClosingPunchId] = useState<string | null>(null);
  const [closePunchNotes, setClosePunchNotes] = useState('');
  const [signOffBy, setSignOffBy] = useState('');

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="ship-board__job" data-testid={testId ?? `installation-job-${projectId}`}>
      <div className="ship-board__job-status">
        <span
          className={
            view.jobStatus === 'completed'
              ? 'status-badge status-badge--done'
              : view.jobStatus === 'in_progress'
                ? 'status-badge status-badge--progress'
                : 'status-badge status-badge--open'
          }
        >
          Instalación: {view.jobStatusLabel}
        </span>
        <span className="ship-board__job-meta">
          {view.units.installed}/{view.units.total} unidades instaladas
          {view.blockingPunchCount > 0
            ? ` · ${view.blockingPunchCount} punch bloqueante${view.blockingPunchCount === 1 ? '' : 's'}`
            : ''}
        </span>
      </div>

      {/* ── Visitas (OC-071) ─────────────────────────────────────────── */}
      <div className="ship-board__section">
        <div className="ship-board__section-header">
          <h4 className="ship-board__section-title">
            <CalendarDays size={14} strokeWidth={1.5} aria-hidden />
            Visitas de campo
            <span className="ship-board__section-count">{job?.visits.length ?? 0}</span>
          </h4>
          {canManage && !visitFormOpen ? (
            <button
              type="button"
              className="btn btn--small"
              onClick={() => setVisitFormOpen(true)}
              data-testid={`installation-new-visit-${projectId}`}
            >
              <CalendarDays size={16} strokeWidth={1.5} aria-hidden />
              Programar visita
            </button>
          ) : null}
        </div>
        <ul className="ship-board__list">
          {(job?.visits ?? []).map((visit) => (
            <li
              key={visit.id}
              className="ship-board__row ship-board__row--stack"
              data-testid={`installation-visit-${visit.id}`}
            >
              <div className="ship-board__row-main">
                <span className="ship-board__row-module">
                  {formatDayDate(visit.date)} · {visit.crew.join(', ')}
                </span>
                <span className="ship-board__row-meta">
                  <span className={VISIT_STATUS_BADGE[visit.status]}>
                    {INSTALLATION_VISIT_STATUS_LABELS_ES[visit.status]}
                  </span>
                  {visit.result
                    ? ` · ${INSTALLATION_VISIT_RESULT_LABELS_ES[visit.result]}${
                        visit.resultNotes ? ` — ${visit.resultNotes}` : ''
                      }`
                    : ''}
                </span>
              </div>
              {canManage && visit.status === 'scheduled' ? (
                <div className="ship-board__row-actions">
                  <button
                    type="button"
                    className="btn btn--small btn--primary"
                    onClick={() => handlers.onStartVisit?.(projectId, visit.id)}
                    data-testid={`installation-visit-start-${visit.id}`}
                  >
                    Iniciar
                  </button>
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => handlers.onCancelVisit?.(projectId, visit.id)}
                  >
                    Cancelar
                  </button>
                </div>
              ) : null}
              {canManage && visit.status === 'in_progress' ? (
                completingVisitId === visit.id ? (
                  <div className="ship-board__inline-form">
                    <select
                      aria-label="Resultado de la visita"
                      value={visitResult}
                      onChange={(e) => setVisitResult(e.target.value as InstallationVisitResult)}
                    >
                      {(Object.keys(INSTALLATION_VISIT_RESULT_LABELS_ES) as InstallationVisitResult[]).map(
                        (r) => (
                          <option key={r} value={r}>
                            {INSTALLATION_VISIT_RESULT_LABELS_ES[r]}
                          </option>
                        ),
                      )}
                    </select>
                    <input
                      type="text"
                      placeholder="Notas del resultado (opcional)"
                      value={visitResultNotes}
                      onChange={(e) => setVisitResultNotes(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn--small btn--primary"
                      onClick={() => {
                        handlers.onCompleteVisit?.(projectId, visit.id, {
                          result: visitResult,
                          resultNotes: visitResultNotes || undefined,
                        });
                        setCompletingVisitId(null);
                        setVisitResultNotes('');
                      }}
                      data-testid={`installation-visit-complete-${visit.id}`}
                    >
                      Guardar
                    </button>
                    <button type="button" className="btn btn--small" onClick={() => setCompletingVisitId(null)}>
                      Volver
                    </button>
                  </div>
                ) : (
                  <div className="ship-board__row-actions">
                    <button
                      type="button"
                      className="btn btn--small btn--primary"
                      onClick={() => setCompletingVisitId(visit.id)}
                    >
                      Completar
                    </button>
                  </div>
                )
              ) : null}
            </li>
          ))}
        </ul>
        {canManage && visitFormOpen ? (
          <div className="ship-board__inline-form">
              <input
                aria-label="Fecha de la visita"
                type="date"
                value={visitDate}
                min={today}
                onChange={(e) => setVisitDate(e.target.value)}
              />
              <input
                aria-label="Crew de la visita"
                type="text"
                placeholder="Crew (nombres separados por coma)"
                value={visitCrew}
                onChange={(e) => setVisitCrew(e.target.value)}
              />
              <button
                type="button"
                className="btn btn--small btn--primary"
                disabled={!visitDate || !visitCrew.trim()}
                onClick={() => {
                  handlers.onScheduleVisit?.(projectId, {
                    date: visitDate,
                    crew: visitCrew
                      .split(',')
                      .map((n) => n.trim())
                      .filter(Boolean),
                  });
                  setVisitFormOpen(false);
                  setVisitDate('');
                  setVisitCrew('');
                }}
                data-testid={`installation-schedule-visit-${projectId}`}
              >
                Programar
              </button>
              <button type="button" className="btn btn--small" onClick={() => setVisitFormOpen(false)}>
                Volver
              </button>
          </div>
        ) : null}
      </div>

      {/* ── Incidencias de campo (OC-072) ────────────────────────────── */}
      <div className="ship-board__section">
        <h4 className="ship-board__section-title">
          <TriangleAlert size={14} strokeWidth={1.5} aria-hidden />
          Incidencias de campo
          {view.openIssueCount > 0 ? (
            <span className="ship-board__section-count">{view.openIssueCount}</span>
          ) : null}
        </h4>
        <ul className="ship-board__list">
          {(job?.fieldIssues ?? []).map((issue) => (
            <li
              key={issue.id}
              className="ship-board__row ship-board__row--stack"
              data-testid={`installation-issue-${issue.id}`}
            >
              <div className="ship-board__row-main">
                <span className="ship-board__row-module">{issue.description}</span>
                <span className="ship-board__row-meta">
                  <span className={ISSUE_STATUS_BADGE[issue.status]}>
                    {FIELD_ISSUE_STATUS_LABELS_ES[issue.status]}
                  </span>
                </span>
              </div>
              {canManage ? (
                <div className="ship-board__row-actions">
                  {FIELD_ISSUE_STATUS_TRANSITIONS[issue.status].map((to) => (
                    <button
                      key={to}
                      type="button"
                      className="btn btn--small"
                      disabled={!canTransitionFieldIssueStatus(issue.status, to)}
                      onClick={() => handlers.onTransitionIssue?.(projectId, issue.id, to)}
                      data-testid={`installation-issue-${issue.id}-${to}`}
                    >
                      {FIELD_ISSUE_STATUS_LABELS_ES[to]}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {canManage ? (
          <div className="ship-board__inline-form">
            <input
              aria-label="Descripción de la incidencia"
              type="text"
              placeholder="Incidencia detectada en obra…"
              value={issueDescription}
              onChange={(e) => setIssueDescription(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--small"
              disabled={!issueDescription.trim()}
              onClick={() => {
                handlers.onReportIssue?.(projectId, { description: issueDescription });
                setIssueDescription('');
              }}
              data-testid={`installation-report-issue-${projectId}`}
            >
              Reportar
            </button>
          </div>
        ) : null}
      </div>

      {/* ── Punch list (OC-073) ──────────────────────────────────────── */}
      <div className="ship-board__section">
        <div className="ship-board__section-header">
          <h4 className="ship-board__section-title">
            <ListChecks size={14} strokeWidth={1.5} aria-hidden />
            Pendientes (Punch list)
            {view.openPunchCount > 0 ? (
              <span className="ship-board__section-count">{view.openPunchCount}</span>
            ) : null}
          </h4>
          {canManage && !punchFormOpen ? (
            <button
              type="button"
              className="btn btn--small"
              onClick={() => setPunchFormOpen(true)}
              data-testid={`installation-new-punch-${projectId}`}
            >
              <ListChecks size={16} strokeWidth={1.5} aria-hidden />
              Abrir pendiente
            </button>
          ) : null}
        </div>
        <ul className="ship-board__list">
          {(job?.punchItems ?? []).map((punch) => (
            <li
              key={punch.id}
              className="ship-board__row ship-board__row--stack"
              data-testid={`installation-punch-${punch.id}`}
            >
              <div className="ship-board__row-main">
                <span className="ship-board__row-module">
                  {punch.description} — {punch.owner}
                  {punch.dueDate ? ` · límite ${formatDayDate(punch.dueDate)}` : ''}
                </span>
                <span className="ship-board__row-meta">
                  <span className={SEVERITY_BADGE[punch.severity]}>
                    {PUNCH_SEVERITY_LABELS_ES[punch.severity]}
                  </span>
                  {punch.isBlocker ? ' · bloquea cierre' : ''}
                  {punch.status === 'closed'
                    ? ` · resuelto${punch.resolutionNotes ? `: ${punch.resolutionNotes}` : ''}`
                    : ''}
                </span>
              </div>
              {canManage && punch.status === 'open' ? (
                closingPunchId === punch.id ? (
                  <div className="ship-board__inline-form">
                    <input
                      aria-label="Evidencia de resolución del pendiente"
                      type="text"
                      placeholder="Evidencia de resolución (obligatoria)"
                      value={closePunchNotes}
                      onChange={(e) => setClosePunchNotes(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn--small btn--primary"
                      disabled={!closePunchNotes.trim()}
                      onClick={() => {
                        handlers.onClosePunch?.(projectId, punch.id, {
                          resolutionNotes: closePunchNotes,
                        });
                        setClosingPunchId(null);
                        setClosePunchNotes('');
                      }}
                      data-testid={`installation-punch-confirm-close-${punch.id}`}
                    >
                      Cerrar pendiente
                    </button>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => setClosingPunchId(null)}
                    >
                      Volver
                    </button>
                  </div>
                ) : (
                  <div className="ship-board__row-actions">
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => setClosingPunchId(punch.id)}
                      data-testid={`installation-punch-close-${punch.id}`}
                    >
                      Resolver
                    </button>
                  </div>
                )
              ) : null}
            </li>
          ))}
        </ul>
        {canManage && punchFormOpen ? (
          <div className="ship-board__inline-form ship-board__inline-form--wide">
              <input
                type="text"
                placeholder="Pendiente detectado…"
                aria-label="Descripción del pendiente"
                value={punchDescription}
                onChange={(e) => setPunchDescription(e.target.value)}
              />
              <input
                type="text"
                placeholder="Responsable"
                aria-label="Responsable del pendiente"
                value={punchOwner}
                onChange={(e) => setPunchOwner(e.target.value)}
              />
              <input
                type="date"
                aria-label="Fecha límite"
                value={punchDueDate}
                onChange={(e) => setPunchDueDate(e.target.value)}
              />
              <label className="ship-board__field-label">
                Severidad{' '}
                <select
                  value={punchSeverity}
                  onChange={(e) => setPunchSeverity(e.target.value as PunchSeverity)}
                >
                  {(Object.keys(PUNCH_SEVERITY_LABELS_ES) as PunchSeverity[]).map((s) => (
                    <option key={s} value={s}>
                      {PUNCH_SEVERITY_LABELS_ES[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ship-board__field-label">
                <input
                  type="checkbox"
                  checked={punchIsBlocker}
                  onChange={(e) => setPunchIsBlocker(e.target.checked)}
                />
                Bloquea cierre
              </label>
              <button
                type="button"
                className="btn btn--small btn--primary"
                disabled={!punchDescription.trim() || !punchOwner.trim()}
                onClick={() => {
                  handlers.onOpenPunch?.(projectId, {
                    description: punchDescription,
                    owner: punchOwner,
                    dueDate: punchDueDate || undefined,
                    severity: punchSeverity,
                    isBlocker: punchIsBlocker,
                  });
                  setPunchFormOpen(false);
                  setPunchDescription('');
                  setPunchOwner('');
                  setPunchDueDate('');
                }}
                data-testid={`installation-open-punch-${projectId}`}
              >
                Abrir pendiente
              </button>
              <button type="button" className="btn btn--small" onClick={() => setPunchFormOpen(false)}>
                Volver
              </button>
          </div>
        ) : null}
      </div>

      {/* ── Cierre y conformidad (OC-074) ────────────────────────────── */}
      <div className="ship-board__section ship-board__section--closeout">
        <h4 className="ship-board__section-title">
          <ClipboardCheck size={14} strokeWidth={1.5} aria-hidden />
          Cierre y conformidad
        </h4>
        <ul className="ship-board__gate-list">
          {view.closeoutChecks.map((check) => (
            <li
              key={check.code}
              className="ship-board__gate"
              data-testid={`installation-gate-${check.code}`}
            >
              <span className={check.passed ? 'ship-board__gate-dot--ok' : 'ship-board__gate-dot--fail'}>
                {check.passed ? '✓' : '✗'}
              </span>
              <span className="ship-board__gate-label">{check.label}</span>
              <span className="ship-board__gate-details">{check.details}</span>
            </li>
          ))}
        </ul>

        {view.closed && job?.closeout ? (
          <p className="ship-board__closeout-audit" data-testid={`installation-closeout-audit-${projectId}`}>
            Conformidad firmada por <strong>{job.closeout.signedOffBy}</strong>
            {job.closeout.closedAt
              ? ` · obra cerrada el ${new Date(job.closeout.closedAt).toLocaleDateString('es-MX')}`
              : ''}
          </p>
        ) : (
          <div className="ship-board__closeout-actions">
            {canManage && canCompleteInstallationNow(view) ? (
              <button
                type="button"
                className="btn btn--small"
                onClick={() => handlers.onCompleteInstallation?.(projectId)}
                data-testid={`installation-complete-${projectId}`}
              >
                Completar instalación
              </button>
            ) : null}
            {canCloseout && !view.closeoutSigned ? (
              <div className="ship-board__inline-form">
                <input
                  aria-label="Nombre de quien firma la conformidad"
                  type="text"
                  placeholder="Firma la conformidad (nombre del cliente)…"
                  value={signOffBy}
                  onChange={(e) => setSignOffBy(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  disabled={!view.closeoutReady || !signOffBy.trim()}
                  title={
                    view.closeoutReady
                      ? undefined
                      : view.closeoutChecks
                          .filter((c) => !c.passed)
                          .map((c) => c.details)
                          .join(' · ')
                  }
                  onClick={() => {
                    handlers.onSignOff?.(projectId, { signedOffBy: signOffBy });
                    setSignOffBy('');
                  }}
                  data-testid={`installation-signoff-${projectId}`}
                >
                  Registrar conformidad
                </button>
              </div>
            ) : null}
            {canCloseout && view.closeoutSigned && !view.closed ? (
              <button
                type="button"
                className="btn btn--small btn--danger"
                onClick={() => handlers.onCloseProject?.(projectId)}
                data-testid={`installation-close-${projectId}`}
              >
                Cerrar proyecto
              </button>
            ) : null}
          </div>
        )}
      </div>

      <p className="ship-board__job-hint">
        Las unidades se instalan desde «En camino» o el escáner; cerrar la obra exige conformidad y punch bloqueante resuelto.
      </p>
    </div>
  );
}
