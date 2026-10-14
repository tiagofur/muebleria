package engine

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1317 / §13.6 — the DECLARED depth reduction materializes on the
// horizontal panels: the full-depth techo's measure shrinks by the profile's
// declared depth (never an engine constant), the front-flush manguete
// recedes its Y with its measure intact, the amarre/piso outside the band
// stay untouched, and the notch on the laterals coexists. The fixture
// verifies the PUBLISHED furniture extents (the authoritative
// transform+dimensions pair), the exact decimal arithmetic (580 − 27.2 =
// 552.8) and the fail-closed paths.

func depthReductionGolaModule() (domain.Module, domain.Catalog) {
	horizontal := func(id, code, name string, widthFormula string, extra ...string) domain.Component {
		comp := domain.Component{
			ID: id, Code: code, Name: name, Placement: domain.PlacementSuperior,
			GeometryKind: "rectangular_board", ThicknessMm: 18,
			OptionRoles:   []string{"INTERIOR"},
			LengthFormula: "PW - 2*T", WidthFormula: widthFormula,
			Construction: &domain.ComponentConstruction{ConstructiveRole: "horizontal"},
			Active:       true,
		}
		if len(extra) >= 1 {
			comp.XFormula = extra[0]
		}
		if len(extra) >= 2 {
			comp.YFormula = extra[1]
		}
		return comp
	}
	techo := horizontal("comp-techo", "TECHO", "Techo", "PD")
	mangFro := horizontal("comp-mang-fro", "MAN-FRO", "Manguete Frontal", "150", "T", "PD - W")
	mangAm := horizontal("comp-mang-am", "MAN-AM", "Manguete Amarre", "100", "T", "0")
	piso := horizontal("comp-piso", "PISO", "Piso", "PD - T")
	piso.Placement = domain.PlacementBase

	lateral := domain.Component{
		ID: "comp-side", Code: "LAT", Name: "Lateral", Placement: domain.PlacementLateralIzquierdo,
		GeometryKind: "rectangular_board", ThicknessMm: 18,
		OptionRoles:   []string{"LATERAL"},
		LengthFormula: "PH - 2*T", WidthFormula: "PD",
		Construction: &domain.ComponentConstruction{ConstructiveRole: "lateral"},
		Active:       true,
	}
	right := lateral
	right.ID = "comp-side-r"
	right.Code = "LAT-R"
	right.Name = "Lateral Derecho"
	right.Placement = domain.PlacementLateralDerecho

	structure := domain.Structure{
		ID: "st-gola-top", Code: "GOLA-TOP", Name: "Gola Top", Active: true,
		Components: []domain.ComponentInstance{
			{ComponentID: "comp-side", Quantity: 1},
			{ComponentID: "comp-side-r", Quantity: 1},
			{ComponentID: "comp-piso", Quantity: 1},
			{ComponentID: "comp-techo", Quantity: 1},
			{ComponentID: "comp-mang-fro", Quantity: 1},
			{ComponentID: "comp-mang-am", Quantity: 1},
		},
	}
	module := domain.Module{
		ID: "mod-gola-top", Code: "GOLA-600", Name: "Gola Top 600",
		WidthMm: 600, HeightMm: 720, DepthMm: 580, StructureID: "st-gola-top",
	}
	catalog := domain.Catalog{
		Structures: []domain.Structure{structure},
		Components: []domain.Component{right, lateral, piso, techo, mangFro, mangAm},
	}
	return module, catalog
}

func depthReductionModifiers() []ResolvedOpeningBodyModifier {
	return []ResolvedOpeningBodyModifier{
		{
			Effect: OpeningModifierEffectDepthReduction, Role: "horizontal",
			ProfileID: "profile.gola-l.8006", Boundary: "top",
			DepthReductionMm: 27.2, ProfileHeightMm: 56.5,
		},
		{
			Effect: OpeningModifierEffectNotch, Role: "lateral",
			ProfileID: "profile.gola-l.8006", Boundary: "top",
			NotchHeightMm: 56.5, NotchDepthMm: 27.2,
		},
	}
}

