package domain

import (
	"encoding/json"
	"strings"
	"testing"
)

// #1137 — the authoring defaults wrapper carries the design's opening
// intent with its own shape validation; the block's other fields keep their
// contracts.
func TestValidateDesignAuthoringDefaultsOpening(t *testing.T) {
	valid := DesignAuthoringDefaults{
		MaterialChoices: map[string]string{"LACA": "mat-1"},
		Opening:         &DesignOpeningSelection{System: "gola", ProfileID: "profile.gola-l.alu"},
	}
	if err := ValidateDesignAuthoringDefaults(valid); err != nil {
		t.Fatalf("valid block rejected: %v", err)
	}

	golaWithoutProfile := valid
	golaWithoutProfile.Opening = &DesignOpeningSelection{System: "gola"}
	if err := ValidateDesignAuthoringDefaults(golaWithoutProfile); err == nil {
		t.Fatal("gola without a profile must be rejected")
	}

	profileOutsideGola := valid
	profileOutsideGola.Opening = &DesignOpeningSelection{System: "handle", ProfileID: "profile.x"}
	if err := ValidateDesignAuthoringDefaults(profileOutsideGola); err == nil {
		t.Fatal("a profile outside gola must be rejected")
	}

	unknownSystem := valid
	unknownSystem.Opening = &DesignOpeningSelection{System: "tirador_magico"}
	if err := ValidateDesignAuthoringDefaults(unknownSystem); err == nil {
		t.Fatal("an unknown system must be rejected")
	}

	unknownPlacement := valid
	unknownPlacement.Opening = &DesignOpeningSelection{System: "gola", ProfileID: "p", Placements: []string{"izquierda"}}
	if err := ValidateDesignAuthoringDefaults(unknownPlacement); err == nil {
		t.Fatal("an unknown placement must be rejected")
	}

	// Canonical empty state stays exactly the materialChoices map — opening
	// absent is nil, never an empty struct.
	empty := DesignAuthoringDefaults{}.Normalize()
	if empty.Opening != nil || empty.MaterialChoices == nil {
		t.Fatalf("canonical empty drifted: %+v", empty)
	}

	// The durable JSON round-trips the selection (the storage block is
	// JSONB): marshal → unmarshal preserves the intent verbatim.
	raw := `{"materialChoices":{"LACA":"mat-1"},"opening":{"system":"gola","profileId":"profile.gola-l.alu","placements":["top"]}}`
	var block DesignAuthoringDefaults
	if err := json.Unmarshal([]byte(raw), &block); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if err := ValidateDesignAuthoringDefaults(block); err != nil {
		t.Fatalf("round-tripped block rejected: %v", err)
	}
	if block.Opening == nil || block.Opening.System != "gola" || block.Opening.ProfileID != "profile.gola-l.alu" ||
		len(block.Opening.Placements) != 1 || block.Opening.Placements[0] != "top" {
		t.Fatalf("round-trip drifted: %+v", block.Opening)
	}
	if !strings.Contains(raw, `"opening"`) {
		t.Fatal("sanity: the wire shape must carry the opening key")
	}
}

// #1337 — the pin freeze accepts the #1316 single door discount as the
// effective geometry: a verified profile authored with only door_reduction_mm
// (legacy pair 0/0) must be pinnable. A pin with no discount at all keeps
// failing closed with the same workshop-facing message.
func TestValidateDesignOpeningPinEffectiveDiscount(t *testing.T) {
	door := 35
	base := func() DesignOpeningSelection {
		return DesignOpeningSelection{
			System:     "gola",
			ProfileID:  "profile.gola-l.alu",
			Placements: []string{"top"},
			ProfilePin: &DesignOpeningProfilePin{
				ProfileCode:     "GOLA-L-ALU",
				DatasheetStatus: "verified",
				DoorReductionMm: &door,
				ProfileHeightMm: 56.5,
				ProfileDepthMm:  27.2,
				BOM:             &DesignOpeningProfilePinBOM{ProfileVersion: 7, Members: map[string]OpeningBOMMember{}},
			},
		}
	}

	if err := ValidateDesignOpeningSelection(base()); err != nil {
		t.Fatalf("pin with door_reduction_mm and 0/0 pair rejected: %v", err)
	}

	// Legacy pair alone still authorizes the freeze.
	legacy := base()
	legacy.ProfilePin.DoorReductionMm = nil
	legacy.ProfilePin.FrontReductionMm = 66
	legacy.ProfilePin.GripClearanceMm = 4
	if err := ValidateDesignOpeningSelection(legacy); err != nil {
		t.Fatalf("pin with legacy pair rejected: %v", err)
	}

	// No discount at all: same workshop-facing message, fail closed.
	none := base()
	none.ProfilePin.DoorReductionMm = nil
	err := ValidateDesignOpeningSelection(none)
	if err == nil || !strings.Contains(err.Error(), "el pin de perfil exige código, estado verificado y geometría positiva") {
		t.Fatalf("pin without any discount err = %v, want the workshop message", err)
	}

	// door_reduction_mm present but non-positive is invalid on its own —
	// present wins, no silent fallback to the pair.
	zero := base()
	bad := 0
	zero.ProfilePin.DoorReductionMm = &bad
	if err := ValidateDesignOpeningSelection(zero); err == nil {
		t.Fatal("pin with door_reduction_mm = 0 must be rejected (present wins)")
	}
}
