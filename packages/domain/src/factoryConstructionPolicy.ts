/**
 * Factory construction policy & joinery configuration domain model (#875 / C1–C4).
 *
 * Defines the typed, versioned factory construction policy stored in the manufacturing
 * library overlay (library_overlays.overrides under the `joint.` namespace).
 *
 * Governs how a factory builds and drills cabinets on top of the shared Granete Standard
 * library without editing individual furniture definitions.
 */

export type JoinerySystemId =
  | 'minifix-dowel'
  | 'dowel-only'
  | 'screw-only'
  | 'minifix-only'
  | 'custom';

export type JoineryProvenance = 'library' | 'factory' | 'component' | 'exception';

export type ConstructiveRole =
  | 'lateral'
  | 'horizontal'
  | 'back'
  | 'door'
  | 'shelf'
  | 'divider'
  | 'custom';

export type ConnectionFace = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export interface JointFamilyRule {
  readonly systemId: JoinerySystemId;
  readonly stationsCount: number;
  readonly startMarginMm: number;
  readonly endMarginMm: number;
  /** Spacing-derived alternative to stationsCount (#1065): each joint's
   * count derives from its real usable span (count = max(2, floor(span /
   * maxSpacing) + 1)), so furniture dimensions scale the fastener count.
   * Mutually exclusive with stationsCount; when set the engine ignores and
   * the editor must not persist stationsCount for the same rule. */
  readonly maxSpacingMm?: number;
  readonly minifixCode?: string;
  readonly dowelCode?: string;
  readonly screwCode?: string;
  readonly withDowels?: boolean;
  readonly provenance?: JoineryProvenance;
}

export interface BackPanelFamilyRule {
  readonly screwCode: string;
  readonly insetMm: number;
  readonly maxSpacingMm: number;
  readonly provenance?: JoineryProvenance;
}

export interface ComponentConstructionOverride {
  readonly componentId: string;
  readonly constructiveRole?: ConstructiveRole;
  readonly connectionFaces?: readonly ConnectionFace[];
  readonly joinerySystemId?: string;
  readonly stationsCount?: number;
  readonly startMarginMm?: number;
  readonly endMarginMm?: number;
  /** Spacing exception (#1065): replaces the whole pattern — the resolved
   * rule derives counts from the contact span instead of a fixed count. */
  readonly maxSpacingMm?: number;
  readonly provenance?: JoineryProvenance;
}

export interface FactoryConstructionPolicy {
  readonly version: 1;
  readonly floorToSide: JointFamilyRule;
  readonly topToSide: JointFamilyRule;
  readonly shelfToSide: JointFamilyRule;
  readonly backPanel: BackPanelFamilyRule;
  readonly componentOverrides?: Readonly<Record<string, ComponentConstructionOverride>>;
}

export const DEFAULT_FACTORY_CONSTRUCTION_POLICY: FactoryConstructionPolicy = {
  version: 1,
  floorToSide: {
    systemId: 'minifix-dowel',
    stationsCount: 2,
    startMarginMm: 50,
    endMarginMm: 50,
    withDowels: true,
    minifixCode: 'HER-MIN-15',
    dowelCode: 'HER-TAQ-8X30',
    provenance: 'library',
  },
  topToSide: {
    systemId: 'minifix-dowel',
    stationsCount: 2,
    startMarginMm: 50,
    endMarginMm: 50,
    withDowels: true,
    minifixCode: 'HER-MIN-15',
    dowelCode: 'HER-TAQ-8X30',
    provenance: 'library',
  },
  shelfToSide: {
    systemId: 'minifix-dowel',
    stationsCount: 2,
    startMarginMm: 50,
    endMarginMm: 50,
    withDowels: true,
    minifixCode: 'HER-MIN-15',
    dowelCode: 'HER-TAQ-8X30',
    provenance: 'library',
  },
  backPanel: {
    screwCode: 'HER-TOR-4X50',
    insetMm: 16,
    maxSpacingMm: 400,
    provenance: 'library',
  },
};

