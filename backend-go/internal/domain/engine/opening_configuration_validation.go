package engine

import (
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Opening configuration validator (#1135) — the server-authoritative gate
// for NEW authoring selections. Available and valid are distinct: a
// capability enables OFFERING (#1134); this validator decides whether a
// CONCRETE selection (system + profile + furniture type + placements) may
// proceed. UI hiding never substitutes it — every authoring surface calls
// the API, and the API rejects with INVALID_OPENING_CONFIGURATION.
//
// Three states (ADR-0009 §8):
//   - valid   — the selection may proceed to authoring.
//   - blocked — available, but resolution is blocked on pending evidence
//     (bottom_overhang waits for OQ-3 field data): a truthful state, never
//     an error and never invented.
//   - invalid — rejected with a stable reason code; the API envelopes it as
//     INVALID_OPENING_CONFIGURATION with details.reason.
//
// Historical designs are NOT this validator's subject: a persisted
// configuration resolves against its pinned release (effectiveLibraryReleaseId
// and the revisions included in it) even when today's capability says
// otherwise — the resolver consumes the PINNED profile data its caller
// feeds it and has no "latest" fallback by construction (see
// TestOpeningConfigurationHistoricalSemantics).

// Validation states.
const (
	OpeningSelectionValid   = "valid"
	OpeningSelectionBlocked = "blocked"
	OpeningSelectionInvalid = "invalid"
)

// Stable reason codes (the UI prints them; the fixture pins them).
const (
	OpeningReasonSystemUnknown         = "OPENING_SYSTEM_UNKNOWN"
	OpeningReasonSystemUnavailable     = "OPENING_SYSTEM_UNAVAILABLE"
	OpeningReasonProfileRequired       = "OPENING_PROFILE_REQUIRED"
	OpeningReasonProfileNotApplicable  = "OPENING_PROFILE_NOT_APPLICABLE"
	OpeningReasonProfileNotCurated     = "OPENING_PROFILE_NOT_CURATED"
	OpeningReasonProfileUnknown        = "OPENING_PROFILE_UNKNOWN"
	OpeningReasonDatasheetPending      = "OPENING_PROFILE_DATASHEET_PENDING"
	OpeningReasonPlacementRestricted   = "OPENING_PLACEMENT_RESTRICTED"
	OpeningReasonPlacementIncompatible = "OPENING_PLACEMENT_INCOMPATIBLE"
	OpeningReasonFurnitureTypeUnknown  = "OPENING_FURNITURE_TYPE_UNKNOWN"
	OpeningReasonOverhangEvidencePend  = "OPENING_OVERHANG_EVIDENCE_PENDING"
)

// OpeningConfigurationSelection is one proposed authoring selection.
type OpeningConfigurationSelection struct {
	System        string   `json:"system"`
	ProfileID     string   `json:"profileId,omitempty"`
	FurnitureType string   `json:"furnitureType,omitempty"`
	Placements    []string `json:"placements,omitempty"`
}

// OpeningProfileSelectionData is the catalog slice the validation consumes
// (a projection of the #1130 entity).
type OpeningProfileSelectionData struct {
	ProfileID            string
	CompatiblePlacements []string
	DatasheetStatus      string
}

// OpeningConfigurationValidation is the three-state outcome.
type OpeningConfigurationValidation struct {
	State  string `json:"state"`
	Reason string `json:"reason,omitempty"`
}

// openingLibraryDefaultSystems mirrors availableOpeningSystems' nil branch in
// the TS domain: with no factory decision every pilot system is offered.
var openingLibraryDefaultSystems = map[string]bool{
	domain.OpeningGripSystemHandle:         true,
	domain.OpeningGripSystemGola:           true,
	domain.OpeningGripSystemBottomOverhang: true,
}

// ValidateOpeningConfiguration validates one selection against the factory
// capabilities (#1134) and the opening profile catalog (#1130). Pure,
// deterministic; identical to the TS domain through the shared fixture
// contracts/openingConfigurationValidation.contract.json.
func ValidateOpeningConfiguration(
	selection OpeningConfigurationSelection,
	capabilities *domain.OpeningCapabilities,
	profiles []OpeningProfileSelectionData,
) OpeningConfigurationValidation {
	if !openingGripSystemVocabulary[selection.System] {
		return invalid(OpeningReasonSystemUnknown)
	}
	enabled := openingLibraryDefaultSystems[selection.System]
	if capabilities != nil {
		enabled = capabilities.Grips[selection.System].Enabled
	}
	if !enabled {
		// The capability gate blocks NEW authoring only — never the
		// resolution of persisted designs.
		return invalid(OpeningReasonSystemUnavailable)
	}

	switch selection.System {
	case domain.OpeningGripSystemBottomOverhang:
		// Available, but the physical behaviour waits for OQ-3 field
		// evidence: blocked is a truthful state, not an error.
		return OpeningConfigurationValidation{State: OpeningSelectionBlocked, Reason: OpeningReasonOverhangEvidencePend}
	case domain.OpeningGripSystemHandle:
		if selection.ProfileID != "" {
			// Only gola consumes a profile; extra ids are incompatible input.
			return invalid(OpeningReasonProfileNotApplicable)
		}
	case domain.OpeningGripSystemGola:
		if selection.ProfileID == "" {
			return invalid(OpeningReasonProfileRequired)
		}
		if capabilities != nil {
			if curated := capabilities.Grips[domain.OpeningGripSystemGola].Profiles; len(curated) > 0 {
				found := false
				for _, profileID := range curated {
					if profileID == selection.ProfileID {
						found = true
						break
					}
				}
				if !found {
					return invalid(OpeningReasonProfileNotCurated)
				}
			}
		}
		profile, known := func() (OpeningProfileSelectionData, bool) {
			for _, candidate := range profiles {
				if candidate.ProfileID == selection.ProfileID {
					return candidate, true
				}
			}
			return OpeningProfileSelectionData{}, false
		}()
		if !known {
			return invalid(OpeningReasonProfileUnknown)
		}
		if profile.DatasheetStatus != "verified" {
			return invalid(OpeningReasonDatasheetPending)
		}
	}

	if selection.FurnitureType != "" && !openingFurnitureTypeVocabulary[selection.FurnitureType] {
		return invalid(OpeningReasonFurnitureTypeUnknown)
	}
	if len(selection.Placements) > 0 {
		if capabilities != nil && selection.FurnitureType != "" {
			if typeCaps, ok := capabilities.ByFurnitureType[selection.FurnitureType]; ok {
				if restricted, ok := typeCaps.Grips[selection.System]; ok && len(restricted.Placements) > 0 {
					for _, placement := range selection.Placements {
						allowed := false
						for _, candidate := range restricted.Placements {
							if candidate == placement {
								allowed = true
								break
							}
						}
						if !allowed {
							return invalid(OpeningReasonPlacementRestricted)
						}
					}
				}
			}
		}
		if selection.System == domain.OpeningGripSystemGola {
			var profile OpeningProfileSelectionData
			for _, candidate := range profiles {
				if candidate.ProfileID == selection.ProfileID {
					profile = candidate
					break
				}
			}
			for _, placement := range selection.Placements {
				compatible := false
				for _, candidate := range profile.CompatiblePlacements {
					if candidate == placement {
						compatible = true
						break
					}
				}
				if !compatible {
					return invalid(OpeningReasonPlacementIncompatible)
				}
			}
		}
	}

	return OpeningConfigurationValidation{State: OpeningSelectionValid}
}

func invalid(reason string) OpeningConfigurationValidation {
	return OpeningConfigurationValidation{State: OpeningSelectionInvalid, Reason: reason}
}

// OpeningSelectionReasonMessage maps a reason code to its workshop-facing
// text (Spanish copy lives with the codes so every surface says the same).
func OpeningSelectionReasonMessage(reason string) string {
	switch reason {
	case OpeningReasonSystemUnknown:
		return "sistema de apertura desconocido"
	case OpeningReasonSystemUnavailable:
		return "el sistema no está disponible para nueva autoría"
	case OpeningReasonProfileRequired:
		return "el sistema gola exige un perfil exacto"
	case OpeningReasonProfileNotApplicable:
		return "sólo el sistema gola consume un perfil"
	case OpeningReasonProfileNotCurated:
		return "el perfil no está en la curaduría de la fábrica"
	case OpeningReasonProfileUnknown:
		return "perfil desconocido en el catálogo"
	case OpeningReasonDatasheetPending:
		return fmt.Sprintf("el perfil espera ficha técnica (%s)", OpeningReasonDatasheetPending)
	case OpeningReasonPlacementRestricted:
		return "la posición no está permitida para este tipo de mueble"
	case OpeningReasonPlacementIncompatible:
		return "el perfil no es compatible con la posición pedida"
	case OpeningReasonFurnitureTypeUnknown:
		return "tipo de mueble desconocido"
	case OpeningReasonOverhangEvidencePend:
		return "el rebase inferior espera evidencia de campo (OQ-3)"
	}
	return reason
}
