/**
 * EngineeringWorkspace — Tabbed workspace for a single project's engineering.
 *
 * Tabs: Resumen, Módulos, Despiece, Etiquetas, Herrajes, Vistas, Optimización, Documentos.
 * Documentos has all download buttons (Pack ZIP, Optimizer, CSV, etc.).
 *
 * Reuses existing production panels where possible; the Resumen tab
 * is extracted to EngineeringResumenTab.
 */

import { useState, type ReactNode } from 'react';
import { ArrowLeft, FileCheck, Printer, Send } from 'lucide-react';

import './engineering.css';
import '../production/production.css';

import {
  canSendToProduction,
  engineeringStatus,
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
import { WorkspaceTabs } from '../common/Tabs';
import type { ProductionOrderReadiness } from '../production/productionOrderModel';
import { ProductionOrderModulesPanel } from '../production/ProductionOrderModulesPanel';
import { ProductionOrderDespiecePanel } from '../production/ProductionOrderDespiecePanel';
import { ProductionOrderViewsPanel } from '../production/ProductionOrderViewsPanel';
import { ProductionOrderOptimizationPanel } from '../production/ProductionOrderOptimizationPanel';
import { ProductionOrderDocumentsPanel } from '../production/ProductionOrderDocumentsPanel';
import { ProductionOrderLabelsPanel } from '../production/ProductionOrderLabelsPanel';
import { ProductionOrderHardwarePanel } from '../production/ProductionOrderHardwarePanel';
import { EngineeringResumenTab } from './components/EngineeringResumenTab';
import { useEngineeringDocuments } from './components/useEngineeringDocuments';

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
  onExportModuleLabels: _onExportModuleLabels,
  onExportAssemblySheets,
  onExportCncPilot,
  onExportDespiecePdf,
  onSaveCutPlan,
  onExportCutPlanPdf,
  onImportNesting: _onImportNesting,
  // Permissions
  canImportNesting: _canImportNesting,
  exportBusy,
  onSendToProduction,
  onMarkDocumented,
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
  readonly onExportPdf?: (
    labels: readonly PieceLabel[],
    perUnit: boolean,
  ) => void | Promise<void>;
  readonly onExportModulePdf?: (
    labels: readonly ModuleLabel[],
  ) => void | Promise<void>;
  readonly onExportHardware?: () => void | Promise<void>;
  readonly onExportElevations?: () => void | Promise<void>;
  readonly onExportOptimizer?: () => void | Promise<void>;
  readonly onExportProductionPack?: () => void | Promise<void>;
  readonly onExportCutListCsv?: () => void | Promise<void>;
  readonly onExportPieceLabels?: (
    labels: readonly PieceLabel[],
    options: { perUnit: boolean },
  ) => void | Promise<void>;
  readonly onExportModuleLabels?: (
    labels: readonly ModuleLabel[],
  ) => void | Promise<void>;
  readonly onExportAssemblySheets?: () => void | Promise<void>;
  readonly onExportCncPilot?: () => void | Promise<void>;
  readonly onExportDespiecePdf?: () => void | Promise<void>;
  readonly onSaveCutPlan?: (cutPlan: import('@muebles/domain').CutPlan) => void;
  readonly onExportCutPlanPdf?: (
    cutPlan: import('@muebles/domain').CutPlan,
  ) => void | Promise<void>;
  readonly onImportNesting?: (nesting: NestingImportResult) => void;
  readonly canImportNesting?: boolean;
  readonly exportBusy?: boolean;
  /**
   * roadmap-screens 2a.15 — the engineering→factory handshake. Button is
   * rendered for accepted projects; the shell stamps the engineering log
   * (sentToProductionBy/At + revision) and transitions to produced.
   */
  readonly onSendToProduction?: () => void;
  readonly onMarkDocumented?: () => void;
}): ReactNode {
  const [activeTab, setActiveTab] = useState<EngineeringTab>('resumen');

  const documents = useEngineeringDocuments({
    readiness,
    labels,
    moduleLabels,
    onExportProductionPack,
    onExportOptimizer,
    onExportCutListCsv,
    onExportHardware,
    onExportElevations,
    onExportPieceLabels,
    onExportModulePdf,
    onExportAssemblySheets,
    onExportCncPilot,
    onNavigateToTab: (tabId) => setActiveTab(tabId as EngineeringTab),
  });

  return (
    <section
      className="eng-workspace"
      aria-label={`Ingeniería — ${project.name}`}
    >
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
        {project.status === 'accepted' && onSendToProduction ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={onSendToProduction}
            disabled={!canSendToProduction(project)}
            data-testid="eng-send-to-production"
            title={
              canSendToProduction(project)
                ? 'Registra el envío en el log de ingeniería (quién/cuándo/rev.) y pasa la obra a Almacén'
                : 'Primero marcá la ingeniería como documentada (generar documentos)'
            }
          >
            <Send size={16} strokeWidth={1.5} aria-hidden />
            Enviar a Producción
          </button>
        ) : null}
        {engineeringStatus(project.engineeringLog) === 'in_progress' &&
        onMarkDocumented ? (
          <button
            type="button"
            className="btn btn--small"
            onClick={onMarkDocumented}
            data-testid="eng-mark-documented"
            title="Marca la ingeniería como documentada (quién/cuándo)"
          >
            <FileCheck size={14} strokeWidth={1.5} aria-hidden />
            Marcar documentado
          </button>
        ) : null}
      </header>

      {/* Tab bar */}
      <WorkspaceTabs
        tabs={ENGINEERING_TABS.map((tab) => ({
          id: tab,
          label: TAB_LABELS[tab],
        }))}
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab as EngineeringTab)}
        ariaLabel="Tabs de ingeniería"
        idPrefix="eng"
        testIdPrefix="eng"
      />

      {/* Tab panel */}
      <div
        className="eng-workspace__panel"
        role="tabpanel"
        id={`eng-panel-${activeTab}`}
        aria-labelledby={`eng-tab-${activeTab}`}
      >
        {activeTab === 'resumen' && (
          <EngineeringResumenTab
            readiness={readiness}
            cutRows={cutRows}
            hardwareRows={hardwareRows}
          />
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
                onClick={onExportDespiecePdf}
                disabled={exportBusy || !onExportDespiecePdf}
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
            onSaveCutPlan={onSaveCutPlan}
            onExportCutPlanPdf={onExportCutPlanPdf}
            exportBusy={exportBusy}
          />
        )}
        {activeTab === 'documentos' && (
          <ProductionOrderDocumentsPanel
            documents={documents}
            exportBusy={exportBusy}
          />
        )}
      </div>
      {ENGINEERING_TABS.filter((tab) => tab !== activeTab).map((tab) => (
        <div
          key={tab}
          role="tabpanel"
          id={`eng-panel-${tab}`}
          aria-labelledby={`eng-tab-${tab}`}
          hidden
        />
      ))}
    </section>
  );
}
