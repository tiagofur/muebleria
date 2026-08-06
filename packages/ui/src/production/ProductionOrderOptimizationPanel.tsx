/**
 * Production hub — Optimización L0 / L1 / L2 (PROD-2.1 + PROD-2.3).
 * Clear layer labels so estimate is never confused with machine nesting.
 */

import { useMemo, type ReactNode } from 'react';
import type {
  BoardSheetEstimate,
  MaterialBoard,
  Project,
  ProductionCutRow,
} from '@muebles/domain';
import {
  estimateBoardSheets,
  generateProjectMaterialSummary,
  nestingImportFromRows,
  parseNestingImportCsv,
  type Catalog,
  type NestingImportResult,
} from '@muebles/domain';
import { FileSpreadsheet } from 'lucide-react';
import { ProductionBoardView } from './ProductionBoardView';

export type ProductionOrderOptimizationPanelProps = {
  readonly project: Project;
  readonly catalog: Catalog | null;
  readonly cutRows: readonly ProductionCutRow[] | null;
  readonly onExportOptimizer?: () => void | Promise<void>;
  readonly onImportNesting?: (nesting: NestingImportResult) => void;
  readonly exportBusy?: boolean;
  /** When true, production role may import nesting (mutates project). */
  readonly canImportNesting?: boolean;
};

function LayerBadge({
  layer,
  label,
}: {
  readonly layer: 'L0' | 'L1' | 'L2';
  readonly label: string;
}): ReactNode {
  return (
    <span className={`prod-opt__badge prod-opt__badge--${layer.toLowerCase()}`}>
      {layer} · {label}
    </span>
  );
}

function groupCutRowsByMaterial(
  rows: readonly ProductionCutRow[],
): Map<string, ProductionCutRow[]> {
  const map = new Map<string, ProductionCutRow[]>();
  for (const row of rows) {
    const key = row.materialName || 'Sin material';
    const arr = map.get(key) ?? [];
    arr.push(row);
    map.set(key, arr);
  }
  return map;
}

function sheetSizeForMaterial(
  materialName: string,
  sheets: readonly BoardSheetEstimate[],
  materials: readonly MaterialBoard[],
): { w: number; h: number } {
  const byName = sheets.find(
    (s) => s.name === materialName || s.code === materialName,
  );
  if (byName && byName.sheetWidthMm > 0 && byName.sheetLengthMm > 0) {
    return { w: byName.sheetWidthMm, h: byName.sheetLengthMm };
  }
  const mat = materials.find(
    (m) => m.name === materialName || m.code === materialName,
  );
  if (mat && mat.widthMm > 0 && mat.lengthMm > 0) {
    return { w: mat.widthMm, h: mat.lengthMm };
  }
  return { w: 2440, h: 1220 };
}

