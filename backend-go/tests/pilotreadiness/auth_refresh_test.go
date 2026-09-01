package pilotreadiness

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// TestRefreshRotationReplayAndLogoutMobileBodyHTTP locks the MOBILE transport
// contract (#460 SEC-4A): the opaque credential rotates through the JSON body.
// The Web equivalent (HttpOnly cookie) is locked in web_refresh_cookie_http_test.go.
func TestRefreshRotationReplayAndLogoutMobileBodyHTTP(t *testing.T) {
	login := fx.mobileLogin(t, fx.a.admin.email, fx.a.slug)
	if login.RefreshExpiresAt == "" || login.AccessExpiresAt == "" || login.AbsoluteSessionExpiresAt == "" {
		t.Fatalf("mobile login must emit refresh/access/absolute expiry metadata: %+v", login)
	}
	for _, wrongTransport := range []string{"web", "sketchup", "support"} {
		status, raw := fx.do(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
			"refresh_token": login.RefreshToken,
			"transport":     wrongTransport,
		})
		if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_INVALID" {
			t.Fatalf("mobile refresh as %s status=%d code=%s", wrongTransport, status, apiErrorCode(raw))
		}
	}

	var rotated loginResponse
	fx.decode(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": login.RefreshToken,
		"transport":     "mobile",
	}, http.StatusOK, &rotated)
	if rotated.Token == "" || rotated.RefreshToken == "" || rotated.RefreshToken == login.RefreshToken {
		t.Fatalf("rotation did not return distinct A2/R2: %+v", rotated)
	}
	fx.want(t, http.MethodGet, "/api/auth/me", rotated.Token, nil, http.StatusOK)

	status, raw := fx.do(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": login.RefreshToken,
		"transport":     "mobile",
	})
	if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_REUSED" {
		t.Fatalf("R1 replay status=%d code=%s body=%s", status, apiErrorCode(raw), raw)
	}
	status, raw = fx.do(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": rotated.RefreshToken,
		"transport":     "mobile",
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
	happyLogin := fx.mobileLogin(t, fx.a.admin.email, fx.a.slug)
	var happyR2, logoutLogin loginResponse
	fx.decode(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": happyLogin.RefreshToken,
		"transport":     "mobile",
	}, http.StatusOK, &happyR2)
	fx.decode(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": happyR2.RefreshToken,
		"transport":     "mobile",
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
		"transport":     "mobile",
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

	// Web transport (#460 SEC-4A): the refresh credential is the HttpOnly
	// cookie; select-org must keep the SAME family and the cookie refresh must
	// return the CURRENT (B) scope.
	loginA := fx.webLogin(t, email, fx.a.slug)
	if loginA.login.SessionID == "" || loginA.cookie == "" {
		t.Fatalf("login missing session/refresh cookie: %+v", loginA.login)
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

	status, raw := fx.do(t, http.MethodPost, "/api/auth/select-org", loginA.login.Token, map[string]string{"organization_id": fx.b.id})
	if status < http.StatusBadRequest || strings.Contains(string(raw), `"token"`) {
		t.Fatalf("failed switch status=%d body=%s", status, raw)
	}
	assertSessionAndFamilyScope(t, loginA.login.SessionID, fx.a.id, "")
	fx.want(t, http.MethodGet, "/api/auth/me", loginA.login.Token, nil, http.StatusOK)

	dropFailureInjection()
	var selectedB loginResponse
	fx.decode(t, http.MethodPost, "/api/auth/select-org", loginA.login.Token, map[string]string{"organization_id": fx.b.id}, http.StatusOK, &selectedB)
	if selectedB.Organization == nil || selectedB.Organization.ID != fx.b.id || selectedB.Token == "" {
		t.Fatalf("successful switch did not return B token: %+v", selectedB)
	}
	assertSessionAndFamilyScope(t, loginA.login.SessionID, fx.b.id, membershipB)
	fx.want(t, http.MethodGet, "/api/auth/me", loginA.login.Token, nil, http.StatusUnauthorized)
	fx.want(t, http.MethodGet, "/api/auth/me", selectedB.Token, nil, http.StatusOK)

	refreshedB := fx.webRefresh(t, &loginA)
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
	login := fx.webLogin(t, fx.a.admin.email, fx.a.slug)
	if login.login.SessionID == "" || login.cookie == "" {
		t.Fatalf("login missing session/refresh cookie: %+v", login.login)
	}
	if _, err := fx.pool.Exec(ctx, `
		UPDATE auth_sessions
		SET revoked_at=NOW(), revoked_by=$2::uuid, revoke_reason='prior_policy', version=version+1
		WHERE id=$1::uuid`, login.login.SessionID, fx.a.admin.id); err != nil {
		t.Fatal(err)
	}
	var familyInitiallyOpen bool
	if err := fx.pool.QueryRow(ctx, `SELECT revoked_at IS NULL FROM auth_refresh_families WHERE session_id=$1`, login.login.SessionID).Scan(&familyInitiallyOpen); err != nil {
		t.Fatal(err)
	}
	if !familyInitiallyOpen {
		t.Fatal("precondition: prior session revocation must leave family open")
	}
	fx.want(t, http.MethodGet, "/api/auth/me", login.login.Token, nil, http.StatusUnauthorized)
	status, raw, resp := fx.doWithHeaders(t, http.MethodPost, "/api/auth/logout", "", nil, webCookieHeaders(login.cookie))
	if status != http.StatusOK {
		t.Fatalf("web cookie logout status=%d body=%s", status, raw)
	}
	if c := webRefreshCookieFromResponse(t, resp); c != "" {
		t.Fatalf("web cookie logout must clear granete_web_refresh, got %q", c)
	}

	var sessionRevokedAt, familyRevokedAt time.Time
	var sessionVersion int64
	var sessionReason, familyReason string
	var logoutEvents int
	readState := func() {
		t.Helper()
		if err := fx.pool.QueryRow(ctx, `
			SELECT s.revoked_at, s.revoke_reason, s.version, f.revoked_at, f.revoke_reason
			FROM auth_sessions s JOIN auth_refresh_families f ON f.session_id=s.id
			WHERE s.id=$1`, login.login.SessionID).Scan(&sessionRevokedAt, &sessionReason, &sessionVersion, &familyRevokedAt, &familyReason); err != nil {
			t.Fatal(err)
		}
		if err := fx.pool.QueryRow(ctx, `
			SELECT count(*) FROM security_audit_events
			WHERE event_type='logout' AND details->>'session_id'=$1`, login.login.SessionID).Scan(&logoutEvents); err != nil {
			t.Fatal(err)
		}
	}
	readState()
	if sessionReason != "prior_policy" || familyReason != "logout" || logoutEvents != 1 {
		t.Fatalf("logout state session=%s family=%s audit=%d", sessionReason, familyReason, logoutEvents)
	}
	firstSessionRevokedAt, firstFamilyRevokedAt, firstVersion := sessionRevokedAt, familyRevokedAt, sessionVersion

	status, raw, _ = fx.doWithHeaders(t, http.MethodPost, "/api/auth/refresh", "", nil, webCookieHeaders(login.cookie))
	if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_REVOKED" {
		t.Fatalf("refresh after logout status=%d code=%s", status, apiErrorCode(raw))
	}
	fx.want(t, http.MethodGet, "/api/auth/me", login.login.Token, nil, http.StatusUnauthorized)
	status, raw, _ = fx.doWithHeaders(t, http.MethodPost, "/api/auth/logout", "", nil, webCookieHeaders(login.cookie))
	if status != http.StatusOK {
		t.Fatalf("repeated web cookie logout must stay idempotent: status=%d body=%s", status, raw)
	}
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
