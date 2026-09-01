package pilotreadiness

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"
)

type sessionDirectoryHTTP struct {
	Items []sessionSummaryHTTP `json:"items"`
	Limit int                  `json:"limit"`
}

type sessionSummaryHTTP struct {
	ID           string  `json:"id"`
	MembershipID *string `json:"membership_id"`
	IsCurrent    bool    `json:"is_current"`
	Status       string  `json:"status"`
}

type sessionRevokeHTTP struct {
	Session sessionSummaryHTTP `json:"session"`
	Revoked bool               `json:"revoked"`
}

func sessionDirectory(t *testing.T, path, token string, status int) sessionDirectoryHTTP {
	t.Helper()
	var directory sessionDirectoryHTTP
	fx.decode(t, http.MethodGet, path, token, nil, status, &directory)
	if directory.Limit != 100 || len(directory.Items) > directory.Limit {
		t.Fatalf("unbounded session directory: %+v", directory)
	}
	return directory
}

func hasSession(directory sessionDirectoryHTTP, sessionID string) bool {
	for _, session := range directory.Items {
		if session.ID == sessionID {
			return true
		}
	}
	return false
}

func exactRevokeWithKey(t *testing.T, path, token, key, reason string) (int, []byte) {
	t.Helper()
	body, err := json.Marshal(map[string]string{"reason": reason})
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, fx.base+path, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("%s Cache-Control=%q", path, resp.Header.Get("Cache-Control"))
	}
	return resp.StatusCode, raw
}

func sessionInDirectory(directory sessionDirectoryHTTP, sessionID string) (sessionSummaryHTTP, bool) {
	for _, session := range directory.Items {
		if session.ID == sessionID {
			return session, true
		}
	}
	return sessionSummaryHTTP{}, false
}

func expectRefreshRevoked(t *testing.T, refreshToken string) {
	t.Helper()
	status, raw := fx.do(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{"refresh_token": refreshToken, "transport": "web"})
	if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_REVOKED" {
		t.Fatalf("refresh after exact revoke status=%d code=%s body=%s", status, apiErrorCode(raw), raw)
	}
}

func TestSessionDirectoryHTTPSelfCurrentAndOtherSession(t *testing.T) {
	const email = "session-directory-self@pilot-readiness.test"
	fx.inviteAndAccept(t, fx.a.admin.token, email, "vendedor")
	s1 := fx.login(t, email, fx.a.slug)
	s2 := fx.login(t, email, fx.a.slug)
	if s1.SessionID == s2.SessionID {
		t.Fatal("self proof requires two distinct sessions")
	}
	self := sessionDirectory(t, "/api/auth/sessions", s1.Token, http.StatusOK)
	summary1, ok1 := sessionInDirectory(self, s1.SessionID)
	summary2, ok2 := sessionInDirectory(self, s2.SessionID)
	if !ok1 || !ok2 || !summary1.IsCurrent || summary2.IsCurrent {
		t.Fatalf("self current markers S1=%+v/%v S2=%+v/%v", summary1, ok1, summary2, ok2)
	}
	foreign := fx.login(t, fx.a.admin.email, fx.a.slug)
	for i, sessionID := range []string{foreign.SessionID, nonexistentUUID} {
		status, raw := exactRevokeWithKey(t, "/api/auth/sessions/"+sessionID+"/revoke", s1.Token, []string{"session-directory-self-foreign-0001", "session-directory-self-missing-0001"}[i], "enumeration proof")
		if status != http.StatusNotFound || apiErrorCode(raw) != "SESSION_NOT_FOUND" {
			t.Fatalf("self foreign/missing session=%s status=%d code=%s body=%s", sessionID, status, apiErrorCode(raw), raw)
		}
	}
	fx.want(t, http.MethodGet, "/api/auth/me", s1.Token, nil, http.StatusOK)

	status, raw := exactRevokeWithKey(t, "/api/auth/sessions/"+s2.SessionID+"/revoke", s1.Token, "session-directory-self-other-0001", "self other device")
	var other sessionRevokeHTTP
	if err := json.Unmarshal(raw, &other); status != http.StatusOK || err != nil || !other.Revoked || other.Session.IsCurrent {
		t.Fatalf("self other revoke status=%d response=%+v decode=%v body=%s", status, other, err, raw)
	}
	fx.want(t, http.MethodGet, "/api/auth/me", s2.Token, nil, http.StatusUnauthorized)
	expectRefreshRevoked(t, s2.RefreshToken)
	fx.want(t, http.MethodGet, "/api/auth/me", s1.Token, nil, http.StatusOK)

	status, raw = exactRevokeWithKey(t, "/api/auth/sessions/"+s1.SessionID+"/revoke", s1.Token, "session-directory-self-current-0001", "self current device")
	var current sessionRevokeHTTP
	if err := json.Unmarshal(raw, &current); status != http.StatusOK || err != nil || !current.Revoked || !current.Session.IsCurrent {
		t.Fatalf("self current revoke status=%d response=%+v decode=%v body=%s", status, current, err, raw)
	}
	fx.want(t, http.MethodGet, "/api/auth/me", s1.Token, nil, http.StatusUnauthorized)
	expectRefreshRevoked(t, s1.RefreshToken)
}

