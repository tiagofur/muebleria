package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// layoutStubServer builds the one-door cabinet world (engine fixture shape)
// behind the API stub store.
func layoutStubServer(t *testing.T) (*Server, string) {
	t.Helper()
	module, catalog := layoutCabinetFixture()
	u := &domain.User{ID: "u1", Active: true}
	server := licenseTestServer(t, u, nil)
	server.Store = &stubStore{
		getUserByEmail:  u,
		moduleReturnedByID: module,
		listStructures:  catalog.Structures,
		listComponents:  catalog.Components,
		listAgregados:   catalog.Agregados,
		listHardwares:   catalog.Hardware,
	}
	token, err := auth.GenerateToken(u.ID, "u@example.com", auth.TokenContext{Roles: []string{"user"}, OrgID: "org-1"}, furnitureTestSecret)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	return server, token
}

// layoutCabinetFixture mirrors engine's oneDoorCabinetCatalog shape.
func layoutCabinetFixture() (*domain.Module, domain.Catalog) {
	strPtr := func(s string) *string { return &s }
	floatPtr := func(f float64) *float64 { return &f }

	lateral := domain.Component{
		ID: "comp-side", Code: "LAT", Name: "Lateral", Placement: domain.PlacementLateralIzquierdo,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"LATERAL"},
		LengthFormula: "PH - 2*T", WidthFormula: "PD", Active: true,
	}
	right := lateral
	right.ID = "comp-side-r"
	right.Placement = domain.PlacementLateralDerecho
	door := domain.Component{
		ID: "comp-door", Code: "PTA", Name: "Puerta", Placement: domain.PlacementPuerta,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"FRENTE"},
		LengthFormula: "PH - 4", WidthFormula: "PW - 4", Active: true,
	}
	module := domain.Module{
		ID: "11111111-1111-1111-1111-111111111111", Code: "BASE-600", Name: "Base Una Puerta 600",
		WidthMm: 600, HeightMm: 720, DepthMm: 560, StructureID: "st-1",
		Components: []domain.ComponentInstance{
			{
				ComponentID: "comp-door", Quantity: 1,
				Overrides: &domain.ComponentInstanceOverrides{
					HardwarePlacements: []domain.HardwarePlacement{{
						HardwareID: "hw-handle", AnchorFace: "front",
						RelativePosition: domain.HardwareRelPosition{XMm: 40, YMm: 360},
					}},
				},
			},
		},
	}
	catalog := domain.Catalog{
		Structures: []domain.Structure{{
			ID: "st-1", Code: "CUERPO", Name: "Cuerpo Base", Active: true,
			Components: []domain.ComponentInstance{
				{ComponentID: "comp-side", Quantity: 1},
				{ComponentID: "comp-side-r", Quantity: 1},
			},
		}},
		Components: []domain.Component{lateral, right, door},
		Hardware: []domain.Hardware{{
			ID: "hw-handle", Code: "MAN-160", Name: "Manija 160", Unit: domain.UnitPiece, Active: true,
			PreviewShape: strPtr("bar-pull"), PreviewSizeMm: floatPtr(160),
		}},
	}
	return &module, catalog
}

func TestFurnitureDefinitionLayoutServesCompleteComposition(t *testing.T) {
	server, token := layoutStubServer(t)

	handler := AuthMiddleware(furnitureTestSecret, server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitionLayout))
	req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions/11111111-1111-1111-1111-111111111111/layout", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("definitionId", "11111111-1111-1111-1111-111111111111")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("resolved layouts must not be cached, got Cache-Control %q", got)
	}

	var layout engine.FurnitureLayout
	if err := json.Unmarshal(rec.Body.Bytes(), &layout); err != nil {
		t.Fatalf("decode layout: %v", err)
	}
	// Both structure sides + the module door with its handle: the complete
	// real furniture, not the "solo laterales" generic fallback.
	if len(layout.Components) != 3 {
		t.Fatalf("expected 3 boards (2 laterales + puerta), got %d: %+v", len(layout.Components), layout.Components)
	}
	if len(layout.Hardware) != 1 || layout.Hardware[0].Shape != "bar-pull" {
		t.Fatalf("expected the door handle in the layout, got %+v", layout.Hardware)
	}
	if layout.DefinitionName != "Base Una Puerta 600" || layout.DimensionsMm != [3]int{600, 720, 560} {
		t.Fatalf("definition identity lost: %+v", layout)
	}
	for _, c := range layout.Components {
		if c.Name == "" || c.SlotID == "" || c.Kind != "board" {
			t.Fatalf("component shape incomplete: %+v", c)
		}
	}
}

