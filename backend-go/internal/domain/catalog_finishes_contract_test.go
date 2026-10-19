package domain_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1209 PR2 — shared TS↔Go parity contract: the closed commercial finish
// preset vocabulary in contracts/hardwareFinishPresets.contract.json pins
// both the Go catalog offer validation AND the snapshot freeze labels. Any
// drift between this runtime and the fixture fails here (and the TS mirror
// fails on its side).
func TestHardwareFinishPresetsContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "hardwareFinishPresets.contract.json"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Schema  string `json:"schema"`
		Presets []struct {
			ID      string `json:"id"`
			LabelES string `json:"labelEs"`
		} `json:"presets"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	if fixture.Schema != "granete.hardware-finish-presets.v1" {
		t.Fatalf("schema = %q", fixture.Schema)
	}

	var ids []string
	for _, p := range fixture.Presets {
		ids = append(ids, p.ID)
		if !domain.HardwareFinishIDValid(p.ID) {
			t.Fatalf("fixture preset %q not in the Go vocabulary", p.ID)
		}
		if domain.HardwareFinishLabelES(p.ID) != p.LabelES {
			t.Fatalf("fixture label for %q = %q, Go says %q", p.ID, p.LabelES, domain.HardwareFinishLabelES(p.ID))
		}
	}
	if err := domain.ValidateHardwareFinishIDs(ids); err != nil {
		t.Fatalf("the full fixture list must validate: %v", err)
	}
	// Closed both ways: absent-from-fixture ids never validate.
	if domain.HardwareFinishIDValid("rose-gold") {
		t.Fatal("rose-gold must stay outside the closed vocabulary")
	}
	if domain.HardwareFinishLabelES("rose-gold") != "" {
		t.Fatal("unknown ids must have no snapshot label")
	}
}
