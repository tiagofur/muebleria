package storage_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const (
	supportEpochUserID    = "d1000000-0000-0000-0000-000000000102"
	supportEpochOrgID     = "d2000000-0000-0000-0000-000000000102"
	supportEpochSessionID = "d3000000-0000-0000-0000-000000000102"
)

func supportSessionEpochMigrationSQL(t *testing.T, suffix string) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000102_support_session_credential_epoch." + suffix + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func seedSupportSessionEpochFixture(t *testing.T) (*storage.PostgresStore, string) {
	t.Helper()
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 101)
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	statements := []struct {
		query string
		args  []any
	}{
		{`
		INSERT INTO users (id, email, normalized_email, password_hash, name, account_status)
		VALUES ($1, 'support-epoch@example.test', 'support-epoch@example.test', 'x', 'Support Epoch', 'active')`, []any{supportEpochUserID}},
		{`
		INSERT INTO organizations (
			id, name, slug, type, license_plan, status, credential_version,
			status_changed_at, version
		) VALUES ($1, 'Support Epoch Org', 'support-epoch-org', 'factory', 'pro', 'provisioning', 7, NOW(), 1)`, []any{supportEpochOrgID}},
		{`UPDATE organization_entitlements SET max_active_members=10 WHERE organization_id=$1`, []any{supportEpochOrgID}},
		{`
		INSERT INTO memberships (organization_id, user_id, roles, status)
		VALUES ($1, $2, ARRAY['admin']::TEXT[], 'active')`, []any{supportEpochOrgID, supportEpochUserID}},
		{`UPDATE organizations SET status='active' WHERE id=$1`, []any{supportEpochOrgID}},
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var sessionID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO support_sessions (
			platform_admin_user_id, organization_id, reason, expires_at
		) VALUES ($1, $2, 'pre-migration support', NOW() + INTERVAL '1 hour')
		RETURNING id
	`, supportEpochUserID, supportEpochOrgID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, supportSessionEpochMigrationSQL(t, "up")); err != nil {
		t.Fatalf("apply migration 102: %v", err)
	}
	return &storage.PostgresStore{Pool: pool}, sessionID
}

func TestSupportSessionEpochMigration_BackfillsAndProtectsCredentialVersion(t *testing.T) {
	store, sessionID := seedSupportSessionEpochFixture(t)
	ctx := context.Background()
	var credentialVersion int64
	if err := store.Pool.QueryRow(ctx, `
		SELECT organization_credential_version FROM support_sessions WHERE id=$1
	`, sessionID).Scan(&credentialVersion); err != nil {
		t.Fatal(err)
	}
	if credentialVersion != 7 {
		t.Fatalf("backfilled credential version = %d, want 7", credentialVersion)
	}
	if _, err := store.Pool.Exec(ctx, `
		UPDATE support_sessions SET organization_credential_version=8 WHERE id=$1
	`, sessionID); err == nil {
		t.Fatal("credential version mutation must be rejected")
	}
	if _, err := store.Pool.Exec(ctx, `
		UPDATE support_sessions SET ended_at=NOW(), ended_via='org_offboarding' WHERE id=$1
	`, sessionID); err != nil {
		t.Fatalf("org_offboarding end reason: %v", err)
	}
}

func TestSupportSessionStorage_PreservesSnapshotAndReturnsLiveOrganizationEpoch(t *testing.T) {
	store, _ := seedSupportSessionEpochFixture(t)
	ctx := context.Background()
	var session *domain.SupportSession
	err := store.WithinTenantTx(ctx, storage.TenantActor{
		UserID: supportEpochUserID, AuthorizedOrganizationIDs: []string{supportEpochOrgID},
	}, func(txCtx context.Context) error {
		var startErr error
		session, startErr = store.StartSupportSession(
			txCtx, supportEpochUserID, supportEpochOrgID, "investigate customer issue",
			time.Hour, 7,
		)
		return startErr
	})
	if err != nil {
		t.Fatal(err)
	}
	if session.OrganizationCredentialVersion != 7 {
		t.Fatalf("created snapshot = %d, want 7", session.OrganizationCredentialVersion)
	}
	if _, err := store.Pool.Exec(ctx, `
		UPDATE organizations SET status='suspended', credential_version=8,
			status_reason='security hold', suspended_at=NOW()
		WHERE id=$1
	`, supportEpochOrgID); err != nil {
		t.Fatal(err)
	}
	live, err := store.GetOpenSupportSession(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if live.OrganizationCredentialVersion != 7 ||
		live.LiveOrganizationCredentialVersion != 8 ||
		live.LiveOrganizationStatus != domain.OrganizationStatusSuspended {
		t.Fatalf("live support session = %+v", live)
	}
}

func TestSupportSessionWritesRequireTenantTransaction(t *testing.T) {
	store := &storage.PostgresStore{}
	if _, err := store.StartSupportSession(
		context.Background(), supportEpochUserID, supportEpochOrgID,
		"investigate customer issue", time.Hour, 7,
	); err == nil {
		t.Fatal("support session start without a transaction must fail")
	}
	if _, err := store.EndSupportSession(
		context.Background(), supportEpochSessionID, supportEpochUserID, "logout",
	); err == nil {
		t.Fatal("support session end without a transaction must fail")
	}
}

func TestSupportSessionEpochMigration_DownRoundTripAndLossyRollbackGuard(t *testing.T) {
	store, sessionID := seedSupportSessionEpochFixture(t)
	ctx := context.Background()
	if _, err := store.Pool.Exec(ctx, `
		UPDATE support_sessions SET ended_at=NOW(), ended_via='org_offboarding' WHERE id=$1
	`, sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Pool.Exec(ctx, supportSessionEpochMigrationSQL(t, "down")); err == nil {
		t.Fatal("rollback with offboarding facts must be rejected")
	}
	if _, err := store.Pool.Exec(ctx, `
		UPDATE support_sessions SET ended_via='org_suspended' WHERE id=$1
	`, sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Pool.Exec(ctx, supportSessionEpochMigrationSQL(t, "down")); err != nil {
		t.Fatalf("clean rollback: %v", err)
	}
	var columnExists bool
	if err := store.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema='public' AND table_name='support_sessions'
			  AND column_name='organization_credential_version'
		)
	`).Scan(&columnExists); err != nil {
		t.Fatal(err)
	}
	if columnExists {
		t.Fatal("credential version column remains after rollback")
	}
	if _, err := store.Pool.Exec(ctx, `
		UPDATE support_sessions SET ended_via='org_offboarding' WHERE id=$1
	`, sessionID); err == nil {
		t.Fatal("pre-000102 ended_via constraint must reject org_offboarding")
	}
}
