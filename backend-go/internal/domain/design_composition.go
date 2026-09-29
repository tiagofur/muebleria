package domain

import "strings"

// DefinitionRoleOptionSpec represents the material role definition of a furniture module/component:
// its role code, optional label, and the allowed/curated option IDs for this role.
// An empty OptionIDs slice means the role is unrestricted across active catalog materials.
type DefinitionRoleOptionSpec struct {
	Role      string   `json:"role"`
	Label     string   `json:"label,omitempty"`
	OptionIDs []string `json:"optionIds"`
}

// EffectiveDefinitionMaterials represents the result of the definition-aware composition:
// the effective material choices and their inheritance modes.
type EffectiveDefinitionMaterials struct {
	FurnitureDefinitionID string                             `json:"furnitureDefinitionId"`
	MaterialChoices       map[string]string                  `json:"materialChoices"`
	MaterialChoiceModes   map[string]DesignMaterialChoiceMode `json:"materialChoiceModes"`
}

// ComposeEffectiveDefinitionMaterials resolves the definition-aware effective material choices
// and their inheritance modes (override || Design default || FurnitureDefinition compatibility -> effective intent).
//
// Rules for each role in roles:
// 1. Explicit override: if overrides[role] is non-empty, use it with mode=override.
// 2. Compatible Design default: if defaults.MaterialChoices[role] is non-empty AND compatible with
//    the role's allowed OptionIDs (contained in OptionIDs, or OptionIDs is empty meaning unrestricted),
//    use it with mode=design.
// 3. Fallback: if not compatible or no Design default, fall back to the first available OptionID (if any)
//    with mode=override.
//
// Returns an EffectiveDefinitionMaterials with strict parity: keys(MaterialChoices) == keys(MaterialChoiceModes).
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

		// 3. Fallback to definition default (first allowed option)
		if len(spec.OptionIDs) > 0 {
			fallback := strings.TrimSpace(spec.OptionIDs[0])
			out.MaterialChoices[role] = fallback
			out.MaterialChoiceModes[role] = DesignMaterialChoiceModeOverride
		} else if designDefault != "" {
			// Unrestricted role without specific candidates accepts design default
			out.MaterialChoices[role] = designDefault
			out.MaterialChoiceModes[role] = DesignMaterialChoiceModeDesign
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
