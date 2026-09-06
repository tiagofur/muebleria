package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #500 / WEB-DT-1: exact commercial context read model for the Project
// Furniture matrix. Revisions and their items are immutable snapshots
// (#393 / DT-9), so this read derives commercial presence strictly from
// stored revision state — never from the live mutable quote.

// ListQuoteRevisionsByProject returns every immutable QuoteRevision of the
// project with its per-unit commercial items, ordered by revision number
// ascending. Items load fail-closed: corrupt JSON snapshots are rejected
// instead of guessed. Missing, foreign or cross-tenant projects answer
// ErrQuoteRevisionNotFound (uniform 404, no existence oracle).
func (s *PostgresStore) ListQuoteRevisionsByProject(ctx context.Context, projectID string) ([]domain.QuoteRevisionDetail, error) {
	if !isValidUUID(projectID) {
		return nil, domain.ErrQuoteRevisionNotFound
	}
	orgID := OrgFromCtx(ctx)
	// Mirror the quote_revisions RLS read policy in plain SQL (caller's
	// organization must be explicitly named by the project) so the repository
	// stays tenant-safe even on connections where RLS is not the enforcement
	// layer (tests, admin tooling).
	var visible int
	err := s.db(ctx).QueryRow(ctx, `
		SELECT 1
		FROM projects p
		WHERE p.id = $1
		  AND (p.organization_id = $2 OR p.sales_organization_id = $2 OR p.manufacturing_organization_id = $2)
	`, projectID, orgID).Scan(&visible)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrQuoteRevisionNotFound
		}
		return nil, err
	}

	rows, err := s.db(ctx).Query(ctx, `
		SELECT id, organization_id, project_id, revision_number, status, source_type,
			COALESCE(notes, ''), COALESCE(created_by::text, ''),
			COALESCE(base_quote_revision_id::text, ''), COALESCE(source_design_revision_id::text, ''),
			created_at
		FROM quote_revisions
		WHERE project_id = $1
		ORDER BY revision_number ASC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	details := []domain.QuoteRevisionDetail{}
	revisionIDs := []string{}
	for rows.Next() {
		var d domain.QuoteRevisionDetail
		if err := rows.Scan(
			&d.ID,
			&d.OrganizationID,
			&d.ProjectID,
			&d.RevisionNumber,
			&d.Status,
			&d.SourceType,
			&d.Notes,
			&d.CreatedBy,
			&d.BaseQuoteRevisionID,
			&d.SourceDesignRevisionID,
			&d.CreatedAt,
		); err != nil {
			return nil, err
		}
		details = append(details, d)
		revisionIDs = append(revisionIDs, d.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(revisionIDs) == 0 {
		return details, nil
	}

	itemRows, err := s.db(ctx).Query(ctx, `
		SELECT quote_revision_id, furniture_instance_id,
			COALESCE(furniture_definition_id::text, ''), definition_version,
			parameters, material_choices, lifecycle_status
		FROM quote_revision_items
		WHERE quote_revision_id = ANY($1)
		ORDER BY quote_revision_id, furniture_instance_id
	`, revisionIDs)
	if err != nil {
		return nil, err
	}
	defer itemRows.Close()

	itemsByRevision := make(map[string][]domain.QuoteRevisionItem, len(details))
	for itemRows.Next() {
		var revisionID, instanceID, definitionID, lifecycle string
		var definitionVersion *int
		var paramsJSON, materialsJSON []byte
		if err := itemRows.Scan(&revisionID, &instanceID, &definitionID, &definitionVersion, &paramsJSON, &materialsJSON, &lifecycle); err != nil {
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

		itemsByRevision[revisionID] = append(itemsByRevision[revisionID], domain.QuoteRevisionItem{
			FurnitureInstanceID:   instanceID,
			FurnitureDefinitionID: definitionID,
			DefinitionVersion:     definitionVersion,
			Parameters:            parameters,
			MaterialChoices:       materialChoices,
			LifecycleStatus:       lifecycle,
		})
	}
	if err := itemRows.Err(); err != nil {
		return nil, err
	}

	for i := range details {
		if items, ok := itemsByRevision[details[i].ID]; ok {
			details[i].Items = items
		} else {
			details[i].Items = []domain.QuoteRevisionItem{}
		}
	}

	return details, nil
}
