package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

const authoringFixtureModuleID = "22222222-2222-2222-2222-222222222222"

func authoringStrPtr(s string) *string     { return &s }
func authoringFloatPtr(f float64) *float64 { return &f }

// authoringStubServer builds the #477 fixture cabinet behind the API stub
// store (same shape as the engine's authoringCabinetCatalog).
func authoringStubServer(t *testing.T) (*Server, string) {
	t.Helper()
	module, catalog := authoringAPICabinetFixture()
	u := &domain.User{ID: "u1", AccountStatus: domain.AccountStatusActive}
	server := licenseTestServer(t, u, nil)
	server.Store = &stubStore{
		getUserByEmail:     u,
		moduleReturnedByID: module,
		listModules:        []domain.Module{*module},
		listStructures:     catalog.Structures,
		listComponents:     catalog.Components,
		listAgregados:      catalog.Agregados,
		listHardwares:      catalog.Hardware,
		listMaterials: []domain.MaterialBoard{
			{ID: "mat-oak18", Code: "ROBLE-CLARO", Name: "Roble Claro", ThicknessMm: 18, PreviewColor: "#c4a574", Active: true},
			{ID: "mat-white18", Code: "MEL-BLANCO", Name: "Melamina Blanca", ThicknessMm: 18, PreviewColor: "#f5f5f0", Active: true},
		},
	}
	token, err := auth.GenerateToken(u.ID, "u@example.com", auth.TokenContext{Roles: []string{"user"}, OrgID: "org-1"}, furnitureTestSecret)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	return server, token
}

func authoringAPICabinetFixture() (*domain.Module, domain.Catalog) {
	lateral := domain.Component{
		ID: "comp-side", Code: "LAT", Name: "Lateral", Placement: domain.PlacementLateralIzquierdo,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"LATERAL"},
		LengthFormula: "PH - 2*T", WidthFormula: "PD", Active: true,
	}
	right := lateral
	right.ID = "comp-side-r"
	right.Placement = domain.PlacementLateralDerecho
	floor := domain.Component{
		ID: "comp-base", Code: "PISO", Name: "Piso", Placement: domain.PlacementBase,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"INTERIOR"},
		LengthFormula: "PW - 2*T", WidthFormula: "PD - T", Active: true,
	}
	top := floor
	top.ID = "comp-top"
	top.Placement = domain.PlacementSuperior
	back := domain.Component{
		ID: "comp-back", Code: "FONDO", Name: "Fondo", Placement: domain.PlacementTrasera,
		GeometryKind: "rectangular_board", ThicknessMm: 15, OptionRoles: []string{"FONDO"},
		LengthFormula: "PW - 2*T", WidthFormula: "PH - 2*T", Active: true,
	}
	door := domain.Component{
		ID: "comp-door", Code: "PTA", Name: "Puerta", Placement: domain.PlacementPuerta,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"FRENTE"},
		LengthFormula: "PH - 4", WidthFormula: "PW - 4", Active: true,
	}
	shelf := domain.Component{
		ID: "comp-shelf", Code: "ENTRE", Name: "Entrepaño", Placement: domain.PlacementInterno,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"INTERIOR"},
		LengthFormula: "PW - 2*T", WidthFormula: "PD - T", Active: true,
	}
	structure := domain.Structure{
		ID: "st-authoring", Code: "CUERPO-BASE", Name: "Cuerpo Base", Active: true,
		Components: []domain.ComponentInstance{
			{ComponentID: "comp-side", Quantity: 1},
			{ComponentID: "comp-side-r", Quantity: 1},
			{ComponentID: "comp-base", Quantity: 1},
			{ComponentID: "comp-top", Quantity: 1},
			{ComponentID: "comp-back", Quantity: 1},
		},
	}
	module := domain.Module{
		ID: authoringFixtureModuleID, Code: "AUTH-600", Name: "Gabinete Authoring 600",
		WidthMm: 600, HeightMm: 720, DepthMm: 560, StructureID: "st-authoring",
		Components: []domain.ComponentInstance{
			{ComponentID: "comp-shelf", Quantity: 1},
			{
				ComponentID: "comp-door", Quantity: 1,
				Overrides: &domain.ComponentInstanceOverrides{
					HardwarePlacements: []domain.HardwarePlacement{
						{HardwareID: "hw-hinge", AnchorFace: "front",
							RelativePosition: domain.HardwareRelPosition{XMm: 298, YMm: 100}},
						{HardwareID: "hw-handle", AnchorFace: "front",
							RelativePosition: domain.HardwareRelPosition{XMm: 40, YMm: 360}},
					},
				},
			},
		},
	}
	catalog := domain.Catalog{
		Structures: []domain.Structure{structure},
		Components: []domain.Component{right, lateral, floor, top, back, door, shelf},
		Hardware: []domain.Hardware{
			{ID: "hw-handle", Code: "MAN-160", Name: "Manija 160", Unit: domain.UnitPiece, Active: true,
				PreviewShape: authoringStrPtr("bar-pull"), PreviewSizeMm: authoringFloatPtr(160), PreviewProjectionMm: authoringFloatPtr(37), PreviewDiameterMm: authoringFloatPtr(32)},
			{ID: "hw-hinge", Code: "BIS-CL110", Name: "Bisagra CL110", Unit: domain.UnitPiece, Active: true,
				PreviewShape: authoringStrPtr("hinge"), PreviewSizeMm: authoringFloatPtr(96), PreviewProjectionMm: authoringFloatPtr(25), PreviewDiameterMm: authoringFloatPtr(35)},
			{ID: "hw-hinge-b", Code: "BIS-CL100", Name: "Bisagra CL100", Unit: domain.UnitPiece, Active: true,
				PreviewShape: authoringStrPtr("hinge"), PreviewSizeMm: authoringFloatPtr(80), PreviewProjectionMm: authoringFloatPtr(22), PreviewDiameterMm: authoringFloatPtr(32)},
			{ID: "hw-minifix", Code: "HER-MIN-15", Name: "Minifix 15", Unit: domain.UnitPiece, Active: true},
			{ID: "hw-dowel", Code: "HER-TAQ-8X30", Name: "Tarugo 8x30", Unit: domain.UnitPiece, Active: true},
		},
	}
	return &module, catalog
}

