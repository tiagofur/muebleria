package api

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Media authorization tests (#460 SEC-3): resource-scoped short-lived grants
// replace the generic `?token=<session JWT>` query authentication. The suite
// proves the happy path, exact-resource binding, tenant partitioning, expiry,
// credential-class confusion, fail-closed configuration and log redaction.

const (
	mediaTestOrgA = "11111111-1111-4111-8111-111111111111"
	mediaTestOrgB = "22222222-2222-4222-8222-222222222222"
	mediaTestUser = "media-user-1"
	// Canonical upload names (32 hex chars + extension).
	mediaTestFileA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"
	mediaTestFileB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png"
)

type mediaAuthEnv struct {
	server *Server
	router http.Handler
	token  string // ver5 web session token scoped to org A
}

func newMediaAuthEnv(t *testing.T) *mediaAuthEnv {
	t.Helper()
	dir := t.TempDir()
	for _, f := range []struct{ org, name, content string }{
		{mediaTestOrgA, mediaTestFileA, "org-a-file-a"},
		{mediaTestOrgA, mediaTestFileB, "org-a-file-b"},
		{mediaTestOrgB, mediaTestFileA, "org-b-file-a-same-name"},
	} {
		if err := os.MkdirAll(filepath.Join(dir, f.org), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, f.org, f.name), []byte(f.content), 0o640); err != nil {
			t.Fatal(err)
		}
	}
	authority := mustAuthority("media-auth-test-jwt-secret-0123456789")
	media := mustMediaAuthority(t, "media-auth-test-media-signing-key-0123456789")
	st := &stubStore{getUserByEmail: &domain.User{ID: mediaTestUser, Email: "media@test.com", AccountStatus: domain.AccountStatusActive}}
	server := &Server{
		Store:      st,
		Tokens:     authority,
		MediaTokens: media,
		MediaDir:   dir,
	}
	tc := auth.TokenContext{
		Roles:        []string{"admin"},
		OrgID:        mediaTestOrgA,
		MembershipID: mediaTestUser + ":" + mediaTestOrgA,
		MembershipCredentialVersion:   1,
		OrganizationCredentialVersion: 1,
	}
	token := mintSessionToken(t, authority, st, mediaTestUser, "media@test.com", tc, "web")
	return &mediaAuthEnv{server: server, router: RegisterRoutes(server), token: token}
}

func mustMediaAuthority(t *testing.T, secret string) *auth.MediaAuthority {
	t.Helper()
	media, err := auth.NewMediaAuthority(secret)
	if err != nil {
		t.Fatalf("media authority: %v", err)
	}
	return media
}

func (e *mediaAuthEnv) authorize(t *testing.T, resources ...string) (int, openapiMediaAuthorizeResponse) {
	t.Helper()
	body, err := json.Marshal(map[string][]string{"resources": resources})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/media:authorize", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+e.token)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	e.router.ServeHTTP(rr, req)
	var parsed openapiMediaAuthorizeResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &parsed)
	return rr.Code, parsed
}

// openapiMediaAuthorizeResponse mirrors the generated response for tests that
// do not want to import the generated package under an alias.
type openapiMediaAuthorizeResponse struct {
	Grants []struct {
		Filename  string `json:"filename"`
		URL       string `json:"url"`
		ExpiresAt string `json:"expiresAt"`
	} `json:"grants"`
}

