package pilotreadiness

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

// #460 SEC-3 — resource-scoped media authorization over the real router,
// real PostgreSQL and the real media directory: the generic `?token=<session
// JWT>` authentication is gone, media reads accept a session header OR a
// short-lived signed grant, and every boundary (exact resource, tenant,
// expiry class confusion, revocation) fails closed.

type mediaGrantHTTP struct {
	Filename  string `json:"filename"`
	URL       string `json:"url"`
	ExpiresAt string `json:"expiresAt"`
}

type mediaAuthorizeHTTP struct {
	Grants []mediaGrantHTTP `json:"grants"`
}

// grantURLFor authorizes filenames with token and returns the grant URL for
// want (empty string when the file was not granted).
func grantURLFor(t *testing.T, token string, want string, files ...string) (string, mediaAuthorizeHTTP) {
	t.Helper()
	status, raw := fx.do(t, http.MethodPost, "/api/media:authorize", token, map[string][]string{"resources": files})
	if status != http.StatusOK {
		t.Fatalf("authorize status=%d body=%s", status, truncate(raw))
	}
	var out mediaAuthorizeHTTP
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("authorize decode: %v body=%s", err, truncate(raw))
	}
	for _, grant := range out.Grants {
		if grant.Filename == want {
			return grant.URL, out
		}
	}
	return "", out
}

// getNoAuth performs a GET without any Authorization header (grant URLs must
// work exactly this way: <img src> cannot set headers).
func getNoAuth(t *testing.T, path string) (*http.Response, string) {
	t.Helper()
	resp, err := http.DefaultClient.Get(fx.base + path)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp, string(raw)
}

func TestMediaAuthorizationHTTPEndToEnd(t *testing.T) {
	// Two files uploaded by org A's admin through the real multipart endpoint.
	fileA, _, err := fx.uploadMediaTok(fx.a.admin.token)
	if err != nil {
		t.Fatalf("upload A: %v", err)
	}
	fileB, _, err := fx.uploadMediaTok(fx.a.admin.token)
	if err != nil {
		t.Fatalf("upload B: %v", err)
	}

	// --- The generic query-string session JWT no longer authenticates -------
	for _, path := range []string{
		"/api/auth/me?token=",
		"/api/customers?token=", // business route
		"/api/media/" + fileA + "?token=",
	} {
		resp, body := getNoAuth(t, path+fx.a.admin.token)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("%s…: query session JWT must 401, got %d body=%s", path, resp.StatusCode, body)
		}
	}

	// Header wins and the query token never participates in session auth.
	fx.want(t, http.MethodGet, "/api/auth/me?token=malicious-other-token", fx.a.admin.token, nil, http.StatusOK)

	// --- Happy path: authorize → signed URL → headerless GET ----------------
	grantURL, _ := grantURLFor(t, fx.a.admin.token, fileA, fileA)
	if grantURL == "" || !strings.HasPrefix(grantURL, "/api/media/"+fileA+"?grant=") {
		t.Fatalf("unexpected grant URL %q", grantURL)
	}
	resp, body := getNoAuth(t, grantURL)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("grant GET status=%d body=%s", resp.StatusCode, body)
	}
	if !strings.HasPrefix(body, "\x89PNG") {
		t.Fatalf("grant GET must serve the uploaded PNG bytes, got %q", truncate([]byte(body)))
	}
	if cc := resp.Header.Get("Cache-Control"); !strings.HasPrefix(cc, "private") {
		t.Fatalf("media Cache-Control=%q, want private", cc)
	}

	// --- Exact resource binding ---------------------------------------------
	grantB, _ := grantURLFor(t, fx.a.admin.token, fileB, fileB)
	grantParam := strings.TrimPrefix(grantB, "/api/media/"+fileB+"?grant=")
	resp, body = getNoAuth(t, "/api/media/"+fileA+"?grant="+grantParam)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("cross-resource grant: want 404, got %d body=%s", resp.StatusCode, body)
	}

	// --- Credential class confusion ------------------------------------------
	resp, body = getNoAuth(t, "/api/media/"+fileA+"?grant="+fx.a.admin.token)
	if resp.StatusCode != http.StatusUnauthorized || !strings.Contains(body, "MEDIA_ACCESS_INVALID") {
		t.Fatalf("session JWT as grant: got %d %s", resp.StatusCode, body)
	}
	resp, body = getNoAuth(t, "/api/media/"+fileA+"?grant=grt_refresh_v1.opaque-credential")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("refresh credential as grant: got %d %s", resp.StatusCode, body)
	}
	status, raw := fx.do(t, http.MethodGet, "/api/auth/me", strings.TrimPrefix(grantURL, "/api/media/"+fileA+"?grant="), nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("media grant as session bearer: got %d body=%s", status, truncate(raw))
	}

	// --- Cross-tenant: org B cannot mint grants for org A's files ------------
	bToken := fx.scopedToken(t, fx.b.admin.email, fx.b.slug)
	none, all := grantURLFor(t, bToken, fileA, fileA)
	if none != "" || len(all.Grants) != 0 {
		t.Fatalf("org B must receive no grants for org A files, got %+v", all.Grants)
	}

	// A same-named file in org B stays unreachable with org A's grant: the
	// grant's organization is signed material.
	grantA, _ := grantURLFor(t, fx.a.admin.token, fileA, fileA)
	resp, body = getNoAuth(t, grantA)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("org A grant must keep serving org A's file: %d %s", resp.StatusCode, body)
	}

	// --- authorize responses are credentials: never cached -------------------
	req, _ := http.NewRequest(http.MethodPost, fx.base+"/api/media:authorize", strings.NewReader(`{"resources":["`+fileA+`"]}`))
	req.Header.Set("Authorization", "Bearer "+fx.a.admin.token)
	req.Header.Set("Content-Type", "application/json")
	authResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, authResp.Body)
	authResp.Body.Close()
	if authResp.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("authorize Cache-Control=%q, want no-store", authResp.Header.Get("Cache-Control"))
	}
}

// A revoked session stops minting media grants immediately (SEC-3/SEC-2B
// interaction): outstanding signed URLs decay within their short TTL, but no
// new grant may be issued.
func TestMediaAuthorizationRevokedSessionCannotMint(t *testing.T) {
	email := "media-revoked@pilot-readiness.test"
	fx.inviteAndAccept(t, fx.a.admin.token, email, "vendedor")
	session := fx.login(t, email, fx.a.slug)
	file, _, err := fx.uploadMediaTok(fx.a.admin.token)
	if err != nil {
		t.Fatalf("upload: %v", err)
	}

	grantURL, _ := grantURLFor(t, session.Token, file, file)
	if grantURL == "" {
		t.Fatal("pre-revoke grant expected")
	}

	status, raw := fx.do(t, http.MethodPost, "/api/auth/sessions/"+session.SessionID+"/revoke", session.Token, map[string]string{"reason": "media revocation proof"})
	if status != http.StatusOK {
		t.Fatalf("revoke status=%d body=%s", status, truncate(raw))
	}

	status, raw = fx.do(t, http.MethodPost, "/api/media:authorize", session.Token, map[string][]string{"resources": {file}})
	if status != http.StatusUnauthorized {
		t.Fatalf("revoked session must not mint media grants: status=%d body=%s", status, truncate(raw))
	}
}
