package storage_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #392 / DT-8: staged publish sessions and design revision artifacts
// (ADR-0003, digital-thread §§17-18, 21, 26, 28).

func designPublishMigrationSQL(t *testing.T) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000114_design_publish_artifacts.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func TestDesignPublish_MigrationFreshAndUpgrade(t *testing.T) {
	ctx := context.Background()

	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 114)
	assertDesignPublishSchema(t, fresh)

	upgrade := multiOrgFreshDB(t)
	identityApplyThrough(t, upgrade, 113)
	if _, err := upgrade.Exec(ctx, designPublishMigrationSQL(t)); err != nil {
		t.Fatalf("upgrade apply 00114: %v", err)
	}
	assertDesignPublishSchema(t, upgrade)
}

func assertDesignPublishSchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	for _, table := range []string{"design_publish_sessions", "design_publish_artifacts", "design_revision_artifacts"} {
		var exists bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name=$1)`, table,
		).Scan(&exists); err != nil || !exists {
			t.Fatalf("table %s exists=%v err=%v", table, exists, err)
		}
	}
}

func TestDesignPublish_SchemaAndRLSInventory(t *testing.T) {
	ctx := context.Background()
	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 114)

	for _, table := range []string{"design_publish_sessions", "design_publish_artifacts", "design_revision_artifacts"} {
		var classification, readScope, writeScope string
		if err := fresh.QueryRow(ctx,
			`SELECT classification, read_scope, write_scope FROM rls_policy_inventory WHERE table_name=$1`, table,
		).Scan(&classification, &readScope, &writeScope); err != nil {
			t.Fatalf("inventory row for %s: %v", table, err)
		}
		if classification != "explicitly-shared" || readScope != "project-organizations" {
			t.Fatalf("inventory for %s = (%q,%q,%q)", table, classification, readScope, writeScope)
		}

		var rls, forced bool
		if err := fresh.QueryRow(ctx,
			`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname=$1`, table,
		).Scan(&rls, &forced); err != nil || !rls || !forced {
			t.Fatalf("RLS for %s enabled=%v forced=%v err=%v", table, rls, forced, err)
		}
	}

	// Final artifact metadata is immutable for the runtime role; staging rows
	// are replaceable while a session is prepared.
	privileges := map[string]bool{}
	rows, err := fresh.Query(ctx, `
		SELECT privilege_type FROM information_schema.table_privileges
		WHERE table_name='design_revision_artifacts' AND grantee='granete_app'`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			t.Fatal(err)
		}
		privileges[p] = true
	}
	rows.Close()
	if !privileges["SELECT"] || !privileges["INSERT"] || privileges["UPDATE"] || privileges["DELETE"] {
		t.Fatalf("design_revision_artifacts grants must be SELECT,INSERT only: %v", privileges)
	}

	var triggerCount int
	if err := fresh.QueryRow(ctx, `
		SELECT count(*) FROM pg_trigger tg
		JOIN pg_class c ON c.oid = tg.tgrelid
		WHERE c.relname='design_revision_artifacts'
		  AND tg.tgname='protect_design_revision_artifacts_immutable'
		  AND NOT tg.tgisinternal`,
	).Scan(&triggerCount); err != nil || triggerCount != 1 {
		t.Fatalf("immutability trigger count=%d err=%v", triggerCount, err)
	}
}

// designPublishWorld is the standard #392 fixture: one design on the shared
// A-B project with two active FurnitureInstances in its working copy.
type designPublishWorld struct {
	fx       *rlsFixture
	designID string
	fi1      string
	fi2      string
}

func newDesignPublishWorld(t *testing.T) *designPublishWorld {
	t.Helper()
	fx := setupDesignsTestFixture(t)
	w := &designPublishWorld{fx: fx, fi1: "51000000-0000-0000-0000-0000000000e1", fi2: "51000000-0000-0000-0000-0000000000e2"}

	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		design, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Cocina Principal",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		w.designID = design.ID

		created := make([]string, 0, 2)
		for range 2 {
			fi, cerr := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
				ProjectID:   fiSharedProject,
				Origin:      domain.FurnitureInstanceOriginDesign,
				ActorUserID: rlsUserA,
			})
			if cerr != nil {
				return cerr
			}
			created = append(created, fi.ID)
		}
		w.fi1, w.fi2 = created[0], created[1]

		_, err = fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   w.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{
					FurnitureInstanceID: w.fi1,
					Parameters:          map[string]any{"widthMm": 600.0},
					MaterialChoices:     map[string]string{"CARCASS": "WHITE-18"},
					Transform: domain.Transform3D{
						TranslationMm: [3]float64{0, 0, 0},
						RotationDeg:   [3]float64{0, 0, 0},
					},
					TechnicalClientLocator: &domain.TechnicalClientLocator{Kind: "sketchup_persistent_id", Value: "11"},
				},
				{
					FurnitureInstanceID: w.fi2,
					Parameters:          map[string]any{"widthMm": 800.0},
					Transform: domain.Transform3D{
						TranslationMm: [3]float64{600, 0, 0},
						RotationDeg:   [3]float64{0, 0, 0},
					},
				},
			},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("seed design publish world: %v", err)
	}
	return w
}

func manifestFor(w *designPublishWorld, base *string, itemIDs ...string) domain.DesignPublishManifest {
	items := make([]domain.DesignPublishManifestItem, 0, len(itemIDs))
	for _, id := range itemIDs {
		items = append(items, domain.DesignPublishManifestItem{
			FurnitureInstanceID: id,
			TechnicalClientLocator: &domain.TechnicalClientLocator{
				Kind: "sketchup_persistent_id", Value: "p-" + id,
			},
		})
	}
	return domain.DesignPublishManifest{
		SchemaVersion:  domain.DesignPublishManifestSchemaVersion,
		ProjectID:      fiSharedProject,
		DesignID:       w.designID,
		BaseRevisionID: base,
		Source: domain.DesignPublishManifestSource{
			Client: "sketchup", SketchUpVersion: "24.0.145", PluginVersion: "0.1.0",
		},
		Items: items,
	}
}

// stageAllArtifactsInTx stages the three required artifacts inside the
// CALLER'S tenant transaction.
func stageAllArtifactsInTx(t *testing.T, ctx context.Context, w *designPublishWorld, sessionID string) {
	t.Helper()
	for i, kind := range domain.RequiredDesignPublishArtifacts {
		_, replaced, err := w.fx.store.RecordDesignPublishArtifact(ctx, storage.RecordDesignPublishArtifactCommand{
			DesignID:    w.designID,
			SessionID:   sessionID,
			Kind:        kind,
			StorageKey:  "designs/publish/" + sessionID + "/" + string(kind) + "-abcdef123456.ext",
			ContentType: "application/octet-stream",
			SizeBytes:   int64(100 + i),
			SHA256:      "sha256-" + strings.Repeat("ab", 32),
			ActorUserID: rlsUserA,
		})
		if err != nil || replaced != "" {
			t.Fatalf("stage artifact %s: err=%v replaced=%q", kind, err, replaced)
		}
	}
}

// stageAllArtifacts stages the three required artifacts in their own tenant
// transaction (for use after the prepare transaction committed).
func stageAllArtifacts(t *testing.T, w *designPublishWorld, sessionID string) {
	t.Helper()
	if err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		stageAllArtifactsInTx(t, ctx, w, sessionID)
		return nil
	}); err != nil {
		t.Fatalf("stage artifacts: %v", err)
	}
}

// readTx runs a read under the org A tenant context (RLS needs it).
func readTx(t *testing.T, w *designPublishWorld, run func(ctx context.Context) error) {
	t.Helper()
	if err := fiTx(t, w.fx.store, fiActorA(), run); err != nil {
		t.Fatalf("read tx: %v", err)
	}
}

func TestDesignPublish_HappyPathPublishesImmutableRevisionWithArtifacts(t *testing.T) {
	w := newDesignPublishWorld(t)
	actor := fiActorA()
	ctx := context.Background()

	var result *storage.PrepareResult
	err := fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		var err error
		result, err = w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID:    w.designID,
			Manifest:    manifestFor(w, nil, w.fi1, w.fi2),
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	session := result.Session
	if session.Status != "prepared" || session.BaseRevisionID != nil {
		t.Fatalf("session = %+v", session)
	}
	if len(result.AbandonedKeys) != 0 {
		t.Fatalf("no abandoned keys expected, got %v", result.AbandonedKeys)
	}

	stageAllArtifacts(t, w, session.ID)

	var rev *domain.DesignRevision
	err = fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		var err error
		rev, err = w.fx.store.FinalizeDesignPublish(ctx, storage.FinalizeDesignPublishCommand{
			DesignID:    w.designID,
			SessionID:   session.ID,
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("finalize: %v", err)
	}

	// R1, sketchup source, items snapshotted from the working copy, artifacts linked.
	if rev.RevisionNumber != 1 || rev.ParentRevisionID != "" {
		t.Fatalf("revision = R%d parent=%q", rev.RevisionNumber, rev.ParentRevisionID)
	}
	if rev.SourceType != domain.DesignRevisionSourceSketchup {
		t.Fatalf("source type = %q", rev.SourceType)
	}
	if len(rev.Items) != 2 {
		t.Fatalf("items = %d, want 2 (working copy is the publication source)", len(rev.Items))
	}
	if len(rev.Artifacts) != len(domain.RequiredDesignPublishArtifacts) {
		t.Fatalf("artifacts = %d, want %d", len(rev.Artifacts), len(domain.RequiredDesignPublishArtifacts))
	}
	kinds := map[string]bool{}
	for _, a := range rev.Artifacts {
		kinds[string(a.Kind)] = true
		if !strings.HasPrefix(a.SHA256, "sha256-") {
			t.Fatalf("artifact sha = %q", a.SHA256)
		}
	}
	if !kinds["model"] || !kinds["manifest"] || !kinds["preview"] {
		t.Fatalf("artifact kinds = %v", kinds)
	}

	// Working copy base advanced; working items REMAIN as authoring state.
	var wc *domain.DesignWorkingCopy
	err = fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		var err error
		wc, err = w.fx.store.GetDesignWorkingCopy(ctx, w.designID)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if wc.BaseRevisionID == nil || *wc.BaseRevisionID != rev.ID {
		t.Fatalf("working copy base = %v, want new revision %s", wc.BaseRevisionID, rev.ID)
	}
	if len(wc.Items) != 2 {
		t.Fatalf("working items must survive publish, got %d", len(wc.Items))
	}

	// Session finalized and linked to the revision.
	var detail *storage.DesignPublishSessionDetail
	readTx(t, w, func(ctx context.Context) error {
		var err error
		detail, err = w.fx.store.GetDesignPublishSession(ctx, w.designID, session.ID)
		return err
	})
	if detail.Session.Status != "finalized" || detail.Session.FinalizedRevisionID == nil ||
		*detail.Session.FinalizedRevisionID != rev.ID {
		t.Fatalf("session after finalize = %+v", detail.Session)
	}

	// Artifact readback + audit.
	var artifacts []domain.DesignRevisionArtifact
	readTx(t, w, func(ctx context.Context) error {
		var err error
		artifacts, err = w.fx.store.ListDesignRevisionArtifacts(ctx, w.designID, rev.ID)
		return err
	})
	if len(artifacts) != 3 {
		t.Fatalf("ListDesignRevisionArtifacts = %d", len(artifacts))
	}
	var auditCount int
	if err := w.fx.admin.QueryRow(ctx, `
		SELECT count(*) FROM security_audit_events
		WHERE event_type='design_revision_published' AND details->>'publish_session_id' = $1`,
		session.ID).Scan(&auditCount); err != nil || auditCount != 1 {
		t.Fatalf("publish audit count=%d err=%v", auditCount, err)
	}

	// Immutability: artifacts cannot be mutated through the runtime role.
	if _, err := w.fx.app.Exec(ctx, `UPDATE design_revision_artifacts SET sha256='sha256-x' WHERE design_revision_id=$1`, rev.ID); err == nil {
		t.Fatal("design_revision_artifacts must be immutable for the app role")
	}
}

func TestDesignPublish_SequentialPublishesAdvanceBase(t *testing.T) {
	w := newDesignPublishWorld(t)
	actor := fiActorA()

	publish := func(base **string) *domain.DesignRevision {
		var rev *domain.DesignRevision
		err := fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
			var result *storage.PrepareResult
			result, err := w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
				DesignID:    w.designID,
				Manifest:    manifestFor(w, *base, w.fi1, w.fi2),
				ActorUserID: rlsUserA,
			})
			if err != nil {
				return err
			}
			stageAllArtifactsInTx(t, ctx, w, result.Session.ID)
			rev, err = w.fx.store.FinalizeDesignPublish(ctx, storage.FinalizeDesignPublishCommand{
				DesignID:    w.designID,
				SessionID:   result.Session.ID,
				ActorUserID: rlsUserA,
			})
			return err
		})
		if err != nil {
			t.Fatalf("publish: %v", err)
		}
		next := rev.ID
		*base = &next
		return rev
	}

	var base *string
	rev1 := publish(&base)
	rev2 := publish(&base)

	if rev2.RevisionNumber != 2 || rev2.ParentRevisionID != rev1.ID {
		t.Fatalf("R2 = %+v (want parent %s)", rev2, rev1.ID)
	}
}

func TestDesignPublish_StaleBaseRejectedAtPrepare(t *testing.T) {
	w := newDesignPublishWorld(t)
	actor := fiActorA()

	// Publish R1.
	var rev1 *domain.DesignRevision
	err := fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		result, err := w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: w.designID, Manifest: manifestFor(w, nil, w.fi1, w.fi2), ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		stageAllArtifactsInTx(t, ctx, w, result.Session.ID)
		rev1, err = w.fx.store.FinalizeDesignPublish(ctx, storage.FinalizeDesignPublishCommand{
			DesignID: w.designID, SessionID: result.Session.ID, ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish R1: %v", err)
	}

	// Stale manifest: claims base R1 while the server already moved past it.
	// Move the working copy base forward by publishing R2 through the legacy
	// path (another client), then prepare with the old base.
	err = fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		_, err := w.fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID: w.designID, BaseRevisionID: rev1.ID, SourceType: domain.DesignRevisionSourceManual,
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish R2 (other client): %v", err)
	}

	err = fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		_, err := w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: w.designID, Manifest: manifestFor(w, &rev1.ID, w.fi1, w.fi2), ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrDesignRevisionConflict) {
		t.Fatalf("stale base must conflict, got %v", err)
	}
}

func TestDesignPublish_RaceAfterPrepareRejectedAtFinalize(t *testing.T) {
	w := newDesignPublishWorld(t)
	actor := fiActorA()

	// prepare against R1-base world: first publish R1.
	var rev1 *domain.DesignRevision
	err := fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		result, err := w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: w.designID, Manifest: manifestFor(w, nil, w.fi1, w.fi2), ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		stageAllArtifactsInTx(t, ctx, w, result.Session.ID)
		rev1, err = w.fx.store.FinalizeDesignPublish(ctx, storage.FinalizeDesignPublishCommand{
			DesignID: w.designID, SessionID: result.Session.ID, ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish R1: %v", err)
	}

	// Our client prepares against R1…
	var session *storage.PrepareResult
	err = fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		var err error
		session, err = w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: w.designID, Manifest: manifestFor(w, &rev1.ID, w.fi1, w.fi2), ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("prepare against R1: %v", err)
	}
	stageAllArtifacts(t, w, session.Session.ID)

	// …another client publishes R2 while we upload…
	err = fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		_, err := w.fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID: w.designID, BaseRevisionID: rev1.ID, SourceType: domain.DesignRevisionSourceManual,
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("other client publishes R2: %v", err)
	}

	// …our finalize must conflict — no R3 based on stale R1.
	err = fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		_, err := w.fx.store.FinalizeDesignPublish(ctx, storage.FinalizeDesignPublishCommand{
			DesignID: w.designID, SessionID: session.Session.ID, ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrDesignRevisionConflict) {
		t.Fatalf("finalize after race must conflict, got %v", err)
	}

	var revs []domain.DesignRevision
	readTx(t, w, func(ctx context.Context) error {
		var err error
		revs, err = w.fx.store.ListDesignRevisions(ctx, w.designID)
		return err
	})
	if len(revs) != 2 {
		t.Fatalf("revisions = %d, want exactly R1+R2 (no stale R3)", len(revs))
	}
}

func TestDesignPublish_ManifestMustMatchWorkingCopy(t *testing.T) {
	w := newDesignPublishWorld(t)
	actor := fiActorA()

	// Unknown FI (valid UUID, not in working copy / project).
	unknown := "51000000-0000-0000-0000-0000000000ff"
	err := fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		_, err := w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: w.designID, Manifest: manifestFor(w, nil, w.fi1, unknown), ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrPublishManifestWorkingCopyMismatch) {
		t.Fatalf("unknown FI must mismatch, got %v", err)
	}

	// Cross-project FI: an instance of project B can never enter this design's
	// working copy; a manifest carrying it is rejected the same fail-closed way.
	crossProject := "51000000-0000-0000-0000-0000000000bb"
	err = w.fx.admin.QueryRow(context.Background(),
		`INSERT INTO furniture_instances (id, organization_id, project_id, origin, lifecycle_status)
		 VALUES ($1, '`+rlsOrgB+`', '`+fiProjectB+`', 'quote', 'active') RETURNING id`, crossProject,
	).Scan(&crossProject)
	if err != nil {
		t.Fatalf("seed cross-project instance: %v", err)
	}
	err = fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		_, err := w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: w.designID, Manifest: manifestFor(w, nil, w.fi1, crossProject), ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrPublishManifestWorkingCopyMismatch) {
		t.Fatalf("cross-project FI must mismatch, got %v", err)
	}

	// Missing one working item (client dropped it from the manifest).
	err = fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		_, err := w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: w.designID, Manifest: manifestFor(w, nil, w.fi1), ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrPublishManifestWorkingCopyMismatch) {
		t.Fatalf("partial manifest must mismatch, got %v", err)
	}

	// Drift BETWEEN prepare and finalize: the working copy changed after
	// prepare, so that publish is stale.
	var session *storage.PrepareResult
	err = fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		var err error
		session, err = w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: w.designID, Manifest: manifestFor(w, nil, w.fi1, w.fi2), ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	stageAllArtifacts(t, w, session.Session.ID)
	err = fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		_, err := w.fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   w.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: w.fi1, Transform: domain.Transform3D{}},
			},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("working copy drift: %v", err)
	}
	err = fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		_, err := w.fx.store.FinalizeDesignPublish(ctx, storage.FinalizeDesignPublishCommand{
			DesignID: w.designID, SessionID: session.Session.ID, ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrPublishManifestWorkingCopyMismatch) {
		t.Fatalf("drifted finalize must mismatch, got %v", err)
	}
}

func TestDesignPublish_MissingArtifactFinalizeFails(t *testing.T) {
	w := newDesignPublishWorld(t)
	actor := fiActorA()

	var session *storage.PrepareResult
	err := fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		var err error
		session, err = w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: w.designID, Manifest: manifestFor(w, nil, w.fi1, w.fi2), ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}

	// Only the model upload succeeded — the manifest upload failed.
	if err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		_, _, err := w.fx.store.RecordDesignPublishArtifact(ctx, storage.RecordDesignPublishArtifactCommand{
			DesignID: w.designID, SessionID: session.Session.ID, Kind: domain.DesignPublishArtifactModel,
			StorageKey: "designs/publish/" + session.Session.ID + "/model-abcdef123456.skp",
			ContentType: "application/octet-stream", SizeBytes: 42,
			SHA256: "sha256-" + strings.Repeat("ab", 32), ActorUserID: rlsUserA,
		})
		return err
	}); err != nil {
		t.Fatal(err)
	}

	err = fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		_, err := w.fx.store.FinalizeDesignPublish(ctx, storage.FinalizeDesignPublishCommand{
			DesignID: w.designID, SessionID: session.Session.ID, ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrPublishArtifactMissing) {
		t.Fatalf("finalize without all artifacts must fail, got %v", err)
	}

	// No falsely published revision; session stays prepared for retry.
	var revs []domain.DesignRevision
	var detail *storage.DesignPublishSessionDetail
	readTx(t, w, func(ctx context.Context) error {
		var err error
		revs, err = w.fx.store.ListDesignRevisions(ctx, w.designID)
		if err != nil {
			return err
		}
		detail, err = w.fx.store.GetDesignPublishSession(ctx, w.designID, session.Session.ID)
		return err
	})
	if len(revs) != 0 {
		t.Fatalf("revisions = %d, want 0 (failed upload can never publish)", len(revs))
	}
	if detail.Session.Status != "prepared" {
		t.Fatalf("session stays prepared: %+v", detail.Session)
	}
}

func TestDesignPublish_FinalizeIsIdempotentPerSession(t *testing.T) {
	w := newDesignPublishWorld(t)
	actor := fiActorA()

	var session *storage.PrepareResult
	var rev1, rev2 *domain.DesignRevision
	err := fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		var err error
		session, err = w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: w.designID, Manifest: manifestFor(w, nil, w.fi1, w.fi2), ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		stageAllArtifactsInTx(t, ctx, w, session.Session.ID)
		rev1, err = w.fx.store.FinalizeDesignPublish(ctx, storage.FinalizeDesignPublishCommand{
			DesignID: w.designID, SessionID: session.Session.ID, ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		// Response lost, client retries the SAME finalize.
		rev2, err = w.fx.store.FinalizeDesignPublish(ctx, storage.FinalizeDesignPublishCommand{
			DesignID: w.designID, SessionID: session.Session.ID, ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("finalize/retry: %v", err)
	}
	if rev1.ID != rev2.ID || rev2.RevisionNumber != 1 {
		t.Fatalf("retry must return the same revision: %s vs %s (R%d)", rev1.ID, rev2.ID, rev2.RevisionNumber)
	}
	var revs []domain.DesignRevision
	readTx(t, w, func(ctx context.Context) error {
		var err error
		revs, err = w.fx.store.ListDesignRevisions(ctx, w.designID)
		return err
	})
	if len(revs) != 1 {
		t.Fatalf("revisions = %d, want exactly 1", len(revs))
	}
}

func TestDesignPublish_ExpiredSessionsAbandonedLazily(t *testing.T) {
	w := newDesignPublishWorld(t)
	actor := fiActorA()
	ctx := context.Background()

	var session *storage.PrepareResult
	err := fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		var err error
		session, err = w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: w.designID, Manifest: manifestFor(w, nil, w.fi1, w.fi2), ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	staleKey := "designs/publish/" + session.Session.ID + "/model-abcdef123456.skp"
	if err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		_, _, err := w.fx.store.RecordDesignPublishArtifact(ctx, storage.RecordDesignPublishArtifactCommand{
			DesignID: w.designID, SessionID: session.Session.ID, Kind: domain.DesignPublishArtifactModel,
			StorageKey: staleKey, ContentType: "application/octet-stream", SizeBytes: 1,
			SHA256: "sha256-" + strings.Repeat("ab", 32), ActorUserID: rlsUserA,
		})
		return err
	}); err != nil {
		t.Fatal(err)
	}

	// Force expiry (the lazy sweep keys off expires_at).
	if _, err := w.fx.admin.Exec(ctx,
		`UPDATE design_publish_sessions SET expires_at = NOW() - interval '1 hour' WHERE id=$1`,
		session.Session.ID); err != nil {
		t.Fatal(err)
	}

	// Uploading into an expired session is rejected.
	err = fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		_, _, err := w.fx.store.RecordDesignPublishArtifact(ctx, storage.RecordDesignPublishArtifactCommand{
			DesignID: w.designID, SessionID: session.Session.ID, Kind: domain.DesignPublishArtifactPreview,
			StorageKey: "designs/publish/" + session.Session.ID + "/preview-abcdef123456.png",
			ContentType: "image/png", SizeBytes: 1,
			SHA256: "sha256-" + strings.Repeat("ab", 32), ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrPublishSessionNotPrepared) {
		t.Fatalf("expired session upload must fail, got %v", err)
	}

	// A fresh prepare sweeps the expired session and surfaces its staged key.
	var fresh *storage.PrepareResult
	err = fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		var err error
		fresh, err = w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: w.designID, Manifest: manifestFor(w, nil, w.fi1, w.fi2), ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(fresh.AbandonedKeys) != 1 || fresh.AbandonedKeys[0] != staleKey {
		t.Fatalf("abandoned keys = %v, want [%s]", fresh.AbandonedKeys, staleKey)
	}
	var detail *storage.DesignPublishSessionDetail
	readTx(t, w, func(ctx context.Context) error {
		var err error
		detail, err = w.fx.store.GetDesignPublishSession(ctx, w.designID, session.Session.ID)
		return err
	})
	if detail.Session.Status != "abandoned" {
		t.Fatalf("expired session must be abandoned: %+v", detail.Session)
	}
	if len(detail.Artifacts) != 0 {
		t.Fatalf("staging rows of abandoned session must be deleted, got %d", len(detail.Artifacts))
	}
}

func TestDesignPublish_ArtifactReplaceReturnsDisplacedKey(t *testing.T) {
	w := newDesignPublishWorld(t)
	actor := fiActorA()

	var session *storage.PrepareResult
	err := fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		var err error
		session, err = w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: w.designID, Manifest: manifestFor(w, nil, w.fi1, w.fi2), ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	first := "designs/publish/" + session.Session.ID + "/model-000000000000.skp"
	second := "designs/publish/" + session.Session.ID + "/model-ffffffffffff.skp"
	var replaced string
	if err := fiTx(t, w.fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		_, replaced, err = w.fx.store.RecordDesignPublishArtifact(ctx, storage.RecordDesignPublishArtifactCommand{
			DesignID: w.designID, SessionID: session.Session.ID, Kind: domain.DesignPublishArtifactModel,
			StorageKey: first, ContentType: "application/octet-stream", SizeBytes: 1,
			SHA256: "sha256-" + strings.Repeat("01", 32), ActorUserID: rlsUserA,
		})
		if err != nil || replaced != "" {
			t.Fatalf("first upload: err=%v replaced=%q", err, replaced)
		}
		_, replaced, err = w.fx.store.RecordDesignPublishArtifact(ctx, storage.RecordDesignPublishArtifactCommand{
			DesignID: w.designID, SessionID: session.Session.ID, Kind: domain.DesignPublishArtifactModel,
			StorageKey: second, ContentType: "application/octet-stream", SizeBytes: 2,
			SHA256: "sha256-" + strings.Repeat("02", 32), ActorUserID: rlsUserA,
		})
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if replaced != first {
		t.Fatalf("re-upload must surface displaced key: %q", replaced)
	}

	var detail *storage.DesignPublishSessionDetail
	readTx(t, w, func(ctx context.Context) error {
		var err error
		detail, err = w.fx.store.GetDesignPublishSession(ctx, w.designID, session.Session.ID)
		return err
	})
	if len(detail.Artifacts) != 1 || detail.Artifacts[0].StorageKey != second {
		t.Fatalf("staging row must be the replacement: %+v", detail.Artifacts)
	}
}

func TestDesignPublish_TenantIsolation(t *testing.T) {
	w := newDesignPublishWorld(t)
	actorA := fiActorA()
	actorB := fiActorB()

	var session *storage.PrepareResult
	err := fiTx(t, w.fx.store, actorA, func(ctx context.Context) error {
		var err error
		session, err = w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: w.designID, Manifest: manifestFor(w, nil, w.fi1, w.fi2), ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	// The shared project lets org B (manufacturing participant) READ session
	// metadata (classification: project-organizations) — but staging into and
	// finalizing org A's session stays owner-org only.
	err = fiTx(t, w.fx.store, actorB, func(ctx context.Context) error {
		if _, err := w.fx.store.GetDesignPublishSession(ctx, w.designID, session.Session.ID); err != nil {
			return err
		}
		_, _, err := w.fx.store.RecordDesignPublishArtifact(ctx, storage.RecordDesignPublishArtifactCommand{
			DesignID: w.designID, SessionID: session.Session.ID, Kind: domain.DesignPublishArtifactModel,
			StorageKey: "designs/publish/" + session.Session.ID + "/model-abcdef123456.skp",
			ContentType: "application/octet-stream", SizeBytes: 1,
			SHA256: "sha256-" + strings.Repeat("ab", 32), ActorUserID: rlsUserB,
		})
		return err
	})
	if !errors.Is(err, domain.ErrFurnitureInstanceProjectNotWritable) {
		t.Fatalf("cross-org staging must be owner-org rejected, got %v", err)
	}
	err = fiTx(t, w.fx.store, actorB, func(ctx context.Context) error {
		_, err := w.fx.store.FinalizeDesignPublish(ctx, storage.FinalizeDesignPublishCommand{
			DesignID: w.designID, SessionID: session.Session.ID, ActorUserID: rlsUserB,
		})
		return err
	})
	// The design-row publish lock is owner-org under RLS: a cross-org finalize
	// fails closed (design not found for FOR UPDATE), never publishes.
	if !errors.Is(err, domain.ErrDesignNotFound) && !errors.Is(err, domain.ErrFurnitureInstanceProjectNotWritable) {
		t.Fatalf("cross-org finalize must fail closed, got %v", err)
	}

	// Hard isolation proof on a PRIVATE org A project: org B cannot even see
	// the session, and published artifact rows are invisible under the app
	// role even with a deliberately unfiltered query (#449 convention).
	var privateDesignID string
	err = fiTx(t, w.fx.store, actorA, func(ctx context.Context) error {
		design, err := w.fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID: fiProjectAOnly, Name: "Closet Privado", ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		privateDesignID = design.ID
		private := manifestFor(w, nil)
		private.ProjectID = fiProjectAOnly
		private.DesignID = privateDesignID
		result, err := w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: privateDesignID, Manifest: private, ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		stageAllArtifactsInTx(t, ctx, &designPublishWorld{fx: w.fx, designID: privateDesignID}, result.Session.ID)
		_, err = w.fx.store.FinalizeDesignPublish(ctx, storage.FinalizeDesignPublishCommand{
			DesignID: privateDesignID, SessionID: result.Session.ID, ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("private project publish: %v", err)
	}

	err = fiTx(t, w.fx.store, actorB, func(ctx context.Context) error {
		var ids []string
		rows, err := w.fx.app.Query(ctx, `SELECT id FROM design_publish_sessions`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		for _, id := range ids {
			if id == session.Session.ID {
				return domain.ErrPublishSessionNotFound
			}
		}
		return w.fx.app.QueryRow(ctx,
			`SELECT count(*) FROM design_revision_artifacts`).Scan(new(int))
	})
	if err != nil {
		t.Fatalf("org B must see zero sessions/artifacts of a private org A project under RLS: %v", err)
	}
}

func TestDesignPublish_SessionExpiredAtFinalizeRejected(t *testing.T) {
	w := newDesignPublishWorld(t)
	actor := fiActorA()
	ctx := context.Background()

	var session *storage.PrepareResult
	err := fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		var err error
		session, err = w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: w.designID, Manifest: manifestFor(w, nil, w.fi1, w.fi2), ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	stageAllArtifacts(t, w, session.Session.ID)
	if _, err := w.fx.admin.Exec(ctx,
		`UPDATE design_publish_sessions SET expires_at = NOW() - interval '1 minute' WHERE id=$1`,
		session.Session.ID); err != nil {
		t.Fatal(err)
	}

	err = fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		_, err := w.fx.store.FinalizeDesignPublish(ctx, storage.FinalizeDesignPublishCommand{
			DesignID: w.designID, SessionID: session.Session.ID, ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrPublishSessionNotPrepared) {
		t.Fatalf("expired finalize must be rejected, got %v", err)
	}
	var revs []domain.DesignRevision
	readTx(t, w, func(ctx context.Context) error {
		var err error
		revs, err = w.fx.store.ListDesignRevisions(ctx, w.designID)
		return err
	})
	if len(revs) != 0 {
		t.Fatalf("no revision may be published from an expired session")
	}
}

func TestDesignPublish_UploadedByAndSourcePersisted(t *testing.T) {
	w := newDesignPublishWorld(t)
	actor := fiActorA()
	ctx := context.Background()

	var session *storage.PrepareResult
	var rev *domain.DesignRevision
	err := fiTx(t, w.fx.store, actor, func(ctx context.Context) error {
		var err error
		session, err = w.fx.store.PrepareDesignPublish(ctx, storage.PrepareDesignPublishCommand{
			DesignID: w.designID, Manifest: manifestFor(w, nil, w.fi1, w.fi2), ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		stageAllArtifactsInTx(t, ctx, w, session.Session.ID)
		rev, err = w.fx.store.FinalizeDesignPublish(ctx, storage.FinalizeDesignPublishCommand{
			DesignID: w.designID, SessionID: session.Session.ID, ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	// Authoring client metadata is durable on the session and the audit event.
	var client, suVersion, pluginVersion string
	if err := w.fx.admin.QueryRow(ctx, `
		SELECT source->>'client', source->>'sketchupVersion', source->>'pluginVersion'
		FROM design_publish_sessions WHERE id=$1`, session.Session.ID,
	).Scan(&client, &suVersion, &pluginVersion); err != nil {
		t.Fatal(err)
	}
	if client != "sketchup" || suVersion != "24.0.145" || pluginVersion != "0.1.0" {
		t.Fatalf("source metadata = %q %q %q", client, suVersion, pluginVersion)
	}
	var auditClient string
	if err := w.fx.admin.QueryRow(ctx, `
		SELECT details->>'authoring_client' FROM security_audit_events
		WHERE event_type='design_revision_published' AND details->>'design_revision_id'=$1`,
		rev.ID).Scan(&auditClient); err != nil || auditClient != "sketchup" {
		t.Fatalf("audit authoring client=%q err=%v", auditClient, err)
	}

	// GetDesignRevision rides artifact metadata along (#392 §31).
	var fetched *domain.DesignRevision
	readTx(t, w, func(ctx context.Context) error {
		var err error
		fetched, err = w.fx.store.GetDesignRevision(ctx, w.designID, rev.ID)
		return err
	})
	if len(fetched.Artifacts) != 3 || len(fetched.Items) != 2 {
		t.Fatalf("readback: artifacts=%d items=%d", len(fetched.Artifacts), len(fetched.Items))
	}
}

// Compile-time guard that the session TTL stays within the idempotency
// receipt lifetime assumptions (receipts default to +24h too).
func TestDesignPublish_SessionTTLIsPositive(t *testing.T) {
	if storage.DesignPublishSessionTTL <= 0 || storage.DesignPublishSessionTTL > 48*time.Hour {
		t.Fatalf("session ttl = %s", storage.DesignPublishSessionTTL)
	}
}
