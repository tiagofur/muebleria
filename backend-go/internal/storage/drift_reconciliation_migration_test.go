package storage_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/db"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Applied migrations never rerun, so a database that applied an intermediate
// version of a migration file keeps whatever that intermediate version
// created forever — even after the file's final commit. The reconciliation
// migrations (reassert_/reconcile_ prefix) converge those databases. These
// tests replay each known drift on a throwaway database and prove
// RunMigrations restores the canonical end state.

// isReconciliation reports whether a migration exists only to converge
// drifted upgrades; tests defer exactly these so RunMigrations has them
// pending against a pre-drift database.
func isReconciliation(m db.Migration) bool {
	return strings.HasPrefix(m.Name, "reassert_") || strings.HasPrefix(m.Name, "reconcile_")
}

// applyUpToReconciliations applies and records every non-reconciliation
// migration in order, like the real runner.
func applyUpToReconciliations(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			name    TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`); err != nil {
		t.Fatalf("create migration ledger: %v", err)
	}
	migrations, err := db.EmbeddedMigrations()
	if err != nil {
		t.Fatalf("embedded migrations: %v", err)
	}
	for _, m := range migrations {
		if isReconciliation(m) {
			continue
		}
		applyRecordedMigration(t, pool, m)
	}
}

// A database that applied an intermediate 000110 keeps the older
// security_audit_insert policy: platform commands that must write
// organization audit rows fail RLS and roll back with 500.
func TestSecurityAuditInsertPolicyReconciliation(t *testing.T) {
	pool := multiOrgFreshDB(t)
	ctx := context.Background()
	applyUpToReconciliations(t, pool)

	const wantPolicy = "app_current_user_is_platform_admin"
	reconciliation := requireReconciliation(t, pool, "reassert_security_audit_insert")

	// Replay the drift: the pre-platform-admin policy an intermediate 000110
	// left behind on upgraded databases.
	if _, err := pool.Exec(ctx, `
		DROP POLICY security_audit_insert ON security_audit_events;
		CREATE POLICY security_audit_insert ON security_audit_events FOR INSERT
			WITH CHECK (
				actor_user_id IS NOT DISTINCT FROM app_current_user_id()
				AND (
					organization_id IS NULL
					OR app_has_organization_access(organization_id)
				)
			);`); err != nil {
		t.Fatalf("seed drifted policy: %v", err)
	}

	runMigrations(t, pool)

	var withCheck string
	if err := pool.QueryRow(ctx, `
		SELECT pg_get_expr(polwithcheck, polrelid)
		FROM pg_policy
		WHERE polname = 'security_audit_insert'`).Scan(&withCheck); err != nil {
		t.Fatalf("read security_audit_insert policy: %v", err)
	}
	if !strings.Contains(withCheck, wantPolicy) {
		t.Fatalf("security_audit_insert with_check=%q, want platform-admin branch", withCheck)
	}
	assertReconciliationRecorded(t, pool, ctx, reconciliation)
}

// A database that applied an intermediate 000113/000115 misses the design
// working-copy tables and the quote-revision immutability backstops: creating
// a design fails with 500 and quote revision immutability is unenforced.
func TestDigitalThreadDriftReconciliation(t *testing.T) {
	pool := multiOrgFreshDB(t)
	ctx := context.Background()
	applyUpToReconciliations(t, pool)

	reconciliation := requireReconciliation(t, pool, "reconcile_digital_thread_drift")

	// Replay the drift: drop the objects the intermediate migrations never
	// created, in dependency order.
	for _, statement := range []string{
		`DROP TRIGGER IF EXISTS protect_quote_revisions_immutable ON quote_revisions`,
		`DROP TRIGGER IF EXISTS protect_quote_revision_items_immutable ON quote_revision_items`,
		`DROP FUNCTION IF EXISTS protect_quote_revision_item_immutability()`,
		`DROP TABLE IF EXISTS design_working_items CASCADE`,
		`DROP TABLE IF EXISTS design_working_copies CASCADE`,
	} {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("seed drift (%s): %v", statement, err)
		}
	}

	runMigrations(t, pool)

	for _, table := range []string{"design_working_copies", "design_working_items"} {
		var exists *string
		if err := pool.QueryRow(ctx, `SELECT to_regclass($1)`, "public."+table).Scan(&exists); err != nil {
			t.Fatalf("check table %s: %v", table, err)
		}
		if exists == nil {
			t.Errorf("table %s missing after reconciliation", table)
		}
	}

	var policies int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM pg_policy
		WHERE polname IN (
            'design_working_copies_read', 'design_working_copies_insert', 'design_working_copies_update',
            'design_working_items_read', 'design_working_items_insert', 'design_working_items_update', 'design_working_items_delete'
        )`).Scan(&policies); err != nil {
		t.Fatalf("count reconciled policies: %v", err)
	}
	if policies != 7 {
		t.Errorf("design working-copy policies after reconciliation = %d, want 7", policies)
	}

	var triggers int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM pg_trigger t
		JOIN pg_class c ON c.oid = t.tgrelid
		WHERE c.relname IN ('design_working_copies', 'quote_revisions', 'quote_revision_items')
          AND t.tgname IN ('protect_shared_child_ownership_working_copies', 'protect_quote_revisions_immutable', 'protect_quote_revision_items_immutable')`).Scan(&triggers); err != nil {
		t.Fatalf("count reconciled triggers: %v", err)
	}
	if triggers != 3 {
		t.Errorf("immutability/ownership triggers after reconciliation = %d, want 3", triggers)
	}

	var itemFn bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'protect_quote_revision_item_immutability')`).Scan(&itemFn); err != nil {
		t.Fatalf("check item immutability function: %v", err)
	}
	if !itemFn {
		t.Error("protect_quote_revision_item_immutability missing after reconciliation")
	}

	assertReconciliationRecorded(t, pool, ctx, reconciliation)
}

