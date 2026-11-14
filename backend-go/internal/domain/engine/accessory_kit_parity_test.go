package engine_test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1502: paridad TS↔Go del kit accesorio elegible. Autoridad numérica única:
// contracts/fixtures/accessoryKitParity.contract.json — ambos lados CONSTRUYEN
// catálogo y receta desde el JSON (patrón variantKitQuoteParity). El espejo TS
// vive en packages/domain/src/accessoryKitParity.test.ts.

type accessoryKitFixture struct {
	Heights []struct {
		Code               string  `json:"code"`
		NominalDimensionMm float64 `json:"nominalDimensionMm"`
		HardwareID         string  `json:"hardwareId"`
		KitHardwareID      string  `json:"kitHardwareId"`
	} `json:"heights"`
	Module struct {
		WidthMm          int    `json:"widthMm"`
		HeightMm         int    `json:"heightMm"`
		DepthMm          int    `json:"depthMm"`
		BayHeightFormula string `json:"bayHeightFormula"`
	} `json:"module"`
	AccessoryGroup struct {
		Code          string `json:"code"`
		Name          string `json:"name"`
		Required      bool   `json:"required"`
		KitHardwareID string `json:"kitHardwareId"`
		Accessories   []struct {
			ID    string `json:"id"`
			Code  string `json:"code"`
			Name  string `json:"name"`
			Parts []struct {
				ID              string `json:"id"`
				Code            string `json:"code"`
				Name            string `json:"name"`
				Label           string `json:"label"`
				ActorMembership string `json:"actorMembership"`
			} `json:"parts"`
		} `json:"accessories"`
	} `json:"accessoryGroup"`
	ChosenAccessoryID         string `json:"chosenAccessoryId"`
	ExpectedAccessoryAssembly struct {
		AssemblyInstanceID string   `json:"assemblyInstanceId"`
		MemberHardwareIDs  []string `json:"memberHardwareIds"`
	} `json:"expectedAccessoryAssembly"`
	ExpectedAccessoryKitLine struct {
		ID         string  `json:"id"`
		HardwareID string  `json:"hardwareId"`
		Quantity   float64 `json:"quantity"`
	} `json:"expectedAccessoryKitLine"`
}

func loadAccessoryKitFixture(t *testing.T) accessoryKitFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "fixtures", "accessoryKitParity.contract.json"))
	if err != nil {
		t.Fatalf("failed reading shared contract: %v", err)
	}
	var fixture accessoryKitFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("failed unmarshaling shared contract: %v", err)
	}
	if len(fixture.AccessoryGroup.Accessories) < 2 {
		t.Fatalf("expected at least 2 accessory choices, got %d", len(fixture.AccessoryGroup.Accessories))
	}
	return fixture
}

