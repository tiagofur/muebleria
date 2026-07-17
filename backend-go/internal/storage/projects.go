package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// loadModuleComponents returns the component instances placed directly on a
// module (F054 / #102), beyond those inherited from its referenced structure.
func (s *PostgresStore) loadModuleComponents(ctx context.Context, moduleID string) ([]domain.ComponentInstance, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT component_id, quantity, placement_override, length_formula, width_formula, overrides
		FROM module_components
		WHERE module_id = $1
		ORDER BY created_at ASC;
	`, moduleID)
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
			// Drop empty override bag (only zero-value fields).
			if ov.LengthFormula != "" || ov.WidthFormula != "" ||
				ov.XFormula != "" || ov.YFormula != "" || ov.ZFormula != "" ||
				len(ov.Edges) > 0 ||
				ov.RotateX != nil || ov.RotateY != nil || ov.RotateZ != nil {
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
// for module_components.overrides JSONB. Returns nil when nothing to store.
func componentInstanceOverridesJSON(ov *domain.ComponentInstanceOverrides) []byte {
	if ov == nil {
		return nil
	}
	if len(ov.Edges) == 0 &&
		ov.XFormula == "" && ov.YFormula == "" && ov.ZFormula == "" &&
		ov.RotateX == nil && ov.RotateY == nil && ov.RotateZ == nil {
		// length/width live in dedicated columns; empty bag → null
		return nil
	}
	// Marshal full overrides; omit empty string formulas via omitempty on domain tags.
	b, err := json.Marshal(ov)
	if err != nil {
		return nil
	}
	return b
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

	// Cargar módulos y su despiece
	query := `SELECT id, code, name, base_labor_cost, width_mm, height_mm, depth_mm, notes, category_id, image_url, structure_id FROM modules ORDER BY name ASC`
	rows, err := s.Pool.Query(ctx, query)
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
		err := rows.Scan(&m.ID, &m.Code, &m.Name, &m.BaseLaborCost, &w, &h, &d, &notes, &categoryID, &imageURL, &structureID)
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

		// Component instances placed directly on this module (F054).
		modComponents, err := s.loadModuleComponents(ctx, m.ID)
		if err != nil {
			return cat, err
		}
		m.Components = modComponents

		presets, err := s.loadModulePresets(ctx, m.ID)
		if err != nil {
			return cat, err
		}
		m.Presets = presets

		// Cargar board parts de este módulo
		partsQuery := `
			SELECT id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2
			FROM board_parts
			WHERE module_id = $1;
		`
		pRows, err := s.Pool.Query(ctx, partsQuery, m.ID)
		if err != nil {
			return cat, err
		}
		// defer immediately so early returns / scan errors cannot leak the cursor (#17).
		func() {
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
		}()

		// Cargar herrajes de este módulo
		hwQuery := `
			SELECT id, quantity, description_override, option_role, hardware_id
			FROM hardware_lines
			WHERE module_id = $1;
		`
		hRows, err := s.Pool.Query(ctx, hwQuery, m.ID)
		if err != nil {
			return cat, err
		}
		func() {
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
		}()

		if m.BoardParts == nil {
			m.BoardParts = []domain.BoardPart{}
		}
		if m.HardwareLines == nil {
			m.HardwareLines = []domain.HardwareLine{}
		}
		cat.Modules = append(cat.Modules, m)
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

// --- PROJECTS / QUOTATIONS ---

func (s *PostgresStore) ListProjects(ctx context.Context) ([]domain.Project, error) {
	query := `
		SELECT id, name, customer_id, created_by, owner_user_id, currency, margin_factor, labor_fixed_cost, status, notes, created_at, updated_at
		FROM projects
		ORDER BY updated_at DESC;
	`
	rows, err := s.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.Project
	for rows.Next() {
		var p domain.Project
		var createdBy *string
		var ownerID *string
		var notes *string
		err := rows.Scan(&p.ID, &p.Name, &p.CustomerID, &createdBy, &ownerID, &p.Currency, &p.MarginFactor, &p.LaborFixedCost, &p.Status, &notes, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			return nil, err
		}
		if createdBy != nil {
			p.CreatedBy = *createdBy
		}
		if ownerID != nil {
			p.OwnerUserID = *ownerID
		}
		if notes != nil {
			p.Notes = *notes
		}

		// Load items so FE reload keeps line items (calculate + UI depend on them).
		items, err := s.loadProjectItems(ctx, p.ID)
		if err != nil {
			return nil, err
		}
		p.Items = items
		level, err := s.loadProjectLevelChoices(ctx, p.ID)
		if err != nil {
			return nil, err
		}
		p.ProjectLevelChoices = level
		list = append(list, p)
	}
	if list == nil {
		list = []domain.Project{}
	}
	return list, nil
}

// loadProjectLevelChoices returns project-wide option defaults (F029).
func (s *PostgresStore) loadProjectLevelChoices(ctx context.Context, projectID string) (map[string]string, error) {
	query := `
		SELECT option_group_code, choice_entity_id
		FROM project_level_choices
		WHERE project_id = $1;
	`
	rows, err := s.Pool.Query(ctx, query, projectID)
	if err != nil {
		// Table may not exist yet on old DBs mid-migrate — treat as empty.
		return map[string]string{}, nil
	}
	defer rows.Close()
	out := make(map[string]string)
	for rows.Next() {
		var code, choiceID string
		if err := rows.Scan(&code, &choiceID); err == nil {
			out[code] = choiceID
		}
	}
	return out, nil
}

// replaceProjectLevelChoicesTx rewrites project-level option defaults.
func replaceProjectLevelChoicesTx(ctx context.Context, tx pgx.Tx, projectID string, choices map[string]string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM project_level_choices WHERE project_id = $1`, projectID); err != nil {
		return fmt.Errorf("error clearing project level choices: %w", err)
	}
	for code, cid := range choices {
		if strings.TrimSpace(code) == "" || strings.TrimSpace(cid) == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO project_level_choices (project_id, option_group_code, choice_entity_id)
			VALUES ($1, $2, $3)
		`, projectID, code, cid); err != nil {
			return fmt.Errorf("error inserting project level choice: %w", err)
		}
	}
	return nil
}

// loadModulePresets returns commercial measure presets for a module (H09).
func (s *PostgresStore) loadModulePresets(ctx context.Context, moduleID string) ([]domain.DimensionPreset, error) {
	q := `
		SELECT id, name, width_mm, height_mm, depth_mm
		FROM module_presets
		WHERE module_id = $1
		ORDER BY width_mm ASC, height_mm ASC, depth_mm ASC;
	`
	rows, err := s.Pool.Query(ctx, q, moduleID)
	if err != nil {
		return nil, fmt.Errorf("error query module presets: %w", err)
	}
	defer rows.Close()

	presets := []domain.DimensionPreset{}
	for rows.Next() {
		var pr domain.DimensionPreset
		if err := rows.Scan(&pr.ID, &pr.Name, &pr.WidthMm, &pr.HeightMm, &pr.DepthMm); err != nil {
			return nil, err
		}
		presets = append(presets, pr)
	}
	return presets, rows.Err()
}

func insertModulePresetsTx(ctx context.Context, tx pgx.Tx, moduleID string, presets []domain.DimensionPreset) error {
	if _, err := tx.Exec(ctx, `DELETE FROM module_presets WHERE module_id = $1`, moduleID); err != nil {
		return fmt.Errorf("error clearing module presets: %w", err)
	}
	for _, pr := range presets {
		var err error
		if pr.ID != "" {
			_, err = tx.Exec(ctx, `
				INSERT INTO module_presets (id, module_id, name, width_mm, height_mm, depth_mm)
				VALUES ($1, $2, $3, $4, $5, $6)
			`, pr.ID, moduleID, pr.Name, pr.WidthMm, pr.HeightMm, pr.DepthMm)
		} else {
			_, err = tx.Exec(ctx, `
				INSERT INTO module_presets (module_id, name, width_mm, height_mm, depth_mm)
				VALUES ($1, $2, $3, $4, $5)
			`, moduleID, pr.Name, pr.WidthMm, pr.HeightMm, pr.DepthMm)
		}
		if err != nil {
			return fmt.Errorf("error inserting module preset: %w", err)
		}
	}
	return nil
}

// loadProjectItems returns all line items + option choices for a project.
func (s *PostgresStore) loadProjectItems(ctx context.Context, projectID string) ([]domain.ProjectItem, error) {
	itemQuery := `
		SELECT id, module_id, quantity, measure_preset_id
		FROM project_items
		WHERE project_id = $1;
	`
	rows, err := s.Pool.Query(ctx, itemQuery, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []domain.ProjectItem{}
	for rows.Next() {
		var item domain.ProjectItem
		var measurePresetID *string
		if err := rows.Scan(&item.ID, &item.ModuleID, &item.Quantity, &measurePresetID); err != nil {
			return nil, err
		}
		if measurePresetID != nil {
			item.MeasurePresetID = *measurePresetID
		}

		choicesQuery := `
			SELECT option_group_code, choice_entity_id
			FROM project_item_choices
			WHERE project_item_id = $1;
		`
		cRows, err := s.Pool.Query(ctx, choicesQuery, item.ID)
		if err != nil {
			return nil, err
		}
		func() {
			defer cRows.Close()
			item.OptionChoices = make(map[string]string)
			for cRows.Next() {
				var code, choiceID string
				if err := cRows.Scan(&code, &choiceID); err == nil {
					item.OptionChoices[code] = choiceID
				}
			}
		}()

		items = append(items, item)
	}
	return items, nil
}

// replaceProjectItemsTx deletes existing items and inserts the payload set.
// Uses client-provided item ids when present so FE ids stay stable.
func replaceProjectItemsTx(ctx context.Context, tx pgx.Tx, projectID string, items []domain.ProjectItem) error {
	if _, err := tx.Exec(ctx, `DELETE FROM project_items WHERE project_id = $1`, projectID); err != nil {
		return fmt.Errorf("error clearing project items: %w", err)
	}
	for i := range items {
		item := &items[i]
		var err error
		measureArg := nullIfEmpty(item.MeasurePresetID)
		if item.ID != "" {
			_, err = tx.Exec(ctx, `
				INSERT INTO project_items (id, project_id, module_id, quantity, measure_preset_id)
				VALUES ($1, $2, $3, $4, $5)
			`, item.ID, projectID, item.ModuleID, item.Quantity, measureArg)
		} else {
			err = tx.QueryRow(ctx, `
				INSERT INTO project_items (project_id, module_id, quantity, measure_preset_id)
				VALUES ($1, $2, $3, $4)
				RETURNING id
			`, projectID, item.ModuleID, item.Quantity, measureArg).Scan(&item.ID)
		}
		if err != nil {
			return fmt.Errorf("error inserting project item: %w", err)
		}
		for gcode, cid := range item.OptionChoices {
			if _, err := tx.Exec(ctx, `
				INSERT INTO project_item_choices (project_item_id, option_group_code, choice_entity_id)
				VALUES ($1, $2, $3)
			`, item.ID, gcode, cid); err != nil {
				return fmt.Errorf("error inserting project item choice: %w", err)
			}
		}
	}
	return nil
}

func (s *PostgresStore) GetProjectByID(ctx context.Context, id string) (*domain.Project, error) {
	query := `
		SELECT id, name, customer_id, created_by, owner_user_id, currency, margin_factor, labor_fixed_cost, status, notes, created_at, updated_at
		FROM projects
		WHERE id = $1;
	`
	row := s.Pool.QueryRow(ctx, query, id)
	var p domain.Project
	var createdBy *string
	var ownerID *string
	var notes *string
	err := row.Scan(&p.ID, &p.Name, &p.CustomerID, &createdBy, &ownerID, &p.Currency, &p.MarginFactor, &p.LaborFixedCost, &p.Status, &notes, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if createdBy != nil {
		p.CreatedBy = *createdBy
	}
	if ownerID != nil {
		p.OwnerUserID = *ownerID
	}
	if notes != nil {
		p.Notes = *notes
	}

	items, err := s.loadProjectItems(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	p.Items = items

	level, err := s.loadProjectLevelChoices(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	p.ProjectLevelChoices = level

	// Cargar snapshot si existe
	snapQuery := `
		SELECT captured_at, materials_cost, edge_total, hardware_total, direct_cost, labor_modular, labor_fixed_cost, margin_factor, sale_price
		FROM quote_snapshots
		WHERE project_id = $1;
	`
	var snapshot domain.QuotePriceSnapshot
	err = s.Pool.QueryRow(ctx, snapQuery, p.ID).Scan(
		&snapshot.CapturedAt,
		&snapshot.Breakdown.MaterialsCost,
		&snapshot.Breakdown.EdgeTotal,
		&snapshot.Breakdown.HardwareTotal,
		&snapshot.Breakdown.DirectCost,
		&snapshot.Breakdown.LaborModular,
		&snapshot.Breakdown.LaborFixedCost,
		&snapshot.Breakdown.MarginFactor,
		&snapshot.Breakdown.SalePrice,
	)
	if err == nil {
		// Encontrado
		p.PriceSnapshot = &snapshot
		// Cargar precios unitarios congelados
		pricesQuery := `
			SELECT entity_type, entity_id, cost_value
			FROM snapshot_prices
			WHERE snapshot_id = (SELECT id FROM quote_snapshots WHERE project_id = $1);
		`
		spRows, err := s.Pool.Query(ctx, pricesQuery, p.ID)
		if err == nil {
			func() {
				defer spRows.Close()
				snapshot.MaterialCostPerM2 = make(map[string]float64)
				snapshot.EdgeCostPerMl = make(map[string]float64)
				snapshot.HardwareCostPerUnit = make(map[string]float64)
				for spRows.Next() {
					var etype, eid string
					var val float64
					if err := spRows.Scan(&etype, &eid, &val); err == nil {
						switch etype {
						case "material":
							snapshot.MaterialCostPerM2[eid] = val
						case "edge":
							snapshot.EdgeCostPerMl[eid] = val
						case "hardware":
							snapshot.HardwareCostPerUnit[eid] = val
						}
					}
				}
			}()
		}
	} else if !errors.Is(err, sql.ErrNoRows) && err.Error() != "no rows in result set" {
		// Error real, no "sin filas"
		return nil, err
	}

	return &p, nil
}

func (s *PostgresStore) CreateProject(ctx context.Context, p *domain.Project) error {
	var createdBy *string
	if p.CreatedBy != "" {
		createdBy = &p.CreatedBy
	}
	var owner *string
	if p.OwnerUserID != "" {
		owner = &p.OwnerUserID
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Prefer the client-provided id so the FE id stays stable (matches every
	// other Create* resource). Without this the DB generated its own id, the FE
	// kept the one it minted, and later calls (calculate, update) 404'd.
	if p.ID != "" {
		query := `
			INSERT INTO projects (id, name, customer_id, created_by, owner_user_id, currency, margin_factor, labor_fixed_cost, status, notes)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			RETURNING created_at, updated_at;
		`
		err = tx.QueryRow(ctx, query, p.ID, p.Name, p.CustomerID, createdBy, owner, p.Currency, p.MarginFactor, p.LaborFixedCost, p.Status, p.Notes).
			Scan(&p.CreatedAt, &p.UpdatedAt)
	} else {
		query := `
			INSERT INTO projects (name, customer_id, created_by, owner_user_id, currency, margin_factor, labor_fixed_cost, status, notes)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			RETURNING id, created_at, updated_at;
		`
		err = tx.QueryRow(ctx, query, p.Name, p.CustomerID, createdBy, owner, p.Currency, p.MarginFactor, p.LaborFixedCost, p.Status, p.Notes).
			Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt)
	}
	if err != nil {
		return fmt.Errorf("error creating project: %w", err)
	}

	if err := replaceProjectItemsTx(ctx, tx, p.ID, p.Items); err != nil {
		return err
	}
	if err := replaceProjectLevelChoicesTx(ctx, tx, p.ID, p.ProjectLevelChoices); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *PostgresStore) AddProjectItem(ctx context.Context, projectID string, item *domain.ProjectItem) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	query := `
		INSERT INTO project_items (project_id, module_id, quantity, measure_preset_id)
		VALUES ($1, $2, $3, $4)
		RETURNING id;
	`
	err = tx.QueryRow(ctx, query, projectID, item.ModuleID, item.Quantity, nullIfEmpty(item.MeasurePresetID)).Scan(&item.ID)
	if err != nil {
		return err
	}

	// Insertar choices
	for gcode, cid := range item.OptionChoices {
		choiceQuery := `
			INSERT INTO project_item_choices (project_item_id, option_group_code, choice_entity_id)
			VALUES ($1, $2, $3);
		`
		_, err = tx.Exec(ctx, choiceQuery, item.ID, gcode, cid)
		if err != nil {
			return err
		}
	}

	// Actualizar project updatedAt
	_, err = tx.Exec(ctx, `UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`, projectID)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *PostgresStore) RemoveProjectItem(ctx context.Context, projectID string, itemID string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `DELETE FROM project_items WHERE id = $1 AND project_id = $2`, itemID, projectID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`, projectID)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *PostgresStore) UpdateProject(ctx context.Context, id string, p *domain.Project) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var owner *string
	if p.OwnerUserID != "" {
		owner = &p.OwnerUserID
	}
	query := `
		UPDATE projects
		SET name = $1, customer_id = $2, currency = $3, margin_factor = $4, labor_fixed_cost = $5, status = $6, notes = $7,
		    owner_user_id = $8, updated_at = CURRENT_TIMESTAMP
		WHERE id = $9;
	`
	tag, err := tx.Exec(ctx, query, p.Name, p.CustomerID, p.Currency, p.MarginFactor, p.LaborFixedCost, p.Status, p.Notes, owner, id)
	if err != nil {
		return err
	}
	// Critical for FE upsert: PUT on a missing id must 404 so the client POSTs
	// create. Without this, Exec succeeds with 0 rows, upsert thinks the project
	// exists, calculate later 404s, and the row is never written.
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("project not found")
	}

	if err := replaceProjectItemsTx(ctx, tx, id, p.Items); err != nil {
		return err
	}
	if err := replaceProjectLevelChoicesTx(ctx, tx, id, p.ProjectLevelChoices); err != nil {
		return err
	}

	// Closed statuses freeze prices (quoted/accepted/produced — F036).
	if engine.IsProjectClosed(p.Status) {
		// Eliminar snapshot previo
		_, _ = tx.Exec(ctx, `DELETE FROM quote_snapshots WHERE project_id = $1`, id)

		if p.PriceSnapshot != nil {
			snapQuery := `
				INSERT INTO quote_snapshots (project_id, captured_at, materials_cost, edge_total, hardware_total, direct_cost, labor_modular, labor_fixed_cost, margin_factor, sale_price)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
				RETURNING id;
			`
			var snapID string
			err = tx.QueryRow(ctx, snapQuery, id, p.PriceSnapshot.CapturedAt,
				p.PriceSnapshot.Breakdown.MaterialsCost, p.PriceSnapshot.Breakdown.EdgeTotal, p.PriceSnapshot.Breakdown.HardwareTotal,
				p.PriceSnapshot.Breakdown.DirectCost, p.PriceSnapshot.Breakdown.LaborModular, p.PriceSnapshot.Breakdown.LaborFixedCost,
				p.PriceSnapshot.Breakdown.MarginFactor, p.PriceSnapshot.Breakdown.SalePrice).Scan(&snapID)
			if err != nil {
				return err
			}

			// Insertar precios unitarios congelados
			for mid, val := range p.PriceSnapshot.MaterialCostPerM2 {
				_, err = tx.Exec(ctx, `INSERT INTO snapshot_prices (snapshot_id, entity_type, entity_id, cost_value) VALUES ($1, 'material', $2, $3)`, snapID, mid, val)
				if err != nil {
					return err
				}
			}
			for eid, val := range p.PriceSnapshot.EdgeCostPerMl {
				_, err = tx.Exec(ctx, `INSERT INTO snapshot_prices (snapshot_id, entity_type, entity_id, cost_value) VALUES ($1, 'edge', $2, $3)`, snapID, eid, val)
				if err != nil {
					return err
				}
			}
			for hid, val := range p.PriceSnapshot.HardwareCostPerUnit {
				_, err = tx.Exec(ctx, `INSERT INTO snapshot_prices (snapshot_id, entity_type, entity_id, cost_value) VALUES ($1, 'hardware', $2, $3)`, snapID, hid, val)
				if err != nil {
					return err
				}
			}
		}
	} else {
		// Si vuelve a borrador, eliminar snapshot (descongelar)
		_, _ = tx.Exec(ctx, `DELETE FROM quote_snapshots WHERE project_id = $1`, id)
	}

	return tx.Commit(ctx)
}

