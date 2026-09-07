package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const snapshotTable = "production_release_manufacturing_snapshots"
const snapshotInsert = `INSERT INTO production_release_manufacturing_snapshots
	(release_id, project_id, organization_id, schema_version, payload) VALUES ($1, $2, $3, $4, $5)`

func assertPrivateSnapshotSchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	var forced, enabled bool
	if err := pool.QueryRow(ctx, `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
		WHERE oid = $1::regclass`, snapshotTable).Scan(&enabled, &forced); err != nil || !enabled || !forced {
		t.Fatalf("RLS enabled=%v forced=%v error=%v", enabled, forced, err)
	}
	var classification, readScope, writeScope string
	if err := pool.QueryRow(ctx, `SELECT classification, read_scope, write_scope
		FROM rls_policy_inventory WHERE table_name=$1`, snapshotTable).
		Scan(&classification, &readScope, &writeScope); err != nil || classification != "tenant-owned" ||
		readScope != "owner-organization" || writeScope != "owner-organization-immutable" {
		t.Fatalf("inventory=%s/%s/%s error=%v", classification, readScope, writeScope, err)
	}
	var grants string
	if err := pool.QueryRow(ctx, `SELECT string_agg(privilege_type, ',' ORDER BY privilege_type)
		FROM information_schema.table_privileges WHERE table_name=$1 AND grantee='granete_app'`,
		snapshotTable).Scan(&grants); err != nil || grants != "INSERT,SELECT" {
		t.Fatalf("runtime grants=%q error=%v", grants, err)
	}
}

func TestPrivateReleaseSnapshot_MigrationFreshUpgradeDown(t *testing.T) {
	for _, path := range []string{"fresh", "upgrade"} {
		t.Run(path, func(t *testing.T) {
			pool := multiOrgFreshDB(t)
			if path == "fresh" {
				identityApplyThrough(t, pool, 122)
			} else {
				identityApplyThrough(t, pool, 121)
				multiOrgExec(t, pool, readMigration(t, "000122_private_release_manufacturing_snapshots.up.sql"))
			}
			assertPrivateSnapshotSchema(t, pool)
			multiOrgExec(t, pool, readMigration(t, "000122_private_release_manufacturing_snapshots.down.sql"))
			var absent bool
			if err := pool.QueryRow(context.Background(), `SELECT to_regclass($1) IS NULL
				AND NOT EXISTS (SELECT 1 FROM rls_policy_inventory WHERE table_name=$1)
				AND to_regclass('production_releases') IS NOT NULL`, snapshotTable).Scan(&absent); err != nil || !absent {
				t.Fatalf("down must remove only snapshot foundation: absent=%v err=%v", absent, err)
			}
			multiOrgExec(t, pool, readMigration(t, "000122_private_release_manufacturing_snapshots.up.sql"))
			assertPrivateSnapshotSchema(t, pool)
		})
	}
}