func TestSessionDirectoryHTTPOrganizationAndMembershipIsolation(t *testing.T) {
	const email = "session-directory-org@pilot-readiness.test"
	acceptedA := fx.inviteAndAccept(t, fx.a.admin.token, email, "vendedor")
	fx.inviteAndAccept(t, fx.b.admin.token, email, "vendedor")
	userID := acceptedA.User.ID
	membershipA := findTeamHTTPMember(t, teamDirectory(t, fx.a.admin.token), userID).MembershipID
	membershipB := findTeamHTTPMember(t, teamDirectory(t, fx.b.admin.token), userID).MembershipID
	sa1 := fx.login(t, email, fx.a.slug)
	sa2 := fx.login(t, email, fx.a.slug)
	sb1 := fx.login(t, email, fx.b.slug)

	orgA := sessionDirectory(t, "/api/org/memberships/"+membershipA+"/sessions", fx.a.admin.token, http.StatusOK)
	orgB := sessionDirectory(t, "/api/org/memberships/"+membershipB+"/sessions", fx.b.admin.token, http.StatusOK)
	if !hasSession(orgA, sa1.SessionID) || !hasSession(orgA, sa2.SessionID) || hasSession(orgA, sb1.SessionID) ||
		!hasSession(orgB, sb1.SessionID) || hasSession(orgB, sa1.SessionID) || hasSession(orgB, sa2.SessionID) {
		t.Fatalf("membership directories crossed scopes: A=%+v B=%+v", orgA, orgB)
	}

	revokeA1 := "/api/org/memberships/" + membershipA + "/sessions/" + sa1.SessionID + "/revoke"
	status, raw := exactRevokeWithKey(t, revokeA1, fx.a.admin.token, "session-directory-org-a1-0001", "lost organization device")
	var revoked sessionRevokeHTTP
	if err := json.Unmarshal(raw, &revoked); status != http.StatusOK || err != nil || !revoked.Revoked {
		t.Fatalf("org exact revoke status=%d response=%+v decode=%v body=%s", status, revoked, err, raw)
	}
	fx.want(t, http.MethodGet, "/api/auth/me", sa1.Token, nil, http.StatusUnauthorized)
	expectRefreshRevoked(t, sa1.RefreshToken)
	fx.want(t, http.MethodGet, "/api/auth/me", sa2.Token, nil, http.StatusOK)
	fx.want(t, http.MethodGet, "/api/auth/me", sb1.Token, nil, http.StatusOK)
	var sa2Rotated, sb1Rotated loginResponse
	fx.decode(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{"refresh_token": sa2.RefreshToken, "transport": "web"}, http.StatusOK, &sa2Rotated)
	fx.decode(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{"refresh_token": sb1.RefreshToken, "transport": "web"}, http.StatusOK, &sb1Rotated)
	fx.want(t, http.MethodGet, "/api/auth/me", sa2Rotated.Token, nil, http.StatusOK)
	fx.want(t, http.MethodGet, "/api/auth/me", sb1Rotated.Token, nil, http.StatusOK)

	status, raw = exactRevokeWithKey(t, "/api/org/memberships/"+membershipB+"/sessions/"+sb1.SessionID+"/revoke", sb1Rotated.Token, "session-directory-seller-denied-0001", "seller must not revoke")
	if status != http.StatusForbidden || apiErrorCode(raw) != "FORBIDDEN" {
		t.Fatalf("seller revoke status=%d code=%s body=%s", status, apiErrorCode(raw), raw)
	}
	status, raw = exactRevokeWithKey(t, "/api/org/memberships/"+membershipA+"/sessions/"+sb1.SessionID+"/revoke", fx.a.admin.token, "session-directory-cross-session-0001", "known foreign session")
	if status != http.StatusNotFound || apiErrorCode(raw) != "SESSION_NOT_FOUND" {
		t.Fatalf("known cross-org session status=%d code=%s body=%s", status, apiErrorCode(raw), raw)
	}
	status, raw = fx.do(t, http.MethodGet, "/api/org/memberships/"+membershipB+"/sessions", fx.a.admin.token, nil)
	if status != http.StatusNotFound || apiErrorCode(raw) != "MEMBERSHIP_NOT_FOUND" {
		t.Fatalf("cross-org membership status=%d code=%s body=%s", status, apiErrorCode(raw), raw)
	}
	fx.want(t, http.MethodGet, "/api/auth/me", sa2Rotated.Token, nil, http.StatusOK)
	fx.want(t, http.MethodGet, "/api/auth/me", sb1Rotated.Token, nil, http.StatusOK)
}

