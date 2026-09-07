package storage

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestConsistentCatalogTx_SourceView(t *testing.T) {
	store := skipIfNoDB(t)
	ctx := context.Background()
	writer, err := store.Pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Release()
	if _, err := writer.Exec(ctx, `CREATE TABLE tenant_catalog_consistency_test (id int PRIMARY KEY, quantity int);
		INSERT INTO tenant_catalog_consistency_test VALUES (1, 4), (2, 4)`); err != nil {
		t.Fatal(err)
	}
	defer writer.Exec(ctx, `DROP TABLE tenant_catalog_consistency_test`)
	rollback := errors.New("rollback reader")
	for _, tc := range []struct {
		name   string
		marked bool
		want   int
	}{
		{"default observes committed edit", false, 40},
		{"marked retains coherent source", true, 4},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := writer.Exec(ctx, `UPDATE tenant_catalog_consistency_test SET quantity = 4`); err != nil {
				t.Fatal(err)
			}
			input := ctx
			if tc.marked {
				input = WithConsistentCatalogTx(input)
			}
			err := store.WithinTenantTx(input, TenantActor{}, func(txCtx context.Context) error {
				var first, second int
				var pid uint32
				var isolation string
				if err := store.db(txCtx).QueryRow(txCtx, `SELECT pg_backend_pid(), current_setting('transaction_isolation'), quantity
					FROM tenant_catalog_consistency_test WHERE id = 1`).Scan(&pid, &isolation, &first); err != nil {
					return err
				}
				wantIsolation := string(pgx.ReadCommitted)
				if tc.marked {
					wantIsolation = string(pgx.RepeatableRead)
				}
				if pid == writer.Conn().PgConn().PID() || isolation != wantIsolation || first != 4 {
					return fmt.Errorf("reader pid=%d isolation=%s first=%d", pid, isolation, first)
				}
				// Two-connection barrier: first read has completed; this autocommit
				// finishes before the second read starts. No scheduling/timing assumption.
				if _, err := writer.Exec(ctx, `UPDATE tenant_catalog_consistency_test SET quantity = 40`); err != nil {
					return err
				}
				if err := store.db(txCtx).QueryRow(txCtx, `SELECT quantity FROM tenant_catalog_consistency_test WHERE id = 2`).Scan(&second); err != nil {
					return err
				}
				if second != tc.want {
					return fmt.Errorf("second source read=%d, want %d", second, tc.want)
				}
				return rollback
			})
			if !errors.Is(err, rollback) {
				t.Fatal(err)
			}
		})
	}
}

func TestConsistentCatalogTx_BorrowedIsolation(t *testing.T) {
	store := skipIfNoDB(t)
	ctx := context.Background()
	for _, isolation := range []pgx.TxIsoLevel{pgx.ReadUncommitted, pgx.ReadCommitted, pgx.RepeatableRead, pgx.Serializable} {
		t.Run(string(isolation), func(t *testing.T) {
			tx, err := store.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: isolation})
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			if _, err := tx.Exec(ctx, `SELECT 1`); err != nil {
				t.Fatal(err)
			}
			input := WithConsistentCatalogTx(context.WithValue(ctx, transactionContextKey{}, tx))
			called := false
			actor := TenantActor{OrganizationID: InitialOrganizationID}
			err = store.WithinTenantTx(input, actor, func(txCtx context.Context) error {
				called = true
				actual, ok := TenantActorFromCtx(txCtx)
				if !ok || actual.OrganizationID != actor.OrganizationID || transactionFromContext(txCtx) != tx {
					return errors.New("borrowed transaction or actor context replaced")
				}
				return nil
			})
			accepted := isolation == pgx.RepeatableRead || isolation == pgx.Serializable
			if accepted && (err != nil || !called) {
				t.Fatalf("coherent borrowed transaction rejected: called=%v err=%v", called, err)
			}
			if !accepted && (!errors.Is(err, ErrInconsistentCatalogTransaction) || called) {
				t.Fatalf("incoherent transaction not refused before callback: called=%v err=%v", called, err)
			}
			var actual, org string
			if err := tx.QueryRow(ctx, `SELECT current_setting('transaction_isolation'), coalesce(current_setting('app.organization_id', true), '')`).Scan(&actual, &org); err != nil {
				t.Fatalf("borrowed transaction no longer usable: %v", err)
			}
			if actual != string(isolation) || (!accepted && org != "") || (accepted && org != actor.OrganizationID) {
				t.Fatalf("borrowed isolation/actor changed on refusal: isolation=%s org=%s", actual, org)
			}
		})
	}
}

