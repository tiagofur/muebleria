/**
 * Production hub — modules inventory (PROD-0.4) + floor status (PROD-3.1).
 * Design remains read-only; floor status is factory-only mutation.
 */

import { useMemo, useState, type ReactNode } from 'react';
import type {
  ItemFloorStatus,
  Module,
  Project,
  ProductionCutRow,
} from '@muebles/domain';
import {
  ITEM_FLOOR_STATUSES,
  ITEM_FLOOR_STATUS_LABELS_ES,
} from '@muebles/domain';
import { Search } from 'lucide-react';
import { buildProductionModuleRows } from './productionModuleRows';

export type ProductionOrderModulesPanelProps = {
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly cutRows: readonly ProductionCutRow[] | null;
  /** Factory roles only — mutates floorStatus, not design. */
  readonly onSetFloorStatus?: (
    itemId: string,
    status: ItemFloorStatus,
  ) => void;
  readonly canSetFloorStatus?: boolean;
};

export function ProductionOrderModulesPanel({
  project,
  modules,
  cutRows,
  onSetFloorStatus,
  canSetFloorStatus = false,
}: ProductionOrderModulesPanelProps): ReactNode {
  const [query, setQuery] = useState('');
  const rows = useMemo(
    () => buildProductionModuleRows(project, modules, cutRows),
    [project, modules, cutRows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.factoryCode.toLowerCase().includes(q) ||
        r.moduleName.toLowerCase().includes(q) ||
        r.moduleCode.toLowerCase().includes(q) ||
        (r.placementLabel?.toLowerCase().includes(q) ?? false),
    );
  }, [rows, query]);

  const unplacedCount = rows.filter((r) => r.unplaced).length;

  return (
    <div className="prod-modulos" data-testid="prod-hub-modulos">
      <div className="prod-modulos__toolbar">
        <label className="prod-modulos__search">
          <Search size={16} strokeWidth={1.5} aria-hidden />
          <span className="sr-only">Buscar módulos</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por código o nombre…"
            data-testid="prod-modulos-search"
          />
        </label>
        <p className="prod-modulos__count" data-testid="prod-modulos-count">
          {filtered.length} de {rows.length} línea
          {rows.length === 1 ? '' : 's'}
          {unplacedCount > 0 ? (
            <span className="prod-modulos__unplaced-hint">
              {' '}
              · {unplacedCount} sin colocar
            </span>
          ) : null}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="prod-hub__placeholder-body">
          Esta orden no tiene muebles. Revisá la cotización.
        </p>
      ) : filtered.length === 0 ? (
        <p className="prod-hub__placeholder-body" data-testid="prod-modulos-empty-filter">
          Ningún módulo coincide con la búsqueda.
        </p>
      ) : (
        <div className="prod-modulos__table-wrap">
          <table className="prod-modulos__table" data-testid="prod-modulos-table">
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Módulo</th>
                <th scope="col">Cant.</th>
                <th scope="col">Medidas</th>
                <th scope="col">Ubicación</th>
                <th scope="col">Piezas</th>
                <th scope="col">Piso</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.itemId}
                  data-testid={`prod-modulo-row-${row.itemId}`}
                  className={
                    row.unplaced ? 'prod-modulos__row--unplaced' : undefined
                  }
                >
                  <td>
                    <code className="prod-modulos__code">{row.factoryCode}</code>
                  </td>
                  <td>
                    <span className="prod-modulos__name">{row.moduleName}</span>
                    <span className="prod-modulos__code-sub">{row.moduleCode}</span>
                  </td>
                  <td data-testid={`prod-modulo-qty-${row.itemId}`}>
                    {row.quantity}
                  </td>
                  <td>{row.measuresLabel}</td>
                  <td>
                    {row.placementLabel == null ? (
                      <span className="prod-modulos__muted">—</span>
                    ) : row.unplaced ? (
                      <span className="prod-modulos__badge-warn">Sin colocar</span>
                    ) : (
                      row.placementLabel
                    )}
                  </td>
                  <td>
                    {row.pieceCount > 0 ? (
                      row.pieceCount
                    ) : (
                      <span className="prod-modulos__muted">—</span>
                    )}
                  </td>
                  <td>
                    {canSetFloorStatus && onSetFloorStatus ? (
                      <select
                        className="prod-modulos__floor-select"
                        value={row.floorStatus}
                        aria-label={`Estado de piso ${row.factoryCode}`}
                        data-testid={`prod-floor-status-${row.itemId}`}
                        onChange={(e) => {
                          onSetFloorStatus(
                            row.itemId,
                            e.target.value as ItemFloorStatus,
                          );
                        }}
                      >
                        {ITEM_FLOOR_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {ITEM_FLOOR_STATUS_LABELS_ES[s]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span data-testid={`prod-floor-label-${row.itemId}`}>
                        {ITEM_FLOOR_STATUS_LABELS_ES[row.floorStatus]}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="prod-modulos__footnote">
        Medidas y opciones: solo lectura (editar en cotización). Estado de piso:
        progreso de fábrica, no cambia el BOM.
      </p>
    </div>
  );
}