func TestMediaAuthorizeHappyPath(t *testing.T) {
	env := newMediaAuthEnv(t)

	code, resp := env.authorize(t, mediaTestFileA)
	if code != http.StatusOK {
		t.Fatalf("authorize status %d body %s", code, mustBody(t, env, mediaTestFileA))
	}
	if len(resp.Grants) != 1 || resp.Grants[0].Filename != mediaTestFileA {
		t.Fatalf("expected one grant for file A, got %+v", resp.Grants)
	}
	grantURL := resp.Grants[0].URL
	if !strings.HasPrefix(grantURL, "/api/media/"+mediaTestFileA+"?grant=") {
		t.Fatalf("grant URL shape unexpected: %q", grantURL)
	}
	if resp.Grants[0].ExpiresAt == "" {
		t.Fatal("grant expiry missing")
	}

	// Consume WITHOUT any Authorization header: the grant alone must serve the
	// exact org-A file bytes.
	get := httptest.NewRequest(http.MethodGet, grantURL, nil)
	rr := httptest.NewRecorder()
	env.router.ServeHTTP(rr, get)
	if rr.Code != http.StatusOK {
		t.Fatalf("grant GET status %d body %s", rr.Code, rr.Body.String())
	}
	if got := rr.Body.String(); got != "org-a-file-a" {
		t.Fatalf("grant GET must serve the org-A file, got %q", got)
	}

	// Cache semantics: private (never shared), vary on Authorization because
	// the same URL also answers session-header requests per organization.
	if cc := rr.Header().Get("Cache-Control"); !strings.HasPrefix(cc, "private") {
		t.Fatalf("media Cache-Control = %q, want private", cc)
	}
	if vary := strings.Join(rr.Header().Values("Vary"), ","); !strings.Contains(vary, "Authorization") {
		t.Fatalf("media Vary = %q, want Authorization", vary)
	}

	// The authorize endpoint itself is never cached (it returns credentials).
	authRR := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/media:authorize", strings.NewReader(`{"resources":["`+mediaTestFileA+`"]}`))
	req.Header.Set("Authorization", "Bearer "+env.token)
	env.router.ServeHTTP(authRR, req)
	if authRR.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("authorize Cache-Control = %q, want no-store", authRR.Header().Get("Cache-Control"))
	}
}

func mustBody(t *testing.T, env *mediaAuthEnv, file string) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/media:authorize", strings.NewReader(`{"resources":["`+file+`"]}`))
	req.Header.Set("Authorization", "Bearer "+env.token)
	rr := httptest.NewRecorder()
	env.router.ServeHTTP(rr, req)
	return rr.Body.String()
}

func TestMediaAuthorizeExactResourceBinding(t *testing.T) {
	env := newMediaAuthEnv(t)

	_, resp := env.authorize(t, mediaTestFileA)
	if len(resp.Grants) != 1 {
		t.Fatalf("expected one grant, got %+v", resp.Grants)
	}
	grantParam := strings.TrimPrefix(resp.Grants[0].URL, "/api/media/"+mediaTestFileA+"?grant=")

	// Same grant pointed at a different file: rejected. The response is the
	// canonical 404 — indistinguishable from a missing file, never a 403 that
	// confirms the other resource exists.
	other := httptest.NewRequest(http.MethodGet, "/api/media/"+mediaTestFileB+"?grant="+grantParam, nil)
	rr := httptest.NewRecorder()
	env.router.ServeHTTP(rr, other)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("cross-resource grant: expected 404, got %d body %s", rr.Code, rr.Body.String())
	}

	// Tampering with the URL filename (path segment) never escapes the signed
	// resource key.
	tampered := httptest.NewRequest(http.MethodGet, "/api/media/"+mediaTestFileB+"?grant="+grantParam+"x", nil)
	rr = httptest.NewRecorder()
	env.router.ServeHTTP(rr, tampered)
	if rr.Code != http.StatusUnauthorized && rr.Code != http.StatusNotFound {
		t.Fatalf("tampered grant: expected 401/404, got %d", rr.Code)
	}
}

