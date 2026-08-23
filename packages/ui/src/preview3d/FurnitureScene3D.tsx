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
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  Bounds,
  ContactShadows,
  Environment,
  Html,
  OrbitControls,
  PerspectiveCamera,
  OrthographicCamera,
  Edges,
  useTexture,
} from '@react-three/drei';
import * as THREE from 'three';
import {
  offsetMmFromPlanPoint,
  suggestLegCount,
  DEFAULT_MATERIAL_PREVIEW_COLOR,
  splitWallSegments,
  wallsOccludingCamera,
  type AmbientMaterial,
  type Hardware,
  type ModuleBaseMode,
  type PlinthSides,
  type ResolvedBoardPart,
  type HardwarePlacement,
  type ResolvedHardwarePlacement,
  type WallOpening,
} from '@muebles/domain';
import { HardwareMesh } from './HardwareMesh';
import { HardwarePlacementGizmo, pickGizmoPlacement } from './HardwarePlacementGizmo';
import {
  beginDragFeedbackSample,
  endDragFeedbackSample,
  recordRendererSample,
} from './perfTelemetry';
import {
  boardPartsToVisuals,
  cameraPositionForView,
  sceneFraming,
  type BoardColorMode,
  type BoardPartVisual,
  type MaterialColorLookup,
  type MaterialSurfaceMode,
  type MaterialTextureEntry,
  type MaterialTextureLookup,
} from './boardPartVisual';
import { BoardMeshMaterial, textureUvRepeat } from './BoardMeshMaterial';
import { MeasurementTool } from './MeasurementTool';
import { KeyboardNav } from './KeyboardNav';
import { ModelExporter, type ModelFormat } from './ModelExporter';
import {
  DEFAULT_SCENE_LIGHTING_MODE,
  planSceneLighting,
  type SceneLightingMode,
} from './sceneLighting';
import {
  BackWallMesh,
  BaseboardMesh,
  CeilingMesh,
  FLOOR_DEFAULT_COLOR,
  FloorAmbientMesh,
  PAINT_HOVER_COLOR,
  ROOM_WALL_HEIGHT_MM,
  WALL_DEFAULT_COLOR,
  WALL_GHOST_OPACITY,
  WINDOW_PANE_COLOR,
  WallAmbientMesh,
  planAmbientScene,
  resolveCountertopPhysical,
} from './AmbientMeshes';
import { isPastDragThreshold } from './moduleDragGesture';
import { planBoxForModule, resolveDragGuide } from './dragGuides';
import {
  BOARD_PAINT_DRAG_MIME,
  LIBRARY_DRAG_MIME,
  PAINT_DRAG_MIME,
  UNPLACED_DRAG_MIME,
  decodeBoardPaintDrag,
  decodePaintDrag,
  decodeUnplacedDrag,
  resolveBoardPaintTarget,
  type PaintDrop,
  type PaintSurface,
} from './paintMaterial';
import { AlertTriangle } from 'lucide-react';
import { ErrorBoundary } from '../common/ErrorBoundary';
import './moduleScene3d.css';

export type { SceneLightingMode } from './sceneLighting';
export type { PaintSurface, PaintDrop } from './paintMaterial';

/**
 * F143 — modificadores de selección leídos del evento nativo del puntero.
 * Shift añade (rango en listas); Ctrl/Cmd alterna.
 */
export type ModuleSelectModifiers = {
  readonly shift: boolean;
  readonly ctrlOrMeta: boolean;
};

function pointerModifiers(e: {
  nativeEvent?: PointerEvent | MouseEvent;
}): ModuleSelectModifiers {
  const n = e.nativeEvent;
  return {
    shift: Boolean(n?.shiftKey),
    ctrlOrMeta: Boolean(n && (n.ctrlKey || n.metaKey)),
  };
}

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
   * top of this clearance; the base treatment is drawn below when > 0.
   */
  readonly baseClearanceMm?: number;
  /**
   * Base treatment mode driving what is drawn under the cabinet (F087):
   * plinth_board (melamine with material color), plinth_strip (purchased
   * metallic profile), legs (feet), none (nothing).
   */
  readonly baseMode?: ModuleBaseMode;
  /** Melamine material id for the plinth board — color/texture via lookups. */
  readonly plinthMaterialId?: string;
  /** Preview color of the chosen profile / legs hardware (user catalog). */
  readonly plinthHardwareColor?: string;
  /** Material thickness for thin plinth panels (F088); profile = 16 mm. */
  readonly plinthThicknessMm?: number;
  /** Exposed plinth sides — side/back return panels (F088). */
  readonly plinthSides?: PlinthSides;
  /** Visual countertop slab on top of floor cabinets (presentation). */
  readonly showCountertop?: boolean;
  readonly showOuterGhost?: boolean;
  /** Per-part resolved hardware placements (handles, hinges) for 3D rendering. */
  readonly resolvedHardwarePlacements?: readonly ResolvedHardwarePlacement[];
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
  /** Optional ambient material override for this specific wall. */
  readonly wallMaterialId?: string;
  /** Wall openings — rendered as real holes (F145, presentation-only). */
  readonly openings?: readonly WallOpening[];
};

export type FurnitureScene3DProps = {
  /**
   * F131: raw hardware placements by componentInstanceId — enables the 3D
   * gizmo editor (snap 32mm) on the selected board. Omitted → read-only gizmo.
   */
  readonly rawHardwarePlacements?: ReadonlyMap<string, readonly HardwarePlacement[]>;
  readonly onUpdateHardwarePlacement?: (
    componentInstanceId: string,
    index: number,
    patch: Partial<HardwarePlacement>,
  ) => void;
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
  readonly cameraView?: CameraViewType | null;
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
  /**
   * F143 — multi-selección: claves de instancias seleccionadas. Cuando se
   * pasa, gana sobre `selectedModuleKey`.
   */
  readonly selectedModuleKeys?: readonly string[] | null;
  /**
   * Click a module (or empty) to select. Prefer over part pick when set.
   * F143: los modificadores (Shift añade, Ctrl/Cmd alterna) llegan en el
   * segundo argumento para que el studio resuelva la intención.
   */
  readonly onSelectModule?: (
    moduleKey: string | null,
    modifiers?: ModuleSelectModifiers,
  ) => void;
  /**
   * F143 — herraje seleccionado en modo detalle. Identidad estable:
   * `${componentInstanceId}:${hardwareId}` (la misma del mesh key).
   */
  readonly selectedHardwareId?: string | null;
  readonly onSelectHardware?: (hardwareId: string | null) => void;
  /** F143 — guías temporales de distancia durante el drag de muro. */
  readonly showDragGuides?: boolean;
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
  readonly onSelectWall?: (wallId: string | null) => void;
  /**
   * Fill parent height/width (Proyectar studio). Default embedded preview
   * keeps a fixed ~380px canvas for modals/editors.
   */
  readonly fillViewport?: boolean;
  /** When false, hide orbit/help hint (studio toolbar replaces it). Default true. */
  readonly showHint?: boolean;
  /** F144 — keyboard orbit cedes to studio nudge when a selection exists. */
  readonly keyboardNavActive?: boolean;
  /** Subtle floor grid in mm (obra look). */
  readonly showFloorGrid?: boolean;
  /**
   * F145 — ghost the walls between the camera and the room so they stop
   * blocking the work (toolbar «Ocultar muros»; default off).
   */
  readonly hideOccludingWalls?: boolean;
  /**
   * Scene lighting + material response preset.
   * present = multi-light + env + glossier melamine (default for Proyectar).
   */
  readonly lightingMode?: SceneLightingMode;
  /**
   * Ambient (presentation-only) floor material. When set AND
   * `lightingMode !== 'catalog'` AND `showFloor`, the floor renders the ambient
   * material (texture/color) instead of the white default. Caller resolves
   * `KitchenSpace.floorMaterialId` → AmbientMaterial via the catalog.
   */
  readonly ambientFloor?: AmbientMaterial;
  /**
   * Ambient (presentation-only) wall material. When set AND
   * `lightingMode !== 'catalog'`, wall segments render the ambient material
   * instead of the white default.
   */
  readonly ambientWall?: AmbientMaterial;
  /**
   * Ambient (presentation-only) ceiling material. When set AND
   * `lightingMode !== 'catalog'`, the ceiling renders the ambient material
   * instead of the white default.
   */
  readonly ambientCeiling?: AmbientMaterial;
  /**
   * Ambient (presentation-only) countertop material for floor cabinet slabs.
   */
  readonly ambientCountertop?: AmbientMaterial;
  /**
   * Catalog ambient materials used for looking up per-wall wallMaterialId overrides.
   */
  readonly availableAmbientMaterials?: readonly AmbientMaterial[];
  /**
   * Show the ceiling mesh (room box). Opt-in; default OFF to preserve the
   * current open feel. Only rendered when an ambient material is present and
   * `lightingMode !== 'catalog'`.
   */
  readonly showCeiling?: boolean;
  /**
   * Paint drop handler (F067). Fired when the user drops a dragged ambient
   * material onto the canvas. FurnitureScene3D reads the dataTransfer, raycasts
   * to resolve the surface, and hands back the resolved drop. The Studio
   * validates surfaceType and commits floor/wallMaterialId. Receives null when
   * the drop misses all paintable surfaces.
   */
  readonly onPaintDrop?: (drop: PaintDrop | null) => void;
  /**
   * Paint hover handler (F067). Fired as the dragged material moves over the
   * canvas. FurnitureScene3D raycasts and reports the surface under the cursor,
   * or null when the drag leaves the canvas / misses paintable surfaces.
   */
  readonly onPaintHover?: (surface: PaintSurface | null) => void;
  /**
   * Surface currently highlighted as paint-drop target, or null. Drives the
   * green overlay on FloorAmbientMesh/WallAmbientMesh.
   */
  readonly paintHoverSurface?: PaintSurface | null;

  // ── F065 Drag ítem sin colocar → viewport ──────────────────────────────────
  /**
   * Ghost semi-transparente mostrado mientras se arrastra un ítem sin colocar.
   * Null = no hay drag activo.
   */
  readonly ghostModule?: {
    readonly widthMm: number;
    readonly heightMm: number;
    readonly depthMm: number;
  } | null;
  /** true=verde (válido), false=rojo (colisión), undefined=neutro. */
  readonly ghostDropValid?: boolean;
  /**
   * Posición Three.js del ghost en escena (mm workshop).
   * Calculada por ProjectSpatialStudio a partir del hit del raycaster.
   */
  readonly ghostPosition?: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  } | null;
  /**
   * Colisión durante drag (Fase A): cuando true, el OuterGhost del módulo
   * seleccionado (el que se arrastra) se renderiza rojo (#ef4444) para avisar
   * que el drop es inválido. El Studio lo setea cuando el offset candidato
   * colisiona con otro módulo.
   */
  readonly draggingInvalid?: boolean;
  /**
   * Hardware catalog lookup (id → Hardware) for rendering handles/hinges.
   * When omitted, no hardware meshes render.
   */
  readonly hardwareCatalog?: readonly Hardware[];
  /**
   * Drop de un ítem sin colocar sobre el viewport. El Studio resuelve la
   * posición (wallId+offsetMm para muro, planXMm/planYMm para piso).
   */
  readonly onUnplacedDrop?: (drop: {
    readonly wallId: string | null;
    readonly offsetMm: number;
    readonly planXMm: number;
    readonly planYMm: number;
  }) => void;
  /**
   * Hover durante el drag de ítem sin colocar. Permite al Studio actualizar
   * la posición del ghost y calcular validez.
   */
  readonly onUnplacedHover?: (hit: {
    readonly wallId: string | null;
    readonly offsetMm: number;
    readonly planXMm: number;
    readonly planYMm: number;
  } | null) => void;
  /**
   * F142 — drop de un material de taller (tablero) sobre el canvas. El
   * studio recibe el material arrastrado y el módulo bajo el cursor
   * (null = fuera de todo mueble o superficie bloqueada; el caller debe
   * rechazar con feedback que enseña, nunca aplicar a superficie).
   */
  readonly onBoardPaintDrop?: (drop: {
    readonly moduleKey: string | null;
    readonly materialId: string;
  }) => void;
  /** F142 — hover durante el drag de tablero (highlight del mueble target). */
  readonly onBoardPaintHover?: (moduleKey: string | null) => void;
  /** F142 — mueble resaltado como target del drag de tablero. */
  readonly boardPaintHoverModuleKey?: string | null;
};

