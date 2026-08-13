/**
 * 3D Gizmo and handles for interactive hardware placement manipulation (F070).
 *
 * Renders interactive handles (position X/Y arrows, rotation ring) over a selected
 * HardwareMesh in Three.js / R3F. Supports snapping to grid (5mm / 5° by default).
 *
 * Pure helpers are exported and tested in jsdom; WebGL rendering is driven by R3F.
 */

import { type ReactNode, useState } from 'react';
import type { AnchorFace, HardwarePlacement } from '@muebles/domain';
import { convertWorldDeltaToFaceMm, snapValue } from '@muebles/domain';

export type HardwarePlacementGizmoProps = {
  readonly placement: HardwarePlacement;
  readonly anchorFace: AnchorFace;
  readonly boardWidthMm: number;
  readonly boardHeightMm: number;
  readonly snapMm?: number;
  readonly snapDeg?: number;
  readonly onChangePlacement?: (patch: Partial<HardwarePlacement>) => void;
  readonly testId?: string;
};

/**
 * Pure helper to compute next relative position given a delta (dxMm, dyMm)
 * and optional snap step.
 */
export function computeNextPosition(
  current: { readonly xMm: number; readonly yMm: number },
  delta: { readonly dxMm: number; readonly dyMm: number },
  snapStep = 5,
): { readonly xMm: number; readonly yMm: number } {
  const nextX = snapValue(current.xMm + delta.dxMm, snapStep);
  const nextY = snapValue(current.yMm + delta.dyMm, snapStep);
  return { xMm: nextX, yMm: nextY };
}

/**
 * Pure helper to compute next rotation angles given a delta (deg)
 * and optional snap step.
 */
export function computeNextRotation(
  currentDeg: { readonly x: number; readonly y: number; readonly z: number },
  axis: 'x' | 'y' | 'z',
  deltaDeg: number,
  snapStep = 5,
): { readonly x: number; readonly y: number; readonly z: number } {
  const nextVal = snapValue(currentDeg[axis] + deltaDeg, snapStep);
  return {
    ...currentDeg,
    [axis]: nextVal,
  };
}

export function HardwarePlacementGizmo({
  placement,
  anchorFace,
  snapMm = 5,
  snapDeg = 5,
  onChangePlacement,
  testId = 'hardware-placement-gizmo',
}: HardwarePlacementGizmoProps): ReactNode {
  const [activeHandle, setActiveHandle] = useState<'move-x' | 'move-y' | 'rot-z' | null>(null);

  const handleMove = (dxMm: number, dyMm: number) => {
    if (!onChangePlacement) return;
    const faceDelta = convertWorldDeltaToFaceMm([dxMm, dyMm, 0], anchorFace);
    const nextPos = computeNextPosition(
      {
        xMm: placement.relativePosition.xMm,
        yMm: placement.relativePosition.yMm,
      },
      faceDelta,
      snapMm,
    );
    onChangePlacement({
      relativePosition: {
        ...placement.relativePosition,
        xMm: nextPos.xMm,
        yMm: nextPos.yMm,
        xFormula: undefined,
        yFormula: undefined,
      },
    });
  };

  const handleRotate = (axis: 'x' | 'y' | 'z', deltaDeg: number) => {
    if (!onChangePlacement) return;
    const currentRot = {
      x: placement.rotationDeg?.x ?? 0,
      y: placement.rotationDeg?.y ?? 0,
      z: placement.rotationDeg?.z ?? 0,
    };
    const nextRot = computeNextRotation(currentRot, axis, deltaDeg, snapDeg);
    onChangePlacement({
      rotationDeg: nextRot,
    });
  };

  return (
    <group data-testid={testId}>
      {/* Visual Bounding Box / Gizmo Ring */}
      <group data-testid={`${testId}-handles`}>
        {/* Handle X (move) */}
        <mesh
          position={[30, 0, 0]}
          onPointerDown={() => setActiveHandle('move-x')}
          onPointerUp={() => setActiveHandle(null)}
          data-testid={`${testId}-handle-x`}
        >
          <boxGeometry args={[12, 4, 4]} />
          <meshBasicMaterial color={activeHandle === 'move-x' ? '#22c55e' : '#ef4444'} />
        </mesh>

        {/* Handle Y (move) */}
        <mesh
          position={[0, 30, 0]}
          onPointerDown={() => setActiveHandle('move-y')}
          onPointerUp={() => setActiveHandle(null)}
          data-testid={`${testId}-handle-y`}
        >
          <boxGeometry args={[4, 12, 4]} />
          <meshBasicMaterial color={activeHandle === 'move-y' ? '#22c55e' : '#3b82f6'} />
        </mesh>

        {/* Handle Rotation Z */}
        <mesh
          position={[0, 0, 20]}
          onPointerDown={() => setActiveHandle('rot-z')}
          onPointerUp={() => setActiveHandle(null)}
          data-testid={`${testId}-handle-rot-z`}
        >
          <torusGeometry args={[15, 2, 8, 24]} />
          <meshBasicMaterial color={activeHandle === 'rot-z' ? '#22c55e' : '#eab308'} />
        </mesh>
      </group>
    </group>
  );
}
