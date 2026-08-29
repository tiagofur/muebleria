// Cloned-catalog independence (F179 / #326): pilot orgs start from a full
// clone of the base catalog with their OWN rows (new UUIDs, same codes).
// Editing price/material/name in A must leave B's copy untouched.

package pilotreadiness

import (
	"net/http"
	"testing"
)

func TestPilotReadiness_CatalogCloneIndependence(t *testing.T) {
	type board struct {
		ID         string  `json:"id"`
		Code       string  `json:"code"`
		Name       string  `json:"name"`
		BoardPrice float64 `json:"board_price"`
	}
	var listA, listB []board
	fx.decode(t, http.MethodGet, "/api/catalog/materials", fx.a.admin.token, nil, http.StatusOK, &listA)
	fx.decode(t, http.MethodGet, "/api/catalog/materials", fx.b.admin.token, nil, http.StatusOK, &listB)

	byCodeB := map[string]board{}
	for _, b := range listB {
		byCodeB[b.Code] = b
	}

	// Find a board that exists in both orgs (cloned from the base catalog
	// with the same code but its own row/id).
	var sharedA, sharedB board
	for _, a := range listA {
		if b, ok := byCodeB[a.Code]; ok {
			sharedA, sharedB = a, b
			break
		}
	}
	if sharedA.ID == "" {
		t.Fatal("catalog: no shared cloned board code between pilot-a and pilot-b — did the clone run?")
	}
	if sharedA.ID == sharedB.ID {
		t.Fatalf("catalog: cloned board %q shares the row id between orgs", sharedA.Code)
	}

	// Mutate A's copy: new name + new price.
	renamed := map[string]any{
		"code":         sharedA.Code,
		"name":         "Tablero Renombrado Alfa",
		"manufacturer": "Maderas Fixture",
		"width_mm":     2750, "length_mm": 1850, "thickness_mm": 18,
		"board_price":   sharedA.BoardPrice + 321.75,
		"waste_percent": 8, "cost_per_m2": 25.5,
		"grain_default": true, "preview_color": "#a9714b",
	}
	fx.want(t, http.MethodPut, "/api/catalog/materials/"+sharedA.ID, fx.a.admin.token, renamed, http.StatusOK)

	// A sees its edit…
	var afterA board
	fx.decode(t, http.MethodGet, "/api/catalog/materials/"+sharedA.ID, fx.a.admin.token, nil, http.StatusOK, &afterA)
	if afterA.Name != "Tablero Renombrado Alfa" {
		t.Fatalf("catalog: A's rename did not apply (name=%q)", afterA.Name)
	}

	// …and B's copy of the same code is untouched.
	var afterB board
	fx.decode(t, http.MethodGet, "/api/catalog/materials/"+sharedB.ID, fx.b.admin.token, nil, http.StatusOK, &afterB)
	if afterB.Name != sharedB.Name {
		t.Fatalf("catalog: edit in A changed B's board name: %q → %q", sharedB.Name, afterB.Name)
	}
	if afterB.BoardPrice != sharedB.BoardPrice {
		t.Fatalf("catalog: edit in A changed B's board price: %v → %v", sharedB.BoardPrice, afterB.BoardPrice)
	}

	// The clone is complete: both orgs hold the same number of modules.
	var modulesA, modulesB []map[string]any
	fx.decode(t, http.MethodGet, "/api/catalog/modules", fx.a.admin.token, nil, http.StatusOK, &modulesA)
	fx.decode(t, http.MethodGet, "/api/catalog/modules", fx.b.admin.token, nil, http.StatusOK, &modulesB)
	if len(modulesA) == 0 || len(modulesA) != len(modulesB) {
		t.Fatalf("catalog: cloned modules differ (A=%d B=%d) — clones must be complete and equal", len(modulesA), len(modulesB))
	}
}
