/**
 * Production order hub — factory control room (PROD-0.1 / PROD-0.3).
 * Read-only design; mutates only factory actions via callbacks.
 */

import { useState, type ReactNode } from 'react';
import type { Catalog,
  HardwarePurchaseRow,
  ItemFloorStatus,
  Module,
  PieceLabel,
  ModuleLabel,
  ProductionCutRow,
  ProductionStaleInfo,
  Project,
  ProductionSpaceOption,
} from '@granete/domain';
import { PRODUCTION_SCOPE_ALL } from '@granete/domain';
import { ArrowLeft, ExternalLink, Factory } from 'lucide-react';
import {
  formatIsoDate,
  projectStatusBadgeClass,
  projectStatusLabel,
} from '../projects/projectHelpers';
import { formatMoneyDisplay } from '../common/formatMoneyDisplay';
import { WorkspaceTabs } from '../common/Tabs';
import {
  HUB_TABS,
  PRODUCTION_ORDER_TAB_LABELS,
  type ProductionOrderReadiness,
  type ProductionOrderTab,
} from './productionOrderModel';
import { ProductionOrderHardwarePanel } from './ProductionOrderHardwarePanel';
import { ProductionOrderDocumentsPanel } from './ProductionOrderDocumentsPanel';
import { ProductionOrderPaperlessPanel } from './ProductionOrderPaperlessPanel';
import { ProductionOrderLabelsPanel } from './ProductionOrderLabelsPanel';
import { CsvExportConfigModal } from './CsvExportConfigModal';
import { ProductionHubResumenTab } from './hub/ProductionHubResumenTab';
import { useProductionOrderDocuments } from './hub/useProductionOrderDocuments';
import './production.css';

export type ProductionOrderHubProps = {
  readonly project: Project;
  readonly customerLabel: string;
  readonly salePrice: number | null;
  readonly readiness: ProductionOrderReadiness;
  readonly activeTab: ProductionOrderTab;
  readonly onTabChange: (tab: ProductionOrderTab) => void;
  readonly onBackToQueue: () => void;
  /** Leave factory workspace → quote/design (projects). */
  readonly onOpenDesign: () => void;
  readonly onExportOptimizer: () => void | Promise<void>;
  readonly onExportHardware: () => void | Promise<void>;
  readonly onExportProductionPack?: () => void | Promise<void>;
  readonly onExportElevations?: () => void | Promise<void>;
  readonly onExportCutListCsv?: () => void | Promise<void>;
  readonly onMarkProduced?: () => void;
  readonly exportBusy?: boolean;
  /** PROD-0.4: catalog modules for inventory + 3D. */
  readonly modules?: readonly Module[];
  /** F130: full catalog for the real drilling report source. */
  readonly catalog?: Catalog | null;
  readonly cutRows?: readonly ProductionCutRow[] | null;
  readonly cutListError?: string | null;
  /** Resolved piece labels for the Etiquetas tab (domain). */
  readonly pieceLabels?: readonly PieceLabel[] | null;
  readonly pieceLabelsError?: string | null;
  readonly moduleLabels?: readonly ModuleLabel[] | null;
  readonly moduleLabelsError?: string | null;
  readonly onExportPieceLabels?: (
    labels: readonly PieceLabel[],
    options?: { readonly perUnit?: boolean },
  ) => void | Promise<void>;
  readonly onExportModuleLabels?: (
    labels: readonly ModuleLabel[],
  ) => void | Promise<void>;
  readonly hardwareRows?: readonly HardwarePurchaseRow[] | null;
  readonly hardwareError?: string | null;
  readonly hideHardwareCosts?: boolean;
  /** Has kitchen walls for elevations PDF. */
  readonly elevationsAvailable?: boolean;
  readonly onSetFloorStatus?: (
    itemId: string,
    status: ItemFloorStatus,
  ) => void;
  readonly canSetFloorStatus?: boolean;
  readonly staleInfo?: ProductionStaleInfo | null;
  readonly onExportCncPilot?: () => void | Promise<void>;
  readonly onExportAssemblySheets?: () => void | Promise<void>;
  /** PROD-4.4 multi-ambiente filter */
  readonly spaceOptions?: readonly ProductionSpaceOption[];
  readonly productionScopeId?: string;
  readonly onProductionScopeChange?: (scopeId: string) => void;
};

