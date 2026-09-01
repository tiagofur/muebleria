package storage_test

import (
	"bytes"
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func authRefreshMigrationSQL(t *testing.T, suffix string) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000106_auth_refresh_credentials." + suffix + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func TestAuthRefresh_MigrationFreshAndUpgrade(t *testing.T) {
	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 106)
	assertAuthRefreshSchema(t, fresh)

	upgrade := multiOrgFreshDB(t)
	identityApplyThrough(t, upgrade, 105)
	if _, err := upgrade.Exec(context.Background(), authRefreshMigrationSQL(t, "up")); err != nil {
		t.Fatalf("upgrade apply 000106: %v", err)
	}
	assertAuthRefreshSchema(t, upgrade)
}

func assertAuthRefreshSchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	for _, table := range []string{"auth_refresh_families", "auth_refresh_credentials"} {
		var classification string
		if err := pool.QueryRow(context.Background(), `SELECT classification FROM rls_policy_inventory WHERE table_name=$1`, table).Scan(&classification); err != nil {
			t.Fatalf("%s inventory: %v", table, err)
		}
		if classification != "platform-global" {
			t.Fatalf("%s classification=%q", table, classification)
		}
		var rls, forced bool
		if err := pool.QueryRow(context.Background(), `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname=$1`, table).Scan(&rls, &forced); err != nil {
			t.Fatal(err)
		}
		if !rls || !forced {
			t.Fatalf("%s RLS enabled=%v forced=%v", table, rls, forced)
		}
	}
	var rawColumns int
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM information_schema.columns
		WHERE table_name IN ('auth_refresh_families','auth_refresh_credentials')
		  AND column_name IN ('secret','token','refresh_token','raw_secret')`).Scan(&rawColumns); err != nil {
		t.Fatal(err)
	}
	if rawColumns != 0 {
		t.Fatal("refresh schema must not have a plaintext credential column")
	}
}

func createRefreshFixture(t *testing.T, f *rlsFixture, verifier []byte) (*domain.AuthSession, *storage.AuthRefreshCredential) {
	return createRefreshFixtureUntil(t, f, verifier, time.Now().Add(18*time.Hour).UTC())
}

func createRefreshFixtureUntil(t *testing.T, f *rlsFixture, verifier []byte, absoluteExpiresAt time.Time) (*domain.AuthSession, *storage.AuthRefreshCredential) {
	return createRefreshForScope(t, f, rlsOrgA, rlsUserA, verifier, absoluteExpiresAt)
}

func createRefreshForScope(t *testing.T, f *rlsFixture, organizationID, userID string, verifier []byte, absoluteExpiresAt time.Time) (*domain.AuthSession, *storage.AuthRefreshCredential) {
	t.Helper()
	ctx := context.Background()
	var membershipID string
	if err := f.admin.QueryRow(ctx, `SELECT id FROM memberships WHERE organization_id=$1 AND user_id=$2`, organizationID, userID).Scan(&membershipID); err != nil {
		t.Fatal(err)
	}
	var session *domain.AuthSession
	var credential *storage.AuthRefreshCredential
	err := f.store.WithinTenantTx(ctx, storage.TenantActor{UserID: userID, OrganizationID: organizationID}, func(txCtx context.Context) error {
		created, err := f.store.CreateAuthSession(txCtx, storage.CreateAuthSessionCommand{
			UserID: userID, MembershipID: membershipID, OrganizationID: organizationID,
			ClientType: domain.SessionClientWeb, AbsoluteExpiresAt: absoluteExpiresAt,
		})
		if err != nil {
			return err
		}
		session = created
		credential, err = f.store.CreateAuthRefreshCredential(txCtx, storage.CreateAuthRefreshCredentialCommand{
			SessionID: created.ID, UserID: created.UserID, Verifier: verifier,
		})
		return err
	})
	if err != nil {
		t.Fatalf("create refresh fixture: %v", err)
	}
	return session, credential
}

func TestAuthRefresh_MembershipRevocationDoesNotCrossIndependentSession(t *testing.T) {
	f := newRLSFixture(t)
	if _, err := f.admin.Exec(context.Background(), `
		INSERT INTO memberships (organization_id, user_id, roles)
		VALUES ($1, $2, ARRAY['admin']::text[])`, rlsOrgB, rlsUserA); err != nil {
		t.Fatal(err)
	}
	verifierA := bytes.Repeat([]byte{0x0c}, 32)
	verifierB := bytes.Repeat([]byte{0x0d}, 32)
	sessionA, _ := createRefreshForScope(t, f, rlsOrgA, rlsUserA, verifierA, time.Now().Add(time.Hour))
	sessionB, _ := createRefreshForScope(t, f, rlsOrgB, rlsUserA, verifierB, time.Now().Add(time.Hour))
	var membershipA string
	var versionA int64
	if err := f.admin.QueryRow(context.Background(), `SELECT id, version FROM memberships WHERE organization_id=$1 AND user_id=$2`, rlsOrgA, rlsUserA).Scan(&membershipA, &versionA); err != nil {
		t.Fatal(err)
	}
	if err := f.store.WithinTenantTx(context.Background(), storage.TenantActor{OrganizationID: rlsOrgA, UserID: rlsUserA}, func(txCtx context.Context) error {
		_, err := f.store.RevokeMembershipSessions(txCtx, rlsOrgA, membershipA, rlsUserA, "test org A only", versionA)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.RotateAuthRefreshCredential(context.Background(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: verifierA, NextVerifier: bytes.Repeat([]byte{0x0e}, 32), ExpectedClient: domain.SessionClientWeb,
	}, func(context.Context, storage.AuthRefreshRotation) error { return nil }); !errors.Is(err, storage.ErrRefreshSessionRevoked) {
		t.Fatalf("org A refresh after membership revocation=%v", err)
	}
	if _, err := f.store.RotateAuthRefreshCredential(context.Background(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: verifierB, NextVerifier: bytes.Repeat([]byte{0x0f}, 32), ExpectedClient: domain.SessionClientWeb,
	}, func(context.Context, storage.AuthRefreshRotation) error { return nil }); err != nil {
		t.Fatalf("independent org B refresh must remain valid: %v", err)
	}
	var revokedA, revokedB bool
	if err := f.admin.QueryRow(context.Background(), `SELECT revoked_at IS NOT NULL FROM auth_sessions WHERE id=$1`, sessionA.ID).Scan(&revokedA); err != nil {
		t.Fatal(err)
	}
	if err := f.admin.QueryRow(context.Background(), `SELECT revoked_at IS NOT NULL FROM auth_sessions WHERE id=$1`, sessionB.ID).Scan(&revokedB); err != nil {
		t.Fatal(err)
	}
	if !revokedA || revokedB {
		t.Fatalf("session isolation revokedA=%v revokedB=%v", revokedA, revokedB)
	}
}

func TestAuthRefresh_RotationNeverSlidesPastAbsoluteExpiry(t *testing.T) {
	f := newRLSFixture(t)
	presented := bytes.Repeat([]byte{0x09}, 32)
	next := bytes.Repeat([]byte{0x0a}, 32)
	absolute := time.Now().Add(250 * time.Millisecond).UTC()
	session, _ := createRefreshFixtureUntil(t, f, presented, absolute)
	rotation, err := f.store.RotateAuthRefreshCredential(context.Background(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: presented, NextVerifier: next, ExpectedClient: domain.SessionClientWeb,
	}, func(context.Context, storage.AuthRefreshRotation) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if !rotation.ExpiresAt.Equal(session.AbsoluteExpiresAt) {
		t.Fatalf("rotated expiry=%s, want original absolute=%s", rotation.ExpiresAt, session.AbsoluteExpiresAt)
	}
	time.Sleep(time.Until(session.AbsoluteExpiresAt) + 30*time.Millisecond)
	_, err = f.store.RotateAuthRefreshCredential(context.Background(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: next, NextVerifier: bytes.Repeat([]byte{0x0b}, 32), ExpectedClient: domain.SessionClientWeb,
	}, func(context.Context, storage.AuthRefreshRotation) error { return nil })
	if !errors.Is(err, storage.ErrRefreshExpired) && !errors.Is(err, storage.ErrRefreshSessionRevoked) {
		t.Fatalf("credential after original absolute expiry=%v", err)
	}
}

func TestAuthRefresh_RotationReplayAndAbsoluteCap(t *testing.T) {
	f := newRLSFixture(t)
	presented := bytes.Repeat([]byte{0x11}, 32)
	next := bytes.Repeat([]byte{0x22}, 32)
	session, initial := createRefreshFixture(t, f, presented)
	probe, err := f.app.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := probe.Exec(context.Background(), `SELECT set_config('app.refresh_verifier', encode($1::bytea, 'hex'), true)`, presented); err != nil {
		t.Fatal(err)
	}
	var probeVisible int
	if err := probe.QueryRow(context.Background(), `SELECT count(*) FROM auth_refresh_credentials WHERE secret_verifier=$1`, presented).Scan(&probeVisible); err != nil {
		t.Fatal(err)
	}
	probe.Rollback(context.Background())
	if probeVisible != 1 {
		t.Fatalf("verifier-scoped RLS probe visible=%d", probeVisible)
	}

	rotation, err := f.store.RotateAuthRefreshCredential(context.Background(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: presented, NextVerifier: next, ExpectedClient: domain.SessionClientWeb,
	}, func(context.Context, storage.AuthRefreshRotation) error { return nil })
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if rotation.Generation != 2 || rotation.CurrentID != initial.ID || rotation.NextID == "" {
		t.Fatalf("unexpected rotation: %+v", rotation)
	}
	if !rotation.ExpiresAt.Equal(session.AbsoluteExpiresAt) {
		t.Fatalf("refresh expiry=%s must equal absolute cap=%s", rotation.ExpiresAt, session.AbsoluteExpiresAt)
	}

	_, err = f.store.RotateAuthRefreshCredential(context.Background(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: presented, NextVerifier: bytes.Repeat([]byte{0x33}, 32), ExpectedClient: domain.SessionClientWeb,
	}, func(context.Context, storage.AuthRefreshRotation) error { return nil })
	if !errors.Is(err, storage.ErrRefreshReused) {
		t.Fatalf("replay error=%v, want ErrRefreshReused", err)
	}
	_, err = f.store.RotateAuthRefreshCredential(context.Background(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: next, NextVerifier: bytes.Repeat([]byte{0x44}, 32), ExpectedClient: domain.SessionClientWeb,
	}, func(context.Context, storage.AuthRefreshRotation) error { return nil })
	if !errors.Is(err, storage.ErrRefreshRevoked) && !errors.Is(err, storage.ErrRefreshSessionRevoked) {
		t.Fatalf("replacement after replay error=%v, want revoked", err)
	}
	var sessionRevoked, familyRevoked bool
	if err := f.admin.QueryRow(context.Background(), `
		SELECT s.revoked_at IS NOT NULL, f.revoked_at IS NOT NULL
		FROM auth_sessions s JOIN auth_refresh_families f ON f.session_id=s.id WHERE s.id=$1`, session.ID).
		Scan(&sessionRevoked, &familyRevoked); err != nil {
		t.Fatal(err)
	}
	if !sessionRevoked || !familyRevoked {
		t.Fatal("reuse must revoke both session and family")
	}
}

func TestAuthRefresh_ClientTypesCannotInterchange(t *testing.T) {
	f := newRLSFixture(t)
	presented := bytes.Repeat([]byte{0x31}, 32)
	_, _ = createRefreshFixture(t, f, presented)
	_, err := f.store.RotateAuthRefreshCredential(context.Background(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: presented, NextVerifier: bytes.Repeat([]byte{0x32}, 32), ExpectedClient: domain.SessionClientMobile,
	}, func(context.Context, storage.AuthRefreshRotation) error { return nil })
	if !errors.Is(err, storage.ErrRefreshTypeMismatch) {
		t.Fatalf("web credential as mobile=%v, want type mismatch", err)
	}
	if _, err := f.store.RotateAuthRefreshCredential(context.Background(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: presented, NextVerifier: bytes.Repeat([]byte{0x33}, 32), ExpectedClient: domain.SessionClientWeb,
	}, func(context.Context, storage.AuthRefreshRotation) error { return nil }); err != nil {
		t.Fatalf("type mismatch must not consume credential: %v", err)
	}
}

func TestAuthRefresh_ConcurrentUseCreatesAtMostOneDescendant(t *testing.T) {
	f := newRLSFixture(t)
	presented := bytes.Repeat([]byte{0x51}, 32)
	session, _ := createRefreshFixture(t, f, presented)

	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i, marker := range []byte{0x61, 0x62} {
		wg.Add(1)
		go func(i int, marker byte) {
			defer wg.Done()
			<-start
			_, err := f.store.RotateAuthRefreshCredential(context.Background(), storage.RotateAuthRefreshCredentialCommand{
				PresentedVerifier: presented, NextVerifier: bytes.Repeat([]byte{marker}, 32), ExpectedClient: domain.SessionClientWeb,
			}, func(context.Context, storage.AuthRefreshRotation) error { return nil })
			results <- err
		}(i, marker)
	}
	close(start)
	wg.Wait()
	close(results)
	successes, reuses := 0, 0
	for err := range results {
		if err == nil {
			successes++
		} else if errors.Is(err, storage.ErrRefreshReused) {
			reuses++
		} else {
			t.Fatalf("unexpected concurrent result: %v", err)
		}
	}
	if successes != 1 || reuses != 1 {
		t.Fatalf("successes=%d reuses=%d, want 1/1", successes, reuses)
	}
	var descendants int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM auth_refresh_credentials WHERE session_id=$1`, session.ID).Scan(&descendants); err != nil {
		t.Fatal(err)
	}
	if descendants != 2 {
		t.Fatalf("credential rows=%d, want original + exactly one descendant", descendants)
	}
}

