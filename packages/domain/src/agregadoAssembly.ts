/**
 * Agregado Hardware Assembly Domain Contract & Resolver
 *
 * Extends Agregado sub-assemblies with multi-member parametric hardware systems
 * (e.g. drawer runner systems like Blum MERIVOBOX, lift systems, sliding systems).
 *
 * Invariants:
 * 1. ZERO PARAMETRIC SCALING for rigid members: RigidMember geometry scale = [1,1,1] with det = +1.0.
 * 2. Fabricated members (bottom, back, etc.) recalculate dimensions from declarative rules (no eval, no scripts).
 * 3. Assembly space follows workshop frame (+X width/right, +Y depth/front, +Z height/up).
 * 4. Distinct left/right parts are modeled as separate rigid members (never mirrored with negative scale).
 * 5. Strict discriminated union for rigid member source (fixed vs variant).
 * 6. Visual asset binding remains decoupled: visual pins (#668 authority) are attached on publication (fail-closed).
 * 7. Authoritative recipe revision is preserved; never hardcoded (R7).
 * 8. Fabricated boards resolve solely from Agregado.Components (R8).
 * 9. Multiplier contract: omitted = 1.0; explicit 0 = 0.0; non-finite rejected (R9).
 */

import type {
  Agregado,
  Component,
  Hardware,
  MaterialBoard,
  Module,
  ModuleComponentInstance,
  OptionChoices,
  Structure,
} from './types';
import { calculateAgregadoSubspaceUnits, resolveEffectiveAgregadoId, type SubspaceUnit } from './agregados';
import type { HardwareDesignPart } from './hardwareDesignParts';
import { resolveHardwareDimensions, type EffectiveHardwareDimensions } from './hardwarePlacement';
import { evaluatePartFormula } from './engine/shared';
import { materialBindingRole } from './materialRole';
import { resolveBoardOptionChoiceId } from './plinth';
import {
  type GlbSourceUnits,
  type GlbUpAxis,
  isGlbSourceUnits,
  isGlbUpAxis,
} from './glbRepresentation';

export interface HardwareRotationDeg {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
}

export type RigidMemberSourceKind = 'fixed' | 'variant';

export type RigidMemberBOMRole =
  | 'included_in_kit'
  | 'separately_purchased'
  | 'non_purchasing';

export type AssemblyAxisRef = 'min' | 'max' | 'center';

export interface AssemblyAxisPlacement {
  readonly ref: AssemblyAxisRef;
  readonly offsetMm: number;
  /**
   * #1418: bounded formula (PW/PH/PD with + - * / and numbers) evaluated
   * against the assembly envelope (X→PW, Y→PD, Z→PH). When present it
   * REPLACES offsetMm; both engines round the result to whole mm so TS and
   * Go resolve identically. Legacy numeric offsets stay byte-identical.
   */
  readonly offsetFormula?: string;
}

export interface AssemblyAnchorRule {
  readonly x: AssemblyAxisPlacement;
  readonly y: AssemblyAxisPlacement;
  readonly z: AssemblyAxisPlacement;
  readonly rotationDeg?: HardwareRotationDeg;
}

export interface FixedHardwareSource {
  readonly hardwareId: string;
}

export interface VariantHardwareSource {
  readonly variantSetId: string;
}

export interface RigidMemberSource {
  readonly kind: RigidMemberSourceKind;
  readonly fixed?: FixedHardwareSource;
  readonly variant?: VariantHardwareSource;
}

/** #1460 F2: un eje del override de dimensiones de un miembro — mm directo o fórmula acotada. */
export interface HardwareDimensionOverrideAxis {
  readonly mm?: number;
  readonly formula?: string;
}

/**
 * #1460 F2: override opcional de dimensiones del herraje de un miembro rígido.
 * Eje ausente (o sin mm ni fórmula) = la dimensión del catálogo. La fórmula
 * REEMPLAZA al mm cuando ambos están presentes (mismo contrato que
 * offsetFormula/offsetMm); su entorno ve el envelope del ensamble (PW/PH/PD)
 * y las dimensiones de catálogo del herraje (HW/HH/HD).
 */
export interface HardwareDimensionOverride {
  readonly width?: HardwareDimensionOverrideAxis;
  readonly height?: HardwareDimensionOverrideAxis;
  readonly depth?: HardwareDimensionOverrideAxis;
}

export interface AgregadoRigidMember {
  readonly memberId: string;
  readonly role: string;
  readonly source: RigidMemberSource;
  readonly placement: AssemblyAnchorRule;
  readonly bomRole: RigidMemberBOMRole;
  /** #1376: Actor membership for presentation kinematics ('body' | 'actor:<id>' | undefined). */
  readonly actorMembership?: string;
  /** #1460 F2: override de dimensiones del herraje (Ancho×Alto×Fondo, mm|fórmula). */
  readonly dimensionOverrides?: HardwareDimensionOverride;
  /**
   * #1429 slice A: rol de placement de la pieza EXTERNA del módulo que este
   * miembro fija ('lateral_izquierdo' | 'lateral_derecho' | 'frente_cajon').
   * Declarado ⇒ el perfil de mecanizado de catálogo del herraje taladra esa
   * pieza en el resolve (congelado Go; el preview TS llega con el puerto del
   * resolver espacial). Ausente ⇒ el miembro no taladra fuera del agregado.
   */
  readonly hostPlacement?: string;
}

export type DimensionRuleSource =
  | 'assembly_width'
  | 'assembly_depth'
  | 'assembly_height'
  | 'selected_variant';

/**
 * AssemblyDimensionRule provides declarative, bounded dimension calculation (no eval, no scripts).
 * Multiplier contract (R9):
 * - omitted (undefined) -> default 1.0
 * - explicit 0.0 -> mathematical 0.0
 * Computed dimension = (SourceValue * effectiveMultiplier) + offsetMm.
 */
export interface AssemblyDimensionRule {
  readonly source: DimensionRuleSource;
  readonly variantSetId?: string;
  readonly multiplier?: number;
  readonly offsetMm: number;
}

export interface ProductVariant {
  readonly nominalDimensionMm: number;
  readonly hardwareId: string;
  /**
   * #1493: kit comercial propio de la variante (opcional). Cuando la variante
   * seleccionada lo declara, sustituye al kit del agregado en el BOM y en la
   * materialización de partes del kit (ej. una altura Blum MERIVOBOX N/M/K/E
   * = un kit distinto; la altura E lleva su galería). Ausente ⇒ fallback al
   * commercialKitHardwareId del agregado.
   */
  readonly commercialKitHardwareId?: string;
}

export interface AgregadoVariantSet {
  readonly id: string;
  readonly dimension: 'depth' | 'height' | 'width';
  readonly variants: readonly ProductVariant[];
}

export interface AssemblyCompatibilityRule {
  readonly variantSetId: string;
  readonly clearanceMm: number;
  readonly selectionStrategy: 'max_fitting' | 'exact';
}

export interface AssemblyBasis {
  readonly x: readonly [number, number, number];
  readonly y: readonly [number, number, number];
  readonly z: readonly [number, number, number];
}

export interface AssemblyMemberTransform {
  readonly translationMm: readonly [number, number, number];
  readonly basis: AssemblyBasis;
}

export interface HardwareMountFrame {
  readonly originMm: readonly [number, number, number];
  readonly basis: AssemblyBasis;
}

export interface HardwareAssetNormalization {
  readonly translationMm: readonly [number, number, number];
  readonly basis: AssemblyBasis;
}

export interface ResolvedRigidMember {
  readonly memberId: string;
  readonly role: string;
  readonly hardwareId: string;
  readonly localTransform: AssemblyMemberTransform;
  readonly bomRole: RigidMemberBOMRole;
  readonly assetId?: string;
  readonly assetRevisionId?: string;
  readonly sha256?: string;
  readonly mountFrame?: HardwareMountFrame;
  /** Exact GLB co-representation for web consumers; absent = partial capability (#669) */
  readonly glb?: MemberGlbRepresentation;
  /** #1376: Actor membership for presentation kinematics ('body' | 'actor:<id>' | undefined). */
  readonly actorMembership?: string;
  /**
   * #1417: design parts of this member's hardware (declared by SKP component
   * name). Attached from the catalog at resolution time — the same flow as
   * visual pins. Absent = monolithic member (legacy behavior).
   */
  readonly designParts?: readonly HardwareDesignPart[];
  /**
   * #1460 F2: dimensiones efectivas del herraje tras aplicar
   * dimensionOverrides (merge sobre el catálogo). Presente SOLO cuando el
   * miembro declara override — los payloads sin override quedan byte-idénticos.
   */
  readonly resolvedDimensions?: EffectiveHardwareDimensions;
}

export interface AssemblyBOMItem {
  readonly hardwareId: string;
  readonly quantity: number;
  readonly role: string;
  readonly notes?: string;
}

/**
 * ResolvedFabricatedComponent describes a dimensioned and placed fabricated board component.
 * Originates solely from Agregado.Components without parallel domain entities (R8).
 */
export interface ResolvedFabricatedComponent {
  readonly componentId: string;
  readonly quantity: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm?: number;
  readonly materialId?: string;
  readonly transform: AssemblyMemberTransform;
}

export interface SelectedAssemblyVariant {
  readonly variantSetId: string;
  readonly hardwareId: string;
  readonly nominalDimensionMm: number;
}

/**
 * ResolvedAssembly is the pure deterministic outcome of evaluating an Agregado assembly recipe
 * with concrete parametric inputs.
 * It contains computed dimensions and transforms, but makes NO historical persistence or revision claims (R11).
 */
export interface ResolvedAssembly {
  readonly agregadoId: string;
  readonly commercialKitHardwareId?: string;
  readonly resolvedDimensionsMm: readonly [number, number, number];
  readonly selectedVariants: readonly SelectedAssemblyVariant[];
  readonly rigidMembers: readonly ResolvedRigidMember[];
  readonly fabricatedComponents: readonly ResolvedFabricatedComponent[];
  readonly bomItems: readonly AssemblyBOMItem[];
}

/**
 * PublishedAssemblySnapshot is the immutable historical freeze artifact (R11, R13).
 * Requires explicit positive recipe revision and complete #668 visual asset pins.
 */
