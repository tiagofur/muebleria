package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBrowserGateDatabaseIdentityHandler(t *testing.T) {
	const marker = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	digest := sha256.Sum256([]byte(marker))
	called := 0
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called++
		w.WriteHeader(http.StatusOK)
	})
	read := func(context.Context) (string, string, string, error) {
		return "granete_gate", "granete_app", marker, nil
	}
	handler := browserGateDatabaseIdentityHandler(next, read)

	plain := httptest.NewRecorder()
	handler.ServeHTTP(plain, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if plain.Code != http.StatusOK || plain.Header().Get("X-Granete-Test-Identity") != "" || called != 1 {
		t.Fatalf("plain health changed: status=%d called=%d", plain.Code, called)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Header.Set("X-Granete-Test-Database-Probe", "1")
	probed := httptest.NewRecorder()
	handler.ServeHTTP(probed, request)
	if probed.Code != http.StatusOK || called != 2 {
		t.Fatalf("probe failed: status=%d called=%d", probed.Code, called)
	}
	if probed.Header().Get("X-Granete-Test-Database") != "granete_gate" ||
		probed.Header().Get("X-Granete-Test-Role") != "granete_app" ||
		probed.Header().Get("X-Granete-Test-Identity") != hex.EncodeToString(digest[:]) {
		t.Fatal("probe did not reflect the runtime database identity")
	}
}

func TestBrowserGateDatabaseIdentityHandlerFailsClosed(t *testing.T) {
	for _, tc := range []struct {
		name string
		read func(context.Context) (string, string, string, error)
	}{
		{"missing marker", func(context.Context) (string, string, string, error) {
			return "granete_gate", "granete_app", "", nil
		}},
		{"wrong role", func(context.Context) (string, string, string, error) {
			return "granete_gate", "postgres", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", nil
		}},
		{"query failed", func(context.Context) (string, string, string, error) {
			return "", "", "", errors.New("synthetic unavailable")
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			called := false
			next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true })
			request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
			request.Header.Set("X-Granete-Test-Database-Probe", "1")
			response := httptest.NewRecorder()
			browserGateDatabaseIdentityHandler(next, tc.read).ServeHTTP(response, request)
			if response.Code != http.StatusServiceUnavailable || called || response.Header().Get("X-Granete-Test-Identity") != "" {
				t.Fatalf("unsafe probe accepted: status=%d called=%t", response.Code, called)
			}
		})
	}
}

func TestBrowserGateServerTargetsRejectSessionIdentityOverrides(t *testing.T) {
	t.Setenv("ORGANIZATION_TEST_ISOLATED", "1")
	t.Setenv("GRANETE_TEST_DATABASE", "1")
	const runtimeURL = "postgres://granete_app:synthetic@127.0.0.1:56321/granete_gate?sslmode=disable"
	const migrationURL = "postgres://postgres:synthetic@127.0.0.1:56321/granete_gate?sslmode=disable"
	if err := validateBrowserGateServerTargets(runtimeURL, migrationURL); err != nil {
		t.Fatalf("valid disposable targets rejected: %v", err)
	}
	for _, tc := range []struct {
		name, runtime, migration, pgOptions string
	}{
		{"runtime URL options", runtimeURL + "&options=-c%20granete.browser_gate_identity%3Dforged", migrationURL, ""},
		{"mixed-case runtime URL options", runtimeURL + "&Options=-c%20granete.browser_gate_identity%3Dforged", migrationURL, ""},
		{"migration URL options", runtimeURL, migrationURL + "&options=-c%20granete.browser_gate_identity%3Dforged", ""},
		{"ambient PGOPTIONS", runtimeURL, migrationURL, "-c granete.browser_gate_identity=forged"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("PGOPTIONS", tc.pgOptions)
			if err := validateBrowserGateServerTargets(tc.runtime, tc.migration); err == nil {
				t.Fatal("session identity override was accepted")
			}
		})
	}
}
