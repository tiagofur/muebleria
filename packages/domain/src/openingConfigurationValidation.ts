/**
 * Opening configuration validator (#1135) — the server-authoritative gate
 * for NEW authoring selections, shared with the Go engine through
 * contracts/openingConfigurationValidation.contract.json (one authority; TS
 * parity only — ADR-0009). UI hiding never substitutes this validation:
 * every authoring surface validates against the API.
 *
 * Three states (ADR-0009 §8):
 *   - valid   — the selection may proceed to authoring.
 *   - blocked — available, but resolution waits on pending evidence
 *     (bottom_overhang / OQ-3): a truthful state, never an error.
 *   - invalid — rejected with a stable reason code; the API envelopes it as
 *     INVALID_OPENING_CONFIGURATION with details.reason.
 *
 * Historical designs are NOT this validator's subject: a persisted
 * configuration resolves against its pinned release even when today's
 * capability says otherwise — the resolver consumes the PINNED profile data
 * its caller feeds it and has no "latest" fallback by construction.
 */

import type { OpeningCapabilities } from './openingCapabilities';
import type { OpeningOverhangRule } from './openingOverhangRule';

export type OpeningConfigurationSelection = {
  readonly system: string;
  readonly profileId?: string;
  readonly furnitureType?: string;
  readonly placements?: readonly string[];
};

/** The catalog slice the validation consumes (a projection of the profile
 * entity). */
export type OpeningProfileSelectionData = {
  readonly profileId: string;
  readonly compatiblePlacements: readonly string[];
  readonly datasheetStatus: string;
};

export type OpeningConfigurationValidation = {
  readonly state: 'valid' | 'blocked' | 'invalid';
  readonly reason?: string;
};

/** Stable reason codes — Go mirrors them verbatim. */
export const OPENING_REASON = {
  systemUnknown: 'OPENING_SYSTEM_UNKNOWN',
  systemUnavailable: 'OPENING_SYSTEM_UNAVAILABLE',
  profileRequired: 'OPENING_PROFILE_REQUIRED',
  profileNotApplicable: 'OPENING_PROFILE_NOT_APPLICABLE',
  profileNotCurated: 'OPENING_PROFILE_NOT_CURATED',
  profileUnknown: 'OPENING_PROFILE_UNKNOWN',
  datasheetPending: 'OPENING_PROFILE_DATASHEET_PENDING',
  placementRestricted: 'OPENING_PLACEMENT_RESTRICTED',
  placementIncompatible: 'OPENING_PLACEMENT_INCOMPATIBLE',
  furnitureTypeUnknown: 'OPENING_FURNITURE_TYPE_UNKNOWN',
  overhangEvidencePending: 'OPENING_OVERHANG_EVIDENCE_PENDING',
} as const;

const GRIP_SYSTEMS: readonly string[] = ['handle', 'gola', 'bottom_overhang'];
const FURNITURE_TYPES: readonly string[] = ['inferior', 'superior', 'alto'];

/** With no factory decision every pilot system is offered (the nil branch of
 * availableOpeningSystems). */
const LIBRARY_DEFAULT_SYSTEMS: readonly string[] = GRIP_SYSTEMS;