function StatusBadge({
  status,
}: {
  readonly status: Project['status'];
}): ReactNode {
  return (
    <span className={`status-badge ${projectStatusBadgeClass(status)}`}>
      <span className="status-badge__dot" aria-hidden>
        ●
      </span>
      {projectStatusLabel(status)}
    </span>
  );
}

export function ProductionOrderHub({
  catalog = null,
  project,
  customerLabel,
  salePrice,
  readiness,
  activeTab,
  onTabChange,
  onBackToQueue,
  onOpenDesign,
  onExportOptimizer,
  onExportHardware,
  onExportPieceLabels,
  onExportProductionPack,
  onExportElevations,
  onExportCutListCsv,
  onMarkProduced: _onMarkProduced,
  exportBusy = false,
  modules = [],
  cutRows = null,
  cutListError: _cutListError = null,
  pieceLabels = null,
  pieceLabelsError = null,
  moduleLabels = null,
  moduleLabelsError = null,
  onExportModuleLabels,
  hardwareRows = null,
  hardwareError = null,
  hideHardwareCosts = false,
  elevationsAvailable = false,
  onSetFloorStatus,
  canSetFloorStatus = false,
  staleInfo = null,
  onExportCncPilot,
  onExportAssemblySheets,
  spaceOptions = [],
  productionScopeId = PRODUCTION_SCOPE_ALL,
  onProductionScopeChange,
}: ProductionOrderHubProps): ReactNode {
  const [isCsvConfigOpen, setIsCsvConfigOpen] = useState(false);

  const documents = useProductionOrderDocuments({
    project,
    catalog,
    readiness,
    cutRows,
    pieceLabels,
    elevationsAvailable,
    onExportProductionPack,
    onExportOptimizer,
    onExportCutListCsv,
    onExportHardware,
    onExportPieceLabels,
    onExportElevations,
    onExportCncPilot,
    onExportAssemblySheets,
    onOpenCsvConfig: () => setIsCsvConfigOpen(true),
    onNavigateToTab: (t) => onTabChange(t as ProductionOrderTab),
  });

  return (
    <section
      className="prod-hub"
      aria-label={`Orden de producción: ${project.name}`}
      data-testid="prod-order-hub"
    >
      <header className="prod-hub__header">
        <button
          type="button"
          className="btn btn--ghost prod-hub__back"
          onClick={onBackToQueue}
          data-testid="prod-hub-back"
        >
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
          Cola de trabajo
        </button>

        <div className="prod-hub__title-row">
          <Factory
            className="prod-hub__title-icon"
            size={28}
            strokeWidth={1.5}
            aria-hidden
          />
          <div className="prod-hub__title-block">
            <div className="prod-hub__name-row">
              <h2 className="prod-hub__title" data-testid="prod-hub-title">
                {project.name}
              </h2>
              <StatusBadge status={project.status} />
            </div>
            <p className="prod-hub__meta">
              {customerLabel || '—'}
              <span className="prod-hub__dot" aria-hidden>
                ·
              </span>
              Actualizado {formatIsoDate(project.updatedAt)}
              {project.production?.revision ? (
                <>
                  <span className="prod-hub__dot" aria-hidden>
                    ·
                  </span>
                  <span data-testid="prod-hub-revision">
                    OP rev. {project.production.revision}
                  </span>
                </>
              ) : null}
            </p>
          </div>
        </div>

        {staleInfo?.stale ? (
          <aside
            className="prod-hub__stale-warning"
            role="status"
            aria-live="polite"
            data-testid="prod-hub-stale-warning"
          >
            <strong>Aviso de versión:</strong>{' '}
            {staleInfo.messageEs ||
              'La orden de producción se generó a partir de una versión anterior.'}
          </aside>
        ) : null}

        <div className="prod-hub__header-actions">
          {salePrice !== null ? (
            <div className="prod-hub__price">
              <span className="prod-hub__price-label">Cotizado</span>
              <span className="prod-hub__price-value">
                {formatMoneyDisplay(salePrice)}
              </span>
            </div>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost prod-hub__btn-design"
            onClick={onOpenDesign}
            data-testid="prod-hub-open-design"
          >
            <ExternalLink size={16} strokeWidth={1.5} aria-hidden />
            Ver en cotización
          </button>
        </div>
      </header>

      {/* PROD-4.4 Ambient Scope Filter */}
      {spaceOptions.length > 0 && onProductionScopeChange ? (
        <div
          className="prod-hub__scope-filter"
          data-testid="prod-hub-scope-filter"
        >
          <span className="prod-hub__scope-label">Alcance de planta:</span>
          <select
            className="select select--small"
            value={productionScopeId}
            onChange={(e) => onProductionScopeChange(e.target.value)}
            aria-label="Filtrar por ambiente"
          >
            <option value={PRODUCTION_SCOPE_ALL}>
              Toda la obra ({project.items.length} módulos)
            </option>
            {spaceOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name} ({opt.itemCount}{' '}
                {opt.itemCount === 1 ? 'módulo' : 'módulos'})
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {/* Tabs */}
      <WorkspaceTabs
        tabs={HUB_TABS.map((tab) => ({
          id: tab,
          label: PRODUCTION_ORDER_TAB_LABELS[tab],
        }))}
        activeTab={activeTab}
        onTabChange={(tab) => onTabChange(tab as ProductionOrderTab)}
        ariaLabel="Vistas de la orden de producción"
        idPrefix="prod-hub"
        testIdPrefix="prod-hub"
      />

      {/* Active Tab Panel */}
      <div
        className="prod-hub__body"
        role="tabpanel"
        id={`prod-hub-panel-${activeTab}`}
        aria-labelledby={`prod-hub-tab-${activeTab}`}
      >
        {activeTab === 'resumen' && (
          <ProductionHubResumenTab
            project={project}
            readiness={readiness}
            cutRows={cutRows}
            exportBusy={exportBusy}
            onExportProductionPack={onExportProductionPack}
            onOpenDesign={onOpenDesign}
          />
        )}

        {activeTab === 'piso' && (
          <ProductionOrderPaperlessPanel
            project={project}
            modules={modules}
            onSetFloorStatus={onSetFloorStatus}
            canSetFloorStatus={canSetFloorStatus}
          />
        )}

        {activeTab === 'etiquetas' && (
          <ProductionOrderLabelsPanel
            project={project}
            labels={pieceLabels}
            labelsError={pieceLabelsError}
            moduleLabels={moduleLabels}
            moduleLabelsError={moduleLabelsError}
            onExportPdf={
              onExportPieceLabels
                ? (lbls, perUnit) => onExportPieceLabels(lbls, { perUnit })
                : undefined
            }
            onExportModulePdf={onExportModuleLabels}
            exportBusy={exportBusy}
          />
        )}

        {activeTab === 'herrajes' && (
          <ProductionOrderHardwarePanel
            rows={hardwareRows}
            error={hardwareError}
            onExportHardware={onExportHardware}
            exportBusy={exportBusy}
            hideCosts={hideHardwareCosts}
          />
        )}

        {activeTab === 'documentos' && (
          <ProductionOrderDocumentsPanel
            documents={documents}
            exportBusy={exportBusy}
          />
        )}
      </div>

      {HUB_TABS.filter((tab) => tab !== activeTab).map((tab) => (
        <div
          key={tab}
          role="tabpanel"
          id={`prod-hub-panel-${tab}`}
          aria-labelledby={`prod-hub-tab-${tab}`}
          hidden
        />
      ))}

      {isCsvConfigOpen && cutRows && (
        <CsvExportConfigModal
          isOpen={isCsvConfigOpen}
          projectName={project.name}
          cutRows={cutRows}
          onClose={() => setIsCsvConfigOpen(false)}
        />
      )}
    </section>
  );
}
