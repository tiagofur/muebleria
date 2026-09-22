package storage_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// #815 — deleting a project must remove it together with its commercial and
// durable family (quote revisions + items, designs + revisions + items,
// furniture instances, publish sessions, production releases + engineering +
// manufacturing snapshots), while every durability guard keeps blocking
// direct deletes outside the storage-layer project-delete transaction.
//
// The fixture reuses the canonical requote demo (accepted quote revision,
// published design revision, synced/modified/modeled furniture instances) and
// seeds the release family on top — the same shape as a real project that
// hit DELETE /api/projects/{id} → 500.

const (
	deleteTestReleaseID = "a1000000-0000-0000-0000-000000000001"
	deleteTestSessionID = "a1000000-0000-0000-0000-000000000002"
)

func seedDeleteReleaseFamily(t *testing.T, admin *pgxpool.Pool, projectID, quoteRevID, designRevID string) string {
	t.Helper()
	ctx := context.Background()
	var designID string
	if err := admin.QueryRow(ctx,
		`SELECT design_id FROM design_revisions WHERE id = $1`, designRevID).Scan(&designID); err != nil {
		t.Fatalf("resolve design for release seed: %v", err)
	}
	statements := []string{
		`INSERT INTO production_releases
		 (id, organization_id, project_id, release_number, design_revision_id, quote_revision_id,
		  manufacturing_fingerprint, released_by)
		 VALUES ('` + deleteTestReleaseID + `', '` + rlsOrgA + `', '` + projectID + `', 1, '` + designRevID + `', '` + quoteRevID + `',
		  'sha256-` + strings.Repeat("a", 64) + `', '` + rlsUserA + `')`,
		`INSERT INTO production_release_engineering
		 (release_id, project_id, organization_id, status, started_by)
		 VALUES ('` + deleteTestReleaseID + `', '` + projectID + `', '` + rlsOrgA + `', 'in_progress', '` + rlsUserA + `')`,
		`INSERT INTO production_release_manufacturing_snapshots
		 (release_id, project_id, organization_id, schema_version, payload)
		 VALUES ('` + deleteTestReleaseID + `', '` + projectID + `', '` + rlsOrgA + `', 1, '{}'::jsonb)`,
		`INSERT INTO design_publish_sessions
		 (id, organization_id, project_id, design_id, base_revision_id, source, manifest, expires_at)
		 VALUES ('` + deleteTestSessionID + `', '` + rlsOrgA + `', '` + projectID + `', '` + designID + `', '` + designRevID + `',
		  '{}'::jsonb, '{}'::jsonb, NOW() + INTERVAL '1 hour')`,
	}
	for _, statement := range statements {
		if _, err := admin.Exec(ctx, statement); err != nil {
			t.Fatalf("seed release family: %v\n%s", err, statement)
		}
	}
	return designID
}

func TestDeleteProject_RemovesFullCommercialHistoryFamily(t *testing.T) {
	fx := setupRequoteFixture(t)
	seedDeleteReleaseFamily(t, fx.admin, fx.projectID, fx.quoteRevID, fx.designRevID)

	// The failing operation: today this dies at the first protected cascade
	// child (permission denied / immutability trigger / NO ACTION grandchild).
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		return fx.store.DeleteProject(ctx, fx.projectID)
	}); err != nil {
		t.Fatalf("DeleteProject with commercial history: %v", err)
	}

	family := []struct{ table, column string }{
		{"projects", "id"},
		{"project_items", "project_id"},
		{"quote_revisions", "project_id"},
		{"quote_revision_items", "project_id"},
		{"quote_line_furniture_instances", "project_id"},
		{"designs", "project_id"},
		{"design_revisions", "project_id"},
		{"design_revision_items", "project_id"},
		{"design_working_copies", "project_id"},
		{"design_working_items", "project_id"},
		{"furniture_instances", "project_id"},
		{"design_publish_sessions", "project_id"},
		{"production_releases", "project_id"},
		{"production_release_engineering", "project_id"},
		{"production_release_manufacturing_snapshots", "project_id"},
	}
	for _, member := range family {
		var count int
		if err := fx.admin.QueryRow(context.Background(),
			`SELECT count(*) FROM `+member.table+` WHERE `+member.column+` = $1`,
			fx.projectID).Scan(&count); err != nil {
			t.Fatalf("count %s after delete: %v", member.table, err)
		}
		if count != 0 {
			t.Errorf("%s still has %d rows for the deleted project", member.table, count)
		}
	}
}

