package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
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

	if transactionFromContext(ctx) == nil {
		actor, ok := TenantActorFromCtx(ctx)
		if !ok {
			return nil, ErrInvalidTenantActor
		}
		var result *ProductionReleaseReadback
		err := s.WithinTenantTx(WithConsistentCatalogTx(ctx), actor, func(inner context.Context) error {
			var err error
			result, err = s.CreateProductionRelease(inner, cmd)
			return err
		})
		if err != nil {
			return nil, err
		}
		return result, nil
	}
	if err := verifyConsistentCatalogTx(ctx, transactionFromContext(ctx)); err != nil {
		return nil, err
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

	// 3-6. The ONE authoritative gate chain (exact accepted quote →
	// reconciliation commercial gate → manufacturing preflight + release
	// snapshot resolution), shared with the #502 production approval so both
	// commands enforce identical verdicts over the exact pair.
	outcome, err := s.enforceProductionGates(txCtx, projectOrgID, cmd.ProjectID, cmd.QuoteRevisionID, cmd.DesignRevisionID)
	if err != nil {
		return nil, err
	}
	items, catalog, collection := outcome.items, outcome.catalog, outcome.collection

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
	quoteRevisionID := cmd.QuoteRevisionID
	release := domain.ProductionRelease{
		ProjectID:                cmd.ProjectID,
		DesignID:                 drDesignID,
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

	if err := s.insertReleaseManufacturingSnapshot(txCtx, release, items, collection, catalog); err != nil {
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
		"preflight_status":          string(outcome.preflight.Status),
		"snapshot_schema_version":   2,
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

// releaseGateOutcome carries the single authoritative evaluation every
// release surface shares (#727): the immutable items, the manufacturing
// preflight verdict, the coherent catalog snapshot and the resolved release
// collection. The release command resolves ONCE here and reuses the
// collection for its immutable snapshot — no second resolution.
type releaseGateOutcome struct {
	items      []domain.DesignRevisionItem
	preflight  *domain.ManufacturingPreflightResult
	catalog    domain.Catalog
	collection *engine.ResolvedReleaseCollection
}

// evaluateReleaseManufacturingReadiness runs the authoritative manufacturing
// preflight AND the release snapshot resolution over the exact immutable
// revision items (§§16–17 + #727 preflight↔release parity): a revision is
// manufacturing-ready only if the SAME snapshot would resolve in
// ResolveReleaseCollection. No BOM rule is duplicated here — both verdicts
// come from the same engines the release command runs.
func (s *PostgresStore) evaluateReleaseManufacturingReadiness(ctx context.Context, projectOrgID, designRevisionID string, items []domain.DesignRevisionItem) (*releaseGateOutcome, error) {
	// 1. Authoritative manufacturing preflight against the organization
	// catalog (§§16–§17). Any blocker rejects the whole command.
	definitions, err := s.loadReferencedFurnitureDefinitionParameters(ctx, projectOrgID, items)
	if err != nil {
		return nil, err
	}
	materialIDs, err := s.loadSelectedMaterialIDs(ctx, projectOrgID, items)
	if err != nil {
		return nil, err
	}
	preflight := domain.RunManufacturingPreflight(designRevisionID, items, definitions, materialIDs)
	if preflight.Status == domain.ManufacturingPreflightBlocked {
		return &releaseGateOutcome{items: items, preflight: preflight},
			&domain.ReleasePreflightBlockedError{Result: preflight}
	}

	// 2. Release snapshot resolution (#727): the manufacturing preflight alone
	// is not the release verdict — the exact snapshot must also resolve. A
	// resolution failure is reported BOTH as the typed command error (409
	// blocker release_snapshot_resolution) and as a blocked preflight verdict,
	// so no surface can present an unresolvable revision as ready.
	catalog, err := s.GetFullCatalog(ctx)
	if err != nil {
		return nil, err
	}
	collection, err := engine.ResolveReleaseCollection(designRevisionID, items, catalog)
	if err != nil {
		return &releaseGateOutcome{items: items, preflight: preflightBlockedBySnapshotResolution(preflight, err)},
			fmt.Errorf("%w: %w", ErrReleaseSnapshotResolution, err)
	}
	if _, err := engine.DeriveReleaseRoutingProgram(items, collection.Units, catalog); err != nil {
		return &releaseGateOutcome{items: items, preflight: preflightBlockedBySnapshotResolution(preflight, err)},
			fmt.Errorf("%w: %w", ErrReleaseSnapshotResolution, err)
	}
	return &releaseGateOutcome{items: items, preflight: preflight, catalog: catalog, collection: collection}, nil
}

// preflightBlockedBySnapshotResolution derives the honest BLOCKED verdict from
// a typed resolution failure: same scope, same revision, one issue carrying
// the physical identities and the business-safe reason (#727). The failing
// unit's item-level verdict flips to blocked so per-unit projections stay
// coherent with the collection verdict.
func preflightBlockedBySnapshotResolution(ready *domain.ManufacturingPreflightResult, err error) *domain.ManufacturingPreflightResult {
	blocked := &domain.ManufacturingPreflightResult{
		DesignRevisionID: ready.DesignRevisionID,
		Scope:            ready.Scope,
		Status:           domain.ManufacturingPreflightBlocked,
		Items:            ready.Items,
	}
	var failure *domain.ReleaseUnitResolutionFailure
	if !errors.As(err, &failure) {
		blocked.Issues = append(blocked.Issues, domain.ManufacturingPreflightIssue{
			Code:    domain.PreflightIssueSnapshotResolution,
			Message: "la revisión no puede resolverse para fabricación",
		})
		return blocked
	}
	issue := domain.ManufacturingPreflightIssue{
		Code:                  domain.PreflightIssueSnapshotResolution,
		FurnitureInstanceID:   failure.FurnitureInstanceID,
		FurnitureDefinitionID: failure.FurnitureDefinitionID,
		Message:               failure.Reason,
	}
	blocked.Issues = append(blocked.Issues, issue)
	for i := range blocked.Items {
		if blocked.Items[i].FurnitureInstanceID == failure.FurnitureInstanceID {
			blocked.Items[i].Status = domain.ManufacturingPreflightItemBlocked
			blocked.Items[i].Issues = append(blocked.Items[i].Issues, issue)
			break
		}
	}
	return blocked
}

// enforceProductionGates is the ONE authoritative gate chain shared by the
// release command and the #502 production approval: exact accepted commercial
// baseline (when pinned), reconciliation commercial gate over the exact pair
// (#393/#394 — the server always recomputes) and the authoritative
// manufacturing readiness (preflight + release snapshot resolution, #727) of
// the organization catalog (§§12–17). Any verdict rejects the whole command
// with the typed domain error the HTTP layer maps to structured 409 blockers.
func (s *PostgresStore) enforceProductionGates(ctx context.Context, projectOrgID, projectID, quoteRevisionID, designRevisionID string) (*releaseGateOutcome, error) {
	// 1. Commercial baseline: exact, same-project, accepted. A draft or
	// superseded quote never grounds production.
	const quoteStatusAccepted = "accepted"
	if quoteRevisionID != "" {
		var qrProjectID, qrStatus string
		err := s.db(ctx).QueryRow(ctx, `
			SELECT project_id, status FROM quote_revisions WHERE id = $1
		`, quoteRevisionID).Scan(&qrProjectID, &qrStatus)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, domain.ErrQuoteRevisionNotFound
			}
			return nil, err
		}
		if qrProjectID != projectID {
			return nil, domain.ErrCrossProjectRelease
		}
		if qrStatus != quoteStatusAccepted {
			return nil, domain.ErrReleaseQuoteNotAccepted
		}
	}

	// 2. Immutable snapshot items: preflight and fingerprint inputs.
	items, err := s.ListDesignRevisionItems(ctx, designRevisionID)
	if err != nil {
		return nil, err
	}

	// 3. Reconciliation commercial gate over the exact revisions: a client
	// "no conflict" claim is never input (§§13–§15).
	if quoteRevisionID != "" {
		inputs, err := s.loadReconciliationInputs(ctx, projectID, quoteRevisionID, designRevisionID)
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

	// 4. Manufacturing readiness: authoritative preflight + release snapshot
	// resolution (#727 parity — the gate cannot present as ready a revision
	// whose exact snapshot would fail to resolve).
	return s.evaluateReleaseManufacturingReadiness(ctx, projectOrgID, designRevisionID, items)
}

// EvaluateDesignRevisionPreflight (#502 / WEB-DT-3) evaluates the exact same
// authoritative release manufacturing preflight that gates
// CreateProductionRelease — read-only, over the immutable revision snapshot
// and the organization catalog. There is deliberately no second engine: the
// same loaders, the same domain function, the same verdict a release command
// would enforce. Nothing is persisted and no release is created.
func (s *PostgresStore) EvaluateDesignRevisionPreflight(ctx context.Context, designID, revisionID string) (*domain.ManufacturingPreflightResult, error) {
	if !isValidUUID(designID) || !isValidUUID(revisionID) {
		return nil, domain.ErrInvalidReleaseCommand
	}

	// 1. Load the exact revision pinned to its design (cross-design answers
	// the uniform revision 404, mirroring GetDesignRevision semantics) and
	// resolve the owning organization for the catalog lookup.
	var drDesignID, projectOrgID string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT design_id::text, organization_id::text
		FROM design_revisions WHERE id = $1
	`, revisionID).Scan(&drDesignID, &projectOrgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignRevisionNotFound
		}
		return nil, err
	}
	if drDesignID != designID {
		return nil, domain.ErrDesignRevisionNotFound
	}

	// 2. Immutable snapshot items: the exact preflight inputs a release
	// would validate.
	items, err := s.ListDesignRevisionItems(ctx, revisionID)
	if err != nil {
		return nil, err
	}

	// 3-4. The ONE authoritative verdict, extended with the release snapshot
	// resolution (#727 parity): the preflight may not report READY for a
	// revision whose exact snapshot would fail to resolve at release time.
	// RLS scopes the revision read to the organizations that can access the
	// project, so a foreign revision never reaches this point. Both blocked
	// verdicts (manufacturing issues, unresolvable snapshot) are RESULTS, not
	// errors — the read-only evaluation answers with the authoritative verdict.
	outcome, err := s.evaluateReleaseManufacturingReadiness(ctx, projectOrgID, revisionID, items)
	if err != nil {
		var blocked *domain.ReleasePreflightBlockedError
		if errors.As(err, &blocked) {
			return blocked.Result, nil
		}
		if errors.Is(err, ErrReleaseSnapshotResolution) {
			return outcome.preflight, nil
		}
		return nil, err
	}
	return outcome.preflight, nil
}

// loadSelectedMaterialIDs checks membership only: role/kind resolution remains
// owned by the manufacturing resolver. Explicit project ownership also scopes
// shared-project reads; no ambient organization override or client authority.
func (s *PostgresStore) loadSelectedMaterialIDs(ctx context.Context, organizationID string, items []domain.DesignRevisionItem) (map[string]bool, error) {
	selected := make(map[string]bool)
	for _, item := range items {
		for _, id := range item.MaterialChoices {
			if id != "" {
				selected[id] = true
			}
		}
	}
	found := make(map[string]bool)
	if len(selected) == 0 {
		return found, nil
	}
	ids := make([]string, 0, len(selected))
	for id := range selected {
		ids = append(ids, id)
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT id::text FROM material_boards WHERE organization_id = $1 AND id::text = ANY($2)
		UNION ALL
		SELECT id::text FROM hardwares WHERE organization_id = $1 AND id::text = ANY($2)
		UNION ALL
		SELECT id::text FROM edge_bands WHERE organization_id = $1 AND id::text = ANY($2)
	`, organizationID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		found[id] = true
	}
	return found, rows.Err()
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

// productionReleaseColumns derives design_revision_number and the parent
// design id from the pinned revision row (the release table stores only the
// exact ids — §6).
const productionReleaseColumns = `
	pr.id, pr.organization_id, pr.project_id, pr.release_number,
	pr.design_revision_id, dr.design_id::text, dr.revision_number, COALESCE(pr.quote_revision_id::text, ''),
	pr.manufacturing_fingerprint, pr.status, pr.released_by::text, pr.released_at`

const productionReleaseFrom = `
	FROM production_releases pr
	JOIN design_revisions dr ON dr.id = pr.design_revision_id`

func scanProductionRelease(row pgx.Row) (*domain.ProductionRelease, error) {
	var r domain.ProductionRelease
	if err := row.Scan(
		&r.ID, &r.OrganizationID, &r.ProjectID, &r.ReleaseNumber,
		&r.DesignRevisionID, &r.DesignID, &r.DesignRevisionNumber, &r.QuoteRevisionID,
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
		SELECT `+productionReleaseColumns+productionReleaseFrom+`
		WHERE pr.project_id = $1
		ORDER BY pr.release_number DESC
	`, projectID)
	if err != nil {
		return nil, err
	}

	// Buffer every release row BEFORE deriving staleness: the staleness
	// projection issues its own queries, and issuing them while this rows
	// cursor is still open would collide on the pooled connection ("conn
	// busy").
	releases := make([]domain.ProductionRelease, 0, 8)
	for rows.Next() {
		release, err := scanProductionRelease(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		releases = append(releases, *release)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	readbacks := make([]ProductionReleaseReadback, 0, len(releases))
	for _, release := range releases {
		staleness, err := s.releaseStaleness(ctx, release, "")
		if err != nil {
			return nil, err
		}
		readbacks = append(readbacks, ProductionReleaseReadback{Release: release, Staleness: *staleness})
	}
	return readbacks, nil
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
		SELECT `+productionReleaseColumns+productionReleaseFrom+`
		WHERE pr.id = $1 AND pr.project_id = $2
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

// GetContextualProductionRelease finds the exact ProductionRelease whose
// immutable pins match the selected design revision (and quote revision when
// pinned). It returns nil without error when no release matches the context.
func (s *PostgresStore) GetContextualProductionRelease(ctx context.Context, projectID, designRevisionID, quoteRevisionID string) (*domain.ProductionRelease, error) {
	if !isValidUUID(projectID) || !isValidUUID(designRevisionID) {
		return nil, domain.ErrInvalidReleaseCommand
	}
	if quoteRevisionID != "" && !isValidUUID(quoteRevisionID) {
		return nil, domain.ErrInvalidReleaseCommand
	}

	var query string
	var args []any
	if quoteRevisionID != "" {
		query = `
			SELECT ` + productionReleaseColumns + productionReleaseFrom + `
			WHERE pr.project_id = $1
			  AND pr.design_revision_id = $2
			  AND (pr.quote_revision_id = $3::uuid OR pr.quote_revision_id IS NULL)
			ORDER BY CASE WHEN pr.quote_revision_id = $3::uuid THEN 0 ELSE 1 END, pr.release_number DESC
			LIMIT 1
		`
		args = []any{projectID, designRevisionID, quoteRevisionID}
	} else {
		query = `
			SELECT ` + productionReleaseColumns + productionReleaseFrom + `
			WHERE pr.project_id = $1
			  AND pr.design_revision_id = $2
			  AND pr.quote_revision_id IS NULL
			ORDER BY pr.release_number DESC
			LIMIT 1
		`
		args = []any{projectID, designRevisionID}
	}

	release, err := scanProductionRelease(s.db(ctx).QueryRow(ctx, query, args...))
	if err != nil {
		if errors.Is(err, domain.ErrReleaseNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return release, nil
}