function BoardMesh({
  visual,
  showWireframe = false,
  showOutlines = false,
  selected = false,
  dimmed = false,
  onSelect,
  lightingMode = DEFAULT_SCENE_LIGHTING_MODE,
  hardwarePlacements,
  hardwareCatalog,
  hardwareSelectedId,
  onSelectHardwareId,
  gizmoRawPlacement,
  onGizmoPlacementChange,
}: {
  readonly visual: BoardPartVisual;
  readonly showWireframe?: boolean;
  readonly showOutlines?: boolean;
  readonly selected?: boolean;
  readonly dimmed?: boolean;
  readonly onSelect?: (partId: string) => void;
  readonly lightingMode?: SceneLightingMode;
  /**
   * Resolved hardware placements filtered to this board (by
   * componentInstanceId === visual.id). Rendered as children of the board group
   * so they inherit the board transform — the group's local frame matches the
   * resolver contract.
   */
  readonly hardwarePlacements?: readonly ResolvedHardwarePlacement[];
  readonly hardwareCatalog?: Readonly<Map<string, Hardware>>;
  /** F143 — id de herraje seleccionado (modo detalle) para highlight. */
  readonly hardwareSelectedId?: string | null;
  /** F143 — click en herraje (modo detalle). */
  readonly onSelectHardwareId?: (hardwareId: string) => void;
  /** F131: raw placement backing the first resolved one (gizmo edit target). */
  readonly gizmoRawPlacement?: HardwarePlacement;
  /** F131: gizmo edits flow up (snap 32mm); absent → gizmo mounts read-only. */
  readonly onGizmoPlacementChange?: (patch: Partial<HardwarePlacement>) => void;
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
  const handleMeshes =
    hardwarePlacements && hardwarePlacements.length > 0 && hardwareCatalog
      ? hardwarePlacements.map((placement) => {
          const hardware = hardwareCatalog.get(placement.hardwareId);
          if (!hardware) return null; // swapped/removed → no orphan mesh (VH-09)
          // Remount on hardware/shape swap so material + geometry refresh
          // cleanly (mirrors BoardMeshMaterial key discipline).
          const hardwareId = `${placement.componentInstanceId}:${placement.hardwareId}`;
          return (
            <HardwareMesh
              key={`${visual.id}:${placement.hardwareId}:${placement.componentInstanceId}`}
              placement={placement}
              hardware={hardware}
              lightingMode={lightingMode}
              selected={hardwareSelectedId === hardwareId}
              onSelect={
                onSelectHardwareId ? () => onSelectHardwareId(hardwareId) : undefined
              }
            />
          );
        })
      : null;
  // F131 (deuda F070): gizmo montado en el viewport para la pieza seleccionada.
  const showGizmo =
    selected && pickGizmoPlacement(selected, hardwarePlacements ?? []);
  const gizmoAnchor = hardwarePlacements?.[0];
  return (
    <group position={visual.position} rotation={visual.rotation}>
      {showGizmo && gizmoAnchor ? (
        <group position={gizmoAnchor.localPosition}>
          <HardwarePlacementGizmo
            placement={
              gizmoRawPlacement ?? {
                hardwareId: gizmoAnchor.hardwareId,
                anchorFace: 'front',
                relativePosition: {
                  xMm: gizmoAnchor.localPosition[0],
                  yMm: gizmoAnchor.localPosition[2],
                },
              }
            }
            anchorFace={gizmoRawPlacement?.anchorFace ?? 'front'}
            boardWidthMm={visual.size[0]}
            boardHeightMm={visual.size[2]}
            snapMm={32}
            onChangePlacement={onGizmoPlacementChange}
          />
        </group>
      ) : null}
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
      {/* Hardware (handles/hinges) mount as siblings of the <mesh> inside the
          board group: they share the group's local frame ([0,W]×[0,T]×[0,L]),
          so the resolver's localPosition lands on the anchor face. */}
      {handleMeshes}
    </group>
  );
}

function OuterGhost({
  width,
  height,
  depth,
  highlighted = false,
  invalid = false,
}: {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly highlighted?: boolean;
  readonly invalid?: boolean;
}): ReactNode {
  const W = Math.max(width, 1);
  const H = Math.max(height, 1);
  const D = Math.max(depth, 1);
  // invalid (collision during drag) wins over highlighted (selection).
  const color = invalid ? '#ef4444' : highlighted ? '#f5c542' : '#6b7280';
  const opacity = invalid ? 0.5 : highlighted ? 0.45 : 0.18;
  return (
    <mesh position={[W / 2, H / 2, D / 2]}>
      <boxGeometry args={[W, H, D]} />
      <meshBasicMaterial
        color={color}
        wireframe
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

/**
 * Ghost semi-transparente del ítem siendo arrastrado al viewport (F065).
 * valid=true → verde, valid=false → rojo, undefined → gris neutro.
 */
function GhostModuleMesh({
  width,
  height,
  depth,
  position,
  valid,
}: {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly position: readonly [number, number, number];
  readonly valid?: boolean;
}): ReactNode {
  const W = Math.max(width, 1);
  const H = Math.max(height, 1);
  const D = Math.max(depth, 1);
  const color =
    valid === false ? '#ef4444' : valid === true ? '#22c55e' : '#6b7280';
  return (
    <group position={[...position]}>
      {/* Filled semi-transparent volume */}
      <mesh position={[W / 2, H / 2, D / 2]}>
        <boxGeometry args={[W, H, D]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.22}
          depthWrite={false}
        />
      </mesh>
      {/* Wireframe overlay for crisp edges */}
      <mesh position={[W / 2, H / 2, D / 2]}>
        <boxGeometry args={[W, H, D]} />
        <meshBasicMaterial
          color={color}
          wireframe
          transparent
          opacity={0.7}
        />
      </mesh>
    </group>
  );
}

/**
 * Base treatment under a floor cabinet (local space), driven by the base mode
 * (F087/F088). Local Three z = workshop depth: z=depth is the cabinet FRONT,
 * z=0 the back. The plinth renders as real thin panels wearing the resolved
 * material (texture + grain along each panel's length):
 * - front panel, recessed `recess` from the cabinet face
 * - side returns where the run ends exposed (no neighbor cabinet / wall end)
 * - back return for islands (free placements)
 */
function PlinthMesh({
  width,
  depth,
  height,
  mode,
  materialId,
  hardwareColor,
  materialColors,
  materialTextures,
  thicknessMm,
  sides,
}: {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly mode: ModuleBaseMode;
  /** Melamine material id (board mode) — resolved via materialColors. */
  readonly materialId?: string;
  /** Hex preview color of the chosen profile / legs hardware. */
  readonly hardwareColor?: string;
  readonly materialColors?: MaterialColorLookup;
  readonly materialTextures?: MaterialTextureLookup;
  readonly thicknessMm?: number;
  readonly sides?: PlinthSides;
}): ReactNode {
  if (height <= 0 || mode === 'none') return null;

  if (mode === 'legs') {
    return (
      <LegsMesh width={width} depth={depth} height={height} color={hardwareColor} />
    );
  }

  const isStrip = mode === 'plinth_strip';
  const T = Math.max(
    1,
    thicknessMm ?? (isStrip ? 16 : 18),
  );
  const H = Math.max(height, 1);
  const recess = Math.min(50, Math.max(20, depth * 0.1));
  const returnDepth = Math.max(depth - recess, 1);
  const color = isStrip
    ? hardwareColor ?? '#b9bec4'
    : (materialId ? materialColors?.[materialId] : undefined) ??
      DEFAULT_MATERIAL_PREVIEW_COLOR;
  const texture =
    !isStrip && materialId ? materialTextures?.[materialId] : undefined;

  type Panel = {
    readonly pos: readonly [number, number, number];
    readonly size: readonly [number, number, number];
    readonly longMm: number;
  };
  // Front panel: visible face `recess` behind the cabinet front (z=depth).
  const panels: Panel[] = [
    {
      pos: [width / 2, -H / 2, depth - recess - T / 2],
      size: [width, H, T],
      longMm: width,
    },
  ];
  if (sides?.left) {
    panels.push({
      pos: [T / 2, -H / 2, (depth - recess) / 2],
      size: [T, H, returnDepth],
      longMm: returnDepth,
    });
  }
  if (sides?.right) {
    panels.push({
      pos: [width - T / 2, -H / 2, (depth - recess) / 2],
      size: [T, H, returnDepth],
      longMm: returnDepth,
    });
  }
  if (sides?.back) {
    panels.push({
      pos: [width / 2, -H / 2, T / 2],
      size: [width, H, T],
      longMm: width,
    });
  }

  return (
    <group>
      {panels.map((panel, i) =>
        texture ? (
          <PlinthPanelMesh
            key={i}
            position={panel.pos}
            size={panel.size}
            longMm={panel.longMm}
            crossMm={H}
            texture={texture}
          />
        ) : (
          <mesh key={i} position={panel.pos as [number, number, number]} userData={{ plinth: true }}>
            <boxGeometry args={panel.size as [number, number, number]} />
            <meshStandardMaterial
              color={color}
              roughness={isStrip ? 0.35 : 0.92}
              metalness={isStrip ? 0.85 : 0.02}
            />
          </mesh>
        ),
      )}
    </group>
  );
}

/** One textured plinth panel — grain (U) runs along the panel's length. */
function PlinthPanelMesh({
  position,
  size,
  longMm,
  crossMm,
  texture,
}: {
  readonly position: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly longMm: number;
  readonly crossMm: number;
  readonly texture: MaterialTextureEntry;
}): ReactNode {
  const map = useTexture(texture.url);
  useEffect(() => {
    const [u, v] = textureUvRepeat(
      longMm,
      crossMm,
      texture.tileWidthMm,
      texture.tileLengthMm,
    );
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(u, v);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    map.needsUpdate = true;
  }, [map, longMm, crossMm, texture]);
  return (
    <mesh position={position as [number, number, number]} userData={{ plinth: true }}>
      <boxGeometry args={size as [number, number, number]} />
      <meshStandardMaterial
        map={map}
        color="#ffffff"
        roughness={0.92}
        metalness={0.02}
      />
    </mesh>
  );
}

/** Visible feet / levelers under the cabinet (base mode `legs`, F087). */
function LegsMesh({
  width,
  depth,
  height,
  color,
}: {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly color?: string;
}): ReactNode {
  const H = Math.max(height, 1);
  const count = suggestLegCount(width);
  const radius = 12;
  const insetX = Math.max(50, width * 0.08);
  const insetZ = Math.max(40, depth * 0.1);
  const positions: [number, number][] = [];
  if (count <= 4) {
    positions.push(
      [insetX, insetZ],
      [width - insetX, insetZ],
      [insetX, depth - insetZ],
      [width - insetX, depth - insetZ],
    );
  } else {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = insetX + t * (width - insetX * 2);
      positions.push([x, insetZ], [x, depth - insetZ]);
    }
  }
  return (
    <group>
      {positions.map(([x, z], i) => (
        <mesh
          key={i}
          position={[x, -H / 2, z]}
          userData={{ plinth: true }}
        >
          <cylinderGeometry args={[radius, radius * 0.85, H, 12]} />
          <meshStandardMaterial
            color={color ?? '#3a3d42'}
            roughness={0.5}
            metalness={0.6}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Textured countertop surface (photo material + UV repeat). */
function CountertopTextureMaterial({
  url,
  widthMm,
  depthMm,
  tileWidthMm,
  tileLengthMm,
  phys,
}: {
  readonly url: string;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly tileWidthMm?: number;
  readonly tileLengthMm?: number;
  readonly phys: ReturnType<typeof resolveCountertopPhysical>;
}): ReactNode {
  const map = useTexture(url);
  useEffect(() => {
    const [u, v] = textureUvRepeat(widthMm, depthMm, tileWidthMm, tileLengthMm);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(u, v);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    map.needsUpdate = true;
  }, [map, widthMm, depthMm, tileWidthMm, tileLengthMm]);
  return (
    <meshPhysicalMaterial
      map={map}
      color="#ffffff"
      roughness={phys.roughness}
      metalness={phys.metalness}
      clearcoat={phys.clearcoat}
      clearcoatRoughness={phys.clearcoatRoughness}
      envMapIntensity={phys.envMapIntensity}
    />
  );
}

/** Simple countertop slab (presentation only). */
function CountertopMesh({
  width,
  height,
  depth,
  material,
  paintHover = false,
  lightingMode = DEFAULT_SCENE_LIGHTING_MODE,
}: {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly material?: AmbientMaterial;
  readonly paintHover?: boolean;
  readonly lightingMode?: SceneLightingMode;
}): ReactNode {
  const thickness = 38;
  const overhangFront = 25;
  const W = Math.max(width + 8, 1);
  const D = Math.max(depth + overhangFront, 1);
  const color = material?.previewColor ?? '#c4c0b8';
  const phys = resolveCountertopPhysical(material, lightingMode);
  return (
    <mesh
      position={[width / 2, height + thickness / 2, D / 2 - overhangFront / 2]}
      userData={{ countertop: true, boardPaintBlocked: true }}
    >
      <boxGeometry args={[W, thickness, D]} />
      {paintHover ? (
        <meshStandardMaterial
          color={PAINT_HOVER_COLOR}
          roughness={0.45}
          metalness={0.08}
          transparent
          opacity={0.85}
        />
      ) : (
        <Suspense
          fallback={
            <meshStandardMaterial
              color={color}
              roughness={phys.roughness}
              metalness={phys.metalness}
            />
          }
        >
          {material?.previewTextureUrl ? (
            <CountertopTextureMaterial
              url={material.previewTextureUrl}
              widthMm={W}
              depthMm={D}
              tileWidthMm={material.previewTextureTileWidthMm}
              tileLengthMm={material.previewTextureTileLengthMm}
              phys={phys}
            />
          ) : (
            <meshStandardMaterial
              color={color}
              roughness={phys.roughness}
              metalness={phys.metalness}
            />
          )}
        </Suspense>
      )}
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

/**
 * F145 — muro con huecos reales: `splitWallSegments` (dominio puro) parte el
 * muro en boxes sólidos alrededor de ventanas/puertas/pasajes, sin CSG. La
 * ventana lleva un vidrio translúcido de referencia; la puerta queda abierta.
 * `ghost` (auto-hide) baja la opacidad sin quitar el mesh de referencia.
 * Constantes compartidas (opacidad/vidrio) viven en AmbientMeshes.
 */
function WallMesh({
  wall,
  selected = false,
  paintHover = false,
  ghost = false,
  onSelect,
}: {
  readonly wall: FurnitureSceneWall;
  readonly selected?: boolean;
  readonly paintHover?: boolean;
  readonly ghost?: boolean;
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
  const segments = useMemo(
    () =>
      splitWallSegments(
        {
          id: wall.id,
          lengthMm: length,
          angleDeg: 0,
          ...(wall.openings ? { openings: wall.openings } : {}),
        },
        h,
      ),
    [wall.id, wall.openings, length, h],
  );
  const handleClick = onSelect
    ? (e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        onSelect(wall.id);
      }
    : undefined;
  const handleOver = onSelect
    ? () => {
        document.body.style.cursor = 'pointer';
      }
    : undefined;
  const handleOut = onSelect
    ? () => {
        document.body.style.cursor = '';
      }
    : undefined;
  // Workshop → Three: [x, z, y]; wall sits on floor, long axis along length.
  // Segment centers are wall-local: x from midpoint, y from h/2.
  return (
    <group position={[midX, h / 2, midY]} rotation={[0, -yaw, 0]}>
      {segments.map((seg, i) => (
        <mesh
          key={i}
          position={[
            seg.startMm + seg.lengthMm / 2 - length / 2,
            (seg.zBottomMm + seg.zTopMm) / 2 - h / 2,
            -thickness / 2,
          ]}
          userData={{ wallId: wall.id }}
          onClick={handleClick}
          onPointerOver={handleOver}
          onPointerOut={handleOut}
        >
          <boxGeometry args={[seg.lengthMm, seg.zTopMm - seg.zBottomMm, thickness]} />
          <meshStandardMaterial
            color={paintHover ? PAINT_HOVER_COLOR : WALL_DEFAULT_COLOR}
            roughness={0.9}
            metalness={0.05}
            transparent={paintHover || ghost}
            opacity={paintHover ? 0.85 : ghost ? WALL_GHOST_OPACITY : 1}
            depthWrite={!ghost}
          />
          {selected ? <Edges threshold={15} color="#3b82f6" lineWidth={2} /> : null}
        </mesh>
      ))}
      {(wall.openings ?? [])
        .filter((o) => o.kind === 'window')
        .map((o) => {
          const sill = o.sillMm ?? 900;
          const height = o.heightMm ?? 1200;
          return (
            <mesh
              key={`pane-${o.id}`}
              position={[
                o.offsetMm + o.widthMm / 2 - length / 2,
                sill + height / 2 - h / 2,
                -thickness / 2,
              ]}
              userData={{ wallId: wall.id, openingPane: true }}
            >
              <boxGeometry args={[o.widthMm, height, thickness * 0.25]} />
              <meshStandardMaterial
                color={WINDOW_PANE_COLOR}
                transparent
                opacity={ghost ? 0.04 : 0.3}
                roughness={0.15}
                metalness={0.1}
                depthWrite={false}
              />
            </mesh>
          );
        })}
    </group>
  );
}

/**
 * F145 — auto-hide de muros: rastrea la cámara y marca los muros entre ella y
 * la habitación (cálculo puro `wallsOccludingCamera`). Sólo actualiza estado
 * cuando cambia el conjunto; el coste por frame es un dot product por muro.
 */
function WallOcclusionTracker({
  walls,
  enabled,
  onOccludedChange,
}: {
  readonly walls: readonly FurnitureSceneWall[];
  readonly enabled: boolean;
  readonly onOccludedChange: (ids: ReadonlySet<string>) => void;
}): null {
  const { camera } = useThree();
  // Guard por CONTENIDO del conjunto (no por posición): la órbita sólo
  // re-renderiza cuando un muro efectivamente entra/sale del conjunto oculto.
  const lastKey = useRef<string>('');
  // F147 — el trabajo pesado sólo cuando cambia la cámara o los muros: sin
  // movimiento no se reallocan arrays/objetos por frame (era churn por useFrame).
  const lastCam = useRef({ x: Number.NaN, y: Number.NaN });
  const withAngles = useMemo(
    () =>
      walls.map((w) => ({
        ...w,
        angleDeg:
          (Math.atan2(w.endYMm - w.originYMm, w.endXMm - w.originXMm) * 180) /
          Math.PI,
      })),
    [walls],
  );
  useFrame(() => {
    if (!enabled) {
      if (lastKey.current !== '') {
        lastKey.current = '';
        lastCam.current = { x: Number.NaN, y: Number.NaN };
        onOccludedChange(new Set());
      }
      return;
    }
    const x = Math.round(camera.position.x);
    const y = Math.round(camera.position.z);
    if (
      lastKey.current !== '' &&
      x === lastCam.current.x &&
      y === lastCam.current.y
    ) {
      return;
    }
    lastCam.current = { x, y };
    const hidden = wallsOccludingCamera(withAngles, x, y);
    const key = walls
      .map((w) => (hidden.has(w.id) ? `1${w.id}` : `0${w.id}`))
      .join('|');
    if (key === lastKey.current) return;
    lastKey.current = key;
    onOccludedChange(hidden);
  });
  return null;
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
  hardwareSelectedId,
  onSelectHardwareId,
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
  draggingInvalid = false,
  hardwareCatalog,
  lightingMode = DEFAULT_SCENE_LIGHTING_MODE,
  ambientCountertop,
  paintHoverCountertop = false,
  controlsRef,
  setOrbitSuppressed,
  rawPlacementsByInstanceId,
  onUpdatePlacement,
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
  readonly onSelectModule?: (
    moduleKey: string,
    modifiers?: ModuleSelectModifiers,
  ) => void;
  /** F143 — herraje seleccionado (modo detalle). */
  readonly hardwareSelectedId?: string | null;
  readonly onSelectHardwareId?: (hardwareId: string) => void;
  readonly lightingMode?: SceneLightingMode;
  readonly ambientCountertop?: AmbientMaterial;
  readonly paintHoverCountertop?: boolean;
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
  /** When true, the selected module's ghost renders red (collision during drag). */
  readonly draggingInvalid?: boolean;
  /** Hardware catalog (id → entry) for rendering resolved placements. */
  readonly hardwareCatalog?: Readonly<Map<string, Hardware>>;
  readonly controlsRef: React.RefObject<any>;
  readonly setOrbitSuppressed: (v: boolean) => void;
  /** F131: raw placements by componentInstanceId for the 3D gizmo editor. */
  readonly rawPlacementsByInstanceId?: ReadonlyMap<string, readonly HardwarePlacement[]>;
  readonly onUpdatePlacement?: (
    componentInstanceId: string,
    index: number,
    patch: Partial<HardwarePlacement>,
  ) => void;
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
      // F147 — latencia de feedback: evento → frame pintado con el ghost movido.
      beginDragFeedbackSample();
      const rect = gl.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(floorPlane, hit)) {
        requestAnimationFrame(() => endDragFeedbackSample());
        return;
      }
      // Three (x,y,z) → workshop (x, y_plan=z)
      if (dragMode.current === 'free' && onModuleFreeMove) {
        const shiftX = planShiftMm?.x ?? 0;
        const shiftY = planShiftMm?.y ?? 0;
        onModuleFreeMove(
          mod.key,
          Math.round(hit.x - shiftX),
          Math.round(hit.z - shiftY),
        );
        requestAnimationFrame(() => endDragFeedbackSample());
        return;
      }
      if (!wallDrag || !onModuleWallOffset) {
        requestAnimationFrame(() => endDragFeedbackSample());
        return;
      }
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
      requestAnimationFrame(() => endDragFeedbackSample());
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
  // Group resolved hardware placements by the board part they attach to
  // (componentInstanceId === part id). Empty when the module carries none.
  const placementsByPartId = useMemo(() => {
    const map = new Map<string, ResolvedHardwarePlacement[]>();
    for (const p of mod.resolvedHardwarePlacements ?? []) {
      const list = map.get(p.componentInstanceId);
      if (list) list.push(p);
      else map.set(p.componentInstanceId, [p]);
    }
    return map;
  }, [mod.resolvedHardwarePlacements]);
  // Workshop → Three Y-up: [x, z, y]
  const groupPos: [number, number, number] = [
    mod.originX,
    mod.originZ,
    mod.originY,
  ];
  // Workshop → Three Y-up handedness: the module yaw must be negated to match
  // the wall meshes (rotation={[0, -yaw, 0]}). Without the negation, modules on
  // walls with yaw ≠ 0 (e.g. Muro B of an L-kitchen, yaw 90) render with their
  // depth pointing OUTSIDE the room instead of toward the interior.
  const yawRad = ((mod.yawDeg ?? 0) * Math.PI) / 180;
  const groupRot: [number, number, number] = [0, -yawRad, 0];
  const hasSelection = Boolean(selectedPartId);

  return (
    <group
      position={groupPos}
      rotation={groupRot}
      userData={{ moduleKey: mod.key }}
      onClick={
        onSelectModule
          ? (e) => {
              e.stopPropagation();
              onSelectModule(mod.key, pointerModifiers(e));
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
              onSelectModule?.(mod.key, pointerModifiers(e));
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
          invalid={draggingInvalid && moduleSelected}
        />
      ) : null}
      {(mod.baseClearanceMm ?? 0) > 0 ? (
        <PlinthMesh
          width={mod.width}
          depth={mod.depth}
          height={mod.baseClearanceMm!}
          mode={mod.baseMode ?? 'plinth_board'}
          materialId={mod.plinthMaterialId}
          hardwareColor={mod.plinthHardwareColor}
          materialColors={materialColors}
          materialTextures={materialTextures}
          thicknessMm={mod.plinthThicknessMm}
          sides={mod.plinthSides}
        />
      ) : null}
      {mod.showCountertop ? (
        <CountertopMesh
          width={mod.width}
          height={mod.height}
          depth={mod.depth}
          material={ambientCountertop}
          paintHover={paintHoverCountertop}
          lightingMode={lightingMode}
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
            hardwarePlacements={placementsByPartId.get(v.id)}
            hardwareCatalog={hardwareCatalog}
            hardwareSelectedId={hardwareSelectedId}
            onSelectHardwareId={onSelectHardwareId}
            gizmoRawPlacement={rawPlacementsByInstanceId?.get(v.id)?.[0]}
            onGizmoPlacementChange={
              onUpdatePlacement
                ? (patch) => onUpdatePlacement(v.id, 0, patch)
                : undefined
            }
          />
        );
      })}
    </group>
  );
}

type CameraViewFit = {
  /** Plan-space center (mm) of the box to frame. */
  readonly centerX: number;
  readonly centerY: number;
  /** Box height (mm, floor→top). */
  readonly heightMm: number;
  /** Largest plan span (mm) — drives the framing distance. */
  readonly spanMm: number;
};

type CameraViewType = {
  readonly type: 'front' | 'top' | 'side' | 'isometric' | 'fit-selection';
  readonly ts: number;
  /** F144 — box to frame when type is 'fit-selection' (plan mm). */
  readonly fit?: CameraViewFit;
};

/**
 * F143 — guía temporal de distancia durante el drag de un mueble: gap al
 * vecino o extremo de muro más cercano. Cálculo puro en dragGuides.ts; este
 * componente sólo dibuja la línea + etiqueta. Nada se persiste.
 */
function WallDragGuides({
  modules,
  draggedKey,
  wallDragByKey,
}: {
  readonly modules: readonly FurnitureSceneModule[];
  readonly draggedKey: string;
  readonly wallDragByKey?: FurnitureScene3DProps['wallDragByKey'];
}): ReactNode | null {
  const guide = useMemo(() => {
    const dragged = modules.find((m) => m.key === draggedKey);
    if (!dragged) return null;
    const peers = modules
      .filter((m) => m.key !== draggedKey)
      .map((m) => planBoxForModule(m));
    const frame = wallDragByKey?.[draggedKey];
    if (frame) {
      // Extremos del muro como pares sintéticos de ancho cero.
      const a = ((frame.angleDeg % 360) + 360) % 360;
      const dirX = a > 45 && a < 135 ? 0 : a >= 135 && a <= 225 ? -1 : a > 225 && a < 315 ? 0 : 1;
      const dirY = a > 45 && a < 135 ? 1 : a >= 135 && a <= 225 ? 0 : a > 225 && a < 315 ? -1 : 0;
      for (const t of [0, frame.lengthMm]) {
        const x = frame.originXMm + dirX * t;
        const y = frame.originYMm + dirY * t;
        peers.push({
          minX: x,
          maxX: x,
          minY: y - 600,
          maxY: y + 600,
        });
      }
    }
    return resolveDragGuide(planBoxForModule(dragged), peers);
  }, [modules, draggedKey, wallDragByKey]);

  const lineObject = useMemo(() => {
    if (!guide) return null;
    const geometry =
      guide.kind === 'x'
        ? new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(guide.fromX, 30, guide.atY),
            new THREE.Vector3(guide.toX, 30, guide.atY),
          ])
        : new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(guide.atX, 30, guide.fromY),
            new THREE.Vector3(guide.atX, 30, guide.toY),
          ]);
    const material = new THREE.LineBasicMaterial({
      color: 0xf5c542,
      transparent: true,
      opacity: 0.9,
    });
    return new THREE.Line(geometry, material);
  }, [guide]);

  if (!guide || !lineObject) return null;
  const mid =
    guide.kind === 'x'
      ? ([guide.fromX + (guide.toX - guide.fromX) / 2, 40, guide.atY] as const)
      : ([guide.atX, 40, guide.fromY + (guide.toY - guide.fromY) / 2] as const);
  return (
    <group>
      <primitive object={lineObject} />
      <Html position={mid} center zIndexRange={[10, 0]}>
        <span className="module-scene-3d__drag-guide-label">
          {guide.gapMm} mm
        </span>
      </Html>
    </group>
  );
}


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

    // F144 — fit-selection: frame the caller-provided box (plan mm → three
    // [x, up, z]) with the same 3/4 math as the isometric preset.
    if (cameraView.type === 'fit-selection') {
      if (!cameraView.fit) return;
      const f = cameraView.fit;
      const fitCenter: readonly [number, number, number] = [
        f.centerX,
        Math.max(f.heightMm / 2, 300),
        f.centerY,
      ];
      // Margin so the framed units don't hug the viewport edges.
      const fitDim = Math.max(f.spanMm, f.heightMm, 600) * 1.15;
      if (controlsRef.current) {
        controlsRef.current.target.set(fitCenter[0], fitCenter[1], fitCenter[2]);
      }
      const targetPos = cameraPositionForView('isometric', fitCenter, fitDim);
      camera.position.set(...targetPos);
      camera.lookAt(fitCenter[0], fitCenter[1], fitCenter[2]);
      camera.updateProjectionMatrix();
      if (controlsRef.current) {
        controlsRef.current.update();
      }
      return;
    }

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

/**
 * F147 / #312 — samplea `renderer.info` cada 30 frames (lectura barata,
 * throttled). `info.render.*` refleja el último frame; el máximo histórico
 * queda en telemetría para el gate de draw calls del smoke de performance.
 */
function ScenePerfProbe(): null {
  const gl = useThree((s) => s.gl);
  const frameCount = useRef(0);
  useFrame(() => {
    frameCount.current += 1;
    if (frameCount.current % 30 !== 0) return;
    const info = gl.info;
    recordRendererSample({
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries,
    });
  });
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
  selectedModuleKeys,
  onSelectModule,
  selectedHardwareId,
  onSelectHardware,
  showDragGuides,
  rawHardwarePlacements,
  onUpdateHardwarePlacement,
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
  keyboardNavActive = true,
  selectedWallId,
  onSelectWall,
  showFloorGrid,
  hideOccludingWalls = false,
  lightingMode = DEFAULT_SCENE_LIGHTING_MODE,
  ambientFloor,
  ambientWall,
  ambientCeiling,
  ambientCountertop,
  availableAmbientMaterials,
  showCeiling,
  paintHoverSurface = null,
  registerResolvePaintHit,
  registerResolveUnplacedHit,
  registerResolveModuleHit,
  boardPaintHoverModuleKey,
  ghostModule = null,
  ghostDropValid,
  ghostPosition = null,
  draggingInvalid = false,
  hardwareCatalog,
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
  readonly selectedModuleKeys?: readonly string[] | null;
  readonly onSelectModule?: (
    moduleKey: string | null,
    modifiers?: ModuleSelectModifiers,
  ) => void;
  readonly selectedHardwareId?: string | null;
  readonly onSelectHardware?: (hardwareId: string | null) => void;
  readonly showDragGuides?: boolean;
  readonly rawHardwarePlacements?: FurnitureScene3DProps['rawHardwarePlacements'];
  readonly onUpdateHardwarePlacement?: FurnitureScene3DProps['onUpdateHardwarePlacement'];
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
  readonly onSelectWall?: (wallId: string | null) => void;
  readonly showFloorGrid?: boolean;
  /** F145 — ghost walls between the camera and the room (auto-hide mode). */
  readonly hideOccludingWalls?: boolean;
  readonly lightingMode?: SceneLightingMode;
  readonly ambientFloor?: AmbientMaterial;
  readonly ambientWall?: AmbientMaterial;
  readonly ambientCeiling?: AmbientMaterial;
  readonly ambientCountertop?: AmbientMaterial;
  readonly availableAmbientMaterials?: readonly AmbientMaterial[];
  readonly showCeiling?: boolean;
  readonly paintHoverSurface?: PaintSurface | null;
  readonly registerResolvePaintHit?: (
    fn: ((clientX: number, clientY: number) => PaintSurface | null) | null,
  ) => void;
  /** F065 — registra el resolver de hits para ítems sin colocar. */
  readonly registerResolveUnplacedHit?: (
    fn: ((
      clientX: number,
      clientY: number,
    ) => {
      readonly wallId: string | null;
      readonly offsetMm: number;
      readonly planXMm: number;
      readonly planYMm: number;
    } | null) | null,
  ) => void;
  /** F142 — registra el resolver de hits de módulos (drag de tablero). */
  readonly registerResolveModuleHit?: (
    fn: ((clientX: number, clientY: number) => string | null) | null,
  ) => void;
  /** F142 — mueble resaltado como target del drag de tablero. */
  readonly boardPaintHoverModuleKey?: string | null;
  readonly ghostModule?: FurnitureScene3DProps['ghostModule'];
  readonly ghostDropValid?: boolean;
  readonly ghostPosition?: FurnitureScene3DProps['ghostPosition'];
  readonly draggingInvalid?: boolean;
  readonly keyboardNavActive?: boolean;
  readonly hardwareCatalog?: readonly Hardware[];
}): ReactNode {
  // Hardware id → entry lookup for resolved placements (Fase 2).
  const hardwareById = useMemo(() => {
    const map = new Map<string, Hardware>();
    for (const h of hardwareCatalog ?? []) map.set(h.id, h);
    return map;
  }, [hardwareCatalog]);
  const [orbitSuppressed, setOrbitSuppressed] = useState(false);

  // F145 — muros ocultos por la cámara (modo «ocultar muros»).
  const [occludedWallIds, setOccludedWallIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // F143 — selección múltiple: Set memoizado para highlight O(1) por módulo.
  const selectedKeySet = useMemo(() => {
    const keys = selectedModuleKeys ?? (selectedModuleKey ? [selectedModuleKey] : []);
    return new Set(keys);
  }, [selectedModuleKeys, selectedModuleKey]);

  // F143 — clave del módulo en drag activo (para las guías de distancia).
  const [activeDragKey, setActiveDragKey] = useState<string | null>(null);
  const handleWallDragStart = useCallback(
    (key: string) => {
      setActiveDragKey(key);
      onModuleWallDragStart?.(key);
    },
    [onModuleWallDragStart],
  );
  const handleWallDragEnd = useCallback(
    (key: string) => {
      setActiveDragKey(null);
      onModuleWallDragEnd?.(key);
    },
    [onModuleWallDragEnd],
  );
  const handleFreeDragStart = useCallback(
    (key: string) => {
      setActiveDragKey(key);
      onModuleFreeDragStart?.(key);
    },
    [onModuleFreeDragStart],
  );
  const handleFreeDragEnd = useCallback(
    (key: string) => {
      setActiveDragKey(null);
      onModuleFreeDragEnd?.(key);
    },
    [onModuleFreeDragEnd],
  );

  /**
   * F143 — click en vacío limpia la selección sólo si fue un click real:
   * un orbit/pan que empieza en el piso no debe perder la selección (North
   * Star §11.1). Mismo umbral de 6px que el drag de módulos.
   */
  const bgPress = useRef<{ x: number; y: number } | null>(null);
  const backgroundClickClears = (e: {
    clientX: number;
    clientY: number;
    nativeEvent?: PointerEvent | MouseEvent;
  }): boolean => {
    const mods = pointerModifiers(e);
    if (mods.shift || mods.ctrlOrMeta) return false;
    const start = bgPress.current;
    bgPress.current = null;
    if (!start) return false;
    return !isPastDragThreshold(start.x, start.y, e.clientX, e.clientY);
  };

  const { camera, gl, scene } = useThree();
  const paintRaycaster = useMemo(() => new THREE.Raycaster(), []);
  const unplacedRaycaster = useMemo(() => new THREE.Raycaster(), []);
  const paintFloorPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    [],
  );
  const paintCeilingPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, -1, 0), ROOM_WALL_HEIGHT_MM),
    [],
  );
  const unplacedFloorPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    [],
  );

  /**
   * Register the paint-hit resolver so the canvas wrapper can raycast during
   * HTML5 dragOver/drop (F067). Resolves which ambient surface (floor/wall/ceiling/countertop)
   * is under the cursor.
   */
  useEffect(() => {
    if (!registerResolvePaintHit) return;
    registerResolvePaintHit((clientX, clientY) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
      paintRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

      const floorHit = new THREE.Vector3();
      const hasFloorHit = paintRaycaster.ray.intersectPlane(paintFloorPlane, floorHit);

      const wallMeshes: THREE.Object3D[] = [];
      const ceilingMeshes: THREE.Object3D[] = [];
      const countertopMeshes: THREE.Object3D[] = [];

      scene.traverse((obj) => {
        if (obj.userData?.wallId && !obj.userData?.paintHoverOverlay) {
          wallMeshes.push(obj);
        } else if (obj.userData?.surface === 'ceiling' && !obj.userData?.paintHoverOverlay) {
          ceilingMeshes.push(obj);
        } else if (obj.userData?.countertop && !obj.userData?.paintHoverOverlay) {
          countertopMeshes.push(obj);
        }
      });

      const wallHits = wallMeshes.length > 0 ? paintRaycaster.intersectObjects(wallMeshes, false) : [];
      const ceilingHits = ceilingMeshes.length > 0 ? paintRaycaster.intersectObjects(ceilingMeshes, false) : [];
      const countertopHits = countertopMeshes.length > 0 ? paintRaycaster.intersectObjects(countertopMeshes, false) : [];

      let closestKind: 'floor' | 'wall' | 'ceiling' | 'countertop' | null = null;
      let closestWallId: string | undefined = undefined;
      let minDistance = Infinity;

      if (countertopHits.length > 0) {
        minDistance = countertopHits[0]!.distance;
        closestKind = 'countertop';
      }

      if (wallHits.length > 0 && wallHits[0]!.distance < minDistance) {
        minDistance = wallHits[0]!.distance;
        closestKind = 'wall';
        closestWallId = wallHits[0]!.object.userData.wallId as string;
      }

      if (ceilingHits.length > 0 && ceilingHits[0]!.distance < minDistance) {
        minDistance = ceilingHits[0]!.distance;
        closestKind = 'ceiling';
      }

      if (hasFloorHit) {
        const dist = floorHit.distanceTo(paintRaycaster.ray.origin);
        if (dist < minDistance) {
          minDistance = dist;
          closestKind = 'floor';
        }
      }

      if (!closestKind && showCeiling && camera.position.y < ROOM_WALL_HEIGHT_MM && paintRaycaster.ray.direction.y > 0) {
        const ceilingHit = new THREE.Vector3();
        if (paintRaycaster.ray.intersectPlane(paintCeilingPlane, ceilingHit)) {
          return { kind: 'ceiling' };
        }
      }

      if (closestKind === 'countertop') {
        return { kind: 'countertop' };
      }
      if (closestKind === 'wall' && closestWallId) {
        return { kind: 'wall', wallId: closestWallId };
      }
      if (closestKind === 'ceiling') {
        return { kind: 'ceiling' };
      }
      if (closestKind === 'floor') {
        return { kind: 'floor' };
      }
      return null;
    });
    return () => registerResolvePaintHit(null);
  }, [camera, gl, scene, paintRaycaster, paintFloorPlane, paintCeilingPlane, registerResolvePaintHit]);

  /**
   * F065 — registra el resolver de hits para ítems sin colocar.
   * Raycasts muros primero (para snap), luego piso (isla).
   */
  useEffect(() => {
    if (!registerResolveUnplacedHit) return;
    registerResolveUnplacedHit((clientX, clientY) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
      unplacedRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

      // 1) Intento snap a muro más cercano
      const wallMeshes: THREE.Object3D[] = [];
      scene.traverse((obj) => {
        if (obj.userData?.wallId && !obj.userData?.paintHoverOverlay) {
          wallMeshes.push(obj);
        }
      });

      if (wallMeshes.length > 0) {
        const wallHits = unplacedRaycaster.intersectObjects(wallMeshes, false);
        if (wallHits.length > 0) {
          const hit = wallHits[0]!;
          const wallId = hit.object.userData.wallId as string;
          // offsetMm: proyección del punto de hit sobre el eje del muro.
          // Aproximamos con la coordenada X del punto de impacto (workshop space).
          const hitPoint = hit.point;
          // Buscar la pared en walls para calcular el offset real.
          const wall = walls.find((w) => w.id === wallId);
          let offsetMm = 0;
          if (wall) {
            const dx = wall.endXMm - wall.originXMm;
            const dy = wall.endYMm - wall.originYMm;
            const len = Math.max(1, Math.hypot(dx, dy));
            const ux = dx / len;
            const uy = dy / len;
            // Vector desde origin del muro al hit (Three X,Z → plan X,Y)
            const px = hitPoint.x - wall.originXMm;
            const py = hitPoint.z - wall.originYMm;
            offsetMm = Math.max(0, Math.min(len, px * ux + py * uy));
          }
          return {
            wallId,
            offsetMm,
            planXMm: hitPoint.x,
            planYMm: hitPoint.z,
          };
        }
      }

      // 2) Drop en piso (isla)
      const floorHit = new THREE.Vector3();
      if (unplacedRaycaster.ray.intersectPlane(unplacedFloorPlane, floorHit)) {
        const shiftX = (planShiftMm?.x ?? 0);
        const shiftY = (planShiftMm?.y ?? 0);
        return {
          wallId: null,
          offsetMm: 0,
          planXMm: Math.round(floorHit.x - shiftX),
          planYMm: Math.round(floorHit.z - shiftY),
        };
      }

      return null;
    });
    return () => registerResolveUnplacedHit(null);
  }, [
    camera,
    gl,
    scene,
    walls,
    planShiftMm,
    unplacedRaycaster,
    unplacedFloorPlane,
    registerResolveUnplacedHit,
  ]);

  /**
   * F142 — registra el resolver de hits de módulos: raycasta los meshes y
   * delega en resolveBoardPaintTarget (hit más cercano; mesada bloqueada).
   * Un drag de tablero sólo puede aplicar a un mueble; fuera de muebles
   * devuelve null.
   */
  useEffect(() => {
    if (!registerResolveModuleHit) return;
    registerResolveModuleHit((clientX, clientY) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
      unplacedRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const meshes: THREE.Object3D[] = [];
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh && !obj.userData?.paintHoverOverlay) {
          meshes.push(obj);
        }
      });
      const hits = unplacedRaycaster.intersectObjects(meshes, false);
      return resolveBoardPaintTarget(hits);
    });
    return () => registerResolveModuleHit(null);
  }, [camera, gl, scene, unplacedRaycaster, registerResolveModuleHit]);

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
  const ambientPlan = useMemo(
    () =>
      planAmbientScene({
        lightMode,
        ambientFloor,
        ambientWall,
        ambientCeiling,
        showCeiling,
        showFloor,
      }),
    [lightMode, ambientFloor, ambientWall, ambientCeiling, showCeiling, showFloor],
  );
  // Room-box geometry derives from the floor-plane bounds + 2400mm height
  // (design #4151). Back wall spans the plane width at the back depth edge.
  const backWallWidth = totalWidth * 1.4;
  const backWallZ = framing.center[2] + (totalDepth * 1.6) / 2;
  const ceilingY = ROOM_WALL_HEIGHT_MM;
  const ceilingZ = framing.center[2];
  const ceilingX = framing.center[0];

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
          onPointerDown={(e) => {
            bgPress.current = { x: e.clientX, y: e.clientY };
          }}
          onClick={
            onSelectModule
              ? (e) => {
                  if (!backgroundClickClears(e)) return;
                  onSelectModule(null);
                }
              : undefined
          }
        >
          {showAxes ? (
            <axesHelper args={[framing.maxDim * 0.75]} />
          ) : null}
          {showFloor ? (
            ambientPlan.ambientFloor && ambientFloor ? (
              <FloorAmbientMesh
                material={ambientFloor}
                widthMm={totalWidth}
                depthMm={totalDepth}
                position={[framing.center[0], -1, framing.center[2]]}
                lightingMode={lightMode}
                paintHover={paintHoverSurface?.kind === 'floor'}
                onClick={(
                  e?: {
                    clientX: number;
                    clientY: number;
                    nativeEvent?: PointerEvent | MouseEvent;
                  },
                ) => {
                  if (!e || !backgroundClickClears(e)) return;
                  onSelectModule?.(null);
                  onSelectWall?.(null);
                  onSelectPart?.(null as any);
                }}
              />
            ) : (
              <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[framing.center[0], -1, framing.center[2]]}
                receiveShadow
                onClick={(e) => {
                  e.stopPropagation();
                  if (!backgroundClickClears(e)) return;
                  onSelectModule?.(null);
                  onSelectWall?.(null);
                  onSelectPart?.(null as any);
                }}
              >
                <planeGeometry
                  args={[totalWidth * 1.4, totalDepth * 1.6]}
                />
                <meshStandardMaterial
                  color={
                    paintHoverSurface?.kind === 'floor'
                      ? PAINT_HOVER_COLOR
                      : FLOOR_DEFAULT_COLOR
                  }
                  roughness={0.95}
                  metalness={0}
                />
              </mesh>
            )
          ) : null}
          {showFloor && showFloorGrid ? (
            <FloorGrid totalWidth={totalWidth} totalDepth={totalDepth} />
          ) : null}
          <WallOcclusionTracker
            walls={walls}
            enabled={hideOccludingWalls}
            onOccludedChange={setOccludedWallIds}
          />
          {walls.map((w) => {
            const wMat =
              (w.wallMaterialId
                ? availableAmbientMaterials?.find(
                    (m) => m.id === w.wallMaterialId,
                  )
                : undefined) ?? ambientWall;
            const ghost = hideOccludingWalls && occludedWallIds.has(w.id);

            return wMat ? (
              <WallAmbientMesh
                key={w.id}
                material={wMat}
                wall={w}
                selected={selectedWallId === w.id}
                onSelect={onSelectWall}
                lightingMode={lightMode}
                ghost={ghost}
                paintHover={
                  paintHoverSurface?.kind === 'wall' &&
                  paintHoverSurface.wallId === w.id
                }
              />
            ) : (
              <WallMesh
                key={w.id}
                wall={w}
                selected={selectedWallId === w.id}
                ghost={ghost}
                paintHover={
                  paintHoverSurface?.kind === 'wall' &&
                  paintHoverSurface.wallId === w.id
                }
                onSelect={onSelectWall}
              />
            );
          })}
          {modules.map((mod) => (
            <ModuleGroup
              key={mod.key}
              mod={mod}
              rawPlacementsByInstanceId={rawHardwarePlacements}
              onUpdatePlacement={onUpdateHardwarePlacement}
              colorMode={colorMode}
              materialColors={materialColors}
              materialTextures={materialTextures}
              surfaceMode={surfaceMode}
              showWireframe={showWireframe}
              showOutlines={showOutlines}
              selectedPartId={selectedPartId}
              isolateSelected={isolateSelected}
              onSelectPart={onSelectPart}
              moduleSelected={
                selectedKeySet.has(mod.key) ||
                boardPaintHoverModuleKey === mod.key
              }
              onSelectModule={onSelectModule}
              hardwareSelectedId={selectedHardwareId}
              onSelectHardwareId={
                onSelectHardware
                  ? (id) => onSelectHardware(id)
                  : undefined
              }
              wallDrag={wallDragByKey?.[mod.key]}
              wallDragEnabled={wallDragEnabled}
              onModuleWallOffset={onModuleWallOffset}
              onModuleWallDragStart={handleWallDragStart}
              onModuleWallDragEnd={handleWallDragEnd}
              freeDrag={Boolean(freeDragByKey?.[mod.key])}
              planShiftMm={planShiftMm}
              onModuleFreeMove={onModuleFreeMove}
              onModuleFreeDragStart={handleFreeDragStart}
              onModuleFreeDragEnd={handleFreeDragEnd}
              draggingInvalid={draggingInvalid}
              lightingMode={lightMode}
              ambientCountertop={ambientCountertop}
              paintHoverCountertop={paintHoverSurface?.kind === 'countertop'}
              hardwareCatalog={hardwareById}
              controlsRef={controlsRef}
              setOrbitSuppressed={setOrbitSuppressed}
            />
          ))}
          {/* F143 — guía temporal de distancia durante el drag (capa efímera). */}
          {showDragGuides && activeDragKey ? (
            <WallDragGuides
              modules={modules}
              draggedKey={activeDragKey}
              wallDragByKey={wallDragByKey}
            />
          ) : null}
          {/* Ambient room box: back wall + per-wall baseboards + optional
              ceiling. Only when an ambient material is present and not in
              catalog mode (spec #4149 room box + lighting gating). */}
          {ambientPlan.roomBox ? (
            <>
              <BackWallMesh
                material={ambientWall}
                widthMm={backWallWidth}
                position={[framing.center[0], ROOM_WALL_HEIGHT_MM / 2, backWallZ]}
                lightingMode={lightMode}
              />
              {walls.map((w) => {
                const wdx = w.endXMm - w.originXMm;
                const wdy = w.endYMm - w.originYMm;
                const wlen = Math.max(1, Math.hypot(wdx, wdy));
                const wmidX = (w.originXMm + w.endXMm) / 2;
                const wmidY = (w.originYMm + w.endYMm) / 2;
                const wyaw = Math.atan2(wdy, wdx);
                return (
                  <BaseboardMesh
                    key={`baseboard-${w.id}`}
                    material={ambientWall}
                    lengthMm={wlen}
                    position={[wmidX, 50, wmidY]}
                    rotationY={-wyaw}
                  />
                );
              })}
            </>
          ) : null}
          {ambientPlan.ceiling ? (
            <CeilingMesh
              material={ambientCeiling}
              widthMm={totalWidth * 1.4}
              depthMm={totalDepth * 1.6}
              position={[ceilingX, ceilingY, ceilingZ]}
              lightingMode={lightMode}
              paintHover={paintHoverSurface?.kind === 'ceiling'}
            />
          ) : null}
          {/* F065 — ghost del ítem siendo arrastrado al viewport */}
          {ghostModule && ghostPosition ? (
            <GhostModuleMesh
              width={ghostModule.widthMm}
              height={ghostModule.heightMm}
              depth={ghostModule.depthMm}
              position={[ghostPosition.x, ghostPosition.y, ghostPosition.z]}
              valid={ghostDropValid}
            />
          ) : null}
        </group>
        <CameraViewSetter
          cameraView={cameraView}
          center={framing.center}
          maxDim={framing.maxDim}
          controlsRef={controlsRef}
        />
      </Bounds>

      {/* Soft ground disk under the unit. Catalog product stills omit it so
          the still is furniture-on-studio-backdrop only (no gray floor band).
          Opacity/color adapt to the floor luminance when an ambient floor is
          present (spec #4149 ContactShadows tuning); absent → 0.32 default. */}
      {ambientPlan.contactShadow ? (
        <ContactShadows
          position={[framing.center[0], 0.5, framing.center[2]]}
          opacity={ambientPlan.contactShadow.opacity}
          color={ambientPlan.contactShadow.color}
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
        active={keyboardNavActive}
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
  rawHardwarePlacements,
  onUpdateHardwarePlacement,
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
  selectedModuleKeys = null,
  onSelectModule,
  selectedHardwareId = null,
  onSelectHardware,
  showDragGuides = false,
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
  keyboardNavActive = true,
  selectedWallId = null,
  onSelectWall,
  showFloorGrid = false,
  hideOccludingWalls = false,
  lightingMode = DEFAULT_SCENE_LIGHTING_MODE,
  ambientFloor,
  ambientWall,
  ambientCeiling,
  ambientCountertop,
  availableAmbientMaterials,
  showCeiling,
  onPaintDrop,
  onPaintHover,
  paintHoverSurface = null,
  ghostModule = null,
  ghostDropValid,
  ghostPosition = null,
  draggingInvalid = false,
  hardwareCatalog,
  onUnplacedDrop,
  onUnplacedHover,
  onBoardPaintDrop,
  onBoardPaintHover,
  boardPaintHoverModuleKey = null,
}: FurnitureScene3DProps): ReactNode {
  const controlsRef = useRef<any>(null);
  /**
   * Ref registrado por SceneContent (que has useThree access). Holds a
   * function that, given client coords, raycasts the scene and returns the
   * paint surface hit (floor/wall) or null. The canvas wrapper calls this on
   * HTML5 dragOver/drop — bridges the DOM drag event into the R3F world.
   */
  const resolvePaintHitRef = useRef<
    ((clientX: number, clientY: number) => PaintSurface | null) | null
  >(null);
  /**
   * F065 — resolver de hits para ítems sin colocar. Registrado por SceneContent.
   */
  const resolveModuleHitRef = useRef<
    ((clientX: number, clientY: number) => string | null) | null
  >(null);
  const resolveUnplacedHitRef = useRef<
    ((
      clientX: number,
      clientY: number,
    ) => {
      readonly wallId: string | null;
      readonly offsetMm: number;
      readonly planXMm: number;
      readonly planYMm: number;
    } | null) | null
  >(null);
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
        onDragEnter={
          (onPaintHover || onUnplacedHover || onBoardPaintHover)
            ? (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }
            : undefined
        }
        onDragOver={
          (onPaintHover || onUnplacedHover || onBoardPaintHover)
            ? (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                // F142: drag de tablero → hover del mueble target
                if (onBoardPaintHover) {
                  if (e.dataTransfer.types.includes(BOARD_PAINT_DRAG_MIME)) {
                    onBoardPaintHover(
                      resolveModuleHitRef.current?.(e.clientX, e.clientY) ??
                        null,
                    );
                    return;
                  }
                  onBoardPaintHover(null);
                }
                // F065: ítem sin colocar · F141: tarjeta de biblioteca
                if (onUnplacedHover) {
                  const isModuleDrag =
                    e.dataTransfer.types.includes(UNPLACED_DRAG_MIME) ||
                    e.dataTransfer.types.includes(LIBRARY_DRAG_MIME);
                  if (isModuleDrag) {
                    const hit = resolveUnplacedHitRef.current?.(e.clientX, e.clientY) ?? null;
                    onUnplacedHover(hit);
                    return;
                  }
                }
                // F067: material de superficie
                if (onPaintHover) {
                  const surface = resolvePaintHitRef.current?.(
                    e.clientX,
                    e.clientY,
                  );
                  onPaintHover(surface ?? null);
                }
              }
            : undefined
        }
        onDragLeave={
          (onPaintHover || onUnplacedHover || onBoardPaintHover)
            ? (e) => {
                if (e.currentTarget === e.target) {
                  onPaintHover?.(null);
                  onUnplacedHover?.(null);
                  onBoardPaintHover?.(null);
                }
              }
            : undefined
        }
        onDrop={
          (onPaintDrop || onUnplacedDrop || onBoardPaintDrop)
            ? (e) => {
                e.preventDefault();

                // F142: drop de tablero — sólo aplica a muebles; el studio
                // rechaza con feedback que enseña cuando moduleKey es null.
                const rawBoard = e.dataTransfer.getData(BOARD_PAINT_DRAG_MIME);
                if (rawBoard && onBoardPaintDrop) {
                  const payload = decodeBoardPaintDrag(rawBoard);
                  if (payload) {
                    onBoardPaintDrop({
                      moduleKey:
                        resolveModuleHitRef.current?.(e.clientX, e.clientY) ??
                        null,
                      materialId: payload.materialId,
                    });
                  }
                  onBoardPaintHover?.(null);
                  if (onUnplacedHover) onUnplacedHover(null);
                  return;
                }

                // F065: drop de ítem sin colocar · F141: drop de biblioteca.
                // El studio distingue la fuente por su estado ghost interno.
                const rawUnplaced =
                  e.dataTransfer.getData(UNPLACED_DRAG_MIME) ||
                  e.dataTransfer.getData(LIBRARY_DRAG_MIME);
                if (rawUnplaced && onUnplacedDrop) {
                  const hit =
                    resolveUnplacedHitRef.current?.(e.clientX, e.clientY) ?? null;
                  if (hit) {
                    onUnplacedDrop(hit);
                  }
                  if (onUnplacedHover) onUnplacedHover(null);
                  if (onPaintHover) onPaintHover(null);
                  return;
                }

                // F067: drop de material de superficie
                if (onPaintDrop) {
                  const rawMime = e.dataTransfer.getData(PAINT_DRAG_MIME);
                  const rawText = e.dataTransfer.getData('text/plain');
                  const payload = decodePaintDrag(rawMime || rawText);
                  const surface = resolvePaintHitRef.current?.(e.clientX, e.clientY);

                  if (payload && surface) {
                    onPaintDrop({ materialId: payload.materialId, surface });
                  } else if (rawText && surface) {
                    onPaintDrop({ materialId: rawText, surface });
                  } else {
                    onPaintDrop(null);
                  }
                  if (onPaintHover) onPaintHover(null);
                }
              }
            : undefined
        }
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
          <Suspense
            fallback={
              <div className="module-scene-3d__loading" role="status" aria-label="Cargando vista 3D">
                <div className="module-scene-3d__loading-spinner" />
                <p className="module-scene-3d__loading-text">
                  Cargando escena 3D…
                </p>
              </div>
            }
          >
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
                  onSelectPart?.(null as any);
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
              <ScenePerfProbe />
              <Suspense fallback={null}>
                <SceneContent
                  rawHardwarePlacements={rawHardwarePlacements}
                  onUpdateHardwarePlacement={onUpdateHardwarePlacement}
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
                  selectedModuleKeys={selectedModuleKeys}
                  onSelectModule={
                    selectionEnabled && onSelectModule
                      ? onSelectModule
                      : undefined
                  }
                  selectedHardwareId={selectedHardwareId}
                  onSelectHardware={
                    selectionEnabled && onSelectHardware
                      ? onSelectHardware
                      : undefined
                  }
                  showDragGuides={showDragGuides}
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
                  keyboardNavActive={keyboardNavActive}
                  selectedWallId={selectedWallId}
                  onSelectWall={onSelectWall}
                  showFloorGrid={showFloorGrid}
                  hideOccludingWalls={hideOccludingWalls}
                  lightingMode={lightingMode}
                  ambientFloor={ambientFloor}
                  ambientWall={ambientWall}
                  ambientCeiling={ambientCeiling}
                  ambientCountertop={ambientCountertop}
                  availableAmbientMaterials={availableAmbientMaterials}
                  showCeiling={showCeiling}
                  paintHoverSurface={paintHoverSurface}
                  registerResolvePaintHit={
                    onPaintDrop || onPaintHover
                      ? (fn) => {
                          resolvePaintHitRef.current = fn;
                        }
                      : undefined
                  }
                  registerResolveUnplacedHit={
                    onUnplacedDrop || onUnplacedHover
                      ? (fn) => {
                          resolveUnplacedHitRef.current = fn;
                        }
                      : undefined
                  }
                  registerResolveModuleHit={
                    onBoardPaintDrop || onBoardPaintHover
                      ? (fn) => {
                          resolveModuleHitRef.current = fn;
                        }
                      : undefined
                  }
                  boardPaintHoverModuleKey={boardPaintHoverModuleKey}
                  ghostModule={ghostModule}
                  ghostDropValid={ghostDropValid}
                  ghostPosition={ghostPosition}
                  draggingInvalid={draggingInvalid}
                  hardwareCatalog={hardwareCatalog}
                />
              </Suspense>
            </Canvas>
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
