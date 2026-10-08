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
	// bottom in v1's single-zone layout); optional — the profile's own
	// compatible placements govern when absent.
	Placements []string `json:"placements,omitempty"`
	// ProfilePin freezes the datasheet slice the selection was VALIDATED
	// against at authoring time (review follow-up B2): the historical
	// resolution consumes these values, never the live catalog — a datasheet
	// update changes fronts only through an explicit new selection. Absent
	// only in rows authored before the pin existed (they resolve against
	// the live catalog until re-saved).
	ProfilePin *DesignOpeningProfilePin `json:"profilePin,omitempty"`
}

// DesignOpeningProfilePin is the pinned datasheet slice of one selection.
type DesignOpeningProfilePin struct {
	ProfileCode      string `json:"profileCode"`
	FrontReductionMm int    `json:"frontReductionMm"`
	GripClearanceMm  int    `json:"gripClearanceMm"`
	DatasheetStatus  string `json:"datasheetStatus"`
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
		case "between":
			// B3 (review of the review): v1 resolves ONE front region per
			// furniture — a between grip is geometrically meaningless and
			// used to be silently reinterpreted as top. Reject at the
			// persistence boundary; the multi-zone editor lifts this later.
			return fmt.Errorf("la posición «Entre frentes» no aplica al layout v1 de una zona: elegí Superior o Inferior")
		case "top", "bottom":
			if seen[placement] {
				return fmt.Errorf("placement repetida %q", placement)
			}
			seen[placement] = true
		default:
			return fmt.Errorf("placement de apertura desconocida %q", placement)
		}
	}
	if selection.ProfilePin != nil {
		pin := selection.ProfilePin
		if strings.TrimSpace(pin.ProfileCode) == "" || pin.DatasheetStatus != "verified" ||
			pin.FrontReductionMm <= 0 || pin.GripClearanceMm < 0 {
			return fmt.Errorf("el pin de perfil exige código, estado verificado y geometría positiva")
		}
	}
	return nil
}
