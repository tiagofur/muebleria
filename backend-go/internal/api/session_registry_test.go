package api

import (
	"context"
	"encoding/json"
	"errors"
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
	membershipID, orgID := "u-1:org-1", "org-1"
	session := &domain.AuthSession{
		ID: id, UserID: "u-1", ClientType: domain.SessionClientWeb,
		MembershipID:         &membershipID,
		ActiveOrganizationID: &orgID,
		CreatedAt:            time.Now().Add(-time.Hour),
		AbsoluteExpiresAt:    time.Now().Add(17 * time.Hour),
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
	// SEC-4A: the bodyless bearer bridge is the SketchUp/support compatibility
	// path; the upgrade mechanism is proven with the extension transport.
	legacy, err := auth.GenerateLegacyExtensionToken("u1", "u@example.com", auth.TokenContext{
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
	if want := started.Add(auth.ExtensionTokenTTL); !session.AbsoluteExpiresAt.Equal(want) {
		t.Fatalf("registry absolute expiry = %s, want original origin + sketchup TTL (%s)", session.AbsoluteExpiresAt, want)
	}
}

// SEC-4A: the legacy bodyless bearer bridge is restricted to the credential
// classes without an opaque refresh family (SketchUp/support). A web bearer —
// ver4 or ver5 — must be denied so web sessions only rotate through the
// cookie flow.
func TestRefreshLegacyBridgeDeniesWebAndMobileBearers(t *testing.T) {
	server, _ := loginTestServer(t)
	started := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	legacyWeb, err := auth.GenerateLegacyWebToken("u1", "u@example.com", auth.TokenContext{
		Roles: []string{"vendedor"}, OrgID: "org-1", MembershipID: "u1:org-1",
		MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1, AuthStartedAt: started,
	}, "unit-test-secret-0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	for name, token := range map[string]string{"ver4 web": legacyWeb} {
		claims, err := mustAuthority("unit-test-secret-0123456789abcdef").Validate(token)
		if err != nil {
			t.Fatalf("validate %s: %v", name, err)
		}
		ctx := context.WithValue(context.Background(), UserContextKey, claims)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
		req = req.WithContext(ctx)
		rec := httptest.NewRecorder()
		server.HandleRefresh(rec, req)
		if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "REFRESH_INVALID") {
			t.Fatalf("%s bearer bridge must be denied, got %d %s", name, rec.Code, rec.Body.String())
		}
	}

	// A ver5 web session token is equally denied: its family rotates through
	// the HttpOnly cookie flow, never through the bearer bridge.
	loginRec := doLogin(t, server, map[string]string{"email": "u@example.com", "password": "secret123"})
	var login LoginResponse
	if err := json.Unmarshal(loginRec.Body.Bytes(), &login); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	req.Header.Set("Authorization", "Bearer "+login.Token)
	AuthMiddleware(mustAuthority("unit-test-secret-0123456789abcdef"), server.Store)(http.HandlerFunc(server.HandleRefresh)).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "REFRESH_INVALID") {
		t.Fatalf("ver5 web bearer bridge must be denied, got %d %s", rec.Code, rec.Body.String())
	}
}

// Negative proof (#460 Blocker 1): the registry is the authority of the
// CURRENT scope. After select-org A→B on the same sid, the previous scoped
// bearer for A stops validating immediately, the org-less selection token is
// rejected too, and only the new B token passes.
func TestSelectOrgSwitchInvalidatesPreviousScopeTokens(t *testing.T) {
	server, st := loginTestServer(t)
	authority := mustAuthority("unit-test-secret-0123456789abcdef")

	loginRec := doLogin(t, server, map[string]string{"email": "u@example.com", "password": "secret123"})
	if loginRec.Code != http.StatusOK {
		t.Fatalf("login: %d %s", loginRec.Code, loginRec.Body.String())
	}
	var login LoginResponse
	if err := json.Unmarshal(loginRec.Body.Bytes(), &login); err != nil {
		t.Fatal(err)
	}
	orglessClaims, err := authority.Validate(login.Token)
	if err != nil {
		t.Fatal(err)
	}

	var lastToken string
	doSelectOrg := func(orgID string) LoginResponse {
		t.Helper()
		claims, err := authority.Validate(login.Token)
		if err != nil {
			t.Fatalf("validate before select %s: %v", orgID, err)
		}
		if claims.OrgID != "" {
			// Refresh-style exchange is not needed here: reuse the scoped token
			// the previous select returned.
			claims, err = authority.Validate(lastToken)
			if err != nil {
				t.Fatalf("validate scoped before select %s: %v", orgID, err)
			}
		}
		ctx := context.WithValue(context.Background(), UserContextKey, claims)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/select-org", strings.NewReader(`{"organization_id":"`+orgID+`"}`))
		req = req.WithContext(ctx)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		server.HandleSelectOrg(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("select-org %s: %d %s", orgID, rec.Code, rec.Body.String())
		}
		var resp LoginResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		lastToken = resp.Token
		return resp
	}

	serve := func(token, path string) int {
		t.Helper()
		handler := AuthMiddleware(authority, st)(okHandler())
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec.Code
	}

	// Phase 1: org-less selection token is valid for auth routes while the
	// session is still org-less.
	if code := serve(login.Token, "/api/auth/me"); code != http.StatusOK {
		t.Fatalf("org-less token before switch: expected 200, got %d", code)
	}

	// Phase 2: select org-1; the scoped A token works, and the org-less
	// selection token is immediately rejected.
	first := doSelectOrg("org-1")
	tokenA := first.Token
	if code := serve(tokenA, "/api/protected"); code != http.StatusOK {
		t.Fatalf("scoped A token: expected 200, got %d", code)
	}
	if code := serve(login.Token, "/api/auth/me"); code != http.StatusUnauthorized {
		t.Fatalf("org-less token after switch: expected 401, got %d", code)
	}
	_ = orglessClaims

	// Phase 3: switch A→B on the same sid. The previous A bearer stops
	// validating immediately; only the new B token passes.
	second := doSelectOrg("org-2")
	tokenB := second.Token
	if code := serve(tokenA, "/api/protected"); code != http.StatusUnauthorized {
		t.Fatalf("previous scope token after switch: expected 401, got %d", code)
	}
	if code := serve(tokenB, "/api/protected"); code != http.StatusOK {
		t.Fatalf("new scope token after switch: expected 200, got %d", code)
	}
}

// Negative proof (#460 Blocker 5): a failed switch never mutates the current
// session scope. Failures are injected AFTER target validation — one at the
// user fetch, one at the scope update itself — and the registry keeps the
// previous scope so the outstanding bearer continues to validate.
func TestSelectOrgFailedSwitchPreservesScope(t *testing.T) {
	server, st := loginTestServer(t)
	authority := mustAuthority("unit-test-secret-0123456789abcdef")

	loginRec := doLogin(t, server, map[string]string{"email": "u@example.com", "password": "secret123"})
	if loginRec.Code != http.StatusOK {
		t.Fatalf("login: %d %s", loginRec.Code, loginRec.Body.String())
	}
	var login LoginResponse
	if err := json.Unmarshal(loginRec.Body.Bytes(), &login); err != nil {
		t.Fatal(err)
	}
	orglessClaims, err := authority.Validate(login.Token)
	if err != nil {
		t.Fatal(err)
	}

	doSwitch := func(store Store) *httptest.ResponseRecorder {
		t.Helper()
		failing := &Server{Store: store, Tokens: authority}
		ctx := context.WithValue(context.Background(), UserContextKey, orglessClaims)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/select-org", strings.NewReader(`{"organization_id":"org-1"}`))
		req = req.WithContext(ctx)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		failing.HandleSelectOrg(rec, req)
		return rec
	}

	serveOrgless := func() int {
		t.Helper()
		handler := AuthMiddleware(authority, st)(okHandler())
		req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
		req.Header.Set("Authorization", "Bearer "+login.Token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec.Code
	}

	if code := serveOrgless(); code != http.StatusOK {
		t.Fatalf("org-less token before failed switch: expected 200, got %d", code)
	}

	// Injection 1: user lookup fails after target validation (before the scope
	// mutation in the reordered flow).
	userFailing := &selectOrgUserFailingStore{stubStore: st}
	if rec := doSwitch(userFailing); rec.Code == http.StatusOK {
		t.Fatal("switch with failing user lookup must not succeed")
	}
	if len(st.authSessions) != 1 || st.authSessions[*login.SessionID].ActiveOrganizationID != nil {
		t.Fatalf("failed switch must not change the scope: %+v", st.authSessions)
	}
	if code := serveOrgless(); code != http.StatusOK {
		t.Fatalf("org-less token after failed switch: expected 200, got %d", code)
	}

	// Injection 2: the scope update itself fails.
	scopeFailing := &selectOrgScopeFailingStore{stubStore: st}
	if rec := doSwitch(scopeFailing); rec.Code == http.StatusOK {
		t.Fatal("switch with failing scope update must not succeed")
	}
	if st.authSessions[*login.SessionID].ActiveOrganizationID != nil {
		t.Fatalf("failed scope update must leave the registry org-less: %+v", st.authSessions)
	}
	if code := serveOrgless(); code != http.StatusOK {
		t.Fatalf("org-less token after failed scope update: expected 200, got %d", code)
	}
}

type selectOrgUserFailingStore struct {
	*stubStore
}

func (s *selectOrgUserFailingStore) GetUserByID(context.Context, string) (*domain.User, error) {
	return nil, errors.New("injected user lookup failure")
}

type selectOrgScopeFailingStore struct {
	*stubStore
}

func (s *selectOrgScopeFailingStore) UpdateAuthSessionScope(context.Context, string, string, string) error {
	return storage.ErrAuthSessionNotFound
}

// sessionScopeMatchesClaims unit matrix: the registry scope must match the
// token scope exactly for org-less, scoped, and support credentials.
func TestSessionScopeMatchesClaimsMatrix(t *testing.T) {
	value := func(v string) *string { return &v }
	now := time.Now()
	base := &domain.AuthSession{ID: "s", UserID: "u1", ClientType: domain.SessionClientWeb, CreatedAt: now, AbsoluteExpiresAt: now.Add(time.Hour)}

	cases := []struct {
		name    string
		claims  *auth.Claims
		session func(*domain.AuthSession)
		want    bool
	}{
		{"orgless match", &auth.Claims{UserID: "u1"}, func(s *domain.AuthSession) {}, true},
		{"orgless vs scoped session", &auth.Claims{UserID: "u1"}, func(s *domain.AuthSession) {
			s.MembershipID, s.ActiveOrganizationID = value("m1"), value("org1")
		}, false},
		{"scoped match", &auth.Claims{UserID: "u1", OrgID: "org1", MembershipID: "m1"}, func(s *domain.AuthSession) {
			s.MembershipID, s.ActiveOrganizationID = value("m1"), value("org1")
		}, true},
		{"scoped vs other org", &auth.Claims{UserID: "u1", OrgID: "org2", MembershipID: "m1"}, func(s *domain.AuthSession) {
			s.MembershipID, s.ActiveOrganizationID = value("m1"), value("org1")
		}, false},
		{"scoped vs other membership same org", &auth.Claims{UserID: "u1", OrgID: "org1", MembershipID: "m2"}, func(s *domain.AuthSession) {
			s.MembershipID, s.ActiveOrganizationID = value("m1"), value("org1")
		}, false},
		{"scoped vs orgless session", &auth.Claims{UserID: "u1", OrgID: "org1", MembershipID: "m1"}, func(s *domain.AuthSession) {}, false},
		{"support match", &auth.Claims{UserID: "u1", Support: &auth.SupportClaims{OrgID: "org1", SessionID: "ss1"}}, func(s *domain.AuthSession) {
			s.ClientType = domain.SessionClientSupport
			s.ActiveOrganizationID, s.SupportSessionID = value("org1"), value("ss1")
		}, true},
		{"support wrong session row", &auth.Claims{UserID: "u1", Support: &auth.SupportClaims{OrgID: "org1", SessionID: "ss2"}}, func(s *domain.AuthSession) {
			s.ClientType = domain.SessionClientSupport
			s.ActiveOrganizationID, s.SupportSessionID = value("org1"), value("ss1")
		}, false},
		{"support with membership in session", &auth.Claims{UserID: "u1", Support: &auth.SupportClaims{OrgID: "org1", SessionID: "ss1"}}, func(s *domain.AuthSession) {
			s.ClientType = domain.SessionClientSupport
			s.ActiveOrganizationID, s.SupportSessionID = value("org1"), value("ss1")
			s.MembershipID = value("m1")
		}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			session := &domain.AuthSession{ID: base.ID, UserID: base.UserID, ClientType: base.ClientType, CreatedAt: base.CreatedAt, AbsoluteExpiresAt: base.AbsoluteExpiresAt}
			tc.session(session)
			if got := sessionScopeMatchesClaims(tc.claims, session); got != tc.want {
				t.Fatalf("sessionScopeMatchesClaims = %v, want %v", got, tc.want)
			}
		})
	}
}
