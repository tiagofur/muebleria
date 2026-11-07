package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestHandleDesignEffectiveMaterials(t *testing.T) {
	const (
		testDesignID = "52000000-0000-0000-0000-000000000001"
		modUUID      = "61000000-0000-0000-0000-000000000001"
		modCode      = "MOD-BASE-1"
		matWhite     = "mat-white-18"
		matGrey      = "mat-grey-18"
		matOak       = "mat-oak-18"
		matWalnut    = "mat-walnut-18"
		matGlass     = "mat-glass-custom"
	)

	lateral := domain.Component{
		ID: "comp-side", Code: "LAT", Name: "Lateral", Placement: domain.PlacementLateralIzquierdo,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"BODY"},
		LengthFormula: "PH - 2*T", WidthFormula: "PD", Active: true,
	}
	door := domain.Component{
		ID: "comp-door", Code: "PTA", Name: "Puerta", Placement: domain.PlacementPuerta,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"FRENTES"},
		LengthFormula: "PH - 4", WidthFormula: "PW - 4", Active: true,
	}

	sampleCatalog := domain.Catalog{
		Materials: []domain.MaterialBoard{
			{ID: matWhite, Code: "MW", Name: "Blanco 18", Active: true, ThicknessMm: 18},
			{ID: matGrey, Code: "MG", Name: "Gris 18", Active: true, ThicknessMm: 18},
			{ID: matOak, Code: "MO", Name: "Roble 18", Active: true, ThicknessMm: 18},
			{ID: matWalnut, Code: "MWN", Name: "Nogal 18", Active: true, ThicknessMm: 18},
		},
		OptionGroups: []domain.OptionGroup{
			{
				Code:      "BODY",
				Name:      "Cuerpo",
				Kind:      "board",
				OptionIDs: []string{matWhite, matGrey},
			},
			{
				Code:      "FRENTES",
				Name:      "Frentes",
				Kind:      "board",
				OptionIDs: []string{matOak, matWalnut},
			},
			{
				Code:      "CAJON",
				Name:      "Cajón",
				Kind:      "agregado",
				OptionIDs: []string{"agr-cajon-1"},
			},
		},
		Agregados: []domain.Agregado{
			{ID: "agr-cajon-1", Code: "CAJON-1", Name: "Cajón Hafele", Active: true},
		},
		Components: []domain.Component{lateral, door},
		Structures: []domain.Structure{
			{
				ID: "st-1", Code: "CUERPO", Name: "Cuerpo Base", Active: true,
				Components: []domain.ComponentInstance{
					{ComponentID: "comp-side", Quantity: 1},
				},
			},
		},
		Modules: []domain.Module{
			{
				ID:      modUUID,
				Code:    modCode,
				Name:    "Módulo Base",
				WidthMm: 600, HeightMm: 720, DepthMm: 560,
				StructureID: "st-1",
				Components: []domain.ComponentInstance{
					{ComponentID: "comp-door", Quantity: 1},
				},
				Agregados: []domain.ModuleAgregadoInstance{
					{ID: "inst-cajon", AgregadoID: "agr-cajon-1", OptionRole: "CAJON", Quantity: 1},
				},
			},
		},
	}

	defaults := domain.DesignAuthoringDefaults{
		MaterialChoices: map[string]string{
			"BODY":    matWhite,
			"FRENTES": matOak,
		},
	}

	setupServer := func(workingDefaults domain.DesignAuthoringDefaults, getWcErr error) *Server {
		store := &stubStore{
			catalogOverride: &sampleCatalog,
			designWorkingCopiesByID: map[string]domain.DesignWorkingCopy{
				testDesignID: {
					DesignID:          testDesignID,
					ProjectID:         "proj-1",
					SourceType:        domain.DesignRevisionSourceManual,
					AuthoringDefaults: workingDefaults,
					UpdatedAt:         time.Now(),
				},
			},
			getDesignWorkingCopyErr: getWcErr,
		}
		return &Server{Store: store}
	}

	t.Run("Full inheritance from design defaults", func(t *testing.T) {
		srv := setupServer(defaults, nil)
		bodyJSON := `{"furnitureDefinitionId":"` + modUUID + `"}`
		req := designRequest(http.MethodPost, "/api/designs/"+testDesignID+"/effective-materials", bodyJSON, string(domain.RoleAdmin))
		rr := httptest.NewRecorder()

		srv.HandleDesignEffectiveMaterials(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
		}
		var resp openapi.DesignEffectiveMaterials
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if resp.FurnitureDefinitionId != modUUID {
			t.Errorf("definitionId = %s, want %s", resp.FurnitureDefinitionId, modUUID)
		}
		if resp.MaterialChoices["BODY"] != matWhite || resp.MaterialChoiceModes["BODY"] != openapi.DesignMaterialChoiceModeDesign {
			t.Errorf("BODY = %v (mode %v), want %s (mode design)", resp.MaterialChoices["BODY"], resp.MaterialChoiceModes["BODY"], matWhite)
		}
		if resp.MaterialChoices["FRENTES"] != matOak || resp.MaterialChoiceModes["FRENTES"] != openapi.DesignMaterialChoiceModeDesign {
			t.Errorf("FRENTES = %v (mode %v), want %s (mode design)", resp.MaterialChoices["FRENTES"], resp.MaterialChoiceModes["FRENTES"], matOak)
		}
		if resp.MaterialChoices["CAJON"] != "agr-cajon-1" || resp.MaterialChoiceModes["CAJON"] != openapi.DesignMaterialChoiceModeDefinition {
			t.Errorf("CAJON = %v (mode %v), want agr-cajon-1 (mode definition)", resp.MaterialChoices["CAJON"], resp.MaterialChoiceModes["CAJON"])
		}
	})

	t.Run("Manual override wins over design default", func(t *testing.T) {
		srv := setupServer(defaults, nil)
		bodyJSON := `{
			"furnitureDefinitionId":"` + modUUID + `",
			"materialChoices":{"FRENTES":"` + matWalnut + `"}
		}`
		req := designRequest(http.MethodPost, "/api/designs/"+testDesignID+"/effective-materials", bodyJSON, string(domain.RoleAdmin))
		rr := httptest.NewRecorder()

		srv.HandleDesignEffectiveMaterials(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
		}
		var resp openapi.DesignEffectiveMaterials
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if resp.MaterialChoices["BODY"] != matWhite || resp.MaterialChoiceModes["BODY"] != openapi.DesignMaterialChoiceModeDesign {
			t.Errorf("BODY = %v (mode %v), want %s (mode design)", resp.MaterialChoices["BODY"], resp.MaterialChoiceModes["BODY"], matWhite)
		}
		if resp.MaterialChoices["FRENTES"] != matWalnut || resp.MaterialChoiceModes["FRENTES"] != openapi.DesignMaterialChoiceModeOverride {
			t.Errorf("FRENTES = %v (mode %v), want %s (mode override)", resp.MaterialChoices["FRENTES"], resp.MaterialChoiceModes["FRENTES"], matWalnut)
		}
	})

	t.Run("Incompatible design default falls back to definition default with definition mode", func(t *testing.T) {
		// Design default specifies matGlass for FRENTES, but FRENTES only allows matOak and matWalnut
		incompatibleDefaults := domain.DesignAuthoringDefaults{
			MaterialChoices: map[string]string{
				"BODY":    matWhite,
				"FRENTES": matGlass,
			},
		}
		srv := setupServer(incompatibleDefaults, nil)
		bodyJSON := `{"furnitureDefinitionId":"` + modUUID + `"}`
		req := designRequest(http.MethodPost, "/api/designs/"+testDesignID+"/effective-materials", bodyJSON, string(domain.RoleAdmin))
		rr := httptest.NewRecorder()

		srv.HandleDesignEffectiveMaterials(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
		}
		var resp openapi.DesignEffectiveMaterials
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if resp.MaterialChoices["BODY"] != matWhite || resp.MaterialChoiceModes["BODY"] != openapi.DesignMaterialChoiceModeDesign {
			t.Errorf("BODY = %v (mode %v), want %s (mode design)", resp.MaterialChoices["BODY"], resp.MaterialChoiceModes["BODY"], matWhite)
		}
		// First option in option group is matOak, materialized as curated
		// definition fallback — never a user exception.
		if resp.MaterialChoices["FRENTES"] != matOak || resp.MaterialChoiceModes["FRENTES"] != openapi.DesignMaterialChoiceModeDefinition {
			t.Errorf("FRENTES = %v (mode %v), want %s (mode definition fallback)", resp.MaterialChoices["FRENTES"], resp.MaterialChoiceModes["FRENTES"], matOak)
		}
	})

	t.Run("Lookup by module code succeeds", func(t *testing.T) {
		srv := setupServer(defaults, nil)
		bodyJSON := `{"furnitureDefinitionId":"` + modCode + `"}`
		req := designRequest(http.MethodPost, "/api/designs/"+testDesignID+"/effective-materials", bodyJSON, string(domain.RoleAdmin))
		rr := httptest.NewRecorder()

		srv.HandleDesignEffectiveMaterials(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
		}
		var resp openapi.DesignEffectiveMaterials
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if resp.FurnitureDefinitionId != modUUID {
			t.Errorf("definitionId = %s, want %s (resolved UUID from code)", resp.FurnitureDefinitionId, modUUID)
		}
	})

	t.Run("Requires authentication", func(t *testing.T) {
		srv := setupServer(defaults, nil)
		req := httptest.NewRequest(http.MethodPost, "/api/designs/"+testDesignID+"/effective-materials", nil)
		req.SetPathValue("designId", testDesignID)
		rr := httptest.NewRecorder()

		srv.HandleDesignEffectiveMaterials(rr, req)

		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401", rr.Code)
		}
	})

	t.Run("Invalid design ID returns 400", func(t *testing.T) {
		srv := setupServer(defaults, nil)
		req := designRequest(http.MethodPost, "/api/designs/not-a-uuid/effective-materials", `{"furnitureDefinitionId":"`+modUUID+`"}`, string(domain.RoleAdmin))
		req.SetPathValue("designId", "not-a-uuid")
		rr := httptest.NewRecorder()

		srv.HandleDesignEffectiveMaterials(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rr.Code)
		}
	})

	t.Run("Missing furnitureDefinitionId returns 400", func(t *testing.T) {
		srv := setupServer(defaults, nil)
		req := designRequest(http.MethodPost, "/api/designs/"+testDesignID+"/effective-materials", `{"furnitureDefinitionId":""}`, string(domain.RoleAdmin))
		rr := httptest.NewRecorder()

		srv.HandleDesignEffectiveMaterials(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rr.Code)
		}
	})

	t.Run("Design not found returns 404", func(t *testing.T) {
		srv := setupServer(defaults, domain.ErrDesignNotFound)
		req := designRequest(http.MethodPost, "/api/designs/"+testDesignID+"/effective-materials", `{"furnitureDefinitionId":"`+modUUID+`"}`, string(domain.RoleAdmin))
		rr := httptest.NewRecorder()

		srv.HandleDesignEffectiveMaterials(rr, req)

		if rr.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", rr.Code)
		}
	})

	t.Run("Definition not found returns 404", func(t *testing.T) {
		srv := setupServer(defaults, nil)
		req := designRequest(http.MethodPost, "/api/designs/"+testDesignID+"/effective-materials", `{"furnitureDefinitionId":"non-existent-module"}`, string(domain.RoleAdmin))
		rr := httptest.NewRecorder()

		srv.HandleDesignEffectiveMaterials(rr, req)

		if rr.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", rr.Code)
		}
	})
}

