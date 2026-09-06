package storage_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #571 / WEB-DT-4: commercial QuoteRevision lifecycle against real
// PostgreSQL under the app role.
//
// Key contracts verified:
// - CreateInitialQuoteRevision snapshots the editable commercial state
//   server-side: quote lines, materialized physical units (qty>1 stays N
//   distinct identities), design truth precedence over line custom_dims over
//   module dimensions.
// - The initial command is Q1-only: a retry or concurrent create fails typed
//   instead of minting a second revision (single #393 writer).
// - Publish and Accept operate on the EXACT revision; acceptance supersedes
//   the previously accepted revision ATOMICALLY in the same transaction.
// - Concurrent accepts serialize (advisory lock) leaving exactly one
//   accepted revision; the partial unique index (000121) backstops any
//   bypass.
// - Commercial revisions stay with the owning organization; a manufacturing
//   partner with shared read access cannot create, publish or accept.
// - Durable audit events land in the same transaction as each transition.

const (
	qlLineA         = "61000000-0000-0000-0000-0000000000a1"
	qlLineNoDims    = "61000000-0000-0000-0000-0000000000a2"
	qlSharedLineB   = "61000000-0000-0000-0000-0000000000b1"
	qlCustomDimsRow = `{"widthMm": 600, "heightMm": 720, "depthMm": 560}`
)

type quoteLifecycleFixture struct {
	*rlsFixture
	projectID string
}

// setupQuoteLifecycleFixture builds the canonical Q1 stage on the org-A-only
// project: one quote line (custom dims, quantity 3) over the fixture module.
func setupQuoteLifecycleFixture(t *testing.T) *quoteLifecycleFixture {
	t.Helper()
	fx := setupDesignsTestFixture(t)
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO project_items (id, project_id, module_id, quantity, custom_dims, organization_id)
		VALUES ($1, $2, $3, 3, $4::jsonb, '`+rlsOrgA+`')`,
		qlLineA, fiProjectAOnly, fiModuleA, qlCustomDimsRow); err != nil {
		t.Fatalf("seed quote line: %v", err)
	}
	return &quoteLifecycleFixture{rlsFixture: fx, projectID: fiProjectAOnly}
}

func createInitialRevision(t *testing.T, fx *quoteLifecycleFixture) *storage.CreateInitialQuoteRevisionResult {
	t.Helper()
	var result *storage.CreateInitialQuoteRevisionResult
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var txErr error
		result, txErr = fx.store.CreateInitialQuoteRevision(ctx, storage.CreateInitialQuoteRevisionCommand{
			ProjectID:   fx.projectID,
			ActorUserID: rlsUserA,
			RequestID:   "quote-lifecycle-test",
		})
		return txErr
	})
	if err != nil {
		t.Fatalf("CreateInitialQuoteRevision: %v", err)
	}
	return result
}

func publishRevision(t *testing.T, fx *quoteLifecycleFixture, revisionID string) *domain.QuoteRevision {
	t.Helper()
	var rev *domain.QuoteRevision
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var txErr error
		rev, txErr = fx.store.PublishQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
			ProjectID:       fx.projectID,
			QuoteRevisionID: revisionID,
			ActorUserID:     rlsUserA,
			RequestID:       "quote-lifecycle-test",
		})
		return txErr
	})
	if err != nil {
		t.Fatalf("PublishQuoteRevision: %v", err)
	}
	return rev
}

func acceptRevision(t *testing.T, fx *quoteLifecycleFixture, revisionID string) *storage.AcceptQuoteRevisionResult {
	t.Helper()
	var result *storage.AcceptQuoteRevisionResult
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var txErr error
		result, txErr = fx.store.AcceptQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
			ProjectID:       fx.projectID,
			QuoteRevisionID: revisionID,
			ActorUserID:     rlsUserA,
			RequestID:       "quote-lifecycle-test",
		})
		return txErr
	})
	if err != nil {
		t.Fatalf("AcceptQuoteRevision: %v", err)
	}
	return result
}

func listRevisions(t *testing.T, fx *quoteLifecycleFixture) []domain.QuoteRevisionDetail {
	t.Helper()
	var details []domain.QuoteRevisionDetail
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var txErr error
		details, txErr = fx.store.ListQuoteRevisionsByProject(ctx, fx.projectID)
		return txErr
	}); err != nil {
		t.Fatalf("list revisions: %v", err)
	}
	return details
}

func revisionStatus(t *testing.T, fx *quoteLifecycleFixture, revisionID string) string {
	t.Helper()
	for _, d := range listRevisions(t, fx) {
		if d.ID == revisionID {
			return d.Status
		}
	}
	return ""
}

func countAcceptedRevisions(t *testing.T, fx *quoteLifecycleFixture) int {
	t.Helper()
	count := 0
	for _, d := range listRevisions(t, fx) {
		if d.Status == "accepted" {
			count++
		}
	}
	return count
}

func itemInstanceIDs(t *testing.T, fx *quoteLifecycleFixture, revisionID string) []string {
	t.Helper()
	for _, d := range listRevisions(t, fx) {
		if d.ID == revisionID {
			ids := make([]string, 0, len(d.Items))
			for _, item := range d.Items {
				ids = append(ids, item.FurnitureInstanceID)
			}
			return ids
		}
	}
	t.Fatalf("revision %s not found", revisionID)
	return nil
}

func countAuditEvents(t *testing.T, fx *quoteLifecycleFixture, eventType, revisionID string) int {
	t.Helper()
	var count int
	if err := fx.admin.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM security_audit_events
		WHERE event_type = $1 AND details->>'quote_revision_id' = $2`,
		eventType, revisionID).Scan(&count); err != nil {
		t.Fatalf("count audit events: %v", err)
	}
	return count
}

