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
	if !isValidUUID(projectID) {
		return nil, domain.ErrQuoteRevisionNotFound
	}
	// Mirror the quote_revisions RLS read policy in plain SQL (caller's
	// organization must be explicitly named by the project) so the repository
	// stays tenant-safe even on connections where RLS is not the enforcement
	// layer (tests, admin tooling). The project's org naming also drives the
	// retail-amount visibility policy (#642/3): the owner organization and
	// the sales organization are authorized for the frozen sale price; a
	// caller that only manufactures the project is not (multi-org
	// distribution model §14 — same rule as the commercial summaries).
	var projectOrgID, salesOrgID string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT p.organization_id::text, COALESCE(p.sales_organization_id::text, '')
		FROM projects p
		WHERE p.id = $1
		  AND (p.organization_id = $2 OR p.sales_organization_id = $2 OR p.manufacturing_organization_id = $2)
	`, projectID, orgID).Scan(&projectOrgID, &salesOrgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrQuoteRevisionNotFound
		}
		return nil, err
	}
	saleAmountsVisible := projectOrgID == orgID || salesOrgID == orgID

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
		// #642/3: the frozen retail price is org-authorized, not just
		// role-authorized. A manufacturing-only caller receives the frozen
		// identity/lines/units (production truth) with the retail amounts
		// zeroed AND the explicit withheld flag — honest absence, never a
		// misleading 0 dressed as a real price, and never the raw amount.
		if !saleAmountsVisible && snapshot != nil {
			snapshot.Breakdown.SalePrice = 0
			for i := range snapshot.Lines {
				snapshot.Lines[i].Amounts.SalePrice = 0
			}
			d.CommercialAmountsWithheld = true
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
//  1. Authoritative QuoteRevision: 'accepted' status if present, otherwise newest revision.
//  2. In-progress draft detection: if Q_accepted is selected, detects whether a newer draft exists (e.g. Q3 draft while Q2 is accepted).
//  3. Frozen identity: a valid commercial snapshot owns project name, customer
//     identity and currency — the mutable Project row never re-labels history.
//  4. Active demand: snapshot furniture quantity is exactly SUM(lines.quantity);
//     there is NO fallback to unit counts, so a line whose units are all
//     removed/cancelled answers 0 instead of reviving terminal demand. Legacy
//     revisions (no snapshot) fall closed to their active revision items.
//  5. commercialActivityAt is a real revision lifecycle event
//     (accepted_at → published_at → created_at) or nil without a revision;
//     Project.updated_at is never a stand-in.
//  6. saleTotal fails closed: nil for legacy snapshots and for callers whose
//     organization reaches the project only as manufacturing organization
//     (retail price is not authorized for the factory by default — multi-org
//     distribution model §14).
//
// Corrupt snapshots fail closed: the whole batch answers 409 instead of
// partially guessed data (approved 2A behavior; one broken revision must not
// silently look like zero demand).
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
			p.organization_id::text,
			p.sales_organization_id::text,
			qr.id::text AS revision_id,
			qr.revision_number,
			qr.status AS revision_status,
			qr.created_at AS revision_created_at,
			qr.published_at,
			qr.accepted_at,
			COALESCE(qr.commercial_snapshot, 'null'::jsonb),
			COALESCE(qr.active_item_count, 0),
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
				(SELECT count(*) FROM quote_revision_items qri
					WHERE qri.quote_revision_id = quote_revisions.id
					  AND qri.lifecycle_status = 'active') AS active_item_count
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
		-- Deterministic batch order only: the Cotizaciones screen keeps the
		-- workspace project ordering and joins summaries by project id, so
		-- this is NOT a claim of "ordered by commercial activity".
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
			projectOrgID, salesOrgID                                                string
			revisionID, revisionStatus                                              *string
			revisionNumber                                                          *int64
			revisionCreatedAt, publishedAt, acceptedAt                              *time.Time
			commercialSnapshotRaw                                                   []byte
			activeItemCount                                                         int64
			activeDraftRevisionNumber                                               *int64
		)

		if err := rows.Scan(
			&projectID,
			&projectName,
			&customerID,
			&customerName,
			&currency,
			&ownerUserID,
			&projectOrgID,
			&salesOrgID,
			&revisionID,
			&revisionNumber,
			&revisionStatus,
			&revisionCreatedAt,
			&publishedAt,
			&acceptedAt,
			&commercialSnapshotRaw,
			&activeItemCount,
			&activeDraftRevisionNumber,
		); err != nil {
			return nil, err
		}

		// Retail sale total is authorized for the owner organization and the
		// sales organization; a caller that only manufactures the project
		// gets the summary with the amount redacted (fail-closed).
		saleTotalVisible := projectOrgID == orgID || salesOrgID == orgID

		summary := domain.ProjectCommercialSummary{
			ProjectID:         projectID,
			ProjectName:       projectName,
			Currency:          currency,
			OwnerUserID:       ownerUserID,
			IsLegacy:          false,
			SaleTotal:         nil,
			FurnitureQuantity: 0,
		}

		if customerID != "" {
			summary.CustomerID = &customerID
		}
		if customerName != "" {
			summary.CustomerName = &customerName
		}

		if revisionID == nil {
			summary.QuoteStatus = domain.ProjectCommercialQuoteStatusNone
			// No revision → no commercial activity ever happened; the mutable
			// Project timestamps are not a substitute (BLOCKER #4 of 2A review).
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
			// Reachable: published → superseded is a legal terminal transition
			// without a replacement accept; the exact newest revision is then
			// honestly reported as superseded.
			summary.QuoteStatus = domain.ProjectCommercialQuoteStatusSuperseded
		default:
			summary.QuoteStatus = domain.ProjectCommercialQuoteStatusDraft
		}

		// Real commercial event by lifecycle — never Project.updated_at.
		activityAt := revisionCreatedAt
		if publishedAt != nil && !publishedAt.IsZero() {
			activityAt = publishedAt
		}
		if acceptedAt != nil && !acceptedAt.IsZero() {
			activityAt = acceptedAt
		}
		if activityAt != nil && !activityAt.IsZero() {
			formatted := activityAt.UTC().Format(time.RFC3339)
			summary.CommercialActivityAt = &formatted
		}

		snapshot, err := parseQuoteCommercialSnapshot(commercialSnapshotRaw)
		if err != nil {
			return nil, err
		}

		if snapshot == nil {
			// Legacy revision without frozen truth: fail closed. No sale
			// total is derived from the mutable project, and demand counts
			// only the revision's still-active items — terminal units stay
			// history, never resurfaced demand.
			summary.IsLegacy = true
			summary.SaleTotal = nil
			summary.FurnitureQuantity = activeItemCount
			summaries = append(summaries, summary)
			continue
		}

		// Valid snapshot v1: the frozen payload owns the commercial identity
		// and the exact active quantity (SUM of line quantities, validated
		// against active physical units at freeze time). No unit/item-count
		// fallback: a line whose units are all removed/cancelled answers 0.
		summary.IsLegacy = false
		summary.ProjectName = snapshot.Project.Name
		snapshotCustomerID := snapshot.Customer.ID
		summary.CustomerID = &snapshotCustomerID
		snapshotCustomerName := snapshot.Customer.Name
		summary.CustomerName = &snapshotCustomerName
		if snapshot.Currency != "" {
			summary.Currency = snapshot.Currency
		}
		if saleTotalVisible {
			salePrice := snapshot.Breakdown.SalePrice
			summary.SaleTotal = &salePrice
		}
		var qty int64
		for _, line := range snapshot.Lines {
			qty += int64(line.Quantity)
		}
		summary.FurnitureQuantity = qty

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