func authoringFixtureRequest(furniture authoringResolveFurniture) authoringResolveRequest {
	return authoringResolveRequest{
		SchemaID:         engine.AuthoringResolveSchemaID,
		SchemaName:       engine.AuthoringResolveSchemaName,
		SchemaVersion:    engine.AuthoringResolveSchemaVersion,
		MessageID:        "msg-fixture-0001",
		IdempotencyKey:   "fixture:authoring-resolve:0001",
		SentAt:           "2026-08-29T12:00:00Z",
		Source:           authoringResolveSource{Client: "granete-for-sketchup", ClientVersion: "0.1.0", Host: "sketchup", HostVersion: "2026.2"},
		Units:            authoringResolveUnits{Length: "mm", Angle: "deg", PrecisionMm: 0.01},
		CoordinateSystem: authoringResolveCoordinateSystem{Handedness: "right", UpAxis: "z", ProjectFrameID: "frame-fixture"},
		Furniture:        furniture,
	}
}

func occurrenceJSON(instanceID, defID string, translation *[3]float64) engine.AuthoringOccurrence {
	occ := engine.AuthoringOccurrence{ComponentInstanceID: instanceID, ComponentDefinitionID: defID}
	if translation != nil {
		occ.Transform = &engine.AuthoringOccurrenceTransform{Frame: "assembly", TranslationMm: *translation}
	}
	return occ
}

func defaultOccurrencesJSON() []engine.AuthoringOccurrence {
	return []engine.AuthoringOccurrence{
		occurrenceJSON("side-left-01", "st-comp-side", nil),
		occurrenceJSON("side-right-01", "st-comp-side-r", nil),
		occurrenceJSON("floor-01", "st-comp-base", nil),
		occurrenceJSON("top-01", "st-comp-top", nil),
		occurrenceJSON("back-01", "st-comp-back", nil),
		occurrenceJSON("shelf-01", "mod-comp-shelf", nil),
		occurrenceJSON("door-01", "mod-comp-door", nil),
	}
}

func shelfRelJSON(id, shelfID string) engine.AuthoringRelationship {
	return engine.AuthoringRelationship{
		RelationshipID: id,
		Kind:           "shelf-support",
		Source:         engine.AuthoringRelationshipAnchor{ComponentInstanceID: shelfID, Role: "shelf-edge"},
		Targets: []engine.AuthoringRelationshipAnchor{
			{ComponentInstanceID: "side-left-01", Role: "inside-face"},
			{ComponentInstanceID: "side-right-01", Role: "inside-face"},
		},
	}
}

