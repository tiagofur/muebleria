/**
 * Generic R3F furniture scene: one or many modules at workshop origins.
 */

import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import {
  Bounds,
  ContactShadows,
  Environment,
  OrbitControls,
  PerspectiveCamera,
  OrthographicCamera,
  Edges,
} from '@react-three/drei';
import * as THREE from 'three';
import { offsetMmFromPlanPoint, type ResolvedBoardPart } from '@muebles/domain';
import {
  boardPartsToVisuals,
  cameraPositionForView,
  sceneFraming,
  type BoardColorMode,
  type BoardPartVisual,
  type MaterialColorLookup,
  type MaterialSurfaceMode,
  type MaterialTextureLookup,
} from './boardPartVisual';
import { BoardMeshMaterial } from './BoardMeshMaterial';
import { MeasurementTool } from './MeasurementTool';
import { KeyboardNav } from './KeyboardNav';
import { ModelExporter, type ModelFormat } from './ModelExporter';
import {
  DEFAULT_SCENE_LIGHTING_MODE,
  planSceneLighting,
  type SceneLightingMode,
} from './sceneLighting';
import { isPastDragThreshold } from './moduleDragGesture';
import { AlertTriangle } from 'lucide-react';
import { ErrorBoundary } from '../common/ErrorBoundary';
import './moduleScene3d.css';

export type { SceneLightingMode } from './sceneLighting';

export type FurnitureSceneModule = {
  readonly key: string;
  readonly parts: readonly ResolvedBoardPart[];
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** Workshop origin (mm): X along run, Y depth, Z height. */
  readonly originX: number;
  readonly originY: number;
  readonly originZ: number;
  /**
   * Workshop plan yaw (degrees) around vertical. Applied as Three Y rotation
   * so cabinet width follows the wall (kitchen layout).
   */
  readonly yawDeg?: number;
  /**
   * Plinth/legs height under the cabinet (mm). Group originZ already sits on
   * top of this clearance; a recessed toe-kick is drawn below when > 0.
   */
  readonly baseClearanceMm?: number;
  /** Visual countertop slab on top of floor cabinets (presentation). */
  readonly showCountertop?: boolean;
  readonly showOuterGhost?: boolean;
};

/** Simple room wall segment in workshop mm (plan X/Y). */
export type FurnitureSceneWall = {
  readonly id: string;
  readonly originXMm: number;
  readonly originYMm: number;
  readonly endXMm: number;
  readonly endYMm: number;
  /** Wall height mm (default 2400). */
  readonly heightMm?: number;
};

export type FurnitureScene3DProps = {
  readonly modules: readonly FurnitureSceneModule[];
  readonly totalWidth: number;
  readonly totalHeight: number;
  readonly totalDepth: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
  /** Show a simple floor under the run. */
  readonly showFloor?: boolean;
  /**
   * Show RGB XYZ axes helper. Default: true when floor is off (module inspect),
   * false when floor is on. Catalog product shots should pass false.
   */
  readonly showAxes?: boolean;
  readonly cameraView?: { readonly type: 'front' | 'top' | 'side' | 'isometric'; readonly ts: number } | null;
  /** Default `material` = fast solid colors from catalog. */
  readonly colorMode?: BoardColorMode;
  readonly materialColors?: MaterialColorLookup;
  /** Optional catalog texture URLs (material.previewTextureUrl). */
  readonly materialTextures?: MaterialTextureLookup;
  /** Color / grain / texture look when colorMode is material. */
  readonly surfaceMode?: MaterialSurfaceMode;
  readonly cameraType?: 'perspective' | 'orthographic';
  readonly showWireframe?: boolean;
  /**
   * Draw silhouette edges on every board so component boundaries are readable
   * without X-ray transparency.
   */
  readonly showOutlines?: boolean;
  /** Enable measurement tool mode (click two points to measure distance). */
  readonly measurementMode?: boolean;
  /** Trigger 3D model export. Set to a format to export; parent should reset to null. */
  readonly exportFormat?: ModelFormat | null;
  /** Callback after export completes (success or failure). */
  readonly onExportComplete?: () => void;
  /** Project name used as base filename for exports. */
  readonly exportProjectName?: string;
  /** Currently selected board part id (highlight). */
  readonly selectedPartId?: string | null;
  /** Click mesh / empty space → select or clear. Disabled while measuring. */
  readonly onSelectPart?: (partId: string | null) => void;
  /** When true and a part is selected, dim other meshes. */
  readonly isolateSelected?: boolean;
  /** Kitchen / room wall segments (workshop plan). */
  readonly walls?: readonly FurnitureSceneWall[];
  /** Selected module instance key (highlight whole cabinet). */
  readonly selectedModuleKey?: string | null;
  /** Click a module (or empty) to select. Prefer over part pick when set. */
  readonly onSelectModule?: (moduleKey: string | null) => void;
  /**
   * Drag cabinets along kitchen walls (spatial studio). Keys = module.instanceKey.
   * Workshop mm frames must match the displayed (shifted) layout.
   */
  readonly wallDragByKey?: Readonly<
    Record<
      string,
      {
        readonly originXMm: number;
        readonly originYMm: number;
        readonly angleDeg: number;
        readonly lengthMm: number;
        readonly moduleWidthMm: number;
      }
    >
  >;
  readonly onModuleWallOffset?: (moduleKey: string, offsetMm: number) => void;
  /** Fired once when a wall-drag gesture starts (for undo history). */
  readonly onModuleWallDragStart?: (moduleKey: string) => void;
  /** Fired when wall-drag ends (for final snap / re-pack). */
  readonly onModuleWallDragEnd?: (moduleKey: string) => void;
  /** When true, pointer-drag on a module updates offset along its wall. */
  readonly wallDragEnabled?: boolean;
  /**
   * Free-floor drag (islands). Keys = module.instanceKey that use free place.
   * planShift converts displayed (shifted) floor hits back to layout plan mm.
   */
  readonly freeDragByKey?: Readonly<Record<string, true>>;
  readonly planShiftMm?: { readonly x: number; readonly y: number };
  /** Free drag reports plan X/Y in layout (unshifted) workshop mm. */
  readonly onModuleFreeMove?: (
    moduleKey: string,
    planXMm: number,
    planYMm: number,
  ) => void;
  /** Fired once when a free-drag gesture starts (undo history). */
  readonly onModuleFreeDragStart?: (moduleKey: string) => void;
  /** Fired when free-drag ends. */
  readonly onModuleFreeDragEnd?: (moduleKey: string) => void;
  /** Highlight and click-select walls (set active wall in Proyectar). */
  readonly selectedWallId?: string | null;
  readonly onSelectWall?: (wallId: string) => void;
  /**
   * Fill parent height/width (Proyectar studio). Default embedded preview
   * keeps a fixed ~380px canvas for modals/editors.
   */
  readonly fillViewport?: boolean;
  /** When false, hide orbit/help hint (studio toolbar replaces it). Default true. */
  readonly showHint?: boolean;
  /** Subtle floor grid in mm (obra look). */
  readonly showFloorGrid?: boolean;
  /**
   * Scene lighting + material response preset.
   * present = multi-light + env + glossier melamine (default for Proyectar).
   */
  readonly lightingMode?: SceneLightingMode;
};

