/**
 * ProductionBoardSvg — High precision SVG rendering of board cuts, pieces, edges and remnants.
 */

import type { ReactNode } from 'react';
import type { CutPlanSheet, CutPlanPlacedPiece } from '@granete/domain';
import type {
  BoardCutLayout,
  PlacedPieceLegacy,
} from './productionBoardLayout';

export interface ProductionBoardSvgProps {
  readonly sheet?: CutPlanSheet;
  readonly isExactPlan: boolean;
  readonly legacyPlaced: readonly PlacedPieceLegacy[];
  readonly layout: BoardCutLayout;
  readonly scale: number;
  readonly svgW: number;
  readonly svgH: number;
  readonly hoveredPiece: CutPlanPlacedPiece | null;
  readonly onHoverPiece: (piece: CutPlanPlacedPiece | null) => void;
  readonly onSelectPiece?: (piece: CutPlanPlacedPiece) => void;
}

export function ProductionBoardSvg({
  sheet,
  isExactPlan,
  legacyPlaced,
  layout,
  scale,
  svgW,
  svgH,
  hoveredPiece,
  onHoverPiece,
  onSelectPiece,
}: ProductionBoardSvgProps): ReactNode {
  const { strips, crossCuts, wasteBlocks, primaryCut } = layout;

  return (
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
                    RETAZO {Math.round(rem.lengthMm)}×{Math.round(rem.widthMm)}{' '}
                    mm ({rem.areaM2.toFixed(2)} m²)
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
                <text x={wx + 3} y={wy + 10} fontSize={6.5} fill="#64748b">
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
              onMouseEnter={() => onHoverPiece(p)}
              onMouseLeave={() => onHoverPiece(null)}
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
                <text x={px + 4} y={py + 21} fontSize={7.5} fill="#475569">
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
                <text x={px + 4} y={py + 12} fontSize={9} fill="#0f172a">
                  {(p.row.partCode || p.row.description || '').slice(0, 12)}
                </text>
              ) : null}
            </g>
          );
        })}
    </svg>
  );
}
