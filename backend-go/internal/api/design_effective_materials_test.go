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
