// @vitest-environment jsdom
import { useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, Mail, LogIn, WifiOff, Eye, EyeOff } from 'lucide-react';
import { BrandMark } from '../common/BrandMark';
import './login.css';

export interface LoginScreenProps {
  readonly onLogin: (email: string, password: string) => Promise<void> | void;
  readonly onGuestAccess: () => void;
  readonly onRegister?: () => void;
  readonly loading?: boolean;
  readonly error?: string | null;
  /** Non-blocking info banner (e.g. session expired notice). */
  readonly notice?: string | null;
}

export function LoginScreen({
  onLogin,
  onGuestAccess,
  onRegister,
  loading = false,
  error = null,
  notice = null,
}: LoginScreenProps): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!email.trim() || !password.trim()) {
      setLocalError('Completá email y contraseña');
      return;
    }
    void onLogin(email.trim(), password);
  };

  const displayError = error ?? localError;

  return (
    <div className="login-screen">
      {/* Panel de marca (desktop ≥900px) — el único momento "committed"
          permitido por el registro product (design.md §6.12 v2.1). */}
      <aside className="login-brand" aria-hidden="true">
        <BrandMark size={64} className="login-brand__mark" />
        <p className="login-brand__name">Granete</p>
        <p className="login-brand__tagline">
          Cotización y producción para talleres de carpintería.
        </p>
        <p className="login-brand__meta">Catálogos · Muebles · Órdenes · Corte</p>
      </aside>
      <div className="login-card">
        <header className="login-card__header">
          <BrandMark size={40} className="login-card__mark" />
          <h2 className="login-card__title">Granete</h2>
          <p className="login-card__subtitle">
            Iniciá sesión para sincronizar tus cotizaciones
          </p>
        </header>

        <form className="login-form" onSubmit={handleSubmit}>
          {notice ? (
            <div className="login-notice" role="status">
              {notice}
            </div>
          ) : null}
          {displayError ? (
            <div className="login-error" role="alert">
              {displayError}
            </div>
          ) : null}

          <div className="login-field">
            <label className="login-field__label" htmlFor="login-email">
              Email
            </label>
            <div className="login-field__control">
              <Mail
                className="login-field__icon"
                size={16}
                strokeWidth={1.5}
                aria-hidden
              />
              <input
                id="login-email"
                className="login-field__input"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ejemplo@correo.com"
                disabled={loading}
              />
            </div>
          </div>

          <div className="login-field">
            <label className="login-field__label" htmlFor="login-password">
              Contraseña
            </label>
            <div className="login-field__control">
              <KeyRound
                className="login-field__icon"
                size={16}
                strokeWidth={1.5}
                aria-hidden
              />
              <input
                id="login-password"
                className="login-field__input login-field__input--with-toggle"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={loading}
              />
              <button
                type="button"
                className="login-field__toggle"
                onClick={() => setShowPassword((prev) => !prev)}
                title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                disabled={loading}
              >
                {showPassword ? (
                  <EyeOff size={16} strokeWidth={1.5} aria-hidden />
                ) : (
                  <Eye size={16} strokeWidth={1.5} aria-hidden />
                )}
              </button>
            </div>
          </div>


          <button
            type="submit"
            className="login-submit"
            disabled={loading}
          >
            <LogIn size={16} strokeWidth={1.5} aria-hidden />
            {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
          </button>
        </form>

        <div className="login-divider" aria-hidden>
          <div className="login-divider__line" />
          <span className="login-divider__label">O también</span>
          <div className="login-divider__line" />
        </div>

        <button
          type="button"
          className="login-guest"
          onClick={onGuestAccess}
          disabled={loading}
        >
          <WifiOff size={16} strokeWidth={1.5} aria-hidden />
          Acceder sin conexión (Invitado)
        </button>

        {onRegister ? (
          <p className="login-register-link">
            ¿Primera vez?
            <button type="button" onClick={onRegister} disabled={loading}>
              Solicitar acceso
            </button>
          </p>
        ) : (
          <p className="login-register-link">
            El acceso a talleres se realiza mediante invitación del administrador.
          </p>
        )}
      </div>
    </div>
  );
}
