package engine

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #403 / MT-2 — material binding role contract regression.
//
// Physical/placement role and material binding role are orthogonal concerns:
// LEFT_SIDE/BASE/SHELF/DOOR answer "what piece is this"; BODY/FRONT/BACK
// answer "which material selection does this piece follow". The binding is
// single (OptionRoles[0] is the only effective key), never inferred from
// component name, placement, color or texture, and legacy aliases
// (ZOCLO / PUERTA / FRENTE_CAJON → FRENTE) follow one explicit precedence
// table.
//
// The alias/binding tables live in contracts/materialRoleBinding.contract.json
// and are consumed VERBATIM by the TS mirror
// (packages/domain/src/materialRoleBinding.test.ts) — a change here without
// the other is a contract break by definition.

const materialRoleContractPath = "../../../../contracts/materialRoleBinding.contract.json"

type aliasCase struct {
	Name             string            `json:"name"`
	Role             string            `json:"role"`
	Choices          map[string]string `json:"choices"`
	ExpectedChoiceID *string           `json:"expectedChoiceId"`
}

type bindingCase struct {
	Name        string   `json:"name"`
	OptionRoles []string `json:"optionRoles"`
	ExpectRole  string   `json:"expectRole"`
	ExpectError bool     `json:"expectError"`
}

type roleBindingContract struct {
	AliasCases   []aliasCase   `json:"aliasCases"`
	BindingCases []bindingCase `json:"bindingCases"`
}

func loadMaterialRoleContract(t *testing.T) roleBindingContract {
	t.Helper()
	raw, err := os.ReadFile(materialRoleContractPath)
	if err != nil {
		t.Fatalf("read shared contract %s: %v", materialRoleContractPath, err)
	}
	var c roleBindingContract
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatalf("parse shared contract: %v", err)
	}
	if len(c.AliasCases) == 0 || len(c.BindingCases) == 0 {
		t.Fatalf("shared contract must carry alias and binding cases")
	}
	return c
}

// ─── Shared contract fixture (alias table + single binding) ───────────────────

func TestMaterialRole_SharedAliasContract(t *testing.T) {
	contract := loadMaterialRoleContract(t)
	for _, c := range contract.AliasCases {
		got := resolveBoardOptionChoiceID(c.Role, c.Choices)
		want := ""
		if c.ExpectedChoiceID != nil {
			want = *c.ExpectedChoiceID
		}
		if got != want {
			t.Errorf("alias case %q (role=%s): resolveBoardOptionChoiceID = %q, want %q",
				c.Name, c.Role, got, want)
		}
	}
}

func TestMaterialRole_SharedBindingContract(t *testing.T) {
	contract := loadMaterialRoleContract(t)
	for _, c := range contract.BindingCases {
		comp := domain.Component{ID: "comp-contract", Code: "CONTRACT", OptionRoles: c.OptionRoles}
		role, err := materialBindingRole(comp)
		if c.ExpectError {
			if err == nil {
				t.Errorf("binding case %q: expected error, got role %q", c.Name, role)
			}
			continue
		}
		if err != nil {
			t.Errorf("binding case %q: unexpected error: %v", c.Name, err)
			continue
		}
		if role != c.ExpectRole {
			t.Errorf("binding case %q: role = %q, want %q", c.Name, role, c.ExpectRole)
		}
	}
}

// ─── Engine negatives (parity with TS materialRoleBinding.test.ts) ────────────

// singleComponentFixture builds a catalog + module exposing exactly one test
// component instance through a dedicated structure.
func singleComponentFixture(base domain.Catalog, comp domain.Component) (domain.Module, domain.Catalog) {
	structureID := "st-403-" + comp.Code
	withComp := base
	withComp.Components = append(append([]domain.Component{}, base.Components...), comp)
	withComp.Structures = append(append([]domain.Structure{}, base.Structures...), domain.Structure{
		ID: structureID, Code: "EST-403-" + comp.Code, Name: "Estructura " + comp.Code, Active: true,
		Components: []domain.ComponentInstance{{ComponentID: comp.ID, Quantity: 1}},
	})
	module := domain.Module{
		ID: "mod-403-" + comp.Code, Code: "MOD-403-" + comp.Code, Name: "Módulo " + comp.Code,
		WidthMm: 600, HeightMm: 720, DepthMm: 560, StructureID: structureID,
	}
	return module, withComp
}

func role403BoardComponent(id, code, name string, placement domain.ComponentPlacement, nominalT int, roles []string) domain.Component {
	return domain.Component{
		ID: id, Code: code, Name: name, Placement: placement,
		GeometryKind: "rectangular_board", ThicknessMm: nominalT,
		OptionRoles: roles, Active: true,
	}
}

var ref403Choices = map[string]string{"BODY": "mat-white16", "FRONT": "mat-oak18", "BACK": "mat-back6"}

