package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// GetDesignCommercialProjection calculates a non-binding estimate from the
// exact Design working copy inside the request's tenant transaction. The
// shared lock serializes this read with UpdateDesignWorkingCopy's FOR UPDATE.
func (s *PostgresStore) GetDesignCommercialProjection(ctx context.Context, projectID, designID string) (*domain.CommercialProjection, error) {
	if !isValidUUID(projectID) || !isValidUUID(designID) {
		return nil, domain.ErrDesignNotFound
	}
	orgID := OrgFromCtx(ctx)
	var authorized bool
	err := s.db(ctx).QueryRow(ctx, `
		SELECT true
		FROM designs d
		JOIN projects p ON p.id = d.project_id
		WHERE d.id = $1 AND d.project_id = $2
		  AND p.organization_id = $3
		FOR SHARE OF d
	`, designID, projectID, orgID).Scan(&authorized)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, err
	}
	wc, err := s.GetDesignWorkingCopy(ctx, designID)
	if err != nil || wc.ProjectID != projectID {
		if err == nil {
			err = domain.ErrDesignNotFound
		}
		return nil, err
	}
	envelope, err := s.loadQuoteCommercialEnvelope(ctx, projectID)
	if err != nil {
		return nil, err
	}

	workingFingerprint, err := hashJSON(struct {
		BaseRevisionID *string                    `json:"baseRevisionId"`
		Items          []domain.DesignWorkingItem `json:"items"`
	}{wc.BaseRevisionID, wc.Items})
	if err != nil {
		return nil, err
	}
	workingVersion := wc.UpdatedAt.UTC().Format(time.RFC3339Nano)
	if wc.UpdatedAt.IsZero() {
		workingVersion = workingFingerprint
	}
	now := time.Now().UTC()
	result := &domain.CommercialProjection{
		Schema: domain.CommercialProjectionSchema, Status: domain.CommercialProjectionIncomplete,
		ProjectID: projectID, DesignID: designID, WorkingVersion: workingVersion,
		WorkingFingerprint: workingFingerprint, PricingAuthority: "calc-project-breakdown",
		CalculatedAt: now, Currency: envelope.Currency, ItemCount: len(wc.Items), Issues: []string{},
		SaleAmountsWithheld: false,
	}

	pricingItems := make([]domain.ProjectItem, 0, len(wc.Items))
	for _, item := range wc.Items {
		if item.FurnitureDefinitionID == "" {
			result.Issues = append(result.Issues, "working_item_missing_furniture_definition")
			continue
		}
		choices := item.MaterialChoices
		if choices == nil {
			choices = map[string]string{}
		}
		pricingItems = append(pricingItems, domain.ProjectItem{
			ID: item.FurnitureInstanceID, ModuleID: item.FurnitureDefinitionID, Quantity: 1,
			OptionChoices: choices, CustomDims: domain.CommercialDimsFromParameters(item.Parameters),
		})
	}
	if len(wc.Items) == 0 {
		result.Issues = append(result.Issues, "working_copy_empty")
	} else if len(pricingItems) != len(wc.Items) {
		result.Issues = append(result.Issues, "working_copy_incomplete")
	}

	revisions, err := s.ListQuoteRevisionsByProject(ctx, projectID)
	if err != nil {
		return nil, err
	}
	result.Reference, result.AcceptedReference, result.LatestPublishedReference = selectCommercialProjectionReferences(revisions)

	if len(result.Issues) == 0 {
		levelChoices, choicesErr := s.loadProjectLevelChoices(ctx, projectID)
		if choicesErr != nil {
			return nil, choicesErr
		}
		catalog, catalogErr := s.GetFullCatalog(ctx)
		if catalogErr != nil {
			return nil, catalogErr
		}
		catalogFingerprint, hashErr := hashJSON(catalog)
		if hashErr != nil {
			return nil, hashErr
		}
		result.CatalogFingerprint = &catalogFingerprint
		pricingLayout, layoutErr := s.designPricingKitchenLayout(ctx, projectID, envelope.KitchenLayout, pricingItems)
		if layoutErr != nil {
			return nil, layoutErr
		}
		pricingProject := domain.Project{
			ID: projectID, Name: envelope.ProjectName, CustomerID: envelope.CustomerID,
			Currency: envelope.Currency, MarginFactor: envelope.MarginFactor,
			LaborFixedCost: envelope.LaborFixedCost, Status: "draft", Items: pricingItems,
			KitchenLayout: pricingLayout, ProjectLevelChoices: levelChoices,
		}
		breakdown, calcErr := engine.CalcProjectBreakdown(pricingProject, catalog)
		if calcErr != nil {
			result.Issues = append(result.Issues, "pricing_inputs_incomplete:"+calcErr.Error())
		} else {
			projectionFingerprint, hashErr := hashJSON(struct {
				Working string         `json:"working"`
				Catalog string         `json:"catalog"`
				Project domain.Project `json:"project"`
			}{workingFingerprint, catalogFingerprint, pricingProject})
			if hashErr != nil {
				return nil, hashErr
			}
			result.ProjectionFingerprint = &projectionFingerprint
			result.Amounts = domain.CommercialProjectionAmountsFromBreakdown(breakdown)
			result.Status = domain.CommercialProjectionCurrent
			result.Comparison = compareCommercialProjection(result)
		}
	}
	return result, nil
}