func TestDeleteProject_DurabilityGuardsBlockDirectDeletes(t *testing.T) {
	fx := setupRequoteFixture(t)
	seedDeleteReleaseFamily(t, fx.admin, fx.projectID, fx.quoteRevID, fx.designRevID)

	cases := []struct {
		name      string
		statement string
		wantMsg   string
	}{
		{"quote_revisions", `DELETE FROM quote_revisions WHERE id = '` + fx.quoteRevID + `'`, "cannot be deleted"},
		{"design_revisions", `DELETE FROM design_revisions WHERE id = '` + fx.designRevID + `'`, "cannot be deleted"},
		{"furniture_instances", `DELETE FROM furniture_instances WHERE project_id = '` + fx.projectID + `'`, "only deletable through project deletion"},
		{"production_releases", `DELETE FROM production_releases WHERE id = '` + deleteTestReleaseID + `'`, "immutable history"},
		{"production_release_engineering", `DELETE FROM production_release_engineering WHERE release_id = '` + deleteTestReleaseID + `'`, "durable history"},
		{"production_release_manufacturing_snapshots", `DELETE FROM production_release_manufacturing_snapshots WHERE release_id = '` + deleteTestReleaseID + `'`, "immutable history"},
	}
	for _, testCase := range cases {
		withRLSActor(t, fx.store.Pool, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
			_, err := tx.Exec(context.Background(), testCase.statement)
			if err == nil {
				t.Errorf("%s: direct delete under the app role unexpectedly succeeded", testCase.name)
				return
			}
			if !strings.Contains(err.Error(), testCase.wantMsg) && !strings.Contains(err.Error(), "permission denied") {
				t.Errorf("%s: direct delete error = %q, want durability guard or permission denied", testCase.name, err.Error())
			}
		})
	}
}

func TestDeleteProject_GuardIsTransactionScoped(t *testing.T) {
	fx := setupRequoteFixture(t)

	// A successful project delete opens the guard inside its own transaction…
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		return fx.store.DeleteProject(ctx, fiProjectAOnly)
	}); err != nil {
		t.Fatalf("DeleteProject empty project: %v", err)
	}

	// …and the guard must die with that transaction: on a NEW transaction from
	// the same pool, the surviving quote revision is still undeletable.
	withRLSActor(t, fx.store.Pool, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(),
			`DELETE FROM quote_revisions WHERE id = $1`, fx.quoteRevID)
		if err == nil {
			t.Error("guard leaked: direct quote_revision delete succeeded after a project delete")
			return
		}
		if !strings.Contains(err.Error(), "cannot be deleted") && !strings.Contains(err.Error(), "permission denied") {
			t.Errorf("post-delete guard error = %q, want direct delete prohibition", err.Error())
		}
	})
}

