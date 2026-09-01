package storage_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #460 / SEC-1: server-side session registry. These integration tests run
// against real PostgreSQL under the app role: lifecycle (create/touch/scope/
// revoke) plus the RLS classification (self or organization or platform;
// inserts must carry the owning user).

func authSessionsMigrationSQL(t *testing.T, suffix string) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000105_auth_session_registry." + suffix + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

// The registry migration must apply both on a fresh database and on top of the
// pre-#460 schema (upgrade fixture), and must register the table in the RLS
// policy inventory with FORCE ROW LEVEL SECURITY.
func TestAuthSessions_MigrationFreshAndUpgrade(t *testing.T) {
	ctx := context.Background()

	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 105)
	assertAuthSessionsRegistry(t, fresh)

	upgrade := multiOrgFreshDB(t)
	identityApplyThrough(t, upgrade, 104)
	if _, err := upgrade.Exec(ctx, authSessionsMigrationSQL(t, "up")); err != nil {
		t.Fatalf("upgrade apply 000105: %v", err)
	}
	assertAuthSessionsRegistry(t, upgrade)
}

func assertAuthSessionsRegistry(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	var classification string
	if err := pool.QueryRow(context.Background(),
		`SELECT classification FROM rls_policy_inventory WHERE table_name='auth_sessions'`,
	).Scan(&classification); err != nil {
		t.Fatalf("inventory row: %v", err)
	}
	if classification != "platform-global" {
		t.Fatalf("classification = %q, want platform-global", classification)
	}
	var readScope string
	if err := pool.QueryRow(context.Background(),
		`SELECT read_scope FROM rls_policy_inventory WHERE table_name='auth_sessions'`,
	).Scan(&readScope); err != nil {
		t.Fatalf("inventory read scope: %v", err)
	}
	if readScope != "self-or-platform" {
		t.Fatalf("read_scope = %q, want self-or-platform", readScope)
	}
	var rls, forced bool
	if err := pool.QueryRow(context.Background(),
		`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='auth_sessions'`,
	).Scan(&rls, &forced); err != nil {
		t.Fatalf("pg_class lookup: %v", err)
	}
	if !rls || !forced {
		t.Fatalf("RLS enabled=%v forced=%v, want both true", rls, forced)
	}
}