func (s *PostgresStore) DeleteProject(ctx context.Context, id string) error {
	query := `DELETE FROM projects WHERE id = $1;`
	_, err := s.Pool.Exec(ctx, query, id)
	return err
}

func (s *PostgresStore) GetModuleByID(ctx context.Context, id string) (*domain.Module, error) {
	query := `SELECT id, code, name, base_labor_cost, width_mm, height_mm, depth_mm, notes, category_id, image_url, structure_id, created_at, updated_at FROM modules WHERE id = $1`
	row := s.Pool.QueryRow(ctx, query, id)
	var m domain.Module
	var w, h, d *int
	var notes *string
	var categoryID *string
	var imageURL *string
	var structureID *string
	err := row.Scan(&m.ID, &m.Code, &m.Name, &m.BaseLaborCost, &w, &h, &d, &notes, &categoryID, &imageURL, &structureID, &m.CreatedAt, &m.UpdatedAt)
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
	partsQuery := `SELECT id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2 FROM board_parts WHERE module_id = $1`
	pRows, err := s.Pool.Query(ctx, partsQuery, m.ID)
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
	hwQuery := `SELECT id, quantity, description_override, option_role, hardware_id FROM hardware_lines WHERE module_id = $1`
	hRows, err := s.Pool.Query(ctx, hwQuery, m.ID)
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
	tx, err := s.Pool.Begin(ctx)
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
	if idToInsert != "" {
		queryInsert = `
			INSERT INTO modules (id, code, name, base_labor_cost, width_mm, height_mm, depth_mm, notes, category_id, image_url, structure_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			RETURNING created_at, updated_at;
		`
		errQuery = tx.QueryRow(ctx, queryInsert, idToInsert, m.Code, m.Name, m.BaseLaborCost, m.WidthMm, m.HeightMm, m.DepthMm, m.Notes, categoryArg, m.ImageURL, structureArg).
			Scan(&m.CreatedAt, &m.UpdatedAt)
		m.ID = idToInsert
	} else {
		queryInsert = `
			INSERT INTO modules (code, name, base_labor_cost, width_mm, height_mm, depth_mm, notes, category_id, image_url, structure_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			RETURNING id, created_at, updated_at;
		`
		errQuery = tx.QueryRow(ctx, queryInsert, m.Code, m.Name, m.BaseLaborCost, m.WidthMm, m.HeightMm, m.DepthMm, m.Notes, categoryArg, m.ImageURL, structureArg).
			Scan(&m.ID, &m.CreatedAt, &m.UpdatedAt)
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
		if partID == "" {
			partQuery := `
				INSERT INTO board_parts (module_id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
				RETURNING id;
			`
			err = tx.QueryRow(ctx, partQuery, m.ID, p.Code, p.Description, p.Quantity, p.LengthMm, p.WidthMm, p.OptionRole, l1, l2, w1, w2).Scan(&p.ID)
		} else {
			partQuery := `
				INSERT INTO board_parts (id, module_id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
			`
			_, err = tx.Exec(ctx, partQuery, partID, m.ID, p.Code, p.Description, p.Quantity, p.LengthMm, p.WidthMm, p.OptionRole, l1, l2, w1, w2)
		}
		if err != nil {
			return fmt.Errorf("error inserting board part: %w", err)
		}
	}

	// Insertar HardwareLines
	for _, hl := range m.HardwareLines {
		var hwID interface{} = nil
		if hl.HardwareID != "" {
			hwID = hl.HardwareID
		}

		hlID := hl.ID
		if hlID == "" {
			hwLineQuery := `
				INSERT INTO hardware_lines (module_id, quantity, description_override, option_role, hardware_id)
				VALUES ($1, $2, $3, $4, $5)
				RETURNING id;
			`
			err = tx.QueryRow(ctx, hwLineQuery, m.ID, hl.Quantity, hl.DescriptionOverride, hl.OptionRole, hwID).Scan(&hl.ID)
		} else {
			hwLineQuery := `
				INSERT INTO hardware_lines (id, module_id, quantity, description_override, option_role, hardware_id)
				VALUES ($1, $2, $3, $4, $5, $6);
			`
			_, err = tx.Exec(ctx, hwLineQuery, hlID, m.ID, hl.Quantity, hl.DescriptionOverride, hl.OptionRole, hwID)
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
	if _, err := tx.Exec(ctx, `DELETE FROM module_components WHERE module_id = $1`, moduleID); err != nil {
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
			INSERT INTO module_components (module_id, component_id, quantity, placement_override, length_formula, width_formula, overrides)
			VALUES ($1, $2, $3, $4, $5, $6, $7);
		`, moduleID, c.ComponentID, c.Quantity, placementOverrideArg(c.PlacementOverride),
			lengthFormula, widthFormula, overridesJSON); err != nil {
			return fmt.Errorf("error inserting module component: %w", err)
		}
	}
	return nil
}

func (s *PostgresStore) UpdateModule(ctx context.Context, id string, m *domain.Module) error {
	tx, err := s.Pool.Begin(ctx)
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
	query := `
		UPDATE modules
		SET code = $1, name = $2, base_labor_cost = $3, width_mm = $4, height_mm = $5, depth_mm = $6, notes = $7, category_id = $8, image_url = $9, structure_id = $10, updated_at = CURRENT_TIMESTAMP
		WHERE id = $11
		RETURNING updated_at;
	`
	err = tx.QueryRow(ctx, query, m.Code, m.Name, m.BaseLaborCost, m.WidthMm, m.HeightMm, m.DepthMm, m.Notes, categoryArg, m.ImageURL, structureArg, id).Scan(&m.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("module not found")
		}
		return fmt.Errorf("error updating module: %w", err)
	}

	// Limpiar piezas y herrajes anteriores
	_, err = tx.Exec(ctx, `DELETE FROM board_parts WHERE module_id = $1`, id)
	if err != nil {
		return fmt.Errorf("error deleting board parts: %w", err)
	}
	_, err = tx.Exec(ctx, `DELETE FROM hardware_lines WHERE module_id = $1`, id)
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
		if partID == "" {
			partQuery := `
				INSERT INTO board_parts (module_id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
				RETURNING id;
			`
			err = tx.QueryRow(ctx, partQuery, id, p.Code, p.Description, p.Quantity, p.LengthMm, p.WidthMm, p.OptionRole, l1, l2, w1, w2).Scan(&p.ID)
		} else {
			partQuery := `
				INSERT INTO board_parts (id, module_id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
			`
			_, err = tx.Exec(ctx, partQuery, partID, id, p.Code, p.Description, p.Quantity, p.LengthMm, p.WidthMm, p.OptionRole, l1, l2, w1, w2)
		}
		if err != nil {
			return fmt.Errorf("error inserting board part: %w", err)
		}
	}

	// Insertar HardwareLines
	for _, hl := range m.HardwareLines {
		var hwID interface{} = nil
		if hl.HardwareID != "" {
			hwID = hl.HardwareID
		}
		hlID := hl.ID
		if hlID == "" {
			hwLineQuery := `
				INSERT INTO hardware_lines (module_id, quantity, description_override, option_role, hardware_id)
				VALUES ($1, $2, $3, $4, $5)
				RETURNING id;
			`
			err = tx.QueryRow(ctx, hwLineQuery, id, hl.Quantity, hl.DescriptionOverride, hl.OptionRole, hwID).Scan(&hl.ID)
		} else {
			hwLineQuery := `
				INSERT INTO hardware_lines (id, module_id, quantity, description_override, option_role, hardware_id)
				VALUES ($1, $2, $3, $4, $5, $6);
			`
			_, err = tx.Exec(ctx, hwLineQuery, hlID, id, hl.Quantity, hl.DescriptionOverride, hl.OptionRole, hwID)
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
	query := `DELETE FROM modules WHERE id = $1;`
	_, err := s.Pool.Exec(ctx, query, id)
	return err
}
