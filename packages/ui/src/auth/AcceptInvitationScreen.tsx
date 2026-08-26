/**
 * AcceptInvitationScreen — Aceptación pública de invitación a un taller (F172 / #326).
 * Se accede con `?token=...`. Si el usuario ya existe ingresa su contraseña;
 * si es nuevo define contraseña (y nombre opcional).
 */

import { useState, type ReactNode } from 'react';
import { ShieldCheck, UserCheck, ArrowLeft, Lock, User } from 'lucide-react';
import './acceptInvitation.css';

export interface AcceptInvitationScreenProps {
  readonly token: string;
  readonly baseUrl: string;
  readonly onAccepted: (authResult: unknown) => void;
  readonly onBackToLogin?: () => void;
}

export function AcceptInvitationScreen({
  token,
  baseUrl,
  onAccepted,
  onBackToLogin,
}: AcceptInvitationScreenProps): ReactNode {
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('La contraseña es requerida');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${baseUrl}/auth/accept-invitation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token.trim(),
          password,
          name: name.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(errData.error || errData.message || 'Error al aceptar invitación');
      }

      const authData = await res.json();
      onAccepted(authData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aceptar la invitación');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="accept-invitation-screen">
      <section className="accept-invitation-card" aria-labelledby="invitation-title">
        <div className="accept-invitation-card__header">
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--brand-100)',
              color: 'var(--brand-700)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 'var(--space-2)',
            }}
          >
            <ShieldCheck size={28} />
          </div>
          <h1 id="invitation-title" className="accept-invitation-card__title">
            Unirte al equipo
          </h1>
          <p className="accept-invitation-card__subtitle">
            Fuiste invitado a colaborar en un taller de Granete. Completá tus datos para acceder.
          </p>
        </div>

        {error && (
          <div role="alert" className="accept-invitation-alert accept-invitation-alert--error">
            {error}
          </div>
        )}

        <form className="accept-invitation-form" onSubmit={handleSubmit}>
          <div>
            <label className="label" htmlFor="inv-name">
              Nombre completo (opcional si ya tenés cuenta)
            </label>
            <div style={{ position: 'relative' }}>
              <User
                size={16}
                style={{
                  position: 'absolute',
                  left: 'var(--space-3)',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                id="inv-name"
                type="text"
                className="input"
                placeholder="Tu nombre y apellido"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ paddingLeft: 'var(--space-8)' }}
                disabled={loading}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="inv-password">
              Contraseña *
            </label>
            <div style={{ position: 'relative' }}>
              <Lock
                size={16}
                style={{
                  position: 'absolute',
                  left: 'var(--space-3)',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                id="inv-password"
                type="password"
                className="input"
                required
                minLength={8}
                placeholder="Mínimo 8 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ paddingLeft: 'var(--space-8)' }}
                disabled={loading}
              />
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
              Si ya tenías cuenta en Granete, ingresá tu contraseña habitual. Si sos nuevo, creá una contraseña segura.
            </p>
          </div>

          <button
            type="submit"
            className="btn btn--primary"
            disabled={loading || !password}
            style={{ width: '100%', marginTop: 'var(--space-2)' }}
          >
            {loading ? (
              'Aceptando...'
            ) : (
              <>
                <UserCheck size={16} /> Aceptar invitación y entrar
              </>
            )}
          </button>
        </form>

        {onBackToLogin && (
          <div style={{ textAlign: 'center', marginTop: 'var(--space-2)' }}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onBackToLogin}
              style={{ color: 'var(--text-secondary)' }}
            >
              <ArrowLeft size={14} /> Volver al inicio de sesión
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
