/**
 * Production hub — Optimización L0 / L1 / L2 (PROD-2.1 + PROD-2.3).
 * Clear layer labels so estimate is never confused with machine nesting.
 */

import { useMemo, useState, type ReactNode } from 'react';
import type {
  BoardSheetEstimate,
  MaterialBoard,
  Project,
  ProductionCutRow,
} from '@muebles/domain';
import {
  estimateBoardSheets,
  generatePartDrillingData,
  generateProjectMaterialSummary,
  nestingImportFromRows,
  parseNestingImportCsv,
  type Catalog,
  type NestingImportResult,
} from '@muebles/domain';
import { Binary, FileSpreadsheet, FileText, QrCode } from 'lucide-react';
import type { PieceLabel } from '@muebles/domain';
import { ProductionBoardView } from './ProductionBoardView';
import { ZplLabelPreviewModal } from './ZplLabelPreviewModal';
import { CsvExportConfigModal } from './CsvExportConfigModal';

export type ProductionOrderOptimizationPanelProps = {
  readonly project: Project;
  readonly catalog: Catalog | null;
  readonly cutRows: readonly ProductionCutRow[] | null;
  readonly onExportOptimizer?: () => void | Promise<void>;
  readonly onExportCutPreviewPdf?: () => void | Promise<void>;
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
  onExportCutPreviewPdf,
  onImportNesting,
  exportBusy = false,
  canImportNesting = false,
}: ProductionOrderOptimizationPanelProps): ReactNode {
  /** null = use catalog waste; number = what-if override (PROD-4.3). */
  const [wasteWhatIf, setWasteWhatIf] = useState<number | null>(null);
  const [isZplModalOpen, setIsZplModalOpen] = useState(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);

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
      wasteWhatIf,
    ).filter((s) => s.estimatedSheets > 0);
  }, [summary, catalog, wasteWhatIf]);

  const byMaterial = useMemo(
    () => (cutRows ? groupCutRowsByMaterial(cutRows) : new Map()),
    [cutRows],
  );

  const pieceLabels = useMemo<PieceLabel[]>(() => {
    if (!cutRows) return [];
    return cutRows.map((r) => {
      const l1 = Boolean(r.L1);
      const l2 = Boolean(r.L2);
      const w1 = Boolean(r.W1);
      const w2 = Boolean(r.W2);
      const sides =
        [
          l1 ? 'L1' : null,
          l2 ? 'L2' : null,
          w1 ? 'W1' : null,
          w2 ? 'W2' : null,
        ]
          .filter(Boolean)
          .join('+') || 'Sin encintar';
      return {
        partCode: r.partCode,
        description: r.partName || r.description,
        moduleCode: r.moduleCode || 'MOD',
        moduleName: r.moduleCode || 'Módulo',
        materialCode: r.materialName,
        materialName: r.materialName,
        lengthMm: r.lengthMm,
        widthMm: r.widthMm,
        quantity: r.quantity,
        L1: l1,
        L2: l2,
        W1: w1,
        W2: w2,
        edgeBandingInstruction: sides,
      };
    });
  }, [cutRows]);

  const nesting = project.nestingImport;

  return (
    <div className="prod-opt" data-testid="prod-hub-optimizacion">
      <div className="prod-opt__intro">
        <p className="prod-hub__exports-hint">
          Tres capas de información. Solo el <strong>Optimizer Excel</strong>{' '}
          (abajo) es el plan de corte oficial para la sierra o el nesting del
          taller.
        </p>
        <ul className="prod-opt__legend" aria-label="Leyenda de capas">
          <li>
            <LayerBadge layer="L0" label="Estimado" /> cuántos pliegos comprar
            (heurística)
          </li>
          <li>
            <LayerBadge layer="L1" label="Preview" /> cómo se ven las piezas en
            un tablero (no es nesting real)
          </li>
          <li>
            <LayerBadge layer="L2" label="Real" /> consumo importado del
            software de corte
          </li>
        </ul>
      </div>

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
          Solo para comprar material. No usés este número para programar la
          máquina: el nesting real se hace afuera (o en L2 si ya importaste).
        </p>
        <label className="prod-opt__whatif" data-testid="prod-opt-waste-whatif">
          <span>Probar otra merma (%)</span>
          <input
            type="range"
            min={0}
            max={30}
            step={1}
            value={wasteWhatIf ?? 10}
            onChange={(e) => setWasteWhatIf(Number(e.target.value))}
            aria-label="Merma what-if porcentaje"
          />
          <span className="prod-opt__whatif-val">
            {wasteWhatIf == null ? 'catálogo' : `${wasteWhatIf}%`}
          </span>
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={() => setWasteWhatIf(null)}
            data-testid="prod-opt-waste-catalog"
          >
            Usar merma catálogo
          </button>
        </label>
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
                  {` · merma ${s.wastePercent}%`}
                  {wasteWhatIf != null ? ' (what-if)' : ' (cat.)'}
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
          Vista aproximada (piezas en rectángulos, empaquetado simple). Sirve
          para revisar tamaños y códigos — <strong>no</strong> es el plan de
          máquina ni sustituye el Optimizer.
        </p>
        {!cutRows || cutRows.length === 0 ? (
          <p className="prod-hub__placeholder-body">
            Sin piezas de corte para previsualizar. Revisá el despiece o el
            BOM en cotización.
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
          Resultado real del optimizador externo del taller. Comparalo con L0
          para ver si compraste de más o de menos.
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
        <h3 className="prod-hub__section-title">Plan de corte oficial y etiquetas</h3>
        <p className="prod-vistas__hint">
          <strong>Plantilla_Optimizer.xlsx</strong> y etiquetas térmicas ZPL para impresora Zebra.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
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
          {onExportCutPreviewPdf ? (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={exportBusy || !cutRows || cutRows.length === 0}
              onClick={() => {
                void onExportCutPreviewPdf();
              }}
              data-testid="prod-opt-export-cut-preview-pdf"
            >
              <FileText size={16} strokeWidth={1.5} aria-hidden />
              Preview Corte Visual (PDF)
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--secondary"
            disabled={!cutRows || cutRows.length === 0}
            onClick={() => setIsCsvModalOpen(true)}
            data-testid="prod-opt-export-csv-configurable"
          >
            <FileSpreadsheet size={16} strokeWidth={1.5} aria-hidden />
            CSV Configurable
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={!cutRows || cutRows.length === 0}
            onClick={() => {
              if (!cutRows || cutRows.length === 0) return;
              const data = generatePartDrillingData({ project, cutRows });
              const content = JSON.stringify(data, null, 2);
              const safeName = project.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
              const blob = new Blob([content], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `perforaciones_${safeName}.json`;
              link.click();
              URL.revokeObjectURL(url);
            }}
            data-testid="prod-opt-export-drilling-json"
          >
            <Binary size={16} strokeWidth={1.5} aria-hidden />
            Perforaciones (JSON)
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={!cutRows || cutRows.length === 0}
            onClick={() => setIsZplModalOpen(true)}
            data-testid="prod-opt-export-zpl"
          >
            <QrCode size={16} strokeWidth={1.5} aria-hidden />
            Etiquetas ZPL (Zebra)
          </button>
        </div>
      </section>

      <ZplLabelPreviewModal
        isOpen={isZplModalOpen}
        onClose={() => setIsZplModalOpen(false)}
        labels={pieceLabels}
        projectName={project.name}
      />

      <CsvExportConfigModal
        isOpen={isCsvModalOpen}
        onClose={() => setIsCsvModalOpen(false)}
        cutRows={cutRows ?? []}
        projectName={project.name}
      />
    </div>
  );
}