export interface PublishedAssemblySnapshot {
  readonly agregadoId: string;
  readonly agregadoRevisionNumber: number;
  readonly commercialKitHardwareId?: string;
  readonly resolvedDimensionsMm: readonly [number, number, number];
  readonly selectedVariants: readonly SelectedAssemblyVariant[];
  readonly rigidMembers: readonly ResolvedRigidMember[];
  readonly fabricatedComponents: readonly ResolvedFabricatedComponent[];
  readonly bomItems: readonly AssemblyBOMItem[];
}

export interface AssemblyResolutionParams {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm: number;
  /**
   * Effective dimensions (mm) per hardwareId for rigid-member offset formulas
   * (#1453 F1): they expose HW/HH/HD to `offsetFormula`. Omitted or a missing
   * id → all three evaluate to 0 (the historical behavior), never a guess.
   */
  readonly hardwareDimensions?: Readonly<Record<string, EffectiveHardwareDimensions>>;
}

export class AssemblyVariantNotFoundError extends Error {
  readonly variantSetId: string;
  readonly requestedSpaceMm: number;
  readonly requiredClearance: number;
  readonly availableNominals: readonly number[];

  constructor(
    variantSetId: string,
    requestedSpaceMm: number,
    requiredClearance: number,
    availableNominals: readonly number[],
  ) {
    super(
      `assembly variant not found for variantSetId '${variantSetId}': requested space ${requestedSpaceMm.toFixed(1)}mm (clearance ${requiredClearance.toFixed(1)}mm) cannot accommodate available nominals [${availableNominals.join(', ')}]`,
    );
    this.name = 'AssemblyVariantNotFoundError';
    this.variantSetId = variantSetId;
    this.requestedSpaceMm = requestedSpaceMm;
    this.requiredClearance = requiredClearance;
    this.availableNominals = availableNominals;
  }
}

// Math & Geometry Validation

export function deriveHardwareBasisFromEuler(rot: HardwareRotationDeg): AssemblyBasis {
  const rx = rot.x ?? 0;
  const ry = rot.y ?? 0;
  const rz = rot.z ?? 0;

  if (!Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(rz)) {
    throw new Error('rotation angles must be finite');
  }

  const radX = (rx * Math.PI) / 180.0;
  const radY = (ry * Math.PI) / 180.0;
  const radZ = (rz * Math.PI) / 180.0;

  const cx = Math.cos(radX), sx = Math.sin(radX);
  const cy = Math.cos(radY), sy = Math.sin(radY);
  const cz = Math.cos(radZ), sz = Math.sin(radZ);

  const clean = (v: number): number => {
    if (Math.abs(v) < 1e-12) return 0;
    if (Math.abs(v - 1) < 1e-12) return 1;
    if (Math.abs(v + 1) < 1e-12) return -1;
    return v;
  };

  const basis: AssemblyBasis = {
    x: [clean(cz * cy), clean(sz * cy), clean(-sy)],
    y: [clean(cz * sy * sx - sz * cx), clean(sz * sy * sx + cz * cx), clean(cy * sx)],
    z: [clean(cz * sy * cx + sz * sx), clean(sz * sy * cx - cz * sx), clean(cy * cx)],
  };

  return basis;
}

export function validateHardwareBasis(basis: AssemblyBasis, label = 'basis'): void {
  const axes = [
    { name: 'x', v: basis.x },
    { name: 'y', v: basis.y },
    { name: 'z', v: basis.z },
  ];
  for (const { name, v } of axes) {
    for (const coord of v) {
      if (!Number.isFinite(coord) || Math.abs(coord) > 1e6) {
        throw new Error(`${label}.${name} must be finite and bounded`);
      }
    }
    const norm = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (Math.abs(norm - 1.0) > 1e-4) {
      throw new Error(`${label}.${name} must be a unit vector (|v|=${norm})`);
    }
  }

  const dotXY = basis.x[0] * basis.y[0] + basis.x[1] * basis.y[1] + basis.x[2] * basis.y[2];
  const dotXZ = basis.x[0] * basis.z[0] + basis.x[1] * basis.z[1] + basis.x[2] * basis.z[2];
  const dotYZ = basis.y[0] * basis.z[0] + basis.y[1] * basis.z[1] + basis.y[2] * basis.z[2];
  if (Math.abs(dotXY) > 1e-4 || Math.abs(dotXZ) > 1e-4 || Math.abs(dotYZ) > 1e-4) {
    throw new Error(`${label} axes must be mutually orthogonal`);
  }

  const crossYZ: [number, number, number] = [
    basis.y[1] * basis.z[2] - basis.y[2] * basis.z[1],
    basis.y[2] * basis.z[0] - basis.y[0] * basis.z[2],
    basis.y[0] * basis.z[1] - basis.y[1] * basis.z[0],
  ];
  const det = basis.x[0] * crossYZ[0] + basis.x[1] * crossYZ[1] + basis.x[2] * crossYZ[2];
  if (Math.abs(det - 1.0) > 1e-4) {
    throw new Error(`${label} must be right-handed with det=+1 (got det=${det}); mirror is rejected`);
  }
}

export const HARDWARE_ASSET_MAGNITUDE_CAP_MM = 1_000_000.0;
export const HARDWARE_ASSET_BASIS_TOLERANCE = 1e-4;

export function deriveAssetNormalization(
  mountFrame: HardwareMountFrame,
): HardwareAssetNormalization {
  validateHardwareBasis(mountFrame.basis, 'mountFrame.basis');
  for (let i = 0; i < 3; i++) {
    const v = mountFrame.originMm[i];
    if (v === undefined || !Number.isFinite(v) || Math.abs(v) > HARDWARE_ASSET_MAGNITUDE_CAP_MM) {
      throw new Error(
        `mountFrame.originMm[${i}] must be finite and within ±${HARDWARE_ASSET_MAGNITUDE_CAP_MM} mm (got ${v})`,
      );
    }
  }

  // Columns of R_norm = rows of R_mount:
  const normBasis: AssemblyBasis = {
    x: [mountFrame.basis.x[0], mountFrame.basis.y[0], mountFrame.basis.z[0]],
    y: [mountFrame.basis.x[1], mountFrame.basis.y[1], mountFrame.basis.z[1]],
    z: [mountFrame.basis.x[2], mountFrame.basis.y[2], mountFrame.basis.z[2]],
  };

  const ox = mountFrame.originMm[0];
  const oy = mountFrame.originMm[1];
  const oz = mountFrame.originMm[2];

  const clean = (n: number): number => (Math.abs(n) < 1e-12 ? 0 : n);

  const tNorm: readonly [number, number, number] = [
    clean(-(normBasis.x[0] * ox + normBasis.y[0] * oy + normBasis.z[0] * oz)),
    clean(-(normBasis.x[1] * ox + normBasis.y[1] * oy + normBasis.z[1] * oz)),
    clean(-(normBasis.x[2] * ox + normBasis.y[2] * oy + normBasis.z[2] * oz)),
  ];

  return {
    translationMm: tNorm,
    basis: normBasis,
  };
}

export function applyAssetNormalization(
  norm: HardwareAssetNormalization,
  p: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    norm.translationMm[0] + p[0] * norm.basis.x[0] + p[1] * norm.basis.y[0] + p[2] * norm.basis.z[0],
    norm.translationMm[1] + p[0] * norm.basis.x[1] + p[1] * norm.basis.y[1] + p[2] * norm.basis.z[1],
    norm.translationMm[2] + p[0] * norm.basis.x[2] + p[1] * norm.basis.y[2] + p[2] * norm.basis.z[2],
  ];
}

export function applyAssetNormalizationVector(
  norm: HardwareAssetNormalization,
  v: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    v[0] * norm.basis.x[0] + v[1] * norm.basis.y[0] + v[2] * norm.basis.z[0],
    v[0] * norm.basis.x[1] + v[1] * norm.basis.y[1] + v[2] * norm.basis.z[1],
    v[0] * norm.basis.x[2] + v[1] * norm.basis.y[2] + v[2] * norm.basis.z[2],
  ];
}

export function applyAssemblyBasis(
  basis: AssemblyBasis,
  v: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    v[0] * basis.x[0] + v[1] * basis.y[0] + v[2] * basis.z[0],
    v[0] * basis.x[1] + v[1] * basis.y[1] + v[2] * basis.z[1],
    v[0] * basis.x[2] + v[1] * basis.y[2] + v[2] * basis.z[2],
  ];
}

export function multiplyAssemblyBases(
  a: AssemblyBasis,
  b: AssemblyBasis,
): AssemblyBasis {
  return {
    x: applyAssemblyBasis(a, b.x),
    y: applyAssemblyBasis(a, b.y),
    z: applyAssemblyBasis(a, b.z),
  };
}

export function composeMemberTransform(
  memberTransform: AssemblyMemberTransform,
  mountFrame?: HardwareMountFrame,
): AssemblyMemberTransform {
  validateHardwareBasis(memberTransform.basis, 'memberTransform.basis');
  if (!mountFrame) {
    return memberTransform;
  }

  const norm = deriveAssetNormalization(mountFrame);
  const effBasis = multiplyAssemblyBases(memberTransform.basis, norm.basis);
  validateHardwareBasis(effBasis, 'effectiveTransform.basis');

  const rotTNorm = applyAssemblyBasis(memberTransform.basis, norm.translationMm);
  const effTrans: readonly [number, number, number] = [
    memberTransform.translationMm[0] + rotTNorm[0],
    memberTransform.translationMm[1] + rotTNorm[1],
    memberTransform.translationMm[2] + rotTNorm[2],
  ];

  return {
    translationMm: effTrans,
    basis: effBasis,
  };
}

// Declarative Dimension Evaluation

export function evaluateDimensionRule(
  rule: AssemblyDimensionRule,
  params: AssemblyResolutionParams,
  selectedVariants: ReadonlyMap<string, SelectedAssemblyVariant>,
): number {
  if (rule.multiplier !== undefined && !Number.isFinite(rule.multiplier)) {
    throw new Error(`dimension rule has non-finite multiplier: ${rule.multiplier}`);
  }
  if (!Number.isFinite(rule.offsetMm)) {
    throw new Error(`dimension rule has non-finite offsetMm: ${rule.offsetMm}`);
  }

  const mult = rule.multiplier !== undefined ? rule.multiplier : 1.0;
  let base: number;

  switch (rule.source) {
    case 'assembly_width':
      base = params.widthMm;
      break;
    case 'assembly_depth':
      base = params.depthMm;
      break;
    case 'assembly_height':
      base = params.heightMm;
      break;
    case 'selected_variant': {
      if (!rule.variantSetId) {
        throw new Error("dimension rule with 'selected_variant' requires variantSetId");
      }
      const variant = selectedVariants.get(rule.variantSetId);
      if (!variant) {
        throw new Error(`selected variant for variantSetId '${rule.variantSetId}' not found`);
      }
      base = variant.nominalDimensionMm;
      break;
    }
    default:
      throw new Error(`unknown dimension rule source: '${(rule as { source: string }).source}'`);
  }

  const result = base * mult + rule.offsetMm;
  if (!Number.isFinite(result) || result <= 0) {
    throw new Error(
      `dimension rule (${rule.source}, mult=${mult}, offset=${rule.offsetMm}) evaluated to non-positive dimension: ${result} mm`,
    );
  }
  return result;
}

