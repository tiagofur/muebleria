package storage_test

// #1599: permanent dev-mode provenance mark on real PostgreSQL under the
// runtime role: stamped once with the real moment, never moved or cleared,
// tenant-scoped, untouched by the aggregate save, and absent by default.

import (
	"context"
	"testing"
	"time"
)

func TestProjectDevModeMark(t *testing.T) {
	ctx := context.Background()
	fx := setupDesignsTestFixture(t)

	readMark := func() *time.Time {
		t.Helper()
		var at *time.Time
		if err := fx.admin.QueryRow(ctx, `SELECT dev_mode_marked_at FROM projects WHERE id=$1`, fiProjectAOnly).Scan(&at); err != nil {
			t.Fatal(err)
		}
		return at
	}
	if readMark() != nil {
		t.Fatal("a project is unmarked by default")
	}

	// Another organization cannot mark it (RLS: zero rows, no audit).
	if err := fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		marked, e := fx.store.MarkProjectDevMode(ctx, fiProjectAOnly, rlsUserB, "", "req-b")
		if marked {
			t.Fatal("org B must not mark org A's project")
		}
		return e
	}); err != nil {
		t.Fatal(err)
	}
	if readMark() != nil {
		t.Fatal("cross-tenant mark leaked")
	}

	before := time.Now().Add(-time.Second)
	var first bool
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var e error
		first, e = fx.store.MarkProjectDevMode(ctx, fiProjectAOnly, rlsUserA, "10.0.0.1", "req-1599")
		return e
	}); err != nil || !first {
		t.Fatalf("first mark: %v %v", first, err)
	}
	at := readMark()
	if at == nil || at.Before(before) {
		t.Fatalf("mark must carry the real moment, got %v", at)
	}

	// A later sync in dev mode keeps the ORIGINAL moment (no-op, no audit).
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		again, e := fx.store.MarkProjectDevMode(ctx, fiProjectAOnly, rlsUserA, "", "req-again")
		if again {
			t.Fatal("re-marking must be a no-op")
		}
		return e
	}); err != nil {
		t.Fatal(err)
	}
	if got := readMark(); got == nil || !got.Equal(*at) {
		t.Fatalf("the mark moved: %v → %v", at, got)
	}
	var audits int
	if err := fx.admin.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE event_type='project_dev_mode_marked' AND details->>'project_id'=$1`, fiProjectAOnly).Scan(&audits); err != nil || audits != 1 {
		t.Fatalf("audits=%d err=%v", audits, err)
	}

	// The aggregate save reads and writes the project without touching it.
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		p, e := fx.store.GetProjectByID(ctx, fiProjectAOnly)
		if e != nil {
			return e
		}
		if p.DevModeMarkedAt == nil || !p.DevModeMarkedAt.Equal(*at) {
			t.Fatalf("the project read must expose the mark: %v", p.DevModeMarkedAt)
		}
		p.DevModeMarkedAt = nil // a client cannot clear it through the save
		p.Name = p.Name + " (editado)"
		return fx.store.UpdateProject(ctx, fiProjectAOnly, p)
	}); err != nil {
		t.Fatalf("update project: %v", err)
	}
	if got := readMark(); got == nil || !got.Equal(*at) {
		t.Fatalf("the save must not clear the mark: %v", got)
	}

	// Permanent against any direct write, even by the table owner (the
	// trigger fires regardless of RLS): neither cleared nor moved.
	for _, sql := range []string{
		`UPDATE projects SET dev_mode_marked_at = NULL WHERE id = $1`,
		`UPDATE projects SET dev_mode_marked_at = NOW() + interval '1 day' WHERE id = $1`,
	} {
		if _, err := fx.admin.Exec(ctx, sql, fiProjectAOnly); err == nil {
			t.Fatalf("the mark must be permanent: %s", sql)
		}
	}
}

func TestProjectDevModeMarkMigrationUpgradeAndDown(t *testing.T) {
	ctx := context.Background()
	pool := multiOrgFreshMigrationDB(t)
	identityApplyThrough(t, pool, 193)
	// Upgrade path: an existing column set without the mark.
	var hasColumn bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='dev_mode_marked_at')`).Scan(&hasColumn); err != nil || hasColumn {
		t.Fatalf("before 000194 the column must not exist (%v %v)", hasColumn, err)
	}
	applyMigrationFile(t, pool, "000194_project_dev_mode_mark.up.sql")
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='dev_mode_marked_at' AND is_nullable='YES')`).Scan(&hasColumn); err != nil || !hasColumn {
		t.Fatalf("000194 must add a nullable column (%v %v)", hasColumn, err)
	}
	// Idempotent re-apply (IF NOT EXISTS / OR REPLACE), then down, then up.
	applyMigrationFile(t, pool, "000194_project_dev_mode_mark.up.sql")
	applyMigrationFile(t, pool, "000194_project_dev_mode_mark.down.sql")
	var leftovers int
	if err := pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name='projects' AND column_name='dev_mode_marked_at')
		     + (SELECT count(*) FROM pg_trigger WHERE tgname='trg_project_dev_mode_mark_permanent')
		     + (SELECT count(*) FROM pg_proc WHERE proname='project_dev_mode_mark_is_permanent')`).Scan(&leftovers); err != nil || leftovers != 0 {
		t.Fatalf("down left %d objects (%v)", leftovers, err)
	}
	applyMigrationFile(t, pool, "000194_project_dev_mode_mark.up.sql")
}
