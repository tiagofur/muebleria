/**
 * Opening body modifiers resolver (#1132) — applies the body modifiers
 * DECLARED by the Opening Profiles (data, not logic) onto the #1131 layout
 * resolution, producing the exact per-role effects. Shared with the Go
 * engine through contracts/openingBodyModifiers.contract.json (one
 * authority; TS parity only, never a second resolver — ADR-0009).
 *
 * Addressing is by ConstructiveRole vocabulary (#1052: horizontal | lateral
 * | shelf | back | door | divider | custom) — never by name; a role outside
 * the vocabulary fails closed (the doc's conceptual «techo» is not an
 * address).
 *
 * Effect rules (pinned by the fixture):
 *   - depth_reduction: only at a top/bottom boundary (the horizontal panel
 *     sitting behind the profile at that edge is shortened by the exact
 *     declared value).
 *   - notch: requires height + depth + NotchAt complete; NotchAt must match
 *     the boundary kind (top_front⇒top at offset 0, bottom_front⇒bottom at
 *     the available-region end, front_boundary⇒between at the end of the
 *     zone below the boundary) and the profile must declare the boundary
 *     kind among its compatible placements.
 *
 * The same effect on the same role+boundary applies ONCE: identical
 * duplicate declarations deduplicate; distinct values for the same target
 * are OPENING_BODY_MODIFIER_CONFLICT — L on top + C between never double a
 * reduction. Baseline (no grips) resolves to zero modifiers. Fail-closed:
 * unknown role, incomplete notch, incompatible position/effect/boundary
 * (OPENING_BODY_MODIFIER_INVALID), profile mounted at an undeclared boundary
 * kind (OPENING_BODY_MODIFIER_PLACEMENT_INVALID). Nothing is invented.
 */

import {
  OPENING_FRONT_CONTRACT,
  type OpeningResolutionErrorCode,
} from './openingFront';
import type { OpeningFrontLayout } from './openingFrontLayout';

export type OpeningModifierEffect = 'depth_reduction' | 'notch';

/** The position CLASS a profile declares; the resolver combines it with the
 * boundary into the exact offset. */
export type OpeningNotchAt = 'top_front' | 'bottom_front' | 'front_boundary';

/** Contract shape of a declared modifier (the persisted entity maps onto
 * this — one vocabulary, no third shape). */
export type OpeningContractBodyModifier = {
  /** Constructive role, never a name (#1052). */
  readonly role: string;
  readonly depthReductionMm?: number;
  readonly notchHeightMm?: number;
  readonly notchDepthMm?: number;
  readonly notchAt?: string;
};

/** The library slice the body-modifier resolution consumes (a projection of
 * the #1130 entity — the storage layer maps it). */
export type OpeningProfileBodyData = {
  readonly profileId: string;
  readonly compatiblePlacements: readonly string[];
  readonly bodyModifiers: readonly OpeningContractBodyModifier[];
};

/** One exact effect: stable identity (effect|role|boundary), target
 * constructive role, provenance (profile + boundary) and the complete
 * geometry the manufacturing pipeline consumes. */
export type ResolvedOpeningBodyModifier = {
  readonly effect: OpeningModifierEffect;
  readonly role: string;
  readonly profileId: string;
  readonly boundary: string;
  readonly depthReductionMm?: number;
  readonly notchHeightMm?: number;
  readonly notchDepthMm?: number;
  /** Offset along the front axis from the available-region start (same
   * coordinate system as the #1131 fronts' offsetMm). */
  readonly notchOffsetMm?: number;
};

export type OpeningBodyModifierErrorCode =
  | OpeningResolutionErrorCode
  | 'OPENING_BODY_MODIFIER_INVALID'
  | 'OPENING_BODY_MODIFIER_CONFLICT'
  | 'OPENING_BODY_MODIFIER_PLACEMENT_INVALID';

export type OpeningBodyModifierResolutionResult =
  | { readonly ok: true; readonly modifiers: readonly ResolvedOpeningBodyModifier[] }
  | { readonly ok: false; readonly errorCode: OpeningBodyModifierErrorCode; readonly message: string };

/** The #1052 ConstructiveRole vocabulary (mirrors the editor's select
 * options and the Go engine's validate map). */
