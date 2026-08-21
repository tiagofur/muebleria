/**
 * ProductionReleaseModal (OC-022).
 * Formally evaluates the 6 release gates and executes/revokes production release.
 */

import { useState, useId, type ReactNode } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Factory,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  evaluateProductionReleaseGates,
  canReleaseToProduction,
  RELEASE_CHECK_LABELS_ES,
  type Project,
  type ProductionReleaseOptions,
} from '@muebles/domain';

export interface ProductionReleaseModalProps {
  readonly project: Project;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onRelease: (note?: string, options?: ProductionReleaseOptions) => void | Promise<void>;
  readonly onRevoke: (reason: string) => void | Promise<void>;
  readonly currentUserId?: string;
}

export function ProductionReleaseModal({
  project,
  isOpen,
  onClose,
  onRelease,
  onRevoke,
}: ProductionReleaseModalProps): ReactNode {
  const [note, setNote] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [isRevoking, setIsRevoking] = useState(false);
  const [requireSurvey, setRequireSurvey] = useState(true);
  const [busy, setBusy] = useState(false);

  const titleId = useId();
  const descId = useId();

  if (!isOpen) return null;

  const currentRelease = project.productionRelease;
  const isCurrentlyReleased = Boolean(currentRelease && !project.events?.some(
    (e) => e.type === 'production_release_revoked' && e.at > currentRelease.releasedAt
  ));

  const checks = evaluateProductionReleaseGates(project, { requireSurvey });
  const releaseStatus = canReleaseToProduction(project, { requireSurvey });

  const handleRelease = async () => {
    if (!releaseStatus.allowed) return;
    setBusy(true);
    try {
      await onRelease(note.trim() || undefined, { requireSurvey });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeReason.trim()) return;
    setBusy(true);
    try {
      await onRevoke(revokeReason.trim());
      setIsRevoking(false);
      onClose();
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
      data-testid="production-release-modal"
    >
      <div className="modal-content modal-content--wide">
        <div className="modal-header">
          <div className="modal-header__title-group">
            <Factory className="modal-header__icon" size={20} aria-hidden="true" />
            <h2 id={titleId} className="modal-title">
              Liberación Formal a Producción (Production Release)
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
          {isCurrentlyReleased && currentRelease ? (
            <div className="release-current-badge">
              <div className="release-current-badge__header">
                <ShieldCheck size={24} className="text-success" aria-hidden="true" />
                <div>
                  <h3 className="release-current-badge__title">
                    Proyecto Liberado a Taller (Revisión {currentRelease.designRevisionId})
                  </h3>
                  <p className="release-current-badge__meta">
                    Liberado el {new Date(currentRelease.releasedAt).toLocaleString('es-MX')} por {currentRelease.releasedBy}.
                    <br />
                    BOM Fingerprint: <code>{currentRelease.bomFingerprint}</code> (Versión {currentRelease.projectVersion})
                  </p>
                </div>
              </div>

              {isRevoking ? (
                <div className="release-revoke-form">
                  <label htmlFor="revoke-reason" className="form-label">
                    Motivo de la revocación (obligatorio):
                  </label>
                  <textarea
                    id="revoke-reason"
                    className="form-input form-textarea"
                    rows={3}
                    placeholder="Ej: Cambio de materiales solicitado por el cliente post-aprobación..."
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    required
                  />
                  <div className="modal-footer" style={{ padding: '0.75rem 0 0 0' }}>
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={() => setIsRevoking(false)}
                      disabled={busy}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger btn--small"
                      onClick={handleRevoke}
                      disabled={!revokeReason.trim() || busy}
                    >
                      Confirmar Revocación
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn--outline-danger btn--small"
                    onClick={() => setIsRevoking(true)}
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                    Revocar Liberación
                  </button>
                </div>
              )}
            </div>
          ) : null}

          <div className="release-gates-section">
            <h3 className="release-gates-section__title">
              Evaluación de las 6 Compuertas de Calidad (Release Gates)
            </h3>
            <p className="release-gates-section__subtitle">
              Para garantizar que no se corten piezas con datos obsoletos o incompletos, todas las compuertas obligatorias deben cumplirse.
            </p>

            <div className="release-gates-list">
              {checks.map((check) => {
                const label = RELEASE_CHECK_LABELS_ES[check.code] ?? check.label;
                return (
                  <div
                    key={check.code}
                    className={`release-gate-item ${
                      check.passed
                        ? 'release-gate-item--passed'
                        : check.required
                          ? 'release-gate-item--failed'
                          : 'release-gate-item--warning'
                    }`}
                    data-testid={`gate-check-${check.code}`}
                  >
                    <div className="release-gate-item__icon">
                      {check.passed ? (
                        <CheckCircle2 size={18} className="text-success" aria-hidden="true" />
                      ) : check.required ? (
                        <AlertCircle size={18} className="text-danger" aria-hidden="true" />
                      ) : (
                        <AlertCircle size={18} className="text-warning" aria-hidden="true" />
                      )}
                    </div>
                    <div className="release-gate-item__info">
                      <div className="release-gate-item__title-row">
                        <strong className="release-gate-item__name">{label}</strong>
                        {check.required ? (
                          <span className="badge badge--danger-subtle">Requerido</span>
                        ) : (
                          <span className="badge badge--neutral-subtle">Opcional</span>
                        )}
                      </div>
                      {check.details ? (
                        <p className="release-gate-item__details">{check.details}</p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="release-options-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={requireSurvey}
                  onChange={(e) => setRequireSurvey(e.target.checked)}
                />
                Exigir relevamiento en sitio verificado (Survey verified)
              </label>
            </div>

            {!isCurrentlyReleased && (
              <div className="release-notes-field">
                <label htmlFor="release-note" className="form-label">
                  Notas de liberación (opcional):
                </label>
                <input
                  id="release-note"
                  type="text"
                  className="form-input"
                  placeholder="Ej: Aprobado por cliente y listo para optimizar corte..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cerrar
          </button>
          {!isCurrentlyReleased && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleRelease}
              disabled={!releaseStatus.allowed || busy}
              data-testid="btn-confirm-production-release"
            >
              <ShieldCheck size={16} aria-hidden="true" />
              Liberar a Producción
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
