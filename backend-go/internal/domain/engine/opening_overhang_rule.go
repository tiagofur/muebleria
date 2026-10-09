package engine

import (
	"encoding/json"
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// openingOverhangRuleBlobKey mirrors domain.OpeningOverhangRuleBlobKey for
// parser messages.
const openingOverhangRuleBlobKey = domain.OpeningOverhangRuleBlobKey

// ParseOpeningOverhangRule decodes the `opening.bottom-overhang` blob from an
// organization overlay's overrides (#1138). nil = no backed rule (the blob or
// the whole overlay is absent) — the case C resolution stays BLOCKED, never a
// default. Identical to the TS domain through the shared fixture: strict
// version, positive integer, unknown keys fail closed.
func ParseOpeningOverhangRule(overrides json.RawMessage) (*domain.OpeningOverhangRule, error) {
	if len(overrides) == 0 || string(overrides) == "null" {
		return nil, nil
	}
	var raw map[string]any
	if err := json.Unmarshal(overrides, &raw); err != nil {
		return nil, fmt.Errorf("overlay overrides are not a JSON object: %w", err)
	}
	blob, present := raw[openingOverhangRuleBlobKey]
	if !present || blob == nil {
		return nil, nil
	}
	structured, ok := blob.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s must be an object", openingOverhangRuleBlobKey)
	}
	if version, ok := structured["version"].(float64); !ok || version != 1 {
		return nil, fmt.Errorf("%s.version must be 1 (una versión futura no se interpreta)", openingOverhangRuleBlobKey)
	}
	for key := range structured {
		if key != "version" && key != "overhangMm" {
			return nil, fmt.Errorf("%s.%s no es una clave conocida", openingOverhangRuleBlobKey, key)
		}
	}
	overhang, ok := structured["overhangMm"].(float64)
	if !ok || overhang != float64(int(overhang)) || overhang <= 0 {
		return nil, fmt.Errorf("%s.overhangMm debe ser un entero positivo", openingOverhangRuleBlobKey)
	}
	return &domain.OpeningOverhangRule{Version: 1, OverhangMm: int(overhang)}, nil
}

// OpeningOverhangRuleMm projects the parsed rule onto the resolver's rule
// input (nil rule → nil: no backed rule, BLOCKED verbatim).
func OpeningOverhangRuleMm(rule *domain.OpeningOverhangRule) *int {
	if rule == nil {
		return nil
	}
	mm := rule.OverhangMm
	return &mm
}
