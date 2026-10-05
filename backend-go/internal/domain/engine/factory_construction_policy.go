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
type FactoryJointRule struct {
	StationsCount int      `json:"stationsCount"`
	StartMarginMm float64  `json:"startMarginMm"`
	EndMarginMm   float64  `json:"endMarginMm"`
	MaxSpacingMm  *float64 `json:"maxSpacingMm,omitempty"`
}

// ComponentConstructionOverride is one catalog component's stored exception
// scalars (#875 slice 3). Fields are POINTERS on purpose: absent, zero and
// explicit are distinct states (C3) — each present scalar overrides the
// factory family rule at consumption time; each absent scalar inherits it.
// A spacing scalar replaces the whole pattern (count included): the family
// rule resolves to either a count or a spacing, never both (#1065).
type ComponentConstructionOverride struct {
	StationsCount *float64 `json:"stationsCount,omitempty"`
	StartMarginMm *float64 `json:"startMarginMm,omitempty"`
	EndMarginMm   *float64 `json:"endMarginMm,omitempty"`
	MaxSpacingMm  *float64 `json:"maxSpacingMm,omitempty"`
}

// FactoryConstructionPolicy carries the factory override per engine-resolvable
// family. nil rules inherit (authored intent, then library defaults).
// ComponentOverrides carries per-CATALOG-component exceptions (#875 slice 3):
// the C3 ladder authored intent → component exception → factory family rule →
// library default, resolved per scalar in RuleForComponent.
type FactoryConstructionPolicy struct {
	FloorToSide        *FactoryJointRule                         `json:"floorToSide,omitempty"`
	ShelfToSide        *FactoryJointRule                         `json:"shelfToSide,omitempty"`
	BackPanel          *FactoryJointRule                         `json:"backPanel,omitempty"`
	ComponentOverrides map[string]*ComponentConstructionOverride `json:"componentOverrides,omitempty"`
}

// Relationship kinds the engine resolves today, mapped to their policy family.
const (
	factoryFamilyKindFloorSide      = "floor-side"
	factoryFamilyKindFixedShelfSide = "fixed-shelf-side"
	factoryFamilyKindBackPanel      = "back-panel"
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
	case factoryFamilyKindBackPanel:
		return p.BackPanel
	default:
		return nil
	}
}

// factoryKindResolvable reports whether the engine resolves this relationship
// kind at all (the same families RuleForKind maps).
func factoryKindResolvable(kind string) bool {
	switch kind {
	case factoryFamilyKindFloorSide, factoryFamilyKindFixedShelfSide, factoryFamilyKindBackPanel:
		return true
	default:
		return false
	}
}

// RuleForComponent resolves one component's construction exception for a
// relationship kind (#875 slice 3, the C3 ladder): the component's stored
// scalars override the factory-wide family rule per field, each absent field
// inherits that rule, and the rule itself already fell back to the library
// defaults at parse. The exception keys on the CATALOG component id of the
// relationship source; an unknown id is dead config, never an error — the
// overlay is org-owned intent and catalog components may come and go. Both
// inputs were bounds-validated at parse, so the resolved pattern is always
// engine-usable.
func (p *FactoryConstructionPolicy) RuleForComponent(componentID, kind string) *FactoryJointRule {
	if p == nil {
		return nil
	}
	factoryRule := p.RuleForKind(kind)
	if factoryRule == nil && !factoryKindResolvable(kind) {
		// The engine cannot resolve this kind at all (top-to-side is #874
		// deferred work): honest absence, never a fabricated pattern.
		return nil
	}
	if componentID == "" {
		return factoryRule
	}
	override := p.ComponentOverrides[componentID]
	if override == nil {
		return factoryRule
	}
	resolved := FactoryJointRule{
		StationsCount: factoryPolicyDefaultStationsCount,
		StartMarginMm: factoryPolicyDefaultMarginMm,
		EndMarginMm:   factoryPolicyDefaultMarginMm,
	}
	if factoryRule != nil {
		resolved = *factoryRule
	}
	if override.StationsCount != nil {
		resolved.StationsCount = int(*override.StationsCount)
		resolved.MaxSpacingMm = nil
	}
	if override.MaxSpacingMm != nil {
		// A spacing exception replaces the whole pattern (#1065): the count
		// is derived from each contact's real span, never pinned.
		resolved.MaxSpacingMm = override.MaxSpacingMm
		resolved.StationsCount = 0
	}
	if override.StartMarginMm != nil {
		resolved.StartMarginMm = *override.StartMarginMm
	}
	if override.EndMarginMm != nil {
		resolved.EndMarginMm = *override.EndMarginMm
	}
	return &resolved
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
			back, err := factoryRuleFromStructured(structured, "backPanel")
			if err != nil {
				return nil, err
			}
			overrides, err := parseFactoryComponentOverrides(structured["componentOverrides"])
			if err != nil {
				return nil, err
			}
			return &FactoryConstructionPolicy{FloorToSide: floor, ShelfToSide: shelf, BackPanel: back, ComponentOverrides: overrides}, nil
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
		for name, raw := range map[string]any{"startMarginMm": entry["startMarginMm"], "endMarginMm": entry["endMarginMm"]} {
			if raw == nil {
				continue
			}
			value, err := factoryScalarOr(raw, 0, path+"."+name)
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
		if override.StationsCount == nil && override.StartMarginMm == nil && override.EndMarginMm == nil && override.MaxSpacingMm == nil {
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
