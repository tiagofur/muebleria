/**
 * ResetPasswordScreen — consumo del enlace one-time de restablecimiento (#1178).
 * Se accede con `?token=...` desde el enlace que emite el administrador del
 * taller (o, más adelante, el correo). Al confirmar, el servidor invalida el
 * token y revoca todas las sesiones previas de la cuenta; el usuario vuelve a
 * iniciar sesión con la nueva contraseña.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyRound, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { GraneteApiClient, GraneteApiError } from '@granete/storage';
import './acceptInvitation.css';

export interface ResetPasswordScreenProps {
  readonly token: string;
  readonly baseUrl: string;
  /** #460 SEC-4B: fetch credenciado en Web; sin inyección usa el global. */
  readonly fetchImpl?: typeof fetch;
  /** Se invoca tras el cambio exitoso (todas las sesiones previas murieron). */
  readonly onCompleted: () => void;
  readonly onBackToLogin?: () => void;
}

const RESET_ERROR_MESSAGE =
  'El enlace de restablecimiento no es válido o ya fue utilizado. Pedile a tu administrador uno nuevo.';

function resetErrorMessage(error: unknown): string {
  if (error instanceof GraneteApiError) {
    if (error.code === 'PASSWORD_RESET_TOKEN_INVALID') {
      return RESET_ERROR_MESSAGE;
    }
    if (error.code === 'BAD_REQUEST' && /política/.test(error.message)) {
      return error.message;
    }
  }
  return 'No se pudo actualizar la contraseña. Revisá tu conexión y probá de nuevo.';
}

export function ResetPasswordScreen({
  token,
  baseUrl,
  fetchImpl,
  onCompleted,
  onBackToLogin,
}: ResetPasswordScreenProps): ReactNode {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || !confirm) {
      setError('Completá la nueva contraseña y su confirmación.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await new GraneteApiClient(baseUrl, fetchImpl).confirmPasswordReset({
        token: token.trim(),
        new_password: password,
      });
      setCompleted(true);
    } catch (err) {
      setError(resetErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="accept-invitation-screen">
      <section className="accept-invitation-card" aria-labelledby="reset-title">
        <div className="accept-invitation-card__header">
          <div className="accept-invitation-card__mark" aria-hidden="true">
            <KeyRound size={28} strokeWidth={1.5} />
          </div>
          <h1 id="reset-title" className="accept-invitation-card__title">
            Nueva contraseña
          </h1>
          <p className="accept-invitation-card__subtitle">
            Definí tu nueva contraseña. Al confirmar, todas las sesiones abiertas de tu
            cuenta se cierran por seguridad.
          </p>
        </div>

        {completed ? (
          <>
            <div role="status" className="accept-invitation-alert accept-invitation-alert--error" style={{ background: 'var(--surface-muted)' }}>
              Tu contraseña se actualizó. Ya podés iniciar sesión con la nueva.
            </div>
            <div className="accept-invitation-card__footer accept-invitation-card__footer--actions">
              <button type="button" className="btn btn--primary btn--small" onClick={onCompleted}>
                Ir a iniciar sesión
              </button>
            </div>
          </>
        ) : (
          <form className="accept-invitation-form" onSubmit={handleSubmit}>
            {error && (
              <div ref={errorRef} role="alert" tabIndex={-1} className="accept-invitation-alert accept-invitation-alert--error">
                {error}
              </div>
            )}
            <div>
              <label className="label" htmlFor="reset-password">
                Nueva contraseña *
              </label>
              <div className="accept-invitation-field">
                <input
                  id="reset-password"
                  type={showPassword ? 'text' : 'password'}
                  className="input accept-invitation-input--with-toggle"
                  required
                  autoComplete="new-password"
                  placeholder="Mínimo 8 caracteres, con letras y números"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby={error ? 'reset-error' : undefined}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="accept-invitation-field__toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  disabled={loading}
                >
                  {showPassword ? <EyeOff size={16} strokeWidth={1.5} aria-hidden="true" /> : <Eye size={16} strokeWidth={1.5} aria-hidden="true" />}
                </button>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="reset-confirm">
                Confirmar contraseña *
              </label>
              <div className="accept-invitation-field">
                <input
                  id="reset-confirm"
                  type={showPassword ? 'text' : 'password'}
                  className="input"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  aria-describedby={error ? 'reset-error' : undefined}
                  disabled={loading}
                />
              </div>
              <p className="accept-invitation-form__hint">Mínimo 8 caracteres, con al menos una letra y un número.</p>
            </div>
            <button type="submit" className="btn btn--primary" disabled={loading || !password || !confirm} aria-busy={loading}>
              {loading ? 'Actualizando…' : 'Actualizar contraseña'}
            </button>
          </form>
        )}

        {!completed && onBackToLogin && (
          <div className="accept-invitation-card__footer">
            <button type="button" className="btn btn--ghost btn--small accept-invitation-card__back" onClick={onBackToLogin}>
              <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" /> Volver al inicio de sesión
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
