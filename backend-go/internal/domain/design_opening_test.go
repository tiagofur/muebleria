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
