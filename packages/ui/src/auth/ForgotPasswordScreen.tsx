/**
 * ForgotPasswordScreen — solicitud pública de restablecimiento (#1178).
 * Resultado uniforme (anti-enumeración). Con email configurado en el
 * servidor (#1646) el enlace llega por correo; sin él la UI lo dice y dirige
 * al administrador del taller, que emite el enlace desde Usuarios. El
 * indicador `email_delivery` refleja configuración, nunca si la cuenta existe.
 */

import { useState, type ReactNode } from 'react';
import { MailQuestion, ArrowLeft } from 'lucide-react';
import { GraneteApiClient } from '@granete/storage';
import './acceptInvitation.css';

export interface ForgotPasswordScreenProps {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly onBackToLogin: () => void;
}

export function ForgotPasswordScreen({
  baseUrl,
  fetchImpl,
  onBackToLogin,
}: ForgotPasswordScreenProps): ReactNode {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [emailDelivery, setEmailDelivery] = useState<'queued' | 'not_configured' | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Poné tu email.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await new GraneteApiClient(baseUrl, fetchImpl).requestPasswordReset({ email: email.trim() });
      setEmailDelivery(response.email_delivery === 'queued' ? 'queued' : 'not_configured');
      setSubmitted(true);
    } catch {
      setError('No se pudo registrar la solicitud. Revisá tu conexión y probá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="accept-invitation-screen">
      <section className="accept-invitation-card" aria-labelledby="forgot-title">
        <div className="accept-invitation-card__header">
          <div className="accept-invitation-card__mark" aria-hidden="true">
            <MailQuestion size={28} strokeWidth={1.5} />
          </div>
          <h1 id="forgot-title" className="accept-invitation-card__title">
            Recuperar contraseña
          </h1>
          {submitted && emailDelivery === 'queued' ? (
            <p className="accept-invitation-card__subtitle">
              Si el email pertenece a una cuenta activa de Granete, en unos minutos te llega
              un correo con un enlace para elegir una nueva contraseña. <strong>El enlace vence
              en una hora y sirve una sola vez.</strong> Revisá también la carpeta de spam.
            </p>
          ) : submitted ? (
            <p className="accept-invitation-card__subtitle">
              Si el email pertenece a una cuenta de Granete, registramos la solicitud.
              Este servidor todavía no envía correos: <strong>pedile a tu administrador del
              taller un enlace de restablecimiento</strong> y abrilo desde acá.
            </p>
          ) : (
            <p className="accept-invitation-card__subtitle">
              Dejanos tu email y te enviamos un enlace para elegir una nueva contraseña. Si no
              llega, tu administrador del taller también puede generarlo desde Usuarios.
            </p>
          )}
        </div>

        {submitted ? (
          <div className="accept-invitation-card__footer accept-invitation-card__footer--actions">
            <button type="button" className="btn btn--primary btn--small" onClick={onBackToLogin}>
              Volver al inicio de sesión
            </button>
          </div>
        ) : (
          <form className="accept-invitation-form" onSubmit={handleSubmit}>
            {error && (
              <div role="alert" className="accept-invitation-alert accept-invitation-alert--error">
                {error}
              </div>
            )}
            <div>
              <label className="label" htmlFor="forgot-email">
                Email *
              </label>
              <div className="accept-invitation-field">
                <input
                  id="forgot-email"
                  type="email"
                  className="input"
                  required
                  autoComplete="email"
                  placeholder="tu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>
            <button type="submit" className="btn btn--primary" disabled={loading || !email.trim()} aria-busy={loading}>
              {loading ? 'Enviando…' : 'Pedir enlace'}
            </button>
          </form>
        )}

        <div className="accept-invitation-card__footer">
          <button type="button" className="btn btn--ghost btn--small accept-invitation-card__back" onClick={onBackToLogin}>
            <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" /> Volver al inicio de sesión
          </button>
        </div>
      </section>
    </main>
  );
}
