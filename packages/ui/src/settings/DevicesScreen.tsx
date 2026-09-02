import { useState, type ReactNode, type FormEvent } from 'react';
import { Smartphone, CheckCircle, ShieldCheck } from 'lucide-react';
import { PageHeader, submitBusyLabel } from '../common';
import './settings.css';

export type DevicesScreenProps = {
  readonly onApproveDevice: (code: string) => Promise<void>;
};

export function DevicesScreen({ onApproveDevice }: DevicesScreenProps): ReactNode {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) return;
    setStatus('submitting');
    setErrorMsg(null);
    try {
      await onApproveDevice(cleanCode);
      setStatus('success');
      setCode('');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Código inválido o expirado.');
    }
  };

  return (
    <section className="catalog-page" aria-label="Dispositivos">
      <PageHeader
        title="Dispositivos Autorizados"
        subtitle="Administra los accesos de SketchUp a tu cuenta"
        icon={<Smartphone size={16} strokeWidth={1.5} />}
      />

      <div className="settings-form">
        <div className="catalog-form__section">
          <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>Aprobar un nuevo dispositivo</h2>
          <p className="settings-hint">
            Ingresa el código que aparece en el plugin de Granete para SketchUp para vincularlo a tu cuenta.
          </p>
        </div>
        
        {status === 'success' ? (
          <div style={{ padding: 16, backgroundColor: 'var(--success-50)', border: '1px solid var(--success-200)', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 12 }}>
            <CheckCircle size={20} color="var(--success-700)" />
            <div style={{ color: 'var(--success-900)' }}>
              <strong>¡Dispositivo aprobado!</strong>
              <div>Ya puedes regresar a SketchUp para comenzar a usar Granete.</div>
            </div>
          </div>
        ) : null}

        {status === 'error' && errorMsg ? (
          <div style={{ padding: 12, backgroundColor: 'var(--destructive-50)', color: 'var(--destructive-700)', borderRadius: 4, fontSize: 14 }}>
            {errorMsg}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, maxWidth: 200 }}>
            <label htmlFor="deviceCode" style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Código de vinculación</label>
            <input
              id="deviceCode"
              type="text"
              placeholder="Ej: ABC-123"
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
              spellCheck="false"
            />
          </div>
          <div>
            <button
              type="submit"
              className="button-primary"
              disabled={!code.trim() || status === 'submitting'}
            >
              {submitBusyLabel(status === 'submitting', 'Aprobar', 'Aprobando...')}
            </button>
          </div>
        </form>

        <div style={{ marginTop: 8, padding: 16, backgroundColor: 'var(--surface-sunken)', borderRadius: 4, display: 'flex', gap: 12 }}>
          <ShieldCheck size={20} color="var(--text-muted)" style={{ flexShrink: 0 }} />
          <p className="settings-hint" style={{ margin: 0 }}>
            Granete utiliza credenciales seguras por dispositivo (MFA). 
            Nunca compartas estos códigos. Cada instalación de SketchUp requiere su propia aprobación individual.
          </p>
        </div>
      </div>
    </section>
  );
}
