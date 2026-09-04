package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #395 / DT-11: server-authoritative ProductionRelease creation and readback
// (ADR-0003, digital-thread §§17, 21–23, 25.6, invariant I6).
//
// One transaction decides everything: permission gates ran upstream, but the
// commercial baseline, the approved status, the reconciliation gate, the
// authoritative manufacturing preflight and the fingerprint are ALL evaluated
// server-side here, against the exact immutable revision rows, immediately
// before the INSERT commits. There is no client-supplied verdict anywhere
// (§33). The inserted row is history: nothing ever updates it (§21), and the
// readback derives staleness as a projection without touching the row (§24).

// CreateProductionReleaseCommand is the durable release command. QuoteRevisionID
// is optional: design-first projects release without a commercial baseline
// (§12); when present it is validated and pinned exactly.
type CreateProductionReleaseCommand struct {
	ProjectID        string
	DesignRevisionID string
	QuoteRevisionID  string
	ActorUserID      string
	IP               string
	RequestID        string
}

// ProductionReleaseReadback pairs the immutable release record with its
// derived staleness projection (#395 §34).
type ProductionReleaseReadback struct {
	Release   domain.ProductionRelease
	Staleness domain.ProductionReleaseStaleness
}

// CreateProductionRelease runs the §17 release gate end-to-end inside one
// transaction and inserts the immutable release row.
func (s *PostgresStore) CreateProductionRelease(ctx context.Context, cmd CreateProductionReleaseCommand) (*ProductionReleaseReadback, error) {
	if !isValidUUID(cmd.ProjectID) || !isValidUUID(cmd.DesignRevisionID) {
		return nil, domain.ErrInvalidReleaseCommand
	}
	if cmd.QuoteRevisionID != "" && !isValidUUID(cmd.QuoteRevisionID) {
		return nil, domain.ErrInvalidReleaseCommand
	}
	actor := nonEmptyOrDefault(cmd.ActorUserID, tenantActorUserID(ctx))
	if actor == "" || !isValidUUID(actor) {
		return nil, domain.ErrInvalidReleaseCommand
	}

	tx, owned, err := s.beginOrUseTx(ctx)
	if err != nil {
		return nil, err
	}
	if owned {
		defer tx.Rollback(ctx)
	}
	txCtx := context.WithValue(ctx, transactionContextKey{}, tx)

	// 1. Lock the project row: ownership check + race-safe release numbering
	// (mirrors the #393 quote numbering pattern).
	var projectOrgID string
	err = s.db(txCtx).QueryRow(txCtx, `
		SELECT organization_id FROM projects WHERE id = $1 FOR UPDATE
	`, cmd.ProjectID).Scan(&projectOrgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignNotFound
		}
		return nil, err
	}

	// 2. Load the EXACT DesignRevision (§10: never latest, never working copy)
	// and enforce same-project + approved.
	var drProjectID, drDesignID, drStatus string
	var drRevisionNumber int
	err = s.db(txCtx).QueryRow(txCtx, `
		SELECT project_id, design_id::text, revision_number, status
		FROM design_revisions
		WHERE id = $1
	`, cmd.DesignRevisionID).Scan(&drProjectID, &drDesignID, &drRevisionNumber, &drStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignRevisionNotFound
		}
		return nil, err
	}
	if drProjectID != cmd.ProjectID {
		return nil, domain.ErrCrossProjectRelease
	}
	if drStatus != string(domain.DesignRevisionStatusApproved) {
		return nil, domain.ErrDesignRevisionNotApproved
	}

	// 3. Load the immutable snapshot items: preflight and fingerprint inputs.
	items, err := s.ListDesignRevisionItems(txCtx, cmd.DesignRevisionID)
	if err != nil {
		return nil, err
	}

	// 4. Commercial baseline: exact, same-project, accepted (§12, §15). A
	// draft or superseded quote never grounds production.
	const quoteStatusAccepted = "accepted"
	quoteRevisionID := ""
	if cmd.QuoteRevisionID != "" {
		var qrProjectID, qrStatus string
		err = s.db(txCtx).QueryRow(txCtx, `
			SELECT project_id, status FROM quote_revisions WHERE id = $1
		`, cmd.QuoteRevisionID).Scan(&qrProjectID, &qrStatus)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, domain.ErrQuoteRevisionNotFound
			}
			return nil, err
		}
		if qrProjectID != cmd.ProjectID {
			return nil, domain.ErrCrossProjectRelease
		}
		if qrStatus != quoteStatusAccepted {
			return nil, domain.ErrReleaseQuoteNotAccepted
		}
		quoteRevisionID = cmd.QuoteRevisionID
	}

	// 5. Reconciliation gate over the exact revisions (#393/#394): the server
	// recomputes; a client "no conflict" claim is never input (§13–§15).
	if quoteRevisionID != "" {
		inputs, err := s.loadReconciliationInputs(txCtx, cmd.ProjectID, quoteRevisionID, cmd.DesignRevisionID)
		if err != nil {
			return nil, err
		}
		reconciliation, err := domain.Reconcile(inputs.Quote, inputs.Design)
		if err != nil {
			return nil, err
		}
		classification, err := domain.ClassifyReconciliation(reconciliation)
		if err != nil {
			return nil, err
		}
		if err := domain.EvaluateReleaseCommercialGate(classification); err != nil {
			return nil, err
		}
	}

	// 6. Authoritative manufacturing preflight against the organization
	// catalog (§16–§17). Any blocker rejects the whole release.
	definitions, err := s.loadReferencedFurnitureDefinitionParameters(txCtx, projectOrgID, items)
	if err != nil {
		return nil, err
	}
	preflight := domain.RunManufacturingPreflight(cmd.DesignRevisionID, items, definitions)
	if preflight.Status == domain.ManufacturingPreflightBlocked {
		return nil, &domain.ReleasePreflightBlockedError{Result: preflight}
	}

	// 7. Server-computed manufacturing fingerprint over the same immutable
	// items the preflight validated (§18–§19). Because both derive from
	// immutable rows inside this transaction, the release can never commit
	// with a stale preflight/fingerprint pair (§31 race closed by design).
	fingerprint, err := domain.ManufacturingFingerprint(items)
	if err != nil {
		return nil, err
	}

	// 8. Race-safe release numbering under the project row lock.
	var releaseNumber int
	if err := s.db(txCtx).QueryRow(txCtx, `
		SELECT COALESCE(MAX(release_number), 0) + 1
		FROM production_releases WHERE project_id = $1
	`, cmd.ProjectID).Scan(&releaseNumber); err != nil {
		return nil, err
	}

	// 9. Insert the immutable pin. The approved-revision RLS backstop
	// (migration 000119) re-verifies the design revision status at the
	// database boundary.
	release := domain.ProductionRelease{
		ProjectID:                cmd.ProjectID,
		DesignRevisionID:         cmd.DesignRevisionID,
		QuoteRevisionID:          quoteRevisionID,
		ReleaseNumber:            releaseNumber,
		DesignRevisionNumber:     drRevisionNumber,
		ManufacturingFingerprint: fingerprint,
		Status:                   domain.ProductionReleaseStatusActive,
		ReleasedBy:               actor,
		OrganizationID:           projectOrgID,
	}
	err = s.db(txCtx).QueryRow(txCtx, `
		INSERT INTO production_releases (
			organization_id, project_id, release_number,
			design_revision_id, quote_revision_id,
			manufacturing_fingerprint, status, released_by
		) VALUES ($1, $2, $3, $4, NULLIF($5, '')::uuid, $6, $7, $8)
		RETURNING id, released_at
	`, projectOrgID, cmd.ProjectID, releaseNumber,
		cmd.DesignRevisionID, quoteRevisionID,
		fingerprint, string(domain.ProductionReleaseStatusActive), actor,
	).Scan(&release.ID, &release.ReleasedAt)
	if err != nil {
		return nil, err
	}

	// 10. Durable audit in the SAME transaction (§35).
	details := map[string]interface{}{
		"production_release_id":     release.ID,
		"project_id":                release.ProjectID,
		"design_revision_id":        release.DesignRevisionID,
		"design_revision_number":    release.DesignRevisionNumber,
		"release_number":            release.ReleaseNumber,
		"manufacturing_fingerprint": release.ManufacturingFingerprint,
		"preflight_status":          string(preflight.Status),
		"item_count":                len(items),
	}
	if quoteRevisionID != "" {
		details["quote_revision_id"] = quoteRevisionID
	}
	if err := s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
		EventType:      "production_release_created",
		ActorUserID:    actor,
		OrganizationID: projectOrgID,
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details:        details,
	}); err != nil {
		return nil, fmt.Errorf("audit production_release_created: %w", err)
	}

	// Read-only staleness projection inside the same transaction: the freshly
	// pinned release and the latest revision are both visible here under the
	// tenant RLS context.
	staleness, err := s.releaseStaleness(txCtx, release, drDesignID)
	if err != nil {
		return nil, err
	}

	if owned {
		if err := tx.Commit(txCtx); err != nil {
			return nil, err
		}
	}
	return &ProductionReleaseReadback{Release: release, Staleness: *staleness}, nil
}

