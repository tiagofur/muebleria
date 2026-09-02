package storage_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #460 / SEC-7: MFA factors, recovery codes and step-up authority. These
// integration tests run against real PostgreSQL under the app role: the
// enrollment lifecycle (pending is never active, expiry is terminal), TOTP
// replay with concurrency, single-use recovery codes with concurrency, the
// sid/scope-bound step-up grants (TTL, session replacement, revocation,
// scope isolation) and the audit trail — never the secrets themselves.

func mfaMigrationSQL(t *testing.T, suffix string) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000109_auth_mfa." + suffix + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func assertMFAPolicies(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	for _, table := range []string{"auth_mfa_factors", "auth_mfa_recovery_codes", "auth_step_up_grants"} {
		var rls, force bool
		if err := pool.QueryRow(ctx, `
			SELECT relrowsecurity, relforcerowsecurity
			FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname='public' AND c.relname=$1`, table).Scan(&rls, &force); err != nil {
			t.Fatalf("table %s: %v", table, err)
		}
		if !rls || !force {
			t.Fatalf("%s must have FORCE ROW LEVEL SECURITY", table)
		}
		var classification string
		if err := pool.QueryRow(ctx,
			`SELECT classification FROM rls_policy_inventory WHERE table_name=$1`, table).Scan(&classification); err != nil {
			t.Fatalf("inventory %s: %v", table, err)
		}
		if classification != "platform-global" {
			t.Fatalf("%s classification = %q, want platform-global", table, classification)
		}
	}
}

func TestAuthMFA_MigrationFreshAndUpgrade(t *testing.T) {
	ctx := context.Background()

	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 109)
	assertMFAPolicies(t, fresh)

	upgrade := multiOrgFreshDB(t)
	identityApplyThrough(t, upgrade, 108)
	if _, err := upgrade.Exec(ctx, mfaMigrationSQL(t, "up")); err != nil {
		t.Fatalf("upgrade apply 000109: %v", err)
	}
	assertMFAPolicies(t, upgrade)

	if _, err := upgrade.Exec(ctx, mfaMigrationSQL(t, "down")); err != nil {
		t.Fatalf("down 000109: %v", err)
	}
	var gone *string
	if err := upgrade.QueryRow(ctx, `SELECT to_regclass('public.auth_step_up_grants')`).Scan(&gone); err != nil {
		t.Fatal(err)
	}
	if gone != nil {
		t.Fatal("down migration must drop auth_step_up_grants")
	}
}

// mfaHarness bundles everything the MFA flows need for one user.
type mfaHarness struct {
	store         *storage.PostgresStore
	admin         *pgxpool.Pool
	app           *pgxpool.Pool
	secrets       *auth.MFASecrets
	userID        string
	rawTOTP       []byte
	factorID      string
	recoveryCodes []string
}

const mfaTestUserA = "20000000-0000-0000-0000-00000000000a"
const mfaTestUserB = "20000000-0000-0000-0000-00000000000b"

func newMFAHarness(t *testing.T, userID string) *mfaHarness {
	t.Helper()
	f := newRLSFixture(t)
	keyring, err := auth.NewMFAKeyring("test", map[string][]byte{"test": []byte("mfa-storage-test-key-32-bytes-ok!")})
	if err != nil {
		t.Fatal(err)
	}
	secrets, err := auth.NewMFASecrets(keyring)
	if err != nil {
		t.Fatal(err)
	}
	return &mfaHarness{store: f.store, admin: f.admin, app: f.app, secrets: secrets, userID: userID}
}