// Domain Validators

export function validateRigidMemberSource(source: RigidMemberSource): void {
  switch (source.kind) {
    case 'fixed':
      if (!source.fixed || !source.fixed.hardwareId.trim()) {
        throw new Error('fixed source requires non-empty hardwareId');
      }
      if (source.variant) {
        throw new Error('fixed source must not contain variant payload');
      }
      break;
    case 'variant':
      if (!source.variant || !source.variant.variantSetId.trim()) {
        throw new Error('variant source requires non-empty variantSetId');
      }
      if (source.fixed) {
        throw new Error('variant source must not contain fixed payload');
      }
      break;
    default:
      throw new Error(`invalid rigid member source kind: '${(source as { kind: string }).kind}'`);
  }
}

export function validateAxisPlacement(axisName: string, p: AssemblyAxisPlacement): void {
  if (p.ref !== 'min' && p.ref !== 'max' && p.ref !== 'center') {
    throw new Error(
      `axis ${axisName} has invalid reference '${p.ref}' (expected min, max, or center)`,
    );
  }
  if (!Number.isFinite(p.offsetMm) || Math.abs(p.offsetMm) > 100000.0) {
    throw new Error(`axis ${axisName} has non-finite or out-of-bounds offsetMm: ${p.offsetMm}`);
  }
  if (p.offsetFormula != null) {
    // Sintaxis only (espejo exacto del validador Go): la evaluación corre en
    // resolve con dimensiones reales — validar evaluando con dims centinela
    // rechazaría fórmulas legítimas tipo PW/(PW-1) que Go acepta (#1421 rev).
    const clean = p.offsetFormula.replace(/\s+/g, '');
    if (!clean) {
      throw new Error(`axis ${axisName} has an empty offsetFormula (omit it or provide a formula)`);
    }
    if (!/^[0-9.WHDTPBLiN+\-*/()]+$/.test(clean)) {
      throw new Error(
        `axis ${axisName} has an invalid offsetFormula: "${p.offsetFormula}" (only numbers, W/H/D/P/T/B/L/i/N and + - * / parentheses)`,
      );
    }
  }
}

export function validateAssemblyAnchorRule(rule: AssemblyAnchorRule): void {
  validateAxisPlacement('x', rule.x);
  validateAxisPlacement('y', rule.y);
  validateAxisPlacement('z', rule.z);

  if (rule.rotationDeg) {
    deriveHardwareBasisFromEuler(rule.rotationDeg);
  }
}

export function validateAgregadoRigidMember(
  m: AgregadoRigidMember,
  hasCommercialKit: boolean,
): void {
  if (!m.memberId.trim()) {
    throw new Error('rigid member must have a non-empty memberId');
  }
  if (!m.role.trim()) {
    throw new Error(`rigid member '${m.memberId}' must have a non-empty role`);
  }
  // #1376 contract: consumers compare the raw string ('' | 'body' | 'actor:<id>'),
  // so no trim normalization here — anything else would silently change membership.
  if (
    m.actorMembership !== undefined &&
    m.actorMembership !== '' &&
    m.actorMembership !== 'body' &&
    !/^actor:\S+$/.test(m.actorMembership)
  ) {
    throw new Error(
      `rigid member '${m.memberId}': invalid actorMembership '${m.actorMembership}' (expected '', 'body', or 'actor:<id>')`,
    );
  }
  validateRigidMemberSource(m.source);
  // #1429 slice A: vocabulario cerrado de anfitriones externos + fuente fija
  // (gemelo Go de ValidateAgregadoRigidMember).
  const hostPlacement = (m.hostPlacement ?? '').trim();
  if (hostPlacement) {
    if (m.source.kind !== 'fixed') {
      throw new Error(`rigid member '${m.memberId}': hostPlacement requires a fixed hardware source`);
    }
    if (hostPlacement !== 'lateral_izquierdo' && hostPlacement !== 'lateral_derecho' && hostPlacement !== 'frente_cajon') {
      throw new Error(
        `rigid member '${m.memberId}': hostPlacement '${hostPlacement}' is outside the supported vocabulary (lateral_izquierdo, lateral_derecho, frente_cajon)`,
      );
    }
  }
  validateAssemblyAnchorRule(m.placement);

  // #1460 F2: estructura del override de dimensiones — fail-closed en
  // definición; la sintaxis de la fórmula la valida el resolve (evaluador).
  if (m.dimensionOverrides) {
    const axes: readonly [
      string,
      HardwareDimensionOverrideAxis | undefined,
    ][] = [
      ['width', m.dimensionOverrides.width],
      ['height', m.dimensionOverrides.height],
      ['depth', m.dimensionOverrides.depth],
    ];
    for (const [axis, o] of axes) {
      if (!o) continue;
      // JSON null = ausente (gemelo Go: puntero nil) — ni crashea ni difiere:
      // sólo mm/formula PRESENTES se validan; un eje sin nada es error.
      if (o.mm != null) {
        if (!Number.isFinite(o.mm) || o.mm < 0 || o.mm > 100000.0) {
          throw new Error(
            `rigid member '${m.memberId}': ${axis} dimension override mm must be a finite value in [0, 100000] (got ${o.mm})`,
          );
        }
      }
      if (o.formula != null && o.formula.trim() === '') {
        throw new Error(
          `rigid member '${m.memberId}': ${axis} dimension override formula must be non-empty when present (omit the field to use mm or the catalog)`,
        );
      }
      if (o.mm == null && (o.formula == null || o.formula.trim() === '')) {
        throw new Error(
          `rigid member '${m.memberId}': ${axis} dimension override must carry mm or formula (an empty axis is the catalog — omit it)`,
        );
      }
    }
  }

  switch (m.bomRole) {
    case 'included_in_kit':
      if (!hasCommercialKit) {
        throw new Error(
          `rigid member '${m.memberId}': bomRole 'included_in_kit' is invalid when no commercialKitHardwareId is configured`,
        );
      }
      break;
    case 'separately_purchased':
    case 'non_purchasing':
      break;
    default:
      throw new Error(`rigid member '${m.memberId}': invalid bomRole '${m.bomRole}'`);
  }
}

export function validateAgregadoVariantSet(vs: AgregadoVariantSet): void {
  if (!vs.id.trim()) {
    throw new Error('variant set must have a non-empty id');
  }
  if (vs.dimension !== 'depth' && vs.dimension !== 'height' && vs.dimension !== 'width') {
    throw new Error(
      `variant set '${vs.id}' has invalid dimension '${vs.dimension}' (expected depth, height, or width)`,
    );
  }
  if (!vs.variants || vs.variants.length === 0) {
    throw new Error(`variant set '${vs.id}' must define at least one ProductVariant`);
  }
  const seenNominals = new Set<number>();
  for (let i = 0; i < vs.variants.length; i++) {
    const v = vs.variants[i];
    if (!v || !Number.isFinite(v.nominalDimensionMm) || v.nominalDimensionMm <= 0) {
      throw new Error(`variant set '${vs.id}' variant ${i}: nominalDimensionMm must be finite and positive`);
    }
    if (seenNominals.has(v.nominalDimensionMm)) {
      throw new Error(`variant set '${vs.id}' has duplicate nominalDimensionMm: ${v.nominalDimensionMm}`);
    }
    seenNominals.add(v.nominalDimensionMm);
    if (!v.hardwareId.trim()) {
      throw new Error(`variant set '${vs.id}' variant ${i}: hardwareId must be non-empty`);
    }
    if (v.commercialKitHardwareId !== undefined && v.commercialKitHardwareId.trim() === '') {
      throw new Error(
        `variant set '${vs.id}' variant ${i}: commercialKitHardwareId cannot be whitespace (omit the field to use the agregado-level kit)`,
      );
    }
  }
}

export function validateDimensionRule(
  axisName: string,
  rule: AssemblyDimensionRule,
  validVariantSets?: ReadonlySet<string>,
): void {
  switch (rule.source) {
    case 'assembly_width':
    case 'assembly_depth':
    case 'assembly_height':
      break;
    case 'selected_variant':
      if (!rule.variantSetId || !rule.variantSetId.trim()) {
        throw new Error(`${axisName} dimension rule with 'selected_variant' requires non-empty variantSetId`);
      }
      if (validVariantSets && !validVariantSets.has(rule.variantSetId)) {
        throw new Error(`${axisName} dimension rule references non-existent variantSetId '${rule.variantSetId}'`);
      }
      break;
    default:
      throw new Error(`${axisName} dimension rule has invalid source '${(rule as { source: string }).source}'`);
  }

  if (rule.multiplier !== undefined && !Number.isFinite(rule.multiplier)) {
    throw new Error(`${axisName} dimension rule has non-finite multiplier: ${rule.multiplier}`);
  }
  if (!Number.isFinite(rule.offsetMm) || Math.abs(rule.offsetMm) > 100000.0) {
    throw new Error(`${axisName} dimension rule has non-finite or out-of-bounds offsetMm: ${rule.offsetMm}`);
  }
}

export interface AgregadoAssemblyInput {
  readonly id: string;
  readonly commercialKitHardwareId?: string;
  readonly components?: readonly ModuleComponentInstance[];
  readonly rigidMembers?: readonly AgregadoRigidMember[];
  readonly variantSets?: readonly AgregadoVariantSet[];
  readonly compatibilityRules?: readonly AssemblyCompatibilityRule[];
}

