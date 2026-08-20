/**
 * Engineering workspace Resumen Tab: KPI cards, material breakdown, and readiness checklist.
 */

import { useMemo, type ReactNode } from 'react';
import {
  CheckCircle2,
  Circle,
  FileSpreadsheet,
  Layers,
  LayoutGrid,
  Ruler,
} from 'lucide-react';
import {
  summarizeProductionTotals,
  type ProductionCutRow,
  type HardwarePurchaseRow,
} from '@muebles/domain';
import type { ProductionOrderReadiness } from '../../production/productionOrderModel';

export function CheckRow({
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
  return (
    <li className="eng-check-row">
      {ok ? (
        <CheckCircle2
          size={16}
          strokeWidth={1.5}
          className="eng-check-row__icon eng-check-row__icon--ok"
        />
      ) : (
        <Circle
          size={16}
          strokeWidth={1.5}
          className="eng-check-row__icon eng-check-row__icon--pending"
        />
      )}
      <div className="eng-check-row__content">
        <span
          className={`eng-check-row__label ${ok ? '' : 'eng-check-row__label--pending'}`}
        >
          {label}
          {warn ? (
            <span
              style={{
                color: 'hsl(38 80% 40%)',
                marginLeft: '0.35rem',
                fontSize: '0.72rem',
              }}
            >
              ⚠
            </span>
          ) : null}
        </span>
        {detail ? (
          <span className="eng-check-row__detail">{detail}</span>
        ) : null}
      </div>
    </li>
  );
}

export interface EngineeringResumenTabProps {
  readonly readiness: ProductionOrderReadiness;
  readonly cutRows: readonly ProductionCutRow[] | null;
  readonly hardwareRows: readonly HardwarePurchaseRow[] | null;
}

export function EngineeringResumenTab({
  readiness,
  cutRows,
  hardwareRows,
}: EngineeringResumenTabProps): ReactNode {
  const totals = useMemo(
    () =>
      cutRows && cutRows.length > 0
        ? summarizeProductionTotals(cutRows)
        : null,
    [cutRows],
  );

  return (
    <div className="eng-resumen">
      {/* Totals row */}
      <div className="eng-resumen__totals" aria-label="Totales de fábrica">
        <div className="stat-card stat-card--eng">
          <span className="stat-card__icon">
            <LayoutGrid size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <div className="stat-card__value">{readiness.moduleUnitCount}</div>
            <div className="stat-card__label">
              {readiness.moduleUnitCount === 1 ? 'módulo' : 'módulos'}
              <span className="eng-resumen__stat-sub">
                {' '}
                ({readiness.moduleLineCount} líneas)
              </span>
            </div>
          </div>
        </div>
        <div className="stat-card stat-card--eng">
          <span className="stat-card__icon">
            <FileSpreadsheet size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <div className="stat-card__value">
              {cutRows && cutRows.length > 0 ? readiness.cutRowCount : '—'}
            </div>
            <div className="stat-card__label">piezas de tablero</div>
          </div>
        </div>
        <div className="stat-card stat-card--eng">
          <span className="stat-card__icon">
            <Layers size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <div className="stat-card__value">
              {totals ? totals.totalAreaM2.toLocaleString('es-MX') : '—'}
            </div>
            <div className="stat-card__label">m² de tablero</div>
          </div>
        </div>
        <div className="stat-card stat-card--eng">
          <span className="stat-card__icon">
            <Ruler size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <div className="stat-card__value">
              {totals ? totals.totalEdgeMl.toLocaleString('es-MX') : '—'}
            </div>
            <div className="stat-card__label">ml de canto</div>
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
                    <span className="eng-resumen__breakdown-material">
                      {m.name}
                    </span>
                    <span className="eng-resumen__breakdown-num">
                      {m.pieces} {m.pieces === 1 ? 'pieza' : 'piezas'} ·{' '}
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
                    <span className="eng-resumen__breakdown-material">
                      {e.name}
                    </span>
                    <span className="eng-resumen__breakdown-num">
                      {e.ml.toLocaleString('es-MX')} ml
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {hardwareRows && hardwareRows.length > 0 ? (
            <div className="eng-resumen__breakdown-col">
              <h4 className="eng-resumen__breakdown-title">Herrajes</h4>
              <ul className="eng-resumen__breakdown-list">
                {hardwareRows.slice(0, 6).map((h) => (
                  <li key={h.hardwareId}>
                    <span className="eng-resumen__breakdown-material">
                      {h.description || h.code}
                    </span>
                    <span className="eng-resumen__breakdown-num">
                      {h.purchaseQuantity} {h.unit}
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