/**
 * The only overlay key prefixes this policy owns. A policy save upserts
 * exactly these and never touches other overlay keys — foreign `joint.*`
 * overrides (e.g. component-level exceptions stored outside the structured
 * blob) must survive every save (#943 review: namespace-wide stripping
 * silently destroyed them).
 */
export const CONSTRUCTION_POLICY_OWNED_KEY_PREFIXES = [
  'joint.floorToSide.',
  'joint.topToSide.',
  'joint.shelfToSide.',
  'joint.backPanel.',
] as const;

/**
 * Keys the policy owns EXACTLY (not by prefix). The structured blob must be
 * cleaned on an all-inherited save, or a stale blob resurrects factory
 * provenance after "Restaurar herencia".
 */
export const CONSTRUCTION_POLICY_OWNED_KEYS = ['joint.constructionPolicy'] as const;

/** Whether an overlay key belongs to this policy (owned keys are cleaned on save). */
export function isConstructionPolicyOwnedKey(key: string): boolean {
  return (
    CONSTRUCTION_POLICY_OWNED_KEYS.includes(key as (typeof CONSTRUCTION_POLICY_OWNED_KEYS)[number]) ||
    CONSTRUCTION_POLICY_OWNED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/**
 * Flatten one joint family into its granular overlay keys. A spacing-derived
 * rule (#1065) replaces the count key — the two patterns are mutually
 * exclusive and the engine refuses a rule carrying both.
 */
function jointFamilyOverlayEntries(
  prefix: string,
  rule: JointFamilyRule,
): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  overrides[`${prefix}.systemId`] = rule.systemId;
  if (rule.maxSpacingMm !== undefined) {
    overrides[`${prefix}.maxSpacingMm`] = rule.maxSpacingMm;
  } else {
    overrides[`${prefix}.stationsCount`] = rule.stationsCount;
  }
  overrides[`${prefix}.startMarginMm`] = rule.startMarginMm;
  overrides[`${prefix}.endMarginMm`] = rule.endMarginMm;
  if (rule.minifixCode) overrides[`${prefix}.minifixCode`] = rule.minifixCode;
  if (rule.dowelCode) overrides[`${prefix}.dowelCode`] = rule.dowelCode;
  if (rule.screwCode) overrides[`${prefix}.screwCode`] = rule.screwCode;
  if (rule.withDowels !== undefined) overrides[`${prefix}.withDowels`] = rule.withDowels;
  return overrides;
}

/** Convert a typed FactoryConstructionPolicy into flattened overlay overrides with `joint.` prefix. */
export function policyToOverlayOverrides(policy: FactoryConstructionPolicy): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  const structuredPolicy: {
    version: 1;
    floorToSide?: JointFamilyRule;
    topToSide?: JointFamilyRule;
    shelfToSide?: JointFamilyRule;
    backPanel?: BackPanelFamilyRule;
    componentOverrides?: Readonly<Record<string, ComponentConstructionOverride>>;
  } = {
    version: policy.version,
  };

  if (policy.floorToSide.provenance === 'factory') {
    structuredPolicy.floorToSide = { ...policy.floorToSide, provenance: 'factory' };
    Object.assign(overrides, jointFamilyOverlayEntries('joint.floorToSide', policy.floorToSide));
  }

  if (policy.topToSide.provenance === 'factory') {
    structuredPolicy.topToSide = { ...policy.topToSide, provenance: 'factory' };
    Object.assign(overrides, jointFamilyOverlayEntries('joint.topToSide', policy.topToSide));
  }

  if (policy.shelfToSide.provenance === 'factory') {
    structuredPolicy.shelfToSide = { ...policy.shelfToSide, provenance: 'factory' };
    Object.assign(overrides, jointFamilyOverlayEntries('joint.shelfToSide', policy.shelfToSide));
  }

  if (policy.backPanel.provenance === 'factory') {
    structuredPolicy.backPanel = { ...policy.backPanel, provenance: 'factory' };
    overrides['joint.backPanel.screwCode'] = policy.backPanel.screwCode;
    overrides['joint.backPanel.insetMm'] = policy.backPanel.insetMm;
    overrides['joint.backPanel.maxSpacingMm'] = policy.backPanel.maxSpacingMm;
  }

  if (policy.componentOverrides && Object.keys(policy.componentOverrides).length > 0) {
    structuredPolicy.componentOverrides = policy.componentOverrides;
  }

  if (
    structuredPolicy.floorToSide ||
    structuredPolicy.topToSide ||
    structuredPolicy.shelfToSide ||
    structuredPolicy.backPanel ||
    structuredPolicy.componentOverrides
  ) {
    overrides['joint.constructionPolicy'] = structuredPolicy;
  }

  return overrides;
}

