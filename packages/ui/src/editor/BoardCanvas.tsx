/**
 * BoardCanvas — SVG isométrico que muestra los board parts de un módulo
 * como tablas visuales seleccionables (Fase 1 slice 1.1).
 *
 * Board-first: el ingeniero ve las piezas como objetos, no como filas.
 * Click para seleccionar. Sin drag todavía (slice 1.4).
 */

import { useMemo, type ReactNode } from 'react';
import type { BoardPartVisual } from '../preview3d/boardPartVisual';
import {
  isoBox,
  projectedBounds,
  viewBoxFromBounds,
  type IsoFace,
} from './isoProjection';
import './boardCanvas.css';

export interface BoardCanvasProps {
  readonly parts: readonly BoardPartVisual[];
  readonly selectedPartId: string | null;
  readonly onSelectPart: (id: string | null) => void;
  readonly moduleWidth?: number;
  readonly moduleHeight?: number;
  readonly moduleDepth?: number;
  readonly showGrid?: boolean;
  readonly scale?: number;
}

/**
 * Shade adjustment: lighten/darken a hex color by a percentage.
 * Returns rgba string for fill opacity control.
 */
function shadeColor(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const adjust = (c: number) => Math.round(c + (255 - c) * factor);
  return `rgb(${adjust(r)}, ${adjust(g)}, ${adjust(b)})`;
}

const SHADE_FACTOR: Record<IsoFace['shade'], number> = {
  light: 0.2,
  medium: 0,
  dark: -0.15,
};

function facesToPolygonPoints(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}

interface RenderedPart {
  readonly id: string;
  readonly faces: readonly IsoFace[];
  readonly color: string;
  readonly isSelected: boolean;
}

export function BoardCanvas({
  parts,
  selectedPartId,
  onSelectPart,
  moduleWidth,
  moduleHeight,
  moduleDepth,
  showGrid = true,
}: BoardCanvasProps): ReactNode {
  // Project all parts to isometric faces.
  const renderedParts = useMemo<RenderedPart[]>(() => {
    return parts.map((part) => {
      // BoardPartVisual.size = [width(X), thickness(Y), length(Z)]
      // BoardPartVisual.position = [x, z, y] (Three Y-up swap)
      // We need workshop coords: x=X, y=Y(depth), z=Z(height)
      // But the visual already did the swap: position=[x, z_workshop, y_workshop]
      // So: workshopX = position[0], workshopY = position[2], workshopZ = position[1]
      const [px, pyThree, pzThree] = part.position;
      const wsX = px;
      const wsY = pzThree; // workshop Y (depth)
      const wsZ = pyThree; // workshop Z (height)

      const [w, h, d] = part.size;

      const faces = isoBox(wsX, wsY, wsZ, w, h, d);
      return {
        id: part.id,
        faces,
        color: part.color,
        isSelected: part.id === selectedPartId,
      };
    });
  }, [parts, selectedPartId]);

  // Compute viewBox from all faces + module ghost.
  const viewBox = useMemo(() => {
    const allFaces = renderedParts.flatMap((p) => p.faces);
    // Add module ghost box if provided.
    if (moduleWidth && moduleHeight && moduleDepth) {
      allFaces.push(...isoBox(0, 0, 0, moduleWidth, moduleHeight, moduleDepth));
    }
    if (allFaces.length === 0) {
      return '-100 -100 200 200';
    }
    const bounds = projectedBounds(allFaces);
    return viewBoxFromBounds(bounds, 50);
  }, [renderedParts, moduleWidth, moduleHeight, moduleDepth]);

  // Grid lines (optional, every 100mm).
  const gridLines = useMemo(() => {
    if (!showGrid) return null;
    const lines: readonly [number, number, number, number][] = [];
    const step = 100;
    const maxRange = Math.max(moduleWidth ?? 1000, moduleDepth ?? 1000, moduleHeight ?? 1000, 1000);
    for (let i = 0; i <= maxRange; i += step) {
      // Lines along X axis (z=0 plane, at depth intervals).
      const [x1, y1] = [0, 0]; // will be projected
      void x1;
      void y1;
    }
    return null; // Grid deferred to when snapping is implemented.
  }, [showGrid, moduleWidth, moduleHeight, moduleDepth]);

  void gridLines;

  return (
    <div
      className="board-canvas"
      data-testid="board-canvas"
      onClick={() => onSelectPart(null)}
    >
      {parts.length === 0 ? (
        <p className="board-canvas__empty">
          No hay piezas para mostrar. Agregá tablas al módulo.
        </p>
      ) : (
        <svg
          className="board-canvas__svg"
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Module ghost outline (optional) */}
          {moduleWidth && moduleHeight && moduleDepth
            ? (() => {
                const ghostFaces = isoBox(0, 0, 0, moduleWidth, moduleHeight, moduleDepth);
                return ghostFaces.map((face, i) => (
                  <polygon
                    key={`ghost-${i}`}
                    points={facesToPolygonPoints(face.points)}
                    fill="none"
                    stroke="var(--canvas-ghost)"
                    strokeWidth={2}
                    strokeDasharray="8 4"
                  />
                ));
              })()
            : null}

          {/* Board parts (sorted back-to-front for painter's algorithm) */}
          {renderedParts.map((part) =>
            part.faces.map((face, faceIdx) => (
              <polygon
                key={`${part.id}-${faceIdx}`}
                points={facesToPolygonPoints(face.points)}
                fill={shadeColor(part.color, SHADE_FACTOR[face.shade])}
                stroke={
                  part.isSelected
                    ? 'var(--canvas-part-stroke-selected)'
                    : 'var(--canvas-part-stroke)'
                }
                strokeWidth={part.isSelected ? 2.5 : 1}
                className={part.isSelected ? 'board-canvas__part--selected' : ''}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectPart(part.id);
                }}
                style={{ cursor: 'pointer' }}
              />
            )),
          )}
        </svg>
      )}
    </div>
  );
}
