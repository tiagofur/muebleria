import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Clock, Copy, RefreshCw, TriangleAlert, X } from 'lucide-react';
import {
  GraneteApiClient,
  GraneteApiError,
  type PairingGrantCreated,
  type PairingGrantStatus,
} from '@granete/storage';
import { Modal } from '../common';
import './digitalThread.css';

/**
 * #499 / DT-SU-1 — "Abrir en SketchUp" pairing sheet (Web side, Slice 2).
 *
 * Slice boundary: this modal CREATES and OBSERVES a Slice 1 pairing grant. It
 * never launches SketchUp and never claims the model binding happened —
 * `exchanged` is reported as "code accepted by SketchUp", the
 * initiated-vs-confirmed distinction Slice 3 will complete.
 *
 * Exactness contract:
 * - the pinned base revision is FROZEN when the grant is created (from the
 *   caller's exact timeline selection). A later R2 never rewrites the modal:
 *   the sheet keeps showing the grant's own pin until it terminates;
 * - polling failures never derive `expired`: expiry comes exclusively from
 *   the server status;
 * - closing while pending cancels the grant (DEMO preference); a grant that
 *   already reached exchanged/cancelled/expired is never cancelled again.
 */

const POLL_INTERVAL_MS = 4000;

export interface SketchUpPairingModalProps {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string;
  readonly designId: string;
  /** Exact pinned base revision at grant-creation time; null = none published. */
  readonly baseRevisionId: string | null;
  /**
   * Frozen presentation label for the pinned base ("R1", "R2", …). Frozen by
   * the caller when the sheet opens; a newer revision published afterwards
   * never rewrites it.
   */
  readonly baseRevisionLabel: string | null;
  /** Frozen display labels: the sheet must not re-derive them from live data. */
  readonly projectName: string;
  readonly designName: string;
  readonly onClose: () => void;
}

function formatCode(code: string): string {
  return code.length === 12 ? `${code.slice(0, 4)} ${code.slice(4, 8)} ${code.slice(8)}` : code;
}

