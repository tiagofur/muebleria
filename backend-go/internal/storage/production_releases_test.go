package storage_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #395 / DT-11 storage proofs against real PostgreSQL: the canonical negative
// proof (publishing R4 never mutates release P1), the §17 gates, approval
// lifecycle + immutability, RLS tenancy, race-safe numbering and the fresh +
// upgrade migrations.

type releaseFixture struct {
	store     *storage.PostgresStore
	admin     *pgxpool.Pool
	projectID string
	designID  string
	revR3     string // published → approved, clean against Q3
	quoteQ3   string // accepted
	fiA, fiB  string
}

const releaseMaterial = "70000000-0000-0000-0000-000000000001"

// setupReleaseFixture builds the canonical demo: Q3 accepted with FI-A/FI-B;
// published R3 identical to Q3 (clean reconciliation), then approved.
func setupReleaseFixture(t *testing.T) *releaseFixture {
	return setupReleaseFixtureWithChoices(t, map[string]string{"BODY": releaseMaterial})
}

func setupReleaseFixtureWithChoices(t *testing.T, choices map[string]string) *releaseFixture {
	t.Helper()
	fx := setupDesignsTestFixture(t)
	for _, statement := range []string{
		`INSERT INTO hardwares (id, code, name, unit, cost_per_unit, organization_id)
		 VALUES ('70000000-0000-0000-0000-000000000002', 'RELEASE-HINGE', 'Release hinge', 'piece', 12, '` + rlsOrgA + `')`,
		`INSERT INTO edge_bands (id, code, name, thickness_mm, cost_per_ml, organization_id)
		 VALUES ('70000000-0000-0000-0000-000000000003', 'RELEASE-EDGE', 'Release edge', 1, 2, '` + rlsOrgA + `')`,
	} {
		multiOrgExec(t, fx.admin, statement)
	}
	if _, ok := choices["legacy-body"]; ok {
		multiOrgExec(t, fx.admin, `UPDATE components SET option_roles='{legacy-body}', default_edges='[{"side":"L1","enabled":true}]' WHERE code='RELEASE-PANEL';
	 INSERT INTO hardware_lines (id,module_id,quantity,option_role,organization_id) VALUES
	 ('71000000-0000-0000-0000-000000000003','`+fiModuleA+`',1,'custom-hinge','`+rlsOrgA+`');`)
	}
	actorA := fiActorA()

	lineID := "60000000-0000-0000-0000-000000000093"
	if _, err := fx.admin.Exec(context.Background(), `
		INSERT INTO project_items (id, project_id, module_id, quantity, custom_dims, organization_id)
		VALUES ($1, $2, $3, 2, '{"widthMm": 600, "heightMm": 720, "depthMm": 560}', '`+rlsOrgA+`')`,
		lineID, fiSharedProject, fiModuleA); err != nil {
		t.Fatalf("seed quote line: %v", err)
	}

	out := &releaseFixture{store: fx.store, admin: fx.admin, projectID: fiSharedProject}
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Release Demo Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		out.designID = d.ID

		matRes, err := fx.store.MaterializeQuoteLine(ctx, storage.MaterializeQuoteLineCommand{
			ProjectID:   fiSharedProject,
			QuoteLineID: lineID,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		out.fiA = matRes.Instances[0].FurnitureInstanceID
		out.fiB = matRes.Instances[1].FurnitureInstanceID

		quoteItem := func(fiID string) storage.CreateQuoteRevisionItemCommand {
			return storage.CreateQuoteRevisionItemCommand{
				FurnitureInstanceID:   fiID,
				FurnitureDefinitionID: fiModuleA,
				Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
				MaterialChoices:       choices,
				LifecycleStatus:       "active",
			}
		}
		q3, err := createPublishedFixtureQuoteRevision(ctx, fx.store, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Notes:     "Q3",
			Items:     []storage.CreateQuoteRevisionItemCommand{quoteItem(out.fiA), quoteItem(out.fiB)},
		})
		if err != nil {
			return err
		}
		out.quoteQ3 = q3.ID
		if _, err := fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: q3.ID,
			Status:          "accepted",
		}); err != nil {
			return err
		}

		workingItem := func(fiID string) storage.UpdateDesignWorkingCopyItemCommand {
			return storage.UpdateDesignWorkingCopyItemCommand{
				FurnitureInstanceID:   fiID,
				FurnitureDefinitionID: fiModuleA,
				Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
				MaterialChoices:       choices,
				Transform:             domain.Transform3D{TranslationMm: [3]float64{100, 0, 0}},
			}
		}
		if _, err := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			Items:       []storage.UpdateDesignWorkingCopyItemCommand{workingItem(out.fiA), workingItem(out.fiB)},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}

		rev, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		out.revR3 = rev.ID

		approved, err := fx.store.ApproveDesignRevision(ctx, storage.ApproveDesignRevisionCommand{
			DesignID:         d.ID,
			DesignRevisionID: rev.ID,
			ActorUserID:      rlsUserA,
		})
		if err != nil {
			return err
		}
		if approved.Status != domain.DesignRevisionStatusApproved || approved.ApprovedBy != rlsUserA || approved.ApprovedAt == nil {
			return errors.New("R3 must be approved with server metadata before release")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("setup release fixture: %v", err)
	}
	return out
}