func componentByName(layout FurnitureLayout, name string) *LayoutComponent {
	for i := range layout.Components {
		if layout.Components[i].Name == name {
			return &layout.Components[i]
		}
	}
	return nil
}

func TestDepthReductionTrimsTechoAndShiftsFrontManguete(t *testing.T) {
	module, catalog := depthReductionGolaModule()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 580}

	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts:               openingPassFront("top", 40),
		openingBodyModifiers: depthReductionModifiers(),
	})
	if err != nil {
		t.Fatalf("resolve with declared depth reduction: %v", err)
	}

	// Techo: the front edge recedes exactly the declared 27.2 — the panel
	// measures 552.8 and the back edge stays at y=0.
	techo := componentByName(layout, "Techo")
	if techo == nil {
		t.Fatalf("fixture lost the techo")
	}
	if techo.Transform.TranslationMm[1] != 0 || techo.DimensionsMm[1] != 552.8 {
		t.Fatalf("techo must span Y [0, 552.8] (580 − 27.2 declared), got min %v size %v",
			techo.Transform.TranslationMm, techo.DimensionsMm)
	}
	// The legacy integer summary fields round at the publish boundary.
	if techo.WidthMm != 553 {
		t.Fatalf("techo legacy summary width must round 552.8 to 553, got %d", techo.WidthMm)
	}

	// Manguete frontal: measure intact, position recedes by the same value.
	manguete := componentByName(layout, "Manguete Frontal")
	if manguete == nil {
		t.Fatalf("fixture lost the manguete frontal")
	}
	if manguete.DimensionsMm[1] != 150 || manguete.Transform.TranslationMm[1] != 402.8 {
		t.Fatalf("manguete frontal must keep 150 and recede to y=402.8, got min %v size %v",
			manguete.Transform.TranslationMm, manguete.DimensionsMm)
	}

	// Manguete amarre: outside the band, untouched.
	amarre := componentByName(layout, "Manguete Amarre")
	if amarre == nil || amarre.Transform.TranslationMm[1] != 0 || amarre.DimensionsMm[1] != 100 {
		t.Fatalf("manguete amarre must stay at y=0 with 100 depth, got %+v", amarre)
	}

	// Piso: role horizontal but below the profile band — untouched.
	piso := componentByName(layout, "Piso")
	if piso == nil || piso.DimensionsMm[1] != 562 {
		t.Fatalf("piso (PD−T, below the band) must stay untouched, got %+v", piso)
	}

	// The laterals' declared notch coexists with the reduction.
	notched := 0
	for i := range layout.Components {
		if layout.Components[i].SlotID == "lateral_izquierdo" || layout.Components[i].SlotID == "lateral_derecho" {
			if len(layout.Components[i].Notches) != 1 {
				t.Fatalf("side %s must carry its notch beside the reduction", layout.Components[i].ComponentInstanceID)
			}
			notched++
		}
	}
	if notched != 2 {
		t.Fatalf("both laterals must be notched, got %d", notched)
	}
}

func TestDepthReductionWithoutOpeningKeepsEverything(t *testing.T) {
	module, catalog := depthReductionGolaModule()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 580}

	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{})
	if err != nil {
		t.Fatalf("baseline resolve: %v", err)
	}
	techo := componentByName(layout, "Techo")
	if techo == nil || techo.DimensionsMm[1] != 580 || techo.Transform.TranslationMm[1] != 0 {
		t.Fatalf("without an opening the techo stays full depth, got %+v", techo)
	}
	manguete := componentByName(layout, "Manguete Frontal")
	if manguete == nil || manguete.Transform.TranslationMm[1] != 430 {
		t.Fatalf("without an opening the manguete stays at its authored y=PD−W, got %+v", manguete)
	}
}

