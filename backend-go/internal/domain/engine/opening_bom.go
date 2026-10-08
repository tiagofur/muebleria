package engine

import (
	"fmt"
	"math"
	"sort"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Opening BOM resolver (#1133) — generates the profile + accessories BOM
// from the #1131 layout resolution and the rules DECLARED by each profile's
// bom_members (#1130). Shared with the TS domain through
// contracts/openingBom.contract.json (one authority; parity only — ADR-0009).
// BOM consumes resolved geometry and profile rules; it never becomes a
// second geometry engine.
//
// Canonical rules (pinned by the fixture):
//   - 'interior_width' (profile run): the run length is EXACTLY the cabinet
//     interior width — an input from the body context, never derived here —
//     presented in meters (the v1 presentation unit) with the exact
//     CutLengthMm alongside.
//   - 'per_length' (supports): quantity = ceil(runLength/spacing) + 1, the
//     SAME station convention the joinery resolver uses (#1219). The spacing
//     ALWAYS comes from the datasheet member; per_length without a spacing
//     fails closed — no invented spacing.
//   - 'per_exposed_end' (end caps): one cap per RESOLVED exposed end (the
//     caller declares left/right ∈ exposed|closed; the open/closed SKU
//     variant is profile data, not resolver logic).
//
// Determinism and idempotence: line identity is boundary|memberKey, members
// emit in the canonical order profile→supports→endCaps across the boundary
// ledger order — re-resolving produces EXACTLY the same list, never
// accumulating. Each line carries the full provenance: profile id + version,
// boundary, rule.
//
// Fail-closed: OPENING_BOM_INVALID for unknown member keys (data corruption
// is never silently dropped), rule/member mismatch or unknown rule, missing
// unit on the run line, per_length without spacing, empty hardwareId
// (a BOM line without a SKU does not exist), version ≤ 0 (a reference
// without a revision), non-positive interior width or unknown end
// conditions; OPENING_PROFILE_UNKNOWN propagates for profiles the catalog
// does not know. Nothing is invented.

const OpeningErrBOMInvalid = "OPENING_BOM_INVALID"

// BOM member keys and their rules (#1130 entity vocabulary).
const (
	OpeningBOMMemberProfile  = "profile"
	OpeningBOMMemberSupports = "supports"
	OpeningBOMMemberEndCaps  = "endCaps"

	OpeningBOMRuleInteriorWidth = "interior_width"
	OpeningBOMRulePerLength     = "per_length"
	OpeningBOMRulePerExposedEnd = "per_exposed_end"

	OpeningBOMUnitMeter = "meter"
	OpeningBOMUnitPiece = "piece"

	OpeningEndExposed = "exposed"
	OpeningEndClosed  = "closed"
)

// OpeningContractBOMMember is the CONTRACT shape of a declared BOM member
// (camelCase, shared with the TS domain and the fixtures). The #1130 entity
// persists snake_case — openingContractBOMMember maps one onto the other.
type OpeningContractBOMMember struct {
	HardwareID string `json:"hardwareId"`
	Rule       string `json:"rule"`
	Unit       string `json:"unit,omitempty"`
	SpacingMm  *int   `json:"spacingMm,omitempty"`
}

// openingContractBOMMember maps the persisted entity member onto the
// contract shape.
func openingContractBOMMember(entity domain.OpeningBOMMember) OpeningContractBOMMember {
	return OpeningContractBOMMember{
		HardwareID: entity.HardwareID,
		Rule:       entity.Rule,
		Unit:       entity.Unit,
		SpacingMm:  entity.SpacingMm,
	}
}

// OpeningProfileBOMData is the library slice the BOM resolution consumes (a
// projection of the #1130 entity — the storage layer maps it). Version is
// the revision every line references; a line without a revision cannot
// exist.
type OpeningProfileBOMData struct {
	ProfileID  string
	Version    int64
	BOMMembers map[string]OpeningContractBOMMember
}

// OpeningBOMEndConditions is the resolved end condition of the module's
// profile runs (design-level fact; multi-module run aggregation is explicit
// later scope per ADR-0009 §4).
type OpeningBOMEndConditions struct {
	LeftEnd  string `json:"leftEnd"`
	RightEnd string `json:"rightEnd"`
}

// OpeningResolvedBOMLine is one deterministic BOM line: stable identity
// (boundary|memberKey), exact quantity in a defined unit, and full
// provenance (profile + revision + boundary + rule).
type OpeningResolvedBOMLine struct {
	LineID         string  `json:"lineId"`
	MemberKey      string  `json:"memberKey"`
	HardwareID     string  `json:"hardwareId"`
	ProfileID      string  `json:"profileId"`
	ProfileVersion int64   `json:"profileVersion"`
	Boundary       string  `json:"boundary"`
	Rule           string  `json:"rule"`
	Quantity       float64 `json:"quantity"`
	Unit           string  `json:"unit"`
	// CutLengthMm rides on profile-run lines: the exact millimetre cut.
	CutLengthMm int `json:"cutLengthMm,omitempty"`
}

// openingBOMMemberKeys is the canonical member order (never map iteration).
var openingBOMMemberKeys = []string{OpeningBOMMemberProfile, OpeningBOMMemberSupports, OpeningBOMMemberEndCaps}

// ResolveOpeningBOM generates the profile BOM lines for the layout's
// boundaries. Pure, deterministic; identical to the TS domain through the
// shared fixture.
func ResolveOpeningBOM(
	layout *OpeningFrontLayout,
	cabinetInteriorWidthMm int,
	ends OpeningBOMEndConditions,
	profiles []OpeningProfileBOMData,
) ([]OpeningResolvedBOMLine, *OpeningResolutionError) {
	if layout == nil || layout.Resolution == nil {
		return nil, openingFail(OpeningErrBOMInvalid,
			"la resolución de layout de apertura es obligatoria")
	}
	if cabinetInteriorWidthMm <= 0 {
		return nil, openingFail(OpeningErrBOMInvalid,
			"el interior del gabinete debe ser mayor a 0 para dimensionar corridas")
	}
	for _, end := range []struct{ name, value string }{{"leftEnd", ends.LeftEnd}, {"rightEnd", ends.RightEnd}} {
		if end.value != OpeningEndExposed && end.value != OpeningEndClosed {
			return nil, openingFail(OpeningErrBOMInvalid,
				fmt.Sprintf("la condición de extremo %s=%q no es válida (exposed|closed)", end.name, end.value))
		}
	}
	profileByID := make(map[string]OpeningProfileBOMData, len(profiles))
	for _, profile := range profiles {
		profileByID[profile.ProfileID] = profile
	}
	profileByBoundary := map[string]string{}
	for _, front := range layout.Fronts {
		for _, grip := range front.Grips {
			profileByBoundary[grip.Boundary] = grip.ProfileID
		}
	}

	lines := []OpeningResolvedBOMLine{}
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
		if profile.Version <= 0 {
			return nil, openingFail(OpeningErrBOMInvalid,
				fmt.Sprintf("el perfil %s no tiene revisión referenciable", profileID))
		}
		// Unknown member keys fail closed: silently dropping declared
		// hardware would under-quote the BOM. Sorted for deterministic
		// reporting when several keys are corrupt.
		unknownKeys := []string{}
		for key := range profile.BOMMembers {
			if !openingBOMMemberKeyKnown(key) {
				unknownKeys = append(unknownKeys, key)
			}
		}
		sort.Strings(unknownKeys)
		if len(unknownKeys) > 0 {
			return nil, openingFail(OpeningErrBOMInvalid,
				fmt.Sprintf("el perfil %s declara claves de BOM desconocidas %v", profileID, unknownKeys))
		}
		exposedEnds := 0
		for _, end := range []string{ends.LeftEnd, ends.RightEnd} {
			if end == OpeningEndExposed {
				exposedEnds++
			}
		}
		for _, key := range openingBOMMemberKeys {
			member, declared := profile.BOMMembers[key]
			if !declared {
				continue
			}
			line, resErr := resolveOpeningBOMLine(profile, key, member, boundary.Boundary,
				cabinetInteriorWidthMm, exposedEnds)
			if resErr != nil {
				return nil, resErr
			}
			lines = append(lines, line)
		}
	}
	return lines, nil
}

// resolveOpeningBOMLine builds one line from a declared member, enforcing
// the rule↔member pairing and the defined presentation unit.
func resolveOpeningBOMLine(
	profile OpeningProfileBOMData,
	key string,
	member OpeningContractBOMMember,
	boundary string,
	cabinetInteriorWidthMm int,
	exposedEnds int,
) (OpeningResolvedBOMLine, *OpeningResolutionError) {
	if member.HardwareID == "" {
		return OpeningResolvedBOMLine{}, openingFail(OpeningErrBOMInvalid,
			fmt.Sprintf("el miembro %s del perfil %s no declara SKU", key, profile.ProfileID))
	}
	line := OpeningResolvedBOMLine{
		LineID:         boundary + "|" + key,
		MemberKey:      key,
		HardwareID:     member.HardwareID,
		ProfileID:      profile.ProfileID,
		ProfileVersion: profile.Version,
		Boundary:       boundary,
		Rule:           member.Rule,
	}
	switch key {
	case OpeningBOMMemberProfile:
		if member.Rule != OpeningBOMRuleInteriorWidth {
			return OpeningResolvedBOMLine{}, openingFail(OpeningErrBOMInvalid,
				fmt.Sprintf("la corrida del perfil %s declara la regla desconocida %q", profile.ProfileID, member.Rule))
		}
		if member.Unit != OpeningBOMUnitMeter {
			return OpeningResolvedBOMLine{}, openingFail(OpeningErrBOMInvalid,
				fmt.Sprintf("la corrida del perfil %s exige la unidad %s (presentación definida v1)", profile.ProfileID, OpeningBOMUnitMeter))
		}
		line.Unit = OpeningBOMUnitMeter
		line.CutLengthMm = cabinetInteriorWidthMm
		line.Quantity = float64(cabinetInteriorWidthMm) / 1000
		return line, nil
	case OpeningBOMMemberSupports:
		if member.Rule != OpeningBOMRulePerLength {
			return OpeningResolvedBOMLine{}, openingFail(OpeningErrBOMInvalid,
				fmt.Sprintf("los soportes del perfil %s declara la regla desconocida %q", profile.ProfileID, member.Rule))
		}
		if member.SpacingMm == nil || *member.SpacingMm <= 0 {
			return OpeningResolvedBOMLine{}, openingFail(OpeningErrBOMInvalid,
				fmt.Sprintf("los soportes del perfil %s exigen el spacing de ficha (no se inventa)", profile.ProfileID))
		}
		if member.Unit != "" && member.Unit != OpeningBOMUnitPiece {
			return OpeningResolvedBOMLine{}, openingFail(OpeningErrBOMInvalid,
				fmt.Sprintf("los soportes del perfil %s no pueden presentarse en %q", profile.ProfileID, member.Unit))
		}
		line.Unit = OpeningBOMUnitPiece
		// The joinery station convention (#1219): stations = ceil(span/spacing)+1.
		line.Quantity = math.Ceil(float64(cabinetInteriorWidthMm)/float64(*member.SpacingMm)) + 1
		return line, nil
	case OpeningBOMMemberEndCaps:
		if member.Rule != OpeningBOMRulePerExposedEnd {
			return OpeningResolvedBOMLine{}, openingFail(OpeningErrBOMInvalid,
				fmt.Sprintf("las tapas del perfil %s declaran la regla desconocida %q", profile.ProfileID, member.Rule))
		}
		if member.Unit != "" && member.Unit != OpeningBOMUnitPiece {
			return OpeningResolvedBOMLine{}, openingFail(OpeningErrBOMInvalid,
				fmt.Sprintf("las tapas del perfil %s no pueden presentarse en %q", profile.ProfileID, member.Unit))
		}
		line.Unit = OpeningBOMUnitPiece
		line.Quantity = float64(exposedEnds)
		return line, nil
	default:
		return OpeningResolvedBOMLine{}, openingFail(OpeningErrBOMInvalid,
			fmt.Sprintf("clave de BOM desconocida %q", key))
	}
}

func openingBOMMemberKeyKnown(key string) bool {
	for _, known := range openingBOMMemberKeys {
		if key == known {
			return true
		}
	}
	return false
}
