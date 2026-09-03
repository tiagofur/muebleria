package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

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
		ORDER BY created_at ASC;
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
// length/width formulas live in dedicated columns on module_components.
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

	agrs, _ := s.ListAgregados(ctx)
	cat.Agregados = agrs

	// Cargar módulos y su despiece
	query := `SELECT id, code, name, base_labor_cost, width_mm, height_mm, depth_mm, notes, category_id, image_url, structure_id, furniture_type, base_mode, base_clearance_mm, agregados, parameter_definitions FROM modules WHERE organization_id = $1 ORDER BY name ASC`
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
		err := rows.Scan(&m.ID, &m.Code, &m.Name, &m.BaseLaborCost, &w, &h, &d, &notes, &categoryID, &imageURL, &structureID, &furnitureType, &baseMode, &baseClearanceMm, &agrsRaw, &parameterDefinitionsRaw)
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
			_ = json.Unmarshal(agrsRaw, &m.Agregados)
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

// --- PROJECTS / QUOTATIONS ---

func (s *PostgresStore) ListProjects(ctx context.Context) ([]domain.Project, error) {
	query := `
		SELECT id, name, customer_id, created_by, owner_user_id, assigned_engineer_id, technical_status, survey_completed_at, installation_scheduled_date, currency, margin_factor, labor_fixed_cost, status, commercial_status, notes, kitchen_layout, plan_edit_session, installation_checklist, nesting_import, measure_defaults, engineering_log, materials_release, cut_plan, design_revisions, approvals, production_release, change_orders, organization_id, sales_organization_id, manufacturing_organization_id, created_at, updated_at
		FROM projects
		WHERE organization_id = $1 OR sales_organization_id = $1 OR manufacturing_organization_id = $1
		ORDER BY updated_at DESC;
	`
	rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.Project
	for rows.Next() {
		var p domain.Project
		var createdBy *string
		var ownerID *string
		var engineerID *string
		var techStatus *string
		var surveyCompletedAt *time.Time
		var installDate *string
		var commercialStatus *string
		var notes *string
		var kitchenLayout []byte
		var planEditSession []byte
		var installationChecklist []byte
		var nestingImport []byte
		var measureDefaults []byte
		var engineeringLog []byte
		var materialsRelease []byte
		var cutPlan []byte
		var designRevisions []byte
		var approvals []byte
		var productionRelease []byte
		var changeOrders []byte
		var orgID, salesOrgID, mfgOrgID *string
		err := rows.Scan(&p.ID, &p.Name, &p.CustomerID, &createdBy, &ownerID, &engineerID, &techStatus, &surveyCompletedAt, &installDate, &p.Currency, &p.MarginFactor, &p.LaborFixedCost, &p.Status, &commercialStatus, &notes, &kitchenLayout, &planEditSession, &installationChecklist, &nestingImport, &measureDefaults, &engineeringLog, &materialsRelease, &cutPlan, &designRevisions, &approvals, &productionRelease, &changeOrders, &orgID, &salesOrgID, &mfgOrgID, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			return nil, err
		}
		if orgID != nil {
			p.OrganizationID = *orgID
		}
		if salesOrgID != nil {
			p.SalesOrganizationID = *salesOrgID
		}
		if mfgOrgID != nil {
			p.ManufacturingOrganizationID = *mfgOrgID
		}
		if createdBy != nil {
			p.CreatedBy = *createdBy
		}
		if ownerID != nil {
			p.OwnerUserID = *ownerID
		}
		if engineerID != nil {
			p.AssignedEngineerID = *engineerID
		}
		if techStatus != nil {
			p.TechnicalStatus = *techStatus
		} else {
			p.TechnicalStatus = "pending_assignment"
		}
		if commercialStatus != nil && *commercialStatus != "" {
			cs := domain.CommercialStatus(*commercialStatus)
			p.CommercialStatus = &cs
		}
		p.SurveyCompletedAt = surveyCompletedAt
		p.InstallationScheduledDate = installDate
		if notes != nil {
			p.Notes = *notes
		}

		if len(kitchenLayout) > 0 && string(kitchenLayout) != "null" {
			p.KitchenLayout = kitchenLayout
		}
		if len(planEditSession) > 0 && string(planEditSession) != "null" {
			p.PlanEditSession = planEditSession
		}
		if len(installationChecklist) > 0 && string(installationChecklist) != "null" {
			p.InstallationChecklist = installationChecklist
		}
		if len(nestingImport) > 0 && string(nestingImport) != "null" {
			p.NestingImport = nestingImport
		}
		if len(measureDefaults) > 0 && string(measureDefaults) != "null" {
			p.MeasureDefaults = measureDefaults
		}
		if len(engineeringLog) > 0 && string(engineeringLog) != "null" {
			p.EngineeringLog = engineeringLog
		}
		if len(materialsRelease) > 0 && string(materialsRelease) != "null" {
			p.MaterialsRelease = materialsRelease
		}
		if len(cutPlan) > 0 && string(cutPlan) != "null" {
			p.CutPlan = cutPlan
		}
		if len(designRevisions) > 0 && string(designRevisions) != "null" {
			_ = json.Unmarshal(designRevisions, &p.DesignRevisions)
		}
		if len(approvals) > 0 && string(approvals) != "null" {
			_ = json.Unmarshal(approvals, &p.Approvals)
		}
		if len(productionRelease) > 0 && string(productionRelease) != "null" {
			var pr domain.ProductionRelease
			if err := json.Unmarshal(productionRelease, &pr); err == nil {
				p.ProductionRelease = &pr
			}
		}
		if len(changeOrders) > 0 && string(changeOrders) != "null" {
			_ = json.Unmarshal(changeOrders, &p.ChangeOrders)
		}

		list = append(list, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	for i := range list {
		// Tenant requests share one transaction and one pgx connection, so
		// dependent queries must run after the project cursor is closed.
		items, err := s.loadProjectItems(ctx, list[i].ID)
		if err != nil {
			return nil, err
		}
		list[i].Items = items
		level, err := s.loadProjectLevelChoices(ctx, list[i].ID)
		if err != nil {
			return nil, err
		}
		list[i].ProjectLevelChoices = level
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
	rows, err := s.db(ctx).Query(ctx, query, projectID)
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
			INSERT INTO project_level_choices (project_id, option_group_code, choice_entity_id, organization_id)
			VALUES ($1, $2, $3, $4)
		`, projectID, code, cid, OrgFromCtx(ctx)); err != nil {
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
		WHERE module_id = $1 AND organization_id = $2
		ORDER BY width_mm ASC, height_mm ASC, depth_mm ASC;
	`
	rows, err := s.db(ctx).Query(ctx, q, moduleID, OrgFromCtx(ctx))
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
	if _, err := tx.Exec(ctx, `DELETE FROM module_presets WHERE module_id = $1 AND organization_id = $2`, moduleID, OrgFromCtx(ctx)); err != nil {
		return fmt.Errorf("error clearing module presets: %w", err)
	}
	for _, pr := range presets {
		var err error
		if pr.ID != "" && isValidUUID(pr.ID) {
			_, err = tx.Exec(ctx, `
				INSERT INTO module_presets (id, module_id, name, width_mm, height_mm, depth_mm, organization_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
			`, pr.ID, moduleID, pr.Name, pr.WidthMm, pr.HeightMm, pr.DepthMm, OrgFromCtx(ctx))
		} else {
			_, err = tx.Exec(ctx, `
				INSERT INTO module_presets (module_id, name, width_mm, height_mm, depth_mm, organization_id)
				VALUES ($1, $2, $3, $4, $5, $6)
			`, moduleID, pr.Name, pr.WidthMm, pr.HeightMm, pr.DepthMm, OrgFromCtx(ctx))
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
		SELECT id, module_id, quantity, measure_preset_id, structure_revision_pin, base_mode, floor_status, custom_dims
		FROM project_items
		WHERE project_id = $1;
	`
	rows, err := s.db(ctx).Query(ctx, itemQuery, projectID)
	if err != nil {
		return nil, err
	}

	items := []domain.ProjectItem{}
	// Buffer the item rows before loading per-item choices: this repository
	// also runs inside the request-scoped tenant transaction (one
	// connection), where an open result set makes nested queries fail with
	// "conn busy".
	for rows.Next() {
		var item domain.ProjectItem
		var measurePresetID *string
		var structureRevisionPin *int
		var floorStatus *string
		var customDims []byte
		if err := rows.Scan(&item.ID, &item.ModuleID, &item.Quantity, &measurePresetID, &structureRevisionPin, &item.BaseMode, &floorStatus, &customDims); err != nil {
			rows.Close()
			return nil, err
		}
		// F144: custom_dims JSONB → *ItemCustomDims (NULL/{} = nil → preset).
		if len(customDims) > 0 && string(customDims) != "null" {
			var dims domain.ItemCustomDims
			if err := json.Unmarshal(customDims, &dims); err != nil {
				rows.Close()
				return nil, fmt.Errorf("invalid custom_dims for item %s: %w", item.ID, err)
			}
			item.CustomDims = &dims
		}
		if measurePresetID != nil {
			item.MeasurePresetID = *measurePresetID
		}
		if floorStatus != nil {
			item.FloorStatus = domain.NormalizeItemFloorStatus(*floorStatus)
		}
		if structureRevisionPin != nil {
			pin := *structureRevisionPin
			item.StructureRevisionPin = &pin
		}
		items = append(items, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for i := range items {
		choicesQuery := `
			SELECT option_group_code, choice_entity_id
			FROM project_item_choices
			WHERE project_item_id = $1;
		`
		cRows, err := s.db(ctx).Query(ctx, choicesQuery, items[i].ID)
		if err != nil {
			return nil, err
		}
		func() {
			defer cRows.Close()
			items[i].OptionChoices = make(map[string]string)
			for cRows.Next() {
				var code, choiceID string
				if err := cRows.Scan(&code, &choiceID); err == nil {
					items[i].OptionChoices[code] = choiceID
				}
			}
		}()
	}
	return items, nil
}

// replaceProjectItemsTx deletes existing items and inserts the payload set.
// Uses client-provided item ids when present so FE ids stay stable.
func replaceProjectItemsTx(ctx context.Context, tx pgx.Tx, projectID string, items []domain.ProjectItem) error {
	// #386: a quote line that still represents materialized furniture
	// instances may not disappear through a generic item replace — retiring
	// the linkage is an explicit command. The deferred quote-line FK is the
	// structural backstop; this check fails loud with a typed error first.
	materialized, err := quoteLinesStillMaterializedTx(ctx, tx, projectID)
	if err != nil {
		return err
	}
	if len(materialized) > 0 {
		kept := make(map[string]struct{}, len(items))
		for i := range items {
			if items[i].ID != "" {
				kept[items[i].ID] = struct{}{}
			}
		}
		for _, lineID := range materialized {
			if _, ok := kept[lineID]; !ok {
				return domain.ErrQuoteLineStillMaterialized
			}
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM project_items WHERE project_id = $1`, projectID); err != nil {
		return fmt.Errorf("error clearing project items: %w", err)
	}
	for i := range items {
		item := &items[i]
		var err error
		measureArg := nullIfEmpty(item.MeasurePresetID)
		pinArg := structurePinArg(item.StructureRevisionPin)
		baseModeArg := item.BaseMode
		floorArg := nullIfEmpty(item.FloorStatus)
		customDimsArg, err := customDimsArg(item.CustomDims)
		if err != nil {
			return fmt.Errorf("invalid custom_dims for item %s: %w", item.ID, err)
		}
		if item.ID != "" {
			_, err = tx.Exec(ctx, `
				INSERT INTO project_items (id, project_id, module_id, quantity, measure_preset_id, structure_revision_pin, base_mode, floor_status, custom_dims, organization_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			`, item.ID, projectID, item.ModuleID, item.Quantity, measureArg, pinArg, baseModeArg, floorArg, customDimsArg, OrgFromCtx(ctx))
		} else {
			err = tx.QueryRow(ctx, `
				INSERT INTO project_items (project_id, module_id, quantity, measure_preset_id, structure_revision_pin, base_mode, floor_status, custom_dims, organization_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
				RETURNING id
			`, projectID, item.ModuleID, item.Quantity, measureArg, pinArg, baseModeArg, floorArg, customDimsArg, OrgFromCtx(ctx)).Scan(&item.ID)
		}
		if err != nil {
			return fmt.Errorf("error inserting project item: %w", err)
		}
		for gcode, cid := range item.OptionChoices {
			if _, err := tx.Exec(ctx, `
				INSERT INTO project_item_choices (project_item_id, option_group_code, choice_entity_id, organization_id)
				VALUES ($1, $2, $3, $4)
			`, item.ID, gcode, cid, OrgFromCtx(ctx)); err != nil {
				return fmt.Errorf("error inserting project item choice: %w", err)
			}
		}
	}
	return nil
}

// customDimsArg marshals the per-item dims override into a JSONB argument
// (nil when unset, so the column stays NULL and the item resolves by preset).
func customDimsArg(dims *domain.ItemCustomDims) (interface{}, error) {
	if dims == nil {
		return nil, nil
	}
	raw, err := json.Marshal(dims)
	if err != nil {
		return nil, err
	}
	return raw, nil
}

// structurePinArg converts a *int pin into a pgx-compatible argument (nil when
// unset, so the column stays NULL and the item resolves live).
func structurePinArg(pin *int) interface{} {
	if pin == nil {
		return nil
	}
	return *pin
}

func (s *PostgresStore) GetProjectByID(ctx context.Context, id string) (*domain.Project, error) {
	query := `
		SELECT id, name, customer_id, created_by, owner_user_id, assigned_engineer_id, technical_status, survey_completed_at, installation_scheduled_date, currency, margin_factor, labor_fixed_cost, status, commercial_status, notes, kitchen_layout, plan_edit_session, installation_checklist, nesting_import, measure_defaults, engineering_log, materials_release, cut_plan, design_revisions, approvals, production_release, change_orders, part_instances, module_units, installation, material_planning, quality, costing, site_survey, organization_id, sales_organization_id, manufacturing_organization_id, created_at, updated_at
		FROM projects
		WHERE id = $1 AND (organization_id = $2 OR sales_organization_id = $2 OR manufacturing_organization_id = $2);
	`
	row := s.db(ctx).QueryRow(ctx, query, id, OrgFromCtx(ctx))
	var p domain.Project
	var createdBy *string
	var ownerID *string
	var engineerID *string
	var techStatus *string
	var surveyCompletedAt *time.Time
	var installDate *string
	var commercialStatus *string
	var notes *string
	var kitchenLayout []byte
	var planEditSession []byte
	var installationChecklist []byte
	var nestingImport []byte
	var measureDefaults []byte
	var engineeringLog []byte
	var materialsRelease []byte
	var cutPlan []byte
	var designRevisions []byte
	var approvals []byte
	var productionRelease []byte
	var changeOrders []byte
	var partInstances []byte
	var moduleUnits []byte
	var installation []byte
	var materialPlanning []byte
	var quality []byte
	var costing []byte
	var siteSurvey []byte
	var orgID, salesOrgID, mfgOrgID *string
	err := row.Scan(&p.ID, &p.Name, &p.CustomerID, &createdBy, &ownerID, &engineerID, &techStatus, &surveyCompletedAt, &installDate, &p.Currency, &p.MarginFactor, &p.LaborFixedCost, &p.Status, &commercialStatus, &notes, &kitchenLayout, &planEditSession, &installationChecklist, &nestingImport, &measureDefaults, &engineeringLog, &materialsRelease, &cutPlan, &designRevisions, &approvals, &productionRelease, &changeOrders, &partInstances, &moduleUnits, &installation, &materialPlanning, &quality, &costing, &siteSurvey, &orgID, &salesOrgID, &mfgOrgID, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if orgID != nil {
		p.OrganizationID = *orgID
	}
	if salesOrgID != nil {
		p.SalesOrganizationID = *salesOrgID
	}
	if mfgOrgID != nil {
		p.ManufacturingOrganizationID = *mfgOrgID
	}
	if createdBy != nil {
		p.CreatedBy = *createdBy
	}
	if ownerID != nil {
		p.OwnerUserID = *ownerID
	}
	if engineerID != nil {
		p.AssignedEngineerID = *engineerID
	}
	if techStatus != nil {
		p.TechnicalStatus = *techStatus
	} else {
		p.TechnicalStatus = "pending_assignment"
	}
	if commercialStatus != nil && *commercialStatus != "" {
		cs := domain.CommercialStatus(*commercialStatus)
		p.CommercialStatus = &cs
	}
	p.SurveyCompletedAt = surveyCompletedAt
	p.InstallationScheduledDate = installDate
	if notes != nil {
		p.Notes = *notes
	}

	if len(kitchenLayout) > 0 && string(kitchenLayout) != "null" {
		p.KitchenLayout = kitchenLayout
	}
	if len(planEditSession) > 0 && string(planEditSession) != "null" {
		p.PlanEditSession = planEditSession
	}
	if len(installationChecklist) > 0 && string(installationChecklist) != "null" {
		p.InstallationChecklist = installationChecklist
	}
	if len(nestingImport) > 0 && string(nestingImport) != "null" {
		p.NestingImport = nestingImport
	}
	if len(measureDefaults) > 0 && string(measureDefaults) != "null" {
		p.MeasureDefaults = measureDefaults
	}
	if len(engineeringLog) > 0 && string(engineeringLog) != "null" {
		p.EngineeringLog = engineeringLog
	}
	if len(materialsRelease) > 0 && string(materialsRelease) != "null" {
		p.MaterialsRelease = materialsRelease
	}
	if len(cutPlan) > 0 && string(cutPlan) != "null" {
		p.CutPlan = cutPlan
	}
	if len(designRevisions) > 0 && string(designRevisions) != "null" {
		_ = json.Unmarshal(designRevisions, &p.DesignRevisions)
	}
	if len(approvals) > 0 && string(approvals) != "null" {
		_ = json.Unmarshal(approvals, &p.Approvals)
	}
	if len(productionRelease) > 0 && string(productionRelease) != "null" {
		var pr domain.ProductionRelease
		if err := json.Unmarshal(productionRelease, &pr); err == nil {
			p.ProductionRelease = &pr
		}
	}
	if len(changeOrders) > 0 && string(changeOrders) != "null" {
		_ = json.Unmarshal(changeOrders, &p.ChangeOrders)
	}
	if len(partInstances) > 0 && string(partInstances) != "null" {
		_ = json.Unmarshal(partInstances, &p.PartInstances)
	}
	if len(moduleUnits) > 0 && string(moduleUnits) != "null" {
		_ = json.Unmarshal(moduleUnits, &p.ModuleUnits)
	}
	if len(installation) > 0 && string(installation) != "null" {
		var job domain.InstallationJob
		if err := json.Unmarshal(installation, &job); err == nil {
			p.Installation = &job
		}
	}
	if len(materialPlanning) > 0 && string(materialPlanning) != "null" {
		var planning domain.MaterialPlanning
		if err := json.Unmarshal(materialPlanning, &planning); err == nil {
			p.MaterialPlanning = &planning
		}
	}
	if len(quality) > 0 && string(quality) != "null" {
		var job domain.QualityJob
		if err := json.Unmarshal(quality, &job); err == nil {
			p.Quality = &job
		}
	}
	if len(costing) > 0 && string(costing) != "null" {
		var costingJob domain.JobCosting
		if err := json.Unmarshal(costing, &costingJob); err == nil {
			p.Costing = &costingJob
		}
	}
	if len(siteSurvey) > 0 && string(siteSurvey) != "null" {
		var survey domain.SiteSurvey
		if err := json.Unmarshal(siteSurvey, &survey); err == nil {
			p.SiteSurvey = &survey
		}
	}

	items, err := s.loadProjectItems(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	p.Items = items

	// F092 — shop-floor log travels with the project detail.
	events, err := s.ListFloorEvents(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	p.FloorEvents = events

	// OC-010 — lifecycle event log travels with project detail.
	projEvents, err := s.ListProjectEvents(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	p.Events = projEvents

	level, err := s.loadProjectLevelChoices(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	p.ProjectLevelChoices = level

	// Cargar snapshot si existe
	snapQuery := `
		SELECT captured_at, materials_cost, edge_total, hardware_total, direct_cost, labor_modular, labor_fixed_cost, margin_factor, sale_price
		FROM quote_snapshots
		WHERE project_id = $1 AND organization_id = $2;
	`
	var snapshot domain.QuotePriceSnapshot
	err = s.db(ctx).QueryRow(ctx, snapQuery, p.ID, OrgFromCtx(ctx)).Scan(
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
		spRows, err := s.db(ctx).Query(ctx, pricesQuery, p.ID)
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
	var engineer *string
	if p.AssignedEngineerID != "" {
		engineer = &p.AssignedEngineerID
	}
	techStatus := p.TechnicalStatus
	if techStatus == "" {
		techStatus = "pending_assignment"
	}

	salesOrg := p.SalesOrganizationID
	if salesOrg == "" {
		salesOrg = OrgFromCtx(ctx)
	}
	mfgOrg := p.ManufacturingOrganizationID
	if mfgOrg == "" {
		mfgOrg = OrgFromCtx(ctx)
	}
	p.SalesOrganizationID = salesOrg
	p.ManufacturingOrganizationID = mfgOrg
	p.OrganizationID = OrgFromCtx(ctx)

	tx, err := s.beginTx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Prefer the client-provided id so the FE id stays stable (matches every
	// other Create* resource). Without this the DB generated its own id, the FE
	// kept the one it minted, and later calls (calculate, update) 404'd.
	if p.ID != "" {
		query := `
			INSERT INTO projects (id, name, customer_id, created_by, owner_user_id, assigned_engineer_id, technical_status, survey_completed_at, installation_scheduled_date, currency, margin_factor, labor_fixed_cost, status, commercial_status, notes, kitchen_layout, plan_edit_session, installation_checklist, nesting_import, measure_defaults, engineering_log, materials_release, cut_plan, design_revisions, approvals, production_release, change_orders, part_instances, module_units, organization_id, sales_organization_id, manufacturing_organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
			RETURNING created_at, updated_at;
		`
		err = tx.QueryRow(ctx, query, p.ID, p.Name, p.CustomerID, createdBy, owner, engineer, techStatus, p.SurveyCompletedAt, p.InstallationScheduledDate, p.Currency, p.MarginFactor, p.LaborFixedCost, p.Status, commercialStatusArg(p.CommercialStatus), p.Notes, nullKitchenLayout(p.KitchenLayout), nullKitchenLayout(p.PlanEditSession), nullKitchenLayout(p.InstallationChecklist), nullKitchenLayout(p.NestingImport), nullKitchenLayout(p.MeasureDefaults), nullKitchenLayout(p.EngineeringLog), nullKitchenLayout(p.MaterialsRelease), nullKitchenLayout(p.CutPlan), jsonbSliceArg(p.DesignRevisions), jsonbSliceArg(p.Approvals), jsonbStructArg(p.ProductionRelease), jsonbSliceArg(p.ChangeOrders), jsonbSliceArg(p.PartInstances), jsonbSliceArg(p.ModuleUnits), OrgFromCtx(ctx), salesOrg, mfgOrg).
			Scan(&p.CreatedAt, &p.UpdatedAt)
	} else {
		query := `
			INSERT INTO projects (name, customer_id, created_by, owner_user_id, assigned_engineer_id, technical_status, survey_completed_at, installation_scheduled_date, currency, margin_factor, labor_fixed_cost, status, commercial_status, notes, kitchen_layout, plan_edit_session, installation_checklist, nesting_import, measure_defaults, engineering_log, materials_release, cut_plan, design_revisions, approvals, production_release, change_orders, part_instances, module_units, organization_id, sales_organization_id, manufacturing_organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31)
			RETURNING id, created_at, updated_at;
		`
		err = tx.QueryRow(ctx, query, p.Name, p.CustomerID, createdBy, owner, engineer, techStatus, p.SurveyCompletedAt, p.InstallationScheduledDate, p.Currency, p.MarginFactor, p.LaborFixedCost, p.Status, commercialStatusArg(p.CommercialStatus), p.Notes, nullKitchenLayout(p.KitchenLayout), nullKitchenLayout(p.PlanEditSession), nullKitchenLayout(p.InstallationChecklist), nullKitchenLayout(p.NestingImport), nullKitchenLayout(p.MeasureDefaults), nullKitchenLayout(p.EngineeringLog), nullKitchenLayout(p.MaterialsRelease), nullKitchenLayout(p.CutPlan), jsonbSliceArg(p.DesignRevisions), jsonbSliceArg(p.Approvals), jsonbStructArg(p.ProductionRelease), jsonbSliceArg(p.ChangeOrders), jsonbSliceArg(p.PartInstances), jsonbSliceArg(p.ModuleUnits), OrgFromCtx(ctx), salesOrg, mfgOrg).
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
	if err := upsertFloorEventsTx(ctx, tx, p.ID, p.FloorEvents); err != nil {
		return err
	}
	if err := upsertProjectEventsTx(ctx, tx, p.ID, p.Events); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *PostgresStore) AddProjectItem(ctx context.Context, projectID string, item *domain.ProjectItem) error {
	tx, err := s.beginTx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	query := `
		INSERT INTO project_items (project_id, module_id, quantity, measure_preset_id, structure_revision_pin, base_mode, floor_status, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id;
	`
	err = tx.QueryRow(ctx, query, projectID, item.ModuleID, item.Quantity, nullIfEmpty(item.MeasurePresetID), structurePinArg(item.StructureRevisionPin), item.BaseMode, nullIfEmpty(item.FloorStatus), OrgFromCtx(ctx)).Scan(&item.ID)
	if err != nil {
		return err
	}

	// Insertar choices
	for gcode, cid := range item.OptionChoices {
		choiceQuery := `
			INSERT INTO project_item_choices (project_item_id, option_group_code, choice_entity_id, organization_id)
			VALUES ($1, $2, $3, $4);
		`
		_, err = tx.Exec(ctx, choiceQuery, item.ID, gcode, cid, OrgFromCtx(ctx))
		if err != nil {
			return err
		}
	}

	// Actualizar project updatedAt
	_, err = tx.Exec(ctx, `UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND (organization_id = $2 OR sales_organization_id = $2 OR manufacturing_organization_id = $2)`, projectID, OrgFromCtx(ctx))
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *PostgresStore) RemoveProjectItem(ctx context.Context, projectID string, itemID string) error {
	tx, err := s.beginTx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// #386: deleting a quote line that still represents materialized
	// furniture instances must fail loud with a typed error instead of
	// tripping the deferred quote-line FK at COMMIT.
	materialized, err := quoteLinesStillMaterializedTx(ctx, tx, projectID)
	if err != nil {
		return err
	}
	for _, lineID := range materialized {
		if lineID == itemID {
			return domain.ErrQuoteLineStillMaterialized
		}
	}

	_, err = tx.Exec(ctx, `DELETE FROM project_items WHERE id = $1 AND project_id = $2`, itemID, projectID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND (organization_id = $2 OR sales_organization_id = $2 OR manufacturing_organization_id = $2)`, projectID, OrgFromCtx(ctx))
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *PostgresStore) UpdateProject(ctx context.Context, id string, p *domain.Project) error {
	tx, err := s.beginTx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var owner *string
	if p.OwnerUserID != "" {
		owner = &p.OwnerUserID
	}
	var engineer *string
	if p.AssignedEngineerID != "" {
		engineer = &p.AssignedEngineerID
	}
	techStatus := p.TechnicalStatus
	if techStatus == "" {
		techStatus = "pending_assignment"
	}
	// #327: sales/manufacturing ownership is NOT writable through the generic
	// update — it is assigned at create (validated against the caller's
	// memberships) and reassignment needs a dedicated audited flow.
	query := `
		UPDATE projects
		SET name = $1, customer_id = $2, currency = $3, margin_factor = $4, labor_fixed_cost = $5, status = $6, commercial_status = $7, notes = $8,
		    owner_user_id = $9, assigned_engineer_id = $10, technical_status = $11, survey_completed_at = $12, installation_scheduled_date = $13,
		    kitchen_layout = $14, plan_edit_session = $15, installation_checklist = $16, nesting_import = $17, measure_defaults = $18, engineering_log = $19, cut_plan = $20,
		    design_revisions = $21, approvals = $22, production_release = $23, change_orders = $24, part_instances = $25, module_units = $26,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $27 AND (organization_id = $28 OR sales_organization_id = $28 OR manufacturing_organization_id = $28);
	`
	tag, err := tx.Exec(ctx, query, p.Name, p.CustomerID, p.Currency, p.MarginFactor, p.LaborFixedCost, p.Status, commercialStatusArg(p.CommercialStatus), p.Notes, owner, engineer, techStatus, p.SurveyCompletedAt, p.InstallationScheduledDate, nullKitchenLayout(p.KitchenLayout), nullKitchenLayout(p.PlanEditSession), nullKitchenLayout(p.InstallationChecklist), nullKitchenLayout(p.NestingImport), nullKitchenLayout(p.MeasureDefaults), nullKitchenLayout(p.EngineeringLog), nullKitchenLayout(p.CutPlan), jsonbSliceArg(p.DesignRevisions), jsonbSliceArg(p.Approvals), jsonbStructArg(p.ProductionRelease), jsonbSliceArg(p.ChangeOrders), jsonbSliceArg(p.PartInstances), jsonbSliceArg(p.ModuleUnits), id, OrgFromCtx(ctx))
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
	if err := upsertFloorEventsTx(ctx, tx, id, p.FloorEvents); err != nil {
		return err
	}
	if err := upsertProjectEventsTx(ctx, tx, id, p.Events); err != nil {
		return err
	}
	if err := replaceProjectLevelChoicesTx(ctx, tx, id, p.ProjectLevelChoices); err != nil {
		return err
	}

	// Closed statuses freeze prices (quoted/accepted/produced — F036).
	if engine.IsProjectClosed(p.Status) {
		// Eliminar snapshot previo
		if _, err := tx.Exec(ctx, `DELETE FROM quote_snapshots WHERE project_id = $1`, id); err != nil {
			return fmt.Errorf("delete previous quote snapshot: %w", err)
		}

		if p.PriceSnapshot != nil {
			snapQuery := `
				INSERT INTO quote_snapshots (project_id, captured_at, materials_cost, edge_total, hardware_total, direct_cost, labor_modular, labor_fixed_cost, margin_factor, sale_price, organization_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
				RETURNING id;
			`
			var snapID string
			err = tx.QueryRow(ctx, snapQuery, id, p.PriceSnapshot.CapturedAt,
				p.PriceSnapshot.Breakdown.MaterialsCost, p.PriceSnapshot.Breakdown.EdgeTotal, p.PriceSnapshot.Breakdown.HardwareTotal,
				p.PriceSnapshot.Breakdown.DirectCost, p.PriceSnapshot.Breakdown.LaborModular, p.PriceSnapshot.Breakdown.LaborFixedCost,
				p.PriceSnapshot.Breakdown.MarginFactor, p.PriceSnapshot.Breakdown.SalePrice, OrgFromCtx(ctx)).Scan(&snapID)
			if err != nil {
				return err
			}

			// Insertar precios unitarios congelados
			for mid, val := range p.PriceSnapshot.MaterialCostPerM2 {
				_, err = tx.Exec(ctx, `INSERT INTO snapshot_prices (snapshot_id, entity_type, entity_id, cost_value, organization_id) VALUES ($1, 'material', $2, $3, $4)`, snapID, mid, val, OrgFromCtx(ctx))
				if err != nil {
					return err
				}
			}
			for eid, val := range p.PriceSnapshot.EdgeCostPerMl {
				_, err = tx.Exec(ctx, `INSERT INTO snapshot_prices (snapshot_id, entity_type, entity_id, cost_value, organization_id) VALUES ($1, 'edge', $2, $3, $4)`, snapID, eid, val, OrgFromCtx(ctx))
				if err != nil {
					return err
				}
			}
			for hid, val := range p.PriceSnapshot.HardwareCostPerUnit {
				_, err = tx.Exec(ctx, `INSERT INTO snapshot_prices (snapshot_id, entity_type, entity_id, cost_value, organization_id) VALUES ($1, 'hardware', $2, $3, $4)`, snapID, hid, val, OrgFromCtx(ctx))
				if err != nil {
					return err
				}
			}
		}
	} else {
		// Si vuelve a borrador, eliminar snapshot (descongelar)
		if _, err := tx.Exec(ctx, `DELETE FROM quote_snapshots WHERE project_id = $1`, id); err != nil {
			return fmt.Errorf("delete quote snapshot: %w", err)
		}
	}

	return tx.Commit(ctx)
}

func (s *PostgresStore) DeleteProject(ctx context.Context, id string) error {
	query := `DELETE FROM projects WHERE id = $1 AND (organization_id = $2 OR sales_organization_id = $2);`
	tag, err := s.db(ctx).Exec(ctx, query, id, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("project not found")
	}
	return nil
}

// ListModules returns the workshop's furniture modules with their measure
// presets, skipping the heavy per-module children (board parts, hardware
// lines, component instances). It backs catalog projections such as the
// SketchUp furniture/definitions endpoint; anything needing the full
// despiece must use GetFullCatalog or GetModuleByID instead.
func (s *PostgresStore) ListModules(ctx context.Context) ([]domain.Module, error) {
	query := `
		SELECT id, code, name, width_mm, height_mm, depth_mm, notes, category_id,
		       furniture_type, base_mode, base_clearance_mm, image_url, structure_id, agregados, parameter_definitions
		FROM modules
		WHERE organization_id = $1
		ORDER BY name ASC;
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
			&furnitureType, &baseMode, &baseClearanceMm, &imageURL, &structureID, &agrsRaw, &parameterDefinitionsRaw)
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
		ORDER BY created_at ASC;
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
		ORDER BY width_mm ASC, height_mm ASC, depth_mm ASC;
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
	query := `SELECT id, code, name, base_labor_cost, width_mm, height_mm, depth_mm, notes, category_id, image_url, structure_id, furniture_type, base_mode, base_clearance_mm, agregados, parameter_definitions, created_at, updated_at FROM modules WHERE id = $1 AND organization_id = $2`
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
	err := row.Scan(&m.ID, &m.Code, &m.Name, &m.BaseLaborCost, &w, &h, &d, &notes, &categoryID, &imageURL, &structureID, &furnitureType, &baseMode, &baseClearanceMm, &agrsRaw, &parameterDefinitionsRaw, &m.CreatedAt, &m.UpdatedAt)
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
			RETURNING created_at, updated_at;
		`
		errQuery = tx.QueryRow(ctx, queryInsert, idToInsert, m.Code, m.Name, m.BaseLaborCost, m.WidthMm, m.HeightMm, m.DepthMm, m.Notes, categoryArg, m.ImageURL, structureArg, m.FurnitureType, m.BaseMode, baseClearanceArg, agrsJSON, parameterDefinitionsJSON, OrgFromCtx(ctx)).
			Scan(&m.CreatedAt, &m.UpdatedAt)
		m.ID = idToInsert
	} else {
		queryInsert = `
			INSERT INTO modules (code, name, base_labor_cost, width_mm, height_mm, depth_mm, notes, category_id, image_url, structure_id, furniture_type, base_mode, base_clearance_mm, agregados, parameter_definitions, organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
			RETURNING id, created_at, updated_at;
		`
		errQuery = tx.QueryRow(ctx, queryInsert, m.Code, m.Name, m.BaseLaborCost, m.WidthMm, m.HeightMm, m.DepthMm, m.Notes, categoryArg, m.ImageURL, structureArg, m.FurnitureType, m.BaseMode, baseClearanceArg, agrsJSON, parameterDefinitionsJSON, OrgFromCtx(ctx)).
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

func (s *PostgresStore) UpdateModule(ctx context.Context, id string, m *domain.Module) error {
	if issues := domain.ValidatePersistedFurnitureParameterDefinitions(m.ParameterDefinitions); len(issues) > 0 {
		return &domain.FurnitureParameterDefinitionsError{Issues: issues}
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
		SET code = $1, name = $2, base_labor_cost = $3, width_mm = $4, height_mm = $5, depth_mm = $6, notes = $7, category_id = $8, image_url = $9, structure_id = $10, furniture_type = $11, base_mode = $12, base_clearance_mm = $13, agregados = $14, parameter_definitions = $15, updated_at = CURRENT_TIMESTAMP
		WHERE id = $16 AND organization_id = $17
		RETURNING updated_at;
	`
	err = tx.QueryRow(ctx, query, m.Code, m.Name, m.BaseLaborCost, m.WidthMm, m.HeightMm, m.DepthMm, m.Notes, categoryArg, m.ImageURL, structureArg, m.FurnitureType, m.BaseMode, baseClearanceArg, agrsJSON, parameterDefinitionsJSON, id, OrgFromCtx(ctx)).Scan(&m.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("module not found")
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

// SetProjectItemFloorStatus atomically advances one item's shop-floor status
// (PROD-3.1 / F089-RN). Single-row UPDATE — no full project rewrite, so a
// phone scan can never clobber concurrent edits elsewhere in the project.
func (s *PostgresStore) SetProjectItemFloorStatus(ctx context.Context, projectID, itemID, status string) error {
	if !isValidItemFloorStatus(status) {
		return fmt.Errorf("invalid floor status %q", status)
	}
	tag, err := s.db(ctx).Exec(ctx, `
		UPDATE project_items
		SET floor_status = $1
		WHERE id = $2 AND project_id = $3 AND organization_id = $4;
	`, status, itemID, projectID, OrgFromCtx(ctx))
	if err != nil {
		return fmt.Errorf("error updating floor status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("project item not found")
	}
	if _, err := s.db(ctx).Exec(ctx, `
		UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND organization_id = $2;
	`, projectID, OrgFromCtx(ctx)); err != nil {
		return fmt.Errorf("error touching project updated_at: %w", err)
	}
	return nil
}

func isValidItemFloorStatus(s string) bool {
	for _, v := range domain.ItemFloorStatuses {
		if v == s {
			return true
		}
	}
	return false
}

// InsertFloorEvent appends one shop-floor transition to the audit log
// (F092). Idempotent by event id — client re-saves and offline sync
// retries never duplicate rows.
func (s *PostgresStore) InsertFloorEvent(ctx context.Context, ev domain.FloorStatusEvent) error {
	if ev.ID == "" || ev.ProjectID == "" || ev.ItemID == "" {
		return fmt.Errorf("floor event requires id, project and item")
	}
	var byUser *string
	if ev.ByUserID != "" {
		byUser = &ev.ByUserID
	}
	var at interface{} = ev.At
	if ev.At.IsZero() {
		at = time.Now()
	}
	_, err := s.db(ctx).Exec(ctx, `
		INSERT INTO project_item_floor_events
			(id, project_id, item_id, from_status, to_status, at, by_user_id, by_name, source, note, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''), $9, NULLIF($10, ''), $11)
		ON CONFLICT (id) DO NOTHING;
	`, ev.ID, ev.ProjectID, ev.ItemID, domain.NormalizeItemFloorStatus(ev.From),
		domain.NormalizeItemFloorStatus(ev.To), at, byUser, ev.ByName,
		string(domain.NormalizeFloorEventSource(string(ev.Source))), ev.Note, OrgFromCtx(ctx))
	if err != nil {
		return fmt.Errorf("error inserting floor event: %w", err)
	}
	return nil
}

// ListFloorEvents returns the shop-floor log of a project, oldest first (F092).
func (s *PostgresStore) ListFloorEvents(ctx context.Context, projectID string) ([]domain.FloorStatusEvent, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT id, project_id, item_id, from_status, to_status, at, by_user_id, by_name, source, note
		FROM project_item_floor_events
		WHERE project_id = $1
		ORDER BY at ASC, id ASC;
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("error listing floor events: %w", err)
	}
	defer rows.Close()

	events := []domain.FloorStatusEvent{}
	for rows.Next() {
		var ev domain.FloorStatusEvent
		var byUser *string
		var byName, note *string
		if err := rows.Scan(&ev.ID, &ev.ProjectID, &ev.ItemID, &ev.From, &ev.To, &ev.At, &byUser, &byName, &ev.Source, &note); err != nil {
			return nil, fmt.Errorf("error scanning floor event: %w", err)
		}
		if byUser != nil {
			ev.ByUserID = *byUser
		}
		if byName != nil {
			ev.ByName = *byName
		}
		if note != nil {
			ev.Note = *note
		}
		events = append(events, ev)
	}
	return events, rows.Err()
}

// upsertFloorEventsTx merges client-supplied events (web project saves)
// into the audit log inside a project update transaction. History rows
// are never rewritten — ON CONFLICT keeps existing ids untouched.
func upsertFloorEventsTx(ctx context.Context, tx pgx.Tx, projectID string, events []domain.FloorStatusEvent) error {
	for _, ev := range events {
		if ev.ID == "" || ev.ItemID == "" {
			continue
		}
		var byUser *string
		if ev.ByUserID != "" {
			byUser = &ev.ByUserID
		}
		var at interface{} = ev.At
		if ev.At.IsZero() {
			at = time.Now()
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO project_item_floor_events
				(id, project_id, item_id, from_status, to_status, at, by_user_id, by_name, source, note, organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''), $9, NULLIF($10, ''), $11)
			ON CONFLICT (id) DO NOTHING;
		`, ev.ID, projectID, ev.ItemID, domain.NormalizeItemFloorStatus(ev.From),
			domain.NormalizeItemFloorStatus(ev.To), at, byUser, ev.ByName,
			string(domain.NormalizeFloorEventSource(string(ev.Source))), ev.Note, OrgFromCtx(ctx)); err != nil {
			return fmt.Errorf("error upserting floor event: %w", err)
		}
	}
	return nil
}

func commercialStatusArg(cs *domain.CommercialStatus) interface{} {
	if cs == nil || *cs == "" {
		return nil
	}
	return string(*cs)
}

func jsonbSliceArg(v interface{}) interface{} {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil || len(b) == 0 || string(b) == "null" || string(b) == "[]" {
		return nil
	}
	return b
}

func jsonbStructArg(v interface{}) interface{} {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil || len(b) == 0 || string(b) == "null" {
		return nil
	}
	return b
}

// ListProjectEvents returns the lifecycle event log of a project, oldest first (OC-010).
func (s *PostgresStore) ListProjectEvents(ctx context.Context, projectID string) ([]domain.ProjectEvent, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT id, project_id, type, at, by_user_id, source, note, payload, created_at
		FROM project_events
		WHERE project_id = $1
		ORDER BY at ASC, id ASC;
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("error listing project events: %w", err)
	}
	defer rows.Close()

	events := []domain.ProjectEvent{}
	for rows.Next() {
		var ev domain.ProjectEvent
		var byUser, note *string
		var source string
		var payload []byte
		if err := rows.Scan(&ev.ID, &ev.ProjectID, &ev.Type, &ev.At, &byUser, &source, &note, &payload, &ev.CreatedAt); err != nil {
			return nil, fmt.Errorf("error scanning project event: %w", err)
		}
		if byUser != nil {
			ev.ByUserID = byUser
		}
		ev.Source = domain.NormalizeProjectEventSource(source)
		if note != nil {
			ev.Note = *note
		}
		if len(payload) > 0 && string(payload) != "null" {
			ev.Payload = payload
		}
		events = append(events, ev)
	}
	return events, rows.Err()
}

// InsertProjectEvent writes one immutable lifecycle event to the audit log (OC-010).
func (s *PostgresStore) InsertProjectEvent(ctx context.Context, ev domain.ProjectEvent) error {
	var at interface{} = ev.At
	if ev.At.IsZero() {
		at = time.Now()
	}
	source := domain.NormalizeProjectEventSource(string(ev.Source))
	_, err := s.db(ctx).Exec(ctx, `
		INSERT INTO project_events
			(id, project_id, type, at, by_user_id, source, note, payload, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8, $9)
		ON CONFLICT (id) DO NOTHING;
	`, ev.ID, ev.ProjectID, ev.Type, at, ev.ByUserID, string(source), ev.Note, nullKitchenLayout(ev.Payload), OrgFromCtx(ctx))
	if err != nil {
		return fmt.Errorf("error inserting project event: %w", err)
	}
	return nil
}

// upsertProjectEventsTx merges client-supplied events into the audit log inside a project transaction.
func upsertProjectEventsTx(ctx context.Context, tx pgx.Tx, projectID string, events []domain.ProjectEvent) error {
	for _, ev := range events {
		if ev.ID == "" || ev.Type == "" {
			continue
		}
		var at interface{} = ev.At
		if ev.At.IsZero() {
			at = time.Now()
		}
		source := domain.NormalizeProjectEventSource(string(ev.Source))
		if _, err := tx.Exec(ctx, `
			INSERT INTO project_events
				(id, project_id, type, at, by_user_id, source, note, payload, organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8, $9)
			ON CONFLICT (id) DO NOTHING;
		`, ev.ID, projectID, ev.Type, at, ev.ByUserID, string(source), ev.Note, nullKitchenLayout(ev.Payload), OrgFromCtx(ctx)); err != nil {
			return fmt.Errorf("error upserting project event: %w", err)
		}
	}
	return nil
}