export function validateAgregadoAssemblyDefinition(agregado: AgregadoAssemblyInput): void {
  if (!agregado.id || !agregado.id.trim()) {
    throw new Error('agregado must have a non-empty id');
  }

  const hasKit =
    agregado.commercialKitHardwareId !== undefined &&
    agregado.commercialKitHardwareId.trim() !== '';

  if (agregado.commercialKitHardwareId !== undefined && agregado.commercialKitHardwareId.trim() === '') {
    throw new Error('commercialKitHardwareId cannot be empty or whitespace');
  }

  // 1. Variant sets
  const seenVariantSets = new Set<string>();
  if (agregado.variantSets) {
    for (const vs of agregado.variantSets) {
      if (seenVariantSets.has(vs.id)) {
        throw new Error(`duplicate variantSetId '${vs.id}' in assembly definition`);
      }
      seenVariantSets.add(vs.id);
      validateAgregadoVariantSet(vs);
    }
  }

  // #1493: una variante puede aportar el kit comercial por altura, así que un
  // miembro included_in_kit también es válido cuando ALGUNA variante declara
  // kit. La selección exacta se exige en resolve (fail-closed): si la variante
  // efectiva no declara kit y el agregado tampoco, resolve rechaza en lugar
  // de omitir el BOM en silencio.
  const hasVariantKit = (agregado.variantSets ?? []).some((vs) =>
    (vs.variants ?? []).some((v) => v.commercialKitHardwareId !== undefined && v.commercialKitHardwareId.trim() !== ''),
  );

  // 2. Compatibility rules
  const seenRuleSets = new Set<string>();
  if (agregado.compatibilityRules) {
    for (const rule of agregado.compatibilityRules) {
      if (!rule.variantSetId.trim()) {
        throw new Error('compatibility rule requires non-empty variantSetId');
      }
      if (!seenVariantSets.has(rule.variantSetId)) {
        throw new Error(`compatibility rule references non-existent variantSetId '${rule.variantSetId}'`);
      }
      if (seenRuleSets.has(rule.variantSetId)) {
        throw new Error(`multiple ambiguous compatibility rules for variantSetId '${rule.variantSetId}'`);
      }
      seenRuleSets.add(rule.variantSetId);
      if (!Number.isFinite(rule.clearanceMm) || rule.clearanceMm < 0) {
        throw new Error(`compatibility rule for '${rule.variantSetId}' has non-finite or negative clearance: ${rule.clearanceMm}`);
      }
      if (rule.selectionStrategy !== 'max_fitting' && rule.selectionStrategy !== 'exact') {
        throw new Error(`compatibility rule for '${rule.variantSetId}' has invalid selectionStrategy '${rule.selectionStrategy}'`);
      }
    }
  }

  // 3. Member IDs & definitions
  const seenMemberIds = new Set<string>();
  if (agregado.rigidMembers) {
    for (const m of agregado.rigidMembers) {
      if (seenMemberIds.has(m.memberId)) {
        throw new Error(`duplicate memberId '${m.memberId}' in assembly definition`);
      }
      seenMemberIds.add(m.memberId);
      validateAgregadoRigidMember(m, hasKit || hasVariantKit);
      if (m.source.kind === 'variant' && m.source.variant) {
        if (!seenVariantSets.has(m.source.variant.variantSetId)) {
          throw new Error(`rigid member '${m.memberId}' references non-existent variantSetId '${m.source.variant.variantSetId}'`);
        }
      }
    }
  }

  // 4. Validate Components (Fabricated board members authority - R8)
  if (agregado.components) {
    let i = 0;
    for (const c of agregado.components) {
      if (!c.componentId || !c.componentId.trim()) {
        throw new Error(`component index ${i} must have non-empty componentId`);
      }
      if (!c.quantity || c.quantity <= 0) {
        throw new Error(`component '${c.componentId}' index ${i} must have positive quantity`);
      }
      if (c.overrides) {
        if (c.overrides.lengthRule) {
          validateDimensionRule('lengthRule', c.overrides.lengthRule, seenVariantSets);
        }
        if (c.overrides.widthRule) {
          validateDimensionRule('widthRule', c.overrides.widthRule, seenVariantSets);
        }
        if (c.overrides.placementRule) {
          validateAssemblyAnchorRule(c.overrides.placementRule);
        }
      }
      i++;
    }
  }
}

// Assembly Resolution Engine

function calculateAxisPlacementCoord(
  axisName: string,
  p: AssemblyAxisPlacement,
  dimensionMm: number,
  hwDims?: EffectiveHardwareDimensions,
): number {
  let base: number;
  switch (p.ref) {
    case 'min':
      base = 0;
      break;
    case 'max':
      base = dimensionMm;
      break;
    case 'center':
      base = dimensionMm / 2;
      break;
    default:
      throw new Error(`axis ${axisName} has invalid reference '${(p as { ref: string }).ref}'`);
  }
  if (p.offsetFormula != null) {
    // #1418: the formula replaces the numeric offset. The axis variable is
    // the envelope the ref resolves against (X→PW, Y→PD, Z→PH); both engines
    // round to whole mm (half away from zero) so TS and Go resolve
    // identically. Same magnitude bound as offsetMm (#1421 rev).
    const vars = axisName === 'x' ? { PW: dimensionMm } : axisName === 'y' ? { PD: dimensionMm } : { PH: dimensionMm };
    const evaluated = evaluatePartFormula(p.offsetFormula, {
      W: dimensionMm, H: dimensionMm, D: dimensionMm, ...vars,
      HW: hwDims?.widthMm ?? 0,
      HH: hwDims?.heightMm ?? 0,
      HD: hwDims?.depthMm ?? 0,
    }, {
      structureCode: 'agregado',
      partDescription: `axis ${axisName}`,
      field: axisName === 'x' ? 'x' : axisName === 'y' ? 'y' : 'z',
    });
    if (Math.abs(evaluated) > 100000.0) {
      throw new Error(`axis ${axisName} offset formula evaluates out of bounds: ${evaluated} (|offset| must be ≤ 100000 mm)`);
    }
    return base + evaluated;
  }
  return base + p.offsetMm;
}

/**
 * #1460 F2: merge de dimensionOverrides sobre las dimensiones de catálogo del
 * herraje del miembro. La fórmula (entorno: PW/PH/PD del envelope + HW/HH/HD
 * de catálogo) reemplaza al mm; el evaluador compartido redondea a mm entero
 * (mitad lejos de cero) para que TS y Go resuelvan idéntico. Fail-closed:
 * negativo, no finito o fuera de cota es error de autoría, nunca un guess.
 */
function resolveMemberEffectiveDimensions(
  memberId: string,
  override: HardwareDimensionOverride | undefined,
  catalog: EffectiveHardwareDimensions | undefined,
  envelope: { widthMm: number; depthMm: number; heightMm: number },
): EffectiveHardwareDimensions {
  const base = catalog ?? { widthMm: 0, heightMm: 0, depthMm: 0 };
  if (!override) return base;
  const resolveAxis = (
    label: 'width' | 'height' | 'depth',
    axis: HardwareDimensionOverrideAxis | undefined,
    catalogMm: number,
    envelopeMm: number,
  ): number => {
    if (!axis) return catalogMm;
    const hasFormula = axis.formula != null && axis.formula.trim() !== '';
    if (!hasFormula && axis.mm == null) return catalogMm;
    if (hasFormula) {
      const evaluated = evaluatePartFormula(
        axis.formula as string,
        {
          W: envelope.widthMm,
          H: envelope.heightMm,
          D: envelope.depthMm,
          PW: envelope.widthMm,
          PH: envelope.heightMm,
          PD: envelope.depthMm,
          HW: base.widthMm,
          HH: base.heightMm,
          HD: base.depthMm,
        },
        {
          structureCode: 'agregado',
          partDescription: memberId,
          field: 'length',
        },
      );
      if (!Number.isFinite(evaluated) || evaluated < 0) {
        throw new Error(
          `member '${memberId}' ${label} dimension override evaluates invalid: ${evaluated} (must be a finite value ≥ 0 mm)`,
        );
      }
      if (Math.abs(evaluated) > 100000.0) {
        throw new Error(
          `member '${memberId}' ${label} dimension override evaluates out of bounds: ${evaluated} (must be ≤ 100000 mm)`,
        );
      }
      return evaluated;
    }
    const mm = axis.mm as number;
    if (!Number.isFinite(mm) || mm < 0) {
      throw new Error(
        `member '${memberId}' ${label} dimension override invalid: ${mm} (must be a finite value ≥ 0 mm)`,
      );
    }
    if (mm > 100000.0) {
      throw new Error(
        `member '${memberId}' ${label} dimension override out of bounds: ${mm} (must be ≤ 100000 mm)`,
      );
    }
    return mm;
  };
  return {
    widthMm: resolveAxis('width', override.width, base.widthMm, envelope.widthMm),
    heightMm: resolveAxis('height', override.height, base.heightMm, envelope.heightMm),
    depthMm: resolveAxis('depth', override.depth, base.depthMm, envelope.depthMm),
  };
}

/**
 * #1493: selección determinista de una variante por cada variant set del
 * agregado (max_fitting por defecto, exact por regla de compatibilidad).
 * Extraída de resolveAgregadoAssembly para que el motor de layout pueda
 * pre-seleccionar variantes POR BAHÍA de cajón antes de sincronizar las
 * partes del kit — el kit comercial puede venir de la variante (una altura
 * Blum MERIVOBOX N/M/K/E = un kit distinto).
 */
export function selectAgregadoVariants(
  agregado: AgregadoAssemblyInput,
  params: AssemblyResolutionParams,
): SelectedAssemblyVariant[] {
  const compatRules = new Map<string, AssemblyCompatibilityRule>();
  if (agregado.compatibilityRules) {
    for (const r of agregado.compatibilityRules) {
      compatRules.set(r.variantSetId, r);
    }
  }

  const selectedVariantsList: SelectedAssemblyVariant[] = [];
  if (agregado.variantSets) {
    for (const vs of agregado.variantSets) {
      const rule = compatRules.get(vs.id) ?? {
        variantSetId: vs.id,
        clearanceMm: 0,
        selectionStrategy: 'max_fitting',
      };

      let targetSpace: number;
      switch (vs.dimension) {
        case 'depth':
          targetSpace = params.depthMm;
          break;
        case 'height':
          targetSpace = params.heightMm;
          break;
        case 'width':
          targetSpace = params.widthMm;
          break;
      }

      const availableNominal = targetSpace - rule.clearanceMm;
      const sortedVariants = [...vs.variants].sort((a, b) => a.nominalDimensionMm - b.nominalDimensionMm);

      let chosen: ProductVariant | undefined;
      if (rule.selectionStrategy === 'max_fitting') {
        for (let i = sortedVariants.length - 1; i >= 0; i--) {
          if (sortedVariants[i]!.nominalDimensionMm <= availableNominal) {
            chosen = sortedVariants[i];
            break;
          }
        }
      } else if (rule.selectionStrategy === 'exact') {
        chosen = sortedVariants.find((v) => Math.abs(v.nominalDimensionMm - availableNominal) < 1e-3);
      }

      if (!chosen) {
        throw new AssemblyVariantNotFoundError(
          vs.id,
          targetSpace,
          rule.clearanceMm,
          sortedVariants.map((v) => v.nominalDimensionMm),
        );
      }

      selectedVariantsList.push({
        variantSetId: vs.id,
        hardwareId: chosen.hardwareId,
        nominalDimensionMm: chosen.nominalDimensionMm,
      });
    }
  }

  return selectedVariantsList;
}

