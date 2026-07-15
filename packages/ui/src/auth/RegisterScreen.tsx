/**
 * RegisterScreen — solicitar acceso al sistema (pending admin approval).
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, Mail, User, LogIn, ChevronLeft } from 'lucide-react';
import './login.css';

export interface RegisterScreenProps {
  readonly onRegister: (name: string, email: string, password: string) => Promise<void> | void;
  readonly onBack: () => void;
  readonly loading?: boolean;
  readonly error?: string | null;
}

export function RegisterScreen({
  onRegister,
  onBack,
  loading = false,
  error = null,
}: RegisterScreenProps): ReactNode {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [success, setSuccess] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (password !== confirm) {
      setLocalError('Las contraseñas no coinciden');
      return;
    }
    if (password.length < 6) {
      setLocalError('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    try {
      await onRegister(name.trim(), email.trim(), password);
      setSuccess(true);
    } catch {
      // error handled by parent via prop
    }
  };

  const displayError = error ?? localError;

  if (success) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="register-success">
            <span className="register-success__icon">✅</span>
            <h2 className="register-success__title">Solicitud enviada</h2>
            <p className="register-success__text">
              Tu solicitud de acceso fue recibida. El administrador revisará tu cuenta y
              recibirás acceso en breve.
            </p>
            <button type="button" className="login-submit" onClick={onBack}>
              <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
              Volver a iniciar sesión
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <header className="login-card__header">
          <span className="login-card__mark" aria-hidden>
            🪑
          </span>
          <h2 className="login-card__title">Solicitar acceso</h2>
          <p className="login-card__subtitle">
            Tu cuenta quedará pendiente hasta que el administrador la apruebe
          </p>
        </header>

        <form className="login-form" onSubmit={handleSubmit}>
          {displayError ? (
            <div className="login-error" role="alert">
              {displayError}
            </div>
          ) : null}

          <div className="login-field">
            <label className="login-field__label" htmlFor="reg-name">
              Nombre completo
            </label>
            <div className="login-field__control">
              <User
                className="login-field__icon"
                size={16}
                strokeWidth={1.5}
                aria-hidden
              />
              <input
                id="reg-name"
                className="login-field__input"
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tu nombre"
                disabled={loading}
              />
            </div>
          </div>

          <div className="login-field">
            <label className="login-field__label" htmlFor="reg-email">
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
                id="reg-email"
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
            <label className="login-field__label" htmlFor="reg-password">
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
                id="reg-password"
                className="login-field__input"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                disabled={loading}
              />
            </div>
          </div>

          <div className="login-field">
            <label className="login-field__label" htmlFor="reg-confirm">
              Confirmar contraseña
            </label>
            <div className="login-field__control">
              <KeyRound
                className="login-field__icon"
                size={16}
                strokeWidth={1.5}
                aria-hidden
              />
              <input
                id="reg-confirm"
                className="login-field__input"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repetí la contraseña"
                disabled={loading}
              />
            </div>
          </div>

          <button type="submit" className="login-submit" disabled={loading}>
            <LogIn size={16} strokeWidth={1.5} aria-hidden />
            {loading ? 'Enviando solicitud...' : 'Solicitar acceso'}
          </button>
        </form>

        <div className="login-divider" aria-hidden>
          <div className="login-divider__line" />
          <span className="login-divider__label">O también</span>
          <div className="login-divider__line" />
        </div>

        <button type="button" className="login-guest" onClick={onBack} disabled={loading}>
          <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
          Volver a iniciar sesión
        </button>
      </div>
    </div>
  );
}
