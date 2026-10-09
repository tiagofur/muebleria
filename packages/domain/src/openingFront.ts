/**
 * Opening / Front contract v1 (#1128/#1129) — the canonical declarative
 * INTENT and its RESOLVED result, shared with the Go engine through
 * contracts/openingFrontResolution.contract.json (one authority; TS parity
 * only, never a second resolver — ADR-0009).
 *
 * Layers (authored intent, never derived values):
 *   - Opening Layout: zones (top→bottom / left→right), access, integer ratios.
 *   - Grip System:    which boundaries carry a grip and with which profile.
 *   - Positioning:    overlay | inset | partial_overlay | bottom_overhang.
 *
 * Resolution math (contract v1, deterministic, integer millimetres):
 *   available = frontHeight − Σ(frontReduction + clearance of every grip)
 *   height_i  = floor(available × ratio_i / Σratios)
 *   remainder = available − Σheights, distributed 1 mm per zone starting at
 *   the LAST zone moving up (remainderZonePolicy = "last_zone_first", fixed
 *   in v1). Internal math is integer; canonical outputs are integer mm.
 *
 * Fail-closed by design: a profile whose datasheet is not verified blocks
 * authoring (OPENING_PROFILE_DATASHEET_PENDING); bottom_overhang blocks on
 * pending field evidence (OPENING_OVERHANG_EVIDENCE_PENDING, OQ-3). Nothing
 * is invented.
 */

export const OPENING_FRONT_CONTRACT = 'granete.opening-front.v1' as const;

export type OpeningLayoutDirection = 'vertical' | 'horizontal';

export type OpeningZoneAccess =
  | 'hinged'
  | 'drawer'
  | 'lift_up'
  | 'fold_up'
  | 'pull_out';

export type OpeningZone = {
  readonly id: string;
  readonly access: OpeningZoneAccess;
  /** Positive integer weight for the height/width share. */
  readonly ratio: number;
};

export type OpeningLayout = {
  readonly direction: OpeningLayoutDirection;
  /** Ordered: first zone is topmost (vertical) or leftmost (horizontal). */
  readonly zones: readonly OpeningZone[];
};

/** The grip boundary kinds. `between` names its two adjacent zones. */
export type OpeningGripBoundaryKind = 'top' | 'between' | 'bottom';

export type OpeningGrip = {
  readonly boundary: OpeningGripBoundaryKind;
  /** `between` only: the zone ABOVE the boundary. */
  readonly aboveZone?: string;
  /** `between` only: the zone BELOW the boundary. */
  readonly belowZone?: string;
  /** Exact library profile id, pinned by release (#1102). */
  readonly profileId: string;
};

export type OpeningPositioning =
  | 'overlay'
  | 'inset'
  | 'partial_overlay'
  | 'bottom_overhang';

export type OpeningIntent = {
  readonly layout: OpeningLayout;
  readonly grips: readonly OpeningGrip[];
  readonly positioning: OpeningPositioning;
};

/** Library profile data the resolution consumes (datasheet-backed, profile issue). */
export type OpeningProfileData = {
  readonly profileId: string;
  /** Only "verified" resolves; anything else blocks authoring. */
  readonly datasheetStatus: 'verified' | `pending_${string}`;
  readonly frontReductionMm: number;
  readonly gripClearanceMm: number;
};

export type OpeningResolvedZone = {
  readonly id: string;
  readonly heightMm: number;
  readonly offsetFromStartMm: number;
};

export type OpeningResolvedBoundary = {
  /** "top" | "bottom" | "between:<above>:<below>" */
  readonly boundary: string;
  readonly consumedMm: number;
};

export type OpeningResolution = {
  readonly availableFrontHeightMm: number;
  readonly zones: readonly OpeningResolvedZone[];
  readonly boundaries: readonly OpeningResolvedBoundary[];
  /** The zone that received the rounding remainder (policy: last zone first). */
  readonly remainderZoneId: string;
};

/** Error codes the contract defines — Go mirrors them verbatim. */
export type OpeningResolutionErrorCode =
  | 'OPENING_LAYOUT_INVALID'
  | 'OPENING_BOUNDARY_INVALID'
  | 'OPENING_BOUNDARY_DUPLICATE'
  | 'OPENING_BOUNDARY_UNKNOWN_ZONE'
  | 'OPENING_PROFILE_DATASHEET_PENDING'
  | 'OPENING_PROFILE_UNKNOWN'
  | 'OPENING_OVERHANG_EVIDENCE_PENDING';

export type OpeningResolutionResult =
  | { readonly ok: true; readonly resolution: OpeningResolution }
  | { readonly ok: false; readonly errorCode: OpeningResolutionErrorCode; readonly message: string };

interface OpeningProfileLookup {
  readonly profiles: readonly OpeningProfileData[];
  /** #1138 case C: the factory's BACKED overhang rule (the versioned
   * `opening.bottom-overhang` blob, parsed fail-closed). Absent = no backed
   * rule: `bottom_overhang` stays BLOCKED (OQ-3 evidence pending, verbatim).
   * Present = the front extends below the body by exactly this value. */
  readonly overhangMm?: number;
}

