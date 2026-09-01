package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #460 / SEC-1: server-side session registry. These tests lock the ver5
// credential path: sid-bound tokens resolve their registry row live, revocation
// and absolute expiry cut access even with an unexpired JWT, credential classes
// never interchange, and login/select-org/refresh keep one stable session id.

const sessionRegistryTestSecret = "session-registry-test-secret-32b"

// sessionAwareUsers extends staticUsers with the registry lookup so ver5
// tokens resolve their session row through the real middleware path.
type sessionAwareUsers struct {
	*staticUsers
	sessions map[string]*domain.AuthSession
}

func (s *sessionAwareUsers) GetAuthSessionForRequest(_ context.Context, sessionID, expectedUserID string) (*domain.AuthSession, error) {
	if session, ok := s.sessions[sessionID]; ok && session.UserID == expectedUserID {
		return session, nil
	}
	return nil, storage.ErrAuthSessionNotFound
}

func sessionRegistryFixture() *sessionAwareUsers {
	return &sessionAwareUsers{
		staticUsers: &staticUsers{
			byID: map[string]*domain.User{
				"u-1": {ID: "u-1", Email: "u@test.com", AccountStatus: domain.AccountStatusActive},
			},
			memberships: map[string]*domain.MembershipWithOrg{
				"u-1:org-1": {
					Membership: domain.Membership{
						ID: "u-1:org-1", OrganizationID: "org-1", UserID: "u-1",
						CredentialVersion: 1, Roles: []domain.UserRole{domain.RoleUser}, Status: domain.MembershipStatusActive,
					},
					Organization: domain.Organization{ID: "org-1", Status: domain.OrganizationStatusActive, CredentialVersion: 1},
				},
			},
		},
		sessions: map[string]*domain.AuthSession{},
	}
}

func (s *sessionAwareUsers) addSession(id string, mutate func(*domain.AuthSession)) {
	session := &domain.AuthSession{
		ID: id, UserID: "u-1", ClientType: domain.SessionClientWeb,
		CreatedAt:         time.Now().Add(-time.Hour),
		AbsoluteExpiresAt: time.Now().Add(17 * time.Hour),
	}
	if mutate != nil {
		mutate(session)
	}
	s.sessions[id] = session
}

func ver5Token(t *testing.T, sid string) string {
	t.Helper()
	token, err := mustAuthority(sessionRegistryTestSecret).IssueTransportToken("u-1", "u@test.com", auth.TokenContext{
		Roles: []string{"user"}, OrgID: "org-1", MembershipID: "u-1:org-1",
		MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1, SessionID: sid,
	}, "web")
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func serveSessionRegistry(t *testing.T, users MembershipLookup, token string) *httptest.ResponseRecorder {
	t.Helper()
	handler := AuthMiddleware(mustAuthority(sessionRegistryTestSecret), users)(okHandler())
	req := httptest.NewRequest(http.MethodGet, "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func sessionErrorCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v (body=%q)", err, rec.Body.String())
	}
	return body.Code
}

// Negative proof (#460): revoking the registry session invalidates the token
// immediately even though the JWT itself has not expired.
func TestAuthMiddleware_RevokedSessionCutsImmediately(t *testing.T) {
	users := sessionRegistryFixture()
	users.addSession("sess-live", nil)
	revokedAt := time.Now().Add(-time.Minute)
	users.addSession("sess-revoked", func(s *domain.AuthSession) { s.RevokedAt = &revokedAt })

	if rec := serveSessionRegistry(t, users, ver5Token(t, "sess-live")); rec.Code != http.StatusOK {
		t.Fatalf("live session: expected 200, got %d", rec.Code)
	}
	rec := serveSessionRegistry(t, users, ver5Token(t, "sess-revoked"))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("revoked session: expected 401, got %d", rec.Code)
	}
	if code := sessionErrorCode(t, rec); code != "SESSION_REVOKED" {
		t.Fatalf("revoked session: expected SESSION_REVOKED, got %q", code)
	}
}

// Negative proof (#460): the registry's absolute expiry bounds the session even
// if the JWT exp window is wider (SketchUp 30d policy reusing this mechanism).
func TestAuthMiddleware_SessionAbsoluteExpiryCutsToken(t *testing.T) {
	users := sessionRegistryFixture()
	users.addSession("sess-expired", func(s *domain.AuthSession) {
		s.AbsoluteExpiresAt = time.Now().Add(-time.Second)
	})
	rec := serveSessionRegistry(t, users, ver5Token(t, "sess-expired"))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expired session: expected 401, got %d", rec.Code)
	}
	if code := sessionErrorCode(t, rec); code != "SESSION_REVOKED" {
		t.Fatalf("expired session: expected SESSION_REVOKED, got %q", code)
	}
}

// A store that cannot resolve registry rows fails CLOSED for ver5 tokens —
// registry-bound credentials never bypass the registry.
func TestAuthMiddleware_Ver5FailsClosedWithoutSessionLookup(t *testing.T) {
	users := sessionRegistryFixture() // implements lookup…
	bare := users.staticUsers         // …this one does not
	rec := serveSessionRegistry(t, bare, ver5Token(t, "sess-any"))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("ver5 without session lookup: expected 401, got %d", rec.Code)
	}
}

