package storage_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/storage"
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
	return seedDeleteReleaseFamilyForOrganization(t, admin, projectID, quoteRevID, designRevID, rlsOrgA)
}

func seedDeleteReleaseFamilyForOrganization(t *testing.T, admin *pgxpool.Pool, projectID, quoteRevID, designRevID, organizationID string) string {
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
		 VALUES ('` + deleteTestReleaseID + `', '` + organizationID + `', '` + projectID + `', 1, '` + designRevID + `', '` + quoteRevID + `',
		  'sha256-` + strings.Repeat("a", 64) + `', '` + rlsUserA + `')`,
		`INSERT INTO production_release_engineering
		 (release_id, project_id, organization_id, status, started_by)
		 VALUES ('` + deleteTestReleaseID + `', '` + projectID + `', '` + organizationID + `', 'in_progress', '` + rlsUserA + `')`,
		`INSERT INTO production_release_manufacturing_snapshots
		 (release_id, project_id, organization_id, schema_version, payload)
		 VALUES ('` + deleteTestReleaseID + `', '` + projectID + `', '` + organizationID + `', 1, '{}'::jsonb)`,
		`INSERT INTO design_publish_sessions
		 (id, organization_id, project_id, design_id, base_revision_id, source, manifest, expires_at)
		 VALUES ('` + deleteTestSessionID + `', '` + organizationID + `', '` + projectID + `', '` + designID + `', '` + designRevID + `',
		  '{}'::jsonb, '{}'::jsonb, NOW() + INTERVAL '1 hour')`,
	}
	for _, statement := range statements {
		if _, err := admin.Exec(ctx, statement); err != nil {
			t.Fatalf("seed release family: %v\n%s", err, statement)
		}
	}
	return designID
}

// seedDeleteCatalogPins creates real project-owned pins to immutable catalog rows.
// The pins must disappear with the project; the catalog rows must not.
func seedDeleteCatalogPins(t *testing.T, fx *requoteFixture) {
	t.Helper()
	ctx := context.Background()
	statements := []string{
		`INSERT INTO hardware_assets (id, organization_id, display_name, created_by) VALUES ('a2000000-0000-0000-0000-000000000001', '` + rlsOrgA + `', 'Delete fixture asset', '` + rlsUserA + `')`,
		`INSERT INTO hardware_asset_revisions (id, organization_id, asset_id, revision_number, representation, storage_key, content_type, size_bytes, sha256, integrity_verified_at, created_by) VALUES ('a2000000-0000-0000-0000-000000000002', '` + rlsOrgA + `', 'a2000000-0000-0000-0000-000000000001', 1, 'glb', 'hardware/delete-fixture.glb', 'model/gltf-binary', 1, 'sha256-` + strings.Repeat("b", 64) + `', NOW(), '` + rlsUserA + `')`,
		`INSERT INTO hardware_asset_validations (organization_id, asset_id, revision_id, sha256, tool, result, created_by) VALUES ('` + rlsOrgA + `', 'a2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', 'sha256-` + strings.Repeat("b", 64) + `', 'delete-fixture', 'passed', '` + rlsUserA + `')`,
		`INSERT INTO hardwares (id, code, name, unit, cost_per_unit, active, organization_id, visual_asset_id, visual_asset_revision_id) VALUES ('a2000000-0000-0000-0000-000000000003', 'DELETE-PIN-HW', 'Delete pin hardware', 'piece', 1, TRUE, '` + rlsOrgA + `', 'a2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002')`,
		`INSERT INTO design_revision_hardware_assets (organization_id, project_id, design_revision_id, hardware_id, asset_id, asset_revision_id, representation, sha256) VALUES ('` + rlsOrgA + `', '` + fx.projectID + `', '` + fx.designRevID + `', 'a2000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', 'glb', 'sha256-` + strings.Repeat("b", 64) + `')`,
		`INSERT INTO agregados (id, code, name, components, organization_id) VALUES ('delete-pin-agregado', 'DELETE-PIN-AGREGADO', 'Delete pin agregado', '[]'::jsonb, '` + rlsOrgA + `')`,
		`INSERT INTO agregado_revisions (id, organization_id, agregado_id, revision_number, recipe, created_by) VALUES ('a2000000-0000-0000-0000-000000000004', '` + rlsOrgA + `', 'delete-pin-agregado', 1, '{}'::jsonb, '` + rlsUserA + `')`,
		`UPDATE agregados SET current_revision_id='a2000000-0000-0000-0000-000000000004' WHERE organization_id='` + rlsOrgA + `' AND id='delete-pin-agregado'`,
		`INSERT INTO published_assembly_snapshots (id, organization_id, agregado_id, agregado_revision_id, agregado_revision_number, resolved_width_mm, resolved_depth_mm, resolved_height_mm, payload_hash, snapshot, created_by) VALUES ('a2000000-0000-0000-0000-000000000005', '` + rlsOrgA + `', 'delete-pin-agregado', 'a2000000-0000-0000-0000-000000000004', 1, 1, 1, 1, 'delete-pin-hash', '{}'::jsonb, '` + rlsUserA + `')`,
		`INSERT INTO design_revision_assembly_snapshots (organization_id, project_id, design_revision_id, agregado_id, slot_key, snapshot_id) VALUES ('` + rlsOrgA + `', '` + fx.projectID + `', '` + fx.designRevID + `', 'delete-pin-agregado', 'delete-pin', 'a2000000-0000-0000-0000-000000000005')`,
	}
	for _, statement := range statements {
		if _, err := fx.admin.Exec(ctx, statement); err != nil {
			t.Fatalf("seed catalog pin: %v\\n%s", err, statement)
		}
	}
}

func TestDeleteProject_RemovesPinsButPreservesSharedCatalog(t *testing.T) {
	ctx := context.Background()
	fx := setupRequoteFixture(t)
	seedDeleteCatalogPins(t, fx)
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error { return fx.store.DeleteProject(ctx, fx.projectID) }); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"design_revision_hardware_assets", "design_revision_assembly_snapshots"} {
		var count int
		if err := fx.admin.QueryRow(ctx, `SELECT count(*) FROM `+table+` WHERE project_id=$1`, fx.projectID).Scan(&count); err != nil || count != 0 {
			t.Fatalf("%s pins remain=%d err=%v", table, count, err)
		}
	}
	for _, check := range []string{
		`SELECT count(*) FROM hardware_assets WHERE id='a2000000-0000-0000-0000-000000000001'`,
		`SELECT count(*) FROM hardware_asset_revisions WHERE id='a2000000-0000-0000-0000-000000000002'`,
		`SELECT count(*) FROM hardware_asset_validations WHERE asset_id='a2000000-0000-0000-0000-000000000001'`,
		`SELECT count(*) FROM hardwares WHERE id='a2000000-0000-0000-0000-000000000003'`,
		`SELECT count(*) FROM agregados WHERE organization_id='` + rlsOrgA + `' AND id='delete-pin-agregado'`,
		`SELECT count(*) FROM agregado_revisions WHERE id='a2000000-0000-0000-0000-000000000004'`,
		`SELECT count(*) FROM published_assembly_snapshots WHERE id='a2000000-0000-0000-0000-000000000005'`,
	} {
		var count int
		if err := fx.admin.QueryRow(ctx, check).Scan(&count); err != nil || count != 1 {
			t.Fatalf("shared catalog lost query=%s count=%d err=%v", check, count, err)
		}
	}
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
		{"design_revision_artifacts", `DELETE FROM design_revision_artifacts WHERE project_id = '` + fx.projectID + `'`, "immutable history"},
		{"design_revision_hardware_assets", `DELETE FROM design_revision_hardware_assets WHERE project_id = '` + fx.projectID + `'`, "immutable"},
		{"design_revision_assembly_snapshots", `DELETE FROM design_revision_assembly_snapshots WHERE project_id = '` + fx.projectID + `'`, "immutable"},
		{"design_publish_sessions", `DELETE FROM design_publish_sessions WHERE project_id = '` + fx.projectID + `'`, "only deletable"},
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

func TestDeleteProject_RejectsNonWritableOrganization(t *testing.T) {
	fx := setupRequoteFixture(t)
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `UPDATE organizations SET status='suspended', status_reason='test suspension' WHERE id=$1`, rlsOrgA); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = fx.admin.Exec(ctx, `UPDATE organizations SET status='active', status_reason=NULL WHERE id=$1`, rlsOrgA)
	})
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		return fx.store.DeleteProject(txCtx, fx.projectID)
	}); err == nil || !strings.Contains(err.Error(), "writable organization scope") {
		t.Fatalf("DeleteProject with non-writable organization error=%v, want writable-scope rejection", err)
	}
	var count int
	if err := fx.admin.QueryRow(ctx, `SELECT count(*) FROM projects WHERE id=$1`, fx.projectID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("project must survive rejected delete: count=%d err=%v", count, err)
	}
}

func TestDeleteProject_StoreAuthorityDeletesFactoryPrivateReleaseTree(t *testing.T) {
	fx := setupRequoteFixture(t)
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `ALTER TABLE projects DISABLE TRIGGER protect_project_organization_ownership`); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.admin.Exec(ctx, `UPDATE projects SET manufacturing_organization_id=$2 WHERE id=$1`, fx.projectID, rlsOrgB); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.admin.Exec(ctx, `ALTER TABLE projects ENABLE TRIGGER protect_project_organization_ownership`); err != nil {
		t.Fatal(err)
	}
	seedDeleteReleaseFamilyForOrganization(t, fx.admin, fx.projectID, fx.quoteRevID, fx.designRevID, rlsOrgB)
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		return fx.store.DeleteProject(txCtx, fx.projectID)
	}); err != nil {
		t.Fatalf("Store-authorized DeleteProject of Factory release tree: %v", err)
	}
	for _, member := range []struct{ table, column string }{{"projects", "id"}, {"production_releases", "project_id"}, {"production_release_engineering", "project_id"}, {"production_release_manufacturing_snapshots", "project_id"}} {
		var count int
		if err := fx.admin.QueryRow(ctx, `SELECT count(*) FROM `+member.table+` WHERE `+member.column+`=$1`, fx.projectID).Scan(&count); err != nil || count != 0 {
			t.Errorf("%s after Store->Factory delete count=%d err=%v", member.table, count, err)
		}
	}
	// The canonical command does not mint cross-org table DELETE capability.
	withRLSActor(t, fx.store.Pool, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
		if _, err := tx.Exec(ctx, `DELETE FROM production_release_engineering WHERE organization_id=$1`, rlsOrgB); err == nil || !strings.Contains(err.Error(), "permission denied") {
			t.Errorf("post-command direct cross-org DELETE error=%v, want permission denied", err)
		}
	})
}

func TestDeleteProject_MediaCleanupRunsOnlyAfterCommit(t *testing.T) {
	fx := setupRequoteFixture(t)
	ctx := context.Background()
	photoPath := filepath.Join(t.TempDir(), "photo.jpg")
	if err := os.WriteFile(photoPath, []byte("project photo"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.admin.Exec(ctx, `INSERT INTO project_photos (project_id, stage, url, organization_id) VALUES ($1, 'survey', '/api/media/delete-photo.jpg', $2)`, fx.projectID, rlsOrgA); err != nil {
		t.Fatal(err)
	}
	called := false
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		return fx.store.DeleteProjectWithMediaCleanup(txCtx, fx.projectID, func(_ context.Context, files []storage.ProjectMediaFile) {
			called = len(files) == 2 && files[0].MediaURL == "/api/media/delete-photo.jpg"
			_ = os.Remove(photoPath)
		})
	}); err != nil {
		t.Fatal(err)
	}
	if !called {
		t.Fatal("post-commit cleanup did not receive the project media reference")
	}
	if _, err := os.Stat(photoPath); !os.IsNotExist(err) {
		t.Fatalf("post-commit media file remains: %v", err)
	}
	var count int
	if err := fx.admin.QueryRow(ctx, `SELECT count(*) FROM projects WHERE id=$1`, fx.projectID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("committed project count=%d err=%v", count, err)
	}
}

func TestDeleteProject_MediaCleanupIsDiscardedOnRollbackAndMissingFileIsHarmless(t *testing.T) {
	fx := setupRequoteFixture(t)
	ctx := context.Background()
	photoPath := filepath.Join(t.TempDir(), "survives.jpg")
	if err := os.WriteFile(photoPath, []byte("project photo"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.admin.Exec(ctx, `INSERT INTO project_photos (project_id, stage, url, organization_id) VALUES ($1, 'survey', '/api/media/rollback-photo.jpg', $2)`, fx.projectID, rlsOrgA); err != nil {
		t.Fatal(err)
	}
	called := false
	err := fx.store.WithinTenantTx(ctx, fiActorA(), func(txCtx context.Context) error {
		if err := fx.store.DeleteProjectWithMediaCleanup(txCtx, fx.projectID, func(_ context.Context, _ []storage.ProjectMediaFile) { called = true; _ = os.Remove(photoPath) }); err != nil {
			return err
		}
		return errors.New("force rollback after canonical delete")
	})
	if err == nil {
		t.Fatal("expected forced rollback")
	}
	if called {
		t.Fatal("cleanup ran despite rollback")
	}
	if _, err := os.Stat(photoPath); err != nil {
		t.Fatalf("rollback must retain physical media: %v", err)
	}
	var count int
	if err := fx.admin.QueryRow(ctx, `SELECT count(*) FROM projects WHERE id=$1`, fx.projectID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("rollback project count=%d err=%v", count, err)
	}
	// A missing file still allows the canonical delete to commit.
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		return fx.store.DeleteProjectWithMediaCleanup(txCtx, fx.projectID, func(_ context.Context, _ []storage.ProjectMediaFile) {
			_ = os.Remove(filepath.Join(filepath.Dir(photoPath), "already-missing.jpg"))
		})
	}); err != nil {
		t.Fatalf("missing post-commit media must not fail delete: %v", err)
	}
}

func TestDeleteProject_PreservesExternalStockHistoryWithNullProject(t *testing.T) {
	fx := setupRequoteFixture(t)
	ctx := context.Background()
	movementID := "a1000000-0000-0000-0000-000000000099"
	if _, err := fx.admin.Exec(ctx, `INSERT INTO stock_movements (id, organization_id, kind, material_id, type, delta, balance_after, project_id) VALUES ($1, $2, 'tableros', 'external-history', 'salida', -1, 9, $3)`, movementID, rlsOrgA, fx.projectID); err != nil {
		t.Fatal(err)
	}
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error { return fx.store.DeleteProject(txCtx, fx.projectID) }); err != nil {
		t.Fatal(err)
	}
	var projectID *string
	var organizationID, kind, materialID, movementType string
	var delta float64
	if err := fx.admin.QueryRow(ctx, `SELECT project_id::text, organization_id::text, kind, material_id, type, delta FROM stock_movements WHERE id=$1`, movementID).Scan(&projectID, &organizationID, &kind, &materialID, &movementType, &delta); err != nil {
		t.Fatalf("external stock history must survive: %v", err)
	}
	if projectID != nil || organizationID != rlsOrgA || kind != "tableros" || materialID != "external-history" || movementType != "salida" || delta != -1 {
		t.Fatalf("stock history mutated: project=%v org=%s kind=%s material=%s type=%s delta=%v", projectID, organizationID, kind, materialID, movementType, delta)
	}
}

func TestDeleteProject_DirectProjectsDeleteRemainsDeniedEvenWithGuard(t *testing.T) {
	fx := setupRequoteFixture(t)
	withRLSActor(t, fx.store.Pool, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
		if _, err := tx.Exec(context.Background(), `SELECT set_config('app.allow_project_cascade_delete','on',true)`); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(context.Background(), `DELETE FROM projects WHERE id=$1`, fx.projectID); err == nil || !strings.Contains(err.Error(), "permission denied") {
			t.Fatalf("direct project delete with manual guard error=%v, want permission denied", err)
		}
	})
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error { return fx.store.DeleteProject(ctx, fx.projectID) }); err != nil {
		t.Fatalf("canonical project delete: %v", err)
	}
}

func TestDeleteProject_PreservesPurchaseAllocationHistoryWithNullProject(t *testing.T) {
	fx := setupRequoteFixture(t)
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `INSERT INTO purchase_orders (id, number, status, organization_id) VALUES ('delete-project-po', 'DELETE-PROJECT-PO', 'emitida', $1)`, rlsOrgA); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.admin.Exec(ctx, `INSERT INTO purchase_order_items (po_id, kind, material_id, quantity, unit_cost, organization_id, allocated_project_id) VALUES ('delete-project-po', 'tableros', 'external-allocation', 1, 42.5, $1, $2)`, rlsOrgA, fx.projectID); err != nil {
		t.Fatal(err)
	}
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error { return fx.store.DeleteProject(txCtx, fx.projectID) }); err != nil {
		t.Fatal(err)
	}
	var projectID *string
	var organizationID string
	var quantity, unitCost float64
	if err := fx.admin.QueryRow(ctx, `SELECT allocated_project_id::text, organization_id::text, quantity, unit_cost FROM purchase_order_items WHERE po_id='delete-project-po' AND kind='tableros' AND material_id='external-allocation'`).Scan(&projectID, &organizationID, &quantity, &unitCost); err != nil {
		t.Fatalf("purchase allocation must survive: %v", err)
	}
	if projectID != nil || organizationID != rlsOrgA || quantity != 1 || unitCost != 42.5 {
		t.Fatalf("purchase allocation mutated: project=%v org=%s quantity=%v unitCost=%v", projectID, organizationID, quantity, unitCost)
	}
}

func TestProjectDeleteBoundaryHasSafeDeploymentOwnershipPosture(t *testing.T) {
	fx := setupRequoteFixture(t)
	var owner string
	var securityDefiner, appCanAssumeOwner, appSuperuser, appBypassRLS bool
	if err := fx.admin.QueryRow(context.Background(), `
		SELECT p.proowner::regrole::text, p.prosecdef,
		       pg_has_role('granete_app', p.proowner::regrole, 'USAGE'), app.rolsuper, app.rolbypassrls
		FROM pg_proc p JOIN pg_roles app ON app.rolname='granete_app'
		WHERE p.oid='delete_project_tree(uuid)'::regprocedure`).Scan(&owner, &securityDefiner, &appCanAssumeOwner, &appSuperuser, &appBypassRLS); err != nil {
		t.Fatal(err)
	}
	if owner == "granete_app" || !securityDefiner || appCanAssumeOwner || appSuperuser || appBypassRLS {
		t.Fatalf("unsafe delete boundary owner=%q definer=%v appCanAssumeOwner=%v superuser=%v bypassrls=%v", owner, securityDefiner, appCanAssumeOwner, appSuperuser, appBypassRLS)
	}
}

func TestDeleteProject_ManualGuardNeverAuthorizesSharedCatalogDeletes(t *testing.T) {
	fx := setupRequoteFixture(t)
	seedDeleteCatalogPins(t, fx)
	cases := []string{
		`DELETE FROM hardware_assets WHERE id='a2000000-0000-0000-0000-000000000001'`,
		`DELETE FROM hardware_asset_revisions WHERE id='a2000000-0000-0000-0000-000000000002'`,
		`DELETE FROM hardware_asset_validations WHERE asset_id='a2000000-0000-0000-0000-000000000001'`,
		`DELETE FROM hardwares WHERE id='a2000000-0000-0000-0000-000000000003'`,
		`DELETE FROM published_assembly_snapshots WHERE id='a2000000-0000-0000-0000-000000000005'`,
		`DELETE FROM agregado_revisions WHERE id='a2000000-0000-0000-0000-000000000004'`,
		`DELETE FROM agregados WHERE organization_id='` + rlsOrgA + `' AND id='delete-pin-agregado'`,
	}
	for _, statement := range cases {
		// Each expected permission error gets its own transaction so a PostgreSQL
		// aborted transaction can never masquerade as a later denial.
		withRLSActor(t, fx.store.Pool, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
			if _, err := tx.Exec(context.Background(), `SELECT set_config('app.allow_project_cascade_delete','on',true)`); err != nil {
				t.Fatal(err)
			}
			if _, err := tx.Exec(context.Background(), statement); err == nil {
				t.Errorf("manual guard DELETE %q unexpectedly succeeded", statement)
			}
		})
	}
}

func TestDeleteProject_RejectsForgedOrInactiveActorMembership(t *testing.T) {
	cases := []struct {
		name    string
		actor   storage.TenantActor
		prepare func(t *testing.T, fx *requoteFixture)
	}{
		{
			name:  "forged membership",
			actor: storage.TenantActor{OrganizationID: rlsOrgA, UserID: rlsUserA, MembershipID: "40000000-0000-0000-0000-0000000000ff"},
		},
		{
			name:  "foreign organization membership",
			actor: storage.TenantActor{OrganizationID: rlsOrgA, UserID: rlsUserA, MembershipID: "40000000-0000-0000-0000-00000000000b"},
		},
		{
			name:  "revoked membership",
			actor: storage.TenantActor{OrganizationID: rlsOrgA, UserID: "40000000-0000-0000-0000-00000000000c", MembershipID: "40000000-0000-0000-0000-00000000000d"},
			prepare: func(t *testing.T, fx *requoteFixture) {
				t.Helper()
				if _, err := fx.admin.Exec(context.Background(), `INSERT INTO users (id, email, normalized_email, password_hash, name, account_status) VALUES ('40000000-0000-0000-0000-00000000000c', 'suspended-delete@example.test', 'suspended-delete@example.test', 'x', 'Suspended delete', 'active')`); err != nil {
					t.Fatalf("seed suspended actor user: %v", err)
				}
				if _, err := fx.admin.Exec(context.Background(), `INSERT INTO memberships (id, organization_id, user_id, roles, status) VALUES ('40000000-0000-0000-0000-00000000000d', $1, '40000000-0000-0000-0000-00000000000c', '{user}', 'suspended')`, rlsOrgA); err != nil {
					t.Fatalf("seed suspended actor membership: %v", err)
				}
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fx := setupRequoteFixture(t)
			if tc.prepare != nil {
				tc.prepare(t, fx)
			}
			err := fiTx(t, fx.store, tc.actor, func(ctx context.Context) error { return fx.store.DeleteProject(ctx, fx.projectID) })
			if err == nil || !strings.Contains(err.Error(), "active actor membership") {
				t.Fatalf("forged/inactive membership delete error=%v", err)
			}
			var count int
			if err := fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM projects WHERE id=$1`, fx.projectID).Scan(&count); err != nil || count != 1 {
				t.Fatalf("unauthorized actor changed project: count=%d err=%v", count, err)
			}
		})
	}
}

func TestDeleteProject_RejectsBareOrganizationScope(t *testing.T) {
	fx := setupRequoteFixture(t)
	if err := fx.store.DeleteProject(storage.WithOrgCtx(context.Background(), rlsOrgA), fx.projectID); err == nil || !strings.Contains(err.Error(), "complete tenant actor") {
		t.Fatalf("bare WithOrgCtx delete error=%v, want complete-actor rejection", err)
	}
	var count int
	if err := fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM projects WHERE id=$1`, fx.projectID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("bare scope delete changed project: count=%d err=%v", count, err)
	}
}
