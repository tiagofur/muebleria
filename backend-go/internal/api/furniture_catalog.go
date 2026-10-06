package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

func furnitureParameterDefinitionsError(err error) (*domain.FurnitureParameterDefinitionsError, bool) {
	var definitionErr *domain.FurnitureParameterDefinitionsError
	ok := errors.As(err, &definitionErr)
	return definitionErr, ok
}

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

type workshopFurnitureParameter = domain.FurnitureParameterDefinition

type workshopFurnitureDefinition struct {
	FurnitureDefinitionID string `json:"furnitureDefinitionId"`
	Code                  string `json:"code"`
	Name                  string `json:"name"`
	// Category is the module's full catalog path (root › … › leaf) for
	// display and search; CategoryID anchors subtree filtering.
	Category       string `json:"category"`
	CategoryID     string `json:"categoryId,omitempty"`
	Version        string `json:"version"`
	SchemaRevision int    `json:"schemaRevision"`
	DefinitionHash string `json:"definitionHash"`
	Description    string `json:"description,omitempty"`
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
	// HardwareRoles lists the kind=hardware option groups the definition's
	// default composition consumes (#1144): the plugin's pre-insert
	// configurator offers one selector per role so a group-required
	// furniture can ALWAYS be inserted with an explicit choice. Mirror of
	// materialRoles; members carry active hardware only, no pricing.
	HardwareRoles []workshopHardwareRole `json:"hardwareRoles,omitempty"`
}

// workshopMaterialRole is one board role of a definition's composition with
// the material options the workshop curated for it. When no option group is
// defined for the role, OptionIDs falls back to every active material.
type workshopMaterialRole struct {
	Role      string   `json:"role"`
	Label     string   `json:"label"`
	OptionIDs []string `json:"optionIds"`
}

// workshopHardwareRole is one hardware option group a definition consumes,
// with its active member hardware for the plugin's pre-insert selector
// (#1144). Deliberately cost-free: commercial truth resolves server-side.
type workshopHardwareRole struct {
	Code      string   `json:"code"`
	Name      string   `json:"name"`
	Required  bool     `json:"required"`
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
	MaterialCategories []workshopMaterialCategory             `json:"materialCategories"`
	Definitions        map[string]workshopFurnitureDefinition `json:"definitions"`
	Presets            []workshopFurniturePreset              `json:"presets"`
	// Materials carries the workshop's active boards so clients can populate
	// per-role material selectors without a second request.
	Materials []workshopMaterial `json:"materials"`
	// Hardware carries the workshop's active hardware definitions (#1046 S3)
	// so the plugin's group selectors and family substitution list the REAL
	// catalog instead of the packaged demo fallback. No costs: pricing stays
	// server-side (estimate/preflight); the plugin never re-derives it.
	Hardware []workshopHardwareCatalogEntry `json:"hardware"`
	// OptionGroups carries the kind=hardware option groups (#1046): the
	// members a furniture's role-based placements choose from. Material-kind
	// groups stay out — board roles already ride each definition's
	// materialRoles.
	OptionGroups []workshopOptionGroup `json:"optionGroups"`
}

// workshopHardwareCatalogEntry is one active hardware definition as the
// plugin consumes it. Deliberately cost-free and machining-free: commercial
// and technical truth resolve server-side against the pinned catalog.
type workshopHardwareCatalogEntry struct {
	ID       string `json:"id"`
	Code     string `json:"code"`
	Name     string `json:"name"`
	Category string `json:"category,omitempty"`
	Unit     string `json:"unit,omitempty"`
	Notes    string `json:"notes,omitempty"`
	ImageURL string `json:"imageUrl,omitempty"`
	Active   bool   `json:"active"`
}

// workshopOptionGroup mirrors domain.OptionGroup for the hardware-kind
// subset the plugin needs (#1046 S3).
type workshopOptionGroup struct {
	ID        string   `json:"id"`
	Code      string   `json:"code"`
	Name      string   `json:"name"`
	Kind      string   `json:"kind"`
	Required  bool     `json:"required"`
	OptionIDs []string `json:"optionIds"`
}

type dimensionSpec struct {
	name       string
	label      string
	sortOrder  int
	fromModule func(m domain.Module) int
	fromPreset func(p domain.DimensionPreset) int
}

