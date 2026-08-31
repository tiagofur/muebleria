import { useEffect, useState, type ReactNode } from 'react';
import {
  GraneteApiClient,
  GraneteApiError,
  type OrganizationOffboardingPreview,
  type OrganizationReadiness,
  type PlatformOrganization,
} from '@granete/storage';
import { Modal, PageLoading } from '../common';

type Props = {
  readonly api: GraneteApiClient;
  readonly token: string;
  readonly organization: PlatformOrganization;
  readonly onUpdated: (organization: PlatformOrganization) => void;
  readonly onReadiness: (readiness: OrganizationReadiness | null) => void;
  readonly onReload: () => Promise<void>;
};

const STATUS_COPY: Record<PlatformOrganization['status'], string> = {
  provisioning: 'Aprovisionamiento en curso. Todavía no puede operar.',
  provisioning_failed: 'El aprovisionamiento falló. Revisá los controles antes de continuar.',
  active: 'Organización habilitada para operar.',
  suspended: 'Acceso operativo suspendido. El historial permanece disponible.',
  offboarding: 'Cierre en curso. Deben resolverse los bloqueos antes de terminar.',
  terminated: 'Organización terminada. No admite nuevas operaciones.',
};

const isConflict = (error: unknown) =>
  error instanceof GraneteApiError && [
    'VERSION_CONFLICT',
    'ORGANIZATION_STATUS_CONFLICT',
    'ORGANIZATION_OFFBOARDING_BLOCKED',
    'IMPACT_VERSION_CONFLICT',
  ].includes(error.code);