func TestDepthReductionTrimsBottomPanelAtRebase(t *testing.T) {
	module, catalog := depthReductionGolaModule()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 580}

	// A bottom (rebase) gola addresses the BASE placement: the piso — here
	// authored full-depth — is the panel the profile band touches.
	fullPiso := domain.Component{
		ID: "comp-piso", Code: "PISO", Name: "Piso", Placement: domain.PlacementBase,
		GeometryKind: "rectangular_board", ThicknessMm: 18,
		OptionRoles:   []string{"INTERIOR"},
		LengthFormula: "PW - 2*T", WidthFormula: "PD",
		Construction: &domain.ComponentConstruction{ConstructiveRole: "horizontal"},
		Active:       true,
	}
	for i := range catalog.Components {
		if catalog.Components[i].ID == "comp-piso" {
			catalog.Components[i] = fullPiso
		}
	}
	rebase := []ResolvedOpeningBodyModifier{{
		Effect: OpeningModifierEffectDepthReduction, Role: "horizontal",
		ProfileID: "profile.gola-c.rebase", Boundary: "bottom",
		DepthReductionMm: 19, ProfileHeightMm: 42,
	}}
	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts:               openingPassFront("bottom", 8),
		openingBodyModifiers: rebase,
	})
	if err != nil {
		t.Fatalf("resolve with rebase reduction: %v", err)
	}
	piso := componentByName(layout, "Piso")
	if piso == nil || piso.DimensionsMm[1] != 561 || piso.Transform.TranslationMm[1] != 0 {
		t.Fatalf("rebase gola must trim the piso to 580 − 19 = 561, got %+v", piso)
	}
	techo := componentByName(layout, "Techo")
	if techo == nil || techo.DimensionsMm[1] != 580 {
		t.Fatalf("the top techo must stay untouched under a rebase gola, got %+v", techo)
	}
}

func TestDepthReductionFailsClosedOnUnclassifiablePanel(t *testing.T) {
	module, catalog := depthReductionGolaModule()
	// A panel that enters the band without being full-depth or front-flush
	// (the historical PD−T construction) is unclassifiable wood: the resolve
	// stops, it never receives an invented correction.
	inset := domain.Component{
		ID: "comp-techo", Code: "TECHO", Name: "Techo", Placement: domain.PlacementSuperior,
		GeometryKind: "rectangular_board", ThicknessMm: 18,
		OptionRoles:   []string{"INTERIOR"},
		LengthFormula: "PW - 2*T", WidthFormula: "PD - T",
		Construction: &domain.ComponentConstruction{ConstructiveRole: "horizontal"},
		Active:       true,
	}
	for i := range catalog.Components {
		if catalog.Components[i].ID == "comp-techo" {
			catalog.Components[i] = inset
		}
	}
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 580}
	_, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts:               openingPassFront("top", 40),
		openingBodyModifiers: depthReductionModifiers(),
	})
	if err == nil || !strings.Contains(err.Error(), "no es clasificable") {
		t.Fatalf("a mid-depth panel inside the band must fail closed, got %v", err)
	}
}

func TestDepthReductionFailsClosedWithoutAddressedBoards(t *testing.T) {
	// The declared role finds no board: a reduction that materializes
	// nowhere is a blocked resolve, never a silent no-op.
	module, catalog := oneDoorCabinetCatalog()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}
	_, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts: openingPassFront("top", 40),
		openingBodyModifiers: []ResolvedOpeningBodyModifier{{
			Effect: OpeningModifierEffectDepthReduction, Role: "horizontal",
			ProfileID: "profile.gola-l.8006", Boundary: "top",
			DepthReductionMm: 27.2, ProfileHeightMm: 56.5,
		}},
	})
	if err == nil || !strings.Contains(err.Error(), "no encontró tableros") {
		t.Fatalf("a reduction with no addressed boards must fail closed, got %v", err)
	}
}

