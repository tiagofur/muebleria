/**
 * AcceptInvitationScreen — Aceptación pública de invitación a un taller (F172 / #326).
 * Se accede con `?token=...`. Si el usuario ya existe ingresa su contraseña;
 * si es nuevo define contraseña (y nombre opcional).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ShieldCheck, UserCheck, ArrowLeft, Lock, User } from 'lucide-react';
import { GraneteApiClient, GraneteApiError, type ApiErrorCode, type LoginResponse } from '@granete/storage';
import './acceptInvitation.css';

export interface AcceptInvitationScreenProps {
  readonly token: string;
  readonly baseUrl: string;
  /**
   * #460 SEC-4B: la Web inyecta un fetch con `credentials: 'include'` para
   * que el browser guarde la cookie HttpOnly del refresh (Set-Cookie). Sin
   * inyección usa el fetch global (compatibilidad con otros hosts).
   */
  readonly fetchImpl?: typeof fetch;
  readonly onAccepted: (authResult: LoginResponse) => void;
  readonly onBackToLogin?: () => void;
}

function invitationErrorMessage(error: unknown): string {
  if (!(error instanceof GraneteApiError)) {
    return error instanceof Error ? error.message : 'No se pudo aceptar la invitación';
  }
  const messages: Partial<Record<ApiErrorCode, string>> = {
    INVITATION_EXPIRED: 'Esta invitación venció. Pedile al administrador que la reenvíe.',
    INVITATION_REVOKED: 'Esta invitación fue revocada. Pedile una nueva al administrador.',
    INVITATION_TOKEN_ROTATED: 'Este enlace fue reemplazado por uno más reciente. Usá el último que recibiste.',
    INVITATION_ALREADY_USED: 'Esta invitación ya fue aceptada. Iniciá sesión con tu cuenta.',
    ACCOUNT_DISABLED: 'Tu cuenta está deshabilitada. Contactá al administrador de plataforma.',
    UNAUTHORIZED: 'La contraseña no coincide con tu cuenta existente.',
  };
  return messages[error.code] ?? error.message;
}

export function AcceptInvitationScreen({
  token,
  baseUrl,
  fetchImpl,
  onAccepted,
  onBackToLogin,
}: AcceptInvitationScreenProps): ReactNode {
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('La contraseña es requerida');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const authData = await new GraneteApiClient(baseUrl, fetchImpl).acceptInvitation({
        token: token.trim(), password, ...(name.trim() ? { name: name.trim() } : {}),
      });
      onAccepted(authData);
    } catch (err) {
      setError(invitationErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="accept-invitation-screen">
      <section className="accept-invitation-card" aria-labelledby="invitation-title">
        <div className="accept-invitation-card__header">
          <div className="accept-invitation-card__mark" aria-hidden="true">
            <ShieldCheck size={28} strokeWidth={1.5} />
          </div>
          <h1 id="invitation-title" className="accept-invitation-card__title">
            Unirte al equipo
          </h1>
          <p className="accept-invitation-card__subtitle">
            Fuiste invitado a colaborar en un taller de Granete. Completá tus datos para acceder.
          </p>
        </div>

        {error && (
          <div
            ref={errorRef}
            id="invitation-error"
            role="alert"
            tabIndex={-1}
            className="accept-invitation-alert accept-invitation-alert--error"
          >
            {error}
          </div>
        )}

        <form className="accept-invitation-form" onSubmit={handleSubmit}>
          <div>
            <label className="label" htmlFor="inv-name">
              Nombre completo (opcional si ya tenés cuenta)
            </label>
            <div className="accept-invitation-field">
              <User
                size={16}
                strokeWidth={1.5}
                className="accept-invitation-field__icon"
                aria-hidden="true"
              />
              <input
                id="inv-name"
                type="text"
                className="input"
                placeholder="Tu nombre y apellido"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-describedby={error ? 'invitation-error' : undefined}
                disabled={loading}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="inv-password">
              Contraseña *
            </label>
            <div className="accept-invitation-field">
              <Lock
                size={16}
                strokeWidth={1.5}
                className="accept-invitation-field__icon"
                aria-hidden="true"
              />
              <input
                id="inv-password"
                type="password"
                className="input"
                required
                placeholder="Tu contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby={`invitation-password-hint${error ? ' invitation-error' : ''}`}
                disabled={loading}
              />
            </div>
            <p id="invitation-password-hint" className="accept-invitation-form__hint">
              Si ya tenías cuenta en Granete, ingresá tu contraseña habitual. Si sos nuevo, creá una contraseña segura.
            </p>
          </div>

          <button
            type="submit"
            className="btn btn--primary"
            disabled={loading || !password}
            aria-busy={loading}
          >
            {loading ? (
              'Aceptando...'
            ) : (
              <>
                <UserCheck size={16} strokeWidth={1.5} aria-hidden="true" /> Aceptar invitación y entrar
              </>
            )}
          </button>
        </form>

        {onBackToLogin && (
          <div className="accept-invitation-card__footer">
            <button
              type="button"
              className="btn btn--ghost btn--small accept-invitation-card__back"
              onClick={onBackToLogin}
            >
              <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" /> Volver al inicio de sesión
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
