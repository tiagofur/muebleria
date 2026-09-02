/**
 * #460 SEC-7 — step-up challenge for sensitive actions.
 *
 * A normal authenticated session is not enough for security-sensitive
 * commands: the backend answers a typed 403 STEP_UP_REQUIRED (never a 401, so
 * it can never be mistaken for access expiry) and the user confirms their
 * identity with a TOTP or a recovery code. `useStepUp` binds the challenge to
 * the EXACT action that triggered it: the retried call is the same operation
 * under the SAME Idempotency-Key (the backend boundary runs before the
 * idempotency wrapper, so a challenge never consumes the key). There is no
 * generic global auto-retry.
 *
 * Secrets never persist: the typed code lives in component state only and the
 * modal forgets it on close.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { KeyRound } from 'lucide-react';
import { GraneteApiClient, GraneteApiError, newIdempotencyKey, type MFAStepUpScope } from '@granete/storage';
import { Modal, submitBusyLabel } from '../common';

export type StepUpScope = MFAStepUpScope;

export type UseStepUpOptions = {
  readonly baseUrl: string;
  readonly token: string;
};

type PendingChallenge = {
  readonly scope: StepUpScope;
  readonly actionLabel: string;
  readonly retry: () => void;
};

const CHALLENGE_CODES = new Set(['STEP_UP_REQUIRED', 'STEP_UP_EXPIRED']);

/** True when the error is the typed step-up challenge of a sensitive command. */
export function isStepUpChallenge(err: unknown): err is GraneteApiError {
  return err instanceof GraneteApiError && CHALLENGE_CODES.has(err.code);
}

/** True when the caller has no MFA factor yet (they must enroll first). */
export function isMFARequired(err: unknown): err is GraneteApiError {
  return err instanceof GraneteApiError && err.code === 'MFA_REQUIRED';
}

/**
 * useStepUp runs sensitive mutations through the challenge flow:
 *
 *   const stepUp = useStepUp({ baseUrl, token });
 *   await stepUp.run('device_enrollment', 'aprobar el dispositivo',
 *     (key) => api.approveDeviceEnrollment(token, { code }, key));
 *
 * The key is minted once per `run` call and reused for the retry after a
 * successful verification. The result is the action's own result, or null
 * when the user cancelled the challenge (or MFA enrollment is required —
 * surfaced through `enrollmentRequired` so the caller can redirect).
 */
