package storage_test

import (
	"context"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/db"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// F169 / #325: the multi-org migrations (000080..000085) must convert an
// existing single-workshop deployment into the initial organization without
// losing or inventing data. This suite builds a throwaway database with the
// legacy schema (migrations <= 000079), seeds representative rows, applies the
// full chain and asserts the backfill; it then replays the .down.sql files to
// prove rollback works.

const (
	multiOrgInitialOrgID = "00000000-0000-0000-0000-000000000001"
	multiOrgTestDBName   = "muebles_multiorg_test"
)

func multiOrgAdminDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable"
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Skipf("cannot parse DATABASE_URL: %v", err)
	}
	u.Path = "/postgres"
	return u.String()
}

func multiOrgExec(t *testing.T, pool *pgxpool.Pool, sql string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql); err != nil {
		t.Fatalf("exec %q: %v", firstLine(sql), err)
	}
}

func firstLine(sql string) string {
	if i := strings.IndexByte(sql, '\n'); i >= 0 {
		return sql[:i]
	}
	return sql
}

// multiOrgFreshDB drops+creates the throwaway database and returns a pool to
// it plus a closer that must run before the drop cleanup.
func multiOrgFreshDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	admin, err := pgxpool.New(context.Background(), multiOrgAdminDSN(t))
	if err != nil {
		t.Skipf("no db: %v", err)
	}
	ctx := context.Background()
	if _, err := admin.Exec(ctx, `DROP DATABASE IF EXISTS `+multiOrgTestDBName+` WITH (FORCE)`); err != nil {
		t.Skipf("drop test db: %v", err)
	}
	if _, err := admin.Exec(ctx, `CREATE DATABASE `+multiOrgTestDBName); err != nil {
		t.Skipf("create test db: %v", err)
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable"
	}
	u, _ := url.Parse(dsn)
	u.Path = "/" + multiOrgTestDBName
	pool, err := pgxpool.New(ctx, u.String())
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	t.Cleanup(func() {
		pool.Close()
		if _, err := admin.Exec(ctx, `DROP DATABASE IF EXISTS `+multiOrgTestDBName+` WITH (FORCE)`); err != nil {
			t.Logf("cleanup drop: %v", err)
		}
		admin.Close()
	})
	return pool
}

// multiOrgApplyLegacySchema applies every embedded migration up to version 79
// (the last pre-multi-org one), recording versions like the real runner.
func multiOrgApplyLegacySchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	multiOrgExec(t, pool, `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name    TEXT NOT NULL,
    applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);`)
	migrations, err := db.EmbeddedMigrations()
	if err != nil {
		t.Fatalf("embedded migrations: %v", err)
	}
	for _, m := range migrations {
		if m.Version > 79 {
			continue
		}
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin legacy %05d: %v", m.Version, err)
		}
		if _, err := tx.Exec(ctx, m.SQL); err != nil {
			tx.Rollback(ctx)
			t.Fatalf("legacy migration %05d_%s: %v", m.Version, m.Name, err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
			m.Version, m.Name); err != nil {
			tx.Rollback(ctx)
			t.Fatalf("record legacy %05d: %v", m.Version, err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("commit legacy %05d: %v", m.Version, err)
		}
	}
}