func TestProjectDeleteGuardMigrationDownAndReplay(t *testing.T) {
	fx := setupRequoteFixture(t)
	ctx := context.Background()

	down, err := os.ReadFile("../../db/migration/000137_project_delete_guard.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fx.admin.Exec(ctx, string(down)); err != nil {
		t.Fatalf("down 000137: %v", err)
	}

	// Posture restored: even WITH the guard set, the durability trigger raises
	// again, and neither the grant nor the DELETE policy survive.
	withRLSActor(t, fx.store.Pool, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
		if _, err := tx.Exec(ctx, `SELECT set_config('app.allow_project_cascade_delete','on',true)`); err != nil {
			t.Fatalf("set guard for down posture: %v", err)
		}
		_, err := tx.Exec(ctx, `DELETE FROM quote_revisions WHERE id = $1`, fx.quoteRevID)
		// Restored posture blocks at the FIRST layer: the REVOKE denies the
		// table before any trigger runs — exactly the pre-#815 barrier.
		if err == nil || !strings.Contains(err.Error(), "permission denied") {
			t.Errorf("down posture: guarded delete error = %v, want permission denied (restored REVOKE)", err)
		}
	})
	var granted bool
	if err := fx.admin.QueryRow(ctx,
		`SELECT has_table_privilege('granete_app','quote_revisions','DELETE')`).Scan(&granted); err != nil || granted {
		t.Errorf("down posture: granete_app DELETE on quote_revisions granted=%v err=%v", granted, err)
	}
	var policyCount int
	if err := fx.admin.QueryRow(ctx,
		`SELECT count(*) FROM pg_policies WHERE policyname='quote_revisions_delete'`).Scan(&policyCount); err != nil || policyCount != 0 {
		t.Errorf("down posture: quote_revisions_delete policies=%d err=%v", policyCount, err)
	}

	// Replay: the up migration restores the guarded posture exactly.
	up, err := os.ReadFile("../../db/migration/000137_project_delete_guard.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fx.admin.Exec(ctx, string(up)); err != nil {
		t.Fatalf("replay up 000137: %v", err)
	}
	if err := fx.admin.QueryRow(ctx,
		`SELECT has_table_privilege('granete_app','quote_revisions','DELETE')`).Scan(&granted); err != nil || granted {
		t.Errorf("replay posture: direct DELETE must remain revoked, granted=%v err=%v", granted, err)
	}
	if err := fx.admin.QueryRow(ctx,
		`SELECT count(*) FROM pg_policies WHERE policyname='quote_revisions_delete'`).Scan(&policyCount); err != nil || policyCount != 0 {
		t.Errorf("replay posture: no generic DELETE policy, policies=%d err=%v", policyCount, err)
	}
	var executable bool
	if err := fx.admin.QueryRow(ctx, `SELECT has_function_privilege('granete_app', 'delete_project_tree(uuid)', 'EXECUTE')`).Scan(&executable); err != nil || !executable {
		t.Errorf("replay posture: canonical project delete function executable=%v err=%v", executable, err)
	}
}

func TestProjectForeignKeysHaveExplicitDeleteLifecycle(t *testing.T) {
	fx := setupRequoteFixture(t)
	rows, err := fx.admin.Query(context.Background(), `
		SELECT child.relname, attribute.attname, constraint_.confdeltype
		FROM pg_constraint constraint_
		JOIN pg_class child ON child.oid = constraint_.conrelid
		JOIN pg_class parent ON parent.oid = constraint_.confrelid
		JOIN pg_attribute attribute ON attribute.attrelid = child.oid
			AND attribute.attnum = ANY(constraint_.conkey)
		WHERE constraint_.contype = 'f' AND parent.relname = 'projects'
		ORDER BY child.relname, attribute.attname`)
	if err != nil {
		t.Fatalf("inspect project foreign keys: %v", err)
	}
	defer rows.Close()
	setNull := map[string]bool{
		"stock_movements.project_id":                true,
		"purchase_order_items.allocated_project_id": true,
	}
	for rows.Next() {
		var table, column, deleteType string
		if err := rows.Scan(&table, &column, &deleteType); err != nil {
			t.Fatal(err)
		}
		key := table + "." + column
		if setNull[key] {
			if deleteType != "n" { // PostgreSQL confdeltype: n = SET NULL.
				t.Errorf("%s delete action=%q, want SET NULL", key, deleteType)
			}
			continue
		}
		if deleteType != "c" { // c = CASCADE; reject NO ACTION / RESTRICT.
			t.Errorf("%s delete action=%q, want CASCADE or an explicit SET NULL allowlist entry", key, deleteType)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate project foreign keys: %v", err)
	}
}