func releaseRowJSON(t *testing.T, pool *pgxpool.Pool, releaseID string) string {
	t.Helper()
	var raw string
	if err := pool.QueryRow(context.Background(),
		`SELECT to_jsonb(p)::text FROM production_releases p WHERE id = $1`, releaseID).Scan(&raw); err != nil {
		t.Fatalf("read release row: %v", err)
	}
	return raw
}

func releaseAuditEvents(t *testing.T, pool *pgxpool.Pool, eventType string) []map[string]any {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT details FROM security_audit_events WHERE event_type = $1 ORDER BY created_at`, eventType)
	if err != nil {
		t.Fatalf("read audit events %s: %v", eventType, err)
	}
	defer rows.Close()
	var events []map[string]any
	for rows.Next() {
		var details map[string]any
		if err := rows.Scan(&details); err != nil {
			t.Fatalf("scan audit event: %v", err)
		}
		events = append(events, details)
	}
	return events
}

// The canonical #395 proof: release P1 against approved R3/Q3, publish R4
// afterwards with a manufacturing change — P1 stays byte-identical, pinned to
// R3 and its fingerprint; the staleness projection flags it read-only. New
// production for R4 must go through the commercial gate again.
func TestProductionRelease_CanonicalPinningNegativeProof(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	var p1 *storage.ProductionReleaseReadback
	err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		p1, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
			RequestID:        "req-release-1",
		})
		return err
	})
	if err != nil {
		t.Fatalf("create release P1: %v", err)
	}
	if p1.Release.ReleaseNumber != 1 || p1.Release.DesignRevisionID != fx.revR3 ||
		p1.Release.QuoteRevisionID != fx.quoteQ3 || p1.Release.DesignRevisionNumber != 1 {
		t.Fatalf("P1 pins mismatch: %+v", p1.Release)
	}
	if !strings.HasPrefix(p1.Release.ManufacturingFingerprint, "sha256-") {
		t.Fatalf("P1 fingerprint must be sha256-…: %s", p1.Release.ManufacturingFingerprint)
	}
	if p1.Staleness.ManufacturingStale {
		t.Fatalf("fresh release must not be stale")
	}

	p1Before := releaseRowJSON(t, fx.admin, p1.Release.ID)
	fingerprintP1 := p1.Release.ManufacturingFingerprint

	// The designer keeps working: manufacturing-affecting change on FI-A.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		if _, err := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   fx.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 650.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
				{FurnitureInstanceID: fx.fiB, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		_, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       fx.designID,
			BaseRevisionID: fx.revR3,
			SourceType:     domain.DesignRevisionSourceSketchup,
			ActorUserID:    rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish R4: %v", err)
	}

	// CENTRAL NEGATIVE PROOF: P1 remains record-equivalent with its R3 pin.
	p1After := releaseRowJSON(t, fx.admin, p1.Release.ID)
	if p1After != p1Before {
		t.Fatalf("P1 must stay byte-identical after R4:\nbefore: %s\nafter:  %s", p1Before, p1After)
	}

	var readback *storage.ProductionReleaseReadback
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		readback, err = fx.store.GetProjectProductionRelease(ctx, fx.projectID, p1.Release.ID)
		return err
	})
	if err != nil {
		t.Fatalf("read P1 after R4: %v", err)
	}
	if readback.Release.DesignRevisionID != fx.revR3 || readback.Release.ManufacturingFingerprint != fingerprintP1 {
		t.Fatalf("P1 pins must never retarget (§21/§27): %+v", readback.Release)
	}
	if !readback.Staleness.ManufacturingStale {
		t.Fatalf("manufacturing change in R4 must flag P1 stale (§24/§26)")
	}
	if readback.Staleness.CurrentDesignRevisionNumber != 2 {
		t.Fatalf("current revision projection = %d, want 2", readback.Staleness.CurrentDesignRevisionNumber)
	}

	// §15: releasing R4 against the outdated Q3 baseline is rejected — no
	// demo exception skips the commercial gate. (Approval runs first per §29,
	// so R4 is approved to expose exactly the commercial verdict.)
	var commercial *domain.ReleaseCommercialGateError
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		if _, err := fx.store.ApproveDesignRevision(ctx, storage.ApproveDesignRevisionCommand{
			DesignID:         fx.designID,
			DesignRevisionID: readback.Staleness.CurrentDesignRevisionID,
			ActorUserID:      rlsUserA,
		}); err != nil {
			return err
		}
		_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: readback.Staleness.CurrentDesignRevisionID,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if err == nil || !errors.As(err, &commercial) || commercial.Cause != domain.ReleaseBlockerCommercialOutdated {
		t.Fatalf("R4 vs stale Q3 must block with commercial_baseline_outdated, got %v", err)
	}

	// Durable audit landed for both lifecycle facts, in the same transactions.
	approvals := releaseAuditEvents(t, fx.admin, "design_revision_approved")
	if len(approvals) != 1 || approvals[0]["design_revision_id"] != fx.revR3 {
		t.Fatalf("design_revision_approved audit mismatch: %+v", approvals)
	}
	releases := releaseAuditEvents(t, fx.admin, "production_release_created")
	if len(releases) != 1 || releases[0]["design_revision_id"] != fx.revR3 ||
		releases[0]["quote_revision_id"] != fx.quoteQ3 || releases[0]["manufacturing_fingerprint"] != fingerprintP1 {
		t.Fatalf("production_release_created audit mismatch: %+v", releases)
	}

	// The full flow for R4 production: explicit requote absorbs the commercial
	// change, the new quote is accepted, R4 is approved and released as P2 —
	// and P1 keeps its original pins.
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		requote, rErr := fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID:           fx.projectID,
			BaseQuoteRevisionID: fx.quoteQ3,
			DesignRevisionID:    readback.Staleness.CurrentDesignRevisionID,
		})
		if rErr != nil {
			return rErr
		}
		if _, err := fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: requote.Revision.ID,
			Status:          "published",
		}); err != nil {
			return err
		}
		if _, err := fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: requote.Revision.ID,
			Status:          "accepted",
		}); err != nil {
			return err
		}
		if _, err := fx.store.ApproveDesignRevision(ctx, storage.ApproveDesignRevisionCommand{
			DesignID:         fx.designID,
			DesignRevisionID: readback.Staleness.CurrentDesignRevisionID,
			ActorUserID:      rlsUserA,
		}); err != nil {
			return err
		}
		p2, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: readback.Staleness.CurrentDesignRevisionID,
			QuoteRevisionID:  requote.Revision.ID,
			ActorUserID:      rlsUserA,
		})
		if err != nil {
			return err
		}
		if p2.Release.ReleaseNumber != 2 {
			return errors.New("second release must number 2")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("R4 full flow to P2: %v", err)
	}

	if after := releaseRowJSON(t, fx.admin, p1.Release.ID); after != p1Before {
		t.Fatalf("P1 must remain untouched after P2 exists:\nbefore: %s\nafter:  %s", p1Before, after)
	}
}

// #642: commercial acceptance lives in QuoteRevision.status — never in
// Project.status. The golden pair (accepted quote + approved revision)
// releases while projects.status stays 'draft', and a legacy 'accepted'
// project status alone never authorizes a release over a non-accepted quote.
func TestProductionRelease_AuthorityIsQuoteRevisionNotProjectStatus(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	projectStatus := func() string {
		t.Helper()
		var status string
		if err := fx.admin.QueryRow(context.Background(),
			`SELECT status FROM projects WHERE id = $1`, fx.projectID).Scan(&status); err != nil {
			t.Fatalf("read project status: %v", err)
		}
		return status
	}

	// Golden: the fixture carries Q3 accepted + R3 approved with the project
	// still draft — the post-#642 commercial state. The release must succeed
	// over that exact pair and must not rewrite the project status.
	if got := projectStatus(); got != "draft" {
		t.Fatalf("fixture project must be draft (commercial acceptance lives in QuoteRevision), got %q", got)
	}
	var p1 *storage.ProductionReleaseReadback
	err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		p1, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
			RequestID:        "req-release-authority-1",
		})
		return err
	})
	if err != nil {
		t.Fatalf("accepted Q3 + approved R3 must release with Project.status=draft: %v", err)
	}
	if p1.Release.QuoteRevisionID != fx.quoteQ3 || p1.Release.DesignRevisionID != fx.revR3 {
		t.Fatalf("release must pin the exact pair, got Q=%s R=%s", p1.Release.QuoteRevisionID, p1.Release.DesignRevisionID)
	}
	if got := projectStatus(); got != "draft" {
		t.Fatalf("release must not rewrite Project.status, got %q", got)
	}

	// Negative proof: the legacy operational status authorizes nothing. A
	// project row stamped 'accepted' (the accidental legacy state) still
	// rejects a release whose exact quote is published but not accepted.
	if _, err := fx.admin.Exec(context.Background(),
		`UPDATE projects SET status = 'accepted' WHERE id = $1`, fx.projectID); err != nil {
		t.Fatalf("stamp legacy project status: %v", err)
	}
	var publishedQuoteID string
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		q, err := createPublishedFixtureQuoteRevision(ctx, fx.store, storage.CreateQuoteRevisionCommand{
			ProjectID: fx.projectID,
			Notes:     "Q4 published not accepted",
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}, LifecycleStatus: "active"},
				{FurnitureInstanceID: fx.fiB, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}, LifecycleStatus: "active"},
			},
			BaseRevisionID: fx.quoteQ3,
		})
		publishedQuoteID = q.ID
		return err
	})
	if err != nil {
		t.Fatalf("create published quote: %v", err)
	}
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  publishedQuoteID,
			ActorUserID:      rlsUserA,
			RequestID:        "req-release-authority-neg",
		})
		return err
	})
	if !errors.Is(err, domain.ErrReleaseQuoteNotAccepted) {
		t.Fatalf("Project.status='accepted' must NOT authorize a release over a non-accepted quote, got %v", err)
	}

	// The rejection is total: no second release row may exist.
	var releaseCount int
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM production_releases WHERE project_id = $1`, fx.projectID).Scan(&releaseCount); err != nil {
		t.Fatalf("count releases: %v", err)
	}
	if releaseCount != 1 {
		t.Fatalf("only the golden release may exist, got %d", releaseCount)
	}
}