// A board declaring a second role is rejected loudly by BOTH resolvers — the
// extra role must never look configurable while controlling nothing.
func TestResolveBom_MaterialRole_SecondRoleRejected(t *testing.T) {
	_, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()
	ambiguous := role403BoardComponent("comp-403-amb", "AMB", "Ambigua", domain.PlacementPuerta, 18, []string{"FRONT", "BODY"})
	module, catAmb := singleComponentFixture(catalog, ambiguous)

	_, err := ResolveBom(module, ref403Choices, catAmb)
	if err == nil {
		t.Fatal("ambiguous optionRoles must fail the BOM resolution")
	}
	if !strings.Contains(err.Error(), "multiple material binding roles") || !strings.Contains(err.Error(), "FRONT") || !strings.Contains(err.Error(), "BODY") {
		t.Fatalf("error must name the competing roles, got: %v", err)
	}
}

func TestResolveFurnitureLayout_MaterialRole_SecondRoleRejected(t *testing.T) {
	_, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()
	ambiguous := role403BoardComponent("comp-403-amb", "AMB", "Ambigua", domain.PlacementPuerta, 18, []string{"FRONT", "BODY"})
	module, catAmb := singleComponentFixture(catalog, ambiguous)

	layout, err := ResolveFurnitureLayout(module, catAmb, nil, ref403Choices)
	if err == nil {
		t.Fatal("ambiguous optionRoles must fail the layout resolution")
	}
	if !strings.Contains(err.Error(), "multiple material binding roles") {
		t.Fatalf("error must name the contract, got: %v", err)
	}
	if layout.Components != nil {
		t.Fatal("no geometry may be emitted alongside the ambiguity error")
	}
}

// Empty/whitespace-only role entries are rejected, not silently skipped.
func TestResolveBom_MaterialRole_EmptyRolesRejected(t *testing.T) {
	_, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()
	empty := role403BoardComponent("comp-403-empty", "VACIO", "Vacía", domain.PlacementPuerta, 18, []string{"", "  "})
	module, catEmpty := singleComponentFixture(catalog, empty)

	_, err := ResolveBom(module, ref403Choices, catEmpty)
	if err == nil || !strings.Contains(err.Error(), "no material binding role") {
		t.Fatalf("empty optionRoles must fail loudly, got: %v", err)
	}
}

// Never infer the binding from the component name: a piece NAMED "Puerta" but
// explicitly bound to BACK gets the BACK material (6 mm), not FRONT.
func TestResolveBom_MaterialRole_NoNameInference(t *testing.T) {
	_, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()
	impostor := role403BoardComponent("comp-403-impostor", "PTA-X", "Puerta", domain.PlacementPuerta, 15, []string{"BACK"})
	module, catImpostor := singleComponentFixture(catalog, impostor)

	bom, err := ResolveBom(module, ref403Choices, catImpostor)
	if err != nil {
		t.Fatalf("ResolveBom: %v", err)
	}
	part := findPartByDescription(bom.BoardParts, "Puerta")
	if part == nil {
		t.Fatalf("missing impostor part: %+v", bom.BoardParts)
	}
	if part.OptionRole != "BACK" || part.MaterialID != "mat-back6" || part.ThicknessMm != 6 {
		t.Fatalf("name must never drive the binding: got role=%s material=%s thickness=%d",
			part.OptionRole, part.MaterialID, part.ThicknessMm)
	}
}

// Never infer the binding from placement: a door-slot piece explicitly bound
// to BODY gets the BODY material (16 mm), not FRONT.
func TestResolveFurnitureLayout_MaterialRole_NoPlacementInference(t *testing.T) {
	_, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()
	bodyDoor := role403BoardComponent("comp-403-bodydoor", "PTA-B", "Puerta Cuerpo", domain.PlacementPuerta, 15, []string{"BODY"})
	module, catBodyDoor := singleComponentFixture(catalog, bodyDoor)

	layout, err := ResolveFurnitureLayout(module, catBodyDoor, nil, ref403Choices)
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}
	door := findComponentByID(layout.Components, "puerta")
	if door == nil {
		t.Fatalf("missing puerta component: %+v", layout.Components)
	}
	if door.OptionRole != "BODY" || door.MaterialID != "mat-white16" || door.ThicknessMm != 16 {
		t.Fatalf("placement must never drive the binding: got role=%s material=%s thickness=%d",
			door.OptionRole, door.MaterialID, door.ThicknessMm)
	}
}

