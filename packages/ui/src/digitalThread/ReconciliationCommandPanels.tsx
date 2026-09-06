import type { ReactNode } from 'react';
import {
  CheckCircle2,
  Factory,
  History,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import {
  GraneteApiError,
  type ManufacturingPreflightResult,
  type ProductionRelease,
  type QuoteRevisionDetail,
  type ReconciliationItem,
} from '@granete/storage';
import { Modal } from '../common';
import {
  formatFingerprint,
  formatQuoteRevisionLabel,
  PREFLIGHT_ISSUE_CODE_LABELS,
  PREFLIGHT_STATUS_LABELS,
  QUOTE_REVISION_STATUS_LABELS,
  impactChips,
  isIncorporableChange,
} from './reconciliationWorkspace';

/**
 * #502 / WEB-DT-3 — command panels for the reconciliation workspace.
 *
 * Presentational components only: every verdict, blocker, count and pin
 * rendered here comes verbatim from the generated backend contracts
 * (#393/#394 reconciliation, #466/#395 preflight, #395 release). Panels
 * never recompute eligibility — disabled states explain the server-owned
 * reason, and success only appears after the authoritative response.
 */

export interface CommandErrorView {
  readonly kind:
    | 'stale'
    | 'conflict'
    | 'forbidden'
    | 'preflight'
    | 'validation'
    | 'network'
    | 'server';
  readonly title: string;
  readonly message: string;
}

/** Typed error mapping — no generic catch-all for business commands. */
export function describeCommandError(err: unknown): CommandErrorView {
  if (err instanceof GraneteApiError) {
    const details = err.payload.details as Record<string, unknown> | undefined;
    const blocker = typeof details?.blocker === 'string' ? details.blocker : null;
    if (err.status === 403) {
      return {
        kind: err.code === 'STEP_UP_REQUIRED' ? 'forbidden' : 'forbidden',
        title: 'Permiso insuficiente',
        message:
          err.code === 'STEP_UP_REQUIRED'
            ? 'Esta acción requiere verificación adicional de identidad (step-up).'
            : 'Tu rol no tiene permiso para ejecutar esta acción en esta obra.',
      };
    }
    if (err.code === 'VERSION_CONFLICT') {
      return {
        kind: 'stale',
        title: 'La comparación quedó desactualizada',
        message:
          'La cotización base cambió desde que abriste esta comparación (hay una revisión más nueva). Recargá la comparación o abrí la revisión nueva antes de volver a intentarlo.',
      };
    }
    if (blocker === 'manufacturing_preflight_blocked') {
      return {
        kind: 'preflight',
        title: 'Preflight de fabricación bloqueado',
        message:
          'El preflight autoritativo rechazó el comando. Corregí los problemas listados antes de liberar.',
      };
    }
    if (err.status === 409 || err.code === 'CONFLICT') {
      return {
        kind: 'conflict',
        title: 'Conflicto de estado',
        message: err.message,
      };
    }
    if (err.status === 400 || err.code === 'BAD_REQUEST') {
      return {
        kind: 'validation',
        title: 'Selección inválida',
        message: err.message,
      };
    }
    return {
      kind: 'server',
      title: 'Error del servidor',
      message: err.message,
    };
  }
  return {
    kind: 'network',
    title: 'Error de red',
    message: 'No se pudo contactar al servidor. La acción no se ejecutó.',
  };
}

export function CommandErrorAlert({ error }: { readonly error: CommandErrorView | null }): ReactNode {
  if (!error) return null;
  return (
    <div className="pd-alert pd-alert--error" role="alert" data-testid="command-error-alert">
      <strong>{error.title}.</strong> <span>{error.message}</span>
    </div>
  );
}

/** Preflight issues payload from a blocked release 409, for the release panel. */
export function preflightIssuesFromError(err: unknown): ManufacturingPreflightResult['issues'] {
  if (err instanceof GraneteApiError) {
    const details = err.payload.details as Record<string, unknown> | undefined;
    const issues = details?.issues;
    if (Array.isArray(issues)) {
      return issues as ManufacturingPreflightResult['issues'];
    }
  }
  return [];
}

export interface PreflightPanelProps {
  readonly preflight: ManufacturingPreflightResult | null;
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
}

export function PreflightPanel({ preflight, loading, error, onRetry }: PreflightPanelProps): ReactNode {
  const showIssues = preflight !== null && preflight.status === 'blocked' && preflight.includesDetail;
  return (
    <section className="pd-card pr-panel" data-testid="preflight-panel" aria-labelledby="preflight-title">
      <div className="pd-card__header">
        <div className="pd-card__title">
          <Factory size={18} />
          <h3 id="preflight-title">Preflight de fabricación</h3>
        </div>
        {loading ? (
          <span className="status-badge status-badge--open" data-testid="preflight-loading">
            Evaluando…
          </span>
        ) : preflight ? (
          <span
            className={`status-badge ${
              preflight.status === 'ready' ? 'status-badge--done' : 'status-badge--danger'
            }`}
            data-testid="preflight-status"
          >
            {preflight.status === 'ready' ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}
            {PREFLIGHT_STATUS_LABELS[preflight.status]}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="pd-alert pd-alert--error" role="alert" data-testid="preflight-error">
          No se pudo evaluar el preflight autoritativo de esta revisión.
          <button type="button" className="btn btn-sm btn-secondary" onClick={onRetry}>
            Reintentar
          </button>
        </div>
      ) : loading ? (
        <p className="pd-empty-hint">Evaluando el contrato de fabricación de la revisión exacta…</p>
      ) : preflight ? (
        <>
          <p
            className={`pr-panel__hint ${preflight.status === 'blocked' ? 'pr-panel__hint--danger' : ''}`}
            data-testid="preflight-message"
          >
            {preflight.message}
          </p>
          {showIssues ? (
            <ul className="pr-issue-list" data-testid="preflight-issues">
              {preflight.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`} className="pr-issue-list__item">
                  <span className="pr-issue-list__code">{issue.code}</span>
                  <span>{PREFLIGHT_ISSUE_CODE_LABELS[issue.code] ?? issue.message}</span>
                  {issue.furnitureInstanceId && (
                    <span className="pd-code-pill" title={issue.furnitureInstanceId}>
                      {issue.furnitureInstanceId.slice(0, 13)}…
                    </span>
                  )}
                  {issue.parameter && <span className="pr-issue-list__param">({issue.parameter})</span>}
                </li>
              ))}
            </ul>
          ) : preflight.status === 'blocked' && !preflight.includesDetail ? (
            <p className="pr-panel__why" data-testid="preflight-detail-restricted">
              El detalle técnico de fabricación está disponible para roles de fabricación (
              {preflight.blockedItemCount}{' '}
              {preflight.blockedItemCount === 1 ? 'unidad bloqueada' : 'unidades bloqueadas'}).
            </p>
          ) : null}
        </>
      ) : (
        <p className="pd-empty-hint">Seleccioná una revisión publicada para evaluar su preflight.</p>
      )}
    </section>
  );
}

export interface ApprovalPanelProps {
  readonly canApprove: boolean;
  readonly revisionStatus: 'published' | 'approved' | 'superseded' | null;
  readonly approvedBy: string | null | undefined;
  readonly approvedAt: string | null | undefined;
  /** Server context (#502): the gated command pins the exact accepted quote. */
  readonly quoteAccepted: boolean;
  readonly quoteLabel: string;
  /** Server-owned preflight verdict over the exact revision. */
  readonly preflightBlocked: boolean | null;
  readonly submitting: boolean;
  readonly error: CommandErrorView | null;
  readonly onApprove: () => void;
}

export function ApprovalPanel({
  canApprove,
  revisionStatus,
  approvedBy,
  approvedAt,
  quoteAccepted,
  quoteLabel,
  preflightBlocked,
  submitting,
  error,
  onApprove,
}: ApprovalPanelProps): ReactNode {
  const canSubmitFromStatus = revisionStatus === 'published';
  return (
    <section className="pd-card pr-panel" data-testid="approval-panel" aria-labelledby="approval-title">
      <div className="pd-card__header">
        <div className="pd-card__title">
          <ShieldCheck size={18} />
          <h3 id="approval-title">Aprobación de la revisión</h3>
        </div>
      </div>

      {revisionStatus === 'approved' ? (
        <p className="pr-panel__hint" data-testid="approval-done">
          Revisión aprobada{approvedAt ? ` el ${approvedAt.slice(0, 10)}` : ''}
          {approvedBy ? ` por ${approvedBy.slice(0, 8)}…` : ''}.
        </p>
      ) : revisionStatus === 'superseded' ? (
        <p className="pr-panel__hint" data-testid="approval-superseded">
          Esta revisión fue reemplazada por una más nueva; no puede aprobarse.
        </p>
      ) : (
        <p className="pr-panel__hint" data-testid="approval-pending">
          {canSubmitFromStatus
            ? `La aprobación de producción se valida contra ${quoteLabel} y el preflight autoritativo del servidor.`
            : 'Seleccioná una revisión publicada para habilitar la aprobación.'}
        </p>
      )}
      {canSubmitFromStatus && !quoteAccepted && (
        <p className="pr-panel__why" data-testid="approval-quote-hint">
          La cotización seleccionada ({quoteLabel}) no está aceptada: el servidor rechazará la
          aprobación de producción hasta fijar una base comercial aceptada.
        </p>
      )}

      <CommandErrorAlert error={error} />

      <button
        type="button"
        className="btn btn-primary"
        data-testid="approve-revision-btn"
        disabled={submitting || !canSubmitFromStatus || !canApprove || preflightBlocked === true}
        onClick={onApprove}
      >
        {submitting ? <RefreshCw size={14} className="spin" /> : <ShieldCheck size={14} />}
        <span>{submitting ? 'Aprobando…' : 'Aprobar revisión exacta'}</span>
      </button>
      {canSubmitFromStatus && preflightBlocked === true && (
        <p className="pr-panel__why" data-testid="approval-preflight-hint">
          El preflight autoritativo bloquea esta revisión: la aprobación de producción está
          bloqueada por el servidor.
        </p>
      )}
      {!canApprove && revisionStatus === 'published' && (
        <p className="pr-panel__why" data-testid="approval-permission-hint">
          Tu rol no incluye la capacidad de aprobar revisiones de diseño.
        </p>
      )}
    </section>
  );
}

export interface ReleasePanelProps {
  readonly canRelease: boolean;
  readonly revisionApproved: boolean;
  readonly quoteAccepted: boolean;
  readonly quoteLabel: string;
  readonly preflightReady: boolean | null;
  readonly submitting: boolean;
  readonly error: CommandErrorView | null;
  readonly preflightIssues: ManufacturingPreflightResult['issues'];
  readonly onOpenReview: () => void;
}

export function ReleasePanel({
  canRelease,
  revisionApproved,
  quoteAccepted,
  quoteLabel,
  preflightReady,
  submitting,
  error,
  preflightIssues,
  onOpenReview,
}: ReleasePanelProps): ReactNode {
  const canOpenReview = canRelease && revisionApproved && quoteAccepted;
  return (
    <section className="pd-card pr-panel" data-testid="release-panel" aria-labelledby="release-title">
      <div className="pd-card__header">
        <div className="pd-card__title">
          <Factory size={18} />
          <h3 id="release-title">Liberación a producción</h3>
        </div>
      </div>

      <p className="pr-panel__hint" data-testid="release-hint">
        {revisionApproved
          ? preflightReady === false
            ? 'El preflight autoritativo bloquea esta revisión: corregí los problemas antes de liberar.'
            : 'La revisión aprobada puede liberarse con un comando explícito y separado de la aprobación.'
          : 'La liberación requiere primero la aprobación de la revisión exacta.'}
      </p>

      <p className="pr-pin-note" data-testid="release-quote-pin-note">
        Base comercial exacta: <strong>{quoteAccepted ? quoteLabel : `${quoteLabel} (no aceptada)`}</strong>{' '}
        — la liberación siempre queda fijada a la cotización aceptada seleccionada.
      </p>

      <CommandErrorAlert error={error} />
      {preflightIssues.length > 0 && (
        <ul className="pr-issue-list" data-testid="release-preflight-issues">
          {preflightIssues.map((issue, index) => (
            <li key={`${issue.code}-${index}`} className="pr-issue-list__item">
              <span className="pr-issue-list__code">{issue.code}</span>
              <span>{PREFLIGHT_ISSUE_CODE_LABELS[issue.code] ?? issue.message}</span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="btn btn-primary"
        data-testid="open-release-review-btn"
        disabled={!canOpenReview || preflightReady === false}
        onClick={onOpenReview}
      >
        <Factory size={14} />
        <span>Crear liberación de producción</span>
      </button>
      {!canRelease && (
        <p className="pr-panel__why" data-testid="release-permission-hint">
          Tu rol no incluye la capacidad de liberar producción.
        </p>
      )}
      {canRelease && !revisionApproved && (
        <p className="pr-panel__why" data-testid="release-approval-hint">
          Disponible después de la aprobación.
        </p>
      )}
      {canRelease && revisionApproved && !quoteAccepted && (
        <p className="pr-panel__why" data-testid="release-quote-hint">
          Seleccioná una cotización aceptada como base comercial para liberar.
        </p>
      )}
    </section>
  );
}

export interface ReleaseHistoryListProps {
  readonly releases: readonly ProductionRelease[];
  readonly quoteRevisions: readonly QuoteRevisionDetail[];
  readonly latestRelease: ProductionRelease | null;
}

export function ReleaseHistoryList({
  releases,
  quoteRevisions,
  latestRelease,
}: ReleaseHistoryListProps): ReactNode {
  return (
    <section className="pd-card pr-panel" data-testid="release-history" aria-labelledby="release-history-title">
      <div className="pd-card__header">
        <div className="pd-card__title">
          <History size={18} />
          <h3 id="release-history-title">Historial de liberaciones ({releases.length})</h3>
        </div>
        {latestRelease && (
          <span className="pr-latest-note" data-testid="latest-release-note">
            Última del proyecto: #{latestRelease.release_number} (informativo)
          </span>
        )}
      </div>

      {releases.length === 0 ? (
        <p className="pd-empty-hint" data-testid="no-releases-hint">
          Esta obra aún no tiene liberaciones de producción.
        </p>
      ) : (
        <div className="pd-table-container">
          <table className="pd-items-table" data-testid="release-history-table">
            <thead>
              <tr>
                <th scope="col">Liberación</th>
                <th scope="col">Pines exactos</th>
                <th scope="col">Contexto de fabricación</th>
                <th scope="col">Liberada</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((release) => {
                const quote = quoteRevisions.find((q) => q.id === release.quote_revision_id);
                return (
                  <tr key={release.id} data-testid={`release-row-${release.release_number}`}>
                    <td>
                      <strong>#{release.release_number}</strong>
                      <div className="text-muted">R{release.design_revision_number}</div>
                    </td>
                    <td>
                      {quote ? formatQuoteRevisionLabel(quote) : <span className="text-muted">sin cotización</span>}
                      {' + '}
                      R{release.design_revision_number}
                    </td>
                    <td>
                      <span className="pd-hash-badge" title={release.manufacturing_fingerprint}>
                        {formatFingerprint(release.manufacturing_fingerprint)}
                      </span>
                    </td>
                    <td>{release.released_at.slice(0, 10)}</td>
                    <td>
                      {release.staleness.manufacturing_stale ? (
                        <span
                          className="status-badge status-badge--warning"
                          title={`Stale respecto al diseño actual R${release.staleness.current_design_revision_number ?? '?'}`}
                        >
                          Stale (diseño actual R{release.staleness.current_design_revision_number ?? '?'})
                        </span>
                      ) : (
                        <span className="status-badge status-badge--done">Activa</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="pr-panel__why">
        Cada liberación queda fijada para siempre a sus revisiones exactas: una revisión más nueva
        nunca reasigna una liberación existente.
      </p>
    </section>
  );
}

export interface RequoteReviewModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly items: readonly ReconciliationItem[];
  readonly selectedIds: readonly string[];
  readonly onToggle: (furnitureInstanceId: string, checked: boolean) => void;
  readonly quoteLabel: string;
  readonly quoteStatusLabel: string;
  readonly designRevisionLabel: string;
  readonly submitting: boolean;
  readonly error: CommandErrorView | null;
  readonly onSubmit: () => void;
}

export function RequoteReviewModal({
  open,
  onClose,
  items,
  selectedIds,
  onToggle,
  quoteLabel,
  quoteStatusLabel,
  designRevisionLabel,
  submitting,
  error,
  onSubmit,
}: RequoteReviewModalProps): ReactNode {
  const incorporable = items.filter(isIncorporableChange);
  return (
    <Modal
      open={open}
      title={`Nueva cotización desde ${quoteLabel} ↔ ${designRevisionLabel}`}
      onClose={() => {
        if (!submitting) onClose();
      }}
    >
      <div className="pr-requote-modal" data-testid="requote-review-modal">
        <p className="pd-modal-hint">
          La cotización {quoteLabel} ({quoteStatusLabel}) no será modificada. Se creará una nueva
          revisión de cotización en estado borrador incorporando los cambios comerciales que elijas.
        </p>

        {incorporable.length === 0 ? (
          <p className="pd-empty-hint">
            No hay cambios comerciales incorporables según la clasificación del servidor.
          </p>
        ) : (
          <ul className="pr-requote-selection">
            {incorporable.map((item) => {
              const checked = selectedIds.includes(item.furnitureInstanceId);
              return (
                <li key={item.furnitureInstanceId} className="pr-requote-selection__item">
                  <label>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={submitting}
                      onChange={(e) => onToggle(item.furnitureInstanceId, e.target.checked)}
                      data-testid={`requote-select-${item.furnitureInstanceId}`}
                    />
                    <span className="pd-code-pill" title={item.furnitureInstanceId}>
                      {item.furnitureInstanceId.slice(0, 13)}…
                    </span>
                    <span>
                      {item.status === 'modeled_not_quoted'
                        ? 'Modelado no cotizado'
                        : 'Cambio comercial'}{' '}
                      · Impacto: {impactChips(item.impact).join(' + ') || '—'}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <div className="pr-requote-summary">
          <p>
            Base: <strong>{quoteLabel}</strong> · Fuente de diseño:{' '}
            <strong>{designRevisionLabel}</strong>
          </p>
          <p>
            Se incorporarán <strong>{selectedIds.length}</strong>{' '}
            {selectedIds.length === 1 ? 'unidad' : 'unidades'}; el resto se conserva tal como está.
          </p>
        </div>

        <CommandErrorAlert error={error} />

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={submitting}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={submitting || selectedIds.length === 0}
            onClick={onSubmit}
            data-testid="submit-requote"
          >
            {submitting ? 'Creando nueva cotización…' : 'Crear nueva cotización'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export interface ReleaseReviewModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly projectName: string | null;
  readonly quoteLabel: string;
  readonly quoteStatusLabel: string;
  readonly designRevisionLabel: string;
  readonly preflightStatus: string | null;
  readonly approvalStatus: string;
  readonly submitting: boolean;
  readonly error: CommandErrorView | null;
  readonly onSubmit: () => void;
}

export function ReleaseReviewModal({
  open,
  onClose,
  projectName,
  quoteLabel,
  quoteStatusLabel,
  designRevisionLabel,
  preflightStatus,
  approvalStatus,
  submitting,
  error,
  onSubmit,
}: ReleaseReviewModalProps): ReactNode {
  return (
    <Modal
      open={open}
      title="Propuesta de liberación de producción"
      onClose={() => {
        if (!submitting) onClose();
      }}
    >
      <div className="pr-release-modal" data-testid="release-review-modal">
        <p className="pd-modal-hint">
          Revisá la propuesta antes de ejecutar. La liberación quedará fijada para siempre a estas
          revisiones exactas y a su contexto de fabricación verificado.
        </p>

        <dl className="pd-audit-grid">
          <dt>Obra</dt>
          <dd>{projectName ?? '—'}</dd>
          <dt>Cotización (base comercial exacta)</dt>
          <dd>{`${quoteLabel} · ${quoteStatusLabel}`}</dd>
          <dt>Revisión de diseño</dt>
          <dd>{designRevisionLabel}</dd>
          <dt>Preflight autoritativo</dt>
          <dd>{preflightStatus ?? '—'}</dd>
          <dt>Aprobación</dt>
          <dd>{approvalStatus}</dd>
          <dt>Contexto de fabricación</dt>
          <dd>Verificado por el servidor al liberar (fingerprint inmutable en la liberación)</dd>
        </dl>

        <CommandErrorAlert error={error} />

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={submitting}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={submitting}
            onClick={onSubmit}
            data-testid="submit-release"
          >
            {submitting ? 'Liberando…' : 'Liberar a producción'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function quoteStatusLabelOf(quote: QuoteRevisionDetail | null | undefined): string {
  return quote ? (QUOTE_REVISION_STATUS_LABELS[quote.status] ?? quote.status) : '—';
}
