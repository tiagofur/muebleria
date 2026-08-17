/**
 * PlankEdgeDiagram — interactive front view of a rectangular board with its four
 * default edges (L1/L2 on the length, W1/W2 on the width) as clickable borders.
 *
 * Replaces the four naked checkboxes (P0 from the Componentes critique): a
 * carpenter can now map each code to the physical edge of the plank and toggle
 * banding by clicking/tapping the edge directly.
 *
 * Convention: plank lying flat with its length horizontal.
 *   L1 = top long edge, L2 = bottom long edge
 *   W1 = left short edge, W2 = right short edge
 * (L = Length, W = Width — matches EdgeSide in @muebles/domain.)
 *
 * Accessibility: each edge is a real button (role/tabindex/aria-pressed) with a
 * visible focus ring, so the whole diagram works keyboard-only.
 */

import { type KeyboardEvent, type ReactNode } from 'react';
import type { EdgeSide } from '@muebles/domain';

export type EdgeStates = {
  readonly L1: boolean;
  readonly L2: boolean;
  readonly W1: boolean;
  readonly W2: boolean;
};

export type PlankEdgeDiagramProps = {
  /** Default banding state per edge. */
  readonly edges: EdgeStates;
  /** Fired with the side string ('L1' | 'L2' | 'W1' | 'W2') when an edge is toggled. */
  readonly onToggle: (side: EdgeSide) => void;
  /** Plank dimensions in mm — drive the drawn aspect ratio. */
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly disabled?: boolean;
};

// Internal layout constants (SVG user units).
const VB_W = 260;
const VB_H = 190;
const PAD = 44; // room for labels around the plank
const EDGE_THICKNESS = 10; // clickable stroke thickness for hit area + visual weight

type EdgeMeta = {
  readonly side: EdgeSide;
  readonly label: string;
  readonly sublabel: string;
  readonly points: string; // line "x1,y1 x2,y2" as polyline points
  readonly strokeOrientation: 'h' | 'v';
};

function edgeMetadata(
  x: number,
  y: number,
  w: number,
  h: number,
): Record<EdgeSide, EdgeMeta> {
  return {
    L1: {
      side: 'L1',
      label: 'L1',
      sublabel: 'Largo · frente / arriba',
      points: `${x},${y} ${x + w},${y}`,
      strokeOrientation: 'h',
    },
    L2: {
      side: 'L2',
      label: 'L2',
      sublabel: 'Largo · fondo / abajo',
      points: `${x},${y + h} ${x + w},${y + h}`,
      strokeOrientation: 'h',
    },
    W1: {
      side: 'W1',
      label: 'W1',
      sublabel: 'Ancho · lateral izq.',
      points: `${x},${y} ${x},${y + h}`,
      strokeOrientation: 'v',
    },
    W2: {
      side: 'W2',
      label: 'W2',
      sublabel: 'Ancho · lateral der.',
      points: `${x + w},${y} ${x + w},${y + h}`,
      strokeOrientation: 'v',
    },
  };
}

/** Fit the plank's real aspect ratio inside the viewBox padding. */
function plankRect(lengthMm: number, widthMm: number): { x: number; y: number; w: number; h: number } {
  const availW = VB_W - PAD * 2;
  const availH = VB_H - PAD * 2;
  const ratio = lengthMm > 0 && widthMm > 0 ? lengthMm / widthMm : 1.6;
  let w = availW;
  let h = w / ratio;
  if (h > availH) {
    h = availH;
    w = h * ratio;
  }
  return { x: (VB_W - w) / 2, y: (VB_H - h) / 2, w, h };
}

export function PlankEdgeDiagram({
  edges,
  onToggle,
  lengthMm,
  widthMm,
  disabled = false,
}: PlankEdgeDiagramProps): ReactNode {
  const rect = plankRect(lengthMm, widthMm);
  const meta = edgeMetadata(rect.x, rect.y, rect.w, rect.h);
  const sides = Object.keys(meta) as EdgeSide[];

  const handleKey = (e: KeyboardEvent<SVGPolylineElement>, side: EdgeSide) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle(side);
    }
  };

  return (
    <div className="plank-edge-diagram" data-testid="plank-edge-diagram">
      <svg
        className="plank-edge-diagram__svg"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="group"
        aria-label={`Placa de ${Math.round(lengthMm)} × ${Math.round(widthMm)} mm. Tocá un borde para marcarlo como encintado.`}
      >
        {/* Plank fill */}
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          rx={3}
          className="plank-edge-diagram__plank"
        />

        {/* Edges: drawn as polylines with thick stroke; the polyline is the button */}
        {sides.map((side) => {
          const m = meta[side];
          const encintado = edges[side];
          return (
            <g key={side}>
              <polyline
                points={m.points}
                className={
                  'plank-edge-diagram__edge' +
                  (encintado ? ' plank-edge-diagram__edge--on' : '') +
                  (disabled ? ' is-disabled' : '')
                }
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-pressed={encintado}
                aria-label={`${m.label} · ${m.sublabel} · ${encintado ? 'encintado' : 'sin canto'}`}
                data-testid={`edge-${side}`}
                onClick={() => !disabled && onToggle(side)}
                onKeyDown={(e) => !disabled && handleKey(e, side)}
              />
              <text
                x={
                  m.strokeOrientation === 'h'
                    ? rect.x + rect.w / 2
                    : side === 'W1'
                      ? rect.x - 16
                      : rect.x + rect.w + 16
                }
                y={
                  m.strokeOrientation === 'h'
                    ? side === 'L1'
                      ? rect.y - 14
                      : rect.y + rect.h + 22
                    : rect.y + rect.h / 2
                }
                textAnchor="middle"
                className={
                  'plank-edge-diagram__label' +
                  (encintado ? ' plank-edge-diagram__label--on' : '')
                }
              >
                {m.label}
              </text>
            </g>
          );
        })}

        {/* Subtitle caption inside the plank */}
        <text
          x={rect.x + rect.w / 2}
          y={rect.y + rect.h / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          className="plank-edge-diagram__caption"
        >
          {Math.round(lengthMm)} × {Math.round(widthMm)} mm
        </text>
      </svg>

      <ul className="plank-edge-diagram__legend">
        {sides.map((side) => {
          const m = meta[side];
          return (
            <li key={side}>
              <span
                className={
                  'plank-edge-diagram__legend-dot' +
                  (edges[side] ? ' plank-edge-diagram__legend-dot--on' : '')
                }
                aria-hidden
              />
              <span className="plank-edge-diagram__legend-code">{m.label}</span>
              <span className="plank-edge-diagram__legend-sub">{m.sublabel}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
