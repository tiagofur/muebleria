package storage_test

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const directoryUser = "20000000-0000-0000-0000-00000000000d"

func TestAuthSessionDirectoryMigrationFreshAndUpgrade(t *testing.T) {
	ctx := context.Background()
	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 107)
	assertSessionDirectoryFunctions(t, fresh)

	upgrade := multiOrgFreshDB(t)
	identityApplyThrough(t, upgrade, 106)
	sql, err := os.ReadFile("../../db/migration/000107_auth_session_directory.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := upgrade.Exec(ctx, string(sql)); err != nil {
		t.Fatalf("upgrade migration 000107: %v", err)
	}
	assertSessionDirectoryFunctions(t, upgrade)
}

func assertSessionDirectoryFunctions(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	var count int
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM pg_proc
		WHERE proname IN (
			'app_list_membership_auth_sessions', 'app_revoke_own_auth_session',
			'app_revoke_membership_auth_session', 'app_revoke_platform_auth_session',
			'app_revoke_membership_auth_sessions'
		)`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 5 {
		t.Fatalf("SEC-2B function count=%d, want 5", count)
	}
}

func seedDirectoryMember(t *testing.T, f *rlsFixture) (actorMembership, targetMembership string) {
	t.Helper()
	ctx := context.Background()
	if _, err := f.admin.Exec(ctx, `
		INSERT INTO users (id,email,normalized_email,password_hash,name,account_status,platform_admin)
		VALUES ($1,'directory@example.test','directory@example.test','x','Directory Member','active',FALSE)`, directoryUser); err != nil {
		t.Fatal(err)
	}
	if _, err := f.admin.Exec(ctx, `INSERT INTO memberships (organization_id,user_id,roles)
		VALUES ($1,$2,ARRAY['vendedor']::text[])`, rlsOrgA, directoryUser); err != nil {
		t.Fatal(err)
	}
	if err := f.admin.QueryRow(ctx, `SELECT id FROM memberships WHERE organization_id=$1 AND user_id=$2`, rlsOrgA, rlsUserA).Scan(&actorMembership); err != nil {
		t.Fatal(err)
	}
	if err := f.admin.QueryRow(ctx, `SELECT id FROM memberships WHERE organization_id=$1 AND user_id=$2`, rlsOrgA, directoryUser).Scan(&targetMembership); err != nil {
		t.Fatal(err)
	}
	return actorMembership, targetMembership
}

func createDirectoryRefresh(t *testing.T, f *rlsFixture, verifierByte byte) (*domain.AuthSession, []byte) {
	t.Helper()
	verifier := bytes.Repeat([]byte{verifierByte}, 32)
	session, _ := createRefreshForScope(t, f, rlsOrgA, directoryUser, verifier, time.Now().Add(time.Hour))
	return session, verifier
}

func TestAuthSessionDirectorySelfOrganizationPlatformAndIsolation(t *testing.T) {
	f := newRLSFixture(t)
	actorMembership, targetMembership := seedDirectoryMember(t, f)
	session, verifier := createDirectoryRefresh(t, f, 0x31)
	foreignSession, _ := createRefreshForScope(t, f, rlsOrgB, rlsUserB, bytes.Repeat([]byte{0x33}, 32), time.Now().Add(time.Hour))
	ctx := context.Background()

	var self []storage.AuthSessionDirectoryEntry
	if err := f.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: rlsOrgA, UserID: directoryUser, MembershipID: targetMembership}, func(txCtx context.Context) error {
		var err error
		self, err = f.store.ListOwnAuthSessions(txCtx, directoryUser, 1000)
		return err
	}); err != nil || len(self) != 1 || self[0].ID != session.ID {
		t.Fatalf("self directory=%+v err=%v", self, err)
	}

	var organization []storage.AuthSessionDirectoryEntry
	if err := f.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: rlsOrgA, UserID: rlsUserA, MembershipID: actorMembership}, func(txCtx context.Context) error {
		var err error
		organization, err = f.store.ListMembershipAuthSessions(txCtx, rlsUserA, rlsOrgA, targetMembership, 100)
		return err
	}); err != nil || len(organization) != 1 || organization[0].ID != session.ID {
		t.Fatalf("organization directory=%+v err=%v", organization, err)
	}

	var seller []storage.AuthSessionDirectoryEntry
	if err := f.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: rlsOrgA, UserID: directoryUser, MembershipID: targetMembership}, func(txCtx context.Context) error {
		var err error
		seller, err = f.store.ListMembershipAuthSessions(txCtx, directoryUser, rlsOrgA, targetMembership, 100)
		return err
	}); err != nil || len(seller) != 0 {
		t.Fatalf("seller must receive no command-boundary rows: %+v err=%v", seller, err)
	}

	var cross []storage.AuthSessionDirectoryEntry
	if err := f.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: rlsOrgA, UserID: rlsUserA, MembershipID: actorMembership}, func(txCtx context.Context) error {
		var err error
		cross, err = f.store.ListMembershipAuthSessions(txCtx, rlsUserA, rlsOrgA, "00000000-0000-0000-0000-000000000999", 100)
		return err
	}); err != nil || len(cross) != 0 {
		t.Fatalf("foreign/missing membership leaked rows: %+v err=%v", cross, err)
	}

	var platform []storage.AuthSessionDirectoryEntry
	if err := f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA}, func(txCtx context.Context) error {
		var err error
		platform, err = f.store.ListPlatformUserAuthSessions(txCtx, directoryUser, 100)
		return err
	}); err != nil || len(platform) != 1 {
		t.Fatalf("platform directory=%+v err=%v", platform, err)
	}

	var revoked *storage.AuthSessionRevocation
	if err := f.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: rlsOrgA, UserID: rlsUserA, MembershipID: actorMembership}, func(txCtx context.Context) error {
		var err error
		revoked, err = f.store.RevokeMembershipAuthSession(txCtx, storage.RevokeAuthSessionCommand{
			ActorUserID: rlsUserA, OrganizationID: rlsOrgA, TargetMembershipID: targetMembership,
			SessionID: session.ID, Reason: "lost device", RequestID: "directory-request-0001",
		})
		return err
	}); err != nil || revoked == nil || !revoked.Revoked {
		t.Fatalf("organization revoke=%+v err=%v", revoked, err)
	}
	if _, err := f.store.RotateAuthRefreshCredential(ctx, storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: verifier, NextVerifier: bytes.Repeat([]byte{0x32}, 32), ExpectedClient: domain.SessionClientWeb,
	}, func(context.Context, storage.AuthRefreshRotation) error { return nil }); !errors.Is(err, storage.ErrRefreshRevoked) && !errors.Is(err, storage.ErrRefreshSessionRevoked) {
		t.Fatalf("revoked refresh remained usable: %v", err)
	}

	if err := f.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: rlsOrgA, UserID: rlsUserA, MembershipID: actorMembership}, func(txCtx context.Context) error {
		_, err := f.store.RevokeMembershipAuthSession(txCtx, storage.RevokeAuthSessionCommand{
			ActorUserID: rlsUserA, OrganizationID: rlsOrgA, TargetMembershipID: targetMembership,
			SessionID: foreignSession.ID, Reason: "known foreign id", RequestID: "directory-cross-0001",
		})
		return err
	}); !errors.Is(err, storage.ErrAuthSessionNotFound) {
		t.Fatalf("known cross-tenant session must be indistinguishable from missing: %v", err)
	}

	var platformRevoke *storage.AuthSessionRevocation
	if err := f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA}, func(txCtx context.Context) error {
		var err error
		platformRevoke, err = f.store.RevokePlatformAuthSession(txCtx, storage.RevokeAuthSessionCommand{
			ActorUserID: rlsUserA, TargetUserID: rlsUserB, SessionID: foreignSession.ID,
			Reason: "platform response", RequestID: "directory-platform-0001",
		})
		return err
	}); err != nil || platformRevoke == nil || !platformRevoke.Revoked {
		t.Fatalf("platform revoke=%+v err=%v", platformRevoke, err)
	}

	var auditCount int
	if err := f.admin.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE event_type='session_revoked_by_organization_admin' AND target_user_id=$1 AND details->>'session_id'=$2`, directoryUser, session.ID).Scan(&auditCount); err != nil || auditCount != 1 {
		t.Fatalf("organization audit count=%d err=%v", auditCount, err)
	}
}