// Legacy alias roles follow the explicit FRENTE precedence through the
// engine: PUERTA without its own choice inherits FRENTE's material (18 mm);
// a direct PUERTA choice wins over the alias.
func TestResolveBom_MaterialRole_LegacyAliasPrecedence(t *testing.T) {
	_, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()
	legacyDoor := role403BoardComponent("comp-403-legacy", "PTA-L", "Puerta Legacy", domain.PlacementPuerta, 15, []string{"PUERTA"})
	module, catLegacy := singleComponentFixture(catalog, legacyDoor)
	legacyChoices := map[string]string{"BODY": "mat-white16", "FRENTE": "mat-oak18", "BACK": "mat-back6"}

	inherited, err := ResolveBom(module, legacyChoices, catLegacy)
	if err != nil {
		t.Fatalf("ResolveBom (inherited): %v", err)
	}
	part := findPartByDescription(inherited.BoardParts, "Puerta Legacy")
	if part == nil {
		t.Fatalf("missing legacy part: %+v", inherited.BoardParts)
	}
	if part.OptionRole != "PUERTA" || part.MaterialID != "mat-oak18" || part.ThicknessMm != 18 {
		t.Fatalf("PUERTA must inherit FRENTE (18 mm oak), got role=%s material=%s thickness=%d",
			part.OptionRole, part.MaterialID, part.ThicknessMm)
	}

	direct, err := ResolveBom(module, map[string]string{
		"BODY": "mat-white16", "FRENTE": "mat-oak18", "BACK": "mat-back6", "PUERTA": "mat-back6",
	}, catLegacy)
	if err != nil {
		t.Fatalf("ResolveBom (direct): %v", err)
	}
	part = findPartByDescription(direct.BoardParts, "Puerta Legacy")
	if part.MaterialID != "mat-back6" || part.ThicknessMm != 6 {
		t.Fatalf("direct PUERTA choice must beat the alias, got material=%s thickness=%d",
			part.MaterialID, part.ThicknessMm)
	}
}

// The layout resolver applies the same alias table (TS↔Go parity of the whole
// table is enforced by the shared contract above).
func TestResolveFurnitureLayout_MaterialRole_LegacyAliasPrecedence(t *testing.T) {
	_, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()
	legacyDoor := role403BoardComponent("comp-403-legacy", "PTA-L", "Puerta Legacy", domain.PlacementPuerta, 15, []string{"PUERTA"})
	module, catLegacy := singleComponentFixture(catalog, legacyDoor)

	layout, err := ResolveFurnitureLayout(module, catLegacy, nil, map[string]string{"FRENTE": "mat-oak18"})
	if err != nil {
		t.Fatalf("resolve layout: %v", err)
	}
	door := findComponentByID(layout.Components, "puerta")
	if door == nil {
		t.Fatalf("missing puerta component: %+v", layout.Components)
	}
	if door.ThicknessMm != 18 || door.MaterialID != "mat-oak18" {
		t.Fatalf("layout PUERTA must inherit FRENTE (18 mm oak), got thickness=%d material=%s",
			door.ThicknessMm, door.MaterialID)
	}
}

// One-to-many + agregado parity: a normal door and three agregado drawer
// fronts, all explicitly bound to FRONT, follow the SAME FRONT choice.
func TestResolveBom_MaterialRole_DoorAndAgregadoFrontsShareFront(t *testing.T) {
	module, catalog := materialAwareCabinetCatalog()
	catalog.Materials = materialAwareMaterials()
	// Keep the module door AND add three agregado drawer fronts (the 402
	// fixture removed the door; here both coexist).
	catalog.Structures[0].Agregados = []domain.ModuleAgregadoInstance{{
		ID: "agr-403-inst", AgregadoID: "agr-ma-drawer", Quantity: 3, LayoutDirection: "vertical",
	}}
	catalog.Agregados = []domain.Agregado{{
		ID: "agr-ma-drawer", Code: "CAJON", Name: "Cajón", Active: true,
		Components: []domain.ComponentInstance{{ComponentID: "comp-ma-dfront", Quantity: 1}},
	}}

	bom, err := ResolveBom(module, ref403Choices, catalog)
	if err != nil {
		t.Fatalf("ResolveBom: %v", err)
	}
	doors, fronts := 0, 0
	for _, part := range bom.BoardParts {
		switch part.Description {
		case "Puerta":
			doors++
		case "Frente Cajón":
			fronts++
		}
		if part.Description != "Puerta" && part.Description != "Frente Cajón" {
			continue
		}
		if part.OptionRole != "FRONT" || part.MaterialID != "mat-oak18" || part.ThicknessMm != 18 {
			t.Errorf("FRONT piece %q must follow the FRONT choice (role=%s material=%s thickness=%d)",
				part.Description, part.OptionRole, part.MaterialID, part.ThicknessMm)
		}
	}
	if doors != 1 || fronts != 3 {
		t.Fatalf("expected 1 door + 3 agregado drawer fronts, got %d/%d", doors, fronts)
	}
}

// ResolveMaterial (legacy flat board parts) applies the same explicit alias
// precedence — a ZOCLO part inherits the FRENTE choice when it has none.
func TestResolveMaterial_MaterialRole_ZocloInheritsFrente(t *testing.T) {
	part := domain.BoardPart{
		ID: "zp1", Code: "ZOCLO-L", Description: "Zócalo", Quantity: 1,
		LengthMm: 600, WidthMm: 100, OptionRole: "ZOCLO",
	}
	material, err := ResolveMaterial(part, map[string]string{"FRENTE": "mat-oak18"}, materialAwareMaterials())
	if err != nil {
		t.Fatalf("ResolveMaterial: %v", err)
	}
	if material.ID != "mat-oak18" || material.ThicknessMm != 18 {
		t.Fatalf("ZOCLO part must inherit the FRENTE choice, got %+v", material)
	}
}
