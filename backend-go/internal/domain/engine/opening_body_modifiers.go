package engine

import (
	"fmt"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"strings"
)

// Opening body modifiers resolver (#1132) — applies the body modifiers
// DECLARED by the Opening Profiles (data, not logic) onto the #1131 layout
// resolution, producing the exact per-role effects: the depth reduction of
// the horizontal panel at the profile's boundary and the side notches with
// their resolved positions. Shared with the TS domain through
// contracts/openingBodyModifiers.contract.json (one authority; parity only —
// ADR-0009).
//
// Addressing is by ConstructiveRole vocabulary (#1052: horizontal | lateral
// | shelf | back | door | divider | custom) — never by name. A modifier with
// a role outside the vocabulary fails closed: the doc's conceptual «techo»
// is not an address.
//
// Effect rules (pinned by the fixture):
//   - depth_reduction: only at a top/bottom boundary (the horizontal panel
//     sitting behind the profile at that edge is shortened by the exact
//     declared value). A depth reduction at a between boundary is an
//     incompatible input.
//   - notch: requires height + depth + NotchAt complete; NotchAt must match
//     the boundary kind (top_front⇒top at offset 0, bottom_front⇒bottom at
//     the available-region end, front_boundary⇒between at the end of the
//     zone below the boundary) and the profile must declare the boundary
//     kind among its compatible placements.
//
// The same effect on the same role+boundary applies ONCE: identical
// duplicate declarations deduplicate; distinct values for the same target
// are OPENING_BODY_MODIFIER_CONFLICT — L on top + C between never double a
// reduction. Baseline (no grips) resolves to zero modifiers.
//
// Fail-closed: OPENING_BODY_MODIFIER_INVALID (shape/geometry/position),
// OPENING_BODY_MODIFIER_CONFLICT (double apply with distinct values),
// OPENING_BODY_MODIFIER_PLACEMENT_INVALID (profile mounted at a boundary
// kind it does not declare). Nothing is invented.

const (
	OpeningErrBodyModifierInvalid   = "OPENING_BODY_MODIFIER_INVALID"
	OpeningErrBodyModifierConflict  = "OPENING_BODY_MODIFIER_CONFLICT"
	OpeningErrBodyModifierPlacement = "OPENING_BODY_MODIFIER_PLACEMENT_INVALID"
)

// OpeningModifierEffect values.
const (
	OpeningModifierEffectDepthReduction = "depth_reduction"
	OpeningModifierEffectNotch          = "notch"
)

// OpeningNotchAt values — the position CLASS the profile declares; the
// resolver combines it with the boundary to produce the exact offset.
const (
	OpeningNotchAtTopFront      = "top_front"
	OpeningNotchAtBottomFront   = "bottom_front"
	OpeningNotchAtFrontBoundary = "front_boundary"
)

// OpeningContractBodyModifier is the CONTRACT shape of a declared modifier
// (camelCase, shared with the TS domain and the fixtures). The #1130 entity
// persists snake_case — openingContractBodyModifier maps one onto the other
// so the library data feeds the resolver without a third vocabulary.
type OpeningContractBodyModifier struct {
	Role             string `json:"role"`
	DepthReductionMm *int   `json:"depthReductionMm,omitempty"`
	NotchHeightMm    *int   `json:"notchHeightMm,omitempty"`
	NotchDepthMm     *int   `json:"notchDepthMm,omitempty"`
	NotchAt          string `json:"notchAt,omitempty"`
}

// openingContractBodyModifier maps the persisted entity modifier onto the
// contract shape.
func openingContractBodyModifier(entity domain.OpeningBodyModifier) OpeningContractBodyModifier {
	return OpeningContractBodyModifier{
		Role:             entity.Role,
		DepthReductionMm: entity.DepthReductionMm,
		NotchHeightMm:    entity.NotchHeightMm,
		NotchDepthMm:     entity.NotchDepthMm,
		NotchAt:          entity.NotchAt,
	}
}

// OpeningProfileBodyData is the library slice the body-modifier resolution
// consumes (a projection of the #1130 entity — the storage layer maps it).
type OpeningProfileBodyData struct {
	ProfileID            string                        `json:"profileId"`
	CompatiblePlacements []string                      `json:"compatiblePlacements"`
	BodyModifiers        []OpeningContractBodyModifier `json:"bodyModifiers"`
}