/** Reconstitute a FactoryConstructionPolicy from overlay overrides, falling back to Standard defaults. */
export function overlayOverridesToPolicy(overrides: Record<string, unknown> | null | undefined): FactoryConstructionPolicy {
  if (!overrides) {
    return DEFAULT_FACTORY_CONSTRUCTION_POLICY;
  }

  // Check structured constructionPolicy first
  const structured = overrides['joint.constructionPolicy'] as Partial<FactoryConstructionPolicy> | undefined;
  if (structured && structured.version === 1) {
    return {
      version: 1,
      floorToSide: structured.floorToSide && structured.floorToSide.provenance === 'factory'
        ? storedFamilyRule(DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide, structured.floorToSide)
        : DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide,
      topToSide: structured.topToSide && structured.topToSide.provenance === 'factory'
        ? storedFamilyRule(DEFAULT_FACTORY_CONSTRUCTION_POLICY.topToSide, structured.topToSide)
        : DEFAULT_FACTORY_CONSTRUCTION_POLICY.topToSide,
      shelfToSide: structured.shelfToSide && structured.shelfToSide.provenance === 'factory'
        ? storedFamilyRule(DEFAULT_FACTORY_CONSTRUCTION_POLICY.shelfToSide, structured.shelfToSide)
        : DEFAULT_FACTORY_CONSTRUCTION_POLICY.shelfToSide,
      backPanel: structured.backPanel && structured.backPanel.provenance === 'factory'
        ? {
            ...DEFAULT_FACTORY_CONSTRUCTION_POLICY.backPanel,
            ...structured.backPanel,
            provenance: 'factory',
          }
        : DEFAULT_FACTORY_CONSTRUCTION_POLICY.backPanel,
      componentOverrides: pickStoredComponentOverrides(structured.componentOverrides),
    };
  }

  // Check granular keys
  const hasFloor =
    'joint.floorToSide.systemId' in overrides
    || 'joint.floorToSide.stationsCount' in overrides
    || 'joint.floorToSide.maxSpacingMm' in overrides;
  const hasTop =
    'joint.topToSide.systemId' in overrides
    || 'joint.topToSide.stationsCount' in overrides
    || 'joint.topToSide.maxSpacingMm' in overrides;
  const hasShelf =
    'joint.shelfToSide.systemId' in overrides
    || 'joint.shelfToSide.stationsCount' in overrides
    || 'joint.shelfToSide.maxSpacingMm' in overrides;
  const hasBack = 'joint.backPanel.screwCode' in overrides || 'joint.backPanel.insetMm' in overrides;

  return {
    version: 1,
    floorToSide: hasFloor
      ? readGranularJointFamily(overrides, 'floorToSide', DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide)
      : DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide,
    topToSide: hasTop
      ? readGranularJointFamily(overrides, 'topToSide', DEFAULT_FACTORY_CONSTRUCTION_POLICY.topToSide)
      : DEFAULT_FACTORY_CONSTRUCTION_POLICY.topToSide,
    shelfToSide: hasShelf
      ? readGranularJointFamily(overrides, 'shelfToSide', DEFAULT_FACTORY_CONSTRUCTION_POLICY.shelfToSide)
      : DEFAULT_FACTORY_CONSTRUCTION_POLICY.shelfToSide,
    backPanel: hasBack
      ? {
          screwCode: (overrides['joint.backPanel.screwCode'] as string) ?? DEFAULT_FACTORY_CONSTRUCTION_POLICY.backPanel.screwCode,
          insetMm: Number(overrides['joint.backPanel.insetMm'] ?? DEFAULT_FACTORY_CONSTRUCTION_POLICY.backPanel.insetMm),
          maxSpacingMm: Number(overrides['joint.backPanel.maxSpacingMm'] ?? DEFAULT_FACTORY_CONSTRUCTION_POLICY.backPanel.maxSpacingMm),
          provenance: 'factory',
        }
      : DEFAULT_FACTORY_CONSTRUCTION_POLICY.backPanel,
  };
}

