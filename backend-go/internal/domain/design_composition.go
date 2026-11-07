package domain

import "strings"

// DefinitionRoleOptionSpec represents the material role definition of a furniture module/component:
// its role code, optional label, and the allowed/curated option IDs for this role.
// An empty OptionIDs slice means the role is unrestricted across active catalog materials.
type DefinitionRoleOptionSpec struct {
	Role      string   `json:"role"`
	Label     string   `json:"label,omitempty"`
	OptionIDs []string `json:"optionIds"`
	// ExplicitChoiceOnly (#1555): the role only ever carries an EXPLICIT
	// choice — an override or a compatible Design default — and never the
	// curated first-option fallback. Kit accessory groups (galería/boxcap)
	// are a deliberate per-furniture decision: silently seeding the first
	// accessory would quote and draw something the user never chose. An
	// absent statement is honest (optional → nothing; required → the engine
	// fails closed with accessory_choice_required).
	ExplicitChoiceOnly bool `json:"explicitChoiceOnly,omitempty"`
}

// EffectiveDefinitionMaterials represents the result of the definition-aware composition:
// the effective material choices and their inheritance modes.
type EffectiveDefinitionMaterials struct {
	FurnitureDefinitionID string                              `json:"furnitureDefinitionId"`
	MaterialChoices       map[string]string                   `json:"materialChoices"`
	MaterialChoiceModes   map[string]DesignMaterialChoiceMode `json:"materialChoiceModes"`
}

// ComposeEffectiveDefinitionMaterials resolves the definition-aware effective material choices
// and their inheritance modes (override || Design default || FurnitureDefinition compatibility -> effective intent).
//
// Rules for each role in roles:
//  1. Explicit override: if overrides[role] is non-empty, use it with mode=override.
//  2. Compatible Design default: if defaults.MaterialChoices[role] is non-empty AND compatible with
//     the role's allowed OptionIDs (contained in OptionIDs, or OptionIDs is empty meaning unrestricted),
//     use it with mode=design.
//  3. Fallback: if not compatible or no Design default, fall back to the first available OptionID (if any)
//     with mode=definition — the curated definition fallback, never a user exception.
//
// A role with no allowed OptionIDs and no Design default carries no effective
// statement at all (absent from both maps). Returns an
// EffectiveDefinitionMaterials with strict parity: keys(MaterialChoices) == keys(MaterialChoiceModes).
func ComposeEffectiveDefinitionMaterials(
	furnitureDefinitionID string,
	roles []DefinitionRoleOptionSpec,
	defaults DesignAuthoringDefaults,
	overrides map[string]string,
) EffectiveDefinitionMaterials {
	out := EffectiveDefinitionMaterials{
		FurnitureDefinitionID: strings.TrimSpace(furnitureDefinitionID),
		MaterialChoices:       make(map[string]string),
		MaterialChoiceModes:   make(map[string]DesignMaterialChoiceMode),
	}

	for _, spec := range roles {
		role := strings.TrimSpace(spec.Role)
		if role == "" {
			continue
		}

		// 1. Manual override
		if overrideChoice := strings.TrimSpace(overrides[role]); overrideChoice != "" {
			out.MaterialChoices[role] = overrideChoice
			out.MaterialChoiceModes[role] = DesignMaterialChoiceModeOverride
			continue
		}

		// 2. Compatible Design default
		designDefault := strings.TrimSpace(defaults.MaterialChoices[role])
		if designDefault != "" && isOptionCompatibleWithRole(designDefault, spec.OptionIDs) {
			out.MaterialChoices[role] = designDefault
			out.MaterialChoiceModes[role] = DesignMaterialChoiceModeDesign
			continue
		}

		// 3. Curated definition fallback (first allowed option). An
		// unrestricted role without candidates and without a Design default
		// carries no statement at all. ExplicitChoiceOnly roles (#1555 kit
		// accessories) never take the fallback: no choice = no statement.
		if len(spec.OptionIDs) > 0 && !spec.ExplicitChoiceOnly {
			fallback := strings.TrimSpace(spec.OptionIDs[0])
			if fallback != "" {
				out.MaterialChoices[role] = fallback
				out.MaterialChoiceModes[role] = DesignMaterialChoiceModeDefinition
			}
		}
	}

	return out
}

func isOptionCompatibleWithRole(optionID string, allowedIDs []string) bool {
	if len(allowedIDs) == 0 {
		return true // Unrestricted
	}
	for _, id := range allowedIDs {
		if strings.TrimSpace(id) == optionID {
			return true
		}
	}
	return false
}
