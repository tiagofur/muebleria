package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"strings"
)

// Contrato: CRUD de módulos plantilla — componentes instanciados, presets
// de medidas y helpers de reemplazo transaccional.
func (s *PostgresStore) ListModules(ctx context.Context) ([]domain.Module, error) {
	query := `
		SELECT id, code, name, width_mm, height_mm, depth_mm, notes, category_id,
		       furniture_type, base_mode, base_clearance_mm, image_url, structure_id, agregados, parameter_definitions, version
		FROM modules
		WHERE organization_id = $1
		ORDER BY name ASC, id ASC;
	`
	rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, fmt.Errorf("error query modules: %w", err)
	}
	defer rows.Close()

	modules := []domain.Module{}
	for rows.Next() {
		var m domain.Module
		var w, h, d *int
		var notes *string
		var categoryID *string
		var furnitureType *string
		var baseMode *string
		var baseClearanceMm *int
		var imageURL *string
		var structureID *string
		var agrsRaw []byte
		var parameterDefinitionsRaw []byte
		err := rows.Scan(&m.ID, &m.Code, &m.Name, &w, &h, &d, &notes, &categoryID,
			&furnitureType, &baseMode, &baseClearanceMm, &imageURL, &structureID, &agrsRaw, &parameterDefinitionsRaw, &m.Version)
		if err != nil {
			return nil, err
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
		if furnitureType != nil {
			m.FurnitureType = *furnitureType
		}
		if baseMode != nil {
			m.BaseMode = *baseMode
		}
		if baseClearanceMm != nil {
			m.BaseClearanceMm = baseClearanceMm
		}
		if imageURL != nil {
			m.ImageURL = *imageURL
		}
		if structureID != nil {
			m.StructureID = *structureID
		}
		if len(agrsRaw) > 0 {
			_ = json.Unmarshal(agrsRaw, &m.Agregados)
		}
		if m.Agregados == nil {
			m.Agregados = []domain.ModuleAgregadoInstance{}
		}
		if err := decodePersistedFurnitureParameterDefinitions(parameterDefinitionsRaw, &m.ParameterDefinitions); err != nil {
			return nil, fmt.Errorf("module %s parameter definitions: %w", m.ID, err)
		}
		modules = append(modules, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	componentsByModule, err := s.listAllModuleComponents(ctx)
	if err != nil {
		return nil, err
	}

	presetsByModule, err := s.listAllModulePresets(ctx)
	if err != nil {
		return nil, err
	}
	for i := range modules {
		if comps, ok := componentsByModule[modules[i].ID]; ok {
			modules[i].Components = comps
		} else {
			modules[i].Components = []domain.ComponentInstance{}
		}
		if presets, ok := presetsByModule[modules[i].ID]; ok {
			modules[i].Presets = presets
		} else {
			modules[i].Presets = []domain.DimensionPreset{}
		}
	}
	return modules, nil
}

func (s *PostgresStore) listAllModuleComponents(ctx context.Context) (map[string][]domain.ComponentInstance, error) {
	query := `
		SELECT module_id, component_id, quantity, placement_override, length_formula, width_formula, overrides
		FROM module_components
		WHERE organization_id = $1
		-- component_id (not the random row id) breaks created_at ties so the
		-- served wire — and any golden pinned on it — is deterministic.
		ORDER BY created_at ASC, component_id ASC;
	`
	rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, fmt.Errorf("error query all module components: %w", err)
	}
	defer rows.Close()

	byModule := map[string][]domain.ComponentInstance{}
	for rows.Next() {
		var moduleID string
		var ci domain.ComponentInstance
		var placementOverride *string
		var lengthFormula, widthFormula *string
		var overridesJSON []byte
		if err := rows.Scan(&moduleID, &ci.ComponentID, &ci.Quantity, &placementOverride, &lengthFormula, &widthFormula, &overridesJSON); err != nil {
			return nil, err
		}
		if placementOverride != nil && *placementOverride != "" {
			p := domain.ComponentPlacement(*placementOverride)
			ci.PlacementOverride = &p
		}
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
				if err := json.Unmarshal(overridesJSON, ov); err != nil {
					var edgeStruct struct {
						Edges []domain.EdgeAssignment `json:"edges"`
					}
					if err2 := json.Unmarshal(overridesJSON, &edgeStruct); err2 == nil {
						ov.Edges = edgeStruct.Edges
					}
				}
			}
			ci.Overrides = ov
		}
		byModule[moduleID] = append(byModule[moduleID], ci)
	}
	return byModule, rows.Err()
}

