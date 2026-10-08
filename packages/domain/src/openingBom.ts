/**
 * Opening BOM resolver (#1133) — generates the profile + accessories BOM
 * from the #1131 layout resolution and the rules DECLARED by each profile's
 * bom_members (#1130). Shared with the Go engine through
 * contracts/openingBom.contract.json (one authority; TS parity only, never
 * a second resolver — ADR-0009). BOM consumes resolved geometry and profile
 * rules; it never becomes a second geometry engine.
 *
 * Canonical rules (pinned by the fixture):
 *   - 'interior_width' (profile run): the run length is EXACTLY the cabinet
 *     interior width — an input from the body context, never derived here —
 *     presented in meters (the v1 presentation unit) with the exact
 *     cutLengthMm alongside.
 *   - 'per_length' (supports): quantity = ceil(runLength/spacing) + 1, the
 *     SAME station convention the joinery resolver uses. The spacing ALWAYS
 *     comes from the datasheet member; per_length without a spacing fails
 *     closed — no invented spacing.
 *   - 'per_exposed_end' (end caps): one cap per RESOLVED exposed end (the
 *     caller declares left/right ∈ exposed|closed; the open/closed SKU
 *     variant is profile data, not resolver logic).
 *
 * Determinism and idempotence: line identity is boundary|memberKey, members
 * emit in the canonical order profile→supports→endCaps across the boundary
 * ledger order — re-resolving produces EXACTLY the same list. Each line
 * carries full provenance: profile id + version, boundary, rule.
 *
 * Fail-closed: OPENING_BOM_INVALID for unknown member keys (data corruption
 * is never silently dropped), rule/member mismatch or unknown rule, missing
 * unit on the run line, per_length without spacing, empty hardwareId,
 * version ≤ 0, non-positive interior width or unknown end conditions;
 * OPENING_PROFILE_UNKNOWN propagates. Nothing is invented.
 */

import type { OpeningFrontLayout } from './openingFrontLayout';
import type { OpeningResolutionErrorCode } from './openingFront';

export const OPENING_BOM_INVALID = 'OPENING_BOM_INVALID';

export type OpeningBOMErrorCode =
  | OpeningResolutionErrorCode
  | 'OPENING_BOM_INVALID';

export type OpeningBOMMemberKey = 'profile' | 'supports' | 'endCaps';

export type OpeningBOMUnit = 'meter' | 'piece';

export type OpeningEndCondition = 'exposed' | 'closed';

/** Contract shape of a declared BOM member (the persisted entity maps onto
 * this — one vocabulary, no third shape). */
export type OpeningContractBOMMember = {
  readonly hardwareId: string;
  readonly rule: string;
  readonly unit?: string;
  readonly spacingMm?: number;
};

/** The library slice the BOM resolution consumes (a projection of the #1130
 * entity — the storage layer maps it). Version is the revision every line
 * references. */
export type OpeningProfileBOMData = {
  readonly profileId: string;
  readonly version: number;
  readonly bomMembers: Readonly<Record<string, OpeningContractBOMMember>>;
};

/** The resolved end condition of the module's profile runs (design-level
 * fact; multi-module run aggregation is explicit later scope). */
export type OpeningBOMEndConditions = {
  readonly leftEnd: OpeningEndCondition;
  readonly rightEnd: OpeningEndCondition;
};

/** One deterministic BOM line: stable identity (boundary|memberKey), exact
 * quantity in a defined unit, full provenance. */
export type OpeningResolvedBOMLine = {
  readonly lineId: string;
  readonly memberKey: OpeningBOMMemberKey;
  readonly hardwareId: string;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly boundary: string;
  readonly rule: string;
  readonly quantity: number;
  readonly unit: OpeningBOMUnit;
  /** Profile-run lines only: the exact millimetre cut. */
  readonly cutLengthMm?: number;
};

export type OpeningBOMResolutionResult =
  | { readonly ok: true; readonly lines: readonly OpeningResolvedBOMLine[] }
  | { readonly ok: false; readonly errorCode: OpeningBOMErrorCode; readonly message: string };

const MEMBER_KEYS: readonly OpeningBOMMemberKey[] = ['profile', 'supports', 'endCaps'];

