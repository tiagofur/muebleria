package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #642 / QUOTE-AUTH Slice 1: server-side capture of the immutable commercial
// snapshot (digital-thread §16A). The snapshot freezes the OUTPUT of the
// existing pricing engine, computed exactly once inside the same tenant
// transaction that creates the revision — plus the customer-facing
// descriptors and commercial identities read at that same instant. Nothing
// here is ever recomputed for an existing revision.

// quoteCommercialEnvelope is the frozen commercial identity of the project at
// capture time: name, customer, currency and the pricing levers the engine
// consumed.
type quoteCommercialEnvelope struct {
	ProjectName    string
	CustomerID     string
	CustomerName   string
	Currency       string
	MarginFactor   float64
	LaborFixedCost float64
	Status         string
	KitchenLayout  []byte
}

// loadQuoteCommercialEnvelope reads the project's commercial envelope inside
// the current tenant transaction. Same consistency boundary as the item
// snapshot build that precedes it in both creation commands.
func (s *PostgresStore) loadQuoteCommercialEnvelope(ctx context.Context, projectID string) (*quoteCommercialEnvelope, error) {
	var envelope quoteCommercialEnvelope
	var kitchenLayout []byte
	err := s.db(ctx).QueryRow(ctx, `
		SELECT p.name, p.customer_id::text, COALESCE(c.name, ''), p.currency,
			p.margin_factor, p.labor_fixed_cost, p.status, COALESCE(p.kitchen_layout, 'null'::jsonb)
		FROM projects p
		JOIN customers c ON c.id = p.customer_id
		WHERE p.id = $1
	`, projectID).Scan(
		&envelope.ProjectName,
		&envelope.CustomerID,
		&envelope.CustomerName,
		&envelope.Currency,
		&envelope.MarginFactor,
		&envelope.LaborFixedCost,
		&envelope.Status,
		&kitchenLayout,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, err
	}
	if len(kitchenLayout) > 0 && string(kitchenLayout) != "null" {
		envelope.KitchenLayout = kitchenLayout
	}
	return &envelope, nil
}

// buildInitialQuoteCommercialSnapshot captures Q1's commercial truth from the
// project's editable commercial state: the SAME live state the user was
// quoted (quote lines with base mode, presets, pins and kitchen layout). The
// existing engine computes the breakdown once; per-unit descriptors come from
// the exact item snapshot being frozen in the same command.
func (s *PostgresStore) buildInitialQuoteCommercialSnapshot(ctx context.Context, projectID string, items []CreateQuoteRevisionItemCommand) (*domain.QuoteCommercialSnapshot, error) {
	envelope, err := s.loadQuoteCommercialEnvelope(ctx, projectID)
	if err != nil {
		return nil, err
	}

	projectItems, err := s.loadProjectItems(ctx, projectID)
	if err != nil {
		return nil, err
	}
	levelChoices, err := s.loadProjectLevelChoices(ctx, projectID)
	if err != nil {
		return nil, err
	}
	// A new canonical QuoteRevision captures the current editable state once.
	// It never copies the mutable project-level legacy snapshot because that
	// payload has no exact QuoteLine authority.
	pricingProject := domain.Project{
		ID:                  projectID,
		Name:                envelope.ProjectName,
		CustomerID:          envelope.CustomerID,
		Currency:            envelope.Currency,
		MarginFactor:        envelope.MarginFactor,
		LaborFixedCost:      envelope.LaborFixedCost,
		Status:              domain.ProjectStatus("draft"),
		Items:               projectItems,
		ProjectLevelChoices: levelChoices,
	}
	if len(envelope.KitchenLayout) > 0 {
		pricingProject.KitchenLayout = envelope.KitchenLayout
	}

	catalog, err := s.GetFullCatalog(ctx)
	if err != nil {
		return nil, err
	}
	breakdown, err := engine.CalcProjectBreakdown(pricingProject, catalog)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", domain.ErrInvalidRevisionSnapshot, err.Error())
	}

	units, err := s.buildQuoteCommercialUnits(ctx, items)
	if err != nil {
		return nil, err
	}
	lines, err := buildQuoteCommercialLines(pricingProject, catalog, items)
	if err != nil {
		return nil, err
	}
	return domain.BuildQuoteCommercialSnapshot(
		time.Now().UTC(),
		envelope.Currency,
		domain.QuoteCommercialIdentity{ID: envelope.CustomerID, Name: envelope.CustomerName},
		domain.QuoteCommercialIdentity{ID: projectID, Name: envelope.ProjectName},
		breakdown,
		lines,
		units,
	)
}

