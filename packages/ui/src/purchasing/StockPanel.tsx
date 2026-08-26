/**
 * StockPanel — tab Compras (Fase 3b): saldos reales por material con alertas
 * de mínimos, recepción/salida/ajuste y edición del mínimo. Reemplaza el
 * placeholder "Próximamente" (diseño 06-stock-almacen.md §4).
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  PackageMinus,
  PackagePlus,
  Search,
  SlidersHorizontal,
  Boxes,
} from 'lucide-react';
import {
  stockStatus,
  stockUnitLabel,
  stockUnitPlural,
  stockValue,
  STOCK_KIND_LABELS_ES,
  STOCK_MOVEMENT_LABELS_ES,
  STOCK_STATUS_LABELS_ES,
  type MaterialStock,
  type StockMaterialKind,
  type StockMovement,
  type StockMovementType,
} from '@granete/domain';
import { EmptyState, formatMoneyDisplay, WorkspaceTabs } from '../common';
import { StockMovementModal } from './StockMovementModal';

export type StockCatalogOption = { readonly id: string; readonly label: string };

export type StockPanelProps = {
  readonly stock: readonly MaterialStock[];
  readonly movements?: readonly StockMovement[] | null;
  /** `${kind}:${materialId}` → display label (resuelto por el shell con el catálogo). */
  readonly labels: Readonly<Record<string, string>>;
  readonly catalogOptions: ReadonlyArray<{
    kind: StockMaterialKind;
    items: readonly StockCatalogOption[];
  }>;
  readonly canEdit: boolean;
  readonly onRecordMovement: (payload: {
    kind: StockMaterialKind;
    materialId: string;
    type: StockMovementType;
    quantity: number;
    note?: string;
  }) => Promise<void>;
  readonly onSetMin: (payload: {
    kind: StockMaterialKind;
    materialId: string;
    minStock: number;
  }) => Promise<void>;
  /**
   * `${kind}:${materialId}` → precio unitario del catálogo (costPerUnit /
   * boardPrice / costPerMl). Necesario para las columnas de costo (Fase 3c).
   */
  readonly prices?: Readonly<Record<string, number>>;
  /**
   * Cost visibility (COST-01/02): cuando es false se omiten las columnas de
   * costo y el total de inventario. Default false.
   */
  readonly showCosts?: boolean;
  /** Código de moneda para el total (default MXN, como formatMoneyDisplay). */
  readonly currency?: string;
};

type FilterId = 'todos' | 'bajo' | 'agotado';

type ModalState = {
  type: StockMovementType;
  kind?: StockMaterialKind;
  materialId?: string;
} | null;

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