// designPricingKitchenLayout translates the editable quote-line placement
// identity (ProjectItem + zero-based instanceIndex) to the physical
// FurnitureInstance identity used by DesignWorkingCopy pricing items.
func (s *PostgresStore) designPricingKitchenLayout(ctx context.Context, projectID string, raw json.RawMessage, pricingItems []domain.ProjectItem) (json.RawMessage, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return raw, nil
	}
	var layout map[string]any
	if err := json.Unmarshal(raw, &layout); err != nil {
		return raw, nil // CalcProjectBreakdown reports the canonical layout error.
	}
	placements, ok := layout["placements"].([]any)
	if !ok {
		return raw, nil
	}

	rows, err := s.db(ctx).Query(ctx, `
		SELECT quote_line_id::text, furniture_instance_id::text
		FROM quote_line_furniture_instances
		WHERE project_id = $1 AND state = 'current'
		ORDER BY quote_line_id, created_at, furniture_instance_id
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	unitsByLine := make(map[string][]string)
	for rows.Next() {
		var lineID, instanceID string
		if err := rows.Scan(&lineID, &instanceID); err != nil {
			return nil, err
		}
		unitsByLine[lineID] = append(unitsByLine[lineID], instanceID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	workingInstances := make(map[string]struct{}, len(pricingItems))
	for _, item := range pricingItems {
		workingInstances[item.ID] = struct{}{}
	}
	layout["placements"] = mapDesignPricingPlacements(placements, unitsByLine, workingInstances)
	mapped, err := json.Marshal(layout)
	if err != nil {
		return nil, err
	}
	return mapped, nil
}

func mapDesignPricingPlacements(placements []any, unitsByLine map[string][]string, workingInstances map[string]struct{}) []any {
	mapped := make([]any, 0, len(placements))
	for _, value := range placements {
		placement, ok := value.(map[string]any)
		if !ok {
			continue
		}
		lineID, _ := placement["itemId"].(string)
		instanceID := lineID
		if _, alreadyPhysical := workingInstances[instanceID]; !alreadyPhysical {
			index, validIndex := placement["instanceIndex"].(float64)
			if !validIndex || index < 0 || index != float64(int(index)) {
				continue
			}
			units := unitsByLine[lineID]
			if int(index) >= len(units) {
				continue
			}
			instanceID = units[int(index)]
		}
		if _, present := workingInstances[instanceID]; !present {
			continue
		}
		placement["itemId"] = instanceID
		mapped = append(mapped, placement)
	}
	return mapped
}

func hashJSON(value any) (string, error) {
	bytes, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("commercial projection fingerprint: %w", err)
	}
	sum := sha256.Sum256(bytes)
	return "sha256-" + hex.EncodeToString(sum[:]), nil
}

func selectCommercialProjectionReferences(revisions []domain.QuoteRevisionDetail) (selected, accepted, latestPublished *domain.CommercialProjectionReference) {
	sort.SliceStable(revisions, func(i, j int) bool { return revisions[i].RevisionNumber < revisions[j].RevisionNumber })
	for i := range revisions {
		revision := revisions[i]
		ref := commercialProjectionReference(revision)
		selected = ref
		if revision.Status == "accepted" {
			accepted = ref
		}
		if revision.PublishedAt != nil {
			latestPublished = ref
		}
	}
	if accepted != nil {
		selected = accepted
	}
	return
}

func commercialProjectionReference(revision domain.QuoteRevisionDetail) *domain.CommercialProjectionReference {
	ref := &domain.CommercialProjectionReference{QuoteRevisionID: revision.ID, RevisionNumber: revision.RevisionNumber, Status: revision.Status}
	if revision.CommercialSnapshot != nil {
		currency := revision.CommercialSnapshot.Currency
		ref.Currency = &currency
		if !revision.CommercialAmountsWithheld {
			value := revision.CommercialSnapshot.Breakdown.SalePrice
			ref.SaleTotal = &value
		}
	}
	return ref
}

func compareCommercialProjection(p *domain.CommercialProjection) *domain.CommercialProjectionComparison {
	if p.Amounts == nil || p.Amounts.SaleTotal == nil || p.Reference == nil || p.Reference.SaleTotal == nil || p.Reference.Currency == nil || p.Currency != *p.Reference.Currency {
		return nil
	}
	delta := *p.Amounts.SaleTotal - *p.Reference.SaleTotal
	comparison := &domain.CommercialProjectionComparison{AbsoluteDelta: delta}
	if *p.Reference.SaleTotal != 0 {
		percent := delta / *p.Reference.SaleTotal * 100
		comparison.PercentageDelta = &percent
	}
	return comparison
}
