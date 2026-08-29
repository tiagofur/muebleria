package storage_test

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/db"
)

const (
	identityUserActive   = "a1000000-0000-0000-0000-000000000001"
	identityUserDisabled = "a1000000-0000-0000-0000-000000000002"
	identityOrgA         = "a2000000-0000-0000-0000-000000000001"
	identityOrgB         = "a2000000-0000-0000-0000-000000000002"
)

func identityApplyThrough(t *testing.T, pool *pgxpool.Pool, maxVersion int) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`); err != nil {
		t.Fatalf("create migration ledger: %v", err)
	}
	migrations, err := db.EmbeddedMigrations()
	if err != nil {
		t.Fatalf("embedded migrations: %v", err)
	}
	for _, migration := range migrations {
		if migration.Version > maxVersion {
			continue
		}
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin migration %05d: %v", migration.Version, err)
		}
		if _, err := tx.Exec(ctx, migration.SQL); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatalf("migration %05d_%s: %v", migration.Version, migration.Name, err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("commit migration %05d: %v", migration.Version, err)
		}
	}
}

func identityMigrationSQL(t *testing.T, suffix string) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000095_identity_membership_lifecycle." + suffix + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func identitySeedPreMigration(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	statements := []string{
		`INSERT INTO organizations (id, name, slug) VALUES
		 ('` + identityOrgA + `', 'Identity A', 'identity-a'),
		 ('` + identityOrgB + `', 'Identity B', 'identity-b')`,
		`INSERT INTO users (id, email, password_hash, name, active) VALUES
		 ('` + identityUserActive + `', '  Active.User@Example.Test  ', 'x', 'Active User', TRUE),
		 ('` + identityUserDisabled + `', 'disabled@example.test', 'x', 'Disabled User', FALSE)`,
		`INSERT INTO memberships (id, organization_id, user_id, roles, active, created_at) VALUES
		 ('a3000000-0000-0000-0000-000000000001', '` + identityOrgA + `', '` + identityUserActive + `', '{admin}', TRUE, '2026-01-01T00:00:00Z'),
		 ('a3000000-0000-0000-0000-000000000002', '` + identityOrgB + `', '` + identityUserActive + `', '{vendedor}', FALSE, '2026-02-01T00:00:00Z')`,
		`INSERT INTO invitations (
		 id, organization_id, email, roles, token_hash, expires_at, invited_by,
		 accepted_at, accepted_by, revoked_at, created_at
		) VALUES
		 ('a4000000-0000-0000-0000-000000000001', '` + identityOrgA + `', ' Pending@Example.Test ', '{vendedor}', 'hash-pending', NOW() + interval '2 days', '` + identityUserActive + `', NULL, NULL, NULL, '2026-03-01T00:00:00Z'),
		 ('a4000000-0000-0000-0000-000000000002', '` + identityOrgA + `', 'expired@example.test', '{vendedor}', 'hash-expired', NOW() - interval '2 days', '` + identityUserActive + `', NULL, NULL, NULL, '2026-03-02T00:00:00Z'),
		 ('a4000000-0000-0000-0000-000000000003', '` + identityOrgA + `', 'accepted@example.test', '{vendedor}', 'hash-accepted', NOW() - interval '2 days', '` + identityUserActive + `', '2026-03-03T00:00:00Z', '` + identityUserActive + `', '2026-03-04T00:00:00Z', '2026-03-03T00:00:00Z'),
		 ('a4000000-0000-0000-0000-000000000004', '` + identityOrgA + `', 'revoked@example.test', '{vendedor}', 'hash-revoked', NOW() + interval '2 days', '` + identityUserActive + `', NULL, NULL, '2026-03-04T00:00:00Z', '2026-03-04T00:00:00Z')`,
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("seed pre-000095: %v\n%s", err, statement)
		}
	}
}

func TestIdentityLifecycleMigration_FreshDatabaseSchemaAndRLS(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 95)
	ctx := context.Background()

	var columns string
	if err := pool.QueryRow(ctx, `
		SELECT string_agg(table_name || '.' || column_name, ',' ORDER BY table_name, ordinal_position)
		FROM information_schema.columns
		WHERE table_schema='public'
		  AND (
			(table_name='users' AND column_name IN ('normalized_email','account_status','email_verified_at','last_login_at'))
			OR (table_name='memberships' AND column_name IN ('status','joined_at','suspended_at','suspended_by','suspension_reason','left_at','left_by','leave_reason'))
			OR (table_name='invitations' AND column_name IN ('normalized_email','status','revoked_by','revoked_reason','updated_at'))
		  )`).Scan(&columns); err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		"users.normalized_email", "users.account_status", "users.email_verified_at", "users.last_login_at",
		"memberships.status", "memberships.joined_at", "memberships.suspended_at", "memberships.left_at",
		"invitations.normalized_email", "invitations.status", "invitations.revoked_by", "invitations.updated_at",
	} {
		if !strings.Contains(columns, required) {
			t.Fatalf("fresh schema missing %s: %s", required, columns)
		}
	}

	var rlsMatrix string
	if err := pool.QueryRow(ctx, `
		SELECT string_agg(c.relname || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity, ',' ORDER BY c.relname)
		FROM pg_class c
		WHERE c.oid IN ('invitations'::regclass, 'memberships'::regclass)`).Scan(&rlsMatrix); err != nil {
		t.Fatal(err)
	}
	if rlsMatrix != "invitations:true:true,memberships:true:true" {
		t.Fatalf("fresh lifecycle RLS matrix=%q", rlsMatrix)
	}
	var missingPolicies int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM (VALUES
			('invitations','tenant_isolation'),
			('memberships','membership_read'),
			('memberships','membership_write')
		) expected(table_name, policy_name)
		WHERE NOT EXISTS (
			SELECT 1 FROM pg_policies p
			WHERE p.schemaname='public' AND p.tablename=expected.table_name AND p.policyname=expected.policy_name
		)`).Scan(&missingPolicies); err != nil || missingPolicies != 0 {
		t.Fatalf("fresh lifecycle RLS policies missing=%d err=%v", missingPolicies, err)
	}
}

