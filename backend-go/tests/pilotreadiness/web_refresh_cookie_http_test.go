package pilotreadiness

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"
)

// #460 SEC-4A proofs: the Web transport's rotating refresh credential lives
// exclusively in the HttpOnly granete_web_refresh cookie — never in Web JSON,
// never sliding, CSRF-bounded, sharing the SEC-2A family/rotation/reuse model.

func findSetCookie(t *testing.T, resp *http.Response) *http.Cookie {
	t.Helper()
	for _, cookie := range resp.Cookies() {
		if cookie.Name == "granete_web_refresh" {
			return cookie
		}
	}
	return nil
}

// accessTokenClaims decodes the fixture-signed JWT's payload without
// re-validating (the assertions are about exp arithmetic, not signature).
func accessTokenClaims(t *testing.T, token string) (iat, exp time.Time) {
	t.Helper()
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("access token is not a JWS: %d parts", len(parts))
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var claims struct {
		Iat int64 `json:"iat"`
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		t.Fatal(err)
	}
	return time.Unix(claims.Iat, 0), time.Unix(claims.Exp, 0)
}

// TestWebAccessTokenShortTTLAndAbsoluteCap locks the SEC-4B lifetime policy at
// the HTTP boundary: the Web bearer is a ~15-minute rolling credential whose
// exp equals access_expires_at and never overshoots the session's absolute
// bound — while Mobile keeps the workday credential until SEC-5.
func TestWebAccessTokenShortTTLAndAbsoluteCap(t *testing.T) {
	sess := fx.webLogin(t, fx.a.admin.email, fx.a.slug)
	webIat, webExp := accessTokenClaims(t, sess.login.Token)
	webTTL := webExp.Sub(webIat)
	if webTTL < 14*time.Minute || webTTL > 16*time.Minute {
		t.Fatalf("web access TTL = %v, want ~15m", webTTL)
	}
	webAccessExpiry, err := time.Parse(time.RFC3339Nano, sess.login.AccessExpiresAt)
	if err != nil {
		t.Fatal(err)
	}
	// access_expires_at mirrors the minting arithmetic exactly (same server
	// clock, same cap): it must equal the JWT exp to the second.
	if !webAccessExpiry.Truncate(time.Second).Equal(webExp.Truncate(time.Second)) {
		t.Fatalf("access_expires_at %s != JWT exp %s", webAccessExpiry, webExp)
	}
	webAbsolute, err := time.Parse(time.RFC3339Nano, sess.login.AbsoluteSessionExpiresAt)
	if err != nil {
		t.Fatal(err)
	}
	if webExp.After(webAbsolute) {
		t.Fatalf("web JWT exp %s overshoots absolute session bound %s", webExp, webAbsolute)
	}

	mobile := fx.mobileLogin(t, fx.a.admin.email, fx.a.slug)
	mobileIat, mobileExp := accessTokenClaims(t, mobile.Token)
	if ttl := mobileExp.Sub(mobileIat); ttl < 14*time.Minute || ttl > 16*time.Minute {
		t.Fatalf("mobile access TTL = %v, want ~15m (SEC-5 boundary)", ttl)
	}

	// T0+17:59 shape: shrink the live absolute bound under one rolling window
	// and rotate — the minted bearer must be capped by the deadline, not by
	// now+15m, and its metadata must still equal the JWT exp.
	ctx := context.Background()
	shrunk := time.Now().UTC().Add(2 * time.Minute).Truncate(time.Second)
	if _, err := fx.pool.Exec(ctx, `
		WITH session_update AS (
			UPDATE auth_sessions SET absolute_expires_at=$2 WHERE id = ANY($1::uuid[]) RETURNING id
		), family_update AS (
			UPDATE auth_refresh_families SET absolute_expires_at=$2 WHERE session_id = ANY($1::uuid[]) RETURNING id
		)
		UPDATE auth_refresh_credentials SET expires_at=$2 WHERE session_id = ANY($1::uuid[])`,
		[]string{sess.login.SessionID, mobile.SessionID}, shrunk); err != nil {
		t.Fatal(err)
	}
	capped := fx.webRefresh(t, &sess)
	_, cappedExp := accessTokenClaims(t, capped.Token)
	if cappedExp.Truncate(time.Second).After(shrunk) {
		t.Fatalf("capped refresh JWT exp %s overshoots shrunk absolute bound %s", cappedExp, shrunk)
	}
	cappedAccessExpiry, err := time.Parse(time.RFC3339Nano, capped.AccessExpiresAt)
	if err != nil {
		t.Fatal(err)
	}
	if !cappedAccessExpiry.Truncate(time.Second).Equal(cappedExp.Truncate(time.Second)) {
		t.Fatalf("capped access_expires_at %s != JWT exp %s", cappedAccessExpiry, cappedExp)
	}

	cappedMobile := fx.mobileRefresh(t, &mobile)
	_, cappedMobileExp := accessTokenClaims(t, cappedMobile.Token)
	if cappedMobileExp.Truncate(time.Second).After(shrunk) {
		t.Fatalf("capped mobile refresh JWT exp %s overshoots shrunk absolute bound %s", cappedMobileExp, shrunk)
	}
	cappedMobileAccessExpiry, err := time.Parse(time.RFC3339Nano, cappedMobile.AccessExpiresAt)
	if err != nil {
		t.Fatal(err)
	}
	if !cappedMobileAccessExpiry.Truncate(time.Second).Equal(cappedMobileExp.Truncate(time.Second)) {
		t.Fatalf("capped mobile access_expires_at %s != JWT exp %s", cappedMobileAccessExpiry, cappedMobileExp)
	}
}

