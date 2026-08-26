/**
 * Piece face drilling editor (F131) — 2D per-face SVG view.
 *
 * Shows one board face at a time with the REAL drilling picture of the piece:
 * holes resolved by the F128 engine (manual placements + derived joints) plus
 * draggable placement anchors with 32mm-grid snap. Geometry, face dimensions
 * and validation all come from the domain — this component only draws and
 * forwards user intent. Inline issues are the engine's own messages.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AnchorFace,
  Hardware,
  HardwarePlacement,
  HoleFace,
  ResolvedBoardPart,
} from '@granete/domain';
import { getFaceDimensions, resolvePartDrilling, snapValue } from '@granete/domain';
import './pieceFaceDrillingEditor.css';

const FACE_LABELS_ES: Readonly<Record<HoleFace, string>> = {
  front: 'Frontal',
  back: 'Trasera',
  left: 'Canto izq.',
  right: 'Canto der.',
  top: 'Canto sup.',
  bottom: 'Canto inf.',
};

const FACES: readonly HoleFace[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];

/**
 * Pure drag→patch mapping (F131): face-mm pointer position becomes a snapped
 * (grid 32) relative-position patch. Formulas are cleared — an explicit drag
 * wins over parametric positioning. Exported for testing; jsdom cannot carry
 * pointer coordinates into React pointer events.
 */
export function snappedPlacementPatch(
  current: HardwarePlacement,
  xMm: number,
  yMm: number,
  gridMm: number,
): Partial<HardwarePlacement> {
  return {
    relativePosition: {
      ...current.relativePosition,
      xMm: snapValue(xMm, gridMm),
      yMm: snapValue(yMm, gridMm),
      xFormula: undefined,
      yFormula: undefined,
    },
  };
}

export interface PieceFaceDrillingEditorProps {
  readonly piece: ResolvedBoardPart;
  /** Manual placements of this piece (editable). */
  readonly placements: readonly HardwarePlacement[];
  /** Derived joint placements (F129) — read-only context for the same piece. */
  readonly derivedPlacements?: readonly HardwarePlacement[];
  readonly hardwareCatalog?: readonly Hardware[];
  /** System grid for snap + visual grid (mm). Default 32. */
  readonly gridMm?: number;
  readonly onUpdatePlacement?: (index: number, patch: Partial<HardwarePlacement>) => void;
  readonly testId?: string;
}

