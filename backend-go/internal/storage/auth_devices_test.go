package storage_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #460 / SEC-6: dedicated device credentials. These integration tests run
// against real PostgreSQL under the app role: the full enrollment lifecycle
// (anonymous enroll → user approval by PIN → single-use exchange → token
// resolution), single-use semantics, cross-user denials, the keyed RLS arms
// (secret hash / enrollment id / enrollment code) and the audit trail.

func devicesMigrationSQL(t *testing.T, suffix string) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000108_auth_devices." + suffix + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func assertDevicesPolicies(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	for _, table := range []string{"auth_devices", "auth_device_enrollments"} {
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
		var insertable, updatable bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=$1 AND cmd='INSERT'),
			       EXISTS (SELECT 1 FROM pg_policies WHERE tablename=$1 AND cmd='UPDATE')`,
			table).Scan(&insertable, &updatable); err != nil {
			t.Fatal(err)
		}
		if !insertable || !updatable {
			t.Fatalf("%s lacks INSERT/UPDATE policies: insert=%v update=%v", table, insertable, updatable)
		}
	}
}

// The device tables must apply on a fresh database AND on top of the 107
// schema, register in the RLS inventory as platform-global with FORCE RLS,
// and carry INSERT/UPDATE policies (the original migration shipped
// SELECT-only policies, which denied every write under the app role). The
// down migration removes the family completely.
func TestAuthDevices_MigrationFreshAndUpgrade(t *testing.T) {
	ctx := context.Background()

	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 108)
	assertDevicesPolicies(t, fresh)

	upgrade := multiOrgFreshDB(t)
	identityApplyThrough(t, upgrade, 107)
	if _, err := upgrade.Exec(ctx, devicesMigrationSQL(t, "up")); err != nil {
		t.Fatalf("upgrade apply 000108: %v", err)
	}
	assertDevicesPolicies(t, upgrade)

	if _, err := upgrade.Exec(ctx, devicesMigrationSQL(t, "down")); err != nil {
		t.Fatalf("down 000108: %v", err)
	}
	var gone *string
	if err := upgrade.QueryRow(ctx, `SELECT to_regclass('public.auth_devices')`).Scan(&gone); err != nil {
		t.Fatal(err)
	}
	if gone != nil {
		t.Fatal("down migration must drop auth_devices")
	}
}

// Full lifecycle under the app role: enroll anonymously, poll by the minted
// id, approve by PIN as the enrolling user, exchange once (single-use), then
// resolve a transport token that is backed by a REAL registry session.
func TestAuthDevices_EnrollmentLifecycleUnderAppRole(t *testing.T) {
	f := newRLSFixture(t)
	store := f.store
	ctx := context.Background()

	enrollment, err := store.CreateAuthDeviceEnrollment(ctx, storage.DeviceEnrollmentCommand{
		EnrollmentID: "10000000-0000-0000-0000-000000000001",
		Code:         "K7M2QP",
		ClientType:   "sketchup",
		DisplayName:  "Mac del taller",
		ExpiresAt:    time.Now().Add(10 * time.Minute).UTC(),
	})
	if err != nil {
		t.Fatalf("enroll: %v", err)
	}
	if enrollment.Status != domain.EnrollmentStatusPending || enrollment.UserID != nil {
		t.Fatalf("new enrollment must be pending and anonymous, got %s/%v", enrollment.Status, enrollment.UserID)
	}

	// The enrolling device polls by the id it was minted.
	polled, err := store.GetAuthDeviceEnrollmentByID(ctx, enrollment.ID)
	if err != nil {
		t.Fatalf("poll: %v", err)
	}
	if polled.Status != domain.EnrollmentStatusPending {
		t.Fatalf("poll status = %s, want pending", polled.Status)
	}
	if _, err := store.GetAuthDeviceEnrollmentByID(ctx, "10000000-0000-0000-0000-00000000dead"); !errors.Is(err, storage.ErrEnrollmentNotFound) {
		t.Fatalf("unknown enrollment id must be not-found, got %v", err)
	}

	// The approving user claims the PIN.
	approved, err := store.ApproveAuthDeviceEnrollment(ctx, storage.ApproveDeviceEnrollmentCommand{
		Code: "K7M2QP", ApprovingUser: rlsUserB,
	})
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if approved.UserID == nil || *approved.UserID != rlsUserB {
		t.Fatal("approval must bind the approving user")
	}
	// The claim is single-shot: a second presentation of the same PIN loses.
	if _, err := store.ApproveAuthDeviceEnrollment(ctx, storage.ApproveDeviceEnrollmentCommand{
		Code: "K7M2QP", ApprovingUser: rlsUserB,
	}); !errors.Is(err, storage.ErrEnrollmentConflict) {
		t.Fatalf("re-approve must conflict, got %v", err)
	}

	// Exchange consumes the enrollment atomically and mints the registry
	// session in the same transaction.
	exchanged, err := store.ExchangeAuthDeviceEnrollment(ctx, storage.ExchangeDeviceCommand{
		EnrollmentID: enrollment.ID,
	})
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	id, secret, found := strings.Cut(exchanged.RawSecret, ":")
	if !found || len(secret) != 64 || id != exchanged.Device.ID {
		t.Fatalf("exchange secret shape: %q", exchanged.RawSecret)
	}
	if exchanged.Session == nil || exchanged.Device.CurrentSessionID == nil || *exchanged.Device.CurrentSessionID != exchanged.Session.ID {
		t.Fatal("exchange must link the device to a registry session")
	}
	if exchanged.Session.ClientType != domain.SessionClientSketchup {
		t.Fatalf("session client = %s, want sketchup", exchanged.Session.ClientType)
	}
	// rlsUserB has exactly one active membership (org B): login's
	// auto-selection scopes the device session so the bearer works without
	// an org picker in the extension.
	if exchanged.Session.ActiveOrganizationID == nil || *exchanged.Session.ActiveOrganizationID != rlsOrgB {
		t.Fatalf("single-membership owner must get an org-scoped session, got %+v", exchanged.Session.ActiveOrganizationID)
	}
	// Single-use: a replayed exchange must NOT mint a second secret.
	if _, err := store.ExchangeAuthDeviceEnrollment(ctx, storage.ExchangeDeviceCommand{
		EnrollmentID: enrollment.ID,
	}); !errors.Is(err, storage.ErrEnrollmentConflict) {
		t.Fatalf("replay exchange must conflict, got %v", err)
	}

	// Token resolution: wrong secret is indistinguishable from unknown
	// device (no oracle), the real secret resolves the registry session.
	if err := store.ResolveDeviceToken(ctx, storage.DeviceTokenCommand{
		DeviceID: exchanged.Device.ID, Secret: strings.Repeat("0", 64),
	}, func(context.Context, storage.DeviceTokenResult) error { return nil }); !errors.Is(err, storage.ErrDeviceNotFound) {
		t.Fatalf("wrong secret must be device-not-found, got %v", err)
	}
	var tokenResult storage.DeviceTokenResult
	err = store.ResolveDeviceToken(ctx, storage.DeviceTokenCommand{
		DeviceID: exchanged.Device.ID, Secret: secret,
	}, func(_ context.Context, result storage.DeviceTokenResult) error {
		tokenResult = result
		return nil
	})
	if err != nil {
		t.Fatalf("resolve token: %v", err)
	}
	if tokenResult.User.ID != rlsUserB || tokenResult.Session.ID != *exchanged.Device.CurrentSessionID {
		t.Fatal("token must resolve the owner and the linked registry session")
	}
	if tokenResult.SessionRefreshed {
		t.Fatal("first token after exchange must reuse the exchange session")
	}
	if tokenResult.OrgID != rlsOrgB || tokenResult.MembershipID == "" || len(tokenResult.Roles) == 0 {
		t.Fatalf("token scope must mirror the session's org scope, got org=%s membership=%s roles=%v",
			tokenResult.OrgID, tokenResult.MembershipID, tokenResult.Roles)
	}

	// Listing is owner-scoped metadata: no credential hash ever leaves.
	devices, err := store.ListAuthDevicesByUser(ctx, rlsUserB)
	if err != nil || len(devices) != 1 {
		t.Fatalf("list own devices: %v (%d)", err, len(devices))
	}
	if devices[0].CredentialHash != nil {
		t.Fatal("credential hash must never leave the storage layer")
	}

	// Another user cannot revoke someone else's device.
	if err := f.store.RevokeAuthDevice(ctx, storage.RevokeDeviceCommand{
		DeviceID: exchanged.Device.ID, OwnerUser: rlsUserA,
	}); !errors.Is(err, storage.ErrDeviceNotFound) {
		t.Fatalf("foreign revoke must be not-found, got %v", err)
	}

	// Owner revocation cuts the device AND its registry session.
	if err := f.store.RevokeAuthDevice(ctx, storage.RevokeDeviceCommand{
		DeviceID: exchanged.Device.ID, OwnerUser: rlsUserB,
	}); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if err := store.ResolveDeviceToken(ctx, storage.DeviceTokenCommand{
		DeviceID: exchanged.Device.ID, Secret: secret,
	}, func(context.Context, storage.DeviceTokenResult) error { return nil }); !errors.Is(err, storage.ErrDeviceNotFound) {
		t.Fatalf("revoked device must stop resolving tokens, got %v", err)
	}
	var sessionRevoked bool
	if err := f.admin.QueryRow(ctx,
		`SELECT revoked_at IS NOT NULL FROM auth_sessions WHERE id=$1`, exchanged.Session.ID).Scan(&sessionRevoked); err != nil || !sessionRevoked {
		t.Fatalf("registry session must be revoked with the device (err=%v revoked=%v)", err, sessionRevoked)
	}

	// The audit trail covers the security mutations.
	for _, event := range []string{"device_enrollment_created", "device_enrollment_approved", "device_exchanged", "device_revoked"} {
		var count int
		if err := f.admin.QueryRow(ctx,
			`SELECT count(*) FROM security_audit_events WHERE event_type=$1`, event).Scan(&count); err != nil || count == 0 {
			t.Fatalf("audit event %s missing (err=%v count=%d)", event, err, count)
		}
	}
}

// Direct-SQL RLS proofs under the app role, each scope inside its own
// transaction because the keyed GUCs are transaction-local:
//  1. without the keyed GUCs nobody reads pending enrollments or devices —
//     not even the future owner before the claim;
//  2. the enrollment-id GUC reaches exactly the named row;
//  3. the secret-hash GUC reaches exactly the matching device: a wrong hash
//     leaves it invisible;
//  4. anonymous writes beyond the pending NULL-owner enrollment shape are
//     denied by the insert policy.
func TestAuthDevices_KeyedRLSArmsOnly(t *testing.T) {
	f := newRLSFixture(t)
	store := f.store
	ctx := context.Background()

	enrollment, err := store.CreateAuthDeviceEnrollment(ctx, storage.DeviceEnrollmentCommand{
		EnrollmentID: "10000000-0000-0000-0000-000000000002",
		Code:         "9QRSTV",
		ClientType:   "sketchup",
		DisplayName:  "Notebook",
		ExpiresAt:    time.Now().Add(10 * time.Minute).UTC(),
	})
	if err != nil {
		t.Fatalf("enroll: %v", err)
	}

	// scopedCount runs one query inside a transaction with an optional
	// set_config preamble (the keyed GUCs only exist inside a transaction).
	scopedCount := func(setup func(tx pgx.Tx) error, sql string, args ...any) int {
		t.Helper()
		tx, err := f.app.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		if setup != nil {
			if err := setup(tx); err != nil {
				t.Fatalf("setup: %v", err)
			}
		}
		var n int
		if err := tx.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
			t.Fatalf("count query: %v\n%s", err, sql)
		}
		return n
	}
	setGUC := func(name, value string) func(pgx.Tx) error {
		return func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `SELECT set_config($1, $2, true)`, name, value)
			return err
		}
	}

	// 1. No actor + no keyed GUC: the pending row is invisible, even to the
	//    user who will later own it (the claim is by PIN, not by identity).
	if n := scopedCount(nil, `SELECT count(*) FROM auth_device_enrollments`); n != 0 {
		t.Fatalf("anonymous read saw %d pending enrollments, want 0", n)
	}
	if n := scopedCount(setGUC("app.user_id", rlsUserB),
		`SELECT count(*) FROM auth_device_enrollments`); n != 0 {
		t.Fatalf("pre-claim owner saw %d pending enrollments, want 0", n)
	}

	// 2. The enrollment-id GUC reaches exactly the named row.
	if n := scopedCount(setGUC("app.device_enrollment_id", enrollment.ID),
		`SELECT count(*) FROM auth_device_enrollments WHERE id = $1::uuid`,
		enrollment.ID); n != 1 {
		t.Fatalf("keyed enrollment read saw %d rows, want 1", n)
	}

	// A device minted through the full flow, read through the secret hash.
	if _, err := store.ApproveAuthDeviceEnrollment(ctx, storage.ApproveDeviceEnrollmentCommand{
		Code: "9QRSTV", ApprovingUser: rlsUserB,
	}); err != nil {
		t.Fatal(err)
	}
	exchanged, err := store.ExchangeAuthDeviceEnrollment(ctx, storage.ExchangeDeviceCommand{EnrollmentID: enrollment.ID})
	if err != nil {
		t.Fatal(err)
	}
	_, secret, _ := strings.Cut(exchanged.RawSecret, ":")

	// 3. Unkeyed and wrong-hash reads are invisible; the exact hash reaches
	//    exactly the matching row.
	if n := scopedCount(nil, `SELECT count(*) FROM auth_devices WHERE id = $1::uuid`, exchanged.Device.ID); n != 0 {
		t.Fatalf("unkeyed device read saw %d rows, want 0", n)
	}
	if n := scopedCount(setGUC("app.device_secret_hash", strings.Repeat("ab", 32)),
		`SELECT count(*) FROM auth_devices WHERE id = $1::uuid`,
		exchanged.Device.ID); n != 0 {
		t.Fatalf("wrong-hash read saw %d rows, want 0", n)
	}
	if n := scopedCount(setGUC("app.device_secret_hash", strings.Repeat("cd", 32)),
		`SELECT count(*) FROM auth_devices WHERE id = $1::uuid`,
		exchanged.Device.ID); n != 0 {
		t.Fatalf("second wrong-hash read saw %d rows, want 0", n)
	}
	correctHash := sha256.Sum256([]byte(secret))
	if n := scopedCount(setGUC("app.device_secret_hash", hex.EncodeToString(correctHash[:])),
		`SELECT count(*) FROM auth_devices WHERE id = $1::uuid`,
		exchanged.Device.ID); n != 1 {
		t.Fatalf("exact-hash read saw %d rows, want 1", n)
	}

	// 4. Anonymous insert of an owner-bound enrollment is denied; only the
	//    pending NULL-owner shape may enter without identity.
	anonTx, err := f.app.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer anonTx.Rollback(ctx)
	if _, err := anonTx.Exec(ctx, `
		INSERT INTO auth_device_enrollments (id, code, user_id, client_type, display_name, status)
		VALUES ('10000000-0000-0000-0000-000000000003', 'AAAAAA', $1::uuid, 'sketchup', 'x', 'pending')`,
		rlsUserB); err == nil {
		t.Fatal("anonymous owner-bound enrollment insert must be RLS-denied")
	} else if !strings.Contains(err.Error(), "row-level security") {
		t.Fatalf("expected RLS violation, got: %v", err)
	}
	_ = pgx.ErrNoRows // keep pgx import for the tx helpers
}