func TestIdentityLifecycleMigration_UpgradeBackfillsConstraintsAndInventory(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 94)
	identitySeedPreMigration(t, pool)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, identityMigrationSQL(t, "up")); err != nil {
		t.Fatalf("apply 000095: %v", err)
	}

	var email, normalized, accountStatus string
	if err := pool.QueryRow(ctx, `SELECT email, normalized_email, account_status FROM users WHERE id=$1`, identityUserActive).
		Scan(&email, &normalized, &accountStatus); err != nil {
		t.Fatal(err)
	}
	if email != "Active.User@Example.Test" || normalized != "active.user@example.test" || accountStatus != "active" {
		t.Fatalf("unexpected active identity backfill: %q %q %q", email, normalized, accountStatus)
	}
	if err := pool.QueryRow(ctx, `SELECT account_status FROM users WHERE id=$1`, identityUserDisabled).Scan(&accountStatus); err != nil || accountStatus != "disabled" {
		t.Fatalf("disabled identity backfill=%q err=%v", accountStatus, err)
	}

	rows, err := pool.Query(ctx, `SELECT organization_id::text, status, joined_at FROM memberships WHERE user_id=$1 ORDER BY organization_id`, identityUserActive)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var memberships []string
	for rows.Next() {
		var orgID, status string
		var joined time.Time
		if err := rows.Scan(&orgID, &status, &joined); err != nil {
			t.Fatal(err)
		}
		memberships = append(memberships, orgID+":"+status+":"+joined.UTC().Format(time.RFC3339))
	}
	wantMemberships := []string{
		identityOrgA + ":active:2026-01-01T00:00:00Z",
		identityOrgB + ":suspended:2026-02-01T00:00:00Z",
	}
	if strings.Join(memberships, "|") != strings.Join(wantMemberships, "|") {
		t.Fatalf("membership lifecycle backfill=%v want=%v", memberships, wantMemberships)
	}

	var invitationStates string
	if err := pool.QueryRow(ctx, `SELECT string_agg(status, ',' ORDER BY id) FROM invitations WHERE id::text LIKE 'a4000000-%'`).Scan(&invitationStates); err != nil {
		t.Fatal(err)
	}
	if invitationStates != "pending,expired,accepted,revoked" {
		t.Fatalf("invitation precedence=%q", invitationStates)
	}
	if err := pool.QueryRow(ctx, `SELECT normalized_email FROM invitations WHERE token_hash='hash-pending'`).Scan(&normalized); err != nil || normalized != "pending@example.test" {
		t.Fatalf("invitation normalized email=%q err=%v", normalized, err)
	}

	for _, invalid := range []string{
		`UPDATE memberships SET status='active', suspended_at=NOW() WHERE id='a3000000-0000-0000-0000-000000000002'`,
		`UPDATE memberships SET status='left', left_at=NULL WHERE id='a3000000-0000-0000-0000-000000000002'`,
		`UPDATE invitations SET status='revoked', revoked_at=NULL WHERE id='a4000000-0000-0000-0000-000000000001'`,
		`INSERT INTO users (email, normalized_email, password_hash, name, account_status) VALUES ('ACTIVE.USER@example.test', 'active.user@example.test', 'x', 'Duplicate', 'active')`,
		`INSERT INTO users (email, normalized_email, password_hash, name, account_status) VALUES ('mismatch@example.test', 'other@example.test', 'x', 'Mismatch', 'active')`,
		`INSERT INTO invitations (organization_id, email, normalized_email, roles, token_hash, expires_at, status) VALUES ('` + identityOrgA + `', 'pending@example.test', 'pending@example.test', '{vendedor}', 'hash-other', NOW()+interval '1 day', 'pending')`,
		`INSERT INTO invitations (organization_id, email, normalized_email, roles, token_hash, expires_at, status) VALUES ('` + identityOrgA + `', 'invite-mismatch@example.test', 'other-invite@example.test', '{vendedor}', 'hash-mismatch', NOW()+interval '1 day', 'pending')`,
	} {
		if _, err := pool.Exec(ctx, invalid); err == nil {
			t.Fatalf("constraint accepted invalid lifecycle statement: %s", invalid)
		}
	}

	var activeColumns int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name='active' AND table_name IN ('users','memberships')`).Scan(&activeColumns); err != nil || activeColumns != 0 {
		t.Fatalf("legacy lifecycle authorities remain: count=%d err=%v", activeColumns, err)
	}
	var inventory string
	if err := pool.QueryRow(ctx, `SELECT string_agg(table_name || ':' || policy_version, ',' ORDER BY table_name) FROM rls_policy_inventory WHERE table_name IN ('users','memberships','invitations')`).Scan(&inventory); err != nil || inventory != "invitations:2,memberships:2,users:2" {
		t.Fatalf("RLS inventory not reconciled: %q err=%v", inventory, err)
	}
	var orphanCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM identity_orphan_reconciliation_report WHERE user_id=$1`, identityUserDisabled).Scan(&orphanCount); err != nil || orphanCount != 1 {
		t.Fatalf("orphan reconciliation report count=%d err=%v", orphanCount, err)
	}
	var runtimeCanReadReport bool
	if err := pool.QueryRow(ctx, `SELECT has_table_privilege('granete_app', 'identity_orphan_reconciliation_report', 'SELECT')`).Scan(&runtimeCanReadReport); err != nil || runtimeCanReadReport {
		t.Fatalf("runtime can read administrative orphan report=%v err=%v", runtimeCanReadReport, err)
	}
}