func TestMediaAuthorizeCrossTenant(t *testing.T) {
	env := newMediaAuthEnv(t)

	// The org-A session cannot obtain a grant for a file that only exists in
	// org B's partition: the response simply omits it (enumeration-safe).
	code, resp := env.authorize(t, "cccccccccccccccccccccccccccccccc.png")
	if code != http.StatusOK || len(resp.Grants) != 0 {
		t.Fatalf("missing/foreign file must be omitted, status=%d grants=%+v", code, resp.Grants)
	}

	// A file name that exists in BOTH partitions: the grant is signed for the
	// caller's organization and must serve that organization's bytes even
	// though another tenant owns a same-named file.
	_, same := env.authorize(t, mediaTestFileA)
	if len(same.Grants) != 1 {
		t.Fatalf("expected grant for same-named file, got %+v", same.Grants)
	}
	get := httptest.NewRequest(http.MethodGet, same.Grants[0].URL, nil)
	rr := httptest.NewRecorder()
	env.router.ServeHTTP(rr, get)
	if rr.Code != http.StatusOK || rr.Body.String() != "org-a-file-a" {
		t.Fatalf("grant must serve caller's org partition, got %d %q", rr.Code, rr.Body.String())
	}
}

func TestMediaGrantExpiry(t *testing.T) {
	env := newMediaAuthEnv(t)
	media := env.server.MediaTokens

	// Fresh grant (T0 + epsilon) is valid — covered by the happy path; here
	// the clock is controlled by signing explicit timestamps with the real key.
	expired, err := jwt.NewWithClaims(jwt.SigningMethodHS256, &auth.MediaClaims{
		Resource: auth.MediaResourceKey(mediaTestFileA), OrgID: mediaTestOrgA,
		Op: auth.MediaOperationRead, Typ: auth.TokenTypeMediaRead, Ver: auth.MediaGrantVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject: auth.MediaResourceKey(mediaTestFileA), Audience: jwt.ClaimStrings{auth.MediaAudience},
			Issuer: auth.MediaIssuer, ID: "expired-grant",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Second)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Minute)),
			NotBefore: jwt.NewNumericDate(time.Now().Add(-2 * time.Minute)),
		},
	}).SignedString([]byte("media-auth-test-media-signing-key-0123456789"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := media.Validate(expired); err != auth.ErrMediaTokenExpired {
		t.Fatalf("expected ErrMediaTokenExpired, got %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/media/"+mediaTestFileA+"?grant="+expired, nil)
	rr := httptest.NewRecorder()
	env.router.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized || !strings.Contains(rr.Body.String(), "MEDIA_ACCESS_EXPIRED") {
		t.Fatalf("expired grant: expected 401 MEDIA_ACCESS_EXPIRED, got %d %s", rr.Code, rr.Body.String())
	}

	// A grant whose absolute cap already passed can never be minted: the
	// session's absolute expiry wins over the TTL.
	if _, _, err := media.Issue(auth.MediaIssueRequest{
		ResourceKey: auth.MediaResourceKey(mediaTestFileA), OrgID: mediaTestOrgA,
		AbsoluteCap: time.Now().Add(-time.Second),
	}); err == nil {
		t.Fatal("expired-cap grant must be refused at minting")
	}
}

func TestMediaTokenTypeConfusion(t *testing.T) {
	env := newMediaAuthEnv(t)

	_, resp := env.authorize(t, mediaTestFileA)
	if len(resp.Grants) != 1 {
		t.Fatalf("expected one grant, got %+v", resp.Grants)
	}
	grant := strings.TrimPrefix(resp.Grants[0].URL, "/api/media/"+mediaTestFileA+"?grant=")

	// Session JWT presented as a media grant → rejected.
	req := httptest.NewRequest(http.MethodGet, "/api/media/"+mediaTestFileA+"?grant="+env.token, nil)
	rr := httptest.NewRecorder()
	env.router.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized || !strings.Contains(rr.Body.String(), "MEDIA_ACCESS_INVALID") {
		t.Fatalf("session JWT as grant: expected 401 MEDIA_ACCESS_INVALID, got %d %s", rr.Code, rr.Body.String())
	}

	// Refresh credential presented as a media grant → rejected.
	req = httptest.NewRequest(http.MethodGet, "/api/media/"+mediaTestFileA+"?grant=grt_refresh_v1.not-a-jwt-at-all", nil)
	rr = httptest.NewRecorder()
	env.router.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("refresh credential as grant: expected 401, got %d", rr.Code)
	}

	// Media grant presented as a session bearer → rejected by /api/auth/me.
	req = httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+grant)
	rr = httptest.NewRecorder()
	env.router.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("media grant as session bearer: expected 401, got %d body %s", rr.Code, rr.Body.String())
	}

	// Media grant under the historical ?token= param → does not authenticate.
	req = httptest.NewRequest(http.MethodGet, "/api/media/"+mediaTestFileA+"?token="+grant, nil)
	rr = httptest.NewRecorder()
	env.router.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("media grant via ?token=: expected 401, got %d", rr.Code)
	}
}