/**
 * #1493 (review slice 2): error tipado para la ambigüedad de kits — el
 * resolver de módulo lo clasifica con `instanceof` en vez de substring del
 * mensaje, así un cambio futuro del literal no degrada silenciosamente a
 * `resolve_failed`.
 */
export class AmbiguousCommercialKitError extends Error {
  readonly kits: readonly string[];
  constructor(kits: readonly string[], message: string) {
    super(message);
    this.name = 'AmbiguousCommercialKitError';
    this.kits = kits;
  }
}

/**
 * #1493: kit comercial que gobierna una selección de variantes resuelta. Una
 * variante puede declarar su propio commercialKitHardwareId (un kit por
 * altura de cajón); si las variantes seleccionadas declaran kits, el kit de
 * variante gana sobre el del agregado. Dos o más kits DISTINTOS declarados es
 * ambiguo y falla cerrado; sin declaración cae al kit del agregado ('' cuando
 * la receta no declara ninguno). El kit de una variante NO seleccionada se
 * ignora — la selección es la única verdad comercial de esta resolución.
 */
export function effectiveKitHardwareId(
  agregado: AgregadoAssemblyInput,
  selected: readonly SelectedAssemblyVariant[],
): string {
  const variantsBySet = new Map<string, readonly ProductVariant[]>();
  for (const vs of agregado.variantSets ?? []) {
    variantsBySet.set(vs.id, vs.variants ?? []);
  }

  const kitOwner = new Map<string, string>(); // kit -> primer variantSetId que lo declaró
  const distinctKits: string[] = [];
  for (const sv of selected) {
    let kit = '';
    for (const v of variantsBySet.get(sv.variantSetId) ?? []) {
      if (v.nominalDimensionMm === sv.nominalDimensionMm) {
        kit = (v.commercialKitHardwareId ?? '').trim();
        break;
      }
    }
    if (!kit) continue;
    if (!kitOwner.has(kit)) {
      kitOwner.set(kit, sv.variantSetId);
      distinctKits.push(kit);
    }
  }

  if (distinctKits.length > 1) {
    const owners = distinctKits.map((kit) => `'${kit}' (set '${kitOwner.get(kit)}')`);
    throw new AmbiguousCommercialKitError(
      distinctKits,
      `ambiguous commercial kit: selected variants declare ${distinctKits.length} distinct kits: ${owners.join(', ')}`,
    );
  }
  if (distinctKits.length === 1) {
    return distinctKits[0]!;
  }
  return agregado.commercialKitHardwareId?.trim() ?? '';
}

export function resolveAgregadoAssembly(
  agregado: AgregadoAssemblyInput,
  params: AssemblyResolutionParams,
): ResolvedAssembly {
  validateAgregadoAssemblyDefinition(agregado);

  if (!Number.isFinite(params.widthMm) || params.widthMm <= 0) {
    throw new Error(`invalid width: ${params.widthMm} mm (must be finite and positive)`);
  }
  if (!Number.isFinite(params.depthMm) || params.depthMm <= 0) {
    throw new Error(`invalid depth: ${params.depthMm} mm (must be finite and positive)`);
  }
  if (!Number.isFinite(params.heightMm) || params.heightMm <= 0) {
    throw new Error(`invalid height: ${params.heightMm} mm (must be finite and positive)`);
  }

  // Variant resolution — #1493: delega en selectAgregadoVariants, el mismo
  // contrato determinista que el layout usa por bahía de cajón.
  const selectedVariantsMap = new Map<string, SelectedAssemblyVariant>();
  const selectedVariantsList = selectAgregadoVariants(agregado, params);
  for (const sv of selectedVariantsList) {
    selectedVariantsMap.set(sv.variantSetId, sv);
  }

  // Rigid members resolution (zero scaling, det = +1)
  const resolvedRigidMembers: ResolvedRigidMember[] = [];
  if (agregado.rigidMembers) {
    for (const member of agregado.rigidMembers) {
      let hardwareId = '';
      if (member.source.kind === 'fixed') {
        hardwareId = member.source.fixed!.hardwareId;
      } else if (member.source.kind === 'variant') {
        const variant = selectedVariantsMap.get(member.source.variant!.variantSetId);
        if (!variant) {
          throw new Error(`variant for '${member.source.variant!.variantSetId}' not resolved`);
        }
        hardwareId = variant.hardwareId;
      }

      // #1460 F2: las fórmulas del miembro (offset y dimensiones) ven las
      // dimensiones EFECTIVAS — override aplicado sobre el catálogo.
      const memberDims = resolveMemberEffectiveDimensions(
        member.memberId,
        member.dimensionOverrides,
        params.hardwareDimensions?.[hardwareId],
        { widthMm: params.widthMm, depthMm: params.depthMm, heightMm: params.heightMm },
      );
      const xCoord = calculateAxisPlacementCoord('x', member.placement.x, params.widthMm, memberDims);
      const yCoord = calculateAxisPlacementCoord('y', member.placement.y, params.depthMm, memberDims);
      const zCoord = calculateAxisPlacementCoord('z', member.placement.z, params.heightMm, memberDims);

      const basis = member.placement.rotationDeg
        ? deriveHardwareBasisFromEuler(member.placement.rotationDeg)
        : { x: [1, 0, 0] as const, y: [0, 1, 0] as const, z: [0, 0, 1] as const };

      resolvedRigidMembers.push({
        memberId: member.memberId,
        role: member.role,
        hardwareId,
        localTransform: {
          translationMm: [xCoord, yCoord, zCoord],
          basis,
        },
        bomRole: member.bomRole,
        actorMembership: member.actorMembership,
        // Sólo con override: los payloads legacy quedan byte-idénticos.
        ...(member.dimensionOverrides ? { resolvedDimensions: memberDims } : {}),
      });
    }
  }

  // Fabricated components resolution (sole authority: Agregado.Components - R8)
  const resolvedFabricated: ResolvedFabricatedComponent[] = [];
  if (agregado.components) {
    for (const c of agregado.components) {
      let length = 0;
      let width = 0;
      let translation: [number, number, number] = [0, 0, 0];
      let basis: AssemblyBasis = {
        x: [1, 0, 0],
        y: [0, 1, 0],
        z: [0, 0, 1],
      };

      if (c.overrides?.lengthRule) {
        length = evaluateDimensionRule(c.overrides.lengthRule, params, selectedVariantsMap);
      }
      if (c.overrides?.widthRule) {
        width = evaluateDimensionRule(c.overrides.widthRule, params, selectedVariantsMap);
      }
      if (c.overrides?.placementRule) {
        const xCoord = calculateAxisPlacementCoord('x', c.overrides.placementRule.x, params.widthMm);
        const yCoord = calculateAxisPlacementCoord('y', c.overrides.placementRule.y, params.depthMm);
        const zCoord = calculateAxisPlacementCoord('z', c.overrides.placementRule.z, params.heightMm);
        translation = [xCoord, yCoord, zCoord];

        if (c.overrides.placementRule.rotationDeg) {
          basis = deriveHardwareBasisFromEuler(c.overrides.placementRule.rotationDeg);
        }
      }

      resolvedFabricated.push({
        componentId: c.componentId,
        quantity: c.quantity,
        lengthMm: length,
        widthMm: width,
        transform: {
          translationMm: translation,
          basis,
        },
      });
    }
  }

  // BOM Generation — #1493: el kit efectivo puede venir de la variante
  // seleccionada (una altura de cajón = un kit). Fallback: kit del agregado.
  const effectiveKit = effectiveKitHardwareId(agregado, selectedVariantsList);
  if (!effectiveKit) {
    for (const m of resolvedRigidMembers) {
      if (m.bomRole === 'included_in_kit') {
        throw new Error(
          `member '${m.memberId}' has bomRole 'included_in_kit' but no effective commercial kit is declared (agregado level or on the selected variant)`,
        );
      }
    }
  }

  const bomItems: AssemblyBOMItem[] = [];
  if (effectiveKit) {
    bomItems.push({
      hardwareId: effectiveKit,
      quantity: 1,
      role: 'commercial_kit',
      notes: `Commercial kit for assembly ${agregado.id}`,
    });
  }

  const separateCounts = new Map<string, { quantity: number; role: string }>();
  for (const m of resolvedRigidMembers) {
    if (m.bomRole === 'separately_purchased') {
      const existing = separateCounts.get(m.hardwareId);
      if (existing) {
        existing.quantity += 1;
      } else {
        separateCounts.set(m.hardwareId, { quantity: 1, role: m.role });
      }
    }
  }

  const sortedHardwareIds = [...separateCounts.keys()].sort();
  for (const hwId of sortedHardwareIds) {
    const item = separateCounts.get(hwId)!;
    bomItems.push({
      hardwareId: hwId,
      quantity: item.quantity,
      role: item.role,
    });
  }

  return {
    agregadoId: agregado.id,
    // #1493: kit EFECTIVO (variante o agregado); legacy sin kits de variante
    // ⇒ valor idéntico al anterior.
    commercialKitHardwareId: effectiveKit || undefined,
    resolvedDimensionsMm: [params.widthMm, params.depthMm, params.heightMm],
    selectedVariants: selectedVariantsList,
    rigidMembers: resolvedRigidMembers,
    fabricatedComponents: resolvedFabricated,
    bomItems,
  };
}

// Visual Pinning Authority (#668 - R10, R13)

/**
 * MemberGlbRepresentation is the web co-representation reference for a rigid
 * member (#669): the exact GLB revision to load plus the declared coordinate
 * space of the file. The renderer maps GLB vertices to asset mm ONCE through
 * sourceUnits/upAxis (glbRepresentation.ts) and then reuses the identical
 * MountFrame chain — there is no second interpretation of MountFrame for web.
 */
