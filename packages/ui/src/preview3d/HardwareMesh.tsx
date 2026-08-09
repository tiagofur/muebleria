/**
 * Parametric hardware meshes (jaladeras) for the 3D preview — Fase 2, WU4.
 *
 * Renders a resolved hardware placement as a child <group> of the board mesh
 * group, so it inherits the board's pose. The board group's LOCAL frame is the
 * resolver's contract: local X = width (W), Y = thickness (T), Z = length (L),
 * box [0,W]×[0,T]×[0,L] (the centered three.js box is re-offset by [w/2,t/2,l/2]
 * on the <mesh> in FurnitureScene3D BoardMesh). So a front-face placement at
 * (xPct·W, T, yPct·L) lands exactly on the +thickness surface — NO extra offset.
 *
 * jsdom has no WebGL, so the R3F <mesh>/<geometry> rendering is NOT exercised
 * here (same convention as BoardMeshMaterial.tsx / AmbientMeshes.tsx). The pose
 * + geometry math is extracted as PURE helpers below and unit-tested directly;
 * the JSX only wires those values onto three.js primitives.
 */

import { type ReactNode } from 'react';
import type { Hardware, ResolvedHardwarePlacement } from '@muebles/domain';
import { normalizePreviewColor } from '@muebles/domain';
import { boardPhysicalResponse, type SceneLightingMode } from './sceneLighting';

// --- pure geometry helpers (jsdom-tested) ---------------------------------

/** Convert degrees to radians. */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Child <group> position: the face point offset by the standoff along the face
 * normal (WU4 spec). Pure.
 */
export function hardwarePlacementPosition(
  placement: ResolvedHardwarePlacement,
): readonly [number, number, number] {
  const [px, py, pz] = placement.localPosition;
  const [nx, ny, nz] = placement.localNormal;
  const s = placement.standoffMm;
  return [px + nx * s, py + ny * s, pz + nz * s];
}

/** Euler rotation (radians) from the placement's per-axis rotationDeg. Pure. */
export function hardwarePlacementRotation(
  placement: ResolvedHardwarePlacement,
): readonly [number, number, number] {
  return [
    degToRad(placement.rotationDeg.x),
    degToRad(placement.rotationDeg.y),
    degToRad(placement.rotationDeg.z),
  ];
}

/**
 * Quaternion [x, y, z, w] that rotates the default +Y axis onto the unit local
 * normal, so each primitive (authored in the +Y-outward frame) projects along
 * the anchor face normal. Mirrors three.js `Quaternion.setFromUnitVectors(+Y,
 * normal)`. Identity for the front face (+Y); 180° about X for the back (−Y).
 *
 * Primitives are authored once in the +Y frame and this orientation rotates the
 * whole handle to the right face — no per-face geometry branches.
 */
export function normalOrientationQuaternion(
  normal: readonly [number, number, number],
): readonly [number, number, number, number] {
  const [x, y, z] = normal;
  const dot = y; // +Y · normal
  if (dot >= 1 - 1e-9) return [0, 0, 0, 1]; // +Y → identity
  if (dot <= -1 + 1e-9) return [1, 0, 0, 0]; // −Y → 180° about X
  // rotation axis = +Y × normal = (z, 0, −x)
  const ax = z;
  const ay = 0;
  const az = -x;
  const axisLen = Math.hypot(ax, ay, az);
  if (axisLen < 1e-9) return [0, 0, 0, 1];
  const sinHalf = Math.sqrt((1 - dot) / 2);
  const cosHalf = Math.sqrt((1 + dot) / 2);
  return [
    (ax / axisLen) * sinHalf,
    (ay / axisLen) * sinHalf,
    (az / axisLen) * sinHalf,
    cosHalf,
  ];
}

/** Preview dimension fallbacks (mm) when a Hardware entry omits a field. */
export const DEFAULT_KNOB_DIAMETER_MM = 28;
export const DEFAULT_BAR_LENGTH_MM = 96;
export const DEFAULT_BAR_DIAMETER_MM = 12;
export const DEFAULT_CUP_DIAMETER_MM = 36;
export const DEFAULT_PROJECTION_MM = 25;
export const DEFAULT_HARDWARE_COLOR = '#9aa0a6';

