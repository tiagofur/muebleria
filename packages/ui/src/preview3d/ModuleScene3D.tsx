/**
 * React Three Fiber scene for a single composed module.
 * Domain owns poses; this component only renders meshes + camera.
 */

import type { CSSProperties, ReactNode } from 'react';
import type {
  Hardware,
  ResolvedBoardPart,
  ResolvedHardwarePlacement,
} from '@granete/domain';
import { FurnitureScene3D } from './FurnitureScene3D';
import type {
  BoardColorMode,
  MaterialColorLookup,
  MaterialSurfaceMode,
  MaterialTextureLookup,
} from './boardPartVisual';
import type { SceneLightingMode } from './sceneLighting';
import { DEFAULT_SCENE_LIGHTING_MODE } from './sceneLighting';

export type ModuleScene3DProps = {
  readonly parts: readonly ResolvedBoardPart[];
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly colorMode?: BoardColorMode;
  readonly materialColors?: MaterialColorLookup;
  readonly materialTextures?: MaterialTextureLookup;
  readonly surfaceMode?: MaterialSurfaceMode;
  readonly cameraView?: { readonly type: 'front' | 'top' | 'side' | 'isometric'; readonly ts: number } | null;
  readonly cameraType?: 'perspective' | 'orthographic';
  readonly showWireframe?: boolean;
  readonly showOutlines?: boolean;
  readonly selectedPartId?: string | null;
  readonly onSelectPart?: (partId: string | null) => void;
  readonly isolateSelected?: boolean;
  /** Workshop lighting preset (default present). */
  readonly lightingMode?: SceneLightingMode;
  /**
   * RGB axes helper. Default true (floor-less inspect). Catalog product
   * stills should pass false.
   */
  readonly showAxes?: boolean;
  /**
   * Outer wireframe footprint ghost. Default true for engineering inspect.
   * Catalog product stills should pass false.
   */
  readonly showOuterGhost?: boolean;
  /**
   * Parametric hardware placements (jaladeras) resolved to board-LOCAL mm
   * (Fase 2). Forwarded into the single module entry of FurnitureScene3D,
   * which attaches each placement to its board mesh by componentInstanceId.
   * Optional/empty → no handles (byte-identical to pre-Fase-2 scene).
   */
  readonly resolvedHardwarePlacements?: readonly ResolvedHardwarePlacement[];
  /**
   * Hardware catalog used to look up preview geometry/PBR for the resolved
   * placements. Optional: when omitted (or no placements), no handles render.
   */
  readonly hardwareCatalog?: readonly Hardware[];
};

export { canUseWebGL } from './webglSupport';

export function ModuleScene3D({
  parts,
  width,
  height,
  depth,
  className,
  style,
  colorMode = 'material',
  materialColors,
  materialTextures,
  surfaceMode,
  cameraView,
  cameraType,
  showWireframe,
  showOutlines,
  selectedPartId,
  onSelectPart,
  isolateSelected,
  lightingMode = DEFAULT_SCENE_LIGHTING_MODE,
  showAxes = true,
  showOuterGhost = true,
  resolvedHardwarePlacements,
  hardwareCatalog,
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
          showOuterGhost,
          resolvedHardwarePlacements,
        },
      ]}
      totalWidth={width}
      totalHeight={height}
      totalDepth={depth}
      className={className}
      style={style}
      testId="module-scene-3d"
      showFloor={false}
      showAxes={showAxes}
      colorMode={colorMode}
      materialColors={materialColors}
      materialTextures={materialTextures}
      surfaceMode={surfaceMode}
      cameraView={cameraView}
      cameraType={cameraType}
      showWireframe={showWireframe}
      showOutlines={showOutlines}
      selectedPartId={selectedPartId}
      onSelectPart={onSelectPart}
      isolateSelected={isolateSelected}
      lightingMode={lightingMode}
      hardwareCatalog={hardwareCatalog}
    />
  );
}
