/**
 * Production hub — hardware picking list (PROD-1.4).
 */

import type { ReactNode } from 'react';
import type { HardwarePurchaseRow } from '@muebles/domain';
import { Wrench } from 'lucide-react';

export type ProductionOrderHardwarePanelProps = {
  readonly rows: readonly HardwarePurchaseRow[] | null;
  readonly error?: string | null;
  readonly onExportHardware?: () => void | Promise<void>;
  readonly exportBusy?: boolean;
  /** When true, hide unit costs (COST-01). */
  readonly hideCosts?: boolean;
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
            className="btn btn--primary"
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
        <div className="prod-modulos__table-wrap">
          <table className="prod-modulos__table" data-testid="prod-herrajes-table">
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Descripción</th>
                <th scope="col">Cant.</th>
                <th scope="col">Compra</th>
                <th scope="col">Unidad</th>
                {!hideCosts ? <th scope="col">Costo línea</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.hardwareId}>
                  <td>
                    <code className="prod-modulos__code">{row.code}</code>
                  </td>
                  <td>{row.description}</td>
                  <td>{formatQty(row.quantity)}</td>
                  <td>{formatQty(row.purchaseQuantity)}</td>
                  <td>{row.unit}</td>
                  {!hideCosts ? (
                    <td>{row.lineCost.toFixed(2)}</td>
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