export type HardwareGeometry = {
  readonly shape: 'knob' | 'bar-pull' | 'cup-pull';
  /** Knob head diameter / cup outer diameter (mm). */
  readonly headDiameterMm: number;
  /** Bar-pull grip length (mm). */
  readonly gripLengthMm: number;
  /** Bar-pull / cup-pull grip tube diameter (mm). */
  readonly gripDiameterMm: number;
  /** Handle projection off the face (mm) — equals placement.standoffMm. */
  readonly projectionMm: number;
  /** Mesh color (normalized #RRGGBB / #RGB), with a neutral default. */
  readonly color: string;
  /** Raw PBR scalars fed into boardPhysicalResponse. */
  readonly previewRoughness: number | undefined;
  readonly previewMetalness: number | undefined;
  readonly previewClearcoat: number | undefined;
};

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/**
 * Resolve effective geometry scalars + color + raw PBR from a Hardware entry,
 * applying sane fallbacks. The shape is re-validated here so a stale catalog
 * entry (shape dropped) renders nothing even if a placement slipped through.
 * Pure.
 */
export function resolveHardwareGeometry(
  hardware: Hardware,
  standoffMm: number,
): HardwareGeometry | null {
  const shape = hardware.previewShape;
  if (shape !== 'knob' && shape !== 'bar-pull' && shape !== 'cup-pull') {
    return null;
  }
  const projectionMm =
    standoffMm > 0 ? standoffMm : positiveOr(hardware.previewProjectionMm, DEFAULT_PROJECTION_MM);
  const headDiameterMm = positiveOr(
    hardware.previewDiameterMm ?? hardware.previewSizeMm,
    shape === 'cup-pull' ? DEFAULT_CUP_DIAMETER_MM : DEFAULT_KNOB_DIAMETER_MM,
  );
  const gripLengthMm = positiveOr(hardware.previewSizeMm, DEFAULT_BAR_LENGTH_MM);
  const gripDiameterMm = positiveOr(hardware.previewDiameterMm, DEFAULT_BAR_DIAMETER_MM);
  const color = normalizePreviewColor(hardware.previewColor) ?? DEFAULT_HARDWARE_COLOR;
  return {
    shape,
    headDiameterMm,
    gripLengthMm,
    gripDiameterMm,
    projectionMm,
    color,
    previewRoughness: hardware.previewRoughness,
    previewMetalness: hardware.previewMetalness,
    previewClearcoat: hardware.previewClearcoat,
  };
}

// --- primitive meshes (authored in the +Y-outward frame) ------------------

type HandleMaterialProps = {
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
  readonly clearcoat: number;
  readonly clearcoatRoughness: number;
  readonly envMapIntensity: number;
};

function KnobPrimitive({
  geom,
  mat,
}: {
  readonly geom: HardwareGeometry;
  readonly mat: HandleMaterialProps;
}): ReactNode {
  const headRadius = geom.headDiameterMm / 2;
  const postLen = Math.max(geom.projectionMm, headRadius * 0.5);
  const postRadius = Math.max(headRadius * 0.35, 1);
  // Head sits at the projection tip; post bridges head → face (−Y).
  return (
    <>
      <mesh position={[0, 0, 0]} castShadow>
        <sphereGeometry args={[headRadius, 24, 16]} />
        <meshPhysicalMaterial {...mat} />
      </mesh>
      <mesh position={[0, -postLen / 2, 0]} castShadow>
        <cylinderGeometry args={[postRadius, postRadius, postLen, 14]} />
        <meshPhysicalMaterial {...mat} />
      </mesh>
    </>
  );
}