function BoardMesh({
  visual,
  showWireframe = false,
  showOutlines = false,
  selected = false,
  dimmed = false,
  onSelect,
  lightingMode = DEFAULT_SCENE_LIGHTING_MODE,
}: {
  readonly visual: BoardPartVisual;
  readonly showWireframe?: boolean;
  readonly showOutlines?: boolean;
  readonly selected?: boolean;
  readonly dimmed?: boolean;
  readonly onSelect?: (partId: string) => void;
  readonly lightingMode?: SceneLightingMode;
}): ReactNode {
  const [w, t, l] = visual.size;
  const transparent = showWireframe || dimmed;
  const opacity = dimmed ? 0.12 : showWireframe ? 0.3 : 1;
  const showEdges = showOutlines || showWireframe || selected;
  // Black outlines for clear board boundaries; selection keeps amber.
  const edgeColor = selected
    ? '#f5c542'
    : showWireframe
      ? visual.color
      : '#000000';
  return (
    <group position={visual.position} rotation={visual.rotation}>
      <mesh
        position={[w / 2, t / 2, l / 2]}
        castShadow={!showWireframe && !dimmed}
        receiveShadow={!showWireframe && !dimmed}
        userData={{
          partId: visual.id,
          description: visual.description,
          optionRole: visual.optionRole,
        }}
        onClick={(e) => {
          if (!onSelect) return;
          e.stopPropagation();
          onSelect(visual.id);
        }}
        onPointerOver={
          onSelect
            ? (e) => {
                e.stopPropagation();
                if (typeof document !== 'undefined') {
                  document.body.style.cursor = 'pointer';
                }
              }
            : undefined
        }
        onPointerOut={
          onSelect
            ? () => {
                if (typeof document !== 'undefined') {
                  document.body.style.cursor = 'auto';
                }
              }
            : undefined
        }
      >
        <boxGeometry args={[w, t, l]} />
        <Suspense
          fallback={
            <meshStandardMaterial
              color={visual.color}
              transparent={transparent}
              opacity={opacity}
              depthWrite={!transparent}
              roughness={0.55}
              metalness={0.04}
            />
          }
        >
          <BoardMeshMaterial
            key={`${visual.id}:${visual.textureUrl ?? ''}:${visual.grain}:${visual.color}:${lightingMode}`}
            visual={visual}
            selected={selected}
            transparent={transparent}
            opacity={opacity}
            lightingMode={lightingMode}
          />
        </Suspense>
        {showEdges ? (
          <Edges scale={1} threshold={15} color={edgeColor} />
        ) : null}
      </mesh>
    </group>
  );
}

function OuterGhost({
  width,
  height,
  depth,
  highlighted = false,
}: {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly highlighted?: boolean;
}): ReactNode {
  const W = Math.max(width, 1);
  const H = Math.max(height, 1);
  const D = Math.max(depth, 1);
  return (
    <mesh position={[W / 2, H / 2, D / 2]}>
      <boxGeometry args={[W, H, D]} />
      <meshBasicMaterial
        color={highlighted ? '#f5c542' : '#6b7280'}
        wireframe
        transparent
        opacity={highlighted ? 0.45 : 0.18}
      />
    </mesh>
  );
}