func TestSessionDirectoryHTTPPlatformListAndRevoke(t *testing.T) {
	const email = "session-directory-platform@pilot-readiness.test"
	accepted := fx.inviteAndAccept(t, fx.a.admin.token, email, "vendedor")
	login := fx.login(t, email, fx.a.slug)
	status, raw := fx.do(t, http.MethodGet, "/api/platform/users/"+accepted.User.ID+"/sessions", login.Token, nil)
	if status != http.StatusForbidden || apiErrorCode(raw) != "FORBIDDEN" {
		t.Fatalf("non-platform list status=%d code=%s body=%s", status, apiErrorCode(raw), raw)
	}
	status, raw = exactRevokeWithKey(t, "/api/platform/users/"+accepted.User.ID+"/sessions/"+login.SessionID+"/revoke", login.Token, "session-directory-non-platform-0001", "must be platform")
	if status != http.StatusForbidden || apiErrorCode(raw) != "FORBIDDEN" {
		t.Fatalf("non-platform revoke status=%d code=%s body=%s", status, apiErrorCode(raw), raw)
	}
	platform := sessionDirectory(t, "/api/platform/users/"+accepted.User.ID+"/sessions", fx.platform.token, http.StatusOK)
	if !hasSession(platform, login.SessionID) {
		t.Fatalf("platform directory missing session: %+v", platform)
	}
	status, raw = exactRevokeWithKey(t, "/api/platform/users/"+accepted.User.ID+"/sessions/"+login.SessionID+"/revoke", fx.platform.token, "session-directory-platform-0001", "platform response")
	if status != http.StatusOK {
		t.Fatalf("platform revoke status=%d body=%s", status, raw)
	}
	fx.want(t, http.MethodGet, "/api/auth/me", login.Token, nil, http.StatusUnauthorized)
	expectRefreshRevoked(t, login.RefreshToken)
}