func (s *PostgresStore) listAllModulePresets(ctx context.Context) (map[string][]domain.DimensionPreset, error) {
	query := `
		SELECT id, module_id, name, width_mm, height_mm, depth_mm
		FROM module_presets
		WHERE organization_id = $1
		ORDER BY width_mm ASC, height_mm ASC, depth_mm ASC, id ASC;
	`
	rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, fmt.Errorf("error query module presets: %w", err)
	}
	defer rows.Close()

	byModule := map[string][]domain.DimensionPreset{}
	for rows.Next() {
		var moduleID string
		var name *string
		var pr domain.DimensionPreset
		if err := rows.Scan(&pr.ID, &moduleID, &name, &pr.WidthMm, &pr.HeightMm, &pr.DepthMm); err != nil {
			return nil, err
		}
		if name != nil {
			pr.Name = *name
		}
		byModule[moduleID] = append(byModule[moduleID], pr)
	}
	return byModule, rows.Err()
}

func (s *PostgresStore) GetModuleByID(ctx context.Context, id string) (*domain.Module, error) {
	query := `SELECT id, code, name, base_labor_cost, width_mm, height_mm, depth_mm, notes, category_id, image_url, structure_id, furniture_type, base_mode, base_clearance_mm, agregados, parameter_definitions, created_at, updated_at, version FROM modules WHERE id = $1 AND organization_id = $2`
	row := s.db(ctx).QueryRow(ctx, query, id, OrgFromCtx(ctx))
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
	err := row.Scan(&m.ID, &m.Code, &m.Name, &m.BaseLaborCost, &w, &h, &d, &notes, &categoryID, &imageURL, &structureID, &furnitureType, &baseMode, &baseClearanceMm, &agrsRaw, &parameterDefinitionsRaw, &m.CreatedAt, &m.UpdatedAt, &m.Version)
	if err != nil {
		return nil, err
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
		_ = json.Unmarshal(agrsRaw, &m.Agregados)
	}
	if m.Agregados == nil {
		m.Agregados = []domain.ModuleAgregadoInstance{}
	}
	if err := decodePersistedFurnitureParameterDefinitions(parameterDefinitionsRaw, &m.ParameterDefinitions); err != nil {
		return nil, fmt.Errorf("module %s parameter definitions: %w", m.ID, err)
	}

	modComponents, err := s.loadModuleComponents(ctx, m.ID)
	if err != nil {
		return nil, err
	}
	m.Components = modComponents

	presets, err := s.loadModulePresets(ctx, m.ID)
	if err != nil {
		return nil, err
	}
	m.Presets = presets

	// BoardParts
	partsQuery := `SELECT id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2 FROM board_parts WHERE module_id = $1 AND organization_id = $2`
	pRows, err := s.db(ctx).Query(ctx, partsQuery, m.ID, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer pRows.Close()

	for pRows.Next() {
		var p domain.BoardPart
		var code *string
		var l1, l2, w1, w2 bool
		err := pRows.Scan(&p.ID, &code, &p.Description, &p.Quantity, &p.LengthMm, &p.WidthMm, &p.OptionRole, &l1, &l2, &w1, &w2)
		if err == nil {
			if code != nil {
				p.Code = *code
			}
			p.Edges = []domain.EdgeAssignment{
				{Side: "L1", Enabled: l1},
				{Side: "L2", Enabled: l2},
				{Side: "W1", Enabled: w1},
				{Side: "W2", Enabled: w2},
			}
			m.BoardParts = append(m.BoardParts, p)
		}
	}

	// HardwareLines
	hwQuery := `SELECT id, quantity, description_override, option_role, hardware_id FROM hardware_lines WHERE module_id = $1 AND organization_id = $2`
	hRows, err := s.db(ctx).Query(ctx, hwQuery, m.ID, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer hRows.Close()

	for hRows.Next() {
		var hl domain.HardwareLine
		var desc *string
		var hwID *string
		err := hRows.Scan(&hl.ID, &hl.Quantity, &desc, &hl.OptionRole, &hwID)
		if err == nil {
			if desc != nil {
				hl.DescriptionOverride = *desc
			}
			if hwID != nil {
				hl.HardwareID = *hwID
			}
			m.HardwareLines = append(m.HardwareLines, hl)
		}
	}

	return &m, nil
}

func (s *PostgresStore) CreateModule(ctx context.Context, m *domain.Module) error {
	if issues := domain.ValidatePersistedFurnitureParameterDefinitions(m.ParameterDefinitions); len(issues) > 0 {
		return &domain.FurnitureParameterDefinitionsError{Issues: issues}
	}
	tx, err := s.beginTx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var idToInsert string
	if m.ID != "" {
		idToInsert = m.ID
	}

	var categoryArg interface{}
	if m.CategoryID != "" {
		categoryArg = m.CategoryID
	}

	var structureArg interface{}
	if m.StructureID != "" {
		structureArg = m.StructureID
	}

	var queryInsert string
	var errQuery error
	var baseClearanceArg interface{}
	if m.BaseClearanceMm != nil {
		baseClearanceArg = *m.BaseClearanceMm
	}

	agrsJSON, _ := json.Marshal(m.Agregados)
	if m.Agregados == nil {
		agrsJSON = []byte("[]")
	}
	parameterDefinitionsJSON, err := json.Marshal(m.ParameterDefinitions)
	if err != nil {
		return fmt.Errorf("encode module parameter definitions: %w", err)
	}
	if m.ParameterDefinitions == nil {
		parameterDefinitionsJSON = []byte("[]")
	}

	if idToInsert != "" {
		queryInsert = `
			INSERT INTO modules (id, code, name, base_labor_cost, width_mm, height_mm, depth_mm, notes, category_id, image_url, structure_id, furniture_type, base_mode, base_clearance_mm, agregados, parameter_definitions, organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
			RETURNING created_at, updated_at, version;
		`
		errQuery = tx.QueryRow(ctx, queryInsert, idToInsert, m.Code, m.Name, m.BaseLaborCost, m.WidthMm, m.HeightMm, m.DepthMm, m.Notes, categoryArg, m.ImageURL, structureArg, m.FurnitureType, m.BaseMode, baseClearanceArg, agrsJSON, parameterDefinitionsJSON, OrgFromCtx(ctx)).
			Scan(&m.CreatedAt, &m.UpdatedAt, &m.Version)
		m.ID = idToInsert
	} else {
		queryInsert = `
			INSERT INTO modules (code, name, base_labor_cost, width_mm, height_mm, depth_mm, notes, category_id, image_url, structure_id, furniture_type, base_mode, base_clearance_mm, agregados, parameter_definitions, organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
			RETURNING id, created_at, updated_at, version;
		`
		errQuery = tx.QueryRow(ctx, queryInsert, m.Code, m.Name, m.BaseLaborCost, m.WidthMm, m.HeightMm, m.DepthMm, m.Notes, categoryArg, m.ImageURL, structureArg, m.FurnitureType, m.BaseMode, baseClearanceArg, agrsJSON, parameterDefinitionsJSON, OrgFromCtx(ctx)).
			Scan(&m.ID, &m.CreatedAt, &m.UpdatedAt, &m.Version)
	}

	if errQuery != nil {
		return fmt.Errorf("error inserting module: %w", errQuery)
	}

	// Insertar BoardParts
	for _, p := range m.BoardParts {
		var l1, l2, w1, w2 bool
		for _, e := range p.Edges {
			switch e.Side {
			case "L1":
				l1 = e.Enabled
			case "L2":
				l2 = e.Enabled
			case "W1":
				w1 = e.Enabled
			case "W2":
				w2 = e.Enabled
			}
		}

		partID := p.ID
		if !isValidUUID(partID) {
			partID = ""
		}
		if partID == "" {
			partQuery := `
				INSERT INTO board_parts (module_id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2, organization_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
				RETURNING id;
			`
			err = tx.QueryRow(ctx, partQuery, m.ID, p.Code, p.Description, p.Quantity, p.LengthMm, p.WidthMm, p.OptionRole, l1, l2, w1, w2, OrgFromCtx(ctx)).Scan(&p.ID)
		} else {
			partQuery := `
				INSERT INTO board_parts (id, module_id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2, organization_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
			`
			_, err = tx.Exec(ctx, partQuery, partID, m.ID, p.Code, p.Description, p.Quantity, p.LengthMm, p.WidthMm, p.OptionRole, l1, l2, w1, w2, OrgFromCtx(ctx))
		}
		if err != nil {
			return fmt.Errorf("error inserting board part: %w", err)
		}
	}

	// Insertar HardwareLines
	for _, hl := range m.HardwareLines {
		var hwID interface{} = nil
		if hl.HardwareID != "" && isValidUUID(hl.HardwareID) {
			hwID = hl.HardwareID
		}

		hlID := hl.ID
		if !isValidUUID(hlID) {
			hlID = ""
		}
		if hlID == "" {
			hwLineQuery := `
				INSERT INTO hardware_lines (module_id, quantity, description_override, option_role, hardware_id, organization_id)
				VALUES ($1, $2, $3, $4, $5, $6)
				RETURNING id;
			`
			err = tx.QueryRow(ctx, hwLineQuery, m.ID, hl.Quantity, hl.DescriptionOverride, hl.OptionRole, hwID, OrgFromCtx(ctx)).Scan(&hl.ID)
		} else {
			hwLineQuery := `
				INSERT INTO hardware_lines (id, module_id, quantity, description_override, option_role, hardware_id, organization_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7);
			`
			_, err = tx.Exec(ctx, hwLineQuery, hlID, m.ID, hl.Quantity, hl.DescriptionOverride, hl.OptionRole, hwID, OrgFromCtx(ctx))
		}
		if err != nil {
			return fmt.Errorf("error inserting hardware line: %w", err)
		}
	}

	if err := replaceModuleComponentsTx(ctx, tx, m.ID, m.Components); err != nil {
		return err
	}
	if err := insertModulePresetsTx(ctx, tx, m.ID, m.Presets); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// replaceModuleComponentsTx deletes and re-inserts the module-level component
// instances for a module (full replace semantics, like board parts/hardware).
func replaceModuleComponentsTx(ctx context.Context, tx pgx.Tx, moduleID string, components []domain.ComponentInstance) error {
	if _, err := tx.Exec(ctx, `DELETE FROM module_components WHERE module_id = $1 AND organization_id = $2`, moduleID, OrgFromCtx(ctx)); err != nil {
		return fmt.Errorf("error clearing module components: %w", err)
	}
	for _, c := range components {
		var lengthFormula, widthFormula interface{}
		if c.Overrides != nil {
			if c.Overrides.LengthFormula != "" {
				lengthFormula = c.Overrides.LengthFormula
			}
			if c.Overrides.WidthFormula != "" {
				widthFormula = c.Overrides.WidthFormula
			}
		}
		overridesJSON := componentInstanceOverridesJSON(c.Overrides)
		if _, err := tx.Exec(ctx, `
			INSERT INTO module_components (module_id, component_id, quantity, placement_override, length_formula, width_formula, overrides, organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
		`, moduleID, c.ComponentID, c.Quantity, placementOverrideArg(c.PlacementOverride),
			lengthFormula, widthFormula, overridesJSON, OrgFromCtx(ctx)); err != nil {
			return fmt.Errorf("error inserting module component: %w", err)
		}
	}
	return nil
}

// UpdateModule replaces the module row only when its stored version still
// matches expectedVersion (#497 optimistic concurrency). The version bump and
// the child-table rewrite share one transaction: any failure rolls the whole
// update back, so a rejected stale write leaves nothing behind.
func (s *PostgresStore) UpdateModule(ctx context.Context, id string, expectedVersion int64, m *domain.Module) error {
	if issues := domain.ValidatePersistedFurnitureParameterDefinitions(m.ParameterDefinitions); len(issues) > 0 {
		return &domain.FurnitureParameterDefinitionsError{Issues: issues}
	}
	if expectedVersion < 1 {
		return ErrVersionConflict
	}
	tx, err := s.beginTx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var categoryArg interface{}
	if m.CategoryID != "" {
		categoryArg = m.CategoryID
	}
	var structureArg interface{}
	if m.StructureID != "" {
		structureArg = m.StructureID
	}
	var baseClearanceArg interface{}
	if m.BaseClearanceMm != nil {
		baseClearanceArg = *m.BaseClearanceMm
	}
	agrsJSON, _ := json.Marshal(m.Agregados)
	if m.Agregados == nil {
		agrsJSON = []byte("[]")
	}
	parameterDefinitionsJSON, err := json.Marshal(m.ParameterDefinitions)
	if err != nil {
		return fmt.Errorf("encode module parameter definitions: %w", err)
	}
	if m.ParameterDefinitions == nil {
		parameterDefinitionsJSON = []byte("[]")
	}

	query := `
		UPDATE modules
		SET code = $1, name = $2, base_labor_cost = $3, width_mm = $4, height_mm = $5, depth_mm = $6, notes = $7, category_id = $8, image_url = $9, structure_id = $10, furniture_type = $11, base_mode = $12, base_clearance_mm = $13, agregados = $14, parameter_definitions = $15, updated_at = CURRENT_TIMESTAMP, version = version + 1
		WHERE id = $16 AND organization_id = $17 AND version = $18
		RETURNING updated_at, version;
	`
	err = tx.QueryRow(ctx, query, m.Code, m.Name, m.BaseLaborCost, m.WidthMm, m.HeightMm, m.DepthMm, m.Notes, categoryArg, m.ImageURL, structureArg, m.FurnitureType, m.BaseMode, baseClearanceArg, agrsJSON, parameterDefinitionsJSON, id, OrgFromCtx(ctx), expectedVersion).Scan(&m.UpdatedAt, &m.Version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Missing row and stale version both surface as ErrNoRows here;
			// disambiguate so clients get 404 vs 412 instead of guessing.
			var exists bool
			if checkErr := tx.QueryRow(ctx,
				`SELECT EXISTS (SELECT 1 FROM modules WHERE id = $1 AND organization_id = $2)`,
				id, OrgFromCtx(ctx)).Scan(&exists); checkErr != nil {
				return fmt.Errorf("error checking module existence: %w", checkErr)
			}
			if !exists {
				return fmt.Errorf("module not found")
			}
			return ErrVersionConflict
		}
		return fmt.Errorf("error updating module: %w", err)
	}

	// Limpiar piezas y herrajes anteriores
	_, err = tx.Exec(ctx, `DELETE FROM board_parts WHERE module_id = $1 AND organization_id = $2`, id, OrgFromCtx(ctx))
	if err != nil {
		return fmt.Errorf("error deleting board parts: %w", err)
	}
	_, err = tx.Exec(ctx, `DELETE FROM hardware_lines WHERE module_id = $1 AND organization_id = $2`, id, OrgFromCtx(ctx))
	if err != nil {
		return fmt.Errorf("error deleting hardware lines: %w", err)
	}

	// Insertar BoardParts
	for _, p := range m.BoardParts {
		var l1, l2, w1, w2 bool
		for _, e := range p.Edges {
			switch e.Side {
			case "L1":
				l1 = e.Enabled
			case "L2":
				l2 = e.Enabled
			case "W1":
				w1 = e.Enabled
			case "W2":
				w2 = e.Enabled
			}
		}
		partID := p.ID
		if !isValidUUID(partID) {
			partID = ""
		}
		if partID == "" {
			partQuery := `
				INSERT INTO board_parts (module_id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2, organization_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
				RETURNING id;
			`
			err = tx.QueryRow(ctx, partQuery, id, p.Code, p.Description, p.Quantity, p.LengthMm, p.WidthMm, p.OptionRole, l1, l2, w1, w2, OrgFromCtx(ctx)).Scan(&p.ID)
		} else {
			partQuery := `
				INSERT INTO board_parts (id, module_id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2, organization_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
			`
			_, err = tx.Exec(ctx, partQuery, partID, id, p.Code, p.Description, p.Quantity, p.LengthMm, p.WidthMm, p.OptionRole, l1, l2, w1, w2, OrgFromCtx(ctx))
		}
		if err != nil {
			return fmt.Errorf("error inserting board part: %w", err)
		}
	}

	// Insertar HardwareLines
	for _, hl := range m.HardwareLines {
		var hwID interface{} = nil
		if hl.HardwareID != "" && isValidUUID(hl.HardwareID) {
			hwID = hl.HardwareID
		}
		hlID := hl.ID
		if !isValidUUID(hlID) {
			hlID = ""
		}
		if hlID == "" {
			hwLineQuery := `
				INSERT INTO hardware_lines (module_id, quantity, description_override, option_role, hardware_id, organization_id)
				VALUES ($1, $2, $3, $4, $5, $6)
				RETURNING id;
			`
			err = tx.QueryRow(ctx, hwLineQuery, id, hl.Quantity, hl.DescriptionOverride, hl.OptionRole, hwID, OrgFromCtx(ctx)).Scan(&hl.ID)
		} else {
			hwLineQuery := `
				INSERT INTO hardware_lines (id, module_id, quantity, description_override, option_role, hardware_id, organization_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7);
			`
			_, err = tx.Exec(ctx, hwLineQuery, hlID, id, hl.Quantity, hl.DescriptionOverride, hl.OptionRole, hwID, OrgFromCtx(ctx))
		}
		if err != nil {
			return fmt.Errorf("error inserting hardware line: %w", err)
		}
	}

	if err := replaceModuleComponentsTx(ctx, tx, id, m.Components); err != nil {
		return err
	}
	if err := insertModulePresetsTx(ctx, tx, id, m.Presets); err != nil {
		return err
	}

	m.ID = id
	return tx.Commit(ctx)
}

func (s *PostgresStore) DeleteModule(ctx context.Context, id string) error {
	// F116 A2: project_items.module_id has no ON DELETE rule (RESTRICT), so a
	// referenced module turned the physical DELETE into an opaque 500 after
	// the FE had already removed it locally. Refuse up-front with a clear
	// error instead.
	var inUse int
	if err := s.db(ctx).QueryRow(ctx,
		`SELECT count(*) FROM project_items WHERE module_id = $1 AND organization_id = $2;`, id, OrgFromCtx(ctx),
	).Scan(&inUse); err != nil {
		return err
	}
	if inUse > 0 {
		return fmt.Errorf("module in use by %d cotización(es)", inUse)
	}
	query := `DELETE FROM modules WHERE id = $1 AND organization_id = $2;`
	tag, err := s.db(ctx).Exec(ctx, query, id, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("module not found")
	}
	return nil
}

func nullKitchenLayout(b []byte) interface{} {
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	return b
}

func nullDateArg(d *string) any {
	if d == nil || strings.TrimSpace(*d) == "" {
		return nil
	}
	return strings.TrimSpace(*d)
}

// SetProjectItemFloorStatus atomically advances one item's shop-floor status
// (PROD-3.1 / F089-RN). Single-row UPDATE — no full project rewrite, so a
// phone scan can never clobber concurrent edits elsewhere in the project.