func TestDepthReductionExemptsCorrectedBoardsFromAuthoredTranslation(t *testing.T) {
	module, catalog := depthReductionGolaModule()
	dims := &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 580}

	// An authored translation on the manguete template carries the stale
	// full-front pose; the opening's correction supersedes it (the same rule
	// that governs constrained fronts).
	plan := &authoringPlan{
		active: true,
		templates: map[string][]plannedCopy{
			"st-comp-mang-fro": {{instanceID: "st-comp-mang-fro-copy-0", translation: &[3]float64{18, 430, 702}}},
		},
		emitted: map[string]bool{},
	}
	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, dims, nil, resolveOptions{
		fronts:               openingPassFront("top", 40),
		openingBodyModifiers: depthReductionModifiers(),
		plan:                 plan,
	})
	if err != nil {
		t.Fatalf("resolve with authored plan: %v", err)
	}
	manguete := componentByName(layout, "Manguete Frontal")
	if manguete == nil || manguete.Transform.TranslationMm[1] != 402.8 {
		t.Fatalf("the opening's Y correction must survive an authored translation, got %+v", manguete)
	}
}

// #1317 BOM coherence: the release cut list carries the EXACT finished
// measure of the reduced panel (552.8), the manguete keeps its own depth
// (its correction is position-only), and the arithmetic is per-declaration.
func TestReleaseBOMCarriesExactDepthReduction(t *testing.T) {
	module, catalog := depthReductionGolaModule()
	catalog.Modules = append(catalog.Modules, module)
	catalog.Materials = append(catalog.Materials, domain.MaterialBoard{
		ID: "mat-opening", Code: "MAT-OPENING", Name: "Tablero Opening",
		WidthMm: 2750, LengthMm: 1850, ThicknessMm: 18, Active: true,
	})
	item := domain.DesignRevisionItem{
		DesignRevisionID:      "revision-depth",
		FurnitureInstanceID:   "unit-depth",
		FurnitureDefinitionID: module.ID,
		Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 580.0},
		MaterialChoices:       map[string]string{"LATERAL": "mat-opening", "INTERIOR": "mat-opening"},
	}
	resolution := ReleaseUnitOpening{
		Fronts: openingPassFront("top", 40),
		Modifiers: []ResolvedOpeningBodyModifier{{
			Effect: OpeningModifierEffectDepthReduction, Role: "horizontal",
			ProfileID: "profile.gola-l.8006", Boundary: "top",
			DepthReductionMm: 27.2, ProfileHeightMm: 56.5,
		}},
	}
	dims := &domain.ItemCustomDims{WidthMm: 600, HeightMm: 720, DepthMm: 580}
	bom, err := ResolveBomForReleaseWithOpening(module, item.MaterialChoices, catalog, dims, nil, resolution.Fronts, resolution.Modifiers, nil)
	if err != nil {
		t.Fatalf("release BOM with depth reduction: %v", err)
	}
	byName := map[string]domain.ResolvedBoardPart{}
	for _, part := range bom.BoardParts {
		byName[part.Description] = part
	}
	techo, ok := byName["Techo"]
	if !ok {
		t.Fatalf("fixture lost the techo part: %+v", bom.BoardParts)
	}
	if techo.WidthMm != 552.8 || techo.LengthMm != 564 {
		t.Fatalf("techo cut line must carry 552.8 × 564 exactly, got %g × %g", techo.WidthMm, techo.LengthMm)
	}
	manguete, ok := byName["Manguete Frontal"]
	if !ok || manguete.WidthMm != 150 {
		t.Fatalf("manguete frontal cut line keeps its own 150 depth, got %+v", manguete)
	}
	piso, ok := byName["Piso"]
	if !ok || piso.WidthMm != 562 {
		t.Fatalf("piso (PD−T, outside the band) stays at 562, got %+v", piso)
	}

	// The same unit without modifiers keeps every authored measure.
	plain, err := ResolveBomForReleaseWithOpening(module, item.MaterialChoices, catalog, dims, nil, resolution.Fronts, nil, nil)
	if err != nil {
		t.Fatalf("release BOM without modifiers: %v", err)
	}
	for _, part := range plain.BoardParts {
		if part.Description == "Techo" && part.WidthMm != 580 {
			t.Fatalf("without modifiers the techo stays at 580, got %g", part.WidthMm)
		}
	}
}