// The canonical Q1: server-side snapshot of the editable commercial state —
// materialized units (qty 3 → 3 distinct identities), line custom_dims as the
// quoted configuration, durable audit in the same transaction.
func TestQuoteLifecycle_CreateInitialRevision_ServerSnapshot(t *testing.T) {
	fx := setupQuoteLifecycleFixture(t)
	result := createInitialRevision(t, fx)

	rev := result.Revision
	if rev.RevisionNumber != 1 || rev.Status != "draft" || rev.SourceType != "manual" {
		t.Fatalf("Q1 = {number:%d status:%s source:%s}, want {1 draft manual}", rev.RevisionNumber, rev.Status, rev.SourceType)
	}

	details := listRevisions(t, fx)
	if len(details) != 1 || len(details[0].Items) != 3 {
		t.Fatalf("expected exactly Q1 with 3 per-unit items, got %d revisions", len(details))
	}
	seen := map[string]bool{}
	for _, item := range details[0].Items {
		if item.FurnitureInstanceID == "" || seen[item.FurnitureInstanceID] {
			t.Fatalf("qty>1 must stay distinct physical identities, got duplicate/empty: %q", item.FurnitureInstanceID)
		}
		seen[item.FurnitureInstanceID] = true
		if item.FurnitureDefinitionID != fiModuleA {
			t.Fatalf("item definition = %q, want the quoted module", item.FurnitureDefinitionID)
		}
		if item.LifecycleStatus != "active" {
			t.Fatalf("item lifecycle = %q, want active", item.LifecycleStatus)
		}
		if item.Parameters["widthMm"] != float64(600) || item.Parameters["heightMm"] != float64(720) {
			t.Fatalf("item parameters must come from the line's custom_dims, got %v", item.Parameters)
		}
	}
	if len(result.CreatedInstanceIDs) != 3 {
		t.Fatalf("materialization must create the 3 missing units, got %d", len(result.CreatedInstanceIDs))
	}
	if count := countAuditEvents(t, fx, "quote_revision_created", rev.ID); count != 1 {
		t.Fatalf("quote_revision_created audit events = %d, want 1", count)
	}
}

