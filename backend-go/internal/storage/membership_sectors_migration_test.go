package storage_test

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestListOrgTeamProjectsActivityAndMembershipSessionState(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 97)
	ctx := context.Background()
	const (
		orgID        = "b4100000-0000-0000-0000-000000000001"
		adminUserID  = "b4100000-0000-0000-0000-000000000002"
		memberUserID = "b4100000-0000-0000-0000-000000000003"
		membershipID = "b4100000-0000-0000-0000-000000000004"
	)
	lastActivity := time.Date(2026, time.August, 30, 14, 0, 0, 0, time.UTC)
	revokedAt := lastActivity.Add(time.Hour)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations (id,name,slug,type) VALUES ($1,'Read Model','team-read-model','factory')`, []any{orgID}},
		{`INSERT INTO users (id,email,normalized_email,password_hash,name,account_status) VALUES ($1,'read-admin@example.test','read-admin@example.test','x','Admin','active')`, []any{adminUserID}},
		{`INSERT INTO users (id,email,normalized_email,password_hash,name,account_status,last_login_at) VALUES ($1,'read-member@example.test','read-member@example.test','x','Member','active',$2)`, []any{memberUserID, lastActivity}},
		{`INSERT INTO memberships (organization_id,user_id,roles,status,joined_at) VALUES ($1,$2,'{admin}','active',NOW())`, []any{orgID, adminUserID}},
		{`INSERT INTO memberships (id,organization_id,user_id,roles,status,joined_at,credential_version,sessions_revoked_at) VALUES ($1,$2,$3,'{produccion}','active',NOW(),4,$4)`, []any{membershipID, orgID, memberUserID, revokedAt}},
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement.query, statement.args...); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	members, err := (&storage.PostgresStore{Pool: pool}).ListOrgTeam(scoped(ctx, orgID), orgID, adminUserID)
	if err != nil {
		t.Fatal(err)
	}
	for _, member := range members {
		if member.MembershipID != membershipID {
			continue
		}
		if member.LastActivity == nil || !member.LastActivity.Equal(lastActivity) || member.CredentialVersion != 4 || member.SessionsRevokedAt == nil || !member.SessionsRevokedAt.Equal(revokedAt) {
			t.Fatalf("session projection=%+v", member)
		}
		return
	}
	t.Fatalf("membership %s missing from Team projection", membershipID)
}

func TestMembershipSectorsMigration_BackfillsExactMembershipAndRLS(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 96)
	ctx := context.Background()
	const org = "b4000000-0000-0000-0000-000000000001"
	const user = "b4000000-0000-0000-0000-000000000002"
	const membership = "b4000000-0000-0000-0000-000000000003"
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`INSERT INTO organizations (id, name, slug) VALUES ('` + org + `', 'Sector Factory', 'sector-factory')`,
		`INSERT INTO users (id, email, normalized_email, password_hash, name, account_status) VALUES ('` + user + `', 'sector@example.test', 'sector@example.test', 'x', 'Sector', 'active')`,
		`INSERT INTO memberships (id, organization_id, user_id, roles, status, joined_at) VALUES ('` + membership + `', '` + org + `', '` + user + `', '{admin,produccion}', 'active', NOW())`,
		`INSERT INTO user_sectors (user_id, sector, sub_sector, organization_id) VALUES ('` + user + `', 'cutting', '', '` + org + `')`,
	} {
		if _, err := tx.Exec(ctx, sql); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, membershipSectorsMigrationSQL(t, "up")); err != nil {
		t.Fatal(err)
	}
	var gotMembership, gotOrg, sector string
	if err := pool.QueryRow(ctx, `SELECT membership_id, organization_id, sector FROM membership_sectors`).Scan(&gotMembership, &gotOrg, &sector); err != nil || gotMembership != membership || gotOrg != org || sector != "cutting" {
		t.Fatalf("backfill membership=%s org=%s sector=%s err=%v", gotMembership, gotOrg, sector, err)
	}
	var forced bool
	if err := pool.QueryRow(ctx, `SELECT relforcerowsecurity FROM pg_class WHERE oid='membership_sectors'::regclass`).Scan(&forced); err != nil || !forced {
		t.Fatalf("membership sectors RLS forced=%v err=%v", forced, err)
	}
}

func TestMembershipSectorsMigration_AbortsNonFactoryLegacyBackfill(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 96)
	ctx := context.Background()
	const org = "b4000000-0000-0000-0000-000000000010"
	const user = "b4000000-0000-0000-0000-000000000011"
	const membership = "b4000000-0000-0000-0000-000000000012"
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`INSERT INTO organizations (id, name, slug, type) VALUES ('` + org + `', 'Sector Store', 'sector-store', 'store')`,
		`INSERT INTO users (id, email, normalized_email, password_hash, name, account_status) VALUES ('` + user + `', 'store-sector@example.test', 'store-sector@example.test', 'x', 'Store sector', 'active')`,
		`INSERT INTO memberships (id, organization_id, user_id, roles, status, joined_at) VALUES ('` + membership + `', '` + org + `', '` + user + `', '{admin}', 'active', NOW())`,
		`INSERT INTO user_sectors (user_id, sector, sub_sector, organization_id) VALUES ('` + user + `', 'cutting', '', '` + org + `')`,
	} {
		if _, err := tx.Exec(ctx, sql); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, membershipSectorsMigrationSQL(t, "up")); err == nil || !strings.Contains(err.Error(), "require exact factory membership reconciliation") {
		t.Fatalf("expected reconciliation error, got %v", err)
	}
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('membership_sectors') IS NOT NULL`).Scan(&exists); err != nil || exists {
		t.Fatalf("failed preflight must not leave membership_sectors=%v err=%v", exists, err)
	}
}

func membershipSectorsMigrationSQL(t *testing.T, suffix string) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000097_membership_sectors." + suffix + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func TestMembershipSectorsRLS_DirectSQLCannotCrossTenant(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	var membershipA, membershipB string
	if err := fx.admin.QueryRow(ctx, `SELECT id FROM memberships WHERE organization_id=$1`, rlsOrgA).Scan(&membershipA); err != nil {
		t.Fatal(err)
	}
	if err := fx.admin.QueryRow(ctx, `SELECT id FROM memberships WHERE organization_id=$1`, rlsOrgB).Scan(&membershipB); err != nil {
		t.Fatal(err)
	}
	for _, row := range []struct{ membership, org string }{{membershipA, rlsOrgA}, {membershipB, rlsOrgB}} {
		if _, err := fx.admin.Exec(ctx, `INSERT INTO membership_sectors (membership_id, organization_id, sector) VALUES ($1, $2, 'cutting')`, row.membership, row.org); err != nil {
			t.Fatal(err)
		}
	}
	withRLSActor(t, fx.app, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
		var visible int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM membership_sectors`).Scan(&visible); err != nil || visible != 1 {
			t.Fatalf("visible sectors=%d err=%v", visible, err)
		}
		tag, err := tx.Exec(ctx, `UPDATE membership_sectors SET sector='cnc' WHERE membership_id=$1`, membershipB)
		if err != nil || tag.RowsAffected() != 0 {
			t.Fatalf("cross-tenant update rows=%d err=%v", tag.RowsAffected(), err)
		}
	})
}
