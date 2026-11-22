/**
 * #1650 — Enviar la cotización exacta al cliente.
 *
 * Email: el PDF de la revisión exacta (los mismos bytes que la descarga) sale
 * por el outbox del servidor; el envío figura «enviado» sólo cuando el
 * servidor SMTP lo aceptó. WhatsApp: el servidor arma el mensaje y el usuario
 * lo envía desde su WhatsApp; queda «sin confirmar» hasta que el usuario
 * confirma que lo envió. Destinatarios: siempre los del cliente guardado.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  GraneteApiClient,
  GraneteApiError,
  type PreparedQuoteWhatsApp,
  type QuoteDelivery,
} from '@granete/storage';
import './quoteSend.css';

export interface QuoteSendRevision {
  readonly id: string;
  readonly revisionNumber: number;
  readonly status: string;
  /** Has a frozen commercial snapshot with lines and visible amounts. */
  readonly exportable: boolean;
}

export type QuoteSendPdfResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly fileName: string }
  | { readonly ok: false; readonly message: string };

export interface QuoteSendPanelProps {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string;
  readonly queryKey: QueryKey;
  readonly revisions: readonly QuoteSendRevision[];
  /** Builds the exact client PDF (same builder as the download). */
  readonly buildPdf: (quoteRevisionId: string, variant: 'detailed' | 'summary') => Promise<QuoteSendPdfResult>;
  /**
   * Called when a delivery became sent/confirmed (the server may have moved
   * the project to «enviada»): lets the shell refresh project and summaries.
   */
  readonly onDeliverySent?: () => void;
}

/** A queued email older than this is shown as stuck and no longer polled. */
export const QUOTE_EMAIL_STALE_MS = 15 * 60 * 1000;

function isStaleQueued(d: QuoteDelivery, now: number): boolean {
  return d.status === 'queued' && now - new Date(d.requestedAt).getTime() > QUOTE_EMAIL_STALE_MS;
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  queued: 'En cola de envío',
  sent: 'Enviada',
  failed: 'No se pudo enviar',
  prepared: 'Preparada, sin confirmar',
  confirmed: 'Enviada (confirmada)',
};

