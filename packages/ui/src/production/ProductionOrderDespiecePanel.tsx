/**
 * Production hub — cut-list (despiece) read-only (PROD-1.3).
 */

import { useMemo, useState, type ReactNode } from 'react';
import type { ProductionCutRow } from '@muebles/domain';

export type ProductionOrderDespiecePanelProps = {
  readonly cutRows: readonly ProductionCutRow[] | null;
  readonly cutError?: string | null;
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

function pieceCode(row: ProductionCutRow, index: number): string {
  if (row.partCode?.trim()) {
    return row.moduleCode
      ? `${row.moduleCode}-${row.partCode}`
      : row.partCode;
  }
  if (row.labelRef?.trim()) return row.labelRef;
  return `P${index + 1}`;
}

export function ProductionOrderDespiecePanel({
  cutRows,
  cutError,
}: ProductionOrderDespiecePanelProps): ReactNode {
  const [groupBy, setGroupBy] = useState<GroupBy>('material');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!cutRows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [...cutRows];
    return cutRows.filter((r) => {
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
  }, [cutRows, query]);

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
                  ? 'prod-hub__tab prod-hub__tab--active'
                  : 'prod-hub__tab'
              }
              onClick={() => setGroupBy(id)}
              data-testid={`prod-despiece-group-${id}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="prod-modulos__count" data-testid="prod-despiece-count">
          {filtered.length} línea{filtered.length === 1 ? '' : 's'}
        </p>
      </div>

      {groups.map((g) => (
        <section key={g.key} className="prod-despiece__group-block">
          {groupBy !== 'none' ? (
            <h3 className="prod-hub__section-title">{g.label}</h3>
          ) : null}
          <div className="prod-modulos__table-wrap">
            <table className="prod-modulos__table">
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Cant.</th>
                  <th scope="col">L × A</th>
                  <th scope="col">Material</th>
                  <th scope="col">Cantos</th>
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
                      <td>{row.materialName}</td>
                      <td>{edgesLabel(row)}</td>
                      <td>{row.description}</td>
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
      </p>
    </div>
  );
}