func TestPrivateReleaseSnapshot_OwnerPrivacyAndImmutability(t *testing.T) {
	fx := setupReleaseFixture(t)
	ctx := context.Background()
	var releaseID string
	if err := releaseTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		release, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID: fx.projectID, DesignRevisionID: fx.revR3, ActorUserID: rlsUserA,
		})
		if err == nil {
			releaseID = release.Release.ID
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	// Exercise a populated pre-capture upgrade without fabricating historical facts.
	before := releaseRowJSON(t, fx.admin, releaseID)
	multiOrgExec(t, fx.admin, readMigration(t, "000122_private_release_manufacturing_snapshots.down.sql"))
	multiOrgExec(t, fx.admin, readMigration(t, "000122_private_release_manufacturing_snapshots.up.sql"))
	if after := releaseRowJSON(t, fx.admin, releaseID); after != before {
		t.Fatal("schema upgrade changed an existing release")
	}
	var snapshotCount int
	if err := fx.admin.QueryRow(ctx, `SELECT count(*) FROM production_release_manufacturing_snapshots`).Scan(&snapshotCount); err != nil || snapshotCount != 0 {
		t.Fatalf("upgrade must not backfill snapshots: count=%d err=%v", snapshotCount, err)
	}
	// Seed a valid unrelated tenant, not a denial caused only by missing membership.
	multiOrgExec(t, fx.admin, `INSERT INTO memberships (organization_id, user_id, roles)
		VALUES ('`+rlsOrgC+`', '`+rlsUserB+`', '{admin}');
		UPDATE organizations SET status='active', status_reason=NULL WHERE id='`+rlsOrgC+`'`)
	// Test-only sales sharing setup; restore the ownership trigger atomically.
	// Shared release visibility must never expose private manufacturing costs.
	multiOrgExec(t, fx.admin, `BEGIN; ALTER TABLE projects DISABLE TRIGGER protect_project_organization_ownership;
		UPDATE projects SET sales_organization_id='`+rlsOrgB+`' WHERE id='`+fx.projectID+`';
		ALTER TABLE projects ENABLE TRIGGER protect_project_organization_ownership; COMMIT;`)
	withRLSActor(t, fx.store.Pool, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
		var runtimeSafe bool
		if err := tx.QueryRow(ctx, `SELECT NOT rolsuper AND NOT rolbypassrls
			AND current_user <> pg_get_userbyid(c.relowner) FROM pg_roles, pg_class c
			WHERE rolname=current_user AND c.oid=$1::regclass`, snapshotTable).Scan(&runtimeSafe); err != nil || !runtimeSafe {
			t.Fatalf("unsafe runtime role: safe=%v err=%v", runtimeSafe, err)
		}
		if _, err := tx.Exec(ctx, snapshotInsert, releaseID, fx.projectID, rlsOrgA, 1, `{"privateCost":42}`); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	})
	for _, test := range []struct {
		name, org, user    string
		parents, snapshots int
	}{
		{"owner", rlsOrgA, rlsUserA, 1, 1},
		{"shared sales", rlsOrgB, rlsUserB, 1, 0},
		{"unrelated", rlsOrgC, rlsUserB, 0, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			withRLSActor(t, fx.store.Pool, test.org, test.user, func(tx pgx.Tx) {
				var parents, snapshots int
				if err := tx.QueryRow(ctx, `SELECT
					(SELECT count(*) FROM production_releases WHERE id=$1),
					(SELECT count(*) FROM production_release_manufacturing_snapshots)`, releaseID).
					Scan(&parents, &snapshots); err != nil || parents != test.parents || snapshots != test.snapshots {
					t.Fatalf("parent/snapshot rows=%d/%d want=%d/%d error=%v", parents, snapshots, test.parents, test.snapshots, err)
				}
			})
		})
	}
	for _, test := range []struct {
		name, actor, org, project, release, payload, code string
		version                                           int
	}{
		{"duplicate", rlsOrgA, rlsOrgA, fx.projectID, releaseID, `{}`, "23505", 1},
		{"shared spoofed owner", rlsOrgB, rlsOrgA, fx.projectID, releaseID, `{}`, "42501", 1},
		{"shared cannot insert", rlsOrgB, rlsOrgB, fx.projectID, releaseID, `{}`, "42501", 1},
		{"wrong project", rlsOrgA, rlsOrgA, fiProjectAOnly, releaseID, `{}`, "42501", 1},
		{"missing release", rlsOrgA, rlsOrgA, fx.projectID, fiInstanceAOnly, `{}`, "42501", 1},
		{"invalid schema", rlsOrgA, rlsOrgA, fx.projectID, releaseID, `{}`, "23514", 0},
		{"nonobject payload", rlsOrgA, rlsOrgA, fx.projectID, releaseID, `[]`, "23514", 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			user := rlsUserA
			if test.actor != rlsOrgA {
				user = rlsUserB
			}
			withRLSActor(t, fx.store.Pool, test.actor, user, func(tx pgx.Tx) {
				_, err := tx.Exec(ctx, snapshotInsert, test.release, test.project, test.org, test.version, test.payload)
				assertSnapshotSQLState(t, err, test.code)
			})
		})
	}
	// The composite FK also binds owner and project when a privileged writer bypasses RLS.
	for _, column := range []string{"organization_id", "project_id"} {
		t.Run("privileged mismatched "+column, func(t *testing.T) {
			tx, err := fx.admin.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			var otherRelease string
			err = tx.QueryRow(ctx, `INSERT INTO production_releases
				(organization_id, project_id, release_number, design_revision_id, manufacturing_fingerprint, released_by)
				SELECT organization_id, project_id, release_number+1, design_revision_id, manufacturing_fingerprint, released_by
				FROM production_releases WHERE id=$1 RETURNING id::text`, releaseID).Scan(&otherRelease)
			if err != nil {
				t.Fatal(err)
			}
			org, project := rlsOrgA, fx.projectID
			if column == "organization_id" {
				org = rlsOrgB
			} else {
				project = fiProjectAOnly
			}
			_, err = tx.Exec(ctx, snapshotInsert, otherRelease, project, org, 1, `{}`)
			assertSnapshotSQLState(t, err, "23503")
		})
	}
	for _, verb := range []string{"UPDATE production_release_manufacturing_snapshots SET payload='{}'", "DELETE FROM production_release_manufacturing_snapshots"} {
		t.Run(verb, func(t *testing.T) {
			withRLSActor(t, fx.store.Pool, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
				_, err := tx.Exec(ctx, verb)
				assertSnapshotSQLState(t, err, "42501")
			})
			_, err := fx.admin.Exec(ctx, verb)
			assertSnapshotSQLState(t, err, "P0001")
		})
	}
	var cost, version int
	if err := fx.admin.QueryRow(ctx, `SELECT (payload->>'privateCost')::int, schema_version
		FROM production_release_manufacturing_snapshots WHERE release_id=$1 AND captured_at IS NOT NULL`, releaseID).
		Scan(&cost, &version); err != nil || cost != 42 || version != 1 {
		t.Fatalf("immutable readback cost=%d version=%d err=%v", cost, version, err)
	}
}

func assertSnapshotSQLState(t *testing.T, err error, code string) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != code {
		t.Fatalf("SQL error=%v, want SQLSTATE %s", err, code)
	}
}
