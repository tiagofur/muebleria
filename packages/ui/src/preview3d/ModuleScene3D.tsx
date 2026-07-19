/**
 * React Three Fiber scene for a single composed module.
 * Domain owns poses; this component only renders meshes + camera.
 */

import type { CSSProperties, ReactNode } from 'react';
import type { ResolvedBoardPart } from '@muebles/domain';
import { FurnitureScene3D } from './FurnitureScene3D';
import type { BoardColorMode, MaterialColorLookup } from './boardPartVisual';

export type ModuleScene3DProps = {
  readonly parts: readonly ResolvedBoardPart[];
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly colorMode?: BoardColorMode;
  readonly materialColors?: MaterialColorLookup;
  readonly cameraView?: { readonly type: 'front' | 'top' | 'side' | 'isometric'; readonly ts: number } | null;
  readonly cameraType?: 'perspective' | 'orthographic';
  readonly showWireframe?: boolean;
};

/** Detect WebGL so tests/jsdom can skip Canvas. */
export function canUseWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl') || canvas.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
}

export function ModuleScene3D({
  parts,
  width,
  height,
  depth,
  className,
  style,
  colorMode = 'material',
  materialColors,
  cameraView,
  cameraType,
  showWireframe,
}: ModuleScene3DProps): ReactNode {
  return (
    <FurnitureScene3D
      modules={[
        {
          key: 'module',
          parts,
          width,
          height,
          depth,
          originX: 0,
          originY: 0,
          originZ: 0,
          showOuterGhost: true,
        },
      ]}
      totalWidth={width}
      totalHeight={height}
      totalDepth={depth}
      className={className}
      style={style}
      testId="module-scene-3d"
      showFloor={false}
      colorMode={colorMode}
      materialColors={materialColors}
      cameraView={cameraView}
      cameraType={cameraType}
      showWireframe={showWireframe}
    />
  );
}