// buildAccessoryKitScenario construye catálogo + módulo desde los números del
// fixture. required sobreescribe el Required del grupo para los escenarios
// opcional/requerido; linked controla si el grupo declara el kit accesorio
// (control legacy byte-idéntico).
func buildAccessoryKitScenario(f accessoryKitFixture, required, linked bool) (domain.Catalog, domain.Module) {
	variants := make([]domain.ProductVariant, 0, len(f.Heights))
	hardware := []domain.Hardware{}
	for _, h := range f.Heights {
		variants = append(variants, domain.ProductVariant{
			NominalDimensionMm:      h.NominalDimensionMm,
			HardwareID:              h.HardwareID,
			CommercialKitHardwareID: h.KitHardwareID,
		})
		hardware = append(hardware,
			domain.Hardware{ID: h.HardwareID, Code: h.HardwareID, Name: h.HardwareID, Unit: "piece", CostPerUnit: 100, Active: true},
			domain.Hardware{ID: h.KitHardwareID, Code: strings.ToUpper(h.KitHardwareID), Name: h.KitHardwareID, Unit: "set", CostPerUnit: 200, Active: true},
		)
	}

	optionIDs := make([]string, 0, len(f.AccessoryGroup.Accessories))
	for _, acc := range f.AccessoryGroup.Accessories {
		optionIDs = append(optionIDs, acc.ID)
		hardware = append(hardware, domain.Hardware{
			ID: acc.ID, Code: acc.Code, Name: acc.Name, Unit: "set", CostPerUnit: 90, Active: true,
		})
		// Las PARTES del accesorio (kit accesorio con hijos propios): mismos
		// campos que las partes del kit principal (#1422) — placement y actor
		// viajan en DesignParts[0].
		for _, part := range acc.Parts {
			hardware = append(hardware, domain.Hardware{
				ID: part.ID, Code: part.Code, Name: part.Name, Unit: "piece", CostPerUnit: 30, Active: true,
				KitHardwareID: &acc.ID,
				DesignParts: []domain.HardwareDesignPart{{
					ComponentName:   part.Code,
					ActorMembership: part.ActorMembership,
					Label:           part.Label,
				}},
			})
		}
	}

	kitLink := f.AccessoryGroup.KitHardwareID
	group := domain.OptionGroup{
		ID:        "og-lateral-e",
		Code:      f.AccessoryGroup.Code,
		Name:      f.AccessoryGroup.Name,
		Kind:      "hardware",
		Required:  required,
		OptionIDs: optionIDs,
	}
	if linked {
		group.KitHardwareID = &kitLink
	}

	member := func(id, role string, xRef domain.AssemblyAxisRef) domain.AgregadoRigidMember {
		return domain.AgregadoRigidMember{
			MemberID: id,
			Role:     role,
			Source: domain.RigidMemberSource{
				Kind:    domain.RigidMemberSourceVariant,
				Variant: &domain.VariantHardwareSource{VariantSetID: "height-variants"},
			},
			Placement: domain.AssemblyAnchorRule{
				X: domain.AssemblyAxisPlacement{Ref: xRef},
				Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			},
			BOMRole: domain.BOMRoleIncludedInKit,
		}
	}
	agr := domain.Agregado{
		ID:     "agr-mbox-acc",
		Code:   "MERIVOBOX-ACC",
		Name:   "MERIVOBOX con accesorio",
		Active: true,
		VariantSets: []domain.AgregadoVariantSet{
			{ID: "height-variants", Dimension: "height", Variants: variants},
		},
		RigidMembers: []domain.AgregadoRigidMember{
			member("side-left", "drawer_side_left", domain.AxisRefMin),
			member("side-right", "drawer_side_right", domain.AxisRefMax),
		},
		Components:    []domain.ComponentInstance{},
		HardwareLines: []domain.HardwareLine{},
	}

	edges := []domain.EdgeAssignment{{Side: "L1"}, {Side: "L2"}, {Side: "W1"}, {Side: "W2"}}
	mod := domain.Module{
		ID: "mod-cajonera-acc", Code: "CAJONERA-ACC", Name: "Cajonera accesorio",
		WidthMm: f.Module.WidthMm, HeightMm: f.Module.HeightMm, DepthMm: f.Module.DepthMm,
		BoardParts: []domain.BoardPart{
			{ID: "p-lat-izq", Description: "Lateral Izq", Quantity: 1, LengthMm: 542, WidthMm: 500, OptionRole: "LATERAL", Edges: edges},
			{ID: "p-lat-der", Description: "Lateral Der", Quantity: 1, LengthMm: 542, WidthMm: 500, OptionRole: "LATERAL", Edges: edges},
		},
		Agregados: []domain.ModuleAgregadoInstance{
			{ID: "inst-bajo", AgregadoID: agr.ID, Quantity: 1,
				Dimensions: &domain.AgregadoDimensions{HeightFormula: f.Module.BayHeightFormula}},
		},
		Components:    []domain.ComponentInstance{},
		HardwareLines: []domain.HardwareLine{},
	}

	catalog := domain.Catalog{
		Agregados: []domain.Agregado{agr},
		Hardware:  hardware,
		Materials: []domain.MaterialBoard{{
			ID: "mat-lateral", Code: "MAT-LAT", Name: "Lateral",
			WidthMm: 1830, LengthMm: 2440, ThicknessMm: 18,
			GrainDefault: true, BoardPrice: 100, WastePercent: 0, CostPerM2: 100,
			Active: true,
		}},
		OptionGroups: []domain.OptionGroup{
			group,
			{ID: "og-lateral", Code: "LATERAL", Name: "Lateral", Kind: "board", Required: true, OptionIDs: []string{"mat-lateral"}},
		},
	}
	return catalog, mod
}

