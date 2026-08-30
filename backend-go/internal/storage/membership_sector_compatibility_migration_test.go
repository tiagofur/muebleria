package storage_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	sectorProductionUser       = "d1000000-0000-0000-0000-000000000001"
	sectorProductionMembership = "d2000000-0000-0000-0000-000000000001"
	sectorWarehouseUser        = "d1000000-0000-0000-0000-000000000002"
	sectorWarehouseMembership  = "d2000000-0000-0000-0000-000000000002"
)

func membershipSectorCompatibilityMigrationSQL(t *testing.T, suffix string) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000098_membership_sector_compatibility." + suffix + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func TestMembershipSectorCompatibilityMigration_FreshSchemaInstallsEveryGate(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 98)
	ctx := context.Background()

	var triggers string
	if err := pool.QueryRow(ctx, `
		SELECT string_agg(tgname, ',' ORDER BY tgname)
		FROM pg_trigger
		WHERE NOT tgisinternal
		  AND tgname IN (
			'enforce_membership_sector_compatibility',
			'enforce_membership_sector_set_on_membership',
			'enforce_membership_sector_set_on_organization'
		  )`).Scan(&triggers); err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		"enforce_membership_sector_compatibility",
		"enforce_membership_sector_set_on_membership",
		"enforce_membership_sector_set_on_organization",
	} {
		if !strings.Contains(triggers, required) {
			t.Fatalf("fresh compatibility schema missing %s: %s", required, triggers)
		}
	}
}

func TestMembershipSectorCompatibilityMigration_UpgradeRejectsInvalidExistingAssignments(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 97)
	ctx := context.Background()
	const (
		org        = "d3000000-0000-0000-0000-000000000001"
		user       = "d3000000-0000-0000-0000-000000000002"
		membership = "d3000000-0000-0000-0000-000000000003"
	)
	for _, statement := range []string{
		`INSERT INTO organizations (id,name,slug,type,active) VALUES ('` + org + `','Invalid sectors','invalid-sectors','factory',FALSE)`,
		`INSERT INTO users (id,email,normalized_email,password_hash,name,account_status) VALUES ('` + user + `','invalid-sector@example.test','invalid-sector@example.test','x','Invalid sector','active')`,
		`INSERT INTO memberships (id,organization_id,user_id,roles,status,joined_at) VALUES ('` + membership + `','` + org + `','` + user + `','{admin}','active',NOW())`,
		`INSERT INTO membership_sectors (membership_id,organization_id,sector) VALUES ('` + membership + `','` + org + `','cutting')`,
	} {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, membershipSectorCompatibilityMigrationSQL(t, "up"))
	_ = tx.Rollback(ctx)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" || pgErr.ConstraintName != "membership_sector_compatibility" {
		t.Fatalf("invalid upgrade error=%v", err)
	}
	var functionExists bool
	if err := pool.QueryRow(ctx, `SELECT to_regprocedure('membership_sector_is_compatible(text,text[],text)') IS NOT NULL`).Scan(&functionExists); err != nil || functionExists {
		t.Fatalf("failed upgrade left compatibility function=%v err=%v", functionExists, err)
	}
}

