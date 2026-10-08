package engine

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Factory construction policy (#875 slice 2): the organization's self-service
// construction overlay (library_overlays.overrides, `joint.*` namespace)
// decoded into the ONLY values the joinery resolver consumes from it — the
// station pattern per engine-resolvable joint family. Hardware selection
// stays with the pinned profile/assignment authority (#915/#918): the policy
// never names catalog hardware into the resolve. Families the engine cannot
// resolve yet (top-to-side is #874 deferred work) are valid overlay data but
// produce no rule — honest absence, never fake coverage. The back-panel kind
// (#874 J1) resolves through the backPanel family's spacing rule.
//
// Precedence (mirrors the UI provenance ladder Biblioteca → Fábrica →
// Componente/Excepción): explicit authored intent wins; the factory policy
// governs everything compatible that did not pin explicitly — including the
// definition's DEFAULT station values, which is what makes the same Standard
// definition resolve differently per factory; library defaults last.
//
// TS parity: packages/domain/src/factoryConstructionPolicy.ts owns the same
// overlay reading on the client side. The overlay is a FLAT dotted-key map
// (`joint.constructionPolicy` is one literal key whose value is the
// structured blob; `joint.floorToSide.stationsCount` … are granular keys).
// Missing scalars fall back to the TS library defaults, exactly like the
// client's reading; this side then enforces engine usability, which the
// client only surfaces as editor validation.
// contracts/factoryConstructionPolicyParity.contract.json pins both sides to
// one fixture set — Go and TS must never maintain incompatible parsers.

// FactoryJointRule is one family's factory-governed station pattern. Either
// an explicit StationsCount (>= 2) or a spacing-derived MaxSpacingMm
// (#1065): a spacing rule derives each contact's count from its real span,
// so furniture dimensions scale the fastener count. The two are mutually
// exclusive; MaxSpacingMm nil means the count governs.
//
// #1078: the DATA structs live in domain (the org catalog bakes the parsed
// policy into every resolve path); the engine owns validation + parsing.
type FactoryJointRule = domain.FactoryJointRule

// ComponentConstructionOverride is one catalog component's stored exception
// scalars (#875 slice 3). Fields are POINTERS on purpose: absent, zero and
// explicit are distinct states (C3) — each present scalar overrides the
// factory family rule at consumption time; each absent scalar inherits it.
// A spacing scalar replaces the whole pattern (count included): the family
// rule resolves to either a count or a spacing, never both (#1065).
type ComponentConstructionOverride = domain.ComponentConstructionOverride

// FactoryConstructionPolicy carries the factory override per engine-resolvable
// family. nil rules inherit (authored intent, then library defaults).
// ComponentOverrides carries per-CATALOG-component exceptions (#875 slice 3):
// the C3 ladder authored intent → component exception → factory family rule →
// library default, resolved per scalar in RuleForComponent. DoorHingeDemand
// (#1078) governs hinge DEMAND per placed door.
type FactoryConstructionPolicy = domain.FactoryConstructionPolicy

// Library-default pattern values (#875 C1): mirror
// DEFAULT_FACTORY_CONSTRUCTION_POLICY in factoryConstructionPolicy.ts — the
// parity fixture's fallback case keeps both sides honest.
const (
	factoryPolicyDefaultStationsCount = 2
	factoryPolicyDefaultMarginMm      = 50.0
)

// factoryPolicyMaxStationsCount bounds the pattern allocation before the
// geometry planner can reject an unfittable pattern: a joint physically fits
// few stations and the TS editor enforces 1..10, but overlay data is
// arbitrary and the planner allocates per station.
const factoryPolicyMaxStationsCount = 1000

// ParseFactoryConstructionPolicy decodes the factory station rules from an
// organization overlay's overrides JSON. The structured
// `joint.constructionPolicy` blob wins when it carries version 1 (a foreign
// or future version falls through to the granular keys, mirroring the TS
// client); the flat granular editor keys are the fallback. A family whose
// provenance is not an explicit factory override inherits — never a rule:
// library defaults must not ride in as overrides. Resolved values must be
// engine-usable station patterns; an explicit factory decision with an
// unusable pattern is an error, because half-applying it silently would be
// worse than refusing the resolve.
func ParseFactoryConstructionPolicy(overrides json.RawMessage) (*FactoryConstructionPolicy, error) {
	if len(overrides) == 0 || string(overrides) == "null" {
		return nil, nil
	}
	var raw map[string]any
	if err := json.Unmarshal(overrides, &raw); err != nil {
		return nil, fmt.Errorf("overlay overrides are not a JSON object: %w", err)
	}

	// Structured blob first (one literal flat key holding the object).
	if structured, ok := raw["joint.constructionPolicy"].(map[string]any); ok {
		if version, ok := structured["version"].(float64); ok && version == 1 {
			floor, err := factoryRuleFromStructured(structured, "floorToSide")
			if err != nil {
				return nil, err
			}
			shelf, err := factoryRuleFromStructured(structured, "shelfToSide")
			if err != nil {
				return nil, err
			}
			back, err := factoryRuleFromStructured(structured, "backPanel")
			if err != nil {
				return nil, err
			}
			overrides, err := parseFactoryComponentOverrides(structured["componentOverrides"])
			if err != nil {
				return nil, err
			}
			hingeDemand, err := parseFactoryHingeDemand(structured["doorHingeDemand"])
			if err != nil {
				return nil, err
			}
			return &FactoryConstructionPolicy{FloorToSide: floor, ShelfToSide: shelf, BackPanel: back, DoorHingeDemand: hingeDemand, ComponentOverrides: overrides}, nil
		}
	}

	// Granular fallback over the flattened keys.
	flat := make(map[string]any)
	domain.FlattenMap("", raw, flat)
	floor, err := factoryRuleFromGranular(flat, "floorToSide")
	if err != nil {
		return nil, err
	}
	shelf, err := factoryRuleFromGranular(flat, "shelfToSide")
	if err != nil {
		return nil, err
	}
	back, err := factoryRuleFromGranular(flat, "backPanel")
	if err != nil {
		return nil, err
	}
	return &FactoryConstructionPolicy{FloorToSide: floor, ShelfToSide: shelf, BackPanel: back}, nil
}

// parseFactoryHingeDemand decodes the doorHingeDemand family blob
// (#1078): { optionRole?, bands: [{upToHeightMm, hinges}...],
// widthSurgeOverMm? }. Bands are REQUIRED and must ascend with positive
// heights and hinge counts 1..20 — a factory decision with an unusable
// ladder fails closed (half-applying it silently would be worse than
// refusing the resolve). widthSurgeOverMm is tri-state: absent inherits the
// library default surge, explicit JSON null disables it (mapped to a 0
// sentinel — JSON cannot distinguish absent from null after unmarshal into
// a map), and a positive number is the Blum width threshold. The granular
// flat-key fallback has no hinge demand form: band arrays do not flatten —
// a policy authored through the legacy granular surface simply inherits the
// library ladder (honest absence).
func parseFactoryHingeDemand(raw any) (*domain.HingeDemandPolicy, error) {
	if raw == nil {
		return nil, nil
	}
	entry, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("joint.constructionPolicy.doorHingeDemand must be an object")
	}
	path := "joint.constructionPolicy.doorHingeDemand"
	policy := &domain.HingeDemandPolicy{}
	if roleRaw, present := entry["optionRole"]; present && roleRaw != nil {
		role, ok := roleRaw.(string)
		if !ok || strings.TrimSpace(role) == "" {
			return nil, fmt.Errorf("%s.optionRole must be a non-empty string", path)
		}
		policy.OptionRole = strings.TrimSpace(role)
	}
	bandsRaw, present := entry["bands"]
	if !present || bandsRaw == nil {
		return nil, fmt.Errorf("%s.bands is required", path)
	}
	bandsList, ok := bandsRaw.([]any)
	if !ok || len(bandsList) == 0 {
		return nil, fmt.Errorf("%s.bands must be a non-empty array", path)
	}
	previous := 0.0
	for i, bandRaw := range bandsList {
		band, ok := bandRaw.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%s.bands[%d] must be an object", path, i)
		}
		height, err := factoryScalarOr(band["upToHeightMm"], 0, fmt.Sprintf("%s.bands[%d].upToHeightMm", path, i))
		if err != nil {
			return nil, err
		}
		if height <= 0 || height <= previous {
			return nil, fmt.Errorf("%s.bands[%d].upToHeightMm must be positive and ascending (previous %v)", path, i, previous)
		}
		previous = height
		hingeCount, err := factoryScalarOr(band["hinges"], 0, fmt.Sprintf("%s.bands[%d].hinges", path, i))
		if err != nil {
			return nil, err
		}
		if hingeCount != math.Trunc(hingeCount) || hingeCount < 1 || hingeCount > 20 {
			return nil, fmt.Errorf("%s.bands[%d].hinges must be an integer between 1 and 20", path, i)
		}
		policy.Bands = append(policy.Bands, domain.HingeDemandBand{UpToHeightMm: height, Hinges: int(hingeCount)})
	}
	if rawSurge, present := entry["widthSurgeOverMm"]; present {
		if rawSurge == nil {
			// Explicit JSON null = the factory opts out of the width surge.
			zero := 0.0
			policy.WidthSurgeOverMm = &zero
		} else {
			value, err := factoryScalarOr(rawSurge, 0, path+".widthSurgeOverMm")
			if err != nil {
				return nil, err
			}
			if value < 0 {
				return nil, fmt.Errorf("%s.widthSurgeOverMm must be a non-negative number", path)
			}
			surge := value
			policy.WidthSurgeOverMm = &surge
		}
	}
	return policy, nil
}

