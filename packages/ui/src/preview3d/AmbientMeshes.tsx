/**
 * Ambient (floor/wall/ceiling/baseboard) meshes for the 3D room scene, plus the
 * pure decision layer consumed by FurnitureScene3D.
 *
 * Spec #4149 (Ambient Scene Rendering), design #4151 (3D Scene Design).
 *
 * Two layers:
 *  - PURE helpers (planAmbientScene / resolveFloorColor / resolveWallColor /
 *    resolveFloorPhysical / resolveWallPhysical): the FurnitureScene3D wiring
 *    decision + material resolution. No three import → fully unit-testable in
 *    jsdom. These encode the spec acceptance criteria (catalog gating,
 *    backward-compat defaults, ceiling default-off, room-box gating).
 *  - R3F mesh components (Floor/Wall/BackWall/Ceiling/Baseboard): thin wrappers
 *    over drei `useTexture` + the ambient UV fns from ambientUvRepeat.ts.
 *    Mirrors BoardMeshMaterial.tsx's pattern. Rendering needs WebGL; jsdom-safe
 *    callers mock the viewer (repo convention).
 */

import { Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { Edges, useTexture } from '@react-three/drei';
import { DoubleSide, RepeatWrapping, SRGBColorSpace } from 'three';
import { splitWallSegments, type AmbientMaterial } from '@muebles/domain';
import { boardPhysicalResponse, type SceneLightingMode } from './sceneLighting';
import {
  contactShadowForFloor,
  floorPlaneUvRepeat,
  wallBoxUvRepeat,
} from './ambientUvRepeat';
import type { FurnitureSceneWall } from './FurnitureScene3D';

// ---------------------------------------------------------------------------
// Constants — verified against FurnitureScene3D.tsx (design #4151).
// ---------------------------------------------------------------------------

/** Default floor color when no ambient material — neutral warm gray (avoids light bounce from pure white). */
export const FLOOR_DEFAULT_COLOR = '#f0eeeb';
/** Default wall color when no ambient material — neutral warm gray (avoids light bounce from pure white). */
export const WALL_DEFAULT_COLOR = '#f0eeeb';
/** Clean white ceiling paint when no ambient material assigned. */
export const CEILING_DEFAULT_COLOR = '#ffffff';
/** Paint drag hover overlay (F067). Green signals "drop here to apply". */
export const PAINT_HOVER_COLOR = '#4ade80';
export const PAINT_HOVER_OPACITY = 0.3;
/** Standard kitchen wall height (mm). Mirrors WallMesh default. */
export const ROOM_WALL_HEIGHT_MM = 2400;
/** F145 — ghost opacity for camera-occluded walls («ocultar muros»). */
export const WALL_GHOST_OPACITY = 0.12;
/** F145 — translucent pane fill for window openings (visual reference only). */
export const WINDOW_PANE_COLOR = '#bcd7e8';
/** Baseboard strip geometry (mm). Design #4151 Q2 (real thin geometry). */
export const BASEBOARD_HEIGHT_MM = 100;
export const BASEBOARD_THICKNESS_MM = 20;
/** Floor plane multipliers — mirror FurnitureScene3D planeGeometry args. */
const FLOOR_WIDTH_FACTOR = 1.4;
const FLOOR_DEPTH_FACTOR = 1.6;

// ---------------------------------------------------------------------------
// PURE decision layer (no three import — jsdom unit-tested).
// ---------------------------------------------------------------------------

/**
 * Resolved ambient rendering plan for one scene frame. FurnitureScene3D reads
 * these booleans to decide which meshes to mount (vs the hardcoded fallbacks).
 */
export type AmbientScenePlan = {
  /** Render FloorAmbientMesh (vs the default-color fallback floor). */
  readonly ambientFloor: boolean;
  /** Render WallAmbientMesh per wall (vs the default-color fallback walls). */
  readonly ambientWall: boolean;
  /** Render the room box (BackWallMesh + BaseboardMeshes). */
  readonly roomBox: boolean;
  /** Render CeilingMesh (only when roomBox && showCeiling). */
  readonly ceiling: boolean;
  /** ContactShadows opacity/color, or null to omit (catalog mode). */
  readonly contactShadow: {
    readonly opacity: number;
    readonly color: string;
  } | null;
};

/**
 * Decide which ambient meshes ContactShadows to render for a scene frame.
 * Pure — the FurnitureScene3D wiring logic, extracted so it is jsdom-testable.
 *
 * Gating (spec #4149):
 *  - catalog mode → nothing ambient, no room box, ContactShadows omitted.
 *  - present/workshop/soft → ambient + room box when materials are provided.
 *  - ceiling is opt-in (showCeiling); default OFF.
 *  - no ambient material → all false (backward-compat: hardcoded scene).
 */
export function planAmbientScene(opts: {
  readonly lightMode: SceneLightingMode;
  readonly ambientFloor?: AmbientMaterial;
  readonly ambientWall?: AmbientMaterial;
  readonly ambientCeiling?: AmbientMaterial;
  readonly showCeiling?: boolean;
  readonly showFloor?: boolean;
}): AmbientScenePlan {
  const {
    lightMode,
    ambientFloor,
    ambientWall,
    ambientCeiling,
    showCeiling,
    showFloor = true,
  } = opts;
  const isAmbientMode = lightMode !== 'catalog';
  return {
    ambientFloor: isAmbientMode && Boolean(ambientFloor) && showFloor,
    ambientWall: isAmbientMode && Boolean(ambientWall),
    roomBox: isAmbientMode && Boolean(ambientWall),
    ceiling: isAmbientMode && (Boolean(showCeiling) || Boolean(ambientCeiling)),
    contactShadow: isAmbientMode
      ? contactShadowForFloor(ambientFloor?.previewColor)
      : null,
  };
}

/** Floor base color — material previewColor or the white default. */
export function resolveFloorColor(material?: AmbientMaterial): string {
  return material?.previewColor ?? FLOOR_DEFAULT_COLOR;
}

/** Wall base color — material previewColor or the white default. */
export function resolveWallColor(material?: AmbientMaterial): string {
  return material?.previewColor ?? WALL_DEFAULT_COLOR;
}

export type AmbientPhysical = {
  readonly roughness: number;
  readonly metalness: number;
  readonly clearcoat: number;
  readonly clearcoatRoughness: number;
  readonly envMapIntensity: number;
};

/**
 * Floor PBR: explicit material overrides (previewRoughness/Metalness/Clearcoat)
 * win; the rest falls back to the mode-adaptive boardPhysicalResponse
 * (design #4151 Q4 — fixed PBR via existing resolver).
 */
export function resolveFloorPhysical(
  material?: AmbientMaterial,
  lightingMode: SceneLightingMode = 'present',
): AmbientPhysical {
  return resolveAmbientPhysical(material, lightingMode);
}

/** Wall PBR — mirrors floor resolution. */
export function resolveWallPhysical(
  material?: AmbientMaterial,
  lightingMode: SceneLightingMode = 'present',
): AmbientPhysical {
  return resolveAmbientPhysical(material, lightingMode);
}

/** Countertop PBR — mirrors ambient resolution. */
export function resolveCountertopPhysical(
  material?: AmbientMaterial,
  lightingMode: SceneLightingMode = 'present',
): AmbientPhysical {
  return resolveAmbientPhysical(material, lightingMode);
}

function resolveAmbientPhysical(
  material: AmbientMaterial | undefined,
  lightingMode: SceneLightingMode,
): AmbientPhysical {
  const base = boardPhysicalResponse({
    hasMap: Boolean(material?.previewTextureUrl),
    hasGrain: false,
    lightingMode,
  });
  return {
    roughness: material?.previewRoughness ?? base.roughness,
    metalness: material?.previewMetalness ?? base.metalness,
    clearcoat: material?.previewClearcoat ?? base.clearcoat,
    clearcoatRoughness: base.clearcoatRoughness,
    envMapIntensity: base.envMapIntensity,
  };
}

// ---------------------------------------------------------------------------
// R3F mesh components (need WebGL; jsdom callers mock the viewer).
// ---------------------------------------------------------------------------

type Vec3 = readonly [number, number, number];

function applyRepeat(
  map: { wrapS: number; wrapT: number; repeat: { set: (u: number, v: number) => void }; colorSpace: string; anisotropy: number; needsUpdate: boolean },
  u: number,
  v: number,
): void {
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  map.repeat.set(u, v);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  map.needsUpdate = true;
}

/** Textured floor surface (photo material + ambient UV repeat). */
function FloorTextureMaterial({
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
  readonly phys: AmbientPhysical;
}): ReactNode {
  const map = useTexture(url);
  useEffect(() => {
    const [u, v] = floorPlaneUvRepeat(widthMm, depthMm, tileWidthMm, tileLengthMm);
    applyRepeat(map, u, v);
  }, [map, widthMm, depthMm, tileWidthMm, tileLengthMm]);
  return (
    <meshPhysicalMaterial
      map={map}
      // White so the photo shows true colors (map * color).
      color="#ffffff"
      roughness={phys.roughness}
      metalness={phys.metalness}
      clearcoat={phys.clearcoat}
      clearcoatRoughness={phys.clearcoatRoughness}
      envMapIntensity={phys.envMapIntensity}
    />
  );
}

/**
 * Ambient floor mesh. Renders a horizontal plane sized like the existing floor
 * (totalWidth*1.4 × totalDepth*1.6), textured or solid per the material.
 */
export function FloorAmbientMesh({
  material,
  widthMm,
  depthMm,
  position,
  lightingMode = 'present',
  paintHover = false,
  onClick,
}: {
  readonly material: AmbientMaterial;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly position?: Vec3;
  readonly lightingMode?: SceneLightingMode;
  readonly paintHover?: boolean;
  /** F143 — recibe el evento para distinguir click real de orbit/pan. */
  readonly onClick?: (e?: {
    clientX: number;
    clientY: number;
    nativeEvent?: PointerEvent | MouseEvent;
  }) => void;
}): ReactNode {
  const color = resolveFloorColor(material);
  const phys = resolveFloorPhysical(material, lightingMode);
  const pos: Vec3 = position ?? [0, 0, 0];
  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[pos[0], pos[1], pos[2]]}
        receiveShadow
        userData={{ surface: 'floor' }}
        onClick={
          onClick
            ? (e) => {
                e.stopPropagation();
                onClick(e);
              }
            : undefined
        }
      >
        <planeGeometry
          args={[widthMm * FLOOR_WIDTH_FACTOR, depthMm * FLOOR_DEPTH_FACTOR]}
        />
        <Suspense
          fallback={
            <meshStandardMaterial
              color={color}
              roughness={phys.roughness}
              metalness={phys.metalness}
            />
          }
        >
          {material.previewTextureUrl ? (
            <FloorTextureMaterial
              url={material.previewTextureUrl}
              widthMm={widthMm}
              depthMm={depthMm}
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
      </mesh>
      {paintHover ? (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[pos[0], pos[1] + 1, pos[2]]}
          userData={{ surface: 'floor', paintHoverOverlay: true }}
        >
          <planeGeometry
            args={[widthMm * FLOOR_WIDTH_FACTOR, depthMm * FLOOR_DEPTH_FACTOR]}
          />
          <meshStandardMaterial
            color={PAINT_HOVER_COLOR}
            transparent
            opacity={PAINT_HOVER_OPACITY}
            emissive={PAINT_HOVER_COLOR}
            emissiveIntensity={0.4}
          />
        </mesh>
      ) : null}
    </>
  );
}