export function ProductionOrderOptimizationPanel({
  project,
  catalog,
  cutRows,
  onExportOptimizer,
  onImportNesting,
  exportBusy = false,
  canImportNesting = false,
}: ProductionOrderOptimizationPanelProps): ReactNode {
  const summary = useMemo(() => {
    if (!catalog) return null;
    try {
      return generateProjectMaterialSummary(project, catalog);
    } catch {
      return null;
    }
  }, [project, catalog]);

  const sheetEstimates = useMemo(() => {
    if (!summary || !catalog) return [];
    return estimateBoardSheets(
      summary.materials,
      catalog.materials,
    ).filter((s) => s.estimatedSheets > 0);
  }, [summary, catalog]);

  const byMaterial = useMemo(
    () => (cutRows ? groupCutRowsByMaterial(cutRows) : new Map()),
    [cutRows],
  );

  const nesting = project.nestingImport;

  return (
    <div className="prod-opt" data-testid="prod-hub-optimizacion">
      <p className="prod-hub__exports-hint">
        Capas de optimización. El plan de corte oficial sigue siendo el{' '}
        <strong>Optimizer Excel</strong> (export abajo).
      </p>

      {/* L0 — estimated sheets */}
      <section
        className="prod-opt__layer"
        data-testid="prod-opt-l0"
        aria-label="Pliegos estimados"
      >
        <div className="prod-opt__layer-head">
          <LayerBadge layer="L0" label="Pliegos estimados" />
        </div>
        <p className="prod-opt__disclaimer">
          Estimado — nesting real en software de corte
        </p>
        {!catalog || sheetEstimates.length === 0 ? (
          <p className="prod-hub__placeholder-body">
            Sin datos de área de tablero para estimar pliegos.
          </p>
        ) : (
          <ul className="prod-opt__list">
            {sheetEstimates.map((s) => (
              <li key={s.materialId}>
                <span className="prod-opt__name">{s.name}</span>
                <span className="prod-opt__meta">
                  ~{s.estimatedSheets} pliego
                  {s.estimatedSheets === 1 ? '' : 's'}
                  {s.sheetWidthMm > 0
                    ? ` · ${s.sheetWidthMm}×${s.sheetLengthMm} mm`
                    : ''}
                  {s.wastePercent > 0 ? ` · merma cat. ${s.wastePercent}%` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* L1 — visual board preview */}
      <section
        className="prod-opt__layer"
        data-testid="prod-opt-l1"
        aria-label="Preview visual de tableros"
      >
        <div className="prod-opt__layer-head">
          <LayerBadge layer="L1" label="Preview de tableros" />
        </div>
        <p className="prod-opt__disclaimer">
          Preview estimada (empaquetado simple) — no es el plan de máquina ni
          reemplaza el Optimizer
        </p>
        {!cutRows || cutRows.length === 0 ? (
          <p className="prod-hub__placeholder-body">
            Sin piezas de corte para previsualizar.
          </p>
        ) : (
          <div className="prod-opt__boards">
            {[...byMaterial.entries()].map(([materialName, rows]) => {
              const size = sheetSizeForMaterial(
                materialName,
                sheetEstimates,
                catalog?.materials ?? [],
              );
              return (
                <div key={materialName} className="prod-opt__board-block">
                  <h4 className="prod-opt__board-title">{materialName}</h4>
                  <ProductionBoardView
                    rows={rows}
                    sheetWidthMm={size.w}
                    sheetHeightMm={size.h}
                    showEstimateMetrics
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* L2 — nesting import */}
      <section
        className="prod-opt__layer"
        data-testid="prod-opt-l2"
        aria-label="Import nesting real"
      >
        <div className="prod-opt__layer-head">
          <LayerBadge layer="L2" label="Import nesting (real)" />
        </div>
        <p className="prod-opt__disclaimer">
          Consumo real del software de corte del taller (CSV)
        </p>
        {nesting && nesting.rows.length > 0 ? (
          <div data-testid="prod-opt-nesting-data">
            <p className="prod-vistas__hint">
              {nesting.sourceName ?? 'CSV'} ·{' '}
              {new Date(nesting.importedAt).toLocaleString()}
            </p>
            <ul className="prod-opt__list">
              {nesting.rows.map((r) => (
                <li key={r.materialCode}>
                  <span className="prod-opt__name">{r.materialCode}</span>
                  <span className="prod-opt__meta">
                    {r.sheetsUsed} pliego
                    {r.sheetsUsed === 1 ? '' : 's'}
                    {r.areaM2 != null ? ` · ${r.areaM2} m²` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="prod-hub__placeholder-body">
            Todavía no hay import de nesting en esta orden.
          </p>
        )}
        {canImportNesting && onImportNesting ? (
          <label className="btn" style={{ cursor: 'pointer', alignSelf: 'flex-start' }}>
            Importar nesting (CSV)
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              style={{ display: 'none' }}
              data-testid="prod-opt-nesting-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                void file.text().then((text) => {
                  const rows = parseNestingImportCsv(text);
                  if (rows.length === 0) return;
                  onImportNesting(
                    nestingImportFromRows(
                      rows,
                      new Date().toISOString(),
                      file.name,
                    ),
                  );
                });
              }}
            />
          </label>
        ) : null}
        <p className="catalog-form__hint">
          Columnas: material_code, sheets_used [, area_m2]
        </p>
      </section>

      {/* Official cut plan */}
      <section className="prod-opt__layer prod-opt__layer--official">
        <h3 className="prod-hub__section-title">Plan de corte oficial</h3>
        <p className="prod-vistas__hint">
          Plantilla_Optimizer.xlsx — fuente de verdad para la sierra / nesting
          externo.
        </p>
        {onExportOptimizer ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={exportBusy || !cutRows || cutRows.length === 0}
            onClick={() => {
              void onExportOptimizer();
            }}
            data-testid="prod-opt-export-optimizer"
          >
            <FileSpreadsheet size={16} strokeWidth={1.5} aria-hidden />
            Exportar Optimizer
          </button>
        ) : null}
      </section>
    </div>
  );
}