// Q1-only by contract: a retry (or concurrent create) after success fails
// typed — the single #393 writer never mints a second baseless revision.
func TestQuoteLifecycle_CreateInitialRevision_RetryNeverMintsQ2(t *testing.T) {
	fx := setupQuoteLifecycleFixture(t)
	first := createInitialRevision(t, fx)

	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, txErr := fx.store.CreateInitialQuoteRevision(ctx, storage.CreateInitialQuoteRevisionCommand{
			ProjectID:   fx.projectID,
			ActorUserID: rlsUserA,
		})
		return txErr
	})
	if !errors.Is(err, domain.ErrQuoteRevisionConflict) {
		t.Fatalf("second create must fail typed conflict, got %v", err)
	}

	details := listRevisions(t, fx)
	if len(details) != 1 || details[0].ID != first.Revision.ID {
		t.Fatalf("retry must not create a new revision, got %d revisions", len(details))
	}
}

// The line's configured custom dimensions win over catalog module dimensions.
func TestQuoteLifecycle_CreateInitialRevision_CustomDimsPrecedence(t *testing.T) {
	fx := setupQuoteLifecycleFixture(t)

	createInitialRevision(t, fx)
	details := listRevisions(t, fx)
	if len(details) != 1 {
		t.Fatalf("expected 1 revision, got %d", len(details))
	}
	if len(details[0].Items) != 3 {
		t.Fatalf("expected 3 items for quantity=3, got %d", len(details[0].Items))
	}
	for _, item := range details[0].Items {
		if item.Parameters["widthMm"] != float64(600) {
			t.Fatalf("custom_dims widthMm must be 600, got %v", item.Parameters)
		}
		if item.Parameters["heightMm"] != float64(720) {
			t.Fatalf("custom_dims heightMm must be 720, got %v", item.Parameters)
		}
		if item.Parameters["depthMm"] != float64(560) {
			t.Fatalf("custom_dims depthMm must be 560, got %v", item.Parameters)
		}
	}
}

// Without design truth or custom_dims, the catalog definition dimensions are
// the honest quoted configuration.
func TestQuoteLifecycle_CreateInitialRevision_ModuleDimsFallback(t *testing.T) {
	base := setupDesignsTestFixture(t)
	ctx := context.Background()
	if _, err := base.admin.Exec(ctx, `
		INSERT INTO project_items (id, project_id, module_id, quantity, organization_id)
		VALUES ($1, $2, $3, 1, '`+rlsOrgA+`')`,
		qlLineNoDims, fiProjectAOnly, fiModuleA); err != nil {
		t.Fatalf("seed line: %v", err)
	}
	if _, err := base.admin.Exec(ctx, `
		UPDATE modules SET width_mm = 300, height_mm = 720, depth_mm = 590 WHERE id = $1`, fiModuleA); err != nil {
		t.Fatalf("seed module dims: %v", err)
	}
	fx := &quoteLifecycleFixture{rlsFixture: base, projectID: fiProjectAOnly}
	createInitialRevision(t, fx)

	details := listRevisions(t, fx)
	params := details[0].Items[0].Parameters
	if params["widthMm"] != float64(300) || params["heightMm"] != float64(720) || params["depthMm"] != float64(590) {
		t.Fatalf("module dims fallback expected, got %v", params)
	}
}