// A database that applied an intermediate 000124 misses the pairing-grant
// provenance column: issuing a SketchUp pairing grant fails with 500 because
// the INSERT references created_by_session_id, which does not exist.
func TestDesignPairingGrantDriftReconciliation(t *testing.T) {
	pool := multiOrgFreshDB(t)
	ctx := context.Background()
	applyUpToReconciliations(t, pool)

	reconciliation := requireReconciliation(t, pool, "reconcile_digital_thread_drift")

	// Replay the drift: the provenance column the intermediate 000124 never
	// created (CASCADE also removes its foreign key).
	if _, err := pool.Exec(ctx,
		`ALTER TABLE design_pairing_grants DROP COLUMN IF EXISTS created_by_session_id CASCADE`); err != nil {
		t.Fatalf("seed drift: %v", err)
	}

	runMigrations(t, pool)

	var nullable string
	if err := pool.QueryRow(ctx, `
		SELECT is_nullable FROM information_schema.columns
		WHERE table_name = 'design_pairing_grants' AND column_name = 'created_by_session_id'`).Scan(&nullable); err != nil {
		t.Fatalf("check created_by_session_id column: %v", err)
	}
	if nullable != "NO" {
		t.Errorf("created_by_session_id is_nullable=%q, want NO", nullable)
	}

	var fk bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM pg_constraint
			WHERE conname = 'design_pairing_grants_created_by_session_id_fkey'
              AND conrelid = 'design_pairing_grants'::regclass
		)`).Scan(&fk); err != nil {
		t.Fatalf("check provenance foreign key: %v", err)
	}
	if !fk {
		t.Error("created_by_session_id foreign key missing after reconciliation")
	}

	assertReconciliationRecorded(t, pool, ctx, reconciliation)
}

// A database that applied intermediate versions of the identity registry
// migrations (000105/000106/000109) misses the session scope-shape and
// membership-coherence constraints, and keeps MFA factor shape checks that
// forbid the normal enabled→revoked lifecycle. The digital-thread shape drift
// (000113) left design_revision_items.definition_version as text and the
// design_revisions source_type check without 'manual'.
func TestIdentityRegistryDriftReconciliation(t *testing.T) {
	pool := multiOrgFreshDB(t)
	ctx := context.Background()
	applyUpToReconciliations(t, pool)

	reconciliation := requireReconciliation(t, pool, "reconcile_digital_thread_drift")

	for _, statement := range []string{
		// Intermediate 000105 shape. The composite FKs are dropped first: on a
		// drifted database they never existed, and on the fresh fixture they
		// depend on the unique keys being reverted below.
		`ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_scope_shape`,
		`ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_membership_user_fk`,
		`ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_membership_organization_fk`,
		`ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_active_organization_id_fkey`,
		`ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_active_organization_id_fkey FOREIGN KEY (active_organization_id) REFERENCES organizations(id) ON DELETE SET NULL`,
		`ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE SET NULL`,
		// Intermediate 000106 shape.
		`ALTER TABLE auth_refresh_families DROP CONSTRAINT auth_refresh_family_membership_user_fk`,
		`ALTER TABLE auth_refresh_families DROP CONSTRAINT auth_refresh_family_membership_organization_fk`,
		`ALTER TABLE memberships DROP CONSTRAINT memberships_id_user_key`,
		// Intermediate 000109 shape.
		`ALTER TABLE auth_mfa_factors DROP CONSTRAINT auth_mfa_factor_enabled_shape`,
		`ALTER TABLE auth_mfa_factors DROP CONSTRAINT auth_mfa_factor_pending_shape`,
		`ALTER TABLE auth_mfa_factors ADD CONSTRAINT auth_mfa_factor_enabled_shape CHECK ((status = 'enabled') = (enabled_at IS NOT NULL))`,
		// Intermediate 000113 shape.
		`ALTER TABLE design_revision_items ALTER COLUMN definition_version TYPE TEXT USING definition_version::text`,
		`ALTER TABLE design_revisions DROP CONSTRAINT design_revisions_source_type_check`,
		`ALTER TABLE design_revisions ADD CONSTRAINT design_revisions_source_type_check CHECK (source_type IN ('sketchup', 'proyectar', 'import', 'system'))`,
	} {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("seed drift (%s): %v", statement, err)
		}
	}

	runMigrations(t, pool)

	for _, constraint := range []string{
		"memberships_id_user_key",
		"auth_sessions_scope_shape",
		"auth_sessions_membership_user_fk",
		"auth_sessions_membership_organization_fk",
		"auth_refresh_family_membership_user_fk",
		"auth_refresh_family_membership_organization_fk",
		"auth_mfa_factor_enabled_shape",
		"auth_mfa_factor_pending_shape",
	} {
		assertConstraintExists(t, pool, ctx, constraint)
	}

	assertConstraintMissing(t, pool, ctx, "auth_sessions_membership_id_fkey")

	var activeOrgFK string
	if err := pool.QueryRow(ctx, `
		SELECT pg_get_constraintdef(oid) FROM pg_constraint
		WHERE conname = 'auth_sessions_active_organization_id_fkey'`).Scan(&activeOrgFK); err != nil {
		t.Fatalf("read active_organization FK: %v", err)
	}
	if strings.Contains(activeOrgFK, "SET NULL") {
		t.Errorf("active_organization FK=%q, want no ON DELETE SET NULL", activeOrgFK)
	}

	var dataType string
	if err := pool.QueryRow(ctx, `
		SELECT data_type FROM information_schema.columns
		WHERE table_name = 'design_revision_items' AND column_name = 'definition_version'`).Scan(&dataType); err != nil {
		t.Fatalf("read definition_version type: %v", err)
	}
	if dataType != "integer" {
		t.Errorf("definition_version data_type=%q, want integer", dataType)
	}

	var sourceCheck string
	if err := pool.QueryRow(ctx, `
		SELECT pg_get_constraintdef(oid) FROM pg_constraint
		WHERE conname = 'design_revisions_source_type_check'`).Scan(&sourceCheck); err != nil {
		t.Fatalf("read source_type check: %v", err)
	}
	if !strings.Contains(sourceCheck, "manual") {
		t.Errorf("design_revisions source_type check=%q, want 'manual' allowed", sourceCheck)
	}

	assertReconciliationRecorded(t, pool, ctx, reconciliation)
}

func assertConstraintExists(t *testing.T, pool *pgxpool.Pool, ctx context.Context, name string) {
	t.Helper()
	var exists bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = $1)`, name).Scan(&exists); err != nil {
		t.Fatalf("check constraint %s: %v", name, err)
	}
	if !exists {
		t.Errorf("constraint %s missing after reconciliation", name)
	}
}