/**
 * Merge one stored structured family entry over its library default,
 * mirroring the Go parser: a stored maxSpacingMm (#1065) owns the pattern
 * and zeroes the count (`usableFactoryRule`).
 */
function storedFamilyRule(fallback: JointFamilyRule, stored: JointFamilyRule): JointFamilyRule {
  const merged: JointFamilyRule = { ...fallback, ...stored, provenance: 'factory' };
  if (merged.maxSpacingMm !== undefined) {
    return { ...merged, stationsCount: 0 };
  }
  return merged;
}

/**
 * Read one joint family from the flat editor keys, mirroring the Go granular
 * parser: a stored maxSpacingMm (#1065) owns the pattern and zeroes the
 * count, exactly like `usableFactoryRule` on the server.
 */
function readGranularJointFamily(
  overrides: Record<string, unknown>,
  family: 'floorToSide' | 'topToSide' | 'shelfToSide',
  fallback: JointFamilyRule,
): JointFamilyRule {
  const maxSpacingMmRaw = overrides[`joint.${family}.maxSpacingMm`];
  const maxSpacingMm = maxSpacingMmRaw !== undefined ? Number(maxSpacingMmRaw) : undefined;
  return {
    systemId: (overrides[`joint.${family}.systemId`] as JoinerySystemId) ?? fallback.systemId,
    stationsCount: maxSpacingMm !== undefined
      ? 0
      : Number(overrides[`joint.${family}.stationsCount`] ?? fallback.stationsCount),
    startMarginMm: Number(overrides[`joint.${family}.startMarginMm`] ?? fallback.startMarginMm),
    endMarginMm: Number(overrides[`joint.${family}.endMarginMm`] ?? fallback.endMarginMm),
    maxSpacingMm,
    minifixCode: overrides[`joint.${family}.minifixCode`] as string | undefined,
    dowelCode: overrides[`joint.${family}.dowelCode`] as string | undefined,
    screwCode: overrides[`joint.${family}.screwCode`] as string | undefined,
    withDowels: overrides[`joint.${family}.withDowels`] as boolean | undefined,
    provenance: 'factory',
  };
}

/**
 * Remove an override for a family or component, restoring inheritance from Granete Standard.
 * Does not copy the current value as a hidden override.
 */
export function restoreInheritance(
  policy: FactoryConstructionPolicy,
  target: 'floorToSide' | 'topToSide' | 'shelfToSide' | 'backPanel' | string
): FactoryConstructionPolicy {
  if (target === 'floorToSide') {
    return { ...policy, floorToSide: DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide };
  }
  if (target === 'topToSide') {
    return { ...policy, topToSide: DEFAULT_FACTORY_CONSTRUCTION_POLICY.topToSide };
  }
  if (target === 'shelfToSide') {
    return { ...policy, shelfToSide: DEFAULT_FACTORY_CONSTRUCTION_POLICY.shelfToSide };
  }
  if (target === 'backPanel') {
    return { ...policy, backPanel: DEFAULT_FACTORY_CONSTRUCTION_POLICY.backPanel };
  }

  // Component-level override removal
  if (policy.componentOverrides && target in policy.componentOverrides) {
    const next = { ...policy.componentOverrides };
    delete next[target];
    return { ...policy, componentOverrides: next };
  }

  return policy;
}

