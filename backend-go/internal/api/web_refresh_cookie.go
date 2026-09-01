package api

import (
	"net/http"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
)

// Web refresh-cookie protocol (#460 SEC-4A).
//
// The Web transport's rotating refresh credential lives exclusively in a
// dedicated HttpOnly cookie: never in a response body, never in script-readable
// storage, never in a URL. It is the same SEC-2A opaque single-use credential
// Mobile receives as JSON — only the transport differs — so rotation, strict
// reuse detection and the absolute session bound stay authoritative server-side.
const (
	// webRefreshCookieName is deliberately NOT the legacy "granete_token":
	// that localStorage bearer is a different credential class removed by
	// SEC-4B, and mixing the two namespaces would blur revocation semantics.
	webRefreshCookieName = "granete_web_refresh"
	// webRefreshCookiePath scopes the cookie to the auth boundary: only
	// /api/auth/* ever needs the refresh credential.
	webRefreshCookiePath = "/api/auth"
	// csrfHeaderName + csrfHeaderValue form the required non-simple custom
	// header proving a cookie-authenticated command comes from script/our SPA
	// and not from a cross-site form (#460 SEC-4A CSRF boundary). A form post
	// cannot set a custom header, and cross-origin script cannot pass the
	// exact-Origin check below.
	csrfHeaderName  = "X-Granete-CSRF"
	csrfHeaderValue = "1"
)

// webRefreshCookieSecure resolves the Secure attribute. The zero value is the
// safe production default; only config (which itself fails closed for
// GRANETE_ENV=production) may opt local development gates out.
func (s *Server) webRefreshCookieSecure() bool {
	return !s.WebRefreshCookieInsecureLocalDev
}

// setWebRefreshCookie writes the rotating Web refresh credential. Its expiry is
// the auth session's absolute bound — NEVER now+TTL on rotation — so every
// Set-Cookie in the family preserves the original login deadline (no sliding).
func (s *Server) setWebRefreshCookie(w http.ResponseWriter, raw string, absoluteExpiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     webRefreshCookieName,
		Value:    raw,
		Path:     webRefreshCookiePath,
		Expires:  absoluteExpiresAt.UTC(),
		MaxAge:   int(time.Until(absoluteExpiresAt).Seconds()),
		HttpOnly: true,
		Secure:   s.webRefreshCookieSecure(),
		SameSite: http.SameSiteStrictMode,
		// No Domain: the cookie stays host-only.
	})
}

// clearWebRefreshCookie deletes the cookie with the same name/path so the
// browser drops exactly the credential the server issued.
func (s *Server) clearWebRefreshCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     webRefreshCookieName,
		Value:    "",
		Path:     webRefreshCookiePath,
		Expires:  time.Unix(0, 0).UTC(),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.webRefreshCookieSecure(),
		SameSite: http.SameSiteStrictMode,
	})
}

// webRefreshCookieValue reads the presented Web refresh credential. An absent
// or empty cookie returns "" (caller treats it as "no Web credential").
func webRefreshCookieValue(r *http.Request) string {
	cookie, err := r.Cookie(webRefreshCookieName)
	if err != nil || cookie == nil {
		return ""
	}
	return cookie.Value
}

// originAllowed matches an Origin against the configured CORS allowlist — the
// same exact-string list CORSMiddleware reflects. Never a wildcard.
func (s *Server) originAllowed(origin string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return false
	}
	for _, allowed := range s.allowedOrigins {
		if strings.TrimSpace(allowed) == origin {
			return true
		}
	}
	return false
}

// requireWebCookieCSRF enforces the CSRF boundary for cookie-authenticated
// commands (Web cookie refresh/logout): the request must carry BOTH an Origin
// that is exactly one of the configured Web origins AND the required non-simple
// CSRF header. CORS alone is not trusted as a defense. Denials are uniform 403s
// that do not reveal which boundary failed.
func (s *Server) requireWebCookieCSRF(w http.ResponseWriter, r *http.Request) bool {
	if !s.originAllowed(r.Header.Get("Origin")) {
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeForbidden, "origen no autorizado", nil)
		return false
	}
	if r.Header.Get(csrfHeaderName) != csrfHeaderValue {
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeForbidden, "falta la cabecera anti-CSRF", nil)
		return false
	}
	return true
}

// hasJSONRequestBody reports whether the client presented a request body, using
// the same signal the refresh transition dispatcher has always used.
func hasJSONRequestBody(r *http.Request) bool {
	return r.ContentLength != 0 || strings.Contains(strings.ToLower(r.Header.Get("Content-Type")), "application/json")
}

// rejectCredentialMix fail-closes the ambiguous case of a JSON refresh body
// riding together with the Web refresh cookie (e.g. a mobile webview that
// inherited the browser jar). The transports must stay separable: a mobile
// body rotation must never touch a Web cookie family, and vice versa.
func rejectCredentialMix(w http.ResponseWriter) {
	respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest,
		"no se puede usar la cookie web y el cuerpo JSON en la misma petición", nil)
}