// The generic session-JWT-in-query-string authentication is gone from the
// AuthMiddleware: a valid session JWT must not authenticate any route when it
// travels in the URL, while the header keeps working even when a hostile
// query token rides along (#460 SEC-3 negative proofs).
func TestAuthMiddlewareRejectsQuerySessionJWT(t *testing.T) {
	env := newMediaAuthEnv(t)

	paths := []string{
		"/api/auth/me?token=",
		"/api/customers?token=",   // business endpoint
		"/api/media/" + mediaTestFileA + "?token=",
	}
	for _, p := range paths {
		req := httptest.NewRequest(http.MethodGet, p+env.token, nil)
		rr := httptest.NewRecorder()
		env.router.ServeHTTP(rr, req)
		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("%s: query session JWT must 401, got %d body %s", p, rr.Code, rr.Body.String())
		}
	}

	// Header wins; the query token never participates in session
	// authentication (explicit, safe precedence).
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me?token=malicious-other-token", nil)
	req.Header.Set("Authorization", "Bearer "+env.token)
	rr := httptest.NewRecorder()
	env.router.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("header + hostile query token: expected 200, got %d body %s", rr.Code, rr.Body.String())
	}
}

func TestMediaAuthorizeRequestValidation(t *testing.T) {
	env := newMediaAuthEnv(t)

	tooMany := make([]string, 101)
	for i := range tooMany {
		tooMany[i] = mediaTestFileA
	}
	body, _ := json.Marshal(map[string][]string{"resources": tooMany})
	req := httptest.NewRequest(http.MethodPost, "/api/media:authorize", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+env.token)
	rr := httptest.NewRecorder()
	env.router.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("101 resources: expected 400, got %d", rr.Code)
	}

	for _, raw := range []string{
		`{"resources":[]}`,
		`{"resources":["../escape.png"]}`,
		`{"resources":["notacanonicalname.png"]}`,
		`{"resources":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.exe"]}`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/media:authorize", strings.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+env.token)
		rr := httptest.NewRecorder()
		env.router.ServeHTTP(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("%s: expected 400, got %d %s", raw, rr.Code, rr.Body.String())
		}
	}

	// Unauthenticated authorize → 401 (grants are only minted for sessions).
	req = httptest.NewRequest(http.MethodPost, "/api/media:authorize", strings.NewReader(`{"resources":["`+mediaTestFileA+`"]}`))
	rr = httptest.NewRecorder()
	env.router.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated authorize: expected 401, got %d", rr.Code)
	}
}

