/**
 * ProductionBoardView — Plan de tablero visual SVG para el taller y almacén (F115).
 *
 * Soporta renderizado de CutPlanSheet del optimizador guillotina 2D con:
 * - Detección automática del eje de corte (Franjas Horizontales en Y vs Columnas Verticales en X)
 * - Proyección exacta de líneas de corte guillotina de orilla a orilla (como en la escuadradora)
 * - Marcador fiel del 1er Corte Primario del tablero (en horizontal o vertical según corresponda)
 * - Diferenciación estricta entre Retazos Útiles (verde ≥ 600×400mm) y Descarte/Merma (gris)
 * - Despuntes y sobrantes de franja continuos y acotados
 * - Bordes con canto/cintilla en Azul Cobalto Técnico profesional
 * - Tooltip interactivo al pasar el cursor
 */

import { useMemo, useState, type ReactNode } from 'react';
import type {
  ProductionCutRow,
  CutPlanSheet,
  CutPlanPlacedPiece,
} from '@muebles/domain';
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
}

export function ProductionBoardView({
  rows,
  sheet,
  sheetWidthMm,
  sheetHeightMm,
  showEstimateMetrics = false,
  onSelectPiece,
}: ProductionBoardViewProps): ReactNode {
  const [hoveredPiece, setHoveredPiece] =
    useState<CutPlanPlacedPiece | null>(null);

  const lengthMm = sheet
    ? sheet.sheetLengthMm
    : (sheetHeightMm ?? DEFAULT_SHEET_L);
  const widthMm = sheet
    ? sheet.sheetWidthMm
    : (sheetWidthMm ?? DEFAULT_SHEET_W);

  const isExactPlan = Boolean(sheet && sheet.pieces);
  // Nesting sheets (F124) have no guillotine structure: strip rip lines, cross
  // cuts and the 1st-cut marker are saw-only decorations.
  const isNestingSheet = isExactPlan && sheet?.strategy === 'cnc-nesting';

  const legacyPlaced = useMemo(() => {
    if (isExactPlan || !rows) return [];
    return simplePack(rows, lengthMm, widthMm);
  }, [rows, lengthMm, widthMm, isExactPlan]);

  const scale = 720 / lengthMm;
  const svgW = lengthMm * scale;
  const svgH = widthMm * scale;

  // Analysis of Guillotine cuts, strips, and waste gaps (saw sheets only)
  const layout = useMemo(
    () =>
      isNestingSheet
        ? EMPTY_BOARD_CUT_LAYOUT
        : computeBoardCutLayout(sheet, lengthMm, widthMm),
    [sheet, lengthMm, widthMm, isNestingSheet],
  );

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
              : ` · Guillotina 2D (${layout.layoutDirection === 'horizontal' ? 'Franjas Horizontales' : 'Columnas Verticales'})`
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
          {layout.primaryCut != null && (
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
          />
          <ProductionBoardHoverCard piece={hoveredPiece} />
        </div>
      )}
    </div>
  );
}
