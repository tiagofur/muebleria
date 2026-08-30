package storage_test

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

const teamFoundationOrg = "b2000000-0000-0000-0000-000000000001"

func teamFoundationMigrationSQL(t *testing.T, suffix string) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000096_team_administration_foundations." + suffix + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func TestTeamFoundationMigration_EnforcesCountersSeatsAndRLS(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 96)
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO organizations (id, name, slug) VALUES ($1, 'Team Foundation', 'team-foundation')`, teamFoundationOrg)
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO users (id, email, normalized_email, password_hash, name, account_status) VALUES ('b1000000-0000-0000-0000-000000000001', 'admin@example.test', 'admin@example.test', 'x', 'Admin', 'active')`)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO memberships (id, organization_id, user_id, roles, status, joined_at) VALUES ('b3000000-0000-0000-0000-000000000001', $1, 'b1000000-0000-0000-0000-000000000001', '{admin}', 'active', NOW())`, teamFoundationOrg)
	}
	if err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit active organization with admin: %v", err)
	}

	var admins, members int
	var maxMembers *int
	if err := pool.QueryRow(ctx, `SELECT s.active_admin_count, s.active_member_count, e.max_active_members FROM organization_team_state s JOIN organization_entitlements e USING (organization_id) WHERE s.organization_id=$1`, teamFoundationOrg).Scan(&admins, &members, &maxMembers); err != nil {
		t.Fatal(err)
	}
	if admins != 1 || members != 1 || maxMembers != nil {
		t.Fatalf("unexpected backfill state admins=%d members=%d max=%v", admins, members, maxMembers)
	}
	teamSummary, err := (&storage.PostgresStore{Pool: pool}).GetOrgTeamSummary(ctx, teamFoundationOrg, "b1000000-0000-0000-0000-000000000001")
	if err != nil || teamSummary.ActiveMembers != 1 || teamSummary.SuspendedMembers != 0 || teamSummary.LeftMembers != 0 || teamSummary.MaxActiveMembers != nil || teamSummary.TeamVersion < 1 || teamSummary.EntitlementsVersion < 1 {
		t.Fatalf("team summary=%#v err=%v", teamSummary, err)
	}

	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE memberships SET status='suspended' WHERE id='b3000000-0000-0000-0000-000000000001'`); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err == nil {
		t.Fatalf("last admin commit error=%v", err)
	}

	if _, err := pool.Exec(ctx, `UPDATE organization_entitlements SET max_active_members=1, source='provisioned' WHERE organization_id=$1`, teamFoundationOrg); err != nil {
		t.Fatal(err)
	}
	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO users (id, email, normalized_email, password_hash, name, account_status) VALUES ('b1000000-0000-0000-0000-000000000002', 'member@example.test', 'member@example.test', 'x', 'Member', 'active')`)
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO memberships (id, organization_id, user_id, roles, status, joined_at) VALUES ('b3000000-0000-0000-0000-000000000002', $1, 'b1000000-0000-0000-0000-000000000002', '{vendedor}', 'active', NOW())`, teamFoundationOrg)
	}
	if err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err == nil {
		t.Fatalf("seat limit commit error=%v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE organization_entitlements SET max_active_members=NULL, source='legacy_unlimited' WHERE organization_id=$1`, teamFoundationOrg); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"4", "5"} {
		if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, normalized_email, password_hash, name, account_status) VALUES ('b1000000-0000-0000-0000-00000000000`+id+`', 'race`+id+`@example.test', 'race`+id+`@example.test', 'x', 'Race', 'active')`); err != nil {
			t.Fatal(err)
		}
	}
	firstReady := make(chan struct{})
	releaseFirst := make(chan struct{})
	results := make(chan error, 2)
	insertMember := func(id string, wait bool) {
		tx, err := pool.Begin(ctx)
		if err == nil {
			_, err = tx.Exec(ctx, `INSERT INTO memberships (id, organization_id, user_id, roles, status, joined_at) VALUES ($1, $2, $3, '{vendedor}', 'active', NOW())`, "b3000000-0000-0000-0000-00000000000"+id, teamFoundationOrg, "b1000000-0000-0000-0000-00000000000"+id)
		}
		if err == nil && wait {
			close(firstReady)
			<-releaseFirst
		}
		if err == nil {
			err = tx.Commit(ctx)
		} else if tx != nil {
			_ = tx.Rollback(ctx)
		}
		results <- err
	}
	go insertMember("4", true)
	<-firstReady
	go insertMember("5", false)
	time.Sleep(25 * time.Millisecond)
	close(releaseFirst)
	for range 2 {
		if err := <-results; err != nil {
			t.Fatalf("concurrent active membership: %v", err)
		}
	}
	if err := pool.QueryRow(ctx, `SELECT active_member_count FROM organization_team_state WHERE organization_id=$1`, teamFoundationOrg).Scan(&members); err != nil || members != 3 {
		t.Fatalf("concurrent counter members=%d err=%v", members, err)
	}

	var inventory string
	if err := pool.QueryRow(ctx, `SELECT string_agg(table_name || ':' || policy_version, ',' ORDER BY table_name) FROM rls_policy_inventory WHERE table_name IN ('organization_team_state','organization_entitlements')`).Scan(&inventory); err != nil || inventory != "organization_entitlements:1,organization_team_state:1" {
		t.Fatalf("RLS inventory=%q err=%v", inventory, err)
	}
	for _, table := range []string{"organization_team_state", "organization_entitlements"} {
		var forced, runtimeCRUD bool
		if err := pool.QueryRow(ctx, `SELECT c.relforcerowsecurity, has_table_privilege('granete_app', c.oid, 'SELECT,INSERT,UPDATE,DELETE') FROM pg_class c WHERE c.oid=$1::regclass`, table).Scan(&forced, &runtimeCRUD); err != nil || !forced || !runtimeCRUD {
			t.Fatalf("unsafe %s posture forced=%v runtimeCRUD=%v err=%v", table, forced, runtimeCRUD, err)
		}
	}
}

func TestUpdateMembershipStatus_RevokesCredentialsWhenLeavingActiveState(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 96)
	ctx := context.Background()
	const (
		orgID        = "b2000000-0000-0000-0000-000000000009"
		adminID      = "b1000000-0000-0000-0000-000000000009"
		memberID     = "b1000000-0000-0000-0000-000000000010"
		membershipID = "b3000000-0000-0000-0000-000000000009"
	)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Credential State', 'credential-state')`, []any{orgID}},
		{`INSERT INTO users (id, email, normalized_email, password_hash, name, account_status) VALUES ($1, 'credential-admin@example.test', 'credential-admin@example.test', 'x', 'Admin', 'active')`, []any{adminID}},
		{`INSERT INTO users (id, email, normalized_email, password_hash, name, account_status) VALUES ($1, 'credential-member@example.test', 'credential-member@example.test', 'x', 'Member', 'active')`, []any{memberID}},
		{`INSERT INTO memberships (organization_id, user_id, roles, status, joined_at) VALUES ($1, $2, '{admin}', 'active', NOW())`, []any{orgID, adminID}},
		{`INSERT INTO memberships (id, organization_id, user_id, roles, status, joined_at) VALUES ($1, $2, $3, '{vendedor}', 'active', NOW())`, []any{membershipID, orgID, memberID}},
	} {
		if _, err := tx.Exec(ctx, statement.query, statement.args...); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	store := &storage.PostgresStore{Pool: pool}
	member, err := store.UpdateMembershipStatus(scoped(ctx, orgID), orgID, membershipID, "suspended", "security hold", adminID, 1)
	if err != nil || member.Version != 2 {
		t.Fatalf("suspend member=%#v err=%v", member, err)
	}
	var credentialVersion int64
	var revokedAt *time.Time
	if err := pool.QueryRow(ctx, `SELECT credential_version, sessions_revoked_at FROM memberships WHERE id=$1`, membershipID).Scan(&credentialVersion, &revokedAt); err != nil || credentialVersion != 2 || revokedAt == nil {
		t.Fatalf("suspend credential_version=%d revoked_at=%v err=%v", credentialVersion, revokedAt, err)
	}

	member, err = store.UpdateMembershipStatus(scoped(ctx, orgID), orgID, membershipID, "active", "", adminID, 2)
	if err != nil || member.Version != 3 {
		t.Fatalf("reactivate member=%#v err=%v", member, err)
	}
	if err := pool.QueryRow(ctx, `SELECT credential_version, sessions_revoked_at FROM memberships WHERE id=$1`, membershipID).Scan(&credentialVersion, &revokedAt); err != nil || credentialVersion != 2 || revokedAt == nil {
		t.Fatalf("reactivation must not revive credentials: version=%d revoked_at=%v err=%v", credentialVersion, revokedAt, err)
	}

	member, err = store.UpdateMembershipStatus(scoped(ctx, orgID), orgID, membershipID, "left", "offboarding", adminID, 3)
	if err != nil || member.Version != 4 {
		t.Fatalf("leave member=%#v err=%v", member, err)
	}
	if err := pool.QueryRow(ctx, `SELECT credential_version, sessions_revoked_at FROM memberships WHERE id=$1`, membershipID).Scan(&credentialVersion, &revokedAt); err != nil || credentialVersion != 3 || revokedAt == nil {
		t.Fatalf("leave credential_version=%d revoked_at=%v err=%v", credentialVersion, revokedAt, err)
	}
}

