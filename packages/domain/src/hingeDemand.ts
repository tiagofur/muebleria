/**
 * Door hinge demand by height band (#1078).
 *
 * A 2100 mm pantry door and a 720 mm cabinet door cannot buy the same hinge
 * count: demand DERIVES from the door's height through industry-standard
 * bands (Blum/Hettich/Salice agree on the ladder), +1 Blum width surge for
 * wide doors. The band is a library default the factory policy and the
 * per-component exception can override (the C3 ladder, same shape as #875).
 *
 * Pure domain logic — no IO, no React. 100% testable and pinned to
 * contracts/hingeDemandBands.contract.json, which the Go engine consumes in
 * its own parity test: one authority for the band ladder on both sides.
 *
 * This is DEMAND (what gets purchased). Drilling positions (F129,
 * jointDrillingRules.hingePositions) consume the same count source so the
 * cups drilled always equal the hinges bought.
 */

/** Option group consumed by the band demand when the policy names no other. */
export const HINGE_DEMAND_ROLE = 'BISAGRA';

/** Line description surfaced on band-derived resolved hardware lines. */
export const HINGE_DEMAND_DESCRIPTION = 'Banda por altura de puerta';

/** Resolved line ID prefix for band-derived demand (origin marker). */
export const HINGE_DEMAND_LINE_PREFIX = 'hingeband-';

/** One band: doors up to (inclusive) upToHeightMm buy `hinges` hinges. */
export interface HingeDemandBand {
  readonly upToHeightMm: number;
  readonly hinges: number;
}

/**
 * The band policy. `bands` must ascend by upToHeightMm; doors taller than the
 * last band clamp to it. `widthSurgeOverMm` is the Blum rule: +1 hinge when
 * the door width exceeds it (a missing width never triggers the surge —
 * never invented). `optionRole` names the consumed group (default BISAGRA).
 */
export interface HingeDemandPolicy {
  readonly optionRole?: string;
  readonly bands: readonly HingeDemandBand[];
  readonly widthSurgeOverMm?: number | null;
}

/** Library default (#1078 — industria: Blum/Hettich/Salice). */
export const DEFAULT_HINGE_DEMAND_POLICY: HingeDemandPolicy = {
  bands: [
    { upToHeightMm: 900, hinges: 2 },
    { upToHeightMm: 1600, hinges: 3 },
    { upToHeightMm: 2000, hinges: 4 },
    { upToHeightMm: 2400, hinges: 5 },
  ],
  widthSurgeOverMm: 650,
};

/**
 * What one door buys under a policy, with the provenance of the last row
 * (#1579). `aboveLastBand` is true when the door is taller than the table's
 * last band: the count clamps to that row and the surface must say so (the
 * owner's rule: use the maximum, never stay silent, never block).
 */
export interface HingeCount {
  readonly hinges: number;
  readonly aboveLastBand: boolean;
  /** Height of the table's last band (the clamp row); null for no door. */
  readonly lastBandHeightMm: number | null;
}

/**
 * Hinges DEMANDED by one door. Bands are the height ladder, the surge is the
 * Blum width rule; both come from the (possibly factory-overridden) policy.
 * A non-positive height demands nothing.
 */
export function hingesForDoor(
  doorHeightMm: number,
  doorWidthMm: number | undefined,
  policy?: HingeDemandPolicy,
): number {
  return resolveHingeCount(doorHeightMm, doorWidthMm, policy).hinges;
}

/**
 * `hingesForDoor` with the last-band provenance (#1579). One implementation
 * serves both, so the numeric half can never drift from the Go mirror
 * (domain.ResolveHingeCount) — pinned by contracts/hingeDemandBands.contract.json.
 */
