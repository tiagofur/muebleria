package api

// #1680 — el reporte de agarre compone las elecciones de un mueble que la
// verdad comercial todavía no cubre: override del working item ‖ default del
// diseño ‖ elección a nivel proyecto ‖ fallback de definición. La verdad de
// cotización (#821) sigue ganando intacta; el reason bloqueado no filtra ids
// internos de placement.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// gripDoorCatalog builds the #1680 shape: a base cabinet whose door agregado
// authors its hardware BY ROLE (JALADERA + BISAGRA, both required groups) —
// the exact authoring that blocked the report for design-placed furniture.
func gripDoorCatalog() domain.Catalog {
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
	doorAgregado := domain.Agregado{
		ID: "agr-door", Code: "AGR-PUE", Name: "Puerta", Active: true,
		Components: []domain.ComponentInstance{{
			ComponentID: "comp-door", Quantity: 1,
			Overrides: &domain.ComponentInstanceOverrides{
				HardwarePlacements: []domain.HardwarePlacement{
					{OptionRole: "JALADERA", AnchorFace: "front",
						RelativePosition: domain.HardwareRelPosition{XMm: 40, YMm: 360}},
					{OptionRole: "BISAGRA", AnchorFace: "back",
						RelativePosition: domain.HardwareRelPosition{XMm: 20, YMm: 90}},
					{OptionRole: "BISAGRA", AnchorFace: "back",
						RelativePosition: domain.HardwareRelPosition{XMm: 20, YMm: 50}},
				},
			},
		}},
	}
	module := domain.Module{
		ID: "mod-door", Code: "BAJ-1P", Name: "Gabinete Bajo 1 Puerta", FurnitureType: "inferior",
		WidthMm: 600, HeightMm: 720, DepthMm: 560, StructureID: "st-door",
		Agregados: []domain.ModuleAgregadoInstance{{
			ID: "agr-inst-door", AgregadoID: "agr-door", Quantity: 1, LayoutDirection: "vertical",
		}},
	}
	structure := domain.Structure{
		ID: "st-door", Code: "CUERPO-BAJ", Name: "Cuerpo Bajo", Active: true,
		Components: []domain.ComponentInstance{
			{ComponentID: "comp-side", Quantity: 1},
			{ComponentID: "comp-side-r", Quantity: 1},
			{ComponentID: "comp-base", Quantity: 1},
			{ComponentID: "comp-top", Quantity: 1},
			{ComponentID: "comp-back", Quantity: 1},
		},
	}
	return domain.Catalog{
		Structures: []domain.Structure{structure},
		Components: []domain.Component{lateral, right, floor, top, back, door},
		Agregados:  []domain.Agregado{doorAgregado},
		Modules:    []domain.Module{module},
		Hardware: []domain.Hardware{
			{ID: "hw-pull-a", Code: "JAL-160", Name: "Jaladera 160", Unit: domain.UnitPiece, Active: true},
			{ID: "hw-pull-b", Code: "JAL-128", Name: "Jaladera 128", Unit: domain.UnitPiece, Active: true},
			{ID: "hw-hinge", Code: "BIS-110", Name: "Bisagra 110", Unit: domain.UnitPiece, Active: true},
		},
		Materials: []domain.MaterialBoard{
			{ID: "mat-1", Code: "MAT-18", Name: "Tablero 18", ThicknessMm: 18, Active: true},
		},
		OptionGroups: []domain.OptionGroup{
			{ID: "og-jaladera", Code: "JALADERA", Name: "Jaladeras y Tiradores", Kind: "hardware", Required: true,
				OptionIDs: []string{"hw-pull-a", "hw-pull-b"}},
			{ID: "og-bisagra", Code: "BISAGRA", Name: "Bisagras de Puertas", Kind: "hardware", Required: true,
				OptionIDs: []string{"hw-hinge"}},
		},
	}
}

// gripReportStore wires a stubStore serving one design-placed door furniture
// under a handle-mode project grip (the seeded «Jaladera» world).
func gripReportStore(t *testing.T, catalog domain.Catalog, quoteChoices map[string]string) *stubStore {
	t.Helper()
	store := &stubStore{
		catalogOverride: &catalog,
		listFurnitureInstanceSummaries: []storage.FurnitureInstanceSummary{{
			Instance: domain.FurnitureInstance{
				ID: "fi-door-1", ProjectID: "proj-grip", Origin: "design",
				FurnitureDefinitionID: "mod-door", LifecycleStatus: domain.FurnitureInstanceLifecycleActive,
			},
			DisplayName: "Gabinete Bajo 1 Puerta",
			DisplayDims: &domain.ItemCustomDims{WidthMm: 600, HeightMm: 720, DepthMm: 560},
			// nil = the commercial truth does not cover this furniture yet.
			DisplayMaterialChoices: quoteChoices,
		}},
		projectGrip: &storage.ProjectGrip{
			ProjectID: "proj-grip", StyleID: "style-jaladera", Version: 1,
			Snapshot: &domain.GripSnapshot{
				StyleID: "style-jaladera", StyleName: "Jaladera",
				Recipes: map[string]domain.GripSnapshotRecipe{
					"inferior": {Mode: domain.GripModeHandle},
				},
			},
		},
	}
	return store
}