// enroll walks begin+verify so the user ends with one ENABLED factor, a
// known raw TOTP secret and a live recovery batch. The accepted counter is
// returned for replay proofs.
func (h *mfaHarness) enroll(t *testing.T, factorIDSuffix string) (counter int64) {
	t.Helper()
	ctx := context.Background()
	raw, _, err := auth.GenerateTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	sealed, kid, err := h.secrets.EncryptTOTPSecret(raw)
	if err != nil {
		t.Fatal(err)
	}
	pending, err := h.store.CreateMFAEnrollment(ctx, storage.CreateMFAEnrollmentCommand{
		UserID:           h.userID,
		FactorID:         "30000000-0000-0000-0000-0000000000" + factorIDSuffix,
		EncryptedSecret:  sealed,
		EncryptionKid:    kid,
		PendingExpiresAt: time.Now().Add(storage.MFAEnrollmentTTL).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if pending.Status != domain.MFAFactorStatusPending {
		t.Fatalf("new enrollment must be pending, got %s", pending.Status)
	}
	h.rawTOTP = raw
	h.factorID = pending.ID

	// A pending factor is NOT active: no step-up can be verified with it.
	if _, err := h.store.VerifyMFAStepUp(ctx, storage.MFAStepUpCommand{
		UserID: h.userID, SessionID: h.createSession(t).ID,
		Scope: domain.StepUpScopeSecurityAdmin, Method: domain.StepUpMethodTOTP,
		Code: auth.TOTPCode(raw, auth.TOTPCounter(time.Now())), Secrets: h.secrets,
	}); !errors.Is(err, storage.ErrMFANoEnabledFactor) {
		t.Fatalf("pending factor must not authorize step-up, got %v", err)
	}

	counter = auth.TOTPCounter(time.Now())
	enabled, err := h.store.EnableMFAFactor(ctx, storage.EnableMFAFactorCommand{
		UserID: h.userID, FactorID: pending.ID,
		Code: auth.TOTPCode(raw, counter), Secrets: h.secrets,
	})
	if err != nil {
		t.Fatalf("enable: %v", err)
	}
	if enabled.Factor.Status != domain.MFAFactorStatusEnabled || enabled.Factor.EnabledAt == nil {
		t.Fatalf("factor must be enabled: %+v", enabled.Factor)
	}
	if len(enabled.RecoveryCodes) != storage.MFARecoveryCodeCount {
		t.Fatalf("recovery codes: %d", len(enabled.RecoveryCodes))
	}
	h.recoveryCodes = enabled.RecoveryCodes
	return counter
}

// createSession mints a registry session for the harness user.
func (h *mfaHarness) createSession(t *testing.T) *domain.AuthSession {
	t.Helper()
	var session *domain.AuthSession
	err := h.store.WithinTenantTx(context.Background(), storage.TenantActor{UserID: h.userID}, func(txCtx context.Context) error {
		created, err := h.store.CreateAuthSession(txCtx, storage.CreateAuthSessionCommand{
			UserID:            h.userID,
			ClientType:        domain.SessionClientWeb,
			AbsoluteExpiresAt: time.Now().Add(time.Hour).UTC(),
		})
		session = created
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return session
}

// codeFor computes the TOTP for the first non-replayed counter at or after
// `last`. When the ±1 window cannot satisfy it yet (a second verification in
// the same 30s interval), the harness waits for the next interval.
func (h *mfaHarness) codeFor(t *testing.T, last int64) (string, int64) {
	t.Helper()
	next := last + 1
	if current := auth.TOTPCounter(time.Now()); next > current+1 {
		time.Sleep(time.Until(time.Unix((next-1)*int64(auth.TOTPPeriod.Seconds()), 0)) + 100*time.Millisecond)
	}
	return auth.TOTPCode(h.rawTOTP, next), next
}

func TestAuthMFA_EnrollmentLifecycle(t *testing.T) {
	h := newMFAHarness(t, mfaTestUserA)
	ctx := context.Background()

	raw, _, _ := auth.GenerateTOTPSecret()
	sealed, kid, err := h.secrets.EncryptTOTPSecret(raw)
	if err != nil {
		t.Fatal(err)
	}

	// Invalid code leaves the factor pending.
	pending, err := h.store.CreateMFAEnrollment(ctx, storage.CreateMFAEnrollmentCommand{
		UserID: h.userID, FactorID: "30000000-0000-0000-0000-0000000000e1",
		EncryptedSecret: sealed, EncryptionKid: kid,
		PendingExpiresAt: time.Now().Add(storage.MFAEnrollmentTTL).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.store.EnableMFAFactor(ctx, storage.EnableMFAFactorCommand{
		UserID: h.userID, FactorID: pending.ID,
		Code: "000000", Secrets: h.secrets,
	}); !errors.Is(err, storage.ErrMFAInvalidCode) {
		t.Fatalf("invalid code must not enable, got %v", err)
	}
	factor, err := h.store.GetMFAFactor(ctx, h.userID, pending.ID)
	if err != nil || factor.Status != domain.MFAFactorStatusPending {
		t.Fatalf("factor must stay pending: %+v err=%v", factor, err)
	}

	// An expired enrollment can never be enabled (time-travel via SQL).
	expired, err := h.store.CreateMFAEnrollment(ctx, storage.CreateMFAEnrollmentCommand{
		UserID: h.userID, FactorID: "30000000-0000-0000-0000-0000000000e2",
		EncryptedSecret: sealed, EncryptionKid: kid,
		PendingExpiresAt: time.Now().Add(storage.MFAEnrollmentTTL).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.admin.Exec(ctx,
		`UPDATE auth_mfa_factors SET pending_expires_at = NOW() - INTERVAL '1 minute' WHERE id=$1`, expired.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := h.store.EnableMFAFactor(ctx, storage.EnableMFAFactorCommand{
		UserID: h.userID, FactorID: expired.ID,
		Code: auth.TOTPCode(raw, auth.TOTPCounter(time.Now())), Secrets: h.secrets,
	}); !errors.Is(err, storage.ErrMFAEnrollmentExpired) {
		t.Fatalf("expired enrollment must not enable, got %v", err)
	}
}

func TestAuthMFA_TOTPReplayProtection(t *testing.T) {
	h := newMFAHarness(t, mfaTestUserA)
	counter := h.enroll(t, "01")
	ctx := context.Background()
	session := h.createSession(t)

	code, counter := h.codeFor(t, counter)
	cmd := storage.MFAStepUpCommand{
		UserID: h.userID, SessionID: session.ID,
		Scope: domain.StepUpScopeSecurityAdmin, Method: domain.StepUpMethodTOTP,
		Code: code, Secrets: h.secrets,
	}
	first, err := h.store.VerifyMFAStepUp(ctx, cmd)
	if err != nil {
		t.Fatalf("first verification: %v", err)
	}
	if first.ExpiresAt.Before(time.Now()) || first.ExpiresAt.After(time.Now().Add(storage.StepUpTTL+time.Second)) {
		t.Fatalf("step-up expiry out of bounds: %v", first.ExpiresAt)
	}

	// Same counter again → rejected as replay.
	if _, err := h.store.VerifyMFAStepUp(ctx, cmd); !errors.Is(err, storage.ErrMFAInvalidCode) {
		t.Fatalf("replayed counter must be rejected, got %v", err)
	}

	// Concurrent presentations of the SAME counter: exactly one wins.
	code2, _ := h.codeFor(t, counter)
	cmd2 := storage.MFAStepUpCommand{
		UserID: h.userID, SessionID: session.ID,
		Scope: domain.StepUpScopeDeviceEnrollment, Method: domain.StepUpMethodTOTP,
		Code: code2, Secrets: h.secrets,
	}
	const racers = 8
	results := make(chan error, racers)
	var wg sync.WaitGroup
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := h.store.VerifyMFAStepUp(ctx, cmd2)
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	winners := 0
	for err := range results {
		if err == nil {
			winners++
		} else if !errors.Is(err, storage.ErrMFAInvalidCode) {
			t.Fatalf("unexpected race error: %v", err)
		}
	}
	if winners != 1 {
		t.Fatalf("same counter accepted %d times, want exactly 1", winners)
	}
}

func TestAuthMFA_RecoveryCodesSingleUse(t *testing.T) {
	h := newMFAHarness(t, mfaTestUserA)
	h.enroll(t, "01")
	ctx := context.Background()
	session := h.createSession(t)
	codes := h.recoveryCodes

	use := func(code string) error {
		_, err := h.store.VerifyMFAStepUp(ctx, storage.MFAStepUpCommand{
			UserID: h.userID, SessionID: session.ID,
			Scope: domain.StepUpScopeSecurityAdmin, Method: domain.StepUpMethodRecovery,
			Code: code, Secrets: h.secrets,
		})
		return err
	}
	if err := use(codes[0]); err != nil {
		t.Fatalf("valid recovery code: %v", err)
	}
	if err := use(codes[0]); !errors.Is(err, storage.ErrMFARecoveryInvalid) {
		t.Fatalf("reused recovery code must fail, got %v", err)
	}
	if err := use("WRONG-CODEX"); !errors.Is(err, storage.ErrMFARecoveryInvalid) {
		t.Fatalf("unknown recovery code must fail, got %v", err)
	}

	// Concurrent uses of the same code: exactly one wins.
	const racers = 8
	results := make(chan error, racers)
	var wg sync.WaitGroup
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- use(codes[1])
		}()
	}
	wg.Wait()
	close(results)
	winners := 0
	for err := range results {
		if err == nil {
			winners++
		} else if !errors.Is(err, storage.ErrMFARecoveryInvalid) {
			t.Fatalf("unexpected race error: %v", err)
		}
	}
	if winners != 1 {
		t.Fatalf("same recovery code accepted %d times, want exactly 1", winners)
	}
}

func TestAuthMFA_StepUpSessionBindingScopesAndRevocation(t *testing.T) {
	h := newMFAHarness(t, mfaTestUserA)
	counter := h.enroll(t, "01")
	ctx := context.Background()
	s1 := h.createSession(t)
	s2 := h.createSession(t)

	code, counter := h.codeFor(t, counter)
	if _, err := h.store.VerifyMFAStepUp(ctx, storage.MFAStepUpCommand{
		UserID: h.userID, SessionID: s1.ID,
		Scope: domain.StepUpScopeDeviceEnrollment, Method: domain.StepUpMethodTOTP,
		Code: code, Secrets: h.secrets,
	}); err != nil {
		t.Fatal(err)
	}

	// Session replacement: S2 does NOT inherit S1's step-up.
	fresh, err := h.store.GetMFAStepUpFreshness(ctx, s2.ID, h.userID, domain.StepUpScopeDeviceEnrollment)
	if err != nil || fresh.Valid {
		t.Fatalf("S2 must not inherit S1 step-up: %+v err=%v", fresh, err)
	}
	// Scopes are isolated: a device_enrollment grant does not authorize
	// security_admin on the SAME session.
	other, err := h.store.GetMFAStepUpFreshness(ctx, s1.ID, h.userID, domain.StepUpScopeSecurityAdmin)
	if err != nil || other.Valid {
		t.Fatalf("scope isolation violated: %+v err=%v", other, err)
	}

	// Revoking S1 cuts its grant (freshness joins the live session row). The
	// revoke runs as the session owner, exactly like the self-revoke boundary.
	err = h.store.WithinTenantTx(ctx, storage.TenantActor{UserID: h.userID}, func(txCtx context.Context) error {
		_, err := h.store.RevokeAuthSession(txCtx, s1.ID, h.userID, "test revocation")
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	revoked, err := h.store.GetMFAStepUpFreshness(ctx, s1.ID, h.userID, domain.StepUpScopeDeviceEnrollment)
	if err != nil || revoked.Valid {
		t.Fatalf("revoked session must not hold a valid grant: %+v err=%v", revoked, err)
	}
}

func TestAuthMFA_StepUpExpiry(t *testing.T) {
	h := newMFAHarness(t, mfaTestUserA)
	counter := h.enroll(t, "01")
	ctx := context.Background()
	session := h.createSession(t)

	code, counter := h.codeFor(t, counter)
	if _, err := h.store.VerifyMFAStepUp(ctx, storage.MFAStepUpCommand{
		UserID: h.userID, SessionID: session.ID,
		Scope: domain.StepUpScopeSecurityAdmin, Method: domain.StepUpMethodTOTP,
		Code: code, Secrets: h.secrets,
	}); err != nil {
		t.Fatal(err)
	}
	// Time-travel the grant past its TTL (direct SQL is the only honest way;
	// the CHECK pins expires_at > created_at, so both move together).
	if _, err := h.admin.Exec(ctx,
		`UPDATE auth_step_up_grants
		 SET created_at = NOW() - INTERVAL '11 minutes', expires_at = NOW() - INTERVAL '1 second'
		 WHERE auth_session_id=$1`, session.ID); err != nil {
		t.Fatal(err)
	}
	fresh, err := h.store.GetMFAStepUpFreshness(ctx, session.ID, h.userID, domain.StepUpScopeSecurityAdmin)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.Valid || !fresh.Expired {
		t.Fatalf("expired grant must report Expired: %+v", fresh)
	}
}

func TestAuthMFA_LastFactorRemovalPurgesRecovery(t *testing.T) {
	h := newMFAHarness(t, mfaTestUserA)
	h.enroll(t, "01")
	ctx := context.Background()

	if _, err := h.store.RevokeMFAFactor(ctx, storage.RevokeMFAFactorCommand{UserID: h.userID, FactorID: h.factorID}); err != nil {
		t.Fatal(err)
	}
	if n, err := h.store.CountEnabledMFAFactors(ctx, h.userID); err != nil || n != 0 {
		t.Fatalf("factors after removal: %d err=%v", n, err)
	}
	// Recovery codes died with the last factor: step-up fails closed.
	session := h.createSession(t)
	if _, err := h.store.VerifyMFAStepUp(ctx, storage.MFAStepUpCommand{
		UserID: h.userID, SessionID: session.ID,
		Scope: domain.StepUpScopeSecurityAdmin, Method: domain.StepUpMethodRecovery,
		Code: h.recoveryCodes[0], Secrets: h.secrets,
	}); !errors.Is(err, storage.ErrMFANoEnabledFactor) {
		t.Fatalf("recovery without factors must fail closed, got %v", err)
	}
	// Regeneration without factors is refused.
	if _, err := h.store.RegenerateMFARecoveryCodes(ctx, storage.RegenerateMFARecoveryCommand{
		UserID: h.userID, Secrets: h.secrets,
	}); !errors.Is(err, storage.ErrMFANoEnabledFactor) {
		t.Fatalf("regeneration without factors must fail, got %v", err)
	}
}

func TestAuthMFA_RegenerateRevokesOldCodes(t *testing.T) {
	h := newMFAHarness(t, mfaTestUserA)
	h.enroll(t, "01")
	ctx := context.Background()

	fresh, err := h.store.RegenerateMFARecoveryCodes(ctx, storage.RegenerateMFARecoveryCommand{
		UserID: h.userID, Secrets: h.secrets,
	})
	if err != nil || len(fresh) != storage.MFARecoveryCodeCount {
		t.Fatalf("regenerate: %v (%d codes)", err, len(fresh))
	}
	session := h.createSession(t)
	for _, old := range h.recoveryCodes {
		if _, err := h.store.VerifyMFAStepUp(ctx, storage.MFAStepUpCommand{
			UserID: h.userID, SessionID: session.ID,
			Scope: domain.StepUpScopeSecurityAdmin, Method: domain.StepUpMethodRecovery,
			Code: old, Secrets: h.secrets,
		}); !errors.Is(err, storage.ErrMFARecoveryInvalid) {
			t.Fatalf("old recovery code must be dead after regeneration, got %v", err)
		}
	}
}

func TestAuthMFA_RLSSelfOnlyAccess(t *testing.T) {
	h := newMFAHarness(t, mfaTestUserA)
	h.enroll(t, "01")
	ctx := context.Background()

	// Another user cannot see the owner's factors: query under the RLS-bound
	// app role with user B as the actor.
	tx, err := h.app.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	setRLSActor(t, tx, "", mfaTestUserB, "")
	var count int
	if err := tx.QueryRow(ctx,
		`SELECT COUNT(*) FROM auth_mfa_factors WHERE user_id=$1`, h.userID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("foreign user sees factors: count=%d err=%v", count, err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	// The owner sees exactly their factor; the sealed secret stays internal.
	factors, err := h.store.ListMFAFactors(ctx, h.userID)
	if err != nil || len(factors) != 1 {
		t.Fatalf("owner list: %d err=%v", len(factors), err)
	}
	if factors[0].EncryptedSecret != nil {
		t.Fatal("list projection must not expose the sealed secret")
	}
}

func TestAuthMFA_AuditTrailWithoutSecrets(t *testing.T) {
	h := newMFAHarness(t, mfaTestUserA)
	h.enroll(t, "01")
	ctx := context.Background()
	session := h.createSession(t)

	// Generate failed verifications for the audit trail. These run WITHOUT an
	// ambient transaction, so the verification transaction rolls back — the
	// failure audits must still persist (review blocker: an in-transaction
	// insert would disappear with the rollback).
	if _, err := h.store.EnableMFAFactor(ctx, storage.EnableMFAFactorCommand{
		UserID: h.userID, FactorID: "30000000-0000-0000-0000-0000000000ff",
		Code: "000000", Secrets: h.secrets,
	}); !errors.Is(err, storage.ErrMFAFactorNotFound) {
		t.Fatalf("unknown factor enable: %v", err)
	}
	pending, err := h.store.CreateMFAEnrollment(ctx, storage.CreateMFAEnrollmentCommand{
		UserID: h.userID, FactorID: "30000000-0000-0000-0000-0000000000fe",
		EncryptedSecret: mustSeal(t, h), EncryptionKid: "test",
		PendingExpiresAt: time.Now().Add(storage.MFAEnrollmentTTL).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.store.EnableMFAFactor(ctx, storage.EnableMFAFactorCommand{
		UserID: h.userID, FactorID: pending.ID,
		Code: "000000", Secrets: h.secrets,
	}); !errors.Is(err, storage.ErrMFAInvalidCode) {
		t.Fatalf("invalid enroll code: %v", err)
	}
	if _, err := h.store.VerifyMFAStepUp(ctx, storage.MFAStepUpCommand{
		UserID: h.userID, SessionID: session.ID,
		Scope: domain.StepUpScopeSecurityAdmin, Method: domain.StepUpMethodTOTP,
		Code: "000000", Secrets: h.secrets,
	}); !errors.Is(err, storage.ErrMFAInvalidCode) {
		t.Fatalf("invalid step-up: %v", err)
	}
	if _, err := h.store.VerifyMFAStepUp(ctx, storage.MFAStepUpCommand{
		UserID: h.userID, SessionID: session.ID,
		Scope: domain.StepUpScopeSecurityAdmin, Method: domain.StepUpMethodRecovery,
		Code: "WRONG-CODEX", Secrets: h.secrets,
	}); !errors.Is(err, storage.ErrMFARecoveryInvalid) {
		t.Fatalf("invalid recovery step-up: %v", err)
	}

	// Both failure events survived the rolled-back transactions, and every
	// MFA/step-up audit row is free of TOTP material, provisioning URIs and
	// recovery plaintext.
	rows, err := h.admin.Query(ctx, `
		SELECT event_type, COALESCE(details::text, '') FROM security_audit_events
		WHERE actor_user_id=$1 AND (event_type LIKE 'mfa%' OR event_type LIKE 'step_up%')`,
		h.userID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	seen := map[string]bool{}
	for rows.Next() {
		var eventType, details string
		if err := rows.Scan(&eventType, &details); err != nil {
			t.Fatal(err)
		}
		seen[eventType] = true
		for _, forbidden := range []string{"otpauth://", "recovery_codes", "code\":", "wrong-code"} {
			if strings.Contains(details, forbidden) {
				t.Fatalf("audit event %s leaks %q: %s", eventType, forbidden, details)
			}
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !seen["mfa_verification_failed"] {
		t.Fatal("mfa_verification_failed audit was lost with the rolled-back transaction")
	}
	if !seen["step_up_failed"] {
		t.Fatal("step_up_failed audit was lost with the rolled-back transaction")
	}
}

// mustSeal seals a throwaway secret for failure-path tests.
func mustSeal(t *testing.T, h *mfaHarness) []byte {
	t.Helper()
	sealed, _, err := h.secrets.EncryptTOTPSecret([]byte("failure-path-probe-secret"))
	if err != nil {
		t.Fatal(err)
	}
	return sealed
}
