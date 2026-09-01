package storage_test

import (
	"context"
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

	// select-org updates the scope in place on the SAME row.
	err = f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA, OrganizationID: rlsOrgA}, func(txCtx context.Context) error {
		return f.store.UpdateAuthSessionScope(txCtx, session.ID, membershipID, rlsOrgB)
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
	var session *domain.AuthSession
	err := f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA, OrganizationID: rlsOrgA}, func(txCtx context.Context) error {
		created, err := f.store.CreateAuthSession(txCtx, storage.CreateAuthSessionCommand{
			UserID:            rlsUserA,
			OrganizationID:    rlsOrgA,
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

const authTestSessionTTL = 18 * time.Hour
