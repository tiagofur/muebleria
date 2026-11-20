package domain

import "testing"

func ptr(v float64) *float64 { return &v }

func TestApplyPricePercent(t *testing.T) {
	items := []PricedItem{
		{ID: "a", Code: "A", Price: 100},
		{ID: "b", Code: "B", Price: 0.04}, // +10% rounds back to 0.04
		{ID: "c", Code: "C", Price: 1234.565},
	}
	changed, unchanged := ApplyPricePercent(items, 10)
	if len(changed) != 2 || changed[0].NewPrice != 110 || changed[1].NewPrice != 1358.02 {
		t.Fatalf("changed: %+v", changed)
	}
	if len(unchanged) != 1 || unchanged[0].ID != "b" {
		t.Fatalf("unchanged: %+v", unchanged)
	}
	changed, _ = ApplyPricePercent([]PricedItem{{ID: "a", Price: 100}}, -15)
	if changed[0].NewPrice != 85 {
		t.Fatalf("discount: %+v", changed)
	}
}

func TestValidatePricePercent(t *testing.T) {
	for _, bad := range []float64{0, -91, 501} {
		if ValidatePricePercent(bad) == nil {
			t.Fatalf("%v accepted", bad)
		}
	}
	for _, ok := range []float64{-90, 0.5, 500} {
		if err := ValidatePricePercent(ok); err != nil {
			t.Fatalf("%v rejected: %v", ok, err)
		}
	}
}

// #1651 acceptance: 3 existing codes, 1 code absent from the catalog and 1
// invalid row are reported exactly in those groups; nothing matches by name.
func TestClassifyPriceImport(t *testing.T) {
	items := []PricedItem{
		{ID: "1", Code: "MEL-18", Name: "Melamina blanca 18", Price: 1000},
		{ID: "2", Code: "MDF-15", Name: "MDF 15", Price: 800},
		{ID: "3", Code: "TER-3", Name: "Terciado 3", Price: 300},
	}
	rows := []PriceImportRow{
		{Line: 2, Code: " MEL-18 ", Price: ptr(1100)},
		{Line: 3, Code: "MDF-15", Price: ptr(880.004)},
		{Line: 4, Code: "TER-3", Price: ptr(300)},
		{Line: 5, Code: "NUEVO-1", Price: ptr(50)},
		{Line: 6, Code: "Melamina blanca 18", Price: ptr(1)}, // name, not code
		{Line: 7, Code: "MEL-18", Price: ptr(1200)},
		{Line: 8, Code: "", Price: ptr(5)},
		{Line: 9, Code: "X", Price: nil},
	}
	p := ClassifyPriceImport(items, rows)
	if len(p.Changed) != 2 || p.Changed[0].Item.ID != "1" || p.Changed[0].NewPrice != 1100 || p.Changed[1].NewPrice != 880 {
		t.Fatalf("changed: %+v", p.Changed)
	}
	if len(p.Unchanged) != 1 || p.Unchanged[0].ID != "3" {
		t.Fatalf("unchanged: %+v", p.Unchanged)
	}
	if len(p.NotFound) != 2 || p.NotFound[0].Code != "NUEVO-1" || p.NotFound[1].Code != "Melamina blanca 18" {
		t.Fatalf("not found: %+v", p.NotFound)
	}
	if len(p.Invalid) != 3 || p.Invalid[0].Line != 7 || p.Invalid[1].Line != 8 || p.Invalid[2].Line != 9 {
		t.Fatalf("invalid: %+v", p.Invalid)
	}
}
