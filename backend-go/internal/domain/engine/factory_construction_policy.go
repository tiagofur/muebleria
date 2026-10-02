package engine

import (
	"encoding/json"
	"fmt"
	"math"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Factory construction policy (#875 slice 2): the organization's self-service
// construction overlay (library_overlays.overrides, `joint.*` namespace)
// decoded into the ONLY values the joinery resolver consumes from it — the
// station pattern per engine-resolvable joint family. Hardware selection
// stays with the pinned profile/assignment authority (#915/#918): the policy
// never names catalog hardware into the resolve. Families the engine cannot
// resolve yet (top-to-side, back-panel kinds are #874 deferred work) are
// valid overlay data but produce no rule — honest absence, never fake
// coverage.
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

// FactoryJointRule is one family's factory-governed station pattern.
type FactoryJointRule struct {
	StationsCount int     `json:"stationsCount"`
	StartMarginMm float64 `json:"startMarginMm"`
	EndMarginMm   float64 `json:"endMarginMm"`
}

// FactoryConstructionPolicy carries the factory override per engine-resolvable
// family. nil rules inherit (authored intent, then library defaults).
type FactoryConstructionPolicy struct {
	FloorToSide *FactoryJointRule `json:"floorToSide,omitempty"`
	ShelfToSide *FactoryJointRule `json:"shelfToSide,omitempty"`
}

// Relationship kinds the engine resolves today, mapped to their policy family.
const (
	factoryFamilyKindFloorSide      = "floor-side"
	factoryFamilyKindFixedShelfSide = "fixed-shelf-side"
)

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

// RuleForKind maps a relationship kind to its factory rule (nil = inherit).
func (p *FactoryConstructionPolicy) RuleForKind(kind string) *FactoryJointRule {
	if p == nil {
		return nil
	}
	switch kind {
	case factoryFamilyKindFloorSide:
		return p.FloorToSide
	case factoryFamilyKindFixedShelfSide:
		return p.ShelfToSide
	default:
		return nil
	}
}

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
			return &FactoryConstructionPolicy{FloorToSide: floor, ShelfToSide: shelf}, nil
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
	return &FactoryConstructionPolicy{FloorToSide: floor, ShelfToSide: shelf}, nil
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
	return usableFactoryRule(count, start, end, "joint.constructionPolicy."+family)
}

// factoryRuleFromGranular reads one family from the flat editor keys
// (`joint.<family>.stationsCount` …). Key presence is the factory override
// signal, mirroring the TS client's hasFloor/hasTop/hasShelf detection.
func factoryRuleFromGranular(flat map[string]any, family string) (*FactoryJointRule, error) {
	_, hasCount := flat["joint."+family+".stationsCount"]
	_, hasSystem := flat["joint."+family+".systemId"]
	if !hasCount && !hasSystem {
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
	return usableFactoryRule(count, start, end, "joint."+family)
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

// usableFactoryRule validates one family's resolved pattern into an
// engine-usable rule. stationCount must be an integer >= 2 (the planner's own
// STATION_PATTERN_INVALID floor) and margins finite nonnegative — the same
// contract the resolver enforces on authored relationships, so a policy
// value can never smuggle a pattern the authored path would reject.
func usableFactoryRule(count, start, end float64, path string) (*FactoryJointRule, error) {
	if count != math.Trunc(count) || count < 2 || count > factoryPolicyMaxStationsCount {
		return nil, fmt.Errorf("%s.stationsCount must be an integer between 2 and %d", path, factoryPolicyMaxStationsCount)
	}
	for _, margin := range []struct {
		value float64
		name  string
	}{{start, "startMarginMm"}, {end, "endMarginMm"}} {
		if math.IsNaN(margin.value) || math.IsInf(margin.value, 0) || margin.value < 0 {
			return nil, fmt.Errorf("%s.%s must be a finite nonnegative number", path, margin.name)
		}
	}
	return &FactoryJointRule{StationsCount: int(count), StartMarginMm: start, EndMarginMm: end}, nil
}

// applyFactoryStationPatterns fills the factory pattern into AUTHORED
// floor-side/fixed-shelf-side relationships that declare none (#875): the
// designer anchors the joint, the factory decides how it is built — the same
// server-input injection contract as #916's recipe synthesis. Authored
// explicit stationCount parameters and construction-declared families are
// explicit intent and stay untouched; with no authored pattern and no
// factory rule the relationship keeps its honest STATION_PATTERN_INVALID
// terminal.
func applyFactoryStationPatterns(relationships []AuthoringRelationship, policy *FactoryConstructionPolicy) []AuthoringRelationship {
	if policy == nil {
		return relationships
	}
	for i := range relationships {
		relationship := &relationships[i]
		rule := policy.RuleForKind(relationship.Kind)
		if rule == nil {
			continue
		}
		if _, explicit := relationship.Parameters["stationCount"]; explicit {
			continue
		}
		if len(relationship.Families) > 0 {
			continue
		}
		if relationship.Parameters == nil {
			relationship.Parameters = map[string]any{}
		}
		relationship.Parameters["stationCount"] = float64(rule.StationsCount)
		relationship.Parameters["startMarginMm"] = rule.StartMarginMm
		relationship.Parameters["endMarginMm"] = rule.EndMarginMm
	}
	return relationships
}
