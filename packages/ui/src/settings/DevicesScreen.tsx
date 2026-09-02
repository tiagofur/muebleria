import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import { GraneteApiClient, type AuthDeviceView } from '@granete/storage';
import { PageHeader, submitBusyLabel } from '../common';
import { MFAEnrollmentHint, useStepUp } from '../security';
import './settings.css';

export type DevicesScreenProps = {
  readonly baseUrl: string;
  readonly token: string;
};

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** DevicesScreen — #460 SEC-6: approval + directory of the user's own device
 * credentials. Presentational fetches follow the SalesNetworkSection pattern:
 * the generated client owns auth headers and the Idempotency-Key; success
 * only shows after the authoritative commit. */
export function DevicesScreen({ baseUrl, token }: DevicesScreenProps): ReactNode {
  const api = useMemo(() => new GraneteApiClient(baseUrl), [baseUrl]);
  // #460 SEC-7: approving a device binds a 30-day credential to this account —
  // it requires a fresh device_enrollment step-up. The challenge re-runs this
  // exact command under the SAME Idempotency-Key.
  const stepUp = useStepUp({ baseUrl, token });
  const [devices, setDevices] = useState<readonly AuthDeviceView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setReloading(true);
    setLoadError(null);
    try {
      const directory = await api.listMyDevices(token);
      setDevices(directory.devices);
    } catch {
      setLoadError('No se pudo cargar los dispositivos. Reintentá en unos segundos.');
    } finally {
      if (!silent) setReloading(false);
    }
  }, [api, token]);

  useEffect(() => {
    void load(true);
  }, [load]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) return;
    setStatus('submitting');
    setErrorMsg(null);
    try {
      const result = await stepUp.run('device_enrollment', 'aprobar el dispositivo', (key) =>
        api.approveDeviceEnrollment(token, { code: cleanCode }, key));
      if (result) {
        setStatus('success');
        setCode('');
        void load(true);
      } else {
        // Cancelled challenge or MFA enrollment required: back to idle, the
        // user decides the next step.
        setStatus('idle');
      }
    } catch (err: any) {
      setStatus('error');
      const status_ = err?.status ?? null;
      setErrorMsg(
        status_ === 409
          ? 'El código ya fue usado o expiró. Generá uno nuevo en SketchUp.'
          : status_ === 404 || status_ === 400
            ? 'Código inválido o expiró.'
            : 'Error al aprobar el dispositivo.',
      );
    }
  };

  const revoke = async (deviceId: string) => {
    setRevokingId(deviceId);
    setRevokeError(null);
    try {
      await api.revokeMyDevice(token, { device_id: deviceId });
      await load(true);
    } catch {
      setRevokeError('No se pudo revocar el dispositivo. Reintentá en unos segundos.');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <section className="catalog-page" aria-label="Dispositivos">
      <PageHeader
        title="Dispositivos Autorizados"
        subtitle="Administra los accesos de SketchUp a tu cuenta"
        icon={<Smartphone size={16} strokeWidth={1.5} />}
      />
      {stepUp.modal}
      {stepUp.enrollmentRequired ? (
        <div style={{ marginBottom: 16 }}>
          <MFAEnrollmentHint />
          <button type="button" className="btn btn--secondary" style={{ marginTop: 8 }} onClick={stepUp.dismissEnrollmentHint}>
            Cerrar aviso
          </button>
        </div>
      ) : null}

      <div className="settings-form">
        <div className="catalog-form__section">
          <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>Aprobar un nuevo dispositivo</h2>
          <p className="settings-hint">
            Ingresa el código que aparece en el plugin de Granete para SketchUp para vincularlo a tu cuenta.
          </p>
        </div>

        {status === 'success' ? (
          <div
            role="status"
            style={{ padding: 16, backgroundColor: 'var(--success-50)', border: '1px solid var(--success-200)', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 12 }}
          >
            <CheckCircle size={20} color="var(--success-700)" />
            <div style={{ color: 'var(--success-900)' }}>
              <strong>¡Dispositivo aprobado!</strong>
              <div>Ya puedes regresar a SketchUp para comenzar a usar Granete.</div>
            </div>
          </div>
        ) : null}

        {status === 'error' && errorMsg ? (
          <div role="alert" style={{ padding: 12, backgroundColor: 'var(--destructive-50)', color: 'var(--destructive-700)', borderRadius: 4, fontSize: 14 }}>
            {errorMsg}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, maxWidth: 200 }}>
            <label htmlFor="deviceCode" style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Código de vinculación</label>
            <input
              id="deviceCode"
              type="text"
              placeholder="Ej: K7M2QP"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                if (status !== 'idle') setStatus('idle');
              }}
              className="catalog-input"
              style={{ letterSpacing: 1, fontFamily: 'monospace' }}
              disabled={status === 'submitting'}
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!code.trim() || status === 'submitting'}
            >
              {submitBusyLabel(status === 'submitting', 'Aprobar', 'Aprobando...')}
            </button>
          </div>
        </form>

        <div style={{ marginTop: 8, padding: 16, backgroundColor: 'var(--surface-sunken)', borderRadius: 4, display: 'flex', gap: 12 }}>
          <ShieldCheck size={20} color="var(--text-muted)" style={{ flexShrink: 0 }} />
          <p className="settings-hint" style={{ margin: 0 }}>
            Granete utiliza credenciales seguras por dispositivo.
            Nunca compartas estos códigos. Cada instalación de SketchUp requiere su propia aprobación individual y
            podés revocarla desde esta pantalla en cualquier momento.
          </p>
        </div>

        <div className="catalog-form__section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>Dispositivos vinculados</h2>
          <button
            type="button"
            className="btn btn--secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={() => void load()}
            disabled={reloading}
          >
            <RefreshCw size={14} aria-hidden />
            {reloading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>

        {revokeError ? (
          <div role="alert" style={{ padding: 12, backgroundColor: 'var(--destructive-50)', color: 'var(--destructive-700)', borderRadius: 4, fontSize: 14 }}>
            {revokeError}
          </div>
        ) : null}

        {loadError ? (
          <div role="alert" style={{ padding: 12, backgroundColor: 'var(--destructive-50)', color: 'var(--destructive-700)', borderRadius: 4, fontSize: 14 }}>
            {loadError}
          </div>
        ) : devices === null ? (
          <p className="settings-hint" role="status">Cargando dispositivos…</p>
        ) : devices.length === 0 ? (
          <p className="settings-hint">Todavía no vinculaste ningún dispositivo. Aprobá un código para empezar.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {devices.map((device) => {
              const revoked = device.revoked_at != null;
              return (
                <li
                  key={device.id}
                  style={{ padding: 12, border: '1px solid var(--border-subtle)', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 12, opacity: revoked ? 0.7 : 1 }}
                >
                  <Smartphone size={18} color={revoked ? 'var(--text-muted)' : 'var(--brand-600)'} aria-hidden />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>
                      {device.display_name}
                      {revoked ? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · revocado</span> : null}
                    </div>
                    <div className="settings-hint" style={{ margin: 0 }}>
                      SketchUp · vinculado {formatWhen(device.created_at)} · última actividad {formatWhen(device.last_seen_at)}
                    </div>
                  </div>
                  {revoked ? null : (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => void revoke(device.id)}
                      disabled={revokingId != null}
                    >
                      {revokingId === device.id ? 'Revocando…' : 'Revocar'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
