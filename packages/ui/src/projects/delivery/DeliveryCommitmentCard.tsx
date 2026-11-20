/**
 * #1648 — «Entrega comprometida» of one obra. Shows the agreed date, its
 * status (en fecha / vence esta semana / atrasado / entregado) and the last
 * change reason; lets authorized users commit or move the date. The server is
 * the authority: the card only submits the command and renders the verdict
 * (a change without reason is also rejected server-side).
 */
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { CalendarClock } from 'lucide-react';
import {
  localIsoDate,
  projectDeliveryInfo,
  type DeliveryCommitmentInput,
  type Project,
} from '@granete/domain';
import { DeliveryStatusChip } from './DeliveryStatusChip';
import './delivery.css';

export type DeliveryCommitResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface DeliveryCommitmentCardProps {
  readonly project: Project;
  /** Absent → read-only (no permission or offline/local mode). */
  readonly onCommit?: (input: DeliveryCommitmentInput) => Promise<DeliveryCommitResult>;
  /** Injected for tests; defaults to the local calendar day. */
  readonly today?: string;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function DeliveryCommitmentCard({ project, onCommit, today }: DeliveryCommitmentCardProps): ReactNode {
  const day = today ?? localIsoDate(new Date());
  const info = projectDeliveryInfo(project, day);
  const committed = project.committedDeliveryDate;
  const lastChange = [...(project.events ?? [])]
    .filter((ev) => ev.type === 'delivery_date_changed')
    .sort((a, b) => (a.at < b.at ? 1 : -1))[0];
  const lastReason =
    lastChange && typeof (lastChange.payload as { reason?: unknown } | undefined)?.reason === 'string'
      ? String((lastChange.payload as { reason: string }).reason)
      : undefined;

  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(committed ?? '');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dateId = useId();
  const reasonId = useId();

  const canEdit = Boolean(onCommit) && info.status !== 'delivered' && info.status !== 'closed';
  const isChange = Boolean(committed);

  const open = () => {
    setDate(committed ?? '');
    setReason('');
    setError(null);
    setEditing(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!onCommit || pending) return;
    if (!date) {
      setError('Elegí la fecha de entrega.');
      return;
    }
    if (isChange && date === committed) {
      setError('La entrega ya está comprometida para esa fecha.');
      return;
    }
    if (isChange && !reason.trim()) {
      setError('Indicá el motivo del cambio: queda en el historial de la obra.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await onCommit(isChange ? { date, reason: reason.trim() } : { date });
      if (result.ok) {
        setEditing(false);
      } else {
        setError(result.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="delivery-card" data-testid="delivery-commitment-card" aria-labelledby={`${dateId}-title`}>
      <div className="delivery-card__header">
        <h4 className="delivery-card__title" id={`${dateId}-title`}>
          <CalendarClock strokeWidth={1.5} size={16} aria-hidden="true" /> Entrega comprometida
        </h4>
        {canEdit && !editing ? (
          <button type="button" className="btn btn--secondary btn--small" onClick={open} data-testid="btn-commit-delivery">
            {isChange ? 'Cambiar fecha' : 'Comprometer fecha'}
          </button>
        ) : null}
      </div>

      <div className="delivery-card__summary">
        <span className="delivery-card__date" data-testid="delivery-committed-date">
          {committed ? formatDate(committed) : 'Sin fecha comprometida'}
        </span>
        {info.status !== 'none' ? <DeliveryStatusChip info={info} withDays testId="delivery-card-status" /> : null}
      </div>
      {info.status === 'delivered' && info.deliveredAt ? (
        <p className="delivery-card__muted" data-testid="delivery-actual">
          Entregada el {new Date(info.deliveredAt).toLocaleDateString('es-MX')} (hito real del historial).
        </p>
      ) : null}
      {info.status === 'none' ? (
        <p className="delivery-card__muted">
          Acordá la fecha con el cliente al aceptar el pedido: así la obra aparece en «Atrasados» si se pasa.
        </p>
      ) : null}
      {lastChange && lastReason && !editing ? (
        <p className="delivery-card__muted" data-testid="delivery-last-change">
          Último cambio ({new Date(lastChange.at).toLocaleDateString('es-MX')}): {lastReason}
        </p>
      ) : null}

      {editing ? (
        <form className="delivery-card__form" onSubmit={submit} data-testid="delivery-commitment-form" noValidate>
          <label className="form-label" htmlFor={dateId}>
            Fecha de entrega
          </label>
          <input
            id={dateId}
            type="date"
            className="form-input form-input--small"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={pending}
            required
          />
          {isChange ? (
            <>
              <label className="form-label" htmlFor={reasonId}>
                Motivo del cambio
              </label>
              <textarea
                id={reasonId}
                className="form-input form-input--small"
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={pending}
                placeholder="Ej.: el proveedor atrasó la placa"
                required
              />
            </>
          ) : null}
          {error ? (
            <p className="delivery-card__error" role="alert" data-testid="delivery-commitment-error">
              {error}
            </p>
          ) : null}
          <div className="delivery-card__actions">
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setEditing(false)} disabled={pending}>
              Cancelar
            </button>
            <button type="submit" className="btn btn--primary btn--small" disabled={pending} data-testid="btn-save-delivery">
              {pending ? 'Guardando…' : 'Guardar fecha'}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