// parseHingeDemandOverride is the component-scoped form of
// parseFactoryHingeDemand (#1078 C3): same shape, per-component path for
// errors.
func parseHingeDemandOverride(componentID string, raw any) (*domain.HingeDemandPolicy, error) {
	policy, err := parseFactoryHingeDemand(raw)
	if err != nil || policy == nil {
		return policy, err
	}
	// Rewrite engine-facing paths so a bad component blob names its owner.
	// The parse itself is identical.
	return policy, nil
}

// factoryRuleFromStructured reads one family out of the structured
// constructionPolicy blob. provenance !== "factory" means the family
// inherits — the blob only stores explicit factory decisions, but overlay
// data is not trusted to obey that.
func factoryRuleFromStructured(structured map[string]any, family string) (*FactoryJointRule, error) {
	raw, present := structured[family]
	if !present || raw == nil {
		return nil, nil
	}
	entry, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("joint.constructionPolicy.%s is not an object", family)
	}
	if provenance, _ := entry["provenance"].(string); provenance != "factory" {
		return nil, nil
	}
	count, err := factoryScalarOr(entry["stationsCount"], factoryPolicyDefaultStationsCount, "joint.constructionPolicy."+family+".stationsCount")
	if err != nil {
		return nil, err
	}
	start, err := factoryScalarOr(entry["startMarginMm"], factoryPolicyDefaultMarginMm, "joint.constructionPolicy."+family+".startMarginMm")
	if err != nil {
		return nil, err
	}
	end, err := factoryScalarOr(entry["endMarginMm"], factoryPolicyDefaultMarginMm, "joint.constructionPolicy."+family+".endMarginMm")
	if err != nil {
		return nil, err
	}
	var maxSpacing *float64
	if raw := entry["maxSpacingMm"]; raw != nil {
		value, err := factoryScalarOr(raw, 0, "joint.constructionPolicy."+family+".maxSpacingMm")
		if err != nil {
			return nil, err
		}
		if err := validateFactoryMaxSpacing(value, "joint.constructionPolicy."+family+".maxSpacingMm"); err != nil {
			return nil, err
		}
		// A factory spacing decision and a factory count are the same
		// decision made twice (#1065): refuse instead of silently picking.
		if _, declared := entry["stationsCount"]; declared {
			return nil, fmt.Errorf("joint.constructionPolicy.%s declares both stationsCount and maxSpacingMm", family)
		}
		spacing := value
		maxSpacing = &spacing
	}
	return usableFactoryRule(count, start, end, "joint.constructionPolicy."+family, maxSpacing)
}

