/**
 * LifecyclePanel (OC-010..OC-024).
 * Comprehensive Project Lifecycle management tab in ProjectDetailView:
 * - Commercial Status & Project Stage
 * - Design Revisions (OC-020)
 * - Multi-Role Approvals (OC-021)
 * - Production Release 6-Gates (OC-022)
 * - Staleness Detection (OC-023)
 * - Change Orders (OC-024)
 * - Audit Event Log (OC-010)
 */

import { useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  ExternalLink,
  Factory,
  FileCheck,
  FileSpreadsheet,
  History,
  Layers,
  Plus,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  COMMERCIAL_STATUS_LABELS_ES,
  PROJECT_STAGE_LABELS_ES,
  PROJECT_EVENT_TYPE_LABELS_ES,
  APPROVAL_STATUS_LABELS_ES,
  APPROVAL_TYPE_LABELS_ES,
  CHANGE_ORDER_STATUS_LABELS_ES,
  STALENESS_REASON_LABELS_ES,
  deriveProjectStage,
  getProjectStalenessReport,
  evaluateProductionReleaseGates,
  getProjectApprovals,
  getProjectDesignRevisions,
  getProjectChangeOrders,
  getLatestDeposit,
  type Project,
  type CommercialStatus,
  type ApprovalType,
  type DesignRevision,
} from '@muebles/domain';

export interface LifecyclePanelProps {
  readonly project: Project;
  readonly onOpenReleaseModal: () => void;
  readonly onOpenChangeOrderModal: () => void;
  readonly onCreateRevision?: (name?: string, description?: string) => void | Promise<void>;
  readonly onDecideApproval?: (
    approvalId: string,
    decision: 'approved' | 'rejected',
    notes?: string
  ) => void | Promise<void>;
  readonly onRequestApproval?: (type: ApprovalType, notes?: string) => void | Promise<void>;
  readonly onChangeCommercialStatus?: (status: CommercialStatus) => void | Promise<void>;
  readonly onRecordDeposit?: (
    params: { amount: number; currency: string; reference?: string; note?: string },
  ) => void | Promise<void>;
}

