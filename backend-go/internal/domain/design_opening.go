package domain

import (
	"fmt"
	"strings"
)

// DesignOpeningSelection (#1137, épica OPEN-FRONT): the durable design-scoped
// opening INTENT — the semantic selection an authoring surface sends. It is
// declared data only: every dimension, reduction and BOM line is a RESOLVE
// output (the #1131 layout resolver over the #1130 profile catalog), never
// stored here and never computed by any client.
//
// Available ≠ valid, applied to persistence: the WRITE path validates the
// selection against the factory capabilities (#1134) and the profile catalog
// (#1130) and rejects with INVALID_OPENING_CONFIGURATION (#1135). Once
// persisted, the selection resolves REGARDLESS of today's capabilities —
// a capability flip never invalidates an existing design (historical rule).
type DesignOpeningSelection struct {
	// System: the opening grip-system vocabulary (handle | gola |
	// bottom_overhang).
	System string `json:"system"`
	// ProfileID is required by gola and forbidden otherwise: the exact
	// opening-profile catalog id.
	ProfileID string `json:"profileId,omitempty"`
	// Placements is the declared mounting of the gola profile (top |
	// between | bottom); optional v1 — the profile's own compatible
	// placements govern when absent.
	Placements []string `json:"placements,omitempty"`
}

// ValidateDesignOpeningSelection enforces the shape at the persistence
// boundary. Capability/placement compatibility against live catalog data is
// the write endpoint's job (it needs the store); this check is the
// store-anywhere contract.
func ValidateDesignOpeningSelection(selection DesignOpeningSelection) error {
	switch selection.System {
	case "gola":
		if strings.TrimSpace(selection.ProfileID) == "" {
			return fmt.Errorf("la selección gola exige un perfil exacto")
		}
	case "handle", "bottom_overhang":
		if strings.TrimSpace(selection.ProfileID) != "" {
			return fmt.Errorf("sólo el sistema gola consume un perfil")
		}
	default:
		return fmt.Errorf("sistema de apertura desconocido %q", selection.System)
	}
	seen := map[string]bool{}
	for _, placement := range selection.Placements {
		switch placement {
		case "top", "between", "bottom":
			if seen[placement] {
				return fmt.Errorf("placement repetida %q", placement)
			}
			seen[placement] = true
		default:
			return fmt.Errorf("placement de apertura desconocida %q", placement)
		}
	}
	return nil
}