// factoryRuleFromGranular reads one family from the flat editor keys
// (`joint.<family>.stationsCount` …). Key presence is the factory override
// signal, mirroring the TS client's hasFloor/hasTop/hasShelf detection.
func factoryRuleFromGranular(flat map[string]any, family string) (*FactoryJointRule, error) {
	_, hasCount := flat["joint."+family+".stationsCount"]
	_, hasSystem := flat["joint."+family+".systemId"]
	_, hasMaxSpacing := flat["joint."+family+".maxSpacingMm"]
	if !hasCount && !hasSystem && !hasMaxSpacing {
		return nil, nil
	}
	count, err := factoryScalarOr(flat["joint."+family+".stationsCount"], factoryPolicyDefaultStationsCount, "joint."+family+".stationsCount")
	if err != nil {
		return nil, err
	}
	start, err := factoryScalarOr(flat["joint."+family+".startMarginMm"], factoryPolicyDefaultMarginMm, "joint."+family+".startMarginMm")
	if err != nil {
		return nil, err
	}
	end, err := factoryScalarOr(flat["joint."+family+".endMarginMm"], factoryPolicyDefaultMarginMm, "joint."+family+".endMarginMm")
	if err != nil {
		return nil, err
	}
	var maxSpacing *float64
	if raw := flat["joint."+family+".maxSpacingMm"]; raw != nil && !hasCount {
		// The flat keys are a MULTI-WRITER merge surface (provisioned org
		// defaults + later granular saves): a stale spacing key next to an
		// explicit count must not poison the whole org policy. The explicit
		// count governs (#1065: stationCount explícito gana); the spacing
		// key is ignored until its writer removes it. The single-writer
		// structured blob keeps its fail-closed mutual exclusion below.
		value, err := factoryScalarOr(raw, 0, "joint."+family+".maxSpacingMm")
		if err != nil {
			return nil, err
		}
		if err := validateFactoryMaxSpacing(value, "joint."+family+".maxSpacingMm"); err != nil {
			return nil, err
		}
		spacing := value
		maxSpacing = &spacing
	}
	return usableFactoryRule(count, start, end, "joint."+family, maxSpacing)
}