/**
 * The Go parser (#875 slice 3) stores a component entry only when it carries
 * at least one station-pattern scalar (presence of a stored field IS the
 * override intent) — the client reader mirrors that drop so both sides derive
 * identical policy from one overlay. Editor-only fields (role, faces, system)
 * never fabricate an entry the engine would not see.
 */
function pickStoredComponentOverrides(
  raw: unknown,
): FactoryConstructionPolicy['componentOverrides'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, ComponentConstructionOverride> = {};
  for (const [componentId, entry] of Object.entries(
    raw as Record<string, Partial<ComponentConstructionOverride>>,
  )) {
    if (!entry || typeof entry !== 'object') continue;
    if (
      entry.stationsCount === undefined &&
      entry.startMarginMm === undefined &&
      entry.endMarginMm === undefined &&
      entry.maxSpacingMm === undefined
    ) {
      continue;
    }
    out[componentId] = entry as ComponentConstructionOverride;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Validate construction policy parameters. */
export function validateConstructionPolicy(policy: FactoryConstructionPolicy): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  const checkJoint = (family: string, rule: JointFamilyRule) => {
    if (rule.maxSpacingMm !== undefined) {
      // Spacing-derived pattern (#1065): the count is derived per joint, so
      // the count bounds do not apply — but a stored count alongside a
      // spacing is the same decision made twice.
      if (!Number.isFinite(rule.maxSpacingMm) || rule.maxSpacingMm <= 0) {
        issues.push(`${family}: maxSpacingMm must be a positive finite number`);
      }
      if (rule.stationsCount > 0) {
        issues.push(`${family}: declare either stationsCount or maxSpacingMm, never both`);
      }
    } else if (rule.stationsCount < 1 || rule.stationsCount > 10) {
      issues.push(`${family}: stationsCount must be between 1 and 10`);
    }
    if (rule.startMarginMm < 10 || rule.startMarginMm > 300) {
      issues.push(`${family}: startMarginMm must be between 10mm and 300mm`);
    }
    if (rule.endMarginMm < 10 || rule.endMarginMm > 300) {
      issues.push(`${family}: endMarginMm must be between 10mm and 300mm`);
    }
    if (!rule.systemId) {
      issues.push(`${family}: systemId is required`);
    }
  };

  checkJoint('floorToSide', policy.floorToSide);
  checkJoint('topToSide', policy.topToSide);
  checkJoint('shelfToSide', policy.shelfToSide);

  if (policy.backPanel.insetMm < 0 || policy.backPanel.insetMm > 100) {
    issues.push('backPanel: insetMm must be between 0mm and 100mm');
  }
  if (policy.backPanel.maxSpacingMm < 50 || policy.backPanel.maxSpacingMm > 1000) {
    issues.push('backPanel: maxSpacingMm must be between 50mm and 1000mm');
  }

  for (const [componentId, entry] of Object.entries(policy.componentOverrides ?? {})) {
    if (entry.stationsCount !== undefined && (entry.stationsCount < 1 || entry.stationsCount > 10)) {
      issues.push(`componentOverrides.${componentId}: stationsCount must be between 1 and 10`);
    }
    if (entry.maxSpacingMm !== undefined) {
      if (!Number.isFinite(entry.maxSpacingMm) || entry.maxSpacingMm <= 0) {
        issues.push(`componentOverrides.${componentId}: maxSpacingMm must be a positive finite number`);
      }
      if (entry.stationsCount !== undefined) {
        issues.push(`componentOverrides.${componentId}: declare either stationsCount or maxSpacingMm, never both`);
      }
    }
    if (entry.startMarginMm !== undefined && (entry.startMarginMm < 10 || entry.startMarginMm > 300)) {
      issues.push(`componentOverrides.${componentId}: startMarginMm must be between 10mm and 300mm`);
    }
    if (entry.endMarginMm !== undefined && (entry.endMarginMm < 10 || entry.endMarginMm > 300)) {
      issues.push(`componentOverrides.${componentId}: endMarginMm must be between 10mm and 300mm`);
    }
  }

  return { valid: issues.length === 0, issues };
}
