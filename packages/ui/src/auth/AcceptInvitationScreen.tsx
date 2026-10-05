/**
 * AcceptInvitationScreen — Aceptación pública de invitación a un taller (F172 / #326).
 * Se accede con `?token=...`. El preflight (#1108) verifica el token al montar y
 * muestra el contexto del taller antes de pedir credenciales; si el usuario ya
 * existe ingresa su contraseña, si es nuevo define contraseña (y nombre).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ShieldCheck, UserCheck, ArrowLeft, Lock, User, Eye, EyeOff } from 'lucide-react';
import { roleLabelEs } from '@granete/domain';
import {
  GraneteApiClient,
  GraneteApiError,
  type ApiErrorCode,
  type InvitationPreviewResponse,
  type LoginResponse,
} from '@granete/storage';
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

const INVITATION_STATE_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  INVITATION_EXPIRED: 'Esta invitación venció. Pedile al administrador que la reenvíe.',
  INVITATION_REVOKED: 'Esta invitación fue revocada. Pedile una nueva al administrador.',
  INVITATION_TOKEN_ROTATED: 'Este enlace fue reemplazado por uno más reciente. Usá el último que recibiste.',
  INVITATION_ALREADY_USED: 'Esta invitación ya fue aceptada. Iniciá sesión con tu cuenta.',
  INVITATION_NOT_FOUND: 'Esta invitación no está disponible. Pedile al administrador que la reenvíe.',
  ACCOUNT_DISABLED: 'Tu cuenta está deshabilitada. Contactá al administrador de plataforma.',
};

const INVITATION_FALLBACK_MESSAGE = 'Esta invitación no está disponible. Pedile al administrador que la reenvíe.';

function invitationStateMessage(error: unknown): string {
  if (error instanceof GraneteApiError) {
    return INVITATION_STATE_MESSAGES[error.code] ?? INVITATION_FALLBACK_MESSAGE;
  }
  return 'No se pudo verificar la invitación. Revisá tu conexión y probá de nuevo.';
}

function invitationErrorMessage(error: unknown): string {
  if (!(error instanceof GraneteApiError)) {
    return error instanceof Error ? error.message : 'No se pudo aceptar la invitación';
  }
  if (error.code === 'UNAUTHORIZED') {
    return 'La contraseña no coincide con tu cuenta existente.';
  }
  return INVITATION_STATE_MESSAGES[error.code] ?? error.message;
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
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvitationPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const errorRef = useRef<HTMLDivElement>(null);
  const previewErrorRef = useRef<HTMLDivElement>(null);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const data = await new GraneteApiClient(baseUrl, fetchImpl).previewInvitation({ token: token.trim() });
      setPreview(data);
    } catch (err) {
      setPreview(null);
      setPreviewError(invitationStateMessage(err));
    } finally {
      setPreviewLoading(false);
    }
  }, [baseUrl, fetchImpl, token]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (previewError) previewErrorRef.current?.focus();
  }, [previewError]);

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

  const accountExists = preview?.account_exists === true;

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
            {preview ? (
              <>
                Fuiste invitado a <strong>{preview.organization_name}</strong>
                {preview.roles.length > 0 ? <> como {preview.roles.map(roleLabelEs).join(' · ')}</> : null}.
              </>
            ) : (
              'Fuiste invitado a colaborar en un taller de Granete. Completá tus datos para acceder.'
            )}
          </p>
          {preview ? (
            <p className="accept-invitation-card__subtitle">
              Con el correo <strong>{preview.email_masked}</strong>.
            </p>
          ) : null}
        </div>

        {previewLoading && (
          <p role="status" className="accept-invitation-form__hint">
            Verificando la invitación…
          </p>
        )}

        {previewError && (
          <>
            <div
              ref={previewErrorRef}
              role="alert"
              tabIndex={-1}
              className="accept-invitation-alert accept-invitation-alert--error"
            >
              {previewError}
            </div>
            <div className="accept-invitation-card__footer accept-invitation-card__footer--actions">
              <button type="button" className="btn btn--secondary btn--small" onClick={() => void loadPreview()}>
                Reintentar
              </button>
              {onBackToLogin && (
                <button type="button" className="btn btn--ghost btn--small accept-invitation-card__back" onClick={onBackToLogin}>
                  <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" /> Volver al inicio de sesión
                </button>
              )}
            </div>
          </>
        )}

        {preview && (
          <form className="accept-invitation-form" onSubmit={handleSubmit}>
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

            {!accountExists && (
              <div>
                <label className="label" htmlFor="inv-name">
                  Nombre completo
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
                    autoComplete="name"
                    placeholder="Tu nombre y apellido"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-describedby={error ? 'invitation-error' : undefined}
                    disabled={loading}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="label" htmlFor="inv-password">
                {accountExists ? 'Tu contraseña *' : 'Creá tu contraseña *'}
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
                  type={showPassword ? 'text' : 'password'}
                  className="input accept-invitation-input--with-toggle"
                  required
                  autoComplete={accountExists ? 'current-password' : 'new-password'}
                  placeholder={accountExists ? 'Tu contraseña habitual' : 'Mínimo 8 caracteres, con letras y números'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby={`invitation-password-hint${error ? ' invitation-error' : ''}`}
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
                  {showPassword ? (
                    <EyeOff size={16} strokeWidth={1.5} aria-hidden="true" />
                  ) : (
                    <Eye size={16} strokeWidth={1.5} aria-hidden="true" />
                  )}
                </button>
              </div>
              <p id="invitation-password-hint" className="accept-invitation-form__hint">
                {accountExists
                  ? 'Ingresá la contraseña que ya usás en Granete para entrar a este taller.'
                  : 'Mínimo 8 caracteres, con al menos una letra y un número.'}
              </p>
            </div>

            <button
              type="submit"
              className="btn btn--primary"
              disabled={loading || !password}
              aria-busy={loading}
            >
              {loading ? (
                'Enviando...'
              ) : (
                <>
                  <UserCheck size={16} strokeWidth={1.5} aria-hidden="true" />
                  {accountExists ? 'Entrar al taller' : 'Aceptar invitación y entrar'}
                </>
              )}
            </button>
          </form>
        )}

        {onBackToLogin && preview && !previewError && (
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