func TestWebRefreshCookieLoginAttributesAndTransportMatrix(t *testing.T) {
	// --- Web login: cookie in, no secret out ---------------------------------
	status, raw, resp := fx.doWithHeaders(t, http.MethodPost, "/api/auth/login", "", map[string]string{
		"email": fx.a.admin.email, "password": pilotPassword, "org": fx.a.slug, "transport": "web",
	}, nil)
	if status != http.StatusOK {
		t.Fatalf("web login status=%d body=%s", status, raw)
	}
	var webLogin loginResponse
	if err := json.Unmarshal(raw, &webLogin); err != nil {
		t.Fatal(err)
	}
	if webLogin.RefreshToken != "" || webLogin.RefreshExpiresAt != "" {
		t.Fatalf("web login JSON must not carry the refresh secret: %+v", webLogin)
	}
	if webLogin.AccessExpiresAt == "" || webLogin.AbsoluteSessionExpiresAt == "" {
		t.Fatalf("web login must expose server-clock expiry metadata: %+v", webLogin)
	}
	cookie := findSetCookie(t, resp)
	if cookie == nil {
		t.Fatal("web login must set granete_web_refresh")
	}
	if !cookie.HttpOnly {
		t.Fatal("granete_web_refresh must be HttpOnly")
	}
	if cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("granete_web_refresh SameSite=%v, want Strict", cookie.SameSite)
	}
	if cookie.Path != "/api/auth" {
		t.Fatalf("granete_web_refresh Path=%q, want /api/auth", cookie.Path)
	}
	if cookie.Domain != "" {
		t.Fatalf("granete_web_refresh must stay host-only, got Domain=%q", cookie.Domain)
	}
	if !cookie.Secure {
		t.Fatal("granete_web_refresh must be Secure in the fixture's default (production-shaped) mode")
	}
	absolute, err := time.Parse(time.RFC3339Nano, webLogin.AbsoluteSessionExpiresAt)
	if err != nil {
		t.Fatal(err)
	}
	if !cookie.Expires.Truncate(time.Second).Equal(absolute.Truncate(time.Second)) {
		t.Fatalf("cookie expiry %s must equal the session absolute bound %s", cookie.Expires, absolute)
	}
	if absolute.Sub(time.Now()) > 18*time.Hour+time.Minute {
		t.Fatalf("session absolute bound %s exceeds the 18h session lifetime", absolute)
	}
	if resp.Header.Get("Cache-Control") != "no-store" || resp.Header.Get("Pragma") != "no-cache" {
		t.Fatalf("credential endpoint must be no-store: %v", resp.Header)
	}

	// --- Mobile login: secret in body, no web cookie --------------------------
	_, _, mobileResp := fx.doWithHeaders(t, http.MethodPost, "/api/auth/login", "", map[string]string{
		"email": fx.a.admin.email, "password": pilotPassword, "org": fx.a.slug, "transport": "mobile",
	}, nil)
	mobile := fx.mobileLogin(t, fx.a.admin.email, fx.a.slug)
	if mobile.RefreshToken == "" || mobile.RefreshExpiresAt == "" {
		t.Fatalf("mobile login must keep the body credential contract: %+v", mobile)
	}
	if findSetCookie(t, mobileResp) != nil {
		t.Fatal("mobile login must not set the web refresh cookie")
	}

	// --- SketchUp login: neither body secret nor web cookie -------------------
	_, sketchupRaw, sketchupResp := fx.doWithHeaders(t, http.MethodPost, "/api/auth/login", "", map[string]string{
		"email": fx.a.admin.email, "password": pilotPassword, "org": fx.a.slug, "transport": "sketchup",
	}, nil)
	if findSetCookie(t, sketchupResp) != nil || strings.Contains(string(sketchupRaw), "refresh_token") {
		t.Fatal("sketchup login must emit neither a web cookie nor a body refresh secret")
	}
}