export function useStepUp({ baseUrl, token }: UseStepUpOptions) {
  const api = useMemo(() => new GraneteApiClient(baseUrl), [baseUrl]);
  const [challenge, setChallenge] = useState<PendingChallenge | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrollmentRequired, setEnrollmentRequired] = useState(false);
  const settledRef = useRef<((ok: boolean) => void) | null>(null);

  const close = useCallback(() => {
    setChallenge(null);
    setCode('');
    setError(null);
    setVerifying(false);
    const settled = settledRef.current;
    settledRef.current = null;
    settled?.(false);
  }, []);

  const run = useCallback(
    async <T,>(scope: StepUpScope, actionLabel: string, action: (idempotencyKey: string) => Promise<T>): Promise<T | null> => {
      const key = newIdempotencyKey();
      const attempt = async (): Promise<T> => action(key);
      try {
        return await attempt();
      } catch (err) {
        if (!isStepUpChallenge(err)) {
          if (isMFARequired(err)) {
            setEnrollmentRequired(true);
            return null;
          }
          throw err;
        }
      }
      // Challenge: bind the modal to this exact action. The retry reuses the
      // SAME key (the backend never consumed it: the challenge happens
      // before the idempotency boundary).
      return await new Promise<T | null>((resolve, reject) => {
        // Only the CANCEL path settles through the ref; after verification
        // the retry settles the promise itself (result or caller-side error).
        settledRef.current = () => resolve(null);
        const cleanup = () => {
          settledRef.current = null;
          setChallenge(null);
          setCode('');
          setError(null);
          setVerifying(false);
        };
        setChallenge({
          scope,
          actionLabel,
          retry: () => {
            void attempt().then(
              (result) => {
                cleanup();
                resolve(result);
              },
              (err) => {
                cleanup();
                if (isMFARequired(err)) {
                  setEnrollmentRequired(true);
                  resolve(null);
                  return;
                }
                // Non-challenge failures propagate to the caller's own
                // catch: the screen renders its normal error handling.
                reject(err);
              },
            );
          },
        });
      });
    },
    [api],
  );

  const verify = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!challenge || verifying) return;
      const clean = code.trim();
      if (clean.length < 6) {
        setError('Ingresá el código completo de 6 dígitos.');
        return;
      }
      setVerifying(true);
      setError(null);
      try {
        await api.requestMFAStepUp(token, { scope: challenge.scope, method: 'totp', code: clean });
        challenge.retry();
      } catch (err) {
        setVerifying(false);
        if (err instanceof GraneteApiError && err.code === 'MFA_INVALID') {
          setError('Código inválido. Revisá tu app de autenticación e intentá de nuevo.');
        } else if (err instanceof GraneteApiError && err.code === 'MFA_REQUIRED') {
          setError('Primero configurá la autenticación en dos pasos en Seguridad.');
        } else if (err instanceof GraneteApiError && err.status === 429) {
          setError('Demasiados intentos. Esperá un minuto y volvé a intentar.');
        } else {
          setError('No se pudo verificar el código. Reintentá en unos segundos.');
        }
      }
    },
    [api, challenge, code, token, verifying],
  );

  const modal = (
    <Modal
      open={challenge !== null}
      onClose={() => {
        if (!verifying) close();
      }}
      title="Confirma tu identidad"
      size="sm"
      dataTestId="step-up-modal"
    >
      <form onSubmit={verify}>
        <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: 14 }}>
          Para {challenge?.actionLabel ?? 'continuar'} ingresá el código de tu app de autenticación.
        </p>
        <label
          htmlFor="step-up-code"
          style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: 'var(--text-primary)' }}
        >
          Código de autenticación
        </label>
        <input
          id="step-up-code"
          data-testid="step-up-code-input"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          className="catalog-input"
          style={{ letterSpacing: 2, fontFamily: 'monospace', width: '100%' }}
          value={code}
          maxLength={8}
          spellCheck={false}
          autoFocus
          disabled={verifying}
          onChange={(e) => {
            setCode(e.target.value);
            if (error) setError(null);
          }}
        />
        {error ? (
          <p role="alert" data-testid="step-up-error" style={{ color: 'var(--destructive-700)', fontSize: 13, margin: '8px 0 0' }}>
            {error}
          </p>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn btn--secondary" onClick={close} disabled={verifying}>
            Cancelar
          </button>
          <button type="submit" className="btn btn--primary" disabled={verifying || code.trim().length < 6}>
            {submitBusyLabel(verifying, 'Verificar', 'Verificando...')}
          </button>
        </div>
      </form>
    </Modal>
  );

  return { run, modal, enrollmentRequired, dismissEnrollmentHint: useCallback(() => setEnrollmentRequired(false), []) };
}

/** Inline hint for MFA_REQUIRED: the sensitive action needs enrollment first. */
export function MFAEnrollmentHint(): ReactNode {
  return (
    <div
      role="alert"
      data-testid="mfa-enrollment-hint"
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: 16,
        backgroundColor: 'var(--warning-50, #fef3c7)',
        border: '1px solid var(--warning-200, #fde68a)',
        borderRadius: 4,
      }}
    >
      <KeyRound size={20} style={{ flexShrink: 0, color: 'var(--warning-700, #b45309)' }} />
      <div style={{ fontSize: 14 }}>
        <strong>Configurá la autenticación en dos pasos</strong>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)' }}>
          Esta acción necesita una verificación adicional. Andá a <strong>Seguridad</strong> para configurar tu app de
          autenticación y volvé a intentarlo.
        </p>
      </div>
    </div>
  );
}

/** Forgets the typed code whenever the modal closes (no secret retention). */
