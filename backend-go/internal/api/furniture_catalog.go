package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// Workshop furniture catalog projection for the SketchUp extension.
//
// This is the single adapter between the workshop's real furniture (domain
// Module rows, the same entities the React app edits under /catalog/modules)
// and the shared camelCase furniture contract consumed by the extension
// (schema mirror: contracts/pilotFurnitureCatalog.json shape — schemaId,
// revisionId, definitions map, presets list). Translation rules live here,
// server-side; the webview never learns the backend's internal module shape.
const (
	workshopFurnitureSchemaID = "granete.workshopFurnitureCatalog.v1"
	workshopFurnitureVersion  = "1.0.0"
	workshopDimParamStepMm    = 10
	workshopMinDimMm          = 50
	// workshopUncategorizedLabel buckets modules the workshop hasn't filed
	// under a catalog category yet.
	workshopUncategorizedLabel = "Sin categoría"
	workshopDimensionParamKind = "dimension"
)

type workshopFurnitureParameter struct {
	Name         string `json:"name"`
	Label        string `json:"label"`
	Type         string `json:"type"`
	DefaultValue int    `json:"defaultValue"`
	Unit         string `json:"unit"`
	Min          int    `json:"min"`
	Max          int    `json:"max"`
	Step         int    `json:"step"`
	Category     string `json:"category"`
}

type workshopFurnitureDefinition struct {
	FurnitureDefinitionID string `json:"furnitureDefinitionId"`
	Code                  string `json:"code"`
	Name                  string `json:"name"`
	// Category is the module's full catalog path (root › … › leaf) for
	// display and search; CategoryID anchors subtree filtering.
	Category    string `json:"category"`
	CategoryID  string `json:"categoryId,omitempty"`
	Version     string `json:"version"`
	Description string `json:"description,omitempty"`
	// ImageURL is the module's stored media path (server-relative, e.g.
	// /api/media/<hash>.png). Clients resolve it against the workshop origin
	// and append their media token (GET /api/media/{name} is auth-protected).
	ImageURL   string                       `json:"imageUrl,omitempty"`
	Parameters []workshopFurnitureParameter `json:"parameters"`
	// EstimatedPartCount / EstimatedHardwareCount are the resolved composition
	// sizes at the definition's default dimensions (boards / visible hardware).
	// They back the "piezas" summary in clients (SketchUp dialog) with the real
	// composition instead of a generic guess. Zero means "not resolvable here";
	// the layout endpoint surfaces the concrete error on insertion.
	EstimatedPartCount int `json:"estimatedPartCount,omitempty"`
	// EstimatedHardwareCount counts visible hardware placements (not cost-only
	// lines, which render nothing).
	EstimatedHardwareCount int `json:"estimatedHardwareCount,omitempty"`
	// MaterialRoles lists the board option roles present in the composition
	// (role == option group code) with the workshop's curated material options,
	// so clients can render per-role material selectors.
	MaterialRoles []workshopMaterialRole `json:"materialRoles,omitempty"`
}

// workshopMaterialRole is one board role of a definition's composition with
// the material options the workshop curated for it. When no option group is
// defined for the role, OptionIDs falls back to every active material.
type workshopMaterialRole struct {
	Role      string   `json:"role"`
	Label     string   `json:"label"`
	OptionIDs []string `json:"optionIds"`
}

// workshopMaterial is a board of the workshop catalog for client material
// selectors (visual & PBR fields only — no pricing).
type workshopMaterial struct {
	MaterialID                 string   `json:"materialId"`
	Code                       string   `json:"code"`
	Name                       string   `json:"name"`
	Manufacturer               string   `json:"manufacturer,omitempty"`
	CategoryID                 string   `json:"categoryId,omitempty"`
	PreviewColor               string   `json:"previewColor,omitempty"`
	ImageURL                   string   `json:"imageUrl,omitempty"`
	PreviewTextureURL          string   `json:"previewTextureUrl,omitempty"`
	PreviewTextureTileWidthMm  float64  `json:"previewTextureTileWidthMm,omitempty"`
	PreviewTextureTileLengthMm float64  `json:"previewTextureTileLengthMm,omitempty"`
	PreviewRoughness           *float64 `json:"previewRoughness,omitempty"`
	PreviewMetalness           *float64 `json:"previewMetalness,omitempty"`
	PreviewClearcoat           *float64 `json:"previewClearcoat,omitempty"`
	ThicknessMm                int      `json:"thicknessMm"`
	Grain                      bool     `json:"grain"`
}

