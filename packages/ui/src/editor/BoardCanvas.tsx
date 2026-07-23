/**
 * BoardCanvas — SVG isométrico que muestra los board parts de un módulo
 * como tablas visuales seleccionables y arrastrables (Fase 1 slice 1.1 + 1.4).
 *
 * Board-first: el ingeniero ve las piezas como objetos, no como filas.
 * Click para seleccionar, drag para mover, snapping a cuadrícula y peers.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { BoardPartVisual } from '../preview3d/boardPartVisual';
import {
  isoBox,
  projectedBounds,
  viewBoxFromBounds,
  type IsoFace,
} from './isoProjection';
import { snapPosition, screenDeltaToWorkshop } from './snapping';
import './boardCanvas.css';

export interface BoardCanvasProps {
  readonly parts: readonly BoardPartVisual[];
  readonly selectedPartId: string | null;
  readonly onSelectPart: (id: string | null) => void;
  readonly onDragPart?: (id: string, pose: { x: number; y: number; z: number }) => void;
  readonly moduleWidth?: number;
  readonly moduleHeight?: number;
  readonly moduleDepth?: number;
  readonly showGrid?: boolean;
  readonly scale?: number;
  readonly snapEnabled?: boolean;
  readonly snapGridMm?: number;
  readonly snapToPeer?: boolean;
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
  onDragPart,
  moduleWidth,
  moduleHeight,
  moduleDepth,
  showGrid = true,
  snapEnabled = true,
  snapGridMm = 50,
  snapToPeer: _snapToPeer = true,
}: BoardCanvasProps): ReactNode {
  // --- Drag state ---
  const dragRef = useRef<{
    partId: string;
    startPx: number;
    startPy: number;
    origX: number;
    origY: number;
    origZ: number;
  } | null>(null);
  const [dragPartId, setDragPartId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Compute scale from viewBox + container (approx: use viewBox width / element width).
  // For simplicity, we use a fixed scale based on the largest module dim.
  const effectiveScale = useMemo(() => {
    const maxDim = Math.max(moduleWidth ?? 600, moduleHeight ?? 720, moduleDepth ?? 580, 600);
    return 400 / maxDim; // ~400px of projected space for the largest dim.
  }, [moduleWidth, moduleHeight, moduleDepth]);

  // Project all parts to isometric faces.
  const renderedParts = useMemo<RenderedPart[]>(() => {
    return parts.map((part) => {
      const [px, pyThree, pzThree] = part.position;
      const wsX = px;
      const wsY = pzThree;
      const wsZ = pyThree;
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
    if (moduleWidth && moduleHeight && moduleDepth) {
      allFaces.push(...isoBox(0, 0, 0, moduleWidth, moduleHeight, moduleDepth));
    }
    if (allFaces.length === 0) {
      return '-100 -100 200 200';
    }
    const bounds = projectedBounds(allFaces);
    return viewBoxFromBounds(bounds, 50);
  }, [renderedParts, moduleWidth, moduleHeight, moduleDepth]);

  // --- Drag handlers ---
  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<SVGPolygonElement>, partId: string) => {
      if (!onDragPart) return;
      e.stopPropagation();
      const part = parts.find((p) => p.id === partId);
      if (!part) return;
      onSelectPart(partId);
      const [px, pyThree, pzThree] = part.position;
      dragRef.current = {
        partId,
        startPx: e.clientX,
        startPy: e.clientY,
        origX: px,
        origY: pzThree, // workshop Y (depth)
        origZ: pyThree, // workshop Z (height)
      };
      setDragPartId(partId);
      (e.target as SVGPolygonElement).setPointerCapture(e.pointerId);
    },
    [onDragPart, onSelectPart, parts],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<SVGPolygonElement>) => {
      const drag = dragRef.current;
      if (!drag || !onDragPart) return;
      const dxPx = e.clientX - drag.startPx;
      const dyPx = e.clientY - drag.startPy;
      const [dwsX, , dwsZ] = screenDeltaToWorkshop(dxPx, dyPx, effectiveScale);
      const newX = drag.origX + dwsX;
      const newY = drag.origY; // depth unchanged for planar drag
      const newZ = drag.origZ + dwsZ;

      // Collect peer positions (other parts' X/Z).
      const peerXs = parts.filter((p) => p.id !== drag.partId).map((p) => p.position[0]);
      const peerZs = parts.filter((p) => p.id !== drag.partId).map((p) => p.position[1]);

      const [snappedX, , snappedZ] = snapPosition(newX, newY, newZ, {
        gridSize: snapGridMm,
        gridEnabled: snapEnabled,
        peerXs,
        peerZs,
        peerEnabled: snapEnabled,
        peerThreshold: 10,
      });

      onDragPart(drag.partId, { x: Math.round(snappedX), y: Math.round(newY), z: Math.round(snappedZ) });
    },
    [onDragPart, parts, effectiveScale, snapEnabled, snapGridMm],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<SVGPolygonElement>) => {
      dragRef.current = null;
      setDragPartId(null);
      try {
        (e.target as SVGPolygonElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    },
    []);

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
          ref={svgRef}
          className="board-canvas__svg"
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Module ghost outline */}
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

          {/* Board parts */}
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
                className={
                  part.isSelected ? 'board-canvas__part--selected' : ''
                }
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectPart(part.id);
                }}
                onPointerDown={
                  onDragPart
                    ? (e) => handlePointerDown(e, part.id)
                    : undefined
                }
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                style={{ cursor: onDragPart ? 'grab' : 'pointer' }}
              />
            )),
          )}
        </svg>
      )}
    </div>
  );
}
