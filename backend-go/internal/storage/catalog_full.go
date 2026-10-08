package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// Contrato: catálogo completo resuelto (GetFullCatalog) y detalles de
// módulo para proyecciones del catálogo. Consumido por resolve/pricing
// y los endpoints de definiciones.
func decodePersistedFurnitureParameterDefinitions(raw []byte, target *[]domain.FurnitureParameterDefinition) error {
	definitions, err := domain.DecodeFurnitureParameterDefinitions(raw, domain.FurnitureParameterDefinitionBoundaryPersisted)
	if err != nil {
		return err
	}
	*target = definitions
	return nil
}

// loadModuleComponents returns the component instances placed directly on a
// module (F054 / #102), beyond those inherited from its referenced structure.
func (s *PostgresStore) loadModuleComponents(ctx context.Context, moduleID string) ([]domain.ComponentInstance, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT component_id, quantity, placement_override, length_formula, width_formula, overrides
		FROM module_components
		WHERE module_id = $1 AND organization_id = $2
		-- component_id (not the random row id) breaks created_at ties so the
		-- served wire — and any golden pinned on it — is deterministic.
		ORDER BY created_at ASC, component_id ASC;
	`, moduleID, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.ComponentInstance
	for rows.Next() {
		var ci domain.ComponentInstance
		var placementOverride *string
		var lengthFormula, widthFormula *string
		var overridesJSON []byte
		if err := rows.Scan(&ci.ComponentID, &ci.Quantity, &placementOverride, &lengthFormula, &widthFormula, &overridesJSON); err != nil {
			return nil, err
		}
		if placementOverride != nil && *placementOverride != "" {
			p := domain.ComponentPlacement(*placementOverride)
			ci.PlacementOverride = &p
		}
		// Materialize overrides when formulas, edges, or spatial fields are set.
		hasFormula := (lengthFormula != nil && *lengthFormula != "") || (widthFormula != nil && *widthFormula != "")
		hasJSON := len(overridesJSON) > 0 && string(overridesJSON) != "null" && string(overridesJSON) != "{}"
		if hasFormula || hasJSON {
			ov := &domain.ComponentInstanceOverrides{}
			if lengthFormula != nil {
				ov.LengthFormula = *lengthFormula
			}
			if widthFormula != nil {
				ov.WidthFormula = *widthFormula
			}
			if hasJSON {
				// Full override blob: edges + spatial formulas/rotates.
				if err := json.Unmarshal(overridesJSON, ov); err != nil {
					// Fallback: edges-only legacy shape.
					var edgeStruct struct {
						Edges []domain.EdgeAssignment `json:"edges"`
					}
					if err2 := json.Unmarshal(overridesJSON, &edgeStruct); err2 == nil && len(edgeStruct.Edges) > 0 {
						ov.Edges = edgeStruct.Edges
					}
				}
			}
			// One emptiness contract with the writer and the structures twin
			// (#858): the bag survives when ANY persisted family is present —
			// hardwarePlacements included.
			if !isEmptyComponentInstanceOverrides(ov) {
				ci.Overrides = ov
			}
		}
		out = append(out, ci)
	}
	if out == nil {
		out = []domain.ComponentInstance{}
	}
	return out, rows.Err()
}

// componentInstanceOverridesJSON serializes instance overrides (edges + spatial)
// for the module_components.overrides JSONB. Emptiness uses the SAME contract
// as every other ComponentInstanceOverrides consumer (#858): a bag whose only
// content is hardwarePlacements is not empty and must survive the round-trip.
// length/width formulas also live in dedicated columns on module_components;
// carrying them here too is redundant but harmless and keeps ONE definition
// of "empty" instead of a second manual field list.
func componentInstanceOverridesJSON(ov *domain.ComponentInstanceOverrides) []byte {
	if isEmptyComponentInstanceOverrides(ov) {
		return nil
	}
	// Marshal full overrides; omit empty string formulas via omitempty on domain tags.
	b, err := json.Marshal(ov)
	if err != nil {
		return nil
	}
	return b
}

// isEmptyComponentInstanceOverrides reports whether ov has no persisted fields.
func isEmptyComponentInstanceOverrides(ov *domain.ComponentInstanceOverrides) bool {
	if ov == nil {
		return true
	}
	return len(ov.Edges) == 0 &&
		ov.LengthFormula == "" && ov.WidthFormula == "" &&
		ov.XFormula == "" && ov.YFormula == "" && ov.ZFormula == "" &&
		ov.RotateX == nil && ov.RotateY == nil && ov.RotateZ == nil &&
		len(ov.HardwarePlacements) == 0
}

// fullComponentInstanceOverridesJSON serializes ALL override fields into JSONB.
// Used by structure_components (no dedicated length/width formula columns).
func fullComponentInstanceOverridesJSON(ov *domain.ComponentInstanceOverrides) []byte {
	if isEmptyComponentInstanceOverrides(ov) {
		return nil
	}
	b, err := json.Marshal(ov)
	if err != nil {
		return nil
	}
	return b
}

// parseComponentInstanceOverridesJSON unmarshals a JSONB overrides blob.
// Returns nil for null/empty/invalid payloads.
func parseComponentInstanceOverridesJSON(overridesJSON []byte) *domain.ComponentInstanceOverrides {
	if len(overridesJSON) == 0 || string(overridesJSON) == "null" || string(overridesJSON) == "{}" {
		return nil
	}
	ov := &domain.ComponentInstanceOverrides{}
	if err := json.Unmarshal(overridesJSON, ov); err != nil {
		// Fallback: edges-only legacy shape.
		var edgeStruct struct {
			Edges []domain.EdgeAssignment `json:"edges"`
		}
		if err2 := json.Unmarshal(overridesJSON, &edgeStruct); err2 == nil && len(edgeStruct.Edges) > 0 {
			return &domain.ComponentInstanceOverrides{Edges: edgeStruct.Edges}
		}
		return nil
	}
	if isEmptyComponentInstanceOverrides(ov) {
		return nil
	}
	return ov
}

// Cargar catálogo completo para el motor de cálculo
func (s *PostgresStore) GetFullCatalog(ctx context.Context) (domain.Catalog, error) {
	var cat domain.Catalog

	mats, err := s.ListMaterialBoards(ctx)
	if err != nil {
		return cat, fmt.Errorf("error loading materials: %w", err)
	}
	cat.Materials = mats

	edges, err := s.ListEdgeBands(ctx)
	if err != nil {
		return cat, fmt.Errorf("error loading edges: %w", err)
	}
	cat.Edges = edges

	hws, err := s.ListHardwares(ctx)
	if err != nil {
		return cat, fmt.Errorf("error loading hardware: %w", err)
	}
	cat.Hardware = hws

	groups, err := s.ListOptionGroups(ctx)
	if err != nil {
		return cat, fmt.Errorf("error loading option groups: %w", err)
	}
	cat.OptionGroups = groups

	cats, err := s.ListCategories(ctx)
	if err != nil {
		return cat, fmt.Errorf("error loading categories: %w", err)
	}
	cat.Categories = cats

	agrs, err := s.ListAgregados(ctx)
	if err != nil {
		return cat, fmt.Errorf("error loading agregados: %w", err)
	}
	cat.Agregados = agrs

	// #1078: the org's factory construction overlay rides the full catalog —
	// quote, estimate and export resolves all see the SAME bands, and the
	// release freeze bakes its own copy so released snapshots resolve
	// immutably. An overlay READ failure is infra-level: fail loud, never
	// silently quote with library-default bands while the factory overrode
	// them. Overlay absence is the normal state (nil = library ladder).
	orgUUID, parseErr := uuid.Parse(OrgFromCtx(ctx))
	if parseErr != nil {
		return cat, fmt.Errorf("overlay factory policy org: %w", parseErr)
	}
	overlay, err := s.GetActiveOverlayByLibrary(ctx, orgUUID, uuid.MustParse(domain.GraneteStandardLibraryID))
	if err == nil {
		policy, perr := engine.ParseFactoryConstructionPolicy(overlay.Overrides)
		if perr != nil {
			return cat, fmt.Errorf("overlay factory policy: %w", perr)
		}
		cat.ConstructionPolicy = policy
	} else if !errors.Is(err, ErrOverlayNotFound) {
		return cat, fmt.Errorf("overlay for factory policy: %w", err)
	}

	// Cargar módulos y su despiece. version rides along (#497 T2 contract):
	// the catalog list must serve the real optimistic-concurrency token so
	// clients seed their version cache from one read (a served 0 would be a
	// value the CHECK >= 1 column can never hold).
	query := `SELECT id, code, name, base_labor_cost, width_mm, height_mm, depth_mm, notes, category_id, image_url, structure_id, furniture_type, base_mode, base_clearance_mm, agregados, parameter_definitions, version FROM modules WHERE organization_id = $1 ORDER BY name ASC, id ASC`
	rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return cat, fmt.Errorf("error query modules: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var m domain.Module
		var w, h, d *int
		var notes *string
		var categoryID *string
		var imageURL *string
		var structureID *string
		var furnitureType *string
		var baseMode *string
		var baseClearanceMm *int
		var agrsRaw []byte
		var parameterDefinitionsRaw []byte
		err := rows.Scan(&m.ID, &m.Code, &m.Name, &m.BaseLaborCost, &w, &h, &d, &notes, &categoryID, &imageURL, &structureID, &furnitureType, &baseMode, &baseClearanceMm, &agrsRaw, &parameterDefinitionsRaw, &m.Version)
		if err != nil {
			return cat, err
		}
		if w != nil {
			m.WidthMm = *w
		}
		if h != nil {
			m.HeightMm = *h
		}
		if d != nil {
			m.DepthMm = *d
		}
		if notes != nil {
			m.Notes = *notes
		}
		if categoryID != nil {
			m.CategoryID = *categoryID
		}
		if imageURL != nil {
			m.ImageURL = *imageURL
		}
		if structureID != nil {
			m.StructureID = *structureID
		}
		if furnitureType != nil {
			m.FurnitureType = *furnitureType
		}
		if baseMode != nil {
			m.BaseMode = *baseMode
		}
		if baseClearanceMm != nil {
			m.BaseClearanceMm = baseClearanceMm
		}
		if len(agrsRaw) > 0 {
			if err := json.Unmarshal(agrsRaw, &m.Agregados); err != nil {
				return cat, fmt.Errorf("module agregados: %w", err)
			}
		}
		if err := decodePersistedFurnitureParameterDefinitions(parameterDefinitionsRaw, &m.ParameterDefinitions); err != nil {
			return cat, fmt.Errorf("module %s parameter definitions: %w", m.ID, err)
		}
		if m.Agregados == nil {
			m.Agregados = []domain.ModuleAgregadoInstance{}
		}

		cat.Modules = append(cat.Modules, m)
	}
	if err := rows.Err(); err != nil {
		return cat, err
	}
	rows.Close()
	for i := range cat.Modules {
		if err := s.loadCatalogModuleDetails(ctx, &cat.Modules[i]); err != nil {
			return cat, err
		}
	}
	if cat.Modules == nil {
		cat.Modules = []domain.Module{}
	}

	// F049 engineering structures (bodies)
	structures, err := s.ListStructures(ctx)
	if err != nil {
		return cat, fmt.Errorf("error loading structures: %w", err)
	}
	cat.Structures = structures

	// F050 reusable components
	components, err := s.ListComponents(ctx)
	if err != nil {
		return cat, fmt.Errorf("error loading components: %w", err)
	}
	cat.Components = components

	return cat, nil
}

func (s *PostgresStore) loadCatalogModuleDetails(ctx context.Context, m *domain.Module) error {
	var err error
	m.Components, err = s.loadModuleComponents(ctx, m.ID)
	if err != nil {
		return err
	}
	m.Presets, err = s.loadModulePresets(ctx, m.ID)
	if err != nil {
		return err
	}
	partsQuery := `SELECT id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2 FROM board_parts WHERE module_id = $1 AND organization_id = $2`
	pRows, err := s.db(ctx).Query(ctx, partsQuery, m.ID, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	for pRows.Next() {
		var p domain.BoardPart
		var code *string
		var l1, l2, w1, w2 bool
		if err := pRows.Scan(&p.ID, &code, &p.Description, &p.Quantity, &p.LengthMm, &p.WidthMm, &p.OptionRole, &l1, &l2, &w1, &w2); err != nil {
			pRows.Close()
			return err
		}
		if code != nil {
			p.Code = *code
		}
		p.Edges = []domain.EdgeAssignment{{Side: "L1", Enabled: l1}, {Side: "L2", Enabled: l2}, {Side: "W1", Enabled: w1}, {Side: "W2", Enabled: w2}}
		m.BoardParts = append(m.BoardParts, p)
	}
	if err := pRows.Err(); err != nil {
		pRows.Close()
		return err
	}
	pRows.Close()
	hRows, err := s.db(ctx).Query(ctx, `SELECT id, quantity, description_override, option_role, hardware_id FROM hardware_lines WHERE module_id = $1 AND organization_id = $2`, m.ID, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	defer hRows.Close()
	for hRows.Next() {
		var hl domain.HardwareLine
		var desc, hwID *string
		if err := hRows.Scan(&hl.ID, &hl.Quantity, &desc, &hl.OptionRole, &hwID); err != nil {
			return err
		}
		if desc != nil {
			hl.DescriptionOverride = *desc
		}
		if hwID != nil {
			hl.HardwareID = *hwID
		}
		m.HardwareLines = append(m.HardwareLines, hl)
	}
	if m.BoardParts == nil {
		m.BoardParts = []domain.BoardPart{}
	}
	if m.HardwareLines == nil {
		m.HardwareLines = []domain.HardwareLine{}
	}
	return hRows.Err()
}
