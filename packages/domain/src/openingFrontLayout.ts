/**
 * Opening Layout resolver (#1131) — the semantic layer of the opening/front
 * contract v1 on top of resolveOpeningFront (#1129): zones, ratios and grip
 * boundaries become canonical FRONT results, shared with the Go engine
 * through contracts/openingFrontResolution.contract.json (one authority; TS
 * parity only, never a second resolver — ADR-0009).
 *
 * Axis mapping (pinned by the shared fixture): a `vertical` layout divides
 * the cabinet front HEIGHT (zones stack top→bottom); a `horizontal` layout
 * divides the front WIDTH (zones left→right). The cross axis passes through
 * untouched — every zone of the layout spans it. Front offsets measure along
 * the divided axis from the start of the available region, in zone order.
 *
 * Grip sides are resolved data (OQ-1), derived from boundary incidence:
 *   - `top`    grips from ABOVE every zone it touches: ALL zones in a
 *     horizontal layout (they all span the height), only the FIRST in a
 *     vertical one.
 *   - `bottom` grips from BELOW: ALL zones in a horizontal layout, only the
 *     LAST in a vertical one.
 *   - `between(a,b)` grips a from BELOW and b from ABOVE.
 *
 * Identity is stable because it is declared: the zone id from the authored
 * layout — component names are never consulted.
 *
 * Fail-closed: unknown direction/access, non-positive front dimensions or an
 * empty zone id are incompatible inputs and fail OPENING_LAYOUT_INVALID
 * BEFORE the v1 math runs; every v1 error (pending datasheet, OQ-3 overhang,
 * boundary problems) propagates verbatim. Nothing is invented.
 */

import {
  OPENING_FRONT_CONTRACT,
  boundaryKey,
  resolveOpeningFront,
  type OpeningIntent,
  type OpeningProfileData,
  type OpeningResolution,
  type OpeningResolutionErrorCode,
  type OpeningZoneAccess,
} from './openingFront';

/** Where the grip sits relative to the front it grips. */
export type OpeningGripSide = 'above' | 'below';

export type OpeningResolvedFrontGrip = {
  /** "top" | "bottom" | "between:<above>:<below>" — same key format as v1. */
  readonly boundary: string;
  readonly side: OpeningGripSide;
  readonly profileId: string;
  readonly consumedMm: number;
};

/** The rules applied to one front — declared inputs, never derived values. */
export type OpeningResolvedFrontRules = {
  readonly direction: OpeningIntent['layout']['direction'];
  readonly positioning: OpeningIntent['positioning'];
  readonly ratio: number;
  readonly ratioSum: number;
  /** This zone is the policy target of the rounding remainder (last zone). */
  readonly remainderTarget: boolean;
};

/** Canonical result for one zone: stable identity, declared access,
 * axis-mapped box and resolved grip/rules data. */
export type OpeningResolvedFront = {
  readonly zoneId: string;
  readonly access: OpeningZoneAccess;
  readonly widthMm: number;
  readonly heightMm: number;
  /** Position along the layout axis from the available region start. */
  readonly offsetMm: number;
  readonly grips: readonly OpeningResolvedFrontGrip[];
  readonly rules: OpeningResolvedFrontRules;
  /** #1138 case C only: the backed `opening.bottom-overhang` value this
   * front extends below the body bottom. Absent = no overhang (the body
   * region is the whole front). `heightMm` already includes it — the field
   * declares the extension so the cut is auditable against the rule. */
  readonly overhangMm?: number;
};

/** The #1131 semantic result: the v1 resolution verbatim plus one front per
 * zone. */
export type OpeningFrontLayout = {
  readonly contract: typeof OPENING_FRONT_CONTRACT;
  readonly resolution: OpeningResolution;
  readonly fronts: readonly OpeningResolvedFront[];
};

export type OpeningFrontLayoutResult =
  | { readonly ok: true; readonly layout: OpeningFrontLayout }
  | { readonly ok: false; readonly errorCode: OpeningResolutionErrorCode; readonly message: string };

interface OpeningProfileLookup {
  readonly profiles: readonly OpeningProfileData[];
}

const OPENING_ZONE_ACCESS_VALUES: readonly OpeningZoneAccess[] = [
  'hinged',
  'drawer',
  'lift_up',
  'fold_up',
  'pull_out',
];

/**
 * Resolve an opening intent into semantic fronts. Pure, deterministic,
 * integer millimetres; identical to the Go engine through the shared
 * fixture. Shape errors fail closed before the v1 math; v1 errors propagate
 * verbatim.
 */
