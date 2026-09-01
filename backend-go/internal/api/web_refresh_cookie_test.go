package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// #460 SEC-4A unit proofs for the Web refresh cookie transport: attributes,
// CSRF boundary and the unambiguous refresh dispatcher precedence.

func webCookieTestServer(allowedOrigins ...string) *Server {
	return NewServer(nil, "unit-test-secret-0123456789abcdef", allowedOrigins, 1, 1)
}

func TestWebRefreshCookieAttributes(t *testing.T) {
	absolute := time.Now().UTC().Add(18 * time.Hour).Truncate(time.Second)

	// Default (zero value): production-shaped Secure cookie.
	server := webCookieTestServer()
	rec := httptest.NewRecorder()
	server.setWebRefreshCookie(rec, "grt_refresh_v1.unit", absolute)
	header := rec.Header().Get("Set-Cookie")
	for _, want := range []string{
		"granete_web_refresh=grt_refresh_v1.unit",
		"Path=/api/auth",
		"HttpOnly",
		"SameSite=Strict",
		"Secure",
	} {
		if !strings.Contains(header, want) {
			t.Fatalf("Set-Cookie missing %q: %s", want, header)
		}
	}
	if strings.Contains(header, "Domain=") {
		t.Fatalf("cookie must stay host-only: %s", header)
	}

	// Clearing uses the same name/path so the browser drops exactly it.
	clearRec := httptest.NewRecorder()
	server.clearWebRefreshCookie(clearRec)
	clearHeader := clearRec.Header().Get("Set-Cookie")
	if !strings.Contains(clearHeader, "granete_web_refresh=;") && !strings.Contains(clearHeader, "granete_web_refresh= ") {
		// Go serializes the empty value as `granete_web_refresh=;`.
		t.Fatalf("clear cookie must empty the value: %s", clearHeader)
	}
	for _, want := range []string{"Path=/api/auth", "Max-Age=0", "HttpOnly", "SameSite=Strict", "Secure"} {
		if !strings.Contains(clearHeader, want) {
			t.Fatalf("clear Set-Cookie missing %q: %s", want, clearHeader)
		}
	}

	// The explicit local-dev opt-out drops Secure and nothing else.
	insecure := webCookieTestServer()
	insecure.WebRefreshCookieInsecureLocalDev = true
	insecureRec := httptest.NewRecorder()
	insecure.setWebRefreshCookie(insecureRec, "grt_refresh_v1.unit", absolute)
	insecureHeader := insecureRec.Header().Get("Set-Cookie")
	if strings.Contains(insecureHeader, "Secure") {
		t.Fatalf("local-dev cookie must not be Secure: %s", insecureHeader)
	}
	for _, want := range []string{"HttpOnly", "SameSite=Strict", "Path=/api/auth"} {
		if !strings.Contains(insecureHeader, want) {
			t.Fatalf("local-dev Set-Cookie missing %q: %s", want, insecureHeader)
		}
	}
}

func TestRequireWebCookieCSRF(t *testing.T) {
	server := webCookieTestServer("http://localhost:5173")

	allowed := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	allowed.Header.Set("Origin", "http://localhost:5173")
	allowed.Header.Set("X-Granete-CSRF", "1")
	if !server.requireWebCookieCSRF(httptest.NewRecorder(), allowed) {
		t.Fatal("allowed origin + exact header must pass")
	}

	denials := []struct {
		name   string
		origin string
		csrf   string
	}{
		{"foreign origin", "https://evil.example", "1"},
		{"missing origin", "", "1"},
		{"origin mismatch port", "http://localhost:5174", "1"},
		{"missing header", "http://localhost:5173", ""},
		{"wrong header value", "http://localhost:5173", "1 "},
	}
	var uniformDenial string
	for _, tc := range denials {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
		if tc.origin != "" {
			req.Header.Set("Origin", tc.origin)
		}
		if tc.csrf != "" {
			req.Header.Set("X-Granete-CSRF", tc.csrf)
		}
		rec := httptest.NewRecorder()
		if server.requireWebCookieCSRF(rec, req) {
			t.Fatalf("%s must be denied", tc.name)
		}
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s: status=%d want 403", tc.name, rec.Code)
		}
		// The public denial must be indistinguishable across boundaries (#460
		// review): same code, same message, no hint of which check failed.
		if uniformDenial == "" {
			uniformDenial = rec.Body.String()
		} else if rec.Body.String() != uniformDenial {
			t.Fatalf("%s: denial body differs: %q vs %q", tc.name, rec.Body.String(), uniformDenial)
		}
	}
	if !strings.Contains(uniformDenial, csrfDeniedMessage) {
		t.Fatalf("denial body must carry the uniform message: %s", uniformDenial)
	}
}

func TestRefreshTransitionHandlerPrecedence(t *testing.T) {
	marker := func(name string) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Handler", name)
		})
	}
	handler := refreshTransitionHandler(marker("opaque"), marker("web-cookie"), marker("legacy"))

	requests := []struct {
		name    string
		body    bool
		cookie  string
		content string
		want    string
		status  int
	}{
		{"json body only", true, "", "application/json", "opaque", 0},
		{"json body with content type only", false, "", "application/json", "opaque", 0},
		{"web cookie only", false, "grt_refresh_v1.x", "", "web-cookie", 0},
		{"body plus web cookie", true, "grt_refresh_v1.x", "application/json", "", http.StatusBadRequest},
		{"neither", false, "", "", "legacy", 0},
	}
	for _, tc := range requests {
		var req *http.Request
		if tc.body {
			req = httptest.NewRequest(http.MethodPost, "/api/auth/refresh", strings.NewReader(`{"refresh_token":"x"}`))
			req.ContentLength = 23
		} else {
			req = httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
		}
		if tc.content != "" {
			req.Header.Set("Content-Type", tc.content)
		}
		if tc.cookie != "" {
			req.Header.Set("Cookie", "granete_web_refresh="+tc.cookie)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if tc.status != 0 {
			if rec.Code != tc.status {
				t.Fatalf("%s: status=%d want=%d", tc.name, rec.Code, tc.status)
			}
			continue
		}
		if got := rec.Header().Get("X-Handler"); got != tc.want {
			t.Fatalf("%s: handler=%q want=%q", tc.name, got, tc.want)
		}
	}
}
