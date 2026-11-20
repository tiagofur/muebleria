/**
 * #1649 — Cobros de una obra: total de la QuoteRevision aceptada exacta,
 * cobrado, saldo y el historial append-only de pagos (con anulaciones). Todo
 * monto y saldo viene del servidor; este panel no recalcula nada. Registrar y
 * anular son comandos del servidor con Idempotency-Key: nada se muestra como
 * registrado hasta que el servidor lo confirma.
 */
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  GraneteApiClient,
  GraneteApiError,
  type ProjectPayment,
  type ProjectPaymentSummary,
} from '@granete/storage';
import { DEPOSIT_PAYMENT_METHODS, validateDepositPayload } from '@granete/domain';
import './payments.css';

export const PAYMENT_METHOD_LABELS_ES: Readonly<Record<string, string>> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card: 'Tarjeta',
  check: 'Cheque',
  other: 'Otro',
};

export function formatPaymentMoney(amount: number, currency: string): string {
  return `${amount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function newIntentKey(): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `payment-${id}`;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof GraneteApiError) {
    if (err.status === 403) return 'No tenés permiso para registrar cobros en esta obra.';
    if (err.status === 404) return 'La obra no está disponible para tu taller.';
    if (err.status === 409) return err.message || 'El cobro ya cambió en el servidor. Actualizá e intentá de nuevo.';
    if (err.message) return err.message;
  }
  return fallback;
}

export interface ProjectPaymentsPanelProps {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string;
  readonly projectCurrency: string;
  readonly queryKey: QueryKey;
  readonly canRecord: boolean;
  readonly onDownloadReceipt?: (payment: ProjectPayment, summary: ProjectPaymentSummary) => void | Promise<void>;
}

export function ProjectPaymentsPanel({
  baseUrl,
  token,
  projectId,
  projectCurrency,
  queryKey,
  canRecord,
  onDownloadReceipt,
}: ProjectPaymentsPanelProps): ReactNode {
  const api = useMemo(() => new GraneteApiClient(baseUrl), [baseUrl]);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.getProjectPaymentSummary(token, projectId, signal),
    retry: false,
  });

  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [receivedOn, setReceivedOn] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const recordKey = useRef<string | null>(null);

  const [voidTarget, setVoidTarget] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);
  const voidKey = useRef<string | null>(null);

  const record = useMutation({
    mutationFn: async () => {
      const currency = query.data?.currency ?? projectCurrency;
      const validation = validateDepositPayload({
        amount: Number(amount),
        currency,
        paymentMethod: method || undefined,
        reference,
        note,
      });
      if (!validation.ok) throw new Error(validation.message);
      recordKey.current ??= newIntentKey();
      const value = validation.value;
      return api.recordProjectPayment(
        token,
        projectId,
        {
          amount: value.amount,
          currency: value.currency,
          ...(value.paymentMethod ? { paymentMethod: value.paymentMethod as never } : {}),
          ...(value.reference ? { reference: value.reference } : {}),
          ...(value.note ? { note: value.note } : {}),
          ...(receivedOn ? { receivedAt: `${receivedOn}T12:00:00Z` } : {}),
        },
        recordKey.current,
      );
    },
    onSuccess: async () => {
      recordKey.current = null;
      setAmount('');
      setMethod('');
      setReference('');
      setReceivedOn('');
      setNote('');
      setFormError(null);
      setShowForm(false);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => setFormError(errorMessage(err, 'No se registró el pago. Revisá tu conexión e intentá de nuevo.')),
  });

  const voidPayment = useMutation({
    mutationFn: async (paymentId: string) => {
      voidKey.current ??= newIntentKey();
      return api.voidProjectPayment(token, projectId, paymentId, { reason: voidReason.trim() }, voidKey.current);
    },
    onSuccess: async () => {
      voidKey.current = null;
      setVoidTarget(null);
      setVoidReason('');
      setVoidError(null);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => setVoidError(errorMessage(err, 'No se anuló el cobro. Intentá de nuevo.')),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    record.mutate();
  };

  if (query.isPending) {
    return (
      <div className="payments-panel" data-testid="payments-panel" aria-busy="true">
        <p className="payments-panel__muted">Cargando cobros…</p>
      </div>
    );
  }
  if (query.isError && !query.data) {
    const blocked = query.error instanceof GraneteApiError && (query.error.status === 403 || query.error.status === 404);
    return (
      <div className="payments-panel" data-testid="payments-panel">
        <p className="payments-panel__error" role="alert" data-testid="payments-error">
          {blocked
            ? 'Los cobros de esta obra no están disponibles para tu usuario.'
            : 'No se pudieron cargar los cobros.'}
        </p>
        {!blocked ? (
          <button type="button" className="btn btn--ghost btn--small" onClick={() => void query.refetch()}>
            Reintentar
          </button>
        ) : null}
      </div>
    );
  }

  const summary = query.data!;
  const balance = summary.balance;
  return (
    <div className="payments-panel" data-testid="payments-panel">
      {query.isError ? (
        <p className="payments-panel__warning" role="status">
          No se pudo actualizar. Se muestran los últimos datos; reintentá antes de decidir.
        </p>
      ) : null}
      <dl className="payments-panel__totals">
        <div>
          <dt>Total cotizado</dt>
          <dd data-testid="payments-quote-total">
            {summary.acceptedQuote
              ? `${formatPaymentMoney(summary.acceptedQuote.saleTotal, summary.acceptedQuote.currency)} (Q${summary.acceptedQuote.revisionNumber})`
              : 'Sin cotización aceptada'}
          </dd>
        </div>
        <div>
          <dt>Cobrado</dt>
          <dd data-testid="payments-paid-total">{formatPaymentMoney(summary.paidTotal, summary.currency)}</dd>
        </div>
        <div>
          <dt>{balance !== undefined && balance < 0 ? 'Saldo a favor del cliente' : 'Saldo'}</dt>
          <dd data-testid="payments-balance" className={balance !== undefined && balance > 0 ? 'payments-panel__due' : undefined}>
            {balance === undefined ? '—' : formatPaymentMoney(Math.abs(balance), summary.currency)}
          </dd>
        </div>
      </dl>
      {summary.otherCurrencyPayments > 0 ? (
        <p className="payments-panel__warning" role="status">
          {summary.otherCurrencyPayments} cobro(s) en otra moneda no se suman al saldo.
        </p>
      ) : null}

      {canRecord && !showForm ? (
        <button
          type="button"
          className="btn btn--primary btn--small"
          data-testid="btn-record-payment"
          onClick={() => setShowForm(true)}
        >
          Registrar pago
        </button>
      ) : null}

      {canRecord && showForm ? (
        <form className="payments-panel__form" onSubmit={onSubmit} aria-label="Registrar pago">
          <label className="form-label" htmlFor="payment-amount">
            Monto ({summary.currency})*
          </label>
          <input
            id="payment-amount"
            className="form-input form-input--small"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <label className="form-label" htmlFor="payment-method">
            Medio de pago
          </label>
          <select
            id="payment-method"
            className="form-select form-select--small"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="">Sin indicar</option>
            {DEPOSIT_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS_ES[m]}
              </option>
            ))}
          </select>
          <label className="form-label" htmlFor="payment-received-on">
            Fecha del pago
          </label>
          <input
            id="payment-received-on"
            className="form-input form-input--small"
            type="date"
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
          />
          <label className="form-label" htmlFor="payment-reference">
            Referencia
          </label>
          <input
            id="payment-reference"
            className="form-input form-input--small"
            maxLength={120}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <label className="form-label" htmlFor="payment-note">
            Nota
          </label>
          <input
            id="payment-note"
            className="form-input form-input--small"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {formError ? (
            <p className="payments-panel__error" role="alert" data-testid="payment-form-error">
              {formError}
            </p>
          ) : null}
          <div className="payments-panel__actions">
            <button
              type="submit"
              className="btn btn--primary btn--small"
              data-testid="btn-confirm-payment"
              disabled={record.isPending || !(Number(amount) > 0)}
            >
              {record.isPending ? 'Registrando…' : 'Confirmar pago'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => {
                setShowForm(false);
                setFormError(null);
                recordKey.current = null;
              }}
              disabled={record.isPending}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      {summary.payments.length === 0 ? (
        <p className="payments-panel__muted" data-testid="payments-empty">
          Todavía no hay cobros registrados.
        </p>
      ) : (
        <table className="payments-panel__table" data-testid="payments-table">
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Concepto</th>
              <th scope="col">Medio</th>
              <th scope="col">Referencia</th>
              <th scope="col" className="payments-panel__num">
                Monto
              </th>
              <th scope="col" aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {summary.payments.map((p) => (
              <tr key={p.id} data-testid={`payment-row-${p.id}`} className={p.void ? 'payments-panel__voided' : undefined}>
                <td>{formatDay(p.receivedAt)}</td>
                <td>
                  {p.kind === 'deposit' ? 'Anticipo' : 'Pago'}
                  {p.void ? (
                    <span className="payments-panel__void-tag" title={p.void.reason}>
                      {' '}
                      · Anulado: {p.void.reason}
                    </span>
                  ) : null}
                </td>
                <td>{p.paymentMethod ? PAYMENT_METHOD_LABELS_ES[p.paymentMethod] : '—'}</td>
                <td>{p.reference ?? '—'}</td>
                <td className="payments-panel__num">{formatPaymentMoney(p.amount, p.currency)}</td>
                <td className="payments-panel__row-actions">
                  {onDownloadReceipt ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={() => void onDownloadReceipt(p, summary)}
                    >
                      Recibo
                    </button>
                  ) : null}
                  {canRecord && !p.void ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      data-testid={`btn-void-${p.id}`}
                      onClick={() => {
                        setVoidTarget(p.id);
                        setVoidReason('');
                        setVoidError(null);
                        voidKey.current = null;
                      }}
                    >
                      Anular
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {voidTarget ? (
        <div className="payments-panel__void" role="dialog" aria-label="Anular cobro" data-testid="void-dialog">
          <label className="form-label" htmlFor="payment-void-reason">
            Motivo de la anulación*
          </label>
          <input
            id="payment-void-reason"
            className="form-input form-input--small"
            maxLength={500}
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
          />
          <p className="payments-panel__muted">El cobro queda en el historial marcado como anulado; no se borra.</p>
          {voidError ? (
            <p className="payments-panel__error" role="alert">
              {voidError}
            </p>
          ) : null}
          <div className="payments-panel__actions">
            <button
              type="button"
              className="btn btn--danger btn--small"
              data-testid="btn-confirm-void"
              disabled={voidPayment.isPending || voidReason.trim() === ''}
              onClick={() => voidPayment.mutate(voidTarget)}
            >
              {voidPayment.isPending ? 'Anulando…' : 'Anular cobro'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setVoidTarget(null)}
              disabled={voidPayment.isPending}
            >
              Volver
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
