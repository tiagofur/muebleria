/**
 * Production hub — cut-list (despiece) read-only (PROD-1.3).
 */

import { useMemo, useState, type ReactNode } from 'react';
import type { ProductionCutRow } from '@muebles/domain';
import { summarizeProductionTotals } from '@muebles/domain';

export type ProductionOrderDespiecePanelProps = {
  readonly cutRows: readonly ProductionCutRow[] | null;
  readonly cutError?: string | null;
  readonly onExportCsv?: () => void | Promise<void>;
  readonly exportBusy?: boolean;
};

type GroupBy = 'material' | 'module' | 'none';

function edgesLabel(row: ProductionCutRow): string {
  const parts: string[] = [];
  if (row.L1) parts.push('L1');
  if (row.L2) parts.push('L2');
  if (row.W1) parts.push('W1');
  if (row.W2) parts.push('W2');
  return parts.length > 0 ? parts.join('+') : '—';
}

function grainLabel(row: ProductionCutRow): string {
  return row.grain === 1 ? '↗' : '—';
}

function isFrontPiece(row: ProductionCutRow): boolean {
  const text = `${row.partCode ?? ''} ${row.partName ?? ''} ${row.description ?? ''}`.toLowerCase();
  return (
    text.includes('frente') ||
    text.includes('puerta') ||
    text.includes('tapa') ||
    text.includes('cajon') ||
    text.includes('cajón')
  );
}

function edgeCell(row: ProductionCutRow): ReactNode {
  const flags = edgesLabel(row);
  const band = row.edgeBandName
    ? `${row.edgeBandName}${row.edgeBandThicknessMm ? ` (${row.edgeBandThicknessMm}mm)` : ''}`
    : null;

  if (flags === '—' && !band) {
    return <span className="prod-modulos__muted">—</span>;
  }

  return (
    <div className="prod-despiece__edge-cell">
      <span className="prod-despiece__edge-flags">{flags}</span>
      {band ? <span className="prod-despiece__edge-band">{band}</span> : null}
    </div>
  );
}

type GroupTotals = {
  readonly lines: number;
  readonly units: number;
  readonly areaM2: number;
  readonly edgeMl: number;
};

function groupTotals(rows: readonly ProductionCutRow[]): GroupTotals {
  let units = 0;
  let areaMm2 = 0;
  for (const r of rows) {
    units += r.quantity;
    areaMm2 += r.lengthMm * r.widthMm * r.quantity;
  }
  const { totalEdgeMl } = summarizeProductionTotals(rows);
  return {
    lines: rows.length,
    units,
    areaM2: Math.round((areaMm2 / 1_000_000) * 100) / 100,
    edgeMl: totalEdgeMl,
  };
}

function totalsLabel(totals: GroupTotals): string {
  const parts = [
    `${totals.lines} línea${totals.lines === 1 ? '' : 's'}`,
    `${totals.units} pieza${totals.units === 1 ? '' : 's'}`,
    `${totals.areaM2.toLocaleString('es-MX')} m²`,
  ];
  if (totals.edgeMl > 0) parts.push(`${totals.edgeMl.toLocaleString('es-MX')} ml canto`);
  return parts.join(' · ');
}

function pieceCode(row: ProductionCutRow, index: number): string {
  if (row.labelRef?.trim() && !row.labelRef.includes('copy-') && !row.labelRef.includes('/')) {
    return row.labelRef.trim();
  }
  if (row.partCode?.trim() && !row.partCode.includes('copy-')) {
    return row.moduleCode
      ? `${row.moduleCode}-${row.partCode.trim()}`
      : row.partCode.trim();
  }
  const prefix = row.moduleCode ? `${row.moduleCode}-` : '';
  return `${prefix}P${String(index + 1).padStart(2, '0')}`;
}