func TestIdentityLifecycleMigration_NormalizedEmailCollisionFailsAtomically(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 94)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO users (email,password_hash,name,active) VALUES ('Case@Example.Test','x','One',TRUE), (' case@example.test ','x','Two',FALSE)`); err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, identityMigrationSQL(t, "up"))
	if err == nil || !strings.Contains(err.Error(), "normalized email collisions") {
		t.Fatalf("collision migration error=%v", err)
	}
	_ = tx.Rollback(ctx)
	var newColumns int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns WHERE table_name='users' AND column_name IN ('normalized_email','account_status')`).Scan(&newColumns); err != nil || newColumns != 0 {
		t.Fatalf("failed migration left partial schema: columns=%d err=%v", newColumns, err)
	}
	var users int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE lower(btrim(email))='case@example.test'`).Scan(&users); err != nil || users != 2 {
		t.Fatalf("collision rows were merged/deleted: count=%d err=%v", users, err)
	}
}

func TestIdentityLifecycleMigration_ExactHashLockBoundaryAndRuntimeGrant(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 94)
	identitySeedPreMigration(t, pool)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, identityMigrationSQL(t, "up")); err != nil {
		t.Fatal(err)
	}

	var owner string
	var publicExecute, runtimeExecute bool
	if err := pool.QueryRow(ctx, `SELECT pg_get_userbyid(p.proowner), has_function_privilege('public', p.oid, 'EXECUTE'), has_function_privilege('granete_app', p.oid, 'EXECUTE') FROM pg_proc p WHERE p.oid='lock_open_invitation_by_hash(text)'::regprocedure`).Scan(&owner, &publicExecute, &runtimeExecute); err != nil {
		t.Fatal(err)
	}
	if owner == "granete_app" || publicExecute || !runtimeExecute {
		t.Fatalf("unsafe lock function grants/owner: owner=%s public=%v runtime=%v", owner, publicExecute, runtimeExecute)
	}
	var definition string
	if err := pool.QueryRow(ctx, `SELECT pg_get_functiondef('lock_open_invitation_by_hash(text)'::regprocedure)`).Scan(&definition); err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"SECURITY DEFINER", "SET search_path TO 'pg_catalog', 'public'", "FOR UPDATE OF i"} {
		if !strings.Contains(definition, required) {
			t.Fatalf("lock function missing %q:\n%s", required, definition)
		}
	}
	if strings.Contains(definition, "SELECT i.token_hash") {
		t.Fatalf("lock function exposes token hash:\n%s", definition)
	}

	tx1, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx1.Rollback(ctx)
	var lockedID string
	if err := tx1.QueryRow(ctx, `SELECT id FROM lock_open_invitation_by_hash('hash-pending')`).Scan(&lockedID); err != nil {
		t.Fatal(err)
	}
	if lockedID != "a4000000-0000-0000-0000-000000000001" {
		t.Fatalf("locked wrong invitation: %s", lockedID)
	}
	tx2, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx2.Rollback(ctx)
	if _, err := tx2.Exec(ctx, `SET LOCAL statement_timeout='100ms'`); err != nil {
		t.Fatal(err)
	}
	if err := tx2.QueryRow(ctx, `SELECT id FROM lock_open_invitation_by_hash('hash-pending')`).Scan(&lockedID); err == nil || !strings.Contains(err.Error(), "statement timeout") {
		t.Fatalf("second exact-hash lock was not serialized: %v", err)
	}
	if err := tx1.Rollback(ctx); err != nil && err != pgx.ErrTxClosed {
		t.Fatal(err)
	}
	var misses int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM lock_open_invitation_by_hash('not-a-hash')`).Scan(&misses); err != nil || misses != 0 {
		t.Fatalf("exact hash boundary returned non-match: count=%d err=%v", misses, err)
	}
}