func assertConstraintMissing(t *testing.T, pool *pgxpool.Pool, ctx context.Context, name string) {
	t.Helper()
	var exists bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = $1)`, name).Scan(&exists); err != nil {
		t.Fatalf("check constraint %s: %v", name, err)
	}
	if exists {
		t.Errorf("constraint %s should have been removed by reconciliation", name)
	}
}

func runMigrations(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	store := &storage.PostgresStore{Pool: pool}
	if err := store.RunMigrations(context.Background()); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
}

func requireReconciliation(t *testing.T, pool *pgxpool.Pool, namePart string) db.Migration {
	t.Helper()
	migrations, err := db.EmbeddedMigrations()
	if err != nil {
		t.Fatalf("embedded migrations: %v", err)
	}
	for _, m := range migrations {
		if isReconciliation(m) && strings.Contains(m.Name, namePart) {
			return m
		}
	}
	t.Fatalf("reconciliation migration containing %q not found", namePart)
	return db.Migration{}
}

func assertReconciliationRecorded(t *testing.T, pool *pgxpool.Pool, ctx context.Context, m db.Migration) {
	t.Helper()
	var recorded int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM schema_migrations WHERE version=$1`, m.Version).Scan(&recorded); err != nil {
		t.Fatalf("read migration ledger: %v", err)
	}
	if recorded != 1 {
		t.Fatalf("reconciliation migration %d recorded %d times, want 1", m.Version, recorded)
	}
}

func applyRecordedMigration(t *testing.T, pool *pgxpool.Pool, m db.Migration) {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin migration %05d: %v", m.Version, err)
	}
	if _, err := tx.Exec(ctx, m.SQL); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("migration %05d_%s: %v", m.Version, m.Name, err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`, m.Version, m.Name); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("record migration %05d: %v", m.Version, err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit migration %05d: %v", m.Version, err)
	}
}
