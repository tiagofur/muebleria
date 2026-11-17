/**
 * #1649 — «Por cobrar»: obras con cotización aceptada y saldo pendiente,
 * calculado por el servidor (total congelado de la revisión aceptada exacta −
 * cobros vigentes). Con customerId muestra la cuenta corriente de un cliente.
 * La antigüedad se mide desde la aceptación real de la revisión, nunca desde
 * fechas de edición de la obra.
 */
import { useMemo, type ReactNode } from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { GraneteApiClient, GraneteApiError, type ProjectReceivable } from '@granete/storage';
import { formatPaymentMoney } from './ProjectPaymentsPanel';
import './payments.css';

export interface ReceivablesPanelProps {
  readonly baseUrl: string;
  readonly token: string;
  readonly queryKey: QueryKey;
  /** Customer account mode: only this customer's projects, settled ones included. */
  readonly customerId?: string;
  readonly onOpenProject?: (projectId: string) => void;
  /** Fixed «now» for tests. */
  readonly now?: Date;
}

export function receivableAgeDays(item: ProjectReceivable, now: Date): number | null {
  if (!item.acceptedAt) return null;
  const accepted = new Date(item.acceptedAt).getTime();
  if (Number.isNaN(accepted)) return null;
  return Math.max(0, Math.floor((now.getTime() - accepted) / 86_400_000));
}

/** Totals per currency; amounts in different currencies are never added. */
export function receivableTotalsByCurrency(items: readonly ProjectReceivable[]): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (item.balance <= 0) continue;
    totals.set(item.currency, Math.round(((totals.get(item.currency) ?? 0) + item.balance) * 100) / 100);
  }
  return totals;
}

export function ReceivablesPanel({
  baseUrl,
  token,
  queryKey,
  customerId,
  onOpenProject,
  now,
}: ReceivablesPanelProps): ReactNode {
  const api = useMemo(() => new GraneteApiClient(baseUrl), [baseUrl]);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.listProjectReceivables(token, signal),
    retry: false,
  });
  const today = now ?? new Date();
  const accountMode = customerId !== undefined;

  if (query.isPending) {
    return (
      <section className="payments-panel" data-testid="receivables-panel" aria-busy="true">
        <p className="payments-panel__muted">Cargando saldos…</p>
      </section>
    );
  }
  if (query.isError && !query.data) {
    const blocked = query.error instanceof GraneteApiError && query.error.status === 403;
    return (
      <section className="payments-panel" data-testid="receivables-panel">
        <p className="payments-panel__error" role="alert">
          {blocked ? 'No tenés permiso para ver los saldos por cobrar.' : 'No se pudieron cargar los saldos por cobrar.'}
        </p>
        {!blocked ? (
          <button type="button" className="btn btn--ghost btn--small" onClick={() => void query.refetch()}>
            Reintentar
          </button>
        ) : null}
      </section>
    );
  }

  const all = query.data!.items;
  const items = (accountMode ? all.filter((i) => i.customerId === customerId) : all.filter((i) => i.balance > 0))
    .slice()
    .sort((a, b) => (receivableAgeDays(b, today) ?? -1) - (receivableAgeDays(a, today) ?? -1));
  const totals = receivableTotalsByCurrency(items);

  return (
    <section
      className="payments-panel"
      data-testid={accountMode ? 'customer-account' : 'receivables-panel'}
      aria-label={accountMode ? 'Cuenta corriente' : 'Por cobrar'}
    >
      {query.isError ? (
        <p className="payments-panel__warning" role="status">
          No se pudo actualizar. Se muestran los últimos datos.
        </p>
      ) : null}
      {totals.size > 0 ? (
        <dl className="payments-panel__totals">
          {[...totals.entries()].map(([currency, total]) => (
            <div key={currency}>
              <dt>{accountMode ? 'Saldo del cliente' : 'Total por cobrar'}</dt>
              <dd data-testid={`receivables-total-${currency}`}>{formatPaymentMoney(total, currency)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {items.length === 0 ? (
        <p className="payments-panel__muted" data-testid="receivables-empty">
          {accountMode ? 'Este cliente no tiene obras con cotización aceptada.' : 'No hay saldos pendientes.'}
        </p>
      ) : (
        <table className="payments-panel__table" data-testid="receivables-table">
          <thead>
            <tr>
              <th scope="col">Obra</th>
              {accountMode ? null : <th scope="col">Cliente</th>}
              <th scope="col" className="payments-panel__num">
                Total
              </th>
              <th scope="col" className="payments-panel__num">
                Cobrado
              </th>
              <th scope="col" className="payments-panel__num">
                Saldo
              </th>
              <th scope="col" className="payments-panel__num">
                Días desde aceptación
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const age = receivableAgeDays(item, today);
              return (
                <tr key={item.projectId} data-testid={`receivable-row-${item.projectId}`}>
                  <td>
                    {onOpenProject ? (
                      <button type="button" className="btn btn--ghost btn--small" onClick={() => onOpenProject(item.projectId)}>
                        {item.projectName} · Q{item.quoteRevisionNumber}
                      </button>
                    ) : (
                      `${item.projectName} · Q${item.quoteRevisionNumber}`
                    )}
                  </td>
                  {accountMode ? null : <td>{item.customerName ?? '—'}</td>}
                  <td className="payments-panel__num">{formatPaymentMoney(item.saleTotal, item.currency)}</td>
                  <td className="payments-panel__num">{formatPaymentMoney(item.paidTotal, item.currency)}</td>
                  <td className={`payments-panel__num${item.balance > 0 ? ' payments-panel__due' : ''}`}>
                    {item.balance < 0
                      ? `A favor ${formatPaymentMoney(-item.balance, item.currency)}`
                      : formatPaymentMoney(item.balance, item.currency)}
                  </td>
                  <td className="payments-panel__num">{age === null ? '—' : age}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