/**
 * Recessed toe-kick under a floor cabinet (local space).
 * Front face (local Z=0) is open by ~50 mm; mass sits toward the back.
 */
function PlinthMesh({
  width,
  depth,
  height,
}: {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}): ReactNode {
  const recess = Math.min(50, Math.max(20, depth * 0.1));
  const W = Math.max(width * 0.98, 1);
  const H = Math.max(height, 1);
  const D = Math.max(depth - recess, 1);
  // Group origin is already at clearance height; plinth sits below local Y=0.
  return (
    <mesh
      position={[width / 2, -H / 2, recess + D / 2]}
      userData={{ plinth: true }}
    >
      <boxGeometry args={[W, H, D]} />
      <meshStandardMaterial
        color="#2c2f34"
        roughness={0.92}
        metalness={0.02}
      />
    </mesh>
  );
}

/** Simple countertop slab (presentation only). */
function CountertopMesh({
  width,
  height,
  depth,
}: {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}): ReactNode {
  const thickness = 38;
  const overhangFront = 25;
  const W = Math.max(width + 8, 1);
  const D = Math.max(depth + overhangFront, 1);
  return (
    <mesh
      position={[width / 2, height + thickness / 2, D / 2 - overhangFront / 2]}
      userData={{ countertop: true }}
    >
      <boxGeometry args={[W, thickness, D]} />
      <meshStandardMaterial
        color="#c4c0b8"
        roughness={0.45}
        metalness={0.08}
      />
    </mesh>
  );
}

function FloorGrid({
  totalWidth,
  totalDepth,
}: {
  readonly totalWidth: number;
  readonly totalDepth: number;
}): ReactNode {
  const cell = 500; // 50 cm grid
  const w = Math.max(totalWidth * 1.5, cell * 4);
  const d = Math.max(totalDepth * 1.5, cell * 4);
  return (
    <gridHelper
      args={[Math.max(w, d), Math.max(4, Math.round(Math.max(w, d) / cell)), '#4a5568', '#2d3748']}
      position={[totalWidth / 2, 1, totalDepth / 2]}
    />
  );
}

function WallMesh({
  wall,
  selected = false,
  onSelect,
}: {
  readonly wall: FurnitureSceneWall;
  readonly selected?: boolean;
  readonly onSelect?: (wallId: string) => void;
}): ReactNode {
  const h = wall.heightMm ?? 2400;
  const dx = wall.endXMm - wall.originXMm;
  const dy = wall.endYMm - wall.originYMm;
  const length = Math.max(1, Math.hypot(dx, dy));
  const midX = (wall.originXMm + wall.endXMm) / 2;
  const midY = (wall.originYMm + wall.endYMm) / 2;
  const yaw = Math.atan2(dy, dx);
  const thickness = selected ? 48 : 40;
  // Workshop → Three: [x, z, y]; wall sits on floor, long axis along length.
  return (
    <mesh
      position={[midX, h / 2, midY]}
      rotation={[0, -yaw, 0]}
      userData={{ wallId: wall.id }}
      onClick={
        onSelect
          ? (e) => {
              e.stopPropagation();
              onSelect(wall.id);
            }
          : undefined
      }
      onPointerOver={
        onSelect
          ? () => {
              document.body.style.cursor = 'pointer';
            }
          : undefined
      }
      onPointerOut={
        onSelect
          ? () => {
              document.body.style.cursor = '';
            }
          : undefined
      }
    >
      <boxGeometry args={[length, h, thickness]} />
      <meshStandardMaterial
        color={selected ? '#5b9fd4' : '#8b9098'}
        roughness={0.9}
        metalness={0.05}
        transparent
        opacity={selected ? 0.72 : 0.55}
      />
    </mesh>
  );
}