func postAuthoringResolve(server *Server, token, query string, body any) *httptest.ResponseRecorder {
	handler := AuthMiddleware(furnitureTestSecret, server.Store)(http.HandlerFunc(server.HandleFurnitureAuthoringResolve))
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/furniture/authoring/resolve"+query, bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// --- shared contract fixture -------------------------------------------------

type authoringFixtureFile struct {
	SchemaVersion         int                     `json:"schemaVersion"`
	Comment               string                  `json:"comment"`
	Schema                authoringFixtureSchema  `json:"schema"`
	FurnitureDefinitionID string                  `json:"furnitureDefinitionId"`
	Joinery               authoringFixtureJoinery `json:"joinery"`
	Scenarios             []authoringFixtureCase  `json:"scenarios"`
}

type authoringFixtureSchema struct {
	SchemaID      string `json:"schemaId"`
	SchemaName    string `json:"schemaName"`
	SchemaVersion string `json:"schemaVersion"`
}

type authoringFixtureJoinery struct {
	ComponentGeometry map[string]authoringFixtureGeometry           `json:"componentGeometry"`
	JoinerySystems    map[string]engine.ShelfSupportJoineryRule     `json:"joinerySystems"`
	RelationshipKinds map[string]string                             `json:"relationshipKinds"`
	ManualHardware    map[string]engine.ManualHardwareMachiningRule `json:"manualHardware"`
	Hardware          []authoringFixtureHardware                    `json:"hardware"`
}

type authoringFixtureGeometry struct {
	BoardLocal  string  `json:"boardLocal"`
	LengthMm    float64 `json:"lengthMm"`
	WidthMm     float64 `json:"widthMm"`
	ThicknessMm float64 `json:"thicknessMm"`
}

type authoringFixtureHardware struct {
	ID          string  `json:"id"`
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	Unit        string  `json:"unit"`
	CostPerUnit float64 `json:"costPerUnit"`
	Active      bool    `json:"active"`
}

type authoringFixtureCase struct {
	ID                 string          `json:"id"`
	Request            json.RawMessage `json:"request"`
	Query              string          `json:"query,omitempty"`
	ExpectedHttpStatus int             `json:"expectedHttpStatus"`
	Response           json.RawMessage `json:"response"`
}

// authoringFixtureScenarios drives the real handler and records the exact
// wire bodies the TS/Ruby parity tests consume.
func authoringFixtureScenarios(t *testing.T, server *Server, token string) []authoringFixtureCase {
	t.Helper()
	run := func(id, query string, request any, wantStatus int) authoringFixtureCase {
		t.Helper()
		requestBody, err := json.Marshal(request)
		if err != nil {
			t.Fatalf("marshal request %s: %v", id, err)
		}
		// Round-trip through a map so the fixture carries stable sorted keys.
		var normalized map[string]any
		if err := json.Unmarshal(requestBody, &normalized); err != nil {
			t.Fatalf("normalize request %s: %v", id, err)
		}
		stable, _ := json.Marshal(normalized)

		rec := postAuthoringResolve(server, token, query, normalized)
		if rec.Code != wantStatus {
			t.Fatalf("scenario %s: status = %d (want %d) body=%s", id, rec.Code, wantStatus, rec.Body.String())
		}
		return authoringFixtureCase{
			ID: id, Request: stable, Query: query,
			ExpectedHttpStatus: wantStatus, Response: json.RawMessage(rec.Body.Bytes()),
		}
	}

	furniture := func(mutate func(f *authoringResolveFurniture)) authoringResolveFurniture {
		f := authoringResolveFurniture{FurnitureDefinitionID: authoringFixtureModuleID}
		mutate(&f)
		return f
	}

	return []authoringFixtureCase{
		// 1. Existing cabinet parameters/materials resolve with GET parity.
		run("01-params-materials-parity", "", authoringFixtureRequest(furniture(func(f *authoringResolveFurniture) {
			f.Parameters = map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}
			f.MaterialChoices = map[string]string{"FRENTE": "mat-oak18"}
		})), http.StatusOK),

		// 2. Move shelf → dependent relationship/machining update.
		run("02-move-shelf", "", authoringFixtureRequest(furniture(func(f *authoringResolveFurniture) {
			occ := defaultOccurrencesJSON()
			occ[5] = occurrenceJSON("shelf-01", "mod-comp-shelf", &[3]float64{18, 18, 520})
			f.Components = occ
			f.Relationships = []engine.AuthoringRelationship{shelfRelJSON("rel-shelf-01", "shelf-01")}
		})), http.StatusOK),

		// 3. Add a second shelf sharing the reusable definition.
		run("03-add-shelf-shared-definition", "", authoringFixtureRequest(furniture(func(f *authoringResolveFurniture) {
			occ := append(defaultOccurrencesJSON(), occurrenceJSON("shelf-02", "mod-comp-shelf", &[3]float64{18, 18, 560}))
			f.Components = occ
			f.Relationships = []engine.AuthoringRelationship{
				shelfRelJSON("rel-shelf-01", "shelf-01"),
				shelfRelJSON("rel-shelf-02", "shelf-02"),
			}
		})), http.StatusOK),

		// 4. Remove shelf → only its dependent machining disappears.
		run("04-remove-shelf", "", authoringFixtureRequest(furniture(func(f *authoringResolveFurniture) {
			occ := defaultOccurrencesJSON()[:5]
			f.Components = append(occ, defaultOccurrencesJSON()[6])
		})), http.StatusOK),

		// 5. Move manual hinge → hinge machining moves, shelf machining stable.
		run("05-move-manual-hinge", "", authoringFixtureRequest(furniture(func(f *authoringResolveFurniture) {
			f.Components = defaultOccurrencesJSON()
			f.Relationships = []engine.AuthoringRelationship{shelfRelJSON("rel-shelf-01", "shelf-01")}
			f.HardwarePlacements = []engine.AuthoringManualPlacement{
				{HardwarePlacementID: "hp-hinge-01", CatalogHardwareID: "hw-hinge", HostComponentInstanceID: "door-01",
					AnchorFace: "front", OffsetMm: [2]float64{298, 480}, RotationDeg: 0},
				{HardwarePlacementID: "hp-handle-01", CatalogHardwareID: "hw-handle", HostComponentInstanceID: "door-01",
					AnchorFace: "front", OffsetMm: [2]float64{40, 360}, RotationDeg: 0},
			}
		})), http.StatusOK),

		// 6. Replace hinge → machining follows the selected definition.
		run("06-replace-hinge", "", authoringFixtureRequest(furniture(func(f *authoringResolveFurniture) {
			f.Components = defaultOccurrencesJSON()
			f.HardwarePlacements = []engine.AuthoringManualPlacement{
				{HardwarePlacementID: "hp-hinge-01", CatalogHardwareID: "hw-hinge-b", HostComponentInstanceID: "door-01",
					AnchorFace: "front", OffsetMm: [2]float64{298, 100}, RotationDeg: 0},
			}
		})), http.StatusOK),

		// 7. Invalid/orphan identity → structured rejection, no partial result.
		run("07-orphan-anchor-rejection", "", authoringFixtureRequest(furniture(func(f *authoringResolveFurniture) {
			f.Components = defaultOccurrencesJSON()
			f.Relationships = []engine.AuthoringRelationship{shelfRelJSON("rel-shelf-01", "shelf-ghost")}
		})), http.StatusUnprocessableEntity),

		// 8. Unknown schema/version → fail closed.
		func() authoringFixtureCase {
			request := authoringFixtureRequest(furniture(func(f *authoringResolveFurniture) {
				f.Parameters = map[string]any{"widthMm": 600.0}
			}))
			request.SchemaVersion = "9.9"
			return run("08-unknown-schema-version", "", request, http.StatusBadRequest)
		}(),

		// Negative proof: ad-hoc query parameters can never carry authoring.
		run("neg-query-parameter", "?shelf2Z=520&hinge1Offset=48", authoringFixtureRequest(furniture(func(f *authoringResolveFurniture) {
			f.Parameters = map[string]any{"widthMm": 600.0}
		})), http.StatusBadRequest),

		// Negative proof: ad-hoc parameter keys in the body fail closed too.
		run("neg-adhoc-body-parameter", "", authoringFixtureRequest(furniture(func(f *authoringResolveFurniture) {
			f.Parameters = map[string]any{"shelf2Z": 520.0}
		})), http.StatusUnprocessableEntity),

		// Negative proof: duplicate occurrence identity.
		run("neg-duplicate-occurrence-id", "", authoringFixtureRequest(furniture(func(f *authoringResolveFurniture) {
			f.Components = append(defaultOccurrencesJSON(), occurrenceJSON("shelf-01", "mod-comp-shelf", nil))
		})), http.StatusUnprocessableEntity),

		// Complete empty manual set: definition placements fully replaced.
		run("09-empty-manual-placement-set", "", authoringFixtureRequest(furniture(func(f *authoringResolveFurniture) {
			f.Components = defaultOccurrencesJSON()
			f.HardwarePlacements = []engine.AuthoringManualPlacement{}
		})), http.StatusOK),
	}
}