// ResolvedOpeningBodyModifier is one exact effect: stable identity
// (effect|role|boundary), target constructive role, provenance (profile +
// boundary) and the complete geometry the manufacturing pipeline consumes.
type ResolvedOpeningBodyModifier struct {
	Effect           string `json:"effect"`
	Role             string `json:"role"`
	ProfileID        string `json:"profileId"`
	Boundary         string `json:"boundary"`
	DepthReductionMm int    `json:"depthReductionMm,omitempty"`
	NotchHeightMm    int    `json:"notchHeightMm,omitempty"`
	NotchDepthMm     int    `json:"notchDepthMm,omitempty"`
	// NotchOffsetMm places the notch along the front axis, measured from the
	// start of the available region (same coordinate system as the #1131
	// fronts' offsetMm); 0 for top_front.
	NotchOffsetMm int `json:"notchOffsetMm,omitempty"`
}

// identity is the dedupe/conflict key: the same effect on the same
// role+boundary is ONE manufacturing feature.
func (m ResolvedOpeningBodyModifier) identity() string {
	return m.Effect + "|" + m.Role + "|" + m.Boundary
}

// sameEffect reports whether two resolved modifiers carry identical values
// (dedupe) or conflicting ones (fail closed).
func (m ResolvedOpeningBodyModifier) sameEffect(other ResolvedOpeningBodyModifier) bool {
	if m.Effect != other.Effect {
		return false
	}
	if m.Effect == OpeningModifierEffectDepthReduction {
		return m.DepthReductionMm == other.DepthReductionMm
	}
	return m.NotchHeightMm == other.NotchHeightMm &&
		m.NotchDepthMm == other.NotchDepthMm &&
		m.NotchOffsetMm == other.NotchOffsetMm
}

// openingBoundaryKind extracts the boundary class ("top" | "between" |
// "bottom") from a boundary key.
func openingBoundaryKind(boundaryKey string) string {
	if kind, _, found := strings.Cut(boundaryKey, ":"); found {
		return kind
	}
	return boundaryKey
}

// ResolveOpeningBodyModifiers resolves the declared body modifiers of every
// profile mounted in the layout onto exact per-role effects. Pure,
// deterministic; identical to the TS domain through the shared fixture.
func ResolveOpeningBodyModifiers(
	layout *OpeningFrontLayout,
	profiles []OpeningProfileBodyData,
) ([]ResolvedOpeningBodyModifier, *OpeningResolutionError) {
	if layout == nil || layout.Resolution == nil {
		return nil, openingFail(OpeningErrBodyModifierInvalid,
			"la resolución de layout de apertura es obligatoria")
	}
	profileByID := make(map[string]OpeningProfileBodyData, len(profiles))
	for _, profile := range profiles {
		profileByID[profile.ProfileID] = profile
	}

	// profileId per boundary, from the fronts' resolved grips (one grip per
	// boundary — its two fronts carry the same profile).
	profileByBoundary := map[string]string{}
	for _, front := range layout.Fronts {
		for _, grip := range front.Grips {
			profileByBoundary[grip.Boundary] = grip.ProfileID
		}
	}

	resolved := []ResolvedOpeningBodyModifier{}
	seen := map[string]ResolvedOpeningBodyModifier{}
	for _, boundary := range layout.Resolution.Boundaries {
		profileID, mounted := profileByBoundary[boundary.Boundary]
		if !mounted {
			continue
		}
		profile, known := profileByID[profileID]
		if !known {
			return nil, openingFail(OpeningErrProfileUnknown,
				fmt.Sprintf("perfil desconocido %s", profileID))
		}
		kind := openingBoundaryKind(boundary.Boundary)
		if !openingPlacementCompatible(profile.CompatiblePlacements, kind) {
			return nil, openingFail(OpeningErrBodyModifierPlacement,
				fmt.Sprintf("el perfil %s no declara compatible la frontera %s", profileID, kind))
		}
		for _, modifier := range profile.BodyModifiers {
			effect, resErr := resolveOpeningBodyModifierEffect(modifier, kind,
				layout.Resolution.AvailableFrontHeightMm, layout.Fronts, boundary.Boundary)
			if resErr != nil {
				return nil, resErr
			}
			effect.ProfileID = profileID
			effect.Boundary = boundary.Boundary
			previous, duplicated := seen[effect.identity()]
			if duplicated {
				if previous.sameEffect(effect) {
					continue
				}
				return nil, openingFail(OpeningErrBodyModifierConflict,
					fmt.Sprintf("el perfil %s declara valores distintos para %s", profileID, effect.identity()))
			}
			seen[effect.identity()] = effect
			resolved = append(resolved, effect)
		}
	}
	return resolved, nil
}

