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
//     declared value). The value is EITHER the modifier's explicit
//     depth_reduction_mm OR — #1317, effect "depth_reduction" with no value —
//     the profile's own declared profile_depth_mm, so the discount follows
//     the pinned datasheet and is never an engine constant. A depth
//     reduction at a between boundary is an incompatible input; so is a
//     valueless declaration on a profile whose datasheet depth is absent.
//   - notch: requires height + depth + NotchAt complete; NotchAt must match
//     the boundary kind (top_front⇒top at offset 0, bottom_front⇒bottom at
//     the available-region end, front_boundary⇒between at the end of the
//     zone below the boundary) and the profile must declare the boundary
//     kind among its compatible placements.
//   - bevel (#1327 slice 3): the italian gola's declared 45° door cut —
//     angle + size + at complete, ONLY a 45° angle, at top_front/bottom_front
//     matching the boundary kind. The door is the effect's only geometry
//     consumer (the layout pass fail-closes any other role).
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
	// #1327 slice 3: the italian gola's door bevel — the declared 45° wedge
	// cut at the door's boundary edge that forms the grip with the strip.
	OpeningModifierEffectBevel = "bevel"
)

// OpeningBevelAngleDegV1 is the only bevel angle with a geometry consumer
// (the italian gola's datasheet cut): the resolver refuses any other value
// instead of guessing an intent the pipeline cannot materialize.
const OpeningBevelAngleDegV1 = 45.0

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
	Role string `json:"role"`
	// Effect names the effect explicitly; with depthReductionMm absent it
	// declares the DERIVED reduction (#1317): the profile's own
	// profileDepthMm. Declared values must agree with the carried fields —
	// a contradiction fails closed.
	Effect           string   `json:"effect,omitempty"`
	DepthReductionMm *int     `json:"depthReductionMm,omitempty"`
	NotchHeightMm    *float64 `json:"notchHeightMm,omitempty"`
	NotchDepthMm     *float64 `json:"notchDepthMm,omitempty"`
	NotchAt          string   `json:"notchAt,omitempty"`
	// #1327 slice 3: the declared 45° door bevel (italian gola). bevelAt is
	// the door edge class (top_front | bottom_front) and must agree with the
	// mounted boundary kind — front_boundary has no consumer and fails closed.
	BevelAngleDeg *float64 `json:"bevelAngleDeg,omitempty"`
	BevelSizeMm   *float64 `json:"bevelSizeMm,omitempty"`
	BevelAt       string   `json:"bevelAt,omitempty"`
}

// openingContractBodyModifier maps the persisted entity modifier onto the
// contract shape.
func openingContractBodyModifier(entity domain.OpeningBodyModifier) OpeningContractBodyModifier {
	return OpeningContractBodyModifier{
		Role:             entity.Role,
		Effect:           entity.Effect,
		DepthReductionMm: entity.DepthReductionMm,
		NotchHeightMm:    entity.NotchHeightMm,
		NotchDepthMm:     entity.NotchDepthMm,
		NotchAt:          entity.NotchAt,
		BevelAngleDeg:    entity.BevelAngleDeg,
		BevelSizeMm:      entity.BevelSizeMm,
		BevelAt:          entity.BevelAt,
	}
}

// ContractBodyModifiersFromEntities maps persisted entity modifiers onto the
// contract shape for the api/storage projections of the frozen pin slice
// (#1287). nil stays nil (the truthful absence).
func ContractBodyModifiersFromEntities(entities []domain.OpeningBodyModifier) []OpeningContractBodyModifier {
	if entities == nil {
		return nil
	}
	out := make([]OpeningContractBodyModifier, 0, len(entities))
	for _, entity := range entities {
		out = append(out, openingContractBodyModifier(entity))
	}
	return out
}

// OpeningProfileBodyData is the library slice the body-modifier resolution
// consumes (a projection of the #1130 entity — the storage layer maps it).
// ProfileDepthMm/ProfileHeightMm are the datasheet envelope the depth
// reduction derives from and computes its band with (#1317); zero = the pin
// predates #1283 and a derived reduction has no source (fail-closed).
type OpeningProfileBodyData struct {
	ProfileID            string                        `json:"profileId"`
	CompatiblePlacements []string                      `json:"compatiblePlacements"`
	ProfileDepthMm       float64                       `json:"profileDepthMm,omitempty"`
	ProfileHeightMm      float64                       `json:"profileHeightMm,omitempty"`
	BodyModifiers        []OpeningContractBodyModifier `json:"bodyModifiers"`
}