export function PieceFaceDrillingEditor({
  piece,
  placements,
  derivedPlacements = [],
  hardwareCatalog,
  gridMm = 32,
  onUpdatePlacement,
  testId = 'face-drilling-editor',
}: PieceFaceDrillingEditorProps): ReactNode {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [activeFace, setActiveFace] = useState<HoleFace>(
    (placements[0]?.anchorFace as HoleFace | undefined) ?? 'front',
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const face = useMemo(
    () => getFaceDimensions(activeFace, piece),
    [activeFace, piece],
  );

  const resolved = useMemo(
    () =>
      hardwareCatalog
        ? resolvePartDrilling({
            piece,
            placements: [...placements, ...derivedPlacements],
            hardwareCatalog,
          })
        : null,
    [piece, placements, derivedPlacements, hardwareCatalog],
  );

  const holesOnFace = resolved
    ? resolved.holes.filter((h) => h.face === activeFace)
    : [];
  const issuesOnFace = resolved
    ? resolved.issues.filter((i) => i.hole.face === activeFace)
    : [];
  const facePlacements = placements
    .map((p, idx) => ({ placement: p, idx }))
    .filter(({ placement }) => placement.anchorFace === (activeFace as AnchorFace));

  // View box: mm→px scale keeps stroke/text sizes stable at 1:1 mm units.
  const padMm = gridMm / 2;
  const svgW = face.widthMm + padMm * 2;
  const svgH = face.heightMm + padMm * 2;

  const pointerToFaceMm = (event: { readonly clientX: number; readonly clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const xMm = ((event.clientX - rect.left) / rect.width) * svgW - padMm;
    const yMm = face.heightMm - (((event.clientY - rect.top) / rect.height) * svgH - padMm);
    return { xMm, yMm };
  };

  const handleDragMove = (event: React.PointerEvent) => {
    if (dragIndex == null || !onUpdatePlacement) return;
    const pos = pointerToFaceMm(event);
    if (!pos) return;
    const current = placements[dragIndex];
    if (!current) return;
    onUpdatePlacement(dragIndex, snappedPlacementPatch(current, pos.xMm, pos.yMm, gridMm));
  };

  const gridLines: number[] = [];
  for (let g = gridMm; g < Math.max(face.widthMm, face.heightMm); g += gridMm) {
    gridLines.push(g);
  }

  const toY = (mm: number) => face.heightMm - mm; // SVG Y grows down, face Y grows up

  return (
    <div className="face-editor" data-testid={testId}>
      <div className="face-editor__faces" role="radiogroup" aria-label="Cara de la pieza">
        {FACES.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={activeFace === f}
            className={`face-editor__face-tab ${activeFace === f ? 'face-editor__face-tab--active' : ''}`}
            onClick={() => setActiveFace(f)}
            data-testid={`${testId}-face-${f}`}
          >
            {FACE_LABELS_ES[f]}
          </button>
        ))}
      </div>

      <svg
        ref={svgRef}
        className="face-editor__svg"
        viewBox={`0 0 ${svgW} ${svgH}`}
        data-testid={`${testId}-svg`}
        onPointerMove={handleDragMove}
        onPointerUp={() => setDragIndex(null)}
        onPointerLeave={() => setDragIndex(null)}
      >
        {/* Board face */}
        <rect
          x={padMm}
          y={padMm}
          width={face.widthMm}
          height={face.heightMm}
          className="face-editor__board"
        />
        {/* 32mm system grid */}
        {gridLines.map((g) =>
          g < face.widthMm ? (
            <line key={`gx-${g}`} x1={padMm + g} y1={padMm} x2={padMm + g} y2={padMm + face.heightMm} className="face-editor__grid" />
          ) : null,
        )}
        {gridLines.map((g) =>
          g < face.heightMm ? (
            <line key={`gy-${g}`} x1={padMm} y1={padMm + toY(g)} x2={padMm + face.widthMm} y2={padMm + toY(g)} className="face-editor__grid" />
          ) : null,
        )}

        {/* Resolved holes (F128) */}
        {holesOnFace.map((hole, i) => (
          <circle
            key={`hole-${i}`}
            cx={padMm + hole.xMm}
            cy={padMm + toY(hole.yMm)}
            r={hole.diameterMm / 2}
            className={`face-editor__hole ${issuesOnFace.some((iss) => iss.hole === hole) ? 'face-editor__hole--error' : ''}`}
            data-testid={`${testId}-hole-${i}`}
          >
            <title>{`${hole.description ?? hole.type} · Ø${hole.diameterMm} × ${hole.depthMm} mm`}</title>
          </circle>
        ))}

        {/* Draggable manual placement anchors */}
        {facePlacements.map(({ placement, idx }) => (
          <g
            key={`anchor-${idx}`}
            className={`face-editor__anchor ${dragIndex === idx ? 'face-editor__anchor--dragging' : ''}`}
            data-testid={`${testId}-anchor-${idx}`}
            onPointerDown={(e) => {
              e.preventDefault();
              setDragIndex(idx);
            }}
          >
            <circle cx={padMm + placement.relativePosition.xMm} cy={padMm + toY(placement.relativePosition.yMm)} r={gridMm * 0.45} />
            <text x={padMm + placement.relativePosition.xMm} y={padMm + toY(placement.relativePosition.yMm)} className="face-editor__anchor-label">
              {idx + 1}
            </text>
          </g>
        ))}
      </svg>

      <p className="face-editor__meta" data-testid={`${testId}-meta`}>
        {FACE_LABELS_ES[activeFace]} · {Math.round(face.widthMm)} × {Math.round(face.heightMm)} mm ·{' '}
        {holesOnFace.length} {holesOnFace.length === 1 ? 'perforación' : 'perforaciones'} · snap {gridMm} mm
      </p>

      {issuesOnFace.length > 0 ? (
        <ul className="face-editor__issues" data-testid={`${testId}-issues`}>
          {issuesOnFace.map((issue, i) => (
            <li key={i} className="face-editor__issue" role="alert">
              {issue.message}
            </li>
          ))}
        </ul>
      ) : (
        resolved && (
          <p className="face-editor__ok" data-testid={`${testId}-ok`}>
            {issuesOnFace.length === 0 && resolved.issues.length === 0
              ? '✓ Perforaciones válidas en toda la pieza'
              : '✓ Sin problemas en esta cara'}
          </p>
        )
      )}
    </div>
  );
}
