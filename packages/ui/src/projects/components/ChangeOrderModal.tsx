/**
 * ChangeOrderModal (OC-024).
 * Manages Change Orders for scope, cost, and schedule adjustments post-approval/post-release.
 */

import { useState, useId, type ReactNode } from 'react';
import {
  AlertCircle,
  CheckCircle,
  FileSpreadsheet,
  Plus,
  Send,
  X,
  XCircle,
} from 'lucide-react';
import {
  getProjectChangeOrders,
  CHANGE_ORDER_STATUS_LABELS_ES,
  type Project,
  type ChangeOrder,
  type ChangeOrderImpact,
} from '@granete/domain';

export interface ChangeOrderModalProps {
  readonly project: Project;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onCreateChangeOrder: (params: {
    reason: string;
    description?: string;
    impact?: ChangeOrderImpact;
  }) => void | Promise<void>;
  readonly onSubmitChangeOrder: (changeOrderId: string) => void | Promise<void>;
  readonly onApproveChangeOrder: (changeOrderId: string, decisionNotes?: string) => void | Promise<void>;
  readonly onRejectChangeOrder: (changeOrderId: string, reason: string) => void | Promise<void>;
}

export function ChangeOrderModal({
  project,
  isOpen,
  onClose,
  onCreateChangeOrder,
  onSubmitChangeOrder,
  onApproveChangeOrder,
  onRejectChangeOrder,
}: ChangeOrderModalProps): ReactNode {
  const [view, setView] = useState<'list' | 'create'>('list');
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [scopeDescription, setScopeDescription] = useState('');
  const [costDelta, setCostDelta] = useState<string>('');
  const [priceDelta, setPriceDelta] = useState<string>('');
  const [leadTimeDaysDelta, setLeadTimeDaysDelta] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const titleId = useId();
  const descId = useId();

  if (!isOpen) return null;

  const changeOrders = getProjectChangeOrders(project);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;

    setBusy(true);
    try {
      const impact: ChangeOrderImpact | undefined =
        costDelta || priceDelta || leadTimeDaysDelta || scopeDescription
          ? {
              costDelta: costDelta ? parseFloat(costDelta) : undefined,
              priceDelta: priceDelta ? parseFloat(priceDelta) : undefined,
              leadTimeDaysDelta: leadTimeDaysDelta ? parseInt(leadTimeDaysDelta, 10) : undefined,
              scopeDescription: scopeDescription.trim() || undefined,
            }
          : undefined;

      await onCreateChangeOrder({
        reason: reason.trim(),
        description: description.trim() || undefined,
        impact,
      });

      setReason('');
      setDescription('');
      setScopeDescription('');
      setCostDelta('');
      setPriceDelta('');
      setLeadTimeDaysDelta('');
      setView('list');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-testid="change-order-modal"
    >
      <div className="modal-content modal-content--wide">
        <div className="modal-header">
          <div className="modal-header__title-group">
            <FileSpreadsheet className="modal-header__icon" size={20} aria-hidden="true" />
            <h2 id={titleId} className="modal-title">
              Órdenes de Cambio (Change Orders — OC-024)
            </h2>
          </div>
          <button
            type="button"
            className="btn-icon btn-icon--ghost"
            onClick={onClose}
            aria-label="Cerrar modal"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body" id={descId}>
          {view === 'list' ? (
            <div className="change-orders-list-view">
              <div className="change-orders-list-view__header">
                <div>
                  <h3 className="section-subtitle">
                    Historial de Modificaciones de Alcance y Costos
                  </h3>
                  <p className="text-secondary text-sm">
                    Cualquier alteración al diseño o cotización tras la aprobación formal debe documentarse aquí.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn--primary btn--small"
                  onClick={() => setView('create')}
                  data-testid="btn-new-change-order"
                >
                  <Plus size={14} aria-hidden="true" />
                  Nueva Orden de Cambio
                </button>
              </div>

              {changeOrders.length === 0 ? (
                <div className="empty-state-box">
                  <p className="empty-state-box__text">
                    No hay órdenes de cambio registradas en este proyecto.
                  </p>
                </div>
              ) : (
                <div className="change-orders-cards">
                  {changeOrders.map((co) => (
                    <div
                      key={co.id}
                      className={`change-order-card change-order-card--${co.status}`}
                      data-testid={`change-order-card-${co.id}`}
                    >
                      <div className="change-order-card__header">
                        <div className="change-order-card__title-wrap">
                          <span className="change-order-card__number">
                            CO #{co.number}
                          </span>
                          <strong className="change-order-card__reason">
                            {co.reason}
                          </strong>
                        </div>
                        <span className={`badge badge--co-${co.status}`}>
                          {CHANGE_ORDER_STATUS_LABELS_ES[co.status]}
                        </span>
                      </div>

                      {co.description ? (
                        <p className="change-order-card__description">
                          {co.description}
                        </p>
                      ) : null}

                      {co.impact ? (
                        <div className="change-order-card__impact-grid">
                          {co.impact.priceDelta !== undefined ? (
                            <div className="impact-pill">
                              <span className="impact-pill__label">Impacto Precio:</span>
                              <strong className="impact-pill__value">
                                {co.impact.priceDelta >= 0 ? '+' : ''}${co.impact.priceDelta}
                              </strong>
                            </div>
                          ) : null}
                          {co.impact.costDelta !== undefined ? (
                            <div className="impact-pill">
                              <span className="impact-pill__label">Impacto Costo:</span>
                              <strong className="impact-pill__value">
                                {co.impact.costDelta >= 0 ? '+' : ''}${co.impact.costDelta}
                              </strong>
                            </div>
                          ) : null}
                          {co.impact.leadTimeDaysDelta !== undefined ? (
                            <div className="impact-pill">
                              <span className="impact-pill__label">Plazo:</span>
                              <strong className="impact-pill__value">
                                {co.impact.leadTimeDaysDelta >= 0 ? '+' : ''}{co.impact.leadTimeDaysDelta} días
                              </strong>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="change-order-card__meta">
                        <span>
                          Solicitado por {co.requestedBy} el {new Date(co.requestedAt).toLocaleDateString('es-MX')}
                        </span>
                        {co.decidedBy && co.decidedAt ? (
                          <span>
                            • Decidido por {co.decidedBy} el {new Date(co.decidedAt).toLocaleDateString('es-MX')}
                          </span>
                        ) : null}
                      </div>

                      <div className="change-order-card__actions">
                        {co.status === 'draft' ? (
                          <button
                            type="button"
                            className="btn btn--secondary btn--small"
                            onClick={() => onSubmitChangeOrder(co.id)}
                            disabled={busy}
                          >
                            <Send size={14} aria-hidden="true" />
                            Enviar a Aprobación
                          </button>
                        ) : null}

                        {co.status === 'submitted' ? (
                          <>
                            <button
                              type="button"
                              className="btn btn--success btn--small"
                              onClick={() => onApproveChangeOrder(co.id)}
                              disabled={busy}
                            >
                              <CheckCircle size={14} aria-hidden="true" />
                              Aprobar y Versionar
                            </button>
                            <button
                              type="button"
                              className="btn btn--outline-danger btn--small"
                              onClick={() => onRejectChangeOrder(co.id, 'Rechazado por taller/cliente')}
                              disabled={busy}
                            >
                              <XCircle size={14} aria-hidden="true" />
                              Rechazar
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleCreate} className="change-order-form">
              <div className="form-group">
                <label htmlFor="co-reason" className="form-label">
                  Motivo del cambio (requerido):
                </label>
                <input
                  id="co-reason"
                  type="text"
                  className="form-input"
                  placeholder="Ej: Cambio de tiradores a perfil gola negro"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="co-description" className="form-label">
                  Detalle / Justificación:
                </label>
                <textarea
                  id="co-description"
                  className="form-input form-textarea"
                  rows={2}
                  placeholder="Explicación detallada de la solicitud..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="co-scope" className="form-label">
                  Descripción del alcance modificado:
                </label>
                <textarea
                  id="co-scope"
                  className="form-input form-textarea"
                  rows={2}
                  placeholder="Detalle de piezas o módulos afectados..."
                  value={scopeDescription}
                  onChange={(e) => setScopeDescription(e.target.value)}
                />
              </div>

              <div className="form-row-3">
                <div className="form-group">
                  <label htmlFor="co-price" className="form-label">
                    Delta Precio ($):
                  </label>
                  <input
                    id="co-price"
                    type="number"
                    step="0.01"
                    className="form-input"
                    placeholder="Ej: 500"
                    value={priceDelta}
                    onChange={(e) => setPriceDelta(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="co-cost" className="form-label">
                    Delta Costo ($):
                  </label>
                  <input
                    id="co-cost"
                    type="number"
                    step="0.01"
                    className="form-input"
                    placeholder="Ej: 320"
                    value={costDelta}
                    onChange={(e) => setCostDelta(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="co-leadtime" className="form-label">
                    Delta Plazo (días):
                  </label>
                  <input
                    id="co-leadtime"
                    type="number"
                    className="form-input"
                    placeholder="Ej: 3"
                    value={leadTimeDaysDelta}
                    onChange={(e) => setLeadTimeDaysDelta(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer" style={{ padding: '1rem 0 0 0' }}>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setView('list')}
                  disabled={busy}
                >
                  Volver al Listado
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={!reason.trim() || busy}
                  data-testid="btn-submit-create-change-order"
                >
                  Guardar Orden de Cambio
                </button>
              </div>
            </form>
          )}
        </div>

        {view === 'list' ? (
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onClose}
              disabled={busy}
            >
              Cerrar
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