const resolveLine = (
  profile: OpeningProfileBOMData,
  key: OpeningBOMMemberKey,
  member: OpeningContractBOMMember,
  boundary: string,
  cabinetInteriorWidthMm: number,
  exposedEnds: number,
): { readonly ok: true; readonly line: OpeningResolvedBOMLine } | { readonly ok: false; readonly errorCode: OpeningBOMErrorCode; readonly message: string } => {
  if (member.hardwareId === '') {
    return fail('OPENING_BOM_INVALID', `el miembro ${key} del perfil ${profile.profileId} no declara SKU`);
  }
  const base = {
    lineId: `${boundary}|${key}`,
    memberKey: key,
    hardwareId: member.hardwareId,
    profileId: profile.profileId,
    profileVersion: profile.version,
    boundary,
    rule: member.rule,
  };
  if (key === 'profile') {
    if (member.rule !== 'interior_width') {
      return fail(
        'OPENING_BOM_INVALID',
        `la corrida del perfil ${profile.profileId} declara la regla desconocida "${member.rule}"`,
      );
    }
    if (member.unit !== 'meter') {
      return fail(
        'OPENING_BOM_INVALID',
        `la corrida del perfil ${profile.profileId} exige la unidad meter (presentación definida v1)`,
      );
    }
    return {
      ok: true,
      line: {
        ...base,
        unit: 'meter',
        cutLengthMm: cabinetInteriorWidthMm,
        quantity: cabinetInteriorWidthMm / 1000,
      },
    };
  }
  if (key === 'supports') {
    if (member.rule !== 'per_length') {
      return fail(
        'OPENING_BOM_INVALID',
        `los soportes del perfil ${profile.profileId} declara la regla desconocida "${member.rule}"`,
      );
    }
    if (member.spacingMm === undefined || member.spacingMm <= 0) {
      return fail(
        'OPENING_BOM_INVALID',
        `los soportes del perfil ${profile.profileId} exigen el spacing de ficha (no se inventa)`,
      );
    }
    if (member.unit !== undefined && member.unit !== 'piece') {
      return fail(
        'OPENING_BOM_INVALID',
        `los soportes del perfil ${profile.profileId} no pueden presentarse en "${member.unit}"`,
      );
    }
    // The joinery station convention: stations = ceil(span/spacing)+1.
    return {
      ok: true,
      line: {
        ...base,
        unit: 'piece',
        quantity: Math.ceil(cabinetInteriorWidthMm / member.spacingMm) + 1,
      },
    };
  }
  if (member.rule !== 'per_exposed_end') {
    return fail(
      'OPENING_BOM_INVALID',
      `las tapas del perfil ${profile.profileId} declaran la regla desconocida "${member.rule}"`,
    );
  }
  if (member.unit !== undefined && member.unit !== 'piece') {
    return fail(
      'OPENING_BOM_INVALID',
      `las tapas del perfil ${profile.profileId} no pueden presentarse en "${member.unit}"`,
    );
  }
  return { ok: true, line: { ...base, unit: 'piece', quantity: exposedEnds } };
};

/**
 * Generate the profile BOM lines for the layout's boundaries. Pure,
 * deterministic; identical to the Go engine through the shared fixture.
 */
export function resolveOpeningBOM(
  layout: OpeningFrontLayout,
  cabinetInteriorWidthMm: number,
  ends: OpeningBOMEndConditions,
  profiles: readonly OpeningProfileBOMData[],
): OpeningBOMResolutionResult {
  if (cabinetInteriorWidthMm <= 0) {
    return fail('OPENING_BOM_INVALID', 'el interior del gabinete debe ser mayor a 0 para dimensionar corridas');
  }
  for (const [name, value] of [
    ['leftEnd', ends.leftEnd],
    ['rightEnd', ends.rightEnd],
  ] as const) {
    if (value !== 'exposed' && value !== 'closed') {
      return fail('OPENING_BOM_INVALID', `la condición de extremo ${name}="${value}" no es válida (exposed|closed)`);
    }
  }
  const profileByID = new Map(profiles.map((p) => [p.profileId, p] as const));
  const profileByBoundary = new Map<string, string>();
  for (const front of layout.fronts) {
    for (const grip of front.grips) {
      profileByBoundary.set(grip.boundary, grip.profileId);
    }
  }

  const lines: OpeningResolvedBOMLine[] = [];
  for (const boundary of layout.resolution.boundaries) {
    const profileId = profileByBoundary.get(boundary.boundary);
    if (profileId === undefined) {
      continue;
    }
    const profile = profileByID.get(profileId);
    if (!profile) {
      return fail('OPENING_PROFILE_UNKNOWN', `perfil desconocido ${profileId}`);
    }
    if (profile.version <= 0) {
      return fail('OPENING_BOM_INVALID', `el perfil ${profileId} no tiene revisión referenciable`);
    }
    // Unknown member keys fail closed: silently dropping declared hardware
    // would under-quote the BOM. Sorted for deterministic reporting.
    const unknownKeys = Object.keys(profile.bomMembers)
      .filter((key) => !MEMBER_KEYS.includes(key as OpeningBOMMemberKey))
      .sort();
    if (unknownKeys.length > 0) {
      return fail(
        'OPENING_BOM_INVALID',
        `el perfil ${profileId} declara claves de BOM desconocidas ${JSON.stringify(unknownKeys)}`,
      );
    }
    const exposedEnds = (ends.leftEnd === 'exposed' ? 1 : 0) + (ends.rightEnd === 'exposed' ? 1 : 0);
    for (const key of MEMBER_KEYS) {
      const member = profile.bomMembers[key];
      if (!member) {
        continue;
      }
      const result = resolveLine(profile, key, member, boundary.boundary, cabinetInteriorWidthMm, exposedEnds);
      if (!result.ok) {
        return result;
      }
      lines.push(result.line);
    }
  }
  return { ok: true, lines };
}

function fail(
  errorCode: OpeningBOMErrorCode,
  message: string,
): { readonly ok: false; readonly errorCode: OpeningBOMErrorCode; readonly message: string } {
  return { ok: false, errorCode, message };
}
