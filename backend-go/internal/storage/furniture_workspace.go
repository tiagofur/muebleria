package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #500 / WEB-DT-1 final authority correction: the contextual workspace
// projection is assembled here from authoritative snapshots (identity list,
// immutable QuoteRevision items, design context items, #393 reconciliation,
// #395 release authority) and derived by the pure domain builder. The read
// is transactional-free: every sub-read runs under the caller's tenant
// context (the authenticated request transaction or an explicit tenant tx).

// FurnitureWorkspaceQuery is the selected exact context for the projection.
type FurnitureWorkspaceQuery struct {
	QuoteRevisionID  string
	DesignID         string
	DesignContextKind string // none | working | revision (validated upstream)
	DesignRevisionID string
}

// GetProjectFurnitureWorkspace returns the authoritative per-unit contextual
// projection for the Project Furniture matrix. Foreign or cross-project
// objects answer their typed not-found errors (uniform 404 upstream); a
// visible project without units/revisions/designs projects honestly empty.
func (s *PostgresStore) GetProjectFurnitureWorkspace(ctx context.Context, projectID string, query FurnitureWorkspaceQuery) (*domain.FurnitureWorkspace, error) {
	if !isValidUUID(projectID) {
		return nil, domain.ErrDesignNotFound
	}
	// Mirror the project RLS read policy in plain SQL so the repository stays
	// tenant-safe even where RLS is not the enforcement layer.
	orgID := OrgFromCtx(ctx)
	var visible int
	if err := s.db(ctx).QueryRow(ctx, `
		SELECT 1
		FROM projects p
		WHERE p.id = $1
		  AND (p.organization_id = $2 OR p.sales_organization_id = $2 OR p.manufacturing_organization_id = $2)
	`, projectID, orgID).Scan(&visible); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, err
	}

	// 1. Physical identities with the presentation summary (terminal included).
	summaries, err := s.ListFurnitureInstanceSummariesByProject(ctx, projectID, true)
	if err != nil {
		return nil, err
	}
	instances := make([]domain.FurnitureInstance, len(summaries))
	for i, summary := range summaries {
		instances[i] = summary.Instance
	}

	// 1b. Commercial quantity provenance from quote_line_furniture_instances (#386 / DT-2).
	// One row per active/current link, ordered deterministically by creation and id.
	// Invariant: Only valid for live commercial state (when no historical QuoteRevision
	// is selected). Historical QuoteRevisions do not invent QuoteLine membership from
	// the live link.
	commercialGroupingByInstance := make(map[string]domain.FurnitureWorkspaceCommercialGrouping)
	if query.QuoteRevisionID == "" {
		linkRows, err := s.db(ctx).Query(ctx, `
			SELECT qli.quote_line_id::text, qli.furniture_instance_id::text
			FROM quote_line_furniture_instances qli
			WHERE qli.project_id = $1
			  AND qli.state = 'current'
			ORDER BY qli.quote_line_id, qli.created_at, qli.furniture_instance_id
		`, projectID)
		if err != nil {
			return nil, err
		}
		defer linkRows.Close()

		linksByLine := make(map[string][]string)
		for linkRows.Next() {
			var lineID, instID string
			if err := linkRows.Scan(&lineID, &instID); err != nil {
				return nil, err
			}
			linksByLine[lineID] = append(linksByLine[lineID], instID)
		}
		if err := linkRows.Err(); err != nil {
			return nil, err
		}

		for lineID, instIDs := range linksByLine {
			total := len(instIDs)
			for idx, instID := range instIDs {
				commercialGroupingByInstance[instID] = domain.FurnitureWorkspaceCommercialGrouping{
					QuoteLineID: lineID,
					UnitIndex:   idx + 1,
					UnitTotal:   total,
				}
			}
		}
	}

	// 2. Exact commercial context: one immutable revision snapshot.
	var quote *domain.QuoteRevisionDetail
	if query.QuoteRevisionID != "" {
		quote, err = s.loadQuoteRevisionDetail(ctx, projectID, query.QuoteRevisionID)
		if err != nil {
			return nil, err
		}
	}

	// 3. Exact design context: working copy or published revision items.
	var designItemIDs []string
	var designRevisionNumber int
	kind := query.DesignContextKind
	if kind == "" {
		kind = domain.FurnitureWorkspaceContextNone
	}
	if query.DesignID != "" {
		design, err := s.GetDesignByID(ctx, query.DesignID)
		if err != nil {
			return nil, err
		}
		if design == nil || design.ProjectID != projectID {
			return nil, domain.ErrDesignNotFound
		}
		switch kind {
		case domain.FurnitureWorkspaceContextRevision:
			revision, err := s.GetDesignRevision(ctx, query.DesignID, query.DesignRevisionID)
			if err != nil {
				return nil, err
			}
			if revision == nil || revision.ProjectID != projectID {
				return nil, domain.ErrDesignRevisionNotFound
			}
			designRevisionNumber = revision.RevisionNumber
			for _, item := range revision.Items {
				designItemIDs = append(designItemIDs, item.FurnitureInstanceID)
			}
		default: // working
			workingCopy, err := s.GetDesignWorkingCopy(ctx, query.DesignID)
			if err != nil {
				return nil, err
			}
			if workingCopy == nil || workingCopy.ProjectID != projectID {
				return nil, domain.ErrDesignNotFound
			}
			kind = domain.FurnitureWorkspaceContextWorking
			for _, item := range workingCopy.Items {
				designItemIDs = append(designItemIDs, item.FurnitureInstanceID)
			}
		}
	} else {
		kind = domain.FurnitureWorkspaceContextNone
	}

	// 4. Server-computed reconciliation for the exact published pair only.
	var reconciliation *domain.ReconciliationResult
	if quote != nil && kind == domain.FurnitureWorkspaceContextRevision && query.DesignRevisionID != "" {
		reconciliation, err = s.ReconcileProject(ctx, projectID, query.QuoteRevisionID, query.DesignRevisionID)
		if err != nil {
			return nil, err
		}
	}

	// 5a. Exact contextual release authority: looked up by exact immutable pins.
	var contextualRelease *domain.ProductionRelease
	var contextualReleaseStale bool
	var contextualReleaseCurrent *domain.ProductionReleaseStaleness
	if kind == domain.FurnitureWorkspaceContextRevision && query.DesignRevisionID != "" {
		rel, err := s.GetContextualProductionRelease(ctx, projectID, query.DesignRevisionID, query.QuoteRevisionID)
		if err != nil {
			return nil, err
		}
		if rel != nil {
			staleness, err := s.releaseStaleness(ctx, *rel, "")
			if err != nil {
				return nil, err
			}
			contextualRelease = rel
			contextualReleaseStale = staleness.ManufacturingStale
			contextualReleaseCurrent = staleness
		}
	}

	// 5b. Latest project release: newest canonical release (informational).
	var latestProjectRelease *domain.ProductionRelease
	var latestProjectReleaseStale bool
	var latestProjectReleaseCurrent *domain.ProductionReleaseStaleness
	latest, err := s.GetLatestProjectProductionRelease(ctx, projectID)
	if err != nil {
		return nil, err
	}
	if latest != nil {
		staleness, err := s.releaseStaleness(ctx, *latest, "")
		if err != nil {
			return nil, err
		}
		latestProjectRelease = latest
		latestProjectReleaseStale = staleness.ManufacturingStale
		latestProjectReleaseCurrent = staleness
	}

	return domain.BuildFurnitureWorkspace(domain.FurnitureWorkspaceInputs{
		ProjectID:                    projectID,
		Instances:                    instances,
		Quote:                        quote,
		CommercialGroupingByInstance: commercialGroupingByInstance,
		DesignContextKind:            kind,
		DesignID:                     query.DesignID,
		DesignRevisionID:             query.DesignRevisionID,
		DesignRevisionNumber:         designRevisionNumber,
		DesignItemInstanceIDs:        designItemIDs,
		Reconciliation:               reconciliation,
		ContextualRelease:            contextualRelease,
		ContextualReleaseStale:       contextualReleaseStale,
		ContextualReleaseCurrent:     contextualReleaseCurrent,
		LatestProjectRelease:        latestProjectRelease,
		LatestProjectReleaseStale:   latestProjectReleaseStale,
		LatestProjectReleaseCurrent: latestProjectReleaseCurrent,
	}), nil
}