const CONSTRUCTIVE_ROLES: readonly string[] = [
  'horizontal',
  'lateral',
  'shelf',
  'back',
  'door',
  'divider',
  'custom',
];

const boundaryKindOf = (boundaryKey: string): string => {
  const index = boundaryKey.indexOf(':');
  return index === -1 ? boundaryKey : boundaryKey.slice(0, index);
};

const placementCompatible = (placements: readonly string[], kind: string): boolean =>
  placements.some((placement) => placement === kind);

const identityOf = (modifier: ResolvedOpeningBodyModifier): string =>
  `${modifier.effect}|${modifier.role}|${modifier.boundary}`;

const sameEffect = (
  a: ResolvedOpeningBodyModifier,
  b: ResolvedOpeningBodyModifier,
): boolean => {
  if (a.effect !== b.effect) {
    return false;
  }
  if (a.effect === 'depth_reduction') {
    return a.depthReductionMm === b.depthReductionMm;
  }
  return (
    a.notchHeightMm === b.notchHeightMm &&
    a.notchDepthMm === b.notchDepthMm &&
    a.notchOffsetMm === b.notchOffsetMm
  );
};

/**
 * Resolve the declared body modifiers of every profile mounted in the
 * layout onto exact per-role effects. Pure, deterministic; identical to the
 * Go engine through the shared fixture.
 */
export function resolveOpeningBodyModifiers(
  layout: OpeningFrontLayout,
  profiles: readonly OpeningProfileBodyData[],
): OpeningBodyModifierResolutionResult {
  const profileByID = new Map(profiles.map((p) => [p.profileId, p] as const));
  const profileByBoundary = new Map<string, string>();
  for (const front of layout.fronts) {
    for (const grip of front.grips) {
      profileByBoundary.set(grip.boundary, grip.profileId);
    }
  }

  const resolved: ResolvedOpeningBodyModifier[] = [];
  const seen = new Map<string, ResolvedOpeningBodyModifier>();
  for (const boundary of layout.resolution.boundaries) {
    const profileId = profileByBoundary.get(boundary.boundary);
    if (profileId === undefined) {
      continue;
    }
    const profile = profileByID.get(profileId);
    if (!profile) {
      return fail('OPENING_PROFILE_UNKNOWN', `perfil desconocido ${profileId}`);
    }
    const kind = boundaryKindOf(boundary.boundary);
    if (!placementCompatible(profile.compatiblePlacements, kind)) {
      return fail(
        'OPENING_BODY_MODIFIER_PLACEMENT_INVALID',
        `el perfil ${profileId} no declara compatible la frontera ${kind}`,
      );
    }
    for (const modifier of profile.bodyModifiers) {
      const effect = resolveEffect(modifier, kind, layout.resolution.availableFrontHeightMm, layout.fronts, boundary.boundary);
      if (!effect.ok) {
        return effect;
      }
      const resolvedModifier: ResolvedOpeningBodyModifier = {
        ...effect.modifier,
        profileId,
        boundary: boundary.boundary,
      };
      const key = identityOf(resolvedModifier);
      const previous = seen.get(key);
      if (previous) {
        if (sameEffect(previous, resolvedModifier)) {
          continue;
        }
        return fail(
          'OPENING_BODY_MODIFIER_CONFLICT',
          `el perfil ${profileId} declara valores distintos para ${key}`,
        );
      }
      seen.set(key, resolvedModifier);
      resolved.push(resolvedModifier);
    }
  }
  return { ok: true, modifiers: resolved };
}