// Guards: no quote lines, legacy-accepted project, non-owner organization and
// unknown project all fail typed without creating anything.
func TestQuoteLifecycle_CreateInitialRevision_Guards(t *testing.T) {
	fx := setupDesignsTestFixture(t)

	// No quote lines.
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, txErr := fx.store.CreateInitialQuoteRevision(ctx, storage.CreateInitialQuoteRevisionCommand{
			ProjectID: fiProjectAOnly,
		})
		return txErr
	})
	if !errors.Is(err, domain.ErrInvalidRevisionSnapshot) {
		t.Fatalf("no-lines project must fail typed, got %v", err)
	}

	// Legacy accepted project: the editable commercial state is pinned.
	if _, err := fx.admin.Exec(context.Background(),
		`UPDATE projects SET status='accepted' WHERE id=$1`, fiProjectAOnly); err != nil {
		t.Fatalf("set accepted: %v", err)
	}
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, txErr := fx.store.CreateInitialQuoteRevision(ctx, storage.CreateInitialQuoteRevisionCommand{
			ProjectID: fiProjectAOnly,
		})
		return txErr
	})
	if !errors.Is(err, domain.ErrQuoteRevisionAccepted) {
		t.Fatalf("legacy-accepted project must fail typed, got %v", err)
	}
	if _, err := fx.admin.Exec(context.Background(),
		`UPDATE projects SET status='draft' WHERE id=$1`, fiProjectAOnly); err != nil {
		t.Fatalf("reset draft: %v", err)
	}

	// Manufacturing partner (org B) has shared read on fiSharedProject but
	// commercial revisions stay with the owner.
	if _, err := fx.admin.Exec(context.Background(), `
		INSERT INTO project_items (id, project_id, module_id, quantity, organization_id)
		VALUES ($1, $2, $3, 1, '`+rlsOrgA+`')`,
		qlSharedLineB, fiSharedProject, fiModuleA); err != nil {
		t.Fatalf("seed shared line: %v", err)
	}
	err = fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, txErr := fx.store.CreateInitialQuoteRevision(ctx, storage.CreateInitialQuoteRevisionCommand{
			ProjectID: fiSharedProject,
		})
		return txErr
	})
	if !errors.Is(err, domain.ErrFurnitureInstanceProjectNotWritable) {
		t.Fatalf("org B must not create commercial revisions, got %v", err)
	}

	// Unknown project.
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, txErr := fx.store.CreateInitialQuoteRevision(ctx, storage.CreateInitialQuoteRevisionCommand{
			ProjectID: "00000000-0000-0000-0000-00000000dead",
		})
		return txErr
	})
	if !errors.Is(err, domain.ErrDesignNotFound) {
		t.Fatalf("unknown project must 404 typed, got %v", err)
	}
}

// Publish: draft → published on the exact revision; same-status, terminal
// states, cross-project and non-owner all reject typed.
func TestQuoteLifecycle_Publish(t *testing.T) {
	fx := setupQuoteLifecycleFixture(t)
	revisionID := createInitialRevision(t, fx).Revision.ID

	published := publishRevision(t, fx, revisionID)
	if published.Status != "published" || published.RevisionNumber != 1 {
		t.Fatalf("publish result = %+v", published)
	}
	if count := countAuditEvents(t, fx, "quote_revision_published", revisionID); count != 1 {
		t.Fatalf("quote_revision_published audit events = %d, want 1", count)
	}

	// Same-status retry (different key) rejects typed.
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, txErr := fx.store.PublishQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
			ProjectID:       fx.projectID,
			QuoteRevisionID: revisionID,
		})
		return txErr
	})
	if !errors.Is(err, domain.ErrQuoteRevisionInvalidTransition) {
		t.Fatalf("double publish must fail typed, got %v", err)
	}

	// Cross-project: exact revision of another project is uniform 404.
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, txErr := fx.store.PublishQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
			ProjectID:       fiProjectB,
			QuoteRevisionID: revisionID,
		})
		return txErr
	})
	if !errors.Is(err, domain.ErrQuoteRevisionNotFound) {
		t.Fatalf("cross-project publish must 404, got %v", err)
	}

	// An organization with no access to the project gets the uniform 404 (no
	// existence oracle): the A-only project's revisions are invisible to org B.
	err = fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, txErr := fx.store.PublishQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
			ProjectID:       fx.projectID,
			QuoteRevisionID: revisionID,
		})
		return txErr
	})
	if !errors.Is(err, domain.ErrQuoteRevisionNotFound) {
		t.Fatalf("org B must get the uniform 404, got %v", err)
	}

	// A shared-read organization (manufacturing partner on the A-B project)
	// can see the revision but commercial transitions stay with the owner.
	if _, err := fx.admin.Exec(context.Background(), `
		INSERT INTO project_items (id, project_id, module_id, quantity, organization_id)
		VALUES ($1, $2, $3, 1, '`+rlsOrgA+`')`,
		qlSharedLineB, fiSharedProject, fiModuleA); err != nil {
		t.Fatalf("seed shared line: %v", err)
	}
	var sharedQ1 string
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		result, txErr := fx.store.CreateInitialQuoteRevision(ctx, storage.CreateInitialQuoteRevisionCommand{
			ProjectID:   fiSharedProject,
			ActorUserID: rlsUserA,
		})
		if txErr != nil {
			return txErr
		}
		sharedQ1 = result.Revision.ID
		return nil
	})
	if err != nil {
		t.Fatalf("create shared Q1: %v", err)
	}
	err = fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, txErr := fx.store.PublishQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
			ProjectID:       fiSharedProject,
			QuoteRevisionID: sharedQ1,
		})
		return txErr
	})
	if !errors.Is(err, domain.ErrFurnitureInstanceProjectNotWritable) {
		t.Fatalf("manufacturing partner must not publish, got %v", err)
	}
}