// accessoryTestChoices combina la elección de material de los laterales con
// las elecciones del escenario.
func accessoryTestChoices(f accessoryKitFixture, extra map[string]string) map[string]string {
	choices := map[string]string{"LATERAL": "mat-lateral"}
	for code, id := range extra {
		choices[code] = id
	}
	return choices
}

// accessoryAssembliesOf filtra los ensambles accesorios (id con sufijo -acc-).
func accessoryAssembliesOf(layout engine.FurnitureLayout) []engine.LayoutAssembly {
	out := make([]engine.LayoutAssembly, 0)
	for _, asm := range layout.Assemblies {
		if strings.Contains(asm.AssemblyInstanceID, "-acc-") {
			out = append(out, asm)
		}
	}
	return out
}

func accessoryKitLinesOf(bom domain.ResolvedBom) []domain.ResolvedHardwareLine {
	out := make([]domain.ResolvedHardwareLine, 0)
	for _, line := range bom.HardwareLines {
		if strings.HasPrefix(line.ID, "kit-acc-") {
			out = append(out, line)
		}
	}
	return out
}

func TestAccessoryKitParitySharedContract_1502(t *testing.T) {
	f := loadAccessoryKitFixture(t)
	catalog, mod := buildAccessoryKitScenario(f, true, true)
	choices := accessoryTestChoices(f, map[string]string{f.AccessoryGroup.Code: f.ChosenAccessoryID})

	layout, err := engine.ResolveFurnitureLayout(mod, catalog, nil, choices)
	if err != nil {
		t.Fatalf("ResolveFurnitureLayout unexpected error: %v", err)
	}
	acc := accessoryAssembliesOf(layout)
	if len(acc) != 1 {
		t.Fatalf("expected 1 accessory assembly, got %d: %+v", len(acc), layout.Assemblies)
	}
	if acc[0].AssemblyInstanceID != f.ExpectedAccessoryAssembly.AssemblyInstanceID {
		t.Errorf("accessory assembly id = %q, want %q", acc[0].AssemblyInstanceID, f.ExpectedAccessoryAssembly.AssemblyInstanceID)
	}
	if len(layout.AssemblyRejections) != 0 {
		t.Errorf("expected no rejections with a valid choice, got %+v", layout.AssemblyRejections)
	}
	members := make([]string, 0, len(acc[0].RigidMembers))
	for _, rm := range acc[0].RigidMembers {
		members = append(members, rm.HardwareID)
	}
	if strings.Join(members, ",") != strings.Join(f.ExpectedAccessoryAssembly.MemberHardwareIDs, ",") {
		t.Errorf("accessory members = %v, want %v", members, f.ExpectedAccessoryAssembly.MemberHardwareIDs)
	}

	bom, err := engine.ResolveBomWithContext(mod, choices, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("ResolveBomWithContext unexpected error: %v", err)
	}
	accLines := accessoryKitLinesOf(bom)
	if len(accLines) != 1 {
		t.Fatalf("expected 1 accessory kit line, got %d: %+v", len(accLines), bom.HardwareLines)
	}
	if accLines[0].ID != f.ExpectedAccessoryKitLine.ID ||
		accLines[0].HardwareID != f.ExpectedAccessoryKitLine.HardwareID ||
		accLines[0].Quantity != f.ExpectedAccessoryKitLine.Quantity {
		t.Errorf("accessory line = {id:%s hw:%s qty:%g}, want {id:%s hw:%s qty:%g}",
			accLines[0].ID, accLines[0].HardwareID, accLines[0].Quantity,
			f.ExpectedAccessoryKitLine.ID, f.ExpectedAccessoryKitLine.HardwareID, f.ExpectedAccessoryKitLine.Quantity)
	}
}

