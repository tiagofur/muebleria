package storage_test

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const (
	rlsOrgA    = "10000000-0000-0000-0000-00000000000a"
	rlsOrgB    = "10000000-0000-0000-0000-00000000000b"
	rlsOrgC    = "10000000-0000-0000-0000-00000000000c"
	rlsUserA   = "20000000-0000-0000-0000-00000000000a"
	rlsUserB   = "20000000-0000-0000-0000-00000000000b"
	rlsAppRole = "granete_app_test"
)

type rlsFixture struct {
	admin *pgxpool.Pool
	app   *pgxpool.Pool
	store *storage.PostgresStore
}

func newRLSFixture(t *testing.T) *rlsFixture {
	t.Helper()
	admin := multiOrgFreshDB(t)
	ctx := context.Background()
	migrationStore := &storage.PostgresStore{Pool: admin}
	if err := migrationStore.RunMigrations(ctx); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	for _, statement := range []string{
		`INSERT INTO organizations (id, name, slug, active) VALUES
		 ('` + rlsOrgA + `', 'RLS A', 'rls-a', FALSE),
		 ('` + rlsOrgB + `', 'RLS B', 'rls-b', FALSE),
		 ('` + rlsOrgC + `', 'RLS C', 'rls-c', FALSE)`,
		`INSERT INTO users (id, email, normalized_email, password_hash, name, account_status, platform_admin) VALUES
		 ('` + rlsUserA + `', 'rls-a@example.test', 'rls-a@example.test', 'x', 'RLS A', 'active', TRUE),
		 ('` + rlsUserB + `', 'rls-b@example.test', 'rls-b@example.test', 'x', 'RLS B', 'active', FALSE)`,
		`INSERT INTO memberships (organization_id, user_id, roles) VALUES
		 ('` + rlsOrgA + `', '` + rlsUserA + `', '{admin}'),
		 ('` + rlsOrgB + `', '` + rlsUserB + `', '{admin}')`,
		`INSERT INTO customers (id, name, organization_id) VALUES
		 ('30000000-0000-0000-0000-00000000000a', 'Customer A', '` + rlsOrgA + `'),
		 ('30000000-0000-0000-0000-00000000000b', 'Customer B', '` + rlsOrgB + `')`,
		`INSERT INTO projects (
		 id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id
		) VALUES (
		 '40000000-0000-0000-0000-000000000001', 'Shared A-B',
		 '30000000-0000-0000-0000-00000000000a', 'draft',
			'` + rlsOrgA + `', '` + rlsOrgA + `', '` + rlsOrgB + `'
		)`,
		`INSERT INTO modules (id, code, name, organization_id) VALUES
		 ('50000000-0000-0000-0000-000000000001', 'RLS-MODULE', 'RLS module', '` + rlsOrgA + `')`,
		`INSERT INTO project_items (id, project_id, module_id, quantity, organization_id) VALUES
		 ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 1, '` + rlsOrgA + `')`,
		`INSERT INTO project_level_choices (project_id, option_group_code, choice_entity_id, organization_id) VALUES
		 ('40000000-0000-0000-0000-000000000001', 'RLS', 'choice-a', '` + rlsOrgA + `')`,
		`INSERT INTO project_item_choices (project_item_id, option_group_code, choice_entity_id, organization_id) VALUES
		 ('60000000-0000-0000-0000-000000000001', 'RLS', '70000000-0000-0000-0000-000000000001', '` + rlsOrgA + `')`,
		`INSERT INTO quote_snapshots (id, project_id, captured_at, materials_cost, edge_total, hardware_total, direct_cost, labor_modular, labor_fixed_cost, margin_factor, sale_price, organization_id) VALUES
		 ('80000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', NOW(), 0, 0, 0, 0, 0, 0, 1, 0, '` + rlsOrgA + `')`,
		`INSERT INTO snapshot_prices (snapshot_id, entity_type, entity_id, cost_value, organization_id) VALUES
		 ('80000000-0000-0000-0000-000000000001', 'material', '90000000-0000-0000-0000-000000000001', 0, '` + rlsOrgA + `')`,
		`DROP ROLE IF EXISTS ` + rlsAppRole,
		`CREATE ROLE ` + rlsAppRole + ` LOGIN PASSWORD 'rls-test-password'
		 NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS IN ROLE granete_app`,
	} {
		if _, err := admin.Exec(ctx, statement); err != nil {
			t.Fatalf("seed RLS fixture: %v\n%s", err, statement)
		}
	}

	appURL := rlsDatabaseURL(t)
	appURL.User = url.UserPassword(rlsAppRole, "rls-test-password")
	app, err := pgxpool.New(ctx, appURL.String())
	if err != nil {
		t.Fatalf("connect app role: %v", err)
	}
	if err := app.Ping(ctx); err != nil {
		app.Close()
		t.Fatalf("ping app role: %v", err)
	}
	t.Cleanup(func() {
		app.Close()
		_, _ = admin.Exec(context.Background(), `DROP ROLE IF EXISTS `+rlsAppRole)
	})
	return &rlsFixture{admin: admin, app: app, store: &storage.PostgresStore{Pool: app}}
}