// §25: a newer revision that differs ONLY spatially keeps the same
// manufacturing fingerprint — the old release is NOT flagged stale.
func TestProductionRelease_SpatialOnlyRevisionIsNotManufacturingStale(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	var p1 *storage.ProductionReleaseReadback
	err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		p1, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("create release: %v", err)
	}

	// R4: identical manufacturing inputs, furniture purely moved.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		if _, err := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   fx.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}, Transform: domain.Transform3D{TranslationMm: [3]float64{2400, 0, 0}, RotationDeg: [3]float64{0, 90, 0}}, RoomID: "room-2"},
				{FurnitureInstanceID: fx.fiB, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}, Transform: domain.Transform3D{TranslationMm: [3]float64{5000, 0, 0}}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		_, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       fx.designID,
			BaseRevisionID: fx.revR3,
			SourceType:     domain.DesignRevisionSourceSketchup,
			ActorUserID:    rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish spatial-only R4: %v", err)
	}

	var readback *storage.ProductionReleaseReadback
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		readback, err = fx.store.GetProjectProductionRelease(ctx, fx.projectID, p1.Release.ID)
		return err
	})
	if err != nil {
		t.Fatalf("read release: %v", err)
	}
	if readback.Staleness.ManufacturingStale {
		t.Fatalf("spatial-only R4 must NOT flag manufacturing staleness (§25)")
	}
	if readback.Staleness.CurrentDesignRevisionNumber != 2 {
		t.Fatalf("current revision projection should still advance to 2")
	}
}