func TestAuthSessionDirectoryRepairsFamilyOnlyAndRollsBackFailures(t *testing.T) {
	for _, failure := range []string{"family", "audit"} {
		t.Run(failure, func(t *testing.T) {
			f := newRLSFixture(t)
			actorMembership, targetMembership := seedDirectoryMember(t, f)
			session, _ := createDirectoryRefresh(t, f, 0x41)
			ctx := context.Background()
			functionSQL := `CREATE FUNCTION fail_sec2b_` + failure + `() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'sec2b failure'; END $$`
			if _, err := f.admin.Exec(ctx, functionSQL); err != nil {
				t.Fatal(err)
			}
			var trigger string
			if failure == "family" {
				trigger += `CREATE TRIGGER fail_sec2b_family BEFORE UPDATE ON auth_refresh_families FOR EACH ROW EXECUTE FUNCTION fail_sec2b_family()`
			} else {
				trigger += `CREATE TRIGGER fail_sec2b_audit BEFORE INSERT ON security_audit_events FOR EACH ROW WHEN (NEW.event_type='session_revoked_by_organization_admin') EXECUTE FUNCTION fail_sec2b_audit()`
			}
			if _, err := f.admin.Exec(ctx, trigger); err != nil {
				t.Fatal(err)
			}
			err := f.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: rlsOrgA, UserID: rlsUserA, MembershipID: actorMembership}, func(txCtx context.Context) error {
				_, err := f.store.RevokeMembershipAuthSession(txCtx, storage.RevokeAuthSessionCommand{
					ActorUserID: rlsUserA, OrganizationID: rlsOrgA, TargetMembershipID: targetMembership,
					SessionID: session.ID, Reason: "failure proof", RequestID: "directory-failure-0001",
				})
				return err
			})
			if err == nil {
				t.Fatal("failure injection must abort command")
			}
			var sessionOpen, familyOpen bool
			var auditCount int
			if err := f.admin.QueryRow(ctx, `SELECT revoked_at IS NULL FROM auth_sessions WHERE id=$1`, session.ID).Scan(&sessionOpen); err != nil {
				t.Fatal(err)
			}
			if err := f.admin.QueryRow(ctx, `SELECT revoked_at IS NULL FROM auth_refresh_families WHERE session_id=$1`, session.ID).Scan(&familyOpen); err != nil {
				t.Fatal(err)
			}
			if err := f.admin.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE event_type='session_revoked_by_organization_admin' AND details->>'session_id'=$1`, session.ID).Scan(&auditCount); err != nil {
				t.Fatal(err)
			}
			if !sessionOpen || !familyOpen || auditCount != 0 {
				t.Fatalf("partial revoke after %s failure: sessionOpen=%v familyOpen=%v audit=%d", failure, sessionOpen, familyOpen, auditCount)
			}
		})
	}

	f := newRLSFixture(t)
	actorMembership, targetMembership := seedDirectoryMember(t, f)
	session, _ := createDirectoryRefresh(t, f, 0x51)
	ctx := context.Background()
	if _, err := f.admin.Exec(ctx, `UPDATE auth_sessions SET revoked_at=NOW(), revoked_by=$1, revoke_reason='prior policy' WHERE id=$2`, rlsUserA, session.ID); err != nil {
		t.Fatal(err)
	}
	var repaired *storage.AuthSessionRevocation
	if err := f.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: rlsOrgA, UserID: rlsUserA, MembershipID: actorMembership}, func(txCtx context.Context) error {
		var err error
		repaired, err = f.store.RevokeMembershipAuthSession(txCtx, storage.RevokeAuthSessionCommand{ActorUserID: rlsUserA, OrganizationID: rlsOrgA, TargetMembershipID: targetMembership, SessionID: session.ID, Reason: "repair", RequestID: "directory-repair-0001"})
		return err
	}); err != nil || repaired == nil || !repaired.Revoked {
		t.Fatalf("family-only repair=%+v err=%v", repaired, err)
	}
	var familyOpen bool
	if err := f.admin.QueryRow(ctx, `SELECT revoked_at IS NULL FROM auth_refresh_families WHERE session_id=$1`, session.ID).Scan(&familyOpen); err != nil || familyOpen {
		t.Fatalf("family-only repair left family open=%v err=%v", familyOpen, err)
	}
	var retry *storage.AuthSessionRevocation
	if err := f.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: rlsOrgA, UserID: rlsUserA, MembershipID: actorMembership}, func(txCtx context.Context) error {
		var err error
		retry, err = f.store.RevokeMembershipAuthSession(txCtx, storage.RevokeAuthSessionCommand{ActorUserID: rlsUserA, OrganizationID: rlsOrgA, TargetMembershipID: targetMembership, SessionID: session.ID, Reason: "repair", RequestID: "directory-repair-0002"})
		return err
	}); err != nil || retry == nil || retry.Revoked {
		t.Fatalf("idempotent retry=%+v err=%v", retry, err)
	}
}

func TestAuthSessionDirectoryConcurrentExactRevokeTransitionsOnce(t *testing.T) {
	f := newRLSFixture(t)
	actorMembership, targetMembership := seedDirectoryMember(t, f)
	session, _ := createDirectoryRefresh(t, f, 0x71)

	type result struct {
		revoked bool
		err     error
	}
	results := make(chan result, 2)
	var ready sync.WaitGroup
	ready.Add(2)
	start := make(chan struct{})
	for i := 0; i < 2; i++ {
		i := i
		go func() {
			ready.Done()
			<-start
			var revoked *storage.AuthSessionRevocation
			err := f.store.WithinTenantTx(context.Background(), storage.TenantActor{OrganizationID: rlsOrgA, UserID: rlsUserA, MembershipID: actorMembership}, func(txCtx context.Context) error {
				var err error
				revoked, err = f.store.RevokeMembershipAuthSession(txCtx, storage.RevokeAuthSessionCommand{
					ActorUserID: rlsUserA, OrganizationID: rlsOrgA, TargetMembershipID: targetMembership,
					SessionID: session.ID, Reason: "concurrent incident", RequestID: []string{"directory-concurrent-0001", "directory-concurrent-0002"}[i],
				})
				return err
			})
			results <- result{revoked: revoked != nil && revoked.Revoked, err: err}
		}()
	}
	ready.Wait()
	close(start)
	first, second := <-results, <-results
	if first.err != nil || second.err != nil || first.revoked == second.revoked {
		t.Fatalf("concurrent revoke results=%+v %+v", first, second)
	}
	var auditCount int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM security_audit_events WHERE event_type='session_revoked_by_organization_admin' AND details->>'session_id'=$1`, session.ID).Scan(&auditCount); err != nil {
		t.Fatal(err)
	}
	if auditCount != 1 {
		t.Fatalf("concurrent exact revoke audit count=%d", auditCount)
	}
}