func TestTeamFoundationMigration_DownFailsAfterCredentialRevocation(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 96)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, normalized_email, password_hash, name, account_status) VALUES ('b1000000-0000-0000-0000-000000000003', 'revoke@example.test', 'revoke@example.test', 'x', 'Revoke', 'active')`); err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO organizations (id, name, slug) VALUES ('b2000000-0000-0000-0000-000000000002', 'Revocation', 'revocation')`); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO memberships (id, organization_id, user_id, roles, status, joined_at) VALUES ('b3000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000003', '{admin}', 'active', NOW())`); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE memberships SET credential_version=2, sessions_revoked_at=NOW() WHERE id='b3000000-0000-0000-0000-000000000003'`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, teamFoundationMigrationSQL(t, "down")); err == nil || !strings.Contains(err.Error(), "credential revocation history") {
		t.Fatalf("down after revocation error=%v", err)
	}
}

func TestTeamFoundationMigration_UpgradeFailsForActiveOrganizationWithoutAdmin(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 95)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO organizations (id, name, slug, active) VALUES ('b2000000-0000-0000-0000-000000000009', 'Unsafe', 'unsafe-team', TRUE)`); err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, teamFoundationMigrationSQL(t, "up")); err == nil || !strings.Contains(err.Error(), "without active admin") {
		_ = tx.Rollback(ctx)
		t.Fatalf("unsafe upgrade error=%v", err)
	}
	_ = tx.Rollback(ctx)
	var tableExists bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('organization_team_state') IS NOT NULL`).Scan(&tableExists); err != nil || tableExists {
		t.Fatalf("failed preflight left team state table=%v err=%v", tableExists, err)
	}
}
