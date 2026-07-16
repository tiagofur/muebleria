// @vitest-environment jsdom
import { useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, Mail, LogIn, WifiOff } from 'lucide-react';
import './login.css';

export interface LoginScreenProps {
  readonly onLogin: (email: string, password: string) => Promise<void> | void;
  readonly onGuestAccess: () => void;
  readonly onRegister?: () => void;
  readonly loading?: boolean;
  readonly error?: string | null;
}

export function LoginScreen({
  onLogin,
  onGuestAccess,
  onRegister,
  loading = false,
  error = null,
}: LoginScreenProps): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      <div className="login-card">
        <header className="login-card__header">
          <span className="login-card__mark" aria-hidden>
            🪑
          </span>
          <h2 className="login-card__title">Muebles Carpintería</h2>
          <p className="login-card__subtitle">
            Iniciá sesión para sincronizar tus cotizaciones
          </p>
        </header>

        <form className="login-form" onSubmit={handleSubmit}>
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
                className="login-field__input"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={loading}
              />
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
        ) : null}
      </div>
    </div>
  );
}