/** The one boundary key format of the contract ("between:<above>:<below>"),
 * shared with the #1131 semantic layer so the format never drifts. */
export const boundaryKey = (grip: OpeningGrip): string => {
  if (grip.boundary === 'between') {
    return `between:${grip.aboveZone ?? ''}:${grip.belowZone ?? ''}`;
  }
  return grip.boundary;
};

/**
 * Resolve the front heights of an opening intent. Pure, deterministic,
 * integer millimetres; identical to the Go engine through the shared
 * fixture. Never mutates, never invents: blocked evidence → blocked result.
 */
export function resolveOpeningFront(
  intent: OpeningIntent,
  cabinetFrontHeightMm: number,
  lookup: OpeningProfileLookup,
): OpeningResolutionResult {
  const zones = intent.layout.zones;
  if (zones.length === 0) {
    return fail('OPENING_LAYOUT_INVALID', 'la composición de frentes no tiene zonas');
  }
  const seen = new Set<string>();
  for (const zone of zones) {
    if (seen.has(zone.id)) {
      return fail('OPENING_LAYOUT_INVALID', `zona duplicada ${zone.id}`);
    }
    seen.add(zone.id);
    if (!Number.isInteger(zone.ratio) || zone.ratio <= 0) {
      return fail('OPENING_LAYOUT_INVALID', `la zona ${zone.id} tiene un ratio inválido`);
    }
  }

  if (intent.positioning === 'bottom_overhang') {
    // #1138 case C: the behaviour resolves ONLY against a backed rule (the
    // versioned `opening.bottom-overhang` blob). Without one, OQ-3 field
    // evidence is still pending — the intent is valid, the resolution is
    // blocked, nothing is invented. A malformed rule value is an incompatible
    // input, not a silent default.
    if (lookup.overhangMm === undefined) {
      return fail(
        'OPENING_OVERHANG_EVIDENCE_PENDING',
        'el rebase inferior espera evidencia de campo (OQ-3)',
      );
    }
    if (!Number.isInteger(lookup.overhangMm) || lookup.overhangMm <= 0) {
      return fail(
        'OPENING_LAYOUT_INVALID',
        'la regla de voladizo debe ser un entero positivo',
      );
    }
  }

  const zoneIndex = new Map(zones.map((z, i) => [z.id, i] as const));
  const boundaryKeys = new Set<string>();
  let consumed = 0;
  const resolvedBoundaries: OpeningResolvedBoundary[] = [];
  for (const grip of intent.grips) {
    const key = boundaryKey(grip);
    if (boundaryKeys.has(key)) {
      return fail('OPENING_BOUNDARY_DUPLICATE', `frontera duplicada ${key}`);
    }
    boundaryKeys.add(key);
    if (grip.boundary === 'between') {
      const above = zoneIndex.get(grip.aboveZone ?? '');
      const below = zoneIndex.get(grip.belowZone ?? '');
      if (above === undefined || below === undefined) {
        return fail(
          'OPENING_BOUNDARY_UNKNOWN_ZONE',
          `frontera ${key} referencia una zona desconocida`,
        );
      }
      if (below !== above + 1) {
        return fail('OPENING_BOUNDARY_INVALID', `frontera ${key} entre zonas no adyacentes`);
      }
    }
    const profile = lookup.profiles.find((p) => p.profileId === grip.profileId);
    if (!profile) {
      return fail('OPENING_PROFILE_UNKNOWN', `perfil desconocido ${grip.profileId}`);
    }
    if (profile.datasheetStatus !== 'verified') {
      return fail(
        'OPENING_PROFILE_DATASHEET_PENDING',
        `el perfil ${grip.profileId} espera ficha técnica`,
      );
    }
    const take = profile.frontReductionMm + profile.gripClearanceMm;
    consumed += take;
    resolvedBoundaries.push({ boundary: key, consumedMm: take });
  }

  const available = cabinetFrontHeightMm - consumed;
  if (!(available > 0)) {
    return fail('OPENING_LAYOUT_INVALID', 'los grips consumen más que la altura del frente');
  }
  const ratioSum = zones.reduce((sum, z) => sum + z.ratio, 0);

  // Integer math only: floors + explicit remainder distribution.
  const heights = zones.map((z) => Math.floor((available * z.ratio) / ratioSum));
  let remainder = available - heights.reduce((sum, h) => sum + h, 0);
  const remainderZoneId = zones[zones.length - 1]!.id;
  for (let i = zones.length - 1; i >= 0 && remainder > 0; i--) {
    heights[i]! += 1;
    remainder -= 1;
  }

  const resolvedZones: OpeningResolvedZone[] = [];
  let offset = 0;
  zones.forEach((zone, i) => {
    resolvedZones.push({ id: zone.id, heightMm: heights[i]!, offsetFromStartMm: offset });
    offset += heights[i]!;
  });

  return {
    ok: true,
    resolution: {
      availableFrontHeightMm: available,
      zones: resolvedZones,
      boundaries: resolvedBoundaries,
      remainderZoneId,
    },
  };
}

function fail(
  errorCode: OpeningResolutionErrorCode,
  message: string,
): OpeningResolutionResult {
  return { ok: false, errorCode, message };
}
