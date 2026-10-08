/**
 * Opening capabilities (#1134) — the factory's self-service overlay for
 * OPENING availability: what a factory OFFERS for new authoring, per grip
 * system and per furniture type. Shared with the Go engine through
 * contracts/openingCapabilities.contract.json — the parsers must never
 * diverge (ADR-0009 §7), same pattern as the construction policy.
 *
 * Available ≠ valid: a capability enables OFFERING; whether a concrete
 * furniture/profile/layout combination resolves is the resolver's business
 * (#1131) against the profile's pinned release (#1130). Disabling a
 * capability hides/blocks NEW selection only — it never rewrites or
 * invalidates existing designs.
 *
 * The overlay carries NO dimensions: every millimetre belongs to the
 * OpeningProfile datasheet. Unknown keys anywhere fail closed, so
 * dimensional payloads can never ride in as "capabilities".
 */

export const OPENING_CAPABILITIES_BLOB_KEY = 'opening.capabilities';

/** Grip-system vocabulary (ADR-0009 §3/§7); "none" is the absence of a
 * selection, not a capability entry. */
export type OpeningGripSystem = 'handle' | 'gola' | 'bottom_overhang';

export type FurnitureTypeKey = 'inferior' | 'superior' | 'alto';

export type OpeningPlacementKey = 'top' | 'between' | 'bottom';

export type OpeningGripCapability = {
  readonly enabled: boolean;
  /** Preselected system for new authoring; at most one (parser-enforced). */
  readonly default?: boolean;
  /** Curated profile ids for gola (exact library ids; absent/empty =
   * curation pending — never a wildcard). */
  readonly profiles?: readonly string[];
};

export type OpeningFurnitureTypeGrip = {
  /** Where the system may mount for this type; absent = the profile's own
   * compatible placements govern. */
  readonly placements?: readonly OpeningPlacementKey[];
  /** Type-level default override (undefined ≠ false). */
  readonly default?: boolean;
};

export type OpeningFurnitureTypeCapabilities = {
  readonly grips?: Readonly<Partial<Record<OpeningGripSystem, OpeningFurnitureTypeGrip>>>;
};

export type OpeningCapabilities = {
  readonly version: 1;
  readonly grips: Readonly<Partial<Record<OpeningGripSystem, OpeningGripCapability>>>;
  readonly byFurnitureType?: Readonly<Partial<Record<FurnitureTypeKey, OpeningFurnitureTypeCapabilities>>>;
};

export type OpeningCapabilitiesParseResult =
  | { readonly ok: true; readonly capabilities: OpeningCapabilities | null }
  | { readonly ok: false; readonly message: string };

const GRIP_SYSTEMS: readonly OpeningGripSystem[] = ['handle', 'gola', 'bottom_overhang'];
const FURNITURE_TYPES: readonly FurnitureTypeKey[] = ['inferior', 'superior', 'alto'];
const PLACEMENTS: readonly OpeningPlacementKey[] = ['top', 'between', 'bottom'];

/** The library default offering (mirrors the pilot matrix §6): jaladera
 * available and default, gola available without curation, rebase available.
 * The UI starts here when no overlay decision exists. */
