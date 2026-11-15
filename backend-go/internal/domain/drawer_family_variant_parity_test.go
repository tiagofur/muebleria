package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// #1633: paridad Go↔TS de la familia de cajón. Autoridad única:
// contracts/fixtures/drawerFamilyVariantParity.contract.json. Espejo TS:
// packages/domain/src/drawerFamilyVariantParity.contract.test.ts.

type drawerFamilyFixture struct {
	EffectiveLabel []struct {
		Name     string         `json:"name"`
		Variant  ProductVariant `json:"variant"`
		Expected string         `json:"expected"`
	} `json:"effectiveLabel"`
	VariantSets []struct {
		Name          string             `json:"name"`
		VariantSet    AgregadoVariantSet `json:"variantSet"`
		Valid         bool               `json:"valid"`
		ErrorContains string             `json:"errorContains"`
	} `json:"variantSets"`
	DrawerSystems []struct {
		Name          string               `json:"name"`
		DrawerSystem  AgregadoDrawerSystem `json:"drawerSystem"`
		Valid         bool                 `json:"valid"`
		ErrorContains string               `json:"errorContains"`
	} `json:"drawerSystems"`
}

func loadDrawerFamilyFixture(t *testing.T) drawerFamilyFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "fixtures", "drawerFamilyVariantParity.contract.json"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var f drawerFamilyFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	if len(f.EffectiveLabel) == 0 || len(f.VariantSets) == 0 || len(f.DrawerSystems) == 0 {
		t.Fatal("fixture sections must not be empty")
	}
	return f
}

func TestDrawerFamilyVariantParity_EffectiveLabel(t *testing.T) {
	for _, tc := range loadDrawerFamilyFixture(t).EffectiveLabel {
		if got := EffectiveVariantLabel(tc.Variant); got != tc.Expected {
			t.Errorf("%s: got %q, want %q", tc.Name, got, tc.Expected)
		}
	}
}

func TestDrawerFamilyVariantParity_VariantSets(t *testing.T) {
	for _, tc := range loadDrawerFamilyFixture(t).VariantSets {
		err := ValidateAgregadoVariantSet(tc.VariantSet)
		if tc.Valid && err != nil {
			t.Errorf("%s: unexpected error %v", tc.Name, err)
		}
		if !tc.Valid && (err == nil || !strings.Contains(err.Error(), tc.ErrorContains)) {
			t.Errorf("%s: want error containing %q, got %v", tc.Name, tc.ErrorContains, err)
		}
	}
}

func TestDrawerFamilyVariantParity_DrawerSystems(t *testing.T) {
	for _, tc := range loadDrawerFamilyFixture(t).DrawerSystems {
		ds := tc.DrawerSystem
		err := ValidateAgregadoDrawerSystem(&ds)
		if tc.Valid && err != nil {
			t.Errorf("%s: unexpected error %v", tc.Name, err)
		}
		if !tc.Valid && (err == nil || !strings.Contains(err.Error(), tc.ErrorContains)) {
			t.Errorf("%s: want error containing %q, got %v", tc.Name, tc.ErrorContains, err)
		}
	}
}

// The marker and labels survive the revision round trip (recipe payload ⇄
// agregado) — the hydration path the storage reads use (#1369/#1399).
func TestDrawerFamilyRecipeRoundTrip(t *testing.T) {
	agr := Agregado{
		ID: "agr", Code: "LGX-CAJON", Name: "Cajón Legrabox",
		DrawerSystem: &AgregadoDrawerSystem{Brand: "Blum", Line: "Legrabox"},
		VariantSets: []AgregadoVariantSet{{ID: "vs", Dimension: "height", Variants: []ProductVariant{
			{NominalDimensionMm: 90, HardwareID: "k1", Label: "N"},
			{NominalDimensionMm: 177, HardwareID: "k2", Label: "C"},
		}}},
	}
	raw, err := json.Marshal(agr.ToRecipePayload())
	if err != nil {
		t.Fatal(err)
	}
	var payload AgregadoRecipePayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	var back Agregado
	back.ApplyRecipe(payload)
	if back.DrawerSystem == nil || back.DrawerSystem.Line != "Legrabox" {
		t.Fatalf("drawerSystem lost in round trip: %+v", back.DrawerSystem)
	}
	if got := back.VariantSets[0].Variants[1].Label; got != "C" {
		t.Fatalf("label lost in round trip: %q", got)
	}
	// A recipe without the marker keeps its previous JSON shape (same hash).
	plain, _ := json.Marshal(Agregado{ID: "x"}.ToRecipePayload())
	if strings.Contains(string(plain), "drawerSystem") {
		t.Fatalf("unmarked recipe must omit drawerSystem: %s", plain)
	}
}
