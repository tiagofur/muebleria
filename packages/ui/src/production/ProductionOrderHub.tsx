/**
 * Production order hub — factory control room (PROD-0.1 / PROD-0.3).
 * Read-only design; mutates only factory actions via callbacks.
 */

import { useState, type ReactNode } from 'react';
import type {
  Catalog,
  HardwarePurchaseRow,
  ItemFloorStatus,
  Module,
  PieceLabel,
  ModuleLabel,
  ProductionCutRow,
  ProductionStaleInfo,
  Project,
  ProductionSpaceOption,
  ReleaseWorkContinuity,
} from '@granete/domain';
import {
  fabricationFlowOf,
  PRODUCTION_SCOPE_ALL,
  type FabricationEngineeringEvidence,
} from '@granete/domain';
import { ArrowLeft, ExternalLink, Factory } from 'lucide-react';
import {
  formatIsoDate,
  projectStatusBadgeClass,
  projectStatusLabel,
} from '../projects/projectHelpers';
import { formatMoneyDisplay } from '../common/formatMoneyDisplay';
import { FabricationFlowSteps } from '../common/FabricationFlowSteps';
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
  /**
   * #741 PR 1: work-release continuity signal — the materialized executions
   * belong to a release older than the canonical authority while physical
   * progress exists. Informative only: the server blocks the dangerous
   * commands; the hub NEVER offers automatic replacement.
   */
  readonly releaseContinuity?: ReleaseWorkContinuity | null;
  /**
   * #741 PR 1 / #768: navigation from the continuity banner to the NEW
   * revision's engineering surface (information only — never a command).
   */
  readonly onOpenNewRevision?: () => void;
  /**
   * #768: compact "Preparación para fabricar" of the obra's canonical
   * release; `undefined` keeps the pre-#768 presentation (legacy obras
   * without a release authority never get an invented flow).
   */
  readonly engineeringState?: EngineeringReleaseStateEvidence;
  /** #768: navigate to the engineering workspace of the authority release. */
  readonly onOpenEngineering?: () => void;
  /** #768: navigate to the existing material authorization surface. */
  readonly onOpenMaterialsSurface?: () => void;
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

/**
 * #768 — durable per-release Engineering state of the obra's canonical
 * authority, as resolved by the shell (same shape the Engineering workspace
 * consumes, minus the fields only Ingeniería displays). Absent → the flow
 * shows the honest "Pendiente de confirmar" (fail closed, no actions).
 */
export type EngineeringReleaseStateEvidence =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | {
      readonly status: 'ready';
      readonly phase: 'pending' | 'in_progress' | 'completed';
    };

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
  releaseContinuity = null,
  onOpenNewRevision,
  engineeringState,
  onOpenEngineering,
  onOpenMaterialsSurface,
  onExportCncPilot,
  onExportAssemblySheets,
  spaceOptions = [],
  productionScopeId = PRODUCTION_SCOPE_ALL,
  onProductionScopeChange,
}: ProductionOrderHubProps): ReactNode {
  const [isCsvConfigOpen, setIsCsvConfigOpen] = useState(false);

  // #768 — compact fabrication flow from existing authorities only. Rendered
  // exclusively for obras with a canonical release; legacy obras keep the
  // pre-#768 presentation instead of an invented flow.
  const engineeringEvidence: FabricationEngineeringEvidence =
    engineeringState === undefined
      ? { kind: 'unknown' }
      : engineeringState.status === 'loading'
        ? { kind: 'loading' }
        : engineeringState.status === 'error'
          ? { kind: 'unconfirmed' }
          : { kind: 'phase', phase: engineeringState.phase };
  const fabResult = fabricationFlowOf(project, engineeringEvidence);
  const fabFlow = fabResult.kind === 'flow' ? fabResult.flow : null;
  const fabAction = fabFlow?.nextAction
    ? fabFlow.nextAction === 'prepare-materials' && onOpenMaterialsSurface
      ? {
          label: 'Autorizar materiales',
          onActivate: onOpenMaterialsSurface,
          testId: 'prod-fab-authorize-materials',
          title:
            'Abre Almacén, la superficie existente donde se autorizan los materiales de esta liberación',
        }
      : (fabFlow.nextAction === 'start-engineering' ||
          fabFlow.nextAction === 'complete-engineering') &&
        onOpenEngineering
        ? {
            label: 'Abrir Ingeniería',
            onActivate: onOpenEngineering,
            testId: 'prod-fab-open-engineering',
            title:
              'Abre Ingeniería, donde se registra el estado de preparación de esta liberación',
          }
        : null
    : null;

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

        {releaseContinuity?.hasPhysicalProgress ? (
          <aside
            className="prod-hub__stale-warning"
            role="status"
            aria-live="polite"
            data-testid="prod-release-continuity"
          >
            <strong>Nueva revisión disponible.</strong> Hay una versión más
            reciente del diseño; la fabricación actual no se cambiará
            automáticamente.
            <p className="prod-hub__continuity-detail">
              Trabajo actual: versión anterior
              {releaseContinuity.authorityReleaseNumber !== undefined
                ? ` · Nueva versión: Liberación #${releaseContinuity.authorityReleaseNumber}`
                : ''}
            </p>
            {/* #768 — information and navigation only. The server keeps
                blocking the dangerous commands; no replacement, suspension
                or cancellation action is ever offered here. */}
            <div className="prod-hub__continuity-actions">
              {onOpenNewRevision ? (
                <button
                  type="button"
                  className="btn btn--small prod-hub__continuity-action"
                  onClick={onOpenNewRevision}
                  data-testid="prod-continuity-open-new-revision"
                  title="Abre la Ingeniería de la nueva liberación para revisarla"
                >
                  Ver nueva revisión
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn--ghost btn--small prod-hub__continuity-action"
                onClick={() => onTabChange('piso')}
                data-testid="prod-continuity-view-current-work"
                title="Muestra el estado de piso del trabajo en curso"
              >
                Ver trabajo actual
              </button>
            </div>
          </aside>
        ) : null}

        {/* #768 — the same compact semantics as Ingeniería, below the
            header; one primary action at most, honest text otherwise. */}
        {fabFlow ? <FabricationFlowSteps flow={fabFlow} action={fabAction} testIdPrefix="prod" /> : null}

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
