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
import { ArrowLeft, Factory, FileCheck, Printer, Send } from 'lucide-react';

import './engineering.css';
import '../production/production.css';

import {
  canSendToProduction,
  engineeringEntryStatus,
  engineeringStatus,
  ENGINEERING_ENTRY_STATUS_LABELS_ES,
  releaseAuthorityLabel,
  releaseAuthorityOf,
  type Project,
  type Module,
  type Catalog,
  type ProductionCutRow,
  type PieceLabel,
  type ModuleLabel,
  type HardwarePurchaseRow,
  type NestingImportResult,
} from '@granete/domain';
import type { Module3DCatalogInput } from '../modules/module3dPreview';
import { WorkspaceTabs } from '../common/Tabs';
import type { ProductionOrderReadiness } from '../production/productionOrderModel';
import { ProductionOrderModulesPanel } from '../production/ProductionOrderModulesPanel';
import { ProductionOrderDespiecePanel } from '../production/ProductionOrderDespiecePanel';
import { ProductionOrderViewsPanel } from '../production/ProductionOrderViewsPanel';
import { ProductionOrderOptimizationPanel } from '../production/ProductionOrderOptimizationPanel';
import type { CuttingOutputTargetView } from '../production/ProductionOrderOptimizationPanel';
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

/**
 * #738 — the EXACT ProductionRelease this workspace was opened with (pinned
 * in the URL). Presentation view resolved from authoritative read models by
 * the shell; the workspace never derives it from "latest".
 */
export interface EngineeringReleasePinView {
  readonly releaseNumber: number;
  readonly designRevisionNumber: number;
  readonly quoteLabel: string | null;
  readonly releasedAt: string;
}

export type EngineeringReleaseContextProp =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly view: EngineeringReleasePinView };

/** Tabs whose panels read the live editable project/catalog state. */
const LIVE_DATA_TABS: ReadonlySet<EngineeringTab> = new Set([
  'resumen',
  'modulos',
  'despiece',
  'etiquetas',
  'herrajes',
  'vistas',
  'optimizacion',
]);