func TestProductionRelease_Gates(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	// 1. Unapproved revision: publish a fresh R4 (published, not approved) and
	// try to release it.
	var revR4ID string
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		if _, err := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   fx.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		rev, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       fx.designID,
			BaseRevisionID: fx.revR3,
			SourceType:     domain.DesignRevisionSourceSketchup,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		revR4ID = rev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("publish unapproved R4: %v", err)
	}

	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: revR4ID,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrDesignRevisionNotApproved) {
		t.Fatalf("unapproved revision must reject the release (§9), got %v", err)
	}

	// 2. Quote not accepted: a fresh quote revision stays draft.
	var draftQuoteID string
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		q, err := createFixtureQuoteRevision(ctx, fx.store, storage.CreateQuoteRevisionCommand{
			ProjectID: fx.projectID,
			Notes:     "Q4 draft",
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}, LifecycleStatus: "active"},
			},
			Status:         "draft",
			BaseRevisionID: fx.quoteQ3,
		})
		draftQuoteID = q.ID
		return err
	})
	if err != nil {
		t.Fatalf("create draft quote: %v", err)
	}
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  draftQuoteID,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrReleaseQuoteNotAccepted) {
		t.Fatalf("draft quote must reject the release, got %v", err)
	}

	// 3. Preflight blocker: invalid parameter type against the module contract.
	var invalidRevID string
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		if _, err := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   fx.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": "seiscientos", "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		rev, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       fx.designID,
			BaseRevisionID: revR4ID,
			SourceType:     domain.DesignRevisionSourceSketchup,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		invalidRevID = rev.ID
		_, err = fx.store.ApproveDesignRevision(ctx, storage.ApproveDesignRevisionCommand{
			DesignID:         fx.designID,
			DesignRevisionID: rev.ID,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish+approve invalid revision: %v", err)
	}
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: invalidRevID,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	var preflight *domain.ReleasePreflightBlockedError
	if err == nil || !errors.As(err, &preflight) {
		t.Fatalf("invalid manufacturing data must block via preflight, got %v", err)
	}
	if len(preflight.Result.Issues) == 0 || preflight.Result.Issues[0].Code != domain.PreflightIssueInvalidParameters {
		t.Fatalf("expected invalid_parameters issue, got %+v", preflight.Result.Issues)
	}

	// 4. Cross-project revision: org B's actor cannot release org A's revision.
	err = releaseTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fiProjectB,
			DesignRevisionID: fx.revR3,
			ActorUserID:      rlsUserB,
		})
		return err
	})
	if !errors.Is(err, domain.ErrCrossProjectRelease) {
		t.Fatalf("releasing another project's revision must fail closed, got %v", err)
	}

	// 5. Design-first release without commercial baseline succeeds.
	var pFirst *storage.ProductionReleaseReadback
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		pFirst, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("design-first release (no quote) must succeed: %v", err)
	}
	if pFirst.Release.QuoteRevisionID != "" {
		t.Fatalf("release without commercial baseline must not pin a quote")
	}
}