export const DEFAULT_OPENING_CAPABILITIES: OpeningCapabilities = {
  version: 1,
  grips: {
    handle: { enabled: true, default: true },
    gola: { enabled: true, default: false },
    bottom_overhang: { enabled: true, default: false },
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Decode the `opening.capabilities` blob from an organization overlay's
 * overrides. null = no factory decision (the blob or the whole overlay is
 * absent). Identical to the Go engine through the shared fixture.
 */
export function parseOpeningCapabilities(overrides: unknown): OpeningCapabilitiesParseResult {
  if (overrides === undefined || overrides === null) {
    return { ok: true, capabilities: null };
  }
  if (!isRecord(overrides)) {
    return { ok: false, message: 'overlay overrides are not a JSON object' };
  }
  const blob = overrides[OPENING_CAPABILITIES_BLOB_KEY];
  if (blob === undefined || blob === null) {
    return { ok: true, capabilities: null };
  }
  if (!isRecord(blob)) {
    return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY} must be an object` };
  }
  if (blob.version !== 1) {
    return {
      ok: false,
      message: `${OPENING_CAPABILITIES_BLOB_KEY}.version must be 1 (una versión futura no se interpreta)`,
    };
  }
  for (const key of Object.keys(blob)) {
    if (key !== 'version' && key !== 'grips' && key !== 'byFurnitureType') {
      return {
        ok: false,
        message: `${OPENING_CAPABILITIES_BLOB_KEY}.${key} no es una clave conocida (las dimensiones viven en el OpeningProfile)`,
      };
    }
  }
  if (!isRecord(blob.grips) || Object.keys(blob.grips).length === 0) {
    return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.grips debe declarar al menos un sistema` };
  }
  let defaults = 0;
  const grips: Record<string, OpeningGripCapability> = {};
  for (const [system, entry] of Object.entries(blob.grips)) {
    if (!GRIP_SYSTEMS.includes(system as OpeningGripSystem)) {
      return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.grips.${system} no es un sistema de grip conocido` };
    }
    if (!isRecord(entry)) {
      return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.grips.${system} debe ser un objeto` };
    }
    const capability: { enabled: boolean; default?: boolean; profiles?: string[] } = { enabled: false };
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'enabled') {
        if (typeof value !== 'boolean') {
          return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.grips.${system}.enabled debe ser booleano` };
        }
        capability.enabled = value;
        continue;
      }
      if (key === 'default') {
        if (typeof value !== 'boolean') {
          return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.grips.${system}.default debe ser booleano` };
        }
        capability.default = value;
        continue;
      }
      if (key === 'profiles') {
        if (system !== 'gola') {
          return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.grips.${system}.profiles sólo aplica al sistema gola` };
        }
        if (!Array.isArray(value)) {
          return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.grips.${system}.profiles debe ser una lista` };
        }
        const profiles: string[] = [];
        for (const item of value) {
          if (typeof item !== 'string' || item === '') {
            return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.grips.${system}.profiles exige ids exactos no vacíos` };
          }
          profiles.push(item);
        }
        capability.profiles = profiles;
        continue;
      }
      return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.grips.${system}.${key} no es una clave conocida` };
    }
    if (capability.default) {
      defaults += 1;
      if (defaults > 1) {
        return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY} declara más de un sistema por defecto` };
      }
    }
    grips[system] = capability;
  }

  let byFurnitureType: OpeningCapabilities['byFurnitureType'];
  if (blob.byFurnitureType !== undefined && blob.byFurnitureType !== null) {
    if (!isRecord(blob.byFurnitureType)) {
      return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.byFurnitureType debe ser un objeto` };
    }
    const byType: Record<string, OpeningFurnitureTypeCapabilities> = {};
    for (const [furnitureType, typeEntry] of Object.entries(blob.byFurnitureType)) {
      if (!FURNITURE_TYPES.includes(furnitureType as FurnitureTypeKey)) {
        return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.byFurnitureType.${furnitureType} no es un tipo de mueble conocido` };
      }
      if (!isRecord(typeEntry)) {
        return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.byFurnitureType.${furnitureType} debe ser un objeto` };
      }
      for (const key of Object.keys(typeEntry)) {
        if (key !== 'grips') {
          return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.byFurnitureType.${furnitureType}.${key} no es una clave conocida` };
        }
      }
      const gripsForTypeRaw = typeEntry.grips;
      if (!isRecord(gripsForTypeRaw)) {
        return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.byFurnitureType.${furnitureType}.grips debe ser un objeto` };
      }
      const gripsForType: Record<string, OpeningFurnitureTypeGrip> = {};
      for (const [system, gripEntry] of Object.entries(gripsForTypeRaw)) {
        if (!GRIP_SYSTEMS.includes(system as OpeningGripSystem)) {
          return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.byFurnitureType.${furnitureType}.grips.${system} no es un sistema conocido` };
        }
        if (!isRecord(gripEntry)) {
          return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.byFurnitureType.${furnitureType}.grips.${system} debe ser un objeto` };
        }
        const grip: { placements?: OpeningPlacementKey[]; default?: boolean } = {};
        for (const [key, value] of Object.entries(gripEntry)) {
          if (key === 'placements') {
            if (!Array.isArray(value) || value.length === 0) {
              return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.byFurnitureType.${furnitureType}.grips.${system}.placements debe ser una lista no vacía` };
            }
            const placements: OpeningPlacementKey[] = [];
            for (const item of value) {
              if (typeof item !== 'string' || !PLACEMENTS.includes(item as OpeningPlacementKey)) {
                return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.byFurnitureType.${furnitureType}.grips.${system}.placements tiene una placement desconocida` };
              }
              placements.push(item as OpeningPlacementKey);
            }
            grip.placements = placements;
            continue;
          }
          if (key === 'default') {
            if (typeof value !== 'boolean') {
              return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.byFurnitureType.${furnitureType}.grips.${system}.default debe ser booleano` };
            }
            grip.default = value;
            continue;
          }
          return { ok: false, message: `${OPENING_CAPABILITIES_BLOB_KEY}.byFurnitureType.${furnitureType}.grips.${system}.${key} no es una clave conocida` };
        }
        gripsForType[system] = grip;
      }
      byType[furnitureType] = { grips: gripsForType };
    }
    byFurnitureType = byType;
  }

  return {
    ok: true,
    capabilities: { version: 1, grips, ...(byFurnitureType ? { byFurnitureType } : {}) },
  };
}

/** The systems the factory offers (enabled) — the "available" set for new
 * authoring. Validity stays with the resolver (#1131). */
export function availableOpeningSystems(
  capabilities: OpeningCapabilities | null,
): readonly OpeningGripSystem[] {
  if (!capabilities) {
    return GRIP_SYSTEMS.filter(
      (system) => DEFAULT_OPENING_CAPABILITIES.grips[system]?.enabled,
    );
  }
  return GRIP_SYSTEMS.filter((system) => capabilities.grips[system]?.enabled);
}

/** The overlay keys the opening capabilities own (one literal blob key) —
 * the save path merges by owned keys so foreign overrides survive (#943
 * lesson). */
export function isOpeningCapabilitiesOwnedKey(key: string): boolean {
  return key === OPENING_CAPABILITIES_BLOB_KEY;
}

/** Serialize the capabilities into its overlay overrides entry. */
export function openingCapabilitiesToOverlayOverrides(
  capabilities: OpeningCapabilities,
): Record<string, unknown> {
  return { [OPENING_CAPABILITIES_BLOB_KEY]: capabilities };
}
