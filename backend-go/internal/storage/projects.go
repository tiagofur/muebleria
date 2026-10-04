package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"strings"
	"time"
)

//  Contrato: proyectos/cotizaciones CRUD — alta con cliente inline (#712),
//  items, media cleanup y contexto digital thread. Dueño del agregado Project.
// --- PROJECTS / QUOTATIONS ---

func (s *PostgresStore) ListProjects(ctx context.Context) ([]domain.Project, error) {
	query := `
		SELECT id, name, customer_id, created_by, owner_user_id, assigned_engineer_id, technical_status, survey_completed_at, installation_scheduled_date, currency, margin_factor, labor_fixed_cost, status, commercial_status, notes, kitchen_layout, plan_edit_session, installation_checklist, nesting_import, measure_defaults, engineering_log, materials_release, cut_plan, design_revisions, approvals, production_release, change_orders, part_instances, module_units, material_planning, organization_id, sales_organization_id, manufacturing_organization_id, created_at, updated_at
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
		var installDate *time.Time
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
		var materialPlanning []byte
		var orgID, salesOrgID, mfgOrgID *string
		err := rows.Scan(&p.ID, &p.Name, &p.CustomerID, &createdBy, &ownerID, &engineerID, &techStatus, &surveyCompletedAt, &installDate, &p.Currency, &p.MarginFactor, &p.LaborFixedCost, &p.Status, &commercialStatus, &notes, &kitchenLayout, &planEditSession, &installationChecklist, &nestingImport, &measureDefaults, &engineeringLog, &materialsRelease, &cutPlan, &designRevisions, &approvals, &productionRelease, &changeOrders, &partInstances, &moduleUnits, &materialPlanning, &orgID, &salesOrgID, &mfgOrgID, &p.CreatedAt, &p.UpdatedAt)
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
		if installDate != nil {
			formatted := installDate.Format("2006-01-02")
			p.InstallationScheduledDate = &formatted
		}
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
			var pr domain.LegacyProductionRelease
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
		if len(materialPlanning) > 0 && string(materialPlanning) != "null" {
			var planning domain.MaterialPlanning
			if err := json.Unmarshal(materialPlanning, &planning); err == nil {
				p.MaterialPlanning = &planning
			}
		}

		list = append(list, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	// #577 / OPS-DT-1: server-owned resolved release authority projection.
	// Canonical latest per project in ONE query (no N+1); the legacy blob is
	// only the pre-DT fallback. Runs after the cursor closes like the other
	// dependent queries.
	projectIDs := make([]string, len(list))
	for i := range list {
		projectIDs[i] = list[i].ID
	}
	latestReleases, err := s.LatestCanonicalReleasesByProject(ctx, projectIDs)
	if err != nil {
		return nil, err
	}
	releaseIDs := make([]string, 0, len(latestReleases))
	for _, release := range latestReleases {
		releaseIDs = append(releaseIDs, release.ID)
	}
	frozenRouting, err := s.FrozenRoutingByRelease(ctx, releaseIDs)
	if err != nil {
		return nil, err
	}
	engineeringStates, err := s.EngineeringStatesByRelease(ctx, releaseIDs)
	if err != nil {
		return nil, err
	}
	dtContext, err := s.DigitalThreadContextByProject(ctx, projectIDs)
	if err != nil {
		return nil, err
	}
	for i := range list {
		list[i].ResolvedProductionRelease = resolveReleaseProjection(latestReleases[list[i].ID], list[i].ProductionRelease)
		if canonical := latestReleases[list[i].ID]; canonical != nil {
			list[i].ResolvedProductionRelease.FrozenRouting = frozenRouting[canonical.ID]
			// #740: durable Engineering state of the resolved authority.
			list[i].ReleaseEngineering = engineeringStates[canonical.ID]
		}
		list[i].HasDigitalThreadContext = dtContext[list[i].ID]
	}
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
	// id is the final tiebreaker: presets with identical dimensions within a
	// module must never reorder between reads or the content-addressed
	// catalog revision oscillates (#466 pinned resolves randomly stale).
	q := `
		SELECT id, name, width_mm, height_mm, depth_mm
		FROM module_presets
		WHERE module_id = $1 AND organization_id = $2
		ORDER BY width_mm ASC, height_mm ASC, depth_mm ASC, id ASC;
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

// DigitalThreadContextByProject returns, per project id, whether the project
// positively participates in the Digital Thread (#697 review): it has at
// least one project-owned FurnitureInstance, quote revision, DT design or
// canonical production release. True pre-Digital-Thread projects answer false — the only case
// where legacy accepted/produced status compatibility may apply. One batch
// query, no N+1; computed on read and never persisted.
func (s *PostgresStore) DigitalThreadContextByProject(ctx context.Context, projectIDs []string) (map[string]bool, error) {
	result := make(map[string]bool, len(projectIDs))
	if len(projectIDs) == 0 {
		return result, nil
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT p.id,
		       EXISTS (SELECT 1 FROM furniture_instances fi WHERE fi.project_id = p.id)
		    OR EXISTS (SELECT 1 FROM quote_revisions qr WHERE qr.project_id = p.id)
		    OR EXISTS (SELECT 1 FROM designs d WHERE d.project_id = p.id)
		    OR EXISTS (SELECT 1 FROM production_releases pr WHERE pr.project_id = p.id)
		FROM projects p
		WHERE p.id = ANY($1)
	`, projectIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var dtContext bool
		if err := rows.Scan(&id, &dtContext); err != nil {
			return nil, err
		}
		result[id] = dtContext
	}
	return result, rows.Err()
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
	var installDate *time.Time
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
	if installDate != nil {
		formatted := installDate.Format("2006-01-02")
		p.InstallationScheduledDate = &formatted
	}
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
		var pr domain.LegacyProductionRelease
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

	// #577 / OPS-DT-1: server-owned resolved release authority projection —
	// canonical latest first, legacy blob as the pre-DT fallback only.
	if canonical, err := s.GetLatestProjectProductionRelease(ctx, p.ID); err != nil {
		return nil, err
	} else {
		p.ResolvedProductionRelease = resolveReleaseProjection(canonical, p.ProductionRelease)
		if canonical != nil {
			frozenRouting, err := s.FrozenRoutingByRelease(ctx, []string{canonical.ID})
			if err != nil {
				return nil, err
			}
			p.ResolvedProductionRelease.FrozenRouting = frozenRouting[canonical.ID]
			// #740: durable Engineering state of the resolved authority —
			// computed on read, never client-authored.
			engineering, err := s.EngineeringStatesByRelease(ctx, []string{canonical.ID})
			if err != nil {
				return nil, err
			}
			p.ReleaseEngineering = engineering[canonical.ID]
		}
	}
	// #697 review: server-owned Digital Thread context projection — same
	// read-model pass as the release authority above.
	if dtContext, err := s.DigitalThreadContextByProject(ctx, []string{p.ID}); err != nil {
		return nil, err
	} else {
		p.HasDigitalThreadContext = dtContext[p.ID]
	}

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
	tx, err := s.beginTx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := createProjectTx(ctx, tx, p); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// CreateProjectWithInlineCustomer is the atomic "nueva cotización + nuevo
// cliente" transition (#712): the customer is inserted with a server-owned id
// and the project references exactly that row inside the SAME transaction.
// Any failure rolls both back — no orphan customer residue, and the FK is
// never consulted with an unpersisted identity.
func (s *PostgresStore) CreateProjectWithInlineCustomer(ctx context.Context, p *domain.Project, inline *domain.Customer) error {
	if strings.TrimSpace(inline.Name) == "" {
		return fmt.Errorf("inline customer name is required")
	}
	inline.Active = true

	tx, err := s.beginTx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := createCustomerTx(ctx, tx, inline, OrgFromCtx(ctx)); err != nil {
		return err
	}
	p.CustomerID = inline.ID

	if err := createProjectTx(ctx, tx, p); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// createProjectTx holds the project insert shared by every create path. It
// first enforces the logical scope of customer_id (same organization, #712
// §8 — RI checks bypass RLS, so the storage owns this guard) and then runs
// the insert plus its child collections on the given transaction.
func createProjectTx(ctx context.Context, tx pgx.Tx, p *domain.Project) error {
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

	if err := ensureCustomerInOrgTx(ctx, tx, p.CustomerID, p.OrganizationID); err != nil {
		return err
	}

	// Prefer the client-provided id so the FE id stays stable (matches every
	// other Create* resource). Without this the DB generated its own id, the FE
	// kept the one it minted, and later calls (calculate, update) 404'd.
	var err error
	if p.ID != "" {
		query := `
			INSERT INTO projects (id, name, customer_id, created_by, owner_user_id, assigned_engineer_id, technical_status, survey_completed_at, installation_scheduled_date, currency, margin_factor, labor_fixed_cost, status, commercial_status, notes, kitchen_layout, plan_edit_session, installation_checklist, nesting_import, measure_defaults, engineering_log, materials_release, cut_plan, design_revisions, approvals, production_release, change_orders, part_instances, module_units, organization_id, sales_organization_id, manufacturing_organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
			RETURNING created_at, updated_at;
		`
		err = tx.QueryRow(ctx, query, p.ID, p.Name, p.CustomerID, createdBy, owner, engineer, techStatus, p.SurveyCompletedAt, nullDateArg(p.InstallationScheduledDate), p.Currency, p.MarginFactor, p.LaborFixedCost, p.Status, commercialStatusArg(p.CommercialStatus), p.Notes, nullKitchenLayout(p.KitchenLayout), nullKitchenLayout(p.PlanEditSession), nullKitchenLayout(p.InstallationChecklist), nullKitchenLayout(p.NestingImport), nullKitchenLayout(p.MeasureDefaults), nullKitchenLayout(p.EngineeringLog), nullKitchenLayout(p.MaterialsRelease), nullKitchenLayout(p.CutPlan), jsonbSliceArg(p.DesignRevisions), jsonbSliceArg(p.Approvals), jsonbStructArg(p.ProductionRelease), jsonbSliceArg(p.ChangeOrders), jsonbSliceArg(p.PartInstances), jsonbSliceArg(p.ModuleUnits), OrgFromCtx(ctx), salesOrg, mfgOrg).
			Scan(&p.CreatedAt, &p.UpdatedAt)
	} else {
		query := `
			INSERT INTO projects (name, customer_id, created_by, owner_user_id, assigned_engineer_id, technical_status, survey_completed_at, installation_scheduled_date, currency, margin_factor, labor_fixed_cost, status, commercial_status, notes, kitchen_layout, plan_edit_session, installation_checklist, nesting_import, measure_defaults, engineering_log, materials_release, cut_plan, design_revisions, approvals, production_release, change_orders, part_instances, module_units, organization_id, sales_organization_id, manufacturing_organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31)
			RETURNING id, created_at, updated_at;
		`
		err = tx.QueryRow(ctx, query, p.Name, p.CustomerID, createdBy, owner, engineer, techStatus, p.SurveyCompletedAt, nullDateArg(p.InstallationScheduledDate), p.Currency, p.MarginFactor, p.LaborFixedCost, p.Status, commercialStatusArg(p.CommercialStatus), p.Notes, nullKitchenLayout(p.KitchenLayout), nullKitchenLayout(p.PlanEditSession), nullKitchenLayout(p.InstallationChecklist), nullKitchenLayout(p.NestingImport), nullKitchenLayout(p.MeasureDefaults), nullKitchenLayout(p.EngineeringLog), nullKitchenLayout(p.MaterialsRelease), nullKitchenLayout(p.CutPlan), jsonbSliceArg(p.DesignRevisions), jsonbSliceArg(p.Approvals), jsonbStructArg(p.ProductionRelease), jsonbSliceArg(p.ChangeOrders), jsonbSliceArg(p.PartInstances), jsonbSliceArg(p.ModuleUnits), OrgFromCtx(ctx), salesOrg, mfgOrg).
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

	return nil
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

	if err := updateProjectTx(ctx, tx, id, p); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// ErrProjectConcurrentUpdate means the project's customer assignment moved
// between the caller's read and the inline transition (#714 §11). Raised
// instead of silently orphaning the customer a competing transition created;
// the handler surfaces it as an explicit 409.
var ErrProjectConcurrentUpdate = errors.New("project concurrently updated")

// UpdateProjectWithInlineCustomer is the atomic "editar cotización + nuevo
// cliente" transition (#714): the row is locked, the caller's base view of the
// customer assignment is verified, and the customer is inserted with a
// server-owned id plus the project update referencing it inside the SAME
// transaction. Any failure rolls both back — no orphan customer residue, and
// the FK is never consulted with an unpersisted identity.
func (s *PostgresStore) UpdateProjectWithInlineCustomer(ctx context.Context, id string, p *domain.Project, inline *domain.Customer, baseCustomerID string, expectedProjectUpdatedAt time.Time) error {
	if strings.TrimSpace(inline.Name) == "" {
		return fmt.Errorf("inline customer name is required")
	}
	inline.Active = true

	tx, err := s.beginTx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// #714 §11: serialize competing inline updates on the row itself and
	// verify the caller's base view of the customer assignment. A stale base
	// fails with an explicit conflict — a retry (same or new idempotency key)
	// converges instead of minting another customer and orphaning the first.
	var currentCustomerID *string
	var projectOrg string
	var currentStatus domain.ProjectStatus
	var currentUpdatedAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT customer_id, organization_id, status, updated_at FROM projects
		WHERE id = $1 AND organization_id = $2
		FOR UPDATE`, id, OrgFromCtx(ctx)).Scan(&currentCustomerID, &projectOrg, &currentStatus, &currentUpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("project not found")
		}
		return err
	}
	current := ""
	if currentCustomerID != nil {
		current = *currentCustomerID
	}
	if current != baseCustomerID || currentStatus != domain.StatusDraft || !currentUpdatedAt.Equal(expectedProjectUpdatedAt) {
		return ErrProjectConcurrentUpdate
	}

	// The inline customer belongs to the project's OWNING organization — the
	// logical FK scope (ensureCustomerInOrgTx inside updateProjectTx) requires
	// exactly that tenant.
	if err := createCustomerTx(ctx, tx, inline, projectOrg); err != nil {
		return err
	}
	p.CustomerID = inline.ID

	if err := updateProjectTx(ctx, tx, id, p); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// updateProjectTx holds the project update shared by every update path: the
// aggregate UPDATE, the logical customer scope guard (#712 §8 — RI checks
// bypass RLS, so the storage owns this) and the child collections, all on the
// given transaction.
func updateProjectTx(ctx context.Context, tx pgx.Tx, id string, p *domain.Project) error {
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
	// #712 §8: re-pointing customer_id remains an owner-only logical-FK
	// transition. A shared manufacturing organization may update a project it
	// can see, but it cannot read the sales-owned customer table. Lock the
	// visible project row first so a same-customer update does not perform an
	// unrelated cross-tenant customer lookup; if the reference changes, validate
	// the incoming customer against the owning organization before the UPDATE.
	var projectOrg string
	var currentCustomerID *string
	if err := tx.QueryRow(ctx, `
		SELECT organization_id, customer_id
		FROM projects
		WHERE id = $1
		FOR UPDATE`, id).Scan(&projectOrg, &currentCustomerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("project not found")
		}
		return err
	}
	currentCustomer := ""
	if currentCustomerID != nil {
		currentCustomer = *currentCustomerID
	}
	if p.CustomerID != currentCustomer {
		if err := ensureCustomerInOrgTx(ctx, tx, p.CustomerID, projectOrg); err != nil {
			return err
		}
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
	tag, err := tx.Exec(ctx, query, p.Name, p.CustomerID, p.Currency, p.MarginFactor, p.LaborFixedCost, p.Status, commercialStatusArg(p.CommercialStatus), p.Notes, owner, engineer, techStatus, p.SurveyCompletedAt, nullDateArg(p.InstallationScheduledDate), nullKitchenLayout(p.KitchenLayout), nullKitchenLayout(p.PlanEditSession), nullKitchenLayout(p.InstallationChecklist), nullKitchenLayout(p.NestingImport), nullKitchenLayout(p.MeasureDefaults), nullKitchenLayout(p.EngineeringLog), nullKitchenLayout(p.CutPlan), jsonbSliceArg(p.DesignRevisions), jsonbSliceArg(p.Approvals), jsonbStructArg(p.ProductionRelease), jsonbSliceArg(p.ChangeOrders), jsonbSliceArg(p.PartInstances), jsonbSliceArg(p.ModuleUnits), id, OrgFromCtx(ctx))
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

	return nil
}

// ProjectMediaFile identifies a physical object owned exclusively by a project.
// OrganizationID is collected from the authoritative row before its cascade.
type ProjectMediaFile struct {
	OrganizationID string
	MediaURL       string
	StorageKey     string
}

// DeleteProject removes an authorized project through the database's narrow
// SECURITY DEFINER boundary.  Direct application DELETE permissions remain
// revoked; the function validates Store/Sales authority before it can bypass
// RLS for Factory-private release descendants.
func (s *PostgresStore) DeleteProject(ctx context.Context, id string) error {
	return s.DeleteProjectWithMediaCleanup(ctx, id, nil)
}

// DeleteProjectWithMediaCleanup registers physical cleanup only after the same
// tenant transaction commits.  The callback is intentionally generic: storage
// returns stable owner/key references, while the API owns MediaDir semantics.
func (s *PostgresStore) DeleteProjectWithMediaCleanup(
	ctx context.Context,
	id string,
	cleanup func(context.Context, []ProjectMediaFile),
) error {
	actor, ok := TenantActorFromCtx(ctx)
	if !ok || actor.OrganizationID == "" || actor.UserID == "" || actor.MembershipID == "" {
		return errors.New("project delete requires a complete tenant actor")
	}
	return runInTenantTxErr(s, ctx, func(ctx context.Context) error {
		tx := transactionFromContext(ctx)
		if tx == nil {
			return errors.New("project delete requires an active tenant transaction")
		}
		rows, err := tx.Query(ctx, `SELECT owner_organization_id, project_media_url, project_storage_key FROM delete_project_tree($1)`, id)
		if err != nil {
			return fmt.Errorf("deleting project tree: %w", err)
		}
		defer rows.Close()
		var files []ProjectMediaFile
		for rows.Next() {
			var file ProjectMediaFile
			var mediaURL, storageKey *string
			if err := rows.Scan(&file.OrganizationID, &mediaURL, &storageKey); err != nil {
				return fmt.Errorf("reading project media cleanup reference: %w", err)
			}
			if mediaURL != nil {
				file.MediaURL = *mediaURL
			}
			if storageKey != nil {
				file.StorageKey = *storageKey
			}
			files = append(files, file)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("reading project media cleanup references: %w", err)
		}
		if cleanup != nil && len(files) > 0 {
			OnCommit(ctx, func(committed context.Context) { cleanup(committed, files) })
		}
		return nil
	})
}

// ListModules returns the workshop's furniture modules with their measure
// presets, skipping the heavy per-module children (board parts, hardware
// lines, component instances). It backs catalog projections such as the
// SketchUp furniture/definitions endpoint; anything needing the full
// despiece must use GetFullCatalog or GetModuleByID instead.