func TestAuthSessions_RegistryLifecycleUnderAppRole(t *testing.T) {
	f := newRLSFixture(t)
	ctx := context.Background()

	// The membership for the scope update is seeded by the fixture without an
	// explicit id; resolve it as the migration role.
	var membershipID string
	if err := f.admin.QueryRow(ctx,
		`SELECT id FROM memberships WHERE organization_id=$1 AND user_id=$2`,
		rlsOrgA, rlsUserA).Scan(&membershipID); err != nil {
		t.Fatal(err)
	}

	absolute := time.Now().Add(authTestSessionTTL).UTC()
	var session *domain.AuthSession
	err := f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA, OrganizationID: rlsOrgA}, func(txCtx context.Context) error {
		created, err := f.store.CreateAuthSession(txCtx, storage.CreateAuthSessionCommand{
			UserID:            rlsUserA,
			MembershipID:      membershipID,
			OrganizationID:    rlsOrgA,
			ClientType:        domain.SessionClientWeb,
			AbsoluteExpiresAt: absolute,
			DeviceHint:        "Go-http-client/2.0 unit",
		})
		session = created
		return err
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	if session == nil || session.ID == "" {
		t.Fatal("create session returned no id")
	}
	if session.ClientType != domain.SessionClientWeb {
		t.Fatalf("client type = %q, want web", session.ClientType)
	}

	// Per-request resolution stamps last_seen once, then throttles.
	var first *domain.AuthSession
	err = f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA, OrganizationID: rlsOrgA}, func(txCtx context.Context) error {
		first, err = f.store.GetAuthSessionForRequest(txCtx, session.ID, rlsUserA)
		return err
	})
	if err != nil {
		t.Fatalf("resolve session: %v", err)
	}
	if first.LastSeenAt == nil {
		t.Fatal("first request must stamp last_seen_at")
	}
	var second *domain.AuthSession
	err = f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA, OrganizationID: rlsOrgA}, func(txCtx context.Context) error {
		second, err = f.store.GetAuthSessionForRequest(txCtx, session.ID, rlsUserA)
		return err
	})
	if err != nil {
		t.Fatalf("resolve session again: %v", err)
	}
	if !second.LastSeenAt.Equal(*first.LastSeenAt) {
		t.Fatal("last_seen_at must be throttled, not rewritten per request")
	}

	// select-org updates the scope in place on the SAME row. The switch must
	// stay coherent: a membership of rlsUserA in the TARGET organization.
	var membershipOrgBID string
	if _, err := f.admin.Exec(ctx, `
		INSERT INTO memberships (organization_id, user_id, roles)
		VALUES ($1, $2, ARRAY['admin']::TEXT[])`, rlsOrgB, rlsUserA); err != nil {
		t.Fatal(err)
	}
	if err := f.admin.QueryRow(ctx,
		`SELECT id FROM memberships WHERE organization_id=$1 AND user_id=$2`,
		rlsOrgB, rlsUserA).Scan(&membershipOrgBID); err != nil {
		t.Fatal(err)
	}
	err = f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA, OrganizationID: rlsOrgB}, func(txCtx context.Context) error {
		return f.store.UpdateAuthSessionScope(txCtx, session.ID, membershipOrgBID, rlsOrgB)
	})
	if err != nil {
		t.Fatalf("update scope: %v", err)
	}
	var activeOrg string
	if err := f.admin.QueryRow(ctx,
		`SELECT active_organization_id FROM auth_sessions WHERE id=$1`, session.ID).Scan(&activeOrg); err != nil {
		t.Fatal(err)
	}
	if activeOrg != rlsOrgB {
		t.Fatalf("active organization = %q, want %q", activeOrg, rlsOrgB)
	}

	// Revocation is idempotent and is the immediate cut for the middleware.
	var revoked bool
	err = f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA, OrganizationID: rlsOrgB}, func(txCtx context.Context) error {
		var err error
		revoked, err = f.store.RevokeAuthSession(txCtx, session.ID, rlsUserA, "unit test")
		return err
	})
	if err != nil || !revoked {
		t.Fatalf("revoke = %v/%v, want true", revoked, err)
	}
	var revokedAgain bool
	err = f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA, OrganizationID: rlsOrgB}, func(txCtx context.Context) error {
		var err error
		revokedAgain, err = f.store.RevokeAuthSession(txCtx, session.ID, rlsUserA, "unit test")
		return err
	})
	if err != nil || revokedAgain {
		t.Fatalf("second revoke = %v/%v, want false", revokedAgain, err)
	}
	var resolved *domain.AuthSession
	err = f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA, OrganizationID: rlsOrgB}, func(txCtx context.Context) error {
		var err error
		resolved, err = f.store.GetAuthSessionForRequest(txCtx, session.ID, rlsUserA)
		return err
	})
	if err != nil {
		t.Fatalf("resolve revoked session: %v", err)
	}
	if resolved.RevokedAt == nil {
		t.Fatal("revoked session must resolve with revoked_at set so middleware cuts it")
	}
}