// Control legacy: el MISMO escenario con el grupo SIN kit_hardware_id no
// cambia nada — sin ensamble accesorio, sin línea, sin rechazos.
func TestAccessoryKitLegacyGroupByteIdentical_1502(t *testing.T) {
	f := loadAccessoryKitFixture(t)
	catalog, mod := buildAccessoryKitScenario(f, true, false)
	choices := accessoryTestChoices(f, map[string]string{f.AccessoryGroup.Code: f.ChosenAccessoryID})

	layout, err := engine.ResolveFurnitureLayout(mod, catalog, nil, choices)
	if err != nil {
		t.Fatalf("ResolveFurnitureLayout unexpected error: %v", err)
	}
	if acc := accessoryAssembliesOf(layout); len(acc) != 0 {
		t.Fatalf("legacy group must not emit accessory assemblies, got %+v", acc)
	}
	if len(layout.AssemblyRejections) != 0 {
		t.Fatalf("legacy group must not reject, got %+v", layout.AssemblyRejections)
	}

	bom, err := engine.ResolveBomWithContext(mod, choices, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("ResolveBomWithContext unexpected error: %v", err)
	}
	if acc := accessoryKitLinesOf(bom); len(acc) != 0 {
		t.Fatalf("legacy group must not quote accessories, got %+v", acc)
	}
}

// assertDefaultAccessoryMounted: sin elección, la bahía monta y cotiza la
// PRIMERA opción activa del grupo (decisión del owner 2026-11-13, sustituye
// «sólo elección explícita» de #1555) — idéntico para opcional y requerido.
func assertDefaultAccessoryMounted(t *testing.T, f accessoryKitFixture, required bool) {
	t.Helper()
	catalog, mod := buildAccessoryKitScenario(f, required, true)
	wantID := f.AccessoryGroup.Accessories[0].ID

	layout, err := engine.ResolveFurnitureLayout(mod, catalog, nil, accessoryTestChoices(f, nil))
	if err != nil {
		t.Fatalf("ResolveFurnitureLayout unexpected error: %v", err)
	}
	if len(layout.AssemblyRejections) != 0 {
		t.Fatalf("default accessory must not reject, got %+v", layout.AssemblyRejections)
	}
	acc := accessoryAssembliesOf(layout)
	if len(acc) != 1 {
		t.Fatalf("expected exactly the default accessory assembly, got %d", len(acc))
	}
	if len(layout.Assemblies) != 2 {
		t.Fatalf("expected main bay + default accessory, got %d assemblies", len(layout.Assemblies))
	}

	bom, err := engine.ResolveBomWithContext(mod, accessoryTestChoices(f, nil), catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("ResolveBomWithContext unexpected error: %v", err)
	}
	lines := accessoryKitLinesOf(bom)
	if len(lines) != 1 || lines[0].HardwareID != wantID {
		t.Fatalf("default accessory must quote %q once, got %+v", wantID, lines)
	}

	result, err := engine.ResolveAuthoringLayout(engine.AuthoringResolveInput{
		Module:        mod,
		Catalog:       catalog,
		Dims:          &engine.LayoutDims{WidthMm: f.Module.WidthMm, HeightMm: f.Module.HeightMm, DepthMm: f.Module.DepthMm},
		OptionChoices: accessoryTestChoices(f, nil),
	})
	if err != nil {
		t.Fatalf("ResolveAuthoringLayout unexpected error: %v", err)
	}
	for _, issue := range result.ValidationIssues {
		if issue.Code == "ACCESSORY_CHOICE_REQUIRED" {
			t.Fatalf("default accessory must not raise ACCESSORY_CHOICE_REQUIRED: %+v", issue)
		}
	}
}

func TestAccessoryKitOptionalWithoutChoiceMountsFirstOption(t *testing.T) {
	assertDefaultAccessoryMounted(t, loadAccessoryKitFixture(t), false)
}

func TestAccessoryKitRequiredWithoutChoiceMountsFirstOption(t *testing.T) {
	assertDefaultAccessoryMounted(t, loadAccessoryKitFixture(t), true)
}