// loadQuoteRevisionDetail loads ONE immutable revision with its per-unit
// items, scoped strictly to the project (fail-closed JSON, like the list).
func (s *PostgresStore) loadQuoteRevisionDetail(ctx context.Context, projectID, revisionID string) (*domain.QuoteRevisionDetail, error) {
	detail := &domain.QuoteRevisionDetail{}
	err := s.db(ctx).QueryRow(ctx, `
		SELECT id, organization_id, project_id, revision_number, status, source_type,
			COALESCE(notes, ''), COALESCE(created_by::text, ''),
			COALESCE(base_quote_revision_id::text, ''), COALESCE(source_design_revision_id::text, ''),
			created_at
		FROM quote_revisions
		WHERE project_id = $1 AND id = $2
	`, projectID, revisionID).Scan(
		&detail.ID,
		&detail.OrganizationID,
		&detail.ProjectID,
		&detail.RevisionNumber,
		&detail.Status,
		&detail.SourceType,
		&detail.Notes,
		&detail.CreatedBy,
		&detail.BaseQuoteRevisionID,
		&detail.SourceDesignRevisionID,
		&detail.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrQuoteRevisionNotFound
		}
		return nil, err
	}

	rows, err := s.db(ctx).Query(ctx, `
		SELECT furniture_instance_id,
			COALESCE(furniture_definition_id::text, ''), definition_version,
			parameters, material_choices, lifecycle_status
		FROM quote_revision_items
		WHERE quote_revision_id = $1
		ORDER BY furniture_instance_id
	`, revisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	detail.Items = []domain.QuoteRevisionItem{}
	for rows.Next() {
		var instanceID, definitionID, lifecycle string
		var definitionVersion *int
		var paramsJSON, materialsJSON []byte
		if err := rows.Scan(&instanceID, &definitionID, &definitionVersion, &paramsJSON, &materialsJSON, &lifecycle); err != nil {
			return nil, err
		}
		parameters := make(map[string]any)
		if len(paramsJSON) > 0 && string(paramsJSON) != "null" {
			if err := json.Unmarshal(paramsJSON, &parameters); err != nil {
				return nil, fmt.Errorf("%w: quote_revision_item %s parameters", domain.ErrInvalidRevisionSnapshot, instanceID)
			}
		}
		materialChoices := make(map[string]string)
		if len(materialsJSON) > 0 && string(materialsJSON) != "null" {
			if err := json.Unmarshal(materialsJSON, &materialChoices); err != nil {
				return nil, fmt.Errorf("%w: quote_revision_item %s material_choices", domain.ErrInvalidRevisionSnapshot, instanceID)
			}
		}
		detail.Items = append(detail.Items, domain.QuoteRevisionItem{
			FurnitureInstanceID:   instanceID,
			FurnitureDefinitionID: definitionID,
			DefinitionVersion:     definitionVersion,
			Parameters:            parameters,
			MaterialChoices:       materialChoices,
			LifecycleStatus:       lifecycle,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return detail, nil
}
