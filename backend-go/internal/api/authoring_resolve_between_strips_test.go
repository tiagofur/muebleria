package api

// #1536 — the italian strip BETWEEN fronts rides the authoring resolve as
// real boards: one per between edge of the resolved stack (the top-strip
// rule mirrored), the FRENTE material role, fail-closed on a missing
// catalog component. The fixture is the 3-drawer column of the A3 tests,
// rebuilt here as API fixtures (module + agregados + strip component).

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func betweenStripsColumnFixture() (*domain.Module, func(catalog *domain.Catalog)) {
	drawerFront := domain.Component{
		ID: "comp-dfront-1536", Code: "FRENTE-CAJ", Name: "Frente Cajón",
		Placement: domain.PlacementFrenteCajon, GeometryKind: "rectangular_board",
		ThicknessMm: 18, OptionRoles: []string{"FRENTE"},
		LengthFormula: "PH - 4", WidthFormula: "PW - 4", Active: true,
	}
	tira := domain.Component{
		ID: "comp-tira-1536", Code: "TIRA-IT", Name: "Tira italiana",
		Placement: domain.PlacementSuperior, GeometryKind: "rectangular_board",
		ThicknessMm: 16, OptionRoles: []string{"FRENTE"}, Active: true,
	}
	agregado := domain.Agregado{
		ID: "agr-cajon-1536", Code: "CAJON-1536", Name: "Cajón", Active: true,
		Components: []domain.ComponentInstance{{ComponentID: "comp-dfront-1536", Quantity: 1}},
	}
	structure := domain.Structure{
		ID: "est-cajonera-1536", Code: "EST-CAJONERA-1536", Name: "Cajonera 3 frentes", Active: true,
		Agregados: []domain.ModuleAgregadoInstance{{
			ID: "agr-inst-1536", AgregadoID: "agr-cajon-1536", Quantity: 3, LayoutDirection: "vertical",
		}},
	}
	techo := domain.Component{
		ID: "comp-techo-1536", Code: "TECHO-COL", Name: "Techo columna",
		Placement: domain.PlacementSuperior, GeometryKind: "rectangular_board",
		ThicknessMm: 18, WidthFormula: "PD", LengthFormula: "PW - 2*T",
		OptionRoles: []string{"INTERIOR"}, Active: true,
		Construction: &domain.ComponentConstruction{ConstructiveRole: "horizontal"},
	}
	// Los laterales reciben la muesca de la tira (#1536 el mismo rol que el
	// cabinet fixture: LATERAL).
	lateral := domain.Component{
		ID: "comp-lateral-1536", Code: "LAT", Name: "Lateral",
		Placement: domain.PlacementLateralIzquierdo, GeometryKind: "rectangular_board",
		ThicknessMm: 18, OptionRoles: []string{"LATERAL"},
		LengthFormula: "PH", WidthFormula: "PD", Active: true,
		Construction: &domain.ComponentConstruction{ConstructiveRole: "lateral"},
	}
	lateralR := lateral
	lateralR.ID = "comp-lateral-1536-r"
	lateralR.Placement = domain.PlacementLateralDerecho
	module := &domain.Module{
		ID: "mod-cajonera-1536", Code: "CAJONERA-1536", Name: "Cajonera 3 frentes",
		WidthMm: 600, HeightMm: 720, DepthMm: 560,
		FurnitureType: "inferior", StructureID: structure.ID,
		Components: []domain.ComponentInstance{
			{ComponentID: "comp-techo-1536", Quantity: 1},
			{ComponentID: "comp-lateral-1536", Quantity: 1},
			{ComponentID: "comp-lateral-1536-r", Quantity: 1},
		},
	}
	return module, func(catalog *domain.Catalog) {
		catalog.Components = append(catalog.Components, drawerFront, tira, techo, lateral, lateralR)
		catalog.Hardware = append(catalog.Hardware,
			domain.Hardware{ID: "hw-8007-1536", Code: "8007", Name: "Perfil GOLA C 8007", Active: true})
		catalog.Agregados = append(catalog.Agregados, agregado)
		catalog.Structures = append(catalog.Structures, structure)
		catalog.Modules = append(catalog.Modules, *module)
	}
}

