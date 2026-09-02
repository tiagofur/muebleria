package pilotreadiness

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"
)

func installAuditFailureTrigger(t *testing.T, eventType string) {
	t.Helper()
	ctx := context.Background()
	const trigger = "fail_gate_a_required_audit"
	const function = "fail_gate_a_required_audit"
	if _, err := fx.pool.Exec(ctx, fmt.Sprintf(`
		CREATE OR REPLACE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'injected Gate A audit failure'; END $$;
		CREATE TRIGGER %s BEFORE INSERT ON security_audit_events
		FOR EACH ROW WHEN (NEW.event_type='%s') EXECUTE FUNCTION %s()`, function, trigger, eventType, function)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = fx.pool.Exec(ctx, fmt.Sprintf(`DROP TRIGGER IF EXISTS %s ON security_audit_events`, trigger))
		_, _ = fx.pool.Exec(ctx, fmt.Sprintf(`DROP FUNCTION IF EXISTS %s()`, function))
	})
}

func TestGateADurableAuditFailureRollsBackLoginSession(t *testing.T) {
	ctx := context.Background()
	var sessionsBefore int
	var lastLoginBefore *time.Time
	if err := fx.pool.QueryRow(ctx, `SELECT count(*) FROM auth_sessions WHERE user_id=$1`, fx.a.admin.id).Scan(&sessionsBefore); err != nil {
		t.Fatal(err)
	}
	if err := fx.pool.QueryRow(ctx, `SELECT last_login_at FROM users WHERE id=$1`, fx.a.admin.id).Scan(&lastLoginBefore); err != nil {
		t.Fatal(err)
	}
	installAuditFailureTrigger(t, "login_success")
	status, _, response := fx.doWithHeaders(t, http.MethodPost, "/api/auth/login", "", map[string]string{
		"email": fx.a.admin.email, "password": pilotPassword, "org": fx.a.slug, "transport": "web",
	}, nil)
	if status != http.StatusInternalServerError {
		t.Fatalf("login status=%d, want 500", status)
	}
	if findSetCookie(t, response) != nil {
		t.Fatal("failed durable audit must not expose a refresh credential")
	}
	var sessionsAfter int
	var lastLoginAfter *time.Time
	if err := fx.pool.QueryRow(ctx, `SELECT count(*) FROM auth_sessions WHERE user_id=$1`, fx.a.admin.id).Scan(&sessionsAfter); err != nil {
		t.Fatal(err)
	}
	if err := fx.pool.QueryRow(ctx, `SELECT last_login_at FROM users WHERE id=$1`, fx.a.admin.id).Scan(&lastLoginAfter); err != nil {
		t.Fatal(err)
	}
	if sessionsAfter != sessionsBefore || !equalOptionalTime(lastLoginBefore, lastLoginAfter) {
		t.Fatalf("login partially committed: sessions %d->%d last_login %v->%v", sessionsBefore, sessionsAfter, lastLoginBefore, lastLoginAfter)
	}
}

func equalOptionalTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Equal(*b)
}

func TestGateADurableAuditFailureRollsBackOrganizationSelection(t *testing.T) {
	ctx := context.Background()
	if _, err := fx.pool.Exec(ctx, `
		INSERT INTO memberships (organization_id,user_id,roles,status)
		VALUES ($1,$2,ARRAY['user']::text[],'active')
		ON CONFLICT (user_id,organization_id) DO UPDATE SET status='active'`, fx.b.id, fx.a.admin.id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = fx.pool.Exec(ctx, `DELETE FROM memberships WHERE organization_id=$1 AND user_id=$2`, fx.b.id, fx.a.admin.id)
	})

	login := fx.login(t, fx.a.admin.email, "")
	if !login.SelectionRequired {
		t.Fatal("multi-organization login must issue an org-less selection session")
	}
	installAuditFailureTrigger(t, "organization_selected")
	status, _, _ := fx.doWithHeaders(t, http.MethodPost, "/api/auth/select-org", login.Token,
		map[string]string{"organization_id": fx.b.id}, nil)
	if status != http.StatusInternalServerError {
		t.Fatalf("select-org status=%d, want 500", status)
	}
	var membershipID, organizationID *string
	if err := fx.pool.QueryRow(ctx, `SELECT membership_id::text, active_organization_id::text FROM auth_sessions WHERE id=$1`, login.SessionID).Scan(&membershipID, &organizationID); err != nil {
		t.Fatal(err)
	}
	if membershipID != nil || organizationID != nil {
		t.Fatalf("failed audit committed scope membership=%v organization=%v", membershipID, organizationID)
	}
}

func TestGateADurableAuditFailureRollsBackPlatformOrganizationPatch(t *testing.T) {
	ctx := context.Background()
	fx.pilotStepUp(t, fx.platform, fx.mfaFor(t, fx.platform), "platform_admin")
	var name string
	var version int64
	if err := fx.pool.QueryRow(ctx, `SELECT name,version FROM organizations WHERE id=$1`, fx.a.id).Scan(&name, &version); err != nil {
		t.Fatal(err)
	}
	installAuditFailureTrigger(t, "organization_renamed")
	status, _, _ := fx.doWithHeaders(t, http.MethodPatch, "/api/platform/organizations/"+fx.a.id, fx.platform.token,
		map[string]string{"name": name + " rejected"}, map[string]string{
			"If-Match": fmt.Sprintf(`"v%d"`, version), "Idempotency-Key": "gate-a-audit-platform-rename",
		})
	if status != http.StatusInternalServerError {
		t.Fatalf("platform patch status=%d, want 500", status)
	}
	var nameAfter string
	var versionAfter int64
	if err := fx.pool.QueryRow(ctx, `SELECT name,version FROM organizations WHERE id=$1`, fx.a.id).Scan(&nameAfter, &versionAfter); err != nil {
		t.Fatal(err)
	}
	if nameAfter != name || versionAfter != version {
		t.Fatalf("failed audit committed organization name/version %q/%d -> %q/%d", name, version, nameAfter, versionAfter)
	}
	if _, err := fx.pool.Exec(ctx, `
		DROP TRIGGER fail_gate_a_required_audit ON security_audit_events;
		DROP FUNCTION fail_gate_a_required_audit()`); err != nil {
		t.Fatal(err)
	}
	status, _, _ = fx.doWithHeaders(t, http.MethodPatch, "/api/platform/organizations/"+fx.a.id, fx.platform.token,
		map[string]string{"name": name + " accepted"}, map[string]string{
			"If-Match": fmt.Sprintf(`"v%d"`, version), "Idempotency-Key": "gate-a-audit-platform-rename",
		})
	if status != http.StatusOK {
		t.Fatalf("platform patch retry status=%d, want 200", status)
	}
	var audits int
	if err := fx.pool.QueryRow(ctx, `
		SELECT count(*) FROM security_audit_events
		WHERE event_type='organization_renamed' AND organization_id=$1`, fx.a.id).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits != 1 {
		t.Fatalf("organization_renamed audit count=%d, want 1", audits)
	}
	if _, err := fx.pool.Exec(ctx, `UPDATE organizations SET name=$2,version=$3 WHERE id=$1`, fx.a.id, name, version); err != nil {
		t.Fatal(err)
	}
}