// Negative proof (#460): credential classes never interchange — a web token
// whose sid resolves to a sketchup session row is rejected.
func TestAuthMiddleware_SessionClientTypeMismatchRejected(t *testing.T) {
	users := sessionRegistryFixture()
	users.addSession("sess-sketchup", func(s *domain.AuthSession) {
		s.ClientType = domain.SessionClientSketchup
	})
	rec := serveSessionRegistry(t, users, ver5Token(t, "sess-sketchup"))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("client type mismatch: expected 401, got %d", rec.Code)
	}
}

// A ver5 token resolving another user's session row is rejected.
func TestAuthMiddleware_SessionUserMismatchRejected(t *testing.T) {
	users := sessionRegistryFixture()
	users.addSession("sess-other", func(s *domain.AuthSession) { s.UserID = "someone-else" })
	rec := serveSessionRegistry(t, users, ver5Token(t, "sess-other"))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("user mismatch: expected 401, got %d", rec.Code)
	}
}

// Login registers the session and returns its id; the ver5 token carries the
// same sid.
func TestLoginCreatesSessionAndReturnsSessionID(t *testing.T) {
	server, st := loginTestServer(t)
	rec := doLogin(t, server, map[string]string{"email": "u@example.com", "password": "secret123", "org": "taller-uno"})
	if rec.Code != http.StatusOK {
		t.Fatalf("login: %d %s", rec.Code, rec.Body.String())
	}
	var resp LoginResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.SessionID == nil || *resp.SessionID == "" {
		t.Fatal("login response must carry session_id")
	}
	if len(st.authSessions) != 1 {
		t.Fatalf("registry rows = %d, want 1", len(st.authSessions))
	}
	claims, err := mustAuthority("unit-test-secret-0123456789abcdef").Validate(resp.Token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.Sid != *resp.SessionID || claims.Typ != auth.TokenTypeAccessWeb {
		t.Fatalf("claims sid/typ = %q/%q, want %q/%s", claims.Sid, claims.Typ, *resp.SessionID, auth.TokenTypeAccessWeb)
	}
}

// The org-less selection phase registers the session with an empty scope;
// select-org updates the SAME row so the session id stays stable (#460).
func TestSelectOrgKeepsStableSessionID(t *testing.T) {
	server, st := loginTestServer(t)
	rec := doLogin(t, server, map[string]string{"email": "u@example.com", "password": "secret123"})
	if rec.Code != http.StatusOK {
		t.Fatalf("login: %d %s", rec.Code, rec.Body.String())
	}
	var login LoginResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &login); err != nil {
		t.Fatal(err)
	}
	if !login.SelectionRequired || login.SessionID == nil {
		t.Fatalf("expected selection_required with session_id: %+v", login)
	}

	claims, err := mustAuthority("unit-test-secret-0123456789abcdef").Validate(login.Token)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.WithValue(context.Background(), UserContextKey, claims)
	body := `{"organization_id":"org-1"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/select-org", strings.NewReader(body))
	req = req.WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	server.HandleSelectOrg(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("select-org: %d %s", rec.Code, rec.Body.String())
	}
	var selected LoginResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &selected); err != nil {
		t.Fatal(err)
	}
	if selected.SessionID == nil || *selected.SessionID != *login.SessionID {
		t.Fatalf("session id must stay stable across select-org: %v -> %v", login.SessionID, selected.SessionID)
	}
	if len(st.authSessions) != 1 {
		t.Fatalf("select-org must not mint a second registry row (rows=%d)", len(st.authSessions))
	}
	session := st.authSessions[*login.SessionID]
	if session.MembershipID == nil || *session.MembershipID != "u1:org-1" {
		t.Fatalf("scope not updated: %+v", session)
	}
}

// A ver4 refresh upgrades to ver5: a registry row is created bounded by the
// ORIGINAL absolute origin, so the upgrade cannot extend the session.
func TestRefreshVer4UpgradesToVer5PreservingAbsoluteOrigin(t *testing.T) {
	server, st := loginTestServer(t)
	started := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Second)
	legacy, err := auth.GenerateLegacyWebToken("u1", "u@example.com", auth.TokenContext{
		Roles: []string{"vendedor"}, OrgID: "org-1", MembershipID: "u1:org-1",
		MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1, AuthStartedAt: started,
	}, "unit-test-secret-0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	claims, err := mustAuthority("unit-test-secret-0123456789abcdef").Validate(legacy)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.WithValue(context.Background(), UserContextKey, claims)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	server.HandleRefresh(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("refresh: %d %s", rec.Code, rec.Body.String())
	}
	var resp LoginResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.SessionID == nil {
		t.Fatal("upgraded refresh must return session_id")
	}
	session := st.authSessions[*resp.SessionID]
	if session == nil {
		t.Fatal("upgraded refresh must register the session")
	}
	if want := started.Add(auth.AccessTokenTTL); !session.AbsoluteExpiresAt.Equal(want) {
		t.Fatalf("registry absolute expiry = %s, want original origin + 18h (%s)", session.AbsoluteExpiresAt, want)
	}
}
