package storage

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestFullComponentInstanceOverridesJSON_roundTrip(t *testing.T) {
	rx := 90
	ov := &domain.ComponentInstanceOverrides{
		LengthFormula: "PH",
		WidthFormula:  "PD - 2*T",
		XFormula:      "0",
		YFormula:      "0",
		ZFormula:      "0",
		RotateX:       &rx,
	}
	raw := fullComponentInstanceOverridesJSON(ov)
	if raw == nil {
		t.Fatal("expected non-nil JSON for non-empty overrides")
	}
	parsed := parseComponentInstanceOverridesJSON(raw)
	if parsed == nil {
		t.Fatal("parse returned nil")
	}
	if parsed.LengthFormula != "PH" || parsed.WidthFormula != "PD - 2*T" {
		t.Errorf("formulas: got %+v", parsed)
	}
	if parsed.XFormula != "0" || parsed.YFormula != "0" || parsed.ZFormula != "0" {
		t.Errorf("spatial formulas: got %+v", parsed)
	}
	if parsed.RotateX == nil || *parsed.RotateX != 90 {
		t.Errorf("rotateX: got %v want 90", parsed.RotateX)
	}
}

func TestFullComponentInstanceOverridesJSON_emptyIsNil(t *testing.T) {
	if fullComponentInstanceOverridesJSON(nil) != nil {
		t.Error("nil overrides should serialize to nil")
	}
	if fullComponentInstanceOverridesJSON(&domain.ComponentInstanceOverrides{}) != nil {
		t.Error("zero overrides should serialize to nil")
	}
	if parseComponentInstanceOverridesJSON(nil) != nil {
		t.Error("nil blob should parse to nil")
	}
	if parseComponentInstanceOverridesJSON([]byte("null")) != nil {
		t.Error("null blob should parse to nil")
	}
	if parseComponentInstanceOverridesJSON([]byte("{}")) != nil {
		t.Error("empty object should parse to nil")
	}
}

func TestParseComponentInstanceOverridesJSON_edgesFallback(t *testing.T) {
	// Edges-only legacy shape still materializes.
	raw := []byte(`{"edges":[{"side":"L1","enabled":true}]}`)
	parsed := parseComponentInstanceOverridesJSON(raw)
	if parsed == nil || len(parsed.Edges) != 1 || parsed.Edges[0].Side != "L1" {
		t.Fatalf("edges fallback: got %+v", parsed)
	}
}
