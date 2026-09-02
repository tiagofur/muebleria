/**
 * SecurityScreen — #460 SEC-7: MFA management for the signed-in user.
 *
 * Enrollment: begin → the otpauth:// provisioning URI arrives ONCE and is
 * rendered as a QR in memory (nothing touches localStorage/sessionStorage/
 * IndexedDB) → the user types the current TOTP → the factor is enabled and
 * the recovery codes are shown exactly once. Existing secrets are never
 * re-displayed. Removing the last factor and regenerating recovery codes
 * require a fresh security_admin step-up through the same challenge modal
 * used by every sensitive command.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { Copy, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { GraneteApiClient, type MFAFactorView } from '@granete/storage';
import { PageHeader, submitBusyLabel } from '../common';
import { MFAEnrollmentHint, useStepUp } from './stepUp';
import '../settings/settings.css';

export type SecurityScreenProps = {
  readonly baseUrl: string;
  readonly token: string;
};

type Enrollment =
  | { readonly phase: 'qr'; readonly factorId: string; readonly uri: string; readonly expiresAt: string }
  | { readonly phase: 'verify'; readonly factorId: string; readonly uri: string; readonly expiresAt: string };

type RecoveryCodes = ReadonlyArray<string>;

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function SecurityScreen({ baseUrl, token }: SecurityScreenProps): ReactNode {
  const api = useMemo(() => new GraneteApiClient(baseUrl), [baseUrl]);
  const stepUp = useStepUp({ baseUrl, token });
  const [factors, setFactors] = useState<readonly MFAFactorView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [beginBusy, setBeginBusy] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<RecoveryCodes | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [managementError, setManagementError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const directory = await api.listMFAFactors(token);
      setFactors(directory.factors);
    } catch {
      setLoadError('No se pudo cargar la configuración de seguridad. Reintentá en unos segundos.');
    }
  }, [api, token]);

  useEffect(() => {
    void load();
  }, [load]);

  // The QR is derived in memory from the one-time URI; it never persists.
  useEffect(() => {
    if (!enrollment) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(enrollment.uri, { errorCorrectionLevel: 'M', margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enrollment]);

  // Manual entry key for users who cannot scan the QR — same one-time window,
  // same in-memory lifecycle.
  const manualSecret = useMemo(() => {
    if (!enrollment) return '';
    try {
      const parsed = new URL(enrollment.uri);
      return parsed.searchParams.get('secret') ?? '';
    } catch {
      return '';
    }
  }, [enrollment]);

  const begin = async () => {
    setBeginBusy(true);
    setManagementError(null);
    setVerifyError(null);
    try {
      const begun = await stepUp.run('security_admin', 'agregar una app de autenticación', () =>
        api.beginMFAEnrollment(token, { label: 'App de autenticación' })
      );
      if (begun) {
        setEnrollment({ phase: 'qr', factorId: begun.factor_id, uri: begun.provisioning_uri, expiresAt: begun.expires_at });
        setVerifyCode('');
      }
    } catch {
      setManagementError('No se pudo iniciar la configuración. Reintentá en unos segundos.');
    } finally {
      setBeginBusy(false);
    }
  };

  const confirmEnrollment = async (e: FormEvent) => {
    e.preventDefault();
    if (!enrollment || verifyBusy) return;
    const clean = verifyCode.trim();
    if (clean.length !== 6) {
      setVerifyError('Ingresá el código completo de 6 dígitos.');
      return;
    }
    setVerifyBusy(true);
    setVerifyError(null);
    try {
      const verified = await stepUp.run('security_admin', 'activar la app de autenticación', () =>
        api.verifyMFAEnrollment(token, enrollment.factorId, { code: clean })
      );
      if (verified) {
        setEnrollment(null);
        setVerifyCode('');
        setRecoveryCodes(verified.recovery_codes);
        await load();
      }
    } catch (err: any) {
      const code = err?.code ?? null;
      if (code === 'MFA_INVALID') {
        setVerifyError('Código inválido. Revisá que tu app muestre la cuenta "Granete" y probá de nuevo.');
      } else if (code === 'MFA_ENROLLMENT_EXPIRED') {
        setVerifyError('La configuración expiró por inactividad. Volvé a empezar.');
        setEnrollment(null);
      } else {
        setVerifyError('No se pudo verificar el código. Reintentá en unos segundos.');
      }
    } finally {
      setVerifyBusy(false);
    }
  };

  const regenerate = async () => {
    setRecoveryBusy(true);
    setManagementError(null);
    try {
      const result = await stepUp.run('security_admin', 'regenerar tus códigos de recuperación', (key) =>
        api.regenerateMFARecoveryCodes(token, key));
      if (result) {
        setRecoveryCodes(result.recovery_codes);
        await load();
      }
    } catch {
      setManagementError('No se pudo regenerar los códigos. Reintentá en unos segundos.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const removeFactor = async (factorId: string) => {
    setRemovingId(factorId);
    setManagementError(null);
    try {
      const removed = await stepUp.run('security_admin', 'eliminar este factor de autenticación', (key) =>
        api.removeMFAFactor(token, factorId, key));
      if (removed) await load();
    } catch {
      setManagementError('No se pudo eliminar el factor. Reintentá en unos segundos.');
    } finally {
      setRemovingId(null);
    }
  };

  const enabled = factors?.filter((f) => f.status === 'enabled') ?? [];
  const hasFactors = enabled.length > 0;
  const copyCodes = async () => {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    } catch {
      // Clipboard may be unavailable; the codes remain readable on screen.
    }
  };

  return (
    <section className="catalog-page" aria-label="Seguridad">
      <PageHeader
        title="Seguridad de la cuenta"
        subtitle="Autenticación en dos pasos y códigos de recuperación"
        icon={<ShieldCheck size={16} strokeWidth={1.5} />}
      />
      {stepUp.modal}

      <div className="settings-form">
        {stepUp.enrollmentRequired ? (
          <div style={{ marginBottom: 16 }}>
            <MFAEnrollmentHint />
            <button type="button" className="btn btn--secondary" style={{ marginTop: 8 }} onClick={stepUp.dismissEnrollmentHint}>
              Cerrar aviso
            </button>
          </div>
        ) : null}

        {managementError ? (
          <div role="alert" style={{ padding: 12, backgroundColor: 'var(--destructive-50)', color: 'var(--destructive-700)', borderRadius: 4, fontSize: 14, marginBottom: 16 }}>
            {managementError}
          </div>
        ) : null}
        {loadError ? (
          <div role="alert" style={{ padding: 12, backgroundColor: 'var(--destructive-50)', color: 'var(--destructive-700)', borderRadius: 4, fontSize: 14, marginBottom: 16 }}>
            {loadError}
          </div>
        ) : null}

        {recoveryCodes ? (
          <div
            data-testid="recovery-codes-panel"
            className="catalog-form__section"
            style={{ border: '1px solid var(--warning-200, #fde68a)', backgroundColor: 'var(--warning-50, #fffbeb)' }}
          >
            <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>Códigos de recuperación</h2>
            <p className="settings-hint">
              Guardalos ahora en un lugar seguro: <strong>es la única vez que se muestran</strong>. Cada código se usa una
              sola vez para confirmar tu identidad si perdés tu app de autenticación.
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 8,
                margin: '12px 0',
                fontFamily: 'monospace',
                letterSpacing: 1,
              }}
            >
              {recoveryCodes.map((code) => (
                <code key={code} data-testid="recovery-code" style={{ padding: '6px 10px', background: 'var(--surface-sunken)', borderRadius: 4 }}>
                  {code}
                </code>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn--secondary" onClick={copyCodes}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Copy size={14} /> Copiar códigos
                </span>
              </button>
              <button type="button" className="btn btn--primary" onClick={() => setRecoveryCodes(null)}>
                Ya los guardé
              </button>
            </div>
          </div>
        ) : null}

        <div className="catalog-form__section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>Autenticación en dos pasos</h2>
            {!enrollment ? (
              <button type="button" className="btn btn--primary" onClick={begin} disabled={beginBusy} data-testid="mfa-begin">
                {submitBusyLabel(beginBusy, 'Configurar app de autenticación', 'Iniciando...')}
              </button>
            ) : null}
            {hasFactors ? (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={regenerate}
                disabled={recoveryBusy}
                data-testid="mfa-regenerate"
              >
                {submitBusyLabel(recoveryBusy, 'Regenerar códigos de recuperación', 'Regenerando...')}
              </button>
            ) : null}
          </div>
          <p className="settings-hint">
            {hasFactors
              ? 'Tu cuenta requiere un código de tu app de autenticación para acciones sensibles (aprobar dispositivos, soporte, administración).'
              : 'Sin 2FA configurado, las acciones sensibles (aprobar dispositivos, soporte, administración) quedan bloqueadas.'}
          </p>
        </div>

        {enrollment ? (
          <div className="catalog-form__section" data-testid="mfa-enroll-wizard">
            <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>Configurar tu app de autenticación</h2>
            {enrollment.phase === 'qr' ? (
              <>
                <p className="settings-hint">
                  Escaneá este código con tu app (Google Authenticator, Authy, 1Password, Aegis…). El código de
                  configuración se muestra <strong>una sola vez</strong>.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="Código QR de configuración de autenticación"
                      data-testid="mfa-qr"
                      width={192}
                      height={192}
                      style={{ borderRadius: 8, border: '1px solid var(--border-subtle)' }}
                    />
                  ) : (
                    <p className="settings-hint">Generando código QR…</p>
                  )}
                </div>
                <details style={{ marginBottom: 12 }}>
                  <summary className="settings-hint" style={{ cursor: 'pointer' }}>
                    ¿No podés escanear el código?
                  </summary>
                  <p className="settings-hint" style={{ margin: '8px 0 0' }}>
                    Ingresá esta clave manualmente en tu app (tipo: basada en tiempo, 6 dígitos, 30 segundos):
                  </p>
                  <code
                    data-testid="mfa-manual-secret"
                    style={{ display: 'block', marginTop: 6, padding: '6px 10px', background: 'var(--surface-sunken)', borderRadius: 4, fontFamily: 'monospace', wordBreak: 'break-all' }}
                  >
                    {manualSecret}
                  </code>
                </details>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setEnrollment({ ...enrollment, phase: 'verify' })}
                >
                  Ya lo escaneé
                </button>
              </>
            ) : (
              <form onSubmit={confirmEnrollment} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, maxWidth: 220 }}>
                  <label htmlFor="mfaVerifyCode" style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                    Código de 6 dígitos
                  </label>
                  <input
                    id="mfaVerifyCode"
                    data-testid="mfa-verify-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="catalog-input"
                    style={{ letterSpacing: 2, fontFamily: 'monospace' }}
                    value={verifyCode}
                    maxLength={7}
                    spellCheck={false}
                    disabled={verifyBusy}
                    onChange={(e) => {
                      setVerifyCode(e.target.value.replace(/\D/g, ''));
                      if (verifyError) setVerifyError(null);
                    }}
                  />
                </div>
                <button type="submit" className="btn btn--primary" disabled={verifyBusy || verifyCode.length !== 6}>
                  {submitBusyLabel(verifyBusy, 'Verificar y activar', 'Verificando...')}
                </button>
                <button type="button" className="btn btn--secondary" onClick={() => setEnrollment(null)} disabled={verifyBusy}>
                  Cancelar
                </button>
                {verifyError ? (
                  <p role="alert" data-testid="mfa-verify-error" style={{ color: 'var(--destructive-700)', fontSize: 13, margin: 0, width: '100%' }}>
                    {verifyError}
                  </p>
                ) : null}
              </form>
            )}
          </div>
        ) : null}

        <div className="catalog-form__section">
          <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>Factores configurados</h2>
          {factors === null ? (
            <p className="settings-hint">Cargando…</p>
          ) : factors.length === 0 ? (
            <p className="settings-hint" data-testid="mfa-empty">
              Todavía no configuraste autenticación en dos pasos.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {factors.map((factor) => (
                <li
                  key={factor.id}
                  data-testid="mfa-factor-row"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <KeyRound size={16} color="var(--text-muted)" />
                    <div>
                      <div style={{ fontWeight: 500 }}>
                        {factor.status === 'enabled' ? 'App de autenticación' : 'Configuración en curso'}
                        {factor.label ? ` · ${factor.label}` : ''}
                      </div>
                      <div className="settings-hint" style={{ margin: 0 }}>
                        {factor.status === 'enabled'
                          ? `Activa desde ${formatWhen(factor.enabled_at)} · último uso ${formatWhen(factor.last_used_at)}`
                          : `Expira ${formatWhen(factor.pending_expires_at)}`}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    data-testid="mfa-remove-factor"
                    disabled={removingId === factor.id}
                    onClick={() => removeFactor(factor.id)}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Trash2 size={14} /> {removingId === factor.id ? 'Eliminando...' : 'Eliminar'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