func TestAuthRefresh_CallbackFailureRollsBackConsumption(t *testing.T) {
	f := newRLSFixture(t)
	presented := bytes.Repeat([]byte{0x71}, 32)
	_, initial := createRefreshFixture(t, f, presented)
	injected := errors.New("mint access failed")
	_, err := f.store.RotateAuthRefreshCredential(context.Background(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: presented, NextVerifier: bytes.Repeat([]byte{0x72}, 32), ExpectedClient: domain.SessionClientWeb,
	}, func(context.Context, storage.AuthRefreshRotation) error { return injected })
	if !errors.Is(err, injected) {
		t.Fatalf("rotation error=%v", err)
	}
	var usedAt *time.Time
	var count int
	if err := f.admin.QueryRow(context.Background(), `SELECT used_at FROM auth_refresh_credentials WHERE id=$1`, initial.ID).Scan(&usedAt); err != nil {
		t.Fatal(err)
	}
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM auth_refresh_credentials WHERE family_id=$1`, initial.FamilyID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if usedAt != nil || count != 1 {
		t.Fatalf("failed mint must preserve R1 and create no R2: used=%v rows=%d", usedAt, count)
	}
}

func TestAuthRefresh_CommitFailureRollsBackConsumption(t *testing.T) {
	f := newRLSFixture(t)
	presented := bytes.Repeat([]byte{0x73}, 32)
	_, initial := createRefreshFixture(t, f, presented)
	if _, err := f.admin.Exec(context.Background(), `
		CREATE FUNCTION fail_refresh_commit() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'injected deferred commit failure'; END $$;
		CREATE CONSTRAINT TRIGGER fail_refresh_commit_trigger
		AFTER INSERT ON auth_refresh_credentials DEFERRABLE INITIALLY DEFERRED
		FOR EACH ROW WHEN (NEW.generation = 2) EXECUTE FUNCTION fail_refresh_commit()`); err != nil {
		t.Fatal(err)
	}
	_, err := f.store.RotateAuthRefreshCredential(context.Background(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: presented, NextVerifier: bytes.Repeat([]byte{0x74}, 32), ExpectedClient: domain.SessionClientWeb,
	}, func(context.Context, storage.AuthRefreshRotation) error { return nil })
	if err == nil {
		t.Fatal("expected injected commit failure")
	}
	assertRefreshUnconsumed(t, f, initial)
}

func TestAuthRefresh_AuditFailureRollsBackConsumption(t *testing.T) {
	f := newRLSFixture(t)
	presented := bytes.Repeat([]byte{0x75}, 32)
	_, initial := createRefreshFixture(t, f, presented)
	if _, err := f.admin.Exec(context.Background(), `
		CREATE FUNCTION fail_refresh_audit() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.event_type = 'refresh_rotated' THEN RAISE EXCEPTION 'injected audit failure'; END IF;
			RETURN NEW;
		END $$;
		CREATE TRIGGER fail_refresh_audit_trigger BEFORE INSERT ON security_audit_events
		FOR EACH ROW EXECUTE FUNCTION fail_refresh_audit()`); err != nil {
		t.Fatal(err)
	}
	_, err := f.store.RotateAuthRefreshCredential(context.Background(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: presented, NextVerifier: bytes.Repeat([]byte{0x76}, 32), ExpectedClient: domain.SessionClientWeb,
	}, func(context.Context, storage.AuthRefreshRotation) error { return nil })
	if err == nil {
		t.Fatal("expected injected durable audit failure")
	}
	assertRefreshUnconsumed(t, f, initial)
}

func TestAuthRefresh_ReuseRevocationFailureRollsBack(t *testing.T) {
	f := newRLSFixture(t)
	presented := bytes.Repeat([]byte{0x77}, 32)
	next := bytes.Repeat([]byte{0x78}, 32)
	session, _ := createRefreshFixture(t, f, presented)
	if _, err := f.store.RotateAuthRefreshCredential(context.Background(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: presented, NextVerifier: next, ExpectedClient: domain.SessionClientWeb,
	}, func(context.Context, storage.AuthRefreshRotation) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := f.admin.Exec(context.Background(), `
		CREATE FUNCTION fail_reuse_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.revoke_reason = 'refresh_reuse_detected' THEN RAISE EXCEPTION 'injected revoke failure'; END IF;
			RETURN NEW;
		END $$;
		CREATE TRIGGER fail_reuse_revoke_trigger BEFORE UPDATE ON auth_sessions
		FOR EACH ROW EXECUTE FUNCTION fail_reuse_revoke()`); err != nil {
		t.Fatal(err)
	}
	_, err := f.store.RotateAuthRefreshCredential(context.Background(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: presented, NextVerifier: bytes.Repeat([]byte{0x79}, 32), ExpectedClient: domain.SessionClientWeb,
	}, func(context.Context, storage.AuthRefreshRotation) error { return nil })
	if err == nil || errors.Is(err, storage.ErrRefreshReused) {
		t.Fatalf("reuse must surface revocation failure, got %v", err)
	}
	var revoked bool
	if err := f.admin.QueryRow(context.Background(), `SELECT revoked_at IS NOT NULL FROM auth_sessions WHERE id=$1`, session.ID).Scan(&revoked); err != nil {
		t.Fatal(err)
	}
	if revoked {
		t.Fatal("failed reuse revocation must roll back partial state")
	}
	if _, err := f.admin.Exec(context.Background(), `DROP TRIGGER fail_reuse_revoke_trigger ON auth_sessions`); err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.RotateAuthRefreshCredential(context.Background(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: next, NextVerifier: bytes.Repeat([]byte{0x7a}, 32), ExpectedClient: domain.SessionClientWeb,
	}, func(context.Context, storage.AuthRefreshRotation) error { return nil }); err != nil {
		t.Fatalf("R2 must remain usable after rolled-back reuse revocation: %v", err)
	}
}

func assertRefreshUnconsumed(t *testing.T, f *rlsFixture, initial *storage.AuthRefreshCredential) {
	t.Helper()
	var usedAt *time.Time
	var count int
	if err := f.admin.QueryRow(context.Background(), `SELECT used_at FROM auth_refresh_credentials WHERE id=$1`, initial.ID).Scan(&usedAt); err != nil {
		t.Fatal(err)
	}
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM auth_refresh_credentials WHERE family_id=$1`, initial.FamilyID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if usedAt != nil || count != 1 {
		t.Fatalf("rotation rollback must preserve R1 and create no R2: used=%v rows=%d", usedAt, count)
	}
}