export interface MemberGlbRepresentation {
  readonly revisionId: string;
  readonly sha256: string;
  readonly sourceUnits: GlbSourceUnits;
  readonly upAxis: GlbUpAxis;
  readonly sourceRevisionId?: string;
}

export type VisualAssetLookup = (hardwareId: string) => {
  mountFrame?: {
    originMm: readonly [number, number, number];
    basis: AssemblyBasis;
  };
  assetId: string;
  assetRevisionId: string;
  sha256: string;
  glb?: MemberGlbRepresentation;
} | null;

/**
 * Creates a VisualAssetLookup from the active hardware catalog.
 * Connects visual bindings (#667/#668) to rigid hardware members for live previews.
 */
export function createCatalogVisualAssetLookup(
  hardwareCatalog?: readonly Hardware[],
): VisualAssetLookup {
  if (!hardwareCatalog || hardwareCatalog.length === 0) {
    return () => null;
  }
  const map = new Map<string, Hardware>();
  for (const hw of hardwareCatalog) {
    map.set(hw.id, hw);
  }
  return (hardwareId: string) => {
    const hw = map.get(hardwareId);
    if (!hw || !hw.visualAsset) return null;
    const va = hw.visualAsset;
    if (!va.assetId || !va.assetRevisionId) return null;
    const glbBinding = (va as unknown as { glb?: MemberGlbRepresentation }).glb;
    const glb =
      glbBinding &&
      glbBinding.revisionId &&
      glbBinding.sha256 &&
      isGlbSourceUnits(glbBinding.sourceUnits) &&
      isGlbUpAxis(glbBinding.upAxis)
        ? glbBinding
        : undefined;
    return {
      assetId: va.assetId,
      assetRevisionId: va.assetRevisionId,
      sha256: va.sha256 ?? '0'.repeat(64),
      mountFrame:
        (va as unknown as { mountFrame?: HardwareMountFrame }).mountFrame ??
        (hw as unknown as { mountFrame?: HardwareMountFrame }).mountFrame,
      ...(glb ? { glb } : {}),
    };
  };
}

export function attachVisualPins(
  assembly: ResolvedAssembly,
  lookup?: VisualAssetLookup,
): ResolvedAssembly {
  if (!lookup) {
    return assembly;
  }

  const updatedMembers = assembly.rigidMembers.map((m) => {
    const asset = lookup(m.hardwareId);
    if (!asset) {
      return m;
    }
    if (!asset.assetId || !asset.assetId.trim()) {
      throw new Error(`visual asset for hardware '${m.hardwareId}' returned empty assetId: fail closed`);
    }
    if (!asset.assetRevisionId || !asset.assetRevisionId.trim()) {
      throw new Error(`visual asset for hardware '${m.hardwareId}' returned empty assetRevisionId: fail closed`);
    }
    if (!asset.sha256 || !asset.sha256.trim()) {
      throw new Error(`visual asset for hardware '${m.hardwareId}' returned empty sha256: fail closed`);
    }
    if (asset.mountFrame) {
      validateHardwareBasis(asset.mountFrame.basis, 'mountFrame.basis');
      for (let i = 0; i < 3; i++) {
        const v = asset.mountFrame.originMm[i];
        if (v === undefined || !Number.isFinite(v) || Math.abs(v) > 100000.0) {
          throw new Error(`visual asset for hardware '${m.hardwareId}' mountFrame origin[${i}] is non-finite: ${v}`);
        }
      }
    }
    return {
      ...m,
      assetId: asset.assetId,
      assetRevisionId: asset.assetRevisionId,
      sha256: asset.sha256,
      mountFrame: asset.mountFrame,
      ...(asset.glb ? { glb: asset.glb } : {}),
    };
  });

  return {
    ...assembly,
    rigidMembers: updatedMembers,
  };
}

/**
 * #1417: attaches the design parts declared on each member's hardware (by SKP
 * component name). Same flow as visual pins: parts live on the catalog
 * hardware and flow to the resolved member at resolution time; a monolithic
 * hardware (no parts) leaves its members untouched.
 */
export function attachHardwareDesignParts(
  assembly: ResolvedAssembly,
  hardwareCatalog?: readonly Hardware[],
): ResolvedAssembly {
  if (!hardwareCatalog || hardwareCatalog.length === 0) {
    return assembly;
  }
  const partsByHardware = new Map<string, readonly HardwareDesignPart[]>();
  for (const hw of hardwareCatalog) {
    if (hw.designParts && hw.designParts.length > 0) {
      partsByHardware.set(hw.id, hw.designParts);
    }
  }
  if (partsByHardware.size === 0) {
    return assembly;
  }
  return {
    ...assembly,
    rigidMembers: assembly.rigidMembers.map((m) => {
      const parts = partsByHardware.get(m.hardwareId);
      return parts ? { ...m, designParts: parts } : m;
    }),
  };
}

/**
 * freezePublishedAssemblySnapshot explicitly produces an immutable published snapshot (R11, R13).
 * Enforces:
 * 1. Authoritative positive recipe revision (recipeRevision > 0).
 * 2. Mandatory #668 visual asset authority; nil/falsy lookup is rejected.
 * 3. Complete visual identity (assetId, assetRevisionId, sha256) for every rigid member.
 * Fails closed if revision <= 0, lookup is falsy, or any member cannot be fully pinned.
 */
export function freezePublishedAssemblySnapshot(
  assembly: ResolvedAssembly,
  recipeRevision: number,
  lookup: VisualAssetLookup,
): PublishedAssemblySnapshot {
  if (!recipeRevision || !Number.isInteger(recipeRevision) || recipeRevision <= 0) {
    throw new Error(`publication freeze requires authoritative positive recipe revision (got ${recipeRevision})`);
  }
  if (!lookup) {
    throw new Error('publication freeze requires #668 visual asset authority; nil lookup is rejected');
  }

  const pinnedAssembly = attachVisualPins(assembly, lookup);
  for (const m of pinnedAssembly.rigidMembers) {
    if (!m.assetId || !m.assetId.trim()) {
      throw new Error(`publication freeze incomplete: rigid member '${m.memberId}' missing visual assetId`);
    }
    if (!m.assetRevisionId || !m.assetRevisionId.trim()) {
      throw new Error(`publication freeze incomplete: rigid member '${m.memberId}' missing visual assetRevisionId`);
    }
    if (!m.sha256 || !m.sha256.trim()) {
      throw new Error(`publication freeze incomplete: rigid member '${m.memberId}' missing visual sha256`);
    }
  }

  return {
    agregadoId: assembly.agregadoId,
    agregadoRevisionNumber: recipeRevision,
    commercialKitHardwareId: assembly.commercialKitHardwareId,
    resolvedDimensionsMm: assembly.resolvedDimensionsMm,
    selectedVariants: assembly.selectedVariants,
    rigidMembers: pinnedAssembly.rigidMembers,
    fabricatedComponents: assembly.fabricatedComponents,
    bomItems: assembly.bomItems,
  };
}

// 3D Assembly Projection (#670-C)

export type AssemblyRenderStatus =
  | 'exact'
  | 'proxy'
  | 'historical_asset_missing'
  | 'asset_load_failed'
  | 'snapshot_invalid';

export interface ProjectedAssemblyPlacement {
  /** Assembly origin in parent furniture / workshop space [x, y, z] mm */
  readonly originMm: readonly [number, number, number];
  /** Workshop plan yaw (degrees) */
  readonly yawDeg?: number;
  /** Full 3D rotation angles in degrees (optional) */
  readonly rotationDeg?: HardwareRotationDeg;
}

/**
 * ProjectedRigidMember represents a purchased rigid hardware component positioned in 3D.
 * INVARIANT: Carries authoritative rigid transform (translationMm + orthonormal basis with det=+1).
 * Carries NO scale property — purchased hardware is NEVER scaled (scale is constant [1,1,1]).
 */
export interface ProjectedRigidMember {
  readonly memberId: string;
  readonly role: string;
  readonly hardwareId: string;
  readonly bomRole: RigidMemberBOMRole;
  readonly assetId?: string;
  readonly assetRevisionId?: string;
  readonly sha256?: string;
  readonly mountFrame?: HardwareMountFrame;
  /** Nominal member placement within assembly space */
  readonly localTransform: AssemblyMemberTransform;
  /** Effective rigid transform T_member * T_norm in assembly space */
  readonly effectiveTransform: AssemblyMemberTransform;
  readonly renderStatus: AssemblyRenderStatus;
  readonly statusDiagnostic?: string;
  /** #1417: design parts (SKP component name + membership + finish key). */
  readonly designParts?: readonly HardwareDesignPart[];
  /**
   * Exact GLB representation to render for web consumers (#669). Absent means
   * the renderer must show the explicit procedural representation (partial
   * capability), never silently hide the member.
   */
  readonly glb?: MemberGlbRepresentation;
}

/**
 * ProjectedFabricatedComponent represents a dimensioned fabricated panel (e.g. bottom, back).
 * Recalculated from authoritative dimensions; never scaled from an old mesh.
 */
export interface ProjectedFabricatedComponent {
  readonly componentId: string;
  readonly quantity: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm?: number;
  readonly materialId?: string;
  readonly transform: AssemblyMemberTransform;
}

export interface ProjectedAssembly {
  readonly assemblyInstanceId: string;
  readonly agregadoId: string;
  readonly recipeRevision?: number;
  readonly snapshotId?: string;
  readonly isHistorical: boolean;
  readonly placement: ProjectedAssemblyPlacement;
  readonly rigidMembers: readonly ProjectedRigidMember[];
  readonly fabricatedComponents: readonly ProjectedFabricatedComponent[];
}

export interface ProjectResolvedAssemblyInput {
  readonly assembly: ResolvedAssembly;
  readonly placement: ProjectedAssemblyPlacement;
  readonly assemblyInstanceId: string;
}

export interface ProjectPublishedAssemblySnapshotInput {
  readonly snapshot: PublishedAssemblySnapshot;
  readonly placement: ProjectedAssemblyPlacement;
  readonly assemblyInstanceId: string;
  /** Set of assetRevisionIds available in local storage or remote CDN */
  readonly availableAssets?: ReadonlySet<string>;
}

/**
 * projectResolvedAssemblyFor3D projects a live, deterministic ResolvedAssembly for 3D preview.
 * Rejects snapshots (which must use projectPublishedAssemblySnapshotFor3D).
 */
