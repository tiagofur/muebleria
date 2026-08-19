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
import type { ProductionCutRow, CutPlanSheet, CutPlanPlacedPiece } from '@muebles/domain';
import './productionBoardView.css';

export interface ProductionBoardViewProps {
  readonly rows?: readonly ProductionCutRow[];
  readonly sheet?: CutPlanSheet;
  readonly sheetWidthMm?: number;
  readonly sheetHeightMm?: number;
  readonly showEstimateMetrics?: boolean;
  readonly onSelectPiece?: (piece: CutPlanPlacedPiece) => void;
}

const DEFAULT_SHEET_L = 2440;
const DEFAULT_SHEET_W = 1830;
const PADDING_MM = 10;

interface PlacedPieceLegacy {
  readonly row: ProductionCutRow;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function simplePack(
  rows: readonly ProductionCutRow[],
  sheetL: number,
  sheetW: number,
): readonly PlacedPieceLegacy[] {
  const byMaterial = new Map<string, ProductionCutRow[]>();
  for (const row of rows) {
    const key = row.materialName || 'Sin material';
    const arr = byMaterial.get(key) ?? [];
    for (let i = 0; i < row.quantity; i++) {
      arr.push({ ...row, quantity: 1 });
    }
    byMaterial.set(key, arr);
  }

  const placed: PlacedPieceLegacy[] = [];
  let cursorY = PADDING_MM;

  for (const [, pieces] of byMaterial) {
    let cursorX = PADDING_MM;
    let stripHeight = 0;

    for (const piece of pieces) {
      const w = Math.min(piece.lengthMm, sheetL - PADDING_MM * 2);
      const h = Math.min(piece.widthMm, sheetW - PADDING_MM * 2);

      if (cursorX + w + PADDING_MM > sheetL) {
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

interface StripInfo {
  readonly axis: 'horizontal' | 'vertical';
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly cutCoordinate: number;
}

interface WasteBlock {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface CrossCutLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

interface PrimaryCutInfo {
  readonly axis: 'horizontal' | 'vertical';
  readonly coordinateMm: number;
  readonly label: string;
}

export function ProductionBoardView({
  rows,
  sheet,
  sheetWidthMm,
  sheetHeightMm,
  showEstimateMetrics = false,
  onSelectPiece,
}: ProductionBoardViewProps): ReactNode {
  const [hoveredPiece, setHoveredPiece] = useState<CutPlanPlacedPiece | null>(null);

  const lengthMm = sheet ? sheet.sheetLengthMm : (sheetHeightMm ?? DEFAULT_SHEET_L);
  const widthMm = sheet ? sheet.sheetWidthMm : (sheetWidthMm ?? DEFAULT_SHEET_W);

  const isExactPlan = Boolean(sheet && sheet.pieces);

  const legacyPlaced = useMemo(() => {
    if (isExactPlan || !rows) return [];
    return simplePack(rows, lengthMm, widthMm);
  }, [rows, lengthMm, widthMm, isExactPlan]);

  const scale = 720 / lengthMm;
  const svgW = lengthMm * scale;
  const svgH = widthMm * scale;

  // Analysis of Guillotine cuts, strips (horizontal vs vertical), and waste gaps
  const { layoutDirection, strips, crossCuts, wasteBlocks, primaryCut } = useMemo(() => {
    if (!sheet || !sheet.pieces || sheet.pieces.length === 0) {
      return {
        layoutDirection: 'horizontal' as const,
        strips: [] as StripInfo[],
        crossCuts: [] as CrossCutLine[],
        wasteBlocks: [] as WasteBlock[],
        primaryCut: null as PrimaryCutInfo | null,
      };
    }

    const pieces = sheet.pieces;

    // Determine layout direction: group by yMm (horizontal rows) vs xMm (vertical cols)
    const yClusters = new Map<number, CutPlanPlacedPiece[]>();
    const xClusters = new Map<number, CutPlanPlacedPiece[]>();

    for (const p of pieces) {
      // Y clustering
      let foundYKey: number | null = null;
      for (const k of yClusters.keys()) {
        if (Math.abs(k - p.yMm) <= 2) {
          foundYKey = k;
          break;
        }
      }
      if (foundYKey !== null) {
        yClusters.get(foundYKey)!.push(p);
      } else {
        yClusters.set(p.yMm, [p]);
      }

      // X clustering
      let foundXKey: number | null = null;
      for (const k of xClusters.keys()) {
        if (Math.abs(k - p.xMm) <= 2) {
          foundXKey = k;
          break;
        }
      }
      if (foundXKey !== null) {
        xClusters.get(foundXKey)!.push(p);
      } else {
        xClusters.set(p.xMm, [p]);
      }
    }

    const avgPiecesPerY = pieces.length / Math.max(1, yClusters.size);
    const avgPiecesPerX = pieces.length / Math.max(1, xClusters.size);

    const isHorizontal = avgPiecesPerY >= avgPiecesPerX;
    const computedStrips: StripInfo[] = [];
    const computedCrossCuts: CrossCutLine[] = [];
    const computedWaste: WasteBlock[] = [];
    let primCut: PrimaryCutInfo | null = null;

    if (isHorizontal) {
      // HORIZONTAL STRIPS (Layout in Rows)
      const sortedYKeys = [...yClusters.keys()].sort((a, b) => a - b);
      let maxUsedY = 0;

      for (const yKey of sortedYKeys) {
        const rowPieces = yClusters.get(yKey)!;
        const minY = Math.min(...rowPieces.map((p) => p.yMm));
        const maxY = Math.max(...rowPieces.map((p) => p.yMm + p.widthMm));
        const minX = Math.min(...rowPieces.map((p) => p.xMm));
        const maxX = Math.max(...rowPieces.map((p) => p.xMm + p.lengthMm));
        const rowHeight = maxY - minY;

        if (maxY > maxUsedY) maxUsedY = maxY;

        computedStrips.push({
          axis: 'horizontal',
          minX,
          maxX,
          minY,
          maxY,
          cutCoordinate: maxY,
        });

        // Vertical cross cuts between pieces in this horizontal row
        const sortedPiecesInRow = [...rowPieces].sort((a, b) => a.xMm - b.xMm);
        for (const p of sortedPiecesInRow) {
          const cutX = p.xMm + p.lengthMm;
          computedCrossCuts.push({
            x1: cutX,
            y1: minY,
            x2: cutX,
            y2: maxY,
          });

          // If piece height is less than row height, there is a waste strip above it
          if (p.widthMm < rowHeight - 1) {
            computedWaste.push({
              x: p.xMm,
              y: p.yMm + p.widthMm,
              w: p.lengthMm,
              h: rowHeight - p.widthMm,
            });
          }
        }

        // Leftover at the end of the row
        if (maxX < lengthMm - 15) {
          computedWaste.push({
            x: maxX,
            y: minY,
            w: lengthMm - maxX,
            h: rowHeight,
          });
        }
      }

      // Check if there is a large useful remnant below/above the rows
      const largeUsefulRemnant = sheet.remnants.find(
        (r) => r.isUseful && r.yMm >= maxUsedY - 5 && r.areaM2 >= 0.24,
      );

      if (largeUsefulRemnant) {
        primCut = {
          axis: 'horizontal',
          coordinateMm: largeUsefulRemnant.yMm,
          label: `✂ 1er CORTE: Y = ${Math.round(largeUsefulRemnant.yMm)} mm`,
        };
      } else if (computedStrips.length > 0) {
        const firstStrip = computedStrips[0]!;
        primCut = {
          axis: 'horizontal',
          coordinateMm: firstStrip.maxY,
          label: `✂ 1er CORTE: Y = ${Math.round(firstStrip.maxY)} mm`,
        };
      }
    } else {
      // VERTICAL STRIPS (Layout in Columns)
      const sortedXKeys = [...xClusters.keys()].sort((a, b) => a - b);
      let maxUsedX = 0;

      for (const xKey of sortedXKeys) {
        const colPieces = xClusters.get(xKey)!;
        const minX = Math.min(...colPieces.map((p) => p.xMm));
        const maxX = Math.max(...colPieces.map((p) => p.xMm + p.lengthMm));
        const minY = Math.min(...colPieces.map((p) => p.yMm));
        const maxY = Math.max(...colPieces.map((p) => p.yMm + p.widthMm));
        const colWidth = maxX - minX;

        if (maxX > maxUsedX) maxUsedX = maxX;

        computedStrips.push({
          axis: 'vertical',
          minX,
          maxX,
          minY,
          maxY,
          cutCoordinate: maxX,
        });

        // Horizontal cross cuts between pieces in this vertical column
        const sortedPiecesInCol = [...colPieces].sort((a, b) => a.yMm - b.yMm);
        for (const p of sortedPiecesInCol) {
          const cutY = p.yMm + p.widthMm;
          computedCrossCuts.push({
            x1: minX,
            y1: cutY,
            x2: maxX,
            y2: cutY,
          });

          // If piece length is less than column width, there is a waste strip to the right of it
          if (p.lengthMm < colWidth - 1) {
            computedWaste.push({
              x: p.xMm + p.lengthMm,
              y: p.yMm,
              w: colWidth - p.lengthMm,
              h: p.widthMm,
            });
          }
        }

        // Leftover at the bottom of the column
        if (maxY < widthMm - 15) {
          computedWaste.push({
            x: minX,
            y: maxY,
            w: colWidth,
            h: widthMm - maxY,
          });
        }
      }

      // Check if there is a large useful remnant to the right
      const largeUsefulRemnant = sheet.remnants.find(
        (r) => r.isUseful && r.xMm >= maxUsedX - 5 && r.areaM2 >= 0.24,
      );

      if (largeUsefulRemnant) {
        primCut = {
          axis: 'vertical',
          coordinateMm: largeUsefulRemnant.xMm,
          label: `✂ 1er CORTE: X = ${Math.round(largeUsefulRemnant.xMm)} mm`,
        };
      } else if (computedStrips.length > 0) {
        const firstStrip = computedStrips[0]!;
        primCut = {
          axis: 'vertical',
          coordinateMm: firstStrip.maxX,
          label: `✂ 1er CORTE: X = ${Math.round(firstStrip.maxX)} mm`,
        };
      }
    }

    return {
      layoutDirection: isHorizontal ? ('horizontal' as const) : ('vertical' as const),
      strips: computedStrips,
      crossCuts: computedCrossCuts,
      wasteBlocks: computedWaste,
      primaryCut: primCut,
    };
  }, [sheet, lengthMm, widthMm]);

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
          {sheet ? `Tablero #${sheet.sheetIndex + 1} (${sheet.materialName}) · ` : ''}
          {lengthMm} × {widthMm} mm
          {isExactPlan ? ` · Guillotina 2D (${layoutDirection === 'horizontal' ? 'Franjas Horizontales' : 'Columnas Verticales'})` : showEstimateMetrics ? ' · preview estimada' : ''}
        </span>
        <span className="production-board__count">
          {isExactPlan ? `${sheet!.pieces.length} piezas` : `${legacyPlaced.length} piezas`}
          {fillPct != null ? ` · ${fillPct}% aprovechamiento` : ''}
          {sheet && sheet.wastePercent > 0 ? ` (${sheet.wastePercent}% merma)` : ''}
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
            <span style={{ display: 'inline-block', width: 14, height: 4, background: '#2563eb', borderRadius: 2 }} />
            <span>Canto / Cintilla (Azul)</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(34, 197, 94, 0.2)', border: '1px dashed #16a34a', borderRadius: 2 }} />
            <span>Retazo Útil de Almacén (≥ 600×400mm)</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 12, height: 12, background: '#e2e8f0', border: '1px dotted #94a3b8', borderRadius: 2 }} />
            <span>Despunte / Descarte (Merma)</span>
          </span>
          {primaryCut != null && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#d97706', fontWeight: 600 }}>
              <span>{primaryCut.label}</span>
            </span>
          )}
        </div>
      )}

      {(isExactPlan && sheet!.pieces.length === 0) || (!isExactPlan && (!rows || rows.length === 0)) ? (
        <p className="production-board__empty">Sin piezas de corte para mostrar.</p>
      ) : (
        <div style={{ position: 'relative' }}>
          <svg
            className="production-board__svg"
            width={svgW}
            height={svgH}
            viewBox={`0 0 ${svgW} ${svgH}`}
            data-testid="production-board-svg"
            style={{ background: '#f8fafc', borderRadius: 'var(--radius-sm)' }}
          >
            {/* Sheet raw board outline */}
            <rect
              x={0}
              y={0}
              width={svgW}
              height={svgH}
              fill="#f8fafc"
              stroke="#334155"
              strokeWidth={1.5}
            />

            {/* Useful Remnants (Green boxes ONLY if truly large and useful) */}
            {isExactPlan &&
              sheet!.remnants
                .filter((rem) => rem.isUseful && rem.areaM2 >= 0.24)
                .map((rem) => {
                  const rx = rem.xMm * scale;
                  const ry = rem.yMm * scale;
                  const rw = rem.lengthMm * scale;
                  const rh = rem.widthMm * scale;
                  return (
                    <g key={rem.id}>
                      <rect
                        x={rx}
                        y={ry}
                        width={rw}
                        height={rh}
                        fill="rgba(34, 197, 94, 0.14)"
                        stroke="#16a34a"
                        strokeWidth={1.5}
                        strokeDasharray="5 3"
                      />
                      {rw > 45 && rh > 18 ? (
                        <text
                          x={rx + 6}
                          y={ry + 14}
                          fontSize={8.5}
                          fontWeight="bold"
                          fill="#15803d"
                        >
                          RETAZO {Math.round(rem.lengthMm)}×{Math.round(rem.widthMm)} mm ({rem.areaM2.toFixed(2)} m²)
                        </text>
                      ) : null}
                    </g>
                  );
                })}

            {/* Small Scraps / Offcuts (subtle grey descarte) */}
            {isExactPlan &&
              sheet!.remnants
                .filter((rem) => !rem.isUseful || rem.areaM2 < 0.24)
                .map((rem) => {
                  const rx = rem.xMm * scale;
                  const ry = rem.yMm * scale;
                  const rw = rem.lengthMm * scale;
                  const rh = rem.widthMm * scale;
                  if (rw < 5 || rh < 5) return null;
                  return (
                    <g key={`scrap-${rem.id}`}>
                      <rect
                        x={rx}
                        y={ry}
                        width={rw}
                        height={rh}
                        fill="#f1f5f9"
                        stroke="#cbd5e1"
                        strokeWidth={0.8}
                        strokeDasharray="2 2"
                      />
                    </g>
                  );
                })}

            {/* Continuous Strip Waste Blocks (Gaps between uneven pieces within strips) */}
            {isExactPlan &&
              wasteBlocks.map((wb, idx) => {
                const wx = wb.x * scale;
                const wy = wb.y * scale;
                const ww = wb.w * scale;
                const wh = wb.h * scale;
                if (ww < 4 || wh < 4) return null;
                return (
                  <g key={`waste-${idx}`}>
                    <rect
                      x={wx}
                      y={wy}
                      width={ww}
                      height={wh}
                      fill="#e2e8f0"
                      stroke="#94a3b8"
                      strokeWidth={0.8}
                      strokeDasharray="2 2"
                    />
                    {ww > 26 && wh > 14 && (
                      <text
                        x={wx + 3}
                        y={wy + 10}
                        fontSize={6.5}
                        fill="#64748b"
                      >
                        {Math.round(wb.w)}×{Math.round(wb.h)}
                      </text>
                    )}
                  </g>
                );
              })}

            {/* Continuous Guillotine Strip Rip Lines */}
            {isExactPlan &&
              strips.map((s, idx) => {
                if (s.axis === 'horizontal') {
                  const sy = s.maxY * scale;
                  return (
                    <line
                      key={`rip-h-${idx}`}
                      x1={0}
                      y1={sy}
                      x2={svgW}
                      y2={sy}
                      stroke="#64748b"
                      strokeWidth={1}
                      strokeDasharray="5 3"
                    />
                  );
                } else {
                  const sx = s.maxX * scale;
                  return (
                    <line
                      key={`rip-v-${idx}`}
                      x1={sx}
                      y1={0}
                      x2={sx}
                      y2={svgH}
                      stroke="#64748b"
                      strokeWidth={1}
                      strokeDasharray="5 3"
                    />
                  );
                }
              })}

            {/* Continuous Cross Cut Lines (within strips) */}
            {isExactPlan &&
              crossCuts.map((cc, idx) => (
                <line
                  key={`cross-${idx}`}
                  x1={cc.x1 * scale}
                  y1={cc.y1 * scale}
                  x2={cc.x2 * scale}
                  y2={cc.y2 * scale}
                  stroke="#94a3b8"
                  strokeWidth={0.9}
                  strokeDasharray="3 2"
                />
              ))}

            {/* Primary Cut Marker Line (1er Corte Real del Tablero) */}
            {isExactPlan && primaryCut != null && (
              <g>
                {primaryCut.axis === 'horizontal' ? (
                  <>
                    <line
                      x1={0}
                      y1={primaryCut.coordinateMm * scale}
                      x2={svgW}
                      y2={primaryCut.coordinateMm * scale}
                      stroke="#d97706"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                    />
                    <rect
                      x={4}
                      y={primaryCut.coordinateMm * scale - 8}
                      width={120}
                      height={16}
                      rx={3}
                      fill="#d97706"
                    />
                    <text
                      x={64}
                      y={primaryCut.coordinateMm * scale + 3}
                      fontSize={7.5}
                      fontWeight="bold"
                      fill="#ffffff"
                      textAnchor="middle"
                    >
                      {primaryCut.label}
                    </text>
                  </>
                ) : (
                  <>
                    <line
                      x1={primaryCut.coordinateMm * scale}
                      y1={0}
                      x2={primaryCut.coordinateMm * scale}
                      y2={svgH}
                      stroke="#d97706"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                    />
                    <rect
                      x={primaryCut.coordinateMm * scale - 55}
                      y={4}
                      width={110}
                      height={16}
                      rx={3}
                      fill="#d97706"
                    />
                    <text
                      x={primaryCut.coordinateMm * scale}
                      y={15}
                      fontSize={7.5}
                      fontWeight="bold"
                      fill="#ffffff"
                      textAnchor="middle"
                    >
                      {primaryCut.label}
                    </text>
                  </>
                )}
              </g>
            )}

            {/* Exact CutPlan Pieces */}
            {isExactPlan &&
              sheet!.pieces.map((p, i) => {
                const px = p.xMm * scale;
                const py = p.yMm * scale;
                const pw = p.lengthMm * scale;
                const ph = p.widthMm * scale;
                const isHovered = hoveredPiece?.id === p.id;

                return (
                  <g
                    key={p.id || i}
                    style={{ cursor: onSelectPiece ? 'pointer' : 'default' }}
                    onMouseEnter={() => setHoveredPiece(p)}
                    onMouseLeave={() => setHoveredPiece(null)}
                    onClick={() => onSelectPiece?.(p)}
                  >
                    {/* Piece Body: Crisp white background with clean slate border */}
                    <rect
                      x={px}
                      y={py}
                      width={pw}
                      height={ph}
                      fill={isHovered ? '#fef08a' : '#ffffff'}
                      stroke="#334155"
                      strokeWidth={isHovered ? 2 : 1}
                      data-testid={`production-piece-${i}`}
                    />

                    {/* Edge Banding Lines: Technical Cobalt Blue (L1, L2, W1, W2) */}
                    {p.L1 === 1 && (
                      <line
                        x1={px}
                        y1={py + ph}
                        x2={px + pw}
                        y2={py + ph}
                        stroke="#2563eb"
                        strokeWidth={2}
                      />
                    )}
                    {p.L2 === 1 && (
                      <line
                        x1={px}
                        y1={py}
                        x2={px + pw}
                        y2={py}
                        stroke="#2563eb"
                        strokeWidth={2}
                      />
                    )}
                    {p.W1 === 1 && (
                      <line
                        x1={px}
                        y1={py}
                        x2={px}
                        y2={py + ph}
                        stroke="#2563eb"
                        strokeWidth={2}
                      />
                    )}
                    {p.W2 === 1 && (
                      <line
                        x1={px + pw}
                        y1={py}
                        x2={px + pw}
                        y2={py + ph}
                        stroke="#2563eb"
                        strokeWidth={2}
                      />
                    )}

                    {/* Part Code Label */}
                    {pw > 32 && ph > 16 ? (
                      <text
                        x={px + 4}
                        y={py + 11}
                        fontSize={8.5}
                        fontWeight="bold"
                        fill="#0f172a"
                      >
                        {p.partCode}
                      </text>
                    ) : null}

                    {/* Dimensions Label (Length × Width) */}
                    {pw > 36 && ph > 26 ? (
                      <text
                        x={px + 4}
                        y={py + 21}
                        fontSize={7.5}
                        fill="#475569"
                      >
                        {p.lengthMm}×{p.widthMm}
                      </text>
                    ) : null}

                    {/* Grain dashed indicator */}
                    {p.grain === 1 && pw > 24 && ph > 16 ? (
                      <line
                        x1={px + 4}
                        y1={py + ph - 4}
                        x2={px + pw - 4}
                        y2={py + ph - 4}
                        stroke="#94a3b8"
                        strokeWidth={1}
                        strokeDasharray="3 2"
                      />
                    ) : null}
                  </g>
                );
              })}

            {/* Legacy Pieces fallback */}
            {!isExactPlan &&
              legacyPlaced.map((p, i) => {
                const px = p.x * scale;
                const py = p.y * scale;
                const pw = p.w * scale;
                const ph = p.h * scale;

                return (
                  <g key={i}>
                    <rect
                      x={px}
                      y={py}
                      width={pw}
                      height={ph}
                      fill="#ffffff"
                      stroke="#334155"
                      strokeWidth={1}
                      data-testid={`production-piece-${i}`}
                    />
                    {pw > 40 && ph > 20 ? (
                      <text
                        x={px + 4}
                        y={py + 12}
                        fontSize={9}
                        fill="#0f172a"
                      >
                        {(p.row.partCode || p.row.description || '').slice(0, 12)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
          </svg>

          {/* Interactive Piece Details Hover Card */}
          {hoveredPiece && (
            <div
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                background: 'rgba(15, 23, 42, 0.95)',
                color: '#fff',
                padding: '8px 12px',
                borderRadius: 6,
                fontSize: 11,
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                pointerEvents: 'none',
                zIndex: 10,
                lineHeight: 1.4,
              }}
            >
              <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 2 }}>
                [{hoveredPiece.partCode}] {hoveredPiece.partName}
              </div>
              <div>Módulo: {hoveredPiece.moduleCode || '—'}</div>
              <div>Corte sierra: <strong>{hoveredPiece.lengthMm} × {hoveredPiece.widthMm} mm</strong></div>
              <div>Medida final: {hoveredPiece.originalLengthMm} × {hoveredPiece.originalWidthMm} mm</div>
              <div>Veta: {hoveredPiece.grain === 1 ? 'Longitudinal' : 'Sin veta'} {hoveredPiece.rotated ? '(Rotada 90°)' : ''}</div>
              <div>
                Cantos: L1={hoveredPiece.L1 ? '✓' : '-'} L2={hoveredPiece.L2 ? '✓' : '-'} W1={hoveredPiece.W1 ? '✓' : '-'} W2={hoveredPiece.W2 ? '✓' : '-'}
                {hoveredPiece.edgeBandThicknessMm ? ` (${hoveredPiece.edgeBandThicknessMm}mm)` : ''}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
