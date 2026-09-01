package pilotreadiness

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestRefreshRotationReplayAndLogoutHTTP(t *testing.T) {
	login := fx.login(t, fx.a.admin.email, fx.a.slug)
	if login.RefreshToken == "" || login.RefreshExpiresAt == "" {
		t.Fatal("web login must emit initial opaque refresh credentials")
	}
	for _, wrongTransport := range []string{"mobile", "sketchup", "support"} {
		status, raw := fx.do(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
			"refresh_token": login.RefreshToken,
			"transport":     wrongTransport,
		})
		if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_INVALID" {
			t.Fatalf("web refresh as %s status=%d code=%s", wrongTransport, status, apiErrorCode(raw))
		}
	}

	var rotated loginResponse
	fx.decode(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": login.RefreshToken,
		"transport":     "web",
	}, http.StatusOK, &rotated)
	if rotated.Token == "" || rotated.RefreshToken == "" || rotated.RefreshToken == login.RefreshToken {
		t.Fatalf("rotation did not return distinct A2/R2: %+v", rotated)
	}
	fx.want(t, http.MethodGet, "/api/auth/me", rotated.Token, nil, http.StatusOK)

	status, raw := fx.do(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": login.RefreshToken,
		"transport":     "web",
	})
	if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_REUSED" {
		t.Fatalf("R1 replay status=%d code=%s body=%s", status, apiErrorCode(raw), raw)
	}
	status, raw = fx.do(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": rotated.RefreshToken,
		"transport":     "web",
	})
	if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_REVOKED" {
		t.Fatalf("R2 after replay status=%d code=%s body=%s", status, apiErrorCode(raw), raw)
	}
	status, _ = fx.do(t, http.MethodGet, "/api/auth/me", rotated.Token, nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("access credential must be cut after reuse, status=%d", status)
	}

	// A separate family proves the replacement itself is consumable once;
	// replay coverage above intentionally revokes R2 before it can rotate.
	happyLogin := fx.login(t, fx.a.admin.email, fx.a.slug)
	var happyR2, logoutLogin loginResponse
	fx.decode(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": happyLogin.RefreshToken,
		"transport":     "web",
	}, http.StatusOK, &happyR2)
	fx.decode(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": happyR2.RefreshToken,
		"transport":     "web",
	}, http.StatusOK, &logoutLogin)
	fx.want(t, http.MethodGet, "/api/auth/me", logoutLogin.Token, nil, http.StatusOK)
	for i := 0; i < 2; i++ {
		fx.want(t, http.MethodPost, "/api/auth/logout", "", map[string]string{
			"refresh_token": logoutLogin.RefreshToken,
		}, http.StatusOK)
	}
	status, _ = fx.do(t, http.MethodGet, "/api/auth/me", logoutLogin.Token, nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("access credential must fail after logout, status=%d", status)
	}
	status, raw = fx.do(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": logoutLogin.RefreshToken,
		"transport":     "web",
	})
	if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_REVOKED" {
		t.Fatalf("refresh credential after logout status=%d code=%s", status, apiErrorCode(raw))
	}
}

