/**
 * Paperless floor mode — large touch-friendly cards (PROD-4.2 / #240).
 */

import { useMemo, useState, type ReactNode } from 'react';
import type { ItemFloorStatus, Module, Project } from '@muebles/domain';
import {
  ITEM_FLOOR_STATUSES,
  ITEM_FLOOR_STATUS_LABELS_ES,
  nextItemFloorStatus,
} from '@muebles/domain';
import { buildProductionModuleRows } from './productionModuleRows';

export type ProductionOrderPaperlessPanelProps = {
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly onSetFloorStatus?: (
    itemId: string,
    status: ItemFloorStatus,
  ) => void;
  readonly canSetFloorStatus?: boolean;
};

export function ProductionOrderPaperlessPanel({
  project,
  modules,
  onSetFloorStatus,
  canSetFloorStatus = false,
}: ProductionOrderPaperlessPanelProps): ReactNode {
  const [filter, setFilter] = useState<ItemFloorStatus | 'all'>('all');
  const rows = useMemo(
    () => buildProductionModuleRows(project, modules, null),
    [project, modules],
  );

  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => r.floorStatus === filter);
  }, [rows, filter]);

  return (
    <div className="prod-paperless" data-testid="prod-hub-piso">
      <p className="prod-hub__exports-hint">
        Modo piso — avance de fábrica con botones grandes. Sin editar diseño.
      </p>
      <div
        className="prod-paperless__filters"
        role="toolbar"
        aria-label="Filtrar por estado de piso"
      >
        <button
          type="button"
          className={
            filter === 'all'
              ? 'prod-hub__tab prod-hub__tab--active'
              : 'prod-hub__tab'
          }
          onClick={() => setFilter('all')}
          data-testid="prod-piso-filter-all"
        >
          Todos ({rows.length})
        </button>
        {ITEM_FLOOR_STATUSES.map((s) => {
          const n = rows.filter((r) => r.floorStatus === s).length;
          return (
            <button
              key={s}
              type="button"
              className={
                filter === s
                  ? 'prod-hub__tab prod-hub__tab--active'
                  : 'prod-hub__tab'
              }
              onClick={() => setFilter(s)}
              data-testid={`prod-piso-filter-${s}`}
            >
              {ITEM_FLOOR_STATUS_LABELS_ES[s]} ({n})
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="prod-hub__placeholder-body">
          No hay módulos en este filtro.
        </p>
      ) : (
        <ul className="prod-paperless__grid">
          {filtered.map((row) => {
            const next = nextItemFloorStatus(row.floorStatus);
            return (
              <li
                key={row.itemId}
                className="prod-paperless__card"
                data-testid={`prod-piso-card-${row.itemId}`}
              >
                <p className="prod-paperless__code">{row.factoryCode}</p>
                <p className="prod-paperless__name">{row.moduleName}</p>
                <p className="prod-paperless__meta">
                  ×{row.quantity} · {row.measuresLabel}
                </p>
                <p className="prod-paperless__status">
                  {ITEM_FLOOR_STATUS_LABELS_ES[row.floorStatus]}
                </p>
                {canSetFloorStatus && onSetFloorStatus && next ? (
                  <button
                    type="button"
                    className="btn btn--primary prod-paperless__advance"
                    data-testid={`prod-piso-advance-${row.itemId}`}
                    onClick={() => onSetFloorStatus(row.itemId, next)}
                  >
                    Marcar: {ITEM_FLOOR_STATUS_LABELS_ES[next]}
                  </button>
                ) : canSetFloorStatus && !next ? (
                  <p className="prod-modulos__muted">Completo</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
