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
		`INSERT INTO organizations (id, name, slug) VALUES
		 ('` + rlsOrgA + `', 'RLS A', 'rls-a'),
		 ('` + rlsOrgB + `', 'RLS B', 'rls-b'),
		 ('` + rlsOrgC + `', 'RLS C', 'rls-c')`,
		`INSERT INTO users (id, email, password_hash, name, active, platform_admin) VALUES
		 ('` + rlsUserA + `', 'rls-a@example.test', 'x', 'RLS A', TRUE, TRUE),
		 ('` + rlsUserB + `', 'rls-b@example.test', 'x', 'RLS B', TRUE, FALSE)`,
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

	var supportSessionID string
	if err := fx.admin.QueryRow(ctx, `
		INSERT INTO support_sessions (platform_admin_user_id, organization_id, reason, expires_at)
		VALUES ($1, $2, 'RLS test support', NOW() + INTERVAL '1 hour')
		RETURNING id`, rlsUserA, rlsOrgA).Scan(&supportSessionID); err != nil {
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
}

func TestTenantRLS_PoolReuseRollbackRoleAndInventoryReadiness(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	if err := fx.store.VerifyRLSReadiness(ctx); err != nil {
		t.Fatalf("runtime readiness: %v", err)
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