export function LifecyclePanel({
  project,
  onOpenReleaseModal,
  onOpenChangeOrderModal,
  onCreateRevision,
  onDecideApproval,
  onRequestApproval,
  onChangeCommercialStatus,
  onRecordDeposit,
}: LifecyclePanelProps): ReactNode {
  const [revisionName, setRevisionName] = useState('');
  const [showNewRevisionForm, setShowNewRevisionForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showDepositForm, setShowDepositForm] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositReference, setDepositReference] = useState('');
  const [depositNote, setDepositNote] = useState('');

  const stage = deriveProjectStage(project);
  const staleness = getProjectStalenessReport(project);
  const gates = evaluateProductionReleaseGates(project);
  const revisions = getProjectDesignRevisions(project);
  const approvals = getProjectApprovals(project);
  const changeOrders = getProjectChangeOrders(project);
  const latestDeposit = getLatestDeposit(project);
  const events = [...(project.events ?? [])].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  );

  const handleCreateRevision = async () => {
    if (!onCreateRevision) return;
    setBusy(true);
    try {
      await onCreateRevision(revisionName.trim() || undefined);
      setRevisionName('');
      setShowNewRevisionForm(false);
    } finally {
      setBusy(false);
    }
  };

  const handleRecordDeposit = async () => {
    if (!onRecordDeposit) return;
    const amount = Number(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setBusy(true);
    try {
      await onRecordDeposit({
        amount,
        currency: project.currency,
        reference: depositReference.trim() || undefined,
        note: depositNote.trim() || undefined,
      });
      setDepositAmount('');
      setDepositReference('');
      setDepositNote('');
      setShowDepositForm(false);
    } finally {
      setBusy(false);
    }
  };

  const handleDecideApproval = async (
    approvalId: string,
    decision: 'approved' | 'rejected'
  ) => {
    if (!onDecideApproval) return;
    setBusy(true);
    try {
      await onDecideApproval(approvalId, decision);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lifecycle-panel" data-testid="lifecycle-panel">
      {/* 1. Header Overview: Stage & Commercial Status */}
      <div className="lifecycle-overview-card">
        <div className="lifecycle-overview-card__item">
          <span className="lifecycle-overview-card__label">Etapa Operativa (ProjectStage)</span>
          <div className="lifecycle-stage-badge">
            <span className="lifecycle-stage-badge__dot" />
            <strong>{PROJECT_STAGE_LABELS_ES[stage]}</strong>
          </div>
        </div>

        <div className="lifecycle-overview-card__item">
          <span className="lifecycle-overview-card__label">Estado Comercial</span>
          {onChangeCommercialStatus ? (
            <select
              className="form-select form-select--small"
              value={project.commercialStatus ?? 'draft'}
              onChange={(e) => onChangeCommercialStatus(e.target.value as CommercialStatus)}
              disabled={busy}
              data-testid="select-commercial-status"
            >
              {(Object.keys(COMMERCIAL_STATUS_LABELS_ES) as CommercialStatus[]).map((st) => (
                <option key={st} value={st}>
                  {COMMERCIAL_STATUS_LABELS_ES[st]}
                </option>
              ))}
            </select>
          ) : (
            <strong>{COMMERCIAL_STATUS_LABELS_ES[project.commercialStatus ?? 'draft']}</strong>
          )}
        </div>

        <div className="lifecycle-overview-card__item">
          <span className="lifecycle-overview-card__label">Liberación a Producción</span>
          <div className="lifecycle-release-status">
            {staleness.isReleased ? (
              <span className="badge badge--success-subtle">
                <ShieldCheck size={14} aria-hidden="true" />
                Liberado
              </span>
            ) : (
              <span className="badge badge--neutral-subtle">
                <Clock size={14} aria-hidden="true" />
                Pendiente ({gates.filter((g) => g.passed).length}/6 Gates)
              </span>
            )}
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={onOpenReleaseModal}
              data-testid="btn-open-release-modal"
            >
              <Factory size={14} aria-hidden="true" />
              {staleness.isReleased ? 'Ver / Revocar' : 'Evaluar 6 Gates'}
            </button>
          </div>
        </div>
      </div>

      {/* Anticipo real (OC-013): sin este evento, el gate de liberación no pasa. */}
      <div className="lifecycle-section-card" data-testid="lifecycle-deposit-card">
        <div className="lifecycle-section-card__header">
          <div className="lifecycle-section-card__title-group">
            <UserCheck size={16} aria-hidden="true" />
            <h4 className="lifecycle-section-card__title">Anticipo (OC-013)</h4>
          </div>
          {onRecordDeposit && !showDepositForm ? (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setShowDepositForm(true)}
              data-testid="btn-record-deposit"
            >
              <Plus size={14} aria-hidden="true" />
              Registrar Anticipo
            </button>
          ) : null}
        </div>

        {latestDeposit ? (
          <p className="lifecycle-deposit-summary" data-testid="lifecycle-deposit-summary">
            Último anticipo:{' '}
            <strong>
              {latestDeposit.payload.amount.toLocaleString('es-MX')}{' '}
              {latestDeposit.payload.currency}
            </strong>{' '}
            el {new Date(latestDeposit.event.at).toLocaleString('es-MX')}
            {latestDeposit.payload.reference ? ` (ref. ${latestDeposit.payload.reference})` : ''}.
          </p>
        ) : (
          <p
            className="lifecycle-deposit-summary lifecycle-deposit-summary--empty"
            data-testid="lifecycle-deposit-summary"
          >
            Sin anticipo registrado. La liberación a producción exige este gate
            (registro con fecha real, no estimada).
          </p>
        )}

        {showDepositForm && onRecordDeposit ? (
          <div className="lifecycle-revision-form" data-testid="lifecycle-deposit-form">
            <div className="lifecycle-deposit-form__row">
              <label className="form-label" htmlFor="deposit-amount">
                Monto ({project.currency})*
              </label>
              <input
                id="deposit-amount"
                type="number"
                min="0"
                step="0.01"
                className="form-input form-input--small"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                disabled={busy}
                required
              />
              <label className="form-label" htmlFor="deposit-reference">
                Referencia
              </label>
              <input
                id="deposit-reference"
                type="text"
                className="form-input form-input--small"
                placeholder="Ej: TRANSF-0042"
                value={depositReference}
                onChange={(e) => setDepositReference(e.target.value)}
                disabled={busy}
              />
              <label className="form-label" htmlFor="deposit-note">
                Nota
              </label>
              <input
                id="deposit-note"
                type="text"
                className="form-input form-input--small"
                placeholder="Ej: Anticipo 50% acordado"
                value={depositNote}
                onChange={(e) => setDepositNote(e.target.value)}
                disabled={busy}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={handleRecordDeposit}
                disabled={busy || !Number.isFinite(Number(depositAmount)) || Number(depositAmount) <= 0}
                data-testid="btn-confirm-deposit"
              >
                Registrar
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => setShowDepositForm(false)}
                disabled={busy}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Staleness Warning */}
      {staleness.isStale && (
        <div className="lifecycle-alert lifecycle-alert--warning" data-testid="lifecycle-staleness-alert">
          <AlertTriangle size={20} className="text-warning" aria-hidden="true" />
          <div className="lifecycle-alert__content">
            <strong>Estado de Fabricación Desactualizado (Stale):</strong>
            <p>
              {staleness.reasons.map((r) => STALENESS_REASON_LABELS_ES[r] ?? r).join('. ')}.
              Se recomienda crear una Orden de Cambio o re-evaluar la liberación.
            </p>
          </div>
          <button
            type="button"
            className="btn btn--small btn--primary"
            onClick={onOpenChangeOrderModal}
          >
            Orden de Cambio
          </button>
        </div>
      )}

      {/* 2-Column Grid: Left (Revisions & Approvals), Right (Change Orders & Events) */}
      <div className="lifecycle-grid">
        {/* Left Col: Design Revisions & Multi-Role Approvals */}
        <div className="lifecycle-grid__col">
          {/* Design Revisions (OC-020) */}
          <div className="lifecycle-section-card">
            <div className="lifecycle-section-card__header">
              <div className="lifecycle-section-card__title-group">
                <Layers size={16} aria-hidden="true" />
                <h4 className="lifecycle-section-card__title">
                  Revisiones de Diseño ({revisions.length})
                </h4>
              </div>
              {onCreateRevision && !showNewRevisionForm ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => setShowNewRevisionForm(true)}
                  data-testid="btn-create-revision"
                >
                  <Plus size={14} aria-hidden="true" />
                  Nueva Revisión
                </button>
              ) : null}
            </div>

            {showNewRevisionForm && (
              <div className="lifecycle-revision-form">
                <input
                  type="text"
                  className="form-input form-input--small"
                  placeholder="Nombre de la revisión (opcional)..."
                  value={revisionName}
                  onChange={(e) => setRevisionName(e.target.value)}
                  disabled={busy}
                />
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn--primary btn--small"
                    onClick={handleCreateRevision}
                    disabled={busy}
                  >
                    Guardar Snapshot
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => setShowNewRevisionForm(false)}
                    disabled={busy}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <div className="lifecycle-revisions-list">
              {revisions.length === 0 ? (
                <p className="text-secondary text-sm">Sin revisiones registradas.</p>
              ) : (
                revisions.map((rev: DesignRevision) => (
                  <div key={rev.id} className="revision-item" data-testid={`revision-item-${rev.id}`}>
                    <div className="revision-item__header">
                      <span className="revision-item__badge">Rev {rev.revision}</span>
                      <strong className="revision-item__name">{rev.name ?? 'Revisión'}</strong>
                      <span className="revision-item__date">
                        {new Date(rev.createdAt).toLocaleDateString('es-MX')}
                      </span>
                    </div>
                    <div className="revision-item__meta">
                      <span>BOM: <code>{rev.bomFingerprint.slice(0, 10)}...</code></span>
                      <span>Por: {rev.createdBy}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Multi-Role Approvals (OC-021) */}
          <div className="lifecycle-section-card">
            <div className="lifecycle-section-card__header">
              <div className="lifecycle-section-card__title-group">
                <FileCheck size={16} aria-hidden="true" />
                <h4 className="lifecycle-section-card__title">
                  Aprobaciones Multi-Rol ({approvals.length})
                </h4>
              </div>
              {onRequestApproval && (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => onRequestApproval('customer')}
                  data-testid="btn-request-approval"
                >
                  <Plus size={14} aria-hidden="true" />
                  Solicitar
                </button>
              )}
            </div>

            <div className="lifecycle-approvals-list">
              {(['customer', 'technical', 'supervisor'] as ApprovalType[]).map((type) => {
                const app = approvals.find((a) => a.type === type);
                return (
                  <div
                    key={type}
                    className={`approval-card approval-card--${app ? app.status : 'none'}`}
                    data-testid={`approval-card-${type}`}
                  >
                    <div className="approval-card__header">
                      <div className="approval-card__title-wrap">
                        <UserCheck size={16} aria-hidden="true" />
                        <strong>{APPROVAL_TYPE_LABELS_ES[type]}</strong>
                      </div>
                      <span className={`badge badge--approval-${app?.status ?? 'pending'}`}>
                        {app ? APPROVAL_STATUS_LABELS_ES[app.status] : 'No iniciada'}
                      </span>
                    </div>

                    {app?.decidedBy && app.decidedAt ? (
                      <p className="approval-card__meta">
                        {app.status === 'approved' ? 'Aprobado' : 'Rechazado'} por {app.decidedBy} el{' '}
                        {new Date(app.decidedAt).toLocaleDateString('es-MX')}
                      </p>
                    ) : null}

                    {app && app.status === 'pending' && onDecideApproval ? (
                      <div className="approval-card__actions">
                        <button
                          type="button"
                          className="btn btn--success btn--small"
                          onClick={() => handleDecideApproval(app.id, 'approved')}
                          disabled={busy}
                        >
                          <CheckCircle size={14} aria-hidden="true" />
                          Aprobar
                        </button>
                        <button
                          type="button"
                          className="btn btn--outline-danger btn--small"
                          onClick={() => handleDecideApproval(app.id, 'rejected')}
                          disabled={busy}
                        >
                          <XCircle size={14} aria-hidden="true" />
                          Rechazar
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Col: Change Orders (OC-024) & Event Audit Stream (OC-010) */}
        <div className="lifecycle-grid__col">
          {/* Change Orders */}
          <div className="lifecycle-section-card">
            <div className="lifecycle-section-card__header">
              <div className="lifecycle-section-card__title-group">
                <FileSpreadsheet size={16} aria-hidden="true" />
                <h4 className="lifecycle-section-card__title">
                  Órdenes de Cambio ({changeOrders.length})
                </h4>
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={onOpenChangeOrderModal}
                data-testid="btn-manage-change-orders"
              >
                <Plus size={14} aria-hidden="true" />
                Gestionar
              </button>
            </div>

            <div className="lifecycle-change-orders-summary">
              {changeOrders.length === 0 ? (
                <p className="text-secondary text-sm">No hay órdenes de cambio registradas.</p>
              ) : (
                changeOrders.slice(0, 3).map((co) => (
                  <div key={co.id} className="co-summary-item" data-testid={`co-summary-${co.id}`}>
                    <div className="co-summary-item__top">
                      <span className="badge badge--neutral-subtle">CO #{co.number}</span>
                      <strong className="co-summary-item__reason">{co.reason}</strong>
                      <span className={`badge badge--co-${co.status}`}>
                        {CHANGE_ORDER_STATUS_LABELS_ES[co.status]}
                      </span>
                    </div>
                    {co.impact?.priceDelta !== undefined ? (
                      <span className="co-summary-item__impact">
                        Precio: {co.impact.priceDelta >= 0 ? '+' : ''}${co.impact.priceDelta}
                      </span>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Audit Event Trail (OC-010) */}
          <div className="lifecycle-section-card">
            <div className="lifecycle-section-card__header">
              <div className="lifecycle-section-card__title-group">
                <History size={16} aria-hidden="true" />
                <h4 className="lifecycle-section-card__title">
                  Registro de Auditoría de Eventos ({events.length})
                </h4>
              </div>
            </div>

            <div className="lifecycle-events-timeline" data-testid="lifecycle-events-timeline">
              {events.length === 0 ? (
                <p className="text-secondary text-sm">Sin eventos registrados en el lifecycle.</p>
              ) : (
                events.slice(0, 15).map((evt) => (
                  <div key={evt.id} className="timeline-event" data-testid={`timeline-event-${evt.id}`}>
                    <span className="timeline-event__dot" />
                    <div className="timeline-event__content">
                      <div className="timeline-event__header">
                        <strong className="timeline-event__type">
                          {PROJECT_EVENT_TYPE_LABELS_ES[evt.type] ?? evt.type}
                        </strong>
                        <span className="timeline-event__time">
                          {new Date(evt.at).toLocaleDateString('es-MX', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      {evt.byUserId ? (
                        <span className="timeline-event__user">Por: {evt.byUserId}</span>
                      ) : null}
                      {evt.note ? (
                        <p className="timeline-event__note">{evt.note}</p>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