// Accept: publish is mandatory; acceptance supersedes the previous accepted
// revision atomically and never leaves two accepted behind.
func TestQuoteLifecycle_AcceptAtomicSupersede(t *testing.T) {
	fx := setupQuoteLifecycleFixture(t)
	q1 := createInitialRevision(t, fx).Revision.ID
	instanceIDs := itemInstanceIDs(t, fx, q1)

	// Draft cannot be accepted directly.
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, txErr := fx.store.AcceptQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
			ProjectID:       fx.projectID,
			QuoteRevisionID: q1,
		})
		return txErr
	})
	if !errors.Is(err, domain.ErrQuoteRevisionInvalidTransition) {
		t.Fatalf("draft accept must fail typed, got %v", err)
	}

	publishRevision(t, fx, q1)
	accepted := acceptRevision(t, fx, q1)
	if accepted.Revision.Status != "accepted" {
		t.Fatalf("Q1 status = %s, want accepted", accepted.Revision.Status)
	}
	if countAcceptedRevisions(t, fx) != 1 {
		t.Fatalf("expected exactly one accepted revision")
	}
	if count := countAuditEvents(t, fx, "quote_revision_accepted", q1); count != 1 {
		t.Fatalf("quote_revision_accepted audit events = %d, want 1", count)
	}

	// Re-accept rejects typed (idempotent readback is the HTTP receipt's job).
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, txErr := fx.store.AcceptQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
			ProjectID:       fx.projectID,
			QuoteRevisionID: q1,
		})
		return txErr
	})
	if !errors.Is(err, domain.ErrQuoteRevisionInvalidTransition) {
		t.Fatalf("re-accept must fail typed, got %v", err)
	}

	// A next published revision accepts atomically: Q1 → superseded, Q2 →
	// accepted, one transaction, exactly one accepted.
	var q2 string
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		rev, txErr := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID:      fx.projectID,
			BaseRevisionID: q1,
			Status:         "published",
			SourceType:     "manual",
			Items: []storage.CreateQuoteRevisionItemCommand{{
				FurnitureInstanceID:   instanceIDs[0],
				FurnitureDefinitionID: fiModuleA,
				Parameters:            map[string]any{"widthMm": 650.0},
			}},
		})
		if txErr != nil {
			return txErr
		}
		q2 = rev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("create Q2: %v", err)
	}

	result := acceptRevision(t, fx, q2)
	if result.Revision.Status != "accepted" {
		t.Fatalf("Q2 status = %s, want accepted", result.Revision.Status)
	}
	if len(result.SupersededRevisions) != 1 || result.SupersededRevisions[0].ID != q1 {
		t.Fatalf("acceptance must supersede Q1 atomically, got %+v", result.SupersededRevisions)
	}
	if status := revisionStatus(t, fx, q1); status != "superseded" {
		t.Fatalf("Q1 status = %s, want superseded", status)
	}
	if count := countAcceptedRevisions(t, fx); count != 1 {
		t.Fatalf("invariant broken: %d accepted revisions", count)
	}
	if count := countAuditEvents(t, fx, "quote_revision_superseded", q1); count != 1 {
		t.Fatalf("quote_revision_superseded audit events = %d, want 1", count)
	}

	// Superseded history is terminal.
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, txErr := fx.store.AcceptQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
			ProjectID:       fx.projectID,
			QuoteRevisionID: q1,
		})
		return txErr
	})
	if !errors.Is(err, domain.ErrQuoteRevisionInvalidTransition) {
		t.Fatalf("superseded accept must fail typed, got %v", err)
	}
}