export function resolveOpeningFrontLayout(
  intent: OpeningIntent,
  cabinetFrontWidthMm: number,
  cabinetFrontHeightMm: number,
  lookup: OpeningProfileLookup,
): OpeningFrontLayoutResult {
  if (intent.layout.direction !== 'vertical' && intent.layout.direction !== 'horizontal') {
    return fail(
      'OPENING_LAYOUT_INVALID',
      `dirección de layout desconocida ${intent.layout.direction}`,
    );
  }
  if (
    !Number.isInteger(cabinetFrontWidthMm) ||
    !Number.isInteger(cabinetFrontHeightMm) ||
    cabinetFrontWidthMm <= 0 ||
    cabinetFrontHeightMm <= 0
  ) {
    return fail('OPENING_LAYOUT_INVALID', 'las dimensiones del frente deben ser mayores a 0');
  }
  for (const zone of intent.layout.zones) {
    if (zone.id.trim().length === 0) {
      return fail(
        'OPENING_LAYOUT_INVALID',
        'toda zona necesita un id declarado para tener identidad estable',
      );
    }
    if (!OPENING_ZONE_ACCESS_VALUES.includes(zone.access)) {
      return fail(
        'OPENING_LAYOUT_INVALID',
        `la zona ${zone.id} tiene un access desconocido ${zone.access}`,
      );
    }
  }

  // Single math authority: the v1 resolver over the divided axis.
  const dividedAxisMm =
    intent.layout.direction === 'vertical' ? cabinetFrontHeightMm : cabinetFrontWidthMm;
  const step = resolveOpeningFront(intent, dividedAxisMm, lookup);
  if (!step.ok) {
    return step;
  }

  const crossMm = intent.layout.direction === 'vertical' ? cabinetFrontWidthMm : cabinetFrontHeightMm;
  const consumedByBoundary = new Map(
    step.resolution.boundaries.map((b) => [b.boundary, b.consumedMm] as const),
  );
  const ratioSum = intent.layout.zones.reduce((sum, z) => sum + z.ratio, 0);

  const fronts = step.resolution.zones.map((resolvedZone, i) => {
    const zone = intent.layout.zones[i]!;
    const horizontal = intent.layout.direction === 'horizontal';
    const front: OpeningResolvedFront = {
      zoneId: resolvedZone.id,
      access: zone.access,
      widthMm: horizontal ? resolvedZone.heightMm : crossMm,
      heightMm: horizontal ? crossMm : resolvedZone.heightMm,
      offsetMm: resolvedZone.offsetFromStartMm,
      grips: openingFrontGrips(intent, resolvedZone.id, consumedByBoundary),
      rules: {
        direction: intent.layout.direction,
        positioning: intent.positioning,
        ratio: zone.ratio,
        ratioSum,
        remainderTarget: resolvedZone.id === step.resolution.remainderZoneId,
      },
    };
    // #1138 case C: a backed rule extends exactly the fronts that touch the
    // bottom edge (same incidence as the grips: the last zone of a vertical
    // layout, every zone of a horizontal one) below the untouched body. The
    // v1 math divided the BODY height — the extension is declared on the
    // front, never borrowed from the body.
    if (
      intent.positioning === 'bottom_overhang' &&
      lookup.overhangMm !== undefined &&
      openingEdgeTouchesZone(intent, 'bottom', resolvedZone.id)
    ) {
      front.heightMm += lookup.overhangMm;
      front.overhangMm = lookup.overhangMm;
    }
    return front;
  });

  return {
    ok: true,
    layout: {
      contract: OPENING_FRONT_CONTRACT,
      resolution: step.resolution,
      fronts,
    },
  };
}

function openingFrontGrips(
  intent: OpeningIntent,
  zoneId: string,
  consumedByBoundary: ReadonlyMap<string, number>,
): readonly OpeningResolvedFrontGrip[] {
  const grips: OpeningResolvedFrontGrip[] = [];
  for (const grip of intent.grips) {
    const key = boundaryKey(grip);
    if (grip.boundary === 'top' || grip.boundary === 'bottom') {
      if (!openingEdgeTouchesZone(intent, grip.boundary, zoneId)) {
        continue;
      }
      grips.push({
        boundary: key,
        side: grip.boundary === 'top' ? 'above' : 'below',
        profileId: grip.profileId,
        consumedMm: consumedByBoundary.get(key) ?? 0,
      });
      continue;
    }
    if (grip.boundary === 'between') {
      if (grip.aboveZone === zoneId) {
        grips.push({
          boundary: key,
          side: 'below',
          profileId: grip.profileId,
          consumedMm: consumedByBoundary.get(key) ?? 0,
        });
      }
      if (grip.belowZone === zoneId) {
        grips.push({
          boundary: key,
          side: 'above',
          profileId: grip.profileId,
          consumedMm: consumedByBoundary.get(key) ?? 0,
        });
      }
    }
  }
  return grips;
}

/** Edge incidence: in a vertical layout the top edge only touches the first
 * zone and the bottom edge only the last; in a horizontal layout every zone
 * spans the full cross axis, so both edges touch every zone. */
function openingEdgeTouchesZone(
  intent: OpeningIntent,
  boundary: 'top' | 'bottom',
  zoneId: string,
): boolean {
  const zones = intent.layout.zones;
  if (zones.length === 0) {
    return false;
  }
  if (intent.layout.direction === 'vertical') {
    return boundary === 'top' ? zones[0]!.id === zoneId : zones[zones.length - 1]!.id === zoneId;
  }
  return zones.some((zone) => zone.id === zoneId);
}

function fail(
  errorCode: OpeningResolutionErrorCode,
  message: string,
): OpeningFrontLayoutResult {
  return { ok: false, errorCode, message };
}