// RLS negative proofs under the app role: another user cannot see or forge the
// owning user's registry rows, and an insert without the owning user context is
// refused by policy.
func TestAuthSessions_RLSScopesUnderAppRole(t *testing.T) {
	f := newRLSFixture(t)
	ctx := context.Background()

	absolute := time.Now().Add(authTestSessionTTL).UTC()
	// Org-less session (selection phase): an organization without a membership
	// is only valid for the support shape, which the shape CHECK rejects here.
	var session *domain.AuthSession
	err := f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA}, func(txCtx context.Context) error {
		created, err := f.store.CreateAuthSession(txCtx, storage.CreateAuthSessionCommand{
			UserID:            rlsUserA,
			ClientType:        domain.SessionClientWeb,
			AbsoluteExpiresAt: absolute,
		})
		session = created
		return err
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	// Another user's context cannot resolve the session (RLS hides the row; the
	// user filter is defense in depth).
	var other *domain.AuthSession
	err = f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserB, OrganizationID: rlsOrgB}, func(txCtx context.Context) error {
		var err error
		other, err = f.store.GetAuthSessionForRequest(txCtx, session.ID, rlsUserA)
		return err
	})
	if err == nil || other != nil {
		t.Fatalf("cross-user session resolution must fail: %v %+v", err, other)
	}

	// Direct SQL under the app role as user B sees no rows of user A.
	tx, err := f.app.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	setRLSActor(t, tx, rlsOrgB, rlsUserB, "")
	var visible int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM auth_sessions WHERE id=$1`, session.ID).Scan(&visible); err != nil {
		t.Fatal(err)
	}
	if visible != 0 {
		t.Fatalf("user B must not see user A's session row (visible=%d)", visible)
	}

	// An insert claiming another user's identity is refused by policy.
	if _, err := tx.Exec(ctx, `
		INSERT INTO auth_sessions (user_id, client_type, absolute_expires_at)
		VALUES ($1, 'web', NOW() + INTERVAL '1 hour')`, rlsUserA); err == nil {
		t.Fatal("insert as user B for user A must be rejected by RLS policy")
	}
}

// Negative proofs (#460 Blocker 2): the registry cannot store a scope that is
// inconsistent with the membership's user or organization. The database
// enforces it (composite FKs + scope-shape CHECK); storage translates the
// violations to ErrAuthSessionScopeIncoherent.
func TestAuthSessions_ScopeCoherenceRejected(t *testing.T) {
	f := newRLSFixture(t)
	ctx := context.Background()

	var membershipA, membershipB, membershipUserB string
	ids := map[string]*string{
		rlsOrgA + ":" + rlsUserA: &membershipA,
		rlsOrgB + ":" + rlsUserA: &membershipB,
		rlsOrgB + ":" + rlsUserB: &membershipUserB,
	}
	if _, err := f.admin.Exec(ctx, `
		INSERT INTO memberships (organization_id, user_id, roles) VALUES
		 ($1, $2, ARRAY['admin']::TEXT[]), ($3, $4, ARRAY['admin']::TEXT[])`,
		rlsOrgB, rlsUserA, rlsOrgA, rlsUserB); err != nil {
		t.Fatal(err)
	}
	rows, err := f.admin.Query(ctx, `SELECT organization_id, user_id, id FROM memberships`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var orgID, userID, id string
		if err := rows.Scan(&orgID, &userID, &id); err != nil {
			t.Fatal(err)
		}
		if target, ok := ids[orgID+":"+userID]; ok {
			*target = id
		}
	}
	rows.Close()
	if membershipA == "" || membershipB == "" || membershipUserB == "" {
		t.Fatal("fixture memberships missing")
	}

	absolute := time.Now().Add(authTestSessionTTL).UTC()
	newSession := func() *domain.AuthSession {
		t.Helper()
		var session *domain.AuthSession
		err := f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA, OrganizationID: rlsOrgA}, func(txCtx context.Context) error {
			created, err := f.store.CreateAuthSession(txCtx, storage.CreateAuthSessionCommand{
				UserID:            rlsUserA,
				MembershipID:      membershipA,
				OrganizationID:    rlsOrgA,
				ClientType:        domain.SessionClientWeb,
				AbsoluteExpiresAt: absolute,
			})
			session = created
			return err
		})
		if err != nil {
			t.Fatalf("create coherent session: %v", err)
		}
		return session
	}

	session := newSession()

	updateScope := func(membershipID, organizationID string) error {
		t.Helper()
		return f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA, OrganizationID: rlsOrgA}, func(txCtx context.Context) error {
			return f.store.UpdateAuthSessionScope(txCtx, session.ID, membershipID, organizationID)
		})
	}

	// membership of org A + active org B → rejected (composite FK).
	if err := updateScope(membershipA, rlsOrgB); !errors.Is(err, storage.ErrAuthSessionScopeIncoherent) {
		t.Fatalf("membership A + org B must be incoherent, got %v", err)
	}
	// membership belonging to another user (org B, user B) → rejected.
	if err := updateScope(membershipUserB, rlsOrgB); !errors.Is(err, storage.ErrAuthSessionScopeIncoherent) {
		t.Fatalf("membership of another user must be incoherent, got %v", err)
	}
	// random valid-but-foreign membership UUID → rejected.
	randomMembership := "7fffffff-0000-0000-0000-000000000105"
	if err := updateScope(randomMembership, rlsOrgA); !errors.Is(err, storage.ErrAuthSessionScopeIncoherent) {
		t.Fatalf("foreign membership uuid must be incoherent, got %v", err)
	}
	// half-empty scope → rejected by the storage guard before the database.
	if err := updateScope(membershipB, ""); !errors.Is(err, storage.ErrAuthSessionScopeIncoherent) {
		t.Fatalf("half-empty scope must be incoherent, got %v", err)
	}

	// Creation with a foreign membership is rejected too.
	err = f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA, OrganizationID: rlsOrgA}, func(txCtx context.Context) error {
		_, err := f.store.CreateAuthSession(txCtx, storage.CreateAuthSessionCommand{
			UserID:            rlsUserA,
			MembershipID:      membershipUserB,
			OrganizationID:    rlsOrgB,
			ClientType:        domain.SessionClientWeb,
			AbsoluteExpiresAt: absolute,
		})
		return err
	})
	if !errors.Is(err, storage.ErrAuthSessionScopeIncoherent) {
		t.Fatalf("create with another user's membership must be incoherent, got %v", err)
	}

	// The coherent switch (membership B of the SAME user, org B) passes.
	if err := updateScope(membershipB, rlsOrgB); err != nil {
		t.Fatalf("coherent scope update must pass: %v", err)
	}
}

// Direct-SQL RLS proofs (#460 Blocker 3) under granete_app:
//  1. self can read and update (revoke) their own session;
//  2. same-org ORDINARY member cannot read another member's session;
//  3. same-org ordinary member cannot update/revoke it either;
//  4. another organization's non-admin cannot read it;
//  5. platform staff reach any row through their explicit authority.
func TestAuthSessions_RLSSelfOrPlatformOnly(t *testing.T) {
	f := newRLSFixture(t)
	ctx := context.Background()

	// rlsUserC: ordinary (non-admin, non-platform) member of org A.
	rlsUserC := "20000000-0000-0000-0000-00000000000c"
	if _, err := f.admin.Exec(ctx, `
		INSERT INTO users (id, email, normalized_email, password_hash, name, account_status, platform_admin) VALUES
		 ($1, 'rls-c@example.test', 'rls-c@example.test', 'x', 'RLS C', 'active', FALSE)`, rlsUserC); err != nil {
		t.Fatal(err)
	}
	if _, err := f.admin.Exec(ctx, `
		INSERT INTO memberships (organization_id, user_id, roles)
		VALUES ($1, $2, ARRAY['vendedor']::TEXT[])`, rlsOrgA, rlsUserC); err != nil {
		t.Fatal(err)
	}

	var membershipUserA, membershipUserC string
	if err := f.admin.QueryRow(ctx,
		`SELECT id FROM memberships WHERE organization_id=$1 AND user_id=$2`,
		rlsOrgA, rlsUserA).Scan(&membershipUserA); err != nil {
		t.Fatal(err)
	}
	if err := f.admin.QueryRow(ctx,
		`SELECT id FROM memberships WHERE organization_id=$1 AND user_id=$2`,
		rlsOrgA, rlsUserC).Scan(&membershipUserC); err != nil {
		t.Fatal(err)
	}
	var sessionA *domain.AuthSession
	err := f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA, OrganizationID: rlsOrgA}, func(txCtx context.Context) error {
		created, err := f.store.CreateAuthSession(txCtx, storage.CreateAuthSessionCommand{
			UserID:            rlsUserA,
			MembershipID:      membershipUserA,
			OrganizationID:    rlsOrgA,
			ClientType:        domain.SessionClientWeb,
			AbsoluteExpiresAt: time.Now().Add(authTestSessionTTL).UTC(),
		})
		sessionA = created
		return err
	})
	if err != nil {
		t.Fatalf("create session A: %v", err)
	}
	var sessionC *domain.AuthSession
	err = f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserC, OrganizationID: rlsOrgA}, func(txCtx context.Context) error {
		created, err := f.store.CreateAuthSession(txCtx, storage.CreateAuthSessionCommand{
			UserID:            rlsUserC,
			MembershipID:      membershipUserC,
			OrganizationID:    rlsOrgA,
			ClientType:        domain.SessionClientWeb,
			AbsoluteExpiresAt: time.Now().Add(authTestSessionTTL).UTC(),
		})
		sessionC = created
		return err
	})
	if err != nil {
		t.Fatalf("create session C: %v", err)
	}

	// 1. Self: read + revoke own row.
	selfTx, err := f.app.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer selfTx.Rollback(ctx)
	setRLSActor(t, selfTx, rlsOrgA, rlsUserA, "")
	var visible int
	if err := selfTx.QueryRow(ctx, `SELECT count(*) FROM auth_sessions WHERE id=$1`, sessionA.ID).Scan(&visible); err != nil {
		t.Fatal(err)
	}
	if visible != 1 {
		t.Fatalf("self must see own session (visible=%d)", visible)
	}
	tag, err := selfTx.Exec(ctx, `UPDATE auth_sessions SET revoke_reason='self test' WHERE id=$1`, sessionA.ID)
	if err != nil || tag.RowsAffected() != 1 {
		t.Fatalf("self must update own session: rows=%d err=%v", tag.RowsAffected(), err)
	}

	// 2 + 3. Same-org ordinary member: user C cannot even SEE user A's session,
	// let alone update it.
	memberTx, err := f.app.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer memberTx.Rollback(ctx)
	setRLSActor(t, memberTx, rlsOrgA, rlsUserC, "")
	if err := memberTx.QueryRow(ctx, `SELECT count(*) FROM auth_sessions WHERE id=$1`, sessionA.ID).Scan(&visible); err != nil {
		t.Fatal(err)
	}
	if visible != 0 {
		t.Fatalf("same-org ordinary member must not see another member's session (visible=%d)", visible)
	}
	tag, err = memberTx.Exec(ctx, `UPDATE auth_sessions SET revoked_at=NOW() WHERE id=$1`, sessionA.ID)
	if err != nil || tag.RowsAffected() != 0 {
		t.Fatalf("same-org ordinary member must not revoke another member's session: rows=%d err=%v", tag.RowsAffected(), err)
	}

	// 4. Other organization, ordinary member (user B of org B): invisible.
	otherTx, err := f.app.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer otherTx.Rollback(ctx)
	setRLSActor(t, otherTx, rlsOrgB, rlsUserB, "")
	if err := otherTx.QueryRow(ctx, `SELECT count(*) FROM auth_sessions WHERE id=$1`, sessionA.ID).Scan(&visible); err != nil {
		t.Fatal(err)
	}
	if visible != 0 {
		t.Fatalf("other-org member must not see the session (visible=%d)", visible)
	}

	// 5. Platform authority (rlsUserA is platform staff in this fixture): may
	// read and update another user's registry row through the explicit
	// platform path — this is the console/support boundary, not tenant scope.
	platformTx, err := f.app.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer platformTx.Rollback(ctx)
	setRLSActor(t, platformTx, "", rlsUserA, "")
	if err := platformTx.QueryRow(ctx, `SELECT count(*) FROM auth_sessions WHERE id=$1`, sessionC.ID).Scan(&visible); err != nil {
		t.Fatal(err)
	}
	if visible != 1 {
		t.Fatalf("platform admin must see any session row (visible=%d)", visible)
	}
	tag, err = platformTx.Exec(ctx, `UPDATE auth_sessions SET revoke_reason='platform test' WHERE id=$1`, sessionC.ID)
	if err != nil || tag.RowsAffected() != 1 {
		t.Fatalf("platform admin must be able to update any session row: rows=%d err=%v", tag.RowsAffected(), err)
	}
}

const authTestSessionTTL = 18 * time.Hour
