/**
 * ProductionBoardSvg — High precision SVG rendering of board cuts, pieces, edges and remnants.
 *
 * Since #650 PR 3, all cutting lines, primary cut markers, kerf bands and waste
 * areas derive strictly from the authoritative executed cut program in
 * @granete/domain. Supports both general layout view and step-by-step navigation
 * with active region, cut line/band, nominal tool overhang, and piece isolation
 * highlighting.
 *
 * Single explicit board→SVG transform (#650 PR 3 review): X grows to the right
 * and board Y=0 (borde inferior, the domain frame also used by the PDF export)
 * renders at the BOTTOM of the drawing. Every geometric element goes through
 * sx/sy — no Y inversions are distributed anywhere else.
 */

import type { ReactNode } from 'react';
import { formatMm, type CutPlanSheet, type CutPlanPlacedPiece, type CutProgramStepView } from '@granete/domain';
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
  /** Active step for step-by-step preview (#650 PR 3). */
  readonly activeStep?: CutProgramStepView | null;
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
  activeStep,
}: ProductionBoardSvgProps): ReactNode {
  const { wasteBlocks, primaryCut, projection } = layout;

  // The one board→SVG transform: program-local IDs repeat across boards, so
  // keys/testids carry the board context to stay collision-free.
  const boardKey = isExactPlan && sheet ? `b${sheet.sheetIndex}` : 'legacy';
  const sx = (xMm: number): number => xMm * scale;
  const sy = (yMm: number, extentMm = 0): number => svgH - (yMm + extentMm) * scale;

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

      {/* Useful Remnants (Green dashed boxes) */}
      {isExactPlan &&
        sheet!.remnants
          .filter((rem) => rem.isUseful && rem.areaM2 >= 0.24)
          .map((rem) => {
            const rx = sx(rem.xMm);
            const ry = sy(rem.yMm, rem.widthMm);
            const rw = rem.lengthMm * scale;
            const rh = rem.widthMm * scale;
            return (
              <g key={`${boardKey}-rem-${rem.id}`}>
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
            const rx = sx(rem.xMm);
            const ry = sy(rem.yMm, rem.widthMm);
            const rw = rem.lengthMm * scale;
            const rh = rem.widthMm * scale;
            if (rw < 5 || rh < 5) return null;
            return (
              <g key={`${boardKey}-scrap-${rem.id}`}>
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

      {/* Waste Blocks from Program Terminals */}
      {isExactPlan &&
        wasteBlocks.map((wb, idx) => {
          const wx = sx(wb.x);
          const wy = sy(wb.y, wb.h);
          const ww = wb.w * scale;
          const wh = wb.h * scale;
          if (ww < 4 || wh < 4) return null;
          return (
            <g key={`${boardKey}-waste-${idx}`}>
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

      {/* GENERAL VIEW: Authoritative Cuts strictly bounded to their parent regions */}
      {isExactPlan && !activeStep && projection?.cuts && (
        <g data-testid="production-board-cuts">
          {projection.cuts.map((cut) => {
            const cx1 = sx(cut.cutLine.x1);
            const cy1 = sy(cut.cutLine.y1);
            const cx2 = sx(cut.cutLine.x2);
            const cy2 = sy(cut.cutLine.y2);

            const kx = sx(cut.kerfBandRect.xMm);
            const ky = sy(cut.kerfBandRect.yMm, cut.kerfBandRect.widthMm);
            const kw = cut.kerfBandRect.lengthMm * scale;
            const kh = cut.kerfBandRect.widthMm * scale;

            return (
              <g
                key={`${boardKey}-prog-cut-${cut.cutId}`}
                data-testid={`cut-line-${boardKey}-${cut.cutId}`}
              >
                {/* Consumed kerf band */}
                {kw > 0.5 && kh > 0.5 && (
                  <rect
                    x={kx}
                    y={ky}
                    width={kw}
                    height={kh}
                    fill="rgba(148, 163, 184, 0.22)"
                    stroke="none"
                  />
                )}
                {/* Cut line */}
                <line
                  x1={cx1}
                  y1={cy1}
                  x2={cx2}
                  y2={cy2}
                  stroke={cut.isTrim ? '#94a3b8' : '#64748b'}
                  strokeWidth={cut.isTrim ? 0.9 : 1.1}
                  strokeDasharray={cut.isTrim ? '3 2' : '5 3'}
                />
              </g>
            );
          })}
        </g>
      )}

      {/* GENERAL VIEW: Primary Cut Marker Line (1er corte real del tablero) */}
      {isExactPlan && !activeStep && primaryCut != null && (
        <g data-testid="production-board-primary-cut">
          {primaryCut.axis === 'horizontal' ? (
            <>
              <line
                x1={0}
                y1={sy(primaryCut.coordinateMm)}
                x2={svgW}
                y2={sy(primaryCut.coordinateMm)}
                stroke="#d97706"
                strokeWidth={2}
                strokeDasharray="6 3"
              />
              <rect
                x={4}
                y={sy(primaryCut.coordinateMm) - 8}
                width={130}
                height={16}
                rx={3}
                fill="#d97706"
              />
              <text
                x={69}
                y={sy(primaryCut.coordinateMm) + 3}
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
                x1={sx(primaryCut.coordinateMm)}
                y1={0}
                x2={sx(primaryCut.coordinateMm)}
                y2={svgH}
                stroke="#d97706"
                strokeWidth={2}
                strokeDasharray="6 3"
              />
              <rect
                x={sx(primaryCut.coordinateMm) - 60}
                y={4}
                width={120}
                height={16}
                rx={3}
                fill="#d97706"
              />
              <text
                x={sx(primaryCut.coordinateMm)}
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

      {/* STEP-BY-STEP VIEW: Active Region, Blade Footprint & Cut Highlight */}
      {isExactPlan && activeStep && (
        <g data-testid="production-board-active-step">
          {/* 1. Active Parent Region Highlight */}
          <g data-testid="step-active-region">
            <rect
              x={sx(activeStep.parentRect.xMm)}
              y={sy(activeStep.parentRect.yMm, activeStep.parentRect.widthMm)}
              width={activeStep.parentRect.lengthMm * scale}
              height={activeStep.parentRect.widthMm * scale}
              fill="rgba(59, 130, 246, 0.08)"
              stroke="#2563eb"
              strokeWidth={1.8}
              strokeDasharray="5 3"
            />
            <rect
              x={sx(activeStep.parentRect.xMm) + 4}
              y={sy(activeStep.parentRect.yMm, activeStep.parentRect.widthMm) + 4}
              width={140}
              height={14}
              rx={2}
              fill="#2563eb"
            />
            <text
              x={sx(activeStep.parentRect.xMm) + 74}
              y={sy(activeStep.parentRect.yMm, activeStep.parentRect.widthMm) + 14}
              fontSize={7}
              fontWeight="bold"
              fill="#ffffff"
              textAnchor="middle"
            >
              Región activa {formatMm(activeStep.parentRect.lengthMm)}×{formatMm(activeStep.parentRect.widthMm)} mm
            </text>
          </g>

          {/* 2. Nominal Blade Tool Overhang (when blade exits parent) */}
          {activeStep.bladeExitsParent && (
            <g data-testid="step-blade-overhang">
              <rect
                x={sx(activeStep.toolFootprintRect.xMm)}
                y={sy(
                  activeStep.toolFootprintRect.yMm,
                  activeStep.toolFootprintRect.widthMm,
                )}
                width={activeStep.toolFootprintRect.lengthMm * scale}
                height={activeStep.toolFootprintRect.widthMm * scale}
                fill="rgba(245, 158, 11, 0.18)"
                stroke="#f59e0b"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
            </g>
          )}

          {/* 3. Consumed Kerf Band */}
          <rect
            x={sx(activeStep.kerfBandRect.xMm)}
            y={sy(activeStep.kerfBandRect.yMm, activeStep.kerfBandRect.widthMm)}
            width={activeStep.kerfBandRect.lengthMm * scale}
            height={activeStep.kerfBandRect.widthMm * scale}
            fill="rgba(217, 119, 6, 0.35)"
            stroke="#d97706"
            strokeWidth={1.2}
            data-testid="step-kerf-band"
          />

          {/* 4. Cut Line */}
          <line
            x1={sx(activeStep.cutLine.x1)}
            y1={sy(activeStep.cutLine.y1)}
            x2={sx(activeStep.cutLine.x2)}
            y2={sy(activeStep.cutLine.y2)}
            stroke="#d97706"
            strokeWidth={2.5}
            strokeDasharray="6 3"
            data-testid="step-cut-line"
          />

          {/* 5. Cut Step Badge */}
          {activeStep.axis === 'x' ? (
            <g>
              <rect
                x={sx(activeStep.cutLine.x1) - 45}
                y={Math.max(2, sy(activeStep.parentRect.yMm, activeStep.parentRect.widthMm) + 4)}
                width={90}
                height={15}
                rx={3}
                fill="#d97706"
              />
              <text
                x={sx(activeStep.cutLine.x1)}
                y={Math.max(2, sy(activeStep.parentRect.yMm, activeStep.parentRect.widthMm) + 4) + 11}
                fontSize={7}
                fontWeight="bold"
                fill="#ffffff"
                textAnchor="middle"
              >
                Corte #{activeStep.stepNumber} ({formatMm(activeStep.cutOffsetMm)}mm)
              </text>
            </g>
          ) : (
            <g>
              <rect
                x={Math.max(4, sx(activeStep.parentRect.xMm) + 4)}
                y={sy(activeStep.cutLine.y1) - 8}
                width={95}
                height={15}
                rx={3}
                fill="#d97706"
              />
              <text
                x={Math.max(4, sx(activeStep.parentRect.xMm) + 4) + 47}
                y={sy(activeStep.cutLine.y1) + 3}
                fontSize={7}
                fontWeight="bold"
                fill="#ffffff"
                textAnchor="middle"
              >
                Corte #{activeStep.stepNumber} ({formatMm(activeStep.cutOffsetMm)}mm)
              </text>
            </g>
          )}
        </g>
      )}

      {/* Exact CutPlan Pieces */}
      {isExactPlan &&
        sheet!.pieces.map((p, i) => {
          const px = sx(p.xMm);
          const py = sy(p.yMm, p.widthMm);
          const pw = p.lengthMm * scale;
          const ph = p.widthMm * scale;
          const isHovered = hoveredPiece?.id === p.id;
          const isProducedInActiveStep = activeStep?.producedPiece?.id === p.id;

          return (
            <g
              key={p.id || `${boardKey}-piece-${i}`}
              style={{ cursor: onSelectPiece ? 'pointer' : 'default' }}
              onMouseEnter={() => onHoverPiece(p)}
              onMouseLeave={() => onHoverPiece(null)}
              onClick={() => onSelectPiece?.(p)}
            >
              {/* Piece Body */}
              <rect
                x={px}
                y={py}
                width={pw}
                height={ph}
                fill={isProducedInActiveStep ? '#fef08a' : isHovered ? '#fef9c3' : '#ffffff'}
                stroke={isProducedInActiveStep ? '#d97706' : '#334155'}
                strokeWidth={isProducedInActiveStep ? 2 : isHovered ? 1.5 : 1}
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

              {/* Highlight badge for produced piece in active step */}
              {isProducedInActiveStep && pw > 45 && ph > 32 && (
                <text
                  x={px + 4}
                  y={py + ph - 6}
                  fontSize={6.5}
                  fontWeight="bold"
                  fill="#b45309"
                >
                  Pieza obtenida
                </text>
              )}
            </g>
          );
        })}

      {/* Legacy Pieces fallback */}
      {!isExactPlan &&
        legacyPlaced.map((p, i) => {
          const px = sx(p.x);
          const py = sy(p.y, p.h);
          const pw = p.w * scale;
          const ph = p.h * scale;

          return (
            <g key={`${boardKey}-legacy-${i}`}>
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