// workshopMaterialCategory exposes the workshop's board category tree (up to
// 3 levels) for hierarchical material filtering (Miller Columns / CategoryNode).
type workshopMaterialCategory struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ParentID  string `json:"parentId,omitempty"`
	SortOrder int    `json:"sortOrder"`
}

// workshopFurnitureCategory exposes the workshop's module category tree
// (up to 3 levels, e.g. Cocinas › Inferiores › Puertas) so clients can
// render cascading filters with subtree semantics.
type workshopFurnitureCategory struct {
	CategoryID string `json:"categoryId"`
	Name       string `json:"name"`
	ParentID   string `json:"parentId,omitempty"`
	SortOrder  int    `json:"sortOrder"`
}

type workshopFurniturePreset struct {
	PresetID              string         `json:"presetId"`
	Name                  string         `json:"name"`
	Category              string         `json:"category"`
	FurnitureDefinitionID string         `json:"furnitureDefinitionId"`
	Parameters            map[string]int `json:"parameters"`
}

type workshopFurnitureCatalog struct {
	SchemaID           string                                 `json:"schemaId"`
	RevisionID         string                                 `json:"revisionId"`
	Categories         []workshopFurnitureCategory            `json:"categories"`
	MaterialCategories []workshopMaterialCategory            `json:"materialCategories"`
	Definitions        map[string]workshopFurnitureDefinition `json:"definitions"`
	Presets            []workshopFurniturePreset              `json:"presets"`
	// Materials carries the workshop's active boards so clients can populate
	// per-role material selectors without a second request.
	Materials []workshopMaterial `json:"materials"`
}

type dimensionSpec struct {
	name       string
	label      string
	fromModule func(m domain.Module) int
	fromPreset func(p domain.DimensionPreset) int
}

var workshopDimensionSpecs = []dimensionSpec{
	{"widthMm", "Ancho (mm)", func(m domain.Module) int { return m.WidthMm },
		func(p domain.DimensionPreset) int { return p.WidthMm }},
	{"heightMm", "Alto (mm)", func(m domain.Module) int { return m.HeightMm },
		func(p domain.DimensionPreset) int { return p.HeightMm }},
	{"depthMm", "Fondo (mm)", func(m domain.Module) int { return m.DepthMm },
		func(p domain.DimensionPreset) int { return p.DepthMm }},
}

// buildWorkshopFurnitureCatalog projects the workshop's modules into the
// shared furniture contract. Modules are the source of truth: definition ids
// are the module UUIDs, default dimensions and presets come verbatim from the
// rows the React app edits. The definition category is the module's full
// catalog path (root › … › leaf from module_categories; "Sin categoría" when
// unfiled) plus its CategoryID for subtree filtering; the envelope carries
// the whole category tree so clients can cascade L1/L2/L3 like the web app.
// Estimated piece counts are resolved from the module's real composition
// (composition carries structures/components/agregados/hardware). Range rules
// for the width/height/depth authoring parameters (the Module entity stores
// no min/max):
//   - with presets: min/max span every preset value plus the module default;
//   - without presets: an operational band around the default (half to double).
func buildWorkshopFurnitureCatalog(modules []domain.Module, categories []domain.ModuleCategory, materialCategories []domain.MaterialCategory, composition domain.Catalog) workshopFurnitureCatalog {
	catalog := workshopFurnitureCatalog{
		SchemaID:           workshopFurnitureSchemaID,
		Categories:         []workshopFurnitureCategory{},
		MaterialCategories: buildWorkshopMaterialCategories(materialCategories),
		Definitions:        map[string]workshopFurnitureDefinition{},
		Presets:            []workshopFurniturePreset{},
		Materials:          buildWorkshopMaterials(composition.Materials),
	}

	byID := make(map[string]domain.ModuleCategory, len(categories))
	for _, c := range categories {
		byID[c.ID] = c
		catalog.Categories = append(catalog.Categories, workshopFurnitureCategory{
			CategoryID: c.ID,
			Name:       c.Name,
			ParentID:   c.ParentID,
			SortOrder:  c.SortOrder,
		})
	}

	for _, m := range modules {
		path := categoryPathNames(m.CategoryID, byID)
		category := strings.Join(path, " › ")
		if category == "" {
			category = workshopUncategorizedLabel
		}

		definition := workshopFurnitureDefinition{
			FurnitureDefinitionID: m.ID,
			Code:                  m.Code,
			Name:                  m.Name,
			Category:              category,
			CategoryID:            m.CategoryID,
			Version:               workshopFurnitureVersion,
			Description:           m.Notes,
			ImageURL:              m.ImageURL,
			Parameters:            []workshopFurnitureParameter{},
		}

		for _, spec := range workshopDimensionSpecs {
			param, ok := buildDimensionParameter(spec, m)
			if ok {
				definition.Parameters = append(definition.Parameters, param)
			}
		}

		// Real composition sizes at default dimensions; a module whose
		// composition cannot resolve here keeps zero counts (the layout
		// endpoint reports the concrete error when the user inserts it).
		if layout, err := engine.ResolveFurnitureLayout(m, composition, nil, nil); err == nil {
			definition.EstimatedPartCount = len(layout.Components)
			definition.EstimatedHardwareCount = len(layout.Hardware)
			definition.MaterialRoles = buildMaterialRoles(layout, composition)
		}

		catalog.Definitions[m.ID] = definition

		for _, p := range m.Presets {
			catalog.Presets = append(catalog.Presets, buildWorkshopPreset(m, p, category))
		}
	}
	return catalog
}