// loadReferencedFurnitureDefinitionParameters loads the persisted parameter
// contracts for exactly the definitions the revision references. A definition
// whose contract fails to decode fail-closes its items (ContractInvalid)
// instead of blocking unrelated catalog rows or being skipped silently.
func (s *PostgresStore) loadReferencedFurnitureDefinitionParameters(ctx context.Context, organizationID string, items []domain.DesignRevisionItem) (map[string]domain.FurnitureDefinitionParameters, error) {
	referenced := make(map[string]bool, len(items))
	for _, item := range items {
		if item.FurnitureDefinitionID != "" {
			referenced[item.FurnitureDefinitionID] = true
		}
	}
	definitions := make(map[string]domain.FurnitureDefinitionParameters, len(referenced))
	if len(referenced) == 0 {
		return definitions, nil
	}

	rows, err := s.db(ctx).Query(ctx, `
		SELECT id::text, parameter_definitions
		FROM modules
		WHERE organization_id = $1
	`, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	raw := make(map[string][]byte, len(referenced))
	for rows.Next() {
		var id string
		var parameterJSON []byte
		if err := rows.Scan(&id, &parameterJSON); err != nil {
			return nil, err
		}
		if referenced[id] {
			raw[id] = parameterJSON
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for id := range referenced {
		parameterJSON, found := raw[id]
		if !found {
			continue // absent definition: preflight reports missing_definition
		}
		decoded, err := domain.DecodeFurnitureParameterDefinitions(parameterJSON, domain.FurnitureParameterDefinitionBoundaryPersisted)
		if err != nil {
			definitions[id] = domain.FurnitureDefinitionParameters{ContractInvalid: true}
			continue
		}
		definitions[id] = domain.FurnitureDefinitionParameters{ParameterDefinitions: decoded}
	}
	return definitions, nil
}

const productionReleaseColumns = `
	id, organization_id, project_id, release_number,
	design_revision_id, COALESCE(quote_revision_id::text, ''),
	manufacturing_fingerprint, status, released_by::text, released_at`

func scanProductionRelease(row pgx.Row) (*domain.ProductionRelease, error) {
	var r domain.ProductionRelease
	if err := row.Scan(
		&r.ID, &r.OrganizationID, &r.ProjectID, &r.ReleaseNumber,
		&r.DesignRevisionID, &r.QuoteRevisionID,
		&r.ManufacturingFingerprint, &r.Status, &r.ReleasedBy, &r.ReleasedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrReleaseNotFound
		}
		return nil, err
	}
	return &r, nil
}

// ListProjectProductionReleases returns the project's releases (newest first)
// with their derived staleness projection.
func (s *PostgresStore) ListProjectProductionReleases(ctx context.Context, projectID string) ([]ProductionReleaseReadback, error) {
	if !isValidUUID(projectID) {
		return nil, domain.ErrInvalidReleaseCommand
	}
	if _, err := s.loadProjectOrganization(ctx, projectID); err != nil {
		return nil, err
	}

	rows, err := s.db(ctx).Query(ctx, `
		SELECT `+productionReleaseColumns+`
		FROM production_releases
		WHERE project_id = $1
		ORDER BY release_number DESC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	releases := []ProductionReleaseReadback{}
	for rows.Next() {
		release, err := scanProductionRelease(rows)
		if err != nil {
			return nil, err
		}
		staleness, err := s.releaseStaleness(ctx, *release, "")
		if err != nil {
			return nil, err
		}
		releases = append(releases, ProductionReleaseReadback{Release: *release, Staleness: *staleness})
	}
	return releases, rows.Err()
}

// GetProjectProductionRelease returns one exact release with its staleness
// projection. Missing and cross-project are the same 404 (uniform with the
// digital-thread negative-proof policy).
func (s *PostgresStore) GetProjectProductionRelease(ctx context.Context, projectID, releaseID string) (*ProductionReleaseReadback, error) {
	if !isValidUUID(projectID) || !isValidUUID(releaseID) {
		return nil, domain.ErrInvalidReleaseCommand
	}
	if _, err := s.loadProjectOrganization(ctx, projectID); err != nil {
		return nil, err
	}

	release, err := scanProductionRelease(s.db(ctx).QueryRow(ctx, `
		SELECT `+productionReleaseColumns+`
		FROM production_releases
		WHERE id = $1 AND project_id = $2
	`, releaseID, projectID))
	if err != nil {
		if errors.Is(err, domain.ErrReleaseNotFound) {
			return nil, domain.ErrReleaseNotFound
		}
		return nil, err
	}

	staleness, err := s.releaseStaleness(ctx, *release, "")
	if err != nil {
		return nil, err
	}
	return &ProductionReleaseReadback{Release: *release, Staleness: *staleness}, nil
}

// loadProjectOrganization verifies the project is visible under tenant RLS.
func (s *PostgresStore) loadProjectOrganization(ctx context.Context, projectID string) (string, error) {
	var orgID string
	if err := s.db(ctx).QueryRow(ctx, `
		SELECT organization_id FROM projects WHERE id = $1
	`, projectID).Scan(&orgID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", domain.ErrDesignNotFound
		}
		return "", err
	}
	return orgID, nil
}

// releaseStaleness derives the §24 projection: compare the release's pinned
// fingerprint with the fingerprint of the latest revision of the same design.
// Fingerprint comparison — not revision numbers — decides manufacturing
// staleness, so a spatial-only newer revision does NOT flag the release stale
// (§25). Read-only: the release row itself is never touched.
func (s *PostgresStore) releaseStaleness(ctx context.Context, release domain.ProductionRelease, knownDesignID string) (*domain.ProductionReleaseStaleness, error) {
	designID := knownDesignID
	if designID == "" {
		if err := s.db(ctx).QueryRow(ctx, `
			SELECT design_id::text FROM design_revisions WHERE id = $1
		`, release.DesignRevisionID).Scan(&designID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, domain.ErrDesignRevisionNotFound
			}
			return nil, err
		}
	}

	var latestID string
	var latestNumber int
	err := s.db(ctx).QueryRow(ctx, `
		SELECT id::text, revision_number
		FROM design_revisions
		WHERE design_id = $1
		ORDER BY revision_number DESC
		LIMIT 1
	`, designID).Scan(&latestID, &latestNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignRevisionNotFound
		}
		return nil, err
	}

	staleness := &domain.ProductionReleaseStaleness{
		CurrentDesignRevisionID:     latestID,
		CurrentDesignRevisionNumber: latestNumber,
	}
	if latestID == release.DesignRevisionID {
		return staleness, nil
	}

	latestItems, err := s.ListDesignRevisionItems(ctx, latestID)
	if err != nil {
		return nil, err
	}
	latestFingerprint, err := domain.ManufacturingFingerprint(latestItems)
	if err != nil {
		return nil, err
	}
	staleness.ManufacturingStale = latestFingerprint != release.ManufacturingFingerprint
	return staleness, nil
}