// ResolvedOpeningBodyModifier is one exact effect: stable identity
// (effect|role|boundary), target constructive role, provenance (profile +
// boundary) and the complete geometry the manufacturing pipeline consumes.
type ResolvedOpeningBodyModifier struct {
	Effect           string  `json:"effect"`
	Role             string  `json:"role"`
	ProfileID        string  `json:"profileId"`
	Boundary         string  `json:"boundary"`
	DepthReductionMm float64 `json:"depthReductionMm,omitempty"`
	// ProfileHeightMm is the profile's declared vertical envelope: the
	// front band the layout consumer computes the reduction with (#1317).
	// Zero for notch effects (they carry their own section).
	ProfileHeightMm float64 `json:"profileHeightMm,omitempty"`
	NotchHeightMm   float64 `json:"notchHeightMm,omitempty"`
	NotchDepthMm    float64 `json:"notchDepthMm,omitempty"`
	// NotchOffsetMm places the notch along the front axis, measured from the
	// start of the available region (same coordinate system as the #1131
	// fronts' offsetMm); 0 for top_front.
	NotchOffsetMm int `json:"notchOffsetMm,omitempty"`
	// #1327 slice 3: the resolved bevel — always 45 in v1 (the resolver
	// refuses any other angle) with the wedge's equal legs in mm; the door
	// edge comes from the carried boundary kind (top⇒top_front,
	// bottom⇒bottom_front), so no separate position field exists.
	BevelAngleDeg float64 `json:"bevelAngleDeg,omitempty"`
	BevelSizeMm   float64 `json:"bevelSizeMm,omitempty"`
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
		return m.DepthReductionMm == other.DepthReductionMm &&
			m.ProfileHeightMm == other.ProfileHeightMm
	}
	if m.Effect == OpeningModifierEffectBevel {
		return m.BevelAngleDeg == other.BevelAngleDeg &&
			m.BevelSizeMm == other.BevelSizeMm
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
		// #1287: an ABSENT declared slice (pre-#1287 pin, or a profile that
		// declares none) resolves no effects and guards nothing — the
		// truthful absence, never a blocked resolution. Declared data still
		// fails closed below.
		if len(profile.BodyModifiers) == 0 {
			continue
		}
		kind := openingBoundaryKind(boundary.Boundary)
		if !openingPlacementCompatible(profile.CompatiblePlacements, kind) {
			return nil, openingFail(OpeningErrBodyModifierPlacement,
				fmt.Sprintf("el perfil %s no declara compatible la frontera %s", profileID, kind))
		}
		for _, modifier := range profile.BodyModifiers {
			effect, resErr := resolveOpeningBodyModifierEffect(modifier, kind,
				layout.Resolution.AvailableFrontHeightMm, layout.Fronts, boundary.Boundary, profile)
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
// set by the caller). The profile declaration carries the derivation source
// (#1317): a valueless depth_reduction resolves to the profile's own
// profile_depth_mm — never to an engine constant.
func resolveOpeningBodyModifierEffect(
	modifier OpeningContractBodyModifier,
	boundaryKind string,
	availableFrontHeightMm int,
	fronts []OpeningResolvedFront,
	boundaryKey string,
	profile OpeningProfileBodyData,
) (ResolvedOpeningBodyModifier, *OpeningResolutionError) {
	role := modifier.Role
	if !componentConstructiveRoles[role] {
		return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
			fmt.Sprintf("el rol constructivo %q no es válido (vocabulario #1052, nunca nombres)", role))
	}
	switch {
	case modifier.DepthReductionMm != nil || modifier.Effect == OpeningModifierEffectDepthReduction:
		if modifier.Effect != "" && modifier.Effect != OpeningModifierEffectDepthReduction {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				fmt.Sprintf("el efecto %q contradice los campos declarados del modifier", modifier.Effect))
		}
		if boundaryKind != "top" && boundaryKind != "bottom" {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				fmt.Sprintf("la reducción de profundidad no aplica en la frontera %s", boundaryKind))
		}
		if modifier.NotchHeightMm != nil || modifier.NotchDepthMm != nil || modifier.NotchAt != "" {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				"un modifier declara reducción de profundidad y saque a la vez")
		}
		if modifier.BevelAngleDeg != nil || modifier.BevelSizeMm != nil || modifier.BevelAt != "" {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				"un modifier declara reducción de profundidad y bisel a la vez")
		}
		var reduction float64
		if modifier.DepthReductionMm != nil {
			if *modifier.DepthReductionMm <= 0 {
				return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
					"la reducción de profundidad debe ser mayor a 0")
			}
			reduction = float64(*modifier.DepthReductionMm)
		} else {
			// #1317: the value IS the pinned datasheet depth — one source of
			// truth, no engine constant. A profile whose datasheet depth is
			// absent has no derivation source (fail-closed here; the band's
			// height, a geometry concern, fails closed in the layout pass).
			if profile.ProfileDepthMm <= 0 {
				return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
					fmt.Sprintf("el perfil %s no declara profile_depth_mm; la reducción derivada no tiene fuente", profile.ProfileID))
			}
			reduction = profile.ProfileDepthMm
		}
		return ResolvedOpeningBodyModifier{
			Effect:           OpeningModifierEffectDepthReduction,
			Role:             role,
			DepthReductionMm: reduction,
			ProfileHeightMm:  profile.ProfileHeightMm,
		}, nil
	case modifier.Effect == OpeningModifierEffectNotch || modifier.NotchHeightMm != nil || modifier.NotchDepthMm != nil || modifier.NotchAt != "":
		if modifier.Effect != "" && modifier.Effect != OpeningModifierEffectNotch {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				fmt.Sprintf("el efecto %q no es válido", modifier.Effect))
		}
		if modifier.NotchHeightMm == nil || modifier.NotchDepthMm == nil || modifier.NotchAt == "" {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				"el saque exige alto, profundidad y posición completos")
		}
		if *modifier.NotchHeightMm <= 0 || *modifier.NotchDepthMm <= 0 {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				"el saque exige alto y profundidad mayores a 0")
		}
		if modifier.BevelAngleDeg != nil || modifier.BevelSizeMm != nil || modifier.BevelAt != "" {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				"un modifier declara saque y bisel a la vez")
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
	case modifier.Effect == OpeningModifierEffectBevel || modifier.BevelAngleDeg != nil || modifier.BevelSizeMm != nil || modifier.BevelAt != "":
		if modifier.Effect != "" && modifier.Effect != OpeningModifierEffectBevel {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				fmt.Sprintf("el efecto %q contradice los campos declarados del modifier", modifier.Effect))
		}
		if modifier.DepthReductionMm != nil {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				"un modifier declara reducción de profundidad y bisel a la vez")
		}
		if modifier.NotchHeightMm != nil || modifier.NotchDepthMm != nil || modifier.NotchAt != "" {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				"un modifier declara saque y bisel a la vez")
		}
		// #1327 slice 3: the bevel declares angle + size + edge COMPLETE, and
		// v1 materializes only the italian gola's 45° cut — any other angle is
		// a declared intent without a geometry consumer, never a default.
		if modifier.BevelAngleDeg == nil || modifier.BevelSizeMm == nil || modifier.BevelAt == "" {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				"el bisel exige ángulo, tamaño y posición completos")
		}
		if *modifier.BevelAngleDeg != OpeningBevelAngleDegV1 {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				fmt.Sprintf("el bisel a %g° no tiene consumidor de geometría en v1 (sólo 45°)", *modifier.BevelAngleDeg))
		}
		if *modifier.BevelSizeMm <= 0 {
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				"el bisel exige un tamaño mayor a 0")
		}
		switch modifier.BevelAt {
		case OpeningNotchAtTopFront:
			if boundaryKind != "top" {
				return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
					fmt.Sprintf("el bisel top_front no aplica en la frontera %s", boundaryKind))
			}
		case OpeningNotchAtBottomFront:
			if boundaryKind != "bottom" {
				return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
					fmt.Sprintf("el bisel bottom_front no aplica en la frontera %s", boundaryKind))
			}
		default:
			return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
				fmt.Sprintf("la posición de bisel %q no es válida", modifier.BevelAt))
		}
		return ResolvedOpeningBodyModifier{
			Effect:        OpeningModifierEffectBevel,
			Role:          role,
			BevelAngleDeg: *modifier.BevelAngleDeg,
			BevelSizeMm:   *modifier.BevelSizeMm,
		}, nil
	case modifier.Effect != "":
		return ResolvedOpeningBodyModifier{}, openingFail(OpeningErrBodyModifierInvalid,
			fmt.Sprintf("el efecto %q no es válido", modifier.Effect))
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