func TestConsistentCatalogTx_CleanupAndOwnership(t *testing.T) {
	store := skipIfNoDB(t)
	ctx := context.Background()
	config := store.Pool.Config()
	config.MaxConns, config.MinConns = 1, 0
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	runner := &PostgresStore{Pool: pool}
	if _, err := pool.Exec(ctx, `CREATE TEMP TABLE tenant_tx_writes (value int)`); err != nil {
		t.Fatal(err)
	}
	rollback := errors.New("rollback callback")
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprintf("rollback=%v", fail), func(t *testing.T) {
			actor := TenantActor{OrganizationID: InitialOrganizationID, UserID: "20000000-0000-0000-0000-00000000000a",
				MembershipID: "30000000-0000-0000-0000-00000000000a", SupportSessionID: "40000000-0000-0000-0000-00000000000a"}
			var insidePID uint32
			err := runner.WithinTenantTx(WithConsistentCatalogTx(ctx), actor, func(txCtx context.Context) error {
				if err := runner.db(txCtx).QueryRow(txCtx, `SELECT pg_backend_pid()`).Scan(&insidePID); err != nil {
					return err
				}
				var settingsOK bool
				if err := runner.db(txCtx).QueryRow(txCtx, `SELECT current_setting('app.organization_id') = $1
					AND current_setting('app.user_id') = $2 AND current_setting('app.membership_id') = $3
					AND current_setting('app.support_session_id') = $4
					AND current_setting('app.authorized_organization_ids') = $1 AND current_setting('row_security') = 'on'`,
					actor.OrganizationID, actor.UserID, actor.MembershipID, actor.SupportSessionID).Scan(&settingsOK); err != nil {
					return err
				}
				if !settingsOK {
					return errors.New("tenant actor settings not installed")
				}
				if _, err := runner.db(txCtx).Exec(txCtx, `INSERT INTO tenant_tx_writes VALUES (1)`); err != nil {
					return err
				}
				if fail {
					return rollback
				}
				return nil
			})
			if (fail && !errors.Is(err, rollback)) || (!fail && err != nil) {
				t.Fatalf("callback outcome: %v", err)
			}
			var outsidePID uint32
			var rows, leaked int
			if err := pool.QueryRow(ctx, `SELECT pg_backend_pid(), (SELECT count(*) FROM tenant_tx_writes),
				(SELECT count(*) FROM unnest(ARRAY['app.organization_id','app.user_id','app.membership_id',
				'app.support_session_id','app.authorized_organization_ids']) key WHERE coalesce(current_setting(key, true), '') <> '')`).Scan(&outsidePID, &rows, &leaked); err != nil {
				t.Fatal(err)
			}
			if insidePID != outsidePID || rows != 1 || leaked != 0 || requiresConsistentCatalog(ctx) {
				t.Fatalf("ownership/cleanup: pid=%d/%d rows=%d leaked=%d", insidePID, outsidePID, rows, leaked)
			}
			if err := runner.WithinTenantTx(ctx, TenantActor{}, func(txCtx context.Context) error {
				var isolation string
				if err := runner.db(txCtx).QueryRow(txCtx, "SHOW transaction_isolation").Scan(&isolation); err != nil {
					return err
				}
				if isolation != string(pgx.ReadCommitted) {
					return fmt.Errorf("isolation leaked to unmarked transaction: %s", isolation)
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestConsistentCatalogTx_ClosedBorrowedTransaction(t *testing.T) {
	store := skipIfNoDB(t)
	ctx := context.Background()
	tx, err := store.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	input := WithConsistentCatalogTx(context.WithValue(ctx, transactionContextKey{}, tx))
	err = store.WithinTenantTx(input, TenantActor{}, func(context.Context) error {
		t.Fatal("callback executed after isolation query failure")
		return nil
	})
	if !errors.Is(err, pgx.ErrTxClosed) {
		t.Fatalf("isolation query failure lost: %v", err)
	}
}
