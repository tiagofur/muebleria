package api

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestInvalidCatalogDefinitionCorpusRejectsUnknownFields(t *testing.T) {
	raw, err := os.ReadFile("../../../contracts/furnitureParameterDefinitions.invalid.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Cases []struct {
			ID                string `json:"id"`
			RawDefinitionJSON string `json:"rawDefinitionJson"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &corpus); err != nil {
		t.Fatal(err)
	}
	found := 0
	for _, testCase := range corpus.Cases {
		if testCase.RawDefinitionJSON == "" {
			continue
		}
		found++
		t.Run(testCase.ID, func(t *testing.T) {
			decoder := json.NewDecoder(bytes.NewReader([]byte(testCase.RawDefinitionJSON)))
			decoder.DisallowUnknownFields()
			var definition workshopFurnitureDefinition
			if err := decoder.Decode(&definition); err == nil {
				t.Fatal("unknown catalog definition field was accepted")
			}
		})
	}
	if found == 0 {
		t.Fatal("invalid corpus carries no catalog definition cases")
	}
}

func numberPtrValue(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

func TestBuildWorkshopCatalogPreservesModuleIdentity(t *testing.T) {
	module := domain.Module{
		ID: "11111111-1111-1111-1111-111111111111", Code: "MOD-BASE-600", Name: "Base Cocina 600",
		WidthMm: 600, HeightMm: 720, DepthMm: 560, CategoryID: "cat-1", Notes: "notas del taller",
		ImageURL: "/api/media/abc123.png",
	}

	catalog := buildWorkshopFurnitureCatalog([]domain.Module{module}, []domain.ModuleCategory{{ID: "cat-1", Name: "Cocinas"}}, nil, domain.Catalog{})

	def, ok := catalog.Definitions[module.ID]
	if !ok {
		t.Fatalf("definition not keyed by module id %q (keys: %v)", module.ID, catalog.Definitions)
	}
	if def.FurnitureDefinitionID != module.ID || def.Code != module.Code || def.Name != module.Name ||
		def.Category != "Cocinas" || def.Description != "notas del taller" || def.Version != workshopFurnitureVersion {
		t.Fatalf("module identity not preserved verbatim: %+v", def)
	}
	if def.ImageURL != "/api/media/abc123.png" {
		t.Fatalf("module image path not preserved: %q", def.ImageURL)
	}
}

func TestBuildWorkshopCatalogDerivesRangesFromPresets(t *testing.T) {
	module := domain.Module{
		ID: "m1", Code: "M1", Name: "Módulo", WidthMm: 600, HeightMm: 720, DepthMm: 500,
		Presets: []domain.DimensionPreset{
			{ID: "p1", WidthMm: 450, HeightMm: 720, DepthMm: 500},
			{ID: "p2", WidthMm: 900, HeightMm: 720, DepthMm: 350},
		},
	}

	catalog := buildWorkshopFurnitureCatalog([]domain.Module{module}, nil, nil, domain.Catalog{})
	def := catalog.Definitions["m1"]

	width := parameterByName(def.Parameters, "widthMm")
	if width == nil || width.DefaultValue != float64(600) || numberPtrValue(width.Min) != 450 || numberPtrValue(width.Max) != 900 {
		t.Fatalf("widthMm must span presets + module default: %+v", width)
	}
	depth := parameterByName(def.Parameters, "depthMm")
	if depth == nil || depth.DefaultValue != float64(500) || numberPtrValue(depth.Min) != 350 || numberPtrValue(depth.Max) != 500 {
		t.Fatalf("depthMm must span preset values: %+v", depth)
	}
}

func TestBuildWorkshopCatalogBandWithoutPresets(t *testing.T) {
	module := domain.Module{ID: "m1", Code: "M1", Name: "Módulo", WidthMm: 800, HeightMm: 2000, DepthMm: 60}

	catalog := buildWorkshopFurnitureCatalog([]domain.Module{module}, nil, nil, domain.Catalog{})
	def := catalog.Definitions["m1"]

	for _, name := range []string{"widthMm", "heightMm", "depthMm"} {
		p := parameterByName(def.Parameters, name)
		if p == nil {
			t.Fatalf("missing parameter %s", name)
		}
		defaultValue, ok := p.DefaultValue.(float64)
		if !ok || numberPtrValue(p.Min) > defaultValue || numberPtrValue(p.Max) < defaultValue {
			t.Fatalf("%s default %v outside editable range [%v, %v]", name, p.DefaultValue, p.Min, p.Max)
		}
	}
	// Small dimensions must not get a floor above their own default.
	depth := parameterByName(def.Parameters, "depthMm")
	if numberPtrValue(depth.Min) != 50 || numberPtrValue(depth.Max) != 120 {
		t.Fatalf("depthMm band for 60mm default = [%v, %v], want [50, 120]", depth.Min, depth.Max)
	}
}

func TestBuildWorkshopCatalogModuleWithoutDimensions(t *testing.T) {
	// No external dims, no presets: still a definition (insertable via builder
	// fallbacks), just without authoring dimension parameters.
	catalog := buildWorkshopFurnitureCatalog([]domain.Module{{ID: "m1", Code: "M1", Name: "Sin cotas"}}, nil, nil, domain.Catalog{})

	def := catalog.Definitions["m1"]
	if len(def.Parameters) != 0 {
		t.Fatalf("undimensioned module must carry no dim parameters, got %d", len(def.Parameters))
	}
	if def.Category != workshopUncategorizedLabel {
		t.Fatalf("category = %q, want %q", def.Category, workshopUncategorizedLabel)
	}
}

func TestBuildWorkshopCatalogDefaultsFromPresetsWhenModuleHasNoDims(t *testing.T) {
	module := domain.Module{
		ID: "m1", Code: "M1", Name: "Módulo",
		Presets: []domain.DimensionPreset{
			{ID: "p1", Name: "Chico", WidthMm: 400, HeightMm: 700, DepthMm: 450},
			{ID: "p2", Name: "Grande", WidthMm: 800, HeightMm: 700, DepthMm: 450},
		},
	}

	catalog := buildWorkshopFurnitureCatalog([]domain.Module{module}, nil, nil, domain.Catalog{})
	width := parameterByName(catalog.Definitions["m1"].Parameters, "widthMm")
	if width == nil || width.DefaultValue != float64(400) || numberPtrValue(width.Min) != 400 || numberPtrValue(width.Max) != 800 {
		t.Fatalf("widthMm must default to smallest preset: %+v", width)
	}
}

func TestBuildWorkshopCatalogMapsPresetsVerbatim(t *testing.T) {
	module := domain.Module{
		ID: "m1", Code: "M1", Name: "Módulo", WidthMm: 600, HeightMm: 720, DepthMm: 500, CategoryID: "cat-towers",
		Presets: []domain.DimensionPreset{
			{ID: "p1", Name: "Estándar", WidthMm: 600, HeightMm: 720, DepthMm: 500},
			{ID: "p2", WidthMm: 800, HeightMm: 720, DepthMm: 500},
		},
	}

	catalog := buildWorkshopFurnitureCatalog([]domain.Module{module}, []domain.ModuleCategory{{ID: "cat-towers", Name: "Torres"}}, nil, domain.Catalog{})

	if len(catalog.Presets) != 2 {
		t.Fatalf("expected both module presets, got %d", len(catalog.Presets))
	}
	named := catalog.Presets[0]
	if named.PresetID != "p1" || named.Name != "Estándar" || named.Category != "Torres" ||
		named.FurnitureDefinitionID != "m1" || named.Parameters["widthMm"] != 600 {
		t.Fatalf("named preset not mapped verbatim: %+v", named)
	}
	unnamed := catalog.Presets[1]
	if unnamed.Name != "800 × 720 × 500 mm" {
		t.Fatalf("unnamed preset must fall back to its measures, got %q", unnamed.Name)
	}
}

func TestWorkshopCatalogRevisionIsContentAddressed(t *testing.T) {
	mk := func(width int) workshopFurnitureCatalog {
		return buildWorkshopFurnitureCatalog([]domain.Module{
			{ID: "m1", Code: "M1", Name: "Módulo", WidthMm: width, HeightMm: 720, DepthMm: 500},
		}, nil, nil, domain.Catalog{})
	}

	if workshopCatalogRevisionID(mk(600)) != workshopCatalogRevisionID(mk(600)) {
		t.Fatal("revision must be stable for identical content")
	}
	if workshopCatalogRevisionID(mk(600)) == workshopCatalogRevisionID(mk(900)) {
		t.Fatal("revision must change when the catalog content changes")
	}

	catA := buildWorkshopFurnitureCatalog(nil, nil, []domain.MaterialCategory{
		{ID: "c1", Name: "Maderas", SortOrder: 1},
	}, domain.Catalog{})
	catB := buildWorkshopFurnitureCatalog(nil, nil, []domain.MaterialCategory{
		{ID: "c1", Name: "Maderas Macizas", SortOrder: 1},
	}, domain.Catalog{})

	if workshopCatalogRevisionID(catA) == workshopCatalogRevisionID(catB) {
		t.Fatal("revision must change when materialCategories change")
	}
}

func TestWorkshopCatalogRevisionCoversParameterRulesAndDefaults(t *testing.T) {
	parameter := func(max, defaultValue float64) domain.FurnitureParameterDefinition {
		return domain.FurnitureParameterDefinition{
			Name: "shelfCount", Label: "Shelf count", Type: domain.FurnitureParameterTypeNumber,
			DefaultValue: defaultValue, Required: true, Unit: domain.FurnitureParameterUnitCount,
			Category: domain.FurnitureParameterCategoryMetadata,
			Min:      float64Ptr(0), Max: float64Ptr(max), Step: float64Ptr(1), Integer: true,
		}
	}
	module := func(rule domain.FurnitureParameterDefinition) domain.Module {
		return domain.Module{ID: "m1", Code: "M1", Name: "Module", WidthMm: 600, HeightMm: 720, DepthMm: 500, ParameterDefinitions: []domain.FurnitureParameterDefinition{rule}}
	}
	base := buildWorkshopFurnitureCatalog([]domain.Module{module(parameter(5, 1))}, nil, nil, domain.Catalog{})
	maxChanged := buildWorkshopFurnitureCatalog([]domain.Module{module(parameter(6, 1))}, nil, nil, domain.Catalog{})
	defaultChanged := buildWorkshopFurnitureCatalog([]domain.Module{module(parameter(5, 2))}, nil, nil, domain.Catalog{})

	if workshopCatalogRevisionID(base) == workshopCatalogRevisionID(maxChanged) || workshopCatalogRevisionID(base) == workshopCatalogRevisionID(defaultChanged) {
		t.Fatal("changing only a parameter rule/default must invalidate the catalog pin")
	}
	definition := base.Definitions["m1"]
	if definition.SchemaRevision != 1 || definition.DefinitionHash == "" {
		t.Fatalf("definition is not versioned: %+v", definition)
	}
}

func TestWorkshopCatalogRevisionCoversConditionBinding(t *testing.T) {
	module := func(target string) domain.Module {
		return domain.Module{ID: "m1", Code: "M1", Name: "Module", Components: []domain.ComponentInstance{{ComponentID: "comp-a", Quantity: 1}, {ComponentID: "comp-b", Quantity: 1}}, ParameterDefinitions: []domain.FurnitureParameterDefinition{{Name: "visible", Label: "Visible", Type: domain.FurnitureParameterTypeBoolean, DefaultValue: true, Required: true, Category: domain.FurnitureParameterCategoryConfiguration, Binding: &domain.FurnitureParameterBinding{Version: 1, Kind: domain.FurnitureParameterBindingComponentCondition, ComponentID: target}}}}
	}
	composition := domain.Catalog{Components: []domain.Component{{ID: "comp-a", Code: "A", Name: "A", Active: true}, {ID: "comp-b", Code: "B", Name: "B", Active: true}}}
	a, err := buildWorkshopFurnitureCatalogValidated([]domain.Module{module("comp-a")}, nil, nil, composition)
	if err != nil {
		t.Fatal(err)
	}
	b, err := buildWorkshopFurnitureCatalogValidated([]domain.Module{module("comp-b")}, nil, nil, composition)
	if err != nil {
		t.Fatal(err)
	}
	if a.Definitions["m1"].DefinitionHash == b.Definitions["m1"].DefinitionHash || workshopCatalogRevisionID(a) == workshopCatalogRevisionID(b) {
		t.Fatal("condition binding target must invalidate definition hash and catalog revision")
	}
}

func TestWorkshopCatalogRejectsParametersWithoutAuthoritativeConsumers(t *testing.T) {
	module := domain.Module{ID: "m1", Code: "M1", Name: "Module", ParameterDefinitions: []domain.FurnitureParameterDefinition{{Name: "shelfCount", Label: "Shelf count", Type: domain.FurnitureParameterTypeNumber, DefaultValue: float64(1), Required: true, Integer: true, Unit: domain.FurnitureParameterUnitCount, Category: domain.FurnitureParameterCategoryConfiguration}}}
	_, err := buildWorkshopFurnitureCatalogValidated([]domain.Module{module}, nil, nil, domain.Catalog{})
	if _, ok := furnitureParameterDefinitionsError(err); !ok {
		t.Fatalf("expected typed definition error, got %v", err)
	}
	module.ParameterDefinitions[0].Binding = &domain.FurnitureParameterBinding{Version: 1, Kind: domain.FurnitureParameterBindingComponentQuantity, ComponentID: "missing"}
	_, err = buildWorkshopFurnitureCatalogValidated([]domain.Module{module}, nil, nil, domain.Catalog{})
	if definitionErr, ok := furnitureParameterDefinitionsError(err); !ok || len(definitionErr.Issues) == 0 || definitionErr.Issues[0].Field != "binding.componentId" {
		t.Fatalf("expected missing consumer issue, got %v", err)
	}
}

func TestWorkshopCatalogRejectsAmbiguousBindingTargets(t *testing.T) {
	parameter := domain.FurnitureParameterDefinition{Name: "count", Label: "Count", Type: domain.FurnitureParameterTypeNumber, DefaultValue: float64(1), Required: true, Integer: true, Unit: domain.FurnitureParameterUnitCount, Category: domain.FurnitureParameterCategoryConfiguration, Binding: &domain.FurnitureParameterBinding{Version: 1, Kind: domain.FurnitureParameterBindingComponentQuantity, ComponentID: "comp-shared"}}
	module := domain.Module{ID: "m1", Code: "M1", Name: "Module", ParameterDefinitions: []domain.FurnitureParameterDefinition{parameter}, Components: []domain.ComponentInstance{{ComponentID: "comp-shared", Quantity: 1}, {ComponentID: "comp-shared", Quantity: 1}}}
	_, err := buildWorkshopFurnitureCatalogValidated([]domain.Module{module}, nil, nil, domain.Catalog{})
	if definitionErr, ok := furnitureParameterDefinitionsError(err); !ok || len(definitionErr.Issues) == 0 || definitionErr.Issues[0].Field != "binding.componentId" {
		t.Fatalf("duplicate direct target accepted: %v", err)
	}
	parameter.Binding.Relationship = &domain.FurnitureParameterRelationshipBinding{Kind: "shelf-support", SourceRole: "shelf-edge", Targets: []domain.FurnitureParameterRelationshipTarget{{ComponentID: "comp-side", Role: "inside-face"}}}
	module.ParameterDefinitions = []domain.FurnitureParameterDefinition{parameter}
	module.Components = []domain.ComponentInstance{{ComponentID: "comp-shared", Quantity: 1}}
	module.StructureID = "st"
	composition := domain.Catalog{Structures: []domain.Structure{{ID: "st", Components: []domain.ComponentInstance{{ComponentID: "comp-side", Quantity: 2}}}}}
	_, err = buildWorkshopFurnitureCatalogValidated([]domain.Module{module}, nil, nil, composition)
	if definitionErr, ok := furnitureParameterDefinitionsError(err); !ok || len(definitionErr.Issues) == 0 || definitionErr.Issues[0].Field != "binding.relationship.targets" {
		t.Fatalf("ambiguous relationship target accepted: %v", err)
	}
}

func TestWorkshopCatalogPreservesAuthoringSortOrder(t *testing.T) {
	module := domain.Module{ID: "m1", Code: "M1", Name: "Module", ParameterDefinitions: []domain.FurnitureParameterDefinition{
		{Name: "zeta", Label: "Zeta", SortOrder: 20, Type: domain.FurnitureParameterTypeString, Category: domain.FurnitureParameterCategoryMetadata, MaxLength: catalogIntPtr(80)},
		{Name: "alpha", Label: "Alpha", SortOrder: 10, Type: domain.FurnitureParameterTypeString, Category: domain.FurnitureParameterCategoryMetadata, MaxLength: catalogIntPtr(80)},
	}}
	catalog, err := buildWorkshopFurnitureCatalogValidated([]domain.Module{module}, nil, nil, domain.Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	parameters := catalog.Definitions["m1"].Parameters
	if len(parameters) != 2 || parameters[0].Name != "alpha" || parameters[1].Name != "zeta" {
		t.Fatalf("sort order lost: %+v", parameters)
	}
}

func catalogIntPtr(value int) *int { return &value }

func TestBuildWorkshopCatalogCategoriesAreHierarchical(t *testing.T) {
	categories := []domain.ModuleCategory{
		{ID: "cat-kitchens", Name: "Cocinas"},
		{ID: "cat-lowers", Name: "Inferiores", ParentID: "cat-kitchens"},
		{ID: "cat-doors", Name: "Puertas", ParentID: "cat-lowers"},
		{ID: "cat-drawers", Name: "Cajoneros", ParentID: "cat-lowers"},
	}
	modules := []domain.Module{
		{ID: "m1", Code: "M1", Name: "Puerta 600", CategoryID: "cat-doors"},
		{ID: "m2", Code: "M2", Name: "Cajonera", CategoryID: "cat-drawers"},
		{ID: "m3", Code: "M3", Name: "Sin clase"},
	}

	catalog := buildWorkshopFurnitureCatalog(modules, categories, nil, domain.Catalog{})

	if len(catalog.Categories) != 4 {
		t.Fatalf("envelope must carry the whole category tree, got %d", len(catalog.Categories))
	}
	if got := catalog.Definitions["m1"].Category; got != "Cocinas › Inferiores › Puertas" {
		t.Fatalf("m1 category path = %q", got)
	}
	if got := catalog.Definitions["m2"].Category; got != "Cocinas › Inferiores › Cajoneros" {
		t.Fatalf("m2 category path = %q", got)
	}
	if got := catalog.Definitions["m3"].Category; got != workshopUncategorizedLabel {
		t.Fatalf("uncategorized module category = %q", got)
	}
	if catalog.Definitions["m1"].CategoryID != "cat-doors" {
		t.Fatalf("categoryId must be preserved for subtree filtering, got %q", catalog.Definitions["m1"].CategoryID)
	}
}

func TestBuildWorkshopCatalogMaterialCategoriesAndVisualProperties(t *testing.T) {
	materialCats := []domain.MaterialCategory{
		{ID: "matcat-wood", Name: "Maderas", SortOrder: 1},
		{ID: "matcat-light", Name: "Claras", ParentID: "matcat-wood", SortOrder: 1},
	}
	roughness := 0.65
	metalness := 0.1
	clearcoat := 0.05
	boards := []domain.MaterialBoard{
		{
			ID:                         "mat-1",
			Code:                       "TAB-ARA-NOU",
			Name:                       "Arauco Nougat",
			Manufacturer:               "Arauco",
			CategoryID:                 "matcat-light",
			PreviewColor:               "#8B5A2B",
			ImageURL:                   "/api/media/nougat_thumb.jpg",
			PreviewTextureURL:          "/api/media/nougat_pbr.jpg",
			PreviewTextureTileWidthMm:  600.0,
			PreviewTextureTileLengthMm: 600.0,
			PreviewRoughness:           &roughness,
			PreviewMetalness:           &metalness,
			PreviewClearcoat:           &clearcoat,
			ThicknessMm:                18,
			GrainDefault:               true,
			Active:                     true,
		},
		{
			ID:           "mat-inactive",
			Code:         "TAB-INACTIVE",
			Name:         "Inactive Material",
			Manufacturer: "Faplac",
			Active:       false,
		},
	}

	catalog := buildWorkshopFurnitureCatalog(nil, nil, materialCats, domain.Catalog{Materials: boards})

	if len(catalog.MaterialCategories) != 2 {
		t.Fatalf("expected 2 material categories, got %d", len(catalog.MaterialCategories))
	}
	if catalog.MaterialCategories[0].Name != "Maderas" || catalog.MaterialCategories[1].ParentID != "matcat-wood" {
		t.Fatalf("material categories hierarchy mismatch: %+v", catalog.MaterialCategories)
	}

	if len(catalog.Materials) != 1 {
		t.Fatalf("expected 1 active material, got %d", len(catalog.Materials))
	}
	m := catalog.Materials[0]
	if m.MaterialID != "mat-1" || m.Manufacturer != "Arauco" || m.CategoryID != "matcat-light" {
		t.Fatalf("material identity/category mismatch: %+v", m)
	}
	if m.PreviewTextureURL != "/api/media/nougat_pbr.jpg" || m.ImageURL != "/api/media/nougat_thumb.jpg" {
		t.Fatalf("texture url vs image url mismatch: %+v", m)
	}
	if m.PreviewTextureTileWidthMm != 600.0 || m.PreviewTextureTileLengthMm != 600.0 {
		t.Fatalf("texture tile size mismatch: %+v", m)
	}
	if m.PreviewRoughness == nil || *m.PreviewRoughness != 0.65 {
		t.Fatalf("roughness mismatch: %+v", m.PreviewRoughness)
	}
	if m.ThicknessMm != 18 || !m.Grain {
		t.Fatalf("thickness or grain mismatch: %+v", m)
	}
}

func TestCategoryPathNamesSurvivesCycles(t *testing.T) {
	byID := map[string]domain.ModuleCategory{
		"a": {ID: "a", Name: "A", ParentID: "b"},
		"b": {ID: "b", Name: "B", ParentID: "a"},
	}

	path := categoryPathNames("a", byID)

	if len(path) != 2 {
		t.Fatalf("cycle must terminate with the nodes seen once, got %v", path)
	}
}
