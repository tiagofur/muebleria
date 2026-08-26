package api

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

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
	if width == nil || width.DefaultValue != 600 || width.Min != 450 || width.Max != 900 {
		t.Fatalf("widthMm must span presets + module default: %+v", width)
	}
	depth := parameterByName(def.Parameters, "depthMm")
	if depth == nil || depth.DefaultValue != 500 || depth.Min != 350 || depth.Max != 500 {
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
		if p.Min > p.DefaultValue || p.Max < p.DefaultValue {
			t.Fatalf("%s default %d outside editable range [%d, %d]", name, p.DefaultValue, p.Min, p.Max)
		}
	}
	// Small dimensions must not get a floor above their own default.
	depth := parameterByName(def.Parameters, "depthMm")
	if depth.Min != 50 || depth.Max != 120 {
		t.Fatalf("depthMm band for 60mm default = [%d, %d], want [50, 120]", depth.Min, depth.Max)
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
	if width == nil || width.DefaultValue != 400 || width.Min != 400 || width.Max != 800 {
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
}

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