// Concurrent accepts serialize on the per-project advisory lock: whichever
// commits last wins and the single-accepted invariant always holds.
func TestQuoteLifecycle_ConcurrentAcceptsLeaveSingleWinner(t *testing.T) {
	fx := setupQuoteLifecycleFixture(t)
	q1 := createInitialRevision(t, fx).Revision.ID
	instanceIDs := itemInstanceIDs(t, fx, q1)
	publishRevision(t, fx, q1)
	acceptRevision(t, fx, q1)

	// Two further published revisions to race. Chained on the exact latest
	// base (Q2 on Q1, Q3 on Q2) — creation happens before the race.
	revisionIDs := make([]string, 2)
	base := q1
	for i := range revisionIDs {
		nextBase := base
		err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
			rev, txErr := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
				ProjectID:      fx.projectID,
				BaseRevisionID: nextBase,
				Status:         "published",
				SourceType:     "manual",
				Items: []storage.CreateQuoteRevisionItemCommand{{
					FurnitureInstanceID:   instanceIDs[i],
					FurnitureDefinitionID: fiModuleA,
				}},
			})
			if txErr != nil {
				return txErr
			}
			revisionIDs[i] = rev.ID
			return nil
		})
		if err != nil {
			t.Fatalf("create racing revision %d: %v", i, err)
		}
		base = revisionIDs[i]
	}

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, revisionID := range revisionIDs {
		wg.Add(1)
		go func(i int, revisionID string) {
			defer wg.Done()
			errs[i] = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
				_, txErr := fx.store.AcceptQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
					ProjectID:       fx.projectID,
					QuoteRevisionID: revisionID,
					ActorUserID:     rlsUserA,
				})
				return txErr
			})
		}(i, revisionID)
	}
	wg.Wait()

	succeeded := 0
	for i, err := range errs {
		if err == nil {
			succeeded++
			continue
		}
		// A loser may only fail typed (e.g. the winner superseded it first or
		// it was already superseded) — never with an unexpected error.
		if !errors.Is(err, domain.ErrQuoteRevisionInvalidTransition) && !errors.Is(err, domain.ErrQuoteRevisionConflict) {
			t.Fatalf("concurrent accept %d failed unexpectedly: %v", i, err)
		}
	}
	if succeeded == 0 {
		t.Fatalf("at least one concurrent accept must succeed, errs=%v", errs)
	}
	if count := countAcceptedRevisions(t, fx); count != 1 {
		t.Fatalf("single-accepted invariant broken: %d accepted", count)
	}
}

// The partial unique index (000121) is the durable backstop: even a direct
// migration-role UPDATE cannot leave two accepted revisions behind.
func TestQuoteLifecycle_AcceptedUniquenessBackstop(t *testing.T) {
	fx := setupQuoteLifecycleFixture(t)
	q1 := createInitialRevision(t, fx).Revision.ID
	instanceIDs := itemInstanceIDs(t, fx, q1)
	publishRevision(t, fx, q1)
	acceptRevision(t, fx, q1)

	var q2 string
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		rev, txErr := fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID:      fx.projectID,
			BaseRevisionID: q1,
			Status:         "published",
			SourceType:     "manual",
			Items: []storage.CreateQuoteRevisionItemCommand{{
				FurnitureInstanceID:   instanceIDs[0],
				FurnitureDefinitionID: fiModuleA,
			}},
		})
		if txErr != nil {
			return txErr
		}
		q2 = rev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("create Q2: %v", err)
	}

	_, err = fx.admin.Exec(context.Background(),
		`UPDATE quote_revisions SET status='accepted' WHERE id=$1`, q2)
	if err == nil || !strings.Contains(err.Error(), "uq_quote_revisions_one_accepted_per_project") {
		t.Fatalf("second accepted revision must be blocked by the unique index, got: %v", err)
	}
}