func cBetween() *domain.FrozenGripProfile {
	int36 := 36
	fp := func(v float64) *float64 { return &v }
	return &domain.FrozenGripProfile{
		ProfileID: "profile.gola-c.alu", Code: "GOLA-C-ALU", Name: "Gola C alu",
		Material: "aluminum", Positions: []string{"between"},
		ProfileDepthMm:         fp(19),
		ProfileHeightMm:        fp(13),
		FrontDiscountBetweenMm: &int36,
		CompatiblePlacements:   []string{"between"},
		BOMMembers: map[string]domain.OpeningBOMMember{
			"profile": {HardwareID: "hw-8007-1536", Rule: "interior_width"},
		},
		BOMVersion: 1,
	}
}

func lcSnapshot() *domain.GripSnapshot {
	int40 := 40
	fp := func(v float64) *float64 { return &v }
	lTop := &domain.FrozenGripProfile{
		ProfileID: "profile.gola-l.alu", Code: "GOLA-L-ALU", Name: "Gola L alu",
		Material: "aluminum", Positions: []string{"top"},
		ProfileDepthMm:       fp(27.2),
		ProfileHeightMm:      fp(56.5),
		FrontDiscountTopMm:   &int40,
		CompatiblePlacements: []string{"top"},
		BOMMembers: map[string]domain.OpeningBOMMember{
			"profile": {HardwareID: "hw-8006-1536", Rule: "interior_width"},
		},
		BOMVersion: 1,
	}
	handle := domain.GripSnapshotRecipe{Mode: "handle"}
	return &domain.GripSnapshot{
		StyleID: "style-lc", StyleName: "L + C",
		Recipes: map[string]domain.GripSnapshotRecipe{
			"inferior": {Mode: "gola", TopProfile: lTop, BetweenProfile: cBetween()},
			"superior": handle,
			"alto":     handle,
		},
	}
}

func italianaSnapshot() *domain.GripSnapshot {
	fp := func(v float64) *float64 { return &v }
	int36 := 36
	stripDims := [3]float64{600, 16, 70}
	itTop := func() *domain.FrozenGripProfile {
		return &domain.FrozenGripProfile{
			ProfileID: "profile.italiana.70", Code: "IT-70", Name: "Italiana 70",
			Material: "melamine", Positions: []string{"top", "between"},
			ProfileDepthMm:         fp(16),
			ProfileHeightMm:        fp(56.5),
			FrontDiscountTopMm:     &int36,
			FrontDiscountBetweenMm: &int36,
			CompatiblePlacements:   []string{"top", "between"},
			BodyModifiers: []domain.OpeningBodyModifier{
				{Role: "door", BevelAngleDeg: fp(45), BevelSizeMm: fp(14), BevelAt: "top_front"},
				{Role: "lateral", NotchHeightMm: fp(70), NotchDepthMm: fp(16), NotchAt: "top_front"},
				{Role: "horizontal", Effect: "depth_reduction"},
			},
			BOMMembers: map[string]domain.OpeningBOMMember{
				"strip": {ComponentID: "comp-tira-1536", Rule: "interior_width",
					DimensionsMm: &stripDims},
			},
			BOMVersion: 1,
		}
	}
	// La italiana ENTRE frentes: la puerta de abajo bisela su borde superior
	// hacia la tira (v1: top_front) y la TIRA viaja en su bomMembers.
	itBetween := func() *domain.FrozenGripProfile {
		profile := itTop()
		profile.BodyModifiers = []domain.OpeningBodyModifier{
			{Role: "door", BevelAngleDeg: fp(45), BevelSizeMm: fp(14), BevelAt: "top_front"},
			{Role: "lateral", NotchHeightMm: fp(70), NotchDepthMm: fp(16), NotchAt: "top_front"},
		}
		return profile
	}
	handle := domain.GripSnapshotRecipe{Mode: "handle"}
	return &domain.GripSnapshot{
		StyleID: "style-1536", StyleName: "Estilo italiana 1536",
		Recipes: map[string]domain.GripSnapshotRecipe{
			"inferior": {Mode: "gola", TopProfile: itTop(), BetweenProfile: itBetween()},
			"superior": handle,
			"alto":     handle,
		},
	}
}