/** What the live data tab names for the working-view notice. */
const LIVE_TAB_NOUN_ES: Readonly<Partial<Record<EngineeringTab, string>>> = {
  resumen: 'el resumen',
  modulos: 'los módulos',
  despiece: 'el despiece',
  etiquetas: 'las etiquetas',
  herrajes: 'los herrajes',
  vistas: 'las vistas',
  optimizacion: 'la optimización',
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
  defaultCutStrategy,
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
  onExportCutPlanDxf,
  onExportCutPlanPtx,
  cuttingOutputTarget,
  resolveCuttingOutputTarget,
  onImportNesting: _onImportNesting,
  // Permissions
  canImportNesting: _canImportNesting,
  exportBusy,
  onSendToProduction,
  onMarkDocumented,
  /**
   * #738 — exact release context pinned by the navigation. When present the
   * obra is canonical: the header shows THIS liberation (not the server's
   * "latest" authority), live data tabs are labeled as a working view, and
   * document downloads computed from the live project are NOT offered as
   * release content (#739 owns the frozen despiece/exports).
   */
  releaseContext,
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
  /** Workshop-level cut strategy default (F133) passed to the Optimización tab. */
  readonly defaultCutStrategy?: import('@granete/domain').CutStrategy;
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
  readonly onSaveCutPlan?: (cutPlan: import('@granete/domain').CutPlan) => void;
  readonly onExportCutPlanPdf?: (
    cutPlan: import('@granete/domain').CutPlan,
  ) => void | Promise<void>;
  readonly onExportCutPlanDxf?: (
    cutPlan: import('@granete/domain').CutPlan,
    variant: 'sheets' | 'pieces',
  ) => void | Promise<void>;
  readonly onExportCutPlanPtx?: (
    cutPlan: import('@granete/domain').CutPlan,
    mode?: 'unified' | 'by-material',
  ) => void | Promise<void>;
  /** #591 display summary of the configured cutting target (Optimización). */
  readonly cuttingOutputTarget?: CuttingOutputTargetView | null;
  readonly resolveCuttingOutputTarget?: (
    cutPlan: import('@granete/domain').CutPlan,
  ) => CuttingOutputTargetView | null;
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
  readonly releaseContext?: EngineeringReleaseContextProp;
}): ReactNode {
  const [activeTab, setActiveTab] = useState<EngineeringTab>('resumen');

  // #738 — canonical obra: the release context governs presentation. The
  // legacy per-project log actions and the live-data document exports are
  // not offered (they can't prove anything about THIS release); the frozen
  // despiece/exports arrive with #739.
  const hasReleaseContext = releaseContext !== undefined;
  const documentExportsDisabled = hasReleaseContext;
  const tabs = hasReleaseContext
    ? ENGINEERING_TABS.filter((tab) => tab !== 'documentos')
    : ENGINEERING_TABS;
  const releaseView = releaseContext?.state === 'ready' ? releaseContext.view : null;
  const entryStatus = engineeringEntryStatus(project);

  const documents = useEngineeringDocuments({
    readiness,
    labels,
    moduleLabels,
    onExportProductionPack: documentExportsDisabled ? undefined : onExportProductionPack,
    onExportOptimizer: documentExportsDisabled ? undefined : onExportOptimizer,
    onExportCutListCsv: documentExportsDisabled ? undefined : onExportCutListCsv,
    onExportHardware: documentExportsDisabled ? undefined : onExportHardware,
    onExportElevations: documentExportsDisabled ? undefined : onExportElevations,
    onExportPieceLabels: documentExportsDisabled ? undefined : onExportPieceLabels,
    onExportModulePdf: documentExportsDisabled ? undefined : onExportModulePdf,
    onExportAssemblySheets: documentExportsDisabled ? undefined : onExportAssemblySheets,
    onExportCncPilot: documentExportsDisabled ? undefined : onExportCncPilot,
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
        {/* #577 / OPS-DT-1: with a canonical ProductionRelease the obra is
            ALREADY in production — the legacy handshake CTA is hidden (no
            dual-write, no second liberation); the release pins are shown
            instead. Legacy-only projects keep the handshake. */}
        {project.status === 'accepted' &&
        onSendToProduction &&
        releaseAuthorityOf(project)?.source !== 'canonical' ? (
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
        {releaseView ? (
          <div className="eng-workspace__release-context" data-testid="eng-release-context">
            <span
              className="status-badge status-badge--done"
              title="Liberación exacta con la que se abrió esta pantalla. La preparación de Ingeniería queda disponible; la liberación no la completa."
            >
              <Factory size={16} strokeWidth={1.5} aria-hidden />
              Liberación #{releaseView.releaseNumber} · Diseño R
              {releaseView.designRevisionNumber}
              {releaseView.quoteLabel ? ` · ${releaseView.quoteLabel}` : ''}
            </span>
            <span
              className={`status-badge status-badge--${entryStatus === 'pending' ? 'open' : 'progress'}`}
              data-testid="eng-entry-status"
              title="Estado de la preparación de Ingeniería para esta liberación. Ningún dato indica que la preparación esté terminada."
            >
              <span className="status-badge__dot" aria-hidden>●</span>
              {ENGINEERING_ENTRY_STATUS_LABELS_ES[entryStatus]}
            </span>
          </div>
        ) : releaseContext?.state === 'loading' ? (
          <span
            className="status-badge status-badge--progress"
            data-testid="eng-release-context-loading"
          >
            Verificando liberación…
          </span>
        ) : releaseAuthorityOf(project)?.source === 'canonical' ? (
          <span
            className="status-badge status-badge--done"
            data-testid="eng-canonical-release"
            title={`Liberación canónica: producción desbloqueada por la liberación del Digital Thread`}
          >
            <Factory size={16} strokeWidth={1.5} aria-hidden />
            {releaseAuthorityLabel(project)}
          </span>
        ) : null}
        {!hasReleaseContext &&
        engineeringStatus(project.engineeringLog) === 'in_progress' &&
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
        tabs={tabs.map((tab) => ({
          id: tab,
          label: TAB_LABELS[tab],
        }))}
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab as EngineeringTab)}
        ariaLabel="Tabs de ingeniería"
        idPrefix="eng"
        testIdPrefix="eng"
      />

      {/* #738 — canonical obra: the data tabs read the live editable
          project/catalog, so they are explicitly separated from the frozen
          release content (never labeled as liberation documents). */}
      {hasReleaseContext && activeTab !== 'documentos' ? (
        <p className="eng-workspace__live-notice" data-testid="eng-live-view-notice">
          Vista de trabajo actual:{' '}
          {LIVE_TAB_NOUN_ES[activeTab] ?? 'estos datos'} se calculan desde el
          proyecto y el catálogo vigentes, no desde el contenido congelado de
          la liberación. El despiece y los documentos exactos de esta
          liberación todavía no están disponibles.
        </p>
      ) : null}

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
              onExportCsv={documentExportsDisabled ? undefined : onExportCsv}
              exportBusy={exportBusy}
            />
            {/* Imprimir A4 button */}
            {!documentExportsDisabled ? (
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
            ) : null}
          </div>
        )}
        {activeTab === 'etiquetas' && (
          <ProductionOrderLabelsPanel
            project={project}
            labels={labels}
            labelsError={labelsError}
            moduleLabels={moduleLabels}
            moduleLabelsError={moduleLabelsError}
            onExportPdf={documentExportsDisabled ? undefined : onExportPdf}
            onExportModulePdf={documentExportsDisabled ? undefined : onExportModulePdf}
            exportBusy={exportBusy}
          />
        )}
        {activeTab === 'herrajes' && (
          <ProductionOrderHardwarePanel
            rows={hardwareRows}
            error={hardwareError}
            onExportHardware={documentExportsDisabled ? undefined : onExportHardware}
            exportBusy={exportBusy}
          />
        )}
        {activeTab === 'vistas' && catalog3d && (
          <ProductionOrderViewsPanel
            project={project}
            modules={modules}
            catalog={catalog3d}
            resolveMediaUrl={resolveMediaUrl}
            onExportElevations={documentExportsDisabled ? undefined : onExportElevations}
            exportBusy={exportBusy}
          />
        )}
        {activeTab === 'optimizacion' && (
          <ProductionOrderOptimizationPanel
            project={project}
            catalog={catalog}
            cutRows={cutRows}
            defaultCutStrategy={defaultCutStrategy}
            onSaveCutPlan={onSaveCutPlan}
            onExportCutPlanPdf={documentExportsDisabled ? undefined : onExportCutPlanPdf}
            onExportOptimizer={documentExportsDisabled ? undefined : onExportOptimizer}
            onExportCutPlanDxf={documentExportsDisabled ? undefined : onExportCutPlanDxf}
            onExportCutPlanPtx={documentExportsDisabled ? undefined : onExportCutPlanPtx}
            cuttingOutputTarget={cuttingOutputTarget}
            resolveCuttingOutputTarget={resolveCuttingOutputTarget}
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
      {tabs.filter((tab) => tab !== activeTab).map((tab) => (
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
