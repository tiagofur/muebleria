/**
 * Opening overhang rule (#1138) — the factory's BACKED rule for the case C
 * `bottom_overhang` positioning: the one declared millimetre the front
 * extends below the body bottom. Shared with the Go engine through
 * contracts/openingOverhangRule.contract.json — the parsers must never
 * diverge (ADR-0009 §7), same pattern as `opening.capabilities` (#1134).
 *
 * Why a dedicated blob: #1134 pinned that `opening.capabilities` carries NO
 * dimensions (unknown keys fail closed so millimetres can never ride in as
 * "capabilities"), and case C consumes no OpeningProfile (no grip hardware)
 * — the rule is the third legitimate home of declared millimetres: profile
 * datasheets, profile body modifiers, and this versioned factory rule.
 *
 * Absent blob = no backed rule: the resolution stays BLOCKED
 * (OPENING_OVERHANG_EVIDENCE_PENDING, the truthful #1135 state). Present and
 * valid = case C resolves exactly per the §6 matrix (door extends below the
 * cabinet bottom; body unchanged; no grip hardware). The overlay composes
 * into pinned releases, so a rule arriving later never rewrites historical
 * pinned designs.
 */

export const OPENING_OVERHANG_RULE_BLOB_KEY = 'opening.bottom-overhang';

export type OpeningOverhangRule = {
  readonly version: 1;
  /** Positive integer millimetres the front extends below the body. */
  readonly overhangMm: number;
};

export type OpeningOverhangRuleParseResult =
  | { readonly ok: true; readonly rule: OpeningOverhangRule | null }
  | { readonly ok: false; readonly message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Decode the `opening.bottom-overhang` blob from an organization overlay's
 * overrides. null = no backed rule (the blob or the whole overlay is
 * absent). Identical to the Go engine through the shared fixture.
 */
export function parseOpeningOverhangRule(overrides: unknown): OpeningOverhangRuleParseResult {
  if (overrides === undefined || overrides === null) {
    return { ok: true, rule: null };
  }
  if (!isRecord(overrides)) {
    return { ok: false, message: 'overlay overrides are not a JSON object' };
  }
  const blob = overrides[OPENING_OVERHANG_RULE_BLOB_KEY];
  if (blob === undefined || blob === null) {
    return { ok: true, rule: null };
  }
  if (!isRecord(blob)) {
    return { ok: false, message: `${OPENING_OVERHANG_RULE_BLOB_KEY} must be an object` };
  }
  if (blob.version !== 1) {
    return {
      ok: false,
      message: `${OPENING_OVERHANG_RULE_BLOB_KEY}.version must be 1 (una versión futura no se interpreta)`,
    };
  }
  for (const key of Object.keys(blob)) {
    if (key !== 'version' && key !== 'overhangMm') {
      return {
        ok: false,
        message: `${OPENING_OVERHANG_RULE_BLOB_KEY}.${key} no es una clave conocida`,
      };
    }
  }
  if (typeof blob.overhangMm !== 'number' || !Number.isInteger(blob.overhangMm) || blob.overhangMm <= 0) {
    return {
      ok: false,
      message: `${OPENING_OVERHANG_RULE_BLOB_KEY}.overhangMm debe ser un entero positivo`,
    };
  }
  return { ok: true, rule: { version: 1, overhangMm: blob.overhangMm } };
}