func TestFurnitureDefinitionLayoutQueryDimsOverride(t *testing.T) {
	server, token := layoutStubServer(t)

	handler := AuthMiddleware(furnitureTestSecret, server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitionLayout))
	req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions/x/layout?widthMm=900&heightMm=800&depthMm=500", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("definitionId", "11111111-1111-1111-1111-111111111111")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var layout engine.FurnitureLayout
	if err := json.Unmarshal(rec.Body.Bytes(), &layout); err != nil {
		t.Fatalf("decode layout: %v", err)
	}
	if layout.DimensionsMm != [3]int{900, 800, 500} {
		t.Fatalf("query overrides not applied: %v", layout.DimensionsMm)
	}
}

func TestFurnitureDefinitionLayoutRejectsInvalidDims(t *testing.T) {
	server, token := layoutStubServer(t)

	handler := AuthMiddleware(furnitureTestSecret, server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitionLayout))
	req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions/x/layout?widthMm=abc", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("definitionId", "11111111-1111-1111-1111-111111111111")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body: %v", err)
	}
	if body["error"] == "" || body["error"] == "error interno del servidor" {
		t.Fatalf("invalid dims must explain themselves, got %q", body["error"])
	}
}

func TestFurnitureDefinitionLayoutUnknownDefinition(t *testing.T) {
	server, token := layoutStubServer(t)
	server.Store.(*stubStore).moduleReturnedByID = nil // no such definition

	handler := AuthMiddleware(furnitureTestSecret, server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitionLayout))
	req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions/unknown/layout", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("definitionId", "unknown")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestFurnitureDefinitionLayoutUnresolvableComposition(t *testing.T) {
	server, token := layoutStubServer(t)
	server.Store.(*stubStore).listStructures = nil // structure gone: layout cannot resolve

	handler := AuthMiddleware(furnitureTestSecret, server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitionLayout))
	req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions/x/layout", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("definitionId", "11111111-1111-1111-1111-111111111111")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body: %v", err)
	}
	if body["error"] == "" || body["error"] == "error interno del servidor" {
		t.Fatalf("resolution failure must surface its cause, got %q", body["error"])
	}
}

