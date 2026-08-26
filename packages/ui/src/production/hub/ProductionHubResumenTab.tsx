/**
 * ProductionHubResumenTab — Resumen tab with KPI cards, material purchase breakdown, and readiness checklist.
 */

import { type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  FileSpreadsheet,
  Layers,
  LayoutGrid,
  Package,
  Ruler,
} from 'lucide-react';
import type { ProductionCutRow, Project } from '@granete/domain';
import { summarizeProductionTotals } from '@granete/domain';
import type { ProductionOrderReadiness } from '../productionOrderModel';

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

function FactoryTotalsBlock({
  rows,
}: {
  readonly rows: readonly ProductionCutRow[];
}): ReactNode {
  const totals = summarizeProductionTotals(rows);
  if (totals.materials.length === 0) return null;
  return (
    <div
      className="prod-hub__factory-totals"
      data-testid="prod-hub-factory-totals"
    >
      <h3 className="prod-hub__section-title">Comprar / cargar</h3>
      <div className="prod-hub__totals-grid">
        <div className="prod-hub__totals-col">
          <p className="prod-hub__totals-col-title">Tablero</p>
          <ul className="prod-hub__totals-list">
            {totals.materials.map((m) => (
              <li key={m.key}>
                <span>
                  {m.name}
                  {m.thicknessMm ? ` · ${m.thicknessMm} mm` : ''}
                </span>
                <span className="prod-hub__totals-num">
                  {m.areaM2.toLocaleString('es-MX')} m²
                </span>
              </li>
            ))}
          </ul>
        </div>
        {totals.edges.length > 0 ? (
          <div className="prod-hub__totals-col">
            <p className="prod-hub__totals-col-title">Canto</p>
            <ul className="prod-hub__totals-list">
              {totals.edges.map((e) => (
                <li key={e.key}>
                  <span>
                    {e.name}
                    {e.thicknessMm ? ` · ${e.thicknessMm} mm` : ''}
                  </span>
                  <span className="prod-hub__totals-num">
                    {e.ml.toLocaleString('es-MX')} ML
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface ProductionHubResumenTabProps {
  readonly project: Project;
  readonly readiness: ProductionOrderReadiness;
  readonly cutRows?: readonly ProductionCutRow[] | null;
  readonly exportBusy?: boolean;
  readonly onExportProductionPack?: () => void | Promise<void>;
  readonly onOpenDesign: () => void;
}

export function ProductionHubResumenTab({
  project: _project,
  readiness,
  cutRows,
  exportBusy,
  onExportProductionPack,
  onOpenDesign,
}: ProductionHubResumenTabProps): ReactNode {
  const totals =
    cutRows && cutRows.length > 0 ? summarizeProductionTotals(cutRows) : null;

  return (
    <div className="prod-hub__resumen">
      <div
        className="prod-hub__stats-grid"
        aria-label="Totales de la orden de producción"
      >
        <div className="stat-card" data-testid="prod-hub-stat-modules">
          <span className="stat-card__icon" aria-hidden>
            <LayoutGrid size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <span className="stat-card__value" data-testid="prod-hub-modules">
              {readiness.moduleUnitCount}
            </span>
            <span className="stat-card__label">
              {readiness.moduleUnitCount === 1 ? 'módulo' : 'módulos'}
              <span className="prod-hub__stat-sub">
                {' '}
                ({readiness.moduleLineCount} líneas)
              </span>
            </span>
          </div>
        </div>

        <div className="stat-card" data-testid="prod-hub-stat-cut-rows">
          <span className="stat-card__icon" aria-hidden>
            <FileSpreadsheet size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <span className="stat-card__value" data-testid="prod-hub-pieces">
              {cutRows && cutRows.length > 0 ? readiness.cutRowCount : '—'}
            </span>
            <span className="stat-card__label">piezas de tablero</span>
          </div>
        </div>

        <div className="stat-card" data-testid="prod-hub-stat-area">
          <span className="stat-card__icon" aria-hidden>
            <Layers size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <span className="stat-card__value" data-testid="prod-hub-board-m2">
              {totals ? totals.totalAreaM2.toLocaleString('es-MX') : '—'}
            </span>
            <span className="stat-card__label">m² de tablero</span>
          </div>
        </div>

        <div className="stat-card" data-testid="prod-hub-stat-edge">
          <span className="stat-card__icon" aria-hidden>
            <Ruler size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <span className="stat-card__value" data-testid="prod-hub-edge-ml">
              {totals ? totals.totalEdgeMl.toLocaleString('es-MX') : '—'}
            </span>
            <span className="stat-card__label">ml de canto</span>
          </div>
        </div>
      </div>

      {cutRows && cutRows.length > 0 ? (
        <FactoryTotalsBlock rows={cutRows} />
      ) : null}

      <div className="prod-hub__readiness-card">
        <h3 className="prod-hub__section-title">Listo para cortar</h3>
        <ul className="prod-hub__checklist" data-testid="prod-hub-checklist">
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
                ? `${readiness.cutRowCount} piezas de tablero para corte`
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
          <div
            className="prod-hub__ready-banner prod-hub__ready-banner--ready"
            data-testid="prod-hub-ready"
          >
            <CheckCircle2 size={20} strokeWidth={1.5} aria-hidden />
            <div>
              <p className="prod-hub__ready-title">
                Listo para generar pack y mandar a corte.
              </p>
              <p className="prod-hub__ready-sub">
                Los materiales, dimensiones y reglas de taller son válidos.
              </p>
            </div>
          </div>
        ) : (
          <div
            className="prod-hub__ready-banner prod-hub__ready-banner--blocked"
            data-testid="prod-hub-not-ready"
          >
            <div>
              <p className="prod-hub__ready-title">
                Falta resolver el despiece antes de cortar.
              </p>
              <p className="prod-hub__ready-sub">
                Revisá los errores de BOM en Proyectos o cambiá a la pestaña
                Despiece.
              </p>
            </div>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={onOpenDesign}
            >
              Abrir en Proyectos
            </button>
          </div>
        )}
      </div>

      <div className="prod-hub__cta-row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={
            !readiness.packGenerable || exportBusy || !onExportProductionPack
          }
          onClick={onExportProductionPack}
          data-testid="prod-hub-export-pack"
          title={
            readiness.packGenerable
              ? 'Descargar ZIP con Optimizer + herrajes + etiquetas + despiece'
              : 'Requiere despiece de corte válido'
          }
        >
          <Package size={16} strokeWidth={1.5} aria-hidden />
          {exportBusy ? 'Generando pack…' : 'Descargar pack de producción'}
        </button>
      </div>
    </div>
  );
}