// The between strips ride the authoring resolve as real boards: two strips
// for the 3-drawer column, hanging from each upper front's bottom edge, the
// FRENTE material role, next to the bevelled doors.
func TestAuthoringResolveDesignOpeningBetweenStrips(t *testing.T) {
	server, token, store := openingAuthoringServer(t)
	const designID = "d1536000-0000-0000-0000-000000000001"
	columnModule, extendCatalog := betweenStripsColumnFixture()
	extendCatalog(store.catalogOverride)
	store.moduleReturnedByID = columnModule
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{designID: openingDesignWC(designID, true)}
	store.designGripFacadeState = &storage.DesignOpeningFacadeState{
		ProjectID: "proj-1536", InstanceID: "fi-cajonera-1536", FurnitureType: "inferior",
		Snapshot: italianaSnapshot(),
	}

	rec := postAuthoringResolve(server, token, "", authoringFixtureRequest(authoringCatalogRevision(t, server), authoringResolveFurniture{
		FurnitureDefinitionID: "mod-cajonera-1536",
		DesignID:              designID,
		Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("between strips resolve status = %d body=%s", rec.Code, rec.Body.String())
	}

	var full struct {
		Resolved *struct {
			Layout struct {
				Components []struct {
					ComponentInstanceID string `json:"componentInstanceId"`
					Role                string `json:"role"`
					Transform           struct {
						TranslationMm [3]float64 `json:"translationMm"`
					} `json:"transform"`
				} `json:"components"`
				Hardware []struct {
					HardwareID    string `json:"hardwareId"`
					PlacementKind string `json:"placementKind"`
					Transform     struct {
						TranslationMm [3]float64 `json:"translationMm"`
					} `json:"transform"`
				} `json:"hardware"`
			} `json:"layout"`
		} `json:"resolved"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &full); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if full.Resolved == nil {
		t.Fatalf("no resolved payload: %s", rec.Body.String())
	}
	strips := []struct {
		id   string
		z    float64
		role string
	}{}
	for _, comp := range full.Resolved.Layout.Components {
		if strings.HasPrefix(comp.ComponentInstanceID, "opening-strip-between-") {
			strips = append(strips, struct {
				id   string
				z    float64
				role string
			}{comp.ComponentInstanceID, comp.Transform.TranslationMm[2], comp.Role})
		}
	}
	if len(strips) != 2 {
		t.Fatalf("3 frentes → 2 tiras entre cajones, got %d (%+v)", len(strips), strips)
	}
	for _, strip := range strips {
		if strip.role != "FRENTE" {
			t.Fatalf("%s: rol FRENTE esperado, got %q", strip.id, strip.role)
		}
	}
	// The resolved drawer fronts (bottom edges, top → bottom) drive both
	// mirror-rule assertions.
	doors := []float64{}
	for _, comp := range full.Resolved.Layout.Components {
		if strings.Contains(comp.ComponentInstanceID, "comp-dfront-1536") {
			doors = append(doors, comp.Transform.TranslationMm[2])
		}
	}
	if len(doors) != 3 {
		t.Fatalf("3 drawer fronts expected, got %v", doors)
	}

	// Mirror rule: each strip's top edge = the upper front's bottom edge —
	// asserted via the resolved doors (top → bottom the strip's z equals the
	// front above it minus its own declared height).
	// The assertion compares STRIPS to fronts by position: for each strip,
	// there must exist a door whose bottom edge is exactly strip.z + 70.
	for _, strip := range strips {
		found := false
		for _, z := range doors {
			if fmt.Sprintf("%.4f", z) == fmt.Sprintf("%.4f", strip.z+70) {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("tira %s (%.2f): ningún frente con su borde superior en %.2f", strip.id, strip.z, strip.z+70)
		}
	}
}

// La mezcla L arriba + C entre frentes (aceptación 1): el C congelado
// materializa su propia corrida de hardware ENTRE cada par de frentes, la
// regla del top-run espejada.
func TestAuthoringResolveDesignOpeningBetweenProfileHardware(t *testing.T) {
	server, token, store := openingAuthoringServer(t)
	const designID = "d1536000-0000-0000-0000-000000000003"
	columnModule, extendCatalog := betweenStripsColumnFixture()
	extendCatalog(store.catalogOverride)
	store.moduleReturnedByID = columnModule
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{designID: openingDesignWC(designID, true)}
	store.designGripFacadeState = &storage.DesignOpeningFacadeState{
		ProjectID: "proj-1536", InstanceID: "fi-cajonera-1536", FurnitureType: "inferior",
		Snapshot: lcSnapshot(),
	}

	rec := postAuthoringResolve(server, token, "", authoringFixtureRequest(authoringCatalogRevision(t, server), authoringResolveFurniture{
		FurnitureDefinitionID: "mod-cajonera-1536",
		DesignID:              designID,
		Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("L+C resolve status = %d body=%s", rec.Code, rec.Body.String())
	}

	var full struct {
		Resolved *struct {
			Layout struct {
				Components []struct {
					ComponentInstanceID string `json:"componentInstanceId"`
					Transform           struct {
						TranslationMm [3]float64 `json:"translationMm"`
					} `json:"transform"`
				} `json:"components"`
				Hardware []struct {
					HardwareID    string `json:"hardwareId"`
					PlacementKind string `json:"placementKind"`
					Transform     struct {
						TranslationMm [3]float64 `json:"translationMm"`
					} `json:"transform"`
				} `json:"hardware"`
			} `json:"layout"`
		} `json:"resolved"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &full); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if full.Resolved == nil {
		t.Fatalf("no resolved payload")
	}
	doors := []float64{}
	for _, comp := range full.Resolved.Layout.Components {
		if strings.Contains(comp.ComponentInstanceID, "comp-dfront-1536") {
			doors = append(doors, comp.Transform.TranslationMm[2])
		}
	}
	if len(doors) != 3 {
		t.Fatalf("3 drawer fronts expected, got %v", doors)
	}
	runs := []float64{}
	for _, hw := range full.Resolved.Layout.Hardware {
		if hw.HardwareID == "hw-8007-1536" && hw.PlacementKind == "derived" {
			runs = append(runs, hw.Transform.TranslationMm[2])
		}
	}
	if len(runs) != 2 {
		t.Fatalf("3 frentes → 2 corridas del C entre frentes, got %d", len(runs))
	}
	for _, runZ := range runs {
		found := false
		for _, z := range doors {
			if fmt.Sprintf("%.4f", z) == fmt.Sprintf("%.4f", runZ+13) {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("corrida C (%.2f): ningún frente con su borde inferior en %.2f", runZ, runZ+13)
		}
	}
	// La cajonera L+C NO lleva tiras: la tira es de la italiana.
	for _, comp := range full.Resolved.Layout.Components {
		if strings.HasPrefix(comp.ComponentInstanceID, "opening-strip-") {
			t.Fatalf("L+C no declara tiras: %s no debe existir", comp.ComponentInstanceID)
		}
	}
}

// Fail-closed: a between strip whose catalog component is missing rejects
// the resolve with the workshop message.
func TestAuthoringResolveDesignOpeningBetweenStripsFailClosed(t *testing.T) {
	server, token, store := openingAuthoringServer(t)
	const designID = "d1536000-0000-0000-0000-000000000002"
	columnModule, extendCatalog := betweenStripsColumnFixture()
	extendCatalog(store.catalogOverride)
	// The fixture's strip component stays OUT (missing): remove it.
	for i, comp := range store.catalogOverride.Components {
		if comp.ID == "comp-tira-1536" {
			store.catalogOverride.Components = append(store.catalogOverride.Components[:i], store.catalogOverride.Components[i+1:]...)
			break
		}
	}
	store.moduleReturnedByID = columnModule
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{designID: openingDesignWC(designID, true)}
	store.designGripFacadeState = &storage.DesignOpeningFacadeState{
		ProjectID: "proj-1536", InstanceID: "fi-cajonera-1536", FurnitureType: "inferior",
		Snapshot: italianaSnapshot(),
	}

	rec := postAuthoringResolve(server, token, "", authoringFixtureRequest(authoringCatalogRevision(t, server), authoringResolveFurniture{
		FurnitureDefinitionID: "mod-cajonera-1536",
		DesignID:              designID,
		Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
	}))
	if rec.Code != http.StatusUnprocessableEntity && rec.Code != http.StatusInternalServerError {
		t.Fatalf("missing strip component must reject: status = %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "no existe o está inactivo") {
		t.Fatalf("workshop message drifted: %s", rec.Body.String())
	}
}

// The project grip facade state for the between-strip tests keeps a valid
// snapshot per the shape validator (unused direct store assertion helper).
var _ = storage.DesignOpeningFacadeState{}
