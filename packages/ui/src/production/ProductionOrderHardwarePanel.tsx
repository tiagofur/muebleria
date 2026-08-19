/**
 * Production hub — hardware picking list (PROD-1.4).
 */

import type { ReactNode } from 'react';
import type { HardwarePurchaseRow } from '@muebles/domain';
import { Wrench } from 'lucide-react';
import { formatMoneyDisplay } from '../common/formatMoneyDisplay';

export type ProductionOrderHardwarePanelProps = {
  readonly rows: readonly HardwarePurchaseRow[] | null;
  readonly error?: string | null;
  readonly onExportHardware?: () => void | Promise<void>;
  readonly exportBusy?: boolean;
  /** When true, hide unit costs (COST-01). */
  readonly hideCosts?: boolean;
  /** Project currency for money display (default MXN, design.md §7.2). */
  readonly currency?: string;
  /**
   * Export as the tab's primary action. The hub chrome owns the primary when
   * it renders a pack button — pass false then (design.md §8).
   */
  readonly exportAsPrimary?: boolean;
};

function formatQty(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

export function ProductionOrderHardwarePanel({
  rows,
  error,
  onExportHardware,
  exportBusy = false,
  hideCosts = false,
  currency = 'MXN',
  exportAsPrimary = true,
}: ProductionOrderHardwarePanelProps): ReactNode {
  return (
    <div className="prod-herrajes" data-testid="prod-hub-herrajes">
      <div className="prod-modulos__toolbar">
        <p className="prod-modulos__count" data-testid="prod-herrajes-count">
          {rows ? `${rows.length} línea${rows.length === 1 ? '' : 's'}` : '—'}
        </p>
        {onExportHardware ? (
          <button
            type="button"
            className={exportAsPrimary ? 'btn btn--primary' : 'btn'}
            disabled={exportBusy || !rows || rows.length === 0}
            onClick={() => {
              void onExportHardware();
            }}
            data-testid="prod-herrajes-export"
          >
            <Wrench size={16} strokeWidth={1.5} aria-hidden />
            Exportar herrajes
          </button>
        ) : null}
      </div>

      {rows === null ? (
        <p className="prod-hub__ready-banner prod-hub__ready-banner--blocked">
          {error || 'No se pudo resolver la lista de herrajes.'}
        </p>
      ) : rows.length === 0 ? (
        <p className="prod-hub__placeholder-body">
          No hay herrajes en esta orden.
        </p>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table" data-testid="prod-herrajes-table">
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Descripción</th>
                <th scope="col" className="prod-herrajes__num">
                  Cant.
                </th>
                <th scope="col" className="prod-herrajes__num">
                  Compra
                </th>
                <th scope="col">Unidad</th>
                {!hideCosts ? (
                  <th scope="col" className="prod-herrajes__num">
                    Costo línea
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.hardwareId}>
                  <td>
                    <code className="prod-modulos__code">{row.code}</code>
                  </td>
                  <td>{row.description}</td>
                  <td className="prod-herrajes__num">{formatQty(row.quantity)}</td>
                  <td className="prod-herrajes__num">
                    {formatQty(row.purchaseQuantity)}
                  </td>
                  <td>{row.unit}</td>
                  {!hideCosts ? (
                    <td className="prod-herrajes__num">
                      {formatMoneyDisplay(row.lineCost, { currency })}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="prod-modulos__footnote">
        Lista de picking / compras. Solo lectura del diseño.
      </p>
    </div>
  );
}
