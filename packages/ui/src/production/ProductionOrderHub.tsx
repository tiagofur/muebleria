/**
 * Production order hub — factory control room (PROD-0.1 / PROD-0.3).
 * Read-only design; mutates only factory actions via callbacks.
 */

import type { ReactNode } from 'react';
import type {
  HardwarePurchaseRow,
  Module,
  ProductionCutRow,
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
  Tags,
  Wrench,
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
  PRODUCTION_ORDER_TABS_READY,
  PRODUCTION_ORDER_TAB_ROADMAP,
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
  readonly onMarkProduced?: () => void;
  readonly exportBusy?: boolean;
  /** PROD-0.4: catalog modules for inventory + 3D. */
  readonly modules?: readonly Module[];
  readonly cutRows?: readonly ProductionCutRow[] | null;
  readonly cutListError?: string | null;
  readonly hardwareRows?: readonly HardwarePurchaseRow[] | null;
  readonly hardwareError?: string | null;
  readonly catalog3d?: Module3DCatalogInput | null;
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
  readonly hideHardwareCosts?: boolean;
  /** Has kitchen walls for elevations PDF. */
  readonly elevationsAvailable?: boolean;
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

function PlaceholderTab({
  tab,
}: {
  readonly tab: ProductionOrderTab;
}): ReactNode {
  const roadmap = PRODUCTION_ORDER_TAB_ROADMAP[tab];
  return (
    <div className="prod-hub__placeholder" data-testid={`prod-hub-placeholder-${tab}`}>
      <p className="prod-hub__placeholder-title">
        {PRODUCTION_ORDER_TAB_LABELS[tab]} — próximo
      </p>
      <p className="prod-hub__placeholder-body">
        Esta vista forma parte del módulo Producción y se implementa en el
        roadmap
        {roadmap ? ` (${roadmap})` : ''}. El diseño de la obra no se edita
        desde aquí.
      </p>
    </div>
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
  onMarkProduced,
  exportBusy = false,
  modules = [],
  cutRows = null,
  cutListError = null,
  hardwareRows = null,
  hardwareError = null,
  catalog3d = null,
  resolveMediaUrl,
  hideHardwareCosts = false,
  elevationsAvailable = false,
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

        <div className="prod-hub__chrome-actions">
          <button
            type="button"
            className="btn"
            onClick={onOpenDesign}
            data-testid="prod-hub-open-design"
            title="Abre la cotización/diseño (sale del workspace de fábrica)"
          >
            <ExternalLink size={16} strokeWidth={1.5} aria-hidden />
            Ver cotización / diseño
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
          {onExportProductionPack ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={exportBusy || !readiness.packGenerable}
              onClick={() => {
                void onExportProductionPack();
              }}
              data-testid="prod-hub-export-pack"
              title={
                readiness.packGenerable
                  ? 'ZIP con Optimizer, herrajes y etiquetas'
                  : 'Pack no disponible: falta despiece de corte válido'
              }
            >
              <Package size={16} strokeWidth={1.5} aria-hidden />
              {exportBusy ? 'Generando…' : 'Pack de producción'}
            </button>
          ) : null}
        </div>
      </header>

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
          />
        ) : null}

        {activeTab === 'despiece' ? (
          <ProductionOrderDespiecePanel
            cutRows={cutRows}
            cutError={cutListError}
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

        {activeTab === 'documentos' ? (
          <ProductionOrderDocumentsPanel
            documents={documents}
            exportBusy={exportBusy}
          />
        ) : null}

        {activeTab === 'exports' ? (
          <div className="prod-hub__exports" data-testid="prod-hub-exports">
            <h3 className="prod-hub__section-title">Exports de fábrica</h3>
            <p className="prod-hub__exports-hint">
              Solo lectura del diseño. Estos archivos no cambian medidas ni
              opciones.
            </p>
            <div className="prod-hub__export-actions">
              {onExportProductionPack ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={exportBusy || !readiness.packGenerable}
                  onClick={() => {
                    void onExportProductionPack();
                  }}
                  data-testid="prod-hub-exports-pack"
                >
                  <Package size={16} strokeWidth={1.5} aria-hidden />
                  Pack de producción
                </button>
              ) : null}
              <button
                type="button"
                className="btn"
                disabled={exportBusy || !readiness.optimizerGenerable}
                onClick={() => {
                  void onExportOptimizer();
                }}
                data-testid="prod-hub-exports-opt"
              >
                <FileSpreadsheet size={16} strokeWidth={1.5} aria-hidden />
                Exportar corte (Optimizer)
              </button>
              <button
                type="button"
                className="btn"
                disabled={exportBusy}
                onClick={() => {
                  void onExportHardware();
                }}
                data-testid="prod-hub-exports-hw"
              >
                <Wrench size={16} strokeWidth={1.5} aria-hidden />
                Herrajes
              </button>
              {onExportPieceLabels ? (
                <button
                  type="button"
                  className="btn"
                  disabled={exportBusy}
                  onClick={() => {
                    void onExportPieceLabels();
                  }}
                  data-testid="prod-hub-exports-labels"
                >
                  <Tags size={16} strokeWidth={1.5} aria-hidden />
                  Etiquetas
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {!PRODUCTION_ORDER_TABS_READY.has(activeTab) ? (
          <PlaceholderTab tab={activeTab} />
        ) : null}
      </div>
    </section>
  );
}