func TestFurnitureDefinitionLayoutRequiresActiveLicense(t *testing.T) {
	module, catalog := layoutCabinetFixture()
	u := &domain.User{ID: "u1", Active: true}
	// Org without an active license → the layout endpoint must block.
	noLicense := &domain.Organization{
		ID: "org-1", Name: "Taller Test", Slug: "taller-test",
		Type: domain.OrganizationTypeFactory, Active: true,
	}
	server := licenseTestServer(t, u, noLicense)
	server.Store = &stubStore{
		getUserByEmail:     u,
		getOrgByID:         noLicense,
		moduleReturnedByID: module,
		listStructures:     catalog.Structures,
		listComponents:     catalog.Components,
		listHardwares:      catalog.Hardware,
	}
	token, _ := auth.GenerateToken(u.ID, "u@example.com", auth.TokenContext{Roles: []string{"user"}, OrgID: "org-1"}, furnitureTestSecret)

	handler := AuthMiddleware(furnitureTestSecret, server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitionLayout))
	req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions/x/layout", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("definitionId", "11111111-1111-1111-1111-111111111111")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestFurnitureDefinitionLayoutMaterialChoices(t *testing.T) {
	server, token := layoutStubServer(t)
	server.Store.(*stubStore).listMaterials = []domain.MaterialBoard{
		// ThicknessMm mirrors the DB contract (material_boards.thickness_mm
		// NOT NULL CHECK > 0): a selected board always carries a real thickness.
		{ID: "mat-oak", Code: "ROBLE-CLARO", Name: "Roble Claro", ThicknessMm: 18, PreviewColor: "#c4a574", Active: true},
	}

	handler := AuthMiddleware(furnitureTestSecret, server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitionLayout))
	send := func(query string) (*httptest.ResponseRecorder, engine.FurnitureLayout) {
		req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions/x/layout"+query, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.SetPathValue("definitionId", "11111111-1111-1111-1111-111111111111")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		var layout engine.FurnitureLayout
		if rec.Code == http.StatusOK {
			if err := json.Unmarshal(rec.Body.Bytes(), &layout); err != nil {
				t.Fatalf("decode layout: %v", err)
			}
		}
		return rec, layout
	}

	// choice.FRENTE rides in the query (extension tokens are GET-only).
	rec, layout := send("?choice.FRENTE=mat-oak")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	door := layout.Components[len(layout.Components)-1] // module door is last
	if door.OptionRole != "FRENTE" || door.MaterialID != "mat-oak" ||
		door.MaterialCode != "ROBLE-CLARO" || door.MaterialColorHex != "#c4a574" {
		t.Fatalf("door material not resolved from the choice: %+v", door)
	}

	// Unknown choice → explicit 422 (never a silent fallback).
	rec, _ = send("?choice.FRENTE=mat-nope")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unknown choice status = %d body=%s", rec.Code, rec.Body.String())
	}

	// Empty/blank choice values are ignored, not errors.
	rec, _ = send("?choice.FRENTE=")
	if rec.Code != http.StatusOK {
		t.Fatalf("blank choice status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestFurnitureDefinitionsCarryMaterialsAndRoles(t *testing.T) {
	module, catalog := layoutCabinetFixture()
	u := &domain.User{ID: "u1", Active: true}
	server := licenseTestServer(t, u, nil)
	server.Store = &stubStore{
		getUserByEmail: u,
		listModules:    []domain.Module{*module},
		listStructures: catalog.Structures,
		listComponents: catalog.Components,
		listHardwares:  catalog.Hardware,
		listMaterials: []domain.MaterialBoard{
			{ID: "mat-white", Code: "MEL-BLANCO", Name: "Melamina Blanca", ThicknessMm: 18, Active: true},
			{ID: "mat-oak", Code: "ROBLE-CLARO", Name: "Roble Claro", ThicknessMm: 18, PreviewColor: "#c4a574", Active: true},
			{ID: "mat-old", Code: "VIEJO", Name: "Descontinuado", Active: false},
		},
		listOptionGroups: []domain.OptionGroup{
			// Curated list for FRENTE: only oak.
			{ID: "og-1", Code: "FRENTE", Name: "Frente / Puertas", Kind: "board",
				OptionIDs: []string{"mat-oak"}},
			// Hardware group must not leak into board roles.
			{ID: "og-2", Code: "CORREDERAS", Name: "Correderas", Kind: "hardware",
				OptionIDs: []string{"hw-x"}},
		},
	}
	token, _ := auth.GenerateToken(u.ID, "u@example.com", auth.TokenContext{Roles: []string{"user"}, OrgID: "org-1"}, furnitureTestSecret)

	handler := AuthMiddleware(furnitureTestSecret, server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitions))
	req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var served workshopFurnitureCatalog
	if err := json.Unmarshal(rec.Body.Bytes(), &served); err != nil {
		t.Fatalf("decode served: %v", err)
	}

	// Only active boards are exposed.
	if len(served.Materials) != 2 {
		t.Fatalf("expected 2 active materials, got %+v", served.Materials)
	}
	oak := served.Materials[1]
	if oak.MaterialID != "mat-oak" || oak.Code != "ROBLE-CLARO" || oak.PreviewColor != "#c4a574" {
		t.Fatalf("material visual fields lost: %+v", oak)
	}

	// Definition roles: FRENTE curated by the board group, LATERAL without a
	// group falls back to every active material.
	def := served.Definitions[module.ID]
	if len(def.MaterialRoles) != 2 {
		t.Fatalf("expected roles FRENTE+LATERAL, got %+v", def.MaterialRoles)
	}
	roles := map[string]workshopMaterialRole{}
	for _, r := range def.MaterialRoles {
		roles[r.Role] = r
	}
	frente := roles["FRENTE"]
	if frente.Label != "Frente / Puertas" || len(frente.OptionIDs) != 1 || frente.OptionIDs[0] != "mat-oak" {
		t.Fatalf("FRENTE must use the curated board group: %+v", frente)
	}
	lateral := roles["LATERAL"]
	if lateral.Label != "LATERAL" || len(lateral.OptionIDs) != 2 {
		t.Fatalf("LATERAL without group must offer every active material: %+v", lateral)
	}
}

func TestFurnitureDefinitionsCarryEstimatedCounts(t *testing.T) {
	// The catalog endpoint reports each definition's real composition size so
	// clients stop guessing "2 piezas" for every cabinet.
	module, catalog := layoutCabinetFixture()
	u := &domain.User{ID: "u1", Active: true}
	server := licenseTestServer(t, u, nil)
	server.Store = &stubStore{
		getUserByEmail: u,
		listModules:    []domain.Module{*module},
		listStructures: catalog.Structures,
		listComponents: catalog.Components,
		listHardwares:  catalog.Hardware,
	}
	token, _ := auth.GenerateToken(u.ID, "u@example.com", auth.TokenContext{Roles: []string{"user"}, OrgID: "org-1"}, furnitureTestSecret)

	handler := AuthMiddleware(furnitureTestSecret, server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitions))
	req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var served workshopFurnitureCatalog
	if err := json.Unmarshal(rec.Body.Bytes(), &served); err != nil {
		t.Fatalf("decode served: %v", err)
	}
	def := served.Definitions[module.ID]
	if def.EstimatedPartCount != 3 {
		t.Fatalf("estimatedPartCount = %d, want 3 (2 laterales + puerta)", def.EstimatedPartCount)
	}
	if def.EstimatedHardwareCount != 1 {
		t.Fatalf("estimatedHardwareCount = %d, want 1 (manija)", def.EstimatedHardwareCount)
	}
}
