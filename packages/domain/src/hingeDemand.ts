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
 * Hinges DEMANDED by one door. Bands are the height ladder, the surge is the
 * Blum width rule; both come from the (possibly factory-overridden) policy.
 * A non-positive height demands nothing.
 */
export function hingesForDoor(
  doorHeightMm: number,
  doorWidthMm: number | undefined,
  policy?: HingeDemandPolicy,
): number {
  if (!(doorHeightMm > 0)) return 0;
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
  if (!matched) {
    hinges = Math.max(0, Math.trunc(bands[bands.length - 1]!.hinges));
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
  return hinges;
}

/** Effective option role a policy consumes (BISAGRA default). */
export function hingeDemandRole(policy?: HingeDemandPolicy): string {
  const role = policy?.optionRole?.trim();
  return role ? role : HINGE_DEMAND_ROLE;
}