// gripReport runs the report of the GET /projects/{id}/grip payload.
func gripReport(t *testing.T, store *stubStore) *projectGripReportPayload {
	t.Helper()
	srv := &Server{Store: store}
	r := httptest.NewRequest(http.MethodGet, "/api/projects/proj-grip/grip", nil)
	report := srv.projectGripReport(r, "proj-grip", store.projectGrip)
	if report == nil {
		t.Fatalf("report nil")
	}
	if len(report.Items) != 1 {
		t.Fatalf("items = %d, want 1: %+v", len(report.Items), report.Items)
	}
	return report
}

// The bug: a design-placed door with role-based JALADERA/BISAGRA placements
// and NO commercial truth resolves through the definition fallback — the
// card reports its measures instead of «Bloqueado: herraje por grupo
// "JALADERA" sin elección».
func TestProjectGripReportComposesChoicesForDesignFurniture(t *testing.T) {
	report := gripReport(t, gripReportStore(t, gripDoorCatalog(), nil))
	item := report.Items[0]
	if item.Layout == nil || item.Layout.State != "resolved" {
		t.Fatalf("design furniture without quote truth must resolve, got %+v", item.Layout)
	}
	if len(item.Layout.Rows) != 1 {
		t.Fatalf("one door front = one row, got %+v", item.Layout.Rows)
	}
}

// A furniture the commercial truth DOES cover keeps its frozen choices: a
// snapshot without the required role stays blocked (fail-closed intact) and
// the reason carries no internal placement id.
func TestProjectGripReportQuoteTruthWinsFailClosed(t *testing.T) {
	report := gripReport(t, gripReportStore(t, gripDoorCatalog(), map[string]string{"FRENTE": "mat-1"}))
	layout := report.Items[0].Layout
	if layout == nil || layout.State != "blocked" {
		t.Fatalf("quote truth without JALADERA must stay blocked, got %+v", layout)
	}
	if !strings.Contains(layout.Reason, `"JALADERA"`) {
		t.Fatalf("reason names the missing group: %q", layout.Reason)
	}
	if strings.Contains(layout.Reason, "placement en") {
		t.Fatalf("reason leaks the internal placement id: %q", layout.Reason)
	}
}

// Lineage precedence inside the composition: working-item override > design
// default > project-level choice > definition fallback (first curated
// option); roles the definition does not consume carry no statement.
func TestComposeGripLineageChoicesPrecedence(t *testing.T) {
	catalog := gripDoorCatalog()
	module := catalog.Modules[0]
	lineage := storage.GripLineageChoices{
		Overrides: map[string]string{"JALADERA": "hw-pull-b"},
		Defaults:  domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"BISAGRA": "hw-hinge", "LATERAL": "mat-1"}},
	}
	level := map[string]string{"JALADERA": "hw-pull-a", "FRENTE": "mat-1"}

	choices := composeGripLineageChoices(module, catalog, lineage, level)
	if choices["JALADERA"] != "hw-pull-b" {
		t.Fatalf("override must win JALADERA, got %q", choices["JALADERA"])
	}
	if choices["BISAGRA"] != "hw-hinge" {
		t.Fatalf("design default must win BISAGRA, got %q", choices["BISAGRA"])
	}
	if choices["FRENTE"] != "mat-1" {
		t.Fatalf("project level must win FRENTE, got %q", choices["FRENTE"])
	}

	// Without override and without design default, the project-level choice
	// beats the definition fallback.
	lineage = storage.GripLineageChoices{Defaults: domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{}}}
	choices = composeGripLineageChoices(module, catalog, lineage, level)
	if choices["JALADERA"] != "hw-pull-a" {
		t.Fatalf("project level must beat the fallback, got %q", choices["JALADERA"])
	}

	// With no statements at all, the definition fallback is the first
	// curated option of each consumed role.
	choices = composeGripLineageChoices(module, catalog, storage.GripLineageChoices{}, nil)
	if choices["JALADERA"] != "hw-pull-a" || choices["BISAGRA"] != "hw-hinge" {
		t.Fatalf("definition fallback = first curated option, got JALADERA=%q BISAGRA=%q", choices["JALADERA"], choices["BISAGRA"])
	}
	if _, foreign := choices["CORREDERA"]; foreign {
		t.Fatalf("a role the definition does not consume carries no statement: %+v", choices)
	}
}

// The workshop reason never shows the engine's wire ids.
func TestWorkshopBlockedReasonStripsPlacementDetail(t *testing.T) {
	raw := `herraje por grupo "JALADERA" sin elección (placement en agr-b0000005-0000-0000-0000-000000000002-u0-b0000004-0000-0000-0000-00000000000e-copy-0)`
	want := `herraje por grupo "JALADERA" sin elección`
	if got := workshopBlockedReason(raw); got != want {
		t.Fatalf("reason = %q, want %q", got, want)
	}
	untouched := "la pila de frentes de este mueble no se puede leer"
	if got := workshopBlockedReason(untouched); got != untouched {
		t.Fatalf("a reason without placement detail must pass through: %q", got)
	}
}
