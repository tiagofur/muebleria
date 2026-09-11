/**
 * ProductionBoardView — Plan de tablero visual SVG para el taller y almacén (F115).
 *
 * Soporta renderizado de CutPlanSheet del optimizador guillotina 2D con:
 * - Proyección exacta desde el programa de corte registrado (#650 PR 3).
 * - Marcador fiel del 1er Corte Primario del tablero directamente del programa.
 * - Líneas y bandas de corte acotadas estrictamente a su región activa padre.
 * - Navegación paso a paso (anterior/siguiente, selección de pasada, resaltado
 *   de región activa, línea de corte, huella de disco y pieza obtenida).
 * - Banners honestos para planes anteriores sin programa (con botón de regeneración)
 *   y programas inválidos (con causa de error y bloqueo de secuencia).
 * - Diferenciación estricta entre Retazos Útiles (verde) y Descarte/Merma (gris).
 * - Bordes con canto/cintilla en Azul Cobalto Técnico profesional.
 * - Tooltip interactivo al pasar el cursor.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Info,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import {
  formatMm,
  type ProductionCutRow,
  type CutPlanSheet,
  type CutPlanPlacedPiece,
  type CutProgramStepView,
} from '@granete/domain';
import './productionBoardView.css';
import {
  computeBoardCutLayout,
  DEFAULT_SHEET_L,
  DEFAULT_SHEET_W,
  EMPTY_BOARD_CUT_LAYOUT,
  simplePack,
} from './board/productionBoardLayout';
import { ProductionBoardSvg } from './board/ProductionBoardSvg';
import { ProductionBoardHoverCard } from './board/ProductionBoardHoverCard';

export interface ProductionBoardViewProps {
  readonly rows?: readonly ProductionCutRow[];
  readonly sheet?: CutPlanSheet;
  readonly sheetWidthMm?: number;
  readonly sheetHeightMm?: number;
  readonly showEstimateMetrics?: boolean;
  readonly onSelectPiece?: (piece: CutPlanPlacedPiece) => void;
  /** Step-by-step navigation (#650 PR 3). */
  readonly selectedStepIndex?: number | null;
  readonly onSelectStep?: (stepIndex: number | null) => void;
  /** Re-generation callback when an older plan lacks cutProgram. */
  readonly onRegeneratePlan?: () => void;
}