// buildWorkshopMaterialCategories projects the workshop's board category tree.
func buildWorkshopMaterialCategories(categories []domain.MaterialCategory) []workshopMaterialCategory {
	out := make([]workshopMaterialCategory, 0, len(categories))
	for _, c := range categories {
		out = append(out, workshopMaterialCategory{
			ID:        c.ID,
			Name:      c.Name,
			ParentID:  c.ParentID,
			SortOrder: c.SortOrder,
		})
	}
	return out
}

// buildWorkshopMaterials projects the workshop's active boards for client
// material selectors (visual & PBR fields only).
func buildWorkshopMaterials(materials []domain.MaterialBoard) []workshopMaterial {
	out := make([]workshopMaterial, 0, len(materials))
	for _, m := range materials {
		if !m.Active {
			continue
		}
		out = append(out, workshopMaterial{
			MaterialID:                 m.ID,
			Code:                       m.Code,
			Name:                       m.Name,
			Manufacturer:               m.Manufacturer,
			CategoryID:                 m.CategoryID,
			PreviewColor:               m.PreviewColor,
			ImageURL:                   m.ImageURL,
			PreviewTextureURL:          m.PreviewTextureURL,
			PreviewTextureTileWidthMm:  m.PreviewTextureTileWidthMm,
			PreviewTextureTileLengthMm: m.PreviewTextureTileLengthMm,
			PreviewRoughness:           m.PreviewRoughness,
			PreviewMetalness:           m.PreviewMetalness,
			PreviewClearcoat:           m.PreviewClearcoat,
			ThicknessMm:                m.ThicknessMm,
			Grain:                      m.GrainDefault,
		})
	}
	return out
}

// buildMaterialRoles derives the definition's board roles (in composition
// order) with the options the workshop curated for each. Roles are option
// group codes; a role without a curated board group offers every active
// material so the selector is never empty.
func buildMaterialRoles(layout engine.FurnitureLayout, composition domain.Catalog) []workshopMaterialRole {
	allActive := make([]string, 0)
	for _, m := range composition.Materials {
		if m.Active {
			allActive = append(allActive, m.ID)
		}
	}

	seen := map[string]bool{}
	roles := make([]workshopMaterialRole, 0)
	for _, c := range layout.Components {
		role := c.OptionRole
		if role == "" || seen[role] {
			continue
		}
		seen[role] = true

		entry := workshopMaterialRole{Role: role, Label: role, OptionIDs: allActive}
		for _, g := range composition.OptionGroups {
			if g.Code == role && g.Kind == "board" && len(g.OptionIDs) > 0 {
				entry.Label = g.Name
				entry.OptionIDs = g.OptionIDs
				break
			}
		}
		roles = append(roles, entry)
	}
	return roles
}