func TestProductionRelease_ApprovalLifecycleAndIdempotency(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	var first, second *domain.DesignRevision
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		first, err = fx.store.ApproveDesignRevision(ctx, storage.ApproveDesignRevisionCommand{
			DesignID:         fx.designID,
			DesignRevisionID: fx.revR3,
			ActorUserID:      rlsUserA,
		})
		if err != nil {
			return err
		}
		second, err = fx.store.ApproveDesignRevision(ctx, storage.ApproveDesignRevisionCommand{
			DesignID:         fx.designID,
			DesignRevisionID: fx.revR3,
			ActorUserID:      rlsUserA, // same command replay
		})
		return err
	})
	if err != nil {
		t.Fatalf("approval replay: %v", err)
	}
	if second.Status != domain.DesignRevisionStatusApproved {
		t.Fatalf("replay must keep approved status")
	}
	if second.ApprovedBy != first.ApprovedBy || second.ApprovedAt == nil || !second.ApprovedAt.Equal(*first.ApprovedAt) {
		t.Fatalf("replay must be a no-op: approval metadata is history and never rewritten (%+v vs %+v)", first, second)
	}
	if len(releaseAuditEvents(t, fx.admin, "design_revision_approved")) != 1 {
		t.Fatalf("idempotent replay must not write a second approval audit")
	}

	// Org B must not see org A's revision (uniform 404).
	err = fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, err := fx.store.ApproveDesignRevision(ctx, storage.ApproveDesignRevisionCommand{
			DesignID:         fx.designID,
			DesignRevisionID: fx.revR3,
			ActorUserID:      rlsUserB,
		})
		return err
	})
	if !errors.Is(err, domain.ErrDesignRevisionNotFound) {
		t.Fatalf("org B must not see org A's revision: %v", err)
	}

	// Immutability backstop: only the exact approval transition passes the
	// trigger; everything else raises.
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `UPDATE design_revisions SET revision_number = 99 WHERE id = $1`, fx.revR3); err == nil {
		t.Fatalf("snapshot columns must be immutable even for the DB owner role")
	}
	if _, err := fx.admin.Exec(ctx, `UPDATE design_revisions SET status = 'published' WHERE id = $1`, fx.revR3); err == nil {
		t.Fatalf("approved → published must be rejected by the trigger")
	}
	if _, err := fx.admin.Exec(ctx, `DELETE FROM design_revisions WHERE id = $1`, fx.revR3); err == nil {
		t.Fatalf("revision deletion must be rejected")
	}
}

func TestProductionRelease_ReleaseRowsAreImmutableHistory(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	var p1 *storage.ProductionReleaseReadback
	err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		p1, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("create release: %v", err)
	}

	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx,
		`UPDATE production_releases SET design_revision_id = gen_random_uuid() WHERE id = $1`, p1.Release.ID); err == nil {
		t.Fatalf("retargeting a release (UpdateProductionReleaseToLatestDesign §27) must be impossible")
	}
	if _, err := fx.admin.Exec(ctx,
		`UPDATE production_releases SET manufacturing_fingerprint = 'sha256-0000000000000000000000000000000000000000000000000000000000000000' WHERE id = $1`, p1.Release.ID); err == nil {
		t.Fatalf("rewriting a release fingerprint must be impossible")
	}
	if _, err := fx.admin.Exec(ctx, `DELETE FROM production_releases WHERE id = $1`, p1.Release.ID); err == nil {
		t.Fatalf("deleting release history must be impossible")
	}
}

func TestProductionRelease_MultiOrgRLS(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	var p1 *storage.ProductionReleaseReadback
	err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		p1, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("create release: %v", err)
	}

	// Reads follow project organizations exactly like every digital-thread
	// table (explicitly-shared): the sharing manufacturer org B can READ the
	// release pinned to the shared project…
	var sharedRead *storage.ProductionReleaseReadback
	err = fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		var err error
		sharedRead, err = fx.store.GetProjectProductionRelease(ctx, fx.projectID, p1.Release.ID)
		return err
	})
	if err != nil || sharedRead == nil {
		t.Fatalf("org B must read releases of the shared project (read follows project organizations), got %v", err)
	}
	if sharedRead.Release.DesignRevisionID != fx.revR3 {
		t.Fatalf("shared read must see the exact pinned revision")
	}

	// …but org B cannot insert releases into org A's project: owner-org write
	// scope, RLS backstop behind the transactional gate.
	err = fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, err := fx.store.Pool.Exec(ctx, `
			INSERT INTO production_releases (organization_id, project_id, release_number, design_revision_id, manufacturing_fingerprint, released_by)
			VALUES ($1, $2, 1, $3, 'sha256-1111111111111111111111111111111111111111111111111111111111111111', $4)`,
			rlsOrgB, fiSharedProject, fx.revR3, rlsUserB)
		return err
	})
	if err == nil {
		t.Fatalf("org B must not be able to insert releases on org A's project")
	}
}