function BarPullPrimitive({
  geom,
  mat,
}: {
  readonly geom: HardwareGeometry;
  readonly mat: HandleMaterialProps;
}): ReactNode {
  const gripRadius = Math.max(geom.gripDiameterMm / 2, 1);
  const gripLen = geom.gripLengthMm;
  const postLen = Math.max(geom.projectionMm, gripRadius);
  const supportRadius = Math.max(gripRadius * 0.6, 1);
  // Grip perpendicular to the normal: rotate the default +Y cylinder 90° about
  // Z so it lies along X (horizontal across the face plane). Exactly two
  // supports (D3) bridge the grip ends down to the face.
  return (
    <>
      <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[gripRadius, gripRadius, gripLen, 16]} />
        <meshPhysicalMaterial {...mat} />
      </mesh>
      <mesh position={[gripLen / 2, -postLen / 2, 0]} castShadow>
        <cylinderGeometry args={[supportRadius, supportRadius, postLen, 10]} />
        <meshPhysicalMaterial {...mat} />
      </mesh>
      <mesh position={[-gripLen / 2, -postLen / 2, 0]} castShadow>
        <cylinderGeometry args={[supportRadius, supportRadius, postLen, 10]} />
        <meshPhysicalMaterial {...mat} />
      </mesh>
    </>
  );
}

function CupPullPrimitive({
  geom,
  mat,
}: {
  readonly geom: HardwareGeometry;
  readonly mat: HandleMaterialProps;
}): ReactNode {
  const cupRadius = Math.max(geom.headDiameterMm / 2, 1);
  const cupDepth = Math.max(geom.projectionMm, cupRadius * 0.5);
  // Recessed cup sitting at the face, opening outward (+Y).
  return (
    <mesh position={[0, -cupDepth / 2, 0]} castShadow>
      <cylinderGeometry args={[cupRadius, cupRadius * 0.8, cupDepth, 20]} />
      <meshPhysicalMaterial {...mat} />
    </mesh>
  );
}

/**
 * Render one resolved hardware placement. Mount as a CHILD of the board mesh
 * `<group>` so it inherits the board transform (local frame = resolver frame).
 *
 * Structure:
 *   <group position rotation scale>        ← placement pose (rotationDeg)
 *     <group quaternion={+Y→normal}>       ← orient primitive along the normal
 *       <primitive .../>                   ← authored in +Y-outward frame
 *
 * Material uses `boardPhysicalResponse` directly with the hardware's raw
 * preview* scalars (D5 dropped — one resolver, same as boards/ambient).
 */
export function HardwareMesh({
  placement,
  hardware,
  lightingMode = 'present',
}: {
  readonly placement: ResolvedHardwarePlacement;
  readonly hardware: Hardware;
  readonly lightingMode?: SceneLightingMode;
}): ReactNode {
  const geom = resolveHardwareGeometry(hardware, placement.standoffMm);
  if (!geom) return null;

  const phys = boardPhysicalResponse({
    hasMap: false,
    hasGrain: false,
    lightingMode,
    previewRoughness: geom.previewRoughness,
    previewMetalness: geom.previewMetalness,
    previewClearcoat: geom.previewClearcoat,
  });
  const mat: HandleMaterialProps = {
    color: geom.color,
    roughness: phys.roughness,
    metalness: phys.metalness,
    clearcoat: phys.clearcoat,
    clearcoatRoughness: phys.clearcoatRoughness,
    envMapIntensity: phys.envMapIntensity,
  };

  // NOTE: meshPhysicalMaterial (not meshStandardMaterial) so clearcoat /
  // clearcoatRoughness / envMapIntensity from boardPhysicalResponse are honored
  // — consistent with BoardMeshMaterial.tsx. meshStandardMaterial would silently
  // drop clearcoat, defeating the previewClearcoat field added in PR1.
  return (
    <group
      position={hardwarePlacementPosition(placement)}
      rotation={hardwarePlacementRotation(placement)}
      scale={placement.scale}
    >
      <group quaternion={normalOrientationQuaternion(placement.localNormal)}>
        {geom.shape === 'knob' ? (
          <KnobPrimitive geom={geom} mat={mat} />
        ) : geom.shape === 'bar-pull' ? (
          <BarPullPrimitive geom={geom} mat={mat} />
        ) : (
          <CupPullPrimitive geom={geom} mat={mat} />
        )}
      </group>
    </group>
  );
}