// resolveOpeningBodyModifierEffect validates one declared modifier against
// its boundary and produces the exact effect (identity/provenance fields are
// set by the caller).
func resolveOpeningBodyModifierEffect(
	modifier OpeningContractBodyModifier,
	boundaryKind string,
	availableFrontHeightMm int,
	fronts []OpeningResolvedFront,
	boundaryKey string,
) (ResolvedOpeningBodyModifier, *OpeningResolutionError) {
	role := modifier.Role
	if !componentConstructiveRoles[role] {
		return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
			fmt.Sprintf("el rol constructivo %q no es válido (vocabulario #1052, nunca nombres)", role))
	}
	switch {
	case modifier.DepthReductionMm != nil:
		if boundaryKind != "top" && boundaryKind != "bottom" {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				fmt.Sprintf("la reducción de profundidad no aplica en la frontera %s", boundaryKind))
		}
		if *modifier.DepthReductionMm <= 0 {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				"la reducción de profundidad debe ser mayor a 0")
		}
		return ResolvedOpeningBodyModifier{
			Effect:           OpeningModifierEffectDepthReduction,
			Role:             role,
			DepthReductionMm: *modifier.DepthReductionMm,
		}, nil
	case modifier.NotchHeightMm != nil || modifier.NotchDepthMm != nil || modifier.NotchAt != "":
		if modifier.NotchHeightMm == nil || modifier.NotchDepthMm == nil || modifier.NotchAt == "" {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				"el saque exige alto, profundidad y posición completos")
		}
		if *modifier.NotchHeightMm <= 0 || *modifier.NotchDepthMm <= 0 {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				"el saque exige alto y profundidad mayores a 0")
		}
		offset, resErr := resolveOpeningNotchOffset(modifier.NotchAt, boundaryKind,
			availableFrontHeightMm, fronts, boundaryKey)
		if resErr != nil {
			return ResolvedOpeningBodyModifier{}, resErr
		}
		return ResolvedOpeningBodyModifier{
			Effect:        OpeningModifierEffectNotch,
			Role:          role,
			NotchHeightMm: *modifier.NotchHeightMm,
			NotchDepthMm:  *modifier.NotchDepthMm,
			NotchOffsetMm: offset,
		}, nil
	default:
		return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
			"el modifier no declara ningún efecto")
	}
}

// resolveOpeningNotchOffset turns the declared position class + boundary
// into the exact offset from the available-region start.
func resolveOpeningNotchOffset(
	notchAt, boundaryKind string,
	availableFrontHeightMm int,
	fronts []OpeningResolvedFront,
	boundaryKey string,
) (int, *OpeningResolutionError) {
	switch notchAt {
	case OpeningNotchAtTopFront:
		if boundaryKind != "top" {
			return 0, openingFail(OpeningErrBodyModifierInvalid,
				fmt.Sprintf("el saque top_front no aplica en la frontera %s", boundaryKind))
		}
		return 0, nil
	case OpeningNotchAtBottomFront:
		if boundaryKind != "bottom" {
			return 0, openingFail(OpeningErrBodyModifierInvalid,
				fmt.Sprintf("el saque bottom_front no aplica en la frontera %s", boundaryKind))
		}
		return availableFrontHeightMm, nil
	case OpeningNotchAtFrontBoundary:
		if boundaryKind != "between" {
			return 0, openingFail(OpeningErrBodyModifierInvalid,
				fmt.Sprintf("el saque front_boundary no aplica en la frontera %s", boundaryKind))
		}
		// The boundary sits at the end of the zone it grips from below.
		for _, front := range fronts {
			for _, grip := range front.Grips {
				if grip.Boundary == boundaryKey && grip.Side == "below" {
					return front.OffsetMm + front.HeightMm, nil
				}
			}
		}
		return 0, openingFail(OpeningErrBodyModifierInvalid,
			fmt.Sprintf("la frontera %s no tiene zona debajo declarada", boundaryKey))
	default:
		return 0, openingFail(OpeningErrBodyModifierInvalid,
			fmt.Sprintf("la posición de saque %q no es válida", notchAt))
	}
}

func openingPlacementCompatible(placements []string, kind string) bool {
	for _, placement := range placements {
		if placement == kind {
			return true
		}
	}
	return false
}