func TestAuthSessionDirectoryMigrationFunctionsAreNarrow(t *testing.T) {
	f := newRLSFixture(t)
	ctx := context.Background()
	var readScope, familyScope string
	if err := f.admin.QueryRow(ctx, `SELECT read_scope FROM rls_policy_inventory WHERE table_name='auth_sessions'`).Scan(&readScope); err != nil {
		t.Fatal(err)
	}
	if err := f.admin.QueryRow(ctx, `SELECT read_scope FROM rls_policy_inventory WHERE table_name='auth_refresh_families'`).Scan(&familyScope); err != nil {
		t.Fatal(err)
	}
	if readScope != "self-or-platform" || familyScope != "self-or-platform" {
		t.Fatalf("RLS widened: auth=%q family=%q", readScope, familyScope)
	}
	var definitions string
	rows, err := f.admin.Query(ctx, `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname LIKE 'app_%auth_session%' OR proname='app_actor_can_revoke_membership_sessions'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var definition string
		if err := rows.Scan(&definition); err != nil {
			t.Fatal(err)
		}
		definitions += definition
	}
	if !strings.Contains(definitions, "SET search_path TO 'pg_catalog', 'public'") || !strings.Contains(definitions, "app_current_membership_id()") {
		t.Fatalf("narrow function hardening missing: %s", definitions)
	}
}

func TestMembershipWideSessionRevokeAuditFailureRollsBackEverything(t *testing.T) {
	f := newRLSFixture(t)
	actorMembership, targetMembership := seedDirectoryMember(t, f)
	session, _ := createDirectoryRefresh(t, f, 0x61)
	ctx := context.Background()
	var beforeVersion int64
	if err := f.admin.QueryRow(ctx, `SELECT version FROM memberships WHERE id=$1`, targetMembership).Scan(&beforeVersion); err != nil {
		t.Fatal(err)
	}
	if _, err := f.admin.Exec(ctx, `CREATE FUNCTION fail_membership_session_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'membership audit failure'; END $$`); err != nil {
		t.Fatal(err)
	}
	if _, err := f.admin.Exec(ctx, `CREATE TRIGGER fail_membership_session_audit BEFORE INSERT ON security_audit_events FOR EACH ROW WHEN (NEW.event_type='membership_sessions_revoked') EXECUTE FUNCTION fail_membership_session_audit()`); err != nil {
		t.Fatal(err)
	}
	err := f.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: rlsOrgA, UserID: rlsUserA, MembershipID: actorMembership}, func(txCtx context.Context) error {
		member, err := f.store.RevokeMembershipSessions(txCtx, rlsOrgA, targetMembership, rlsUserA, "incident", beforeVersion)
		if err != nil {
			return err
		}
		return f.store.InsertSecurityAuditEvent(txCtx, storage.SecurityAuditEvent{
			EventType: "membership_sessions_revoked", ActorUserID: rlsUserA,
			TargetUserID: member.UserID, OrganizationID: rlsOrgA,
			Details: map[string]interface{}{"target_membership_id": targetMembership, "session_id": session.ID},
		})
	})
	if err == nil {
		t.Fatal("audit failure must abort membership-wide command")
	}
	var afterVersion int64
	var sessionOpen, familyOpen bool
	if err := f.admin.QueryRow(ctx, `SELECT version FROM memberships WHERE id=$1`, targetMembership).Scan(&afterVersion); err != nil {
		t.Fatal(err)
	}
	if err := f.admin.QueryRow(ctx, `SELECT revoked_at IS NULL FROM auth_sessions WHERE id=$1`, session.ID).Scan(&sessionOpen); err != nil {
		t.Fatal(err)
	}
	if err := f.admin.QueryRow(ctx, `SELECT revoked_at IS NULL FROM auth_refresh_families WHERE session_id=$1`, session.ID).Scan(&familyOpen); err != nil {
		t.Fatal(err)
	}
	if afterVersion != beforeVersion || !sessionOpen || !familyOpen {
		t.Fatalf("partial mass revoke after audit failure: version=%d/%d sessionOpen=%v familyOpen=%v", beforeVersion, afterVersion, sessionOpen, familyOpen)
	}
}