export function validateOpeningConfiguration(
  selection: OpeningConfigurationSelection,
  capabilities: OpeningCapabilities | null,
  profiles: readonly OpeningProfileSelectionData[],
  // #1138: the factory's BACKED overhang rule (parsed `opening.bottom-overhang`
  // blob). Absent = case C stays a truthful BLOCKED state; present = the
  // selection is gateable like any other system.
  overhangRule: OpeningOverhangRule | null = null,
): OpeningConfigurationValidation {
  if (!GRIP_SYSTEMS.includes(selection.system)) {
    return invalid(OPENING_REASON.systemUnknown);
  }
  let enabled = LIBRARY_DEFAULT_SYSTEMS.includes(selection.system);
  if (capabilities) {
    enabled = capabilities.grips[selection.system as keyof typeof capabilities.grips]?.enabled === true;
  }
  if (!enabled) {
    // The capability gate blocks NEW authoring only — never the resolution
    // of persisted designs.
    return invalid(OPENING_REASON.systemUnavailable);
  }

  if (selection.system === 'bottom_overhang') {
    // Available, and resolvable only against the backed rule (#1138): without
    // it the physical behaviour waits for OQ-3 field evidence — blocked is a
    // truthful state, not an error. With it, the gate keeps applying the
    // furniture-type/placement checks below.
    if (!overhangRule) {
      return { state: 'blocked', reason: OPENING_REASON.overhangEvidencePending };
    }
  }
  if (selection.system === 'handle') {
    if (selection.profileId) {
      // Only gola consumes a profile; extra ids are incompatible input.
      return invalid(OPENING_REASON.profileNotApplicable);
    }
  }
  let profile: OpeningProfileSelectionData | undefined;
  if (selection.system === 'gola') {
    if (!selection.profileId) {
      return invalid(OPENING_REASON.profileRequired);
    }
    if (capabilities) {
      const curated = capabilities.grips.gola?.profiles;
      if (curated && curated.length > 0 && !curated.includes(selection.profileId)) {
        return invalid(OPENING_REASON.profileNotCurated);
      }
    }
    profile = profiles.find((candidate) => candidate.profileId === selection.profileId);
    if (!profile) {
      return invalid(OPENING_REASON.profileUnknown);
    }
    if (profile.datasheetStatus !== 'verified') {
      return invalid(OPENING_REASON.datasheetPending);
    }
  }

  if (selection.furnitureType && !FURNITURE_TYPES.includes(selection.furnitureType)) {
    return invalid(OPENING_REASON.furnitureTypeUnknown);
  }
  if (selection.placements && selection.placements.length > 0) {
    if (capabilities && selection.furnitureType) {
      const restricted = capabilities.byFurnitureType?.[selection.furnitureType as keyof NonNullable<OpeningCapabilities['byFurnitureType']>]?.grips?.[
        selection.system as 'handle' | 'gola' | 'bottom_overhang'
      ]?.placements;
      if (restricted && restricted.length > 0) {
        for (const placement of selection.placements) {
          if (!restricted.includes(placement as never)) {
            return invalid(OPENING_REASON.placementRestricted);
          }
        }
      }
    }
    if (selection.system === 'gola' && profile) {
      for (const placement of selection.placements) {
        if (!profile.compatiblePlacements.includes(placement)) {
          return invalid(OPENING_REASON.placementIncompatible);
        }
      }
    }
  }

  return { state: 'valid' };
}

function invalid(reason: string): OpeningConfigurationValidation {
  return { state: 'invalid', reason };
}

/** Workshop-facing text per reason code (Spanish copy lives with the codes
 * so every surface says the same). */
export function openingSelectionReasonMessage(reason: string): string {
  switch (reason) {
    case OPENING_REASON.systemUnknown:
      return 'sistema de apertura desconocido';
    case OPENING_REASON.systemUnavailable:
      return 'el sistema no está disponible para nueva autoría';
    case OPENING_REASON.profileRequired:
      return 'el sistema gola exige un perfil exacto';
    case OPENING_REASON.profileNotApplicable:
      return 'sólo el sistema gola consume un perfil';
    case OPENING_REASON.profileNotCurated:
      return 'el perfil no está en la curaduría de la fábrica';
    case OPENING_REASON.profileUnknown:
      return 'perfil desconocido en el catálogo';
    case OPENING_REASON.datasheetPending:
      return 'el perfil espera ficha técnica (OPENING_PROFILE_DATASHEET_PENDING)';
    case OPENING_REASON.placementRestricted:
      return 'la posición no está permitida para este tipo de mueble';
    case OPENING_REASON.placementIncompatible:
      return 'el perfil no es compatible con la posición pedida';
    case OPENING_REASON.furnitureTypeUnknown:
      return 'tipo de mueble desconocido';
    case OPENING_REASON.overhangEvidencePending:
      return 'el rebase inferior espera evidencia de campo (OQ-3)';
  }
  return reason;
}