func TestMembershipSectorCompatibilityMigration_ValidUpgradeAndDown(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 97)
	ctx := context.Background()
	const (
		org        = "d3000000-0000-0000-0000-000000000011"
		user       = "d3000000-0000-0000-0000-000000000012"
		membership = "d3000000-0000-0000-0000-000000000013"
	)
	for _, statement := range []string{
		`INSERT INTO organizations (id,name,slug,type,active) VALUES ('` + org + `','Valid sectors','valid-sectors','factory',FALSE)`,
		`INSERT INTO users (id,email,normalized_email,password_hash,name,account_status) VALUES ('` + user + `','valid-sector@example.test','valid-sector@example.test','x','Valid sector','active')`,
		`INSERT INTO memberships (id,organization_id,user_id,roles,status,joined_at) VALUES ('` + membership + `','` + org + `','` + user + `','{produccion}','active',NOW())`,
		`INSERT INTO membership_sectors (membership_id,organization_id,sector) VALUES ('` + membership + `','` + org + `','cutting')`,
	} {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, membershipSectorCompatibilityMigrationSQL(t, "up")); err != nil {
		t.Fatalf("valid upgrade: %v", err)
	}
	if _, err := pool.Exec(ctx, membershipSectorCompatibilityMigrationSQL(t, "down")); err != nil {
		t.Fatalf("compatibility down: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE memberships SET roles='{admin}' WHERE id=$1`, membership); err != nil {
		t.Fatalf("down left membership trigger: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO membership_sectors (membership_id,organization_id,sector) VALUES ($1,$2,'not_a_sector')`, membership, org); err != nil {
		t.Fatalf("down left row trigger: %v", err)
	}
}

func TestMembershipSectorCompatibility_DirectRuntimeSQLRejectsInvalidRowsAndResiduals(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id,email,normalized_email,password_hash,name,account_status) VALUES ($1,'sector-production@example.test','sector-production@example.test','x','Production','active')`, []any{sectorProductionUser}},
		{`INSERT INTO users (id,email,normalized_email,password_hash,name,account_status) VALUES ($1,'sector-warehouse@example.test','sector-warehouse@example.test','x','Warehouse','active')`, []any{sectorWarehouseUser}},
		{`INSERT INTO memberships (id,organization_id,user_id,roles,status,joined_at) VALUES ($1,$2,$3,'{produccion}','active',NOW())`, []any{sectorProductionMembership, rlsOrgA, sectorProductionUser}},
		{`INSERT INTO memberships (id,organization_id,user_id,roles,status,joined_at) VALUES ($1,$2,$3,'{almacen}','active',NOW())`, []any{sectorWarehouseMembership, rlsOrgA, sectorWarehouseUser}},
		{`UPDATE organizations SET type='store' WHERE id=$1`, []any{rlsOrgB}},
		{`INSERT INTO membership_sectors (membership_id,organization_id,sector) VALUES ($1,$2,'herrajes')`, []any{sectorWarehouseMembership, rlsOrgA}},
	} {
		if _, err := fx.admin.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed direct compatibility proof: %v", err)
		}
	}

	var adminMembershipA, adminMembershipB string
	if err := fx.admin.QueryRow(ctx, `SELECT id FROM memberships WHERE organization_id=$1 AND user_id=$2`, rlsOrgA, rlsUserA).Scan(&adminMembershipA); err != nil {
		t.Fatal(err)
	}
	if err := fx.admin.QueryRow(ctx, `SELECT id FROM memberships WHERE organization_id=$1 AND user_id=$2`, rlsOrgB, rlsUserB).Scan(&adminMembershipB); err != nil {
		t.Fatal(err)
	}

	withRLSActor(t, fx.app, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
		if _, err := tx.Exec(ctx, `INSERT INTO membership_sectors (membership_id,organization_id,sector) VALUES ($1,$2,'cutting')`, sectorProductionMembership, rlsOrgA); err != nil {
			t.Fatalf("valid production sector rejected: %v", err)
		}
		var count int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM membership_sectors WHERE membership_id=$1 AND sector='cutting'`, sectorProductionMembership).Scan(&count); err != nil || count != 1 {
			t.Fatalf("valid runtime insert count=%d err=%v", count, err)
		}
	})

	expectRuntimeSectorConstraint(t, fx.app, rlsOrgA, rlsUserA,
		`INSERT INTO membership_sectors (membership_id,organization_id,sector) VALUES ($1,$2,'cutting')`, adminMembershipA, rlsOrgA)
	expectRuntimeSectorConstraint(t, fx.app, rlsOrgA, rlsUserA,
		`INSERT INTO membership_sectors (membership_id,organization_id,sector) VALUES ($1,$2,'unknown')`, sectorProductionMembership, rlsOrgA)
	expectRuntimeSectorConstraint(t, fx.app, rlsOrgA, rlsUserA,
		`UPDATE membership_sectors SET sector='cutting' WHERE membership_id=$1 AND sector='herrajes'`, sectorWarehouseMembership)
	expectRuntimeSectorConstraint(t, fx.app, rlsOrgB, rlsUserB,
		`INSERT INTO membership_sectors (membership_id,organization_id,sector) VALUES ($1,$2,'herrajes')`, adminMembershipB, rlsOrgB)
	expectRuntimeSectorSetConstraint(t, fx.app, rlsOrgA, rlsUserA,
		`UPDATE memberships SET roles='{admin}' WHERE id=$1`, sectorWarehouseMembership)
}

func expectRuntimeSectorConstraint(t *testing.T, pool *pgxpool.Pool, organizationID, userID, query string, args ...any) {
	t.Helper()
	withRLSActor(t, pool, organizationID, userID, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(), query, args...)
		assertPGConstraint(t, err, "membership_sector_compatibility")
	})
}

func expectRuntimeSectorSetConstraint(t *testing.T, pool *pgxpool.Pool, organizationID, userID, query string, args ...any) {
	t.Helper()
	withRLSActor(t, pool, organizationID, userID, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(), query, args...)
		assertPGConstraint(t, err, "membership_sector_set_compatibility")
	})
}

func assertPGConstraint(t *testing.T, err error, constraint string) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" || pgErr.ConstraintName != constraint {
		t.Fatalf("constraint=%s error=%v", constraint, err)
	}
}
