/**
 * Paperless floor mode — large touch-friendly cards (PROD-4.2 / #240).
 * QR scan: piece-label payload v2 (or plain code) jumps to the module.
 */

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { ItemFloorStatus, Module, Project } from '@muebles/domain';
import {
  ITEM_FLOOR_STATUSES,
  ITEM_FLOOR_STATUS_LABELS_ES,
  nextItemFloorStatus,
} from '@muebles/domain';
import { ScanLine } from 'lucide-react';
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

export type ProductionModuleRow = ReturnType<
  typeof buildProductionModuleRows
>[number];

/**
 * A scanner gun types the QR payload and presses Enter. Payload v2 carries
 * `module`; anything else falls back to plain-text code search.
 */
export function matchModuleFromScan(
  scan: string,
  rows: readonly ProductionModuleRow[],
): ProductionModuleRow | null {
  const text = scan.trim();
  if (!text) return null;
  let moduleCode: string | null = null;
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { module?: unknown };
      if (typeof parsed.module === 'string' && parsed.module) {
        moduleCode = parsed.module;
      }
    } catch {
      moduleCode = null;
    }
  }
  const needle = (moduleCode ?? text).toLowerCase();
  return (
    rows.find((r) => r.moduleCode.toLowerCase() === needle) ??
    rows.find((r) => r.factoryCode.toLowerCase() === needle) ??
    rows.find(
      (r) =>
        r.factoryCode.toLowerCase().includes(needle) ||
        r.moduleCode.toLowerCase().includes(needle) ||
        r.moduleName.toLowerCase().includes(needle),
    ) ??
    null
  );
}

export function ProductionOrderPaperlessPanel({
  project,
  modules,
  onSetFloorStatus,
  canSetFloorStatus = false,
}: ProductionOrderPaperlessPanelProps): ReactNode {
  const [filter, setFilter] = useState<ItemFloorStatus | 'all'>('all');
  const [scan, setScan] = useState('');
  const [scanMatchId, setScanMatchId] = useState<string | null>(null);
  const [scanMiss, setScanMiss] = useState(false);
  const rows = useMemo(
    () => buildProductionModuleRows(project, modules, null),
    [project, modules],
  );

  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => r.floorStatus === filter);
  }, [rows, filter]);

  const scanMatch = scanMatchId
    ? (rows.find((r) => r.itemId === scanMatchId) ?? null)
    : null;

  const handleScanSubmit = (e: FormEvent) => {
    e.preventDefault();
    const match = matchModuleFromScan(scan, rows);
    if (match) {
      setScanMatchId(match.itemId);
      setScanMiss(false);
      setFilter('all');
    } else {
      setScanMatchId(null);
      setScanMiss(true);
    }
    setScan('');
  };

  const advanceScanned = () => {
    if (!scanMatch) return;
    const next = nextItemFloorStatus(scanMatch.floorStatus);
    if (!next || !onSetFloorStatus) return;
    onSetFloorStatus(scanMatch.itemId, next);
    setScanMatchId(null);
  };

  return (
    <div className="prod-paperless" data-testid="prod-hub-piso">
      <p className="prod-hub__exports-hint">
        Modo piso — avance de fábrica con botones grandes. Sin editar diseño.
      </p>

      <form
        className="prod-paperless__scan"
        onSubmit={handleScanSubmit}
        data-testid="prod-piso-scan-form"
      >
        <ScanLine size={18} strokeWidth={1.5} aria-hidden />
        <label className="prod-paperless__scan-label" htmlFor="prod-piso-scan">
          Escaneá el QR de una etiqueta o tipeá el código del mueble
        </label>
        <input
          id="prod-piso-scan"
          type="text"
          className="prod-modulos__floor-select prod-paperless__scan-input"
          value={scan}
          onChange={(e) => {
            setScan(e.target.value);
            setScanMiss(false);
          }}
          placeholder="MOD-03, MOD-03-LAT o payload QR…"
          data-testid="prod-piso-scan-input"
        />
        <button
          type="submit"
          className="btn btn--small"
          disabled={!scan.trim()}
          data-testid="prod-piso-scan-submit"
        >
          Buscar
        </button>
      </form>

      {scanMatch ? (
        <div
          className="prod-paperless__scan-result"
          data-testid="prod-piso-scan-result"
          role="status"
        >
          <span>
            <strong>{scanMatch.factoryCode}</strong> · {scanMatch.moduleName} —{' '}
            {ITEM_FLOOR_STATUS_LABELS_ES[scanMatch.floorStatus]}
          </span>
          {canSetFloorStatus &&
          nextItemFloorStatus(scanMatch.floorStatus) ? (
            <button
              type="button"
              className="btn btn--small btn--primary"
              onClick={advanceScanned}
              data-testid="prod-piso-scan-advance"
            >
              Marcar:{' '}
              {ITEM_FLOOR_STATUS_LABELS_ES[
                nextItemFloorStatus(scanMatch.floorStatus)!
              ]}
            </button>
          ) : null}
        </div>
      ) : scanMiss ? (
        <p
          className="catalog-form__error"
          role="alert"
          data-testid="prod-piso-scan-miss"
        >
          Código no reconocido en esta obra.
        </p>
      ) : null}

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
                className={
                  row.itemId === scanMatchId
                    ? 'prod-paperless__card prod-paperless__card--scan'
                    : 'prod-paperless__card'
                }
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
