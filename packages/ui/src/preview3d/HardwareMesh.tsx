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
import type { Hardware, HardwarePlacement, ResolvedHardwarePlacement } from '@granete/domain';
import { normalizePreviewColor, resolveHardwarePartFinish } from '@granete/domain';
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
// F068 — new hardware shapes
export const DEFAULT_HINGE_CUP_DIAMETER_MM = 35;
export const DEFAULT_HINGE_CUP_DEPTH_MM = 11;
export const DEFAULT_HINGE_ARM_LENGTH_MM = 50;
export const DEFAULT_SLIDE_LENGTH_MM = 500;
export const DEFAULT_SLIDE_HEIGHT_MM = 45;
export const DEFAULT_RAIL_LENGTH_MM = 500;
export const DEFAULT_RAIL_HEIGHT_MM = 30;
export const DEFAULT_LEG_DIAMETER_MM = 12;
export const DEFAULT_LEG_HEIGHT_MM = 120;

export type HardwareGeometry = {
  readonly shape: 'knob' | 'bar-pull' | 'cup-pull' | 'hinge' | 'slide' | 'rail' | 'leg';
  /** Knob head diameter / cup outer diameter / hinge cup diameter (mm). */
  readonly headDiameterMm: number;
  /** Bar-pull grip length (mm). */
  readonly gripLengthMm: number;
  /** Bar-pull / cup-pull grip tube diameter (mm). */
  readonly gripDiameterMm: number;
  /** Handle projection off the face (mm) — equals placement.standoffMm. */
  readonly projectionMm: number;
  /** Hinge cup depth (mm). */
  readonly cupDepthMm: number;
  /** Hinge arm length (mm). */
  readonly armLengthMm: number;
  /** Slide/rail length (mm). */
  readonly railLengthMm: number;
  /** Slide/rail height/profile (mm). */
  readonly railHeightMm: number;
  /** Leg height (mm). */
  readonly legHeightMm: number;
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
  const validShapes = ['knob', 'bar-pull', 'cup-pull', 'hinge', 'slide', 'rail', 'leg'];
  if (!shape || !validShapes.includes(shape)) {
    return null;
  }
  const projectionMm =
    standoffMm > 0 ? standoffMm : positiveOr(hardware.previewProjectionMm, DEFAULT_PROJECTION_MM);
  const headDiameterMm = positiveOr(
    hardware.previewDiameterMm ?? hardware.previewSizeMm,
    shape === 'cup-pull'
      ? DEFAULT_CUP_DIAMETER_MM
      : shape === 'hinge'
        ? DEFAULT_HINGE_CUP_DIAMETER_MM
        : shape === 'leg'
          ? DEFAULT_LEG_DIAMETER_MM
          : DEFAULT_KNOB_DIAMETER_MM,
  );
  const gripLengthMm = positiveOr(hardware.previewSizeMm, DEFAULT_BAR_LENGTH_MM);
  const gripDiameterMm = positiveOr(hardware.previewDiameterMm, DEFAULT_BAR_DIAMETER_MM);
  const cupDepthMm = positiveOr(hardware.previewProjectionMm, DEFAULT_HINGE_CUP_DEPTH_MM);
  const armLengthMm = positiveOr(hardware.previewSizeMm, DEFAULT_HINGE_ARM_LENGTH_MM);
  const railLengthMm = positiveOr(hardware.previewSizeMm,
    shape === 'rail' ? DEFAULT_RAIL_LENGTH_MM : DEFAULT_SLIDE_LENGTH_MM);
  const railHeightMm = positiveOr(hardware.previewDiameterMm,
    shape === 'rail' ? DEFAULT_RAIL_HEIGHT_MM : DEFAULT_SLIDE_HEIGHT_MM);
  const legHeightMm = positiveOr(hardware.previewSizeMm, DEFAULT_LEG_HEIGHT_MM);
  const color = normalizePreviewColor(hardware.previewColor) ?? DEFAULT_HARDWARE_COLOR;
  return {
    shape,
    headDiameterMm,
    gripLengthMm,
    gripDiameterMm,
    projectionMm,
    cupDepthMm,
    armLengthMm,
    railLengthMm,
    railHeightMm,
    legHeightMm,
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

/** Materials per F080 part role: body / base / grip. */
export type HardwarePartMaterials = {
  readonly body: HandleMaterialProps;
  readonly base: HandleMaterialProps;
  readonly grip: HandleMaterialProps;
};

/**
 * Per-part materials (F080): a part with an assigned preset uses its
 * color + PBR; otherwise it inherits the hardware's global preview* finish
 * (legacy behavior). Selection tints every part. Pure — jsdom-testable.
 */
export function hardwarePartMaterials(
  geom: HardwareGeometry,
  hardware: Hardware,
  lightingMode: SceneLightingMode,
  selected = false,
): HardwarePartMaterials {
  const build = (
    finishColor: string | undefined,
    finishRoughness: number | undefined,
    finishMetalness: number | undefined,
    finishClearcoat: number | undefined,
  ): HandleMaterialProps => {
    const phys = boardPhysicalResponse({
      hasMap: false,
      hasGrain: false,
      lightingMode,
      previewRoughness: finishRoughness ?? geom.previewRoughness,
      previewMetalness: finishMetalness ?? geom.previewMetalness,
      previewClearcoat: finishClearcoat ?? geom.previewClearcoat,
    });
    return {
      color: selected ? '#3b82f6' : (finishColor ?? geom.color),
      roughness: phys.roughness,
      metalness: phys.metalness,
      clearcoat: phys.clearcoat,
      clearcoatRoughness: phys.clearcoatRoughness,
      envMapIntensity: phys.envMapIntensity,
    };
  };
  const forRole = (role: 'body' | 'base' | 'grip'): HandleMaterialProps => {
    const finish = resolveHardwarePartFinish(hardware, role);
    return build(
      finish?.color,
      finish?.roughness,
      finish?.metalness,
      finish?.clearcoat,
    );
  };
  return { body: forRole('body'), base: forRole('base'), grip: forRole('grip') };
}

function KnobPrimitive({
  geom,
  mats,
}: {
  readonly geom: HardwareGeometry;
  readonly mats: HardwarePartMaterials;
}): ReactNode {
  const headRadius = geom.headDiameterMm / 2;
  const postLen = Math.max(geom.projectionMm, headRadius * 0.5);
  const postRadius = Math.max(headRadius * 0.35, 1);
  // Head sits at the projection tip; post bridges head → face (−Y).
  return (
    <>
      <mesh position={[0, 0, 0]} castShadow>
        <sphereGeometry args={[headRadius, 24, 16]} />
        <meshPhysicalMaterial {...mats.body} />
      </mesh>
      <mesh position={[0, -postLen / 2, 0]} castShadow>
        <cylinderGeometry args={[postRadius, postRadius, postLen, 14]} />
        <meshPhysicalMaterial {...mats.base} />
      </mesh>
    </>
  );
}

function BarPullPrimitive({
  geom,
  mats,
}: {
  readonly geom: HardwareGeometry;
  readonly mats: HardwarePartMaterials;
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
        <meshPhysicalMaterial {...mats.grip} />
      </mesh>
      <mesh position={[gripLen / 2, -postLen / 2, 0]} castShadow>
        <cylinderGeometry args={[supportRadius, supportRadius, postLen, 10]} />
        <meshPhysicalMaterial {...mats.base} />
      </mesh>
      <mesh position={[-gripLen / 2, -postLen / 2, 0]} castShadow>
        <cylinderGeometry args={[supportRadius, supportRadius, postLen, 10]} />
        <meshPhysicalMaterial {...mats.base} />
      </mesh>
    </>
  );
}

function CupPullPrimitive({
  geom,
  mats,
}: {
  readonly geom: HardwareGeometry;
  readonly mats: HardwarePartMaterials;
}): ReactNode {
  const cupRadius = Math.max(geom.headDiameterMm / 2, 1);
  const cupDepth = Math.max(geom.projectionMm, cupRadius * 0.5);
  // Recessed cup sitting at the face, opening outward (+Y).
  return (
    <mesh position={[0, -cupDepth / 2, 0]} castShadow>
      <cylinderGeometry args={[cupRadius, cupRadius * 0.8, cupDepth, 20]} />
      <meshPhysicalMaterial {...mats.body} />
    </mesh>
  );
}

// --- F068: new hardware primitives -----------------------------------------

/**
 * Hinge (bisagra cazoleta) — cup cylinder + articulated arm.
 * Authored in +Y-outward frame: cup at the face surface, arm extends along +Y.
 */
function HingePrimitive({
  geom,
  mats,
}: {
  readonly geom: HardwareGeometry;
  readonly mats: HardwarePartMaterials;
}): ReactNode {
  const cupRadius = Math.max(geom.headDiameterMm / 2, 1);
  const cupDepth = Math.max(geom.cupDepthMm, 2);
  const armLen = Math.max(geom.armLengthMm, 10);
  const armW = Math.max(cupRadius * 0.4, 3);
  const armT = Math.max(cupDepth * 0.3, 2);
  return (
    <>
      {/* Cup (cazoleta) — recessed cylinder at the face */}
      <mesh position={[0, cupDepth / 2, 0]} castShadow>
        <cylinderGeometry args={[cupRadius, cupRadius, cupDepth, 20]} />
        <meshPhysicalMaterial {...mats.body} />
      </mesh>
      {/* Arm — thin box from cup center outward along +Y */}
      <mesh position={[0, cupDepth + armLen / 2, 0]} castShadow>
        <boxGeometry args={[armW, armLen, armT]} />
        <meshPhysicalMaterial {...mats.body} />
      </mesh>
      {/* Mounting plate at the arm tip */}
      <mesh position={[0, cupDepth + armLen, 0]} castShadow>
        <boxGeometry args={[armW * 1.5, armT, armT * 1.5]} />
        <meshPhysicalMaterial {...mats.base} />
      </mesh>
    </>
  );
}

/**
 * Slide (corredera telescópica) — rail profile + inner track.
 * Authored in +Y-outward frame: rail lies in the X-Z plane, projecting along +Y.
 */
function SlidePrimitive({
  geom,
  mats,
}: {
  readonly geom: HardwareGeometry;
  readonly mats: HardwarePartMaterials;
}): ReactNode {
  const len = Math.max(geom.railLengthMm, 50);
  const h = Math.max(geom.railHeightMm, 10);
  const t = Math.max(h * 0.2, 3);
  return (
    <>
      {/* Outer rail profile */}
      <mesh position={[0, t / 2, 0]} castShadow>
        <boxGeometry args={[t, h, len]} />
        <meshPhysicalMaterial {...mats.body} />
      </mesh>
      {/* Inner track (slightly thinner, offset inward) */}
      <mesh position={[t * 0.8, t / 2, 0]} castShadow>
        <boxGeometry args={[t * 0.6, h * 0.8, len * 0.9]} />
        <meshPhysicalMaterial {...mats.base} />
      </mesh>
    </>
  );
}

/**
 * Rail (riel para cajones) — simplified linear profile.
 * Thinner than a slide; single box.
 */
function RailPrimitive({
  geom,
  mats,
}: {
  readonly geom: HardwareGeometry;
  readonly mats: HardwarePartMaterials;
}): ReactNode {
  const len = Math.max(geom.railLengthMm, 50);
  const h = Math.max(geom.railHeightMm, 10);
  const t = Math.max(h * 0.15, 2);
  return (
    <mesh position={[0, t / 2, 0]} castShadow>
      <boxGeometry args={[t, h, len]} />
      <meshPhysicalMaterial {...mats.body} />
    </mesh>
  );
}

/**
 * Leg (pata nivelable) — vertical cylinder + wider base.
 * Authored in +Y-outward frame: cylinder extends along -Y (downward from face).
 */
function LegPrimitive({
  geom,
  mats,
}: {
  readonly geom: HardwareGeometry;
  readonly mats: HardwarePartMaterials;
}): ReactNode {
  const radius = Math.max(geom.headDiameterMm / 2, 2);
  const height = Math.max(geom.legHeightMm, 20);
  const baseRadius = radius * 1.6;
  const baseH = Math.max(height * 0.08, 5);
  return (
    <>
      {/* Main shaft */}
      <mesh position={[0, -height / 2, 0]} castShadow>
        <cylinderGeometry args={[radius, radius, height, 16]} />
        <meshPhysicalMaterial {...mats.body} />
      </mesh>
      {/* Leveling base (wider foot) */}
      <mesh position={[0, -height + baseH / 2, 0]} castShadow>
        <cylinderGeometry args={[baseRadius, baseRadius * 0.8, baseH, 16]} />
        <meshPhysicalMaterial {...mats.base} />
      </mesh>
    </>
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
  selected = false,
  onSelect,
  onChangePlacement,
}: {
  readonly placement: ResolvedHardwarePlacement;
  readonly hardware: Hardware;
  readonly lightingMode?: SceneLightingMode;
  readonly selected?: boolean;
  readonly onSelect?: () => void;
  readonly onChangePlacement?: (patch: Partial<HardwarePlacement>) => void;
}): ReactNode {
  const geom = resolveHardwareGeometry(hardware, placement.standoffMm);
  if (!geom) return null;

  const mats = hardwarePartMaterials(geom, hardware, lightingMode, selected);

  const handleClick = (e: { stopPropagation: () => void }) => {
    if (onSelect) {
      e.stopPropagation();
      onSelect();
    }
  };

  return (
    <group
      position={hardwarePlacementPosition(placement)}
      rotation={hardwarePlacementRotation(placement)}
      scale={placement.scale}
      onClick={handleClick}
      data-testid="hardware-mesh-group"
    >
      <group quaternion={normalOrientationQuaternion(placement.localNormal)}>
        {geom.shape === 'knob' ? (
          <KnobPrimitive geom={geom} mats={mats} />
        ) : geom.shape === 'bar-pull' ? (
          <BarPullPrimitive geom={geom} mats={mats} />
        ) : geom.shape === 'cup-pull' ? (
          <CupPullPrimitive geom={geom} mats={mats} />
        ) : geom.shape === 'hinge' ? (
          <HingePrimitive geom={geom} mats={mats} />
        ) : geom.shape === 'slide' ? (
          <SlidePrimitive geom={geom} mats={mats} />
        ) : geom.shape === 'rail' ? (
          <RailPrimitive geom={geom} mats={mats} />
        ) : (
          <LegPrimitive geom={geom} mats={mats} />
        )}
      </group>
    </group>
  );
}