// #1555 (B1 del review #1563): the connected resolve receives the materials
// COMPOSED by this endpoint, not the plugin's raw map. The kit accessory
// groups of the definition's agregado options must be part of the
// composition — otherwise the plugin's accessory override is silently
// dropped (optional: lost quote line; required: accessory_choice_required
// despite the pick). They are ExplicitChoiceOnly: nobody's choice is never
// seeded with the first accessory.
func TestHandleDesignEffectiveMaterials_AccessoryGroups_1555(t *testing.T) {
	const (
		testDesignID = "52000000-0000-0000-0000-000000000155"
		modUUID      = "61000000-0000-0000-0000-000000000155"
	)
	kitE := "kit-e"
	catalog := domain.Catalog{
		Hardware: []domain.Hardware{
			{ID: kitE, Code: "MBOX-E", Name: "Kit MERIVOBOX E", Unit: domain.UnitSet, Active: true},
			{ID: "hw-gal-e", Code: "GAL-E", Name: "Galería E", Unit: domain.UnitPiece, Active: true},
		},
		OptionGroups: []domain.OptionGroup{
			{Code: "CAJON", Name: "Cajón", Kind: "agregado", OptionIDs: []string{"agr-e"}},
			{
				Code: "LATERAL_E", Name: "Lateral superior E", Kind: "hardware", Required: true,
				OptionIDs: []string{"hw-gal-e"}, KitHardwareID: &kitE,
			},
		},
		Agregados: []domain.Agregado{
			{ID: "agr-e", Code: "CAJON-E", Name: "Cajón E", Active: true, CommercialKitHardwareID: &kitE},
		},
		Modules: []domain.Module{
			{
				ID: modUUID, Code: "MOD-MBOX-E", Name: "Base MERIVOBOX E",
				WidthMm: 600, HeightMm: 720, DepthMm: 560,
				Agregados: []domain.ModuleAgregadoInstance{
					{ID: "inst-e", AgregadoID: "agr-e", OptionRole: "CAJON", Quantity: 1},
				},
			},
		},
	}
	srv := &Server{Store: &stubStore{
		catalogOverride: &catalog,
		designWorkingCopiesByID: map[string]domain.DesignWorkingCopy{
			testDesignID: {
				DesignID: testDesignID, ProjectID: "proj-1",
				SourceType: domain.DesignRevisionSourceManual, UpdatedAt: time.Now(),
			},
		},
	}}
	post := func(body string) openapi.DesignEffectiveMaterials {
		t.Helper()
		req := designRequest(http.MethodPost, "/api/designs/"+testDesignID+"/effective-materials", body, string(domain.RoleAdmin))
		rr := httptest.NewRecorder()
		srv.HandleDesignEffectiveMaterials(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
		}
		var resp openapi.DesignEffectiveMaterials
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		return resp
	}

	t.Run("the plugin's accessory override survives the composition", func(t *testing.T) {
		resp := post(`{"furnitureDefinitionId":"` + modUUID + `","materialChoices":{"CAJON":"agr-e","LATERAL_E":"hw-gal-e"}}`)
		if resp.MaterialChoices["LATERAL_E"] != "hw-gal-e" || resp.MaterialChoiceModes["LATERAL_E"] != openapi.DesignMaterialChoiceModeOverride {
			t.Fatalf("LATERAL_E = %q (mode %q), want hw-gal-e (override) — the connected resolve must see the pick: %v",
				resp.MaterialChoices["LATERAL_E"], resp.MaterialChoiceModes["LATERAL_E"], resp.MaterialChoices)
		}
	})

	t.Run("no accessory choice is never seeded with the first member", func(t *testing.T) {
		resp := post(`{"furnitureDefinitionId":"` + modUUID + `"}`)
		if _, ok := resp.MaterialChoices["LATERAL_E"]; ok {
			t.Fatalf("accessory nobody chose must carry no statement: %v", resp.MaterialChoices)
		}
		// The drawer group keeps its curated definition fallback (regression guard).
		if resp.MaterialChoices["CAJON"] != "agr-e" || resp.MaterialChoiceModes["CAJON"] != openapi.DesignMaterialChoiceModeDefinition {
			t.Fatalf("CAJON fallback must stay: %v / %v", resp.MaterialChoices, resp.MaterialChoiceModes)
		}
	})
}