export function projectResolvedAssemblyFor3D(
  input: ProjectResolvedAssemblyInput,
): ProjectedAssembly {
  const { assembly, placement, assemblyInstanceId } = input;
  if (!assemblyInstanceId || !assemblyInstanceId.trim()) {
    throw new Error('projectResolvedAssemblyFor3D requires non-empty assemblyInstanceId');
  }
  if ((assembly as unknown as PublishedAssemblySnapshot).agregadoRevisionNumber !== undefined) {
    throw new Error(
      'projectResolvedAssemblyFor3D rejected PublishedAssemblySnapshot: use projectPublishedAssemblySnapshotFor3D for historical snapshots',
    );
  }

  const rigidMembers: ProjectedRigidMember[] = assembly.rigidMembers.map((m) => {
    const effectiveTransform = composeMemberTransform(m.localTransform, m.mountFrame);
    const hasPins = Boolean(m.assetId && m.assetRevisionId);
    const renderStatus: AssemblyRenderStatus = hasPins ? 'exact' : 'proxy';

    return {
      memberId: m.memberId,
      role: m.role,
      hardwareId: m.hardwareId,
      bomRole: m.bomRole,
      assetId: m.assetId,
      assetRevisionId: m.assetRevisionId,
      sha256: m.sha256,
      mountFrame: m.mountFrame,
      localTransform: m.localTransform,
      effectiveTransform,
      renderStatus,
      ...(m.designParts ? { designParts: m.designParts } : {}),
      ...(m.glb ? { glb: m.glb } : {}),
    };
  });

  const fabricatedComponents: ProjectedFabricatedComponent[] = assembly.fabricatedComponents.map((c) => ({
    componentId: c.componentId,
    quantity: c.quantity,
    lengthMm: c.lengthMm,
    widthMm: c.widthMm,
    thicknessMm: c.thicknessMm,
    materialId: c.materialId,
    transform: c.transform,
  }));

  return {
    assemblyInstanceId,
    agregadoId: assembly.agregadoId,
    isHistorical: false,
    placement,
    rigidMembers,
    fabricatedComponents,
  };
}

/**
 * projectPublishedAssemblySnapshotFor3D projects an immutable PublishedAssemblySnapshot for 3D viewing.
 * Does NOT re-evaluate recipes, does NOT select variants, and does NOT query current catalog bindings.
 * Fails closed with 'historical_asset_missing' if exact asset revision is unavailable (never falls back to latest).
 */
export function projectPublishedAssemblySnapshotFor3D(
  input: ProjectPublishedAssemblySnapshotInput,
): ProjectedAssembly {
  const { snapshot, placement, assemblyInstanceId, availableAssets } = input;
  if (!assemblyInstanceId || !assemblyInstanceId.trim()) {
    throw new Error('projectPublishedAssemblySnapshotFor3D requires non-empty assemblyInstanceId');
  }
  if (!snapshot.agregadoRevisionNumber || snapshot.agregadoRevisionNumber <= 0) {
    throw new Error(
      `projectPublishedAssemblySnapshotFor3D rejected invalid snapshot: recipeRevision must be positive integer (got ${snapshot.agregadoRevisionNumber})`,
    );
  }

  const rigidMembers: ProjectedRigidMember[] = snapshot.rigidMembers.map((m) => {
    const effectiveTransform = composeMemberTransform(m.localTransform, m.mountFrame);

    let renderStatus: AssemblyRenderStatus = 'exact';
    let statusDiagnostic: string | undefined;

    if (!m.assetRevisionId) {
      renderStatus = 'snapshot_invalid';
      statusDiagnostic = `snapshot member '${m.memberId}' is missing assetRevisionId`;
    } else if (availableAssets && !availableAssets.has(m.assetRevisionId)) {
      renderStatus = 'historical_asset_missing';
      statusDiagnostic = `exact historical asset unavailable (rev: ${m.assetRevisionId})`;
    }

    // The frozen GLB pin stays exact: it renders only when the exact revision
    // is available to this consumer. A re-exported newer GLB never replaces it
    // and an unavailable one degrades to the explicit procedural
    // representation with a diagnostic, never to latest or to invisibility.
    let glb = m.glb;
    if (glb && availableAssets && !availableAssets.has(glb.revisionId)) {
      statusDiagnostic = `${statusDiagnostic ? `${statusDiagnostic}; ` : ''}exact historical glb unavailable (rev: ${glb.revisionId})`;
      glb = undefined;
    }

    return {
      memberId: m.memberId,
      role: m.role,
      hardwareId: m.hardwareId,
      bomRole: m.bomRole,
      assetId: m.assetId,
      assetRevisionId: m.assetRevisionId,
      sha256: m.sha256,
      mountFrame: m.mountFrame,
      localTransform: m.localTransform,
      effectiveTransform,
      renderStatus,
      ...(statusDiagnostic ? { statusDiagnostic } : {}),
      ...(glb ? { glb } : {}),
    };
  });

  const fabricatedComponents: ProjectedFabricatedComponent[] = snapshot.fabricatedComponents.map((c) => ({
    componentId: c.componentId,
    quantity: c.quantity,
    lengthMm: c.lengthMm,
    widthMm: c.widthMm,
    thicknessMm: c.thicknessMm,
    materialId: c.materialId,
    transform: c.transform,
  }));

  return {
    assemblyInstanceId,
    agregadoId: snapshot.agregadoId,
    recipeRevision: snapshot.agregadoRevisionNumber,
    isHistorical: true,
    placement,
    rigidMembers,
    fabricatedComponents,
  };
}

export interface ResolvedModuleAssembly {
  readonly assemblyInstanceId: string;
  readonly agregadoId: string;
  readonly placement: ProjectedAssemblyPlacement;
  readonly resolvedAssembly?: ResolvedAssembly;
  readonly snapshot?: PublishedAssemblySnapshot;
  readonly isHistorical: boolean;
}

/**
 * #1493 slice 2: razón de rechazo de una bahía/instancia de agregado —
 * espejo exacto del wire contract Go (LayoutAssemblyRejection). Machine
 * strings; la UI las mapea a copy español.
 */
export type AssemblyRejectionReason =
  | 'definition_invalid'
  | 'variant_not_found'
  | 'ambiguous_kit'
  | 'resolve_failed';

export interface ModuleAssemblyRejection {
  readonly assemblyInstanceId: string;
  readonly agregadoId: string;
  readonly agregadoCode?: string;
  readonly reason: AssemblyRejectionReason;
  readonly variantSetId?: string;
  readonly bayHeightMm?: number;
  readonly fittingNominals?: readonly number[];
  readonly detail?: string;
}

export interface ResolvedModuleAssemblies {
  readonly assemblies: readonly ResolvedModuleAssembly[];
  readonly rejections: readonly ModuleAssemblyRejection[];
}

export interface ResolveModuleAgregadoAssembliesOptions {
  readonly optionChoices?: OptionChoices;
  readonly visualAssetLookup?: VisualAssetLookup;
}

/** Catalog slices that carry the thickness/material authority for fabricated boards (R3). */
export interface FabricatedAuthorityCatalog {
  readonly components?: readonly Component[];
  readonly materials?: readonly MaterialBoard[];
}

/**
 * Enriches the fabricated components of a resolved assembly with their
 * authoritative thickness and material (R3): the bound material chosen through
 * the component's option role first, the component's rectangular geometry
 * second, never a hardcoded fallback. Every 3D consumer of a live recipe
 * (module/structure previews, the agregado's own preview) must pass through
 * here before projection; AssemblyMesh refuses a board without thickness.
 *
 * Throws when neither authority exists so the caller can surface an honest
 * diagnostic instead of rendering a guessed board.
 */
export function enrichFabricatedComponentsWithAuthority(
  fabricated: readonly ResolvedFabricatedComponent[],
  catalog: FabricatedAuthorityCatalog,
  optionChoices: OptionChoices | undefined,
): readonly ResolvedFabricatedComponent[] {
  return fabricated.map((c) => {
    const compDef = catalog.components?.find((cmp) => cmp.id === c.componentId);
    let thicknessMm = c.thicknessMm;
    let materialId = c.materialId;

    if (thicknessMm === undefined || !materialId) {
      let role: string | undefined;
      if (compDef) {
        try {
          role = materialBindingRole(compDef);
        } catch {
          role = compDef.optionRoles?.[0];
        }
      }
      const resolvedMatId = role
        ? resolveBoardOptionChoiceId(role, optionChoices ?? {})
        : undefined;
      if (!materialId && resolvedMatId) {
        materialId = resolvedMatId;
      }
      const mat = materialId ? catalog.materials?.find((m) => m.id === materialId) : undefined;

      if (thicknessMm === undefined) {
        thicknessMm =
          mat?.thicknessMm ??
          (compDef?.geometry?.kind === 'rectangular_board'
            ? compDef.geometry.thicknessMm
            : undefined);
      }
    }

    if (thicknessMm === undefined || !Number.isFinite(thicknessMm) || thicknessMm <= 0) {
      throw new Error(
        `Authoritative thicknessMm not found for fabricated component '${c.componentId}': must be defined on bound material or component geometry (no hardcoded fallback allowed)`,
      );
    }

    return {
      ...c,
      thicknessMm,
      ...(materialId ? { materialId } : {}),
    };
  });
}

/**
 * Resolves all agregado multi-member hardware assemblies attached to a module
 * or its structure into pure domain ResolvedModuleAssembly instances.
 *
 * Domain Boundary:
 * application/domain resolution -> ResolvedModuleAssembly -> projection adapter -> UI / SketchUp
 *
 * Invariants:
 * 1. Stable identity: Uses authoritative instance id; unitIndex is solely relative to the instance's own linear array.
 * 2. Authoritative thickness: Derived strictly from bound material or component geometry (never hardcoded 18mm fallback).
 * 3. Live visual pins: Attaches visual assets from catalog (#668) so live rigid members carry renderStatus = 'exact'.
 * 4. Historical snapshots: Passthrough without recipe re-evaluation or current catalog lookup.
 */
