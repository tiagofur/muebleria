package storage_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

const (
	sectorRaceOrganization = "d9000000-0000-0000-0000-000000000001"
	sectorRaceUser         = "d9000000-0000-0000-0000-000000000002"
	sectorRaceMembership   = "d9000000-0000-0000-0000-000000000003"
)

func newMembershipSectorRaceFixture(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := multiOrgFreshDB(t)
	store := &storage.PostgresStore{Pool: pool}
	ctx := context.Background()
	if err := store.RunMigrations(ctx); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations (id,name,slug,type,active) VALUES ($1,'Sector race','sector-race','factory',FALSE)`, []any{sectorRaceOrganization}},
		{`INSERT INTO users (id,email,normalized_email,password_hash,name,account_status) VALUES ($1,'sector-race@example.test','sector-race@example.test','x','Sector Race','active')`, []any{sectorRaceUser}},
		{`INSERT INTO memberships (id,organization_id,user_id,roles,status,joined_at) VALUES ($1,$2,$3,'{produccion}','active',NOW())`, []any{sectorRaceMembership, sectorRaceOrganization, sectorRaceUser}},
	} {
		if _, err := pool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	return pool
}

func TestMembershipSectorCompatibility_RoleChangeAndSectorInsertSerialize(t *testing.T) {
	t.Run("role change commits first", func(t *testing.T) {
		pool := newMembershipSectorRaceFixture(t)
		ctx := context.Background()
		holder, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer holder.Rollback(ctx)
		lockSectorRaceOrganization(t, holder)
		if _, err := holder.Exec(ctx, `UPDATE memberships SET roles='{admin}' WHERE id=$1`, sectorRaceMembership); err != nil {
			t.Fatal(err)
		}

		result := runSectorRaceMutation(t, pool, "sector-race-insert-after-role", `
			INSERT INTO membership_sectors (membership_id,organization_id,sector)
			VALUES ($1,$2,'cutting')`, sectorRaceMembership, sectorRaceOrganization)
		waitForAdvisoryBlock(t, pool, "sector-race-insert-after-role")
		if err := holder.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		assertRaceConstraint(t, awaitSectorRaceResult(t, result), "membership_sector_compatibility")
		assertFinalSectorCompatibility(t, pool, "admin", 0)
	})

	t.Run("sector insert commits first", func(t *testing.T) {
		pool := newMembershipSectorRaceFixture(t)
		ctx := context.Background()
		holder, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer holder.Rollback(ctx)
		if _, err := holder.Exec(ctx, `
			INSERT INTO membership_sectors (membership_id,organization_id,sector)
			VALUES ($1,$2,'cutting')`, sectorRaceMembership, sectorRaceOrganization); err != nil {
			t.Fatal(err)
		}

		result := runSectorRaceMutation(t, pool, "sector-race-role-after-insert",
			`UPDATE memberships SET roles='{admin}' WHERE id=$1`, sectorRaceMembership)
		waitForAdvisoryBlock(t, pool, "sector-race-role-after-insert")
		if err := holder.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		assertRaceConstraint(t, awaitSectorRaceResult(t, result), "membership_sector_set_compatibility")
		assertFinalSectorCompatibility(t, pool, "produccion", 1)
	})
}

func TestMembershipSectorCompatibility_OrganizationTypeAndSectorInsertSerialize(t *testing.T) {
	t.Run("organization type commits first", func(t *testing.T) {
		pool := newMembershipSectorRaceFixture(t)
		ctx := context.Background()
		holder, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer holder.Rollback(ctx)
		lockSectorRaceOrganization(t, holder)
		if _, err := holder.Exec(ctx, `UPDATE organizations SET type='store' WHERE id=$1`, sectorRaceOrganization); err != nil {
			t.Fatal(err)
		}

		result := runSectorRaceMutation(t, pool, "sector-race-insert-after-type", `
			INSERT INTO membership_sectors (membership_id,organization_id,sector)
			VALUES ($1,$2,'cutting')`, sectorRaceMembership, sectorRaceOrganization)
		waitForAdvisoryBlock(t, pool, "sector-race-insert-after-type")
		if err := holder.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		assertRaceConstraint(t, awaitSectorRaceResult(t, result), "membership_sector_compatibility")
		assertFinalOrganizationSectorCompatibility(t, pool, "store", 0)
	})

	t.Run("sector insert commits first", func(t *testing.T) {
		pool := newMembershipSectorRaceFixture(t)
		ctx := context.Background()
		holder, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer holder.Rollback(ctx)
		if _, err := holder.Exec(ctx, `
			INSERT INTO membership_sectors (membership_id,organization_id,sector)
			VALUES ($1,$2,'cutting')`, sectorRaceMembership, sectorRaceOrganization); err != nil {
			t.Fatal(err)
		}

		result := runSectorRaceMutation(t, pool, "sector-race-type-after-insert",
			`UPDATE organizations SET type='store' WHERE id=$1`, sectorRaceOrganization)
		waitForAdvisoryBlock(t, pool, "sector-race-type-after-insert")
		if err := holder.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		assertRaceConstraint(t, awaitSectorRaceResult(t, result), "membership_sector_set_compatibility")
		assertFinalOrganizationSectorCompatibility(t, pool, "factory", 1)
	})
}

func lockSectorRaceOrganization(t *testing.T, tx pgx.Tx) {
	t.Helper()
	if _, err := tx.Exec(context.Background(), `
		SELECT pg_advisory_xact_lock(hashtextextended(
			'granete:membership-sector:organization:' || $1::uuid::text,
			0
		))`, sectorRaceOrganization); err != nil {
		t.Fatal(err)
	}
}

func runSectorRaceMutation(t *testing.T, pool *pgxpool.Pool, applicationName, query string, args ...any) <-chan error {
	t.Helper()
	result := make(chan error, 1)
	go func() {
		ctx := context.Background()
		tx, err := pool.Begin(ctx)
		if err != nil {
			result <- err
			return
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `SELECT set_config('application_name',$1,true)`, applicationName); err != nil {
			result <- err
			return
		}
		if _, err := tx.Exec(ctx, query, args...); err != nil {
			result <- err
			return
		}
		result <- tx.Commit(ctx)
	}()
	return result
}

func waitForAdvisoryBlock(t *testing.T, pool *pgxpool.Pool, applicationName string) {
	t.Helper()
	ctx := context.Background()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var blocked bool
		err := pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM pg_stat_activity
				WHERE application_name=$1
				  AND wait_event_type='Lock'
				  AND wait_event='advisory'
			)`, applicationName).Scan(&blocked)
		if err != nil {
			t.Fatal(err)
		}
		if blocked {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("mutation %s never waited on the compatibility advisory lock", applicationName)
}