func multiOrgSeedLegacyRows(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	seed := []string{
		`INSERT INTO users (id, email, password_hash, name, role, active, license_plan, license_expires_at)
		 VALUES ('11111111-1111-1111-1111-111111111111', 'op@multiorg.test', 'x', 'Operario', 'produccion', TRUE, 'trial', NOW() + INTERVAL '30 days')`,
		`INSERT INTO users (id, email, password_hash, name, role, active, license_plan)
		 VALUES ('22222222-2222-2222-2222-222222222222', 'admin@multiorg.test', 'x', 'Admin Viejo', 'admin', TRUE, 'none')`,
		`INSERT INTO customers (id, name) VALUES ('33333333-3333-3333-3333-333333333333', 'Cliente Legado')`,
		`INSERT INTO projects (id, name, customer_id, status)
		 VALUES ('44444444-4444-4444-4444-444444444444', 'Obra Legada', '33333333-3333-3333-3333-333333333333', 'draft')`,
		`INSERT INTO material_boards (id, code, name, width_mm, length_mm, thickness_mm, board_price)
		 VALUES ('55555555-5555-5555-5555-555555555555', 'TAB-MULTIORG', 'Tablero Legado', 1830, 2440, 18, 1500)`,
		`INSERT INTO user_sectors (user_id, sector, sub_sector)
		 VALUES ('11111111-1111-1111-1111-111111111111', 'cutting', '')`,
	}
	for _, s := range seed {
		if _, err := pool.Exec(ctx, s); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
}

func TestMultiOrg_BackfillFromLegacySchema(t *testing.T) {
	pool := multiOrgFreshDB(t)
	multiOrgApplyLegacySchema(t, pool)
	multiOrgSeedLegacyRows(t, pool)

	store := &storage.PostgresStore{Pool: pool}
	ctx := context.Background()
	if err := store.RunMigrations(ctx); err != nil {
		t.Fatalf("RunMigrations (multi-org chain): %v", err)
	}

	// Initial organization exists with the deterministic id and the strongest
	// user license rolled up (trial beats none).
	var name, slug, license string
	err := pool.QueryRow(ctx,
		`SELECT name, slug, license_plan FROM organizations WHERE id = $1`,
		multiOrgInitialOrgID).Scan(&name, &slug, &license)
	if err != nil {
		t.Fatalf("initial org missing after backfill: %v", err)
	}
	if name != "Taller inicial" || slug != "inicial" || license != "trial" {
		t.Fatalf("unexpected initial org: %q %q %q", name, slug, license)
	}

	// Every legacy user keeps role and status in a membership.
	var roles []string
	var membershipStatus string
	err = pool.QueryRow(ctx,
		`SELECT roles, status FROM memberships WHERE user_id = '11111111-1111-1111-1111-111111111111'`).
		Scan(&roles, &membershipStatus)
	if err != nil {
		t.Fatalf("produccion membership missing: %v", err)
	}
	if len(roles) != 1 || roles[0] != "produccion" || membershipStatus != "active" {
		t.Fatalf("unexpected produccion membership: %v %v", roles, membershipStatus)
	}
	err = pool.QueryRow(ctx,
		`SELECT roles FROM memberships WHERE user_id = '22222222-2222-2222-2222-222222222222'`).
		Scan(&roles)
	if err != nil {
		t.Fatalf("admin membership missing: %v", err)
	}
	if len(roles) != 1 || roles[0] != "admin" {
		t.Fatalf("unexpected admin membership: %v", roles)
	}

	// Business + catalog + sector rows are scoped to the initial org.
	for _, q := range []struct {
		sql  string
		what string
	}{
		{`SELECT organization_id FROM projects WHERE id = '44444444-4444-4444-4444-444444444444'`, "projects"},
		{`SELECT organization_id FROM customers WHERE id = '33333333-3333-3333-3333-333333333333'`, "customers"},
		{`SELECT organization_id FROM material_boards WHERE id = '55555555-5555-5555-5555-555555555555'`, "material_boards"},
		{`SELECT ms.organization_id FROM membership_sectors ms JOIN memberships m ON m.id = ms.membership_id WHERE m.user_id = '11111111-1111-1111-1111-111111111111' AND ms.sector = 'cutting'`, "membership_sectors"},
		{`SELECT organization_id FROM workshop_settings WHERE id = 1`, "workshop_settings"},
	} {
		var orgID string
		if err := pool.QueryRow(ctx, q.sql).Scan(&orgID); err != nil {
			t.Fatalf("%s not scoped after backfill: %v", q.what, err)
		}
		if orgID != multiOrgInitialOrgID {
			t.Fatalf("%s scoped to %s, want initial org", q.what, orgID)
		}
	}

	// The conversion itself is auditable.
	var auditCount int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM security_audit_events WHERE event_type = 'organization_created' AND organization_id = $1`,
		multiOrgInitialOrgID).Scan(&auditCount); err != nil || auditCount < 1 {
		t.Fatalf("organization_created audit event missing (count=%d err=%v)", auditCount, err)
	}

	// users.platform_admin defaults to false.
	var platformAdmin bool
	if err := pool.QueryRow(ctx,
		`SELECT platform_admin FROM users WHERE id = '22222222-2222-2222-2222-222222222222'`).Scan(&platformAdmin); err != nil || platformAdmin {
		t.Fatalf("platform_admin should default to false (err=%v)", err)
	}
}

func TestMultiOrg_PerOrgCodesAndSettings(t *testing.T) {
	pool := multiOrgFreshDB(t)
	multiOrgApplyLegacySchema(t, pool)
	multiOrgSeedLegacyRows(t, pool)

	store := &storage.PostgresStore{Pool: pool}
	ctx := context.Background()
	if err := store.RunMigrations(ctx); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	const org2 = "99999999-9999-9999-9999-999999999999"
	if _, err := pool.Exec(ctx,
		`INSERT INTO organizations (id, name, slug, status) VALUES ($1, 'Taller Dos', 'taller-dos', 'provisioning')`, org2); err != nil {
		t.Fatalf("create org 2: %v", err)
	}

	// Same catalog code in another organization is fine.
	if _, err := pool.Exec(ctx,
		`INSERT INTO material_boards (code, name, width_mm, length_mm, thickness_mm, board_price, organization_id)
		 VALUES ('TAB-MULTIORG', 'Mismo codigo otro taller', 1830, 2440, 18, 1600, $1)`, org2); err != nil {
		t.Fatalf("same code in org 2 should be allowed: %v", err)
	}

	// Duplicate code within the same organization is rejected.
	if _, err := pool.Exec(ctx,
		`INSERT INTO material_boards (code, name, width_mm, length_mm, thickness_mm, board_price, organization_id)
		 VALUES ('TAB-MULTIORG', 'Duplicado', 1830, 2440, 18, 1700, $1)`, multiOrgInitialOrgID); err == nil {
		t.Fatalf("duplicate code within org should violate the composite unique")
	}

	// workshop_settings accepts a second row for another org (sequence-backed id).
	if _, err := pool.Exec(ctx,
		`INSERT INTO workshop_settings (organization_id) VALUES ($1)`, org2); err != nil {
		t.Fatalf("workshop_settings row for org 2: %v", err)
	}
	// ...but not two rows for the same org.
	if _, err := pool.Exec(ctx,
		`INSERT INTO workshop_settings (organization_id) VALUES ($1)`, org2); err == nil {
		t.Fatalf("duplicate workshop_settings per org should violate the unique")
	}

	// Membership roles are validated against the canonical set.
	if _, err := pool.Exec(ctx,
		`INSERT INTO memberships (organization_id, user_id, roles)
		 VALUES ($1, '22222222-2222-2222-2222-222222222222', ARRAY['bogus'])`, org2); err == nil {
		t.Fatalf("bogus membership role should violate the check")
	}
	// Multi-role memberships are the supported shape for small workshops.
	if _, err := pool.Exec(ctx,
		`INSERT INTO memberships (organization_id, user_id, roles)
		 VALUES ($1, '22222222-2222-2222-2222-222222222222', ARRAY['vendedor','ingeniero'])`, org2); err != nil {
		t.Fatalf("multi-role membership should be allowed: %v", err)
	}
}

func TestMultiOrg_DownMigrationsRollBack(t *testing.T) {
	pool := multiOrgFreshDB(t)
	multiOrgApplyLegacySchema(t, pool)
	multiOrgSeedLegacyRows(t, pool)

	store := &storage.PostgresStore{Pool: pool}
	ctx := context.Background()
	if err := store.RunMigrations(ctx); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	// Replays every multi-org .down.sql in reverse order.
	dir := "../../db/migration"
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read migration dir: %v", err)
	}
	versions := []int{}
	byVersion := map[int]string{}
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".down.sql") {
			continue
		}
		v, err := strconv.Atoi(strings.SplitN(name, "_", 2)[0])
		if err != nil {
			continue
		}
		if v < 80 {
			continue
		}
		versions = append(versions, v)
		byVersion[v] = filepath.Join(dir, name)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(versions)))

	for _, v := range versions {
		sqlBytes, err := os.ReadFile(byVersion[v])
		if err != nil {
			t.Fatalf("read down %05d: %v", v, err)
		}
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin down %05d: %v", v, err)
		}
		if _, err := tx.Exec(ctx, string(sqlBytes)); err != nil {
			tx.Rollback(ctx)
			t.Fatalf("down %05d: %v", v, err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM schema_migrations WHERE version = $1`, v); err != nil {
			tx.Rollback(ctx)
			t.Fatalf("unrecord %05d: %v", v, err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("commit down %05d: %v", v, err)
		}
	}

	// The multi-org objects are gone; legacy tables keep their data.
	var regClass *string
	if err := pool.QueryRow(ctx, `SELECT to_regclass('organizations')`).Scan(&regClass); err != nil {
		t.Fatalf("to_regclass: %v", err)
	}
	if regClass != nil {
		t.Fatalf("organizations table should be gone after rollback")
	}
	var colCount int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM information_schema.columns
		WHERE table_name = 'users' AND column_name = 'platform_admin'`).Scan(&colCount); err != nil {
		t.Fatalf("columns check: %v", err)
	}
	if colCount != 0 {
		t.Fatalf("users.platform_admin should be gone after rollback")
	}
	var boards int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM material_boards WHERE code = 'TAB-MULTIORG'`).Scan(&boards); err != nil || boards != 1 {
		t.Fatalf("legacy catalog row lost during rollback (boards=%d err=%v)", boards, err)
	}

	// The structural 000090 rollback restores legacy role with a safe default,
	// not the historical role. Restore the fixture's exact roles so replay can
	// satisfy both the active-admin and membership-sector invariants.
	if _, err := pool.Exec(ctx, `UPDATE users SET role=CASE id
		WHEN '11111111-1111-1111-1111-111111111111' THEN 'produccion'
		WHEN '22222222-2222-2222-2222-222222222222' THEN 'admin'
		ELSE role END
		WHERE id IN ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222')`); err != nil {
		t.Fatalf("restore legacy role fixtures for replay: %v", err)
	}
	// Re-applying the chain after a rollback must work (idempotent lifecycle).
	if err := store.RunMigrations(ctx); err != nil {
		t.Fatalf("re-apply after rollback: %v", err)
	}
}

func TestMultiOrg_FreshDatabaseGetsInitialOrg(t *testing.T) {
	pool := multiOrgFreshDB(t)
	store := &storage.PostgresStore{Pool: pool}
	ctx := context.Background()
	if err := store.RunMigrations(ctx); err != nil {
		t.Fatalf("RunMigrations on fresh db: %v", err)
	}
	// A brand-new deployment (no users yet) still gets the initial org, so the
	// first platform admin can be created into it.
	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM organizations WHERE id = $1`, multiOrgInitialOrgID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("fresh db should have the initial org (count=%d err=%v)", count, err)
	}
}
