/**
 * Production order hub — factory control room (PROD-0.1 / PROD-0.3).
 * Read-only design; mutates only factory actions via callbacks.
 */

import type { ReactNode } from 'react';
import type {
  HardwarePurchaseRow,
  ItemFloorStatus,
  Module,
  ProductionCutRow,
  ProductionStaleInfo,
  Project,
} from '@muebles/domain';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  ExternalLink,
  Factory,
  FileSpreadsheet,
  LayoutGrid,
  Package,
  AlertTriangle,
} from 'lucide-react';
import {
  formatIsoDate,
  projectStatusBadgeClass,
  projectStatusLabel,
} from '../projects/projectHelpers';
import { formatMoneyDisplay } from '../common/formatMoneyDisplay';
import type { Module3DCatalogInput } from '../modules/module3dPreview';
import {
  PRODUCTION_ORDER_TABS,
  PRODUCTION_ORDER_TAB_LABELS,
  type ProductionOrderReadiness,
  type ProductionOrderTab,
} from './productionOrderModel';
import { ProductionOrderModulesPanel } from './ProductionOrderModulesPanel';
import { ProductionOrderViewsPanel } from './ProductionOrderViewsPanel';
import { ProductionOrderDespiecePanel } from './ProductionOrderDespiecePanel';
import { ProductionOrderHardwarePanel } from './ProductionOrderHardwarePanel';
import {
  ProductionOrderDocumentsPanel,
  type ProductionDocumentItem,
} from './ProductionOrderDocumentsPanel';
import { ProductionOrderOptimizationPanel } from './ProductionOrderOptimizationPanel';
import { ProductionOrderPaperlessPanel } from './ProductionOrderPaperlessPanel';
import type { Catalog, NestingImportResult } from '@muebles/domain';
import type { ProductionSpaceOption } from '@muebles/domain';
import { PRODUCTION_SCOPE_ALL } from '@muebles/domain';
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
  readonly onExportPieceLabels?: () => void | Promise<void>;
  readonly onExportProductionPack?: () => void | Promise<void>;
  readonly onExportElevations?: () => void | Promise<void>;
  readonly onExportCutListCsv?: () => void | Promise<void>;
  readonly onMarkProduced?: () => void;
  readonly exportBusy?: boolean;
  /** PROD-0.4: catalog modules for inventory + 3D. */
  readonly modules?: readonly Module[];
  readonly cutRows?: readonly ProductionCutRow[] | null;
  readonly cutListError?: string | null;
  readonly hardwareRows?: readonly HardwarePurchaseRow[] | null;
  readonly hardwareError?: string | null;
  readonly catalog3d?: Module3DCatalogInput | null;
  /** Full catalog for material summary / sheet estimate (optimización). */
  readonly catalog?: Catalog | null;
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
  readonly hideHardwareCosts?: boolean;
  /** Has kitchen walls for elevations PDF. */
  readonly elevationsAvailable?: boolean;
  readonly onImportNesting?: (nesting: NestingImportResult) => void;
  readonly canImportNesting?: boolean;
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

function StatusBadge({ status }: { readonly status: Project['status'] }): ReactNode {
  return (
    <span className={`status-badge ${projectStatusBadgeClass(status)}`}>
      <span className="status-badge__dot" aria-hidden>
        ●
      </span>
      {projectStatusLabel(status)}
    </span>
  );
}

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
}): ReactNode {
  const Icon = warn ? AlertTriangle : ok ? CheckCircle2 : Circle;
  const stateClass = warn
    ? 'prod-hub__check prod-hub__check--warn'
    : ok
      ? 'prod-hub__check prod-hub__check--ok'
      : 'prod-hub__check prod-hub__check--fail';
  return (
    <li className={stateClass}>
      <Icon size={18} strokeWidth={1.5} aria-hidden />
      <div>
        <p className="prod-hub__check-label">{label}</p>
        {detail ? <p className="prod-hub__check-detail">{detail}</p> : null}
      </div>
    </li>
  );
}