func TestSelectOrgRefreshScopeIsAtomicAndAuthoritative(t *testing.T) {
	ctx := context.Background()
	const email = "refresh-scope-atomic@pilot-readiness.test"
	fx.inviteAndAccept(t, fx.a.admin.token, email, "admin")
	acceptedB := fx.inviteAndAccept(t, fx.b.admin.token, email, "vendedor")
	if len(acceptedB.Memberships) != 1 {
		t.Fatalf("B acceptance missing membership: %+v", acceptedB)
	}
	membershipB := acceptedB.Memberships[0].ID

	loginA := fx.login(t, email, fx.a.slug)
	if loginA.SessionID == "" || loginA.RefreshToken == "" {
		t.Fatalf("login missing session/refresh: %+v", loginA)
	}
	dropFailureInjection := func() {
		_, _ = fx.pool.Exec(ctx, `DROP TRIGGER IF EXISTS fail_select_org_refresh_family ON auth_refresh_families`)
		_, _ = fx.pool.Exec(ctx, `DROP FUNCTION IF EXISTS fail_select_org_refresh_family()`)
	}
	dropFailureInjection()
	t.Cleanup(dropFailureInjection)
	if _, err := fx.pool.Exec(ctx, `
		CREATE FUNCTION fail_select_org_refresh_family() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'injected refresh family scope failure'; END $$;
		CREATE TRIGGER fail_select_org_refresh_family
		BEFORE UPDATE ON auth_refresh_families
		FOR EACH ROW EXECUTE FUNCTION fail_select_org_refresh_family()`); err != nil {
		t.Fatal(err)
	}

	status, raw := fx.do(t, http.MethodPost, "/api/auth/select-org", loginA.Token, map[string]string{"organization_id": fx.b.id})
	if status < http.StatusBadRequest || strings.Contains(string(raw), `"token"`) {
		t.Fatalf("failed switch status=%d body=%s", status, raw)
	}
	assertSessionAndFamilyScope(t, loginA.SessionID, fx.a.id, "")
	fx.want(t, http.MethodGet, "/api/auth/me", loginA.Token, nil, http.StatusOK)

	dropFailureInjection()
	var selectedB loginResponse
	fx.decode(t, http.MethodPost, "/api/auth/select-org", loginA.Token, map[string]string{"organization_id": fx.b.id}, http.StatusOK, &selectedB)
	if selectedB.Organization == nil || selectedB.Organization.ID != fx.b.id || selectedB.Token == "" {
		t.Fatalf("successful switch did not return B token: %+v", selectedB)
	}
	assertSessionAndFamilyScope(t, loginA.SessionID, fx.b.id, membershipB)
	fx.want(t, http.MethodGet, "/api/auth/me", loginA.Token, nil, http.StatusUnauthorized)
	fx.want(t, http.MethodGet, "/api/auth/me", selectedB.Token, nil, http.StatusOK)

	var refreshedB loginResponse
	fx.decode(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": loginA.RefreshToken,
		"transport":     "web",
	}, http.StatusOK, &refreshedB)
	if refreshedB.Organization == nil || refreshedB.Organization.ID != fx.b.id {
		t.Fatalf("refresh after switch must use current B scope: %+v", refreshedB)
	}
	fx.want(t, http.MethodGet, "/api/auth/me", refreshedB.Token, nil, http.StatusOK)
}

func assertSessionAndFamilyScope(t *testing.T, sessionID, organizationID, membershipID string) {
	t.Helper()
	var sessionOrg, familyOrg, familyMembership string
	var familyMembershipEpoch, currentMembershipEpoch, familyOrganizationEpoch, currentOrganizationEpoch int64
	if err := fx.pool.QueryRow(context.Background(), `
		SELECT s.active_organization_id::text, f.active_organization_id::text,
			f.membership_id::text, f.membership_credential_version, m.credential_version,
			f.organization_credential_version, o.credential_version
		FROM auth_sessions s
		JOIN auth_refresh_families f ON f.session_id=s.id
		JOIN memberships m ON m.id=f.membership_id
		JOIN organizations o ON o.id=f.active_organization_id
		WHERE s.id=$1`, sessionID).Scan(
		&sessionOrg, &familyOrg, &familyMembership, &familyMembershipEpoch,
		&currentMembershipEpoch, &familyOrganizationEpoch, &currentOrganizationEpoch); err != nil {
		t.Fatal(err)
	}
	if sessionOrg != organizationID || familyOrg != organizationID ||
		(membershipID != "" && familyMembership != membershipID) ||
		familyMembershipEpoch != currentMembershipEpoch || familyOrganizationEpoch != currentOrganizationEpoch {
		t.Fatalf("scope mismatch session=%s family=%s membership=%s epochs=%d/%d %d/%d", sessionOrg, familyOrg, familyMembership,
			familyMembershipEpoch, currentMembershipEpoch, familyOrganizationEpoch, currentOrganizationEpoch)
	}
}