export function resolveModuleAgregadoAssembliesDetailed(
  module: Module,
  moduleDims: { width: number; height: number; depth: number },
  catalog: {
    readonly structures?: readonly Structure[];
    readonly agregados?: readonly Agregado[];
    readonly components?: readonly Component[];
    readonly materials?: readonly MaterialBoard[];
    readonly hardware?: readonly Hardware[];
  },
  options: ResolveModuleAgregadoAssembliesOptions = {},
): ResolvedModuleAssemblies {
  const structure = catalog.structures?.find((s) => s.id === module.structureId);
  const allAgregadoInstances = [
    ...(structure?.agregados ?? []),
    ...(module.agregados ?? []),
  ];
  if (allAgregadoInstances.length === 0) return { assemblies: [], rejections: [] };

  const PW = moduleDims.width;
  const PH = moduleDims.height;
  const PD = moduleDims.depth;
  const parentDims = { PW, PH, PD, W: PW, H: PH, D: PD };

  const out: ResolvedModuleAssembly[] = [];
  // #1493 slice 2: el preview nunca vuelve a romper por una bahía — cada
  // unidad/instancia que no emite ensamble queda como rechazo explícito
  // (espejo del guard Go en el wire contract).
  const rejections: ModuleAssemblyRejection[] = [];
  const visualLookup =
    options.visualAssetLookup ?? createCatalogVisualAssetLookup(catalog.hardware);
  // #1453 F1: member offset formulas see HW/HH/HD from the catalog — same
  // lookup the Go layout resolve passes (HardwareDimensionsFromCatalog), so
  // the project preview and the engine agree on every formula.
  const hardwareDimensions: Record<string, EffectiveHardwareDimensions> = {};
  for (const hw of catalog.hardware ?? []) {
    hardwareDimensions[hw.id] = resolveHardwareDimensions(hw);
  }

  for (const agrInst of allAgregadoInstances) {
    const effectiveId = resolveEffectiveAgregadoId(agrInst, options.optionChoices);
    if (!effectiveId) continue;
    const agregado = catalog.agregados?.find((a) => a.id === effectiveId);
    if (!agregado) continue;

    // Only process agregados that define a multi-member assembly recipe
    const isAssembly = Boolean(
      agregado.rigidMembers && agregado.rigidMembers.length > 0,
    );
    if (!isAssembly) continue;

    // #1493 slice 2: la definición se valida UNA vez por instancia (sugerencia
    // del review del slice 1, espejo del guard Go).
    try {
      validateAgregadoAssemblyDefinition(agregado);
    } catch (err) {
      rejections.push({
        assemblyInstanceId: agrInst.id ?? '',
        agregadoId: agregado.id,
        agregadoCode: agregado.code,
        reason: 'definition_invalid',
        detail: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const rawW = agrInst.dimensions?.widthFormula
      ? evaluatePartFormula(agrInst.dimensions.widthFormula, parentDims, {
          structureCode: agregado.code,
          partDescription: agregado.name,
          field: 'width',
        })
      : PW;
    const spaceW = rawW > 0 ? rawW : PW;

    const rawH = agrInst.dimensions?.heightFormula
      ? evaluatePartFormula(agrInst.dimensions.heightFormula, parentDims, {
          structureCode: agregado.code,
          partDescription: agregado.name,
          field: 'length',
        })
      : PH;
    const spaceH = rawH > 0 ? rawH : PH;

    const rawD = agrInst.dimensions?.depthFormula
      ? evaluatePartFormula(agrInst.dimensions.depthFormula, parentDims, {
          structureCode: agregado.code,
          partDescription: agregado.name,
          field: 'length',
        })
      : PD;
    const spaceD = rawD > 0 ? rawD : PD;

    const spaceX = agrInst.position?.xFormula
      ? evaluatePartFormula(agrInst.position.xFormula, parentDims, {
          structureCode: agregado.code,
          partDescription: agregado.name,
          field: 'x',
        })
      : 0;

    const spaceY = agrInst.position?.yFormula
      ? evaluatePartFormula(agrInst.position.yFormula, parentDims, {
          structureCode: agregado.code,
          partDescription: agregado.name,
          field: 'y',
        })
      : 0;

    const spaceZ = agrInst.position?.zFormula
      ? evaluatePartFormula(agrInst.position.zFormula, parentDims, {
          structureCode: agregado.code,
          partDescription: agregado.name,
          field: 'z',
        })
      : 0;

    if (!agrInst.id || !agrInst.id.trim()) {
      throw new Error(
        `ModuleAgregadoInstance for agregado '${agrInst.agregadoId}' requires a non-empty authoritative 'id' for stable 3D assembly projection`,
      );
    }

    // #1386: pose formulas using the copy variables (i, N) position every
    // unit BY FORMULA at full sub-space size — the layout_direction split
    // stays off, mirroring bom.ts and the Go engine so the 3D assembly
    // projection of bound agregado copies matches BOM and layout.
    const quantity = Math.max(1, agrInst.quantity);
    const poseUsesCopyIndex = [agrInst.position?.xFormula, agrInst.position?.yFormula, agrInst.position?.zFormula]
      .some((formula) => /[iN]/.test(formula ?? ''));
    const units: readonly SubspaceUnit[] = poseUsesCopyIndex
      ? Array.from({ length: quantity }, (_, unitIndex) => {
          const poseDims = { ...parentDims, i: unitIndex, N: quantity };
          const evalPose = (formula: string | undefined, field: 'x' | 'y' | 'z') =>
            formula
              ? evaluatePartFormula(formula, poseDims, {
                  structureCode: agregado.code,
                  partDescription: agregado.name,
                  field,
                })
              : 0;
          return {
            unitIndex,
            x: evalPose(agrInst.position?.xFormula, 'x'),
            y: evalPose(agrInst.position?.yFormula, 'y'),
            z: evalPose(agrInst.position?.zFormula, 'z'),
            width: spaceW,
            height: spaceH,
            depth: spaceD,
          };
        })
      : calculateAgregadoSubspaceUnits(
          agrInst.quantity,
          { width: spaceW, height: spaceH, depth: spaceD },
          { x: spaceX, y: spaceY, z: spaceZ },
          agrInst.layoutDirection ?? 'none',
          agrInst.gapMm ?? 0,
        );

    for (const unit of units) {
      const assemblyInstanceId =
        units.length > 1 ? `${agrInst.id}:u${unit.unitIndex}` : agrInst.id;
      const placement: ProjectedAssemblyPlacement = {
        originMm: [unit.x, unit.y, unit.z],
      };

      // Check if instance carries a historical published snapshot
      const snapshot =
        (agrInst as unknown as { assemblySnapshot?: PublishedAssemblySnapshot; snapshot?: PublishedAssemblySnapshot })
          .assemblySnapshot ??
        (agrInst as unknown as { snapshot?: PublishedAssemblySnapshot }).snapshot;

      if (snapshot) {
        out.push({
          assemblyInstanceId,
          agregadoId: agrInst.agregadoId,
          placement,
          snapshot,
          isHistorical: true,
        });
      } else {
        let pinned: ResolvedAssembly;
        try {
          const resolved = resolveAgregadoAssembly(agregado, {
            widthMm: unit.width,
            depthMm: unit.depth,
            heightMm: unit.height,
            hardwareDimensions,
          });

          const enrichedFabricated = enrichFabricatedComponentsWithAuthority(
            resolved.fabricatedComponents,
            catalog,
            options.optionChoices,
          );

          // #1417: attach design parts from the catalog hardware (same flow as pins).
          const withParts = attachHardwareDesignParts(resolved, catalog.hardware);

          // Attach visual pins (R2)
          pinned = attachVisualPins(
            {
              ...withParts,
              fabricatedComponents: enrichedFabricated,
            },
            visualLookup,
          );
        } catch (err) {
          let rejection: ModuleAssemblyRejection = {
            assemblyInstanceId,
            agregadoId: agrInst.agregadoId,
            agregadoCode: agregado.code,
            reason: 'resolve_failed',
            bayHeightMm: unit.height,
            detail: err instanceof Error ? err.message : String(err),
          };
          if (err instanceof AssemblyVariantNotFoundError) {
            rejection = {
              ...rejection,
              reason: 'variant_not_found',
              variantSetId: err.variantSetId,
              fittingNominals: err.availableNominals,
            };
          } else if (err instanceof AmbiguousCommercialKitError) {
            rejection = { ...rejection, reason: 'ambiguous_kit' };
          }
          rejections.push(rejection);
          continue;
        }

        out.push({
          assemblyInstanceId,
          agregadoId: agrInst.agregadoId,
          placement,
          resolvedAssembly: pinned,
          isHistorical: false,
        });
      }
    }
  }

  return { assemblies: out, rejections };
}

/**
 * Wrapper compatible con el contrato histórico: sólo los ensambles emitidos.
 * #1493 slice 2 — ya NO propaga throws de una bahía: los rechazos quedan en
 * `resolveModuleAgregadoAssembliesDetailed().rejections` (el preview usa la
 * variante detailed para mostrarlos).
 */
export function resolveModuleAgregadoAssemblies(
  module: Module,
  moduleDims: { width: number; height: number; depth: number },
  catalog: {
    readonly structures?: readonly Structure[];
    readonly agregados?: readonly Agregado[];
    readonly components?: readonly Component[];
    readonly materials?: readonly MaterialBoard[];
    readonly hardware?: readonly Hardware[];
  },
  options: ResolveModuleAgregadoAssembliesOptions = {},
): readonly ResolvedModuleAssembly[] {
  return resolveModuleAgregadoAssembliesDetailed(module, moduleDims, catalog, options).assemblies;
}

/**
 * 3D Projection adapter: transforms ResolvedModuleAssembly instances into UI/Three.js-ready ProjectedAssembly.
 */
export function projectModuleAssembliesFor3D(
  resolvedAssemblies: readonly ResolvedModuleAssembly[],
  options: {
    readonly availableAssets?: ReadonlySet<string>;
  } = {},
): readonly ProjectedAssembly[] {
  return resolvedAssemblies.map((item) => {
    if (item.isHistorical && item.snapshot) {
      return projectPublishedAssemblySnapshotFor3D({
        snapshot: item.snapshot,
        placement: item.placement,
        assemblyInstanceId: item.assemblyInstanceId,
        availableAssets: options.availableAssets,
      });
    }
    if (item.resolvedAssembly) {
      return projectResolvedAssemblyFor3D({
        assembly: item.resolvedAssembly,
        placement: item.placement,
        assemblyInstanceId: item.assemblyInstanceId,
      });
    }
    throw new Error(
      `ResolvedModuleAssembly '${item.assemblyInstanceId}' missing both resolvedAssembly and snapshot`,
    );
  });
}