export function ProductionBoardView({
  rows,
  sheet,
  sheetWidthMm,
  sheetHeightMm,
  showEstimateMetrics = false,
  onSelectPiece,
  selectedStepIndex,
  onSelectStep,
  onRegeneratePlan,
}: ProductionBoardViewProps): ReactNode {
  const [hoveredPiece, setHoveredPiece] =
    useState<CutPlanPlacedPiece | null>(null);
  const [internalStepIndex, setInternalStepIndex] = useState<number | null>(null);

  const lengthMm = sheet
    ? sheet.sheetLengthMm
    : (sheetHeightMm ?? DEFAULT_SHEET_L);
  const widthMm = sheet
    ? sheet.sheetWidthMm
    : (sheetWidthMm ?? DEFAULT_SHEET_W);

  const isExactPlan = Boolean(sheet && sheet.pieces);
  const isNestingSheet = isExactPlan && sheet?.strategy === 'cnc-nesting';

  const legacyPlaced = useMemo(() => {
    if (isExactPlan || !rows) return [];
    return simplePack(rows, lengthMm, widthMm);
  }, [rows, lengthMm, widthMm, isExactPlan]);

  const scale = 720 / lengthMm;
  const svgW = lengthMm * scale;
  const svgH = widthMm * scale;

  // Authoritative cut program projection (#650 PR 3)
  const layout = useMemo(
    () =>
      isNestingSheet
        ? EMPTY_BOARD_CUT_LAYOUT
        : computeBoardCutLayout(sheet, lengthMm, widthMm),
    [sheet, lengthMm, widthMm, isNestingSheet],
  );

  const steps: readonly CutProgramStepView[] = layout.projection?.steps ?? [];
  const totalSteps = steps.length;

  // Controlled or uncontrolled step selection
  const activeStepIndex =
    selectedStepIndex !== undefined ? selectedStepIndex : internalStepIndex;

  const handleSelectStep = (idx: number | null) => {
    if (onSelectStep) {
      onSelectStep(idx);
    } else {
      setInternalStepIndex(idx);
    }
  };

  // Reconcile/reset selection whenever the sheet or its actual program object
  // changes (a regenerated program for the same sheet/material must not keep a
  // stale step index). Reference identity is deterministic and never
  // serializes the program on every render (#650 PR #655 R5).
  const programRef = sheet?.cutProgram;
  useEffect(() => {
    handleSelectStep(null);
  }, [sheet, programRef]);

  const activeStep: CutProgramStepView | null =
    activeStepIndex != null &&
    activeStepIndex >= 0 &&
    activeStepIndex < totalSteps
      ? steps[activeStepIndex] ?? null
      : null;

  const fillPct = useMemo(() => {
    if (sheet) return sheet.yieldPercent;
    if (!showEstimateMetrics || !rows || rows.length === 0) return null;
    const sheetArea = lengthMm * widthMm;
    if (!(sheetArea > 0)) return null;
    let pieceArea = 0;
    for (const r of rows) {
      pieceArea += r.lengthMm * r.widthMm * Math.max(1, r.quantity);
    }
    return Math.min(100, Math.round((pieceArea / sheetArea) * 1000) / 10);
  }, [sheet, rows, lengthMm, widthMm, showEstimateMetrics]);

  return (
    <div className="production-board" data-testid="production-board-view">
      <div className="production-board__header">
        <span className="production-board__label">
          {sheet
            ? `Tablero #${sheet.sheetIndex + 1} (${sheet.materialName}) · `
            : ''}
          {lengthMm} × {widthMm} mm
          {isExactPlan
            ? isNestingSheet
              ? ' · CNC Nesting'
              : layout.programStatus === 'valid'
                ? ` · Guillotina 2D (${layout.layoutDirection === 'horizontal' ? 'Franjas Horizontales' : 'Columnas Verticales'})`
                : layout.programStatus === 'invalid'
                  ? ' · Guillotina 2D (Programa no válido)'
                  : ' · Guillotina 2D'
            : showEstimateMetrics
              ? ' · preview estimada'
              : ''}
        </span>
        <span className="production-board__count">
          {isExactPlan
            ? `${sheet!.pieces.length} piezas`
            : `${legacyPlaced.length} piezas`}
          {fillPct != null ? ` · ${fillPct}% aprovechamiento` : ''}
          {sheet && sheet.wastePercent > 0
            ? ` (${sheet.wastePercent}% merma)`
            : ''}
        </span>
      </div>

      {/* Honest banner: Missing program in legacy plan */}
      {isExactPlan && !isNestingSheet && layout.programStatus === 'missing' && (
        <div
          data-testid="missing-program-banner"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '8px 12px',
            marginBottom: 8,
            background: 'var(--surface-muted)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.82em',
            color: 'var(--text-secondary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Info size={14} strokeWidth={1.5} aria-hidden />
            <span>
              <strong>Plan anterior sin programa:</strong> este plan no dispone de programa de corte verificado.
              Regenerá el plan para disponer de la secuencia de corte exacta e instrucciones.
            </span>
          </div>
          {onRegeneratePlan && (
            <button
              type="button"
              className="btn btn--small"
              onClick={onRegeneratePlan}
              data-testid="btn-regenerate-from-banner"
            >
              <Zap size={14} strokeWidth={1.5} aria-hidden /> Regenerar plan
            </button>
          )}
        </div>
      )}

      {/* Honest banner: Invalid program */}
      {isExactPlan && layout.programStatus === 'invalid' && (
        <div
          data-testid="invalid-program-banner"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            marginBottom: 8,
            background: 'var(--danger-50)',
            border: '1px solid var(--danger-500)',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.82em',
            color: 'var(--danger-700)',
          }}
        >
          <TriangleAlert size={14} strokeWidth={1.5} aria-hidden />
          <span>
            <strong>Programa de corte inválido:</strong> {layout.errorMessage}. Secuencia de corte bloqueada.
          </span>
        </div>
      )}

      {/* Visual Legend Bar */}
      {isExactPlan && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '14px',
            alignItems: 'center',
            fontSize: '0.78em',
            color: 'var(--text-muted)',
            padding: '6px 8px',
            background: 'var(--surface-card)',
            borderBottom: '1px solid var(--border-default)',
            marginBottom: '6px',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                display: 'inline-block',
                width: 14,
                height: 4,
                background: '#2563eb',
                borderRadius: 2,
              }}
            />
            <span>Canto / Cintilla (Azul)</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                background: 'rgba(34, 197, 94, 0.2)',
                border: '1px dashed #16a34a',
                borderRadius: 2,
              }}
            />
            <span>Retazo Útil de Almacén (≥ 600×400mm)</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                background: '#e2e8f0',
                border: '1px dotted #94a3b8',
                borderRadius: 2,
              }}
            />
            <span>Despunte / Descarte (Merma)</span>
          </span>
          {!activeStep && layout.primaryCut != null && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: '#d97706',
                fontWeight: 600,
              }}
            >
              <span>{layout.primaryCut.label}</span>
            </span>
          )}
        </div>
      )}

      {/* Step-by-Step Navigation Toolbar (#650 PR 3) */}
      {isExactPlan && layout.programStatus === 'valid' && totalSteps > 0 && (
        <div
          className="production-board__step-nav"
          data-testid="production-board-step-nav"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn--small ${activeStepIndex == null ? '' : 'btn--ghost'}`}
              onClick={() => handleSelectStep(null)}
              data-testid="step-nav-general"
            >
              Vista general
            </button>
            <button
              type="button"
              className="btn btn--small btn--ghost"
              disabled={activeStepIndex == null || activeStepIndex <= 0}
              onClick={() =>
                handleSelectStep(activeStepIndex == null ? 0 : activeStepIndex - 1)
              }
              aria-label="Paso anterior"
              data-testid="step-nav-prev"
            >
              <ChevronLeft size={14} strokeWidth={1.5} aria-hidden /> Anterior
            </button>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.85em',
                fontWeight: 500,
              }}
            >
              <span>Pasada:</span>
              <select
                value={activeStepIndex == null ? '' : activeStepIndex}
                onChange={(e) =>
                  handleSelectStep(e.target.value === '' ? null : Number(e.target.value))
                }
                data-testid="step-nav-select"
                style={{
                  padding: '3px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-default)',
                  background: 'var(--surface-input)',
                  fontSize: '0.9em',
                }}
              >
                <option value="">Vista general ({totalSteps} cortes)</option>
                {steps.map((s) => (
                  <option key={s.cutId} value={s.stepIndex}>
                    #{s.stepNumber}: {s.isTrim
                      ? `Refilado (${formatMm(s.trimAmountMm ?? 0)} mm · línea ${formatMm(s.cutOffsetMm)} mm)`
                      : s.producedPiece
                        ? `Pieza [${s.producedPiece.partCode}]`
                        : 'Separación'} ({formatMm(s.cutOffsetMm)} mm)
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn--small btn--ghost"
              disabled={activeStepIndex != null && activeStepIndex >= totalSteps - 1}
              onClick={() =>
                handleSelectStep(activeStepIndex == null ? 0 : activeStepIndex + 1)
              }
              aria-label="Paso siguiente"
              data-testid="step-nav-next"
            >
              Siguiente <ChevronRight size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </div>

          {activeStep && (
            <div
              style={{
                fontSize: '0.82em',
                color: 'var(--text-secondary)',
                background: 'var(--surface-muted)',
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)',
              }}
              data-testid="step-info-summary"
            >
              <strong style={{ color: 'var(--warning-700)' }}>
                Pasada #{activeStep.stepNumber} de {totalSteps}:
              </strong>{' '}
              Línea: <strong>{formatMm(activeStep.cutOffsetMm)} mm</strong> desde el origen de la región (eje {activeStep.axis.toUpperCase()})
              {activeStep.isTrim ? <> · Refilado: <strong>{formatMm(activeStep.trimAmountMm ?? 0)} mm</strong></> : ''} ·{' '}
              Disco: <strong>{formatMm(activeStep.nominalKerfMm)} mm</strong>{' '}
              {activeStep.bladeExitsParent
                ? `(consumo local: ${formatMm(activeStep.consumedKerfMm)} mm, salida verificada) · `
                : '· '}
              Región: {formatMm(activeStep.parentRect.lengthMm)}×{formatMm(activeStep.parentRect.widthMm)} mm
              {activeStep.producedPiece && (
                <span style={{ color: 'var(--success-700)', fontWeight: 600 }}>
                  {' '}· Obtiene: [{activeStep.producedPiece.partCode}] {activeStep.producedPiece.partName}
                </span>
              )}
              {activeStep.producedRemnant && (
                <span style={{ color: 'var(--success-700)', fontWeight: 600 }}>
                  {' '}· Retazo útil: {formatMm(activeStep.producedRemnant.lengthMm)}×{formatMm(activeStep.producedRemnant.widthMm)} mm
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {(isExactPlan && sheet!.pieces.length === 0) ||
      (!isExactPlan && (!rows || rows.length === 0)) ? (
        <p className="production-board__empty">
          Sin piezas de corte para mostrar.
        </p>
      ) : (
        <div style={{ position: 'relative' }}>
          <ProductionBoardSvg
            sheet={sheet}
            isExactPlan={isExactPlan}
            legacyPlaced={legacyPlaced}
            layout={layout}
            scale={scale}
            svgW={svgW}
            svgH={svgH}
            hoveredPiece={hoveredPiece}
            onHoverPiece={setHoveredPiece}
            onSelectPiece={onSelectPiece}
            activeStep={activeStep}
          />
          <ProductionBoardHoverCard piece={hoveredPiece} />
        </div>
      )}
    </div>
  );
}