// El default salta las opciones INACTIVAS: con la primera desactivada, la
// bahía monta la siguiente activa en el orden declarado.
func TestAccessoryKitDefaultSkipsInactiveOption(t *testing.T) {
	f := loadAccessoryKitFixture(t)
	catalog, mod := buildAccessoryKitScenario(f, false, true)
	firstID, secondID := f.AccessoryGroup.Accessories[0].ID, f.AccessoryGroup.Accessories[1].ID
	for i := range catalog.Hardware {
		if catalog.Hardware[i].ID == firstID {
			catalog.Hardware[i].Active = false
		}
	}
	bom, err := engine.ResolveBomWithContext(mod, accessoryTestChoices(f, nil), catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("ResolveBomWithContext unexpected error: %v", err)
	}
	lines := accessoryKitLinesOf(bom)
	if len(lines) != 1 || lines[0].HardwareID != secondID {
		t.Fatalf("default must be the first ACTIVE option %q, got %+v", secondID, lines)
	}
}

// Sin NINGUNA opción activa: el grupo opcional no aporta nada; el REQUERIDO
// conserva el fail-closed visible — rejection accessory_choice_required por
// bahía, issue ACCESSORY_CHOICE_REQUIRED (status blocked CON layout
// presente) y la cotización no inventa demanda. El cajón se dibuja igual.
func TestAccessoryKitWithoutActiveOptions_1502(t *testing.T) {
	f := loadAccessoryKitFixture(t)
	for _, required := range []bool{false, true} {
		catalog, mod := buildAccessoryKitScenario(f, required, true)
		accessoryIDs := map[string]bool{}
		for _, acc := range f.AccessoryGroup.Accessories {
			accessoryIDs[acc.ID] = true
		}
		for i := range catalog.Hardware {
			if accessoryIDs[catalog.Hardware[i].ID] {
				catalog.Hardware[i].Active = false
			}
		}

		layout, err := engine.ResolveFurnitureLayout(mod, catalog, nil, accessoryTestChoices(f, nil))
		if err != nil {
			t.Fatalf("required=%v: ResolveFurnitureLayout unexpected error: %v", required, err)
		}
		if len(layout.Assemblies) != 1 {
			t.Fatalf("required=%v: the main bay assembly must still be emitted alone, got %d", required, len(layout.Assemblies))
		}
		bom, err := engine.ResolveBomWithContext(mod, accessoryTestChoices(f, nil), catalog, nil, "", nil, nil)
		if err != nil {
			t.Fatalf("required=%v: ResolveBomWithContext unexpected error: %v", required, err)
		}
		if acc := accessoryKitLinesOf(bom); len(acc) != 0 {
			t.Fatalf("required=%v: no active option must not quote accessories, got %+v", required, acc)
		}

		result, err := engine.ResolveAuthoringLayout(engine.AuthoringResolveInput{
			Module:        mod,
			Catalog:       catalog,
			Dims:          &engine.LayoutDims{WidthMm: f.Module.WidthMm, HeightMm: f.Module.HeightMm, DepthMm: f.Module.DepthMm},
			OptionChoices: accessoryTestChoices(f, nil),
		})
		if err != nil {
			t.Fatalf("required=%v: ResolveAuthoringLayout unexpected error: %v", required, err)
		}
		blocked := false
		for _, issue := range result.ValidationIssues {
			if issue.Code == "ACCESSORY_CHOICE_REQUIRED" {
				blocked = true
			}
		}

		if !required {
			if len(layout.AssemblyRejections) != 0 || blocked {
				t.Fatalf("optional group without active options must stay silent, got rejections=%+v blocked=%v", layout.AssemblyRejections, blocked)
			}
			continue
		}
		if len(layout.AssemblyRejections) != 1 || layout.AssemblyRejections[0].Reason != "accessory_choice_required" {
			t.Fatalf("required group without active options must reject once, got %+v", layout.AssemblyRejections)
		}
		wantID := fmt.Sprintf("%s-acc-%s", "inst-bajo", strings.ToLower(f.AccessoryGroup.Code))
		if layout.AssemblyRejections[0].AssemblyInstanceID != wantID {
			t.Errorf("rejection assemblyInstanceId = %q, want %q", layout.AssemblyRejections[0].AssemblyInstanceID, wantID)
		}
		if !blocked || result.ValidationStatus != "blocked" {
			t.Fatalf("expected ACCESSORY_CHOICE_REQUIRED + blocked, got status=%q issues=%+v", result.ValidationStatus, result.ValidationIssues)
		}
	}
}

