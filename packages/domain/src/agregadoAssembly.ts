/**
 * Agregado Hardware Assembly Domain Contract
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
 * 6. Visual asset binding remains decoupled: visual pins (#668 authority) are attached on publication.
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

export type DimensionRuleSource =
  | 'assembly_width'
  | 'assembly_depth'
  | 'assembly_height'
  | 'selected_variant';

export interface AssemblyDimensionRule {
  readonly source: DimensionRuleSource;
  readonly variantSetId?: string;
  readonly multiplier?: number;
  readonly offsetMm: number;
}

export interface AgregadoFabricatedMember {
  readonly memberId: string;
  readonly slotId: string;
  readonly name: string;
  readonly thicknessMm: number;
  readonly lengthRule: AssemblyDimensionRule;
  readonly widthRule: AssemblyDimensionRule;
  readonly placement: AssemblyAnchorRule;
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
  readonly localTransform: AssemblyMemberTransform;
  readonly bomRole: RigidMemberBOMRole;
  readonly assetId?: string;
  readonly assetRevisionId?: string;
  readonly sha256?: string;
  readonly mountFrame?: {
    readonly originMm: readonly [number, number, number];
    readonly basis: AssemblyBasis;
  };
}

export interface AssemblyBOMItem {
  readonly hardwareId: string;
  readonly quantity: number;
  readonly role: string;
  readonly notes?: string;
}

export interface ResolvedFabricatedComponent {
  readonly memberId: string;
  readonly slotId: string;
  readonly name: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm: number;
  readonly transform: AssemblyMemberTransform;
}

export interface SelectedAssemblyVariant {
  readonly variantSetId: string;
  readonly hardwareId: string;
  readonly nominalDimensionMm: number;
}

export interface ResolvedAssemblySnapshot {
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

// Declarative Dimension Evaluation

export function evaluateDimensionRule(
  rule: AssemblyDimensionRule,
  params: AssemblyResolutionParams,
  selectedVariants: ReadonlyMap<string, SelectedAssemblyVariant>,
): number {
  const mult = rule.multiplier ?? 1.0;
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
  validateRigidMemberSource(m.source);
  validateAssemblyAnchorRule(m.placement);

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

export function validateAgregadoFabricatedMember(
  fm: AgregadoFabricatedMember,
  validVariantSets?: ReadonlySet<string>,
): void {
  if (!fm.memberId.trim()) {
    throw new Error('fabricated member must have a non-empty memberId');
  }
  if (!fm.slotId.trim()) {
    throw new Error(`fabricated member '${fm.memberId}' must have a non-empty slotId`);
  }
  if (!fm.name.trim()) {
    throw new Error(`fabricated member '${fm.memberId}' must have a non-empty name`);
  }
  if (!Number.isFinite(fm.thicknessMm) || fm.thicknessMm <= 0) {
    throw new Error(`fabricated member '${fm.memberId}' thicknessMm must be finite and positive`);
  }
  validateDimensionRule('lengthRule', fm.lengthRule, validVariantSets);
  validateDimensionRule('widthRule', fm.widthRule, validVariantSets);
  validateAssemblyAnchorRule(fm.placement);
}

export interface AgregadoAssemblyInput {
  readonly id: string;
  readonly commercialKitHardwareId?: string;
  readonly rigidMembers?: readonly AgregadoRigidMember[];
  readonly fabricatedMembers?: readonly AgregadoFabricatedMember[];
  readonly variantSets?: readonly AgregadoVariantSet[];
  readonly compatibilityRules?: readonly AssemblyCompatibilityRule[];
}

export function validateAgregadoAssemblyDefinition(agregado: AgregadoAssemblyInput): void {
  if (!agregado.id.trim()) {
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
      validateAgregadoRigidMember(m, hasKit);
      if (m.source.kind === 'variant' && m.source.variant) {
        if (!seenVariantSets.has(m.source.variant.variantSetId)) {
          throw new Error(`rigid member '${m.memberId}' references non-existent variantSetId '${m.source.variant.variantSetId}'`);
        }
      }
    }
  }

  if (agregado.fabricatedMembers) {
    for (const fm of agregado.fabricatedMembers) {
      if (seenMemberIds.has(fm.memberId)) {
        throw new Error(`duplicate memberId '${fm.memberId}' (fabricated) in assembly definition`);
      }
      seenMemberIds.add(fm.memberId);
      validateAgregadoFabricatedMember(fm, seenVariantSets);
    }
  }
}