func TestSessionDirectoryHTTPFailureRollback(t *testing.T) {
	ctx := context.Background()
	for _, failure := range []string{"family-update", "audit-insert"} {
		t.Run(failure, func(t *testing.T) {
			email := "session-directory-" + failure + "@pilot-readiness.test"
			accepted := fx.inviteAndAccept(t, fx.a.admin.token, email, "vendedor")
			membershipID := findTeamHTTPMember(t, teamDirectory(t, fx.a.admin.token), accepted.User.ID).MembershipID
			login := fx.login(t, email, fx.a.slug)

			var installSQL string
			var dropFailure func()
			if failure == "family-update" {
				dropFailure = func() {
					_, _ = fx.pool.Exec(ctx, `DROP TRIGGER IF EXISTS fail_session_directory_http_family ON auth_refresh_families`)
					_, _ = fx.pool.Exec(ctx, `DROP FUNCTION IF EXISTS fail_session_directory_http_family()`)
				}
				installSQL = `
					CREATE FUNCTION fail_session_directory_http_family() RETURNS trigger LANGUAGE plpgsql AS $$
					BEGIN RAISE EXCEPTION 'injected session directory family failure'; END $$;
					CREATE TRIGGER fail_session_directory_http_family
					BEFORE UPDATE ON auth_refresh_families
					FOR EACH ROW EXECUTE FUNCTION fail_session_directory_http_family()`
			} else {
				dropFailure = func() {
					_, _ = fx.pool.Exec(ctx, `DROP TRIGGER IF EXISTS fail_session_directory_http_audit ON security_audit_events`)
					_, _ = fx.pool.Exec(ctx, `DROP FUNCTION IF EXISTS fail_session_directory_http_audit()`)
				}
				installSQL = `
					CREATE FUNCTION fail_session_directory_http_audit() RETURNS trigger LANGUAGE plpgsql AS $$
					BEGIN RAISE EXCEPTION 'injected session directory audit failure'; END $$;
					CREATE TRIGGER fail_session_directory_http_audit
					BEFORE INSERT ON security_audit_events
					FOR EACH ROW WHEN (NEW.event_type='session_revoked_by_organization_admin')
					EXECUTE FUNCTION fail_session_directory_http_audit()`
			}
			dropFailure()
			t.Cleanup(dropFailure)
			if _, err := fx.pool.Exec(ctx, installSQL); err != nil {
				t.Fatal(err)
			}

			path := "/api/org/memberships/" + membershipID + "/sessions/" + login.SessionID + "/revoke"
			status, raw := exactRevokeWithKey(t, path, fx.a.admin.token, "session-directory-"+failure+"-0001", "failure injection")
			if status != http.StatusInternalServerError || apiErrorCode(raw) != "INTERNAL_ERROR" {
				t.Fatalf("%s failure status=%d code=%s body=%s", failure, status, apiErrorCode(raw), raw)
			}
			var sessionOpen, familyOpen bool
			var auditCount int
			if err := fx.pool.QueryRow(ctx, `SELECT revoked_at IS NULL FROM auth_sessions WHERE id=$1`, login.SessionID).Scan(&sessionOpen); err != nil {
				t.Fatal(err)
			}
			if err := fx.pool.QueryRow(ctx, `SELECT revoked_at IS NULL FROM auth_refresh_families WHERE session_id=$1`, login.SessionID).Scan(&familyOpen); err != nil {
				t.Fatal(err)
			}
			if err := fx.pool.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE event_type='session_revoked_by_organization_admin' AND details->>'session_id'=$1`, login.SessionID).Scan(&auditCount); err != nil {
				t.Fatal(err)
			}
			if !sessionOpen || !familyOpen || auditCount != 0 {
				t.Fatalf("partial HTTP revoke after %s: sessionOpen=%v familyOpen=%v audit=%d", failure, sessionOpen, familyOpen, auditCount)
			}
			fx.want(t, http.MethodGet, "/api/auth/me", login.Token, nil, http.StatusOK)
			dropFailure()
			var rotated loginResponse
			fx.decode(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{"refresh_token": login.RefreshToken, "transport": "web"}, http.StatusOK, &rotated)
			fx.want(t, http.MethodGet, "/api/auth/me", rotated.Token, nil, http.StatusOK)
		})
	}
}

func TestSessionDirectoryHTTPFamilyOnlyRepairIsMonotonic(t *testing.T) {
	ctx := context.Background()
	const repairEmail = "session-directory-family-repair@pilot-readiness.test"
	repairAccepted := fx.inviteAndAccept(t, fx.a.admin.token, repairEmail, "vendedor")
	repairMembership := findTeamHTTPMember(t, teamDirectory(t, fx.a.admin.token), repairAccepted.User.ID).MembershipID
	repairLogin := fx.login(t, repairEmail, fx.a.slug)
	if _, err := fx.pool.Exec(ctx, `
		UPDATE auth_sessions
		SET revoked_at=NOW(), revoked_by=$2::uuid, revoke_reason='prior_policy', version=version+1
		WHERE id=$1::uuid`, repairLogin.SessionID, fx.a.admin.id); err != nil {
		t.Fatal(err)
	}
	repairPath := "/api/org/memberships/" + repairMembership + "/sessions/" + repairLogin.SessionID + "/revoke"
	status, raw := exactRevokeWithKey(t, repairPath, fx.a.admin.token, "session-directory-family-repair-0001", "close surviving family")
	var first sessionRevokeHTTP
	if err := json.Unmarshal(raw, &first); status != http.StatusOK || err != nil || !first.Revoked {
		t.Fatalf("family repair status=%d response=%+v decode=%v body=%s", status, first, err, raw)
	}
	var firstFamilyRevokedAt time.Time
	if err := fx.pool.QueryRow(ctx, `SELECT revoked_at FROM auth_refresh_families WHERE session_id=$1`, repairLogin.SessionID).Scan(&firstFamilyRevokedAt); err != nil {
		t.Fatal(err)
	}
	status, raw = exactRevokeWithKey(t, repairPath, fx.a.admin.token, "session-directory-family-repair-0002", "close surviving family")
	var retry sessionRevokeHTTP
	if err := json.Unmarshal(raw, &retry); status != http.StatusOK || err != nil || retry.Revoked {
		t.Fatalf("family repair retry status=%d response=%+v decode=%v body=%s", status, retry, err, raw)
	}
	var secondFamilyRevokedAt time.Time
	var auditCount int
	if err := fx.pool.QueryRow(ctx, `SELECT revoked_at FROM auth_refresh_families WHERE session_id=$1`, repairLogin.SessionID).Scan(&secondFamilyRevokedAt); err != nil {
		t.Fatal(err)
	}
	if err := fx.pool.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE event_type='session_revoked_by_organization_admin' AND details->>'session_id'=$1`, repairLogin.SessionID).Scan(&auditCount); err != nil {
		t.Fatal(err)
	}
	if !firstFamilyRevokedAt.Equal(secondFamilyRevokedAt) || auditCount != 1 {
		t.Fatalf("retry mutated family or audit: revokedAt=%s/%s audit=%d", firstFamilyRevokedAt, secondFamilyRevokedAt, auditCount)
	}
}