function ModuleGroup({
  mod,
  colorMode,
  materialColors,
  materialTextures,
  surfaceMode,
  showWireframe,
  showOutlines,
  selectedPartId,
  isolateSelected,
  onSelectPart,
  moduleSelected,
  onSelectModule,
  wallDrag,
  wallDragEnabled,
  onModuleWallOffset,
  onModuleWallDragStart,
  onModuleWallDragEnd,
  freeDrag,
  planShiftMm,
  onModuleFreeMove,
  onModuleFreeDragStart,
  onModuleFreeDragEnd,
  lightingMode = DEFAULT_SCENE_LIGHTING_MODE,
  controlsRef,
  setOrbitSuppressed,
}: {
  readonly mod: FurnitureSceneModule;
  readonly colorMode: BoardColorMode;
  readonly materialColors?: MaterialColorLookup;
  readonly materialTextures?: MaterialTextureLookup;
  readonly surfaceMode?: MaterialSurfaceMode;
  readonly showWireframe?: boolean;
  readonly showOutlines?: boolean;
  readonly selectedPartId?: string | null;
  readonly isolateSelected?: boolean;
  readonly onSelectPart?: (partId: string) => void;
  readonly moduleSelected?: boolean;
  readonly onSelectModule?: (moduleKey: string) => void;
  readonly lightingMode?: SceneLightingMode;
  readonly wallDrag?: {
    readonly originXMm: number;
    readonly originYMm: number;
    readonly angleDeg: number;
    readonly lengthMm: number;
    readonly moduleWidthMm: number;
  };
  readonly wallDragEnabled?: boolean;
  readonly onModuleWallOffset?: (moduleKey: string, offsetMm: number) => void;
  readonly onModuleWallDragStart?: (moduleKey: string) => void;
  readonly onModuleWallDragEnd?: (moduleKey: string) => void;
  readonly freeDrag?: boolean;
  readonly planShiftMm?: { readonly x: number; readonly y: number };
  readonly onModuleFreeMove?: (
    moduleKey: string,
    planXMm: number,
    planYMm: number,
  ) => void;
  readonly onModuleFreeDragStart?: (moduleKey: string) => void;
  readonly onModuleFreeDragEnd?: (moduleKey: string) => void;
  readonly controlsRef: React.RefObject<any>;
  readonly setOrbitSuppressed: (v: boolean) => void;
}): ReactNode {
  const { camera, gl } = useThree();
  /** True only after pointer moved past threshold (real drag). */
  const dragging = useRef(false);
  /** Pointer is down on module; may become drag or stay as click-select. */
  const pressPending = useRef(false);
  const pressStart = useRef({ x: 0, y: 0 });
  const dragMode = useRef<'wall' | 'free' | null>(null);
  const floorPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    [],
  );
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);

  const canFreeDrag = Boolean(
    wallDragEnabled && freeDrag && onModuleFreeMove,
  );
  const canWallDrag = Boolean(
    wallDragEnabled && !freeDrag && wallDrag && onModuleWallOffset,
  );
  const canDrag = canFreeDrag || canWallDrag;

  const applyDragFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(floorPlane, hit)) return;
      // Three (x,y,z) → workshop (x, y_plan=z)
      if (dragMode.current === 'free' && onModuleFreeMove) {
        const shiftX = planShiftMm?.x ?? 0;
        const shiftY = planShiftMm?.y ?? 0;
        onModuleFreeMove(
          mod.key,
          Math.round(hit.x - shiftX),
          Math.round(hit.z - shiftY),
        );
        return;
      }
      if (!wallDrag || !onModuleWallOffset) return;
      const offset = offsetMmFromPlanPoint(
        {
          originXMm: wallDrag.originXMm,
          originYMm: wallDrag.originYMm,
          angleDeg: wallDrag.angleDeg,
          lengthMm: wallDrag.lengthMm,
        },
        hit.x,
        hit.z,
        wallDrag.moduleWidthMm,
      );
      onModuleWallOffset(mod.key, offset);
    },
    [
      wallDrag,
      onModuleWallOffset,
      onModuleFreeMove,
      planShiftMm,
      gl.domElement,
      ndc,
      raycaster,
      camera,
      floorPlane,
      hit,
      mod.key,
    ],
  );

  const beginRealDrag = useCallback(
    (clientX: number, clientY: number) => {
      if (dragging.current) return;
      dragging.current = true;
      pressPending.current = false;
      dragMode.current = canFreeDrag ? 'free' : 'wall';
      setOrbitSuppressed(true);
      if (controlsRef.current) controlsRef.current.enabled = false;
      document.body.style.cursor = 'grabbing';
      if (canFreeDrag) onModuleFreeDragStart?.(mod.key);
      else onModuleWallDragStart?.(mod.key);
      applyDragFromClient(clientX, clientY);
    },
    [
      canFreeDrag,
      setOrbitSuppressed,
      controlsRef,
      onModuleFreeDragStart,
      onModuleWallDragStart,
      mod.key,
      applyDragFromClient,
    ],
  );

  const endDrag = useCallback(() => {
    pressPending.current = false;
    if (!dragging.current) return;
    const mode = dragMode.current;
    dragging.current = false;
    dragMode.current = null;
    setOrbitSuppressed(false);
    if (controlsRef.current) controlsRef.current.enabled = true;
    document.body.style.cursor = '';
    if (mode === 'free') onModuleFreeDragEnd?.(mod.key);
    else onModuleWallDragEnd?.(mod.key);
  }, [
    controlsRef,
    setOrbitSuppressed,
    onModuleWallDragEnd,
    onModuleFreeDragEnd,
    mod.key,
  ]);

  useEffect(() => {
    if (!canDrag) return;
    const onMove = (e: PointerEvent) => {
      if (pressPending.current && !dragging.current) {
        if (
          isPastDragThreshold(
            pressStart.current.x,
            pressStart.current.y,
            e.clientX,
            e.clientY,
          )
        ) {
          beginRealDrag(e.clientX, e.clientY);
        }
        return;
      }
      if (!dragging.current) return;
      applyDragFromClient(e.clientX, e.clientY);
    };
    const onUp = () => {
      // Click without drag: only select (already done on pointer down).
      if (pressPending.current && !dragging.current) {
        pressPending.current = false;
        return;
      }
      endDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [canDrag, applyDragFromClient, beginRealDrag, endDrag]);

  const visuals = useMemo(
    () =>
      boardPartsToVisuals(mod.parts, {
        colorMode,
        materialColors,
        materialTextures,
        surfaceMode,
      }),
    [mod.parts, colorMode, materialColors, materialTextures, surfaceMode],
  );
  // Workshop → Three Y-up: [x, z, y]
  const groupPos: [number, number, number] = [
    mod.originX,
    mod.originZ,
    mod.originY,
  ];
  const yawRad = ((mod.yawDeg ?? 0) * Math.PI) / 180;
  const groupRot: [number, number, number] = [0, yawRad, 0];
  const hasSelection = Boolean(selectedPartId);

  return (
    <group
      position={groupPos}
      rotation={groupRot}
      onClick={
        onSelectModule
          ? (e) => {
              e.stopPropagation();
              onSelectModule(mod.key);
            }
          : undefined
      }
      onPointerDown={
        canDrag
          ? (e) => {
              // Only primary button; leave orbit/right-click alone.
              if (e.button !== 0) return;
              e.stopPropagation();
              (e.target as Element).setPointerCapture?.(e.pointerId);
              // Click = select now. Drag starts only after movement threshold
              // (avoids jumping the unit when the floor raycast differs from
              // the click on the cabinet face).
              pressPending.current = true;
              pressStart.current = { x: e.clientX, y: e.clientY };
              dragging.current = false;
              dragMode.current = null;
              onSelectModule?.(mod.key);
              document.body.style.cursor = 'grab';
            }
          : undefined
      }
    >
      {mod.showOuterGhost !== false || moduleSelected ? (
        <OuterGhost
          width={mod.width}
          height={mod.height}
          depth={mod.depth}
          highlighted={moduleSelected}
        />
      ) : null}
      {(mod.baseClearanceMm ?? 0) > 0 ? (
        <PlinthMesh
          width={mod.width}
          depth={mod.depth}
          height={mod.baseClearanceMm!}
        />
      ) : null}
      {mod.showCountertop ? (
        <CountertopMesh
          width={mod.width}
          height={mod.height}
          depth={mod.depth}
        />
      ) : null}
      {visuals.map((v) => {
        const selected = selectedPartId === v.id || Boolean(moduleSelected);
        const dimmed =
          Boolean(isolateSelected) && hasSelection && !selected;
        return (
          <BoardMesh
            key={`${mod.key}-${v.id}`}
            visual={v}
            showWireframe={showWireframe}
            showOutlines={showOutlines || moduleSelected}
            selected={selected}
            dimmed={dimmed}
            onSelect={onSelectPart}
            lightingMode={lightingMode}
          />
        );
      })}
    </group>
  );
}

type CameraViewType = {
  readonly type: 'front' | 'top' | 'side' | 'isometric';
  readonly ts: number;
};

function CameraViewSetter({
  cameraView,
  center,
  maxDim,
  controlsRef,
}: {
  readonly cameraView: CameraViewType | null | undefined;
  readonly center: readonly [number, number, number];
  readonly maxDim: number;
  readonly controlsRef: React.RefObject<any>;
}): ReactNode {
  const { camera } = useThree();

  // Layout effect so presets win over drei Bounds fit animation on the same frame.
  useLayoutEffect(() => {
    if (!cameraView) return;

    if (controlsRef.current) {
      controlsRef.current.target.set(center[0], center[1], center[2]);
    }

    const targetPos = cameraPositionForView(
      cameraView.type,
      center,
      maxDim,
    );

    camera.position.set(...targetPos);
    camera.lookAt(center[0], center[1], center[2]);
    camera.updateProjectionMatrix();

    if (controlsRef.current) {
      controlsRef.current.update();
    }
  }, [cameraView, center, maxDim, controlsRef, camera]);

  return null;
}

function SceneContent({
  modules,
  walls,
  totalWidth,
  totalHeight,
  totalDepth,
  showFloor,
  showAxes,
  colorMode,
  materialColors,
  materialTextures,
  surfaceMode,
  cameraView,
  showWireframe,
  showOutlines,
  measurementMode,
  controlsRef,
  exportFormat,
  onExportComplete,
  exportProjectName,
  selectedPartId,
  isolateSelected,
  onSelectPart,
  selectedModuleKey,
  onSelectModule,
  wallDragByKey,
  onModuleWallOffset,
  onModuleWallDragStart,
  onModuleWallDragEnd,
  wallDragEnabled,
  freeDragByKey,
  planShiftMm,
  onModuleFreeMove,
  onModuleFreeDragStart,
  onModuleFreeDragEnd,
  selectedWallId,
  onSelectWall,
  showFloorGrid,
  lightingMode = DEFAULT_SCENE_LIGHTING_MODE,
}: {
  readonly modules: readonly FurnitureSceneModule[];
  readonly walls: readonly FurnitureSceneWall[];
  readonly totalWidth: number;
  readonly totalHeight: number;
  readonly totalDepth: number;
  readonly showFloor: boolean;
  readonly showAxes: boolean;
  readonly colorMode: BoardColorMode;
  readonly materialColors?: MaterialColorLookup;
  readonly materialTextures?: MaterialTextureLookup;
  readonly surfaceMode?: MaterialSurfaceMode;
  readonly cameraView?: CameraViewType | null;
  readonly showWireframe?: boolean;
  readonly showOutlines?: boolean;
  readonly measurementMode?: boolean;
  readonly controlsRef: React.RefObject<any>;
  readonly exportFormat?: ModelFormat | null;
  readonly onExportComplete?: () => void;
  readonly exportProjectName?: string;
  readonly selectedPartId?: string | null;
  readonly isolateSelected?: boolean;
  readonly onSelectPart?: (partId: string) => void;
  readonly selectedModuleKey?: string | null;
  readonly onSelectModule?: (moduleKey: string | null) => void;
  readonly wallDragByKey?: FurnitureScene3DProps['wallDragByKey'];
  readonly onModuleWallOffset?: (moduleKey: string, offsetMm: number) => void;
  readonly onModuleWallDragStart?: (moduleKey: string) => void;
  readonly onModuleWallDragEnd?: (moduleKey: string) => void;
  readonly wallDragEnabled?: boolean;
  readonly freeDragByKey?: FurnitureScene3DProps['freeDragByKey'];
  readonly planShiftMm?: FurnitureScene3DProps['planShiftMm'];
  readonly onModuleFreeMove?: FurnitureScene3DProps['onModuleFreeMove'];
  readonly onModuleFreeDragStart?: FurnitureScene3DProps['onModuleFreeDragStart'];
  readonly onModuleFreeDragEnd?: FurnitureScene3DProps['onModuleFreeDragEnd'];
  readonly selectedWallId?: string | null;
  readonly onSelectWall?: (wallId: string) => void;
  readonly showFloorGrid?: boolean;
  readonly lightingMode?: SceneLightingMode;
}): ReactNode {
  const [orbitSuppressed, setOrbitSuppressed] = useState(false);
  const framing = useMemo(
    () => sceneFraming(totalWidth, totalHeight, totalDepth),
    [totalWidth, totalHeight, totalDepth],
  );
  const lighting = useMemo(
    () =>
      planSceneLighting(
        lightingMode ?? DEFAULT_SCENE_LIGHTING_MODE,
        framing.maxDim,
      ),
    [lightingMode, framing.maxDim],
  );
  const lightMode = lightingMode ?? DEFAULT_SCENE_LIGHTING_MODE;

  return (
    <>
      <color attach="background" args={[lighting.background]} />
      <ambientLight intensity={lighting.ambient} />
      <hemisphereLight
        args={[lighting.hemiSky, lighting.hemiGround, lighting.hemiIntensity]}
      />
      <directionalLight
        position={[...lighting.key.pos]}
        intensity={lighting.key.intensity}
        color={lighting.key.color ?? '#ffffff'}
        castShadow={lighting.key.castShadow}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.00015}
        shadow-normalBias={0.6}
      />
      {lighting.fill ? (
        <directionalLight
          position={[...lighting.fill.pos]}
          intensity={lighting.fill.intensity}
          color={lighting.fill.color ?? '#ffffff'}
        />
      ) : null}
      {lighting.rim ? (
        <directionalLight
          position={[...lighting.rim.pos]}
          intensity={lighting.rim.intensity}
          color={lighting.rim.color ?? '#ffffff'}
        />
      ) : null}
      {lighting.spot ? (
        <spotLight
          position={[...lighting.spot.pos]}
          intensity={lighting.spot.intensity}
          angle={lighting.spot.angle}
          penumbra={lighting.spot.penumbra}
          castShadow={lighting.key.castShadow}
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
      ) : null}
      {lighting.useEnvironment ? (
        <Suspense fallback={null}>
          <Environment
            preset={lightMode === 'catalog' ? 'studio' : 'warehouse'}
            environmentIntensity={lighting.environmentIntensity}
          />
        </Suspense>
      ) : null}

      {/*
        Auto-fit fights CameraViewSetter: Bounds animates ~1s from the default
        camera and overwrites the 3/4 preset on open. Keep Bounds for grouping
        only when a preset is active; otherwise fit empty/manual views.
      */}
      <Bounds fit={!cameraView} margin={1.25}>
        <group
          onClick={
            onSelectModule
              ? () => {
                  onSelectModule(null);
                }
              : undefined
          }
        >
          {showAxes ? (
            <axesHelper args={[framing.maxDim * 0.75]} />
          ) : null}
          {showFloor ? (
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[framing.center[0], -1, framing.center[2]]}
              receiveShadow
            >
              <planeGeometry
                args={[totalWidth * 1.4, totalDepth * 1.6]}
              />
              <meshStandardMaterial
                color="#2a2d31"
                roughness={0.95}
                metalness={0}
              />
            </mesh>
          ) : null}
          {showFloor && showFloorGrid ? (
            <FloorGrid totalWidth={totalWidth} totalDepth={totalDepth} />
          ) : null}
          {walls.map((w) => (
            <WallMesh
              key={w.id}
              wall={w}
              selected={selectedWallId === w.id}
              onSelect={onSelectWall}
            />
          ))}
          {modules.map((mod) => (
            <ModuleGroup
              key={mod.key}
              mod={mod}
              colorMode={colorMode}
              materialColors={materialColors}
              materialTextures={materialTextures}
              surfaceMode={surfaceMode}
              showWireframe={showWireframe}
              showOutlines={showOutlines}
              selectedPartId={selectedPartId}
              isolateSelected={isolateSelected}
              onSelectPart={onSelectPart}
              moduleSelected={selectedModuleKey === mod.key}
              onSelectModule={
                onSelectModule
                  ? (key) => {
                      onSelectModule(key);
                    }
                  : undefined
              }
              wallDrag={wallDragByKey?.[mod.key]}
              wallDragEnabled={wallDragEnabled}
              onModuleWallOffset={onModuleWallOffset}
              onModuleWallDragStart={onModuleWallDragStart}
              onModuleWallDragEnd={onModuleWallDragEnd}
              freeDrag={Boolean(freeDragByKey?.[mod.key])}
              planShiftMm={planShiftMm}
              onModuleFreeMove={onModuleFreeMove}
              onModuleFreeDragStart={onModuleFreeDragStart}
              onModuleFreeDragEnd={onModuleFreeDragEnd}
              lightingMode={lightMode}
              controlsRef={controlsRef}
              setOrbitSuppressed={setOrbitSuppressed}
            />
          ))}
        </group>
        <CameraViewSetter
          cameraView={cameraView}
          center={framing.center}
          maxDim={framing.maxDim}
          controlsRef={controlsRef}
        />
      </Bounds>

      {/* Soft ground disk under the unit. Catalog product stills omit it so
          the still is furniture-on-studio-backdrop only (no gray floor band). */}
      {lightMode !== 'catalog' ? (
        <ContactShadows
          position={[framing.center[0], 0.5, framing.center[2]]}
          opacity={0.32}
          scale={framing.maxDim * 2.2}
          blur={2.2}
          far={framing.maxDim}
        />
      ) : null}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={framing.maxDim * 0.3}
        maxDistance={framing.maxDim * 5}
        // Keep orbit above the floor (no under-slab "looking up" view).
        minPolarAngle={0.08}
        maxPolarAngle={Math.PI / 2 - 0.06}
        target={framing.center as any}
        enabled={!measurementMode && !orbitSuppressed}
      />

      <MeasurementTool active={measurementMode ?? false} />
      <KeyboardNav
        active={true}
        controlsRef={controlsRef}
        center={framing.center}
        maxDim={framing.maxDim}
      />

      <ModelExporter
        exportFormat={exportFormat ?? null}
        onExportComplete={onExportComplete ?? (() => {})}
        projectName={exportProjectName ?? 'scene'}
      />
    </>);
}