// Accesorio monolítico (kit accesorio sin partes): un miembro con el asset
// del propio herraje elegido.
func TestAccessoryKitMonolithicAccessory_1502(t *testing.T) {
	f := loadAccessoryKitFixture(t)
	catalog, mod := buildAccessoryKitScenario(f, true, true)
	monolithic := f.AccessoryGroup.Accessories[1].ID
	if len(f.AccessoryGroup.Accessories[1].Parts) != 0 {
		t.Fatalf("fixture second accessory must be monolithic for this scenario")
	}
	choices := accessoryTestChoices(f, map[string]string{f.AccessoryGroup.Code: monolithic})

	layout, err := engine.ResolveFurnitureLayout(mod, catalog, nil, choices)
	if err != nil {
		t.Fatalf("ResolveFurnitureLayout unexpected error: %v", err)
	}
	acc := accessoryAssembliesOf(layout)
	if len(acc) != 1 || len(acc[0].RigidMembers) != 1 {
		t.Fatalf("expected 1 accessory assembly with 1 member, got %+v", acc)
	}
	if acc[0].RigidMembers[0].HardwareID != monolithic {
		t.Errorf("monolithic member = %s, want %s", acc[0].RigidMembers[0].HardwareID, monolithic)
	}
}

// #1596 aceptación de paridad: un inserto del ALTA NUEVA (herraje
// monolítico con Pieces I/D — cada una con offsets explícitos — y
// DesignParts[0].actorMembership = actor:drawer) resuelve en la bahía E
// como DOS miembros (mano izquierda y derecha) con el movimiento
// declarado, honrando los offsets guardados — nunca los defaults 10/35
// de la inferencia legacy.
func TestAccessoryKitInsertoPiecesTwoMembersDeclaredMotion_1596(t *testing.T) {
	f := loadAccessoryKitFixture(t)
	catalog, mod := buildAccessoryKitScenario(f, true, true)
	monolithic := f.AccessoryGroup.Accessories[1].ID
	mutated := false
	for i := range catalog.Hardware {
		if catalog.Hardware[i].ID != monolithic {
			continue
		}
		mutated = true
		catalog.Hardware[i].Pieces = []domain.HardwarePiece{
			{Anchor: "left", OffsetMm: &domain.HardwarePieceOffset{X: 12.5, Y: 3, Z: 1}},
			{Anchor: "right", OffsetMm: &domain.HardwarePieceOffset{X: -3, Y: 0, Z: 1}},
		}
		catalog.Hardware[i].DesignParts = []domain.HardwareDesignPart{{
			ComponentName:   catalog.Hardware[i].Code,
			ActorMembership: "actor:drawer",
		}}
	}
	if !mutated {
		t.Fatalf("accessory %s not found in catalog", monolithic)
	}
	choices := accessoryTestChoices(f, map[string]string{f.AccessoryGroup.Code: monolithic})

	layout, err := engine.ResolveFurnitureLayout(mod, catalog, nil, choices)
	if err != nil {
		t.Fatalf("ResolveFurnitureLayout unexpected error: %v", err)
	}
	acc := accessoryAssembliesOf(layout)
	if len(acc) != 1 {
		t.Fatalf("expected 1 accessory assembly, got %+v", acc)
	}
	if len(acc[0].RigidMembers) != 2 {
		t.Fatalf("inserto with pieces must resolve as 2 members (left+right), got %d: %+v", len(acc[0].RigidMembers), acc[0].RigidMembers)
	}
	byHand := map[string]domain.ResolvedRigidMember{}
	for _, m := range acc[0].RigidMembers {
		byHand[m.Hand] = m
	}
	left, hasLeft := byHand["left"]
	right, hasRight := byHand["right"]
	if !hasLeft || !hasRight {
		t.Fatalf("members must carry hands left and right, got %+v", acc[0].RigidMembers)
	}
	for name, m := range map[string]domain.ResolvedRigidMember{"left": left, "right": right} {
		if m.ActorMembership != "actor:drawer" {
			t.Errorf("%s member actorMembership = %q, want actor:drawer (the declared «Al abrir»)", name, m.ActorMembership)
		}
		if m.HardwareID != monolithic {
			t.Errorf("%s member hardwareId = %s, want %s", name, m.HardwareID, monolithic)
		}
	}
	// Offsets explícitos verbatim (mostrado = guardado). La izquierda ancla
	// a min: su traslación en espacio del ensamble es el offset tal cual
	// [12.5, 3, 1] — no el default 10 de la inferencia legacy. La derecha
	// ancla a max (x depende del ancho del ensamble); sus y/z son el offset
	// verbatim [0, 1] y su x cae al lado izquierdo del ensamble.
	lt := left.LocalTransform.TranslationMm
	if lt[0] != 12.5 || lt[1] != 3 || lt[2] != 1 {
		t.Errorf("left member translation = %v, want explicit offsets [12.5 3 1]", lt)
	}
	rt := right.LocalTransform.TranslationMm
	if rt[1] != 0 || rt[2] != 1 {
		t.Errorf("right member y/z = %v, want explicit offsets [0 1]", rt)
	}
	if rt[0] <= lt[0] {
		t.Errorf("right member x (%v) must sit right of the left member (%v)", rt[0], lt[0])
	}
}