// buildRequoteCommercialSnapshot captures the next revision's commercial
// truth from the exact draft configuration the requote builder derived from
// the source QuoteRevision + DesignRevision. The pricing input is synthesized
// per ACTIVE physical unit (definition + frozen choices + dimensions) and
// resolved against the catalog exactly once, at requote time — a draft is
// never closed-status, so the legacy project snapshot is never consulted.
func (s *PostgresStore) buildRequoteCommercialSnapshot(ctx context.Context, projectID string, items []CreateQuoteRevisionItemCommand) (*domain.QuoteCommercialSnapshot, error) {
	envelope, err := s.loadQuoteCommercialEnvelope(ctx, projectID)
	if err != nil {
		return nil, err
	}

	pricingItems := make([]domain.ProjectItem, 0, len(items))
	for _, item := range items {
		if item.LifecycleStatus != "active" || item.FurnitureDefinitionID == "" {
			continue
		}
		choices := item.MaterialChoices
		if choices == nil {
			choices = map[string]string{}
		}
		pricingItems = append(pricingItems, domain.ProjectItem{
			ID:            item.FurnitureInstanceID,
			ModuleID:      item.FurnitureDefinitionID,
			Quantity:      1,
			OptionChoices: choices,
			CustomDims:    domain.CommercialDimsFromParameters(item.Parameters),
		})
	}
	if len(pricingItems) == 0 {
		return nil, fmt.Errorf("%w: el borrador no tiene unidades activas para congelar la verdad comercial", domain.ErrInvalidRevisionSnapshot)
	}

	pricingProject := domain.Project{
		ID:             projectID,
		Name:           envelope.ProjectName,
		CustomerID:     envelope.CustomerID,
		Currency:       envelope.Currency,
		MarginFactor:   envelope.MarginFactor,
		LaborFixedCost: envelope.LaborFixedCost,
		Status:         "draft",
		Items:          pricingItems,
	}

	catalog, err := s.GetFullCatalog(ctx)
	if err != nil {
		return nil, err
	}
	breakdown, err := engine.CalcProjectBreakdown(pricingProject, catalog)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", domain.ErrInvalidRevisionSnapshot, err.Error())
	}

	units, err := s.buildQuoteCommercialUnits(ctx, items)
	if err != nil {
		return nil, err
	}
	lines, err := buildQuoteCommercialLines(pricingProject, catalog, items)
	if err != nil {
		return nil, err
	}
	return domain.BuildQuoteCommercialSnapshot(
		time.Now().UTC(),
		envelope.Currency,
		domain.QuoteCommercialIdentity{ID: envelope.CustomerID, Name: envelope.CustomerName},
		domain.QuoteCommercialIdentity{ID: projectID, Name: envelope.ProjectName},
		breakdown,
		lines,
		units,
	)
}

// buildQuoteCommercialLines freezes stable commercial grouping, explicit
// quantity and authoritative per-line amount contributions. Pricing is run
// with the exact inputs for each line and zero fixed labor; the snapshot-level
// fixed labor is therefore added exactly once.
func buildQuoteCommercialLines(pricingProject domain.Project, catalog domain.Catalog, items []CreateQuoteRevisionItemCommand) ([]domain.QuoteCommercialLine, error) {
	type lineInput struct {
		instanceIDs []string
		active      int
		items       []domain.ProjectItem
	}
	byLine := map[string]*lineInput{}
	lineByInstance := make(map[string]string, len(items))
	for _, item := range items {
		if !isValidUUID(item.QuoteLineID) {
			return nil, fmt.Errorf("%w: la unidad %s no tiene quoteLineId estable", domain.ErrInvalidRevisionSnapshot, item.FurnitureInstanceID)
		}
		line := byLine[item.QuoteLineID]
		if line == nil {
			line = &lineInput{}
			byLine[item.QuoteLineID] = line
		}
		line.instanceIDs = append(line.instanceIDs, item.FurnitureInstanceID)
		lineByInstance[item.FurnitureInstanceID] = item.QuoteLineID
		if item.LifecycleStatus == "" || item.LifecycleStatus == "active" {
			line.active++
		}
	}
	for _, item := range pricingProject.Items {
		lineID := item.ID
		if mapped := lineByInstance[item.ID]; mapped != "" {
			lineID = mapped
		}
		line := byLine[lineID]
		if line == nil {
			return nil, fmt.Errorf("%w: la línea %s no tiene unidades físicas congeladas", domain.ErrInvalidRevisionSnapshot, lineID)
		}
		line.items = append(line.items, item)
	}

	lines := make([]domain.QuoteCommercialLine, 0, len(byLine))
	for lineID, input := range byLine {
		amounts := domain.QuoteCommercialLineAmounts{}
		if len(input.items) > 0 {
			lineProject := pricingProject
			lineProject.Status = domain.ProjectStatus("draft")
			lineProject.PriceSnapshot = nil
			lineProject.LaborFixedCost = 0
			lineProject.Items = input.items
			breakdown, err := engine.CalcProjectBreakdown(lineProject, catalog)
			if err != nil {
				return nil, fmt.Errorf("%w: línea %s: %s", domain.ErrInvalidRevisionSnapshot, lineID, err.Error())
			}
			amounts = domain.QuoteCommercialLineAmounts{
				MaterialsCost: breakdown.MaterialsCost,
				EdgeTotal:     breakdown.EdgeTotal,
				HardwareTotal: breakdown.HardwareTotal,
				DirectCost:    breakdown.DirectCost,
				LaborModular:  breakdown.LaborModular,
				SalePrice:     breakdown.SalePrice,
			}
		}
		lines = append(lines, domain.QuoteCommercialLine{
			QuoteLineID:          lineID,
			Quantity:             input.active,
			FurnitureInstanceIDs: input.instanceIDs,
			Amounts:              amounts,
		})
	}
	return lines, nil
}