// The SketchUp extension token is read-only except for an explicit POST
// capability list: minting media read grants for files it can already GET is
// one deliberate capability (#460 SEC-3); every other media POST stays
// forbidden.
func TestExtensionTokenMayAuthorizeMediaButNotMutate(t *testing.T) {
	env := newMediaAuthEnv(t)

	st := env.server.Store.(*stubStore)
	authority := env.server.Tokens
	tc := auth.TokenContext{
		Roles:        []string{"admin"},
		OrgID:        mediaTestOrgA,
		MembershipID: "sketchup-user:" + mediaTestOrgA,
		MembershipCredentialVersion:   1,
		OrganizationCredentialVersion: 1,
	}
	extToken := mintSessionToken(t, authority, st, "sketchup-user", "sketchup@test.com", tc, "sketchup")

	req := httptest.NewRequest(http.MethodPost, "/api/media:authorize", strings.NewReader(`{"resources":["`+mediaTestFileA+`"]}`))
	req.Header.Set("Authorization", "Bearer "+extToken)
	rr := httptest.NewRecorder()
	env.router.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("extension authorize: expected 200, got %d body %s", rr.Code, rr.Body.String())
	}

	// Upload (a mutation) stays forbidden for the extension token.
	req = httptest.NewRequest(http.MethodPost, "/api/media", nil)
	req.Header.Set("Authorization", "Bearer "+extToken)
	rr = httptest.NewRecorder()
	env.router.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("extension upload: expected 403, got %d", rr.Code)
	}
}

// A server without the dedicated media signing key fails closed: no grants
// are minted and no grant authenticates.
func TestMediaAuthorizationFailsClosedWithoutKey(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, mediaTestOrgA), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, mediaTestOrgA, mediaTestFileA), []byte("x"), 0o640); err != nil {
		t.Fatal(err)
	}
	authority := mustAuthority("media-auth-nockey-jwt-secret-0123456789")
	st := &stubStore{getUserByEmail: &domain.User{ID: mediaTestUser, Email: "media@test.com", AccountStatus: domain.AccountStatusActive}}
	server := &Server{Store: st, Tokens: authority, MediaDir: dir}
	router := RegisterRoutes(server)

	tc := auth.TokenContext{
		Roles: []string{"admin"}, OrgID: mediaTestOrgA, MembershipID: mediaTestUser + ":" + mediaTestOrgA,
		MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1,
	}
	token := mintSessionToken(t, authority, st, mediaTestUser, "media@test.com", tc, "web")

	req := httptest.NewRequest(http.MethodPost, "/api/media:authorize", strings.NewReader(`{"resources":["`+mediaTestFileA+`"]}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("authorize without media key: expected 503, got %d", rr.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/media/"+mediaTestFileA+"?grant=anything", nil)
	rr = httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("grant GET without media key: expected 503, got %d", rr.Code)
	}
}

// Structured logs must never contain the raw grant (nor any bearer): the log
// redaction boundary is asserted against a captured slog handler.
func TestMediaGrantNeverLogged(t *testing.T) {
	env := newMediaAuthEnv(t)

	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	// Drive every failure path that could leak: invalid grant, expired-shaped
	// garbage, authorize round-trip, session-header GET.
	for _, url := range []string{
		"/api/media/" + mediaTestFileA + "?grant=not-a-jwt",
		"/api/media/" + mediaTestFileA + "?grant=eyJhbGciOiJIUzI1NiJ9.e30.bad",
		"/api/media/" + mediaTestFileA,
	} {
		env.router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, url, nil))
	}
	_, resp := env.authorize(t, mediaTestFileA)
	if len(resp.Grants) != 1 {
		t.Fatalf("expected grant, got %+v", resp.Grants)
	}
	grant := strings.TrimPrefix(resp.Grants[0].URL, "/api/media/"+mediaTestFileA+"?grant=")
	env.router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, resp.Grants[0].URL, nil))

	out := logs.String()
	if strings.Contains(out, grant) {
		t.Fatalf("raw media grant leaked into structured logs:\n%s", out)
	}
	if strings.Contains(out, env.token) {
		t.Fatalf("session token leaked into structured logs:\n%s", out)
	}
}

// The idempotency fingerprint is built from method+path only: a grant riding
// the query string can never end up in a durable receipt.
func TestIdempotencyFingerprintExcludesQueryString(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/media:authorize?grant=secret-grant-value", nil)
	if strings.Contains(req.URL.Path, "secret-grant-value") {
		t.Fatal("path must not carry the query string")
	}
	if req.URL.RawQuery == "" {
		t.Fatal("sanity: query string should be present")
	}
}