// Elección inválida (no es miembro activo del grupo): rechazo visible
// resolve_failed y cero accesorios dibujados o cotizados.
func TestAccessoryKitInvalidChoice_1502(t *testing.T) {
	f := loadAccessoryKitFixture(t)
	catalog, mod := buildAccessoryKitScenario(f, true, true)
	choices := accessoryTestChoices(f, map[string]string{f.AccessoryGroup.Code: "kit-acc-desconocido"})

	layout, err := engine.ResolveFurnitureLayout(mod, catalog, nil, choices)
	if err != nil {
		t.Fatalf("ResolveFurnitureLayout unexpected error: %v", err)
	}
	if acc := accessoryAssembliesOf(layout); len(acc) != 0 {
		t.Fatalf("invalid choice must not emit accessory assemblies, got %+v", acc)
	}
	if len(layout.AssemblyRejections) != 1 || layout.AssemblyRejections[0].Reason != "resolve_failed" {
		t.Fatalf("expected 1 resolve_failed rejection, got %+v", layout.AssemblyRejections)
	}

	bom, err := engine.ResolveBomWithContext(mod, choices, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("ResolveBomWithContext unexpected error: %v", err)
	}
	if acc := accessoryKitLinesOf(bom); len(acc) != 0 {
		t.Fatalf("invalid choice must not quote accessories, got %+v", acc)
	}
}

// El dedupe contra bulk del kit principal NO elimina los accesorios: con una
// línea bulk que ya resuelve al kit, el kit no se duplica pero la línea del
// accesorio elegido sigue presente.
func TestAccessoryKitSurvivesBulkDedupe_1502(t *testing.T) {
	f := loadAccessoryKitFixture(t)
	catalog, mod := buildAccessoryKitScenario(f, true, true)
	// El autor añade el kit-E como bulk line explícita en la receta.
	catalog.Agregados[0].HardwareLines = []domain.HardwareLine{
		{ID: "hl-kit-e", Quantity: 1, OptionRole: "KIT_MANUAL", HardwareID: f.AccessoryGroup.KitHardwareID},
	}
	choices := accessoryTestChoices(f, map[string]string{f.AccessoryGroup.Code: f.ChosenAccessoryID})

	bom, err := engine.ResolveBomWithContext(mod, choices, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("ResolveBomWithContext unexpected error: %v", err)
	}
	kitECount := 0
	for _, line := range bom.HardwareLines {
		if line.HardwareID == f.AccessoryGroup.KitHardwareID {
			kitECount++
		}
	}
	if kitECount != 1 {
		t.Fatalf("bulk dedupe: expected exactly 1 line for the main kit, got %d", kitECount)
	}
	accLines := accessoryKitLinesOf(bom)
	if len(accLines) != 1 || accLines[0].HardwareID != f.ChosenAccessoryID {
		t.Fatalf("accessory line must survive the bulk dedupe, got %+v", accLines)
	}
}

