/**
 * ProductionBoardView — plan de tablero visual SVG que muestra las piezas
 * de corte acomodadas sobre un tablero estándar 2440×1220 mm (Fase 4 slice 4.2).
 *
 * No hace nesting real (eso lo hace el optimizador externo). Muestra las
 * piezas como rectángulos proporcionales sobre el tablero, agrupadas por
 * material, con etiquetas de código + medidas.
 */

import { useMemo, type ReactNode } from 'react';
import type { ProductionCutRow } from '@muebles/domain';
import './productionBoardView.css';

export interface ProductionBoardViewProps {
  readonly rows: readonly ProductionCutRow[];
  readonly sheetWidthMm?: number;
  readonly sheetHeightMm?: number;
  /**
   * When true, show grain hash marks and estimated fill % (heuristic pack only).
   * PROD-2.1 — never presents as machine-official nesting.
   */
  readonly showEstimateMetrics?: boolean;
}

const DEFAULT_SHEET_W = 2440;
const DEFAULT_SHEET_H = 1220;
const PADDING_MM = 10; // margin around each piece on the sheet

interface PlacedPiece {
  readonly row: ProductionCutRow;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Simple left-to-right, top-to-bottom packing (not optimized — just visual).
 * Groups by material, stacks pieces within each material's strip.
 */
function simplePack(
  rows: readonly ProductionCutRow[],
  sheetW: number,
  sheetH: number,
): readonly PlacedPiece[] {
  const byMaterial = new Map<string, ProductionCutRow[]>();
  for (const row of rows) {
    const key = row.materialName || 'Sin material';
    const arr = byMaterial.get(key) ?? [];
    for (let i = 0; i < row.quantity; i++) {
      arr.push({ ...row, quantity: 1 });
    }
    byMaterial.set(key, arr);
  }

  const placed: PlacedPiece[] = [];
  let cursorY = PADDING_MM;

  for (const [, pieces] of byMaterial) {
    let cursorX = PADDING_MM;
    let stripHeight = 0;

    for (const piece of pieces) {
      const w = Math.min(piece.lengthMm, sheetW - PADDING_MM * 2);
      const h = Math.min(piece.widthMm, sheetH - PADDING_MM * 2);

      if (cursorX + w + PADDING_MM > sheetW) {
        // Wrap to next row.
        cursorX = PADDING_MM;
        cursorY += stripHeight + PADDING_MM;
        stripHeight = 0;
      }

      placed.push({ row: piece, x: cursorX, y: cursorY, w, h });
      cursorX += w + PADDING_MM;
      stripHeight = Math.max(stripHeight, h);
    }
    cursorY += stripHeight + PADDING_MM * 2;
  }

  return placed;
}

export function ProductionBoardView({
  rows,
  sheetWidthMm = DEFAULT_SHEET_W,
  sheetHeightMm = DEFAULT_SHEET_H,
  showEstimateMetrics = false,
}: ProductionBoardViewProps): ReactNode {
  const placed = useMemo(
    () => simplePack(rows, sheetWidthMm, sheetHeightMm),
    [rows, sheetWidthMm, sheetHeightMm],
  );

  // Scale: fit sheet into ~600px wide.
  const scale = 600 / sheetWidthMm;
  const svgW = sheetWidthMm * scale;
  const svgH = sheetHeightMm * scale;

  const fillPct = useMemo(() => {
    if (!showEstimateMetrics || rows.length === 0) return null;
    const sheetArea = sheetWidthMm * sheetHeightMm;
    if (!(sheetArea > 0)) return null;
    let pieceArea = 0;
    for (const r of rows) {
      pieceArea += r.lengthMm * r.widthMm * Math.max(1, r.quantity);
    }
    // Cap at 100 for display; simple pack may overflow sheet visually.
    return Math.min(100, Math.round((pieceArea / sheetArea) * 1000) / 10);
  }, [rows, sheetWidthMm, sheetHeightMm, showEstimateMetrics]);

  // Unique materials for color assignment.
  const materialColors = useMemo(() => {
    const colors = ['#d4c4a8', '#c4a574', '#a8c4d4', '#c4d4a8', '#d4a8c4', '#a8d4c4'];
    const materials = [...new Set(rows.map((r) => r.materialName || 'Sin material'))];
    const map: Record<string, string> = {};
    materials.forEach((m, i) => {
      map[m] = colors[i % colors.length]!;
    });
    return map;
  }, [rows]);

  return (
    <div className="production-board" data-testid="production-board-view">
      <div className="production-board__header">
        <span className="production-board__label">
          Tablero {sheetWidthMm} × {sheetHeightMm} mm
          {showEstimateMetrics ? ' · preview estimada' : ''}
        </span>
        <span className="production-board__count">
          {placed.length} pieza{placed.length === 1 ? '' : 's'}
          {fillPct != null ? ` · ~${fillPct}% área` : ''}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="production-board__empty">
          Sin piezas de corte para mostrar.
        </p>
      ) : (
        <svg
          className="production-board__svg"
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          data-testid="production-board-svg"
        >
          {/* Sheet outline */}
          <rect
            x={0}
            y={0}
            width={svgW}
            height={svgH}
            fill="var(--surface-muted)"
            stroke="var(--border-strong)"
            strokeWidth={2}
          />
          {/* Placed pieces */}
          {placed.map((p, i) => {
            const color = materialColors[p.row.materialName || 'Sin material'] ?? '#d4c4a8';
            return (
              <g key={i}>
                <rect
                  x={p.x * scale}
                  y={p.y * scale}
                  width={p.w * scale}
                  height={p.h * scale}
                  fill={color}
                  stroke="var(--border-strong)"
                  strokeWidth={1}
                  opacity={0.85}
                  data-testid={`production-piece-${i}`}
                />
                {p.w * scale > 40 && p.h * scale > 20 ? (
                  <text
                    x={p.x * scale + 4}
                    y={p.y * scale + 12}
                    fontSize={9}
                    fill="var(--text-primary)"
                  >
                    {(p.row.partCode || p.row.description || '').slice(0, 12)}
                  </text>
                ) : null}
                {showEstimateMetrics &&
                p.row.grain === 1 &&
                p.w * scale > 24 &&
                p.h * scale > 16 ? (
                  <line
                    x1={p.x * scale + 4}
                    y1={p.y * scale + p.h * scale - 6}
                    x2={p.x * scale + p.w * scale - 4}
                    y2={p.y * scale + p.h * scale - 6}
                    stroke="var(--text-muted)"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                    data-testid={`production-piece-grain-${i}`}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