// buildQuoteCommercialUnits freezes the customer-facing descriptor of every
// physical unit: module code/name and option group/choice labels read from
// the owning organization's catalog at capture time. Missing customer-facing
// labels fail typed/actionable; raw UUIDs are never frozen as presentation.
func (s *PostgresStore) buildQuoteCommercialUnits(ctx context.Context, items []CreateQuoteRevisionItemCommand) ([]domain.QuoteCommercialUnit, error) {
	orgID := OrgFromCtx(ctx)

	moduleIDs := make([]string, 0, len(items))
	seenModule := map[string]bool{}
	groupCodes := make([]string, 0)
	seenGroup := map[string]bool{}
	choiceIDs := make([]string, 0)
	seenChoice := map[string]bool{}
	for _, item := range items {
		if item.FurnitureDefinitionID != "" && !seenModule[item.FurnitureDefinitionID] {
			seenModule[item.FurnitureDefinitionID] = true
			moduleIDs = append(moduleIDs, item.FurnitureDefinitionID)
		}
		for groupCode, choiceID := range item.MaterialChoices {
			if !seenGroup[groupCode] {
				seenGroup[groupCode] = true
				groupCodes = append(groupCodes, groupCode)
			}
			if choiceID != "" && !seenChoice[choiceID] {
				seenChoice[choiceID] = true
				choiceIDs = append(choiceIDs, choiceID)
			}
		}
	}

	moduleLabels, err := s.loadCatalogLabels(ctx, orgID, "modules", moduleIDs)
	if err != nil {
		return nil, err
	}
	choiceLabels, err := s.loadChoiceLabels(ctx, orgID, choiceIDs)
	if err != nil {
		return nil, err
	}
	groupLabels, err := s.loadOptionGroupLabels(ctx, orgID, groupCodes)
	if err != nil {
		return nil, err
	}

	units := make([]domain.QuoteCommercialUnit, 0, len(items))
	for _, item := range items {
		if !isValidUUID(item.QuoteLineID) {
			return nil, fmt.Errorf("%w: la unidad %s no tiene quoteLineId estable", domain.ErrInvalidRevisionSnapshot, item.FurnitureInstanceID)
		}
		lifecycle := item.LifecycleStatus
		if lifecycle == "" {
			lifecycle = "active"
		}
		unit := domain.QuoteCommercialUnit{
			FurnitureInstanceID: item.FurnitureInstanceID,
			QuoteLineID:         item.QuoteLineID,
			LifecycleStatus:     lifecycle,
			Options:             []domain.QuoteCommercialOption{},
		}
		label, ok := moduleLabels[item.FurnitureDefinitionID]
		if !ok || strings.TrimSpace(label.Code) == "" || strings.TrimSpace(label.Name) == "" {
			return nil, fmt.Errorf("%w: el módulo %s no tiene descriptor comercial; corregí el catálogo antes de cotizar", domain.ErrInvalidRevisionSnapshot, item.FurnitureDefinitionID)
		}
		unit.ModuleCode = label.Code
		unit.ModuleName = label.Name
		for groupCode, choiceID := range item.MaterialChoices {
			groupLabel := groupLabels[groupCode]
			if strings.TrimSpace(groupLabel) == "" {
				return nil, fmt.Errorf("%w: el grupo de opción %s no tiene label comercial; corregí el catálogo antes de cotizar", domain.ErrInvalidRevisionSnapshot, groupCode)
			}
			choiceLabel, ok := choiceLabels[choiceID]
			if !ok || strings.TrimSpace(choiceLabel) == "" {
				return nil, fmt.Errorf("%w: la opción %s no tiene label comercial; corregí el catálogo antes de cotizar", domain.ErrInvalidRevisionSnapshot, choiceID)
			}
			unit.Options = append(unit.Options, domain.QuoteCommercialOption{
				GroupCode:   groupCode,
				GroupLabel:  groupLabel,
				ChoiceID:    choiceID,
				ChoiceLabel: choiceLabel,
			})
		}
		sort.Slice(unit.Options, func(i, j int) bool {
			if unit.Options[i].GroupCode == unit.Options[j].GroupCode {
				return unit.Options[i].ChoiceID < unit.Options[j].ChoiceID
			}
			return unit.Options[i].GroupCode < unit.Options[j].GroupCode
		})
		units = append(units, unit)
	}
	return units, nil
}