func TestLogoutClosesFamilyWhenSessionWasAlreadyRevoked(t *testing.T) {
	ctx := context.Background()
	login := fx.login(t, fx.a.admin.email, fx.a.slug)
	if login.SessionID == "" || login.RefreshToken == "" {
		t.Fatalf("login missing session/refresh: %+v", login)
	}
	if _, err := fx.pool.Exec(ctx, `
		UPDATE auth_sessions
		SET revoked_at=NOW(), revoked_by=$2::uuid, revoke_reason='prior_policy', version=version+1
		WHERE id=$1::uuid`, login.SessionID, fx.a.admin.id); err != nil {
		t.Fatal(err)
	}
	var familyInitiallyOpen bool
	if err := fx.pool.QueryRow(ctx, `SELECT revoked_at IS NULL FROM auth_refresh_families WHERE session_id=$1`, login.SessionID).Scan(&familyInitiallyOpen); err != nil {
		t.Fatal(err)
	}
	if !familyInitiallyOpen {
		t.Fatal("precondition: prior session revocation must leave family open")
	}
	fx.want(t, http.MethodGet, "/api/auth/me", login.Token, nil, http.StatusUnauthorized)
	fx.want(t, http.MethodPost, "/api/auth/logout", "", map[string]string{"refresh_token": login.RefreshToken}, http.StatusOK)

	var sessionRevokedAt, familyRevokedAt time.Time
	var sessionVersion int64
	var sessionReason, familyReason string
	var logoutEvents int
	readState := func() {
		t.Helper()
		if err := fx.pool.QueryRow(ctx, `
			SELECT s.revoked_at, s.revoke_reason, s.version, f.revoked_at, f.revoke_reason
			FROM auth_sessions s JOIN auth_refresh_families f ON f.session_id=s.id
			WHERE s.id=$1`, login.SessionID).Scan(&sessionRevokedAt, &sessionReason, &sessionVersion, &familyRevokedAt, &familyReason); err != nil {
			t.Fatal(err)
		}
		if err := fx.pool.QueryRow(ctx, `
			SELECT count(*) FROM security_audit_events
			WHERE event_type='logout' AND details->>'session_id'=$1`, login.SessionID).Scan(&logoutEvents); err != nil {
			t.Fatal(err)
		}
	}
	readState()
	if sessionReason != "prior_policy" || familyReason != "logout" || logoutEvents != 1 {
		t.Fatalf("logout state session=%s family=%s audit=%d", sessionReason, familyReason, logoutEvents)
	}
	firstSessionRevokedAt, firstFamilyRevokedAt, firstVersion := sessionRevokedAt, familyRevokedAt, sessionVersion

	status, raw := fx.do(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": login.RefreshToken, "transport": "web",
	})
	if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_REVOKED" {
		t.Fatalf("refresh after logout status=%d code=%s", status, apiErrorCode(raw))
	}
	fx.want(t, http.MethodGet, "/api/auth/me", login.Token, nil, http.StatusUnauthorized)
	fx.want(t, http.MethodPost, "/api/auth/logout", "", map[string]string{"refresh_token": login.RefreshToken}, http.StatusOK)
	readState()
	if !sessionRevokedAt.Equal(firstSessionRevokedAt) || !familyRevokedAt.Equal(firstFamilyRevokedAt) || sessionVersion != firstVersion || logoutEvents != 1 {
		t.Fatalf("second logout changed state: session=%s/%s family=%s/%s version=%d/%d audit=%d",
			firstSessionRevokedAt, sessionRevokedAt, firstFamilyRevokedAt, familyRevokedAt, firstVersion, sessionVersion, logoutEvents)
	}
}

func apiErrorCode(raw []byte) string {
	var body struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(raw, &body)
	return body.Code
}