// buildAuthoringFixtureJoinery assembles the TS-side machining inputs from
// the Go-resolved world: geometry from the resolved boards of scenario 01 and
// the compiled joinery defaults, so the TS recomputation in
// sketchupAuthoringResolve.contract.test.ts runs on the same numbers the Go
// resolver used.
func buildAuthoringFixtureJoinery(t *testing.T, scenarios []authoringFixtureCase, catalog domain.Catalog) authoringFixtureJoinery {
	t.Helper()

	var parityResponse struct {
		Resolved struct {
			Layout engine.FurnitureLayout `json:"layout"`
		} `json:"resolved"`
	}
	if err := json.Unmarshal(scenarios[0].Response, &parityResponse); err != nil {
		t.Fatalf("decode parity scenario response: %v", err)
	}

	boardLocal := map[string]string{
		"lateral_izquierdo": "lateral",
		"lateral_derecho":   "lateral",
		"puerta":            "door",
		"trasera":           "back",
	}
	geometry := map[string]authoringFixtureGeometry{}
	for _, component := range parityResponse.Resolved.Layout.Components {
		kind := boardLocal[component.SlotID]
		if kind == "" {
			kind = "horizontal"
		}
		geometry[component.ComponentDefinitionID] = authoringFixtureGeometry{
			BoardLocal: kind, LengthMm: float64(component.LengthMm),
			WidthMm: float64(component.WidthMm), ThicknessMm: float64(component.ThicknessMm),
		}
	}

	hardware := make([]authoringFixtureHardware, 0, len(catalog.Hardware))
	for _, hw := range catalog.Hardware {
		hardware = append(hardware, authoringFixtureHardware{
			ID: hw.ID, Code: hw.Code, Name: hw.Name,
			Unit: string(hw.Unit), CostPerUnit: hw.CostPerUnit, Active: hw.Active,
		})
	}

	return authoringFixtureJoinery{
		ComponentGeometry: geometry,
		JoinerySystems: map[string]engine.ShelfSupportJoineryRule{
			"minifix-dowel": {
				JoinerySystemID: "minifix-dowel", MinifixCode: "HER-MIN-15", DowelCode: "HER-TAQ-8X30",
				EndMarginMm: 50, MaxSpacingMm: 512, GridMm: 32, WithDowels: true,
				CamDiameterMm: 15, CamDepthMm: 12.5, DowelDiameterMm: 8, DowelDepthMm: 12, DowelEndDepthMm: 20,
			},
		},
		RelationshipKinds: map[string]string{"shelf-support": "minifix-dowel"},
		ManualHardware: map[string]engine.ManualHardwareMachiningRule{
			"hw-hinge":   {PilotDiameterMm: 35, PilotDepthMm: 12.5, HoleType: "hinge", BoardFace: "front"},
			"hw-hinge-b": {PilotDiameterMm: 32, PilotDepthMm: 12.5, HoleType: "hinge", BoardFace: "front"},
		},
		Hardware: hardware,
	}
}