function formatCountdown(expiresAt: string, nowMs: number): string {
  const remaining = Math.floor((new Date(expiresAt).getTime() - nowMs) / 1000);
  if (Number.isNaN(remaining) || remaining <= 0) return 'menos de 1 minuto';
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

type GrantPhase = 'creating' | 'active' | 'create-error';

function isTerminalGrantStatus(status: PairingGrantStatus['status'] | undefined): boolean {
  return (
    status === 'exchanged' ||
    status === 'confirmed' ||
    status === 'cancelled' ||
    status === 'expired'
  );
}

/**
 * States the grant can never leave. `exchanged` is NOT final — the plugin
 * still owes the confirm that closes the initiated-vs-confirmed gap (#499
 * Slice 3), so polling must continue through it or a confirm committed
 * between two polls would never surface.
 */
function isFinalGrantStatus(status: PairingGrantStatus['status'] | undefined): boolean {
  return (
    status === 'confirmed' ||
    status === 'cancelled' ||
    status === 'expired'
  );
}

export function SketchUpPairingModal({
  baseUrl,
  token,
  projectId,
  designId,
  baseRevisionId,
  baseRevisionLabel,
  projectName,
  designName,
  onClose,
}: SketchUpPairingModalProps): ReactNode {
  const api = useMemo(() => new GraneteApiClient(baseUrl), [baseUrl]);
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<GrantPhase>('creating');
  const [grant, setGrant] = useState<PairingGrantCreated | null>(null);
  const [status, setStatus] = useState<PairingGrantStatus | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const grantRef = useRef<PairingGrantCreated | null>(null);
  const statusRef = useRef<PairingGrantStatus | null>(null);
  const closedRef = useRef(false);

  // Base label frozen for the lifetime of the sheet: "R2 actual" arriving in
  // the background never rewrites what this grant pinned.
  const baseLabel = baseRevisionLabel ?? 'Sin revisión publicada';

  const createGrant = useCallback(async () => {
    setBusy(true);
    setCreateError(null);
    setCopied(false);
    setPollError(null);
    try {
      const created = await api.createDesignPairingGrant(token, projectId, designId, {
        action: 'open_design',
        ...(baseRevisionId ? { base_revision_id: baseRevisionId } : {}),
      });
      grantRef.current = created;
      statusRef.current = null;
      setGrant(created);
      setStatus(null);
      setPhase('active');
    } catch (err) {
      if (closedRef.current) return;
      setPhase('create-error');
      setCreateError(
        err instanceof GraneteApiError
          ? err.message
          : 'No se pudo crear el código de vinculación. Revisá tu conexión.',
      );
    } finally {
      setBusy(false);
    }
  }, [api, token, projectId, designId, baseRevisionId]);

  useEffect(() => {
    void createGrant();
  }, [createGrant]);

  const terminalStatus = isTerminalGrantStatus(status?.status);
  const finalStatus = isFinalGrantStatus(status?.status);

  // Poll grant status while it can still advance. A network/API failure keeps
  // the last known state and surfaces a retryable notice — it NEVER derives
  // expired. `exchanged` keeps polling: the plugin confirm may land between
  // two polls (backend pending→exchanged→confirmed).
  useEffect(() => {
    if (phase !== 'active' || !grant || finalStatus) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const current = await api.getDesignPairingGrant(token, projectId, designId, grant.id);
        if (cancelled) return;
        statusRef.current = current;
        setStatus(current);
        setPollError(null);
      } catch {
        if (cancelled) return;
        setPollError('No se pudo actualizar el estado. Reintentando…');
      }
    };
    void poll();
    const id = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, token, projectId, designId, grant, phase, finalStatus]);

  // Countdown ticker: visual only (aria-hidden) so screen readers are not
  // spammed every second.
  useEffect(() => {
    if (phase !== 'active' || finalStatus) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [phase, finalStatus]);

  const cancelPendingGrant = useCallback(async () => {
    const current = grantRef.current;
    if (!current) return;
    try {
      await api.cancelDesignPairingGrant(token, projectId, designId, current.id);
      await queryClient.invalidateQueries({ queryKey: ['project-designs'] });
    } catch {
      // Best effort: a lost cancel only leaves the grant to expire by TTL.
    }
  }, [api, token, projectId, designId, queryClient]);

  const handleClose = useCallback(() => {
    closedRef.current = true;
    // DEMO preference: leaving while pending cancels the outstanding grant so
    // no live code outlives the sheet. Terminal grants (confirmed included)
    // are never re-cancelled. Read refs because Modal's document listener is
    // refreshed in a passive effect and may briefly retain an earlier callback.
    if (grantRef.current && !isTerminalGrantStatus(statusRef.current?.status)) {
      void cancelPendingGrant();
    }
    onClose();
  }, [cancelPendingGrant, onClose]);

  const handleRegenerate = useCallback(async () => {
    setBusy(true);
    try {
      if (grant && !terminalStatus) await cancelPendingGrant();
      grantRef.current = null;
      statusRef.current = null;
      setGrant(null);
      setStatus(null);
      setPhase('creating');
      await createGrant();
    } finally {
      setBusy(false);
    }
  }, [grant, terminalStatus, cancelPendingGrant, createGrant]);

  const handleCopy = useCallback(async () => {
    if (!grant) return;
    try {
      await navigator.clipboard.writeText(grant.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }, [grant]);

  const statusLine = (): ReactNode => {
    if (phase === 'creating') {
      return (
        <p className="psm-status psm-status--muted" data-testid="pairing-creating">
          <RefreshCw size={14} className="spin" /> Creando código de vinculación…
        </p>
      );
    }
    if (phase === 'create-error') {
      return (
        <div className="pd-alert pd-alert--error" role="alert" data-testid="pairing-create-error">
          <TriangleAlert size={16} /> {createError ?? 'No se pudo crear el código.'}
        </div>
      );
    }
    switch (status?.status) {
      case 'confirmed':
        return (
          <p className="psm-status psm-status--ok" role="status" data-testid="pairing-confirmed">
            <CircleCheck size={16} /> Diseño vinculado en SketchUp. Ya podés modelar y publicar
            desde la extensión.
          </p>
        );
      case 'exchanged':
        return (
          <p className="psm-status psm-status--ok" role="status" data-testid="pairing-exchanged">
            <CircleCheck size={16} /> Código aceptado por SketchUp. Terminá la conexión en la
            extensión para confirmar el enlace del modelo.
          </p>
        );
      case 'cancelled':
        return (
          <p className="psm-status psm-status--warn" role="status" data-testid="pairing-cancelled">
            <TriangleAlert size={16} /> El código fue cancelado. Podés generar uno nuevo.
          </p>
        );
      case 'expired':
        return (
          <p className="psm-status psm-status--warn" role="status" data-testid="pairing-expired">
            <TriangleAlert size={16} /> El código expiró. Generá uno nuevo para continuar.
          </p>
        );
      default:
        return (
          <p className="psm-status" role="status" data-testid="pairing-pending">
            Esperando conexión con SketchUp…
          </p>
        );
    }
  };

  return (
    <Modal
      open
      title="Abrir en SketchUp"
      onClose={handleClose}
      dataTestId="sketchup-pairing-modal"
    >
      <div className="psm-sheet">
        <p className="psm-context">
          Se abrirá <strong>{designName}</strong> de la obra <strong>{projectName}</strong>.
        </p>
        <p className="psm-base" data-testid="pairing-base-label">
          Base: {baseLabel}
        </p>

        {statusLine()}

        {phase === 'active' && grant ? (
          <>
            <div className="psm-code-row">
              <output className="psm-code" aria-label="Código de vinculación" data-testid="pairing-code">
                {formatCode(grant.code)}
              </output>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void handleCopy()}
                data-testid="pairing-copy-btn"
              >
                <Copy size={14} />
                <span>{copied ? '¡Copiado!' : 'Copiar código'}</span>
              </button>
            </div>
            <p className="psm-hint" aria-hidden="true">
              <Clock size={13} /> Expira en {formatCountdown(grant.expires_at, nowMs)}
            </p>
            {pollError ? (
              <p className="psm-poll-error" role="alert" data-testid="pairing-poll-error">
                {pollError}
              </p>
            ) : null}
            <ol className="psm-steps">
              <li>En SketchUp, abrí la extensión Granete.</li>
              <li>
                Elegí <strong>Conectar con código</strong> y pegá este código.
              </li>
            </ol>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={handleClose}>
                {terminalStatus ? 'Cerrar' : 'Cerrar y cancelar código'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void handleRegenerate()}
                data-testid="pairing-regenerate-btn"
              >
                <RefreshCw size={14} />
                <span>{status?.status === 'expired' || status?.status === 'cancelled' ? 'Generar nuevo código' : 'Regenerar código'}</span>
              </button>
            </div>
          </>
        ) : phase === 'create-error' ? (
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              Cerrar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void createGrant()}
              data-testid="pairing-retry-create-btn"
            >
              Reintentar
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
