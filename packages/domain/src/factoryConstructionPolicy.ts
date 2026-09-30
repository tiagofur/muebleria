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
 * overrides (e.g. component-level exceptions) must survive every save
 * (#943 review: namespace-wide stripping silently destroyed them).
 */
export const CONSTRUCTION_POLICY_OWNED_KEY_PREFIXES = [
  'joint.floorToSide.',
  'joint.topToSide.',
  'joint.shelfToSide.',
  'joint.backPanel.',
] as const;

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
    overrides['joint.floorToSide.systemId'] = policy.floorToSide.systemId;
    overrides['joint.floorToSide.stationsCount'] = policy.floorToSide.stationsCount;
    overrides['joint.floorToSide.startMarginMm'] = policy.floorToSide.startMarginMm;
    overrides['joint.floorToSide.endMarginMm'] = policy.floorToSide.endMarginMm;
    if (policy.floorToSide.minifixCode) overrides['joint.floorToSide.minifixCode'] = policy.floorToSide.minifixCode;
    if (policy.floorToSide.dowelCode) overrides['joint.floorToSide.dowelCode'] = policy.floorToSide.dowelCode;
    if (policy.floorToSide.screwCode) overrides['joint.floorToSide.screwCode'] = policy.floorToSide.screwCode;
    if (policy.floorToSide.withDowels !== undefined) overrides['joint.floorToSide.withDowels'] = policy.floorToSide.withDowels;
  }

  if (policy.topToSide.provenance === 'factory') {
    structuredPolicy.topToSide = { ...policy.topToSide, provenance: 'factory' };
    overrides['joint.topToSide.systemId'] = policy.topToSide.systemId;
    overrides['joint.topToSide.stationsCount'] = policy.topToSide.stationsCount;
    overrides['joint.topToSide.startMarginMm'] = policy.topToSide.startMarginMm;
    overrides['joint.topToSide.endMarginMm'] = policy.topToSide.endMarginMm;
    if (policy.topToSide.minifixCode) overrides['joint.topToSide.minifixCode'] = policy.topToSide.minifixCode;
    if (policy.topToSide.dowelCode) overrides['joint.topToSide.dowelCode'] = policy.topToSide.dowelCode;
    if (policy.topToSide.screwCode) overrides['joint.topToSide.screwCode'] = policy.topToSide.screwCode;
    if (policy.topToSide.withDowels !== undefined) overrides['joint.topToSide.withDowels'] = policy.topToSide.withDowels;
  }

  if (policy.shelfToSide.provenance === 'factory') {
    structuredPolicy.shelfToSide = { ...policy.shelfToSide, provenance: 'factory' };
    overrides['joint.shelfToSide.systemId'] = policy.shelfToSide.systemId;
    overrides['joint.shelfToSide.stationsCount'] = policy.shelfToSide.stationsCount;
    overrides['joint.shelfToSide.startMarginMm'] = policy.shelfToSide.startMarginMm;
    overrides['joint.shelfToSide.endMarginMm'] = policy.shelfToSide.endMarginMm;
    if (policy.shelfToSide.minifixCode) overrides['joint.shelfToSide.minifixCode'] = policy.shelfToSide.minifixCode;
    if (policy.shelfToSide.dowelCode) overrides['joint.shelfToSide.dowelCode'] = policy.shelfToSide.dowelCode;
    if (policy.shelfToSide.screwCode) overrides['joint.shelfToSide.screwCode'] = policy.shelfToSide.screwCode;
    if (policy.shelfToSide.withDowels !== undefined) overrides['joint.shelfToSide.withDowels'] = policy.shelfToSide.withDowels;
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
        ? {
            ...DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide,
            ...structured.floorToSide,
            provenance: 'factory',
          }
        : DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide,
      topToSide: structured.topToSide && structured.topToSide.provenance === 'factory'
        ? {
            ...DEFAULT_FACTORY_CONSTRUCTION_POLICY.topToSide,
            ...structured.topToSide,
            provenance: 'factory',
          }
        : DEFAULT_FACTORY_CONSTRUCTION_POLICY.topToSide,
      shelfToSide: structured.shelfToSide && structured.shelfToSide.provenance === 'factory'
        ? {
            ...DEFAULT_FACTORY_CONSTRUCTION_POLICY.shelfToSide,
            ...structured.shelfToSide,
            provenance: 'factory',
          }
        : DEFAULT_FACTORY_CONSTRUCTION_POLICY.shelfToSide,
      backPanel: structured.backPanel && structured.backPanel.provenance === 'factory'
        ? {
            ...DEFAULT_FACTORY_CONSTRUCTION_POLICY.backPanel,
            ...structured.backPanel,
            provenance: 'factory',
          }
        : DEFAULT_FACTORY_CONSTRUCTION_POLICY.backPanel,
      componentOverrides: structured.componentOverrides,
    };
  }

  // Check granular keys
  const hasFloor = 'joint.floorToSide.systemId' in overrides || 'joint.floorToSide.stationsCount' in overrides;
  const hasTop = 'joint.topToSide.systemId' in overrides || 'joint.topToSide.stationsCount' in overrides;
  const hasShelf = 'joint.shelfToSide.systemId' in overrides || 'joint.shelfToSide.stationsCount' in overrides;
  const hasBack = 'joint.backPanel.screwCode' in overrides || 'joint.backPanel.insetMm' in overrides;

  return {
    version: 1,
    floorToSide: hasFloor
      ? {
          systemId: (overrides['joint.floorToSide.systemId'] as JoinerySystemId) ?? DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide.systemId,
          stationsCount: Number(overrides['joint.floorToSide.stationsCount'] ?? DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide.stationsCount),
          startMarginMm: Number(overrides['joint.floorToSide.startMarginMm'] ?? DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide.startMarginMm),
          endMarginMm: Number(overrides['joint.floorToSide.endMarginMm'] ?? DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide.endMarginMm),
          minifixCode: overrides['joint.floorToSide.minifixCode'] as string | undefined,
          dowelCode: overrides['joint.floorToSide.dowelCode'] as string | undefined,
          screwCode: overrides['joint.floorToSide.screwCode'] as string | undefined,
          withDowels: overrides['joint.floorToSide.withDowels'] as boolean | undefined,
          provenance: 'factory',
        }
      : DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide,
    topToSide: hasTop
      ? {
          systemId: (overrides['joint.topToSide.systemId'] as JoinerySystemId) ?? DEFAULT_FACTORY_CONSTRUCTION_POLICY.topToSide.systemId,
          stationsCount: Number(overrides['joint.topToSide.stationsCount'] ?? DEFAULT_FACTORY_CONSTRUCTION_POLICY.topToSide.stationsCount),
          startMarginMm: Number(overrides['joint.topToSide.startMarginMm'] ?? DEFAULT_FACTORY_CONSTRUCTION_POLICY.topToSide.startMarginMm),
          endMarginMm: Number(overrides['joint.topToSide.endMarginMm'] ?? DEFAULT_FACTORY_CONSTRUCTION_POLICY.topToSide.endMarginMm),
          minifixCode: overrides['joint.topToSide.minifixCode'] as string | undefined,
          dowelCode: overrides['joint.topToSide.dowelCode'] as string | undefined,
          screwCode: overrides['joint.topToSide.screwCode'] as string | undefined,
          withDowels: overrides['joint.topToSide.withDowels'] as boolean | undefined,
          provenance: 'factory',
        }
      : DEFAULT_FACTORY_CONSTRUCTION_POLICY.topToSide,
    shelfToSide: hasShelf
      ? {
          systemId: (overrides['joint.shelfToSide.systemId'] as JoinerySystemId) ?? DEFAULT_FACTORY_CONSTRUCTION_POLICY.shelfToSide.systemId,
          stationsCount: Number(overrides['joint.shelfToSide.stationsCount'] ?? DEFAULT_FACTORY_CONSTRUCTION_POLICY.shelfToSide.stationsCount),
          startMarginMm: Number(overrides['joint.shelfToSide.startMarginMm'] ?? DEFAULT_FACTORY_CONSTRUCTION_POLICY.shelfToSide.startMarginMm),
          endMarginMm: Number(overrides['joint.shelfToSide.endMarginMm'] ?? DEFAULT_FACTORY_CONSTRUCTION_POLICY.shelfToSide.endMarginMm),
          minifixCode: overrides['joint.shelfToSide.minifixCode'] as string | undefined,
          dowelCode: overrides['joint.shelfToSide.dowelCode'] as string | undefined,
          screwCode: overrides['joint.shelfToSide.screwCode'] as string | undefined,
          withDowels: overrides['joint.shelfToSide.withDowels'] as boolean | undefined,
          provenance: 'factory',
        }
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

/** Validate construction policy parameters. */
export function validateConstructionPolicy(policy: FactoryConstructionPolicy): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  const checkJoint = (family: string, rule: JointFamilyRule) => {
    if (rule.stationsCount < 1 || rule.stationsCount > 10) {
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

  return { valid: issues.length === 0, issues };
}