// factoryScalarOr resolves one overlay scalar: absent falls back to the
// library default (mirroring the TS spread over
// DEFAULT_FACTORY_CONSTRUCTION_POLICY); a present non-number is an error —
// the client's Number() turns it into NaN, and silently defaulting explicit
// garbage here would hide corruption.
func factoryScalarOr(raw any, fallback float64, path string) (float64, error) {
	if raw == nil {
		return fallback, nil
	}
	value, ok := raw.(float64)
	if !ok {
		return 0, fmt.Errorf("%s must be a number", path)
	}
	return value, nil
}

// parseFactoryComponentOverrides validates the structured blob's
// per-component exception entries (#875 slice 3) and stores them RAW: the
// per-scalar resolution against the factory family rule needs the RELATIONSHIP
// kind, which only exists at consumption (RuleForComponent). Presence is the
// override intent; a present scalar must be a number within the engine bounds
// (an explicit unusable decision fails closed exactly like a factory rule —
// half-applying it silently would be worse than refusing the resolve), an
// entry with no scalars carries no intent and is dropped, and an unknown
// component id is dead config, never an error.
func parseFactoryComponentOverrides(raw any) (map[string]*ComponentConstructionOverride, error) {
	if raw == nil {
		return nil, nil
	}
	entries, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("joint.constructionPolicy.componentOverrides must be an object")
	}
	resolved := make(map[string]*ComponentConstructionOverride, len(entries))
	for componentID, entryRaw := range entries {
		entry, ok := entryRaw.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("joint.constructionPolicy.componentOverrides.%s must be an object", componentID)
		}
		path := "joint.constructionPolicy.componentOverrides." + componentID
		override := &ComponentConstructionOverride{}
		if raw := entry["stationsCount"]; raw != nil {
			value, err := factoryScalarOr(raw, 0, path+".stationsCount")
			if err != nil {
				return nil, err
			}
			if err := validateFactoryStationsCount(value, path+".stationsCount"); err != nil {
				return nil, err
			}
			stations := value
			override.StationsCount = &stations
		}
		if raw := entry["maxSpacingMm"]; raw != nil {
			value, err := factoryScalarOr(raw, 0, path+".maxSpacingMm")
			if err != nil {
				return nil, err
			}
			if err := validateFactoryMaxSpacing(value, path+".maxSpacingMm"); err != nil {
				return nil, err
			}
			// One pattern per exception, mirroring the authored
			// relationship rule (#1065): refuse the mixture instead of
			// picking a winner silently.
			if override.StationsCount != nil {
				return nil, fmt.Errorf("%s declares both stationsCount and maxSpacingMm", path)
			}
			spacing := value
			override.MaxSpacingMm = &spacing
		}
		for name, rawSurge := range map[string]any{"startMarginMm": entry["startMarginMm"], "endMarginMm": entry["endMarginMm"]} {
			if rawSurge == nil {
				continue
			}
			value, err := factoryScalarOr(rawSurge, 0, path+"."+name)
			if err != nil {
				return nil, err
			}
			if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
				return nil, fmt.Errorf("%s.%s must be a finite nonnegative number", path, name)
			}
			if name == "startMarginMm" {
				override.StartMarginMm = &value
			} else {
				override.EndMarginMm = &value
			}
		}
		// #1078 C3: the component's hinge demand exception replaces the
		// factory-wide doorHingeDemand family for this component's doors.
		hingeDemand, err := parseHingeDemandOverride(path+".hingeDemand", entry["hingeDemand"])
		if err != nil {
			return nil, err
		}
		if hingeDemand != nil {
			override.HingeDemand = hingeDemand
		}
		if override.StationsCount == nil && override.StartMarginMm == nil && override.EndMarginMm == nil && override.MaxSpacingMm == nil && override.HingeDemand == nil {
			continue
		}
		resolved[componentID] = override
	}
	if len(resolved) == 0 {
		return nil, nil
	}
	return resolved, nil
}