export function ProductionOrderDespiecePanel({
  cutRows,
  cutError,
  onExportCsv,
  exportBusy = false,
}: ProductionOrderDespiecePanelProps): ReactNode {
  const [groupBy, setGroupBy] = useState<GroupBy>('material');
  const [query, setQuery] = useState('');
  const [onlyFronts, setOnlyFronts] = useState(false);

  const filtered = useMemo(() => {
    if (!cutRows) return [];
    let list = cutRows;
    if (onlyFronts) {
      list = list.filter(isFrontPiece);
    }
    const q = query.trim().toLowerCase();
    if (!q) return [...list];
    return list.filter((r) => {
      const hay = [
        r.description,
        r.materialName,
        r.moduleCode,
        r.partCode,
        r.partName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [cutRows, query, onlyFronts]);

  const groups = useMemo(() => {
    if (groupBy === 'none') {
      return [{ key: 'all', label: 'Todas las piezas', rows: filtered }];
    }
    const map = new Map<string, ProductionCutRow[]>();
    for (const row of filtered) {
      const key =
        groupBy === 'material'
          ? row.materialName || 'Sin material'
          : row.moduleCode || 'Sin módulo';
      const arr = map.get(key) ?? [];
      arr.push(row);
      map.set(key, arr);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'es'))
      .map(([key, rows]) => ({ key, label: key, rows }));
  }, [filtered, groupBy]);

  if (cutRows === null) {
    return (
      <div className="prod-despiece" data-testid="prod-hub-despiece">
        <p className="prod-hub__ready-banner prod-hub__ready-banner--blocked">
          {cutError || 'No se pudo resolver el despiece de corte.'}
        </p>
      </div>
    );
  }

  if (cutRows.length === 0) {
    return (
      <div className="prod-despiece" data-testid="prod-hub-despiece">
        <p className="prod-hub__placeholder-body">
          No hay piezas de tablero. Revisá módulos y opciones en cotización.
        </p>
      </div>
    );
  }

  let globalIndex = 0;

  return (
    <div className="prod-despiece" data-testid="prod-hub-despiece">
      <div className="prod-modulos__toolbar">
        <label className="prod-modulos__search">
          <span className="sr-only">Buscar en despiece</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar material, módulo, pieza…"
            data-testid="prod-despiece-search"
          />
        </label>
        <div className="prod-despiece__group" role="group" aria-label="Agrupar por">
          {(
            [
              ['material', 'Material'],
              ['module', 'Módulo'],
              ['none', 'Lista'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={
                groupBy === id
                  ? 'tab-btn tab-btn--active'
                  : 'tab-btn'
              }
              onClick={() => setGroupBy(id)}
              data-testid={`prod-despiece-group-${id}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="prod-labels__check prod-despiece__fronts-check">
          <input
            type="checkbox"
            checked={onlyFronts}
            onChange={(e) => setOnlyFronts(e.target.checked)}
            data-testid="prod-despiece-filter-fronts"
          />
          <span>Solo frentes</span>
        </label>
        <p className="prod-modulos__count" data-testid="prod-despiece-count">
          {filtered.length} línea{filtered.length === 1 ? '' : 's'}
        </p>
        {onExportCsv ? (
          <button
            type="button"
            className="btn"
            disabled={exportBusy || cutRows.length === 0}
            onClick={() => {
              void onExportCsv();
            }}
            data-testid="prod-despiece-export-csv"
          >
            Exportar CSV
          </button>
        ) : null}
      </div>

      {groups.map((g) => (
        <section key={g.key} className="prod-despiece__group-block">
          {groupBy !== 'none' ? (
            <h3 className="prod-hub__section-title">
              {g.label}
              <span
                className="prod-despiece__group-totals"
                data-testid={`prod-despiece-totals-${g.key}`}
              >
                {' '}
                · {totalsLabel(groupTotals(g.rows))}
              </span>
            </h3>
          ) : null}
          <div className="prod-modulos__table-wrap">
            <table className="prod-modulos__table" data-testid="prod-despiece-table">
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Cant.</th>
                  <th scope="col">L × A</th>
                  <th scope="col">Espesor</th>
                  <th scope="col">Material</th>
                  <th scope="col">Cantos</th>
                  <th scope="col">Veta</th>
                  <th scope="col">Descripción</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((row) => {
                  const idx = globalIndex++;
                  return (
                    <tr key={`${g.key}-${idx}-${row.description}`}>
                      <td>
                        <code className="prod-modulos__code">
                          {pieceCode(row, idx)}
                        </code>
                      </td>
                      <td>{row.quantity}</td>
                      <td>
                        {row.lengthMm}×{row.widthMm}
                      </td>
                      <td>
                        {row.thicknessMm ? `${row.thicknessMm} mm` : <span className="prod-modulos__muted">—</span>}
                      </td>
                      <td>{row.materialName}</td>
                      <td>{edgeCell(row)}</td>
                      <td aria-label={row.grain === 1 ? 'con veta' : 'sin veta'}>
                        {grainLabel(row)}
                      </td>
                      <td>
                        <div className="prod-despiece__desc-cell">
                          <span className="prod-despiece__desc-name">{row.partName || row.description}</span>
                          {groupBy !== 'module' && row.moduleCode ? (
                            <span className="prod-despiece__desc-mod">{row.moduleCode}</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <p className="prod-modulos__footnote">
        Solo lectura. Misma población de piezas que el Optimizer (sin herrajes).
        Cantos: lados L1/L2 (largos) y W1/W2 (anchos). Veta ↗ = respetar
        dirección del grano.
      </p>
    </div>
  );
}