export function isQuoteRevisionSendable(revision: QuoteSendRevision): boolean {
  return (revision.status === 'published' || revision.status === 'accepted') && revision.exportable;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('es-MX', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function newIntentKey(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof GraneteApiError) {
    if (err.status === 403) return 'No tenés permiso para enviar esta cotización.';
    if (err.status === 404) return 'La cotización ya no está disponible.';
    if (err.message) return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function deliveryLine(d: QuoteDelivery, now: number): string {
  const channel = d.channel === 'email' ? `Email a ${d.recipient}` : `WhatsApp a ${d.recipient}`;
  const when = d.sentAt ? ` · ${formatWhen(d.sentAt)}` : ` · pedido ${formatWhen(d.requestedAt)}`;
  const label = isStaleQueued(d, now)
    ? 'Sigue en cola hace más de 15 minutos: el servidor de correo no lo aceptó todavía'
    : STATUS_LABELS[d.status] ?? d.status;
  return `Q${d.revisionNumber} · ${channel} · ${label}${when}`;
}

export function QuoteSendPanel({ baseUrl, token, projectId, queryKey, revisions, buildPdf, onDeliverySent }: QuoteSendPanelProps): ReactNode {
  const api = useMemo(() => new GraneteApiClient(baseUrl), [baseUrl]);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.listProjectQuoteDeliveries(token, projectId, signal),
    retry: false,
    // Queued emails become "sent" when the worker delivers them; a stale
    // queued email (worker problem) stops the polling and is shown as stuck.
    refetchInterval: (q) => {
      const now = Date.now();
      return q.state.data?.items.some((d) => d.status === 'queued' && !isStaleQueued(d, now)) ? 4000 : false;
    },
  });

  // Re-render when the oldest still-fresh queued email crosses the stale
  // mark: polling stops then, so nothing else would refresh its label.
  const [staleTick, setStaleTick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const pending = (query.data?.items ?? [])
      .filter((d) => d.status === 'queued' && !isStaleQueued(d, now))
      .map((d) => new Date(d.requestedAt).getTime() + QUOTE_EMAIL_STALE_MS - now);
    if (pending.length === 0) return undefined;
    const timer = setTimeout(() => setStaleTick((n) => n + 1), Math.max(0, Math.min(...pending)) + 1000);
    return () => clearTimeout(timer);
    // staleTick re-arms the timer for the next queued email (identical
    // refetches keep query.data's reference stable).
  }, [query.data, staleTick]);

  // Notify the shell once per delivery that reaches sent/confirmed.
  const seenSent = useRef<Set<string> | null>(null);
  useEffect(() => {
    const items = query.data?.items;
    if (!items) return;
    const sentIds = items.filter((d) => d.status === 'sent' || d.status === 'confirmed').map((d) => d.id);
    if (seenSent.current === null) {
      seenSent.current = new Set(sentIds);
      return;
    }
    const fresh = sentIds.filter((id) => !seenSent.current!.has(id));
    sentIds.forEach((id) => seenSent.current!.add(id));
    if (fresh.length > 0) onDeliverySent?.();
  }, [query.data, onDeliverySent]);

  const sendable = useMemo(
    () => [...revisions].filter(isQuoteRevisionSendable).sort((a, b) => b.revisionNumber - a.revisionNumber),
    [revisions],
  );
  const [revisionId, setRevisionId] = useState<string>('');
  const selected = sendable.find((r) => r.id === revisionId) ?? sendable[0];
  const [variant, setVariant] = useState<'detailed' | 'summary'>('detailed');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedQuoteWhatsApp | null>(null);
  const emailKey = useRef<string | null>(null);
  const whatsappKey = useRef<string | null>(null);
  const confirmKeys = useRef(new Map<string, string>());

  const refresh = () => queryClient.invalidateQueries({ queryKey });
  // An Idempotency-Key belongs to ONE exact request: a changed input or a
  // definitive (4xx) refusal starts a new intent; only a network/5xx retry
  // reuses the key so a lost response replays instead of sending twice.
  const resetIntents = () => {
    emailKey.current = null;
    whatsappKey.current = null;
  };
  const keepKeyFor = (err: unknown) => !(err instanceof GraneteApiError) || err.status >= 500;

  const sendEmail = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Elegí una revisión publicada.');
      const pdf = await buildPdf(selected.id, variant);
      if (!pdf.ok) throw new Error(pdf.message);
      emailKey.current ??= newIntentKey('quote-email');
      return api.sendProjectQuoteRevisionEmail(
        token,
        projectId,
        selected.id,
        { variant, fileName: pdf.fileName, pdfBase64: bytesToBase64(pdf.bytes), ...(note.trim() ? { note: note.trim() } : {}) },
        emailKey.current,
      );
    },
    onSuccess: async (delivery) => {
      emailKey.current = null;
      setError(null);
      setNote('');
      setNotice(`Email en cola para ${delivery.recipient}. Figura «Enviada» cuando el servidor de correo lo acepte.`);
      await refresh();
    },
    onError: (err) => {
      if (!keepKeyFor(err)) emailKey.current = null;
      setError(errorMessage(err, 'No se pudo enviar el email. Revisá tu conexión e intentá de nuevo.'));
    },
  });

  const prepareWhatsApp = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Elegí una revisión publicada.');
      whatsappKey.current ??= newIntentKey('quote-whatsapp');
      return api.prepareProjectQuoteRevisionWhatsApp(token, projectId, selected.id, whatsappKey.current);
    },
    onSuccess: async (result) => {
      whatsappKey.current = null;
      setError(null);
      setNotice(null);
      setPrepared(result);
      await refresh();
    },
    onError: (err) => {
      if (!keepKeyFor(err)) whatsappKey.current = null;
      setError(errorMessage(err, 'No se pudo preparar el mensaje de WhatsApp.'));
    },
  });

  const confirm = useMutation({
    mutationFn: async (deliveryId: string) => {
      // One intent per delivery: a lost response retried replays the same
      // confirmation instead of answering «ya no se puede confirmar».
      let key = confirmKeys.current.get(deliveryId);
      if (!key) {
        key = newIntentKey('quote-confirm');
        confirmKeys.current.set(deliveryId, key);
      }
      return api.confirmProjectQuoteDelivery(token, projectId, deliveryId, key);
    },
    onSuccess: async () => {
      setPrepared(null);
      setError(null);
      setNotice('Envío por WhatsApp confirmado.');
      await refresh();
    },
    onError: (err) => setError(errorMessage(err, 'No se pudo confirmar el envío.')),
  });

  if (query.isPending) {
    return (
      <div className="quote-send" data-testid="quote-send-panel" aria-busy="true">
        <p className="quote-send__muted">Cargando envíos…</p>
      </div>
    );
  }
  if (query.isError && !query.data) {
    const blocked = query.error instanceof GraneteApiError && (query.error.status === 403 || query.error.status === 404);
    return (
      <div className="quote-send" data-testid="quote-send-panel">
        <p className="quote-send__error" role="alert">
          {blocked
            ? 'Sólo la organización que vende la obra puede enviar la cotización.'
            : 'No se pudieron cargar los envíos.'}
        </p>
        {!blocked ? (
          <button type="button" className="btn btn--ghost btn--small" onClick={() => void query.refetch()}>
            Reintentar
          </button>
        ) : null}
      </div>
    );
  }

  const list = query.data!;
  const busy = sendEmail.isPending || prepareWhatsApp.isPending || confirm.isPending;
  const emailBlocked = !selected
    ? 'Publicá una revisión para poder enviarla.'
    : !list.emailDeliveryAvailable
      ? 'Este servidor todavía no envía correos.'
      : !list.customerEmailAvailable
        ? 'El cliente no tiene un email válido. Agregalo en Clientes.'
        : null;
  const whatsappBlocked = !selected
    ? 'Publicá una revisión para poder enviarla.'
    : !list.customerPhoneAvailable
      ? list.customerPhone
        ? 'El teléfono del cliente no tiene código de país (por ejemplo +52 …). Corregilo en Clientes.'
        : 'El cliente no tiene teléfono. Agregalo en Clientes.'
      : null;
  const pendingWhatsApp = list.items.filter((d) => d.channel === 'whatsapp' && d.status === 'prepared');

  return (
    <div className="quote-send" data-testid="quote-send-panel">
      {query.isError ? (
        <p className="quote-send__warning" role="status">
          No se pudo actualizar. Se muestran los últimos datos.
        </p>
      ) : null}

      {sendable.length === 0 ? (
        <p className="quote-send__muted" data-testid="quote-send-none">
          Todavía no hay una revisión publicada o aceptada para enviar. Publicá la cotización primero.
        </p>
      ) : (
        <form
          className="quote-send__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!emailBlocked && !busy) sendEmail.mutate();
          }}
        >
          <div className="quote-send__row">
            <label className="label" htmlFor="quote-send-revision">
              Revisión
            </label>
            <select
              id="quote-send-revision"
              className="input"
              value={selected?.id ?? ''}
              onChange={(e) => {
                setRevisionId(e.target.value);
                setPrepared(null);
                resetIntents();
              }}
              disabled={busy}
            >
              {sendable.map((r) => (
                <option key={r.id} value={r.id}>
                  {`Q${r.revisionNumber} · ${r.status === 'accepted' ? 'aceptada' : 'publicada'}`}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="quote-send__variants" disabled={busy}>
            <legend className="label">PDF adjunto</legend>
            <label>
              <input type="radio" name="quote-send-variant" checked={variant === 'detailed'} onChange={() => { setVariant('detailed'); resetIntents(); }} />{' '}
              Listado (muebles + total)
            </label>
            <label>
              <input type="radio" name="quote-send-variant" checked={variant === 'summary'} onChange={() => { setVariant('summary'); resetIntents(); }} />{' '}
              Resumen (sólo total)
            </label>
          </fieldset>
          <div className="quote-send__row">
            <label className="label" htmlFor="quote-send-note">
              Mensaje para el cliente (opcional)
            </label>
            <textarea
              id="quote-send-note"
              className="input"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                emailKey.current = null;
              }}
              disabled={busy}
            />
          </div>
          <p className="quote-send__recipient" data-testid="quote-send-recipient">
            {list.customerEmailAvailable && list.customerEmail ? `Se envía a ${list.customerEmail}.` : 'Sin email del cliente.'}
          </p>
          {error ? (
            <p className="quote-send__error" role="alert" data-testid="quote-send-error">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="quote-send__notice" role="status" data-testid="quote-send-notice">
              {notice}
            </p>
          ) : null}
          <div className="quote-send__actions">
            <button
              type="submit"
              className={`btn ${prepared ? 'btn--secondary' : 'btn--primary'} btn--small`}
              disabled={Boolean(emailBlocked) || busy}
              aria-describedby={emailBlocked ? 'quote-send-email-blocked' : undefined}
            >
              {sendEmail.isPending ? 'Enviando…' : 'Enviar por email'}
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              disabled={Boolean(whatsappBlocked) || busy}
              aria-describedby={whatsappBlocked ? 'quote-send-whatsapp-blocked' : undefined}
              onClick={() => prepareWhatsApp.mutate()}
            >
              Preparar WhatsApp
            </button>
          </div>
          {emailBlocked ? (
            <p id="quote-send-email-blocked" className="quote-send__muted" data-testid="quote-send-email-blocked">
              Email: {emailBlocked}
            </p>
          ) : null}
          {whatsappBlocked ? (
            <p id="quote-send-whatsapp-blocked" className="quote-send__muted" data-testid="quote-send-whatsapp-blocked">
              WhatsApp: {whatsappBlocked}
            </p>
          ) : null}
        </form>
      )}

      {prepared ? (
        <div className="quote-send__whatsapp" data-testid="quote-send-whatsapp">
          <p className="quote-send__muted">Mensaje preparado para {prepared.delivery.recipient}:</p>
          <blockquote className="quote-send__message">{prepared.message}</blockquote>
          <p className="quote-send__muted">
            Abrí WhatsApp, adjuntá el PDF si querés y envialo. Después confirmá acá: hasta entonces la cotización no figura como enviada.
          </p>
          <div className="quote-send__actions">
            <a className="btn btn--secondary btn--small" href={prepared.whatsappUrl} target="_blank" rel="noopener noreferrer">
              Abrir WhatsApp
            </a>
            <button
              type="button"
              className="btn btn--primary btn--small"
              disabled={busy}
              onClick={() => confirm.mutate(prepared.delivery.id)}
            >
              Ya lo envié
            </button>
          </div>
        </div>
      ) : null}

      <section aria-labelledby="quote-send-history-title">
        <h4 id="quote-send-history-title" className="quote-send__title">
          Envíos
        </h4>
        {list.items.length === 0 ? (
          <p className="quote-send__muted" data-testid="quote-send-empty">
            Todavía no se envió ninguna cotización de esta obra.
          </p>
        ) : (
          <ul className="quote-send__history" data-testid="quote-send-history">
            {list.items.map((d) => (
              <li key={d.id} className={`quote-send__item quote-send__item--${d.status}`} data-testid={`quote-delivery-${d.status}`}>
                <span>{deliveryLine(d, Date.now())}</span>
                {d.pdfSha256 ? (
                  <span className="quote-send__hash" title={`SHA-256 del PDF enviado: ${d.pdfSha256}`}>
                    PDF {d.pdfSha256.slice(0, 12)}
                  </span>
                ) : null}
                {d.status === 'failed' && d.failureReason ? (
                  <span className="quote-send__error">{d.failureReason}</span>
                ) : null}
                {d.status === 'prepared' && !prepared && pendingWhatsApp.some((p) => p.id === d.id) ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    disabled={busy}
                    onClick={() => confirm.mutate(d.id)}
                  >
                    Confirmar envío
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