const authoringFixturePath = "../../../contracts/sketchupAuthoringResolve.contract.json"

// TestAuthoringResolveContractFixtureGolden generates and pins the shared
// TS↔Go↔Ruby resolve contract fixture (Go is the golden author). Regenerate
// with UPDATE_AUTHORING_RESOLVE_GOLDEN=1.
func TestAuthoringResolveContractFixtureGolden(t *testing.T) {
	server, token := authoringStubServer(t)
	_, catalog := authoringAPICabinetFixture()

	scenarios := authoringFixtureScenarios(t, server, token)
	fixture := authoringFixtureFile{
		SchemaVersion: 1,
		Comment: "Shared #477 authoring resolve contract fixture. Generated from the Go resolver's " +
			"own HTTP responses (golden author); consumed by Go (this test), TS " +
			"(packages/domain sketchupAuthoringResolve.contract.test.ts recomputes machining parity) " +
			"and Ruby (authoring_resolve_contract_test.rb parses every response fail-closed). " +
			"Regenerate: UPDATE_AUTHORING_RESOLVE_GOLDEN=1 go test ./internal/api -run TestAuthoringResolveContractFixtureGolden",
		Schema: authoringFixtureSchema{
			SchemaID:      engine.AuthoringResolveSchemaID,
			SchemaName:    engine.AuthoringResolveSchemaName,
			SchemaVersion: engine.AuthoringResolveSchemaVersion,
		},
		FurnitureDefinitionID: authoringFixtureModuleID,
		Joinery:               buildAuthoringFixtureJoinery(t, scenarios, catalog),
		Scenarios:             scenarios,
	}

	body, err := json.MarshalIndent(fixture, "", "  ")
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	body = append(body, '\n')

	if os.Getenv("UPDATE_AUTHORING_RESOLVE_GOLDEN") == "1" {
		if err := os.WriteFile(authoringFixturePath, body, 0o644); err != nil {
			t.Fatalf("update golden: %v", err)
		}
	}

	raw, err := os.ReadFile(authoringFixturePath)
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}
	if strings.TrimSpace(string(raw)) != strings.TrimSpace(string(body)) {
		t.Fatal("resolve contract fixture drifted from the Go resolver output; regenerate with UPDATE_AUTHORING_RESOLVE_GOLDEN=1 and review the diff")
	}

	// Wire-shape pins the Ruby/TS parsers rely on.
	var probe authoringFixtureFile
	if err := json.Unmarshal(raw, &probe); err != nil {
		t.Fatalf("decode golden: %v", err)
	}
	for _, scenario := range probe.Scenarios {
		var response struct {
			SchemaID        string `json:"schemaId"`
			ResolveContract string `json:"resolveContract"`
			Status          string `json:"status"`
			Resolved        *struct {
				Layout struct {
					TransformContract string `json:"transformContract"`
					Components        []struct {
						ComponentInstanceID string `json:"componentInstanceId"`
					} `json:"components"`
					Hardware []struct {
						PlacementID   string `json:"placementId"`
						PlacementKind string `json:"placementKind"`
					} `json:"hardware"`
				} `json:"layout"`
				Machining struct {
					BomFingerprint string `json:"bomFingerprint"`
				} `json:"machining"`
				Preflight struct {
					Status            string `json:"status"`
					PreflightContract string `json:"preflightContract"`
				} `json:"preflight"`
			} `json:"resolved"`
			Issues []domain.ContractIssue `json:"issues"`
		}
		if err := json.Unmarshal(scenario.Response, &response); err != nil {
			t.Fatalf("decode scenario %s response: %v", scenario.ID, err)
		}
		if response.SchemaID != engine.AuthoringResolveSchemaID || response.ResolveContract != engine.AuthoringResolveSchemaID {
			t.Fatalf("scenario %s: schema/capability marker lost", scenario.ID)
		}
		switch scenario.ExpectedHttpStatus {
		case http.StatusOK:
			if response.Status != "accepted" || response.Resolved == nil {
				t.Fatalf("scenario %s: expected accepted with resolved payload", scenario.ID)
			}
			if response.Resolved.Layout.TransformContract != engine.LayoutTransformContractV1 {
				t.Fatalf("scenario %s: transform contract marker lost", scenario.ID)
			}
			if response.Resolved.Machining.BomFingerprint == "" {
				t.Fatalf("scenario %s: fingerprint missing", scenario.ID)
			}
			if response.Resolved.Preflight.PreflightContract != engine.ManufacturingPreflightContract {
				t.Fatalf("scenario %s: preflight contract marker lost", scenario.ID)
			}
			for _, component := range response.Resolved.Layout.Components {
				if component.ComponentInstanceID == "" {
					t.Fatalf("scenario %s: occurrence identity lost", scenario.ID)
				}
			}
			for _, hw := range response.Resolved.Layout.Hardware {
				if hw.PlacementKind != engine.HardwarePlacementKindManual {
					t.Fatalf("scenario %s: placement kind must stay explicit", scenario.ID)
				}
			}
		default:
			if response.Status != "rejected" || response.Resolved != nil {
				t.Fatalf("scenario %s: expected rejected without resolved payload", scenario.ID)
			}
			if len(response.Issues) == 0 {
				t.Fatalf("scenario %s: rejection must carry structured issues", scenario.ID)
			}
			for _, issue := range response.Issues {
				if issue.Code == "" {
					t.Fatalf("scenario %s: issue without stable code", scenario.ID)
				}
			}
		}
	}
}

