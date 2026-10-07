package domain

// Factory construction policy DATA (#875 slice 2) — the organization's
// self-service construction overlay decoded shape, shared with the engine
// package via aliases so the catalog can carry it without an import cycle
// (#1078: the catalog bakes the factory policy into every resolve path and
// the release freeze keeps its snapshot immutable).
//
// Validation and parsing stay engine-side (factory_construction_policy.go);
// this file only owns the wire shape. TS parity:
// packages/domain/src/factoryConstructionPolicy.ts +
// contracts/factoryConstructionPolicyParity.contract.json.

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
//
// HingeDemand (#1078) is the per-component hinge demand policy exception:
// a full policy object (bands + surge + role) that replaces the factory-wide
// doorHingeDemand family for doors of this catalog component.
type ComponentConstructionOverride struct {
	StationsCount *float64            `json:"stationsCount,omitempty"`
	StartMarginMm *float64            `json:"startMarginMm,omitempty"`
	EndMarginMm   *float64            `json:"endMarginMm,omitempty"`
	MaxSpacingMm  *float64            `json:"maxSpacingMm,omitempty"`
	HingeDemand   *HingeDemandPolicy  `json:"hingeDemand,omitempty"`
}

// FactoryConstructionPolicy carries the factory override per engine-resolvable
// family. nil rules inherit (authored intent, then library defaults).
// ComponentOverrides carries per-CATALOG-component exceptions (#875 slice 3):
// the C3 ladder authored intent → component exception → factory family rule →
// library default, resolved per scalar in the engine's RuleForComponent.
//
// DoorHingeDemand (#1078) governs how many hinges each placed door buys; nil
// inherits the library ladder (domain.DefaultHingeDemandPolicy).
type FactoryConstructionPolicy struct {
	FloorToSide        *FactoryJointRule                         `json:"floorToSide,omitempty"`
	ShelfToSide        *FactoryJointRule                         `json:"shelfToSide,omitempty"`
	BackPanel          *FactoryJointRule                         `json:"backPanel,omitempty"`
	DoorHingeDemand    *HingeDemandPolicy                        `json:"doorHingeDemand,omitempty"`
	ComponentOverrides map[string]*ComponentConstructionOverride `json:"componentOverrides,omitempty"`
}

// Relationship kinds the engine resolves today, mapped to their policy family.
const (
	FactoryFamilyKindFloorSide      = "floor-side"
	FactoryFamilyKindFixedShelfSide = "fixed-shelf-side"
	FactoryFamilyKindBackPanel      = "back-panel"
)

// factoryKindResolvable reports whether the engine resolves this relationship
// kind at all (the same families RuleForKind maps).
func factoryKindResolvable(kind string) bool {
	switch kind {
	case FactoryFamilyKindFloorSide, FactoryFamilyKindFixedShelfSide, FactoryFamilyKindBackPanel:
		return true
	default:
		return false
	}
}

// RuleForKind maps a relationship kind to its factory rule (nil = inherit).
func (p *FactoryConstructionPolicy) RuleForKind(kind string) *FactoryJointRule {
	if p == nil {
		return nil
	}
	switch kind {
	case FactoryFamilyKindFloorSide:
		return p.FloorToSide
	case FactoryFamilyKindFixedShelfSide:
		return p.ShelfToSide
	case FactoryFamilyKindBackPanel:
		return p.BackPanel
	default:
		return nil
	}
}

// RuleForComponent resolves one component's construction exception for a
// relationship kind (#875 slice 3, the C3 ladder): the component's stored
// scalars override the factory-wide family rule per field, each absent field
// inherits that rule, and the rule itself already fell back to the library
// defaults at parse. The exception keys on the CATALOG component id of the
// relationship source; an unknown id is dead config, never an error — the
// overlay is org-owned intent and catalog components may come and go.
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

// HingeDemandForComponent resolves one component's hinge demand policy
// (#1078, the same C3 ladder as RuleForComponent): the component's stored
// exception replaces the factory-wide doorHingeDemand family entirely; nil
// everywhere inherits the library ladder (HingesForDoor's default).
func (p *FactoryConstructionPolicy) HingeDemandForComponent(componentID string) *HingeDemandPolicy {
	if p == nil {
		return nil
	}
	if componentID != "" {
		if override := p.ComponentOverrides[componentID]; override != nil && override.HingeDemand != nil {
			return override.HingeDemand
		}
	}
	return p.DoorHingeDemand
}

// Engine-consumption defaults mirrored from the engine package's parse
// fallbacks (library defaults last — same scalars as #875 C1).
const (
	factoryPolicyDefaultStationsCount = 2
	factoryPolicyDefaultMarginMm      = 50.0
)
