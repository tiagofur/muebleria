/**
 * EngineeringWorkspace — Tabbed workspace for a single project's engineering.
 *
 * Tabs: Resumen, Módulos, Despiece, Etiquetas, Herrajes, Vistas, Optimización, Documentos.
 * Documentos has all download buttons (Pack ZIP, Optimizer, CSV, etc.).
 *
 * Reuses existing production panels where possible; the Resumen tab
 * is extracted from ProductionOrderHub's inline code.
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  FileSpreadsheet,
  Layers,
  LayoutGrid,
  Printer,
  Ruler,
} from 'lucide-react';

import './engineering.css';
import '../production/production.css';

import {
  summarizeProductionTotals,
  type Project,
  type Module,
  type Catalog,
  type ProductionCutRow,
  type PieceLabel,
  type ModuleLabel,
  type HardwarePurchaseRow,
  type NestingImportResult,
} from '@muebles/domain';
import type { Module3DCatalogInput } from '../modules/module3dPreview';
import type { ProductionOrderReadiness } from '../production/productionOrderModel';
import { ProductionOrderModulesPanel } from '../production/ProductionOrderModulesPanel';
import { ProductionOrderDespiecePanel } from '../production/ProductionOrderDespiecePanel';
import { ProductionOrderViewsPanel } from '../production/ProductionOrderViewsPanel';
import { ProductionOrderOptimizationPanel } from '../production/ProductionOrderOptimizationPanel';
import { ProductionOrderDocumentsPanel } from '../production/ProductionOrderDocumentsPanel';
import type { ProductionDocumentItem } from '../production/ProductionOrderDocumentsPanel';
import { ProductionOrderLabelsPanel } from '../production/ProductionOrderLabelsPanel';
import { ProductionOrderHardwarePanel } from '../production/ProductionOrderHardwarePanel';

/* ── Tab model ──────────────────────────────────────────────────────────── */

const ENGINEERING_TABS = [
  'resumen',
  'modulos',
  'despiece',
  'etiquetas',
  'herrajes',
  'vistas',
  'optimizacion',
  'documentos',
] as const;

type EngineeringTab = (typeof ENGINEERING_TABS)[number];

const TAB_LABELS: Readonly<Record<EngineeringTab, string>> = {
  resumen: 'Resumen',
  modulos: 'Módulos',
  despiece: 'Despiece',
  etiquetas: 'Etiquetas',
  herrajes: 'Herrajes',
  vistas: 'Vistas',
  optimizacion: 'Optimización',
  documentos: 'Documentos',
};

/* ── CheckRow (extracted from Hub) ──────────────────────────────────────── */

function CheckRow({
  ok,
  label,
  detail,
  warn,
}: {
  readonly ok: boolean;
  readonly label: string;
  readonly detail?: string;
  readonly warn?: boolean;
}) {
  return (
    <li className="eng-check-row">
      {ok ? (
        <CheckCircle2 size={16} strokeWidth={1.5} className="eng-check-row__icon eng-check-row__icon--ok" />
      ) : (
        <Circle size={16} strokeWidth={1.5} className="eng-check-row__icon eng-check-row__icon--pending" />
      )}
      <div className="eng-check-row__content">
        <span className={`eng-check-row__label ${ok ? '' : 'eng-check-row__label--pending'}`}>
          {label}
          {warn ? (
            <span style={{ color: 'hsl(38 80% 40%)', marginLeft: '0.35rem', fontSize: '0.72rem' }}>⚠</span>
          ) : null}
        </span>
        {detail ? (
          <span className="eng-check-row__detail">{detail}</span>
        ) : null}
      </div>
    </li>
  );
}

/* ── Resumen tab ──────────────────────────────────────────────────────────── */

