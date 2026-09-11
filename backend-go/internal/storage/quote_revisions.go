package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

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
			created_at, published_at, accepted_at, COALESCE(commercial_snapshot, 'null'::jsonb)
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
		var commercialSnapshot []byte
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
			&d.PublishedAt,
			&d.AcceptedAt,
			&commercialSnapshot,
		); err != nil {
			return nil, err
		}
		// #642: the frozen commercial payload decodes fail-closed — corrupt
		// history is rejected, never guessed. NULL (legacy revisions that
		// never froze commercial truth) stays honestly absent; consumers fail
		// closed instead of recalculating.
		snapshot, err := parseQuoteCommercialSnapshot(commercialSnapshot)
		if err != nil {
			return nil, err
		}
		d.CommercialSnapshot = snapshot
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

// ListProjectCommercialSummaries resolves the authoritative commercial summary
// for every project accessible to the caller's organization (#642 / 2A).
// Selection per project:
// 1. Authoritative QuoteRevision: 'accepted' status if present, otherwise newest revision.
// 2. In-progress draft detection: if Q_accepted is selected, detects whether a newer draft exists (e.g. Q3 draft while Q2 is accepted).
// 3. Fail-closed: missing commercial snapshot marks isLegacy=true with nil saleTotal; corrupt snapshot returns error.
func (s *PostgresStore) ListProjectCommercialSummaries(ctx context.Context) ([]domain.ProjectCommercialSummary, error) {
	orgID, err := RequireOrgFromCtx(ctx)
	if err != nil {
		return nil, err
	}

	query := `
		SELECT
			p.id::text,
			p.name,
			p.customer_id::text,
			COALESCE(c.name, p.customer_id::text) AS customer_name,
			p.currency,
			COALESCE(p.owner_user_id::text, ''),
			p.created_at,
			p.updated_at,
			qr.id::text AS revision_id,
			qr.revision_number,
			qr.status AS revision_status,
			qr.created_at AS revision_created_at,
			qr.published_at,
			qr.accepted_at,
			COALESCE(qr.commercial_snapshot, 'null'::jsonb),
			COALESCE(qr.item_count, 0),
			draft_qr.revision_number AS active_draft_revision_number
		FROM projects p
		LEFT JOIN customers c ON c.id = p.customer_id AND c.organization_id = p.organization_id
		LEFT JOIN LATERAL (
			SELECT
				id,
				revision_number,
				status,
				created_at,
				published_at,
				accepted_at,
				commercial_snapshot,
				(SELECT count(*) FROM quote_revision_items WHERE quote_revision_id = quote_revisions.id) AS item_count
			FROM quote_revisions
			WHERE project_id = p.id
			ORDER BY CASE WHEN status = 'accepted' THEN 0 ELSE 1 END ASC, revision_number DESC
			LIMIT 1
		) qr ON true
		LEFT JOIN LATERAL (
			SELECT revision_number
			FROM quote_revisions
			WHERE project_id = p.id
			  AND status = 'draft'
			  AND qr.status = 'accepted'
			  AND revision_number > qr.revision_number
			ORDER BY revision_number DESC
			LIMIT 1
		) draft_qr ON true
		WHERE p.organization_id = $1 OR p.sales_organization_id = $1 OR p.manufacturing_organization_id = $1
		ORDER BY p.updated_at DESC;
	`

	rows, err := s.db(ctx).Query(ctx, query, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var summaries []domain.ProjectCommercialSummary
	for rows.Next() {
		var (
			projectID, projectName, customerID, customerName, currency, ownerUserID string
			projectCreatedAt, projectUpdatedAt                                     time.Time
			revisionID, revisionStatus                                             *string
			revisionNumber                                                         *int64
			revisionCreatedAt, publishedAt, acceptedAt                             *time.Time
			commercialSnapshotRaw                                                  []byte
			itemCount                                                              int64
			activeDraftRevisionNumber                                              *int64
		)

		if err := rows.Scan(
			&projectID,
			&projectName,
			&customerID,
			&customerName,
			&currency,
			&ownerUserID,
			&projectCreatedAt,
			&projectUpdatedAt,
			&revisionID,
			&revisionNumber,
			&revisionStatus,
			&revisionCreatedAt,
			&publishedAt,
			&acceptedAt,
			&commercialSnapshotRaw,
			&itemCount,
			&activeDraftRevisionNumber,
		); err != nil {
			return nil, err
		}

		summary := domain.ProjectCommercialSummary{
			ProjectID:            projectID,
			ProjectName:          projectName,
			Currency:             currency,
			OwnerUserID:          ownerUserID,
			CommercialActivityAt: projectUpdatedAt.UTC().Format(time.RFC3339),
		}

		if customerID != "" {
			summary.CustomerID = &customerID
		}
		if customerName != "" {
			summary.CustomerName = &customerName
		}

		if revisionID == nil {
			summary.QuoteStatus = domain.ProjectCommercialQuoteStatusNone
			summary.IsLegacy = false
			summary.FurnitureQuantity = 0
			summaries = append(summaries, summary)
			continue
		}

		summary.QuoteRevisionID = revisionID
		summary.QuoteRevisionNumber = revisionNumber
		summary.ActiveDraftRevisionNumber = activeDraftRevisionNumber

		switch *revisionStatus {
		case "accepted":
			summary.QuoteStatus = domain.ProjectCommercialQuoteStatusAccepted
		case "published":
			summary.QuoteStatus = domain.ProjectCommercialQuoteStatusPublished
		case "draft":
			summary.QuoteStatus = domain.ProjectCommercialQuoteStatusDraft
		case "superseded":
			summary.QuoteStatus = domain.ProjectCommercialQuoteStatusSuperseded
		default:
			summary.QuoteStatus = domain.ProjectCommercialQuoteStatusDraft
		}

		if acceptedAt != nil && !acceptedAt.IsZero() {
			summary.CommercialActivityAt = acceptedAt.UTC().Format(time.RFC3339)
		} else if publishedAt != nil && !publishedAt.IsZero() {
			summary.CommercialActivityAt = publishedAt.UTC().Format(time.RFC3339)
		} else if revisionCreatedAt != nil && !revisionCreatedAt.IsZero() {
			summary.CommercialActivityAt = revisionCreatedAt.UTC().Format(time.RFC3339)
		}

		snapshot, err := parseQuoteCommercialSnapshot(commercialSnapshotRaw)
		if err != nil {
			return nil, err
		}

		if snapshot == nil {
			summary.IsLegacy = true
			summary.SaleTotal = nil
			summary.FurnitureQuantity = itemCount
		} else {
			summary.IsLegacy = false
			salePrice := snapshot.Breakdown.SalePrice
			summary.SaleTotal = &salePrice
			if snapshot.Currency != "" {
				summary.Currency = snapshot.Currency
			}

			var qty int64
			for _, line := range snapshot.Lines {
				qty += int64(line.Quantity)
			}
			if qty == 0 && len(snapshot.Units) > 0 {
				qty = int64(len(snapshot.Units))
			}
			if qty == 0 && itemCount > 0 {
				qty = itemCount
			}
			summary.FurnitureQuantity = qty
		}

		summaries = append(summaries, summary)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	if summaries == nil {
		summaries = []domain.ProjectCommercialSummary{}
	}
	return summaries, nil
}
