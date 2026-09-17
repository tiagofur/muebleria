/**
 * Agregado Hardware Assembly Domain Contract
 *
 * Extends Agregado sub-assemblies with multi-member parametric hardware systems
 * (e.g. drawer runner systems like Blum MERIVOBOX, lift systems, sliding systems).
 *
 * Invariants:
 * 1. ZERO PARAMETRIC SCALING for rigid members: RigidMember geometry scale = [1,1,1] with det = +1.0.
 * 2. Fabricated members (bottom, back, etc.) recalculate dimensions from formulas and regenerate geometry.
 * 3. Assembly space follows workshop frame (+X width/right, +Y depth/front, +Z height/up).
 * 4. Distinct left/right parts are modeled as separate rigid members (never mirrored with negative scale).
 * 5. Strict discriminated union for rigid member source (fixed vs variant).
 */

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

export interface AgregadoRigidMember {
  readonly memberId: string;
  readonly role: string;
  readonly source: RigidMemberSource;
  readonly placement: AssemblyAnchorRule;
  readonly bomRole: RigidMemberBOMRole;
}

export interface ProductVariant {
  readonly nominalDimensionMm: number;
  readonly hardwareId: string;
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

export interface ResolvedRigidMember {
  readonly memberId: string;
  readonly role: string;
  readonly hardwareId: string;
  readonly assetId: string;
  readonly assetRevisionId: string;
  readonly sha256: string;
  readonly mountFrame?: {
    readonly originMm: readonly [number, number, number];
    readonly basis: AssemblyBasis;
  };
  readonly localTransform: AssemblyMemberTransform;
  readonly bomRole: RigidMemberBOMRole;
}

export interface AssemblyBOMItem {
  readonly hardwareId: string;
  readonly quantity: number;
  readonly role: string;
  readonly notes?: string;
}

export interface ResolvedFabricatedComponent {
  readonly componentId: string;
  readonly slotId: string;
  readonly name: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm: number;
  readonly transform: AssemblyMemberTransform;
}

export interface ResolvedAssemblySnapshot {
  readonly agregadoId: string;
  readonly agregadoRevisionNumber: number;
  readonly commercialKitHardwareId?: string;
  readonly resolvedDimensionsMm: readonly [number, number, number];
  readonly selectedVariants: Record<string, number>;
  readonly rigidMembers: readonly ResolvedRigidMember[];
  readonly fabricatedComponents: readonly ResolvedFabricatedComponent[];
  readonly bomItems: readonly AssemblyBOMItem[];
}

export interface AssemblyResolutionParams {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm: number;
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
}

export function validateAssemblyAnchorRule(rule: AssemblyAnchorRule): void {
  validateAxisPlacement('x', rule.x);
  validateAxisPlacement('y', rule.y);
  validateAxisPlacement('z', rule.z);
}

export function validateAgregadoRigidMember(
  m: AgregadoRigidMember,
  hasCommercialKit: boolean,
): void {
  if (!m.memberId.trim()) {
    throw new Error('rigid member must have a non-empty memberId');
  }
  if (!m.role.trim()) {
    throw new Error(`rigid member ${m.memberId} must have a non-empty role`);
  }
  validateRigidMemberSource(m.source);
  validateAssemblyAnchorRule(m.placement);

  switch (m.bomRole) {
    case 'included_in_kit':
      if (!hasCommercialKit) {
        throw new Error(
          `rigid member ${m.memberId}: bomRole 'included_in_kit' is invalid when no commercialKitHardwareId is configured`,
        );
      }
      break;
    case 'separately_purchased':
    case 'non_purchasing':
      break;
    default:
      throw new Error(`rigid member ${m.memberId}: invalid bomRole '${m.bomRole}'`);
  }
}

export function validateAgregadoVariantSet(vs: AgregadoVariantSet): void {
  if (!vs.id.trim()) {
    throw new Error('variant set must have a non-empty id');
  }
  if (vs.dimension !== 'depth' && vs.dimension !== 'height' && vs.dimension !== 'width') {
    throw new Error(
      `variant set ${vs.id} has invalid dimension '${vs.dimension}' (expected depth, height, or width)`,
    );
  }
  if (!vs.variants || vs.variants.length === 0) {
    throw new Error(`variant set ${vs.id} must define at least one ProductVariant`);
  }
  for (let i = 0; i < vs.variants.length; i++) {
    const v = vs.variants[i];
    if (!v || v.nominalDimensionMm <= 0) {
      throw new Error(`variant set ${vs.id} variant ${i}: nominalDimensionMm must be positive`);
    }
    if (!v.hardwareId.trim()) {
      throw new Error(`variant set ${vs.id} variant ${i}: hardwareId must be non-empty`);
    }
  }
}