/** Textured wall surface (photo material + per-face box UV repeat). */
function WallTextureMaterial({
  url,
  lengthMm,
  heightMm,
  tileWidthMm,
  tileLengthMm,
  phys,
  selected = false,
  ghost = false,
}: {
  readonly url: string;
  readonly lengthMm: number;
  readonly heightMm: number;
  readonly tileWidthMm?: number;
  readonly tileLengthMm?: number;
  readonly phys: AmbientPhysical;
  readonly selected?: boolean;
  readonly ghost?: boolean;
}): ReactNode {
  const map = useTexture(url);
  useEffect(() => {
    const [u, v] = wallBoxUvRepeat(lengthMm, heightMm, tileWidthMm, tileLengthMm);
    applyRepeat(map, u, v);
  }, [map, lengthMm, heightMm, tileWidthMm, tileLengthMm]);
  return (
    <meshPhysicalMaterial
      map={map}
      color="#ffffff"
      roughness={phys.roughness}
      metalness={phys.metalness}
      clearcoat={phys.clearcoat}
      clearcoatRoughness={phys.clearcoatRoughness}
      envMapIntensity={phys.envMapIntensity}
      emissive={selected ? '#5b9fd4' : '#000000'}
      emissiveIntensity={selected ? 0.35 : 0}
      transparent={ghost}
      opacity={ghost ? WALL_GHOST_OPACITY : 1}
      depthWrite={!ghost}
    />
  );
}