func TestProductionRelease_ConcurrentCreationNumbering(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	const concurrency = 4
	var wg sync.WaitGroup
	errs := make([]error, concurrency)
	releases := make([]*storage.ProductionReleaseReadback, concurrency)

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			for attempt := 0; attempt < concurrency; attempt++ {
				errs[idx] = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
					var err error
					releases[idx], err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
						ProjectID:        fx.projectID,
						DesignRevisionID: fx.revR3,
						ActorUserID:      rlsUserA,
					})
					return err
				})
				// A coherent snapshot cannot see a concurrently committed release.
				// Retry the entire transaction, never an INSERT inside the stale view.
				var conflict *pgconn.PgError
				if !errors.As(errs[idx], &conflict) || (conflict.Code != "40001" && conflict.ConstraintName != "uq_production_releases_project_number") {
					break
				}
			}
		}(i)
	}
	wg.Wait()

	seen := map[int]bool{}
	for i := 0; i < concurrency; i++ {
		if errs[i] != nil {
			t.Fatalf("concurrent release %d failed: %v", i, errs[i])
		}
		n := releases[i].Release.ReleaseNumber
		if seen[n] {
			t.Fatalf("duplicate release number %d — numbering must be race-safe", n)
		}
		seen[n] = true
	}
}

func readMigration(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile("../../db/migration/" + name)
	if err != nil {
		t.Fatalf("read migration %s: %v", name, err)
	}
	return string(raw)
}

func assertProductionReleaseSchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM information_schema.columns
		WHERE table_name = 'design_revisions' AND column_name IN ('approved_by', 'approved_at')`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("design_revisions approval columns missing (count=%d, err=%v)", count, err)
	}
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM pg_policies
		WHERE tablename = 'design_revisions' AND policyname = 'design_revisions_approve'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("design_revisions_approve policy missing (count=%d, err=%v)", count, err)
	}
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM information_schema.tables
		WHERE table_name = 'production_releases'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("production_releases table missing (count=%d, err=%v)", count, err)
	}
	for _, policy := range []string{"production_releases_read", "production_releases_insert"} {
		if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM pg_policies
			WHERE tablename = 'production_releases' AND policyname = $1`, policy).Scan(&count); err != nil || count != 1 {
			t.Fatalf("policy %s missing (count=%d, err=%v)", policy, count, err)
		}
	}
	var rls, forced bool
	if err := pool.QueryRow(ctx, `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'production_releases'`).Scan(&rls, &forced); err != nil || !rls || !forced {
		t.Fatalf("production_releases must have FORCED row level security (rls=%v forced=%v err=%v)", rls, forced, err)
	}
	for _, table := range []string{"design_revisions", "production_releases"} {
		if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM rls_policy_inventory WHERE table_name = $1`, table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("rls_policy_inventory row for %s missing (count=%d, err=%v)", table, count, err)
		}
	}
}

func TestProductionRelease_MigrationFreshAndUpgrade(t *testing.T) {
	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 119)
	assertProductionReleaseSchema(t, fresh)

	upgrade := multiOrgFreshDB(t)
	identityApplyThrough(t, upgrade, 117)
	if _, err := upgrade.Exec(context.Background(), readMigration(t, "000118_design_revision_approval.up.sql")); err != nil {
		t.Fatalf("upgrade apply 00118: %v", err)
	}
	if _, err := upgrade.Exec(context.Background(), readMigration(t, "000119_production_releases.up.sql")); err != nil {
		t.Fatalf("upgrade apply 00119: %v", err)
	}
	assertProductionReleaseSchema(t, upgrade)
}

// #395 authority proof (PR #551 review): the canonical ProductionRelease is
// the ONE release authority the production pipeline consumes. Material
// planning, job costing and quality resolve P1's exact ID and the SAME
// manufacturing fingerprint F3 the release pinned — never the coexisting
// legacy OC-022 blob. Without a canonical release, the legacy blob keeps
// grounding pre-DT projects unchanged.
func TestProductionRelease_AuthorityFeedsProductionConsumers(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	var p1 *storage.ProductionReleaseReadback
	err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		p1, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("create release: %v", err)
	}
	f3 := p1.Release.ManufacturingFingerprint

	// A legacy blob coexists on the project row: it must lose to the
	// canonical authority everywhere (required shape: canonical P1/F3 wins
	// over legacy LEGACY/OLD-FP).
	if _, err := fx.admin.Exec(context.Background(), `
		UPDATE projects SET production_release = '{"id":"LEGACY","project_id":"`+fx.projectID+`","project_version":7,"bom_fingerprint":"OLD-FP"}'::jsonb
		WHERE id = $1`, fx.projectID); err != nil {
		t.Fatalf("seed legacy blob: %v", err)
	}

	var planningSnap *domain.MaterialPlanningSnapshot
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.MutateProjectMaterialPlanning(ctx, fx.projectID, func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error) {
			planningSnap = snap
			return &domain.MaterialPlanningMutation{}, nil
		})
		return err
	})
	if err != nil {
		t.Fatalf("material planning snapshot: %v", err)
	}
	if planningSnap.ProductionRelease == nil || planningSnap.ProductionRelease.ReleaseID != p1.Release.ID {
		t.Fatalf("material planning must resolve the canonical release authority, got %+v", planningSnap.ProductionRelease)
	}
	if planningSnap.ProductionRelease.ManufacturingFingerprint != f3 {
		t.Fatalf("material planning must bind the SAME authoritative fingerprint F3, got %s", planningSnap.ProductionRelease.ManufacturingFingerprint)
	}

	var costingSnap *domain.JobCostingSnapshot
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.MutateProjectCosting(ctx, fx.projectID, func(snap *domain.JobCostingSnapshot) (*domain.JobCostingMutation, error) {
			costingSnap = snap
			return &domain.JobCostingMutation{}, nil
		})
		return err
	})
	if err != nil {
		t.Fatalf("job costing snapshot: %v", err)
	}
	if costingSnap.ProductionRelease == nil || costingSnap.ProductionRelease.ReleaseID != p1.Release.ID ||
		costingSnap.ProductionRelease.ManufacturingFingerprint != f3 {
		t.Fatalf("job costing must resolve the SAME canonical authority (P1/F3), got %+v", costingSnap.ProductionRelease)
	}

	// Quality is a PHYSICAL execution consumer guarded by the frozen routing
	// evidence (#577): a schema-v2 release froze the neutral routing program,
	// so the mutation is authorized; the historical schema-v1 shape is proven
	// fail-closed right below.
	qualityRan := false
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.MutateProjectQuality(ctx, fx.projectID, func(snap *domain.QualitySnapshot) (*domain.QualityMutation, error) {
			qualityRan = true
			return &domain.QualityMutation{}, nil
		})
		return err
	})
	if err != nil || !qualityRan {
		t.Fatalf("quality must run with frozen v2 routing evidence (err=%v)", err)
	}

	// Historical schema-v1 snapshot (BOM demand frozen, no routing program):
	// every physical execution consumer keeps failing closed — missing
	// machining evidence is never a no-CNC verdict.
	multiOrgExec(t, fx.admin, `ALTER TABLE production_release_manufacturing_snapshots DISABLE TRIGGER protect_release_manufacturing_snapshots_immutable`)
	t.Cleanup(func() {
		multiOrgExec(t, fx.admin, `ALTER TABLE production_release_manufacturing_snapshots ENABLE TRIGGER protect_release_manufacturing_snapshots_immutable`)
	})
	if _, err := fx.admin.Exec(context.Background(), `
		UPDATE production_release_manufacturing_snapshots
		SET schema_version = 1,
		    payload = (payload - 'routing') || '{"schemaVersion":1}'::jsonb
		WHERE release_id = $1`, p1.Release.ID); err != nil {
		t.Fatalf("simulate historical v1 snapshot: %v", err)
	}
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.MutateProjectQuality(ctx, fx.projectID, func(snap *domain.QualitySnapshot) (*domain.QualityMutation, error) {
			t.Fatal("no quality callback may run without frozen routing evidence")
			return nil, nil
		})
		return err
	})
	if !errors.Is(err, storage.ErrReleaseRoutingUnavailable) {
		t.Fatalf("quality must fail closed without frozen routing, got %v", err)
	}

	// Control — required legacy-fallback shape: a project WITHOUT a canonical
	// release keeps the legacy blob as its (compatibility) authority; the old
	// BOMFingerprint token rides the ManufacturingFingerprint slot through
	// the legacy adapter ONLY.
	if _, err := fx.admin.Exec(context.Background(), `
		UPDATE projects SET production_release = '{"id":"LEGACY","project_version":3,"bom_fingerprint":"OLD-FP"}'::jsonb
		WHERE id = $1`, fiProjectAOnly); err != nil {
		t.Fatalf("seed control blob: %v", err)
	}
	var controlSnap *domain.MaterialPlanningSnapshot
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.MutateProjectMaterialPlanning(ctx, fiProjectAOnly, func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error) {
			controlSnap = snap
			return &domain.MaterialPlanningMutation{}, nil
		})
		return err
	})
	if err != nil {
		t.Fatalf("control snapshot: %v", err)
	}
	if controlSnap.ProductionRelease == nil ||
		controlSnap.ProductionRelease.ReleaseID != "LEGACY" ||
		controlSnap.ProductionRelease.ManufacturingFingerprint != "OLD-FP" {
		t.Fatalf("legacy fallback must resolve ReleaseID=LEGACY + ManufacturingFingerprint=OLD-FP, got %+v", controlSnap.ProductionRelease)
	}
}

func TestGetContextualProductionRelease_HistoricalVsLatest(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	// 1. Create Release P1 pinned to (revR3, quoteQ3).
	var p1 *storage.ProductionReleaseReadback
	err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		p1, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
			RequestID:        "p1-release",
		})
		return err
	})
	if err != nil {
		t.Fatalf("create release P1: %v", err)
	}

	// 2. Modify working copy (width change on fiA), publish R4, requote to Q4, accept Q4, approve R4, and create P2.
	var p2 *storage.ProductionReleaseReadback
	var revR4, quoteQ4 string
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		if _, err := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   fx.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 650.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
				{FurnitureInstanceID: fx.fiB, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}

		pubReadback, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       fx.designID,
			BaseRevisionID: fx.revR3,
			SourceType:     domain.DesignRevisionSourceSketchup,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		revR4 = pubReadback.ID

		requote, err := fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID:           fx.projectID,
			BaseQuoteRevisionID: fx.quoteQ3,
			DesignRevisionID:    revR4,
		})
		if err != nil {
			return err
		}
		quoteQ4 = requote.Revision.ID

		if _, err := fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: quoteQ4,
			Status:          "published",
		}); err != nil {
			return err
		}

		if _, err := fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: quoteQ4,
			Status:          "accepted",
		}); err != nil {
			return err
		}

		if _, err := fx.store.ApproveDesignRevision(ctx, storage.ApproveDesignRevisionCommand{
			DesignID:         fx.designID,
			DesignRevisionID: revR4,
			ActorUserID:      rlsUserA,
		}); err != nil {
			return err
		}

		p2, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: revR4,
			QuoteRevisionID:  quoteQ4,
			ActorUserID:      rlsUserA,
			RequestID:        "p2-release",
		})
		return err
	})
	if err != nil {
		t.Fatalf("create release P2: %v", err)
	}

	// 3. Verifications:
	// a. LatestProjectProductionRelease must be P2.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		latest, err := fx.store.GetLatestProjectProductionRelease(ctx, fx.projectID)
		if err != nil {
			return err
		}
		if latest == nil || latest.ID != p2.Release.ID || latest.ReleaseNumber != 2 {
			t.Fatalf("expected latest release P2 (release #2), got %+v", latest)
		}
		detail, err := fx.store.GetProjectByID(ctx, fx.projectID)
		if err != nil {
			return err
		}
		projects, err := fx.store.ListProjects(ctx)
		if err != nil {
			return err
		}
		found := false
		for _, project := range projects {
			if project.ID != fx.projectID {
				continue
			}
			found = true
			if project.ResolvedProductionRelease == nil || detail.ResolvedProductionRelease == nil ||
				project.ResolvedProductionRelease.ReleaseID != p2.Release.ID ||
				detail.ResolvedProductionRelease.ReleaseID != project.ResolvedProductionRelease.ReleaseID {
				t.Fatalf("list and detail must resolve newest P2: list=%+v detail=%+v", project.ResolvedProductionRelease, detail.ResolvedProductionRelease)
			}
		}
		if !found {
			t.Fatal("released project missing from list")
		}

		// b. Contextual release for historical context (revR3, quoteQ3) MUST return P1!
		// Even though P2 is newer in the project, P2 must NOT hide P1.
		contextualP1, err := fx.store.GetContextualProductionRelease(ctx, fx.projectID, fx.revR3, fx.quoteQ3)
		if err != nil {
			return err
		}
		if contextualP1 == nil || contextualP1.ID != p1.Release.ID || contextualP1.ReleaseNumber != 1 {
			t.Fatalf("expected contextual release P1 (release #1), got %+v", contextualP1)
		}

		// c. Contextual release for context (revR4, quoteQ4) returns P2.
		contextualP2, err := fx.store.GetContextualProductionRelease(ctx, fx.projectID, revR4, quoteQ4)
		if err != nil {
			return err
		}
		if contextualP2 == nil || contextualP2.ID != p2.Release.ID || contextualP2.ReleaseNumber != 2 {
			t.Fatalf("expected contextual release P2, got %+v", contextualP2)
		}

		// d. Mismatched pins (revR3, quoteQ4) returns nil without error.
		mismatched, err := fx.store.GetContextualProductionRelease(ctx, fx.projectID, fx.revR3, quoteQ4)
		if err != nil {
			return err
		}
		if mismatched != nil {
			t.Fatalf("expected nil for mismatched pins, got %+v", mismatched)
		}

		return nil
	})
	if err != nil {
		t.Fatalf("verification transaction: %v", err)
	}
}

// Releases require the same coherent outer transaction as the HTTP route.
func releaseTx(t *testing.T, store *storage.PostgresStore, actor storage.TenantActor, run func(context.Context) error) error {
	t.Helper()
	return store.WithinTenantTx(storage.WithConsistentCatalogTx(context.Background()), actor, run)
}