// Scenario 1 acceptance: POST parameters/materials resolve identically to
// the current GET layout endpoint semantics.
func TestAuthoringResolveParityWithGetLayout(t *testing.T) {
	server, token := authoringStubServer(t)

	getHandler := AuthMiddleware(furnitureTestSecret, server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitionLayout))
	getReq := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions/x/layout?choice.FRENTE=mat-oak18", nil)
	getReq.Header.Set("Authorization", "Bearer "+token)
	getReq.SetPathValue("definitionId", authoringFixtureModuleID)
	getRec := httptest.NewRecorder()
	getHandler.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("GET layout status = %d body=%s", getRec.Code, getRec.Body.String())
	}

	rec := postAuthoringResolve(server, token, "", authoringFixtureRequest(authoringResolveFurniture{
		FurnitureDefinitionID: authoringFixtureModuleID,
		Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
		MaterialChoices:       map[string]string{"FRENTE": "mat-oak18"},
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("POST resolve status = %d body=%s", rec.Code, rec.Body.String())
	}

	var response struct {
		Status   string `json:"status"`
		Resolved *struct {
			Layout json.RawMessage `json:"layout"`
		} `json:"resolved"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode resolve: %v", err)
	}
	if response.Status != "accepted" || response.Resolved == nil {
		t.Fatalf("expected accepted resolve: %s", rec.Body.String())
	}
	if !jsonBytesEqual(getRec.Body.Bytes(), response.Resolved.Layout) {
		t.Fatalf("POST resolve layout drifted from GET layout:\n GET=%s\nPOST=%s", getRec.Body.String(), response.Resolved.Layout)
	}
}

// Stateless retries are deterministic: byte-identical responses, no receipts.
func TestAuthoringResolveDeterministicRetries(t *testing.T) {
	server, token := authoringStubServer(t)

	request := authoringFixtureRequest(authoringResolveFurniture{
		FurnitureDefinitionID: authoringFixtureModuleID,
		Components:            defaultOccurrencesJSON(),
		Relationships:         []engine.AuthoringRelationship{shelfRelJSON("rel-shelf-01", "shelf-01")},
	})
	first := postAuthoringResolve(server, token, "", request)
	second := postAuthoringResolve(server, token, "", request)
	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("status = %d/%d body=%s", first.Code, second.Code, first.Body.String())
	}
	if first.Body.String() != second.Body.String() {
		t.Fatal("identical stateless resolves must return byte-identical responses")
	}
	if first.Header().Get("Idempotency-Replayed") != "" {
		t.Fatal("stateless resolve must not consume durable idempotency receipts")
	}
	if cache := first.Header().Get("Cache-Control"); cache != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", cache)
	}
}

func TestAuthoringResolveAuthAndCapability(t *testing.T) {
	server, _ := authoringStubServer(t)

	// No token → 401.
	rec := postAuthoringResolve(server, "", "", authoringFixtureRequest(authoringResolveFurniture{FurnitureDefinitionID: authoringFixtureModuleID}))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no-token status = %d", rec.Code)
	}

	// Org-less token → fail closed before the handler.
	u := &domain.User{ID: "u1", AccountStatus: domain.AccountStatusActive}
	orgless, _ := auth.GenerateToken(u.ID, "u@example.com", auth.TokenContext{Roles: []string{"user"}}, furnitureTestSecret)
	rec = postAuthoringResolve(server, orgless, "", authoringFixtureRequest(authoringResolveFurniture{FurnitureDefinitionID: authoringFixtureModuleID}))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("org-less status = %d", rec.Code)
	}

	// Extension tokens hold the EXPLICIT authoring-resolve POST capability
	// (#460 coordination) and stay read-only everywhere else.
	extension, _ := auth.GenerateExtensionToken(u.ID, "u@example.com", auth.TokenContext{Roles: []string{"user"}, OrgID: "org-1"}, furnitureTestSecret)
	rec = postAuthoringResolve(server, extension, "", authoringFixtureRequest(authoringResolveFurniture{FurnitureDefinitionID: authoringFixtureModuleID}))
	if rec.Code != http.StatusOK {
		t.Fatalf("extension token resolve status = %d body=%s", rec.Code, rec.Body.String())
	}

	handler := AuthMiddleware(furnitureTestSecret, server.Store)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	post := func(path string) int {
		req := httptest.NewRequest(http.MethodPost, path, nil)
		req.Header.Set("Authorization", "Bearer "+extension)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec.Code
	}
	if got := post("/api/projects"); got != http.StatusForbidden {
		t.Fatalf("extension token POST elsewhere = %d, want 403 (read-only regression)", got)
	}

	// Inactive license blocks exactly like the catalog family.
	noLicense := &domain.Organization{
		ID: "org-1", Name: "Taller Test", Slug: "taller-test",
		Type: domain.OrganizationTypeFactory, Active: true,
	}
	licenseless := licenseTestServer(t, u, noLicense)
	module, catalog := authoringAPICabinetFixture()
	licenseless.Store = &stubStore{
		getUserByEmail: u, getOrgByID: noLicense, moduleReturnedByID: module,
		listStructures: catalog.Structures, listComponents: catalog.Components, listHardwares: catalog.Hardware,
	}
	webToken, _ := auth.GenerateToken(u.ID, "u@example.com", auth.TokenContext{Roles: []string{"user"}, OrgID: "org-1"}, furnitureTestSecret)
	rec = postAuthoringResolve(licenseless, webToken, "", authoringFixtureRequest(authoringResolveFurniture{FurnitureDefinitionID: authoringFixtureModuleID}))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("inactive license status = %d", rec.Code)
	}
}

func TestAuthoringResolveTransportFailClosed(t *testing.T) {
	server, token := authoringStubServer(t)
	valid := authoringResolveFurniture{FurnitureDefinitionID: authoringFixtureModuleID, Parameters: map[string]any{"widthMm": 600.0}}

	// Unknown schema id.
	request := authoringFixtureRequest(valid)
	request.SchemaID = "granete.sketchup-authoring.v1"
	rec := postAuthoringResolve(server, token, "", request)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("schema id mismatch status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertIssueCode(t, rec.Body.Bytes(), "SCHEMA_ID_MISMATCH")

	// Malformed JSON.
	handler := AuthMiddleware(furnitureTestSecret, server.Store)(http.HandlerFunc(server.HandleFurnitureAuthoringResolve))
	req := httptest.NewRequest(http.MethodPost, "/api/furniture/authoring/resolve", strings.NewReader("{not json"))
	req.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("malformed json status = %d", recorder.Code)
	}
	assertIssueCode(t, recorder.Body.Bytes(), "REQUEST_INVALID")

	// Unknown fields fail closed — the server never guesses a schema.
	var withUnknown map[string]any
	raw, _ := json.Marshal(authoringFixtureRequest(valid))
	_ = json.Unmarshal(raw, &withUnknown)
	withUnknown["shelf2Z"] = 520.0
	rec = postAuthoringResolve(server, token, "", withUnknown)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown field status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertIssueCode(t, rec.Body.Bytes(), "REQUEST_INVALID")

	// Payload limit is explicit.
	oversized := authoringFixtureRequest(valid)
	oversized.MessageID = strings.Repeat("x", 3<<20)
	rec = postAuthoringResolve(server, token, "", oversized)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertIssueCode(t, rec.Body.Bytes(), "PAYLOAD_TOO_LARGE")

	// Ad-hoc query parameters are rejected before any resolution.
	rec = postAuthoringResolve(server, token, "?shelf2Z=520", authoringFixtureRequest(valid))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("query param status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertIssueCode(t, rec.Body.Bytes(), "QUERY_PARAMETERS_UNSUPPORTED")

	// Catalog revision mismatch rejects with the structured code.
	stale := "workshop-stale"
	request = authoringFixtureRequest(valid)
	request.Furniture.CatalogRevision = &stale
	rec = postAuthoringResolve(server, token, "", request)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("stale catalog status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertIssueCode(t, rec.Body.Bytes(), "CATALOG_REVISION_STALE")

	// Unknown material choice keeps the structured code.
	request = authoringFixtureRequest(authoringResolveFurniture{
		FurnitureDefinitionID: authoringFixtureModuleID,
		MaterialChoices:       map[string]string{"FRENTE": "mat-ghost"},
	})
	rec = postAuthoringResolve(server, token, "", request)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unknown material status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertIssueCode(t, rec.Body.Bytes(), "MATERIAL_CHOICE_INVALID")

	// Unknown definition is a structured rejection, not a bare 404.
	server.Store.(*stubStore).moduleReturnedByID = nil
	request = authoringFixtureRequest(authoringResolveFurniture{FurnitureDefinitionID: "mod-ghost"})
	rec = postAuthoringResolve(server, token, "", request)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unknown definition status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertIssueCode(t, rec.Body.Bytes(), "CATALOG_REFERENCE_MISSING")

	// Method boundary: the resolve is POST-only.
	req = httptest.NewRequest(http.MethodGet, "/api/furniture/authoring/resolve", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET resolve status = %d", recorder.Code)
	}
}

func assertIssueCode(t *testing.T, body []byte, code string) {
	t.Helper()
	var response struct {
		Issues []domain.ContractIssue `json:"issues"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		t.Fatalf("decode issues: %v (body=%s)", err, body)
	}
	for _, issue := range response.Issues {
		if issue.Code == code {
			return
		}
	}
	t.Fatalf("issue code %s not found in %s", code, body)
}

// jsonBytesEqual compares two JSON payloads modulo whitespace.
func jsonBytesEqual(a, b []byte) bool {
	var ca, cb bytes.Buffer
	if err := json.Compact(&ca, a); err != nil {
		return false
	}
	if err := json.Compact(&cb, b); err != nil {
		return false
	}
	return bytes.Equal(ca.Bytes(), cb.Bytes())
}