type catalogLabel struct {
	Code string
	Name string
}

// loadCatalogLabels resolves id → {code, name} for one catalog table of the
// owning organization. Valid UUID ids only; anything else simply misses.
func (s *PostgresStore) loadCatalogLabels(ctx context.Context, orgID string, table string, ids []string) (map[string]catalogLabel, error) {
	labels := map[string]catalogLabel{}
	validIDs := make([]string, 0, len(ids))
	for _, id := range ids {
		if isValidUUID(id) {
			validIDs = append(validIDs, id)
		}
	}
	if len(validIDs) == 0 {
		return labels, nil
	}
	rows, err := s.db(ctx).Query(ctx, fmt.Sprintf(`
		SELECT id::text, code, name FROM %s WHERE organization_id = $1 AND id = ANY($2::uuid[])`, table), orgID, validIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var label catalogLabel
		if err := rows.Scan(&id, &label.Code, &label.Name); err != nil {
			return nil, err
		}
		labels[id] = label
	}
	return labels, rows.Err()
}

// loadChoiceLabels resolves choice entity ids across the three catalog entity
// tables (materials, edges, hardware) of the owning organization.
func (s *PostgresStore) loadChoiceLabels(ctx context.Context, orgID string, choiceIDs []string) (map[string]string, error) {
	labels := map[string]string{}
	validIDs := make([]string, 0, len(choiceIDs))
	for _, id := range choiceIDs {
		if isValidUUID(id) {
			validIDs = append(validIDs, id)
		}
	}
	if len(validIDs) == 0 {
		return labels, nil
	}
	for _, table := range []string{"material_boards", "edge_bands", "hardwares"} {
		rows, err := s.db(ctx).Query(ctx, fmt.Sprintf(`
			SELECT id::text, name FROM %s WHERE organization_id = $1 AND id = ANY($2::uuid[])`, table), orgID, validIDs)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id, name string
			if err := rows.Scan(&id, &name); err != nil {
				rows.Close()
				return nil, err
			}
			labels[id] = name
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return labels, nil
}

// loadOptionGroupLabels resolves option group codes to their customer-facing
// names in the owning organization's catalog.
func (s *PostgresStore) loadOptionGroupLabels(ctx context.Context, orgID string, codes []string) (map[string]string, error) {
	labels := map[string]string{}
	if len(codes) == 0 {
		return labels, nil
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT code, name FROM option_groups WHERE organization_id = $1 AND code = ANY($2)`, orgID, codes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var code, name string
		if err := rows.Scan(&code, &name); err != nil {
			return nil, err
		}
		labels[code] = name
	}
	return labels, rows.Err()
}

// loadLegacyQuoteSnapshot reads the legacy compatibility-only priceSnapshot
// (quote_snapshots). Only consumed by the engine for already-closed legacy
// projects; never an authority for revision history (#642 §16A).
func (s *PostgresStore) loadLegacyQuoteSnapshot(ctx context.Context, projectID string) (*domain.QuotePriceSnapshot, error) {
	var snapshot domain.QuotePriceSnapshot
	err := s.db(ctx).QueryRow(ctx, `
		SELECT captured_at, materials_cost, edge_total, hardware_total, direct_cost,
			labor_modular, labor_fixed_cost, margin_factor, sale_price
		FROM quote_snapshots
		WHERE project_id = $1 AND organization_id = $2`,
		projectID, OrgFromCtx(ctx)).Scan(
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
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &snapshot, nil
}

// parseQuoteCommercialSnapshot decodes a stored commercial snapshot
// fail-closed: corrupt or structurally invalid payloads are rejected, never
// guessed or partially loaded.
func parseQuoteCommercialSnapshot(payload []byte) (*domain.QuoteCommercialSnapshot, error) {
	if len(payload) == 0 || string(payload) == "null" {
		return nil, nil
	}
	var snapshot domain.QuoteCommercialSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		return nil, fmt.Errorf("%w: commercial snapshot payload corrupto", domain.ErrInvalidRevisionSnapshot)
	}
	if err := domain.ValidateQuoteCommercialSnapshot(&snapshot); err != nil {
		return nil, err
	}
	return &snapshot, nil
}