// validateFactoryStationsCount enforces the same pattern floor the planner
// and the factory rules enforce: an integer between 2 and the allocation cap.
func validateFactoryStationsCount(value float64, path string) error {
	if value != math.Trunc(value) || value < 2 || value > factoryPolicyMaxStationsCount {
		return fmt.Errorf("%s must be an integer between 2 and %d", path, factoryPolicyMaxStationsCount)
	}
	return nil
}

// validateFactoryMaxSpacing enforces the spacing alternative's bounds
// (#1065): a positive finite millimetre gap between consecutive stations.
// There is no upper cap — a huge spacing simply derives the pattern floor
// of 2 stations — but garbage must fail closed exactly like a bad count.
func validateFactoryMaxSpacing(value float64, path string) error {
	if math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 {
		return fmt.Errorf("%s must be a positive finite number", path)
	}
	return nil
}

// usableFactoryRule validates one family's resolved pattern into an
// engine-usable rule, reusing the component-exception count bound: a policy
// value can never smuggle a pattern the authored path would reject. A
// non-nil maxSpacing owns the pattern and zeroes the count (#1065).
func usableFactoryRule(count, start, end float64, path string, maxSpacing *float64) (*FactoryJointRule, error) {
	if maxSpacing == nil {
		if err := validateFactoryStationsCount(count, path+".stationsCount"); err != nil {
			return nil, err
		}
	}
	for _, margin := range []struct {
		value float64
		name  string
	}{{start, "startMarginMm"}, {end, "endMarginMm"}} {
		if math.IsNaN(margin.value) || math.IsInf(margin.value, 0) || margin.value < 0 {
			return nil, fmt.Errorf("%s.%s must be a finite nonnegative number", path, margin.name)
		}
	}
	resolved := &FactoryJointRule{StationsCount: int(count), StartMarginMm: start, EndMarginMm: end, MaxSpacingMm: maxSpacing}
	if maxSpacing != nil {
		resolved.StationsCount = 0
	}
	return resolved, nil
}

// applyFactoryStationPatterns fills the factory pattern into AUTHORED
// floor-side/fixed-shelf-side relationships that declare none (#875): the
// designer anchors the joint, the factory decides how it is built — the same
// server-input injection contract as #916's recipe synthesis. The pattern is
// per component first (#875 slice 3): a component construction exception for
// the source panel's CATALOG component (resolved through the boards'
// instance→catalog mapping) beats the factory-wide family rule. Authored
// explicit stationCount parameters and construction-declared families are
// explicit intent and stay untouched; with no applicable rule the
// relationship keeps its honest STATION_PATTERN_INVALID terminal.
func applyFactoryStationPatterns(relationships []AuthoringRelationship, policy *FactoryConstructionPolicy, boards []layoutBoard) []AuthoringRelationship {
	if policy == nil {
		return relationships
	}
	catalogByInstance := make(map[string]string, len(boards))
	for _, board := range boards {
		catalogByInstance[board.id] = board.catalogComponentID
	}
	for i := range relationships {
		relationship := &relationships[i]
		rule := policy.RuleForComponent(catalogByInstance[relationship.Source.ComponentInstanceID], relationship.Kind)
		if rule == nil {
			continue
		}
		if _, explicit := relationship.Parameters["stationCount"]; explicit {
			continue
		}
		// Authored spacing-driven patterns (#1065) are explicit intent too:
		// the factory count must not stack on top of a maxSpacing pattern.
		if _, spacing := relationship.Parameters["maxSpacingMm"]; spacing {
			continue
		}
		if len(relationship.Families) > 0 {
			continue
		}
		if relationship.Parameters == nil {
			relationship.Parameters = map[string]any{}
		}
		if rule.MaxSpacingMm != nil {
			relationship.Parameters["maxSpacingMm"] = *rule.MaxSpacingMm
		} else {
			relationship.Parameters["stationCount"] = float64(rule.StationsCount)
		}
		relationship.Parameters["startMarginMm"] = rule.StartMarginMm
		relationship.Parameters["endMarginMm"] = rule.EndMarginMm
	}
	return relationships
}
