/**
 * Opening capabilities (#1134) — the SHAPE of the catalog read
 * GET /api/catalog/opening-capabilities and of the design-opening write gate.
 * Since #1531 the server projects it from the workshop's grip styles; the
 * overlay blob it used to be parsed from is retired, so there is no parser
 * here any more.
 */

/** Grip-system vocabulary (ADR-0009 §3/§7); "none" is the absence of a
 * selection, not a capability entry. */
export type OpeningGripSystem = 'handle' | 'gola' | 'bottom_overhang';

export type FurnitureTypeKey = 'inferior' | 'superior' | 'alto';

export type OpeningPlacementKey = 'top' | 'between' | 'bottom';

/** The gola profile's own cross-section vocabulary — the standard-profile
 * map is keyed by it (#1329). */
export type OpeningGolaSectionKey = 'L' | 'C' | 'J' | 'flat';

export type OpeningGripCapability = {
  readonly enabled: boolean;
  /** Preselected system for new authoring; at most one (parser-enforced). */
  readonly default?: boolean;
  /** Curated profile ids for gola (exact library ids; absent/empty =
   * curation pending — never a wildcard). */
  readonly profiles?: readonly string[];
  /** #1329 — the workshop's STANDARD profile per gola section (gola only,
   * one per section, each value part of `profiles`). A standard whose
   * profile deactivates/disappears resolves to NO standard on the consumer
   * (fail-closed, never an invented fallback). */
  readonly standardProfiles?: Readonly<Partial<Record<OpeningGolaSectionKey, string>>>;
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