export function resolveHingeCount(
  doorHeightMm: number,
  doorWidthMm: number | undefined,
  policy?: HingeDemandPolicy,
): HingeCount {
  if (!(doorHeightMm > 0)) {
    return { hinges: 0, aboveLastBand: false, lastBandHeightMm: null };
  }
  // No policy = the whole library default (bands AND surge). A present
  // policy owns its bands; an omitted surge inherits the default rule and an
  // explicit null disables it (factory policies may opt out of the surge).
  const effective: HingeDemandPolicy = policy ?? DEFAULT_HINGE_DEMAND_POLICY;
  const bands =
    effective.bands && effective.bands.length > 0
      ? effective.bands
      : DEFAULT_HINGE_DEMAND_POLICY.bands;
  let hinges = 0;
  let matched = false;
  for (const band of bands) {
    if (doorHeightMm <= band.upToHeightMm) {
      hinges = Math.max(0, Math.trunc(band.hinges));
      matched = true;
      break;
    }
  }
  const lastBand = bands[bands.length - 1]!;
  if (!matched) {
    hinges = Math.max(0, Math.trunc(lastBand.hinges));
  }
  const surge =
    effective.widthSurgeOverMm === undefined
      ? DEFAULT_HINGE_DEMAND_POLICY.widthSurgeOverMm
      : effective.widthSurgeOverMm;
  if (
    typeof surge === 'number' &&
    surge > 0 &&
    typeof doorWidthMm === 'number' &&
    doorWidthMm > surge
  ) {
    hinges += 1;
  }
  return {
    hinges,
    aboveLastBand: !matched,
    lastBandHeightMm: lastBand.upToHeightMm,
  };
}

/**
 * The visible warning for a door taller than the table's last row (#1579,
 * owner decision 3). Mirrors domain.HingeDemandAboveLastBandMessage character
 * for character — the parity fixture pins the sentence on both stacks.
 */
export function hingeDemandNotice(doorHeightMm: number, count: HingeCount): string | undefined {
  if (!count.aboveLastBand) return undefined;
  return `La puerta mide ${doorHeightMm} mm: supera la última banda de la tabla (${count.lastBandHeightMm ?? 0} mm). Se aplican ${count.hinges} bisagras por puerta.`;
}

/**
 * The engine notices carried by a resolved BOM's hardware lines (#1579) —
 * unique, in first-appearance order. A furniture with several doors under
 * the same hinge shows one warning, not one per door.
 */
export function resolvedHardwareNotices(
  hardwareLines: readonly { readonly notice?: string }[],
): string[] {
  const notices: string[] = [];
  for (const line of hardwareLines) {
    const notice = line.notice?.trim();
    if (notice && !notices.includes(notice)) notices.push(notice);
  }
  return notices;
}

/** Bounds of the quantity a hinge may declare per band (#1579: 2 to 5). */
export const HINGE_TABLE_MIN_HINGES = 2;
export const HINGE_TABLE_MAX_HINGES = 5;

/**
 * Why the table a hinge declares is unusable, or null when it is valid
 * (#1579): non-empty, ascending positive heights, whole hinge counts within
 * 2..5, a non-negative surge. `optionRole` has no meaning on a hinge's own
 * table — the hinge IS the chosen hardware — so a declared role is refused
 * rather than ignored. Mirrors domain.ValidateHingeDemandTable message for
 * message (the web rejects before the round-trip what the server would 422).
 */
export function validateHingeDemandTable(
  policy: HingeDemandPolicy | null | undefined,
): string | null {
  if (!policy) return null;
  if (policy.optionRole?.trim()) {
    return 'la tabla de bisagras por altura de un herraje no admite optionRole';
  }
  if (!policy.bands || policy.bands.length === 0) {
    return 'la tabla de bisagras por altura debe tener al menos una banda';
  }
  let previous = 0;
  for (const [i, band] of policy.bands.entries()) {
    const path = `bands[${i}]`;
    if (!Number.isFinite(band.upToHeightMm) || band.upToHeightMm <= 0 || band.upToHeightMm <= previous) {
      return `${path}.upToHeightMm debe ser positivo y ascendente (anterior ${previous})`;
    }
    previous = band.upToHeightMm;
    if (
      !Number.isInteger(band.hinges) ||
      band.hinges < HINGE_TABLE_MIN_HINGES ||
      band.hinges > HINGE_TABLE_MAX_HINGES
    ) {
      return `${path}.hinges debe ser un entero entre ${HINGE_TABLE_MIN_HINGES} y ${HINGE_TABLE_MAX_HINGES}`;
    }
  }
  const surge = policy.widthSurgeOverMm;
  if (typeof surge === 'number' && (!Number.isFinite(surge) || surge < 0)) {
    return 'widthSurgeOverMm debe ser un número no negativo';
  }
  return null;
}

/** Effective option role a policy consumes (BISAGRA default). */
export function hingeDemandRole(policy?: HingeDemandPolicy): string {
  const role = policy?.optionRole?.trim();
  return role ? role : HINGE_DEMAND_ROLE;
}