function ResumenTab({
  readiness,
  cutRows,
}: {
  readonly readiness: ProductionOrderReadiness;
  readonly cutRows: readonly ProductionCutRow[] | null;
}) {
  const totals = useMemo(
    () => (cutRows && cutRows.length > 0 ? summarizeProductionTotals(cutRows) : null),
    [cutRows],
  );

  return (
    <div className="eng-resumen">
      {/* Totals row */}
      <div className="eng-resumen__totals" aria-label="Totales de fábrica">
        <div className="eng-resumen__stat">
          <span className="eng-resumen__stat-icon eng-resumen__stat-icon--modules">
            <LayoutGrid size={18} strokeWidth={1.5} />
          </span>
          <div className="eng-resumen__stat-body">
            <span className="eng-resumen__stat-value">{readiness.moduleUnitCount}</span>
            <span className="eng-resumen__stat-label">
              {readiness.moduleUnitCount === 1 ? 'módulo' : 'módulos'}
              <span className="eng-resumen__stat-sub"> ({readiness.moduleLineCount} líneas)</span>
            </span>
          </div>
        </div>
        <div className="eng-resumen__stat">
          <span className="eng-resumen__stat-icon eng-resumen__stat-icon--pieces">
            <FileSpreadsheet size={18} strokeWidth={1.5} />
          </span>
          <div className="eng-resumen__stat-body">
            <span className="eng-resumen__stat-value">
              {cutRows && cutRows.length > 0 ? readiness.cutRowCount : '—'}
            </span>
            <span className="eng-resumen__stat-label">piezas de tablero</span>
          </div>
        </div>
        <div className="eng-resumen__stat">
          <span className="eng-resumen__stat-icon eng-resumen__stat-icon--area">
            <Layers size={18} strokeWidth={1.5} />
          </span>
          <div className="eng-resumen__stat-body">
            <span className="eng-resumen__stat-value">
              {totals ? totals.totalAreaM2.toLocaleString('es-MX') : '—'}
            </span>
            <span className="eng-resumen__stat-label">m² de tablero</span>
          </div>
        </div>
        <div className="eng-resumen__stat">
          <span className="eng-resumen__stat-icon eng-resumen__stat-icon--edge">
            <Ruler size={18} strokeWidth={1.5} />
          </span>
          <div className="eng-resumen__stat-body">
            <span className="eng-resumen__stat-value">
              {totals ? totals.totalEdgeMl.toLocaleString('es-MX') : '—'}
            </span>
            <span className="eng-resumen__stat-label">ml de canto</span>
          </div>
        </div>
      </div>

      {/* Material breakdown */}
      {totals && (totals.materials.length > 0 || totals.edges.length > 0) ? (
        <div className="eng-resumen__breakdown">
          {totals.materials.length > 0 ? (
            <div className="eng-resumen__breakdown-col">
              <h4 className="eng-resumen__breakdown-title">Tablero</h4>
              <ul className="eng-resumen__breakdown-list">
                {totals.materials.slice(0, 6).map((m) => (
                  <li key={m.key}>
                    <span className="eng-resumen__breakdown-material">{m.name}</span>
                    <span className="eng-resumen__breakdown-num">
                      {m.areaM2.toLocaleString('es-MX')} m²
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {totals.edges.length > 0 ? (
            <div className="eng-resumen__breakdown-col">
              <h4 className="eng-resumen__breakdown-title">Canto</h4>
              <ul className="eng-resumen__breakdown-list">
                {totals.edges.slice(0, 6).map((e) => (
                  <li key={e.key}>
                    <span className="eng-resumen__breakdown-material">{e.name}</span>
                    <span className="eng-resumen__breakdown-num">
                      {e.ml.toLocaleString('es-MX')} ml
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Readiness checklist */}
      <div className="eng-resumen__checklist-block">
        <h3 className="eng-resumen__checklist-title">Listo para cortar</h3>
        <ul className="eng-resumen__checklist">
          <CheckRow
            ok={readiness.cutListOk}
            label="BOM / cut-list válido"
            detail={readiness.cutListOk ? undefined : (readiness.cutListError ?? undefined)}
          />
          <CheckRow
            ok={readiness.materialsResolved}
            label="Materiales resueltos"
            detail={
              readiness.materialsResolved
                ? `${readiness.cutRowCount} piezas de tablero`
                : 'Sin piezas de tablero para exportar'
            }
          />
          <CheckRow
            ok={readiness.hasKitchenLayout ? readiness.hasPlacements : true}
            warn={readiness.hasUnplacedItems}
            label={
              readiness.hasKitchenLayout
                ? 'Layout de cocina'
                : 'Layout de cocina (opcional)'
            }
            detail={
              !readiness.hasKitchenLayout
                ? 'Sin muros — obra lineal o solo despiece'
                : readiness.hasUnplacedItems
                  ? 'Hay muebles sin colocar en el layout'
                  : `${readiness.hasPlacements ? 'Con placements' : 'Sin placements'}`
            }
          />
          <CheckRow
            ok={readiness.optimizerGenerable}
            label="Optimizer generable"
            detail={
              readiness.optimizerGenerable
                ? 'Plantilla_Optimizer.xlsx listo'
                : 'Bloqueado hasta tener despiece válido'
            }
          />
          <CheckRow
            ok={readiness.packGenerable}
            label="Pack descargable"
            detail={
              readiness.packGenerable
                ? 'Núcleo Optimizer disponible'
                : 'Requiere despiece de corte'
            }
          />
        </ul>

        {/* Ready banner */}
        {readiness.readyToCut ? (
          <div className="eng-resumen__banner eng-resumen__banner--ready">
            <CheckCircle2 size={18} strokeWidth={1.5} />
            Listo para generar pack y mandar a corte.
          </div>
        ) : (
          <div className="eng-resumen__banner eng-resumen__banner--blocked">
            Falta resolver el despiece antes de cortar.
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main workspace ─────────────────────────────────────────────────────── */

export function EngineeringWorkspace({
  project,
  modules,
  catalog,
  catalog3d,
  cutRows,
  cutError,
  readiness,
  labels,
  labelsError,
  moduleLabels,
  moduleLabelsError,
  hardwareRows,
  hardwareError,
  customerLabel,
  onBack,
  resolveMediaUrl,
  // Export callbacks
  onExportCsv,
  onExportPdf,
  onExportModulePdf,
  onExportHardware,
  onExportElevations,
  onExportOptimizer,
  onExportProductionPack,
  onExportCutListCsv,
  onExportPieceLabels,
  onExportModuleLabels,
  onImportNesting,
  // Permissions
  canImportNesting,
  exportBusy,
}: {
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly catalog: Catalog | null;
  readonly catalog3d?: Module3DCatalogInput | null;
  readonly cutRows: readonly ProductionCutRow[] | null;
  readonly cutError?: string | null;
  readonly readiness: ProductionOrderReadiness;
  readonly labels: readonly PieceLabel[] | null;
  readonly labelsError?: string | null;
  readonly moduleLabels?: readonly ModuleLabel[] | null;
  readonly moduleLabelsError?: string | null;
  readonly hardwareRows: readonly HardwarePurchaseRow[] | null;
  readonly hardwareError?: string | null;
  readonly customerLabel?: string;
  readonly onBack: () => void;
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
  readonly onExportCsv?: () => void | Promise<void>;
  readonly onExportPdf?: (labels: readonly PieceLabel[], perUnit: boolean) => void | Promise<void>;
  readonly onExportModulePdf?: (labels: readonly ModuleLabel[]) => void | Promise<void>;
  readonly onExportHardware?: () => void | Promise<void>;
  readonly onExportElevations?: () => void | Promise<void>;
  readonly onExportOptimizer?: () => void | Promise<void>;
  readonly onExportProductionPack?: () => void | Promise<void>;
  readonly onExportCutListCsv?: () => void | Promise<void>;
  readonly onExportPieceLabels?: (labels: readonly PieceLabel[], options: { perUnit: boolean }) => void | Promise<void>;
  readonly onExportModuleLabels?: (labels: readonly ModuleLabel[]) => void | Promise<void>;
  readonly onImportNesting?: (nesting: NestingImportResult) => void;
  readonly canImportNesting?: boolean;
  readonly exportBusy?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<EngineeringTab>('resumen');

  // Build documents list for the Documentos tab.
  const documents: readonly ProductionDocumentItem[] = useMemo(() => [
    {
      id: 'pack',
      label: 'Pack de producción (ZIP)',
      hint: 'Optimizer + herrajes + etiquetas PDF y ZPL + resumen + elevaciones + despiece',
      available: readiness.packGenerable && Boolean(onExportProductionPack),
      reason: 'Requiere despiece de corte válido',
      onDownload: onExportProductionPack,
    },
    {
      id: 'optimizer',
      label: 'Optimizer (Excel)',
      hint: 'Plan de corte Plantilla_Optimizer.xlsx',
      available: readiness.optimizerGenerable,
      reason: 'Requiere despiece válido',
      onDownload: onExportOptimizer,
    },
    {
      id: 'cutlist-csv',
      label: 'Cut-list CSV',
      hint: 'CSV genérico (separador ;) para sierra/CNC/terceros',
      available: readiness.materialsResolved && Boolean(onExportCutListCsv),
      reason: 'Requiere piezas de tablero',
      onDownload: onExportCutListCsv,
    },
    {
      id: 'hardware',
      label: 'Lista de herrajes',
      hint: 'Picking / compras (.xlsx)',
      available: Boolean(onExportHardware),
      onDownload: onExportHardware,
    },
    {
      id: 'elevations',
      label: 'Elevaciones por muro (PDF)',
      hint: 'Alzados con códigos y medidas',
      available: Boolean(onExportElevations),
      reason: 'Sin muros en el layout de cocina',
      onDownload: onExportElevations,
    },
    {
      id: 'despiece',
      label: 'Despiece (ver tab)',
      hint: 'Lista de piezas en la pestaña Despiece',
      available: readiness.materialsResolved,
      reason: 'Sin piezas de tablero',
      actionLabel: 'Ver tab',
      onDownload: () => setActiveTab('despiece'),
    },
  ], [readiness, onExportProductionPack, onExportOptimizer, onExportCutListCsv, onExportHardware, onExportElevations]);

  return (
    <section className="eng-workspace" aria-label={`Ingeniería — ${project.name}`}>
      {/* Header */}
      <header className="eng-workspace__header">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          <ArrowLeft size={16} strokeWidth={1.5} />
          Volver
        </button>
        <div className="eng-workspace__header-info">
          <h2 className="eng-workspace__title">{project.name}</h2>
          {customerLabel ? (
            <span className="eng-workspace__customer">{customerLabel}</span>
          ) : null}
        </div>
      </header>

      {/* Tab bar */}
      <nav className="tab-bar" role="tablist" aria-label="Tabs de ingeniería">
        <div className="tab-bar__inner">
          {ENGINEERING_TABS.map((tab) => {
            const isActive = tab === activeTab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`eng-panel-${tab}`}
                id={`eng-tab-${tab}`}
                className={`tab-btn ${isActive ? 'tab-btn--active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Tab panel */}
      <div
        className="eng-workspace__panel"
        role="tabpanel"
        id={`eng-panel-${activeTab}`}
        aria-labelledby={`eng-tab-${activeTab}`}
      >
        {activeTab === 'resumen' && (
          <ResumenTab readiness={readiness} cutRows={cutRows} />
        )}
        {activeTab === 'modulos' && (
          <ProductionOrderModulesPanel
            project={project}
            modules={modules}
            cutRows={cutRows}
          />
        )}
        {activeTab === 'despiece' && (
          <div className="eng-despiece">
            <ProductionOrderDespiecePanel
              cutRows={cutRows}
              cutError={cutError}
              onExportCsv={onExportCsv}
              exportBusy={exportBusy}
            />
            {/* Imprimir A4 button */}
            <div className="eng-despiece__print">
              <button
                type="button"
                className="btn btn--small"
                onClick={onExportCsv}
                disabled={exportBusy}
              >
                <Printer size={14} strokeWidth={1.5} />
                Imprimir A4
              </button>
            </div>
          </div>
        )}
        {activeTab === 'etiquetas' && (
          <ProductionOrderLabelsPanel
            project={project}
            labels={labels}
            labelsError={labelsError}
            moduleLabels={moduleLabels}
            moduleLabelsError={moduleLabelsError}
            onExportPdf={onExportPdf}
            onExportModulePdf={onExportModulePdf}
            exportBusy={exportBusy}
          />
        )}
        {activeTab === 'herrajes' && (
          <ProductionOrderHardwarePanel
            rows={hardwareRows}
            error={hardwareError}
            onExportHardware={onExportHardware}
            exportBusy={exportBusy}
          />
        )}
        {activeTab === 'vistas' && catalog3d && (
          <ProductionOrderViewsPanel
            project={project}
            modules={modules}
            catalog={catalog3d}
            resolveMediaUrl={resolveMediaUrl}
            onExportElevations={onExportElevations}
            exportBusy={exportBusy}
          />
        )}
        {activeTab === 'optimizacion' && (
          <ProductionOrderOptimizationPanel
            project={project}
            catalog={catalog}
            cutRows={cutRows}
            onImportNesting={onImportNesting}
            exportBusy={exportBusy}
            canImportNesting={canImportNesting}
          />
        )}
        {activeTab === 'documentos' && (
          <ProductionOrderDocumentsPanel
            documents={documents}
            exportBusy={exportBusy}
          />
        )}
      </div>
    </section>
  );
}