func TestWebRefreshCookieRotationPreservesAbsoluteBound(t *testing.T) {
	ctx := context.Background()
	sess := fx.webLogin(t, fx.a.admin.email, fx.a.slug)
	r1 := sess.cookie
	firstAbsolute, err := time.Parse(time.RFC3339Nano, sess.login.AbsoluteSessionExpiresAt)
	if err != nil {
		t.Fatal(err)
	}

	rotated := fx.webRefresh(t, &sess)
	if sess.cookie == r1 {
		t.Fatal("rotation must deliver a distinct R2 cookie value")
	}
	if rotated.RefreshToken != "" {
		t.Fatalf("web refresh JSON must not carry the rotated secret: %+v", rotated)
	}
	if rotated.AccessExpiresAt == "" || rotated.AbsoluteSessionExpiresAt == "" {
		t.Fatalf("web refresh must expose expiry metadata: %+v", rotated)
	}
	rotatedAbsolute, err := time.Parse(time.RFC3339Nano, rotated.AbsoluteSessionExpiresAt)
	if err != nil {
		t.Fatal(err)
	}
	if !rotatedAbsolute.Truncate(time.Second).Equal(firstAbsolute.Truncate(time.Second)) {
		t.Fatalf("rotation changed the absolute bound: %s -> %s", firstAbsolute, rotatedAbsolute)
	}
	// R1 consumed, R2 active in the registry (same family).
	var r1Used, r2Active, familyCount int
	if err := fx.pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE c.used_at IS NOT NULL),
			count(*) FILTER (WHERE c.used_at IS NULL AND c.revoked_at IS NULL),
			count(DISTINCT c.family_id)
		FROM auth_refresh_credentials c
		JOIN auth_sessions s ON s.id = c.session_id
		WHERE s.id=$1`, sess.login.SessionID).Scan(&r1Used, &r2Active, &familyCount); err != nil {
		t.Fatal(err)
	}
	if r1Used != 1 || r2Active != 1 || familyCount != 1 {
		t.Fatalf("rotation state used=%d active=%d families=%d", r1Used, r2Active, familyCount)
	}

	// The cookie's own expiry must stay the ORIGINAL bound, never now+18h:
	// simulate the T0+17h59m refresh by shrinking the live registry bound and
	// rotating again — the new cookie cannot exceed the shrunk deadline.
	shrunk := time.Now().UTC().Add(2 * time.Hour).Truncate(time.Second)
	// One statement across session + family + live credentials: the composite
	// FK chain (sessions ← families ← credentials, each carrying the bound)
	// structurally pins the whole family to the session deadline, and immediate
	// constraints only see the final consistent state.
	if _, err := fx.pool.Exec(ctx, `
		WITH session_update AS (
			UPDATE auth_sessions SET absolute_expires_at=$2 WHERE id=$1 RETURNING id
		), family_update AS (
			UPDATE auth_refresh_families SET absolute_expires_at=$2 WHERE session_id=$1 RETURNING id
		)
		UPDATE auth_refresh_credentials SET expires_at=$2 WHERE session_id=$1`,
		sess.login.SessionID, shrunk); err != nil {
		t.Fatal(err)
	}
	lateRotated := fx.webRefresh(t, &sess)
	lateAbsolute, err := time.Parse(time.RFC3339Nano, lateRotated.AbsoluteSessionExpiresAt)
	if err != nil {
		t.Fatal(err)
	}
	if lateAbsolute.After(shrunk.Add(time.Second)) || lateAbsolute.Sub(time.Now()) > 2*time.Hour+time.Minute {
		t.Fatalf("rotated bound %s escaped the shrunk absolute deadline %s", lateAbsolute, shrunk)
	}
	if lateRotated.AccessExpiresAt == "" {
		t.Fatal("late rotation must still expose access expiry metadata")
	}
}

func TestWebRefreshCookieCSRFBoundary(t *testing.T) {
	sess := fx.webLogin(t, fx.a.admin.email, fx.a.slug)
	cookieHeader := "granete_web_refresh=" + sess.cookie

	// Every denial case must leave the credential consumable (no rotation, no
	// revocation): the final successful refresh below proves that.
	denials := []struct {
		name   string
		origin string
		csrf   string
	}{
		{"foreign origin", "https://evil.example", "1"},
		{"missing origin", "", "1"},
		{"missing csrf header", pilotWebOrigin, ""},
		{"wrong csrf header value", pilotWebOrigin, "true"},
	}
	for _, tc := range denials {
		headers := map[string]string{"Cookie": cookieHeader}
		if tc.origin != "" {
			headers["Origin"] = tc.origin
		}
		if tc.csrf != "" {
			headers["X-Granete-CSRF"] = tc.csrf
		}
		status, raw, _ := fx.doWithHeaders(t, http.MethodPost, "/api/auth/refresh", "", nil, headers)
		if status != http.StatusForbidden {
			t.Fatalf("%s: refresh status=%d want 403 body=%s", tc.name, status, raw)
		}
	}

	// A simple cross-site form (urlencoded body, no custom headers) cannot
	// refresh even from the allowed origin: the presented body plus the web
	// cookie is credential mixing (400) — denied either way, never rotated.
	status, raw, _ := fx.doWithHeaders(t, http.MethodPost, "/api/auth/refresh", "", "refresh_token=x", map[string]string{
		"Cookie": cookieHeader, "Origin": pilotWebOrigin, "Content-Type": "application/x-www-form-urlencoded",
	})
	if status != http.StatusForbidden && status != http.StatusBadRequest {
		t.Fatalf("form-compatible request refreshed: status=%d body=%s", status, raw)
	}

	// Logout shares the boundary.
	status, raw, _ = fx.doWithHeaders(t, http.MethodPost, "/api/auth/logout", "", nil, map[string]string{
		"Cookie": cookieHeader, "Origin": "https://evil.example", "X-Granete-CSRF": "1",
	})
	if status != http.StatusForbidden {
		t.Fatalf("logout with foreign origin status=%d body=%s", status, raw)
	}
	status, raw, _ = fx.doWithHeaders(t, http.MethodPost, "/api/auth/logout", "", nil, map[string]string{
		"Cookie": cookieHeader, "Origin": pilotWebOrigin,
	})
	if status != http.StatusForbidden {
		t.Fatalf("logout without csrf header status=%d body=%s", status, raw)
	}

	// The positive case: allowed origin + exact header refreshes fine, proving
	// the denials above did not consume or revoke the credential.
	rotated := fx.webRefresh(t, &sess)
	fx.want(t, http.MethodGet, "/api/auth/me", rotated.Token, nil, http.StatusOK)
}

func TestWebRefreshCookieCredentialMixingRejected(t *testing.T) {
	sess := fx.webLogin(t, fx.a.admin.email, fx.a.slug)
	mobile := fx.mobileLogin(t, fx.a.admin.email, fx.a.slug)

	headers := webCookieHeaders(sess.cookie)
	status, raw, _ := fx.doWithHeaders(t, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refresh_token": mobile.RefreshToken, "transport": "mobile",
	}, headers)
	if status != http.StatusBadRequest {
		t.Fatalf("refresh body + web cookie must be rejected, status=%d body=%s", status, raw)
	}
	status, raw, _ = fx.doWithHeaders(t, http.MethodPost, "/api/auth/logout", "", map[string]string{
		"refresh_token": mobile.RefreshToken,
	}, headers)
	if status != http.StatusBadRequest {
		t.Fatalf("logout body + web cookie must be rejected, status=%d body=%s", status, raw)
	}

	// The denial consumed nothing: both credentials still rotate/logout.
	rotated := fx.webRefresh(t, &sess)
	fx.want(t, http.MethodGet, "/api/auth/me", rotated.Token, nil, http.StatusOK)
	fx.want(t, http.MethodPost, "/api/auth/logout", "", map[string]string{
		"refresh_token": mobile.RefreshToken,
	}, http.StatusOK)
}

func TestWebRefreshCookieReplayRevokesFamilyAndSession(t *testing.T) {
	sess := fx.webLogin(t, fx.a.admin.email, fx.a.slug)
	r1 := sess.cookie
	rotated := fx.webRefresh(t, &sess)
	fx.want(t, http.MethodGet, "/api/auth/me", rotated.Token, nil, http.StatusOK)

	// Manual replay of the consumed R1: strict reuse detection revokes the
	// family AND the session; R2 and both access bearers stop being authority.
	status, raw, _ := fx.doWithHeaders(t, http.MethodPost, "/api/auth/refresh", "", nil, webCookieHeaders(r1))
	if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_REUSED" {
		t.Fatalf("R1 replay status=%d code=%s body=%s", status, apiErrorCode(raw), raw)
	}
	fx.want(t, http.MethodGet, "/api/auth/me", rotated.Token, nil, http.StatusUnauthorized)
	fx.want(t, http.MethodGet, "/api/auth/me", sess.login.Token, nil, http.StatusUnauthorized)
	status, raw, _ = fx.doWithHeaders(t, http.MethodPost, "/api/auth/refresh", "", nil, webCookieHeaders(sess.cookie))
	if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_REVOKED" {
		t.Fatalf("R2 after replay status=%d code=%s body=%s", status, apiErrorCode(raw), raw)
	}
}

func TestWebRefreshCookieLogoutRevokesClearsAndIsolatesSessions(t *testing.T) {
	const email = "web-cookie-isolation@pilot-readiness.test"
	fx.inviteAndAccept(t, fx.a.admin.token, email, "vendedor")
	sa := fx.webLogin(t, email, fx.a.slug)
	sb := fx.webLogin(t, email, fx.a.slug)
	if sa.login.SessionID == sb.login.SessionID {
		t.Fatal("isolation proof requires two distinct sessions")
	}

	status, raw, resp := fx.doWithHeaders(t, http.MethodPost, "/api/auth/logout", "", nil, webCookieHeaders(sa.cookie))
	if status != http.StatusOK {
		t.Fatalf("web cookie logout status=%d body=%s", status, raw)
	}
	cleared := findSetCookie(t, resp)
	if cleared == nil || cleared.Value != "" || !cleared.Expires.Before(time.Now()) {
		t.Fatalf("logout must expire granete_web_refresh with matching attributes, got %+v", cleared)
	}
	fx.want(t, http.MethodGet, "/api/auth/me", sa.login.Token, nil, http.StatusUnauthorized)
	status, raw, _ = fx.doWithHeaders(t, http.MethodPost, "/api/auth/refresh", "", nil, webCookieHeaders(sa.cookie))
	if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_REVOKED" {
		t.Fatalf("SA cookie after logout status=%d code=%s", status, apiErrorCode(raw))
	}

	// The unrelated session SB keeps working and rotating.
	fx.want(t, http.MethodGet, "/api/auth/me", sb.login.Token, nil, http.StatusOK)
	sbRotated := fx.webRefresh(t, &sb)
	fx.want(t, http.MethodGet, "/api/auth/me", sbRotated.Token, nil, http.StatusOK)

	// Repeating the dead logout stays a safe no-op success.
	status, raw, _ = fx.doWithHeaders(t, http.MethodPost, "/api/auth/logout", "", nil, webCookieHeaders(sa.cookie))
	if status != http.StatusOK {
		t.Fatalf("repeat logout status=%d body=%s", status, raw)
	}
	// So does a credential-less logout — now strictly mutation-free.
	status, raw, noCredResp := fx.doWithHeaders(t, http.MethodPost, "/api/auth/logout", "", nil, nil)
	if status != http.StatusOK {
		t.Fatalf("credential-less logout status=%d body=%s", status, raw)
	}
	if findSetCookie(t, noCredResp) != nil {
		t.Fatal("credential-less logout must not emit a granete_web_refresh Set-Cookie")
	}
}

// Review blocker 1 (#460 SEC-4A): an INTERNAL refresh failure — the rotation
// transaction rolled back — must NOT delete the browser's cookie. R1 is still
// the live server-side credential and a retry with it must succeed.
func TestWebRefreshCookieInternalFailurePreservesCredential(t *testing.T) {
	ctx := context.Background()
	sess := fx.webLogin(t, fx.a.admin.email, fx.a.slug)

	dropFailure := func() {
		_, _ = fx.pool.Exec(ctx, `DROP TRIGGER IF EXISTS fail_web_refresh_internal ON auth_refresh_credentials`)
		_, _ = fx.pool.Exec(ctx, `DROP FUNCTION IF EXISTS fail_web_refresh_internal()`)
	}
	dropFailure()
	t.Cleanup(dropFailure)
	if _, err := fx.pool.Exec(ctx, `
		CREATE FUNCTION fail_web_refresh_internal() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'injected rotation failure'; END $$;
		CREATE TRIGGER fail_web_refresh_internal
		BEFORE UPDATE ON auth_refresh_credentials
		FOR EACH ROW EXECUTE FUNCTION fail_web_refresh_internal()`); err != nil {
		t.Fatal(err)
	}

	status, raw, resp := fx.doWithHeaders(t, http.MethodPost, "/api/auth/refresh", "", nil, webCookieHeaders(sess.cookie))
	if status != http.StatusInternalServerError {
		t.Fatalf("injected rotation failure status=%d body=%s", status, raw)
	}
	if findSetCookie(t, resp) != nil {
		t.Fatal("internal refresh failure must not emit any granete_web_refresh Set-Cookie: R1 is still the live credential")
	}

	// The rollback left the family coherent and R1 consumable: the retry rotates.
	dropFailure()
	rotated := fx.webRefresh(t, &sess)
	fx.want(t, http.MethodGet, "/api/auth/me", rotated.Token, nil, http.StatusOK)
}

// Review blocker 2 (#460 SEC-4A): the cookie-flow logout clears the cookie
// only AFTER the revocation commits. A failing logout answers 5xx with the
// cookie intact, session/family roll back coherently, and the retry closes
// everything and clears the cookie.
func TestWebLogoutInternalFailurePreservesCookieAndRetryCloses(t *testing.T) {
	ctx := context.Background()
	sess := fx.webLogin(t, fx.a.admin.email, fx.a.slug)

	dropFailure := func() {
		_, _ = fx.pool.Exec(ctx, `DROP TRIGGER IF EXISTS fail_web_logout_audit ON security_audit_events`)
		_, _ = fx.pool.Exec(ctx, `DROP FUNCTION IF EXISTS fail_web_logout_audit()`)
	}
	dropFailure()
	t.Cleanup(dropFailure)
	if _, err := fx.pool.Exec(ctx, `
		CREATE FUNCTION fail_web_logout_audit() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'injected logout audit failure'; END $$;
		CREATE TRIGGER fail_web_logout_audit
		BEFORE INSERT ON security_audit_events
		FOR EACH ROW WHEN (NEW.event_type='logout')
		EXECUTE FUNCTION fail_web_logout_audit()`); err != nil {
		t.Fatal(err)
	}

	status, raw, resp := fx.doWithHeaders(t, http.MethodPost, "/api/auth/logout", "", nil, webCookieHeaders(sess.cookie))
	if status != http.StatusInternalServerError {
		t.Fatalf("injected logout failure status=%d body=%s", status, raw)
	}
	if findSetCookie(t, resp) != nil {
		t.Fatal("failing logout must not delete the browser's cookie: the family/session rolled back open")
	}
	var sessionOpen, familyOpen bool
	if err := fx.pool.QueryRow(ctx, `
		SELECT s.revoked_at IS NULL, f.revoked_at IS NULL
		FROM auth_sessions s JOIN auth_refresh_families f ON f.session_id=s.id
		WHERE s.id=$1`, sess.login.SessionID).Scan(&sessionOpen, &familyOpen); err != nil {
		t.Fatal(err)
	}
	if !sessionOpen || !familyOpen {
		t.Fatalf("failed logout must roll back coherently: sessionOpen=%v familyOpen=%v", sessionOpen, familyOpen)
	}

	// Retry after the failure closes everything and clears the cookie.
	dropFailure()
	status, raw, resp = fx.doWithHeaders(t, http.MethodPost, "/api/auth/logout", "", nil, webCookieHeaders(sess.cookie))
	if status != http.StatusOK {
		t.Fatalf("logout retry status=%d body=%s", status, raw)
	}
	if cleared := findSetCookie(t, resp); cleared == nil || cleared.Value != "" || !cleared.Expires.Before(time.Now()) {
		t.Fatalf("logout retry must clear granete_web_refresh, got %+v", cleared)
	}
	fx.want(t, http.MethodGet, "/api/auth/me", sess.login.Token, nil, http.StatusUnauthorized)
	status, raw, _ = fx.doWithHeaders(t, http.MethodPost, "/api/auth/refresh", "", nil, webCookieHeaders(sess.cookie))
	if status != http.StatusUnauthorized || apiErrorCode(raw) != "REFRESH_REVOKED" {
		t.Fatalf("cookie after logout retry status=%d code=%s body=%s", status, apiErrorCode(raw), raw)
	}
}

// Review blocker 3 (#460 SEC-4A): a credential-less logout is a mutation-free
// 200. A cross-site form cannot carry the Strict cookie; such a request must
// neither revoke anything nor trick the server into deleting the browser's
// cookie (no logout-CSRF via cookie deletion).
func TestLogoutWithoutCredentialIsMutationFree(t *testing.T) {
	sess := fx.webLogin(t, fx.a.admin.email, fx.a.slug)

	// Bodyless, form content type, foreign origin: the exact shape a
	// cross-site logout-CSRF attempt can produce (no Cookie travels).
	status, raw, resp := fx.doWithHeaders(t, http.MethodPost, "/api/auth/logout", "", nil, map[string]string{
		"Origin": "https://evil.example", "Content-Type": "application/x-www-form-urlencoded",
	})
	if status != http.StatusOK {
		t.Fatalf("credential-less logout status=%d body=%s", status, raw)
	}
	if findSetCookie(t, resp) != nil {
		t.Fatal("credential-less logout must not emit a granete_web_refresh Set-Cookie (no logout-CSRF cookie deletion)")
	}

	// Nothing was revoked: the session keeps working and the cookie still rotates.
	fx.want(t, http.MethodGet, "/api/auth/me", sess.login.Token, nil, http.StatusOK)
	rotated := fx.webRefresh(t, &sess)
	fx.want(t, http.MethodGet, "/api/auth/me", rotated.Token, nil, http.StatusOK)
}

// TestWebRefreshCookieSecretsNeverLogged proves log redaction (#460 SEC-4A §23):
// neither the raw cookie values nor any refresh credential material may ever
// reach request/debug/audit/error logs — including on the internal-error path.
func TestWebRefreshCookieSecretsNeverLogged(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	sess := fx.webLogin(t, fx.a.admin.email, fx.a.slug)
	r1 := sess.cookie
	rotated := fx.webRefresh(t, &sess)
	// Failure path: make the rotation fail inside PostgreSQL after the lock.
	dropFailure := func() {
		_, _ = fx.pool.Exec(context.Background(), `DROP TRIGGER IF EXISTS fail_web_cookie_rotation ON auth_refresh_credentials`)
		_, _ = fx.pool.Exec(context.Background(), `DROP FUNCTION IF EXISTS fail_web_cookie_rotation()`)
	}
	dropFailure()
	t.Cleanup(dropFailure)
	if _, err := fx.pool.Exec(context.Background(), `
		CREATE FUNCTION fail_web_cookie_rotation() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'injected rotation failure'; END $$;
		CREATE TRIGGER fail_web_cookie_rotation
		BEFORE UPDATE ON auth_refresh_credentials
		FOR EACH ROW EXECUTE FUNCTION fail_web_cookie_rotation()`); err != nil {
		t.Fatal(err)
	}
	status, raw, _ := fx.doWithHeaders(t, http.MethodPost, "/api/auth/refresh", "", nil, webCookieHeaders(sess.cookie))
	if status != http.StatusInternalServerError {
		t.Fatalf("injected rotation failure status=%d body=%s", status, raw)
	}
	dropFailure()
	_ = fx.webRefresh(t, &sess) // restore a live credential
	fx.want(t, http.MethodPost, "/api/auth/logout", "", nil, http.StatusOK)

	out := logs.String()
	for _, secret := range []string{r1, sess.cookie, rotated.Token} {
		if secret != "" && strings.Contains(out, secret) {
			t.Fatalf("secret material leaked into logs: %q in %q", secret[:12]+"…", out)
		}
	}
	if strings.Contains(out, "grt_refresh_v1.") {
		t.Fatalf("raw refresh credential prefix leaked into logs: %q", out)
	}
}

func TestWebRefreshCORSCredentialsExactOrigin(t *testing.T) {
	// Allowed origin: exact reflection + credentials (never a wildcard pair).
	status, _, resp := fx.doWithHeaders(t, http.MethodGet, "/api/health", "", nil, map[string]string{"Origin": pilotWebOrigin})
	if status != http.StatusOK {
		t.Fatalf("health status=%d", status)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != pilotWebOrigin {
		t.Fatalf("Allow-Origin=%q, want exact %q", got, pilotWebOrigin)
	}
	if got := resp.Header.Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("Allow-Credentials=%q, want true for allowed origin", got)
	}

	// Foreign origin: no credentialed CORS authorization at all.
	_, _, foreign := fx.doWithHeaders(t, http.MethodGet, "/api/health", "", nil, map[string]string{"Origin": "https://evil.example"})
	if foreign.Header.Get("Access-Control-Allow-Origin") != "" || foreign.Header.Get("Access-Control-Allow-Credentials") != "" {
		t.Fatal("foreign origin must receive no Allow-Origin/Allow-Credentials")
	}

	// The CSRF custom header is preflight-able only because it is allowlisted.
	_, _, preflight := fx.doWithHeaders(t, http.MethodOptions, "/api/auth/refresh", "", nil, map[string]string{
		"Origin":                         pilotWebOrigin,
		"Access-Control-Request-Method":  http.MethodPost,
		"Access-Control-Request-Headers": "x-granete-csrf",
	})
	if !strings.Contains(preflight.Header.Get("Access-Control-Allow-Headers"), "X-Granete-CSRF") {
		t.Fatalf("CSRF header missing from CORS allowlist: %q", preflight.Header.Get("Access-Control-Allow-Headers"))
	}
}