func TestAuthRefresh_LogoutIsIdempotentAndRLSVerifierIsExact(t *testing.T) {
	f := newRLSFixture(t)
	verifier := bytes.Repeat([]byte{0x81}, 32)
	session, credential := createRefreshFixture(t, f, verifier)
	if err := f.store.LogoutByRefreshCredential(context.Background(), verifier, "127.0.0.1", "req-logout"); err != nil {
		t.Fatal(err)
	}
	if err := f.store.LogoutByRefreshCredential(context.Background(), verifier, "127.0.0.1", "req-logout-2"); err != nil {
		t.Fatalf("second logout: %v", err)
	}

	tx, err := f.app.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	setRLSActor(t, tx, rlsOrgB, rlsUserB, "")
	var visible int
	if err := tx.QueryRow(context.Background(), `SELECT count(*) FROM auth_refresh_credentials WHERE id=$1`, credential.ID).Scan(&visible); err != nil {
		t.Fatal(err)
	}
	if visible != 0 {
		t.Fatal("other user must not see refresh row")
	}

	var revoked bool
	if err := f.admin.QueryRow(context.Background(), `SELECT revoked_at IS NOT NULL FROM auth_sessions WHERE id=$1`, session.ID).Scan(&revoked); err != nil {
		t.Fatal(err)
	}
	if !revoked {
		t.Fatal("logout must revoke auth session")
	}
}