export function OrganizationLifecyclePanel({ api, token, organization, onUpdated, onReadiness, onReload }: Props): ReactNode {
  const [open, setOpen] = useState(false);
  const [readiness, setReadiness] = useState<OrganizationReadiness | null>(null);
  const [preview, setPreview] = useState<OrganizationOffboardingPreview | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const loadReadiness = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getOrganizationReadiness(token, organization.id);
      setReadiness(next);
      onReadiness(next);
    } catch {
      setReadiness(null);
      onReadiness(null);
      setError('No se pudo comprobar si la organización está lista. Volvé a intentarlo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReadiness();
  }, [api, token, organization.id]);

  const fail = (cause: unknown) => {
    const stale = isConflict(cause);
    setConflict(stale);
    setError(stale
      ? 'El estado cambió mientras trabajabas. Recargá antes de volver a intentar.'
      : cause instanceof GraneteApiError ? cause.payload.message : 'No se pudo completar la acción.');
  };

  const runLifecycle = async (action: 'suspend' | 'reactivate') => {
    if (reason.trim().length < 4) return;
    setSubmitting(true);
    setError(null);
    setConflict(false);
    try {
      const response = action === 'suspend'
        ? await api.suspendOrganization(token, organization.id, organization.version, { reason: reason.trim() })
        : await api.reactivateOrganization(token, organization.id, organization.version, { reason: reason.trim() });
      onUpdated(response.organization);
      setReason('');
      if (response.readiness) {
        setReadiness(response.readiness);
        onReadiness(response.readiness);
      } else {
        try {
          const next = await api.getOrganizationReadiness(token, organization.id);
          setReadiness(next);
          onReadiness(next);
        } catch {
          setError('Cambio guardado. No se pudo actualizar la preparación; recargá para comprobarla.');
        }
      }
    } catch (cause) {
      fail(cause);
    } finally {
      setSubmitting(false);
    }
  };

  const loadPreview = async () => {
    setSubmitting(true);
    setError(null);
    try {
      setPreview(await api.previewOrganizationOffboarding(token, organization.id));
    } catch (cause) {
      fail(cause);
    } finally {
      setSubmitting(false);
    }
  };

  const commitOffboarding = async () => {
    if (!preview || preview.blockers.length > 0 || reason.trim().length < 4) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = { reason: reason.trim(), impact_version: preview.impact_version };
      const response = organization.status === 'offboarding' || organization.status === 'provisioning_failed'
        ? await api.terminateOrganization(token, organization.id, preview.organization_version, body)
        : await api.beginOrganizationOffboarding(token, organization.id, preview.organization_version, body);
      onUpdated(response.organization);
      setPreview(null);
      setReason('');
      try {
        const next = await api.getOrganizationReadiness(token, organization.id);
        setReadiness(next);
        onReadiness(next);
      } catch {
        setError('Cambio guardado. No se pudo actualizar la preparación; recargá para comprobarla.');
      }
    } catch (cause) {
      fail(cause);
    } finally {
      setSubmitting(false);
    }
  };

  const canPreview = ['active', 'suspended', 'offboarding', 'provisioning_failed'].includes(organization.status);
  const terminalAction = organization.status === 'offboarding' || organization.status === 'provisioning_failed';
  const statusCopy = organization.status === 'active'
    ? readiness === null
      ? 'Preparación sin verificar. No se puede confirmar que esté habilitada para operar.'
      : readiness.ready ? STATUS_COPY.active : 'Preparación incompleta. El servidor informa que todavía no está lista para operar.'
    : STATUS_COPY[organization.status];

  const reloadConflict = async () => {
    const refreshPreview = preview !== null;
    setPreview(null);
    setSubmitting(true);
    try {
      await onReload();
      await loadReadiness();
      if (refreshPreview) setPreview(await api.previewOrganizationOffboarding(token, organization.id));
      setConflict(false);
      setError(null);
    } catch {
      setError('No se pudo recargar el estado autoritativo. Volvé a intentar.');
    } finally {
      setSubmitting(false);
    }
  };

  return <>
    <button type="button" className="btn btn--secondary btn--sm" onClick={() => setOpen(true)}>
      Estado y ciclo de vida
    </button>
    <Modal open={open} onClose={() => setOpen(false)} title={`Estado de ${organization.name}`} size="md">
      <div className="platform-form">
        <div role="status" aria-live="polite" className={`platform-banner-info platform-lifecycle--${organization.status}`}>
          <strong>{statusCopy}</strong>
        </div>

        {loading ? <PageLoading label="Comprobando preparación..." /> : readiness ? (
          <section aria-labelledby={`readiness-${organization.id}`}>
            <h3 id={`readiness-${organization.id}`} className="platform-card__title">
              {readiness.ready ? 'Lista para operar' : 'No lista para operar'}
            </h3>
            <ul>
              {readiness.checks.map((check) => <li key={check.code}>
                <strong>{check.ready ? 'Listo' : check.blocking ? 'Bloqueado' : 'Pendiente'}:</strong> {check.message}
              </li>)}
            </ul>
          </section>
        ) : null}

        {error && <div role="alert" className="platform-modal-error">
          <span>{error}</span>
          {conflict ? <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reloadConflict()}>Recargar estado</button> : null}
        </div>}

        {canPreview ? <div className="platform-form-group">
          <label className="platform-label" htmlFor={`lifecycle-reason-${organization.id}`}>Motivo (mínimo 4 caracteres) *</label>
          <textarea id={`lifecycle-reason-${organization.id}`} className="platform-textarea" value={reason} onChange={(event) => setReason(event.target.value)} />
        </div> : null}

        {preview ? <section aria-label="Impacto del cierre">
          {preview.blockers.length > 0 ? <div role="alert" className="platform-modal-error">
            El cierre está bloqueado. Resolvé estas responsabilidades y actualizá la vista.
          </div> : <p className="platform-help-text">No hay bloqueos autoritativos para continuar.</p>}
          <ul>{[...preview.blockers, ...preview.warnings].map((item) => <li key={item.code}>{item.message} ({item.count})</li>)}</ul>
        </section> : null}

        {organization.status === 'provisioning_failed' ? <p className="platform-help-text">
          El contrato actual no expone un comando de reintento. Sólo permite revisar una terminación segura.
        </p> : null}

        <div className="platform-modal-actions">
          {organization.status === 'active' ? <button type="button" className="btn btn--secondary" disabled={submitting || reason.trim().length < 4} onClick={() => void runLifecycle('suspend')}>Suspender</button> : null}
          {organization.status === 'suspended' ? <button type="button" className="btn btn--primary" disabled={submitting || reason.trim().length < 4} onClick={() => void runLifecycle('reactivate')}>Reactivar</button> : null}
          {canPreview && !preview ? <button type="button" className="btn btn--secondary" disabled={submitting} onClick={() => void loadPreview()}>Revisar {terminalAction ? 'terminación' : 'cierre'}</button> : null}
          {preview ? <button type="button" className="btn btn--secondary" disabled={submitting || preview.blockers.length > 0 || reason.trim().length < 4} onClick={() => void commitOffboarding()}>{terminalAction ? 'Terminar organización' : 'Iniciar cierre'}</button> : null}
        </div>
      </div>
    </Modal>
  </>;
}