/**
 * Ambient wall mesh. Mirrors the WallMesh geometry convention (workshop→Three
 * [x,z,y] transform). F145: renders per solid segment via `splitWallSegments`
 * so openings are real holes; windows get a translucent reference pane.
 * Selected highlight is preserved (blue emissive tint); `ghost` fades the wall
 * when auto-hidden by the camera.
 */
export function WallAmbientMesh({
  material,
  wall,
  selected = false,
  onSelect,
  lightingMode = 'present',
  ghost = false,
  paintHover = false,
}: {
  readonly material: AmbientMaterial;
  readonly wall: FurnitureSceneWall;
  readonly selected?: boolean;
  readonly onSelect?: (wallId: string) => void;
  readonly lightingMode?: SceneLightingMode;
  /** F145 — auto-hidden by camera (ghost opacity instead of removal). */
  readonly ghost?: boolean;
  readonly paintHover?: boolean;
}): ReactNode {
  const h = wall.heightMm ?? ROOM_WALL_HEIGHT_MM;
  const dx = wall.endXMm - wall.originXMm;
  const dy = wall.endYMm - wall.originYMm;
  const length = Math.max(1, Math.hypot(dx, dy));
  const midX = (wall.originXMm + wall.endXMm) / 2;
  const midY = (wall.originYMm + wall.endYMm) / 2;
  const yaw = Math.atan2(dy, dx);
  const thickness = selected ? 48 : 40;
  const color = resolveWallColor(material);
  const phys = resolveWallPhysical(material, lightingMode);
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
        if (typeof document !== 'undefined') {
          document.body.style.cursor = 'pointer';
        }
      }
    : undefined;
  const handleOut = onSelect
    ? () => {
        if (typeof document !== 'undefined') {
          document.body.style.cursor = '';
        }
      }
    : undefined;
  return (
    <group position={[midX, h / 2, midY]} rotation={[0, -yaw, 0]}>
      {segments.map((seg, i) => {
        const segH = seg.zTopMm - seg.zBottomMm;
        return (
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
            <boxGeometry args={[seg.lengthMm, segH, thickness]} />
            {selected ? <Edges threshold={15} color="#3b82f6" lineWidth={2} /> : null}
            <Suspense
              fallback={
                <meshStandardMaterial
                  color={color}
                  roughness={phys.roughness}
                  metalness={phys.metalness}
                  transparent={ghost}
                  opacity={ghost ? WALL_GHOST_OPACITY : 1}
                  depthWrite={!ghost}
                />
              }
            >
              {material.previewTextureUrl ? (
                <WallTextureMaterial
                  url={material.previewTextureUrl}
                  lengthMm={seg.lengthMm}
                  heightMm={segH}
                  tileWidthMm={material.previewTextureTileWidthMm}
                  tileLengthMm={material.previewTextureTileLengthMm}
                  phys={phys}
                  selected={selected}
                  ghost={ghost}
                />
              ) : (
                <meshStandardMaterial
                  color={color}
                  roughness={phys.roughness}
                  metalness={phys.metalness}
                  transparent={ghost}
                  opacity={ghost ? WALL_GHOST_OPACITY : 1}
                  depthWrite={!ghost}
                />
              )}
            </Suspense>
          </mesh>
        );
      })}
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
      {paintHover ? (
        <mesh
          position={[0, 0, -thickness / 2]}
          userData={{ wallId: wall.id, paintHoverOverlay: true }}
        >
          <boxGeometry args={[length + 1, h + 1, thickness + 2]} />
          <meshStandardMaterial
            color={PAINT_HOVER_COLOR}
            transparent
            opacity={PAINT_HOVER_OPACITY}
            emissive={PAINT_HOVER_COLOR}
            emissiveIntensity={0.4}
          />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * Back wall closing the room behind the layout. A box across the layout width
 * axis at the furthest depth edge, height 2400mm (design #4151 room box).
 */
export function BackWallMesh({
  material,
  widthMm,
  heightMm = ROOM_WALL_HEIGHT_MM,
  position,
  thicknessMm = 40,
  lightingMode = 'present',
}: {
  readonly material?: AmbientMaterial;
  readonly widthMm: number;
  readonly heightMm?: number;
  readonly position: Vec3;
  readonly thicknessMm?: number;
  readonly lightingMode?: SceneLightingMode;
}): ReactNode {
  const color = resolveWallColor(material);
  const phys = resolveWallPhysical(material, lightingMode);
  return (
    <mesh position={[position[0], position[1], position[2]]}>
      <boxGeometry args={[widthMm, heightMm, thicknessMm]} />
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
          <WallTextureMaterial
            url={material.previewTextureUrl}
            lengthMm={widthMm}
            heightMm={heightMm}
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
    </mesh>
  );
}

/**
 * Optional ceiling plane. Only mounted when the caller (FurnitureScene3D)
 * passes showCeiling — this component just renders when mounted.
 */
export function CeilingMesh({
  material,
  widthMm,
  depthMm,
  position,
  thicknessMm = 40,
  lightingMode = 'present',
  paintHover = false,
}: {
  readonly material?: AmbientMaterial;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly position: Vec3;
  readonly thicknessMm?: number;
  readonly lightingMode?: SceneLightingMode;
  readonly paintHover?: boolean;
}): ReactNode {
  const color = material ? resolveWallColor(material) : CEILING_DEFAULT_COLOR;
  const phys = resolveWallPhysical(material, lightingMode);
  // Center Y of box = position[1] + thickness/2 so the underside rests at
  // position[1] (e.g. 2400mm wall height) and the box extrudes upward.
  const posY = position[1] + thicknessMm / 2;
  return (
    <group position={[position[0], posY, position[2]]}>
      <mesh
        receiveShadow
        castShadow
        userData={{ surface: 'ceiling' }}
      >
        <boxGeometry args={[widthMm, thicknessMm, depthMm]} />
        <Suspense
          fallback={
            <meshStandardMaterial
              color={paintHover ? PAINT_HOVER_COLOR : color}
              side={DoubleSide}
              roughness={phys.roughness}
              metalness={phys.metalness}
            />
          }
        >
          {material?.previewTextureUrl ? (
            <WallTextureMaterial
              url={material.previewTextureUrl}
              lengthMm={widthMm}
              heightMm={depthMm}
              tileWidthMm={material.previewTextureTileWidthMm}
              tileLengthMm={material.previewTextureTileLengthMm}
              phys={phys}
            />
          ) : (
            <meshStandardMaterial
              color={paintHover ? PAINT_HOVER_COLOR : color}
              side={DoubleSide}
              roughness={phys.roughness}
              metalness={phys.metalness}
            />
          )}
        </Suspense>
      </mesh>
      {paintHover ? (
        <mesh
          rotation={[Math.PI / 2, 0, 0]}
          position={[0, -thicknessMm / 2 - 1, 0]}
          userData={{ surface: 'ceiling', paintHoverOverlay: true }}
        >
          <planeGeometry args={[widthMm, depthMm]} />
          <meshBasicMaterial
            color={PAINT_HOVER_COLOR}
            transparent
            opacity={PAINT_HOVER_OPACITY}
            side={DoubleSide}
          />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * Real thin baseboard strip at the floor-wall junction (design #4151 Q2).
 * ~100mm tall × 20mm thick box; neutral color when no material.
 */
export function BaseboardMesh({
  material,
  lengthMm,
  position,
  rotationY = 0,
}: {
  readonly material?: AmbientMaterial;
  readonly lengthMm: number;
  readonly position: Vec3;
  readonly rotationY?: number;
}): ReactNode {
  const color = resolveWallColor(material);
  return (
    <mesh
      position={[position[0], position[1], position[2]]}
      rotation={[0, rotationY, 0]}
    >
      <boxGeometry args={[lengthMm, BASEBOARD_HEIGHT_MM, BASEBOARD_THICKNESS_MM]} />
      <meshStandardMaterial color={color} roughness={0.85} metalness={0.05} />
    </mesh>
  );
}