func awaitSectorRaceResult(t *testing.T, result <-chan error) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-time.After(3 * time.Second):
		t.Fatal("concurrent compatibility mutation deadlocked")
		return nil
	}
}

func assertRaceConstraint(t *testing.T, err error, constraint string) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" || pgErr.ConstraintName != constraint {
		t.Fatalf("constraint=%s error=%v", constraint, err)
	}
}

func assertFinalSectorCompatibility(t *testing.T, pool *pgxpool.Pool, role string, sectors int) {
	t.Helper()
	var gotRole string
	var gotSectors int
	if err := pool.QueryRow(context.Background(), `
		SELECT m.roles[1], count(ms.*)
		FROM memberships m
		LEFT JOIN membership_sectors ms ON ms.membership_id=m.id
		WHERE m.id=$1
		GROUP BY m.roles`, sectorRaceMembership).Scan(&gotRole, &gotSectors); err != nil {
		t.Fatal(err)
	}
	if gotRole != role || gotSectors != sectors {
		t.Fatalf("incompatible final state role=%s sectors=%d, want role=%s sectors=%d", gotRole, gotSectors, role, sectors)
	}
}

func assertFinalOrganizationSectorCompatibility(t *testing.T, pool *pgxpool.Pool, organizationType string, sectors int) {
	t.Helper()
	var gotType string
	var gotSectors int
	if err := pool.QueryRow(context.Background(), `
		SELECT o.type, count(ms.*)
		FROM organizations o
		LEFT JOIN membership_sectors ms ON ms.organization_id=o.id
		WHERE o.id=$1
		GROUP BY o.type`, sectorRaceOrganization).Scan(&gotType, &gotSectors); err != nil {
		t.Fatal(err)
	}
	if gotType != organizationType || gotSectors != sectors {
		t.Fatalf("incompatible final state type=%s sectors=%d, want type=%s sectors=%d", gotType, gotSectors, organizationType, sectors)
	}
}

func TestMembershipSectorRaceLockingMigration_DownRestoresPreviousGate(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 99)
	ctx := context.Background()
	down, err := osReadMigration("../../db/migration/000099_membership_sector_race_locking.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, down); err != nil {
		t.Fatal(err)
	}
	var lockFunctionExists bool
	if err := pool.QueryRow(ctx, `SELECT to_regprocedure('lock_membership_sector_keys(text,uuid,uuid)') IS NOT NULL`).Scan(&lockFunctionExists); err != nil || lockFunctionExists {
		t.Fatalf("down left locking function=%v err=%v", lockFunctionExists, err)
	}
	var triggerFunctionExists bool
	if err := pool.QueryRow(ctx, `SELECT to_regprocedure('enforce_membership_sector_compatibility()') IS NOT NULL`).Scan(&triggerFunctionExists); err != nil || !triggerFunctionExists {
		t.Fatalf("down removed 000098 semantic gate=%v err=%v", triggerFunctionExists, err)
	}
}

func osReadMigration(path string) (string, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read migration: %w", err)
	}
	return string(contents), nil
}