export function FurnitureScene3D({
  modules,
  totalWidth,
  totalHeight,
  totalDepth,
  className,
  style,
  testId = 'furniture-scene-3d',
  showFloor = true,
  showAxes,
  colorMode = 'material',
  materialColors,
  materialTextures,
  surfaceMode,
  cameraView,
  cameraType = 'perspective',
  showWireframe,
  showOutlines = false,
  measurementMode,
  exportFormat = null,
  onExportComplete,
  exportProjectName = 'scene',
  selectedPartId = null,
  onSelectPart,
  isolateSelected = false,
  walls = [],
  selectedModuleKey = null,
  onSelectModule,
  wallDragByKey,
  onModuleWallOffset,
  onModuleWallDragStart,
  onModuleWallDragEnd,
  wallDragEnabled = false,
  freeDragByKey,
  planShiftMm,
  onModuleFreeMove,
  onModuleFreeDragStart,
  onModuleFreeDragEnd,
  fillViewport = false,
  showHint = true,
  selectedWallId = null,
  onSelectWall,
  showFloorGrid = false,
  lightingMode = DEFAULT_SCENE_LIGHTING_MODE,
}: FurnitureScene3DProps): ReactNode {
  const controlsRef = useRef<any>(null);
  const hasAnyParts = modules.some((m) => m.parts.length > 0);
  // Keep empty modules so outer ghosts match layout footprint (no invisible gaps).
  const sceneModules = modules;
  const selectionEnabled =
    (Boolean(onSelectPart) || Boolean(onSelectModule)) && !measurementMode;
  const hasWalls = walls.length > 0;
  /** Axes default on only for floor-less inspect scenes (module editor). */
  const axesVisible = showAxes ?? !showFloor;
  const rootClass = [
    'module-scene-3d',
    fillViewport ? 'module-scene-3d--fill' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  // Same 3/4 formula as the toolbar button / CameraViewSetter (first frame match).
  const defaultCameraPosition = useMemo(() => {
    const framing = sceneFraming(totalWidth, totalHeight, totalDepth);
    return cameraPositionForView(
      'isometric',
      framing.center,
      framing.maxDim,
    );
  }, [totalWidth, totalHeight, totalDepth]);
  const cameraFar =
    Math.max(totalWidth, totalHeight, totalDepth, 1) * 25;

  const hintText = [
    'Arrastrá para orbitar · rueda para zoom · click derecho o Shift+click para pan',
    '← → ↑ ↓ teclado · + − zoom',
    selectionEnabled ? 'click para seleccionar' : null,
    wallDragEnabled
      ? freeDragByKey && Object.keys(freeDragByKey).length > 0
        ? 'arrastrá un mueble en muro o isla libre'
        : 'arrastrá un mueble para deslizarlo en el muro'
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (
    sceneModules.length === 0 &&
    !hasWalls
  ) {
    return (
      <div
        className={`${rootClass} module-scene-3d--empty`}
        style={style}
        data-testid={`${testId}-empty`}
      >
        <p className="catalog-empty">Sin piezas para la vista 3D.</p>
      </div>
    );
  }

  if (
    sceneModules.length > 0 &&
    !hasAnyParts &&
    sceneModules.every((m) => m.showOuterGhost === false) &&
    !hasWalls
  ) {
    return (
      <div
        className={`${rootClass} module-scene-3d--empty`}
        style={style}
        data-testid={`${testId}-empty`}
      >
        <p className="catalog-empty">Sin piezas para la vista 3D.</p>
      </div>
    );
  }

  return (
    <div className={rootClass} style={style} data-testid={testId}>
      {showHint && !fillViewport ? (
        <p className="module-scene-3d__hint">{hintText}</p>
      ) : null}
      <div
        className="module-scene-3d__canvas-wrap module-scene-3d__canvas-wrap--focusable"
        tabIndex={0}
        aria-label="Vista 3D interactiva. Usá las flechas para orbitar, +/- para zoom."
      >
        {showHint && fillViewport ? (
          <p className="module-scene-3d__hint module-scene-3d__hint--overlay">
            {hintText}
          </p>
        ) : null}
        <ErrorBoundary
          fallback={(error, reset) => (
            <div className="r3f-error-fallback" role="alert" aria-label="Error en la vista 3D">
              <AlertTriangle
                size={32}
                strokeWidth={1.5}
                className="r3f-error-fallback__icon"
                aria-hidden
              />
              <p className="r3f-error-fallback__message">
                Error al renderizar la vista 3D.
              </p>
              <button
                type="button"
                className="btn btn--small"
                onClick={reset}
                data-testid="r3f-error-retry"
              >
                Reintentar
              </button>
            </div>
          )}
        >
        <Suspense fallback={
          <div className="module-scene-3d__loading" role="status" aria-label="Cargando vista 3D">
            <div className="module-scene-3d__loading-spinner" />
            <p className="module-scene-3d__loading-text">
              Cargando escena 3D…
            </p>
          </div>
        }>
        <Canvas
          shadows
          dpr={[1, 2]}
          style={
            fillViewport
              ? { width: '100%', height: '100%', display: 'block' }
              : undefined
          }
          gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
          onPointerMissed={() => {
            if (selectionEnabled) {
              onSelectPart?.(null);
              onSelectModule?.(null);
            }
          }}
        >
          {cameraType === 'orthographic' ? (
            <OrthographicCamera
              makeDefault
              position={[...defaultCameraPosition]}
              zoom={1.5}
              near={1}
              far={cameraFar}
            />
          ) : (
            <PerspectiveCamera
              makeDefault
              position={[...defaultCameraPosition]}
              fov={40}
              near={1}
              far={cameraFar}
            />
          )}
          <Suspense fallback={null}>
             <SceneContent
              modules={sceneModules}
              walls={walls}
              totalWidth={totalWidth}
              totalHeight={totalHeight}
              totalDepth={totalDepth}
              showFloor={showFloor}
              showAxes={axesVisible}
              colorMode={colorMode}
              materialColors={materialColors}
              materialTextures={materialTextures}
              surfaceMode={surfaceMode}
              cameraView={cameraView}
              showWireframe={showWireframe}
              showOutlines={showOutlines}
              measurementMode={measurementMode}
              controlsRef={controlsRef}
              exportFormat={exportFormat}
              onExportComplete={onExportComplete}
              exportProjectName={exportProjectName}
              selectedPartId={selectedPartId}
              isolateSelected={isolateSelected}
              onSelectPart={
                selectionEnabled && onSelectPart ? onSelectPart : undefined
              }
              selectedModuleKey={selectedModuleKey}
              onSelectModule={
                selectionEnabled && onSelectModule
                  ? onSelectModule
                  : undefined
              }
              wallDragByKey={wallDragByKey}
              onModuleWallOffset={onModuleWallOffset}
              onModuleWallDragStart={onModuleWallDragStart}
              onModuleWallDragEnd={onModuleWallDragEnd}
              wallDragEnabled={wallDragEnabled && !measurementMode}
              freeDragByKey={freeDragByKey}
              planShiftMm={planShiftMm}
              onModuleFreeMove={onModuleFreeMove}
              onModuleFreeDragStart={onModuleFreeDragStart}
              onModuleFreeDragEnd={onModuleFreeDragEnd}
              selectedWallId={selectedWallId}
              onSelectWall={onSelectWall}
              showFloorGrid={showFloorGrid}
              lightingMode={lightingMode}
            />
          </Suspense>
          </Canvas>
        </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