var workshopDimensionSpecs = []dimensionSpec{
	{"widthMm", "Ancho (mm)", 10, func(m domain.Module) int { return m.WidthMm },
		func(p domain.DimensionPreset) int { return p.WidthMm }},
	{"heightMm", "Alto (mm)", 20, func(m domain.Module) int { return m.HeightMm },
		func(p domain.DimensionPreset) int { return p.HeightMm }},
	{"depthMm", "Fondo (mm)", 30, func(m domain.Module) int { return m.DepthMm },
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
	catalog, err := buildWorkshopFurnitureCatalogValidated(modules, categories, materialCategories, composition)
	if err != nil {
		panic(err)
	}
	return catalog
}

func buildWorkshopFurnitureCatalogValidated(modules []domain.Module, categories []domain.ModuleCategory, materialCategories []domain.MaterialCategory, composition domain.Catalog) (workshopFurnitureCatalog, error) {
	catalog := workshopFurnitureCatalog{
		SchemaID:           workshopFurnitureSchemaID,
		Categories:         []workshopFurnitureCategory{},
		MaterialCategories: buildWorkshopMaterialCategories(materialCategories),
		Definitions:        map[string]workshopFurnitureDefinition{},
		Presets:            []workshopFurniturePreset{},
		Materials:          buildWorkshopMaterials(composition.Materials),
		Hardware:           buildWorkshopHardwareEntries(composition.Hardware),
		OptionGroups:       buildWorkshopHardwareOptionGroups(composition.OptionGroups),
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
		if issues := domain.ValidatePersistedFurnitureParameterDefinitions(m.ParameterDefinitions); len(issues) != 0 {
			return workshopFurnitureCatalog{}, &domain.FurnitureParameterDefinitionsError{Issues: issues}
		}
		if issues := domain.ValidateModuleFurnitureParameterConsumers(m, composition); len(issues) != 0 {
			return workshopFurnitureCatalog{}, &domain.FurnitureParameterDefinitionsError{Issues: issues}
		}
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
			SchemaRevision:        1,
			Description:           m.Notes,
			ImageURL:              m.ImageURL,
			Parameters:            []workshopFurnitureParameter{},
		}

		definition.Parameters = append(definition.Parameters, m.ParameterDefinitions...)
		for _, spec := range workshopDimensionSpecs {
			param, ok := buildDimensionParameter(spec, m)
			if ok {
				definition.Parameters = append(definition.Parameters, param)
			}
		}
		sort.SliceStable(definition.Parameters, func(i, j int) bool {
			if definition.Parameters[i].SortOrder != definition.Parameters[j].SortOrder {
				return definition.Parameters[i].SortOrder < definition.Parameters[j].SortOrder
			}
			return definition.Parameters[i].Name < definition.Parameters[j].Name
		})
		if issues := domain.ValidatePublishedFurnitureParameterDefinitions(definition.Parameters); len(issues) != 0 {
			return workshopFurnitureCatalog{}, &domain.FurnitureParameterDefinitionsError{Issues: issues}
		}
		definitionHash, err := domain.FurnitureParameterDefinitionHash(definition.Parameters)
		if err != nil {
			return workshopFurnitureCatalog{}, err
		}
		definition.DefinitionHash = definitionHash

		// Real composition sizes at default dimensions; a module whose
		// composition cannot resolve here keeps zero counts (the layout
		// endpoint reports the concrete error when the user inserts it).
		if layout, err := engine.ResolveFurnitureLayout(m, composition, nil, nil); err == nil {
			// Estimates are resolve EVIDENCE, not role authority: they only
			// exist when the default layout resolves.
			definition.EstimatedPartCount = len(layout.Components)
			definition.EstimatedHardwareCount = len(layout.Hardware)
		}
		// Static scan on purpose (#1144/#1156): a group-required furniture's
		// default layout FAILS closed without a choice — exactly when the
		// configurator must offer the selectors — so the roles (board AND
		// hardware) can never depend on the layout succeeding.
		definition.MaterialRoles = buildMaterialRoles(m, composition)
		definition.HardwareRoles = buildHardwareRoles(m, composition)

		catalog.Definitions[m.ID] = definition

		for _, p := range m.Presets {
			catalog.Presets = append(catalog.Presets, buildWorkshopPreset(m, p, category))
		}
	}
	// NOTE: the arrays above feed the content-addressed revisionId/ETag, so
	// their order must be a total function of content. That guarantee lives
	// in the storage layer's ORDER BY (id tiebreakers for duplicate
	// (sort_order, name) categories and equal-dimension presets) — the
	// projection deliberately preserves the store's semantic order verbatim
	// (tests assert it); re-sorting here would desync the web client's
	// presentation order (#466 pinned-resolve stability).
	return catalog, nil
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

// buildWorkshopHardwareEntries projects the workshop's ACTIVE hardware
// definitions (#1046 S3), deterministically ordered (code, then id) because
// the slice feeds the content-addressed revisionId.
func buildWorkshopHardwareEntries(hardwares []domain.Hardware) []workshopHardwareCatalogEntry {
	out := make([]workshopHardwareCatalogEntry, 0, len(hardwares))
	for _, h := range hardwares {
		if !h.Active {
			continue
		}
		out = append(out, workshopHardwareCatalogEntry{
			ID:       h.ID,
			Code:     h.Code,
			Name:     h.Name,
			Category: h.Category,
			Unit:     string(h.Unit),
			Notes:    h.Notes,
			ImageURL: h.ImageURL,
			Active:   true,
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Code != out[j].Code {
			return out[i].Code < out[j].Code
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// buildWorkshopHardwareOptionGroups projects ONLY the kind=hardware option
// groups (#1046 S3), deterministically ordered (code, then id) because the
// slice feeds the content-addressed revisionId.
func buildWorkshopHardwareOptionGroups(groups []domain.OptionGroup) []workshopOptionGroup {
	out := make([]workshopOptionGroup, 0, len(groups))
	for _, g := range groups {
		if g.Kind != "hardware" {
			continue
		}
		optionIDs := make([]string, len(g.OptionIDs))
		copy(optionIDs, g.OptionIDs)
		out = append(out, workshopOptionGroup{
			ID:        g.ID,
			Code:      g.Code,
			Name:      g.Name,
			Kind:      g.Kind,
			Required:  g.Required,
			OptionIDs: optionIDs,
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Code != out[j].Code {
			return out[i].Code < out[j].Code
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// buildMaterialRoles derives the definition's board roles (in composition
// order) with the options the workshop curated for each. Roles are option
// group codes; a role without a curated board group offers every active
// material so the selector is never empty.
// buildMaterialRoles derives the definition's board roles statically —
// module components, structure components and every agregado instance
// (#1156) — so a furniture whose default layout fails closed (required
// hardware group without a choice) still publishes its material selectors.
// Semantics unchanged from the layout-derived version: roles in
// composition order; a board-kind group contributes label + curated
// options, otherwise the role offers every active material.
func buildMaterialRoles(m domain.Module, composition domain.Catalog) []workshopMaterialRole {
	allActive := make([]string, 0)
	for _, mat := range composition.Materials {
		if mat.Active {
			allActive = append(allActive, mat.ID)
		}
	}

	seen := map[string]bool{}
	roles := make([]workshopMaterialRole, 0)
	record := func(instances []domain.ComponentInstance) {
		for _, inst := range instances {
			for _, role := range optionRolesOf(composition, inst.ComponentID) {
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
		}
	}

	findStructure := func(id string) (domain.Structure, bool) {
		if id == "" {
			return domain.Structure{}, false
		}
		for _, st := range composition.Structures {
			if st.ID == id {
				return st, true
			}
		}
		return domain.Structure{}, false
	}
	findAgregado := func(id string) (domain.Agregado, bool) {
		if id == "" {
			return domain.Agregado{}, false
		}
		for _, agr := range composition.Agregados {
			if agr.ID == id {
				return agr, true
			}
		}
		return domain.Agregado{}, false
	}

	record(m.Components)
	if structure, ok := findStructure(m.StructureID); ok {
		record(structure.Components)
		for _, agrInst := range structure.Agregados {
			if agr, ok := findAgregado(agrInst.AgregadoID); ok {
				record(agr.Components)
			}
		}
	}
	for _, agrInst := range m.Agregados {
		if agr, ok := findAgregado(agrInst.AgregadoID); ok {
			record(agr.Components)
		}
	}
	return roles
}

// optionRolesOf returns a component's declared option roles (definition
// order); unknown components carry none.
func optionRolesOf(composition domain.Catalog, componentID string) []string {
	for _, c := range composition.Components {
		if c.ID == componentID {
			return c.OptionRoles
		}
	}
	return nil
}

// buildHardwareRoles derives the definition's hardware option-group roles
// with the ACTIVE members the workshop curated for each (#1144), scanning
// the module's composition statically (module components, structure
// components and every agregado instance — the same traversal the engine's
// consumed-roles walk uses). A consumed role without a hardware-kind group
// still surfaces — with empty members — so the configurator can explain the
// unresolvable choice instead of hiding it; the engine fails that resolve
// fail-closed either way.
func buildHardwareRoles(m domain.Module, composition domain.Catalog) []workshopHardwareRole {
	active := make(map[string]bool, len(composition.Hardware))
	for _, h := range composition.Hardware {
		if h.Active {
			active[h.ID] = true
		}
	}
	findGroup := func(code string) (domain.OptionGroup, bool) {
		for _, g := range composition.OptionGroups {
			if strings.EqualFold(g.Code, code) && g.Kind == "hardware" {
				return g, true
			}
		}
		return domain.OptionGroup{}, false
	}

	seen := map[string]bool{}
	roles := make([]workshopHardwareRole, 0)
	record := func(instances []domain.ComponentInstance) {
		for _, inst := range instances {
			if inst.Overrides == nil {
				continue
			}
			for _, hp := range inst.Overrides.HardwarePlacements {
				code := strings.TrimSpace(hp.OptionRole)
				if code == "" || seen[code] {
					continue
				}
				seen[code] = true

				entry := workshopHardwareRole{Code: code, Name: code, Required: true, OptionIDs: []string{}}
				if group, ok := findGroup(code); ok {
					entry.Name = group.Name
					entry.Required = group.Required
					entry.OptionIDs = make([]string, 0, len(group.OptionIDs))
					for _, optionID := range group.OptionIDs {
						if active[optionID] {
							entry.OptionIDs = append(entry.OptionIDs, optionID)
						}
					}
				}
				roles = append(roles, entry)
			}
		}
	}

	// Local lookups on purpose: the engine's find* stay unexported and the
	// static scan needs none of its resolution semantics.
	findStructure := func(id string) (domain.Structure, bool) {
		if id == "" {
			return domain.Structure{}, false
		}
		for _, st := range composition.Structures {
			if st.ID == id {
				return st, true
			}
		}
		return domain.Structure{}, false
	}
	findAgregado := func(id string) (domain.Agregado, bool) {
		if id == "" {
			return domain.Agregado{}, false
		}
		for _, agr := range composition.Agregados {
			if agr.ID == id {
				return agr, true
			}
		}
		return domain.Agregado{}, false
	}

	record(m.Components)
	if structure, ok := findStructure(m.StructureID); ok {
		record(structure.Components)
		for _, agrInst := range structure.Agregados {
			if agr, ok := findAgregado(agrInst.AgregadoID); ok {
				record(agr.Components)
			}
		}
	}
	for _, agrInst := range m.Agregados {
		if agr, ok := findAgregado(agrInst.AgregadoID); ok {
			record(agr.Components)
		}
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
	step := workshopDimParamStepMm
	if (defaultValue-min)%step != 0 {
		step = 1
	}
	for _, candidate := range candidates {
		if (candidate-min)%step != 0 {
			step = 1
			break
		}
	}

	return workshopFurnitureParameter{
		Name:         spec.name,
		Label:        spec.label,
		SortOrder:    spec.sortOrder,
		Type:         "number",
		DefaultValue: float64(defaultValue),
		Required:     true,
		Unit:         domain.FurnitureParameterUnitMM,
		Min:          float64Ptr(float64(min)),
		Max:          float64Ptr(float64(max)),
		Step:         float64Ptr(float64(step)),
		Category:     domain.FurnitureParameterCategory(workshopDimensionParamKind),
		Integer:      true,
		Binding: &domain.FurnitureParameterBinding{
			Version:   domain.FurnitureParameterBindingVersion,
			Kind:      domain.FurnitureParameterBindingDimensionColumn,
			Dimension: spec.name,
		},
	}, true
}

func float64Ptr(value float64) *float64 { return &value }

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
	return workshopCatalogRevisionIDWithRules(c, engine.AuthoringIndustrialRulesRevision())
}

func workshopCatalogRevisionIDWithRules(c workshopFurnitureCatalog, industrialRulesRevision string) string {
	payload := struct {
		Categories         []workshopFurnitureCategory            `json:"categories"`
		MaterialCategories []workshopMaterialCategory             `json:"materialCategories"`
		Definitions        map[string]workshopFurnitureDefinition `json:"definitions"`
		Presets            []workshopFurniturePreset              `json:"presets"`
		Materials          []workshopMaterial                     `json:"materials"`
		// Hardware and hardware-kind option groups join the content hash
		// (#1046 S3): role-based placements resolve against them, so a group
		// or member change MUST re-pin the catalog revision.
		Hardware        []workshopHardwareCatalogEntry `json:"hardware"`
		OptionGroups    []workshopOptionGroup          `json:"optionGroups"`
		IndustrialRules string                         `json:"industrialRulesRevision"`
	}{c.Categories, c.MaterialCategories, c.Definitions, c.Presets, c.Materials, c.Hardware, c.OptionGroups, industrialRulesRevision}
	raw, err := json.Marshal(payload)
	if err != nil {
		// Marshal of these plain structs cannot fail in practice; fall back
		// to a stable constant rather than 500-ing the whole catalog.
		return "workshop-unavailable"
	}
	sum := sha256.Sum256(raw)
	return "workshop-" + hex.EncodeToString(sum[:6])
}
