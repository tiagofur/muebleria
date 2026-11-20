/**
 * #1651 — historial de precio de un recurso del catálogo (más nuevo primero),
 * con la fecha real del cambio, el origen (porcentaje o lista) y la nota.
 */
import { useMemo, type ReactNode } from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { GraneteApiClient, type PriceResourceKind } from '@granete/storage';
import './prices.css';

export interface PriceHistoryPanelProps {
  readonly baseUrl: string;
  readonly token: string;
  readonly kind: PriceResourceKind;
  readonly resourceId: string;
  readonly queryKey: QueryKey;
}

function money(v: number): string {
  return v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PriceHistoryPanel({ baseUrl, token, kind, resourceId, queryKey }: PriceHistoryPanelProps): ReactNode {
  const api = useMemo(() => new GraneteApiClient(baseUrl), [baseUrl]);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.getCatalogPriceHistory(token, kind, resourceId, signal),
    retry: false,
  });
  if (query.isPending) return <p className="bulk-prices__muted">Cargando historial…</p>;
  if (query.isError) return <p className="bulk-prices__error" role="alert">No se pudo cargar el historial de precio.</p>;
  const entries = query.data.entries;
  if (entries.length === 0) {
    return (
      <p className="bulk-prices__muted" data-testid="price-history-empty">
        Sin cambios masivos de precio registrados.
      </p>
    );
  }
  return (
    <ul className="price-history" data-testid="price-history">
      {entries.map((e) => (
        <li key={`${e.batchId}-${e.changedAt}`}>
          <span>{new Date(e.changedAt).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
          <span className="bulk-prices__num">
            {money(e.oldPrice)} → {money(e.newPrice)}
          </span>
          <span className="bulk-prices__muted">
            {e.source === 'percent' ? 'Ajuste %' : 'Lista importada'}
            {e.note ? ` · ${e.note}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