function resolveEffect(
  modifier: OpeningContractBodyModifier,
  boundaryKind: string,
  availableFrontHeightMm: number,
  fronts: OpeningFrontLayout['fronts'],
  boundaryKey: string,
): { readonly ok: true; readonly modifier: Omit<ResolvedOpeningBodyModifier, 'profileId' | 'boundary'> } | { readonly ok: false; readonly errorCode: OpeningBodyModifierErrorCode; readonly message: string } {
  if (!CONSTRUCTIVE_ROLES.includes(modifier.role)) {
    return fail(
      'OPENING_BODY_MODIFIER_INVALID',
      `el rol constructivo "${modifier.role}" no es válido (vocabulario ConstructiveRole, nunca nombres)`,
    );
  }
  const declaresDepth = modifier.depthReductionMm !== undefined;
  const declaresNotch =
    modifier.notchHeightMm !== undefined ||
    modifier.notchDepthMm !== undefined ||
    modifier.notchAt !== undefined;
  if (declaresDepth) {
    if (boundaryKind !== 'top' && boundaryKind !== 'bottom') {
      return fail(
        'OPENING_BODY_MODIFIER_INVALID',
        `la reducción de profundidad no aplica en la frontera ${boundaryKind}`,
      );
    }
    if (modifier.depthReductionMm === undefined || modifier.depthReductionMm <= 0) {
      return fail('OPENING_BODY_MODIFIER_INVALID', 'la reducción de profundidad debe ser mayor a 0');
    }
    return {
      ok: true,
      modifier: {
        effect: 'depth_reduction',
        role: modifier.role,
        depthReductionMm: modifier.depthReductionMm,
      },
    };
  }
  if (declaresNotch) {
    if (
      modifier.notchHeightMm === undefined ||
      modifier.notchDepthMm === undefined ||
      modifier.notchAt === undefined
    ) {
      return fail('OPENING_BODY_MODIFIER_INVALID', 'el saque exige alto, profundidad y posición completos');
    }
    if (modifier.notchHeightMm <= 0 || modifier.notchDepthMm <= 0) {
      return fail('OPENING_BODY_MODIFIER_INVALID', 'el saque exige alto y profundidad mayores a 0');
    }
    const offset = resolveNotchOffset(modifier.notchAt as OpeningNotchAt, boundaryKind, availableFrontHeightMm, fronts, boundaryKey);
    if (typeof offset !== 'number') {
      return offset;
    }
    return {
      ok: true,
      modifier: {
        effect: 'notch',
        role: modifier.role,
        notchHeightMm: modifier.notchHeightMm,
        notchDepthMm: modifier.notchDepthMm,
        notchOffsetMm: offset,
      },
    };
  }
  return fail('OPENING_BODY_MODIFIER_INVALID', 'el modifier no declara ningún efecto');
}

function resolveNotchOffset(
  notchAt: OpeningNotchAt,
  boundaryKind: string,
  availableFrontHeightMm: number,
  fronts: OpeningFrontLayout['fronts'],
  boundaryKey: string,
): number | { readonly ok: false; readonly errorCode: OpeningBodyModifierErrorCode; readonly message: string } {
  switch (notchAt) {
    case 'top_front':
      if (boundaryKind !== 'top') {
        return fail(
          'OPENING_BODY_MODIFIER_INVALID',
          `el saque top_front no aplica en la frontera ${boundaryKind}`,
        );
      }
      return 0;
    case 'bottom_front':
      if (boundaryKind !== 'bottom') {
        return fail(
          'OPENING_BODY_MODIFIER_INVALID',
          `el saque bottom_front no aplica en la frontera ${boundaryKind}`,
        );
      }
      return availableFrontHeightMm;
    case 'front_boundary': {
      if (boundaryKind !== 'between') {
        return fail(
          'OPENING_BODY_MODIFIER_INVALID',
          `el saque front_boundary no aplica en la frontera ${boundaryKind}`,
        );
      }
      // The boundary sits at the end of the zone it grips from below.
      for (const front of fronts) {
        for (const grip of front.grips) {
          if (grip.boundary === boundaryKey && grip.side === 'below') {
            return front.offsetMm + front.heightMm;
          }
        }
      }
      return fail(
        'OPENING_BODY_MODIFIER_INVALID',
        `la frontera ${boundaryKey} no tiene zona debajo declarada`,
      );
    }
    default:
      return fail('OPENING_BODY_MODIFIER_INVALID', `la posición de saque "${notchAt}" no es válida`);
  }
}

function fail(
  errorCode: OpeningBodyModifierErrorCode,
  message: string,
): { readonly ok: false; readonly errorCode: OpeningBodyModifierErrorCode; readonly message: string } {
  return { ok: false, errorCode, message };
}

/** The contract id the resolution belongs to (re-exported for consumers). */
export const OPENING_BODY_MODIFIERS_CONTRACT = OPENING_FRONT_CONTRACT;