func TestIdentityLifecycleMigration_RollbackRejectsLossAndSafeRoundTrip(t *testing.T) {
	t.Run("safe rollback and reapply", func(t *testing.T) {
		pool := multiOrgFreshDB(t)
		identityApplyThrough(t, pool, 94)
		identitySeedPreMigration(t, pool)
		ctx := context.Background()
		up := identityMigrationSQL(t, "up")
		down := identityMigrationSQL(t, "down")
		if _, err := pool.Exec(ctx, up); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, down); err != nil {
			t.Fatalf("safe rollback: %v", err)
		}
		var active bool
		if err := pool.QueryRow(ctx, `SELECT active FROM users WHERE id=$1`, identityUserActive).Scan(&active); err != nil || !active {
			t.Fatalf("legacy user state not restored: active=%v err=%v", active, err)
		}
		if err := pool.QueryRow(ctx, `SELECT active FROM memberships WHERE id='a3000000-0000-0000-0000-000000000002'`).Scan(&active); err != nil || active {
			t.Fatalf("legacy membership state not restored: active=%v err=%v", active, err)
		}
		if _, err := pool.Exec(ctx, up); err != nil {
			t.Fatalf("reapply after safe rollback: %v", err)
		}
	})

	t.Run("history blocks rollback", func(t *testing.T) {
		pool := multiOrgFreshDB(t)
		identityApplyThrough(t, pool, 94)
		identitySeedPreMigration(t, pool)
		ctx := context.Background()
		if _, err := pool.Exec(ctx, identityMigrationSQL(t, "up")); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE memberships SET status='left', left_at=NOW() WHERE id='a3000000-0000-0000-0000-000000000002'`); err != nil {
			t.Fatal(err)
		}
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		_, err = tx.Exec(ctx, identityMigrationSQL(t, "down"))
		if err == nil || !strings.Contains(err.Error(), "membership lifecycle history") {
			t.Fatalf("lossy rollback was not rejected: %v", err)
		}
		_ = tx.Rollback(ctx)
		var status string
		if err := pool.QueryRow(ctx, `SELECT status FROM memberships WHERE id='a3000000-0000-0000-0000-000000000002'`).Scan(&status); err != nil || status != "left" {
			t.Fatalf("rejected rollback changed schema/data: status=%q err=%v", status, err)
		}
	})
}