export function StockPanel({
  stock,
  movements = null,
  labels,
  catalogOptions,
  canEdit,
  onRecordMovement,
  onSetMin,
  prices = {},
  showCosts = false,
  currency,
}: StockPanelProps): ReactNode {
  const [filter, setFilter] = useState<FilterId>('todos');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState>(null);

  const counts = useMemo(() => {
    let bajo = 0;
    let agotado = 0;
    for (const row of stock) {
      const s = stockStatus(row.quantity, row.minStock);
      if (s === 'bajo') bajo += 1;
      if (s === 'agotado') agotado += 1;
    }
    return { bajo, agotado };
  }, [stock]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return stock.filter((row) => {
      const status = stockStatus(row.quantity, row.minStock);
      if (filter === 'bajo' && status !== 'bajo') return false;
      if (filter === 'agotado' && status !== 'agotado') return false;
      if (needle) {
        const label = labels[`${row.kind}:${row.materialId}`] ?? row.materialId;
        if (!label.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
  }, [stock, filter, search, labels]);

  const lastMovementFor = (kind: StockMaterialKind, materialId: string): StockMovement | undefined =>
    (movements ?? []).find(
      (m) => m.kind === kind && m.materialId === materialId && m.type !== 'despacho',
    ) ?? (movements ?? []).find((m) => m.kind === kind && m.materialId === materialId);

  /** Valor de inventario por fila (null = sin precio en catálogo). */
  const valueFor = (row: MaterialStock): number | null =>
    stockValue(row.quantity, prices[`${row.kind}:${row.materialId}`]);

  const totalValue = useMemo(
    () =>
      stock.reduce((sum, row) => {
        const v = valueFor(row);
        return v == null ? sum : sum + v;
      }, 0),
    // valueFor closes over prices/stock — recompute when those change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stock, prices],
  );

  if (stock.length === 0) {
    return (
      <div className="purch-panel__stock-empty">
        <EmptyState
          icon={Boxes}
          title="Sin stock cargado"
          description={
            canEdit
              ? 'Recibí materiales para empezar a llevar inventario real.'
              : 'Todavía no hay stock cargado para mostrar.'
          }
        />
        {canEdit ? (
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={() => setModal({ type: 'entrada' })}
            data-testid="purch-stock-receive-first"
          >
            <PackagePlus size={14} strokeWidth={1.5} aria-hidden />
            Recibir stock
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="purch-stock">
      {counts.bajo > 0 || counts.agotado > 0 ? (
        <div
          className="purch-stock__alert"
          data-testid="purch-stock-alert"
        >
          <AlertTriangle size={16} strokeWidth={1.5} aria-hidden />
          <span>
            {counts.bajo} {counts.bajo === 1 ? 'material' : 'materiales'} bajo mínimo
            {counts.agotado > 0 ? (
              <>
                {' '}
                · {counts.agotado} {counts.agotado === 1 ? 'agotado' : 'agotados'}
              </>
            ) : null}
          </span>
        </div>
      ) : null}

      <div className="purch-stock__toolbar">
        <WorkspaceTabs
          tabs={[
            { id: 'todos', label: 'Todos' },
            { id: 'bajo', label: 'Bajo mínimo' },
            { id: 'agotado', label: 'Agotados' },
          ]}
          activeTab={filter}
          onTabChange={setFilter}
          ariaLabel="Filtros de stock"
          idPrefix="purch-stock"
          testIdPrefix="purch-stock"
        />
        <label className="purch-stock__search">
          <Search size={14} strokeWidth={1.5} aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar material…"
            aria-label="Buscar material"
            data-testid="purch-stock-search"
          />
        </label>
        {canEdit ? (
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={() => setModal({ type: 'entrada' })}
            data-testid="purch-stock-receive"
          >
            <PackagePlus size={14} strokeWidth={1.5} aria-hidden />
            Recibir stock
          </button>
        ) : null}
      </div>

      <div
        className="purch-stock__table-wrap"
        id={`purch-stock-panel-${filter}`}
        role="tabpanel"
        aria-labelledby={`purch-stock-tab-${filter}`}
      >
        <table className="purch-stock__table" data-testid="purch-stock-table">
          <thead>
            <tr>
              <th>Material</th>
              <th>Unidad</th>
              <th>Stock</th>
              <th>Mínimo</th>
              <th>Estado</th>
              <th>Último</th>
              {showCosts ? (
                <>
                  <th className="purch-stock__num">Costo</th>
                  <th className="purch-stock__num">Valor</th>
                </>
              ) : null}
              {canEdit ? <th className="purch-stock__actions-col">Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const status = stockStatus(row.quantity, row.minStock);
              const unit = stockUnitLabel(row.kind, undefined);
              const label = labels[`${row.kind}:${row.materialId}`] ?? row.materialId;
              const last = lastMovementFor(row.kind, row.materialId);
              const value = valueFor(row);
              return (
                <tr key={`${row.kind}:${row.materialId}`} data-testid={`purch-stock-row-${row.kind}-${row.materialId}`}>
                  <td>
                    <span className="purch-stock__name">{label}</span>
                    <span className="purch-stock__kind">{STOCK_KIND_LABELS_ES[row.kind]}</span>
                  </td>
                  <td>{unit}</td>
                  <td className="purch-stock__qty">
                    {formatQty(row.quantity)} {stockUnitPlural(unit, row.quantity)}
                  </td>
                  <td>
                    {canEdit ? (
                      <input
                        type="number"
                        min={0}
                        step="any"
                        defaultValue={row.minStock}
                        className="purch-stock__min-input"
                        aria-label={`Mínimo de ${label}`}
                        data-testid={`purch-stock-min-${row.kind}-${row.materialId}`}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (
                            Number.isFinite(v) &&
                            v >= 0 &&
                            v !== row.minStock
                          ) {
                            void onSetMin({
                              kind: row.kind,
                              materialId: row.materialId,
                              minStock: v,
                            });
                          }
                        }}
                      />
                    ) : (
                      formatQty(row.minStock)
                    )}
                  </td>
                  <td>
                    <span
                      className={`status-badge status-badge--${status === 'ok' ? 'done' : status}`}
                      data-testid={`purch-stock-status-${row.kind}-${row.materialId}`}
                    >
                      {STOCK_STATUS_LABELS_ES[status]}
                    </span>
                  </td>
                  <td className="purch-stock__last">
                    {last
                      ? `${STOCK_MOVEMENT_LABELS_ES[last.type]} · ${formatDate(last.at)}`
                      : '—'}
                  </td>
                  {showCosts ? (
                    <>
                      <td className="purch-stock__num" data-testid={`purch-stock-cost-${row.materialId}`}>
                        {value == null
                          ? '—'
                          : formatMoneyDisplay(prices[`${row.kind}:${row.materialId}`]!, {
                              showCurrency: false,
                            })}
                      </td>
                      <td className="purch-stock__num" data-testid={`purch-stock-value-${row.materialId}`}>
                        {value == null
                          ? '—'
                          : formatMoneyDisplay(value, { showCurrency: false })}
                      </td>
                    </>
                  ) : null}
                  {canEdit ? (
                    <td className="purch-stock__actions">
                      <button
                        type="button"
                        className="btn btn--secondary btn--small"
                        onClick={() =>
                          setModal({ type: 'entrada', kind: row.kind, materialId: row.materialId })
                        }
                        data-testid={`purch-stock-action-entrada-${row.materialId}`}
                      >
                        <PackagePlus size={12} strokeWidth={1.5} aria-hidden />
                        Recibir
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary btn--small"
                        onClick={() =>
                          setModal({ type: 'salida', kind: row.kind, materialId: row.materialId })
                        }
                        data-testid={`purch-stock-action-salida-${row.materialId}`}
                      >
                        <PackageMinus size={12} strokeWidth={1.5} aria-hidden />
                        Salida
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary btn--small"
                        onClick={() =>
                          setModal({ type: 'ajuste', kind: row.kind, materialId: row.materialId })
                        }
                        data-testid={`purch-stock-action-ajuste-${row.materialId}`}
                      >
                        <SlidersHorizontal size={12} strokeWidth={1.5} aria-hidden />
                        Ajustar
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 ? (
          <p className="purch-stock__no-results">Sin materiales para este filtro.</p>
        ) : null}
        {showCosts ? (
          <div className="purch-stock__total" data-testid="purch-stock-total">
            <span>Valor total del inventario</span>
            <strong>{formatMoneyDisplay(totalValue, { currency })}</strong>
          </div>
        ) : null}
      </div>

      {modal ? (
        <StockMovementModal
          type={modal.type}
          initialKind={modal.kind}
          initialMaterialId={modal.materialId}
          catalogOptions={catalogOptions}
          labels={labels}
          onClose={() => setModal(null)}
          onSubmit={onRecordMovement}
        />
      ) : null}
    </div>
  );
}