func rlsDatabaseURL(t *testing.T) *url.URL {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable"
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse DATABASE_URL: %v", err)
	}
	u.Path = "/" + multiOrgTestDBName
	return u
}

func setRLSActor(t *testing.T, tx pgx.Tx, organizationID, userID, supportSessionID string) {
	t.Helper()
	if _, err := tx.Exec(context.Background(), `
		SELECT set_config('app.organization_id', $1, true),
		       set_config('app.user_id', $2, true),
		       set_config('app.membership_id', '', true),
		       set_config('app.support_session_id', $3, true),
		       set_config('app.authorized_organization_ids', $1, true)
	`, organizationID, userID, supportSessionID); err != nil {
		t.Fatalf("set RLS actor: %v", err)
	}
}

func withRLSActor(t *testing.T, pool *pgxpool.Pool, organizationID, userID string, run func(pgx.Tx)) {
	t.Helper()
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatalf("begin app tx: %v", err)
	}
	defer tx.Rollback(context.Background())
	setRLSActor(t, tx, organizationID, userID, "")
	run(tx)
}

func TestTenantRLS_DirectSQLBlocksCrossOrganizationCRUDAndUpsert(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()

	for _, test := range []struct {
		name, actorOrg, actorUser, visibleID, victimID string
	}{
		{"A cannot reach B", rlsOrgA, rlsUserA, "30000000-0000-0000-0000-00000000000a", "30000000-0000-0000-0000-00000000000b"},
		{"B cannot reach A", rlsOrgB, rlsUserB, "30000000-0000-0000-0000-00000000000b", "30000000-0000-0000-0000-00000000000a"},
	} {
		t.Run(test.name, func(t *testing.T) {
			withRLSActor(t, fx.app, test.actorOrg, test.actorUser, func(tx pgx.Tx) {
				var ids []string
				rows, err := tx.Query(ctx, `SELECT id::text FROM customers ORDER BY id`)
				if err != nil {
					t.Fatalf("unfiltered select: %v", err)
				}
				for rows.Next() {
					var id string
					_ = rows.Scan(&id)
					ids = append(ids, id)
				}
				rows.Close()
				if len(ids) != 1 || ids[0] != test.visibleID {
					t.Fatalf("unfiltered SELECT leaked rows: %v", ids)
				}

				for operation, sql := range map[string]string{
					"update": `UPDATE customers SET name='attacker' WHERE id='` + test.victimID + `'`,
					"delete": `DELETE FROM customers WHERE id='` + test.victimID + `'`,
				} {
					tag, err := tx.Exec(ctx, sql)
					if err != nil || tag.RowsAffected() != 0 {
						t.Fatalf("cross-org %s affected victim: rows=%d err=%v", operation, tag.RowsAffected(), err)
					}
				}

				_, err = tx.Exec(ctx, `
					INSERT INTO customers (id, name, organization_id)
					VALUES ($1, 'upsert attacker', $2)
					ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
					test.victimID, test.actorOrg)
				if err == nil {
					t.Fatal("cross-org ON CONFLICT must fail rather than mutate victim")
				}
			})
		})
	}

	var names string
	if err := fx.admin.QueryRow(ctx,
		`SELECT string_agg(name, ',' ORDER BY id) FROM customers`).Scan(&names); err != nil {
		t.Fatal(err)
	}
	if names != "Customer A,Customer B" {
		t.Fatalf("victims changed through RLS: %s", names)
	}
}

func TestTenantRLS_SharedProjectSupportPlatformAndOwnershipMatrix(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()

	for _, tc := range []struct {
		name, org, user string
		want            int
	}{
		{"sales sees shared project", rlsOrgA, rlsUserA, 1},
		{"manufacturer sees shared project", rlsOrgB, rlsUserB, 1},
		{"unrelated tenant does not", rlsOrgC, rlsUserA, 0},
		{"org-less platform does not", "", rlsUserA, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			withRLSActor(t, fx.app, tc.org, tc.user, func(tx pgx.Tx) {
				var count int
				if err := tx.QueryRow(ctx, `SELECT count(*) FROM projects`).Scan(&count); err != nil {
					t.Fatal(err)
				}
				if count != tc.want {
					t.Fatalf("shared project count=%d want=%d", count, tc.want)
				}
			})
		})
	}

	withRLSActor(t, fx.app, rlsOrgB, rlsUserB, func(tx pgx.Tx) {
		tag, err := tx.Exec(ctx, `DELETE FROM projects WHERE id='40000000-0000-0000-0000-000000000001'`)
		if err != nil || tag.RowsAffected() != 0 {
			t.Fatalf("manufacturer must not delete shared project: rows=%d err=%v", tag.RowsAffected(), err)
		}
	})
	withRLSActor(t, fx.app, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
		_, err := tx.Exec(ctx, `UPDATE projects SET manufacturing_organization_id=$1 WHERE id='40000000-0000-0000-0000-000000000001'`, rlsOrgC)
		if err == nil || !strings.Contains(err.Error(), "explicit command") {
			t.Fatalf("ownership mutation must be rejected by trigger: %v", err)
		}
	})

	withRLSActor(t, fx.app, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
		_, err := tx.Exec(ctx, `
			INSERT INTO project_items (project_id, module_id, quantity, organization_id)
			VALUES ('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 1, $1)`, rlsOrgC)
		if err == nil {
			t.Fatal("shared child insert attributed to unrelated organization must fail")
		}
	})

	for _, mutation := range []struct {
		name, sql string
	}{
		{"project item", `UPDATE project_items SET organization_id='` + rlsOrgC + `' WHERE id='60000000-0000-0000-0000-000000000001'`},
		{"project level choice", `UPDATE project_level_choices SET organization_id='` + rlsOrgC + `' WHERE project_id='40000000-0000-0000-0000-000000000001'`},
		{"project item choice", `UPDATE project_item_choices SET organization_id='` + rlsOrgC + `' WHERE project_item_id='60000000-0000-0000-0000-000000000001'`},
		{"quote snapshot", `UPDATE quote_snapshots SET organization_id='` + rlsOrgC + `' WHERE id='80000000-0000-0000-0000-000000000001'`},
		{"snapshot price", `UPDATE snapshot_prices SET organization_id='` + rlsOrgC + `' WHERE snapshot_id='80000000-0000-0000-0000-000000000001'`},
	} {
		t.Run("shared child retarget "+mutation.name, func(t *testing.T) {
			withRLSActor(t, fx.app, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
				if _, err := tx.Exec(ctx, mutation.sql); err == nil || !strings.Contains(err.Error(), "explicit command") {
					t.Fatalf("shared child ownership mutation must fail: %v", err)
				}
			})
		})
	}

	var supportSessionID, supportSessionBID string
	if err := fx.admin.QueryRow(ctx, `
		INSERT INTO support_sessions (platform_admin_user_id, organization_id, reason, expires_at)
		VALUES ($1, $2, 'RLS test support', NOW() + INTERVAL '1 hour')
		RETURNING id`, rlsUserA, rlsOrgA).Scan(&supportSessionID); err != nil {
		t.Fatal(err)
	}
	if err := fx.admin.QueryRow(ctx, `
		INSERT INTO support_sessions (platform_admin_user_id, organization_id, reason, expires_at)
		VALUES ($1, $2, 'RLS test support B', NOW() + INTERVAL '1 hour')
		RETURNING id`, rlsUserA, rlsOrgB).Scan(&supportSessionBID); err != nil {
		t.Fatal(err)
	}
	tx, err := fx.app.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	setRLSActor(t, tx, rlsOrgA, rlsUserA, supportSessionID)
	var names []string
	rows, err := tx.Query(ctx, `SELECT name FROM customers ORDER BY name`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var name string
		_ = rows.Scan(&name)
		names = append(names, name)
	}
	rows.Close()
	if fmt.Sprint(names) != "[Customer A]" {
		t.Fatalf("support session leaked another org: %v", names)
	}
	tag, err := tx.Exec(ctx, `UPDATE support_sessions SET ended_at=NOW(), ended_via='logout' WHERE id=$1`, supportSessionBID)
	if err != nil || tag.RowsAffected() != 0 {
		t.Fatalf("support session A mutated session B: rows=%d err=%v", tag.RowsAffected(), err)
	}
	var ended bool
	if err := fx.admin.QueryRow(ctx, `SELECT ended_at IS NOT NULL FROM support_sessions WHERE id=$1`, supportSessionBID).Scan(&ended); err != nil || ended {
		t.Fatalf("support session B changed through A: ended=%v err=%v", ended, err)
	}
}

func TestTenantRLS_PoolReuseRollbackRoleAndInventoryReadiness(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	if err := fx.store.VerifyRLSReadiness(ctx); err != nil {
		t.Fatalf("runtime readiness: %v", err)
	}
	const unsafeOwnerRole = "granete_rls_unsafe_owner_test"
	var originalOwner string
	if err := fx.admin.QueryRow(ctx, `SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'customers'::regclass`).Scan(&originalOwner); err != nil {
		t.Fatal(err)
	}
	_, _ = fx.admin.Exec(ctx, `DROP ROLE IF EXISTS `+unsafeOwnerRole)
	if _, err := fx.admin.Exec(ctx, `CREATE ROLE `+unsafeOwnerRole+` NOLOGIN; GRANT `+unsafeOwnerRole+` TO `+rlsAppRole+`; ALTER TABLE customers OWNER TO `+unsafeOwnerRole); err != nil {
		t.Fatal(err)
	}
	if err := fx.store.VerifyRLSReadiness(ctx); err == nil || !strings.Contains(err.Error(), unsafeOwnerRole) {
		t.Fatalf("readiness accepted inherited protected-table owner: %v", err)
	}
	if _, err := fx.admin.Exec(ctx, `ALTER TABLE customers OWNER TO `+pgx.Identifier{originalOwner}.Sanitize()+`; REVOKE `+unsafeOwnerRole+` FROM `+rlsAppRole+`; DROP ROLE `+unsafeOwnerRole); err != nil {
		t.Fatal(err)
	}

	err := fx.store.WithinTenantTx(ctx, storage.TenantActor{
		OrganizationID: rlsOrgA,
		UserID:         rlsUserA,
	}, func(txCtx context.Context) error {
		customers, err := fx.store.ListCustomers(txCtx)
		if err != nil || len(customers) != 1 || customers[0].Name != "Customer A" {
			return fmt.Errorf("tenant runner list: customers=%v err=%w", customers, err)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	err = fx.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: rlsOrgA, UserID: rlsUserA}, func(txCtx context.Context) error {
		customer := &domain.Customer{Name: "Runner rollback"}
		if err := fx.store.CreateCustomer(txCtx, customer); err != nil {
			return err
		}
		return errors.New("force rollback")
	})
	if err == nil {
		t.Fatal("tenant runner committed a failed callback")
	}
	var runnerRolledBack int
	if err := fx.admin.QueryRow(ctx, `SELECT count(*) FROM customers WHERE name = 'Runner rollback'`).Scan(&runnerRolledBack); err != nil || runnerRolledBack != 0 {
		t.Fatalf("tenant runner rollback persisted row: count=%d err=%v", runnerRolledBack, err)
	}

	var outsideCount int
	if err := fx.app.QueryRow(ctx, `SELECT count(*) FROM customers`).Scan(&outsideCount); err != nil {
		t.Fatal(err)
	}
	if outsideCount != 0 {
		t.Fatalf("pool connection retained tenant context after commit: %d", outsideCount)
	}

	tx, err := fx.app.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	setRLSActor(t, tx, rlsOrgA, rlsUserA, "")
	if _, err := tx.Exec(ctx, `INSERT INTO customers (id, name, organization_id) VALUES ('30000000-0000-0000-0000-0000000000aa', 'Rollback', $1)`, rlsOrgA); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	var rolledBack int
	if err := fx.admin.QueryRow(ctx, `SELECT count(*) FROM customers WHERE name='Rollback'`).Scan(&rolledBack); err != nil || rolledBack != 0 {
		t.Fatalf("rollback persisted tenant row: count=%d err=%v", rolledBack, err)
	}

	conn, err := fx.app.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	defer conn.Exec(context.Background(), `RESET row_security`)
	if _, err := conn.Exec(ctx, `SET row_security = off`); err != nil {
		t.Fatalf("PostgreSQL USERSET compatibility changed: %v", err)
	}
	if _, err := conn.Exec(ctx, `SELECT count(*) FROM customers`); err == nil {
		t.Fatal("row_security=off must fail instead of bypassing FORCE RLS")
	}
}

func TestTenantRLS_CriticalCustomerPlanUsesTenantIndex(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `INSERT INTO customers (name, organization_id) SELECT 'plan-a-' || g, $1::uuid FROM generate_series(1, 5000) g`, rlsOrgA); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.admin.Exec(ctx, `INSERT INTO customers (name, organization_id) SELECT 'plan-b-' || g, $1::uuid FROM generate_series(1, 5000) g`, rlsOrgB); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.admin.Exec(ctx, `ANALYZE customers`); err != nil {
		t.Fatal(err)
	}

	baseline := explainPlan(t, fx.admin, ctx, `SELECT id, name FROM customers WHERE organization_id = $1`, rlsOrgA)
	tx, err := fx.app.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	setRLSActor(t, tx, rlsOrgA, rlsUserA, "")
	rlsPlan := explainPlan(t, tx, ctx, `SELECT id, name FROM customers WHERE organization_id = $1`, rlsOrgA)
	if !strings.Contains(baseline, "idx_customers_organization") || !strings.Contains(rlsPlan, "idx_customers_organization") {
		t.Fatalf("organization index missing from plans\nbaseline:\n%s\nRLS:\n%s", baseline, rlsPlan)
	}
	t.Logf("baseline (explicit scope, owner role):\n%s\nRLS (runtime role):\n%s", baseline, rlsPlan)
}

func TestTenantRLS_DownMigrationIsScopedAndComplete(t *testing.T) {
	admin := multiOrgFreshDB(t)
	ctx := context.Background()
	store := &storage.PostgresStore{Pool: admin}
	if err := store.RunMigrations(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, `
		CREATE TABLE external_rls_sentinel (id integer primary key, owner_name text);
		ALTER TABLE external_rls_sentinel ENABLE ROW LEVEL SECURITY;
		ALTER TABLE external_rls_sentinel FORCE ROW LEVEL SECURITY;
		CREATE POLICY external_policy ON external_rls_sentinel USING (true) WITH CHECK (true)`); err != nil {
		t.Fatal(err)
	}
	downSQL, err := os.ReadFile("../../db/migration/000094_tenant_rls.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, string(downSQL)); err != nil {
		t.Fatal(err)
	}

	var sentinelRLS, sentinelForced bool
	if err := admin.QueryRow(ctx, `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='external_rls_sentinel'::regclass`).Scan(&sentinelRLS, &sentinelForced); err != nil {
		t.Fatal(err)
	}
	if !sentinelRLS || !sentinelForced {
		t.Fatal("down migration changed unrelated RLS table")
	}
	var sentinelPolicies int
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM pg_policies WHERE tablename='external_rls_sentinel' AND policyname='external_policy'`).Scan(&sentinelPolicies); err != nil || sentinelPolicies != 1 {
		t.Fatalf("unrelated policy removed: count=%d err=%v", sentinelPolicies, err)
	}
	var customerRLS bool
	if err := admin.QueryRow(ctx, `SELECT relrowsecurity FROM pg_class WHERE oid='customers'::regclass`).Scan(&customerRLS); err != nil || customerRLS {
		t.Fatalf("customers RLS not reverted: enabled=%v err=%v", customerRLS, err)
	}
	var artifacts int
	if err := admin.QueryRow(ctx, `
		SELECT
			(CASE WHEN to_regclass('rls_policy_inventory') IS NOT NULL THEN 1 ELSE 0 END) +
			(CASE WHEN to_regprocedure('app_has_organization_access(uuid)') IS NOT NULL THEN 1 ELSE 0 END) +
			(SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='api_idempotency_receipts' AND column_name IN ('actor_user_id','organization_id')) +
			(SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN (
				'idx_api_idempotency_receipts_org_actor', 'idx_ambient_categories_organization',
				'idx_board_parts_organization', 'idx_damage_reports_organization',
				'idx_hardware_lines_organization', 'idx_material_categories_organization',
				'idx_module_categories_organization', 'idx_module_components_organization',
				'idx_module_presets_organization', 'idx_option_group_members_organization',
				'idx_production_activities_organization', 'idx_project_internal_messages_organization',
				'idx_project_item_choices_organization', 'idx_project_item_floor_events_organization',
				'idx_project_level_choices_organization', 'idx_project_photos_organization',
				'idx_project_picking_organization', 'idx_project_templates_organization',
				'idx_purchase_order_items_organization', 'idx_quote_snapshots_organization',
				'idx_snapshot_prices_organization', 'idx_structure_components_organization',
				'idx_structure_presets_organization', 'idx_structure_revisions_organization',
				'idx_suppliers_organization', 'idx_warranty_ticket_photos_organization'))
	`).Scan(&artifacts); err != nil || artifacts != 0 {
		t.Fatalf("down migration left #449 artifacts: count=%d err=%v", artifacts, err)
	}
	var runtimeCanRead bool
	if err := admin.QueryRow(ctx, `SELECT has_table_privilege('granete_app', 'customers', 'SELECT')`).Scan(&runtimeCanRead); err != nil || runtimeCanRead {
		t.Fatalf("down migration left runtime grant: can_read=%v err=%v", runtimeCanRead, err)
	}
}

type planQuerier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func explainPlan(t *testing.T, q planQuerier, ctx context.Context, sql string, args ...any) string {
	t.Helper()
	rows, err := q.Query(ctx, "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) "+sql, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var lines []string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		lines = append(lines, line)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return strings.Join(lines, "\n")
}