export function ProductionOrderHub({
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
  onMarkProduced,
  exportBusy = false,
  modules = [],
  cutRows = null,
  cutListError = null,
  hardwareRows = null,
  hardwareError = null,
  catalog3d = null,
  catalog = null,
  resolveMediaUrl,
  hideHardwareCosts = false,
  elevationsAvailable = false,
  onImportNesting,
  canImportNesting = false,
  onSetFloorStatus,
  canSetFloorStatus = false,
  staleInfo = null,
  onExportCncPilot,
  onExportAssemblySheets,
  spaceOptions = [],
  productionScopeId = PRODUCTION_SCOPE_ALL,
  onProductionScopeChange,
}: ProductionOrderHubProps): ReactNode {
  const documents: readonly ProductionDocumentItem[] = [
    {
      id: 'pack',
      label: 'Pack de producción (ZIP)',
      hint: 'Optimizer + herrajes + etiquetas + resumen + elevaciones + despiece',
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
      id: 'labels',
      label: 'Etiquetas de pieza',
      hint: 'PDF con encintado y QR',
      available: Boolean(onExportPieceLabels) && readiness.materialsResolved,
      reason: 'Requiere piezas de tablero',
      onDownload: onExportPieceLabels,
    },
    {
      id: 'elevations',
      label: 'Elevaciones por muro (PDF)',
      hint: 'Alzados con códigos y medidas',
      available: elevationsAvailable && Boolean(onExportElevations),
      reason: 'Sin muros en el layout de cocina',
      onDownload: onExportElevations,
    },
    {
      id: 'despiece',
      label: 'Despiece (ver tab)',
      hint: 'Lista de piezas en la pestaña Despiece',
      available: readiness.materialsResolved,
      reason: 'Sin piezas de tablero',
      onDownload: () => onTabChange('despiece'),
    },
    {
      id: 'cnc-pilot',
      label: 'CNC pilot (JSON)',
      hint: 'Metadatos rectangulares por pieza — no reemplaza Optimizer (#111)',
      available: readiness.materialsResolved && Boolean(onExportCncPilot),
      reason: 'Requiere piezas de tablero',
      onDownload: onExportCncPilot,
    },
    {
      id: 'assembly',
      label: 'Hojas de armado (PDF)',
      hint: 'Una página por módulo: medidas + herrajes + estado piso',
      available: project.items.length > 0 && Boolean(onExportAssemblySheets),
      reason: 'Sin módulos en el alcance',
      onDownload: onExportAssemblySheets,
    },
  ];

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
              {salePrice != null ? (
                <>
                  <span className="prod-hub__dot" aria-hidden>
                    ·
                  </span>
                  {formatMoneyDisplay(salePrice, { currency: project.currency })}
                </>
              ) : null}
            </p>
          </div>
        </div>

        {staleInfo?.stale && staleInfo.messageEs ? (
          <p
            className="prod-hub__ready-banner prod-hub__ready-banner--blocked"
            data-testid="prod-hub-stale-warning"
            role="status"
          >
            {staleInfo.messageEs}
          </p>
        ) : null}

        {spaceOptions.length >= 2 && onProductionScopeChange ? (
          <div
            className="prod-hub__scope"
            data-testid="prod-hub-space-scope"
          >
            <label className="prod-hub__scope-label" htmlFor="prod-scope-select">
              Ambiente
            </label>
            <select
              id="prod-scope-select"
              className="prod-modulos__floor-select"
              value={productionScopeId}
              onChange={(e) => onProductionScopeChange(e.target.value)}
              data-testid="prod-scope-select"
            >
              <option value={PRODUCTION_SCOPE_ALL}>Toda la obra</option>
              {spaceOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.itemCount})
                </option>
              ))}
            </select>
            <span className="prod-modulos__muted">
              Filtra vistas de fábrica · export Optimizer sigue siendo obra completa
            </span>
          </div>
        ) : null}

        <div className="prod-hub__chrome-actions">
          {onExportProductionPack ? (
            <button
              type="button"
              className="btn btn--primary prod-hub__chrome-primary"
              disabled={exportBusy || !readiness.packGenerable}
              onClick={() => {
                void onExportProductionPack();
              }}
              data-testid="prod-hub-export-pack"
              title={
                readiness.packGenerable
                  ? 'ZIP: Optimizer, herrajes, etiquetas, elevaciones, armado…'
                  : 'Pack no disponible: falta despiece de corte válido'
              }
            >
              <Package size={16} strokeWidth={1.5} aria-hidden />
              {exportBusy ? 'Generando…' : 'Pack de producción'}
            </button>
          ) : null}
          <div className="prod-hub__chrome-secondary">
            <button
              type="button"
              className="btn"
              onClick={onOpenDesign}
              data-testid="prod-hub-open-design"
              title="Abre la cotización/diseño (sale del workspace de fábrica)"
            >
              <ExternalLink size={16} strokeWidth={1.5} aria-hidden />
              Ver cotización
            </button>
            {project.status === 'accepted' && onMarkProduced ? (
              <button
                type="button"
                className="btn"
                onClick={onMarkProduced}
                data-testid="prod-hub-mark-produced"
              >
                <CheckCircle2 size={16} strokeWidth={1.5} aria-hidden />
                Marcar en producción
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="prod-hub__tabs-wrap">
        <nav
          className="prod-hub__tabs"
          role="tablist"
          aria-label="Secciones de la orden de producción"
        >
          {PRODUCTION_ORDER_TABS.map((tab) => {
            const selected = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={selected}
                className={
                  selected
                    ? 'prod-hub__tab prod-hub__tab--active'
                    : 'prod-hub__tab'
                }
                onClick={() => onTabChange(tab)}
                data-testid={`prod-hub-tab-${tab}`}
              >
                {PRODUCTION_ORDER_TAB_LABELS[tab]}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="prod-hub__body" role="tabpanel">
        {activeTab === 'resumen' ? (
          <div className="prod-hub__resumen" data-testid="prod-hub-resumen">
            <div className="prod-hub__totals" aria-label="Totales de fábrica">
              <div className="prod-hub__total-card">
                <LayoutGrid size={18} strokeWidth={1.5} aria-hidden />
                <div>
                  <p className="prod-hub__total-value" data-testid="prod-hub-modules">
                    {readiness.moduleUnitCount}
                  </p>
                  <p className="prod-hub__total-label">
                    {readiness.moduleUnitCount === 1 ? 'módulo' : 'módulos'}
                    <span className="prod-hub__total-sub">
                      {' '}
                      ({readiness.moduleLineCount} líneas)
                    </span>
                  </p>
                </div>
              </div>
              <div className="prod-hub__total-card">
                <FileSpreadsheet size={18} strokeWidth={1.5} aria-hidden />
                <div>
                  <p className="prod-hub__total-value" data-testid="prod-hub-pieces">
                    {readiness.cutListOk ? readiness.cutRowCount : '—'}
                  </p>
                  <p className="prod-hub__total-label">piezas de tablero</p>
                </div>
              </div>
            </div>

            <div className="prod-hub__checklist-block">
              <h3 className="prod-hub__section-title">Listo para cortar</h3>
              <ul
                className="prod-hub__checklist"
                data-testid="prod-hub-checklist"
              >
                <CheckRow
                  ok={readiness.cutListOk}
                  label="BOM / cut-list válido"
                  detail={
                    readiness.cutListOk
                      ? undefined
                      : (readiness.cutListError ?? undefined)
                  }
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
              {readiness.readyToCut ? (
                <p
                  className="prod-hub__ready-banner prod-hub__ready-banner--ok"
                  data-testid="prod-hub-ready"
                >
                  Listo para generar pack y mandar a corte.
                </p>
              ) : (
                <p
                  className="prod-hub__ready-banner prod-hub__ready-banner--blocked"
                  data-testid="prod-hub-not-ready"
                >
                  Falta resolver el despiece antes de cortar. Revisá módulos y
                  catálogo en cotización/diseño.
                </p>
              )}
            </div>
          </div>
        ) : null}

        {activeTab === 'modulos' ? (
          <ProductionOrderModulesPanel
            project={project}
            modules={modules}
            cutRows={cutRows}
            onSetFloorStatus={onSetFloorStatus}
            canSetFloorStatus={canSetFloorStatus}
          />
        ) : null}

        {activeTab === 'piso' ? (
          <ProductionOrderPaperlessPanel
            project={project}
            modules={modules}
            onSetFloorStatus={onSetFloorStatus}
            canSetFloorStatus={canSetFloorStatus}
          />
        ) : null}

        {activeTab === 'despiece' ? (
          <ProductionOrderDespiecePanel
            cutRows={cutRows}
            cutError={cutListError}
            onExportCsv={onExportCutListCsv}
            exportBusy={exportBusy}
          />
        ) : null}

        {activeTab === 'herrajes' ? (
          <ProductionOrderHardwarePanel
            rows={hardwareRows}
            error={hardwareError}
            onExportHardware={onExportHardware}
            exportBusy={exportBusy}
            hideCosts={hideHardwareCosts}
          />
        ) : null}

        {activeTab === 'vistas' ? (
          catalog3d ? (
            <ProductionOrderViewsPanel
              project={project}
              modules={modules}
              catalog={catalog3d}
              resolveMediaUrl={resolveMediaUrl}
              onExportElevations={onExportElevations}
              exportBusy={exportBusy}
            />
          ) : (
            <div
              className="prod-hub__placeholder"
              data-testid="prod-hub-vistas-no-catalog"
            >
              <p className="prod-hub__placeholder-title">Vistas no disponibles</p>
              <p className="prod-hub__placeholder-body">
                Falta el catálogo para resolver planta y 3D. Recargá el workspace
                o abrí la cotización.
              </p>
            </div>
          )
        ) : null}

        {activeTab === 'optimizacion' ? (
          <ProductionOrderOptimizationPanel
            project={project}
            catalog={catalog}
            cutRows={cutRows}
            onExportOptimizer={onExportOptimizer}
            onImportNesting={onImportNesting}
            exportBusy={exportBusy}
            canImportNesting={canImportNesting}
          />
        ) : null}

        {activeTab === 'documentos' ? (
          <ProductionOrderDocumentsPanel
            documents={documents}
            exportBusy={exportBusy}
          />
        ) : null}

      </div>
    </section>
  );
}