// #1620 (review P1-2): la intersección de elecciones consumidas (#826) es
// BOM-neutral sólo si nunca suelta la clave de un grupo de insertos que el
// mueble monta: una elección explícita INVÁLIDA no dibuja ni cotiza nada,
// mientras que la clave ausente cae a la primera opción activa. La clave
// stale se conserva y el gate estricto de liberación la rechaza por nombre.
// La clave de un grupo vinculado a un kit que el mueble NO monta sigue
// siendo descartable.
func TestIntersectKeepsStaleMountedAccessoryChoice_1620(t *testing.T) {
	f := loadAccessoryKitFixture(t)
	catalog, mod := buildAccessoryKitScenario(f, false, true)
	// The release unit only accepts agregados on a composed (structure-backed)
	// definition, with explicit integer dimensions.
	catalog.Structures = append(catalog.Structures, domain.Structure{ID: "st-acc", Code: "ST-ACC", Name: "Cuerpo", Active: true})
	mod.StructureID = "st-acc"
	catalog.Modules = append(catalog.Modules, mod)
	otherKit := "kit-otro"
	catalog.Hardware = append(catalog.Hardware,
		domain.Hardware{ID: otherKit, Code: "KIT-OTRO", Name: "Kit otro", Unit: "set", Active: true},
		domain.Hardware{ID: "acc-otro", Code: "ACC-OTRO", Name: "Accesorio otro", Unit: "set", Active: true},
	)
	catalog.OptionGroups = append(catalog.OptionGroups, domain.OptionGroup{
		ID: "og-otro", Code: "LATERAL_OTRO", Name: "Lateral otro", Kind: "hardware",
		OptionIDs: []string{"acc-otro"}, KitHardwareID: &otherKit,
	})
	stale := f.AccessoryGroup.Accessories[0].ID
	for i := range catalog.Hardware {
		if catalog.Hardware[i].ID == stale {
			catalog.Hardware[i].Active = false
		}
	}
	item := domain.DesignRevisionItem{
		FurnitureInstanceID:   "fi-acc",
		FurnitureDefinitionID: mod.ID,
		Parameters: map[string]any{
			"widthMm": float64(f.Module.WidthMm), "heightMm": float64(f.Module.HeightMm), "depthMm": float64(f.Module.DepthMm),
		},
		MaterialChoices: map[string]string{
			"LATERAL":             "mat-lateral",
			f.AccessoryGroup.Code: stale,
			"LATERAL_OTRO":        "acc-otro",
		},
	}

	filtered, ok := engine.IntersectConsumedOptionChoices(item, catalog)
	if !ok {
		t.Fatal("resolvable unit must intersect")
	}
	if filtered[f.AccessoryGroup.Code] != stale {
		t.Fatalf("the stale pick of a mounted accessory group must survive the intersection, got %+v", filtered)
	}
	if _, kept := filtered["LATERAL_OTRO"]; kept {
		t.Fatalf("an accessory group of a kit the module does not mount must stay droppable, got %+v", filtered)
	}

	// BOM-neutral: the frozen choices quote exactly what the original choices
	// quoted (no accessory line), never the silent default.
	before, err := engine.ResolveBomWithContext(mod, item.MaterialChoices, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("ResolveBomWithContext(before): %v", err)
	}
	after, err := engine.ResolveBomWithContext(mod, filtered, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("ResolveBomWithContext(after): %v", err)
	}
	if len(accessoryKitLinesOf(before)) != 0 || len(accessoryKitLinesOf(after)) != 0 {
		t.Fatalf("a stale pick quotes nothing before and after the intersection: before=%+v after=%+v",
			accessoryKitLinesOf(before), accessoryKitLinesOf(after))
	}

	// The strict release gate rejects the stale value by name.
	item.MaterialChoices = filtered
	if _, err := engine.ResolveReleaseUnit(item, catalog); err == nil || !strings.Contains(err.Error(), f.AccessoryGroup.Code) {
		t.Fatalf("release gate must reject the stale accessory pick by name, got %v", err)
	}
}