// buildDimensionParameter projects one dimension parameter from the module and its presets.
func buildDimensionParameter(spec dimensionSpec, m domain.Module) (workshopFurnitureParameter, bool) {
	definitionValue := spec.fromModule(m)
	candidates := []int{}
	if definitionValue > 0 {
		candidates = append(candidates, definitionValue)
	}
	for _, p := range m.Presets {
		if v := spec.fromPreset(p); v > 0 {
			candidates = append(candidates, v)
		}
	}
	if len(candidates) == 0 {
		// Module is not dimensioned yet (no external dims, no presets): the
		// definition carries no authoring parameter for this dimension.
		return workshopFurnitureParameter{}, false
	}

	defaultValue := definitionValue
	if defaultValue <= 0 {
		// Presets are ordered smallest-first by the storage layer.
		defaultValue = candidates[0]
	}

	min, max := candidates[0], candidates[0]
	for _, v := range candidates {
		if v < min {
			min = v
		}
		if v > max {
			max = v
		}
	}
	if min == max {
		min, max = operationalDimBand(defaultValue)
	}

	return workshopFurnitureParameter{
		Name:         spec.name,
		Label:        spec.label,
		Type:         "number",
		DefaultValue: defaultValue,
		Unit:         "mm",
		Min:          min,
		Max:          max,
		Step:         workshopDimParamStepMm,
		Category:     workshopDimensionParamKind,
	}, true
}

// operationalDimBand widens a single known dimension into an editable range
// when the workshop defined no presets around it.
func operationalDimBand(value int) (int, int) {
	min := value / 2
	if min < workshopMinDimMm {
		min = workshopMinDimMm
	}
	if min > value {
		min = value
	}
	max := value * 2
	if max <= value {
		max = value + workshopMinDimMm
	}
	return min, max
}

func buildWorkshopPreset(m domain.Module, p domain.DimensionPreset, category string) workshopFurniturePreset {
	name := p.Name
	if name == "" {
		name = fmt.Sprintf("%d × %d × %d mm", p.WidthMm, p.HeightMm, p.DepthMm)
	}
	parameters := map[string]int{}
	for _, spec := range workshopDimensionSpecs {
		if v := spec.fromPreset(p); v > 0 {
			parameters[spec.name] = v
		}
	}
	return workshopFurniturePreset{
		PresetID:              p.ID,
		Name:                  name,
		Category:              category,
		FurnitureDefinitionID: m.ID,
		Parameters:            parameters,
	}
}

// categoryPathNames walks the category tree root→leaf. Guarded against
// cycles and runaway depth so bad data can't hang the catalog projection.
func categoryPathNames(categoryID string, byID map[string]domain.ModuleCategory) []string {
	if strings.TrimSpace(categoryID) == "" {
		return nil
	}
	var reversed []string
	seen := map[string]bool{}
	current := categoryID
	for len(reversed) < 8 {
		if seen[current] {
			break
		}
		seen[current] = true
		node, ok := byID[current]
		if !ok {
			break
		}
		reversed = append(reversed, node.Name)
		if strings.TrimSpace(node.ParentID) == "" {
			break
		}
		current = node.ParentID
	}
	for i, j := 0, len(reversed)-1; i < j; i, j = i+1, j-1 {
		reversed[i], reversed[j] = reversed[j], reversed[i]
	}
	return reversed
}

// workshopCatalogRevisionID derives a content-addressed revision from the
// projected categories, definitions and presets, used both as the contract
// revisionId and as the HTTP ETag so clients cache per catalog content.
func workshopCatalogRevisionID(c workshopFurnitureCatalog) string {
	payload := struct {
		Categories         []workshopFurnitureCategory            `json:"categories"`
		MaterialCategories []workshopMaterialCategory             `json:"materialCategories"`
		Definitions        map[string]workshopFurnitureDefinition `json:"definitions"`
		Presets            []workshopFurniturePreset              `json:"presets"`
		Materials          []workshopMaterial                     `json:"materials"`
	}{c.Categories, c.MaterialCategories, c.Definitions, c.Presets, c.Materials}
	raw, err := json.Marshal(payload)
	if err != nil {
		// Marshal of these plain structs cannot fail in practice; fall back
		// to a stable constant rather than 500-ing the whole catalog.
		return "workshop-unavailable"
	}
	sum := sha256.Sum256(raw)
	return "workshop-" + hex.EncodeToString(sum[:6])
}
