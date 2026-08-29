package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
)

func TestLoginTransportBoundaryAcceptsCanonicalTransports(t *testing.T) {
	for _, transport := range []openapi.LoginTransport{
		openapi.LoginTransportWeb, openapi.LoginTransportMobile,
		openapi.LoginTransportSketchup,
	} {
		t.Run(string(transport), func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(fmt.Sprintf(`{"email":"a@b.test","password":"secret123","transport":%q}`, transport)))
			rec := httptest.NewRecorder()
			got, ok := decodeLoginCredentials(rec, req)
			if !ok || got.Transport != transport {
				t.Fatalf("ok=%v transport=%q body=%s", ok, got.Transport, rec.Body.String())
			}
			if rec.Header().Get("Deprecation") != "" {
				t.Fatal("canonical transport marked deprecated")
			}
		})
	}
}

func TestLoginTransportBoundaryRejectsInvalidMismatchAndUnknown(t *testing.T) {
	for name, body := range map[string]string{
		"invalid":           `{"email":"a@b.test","password":"secret123","transport":"desktop"}`,
		"support":           `{"email":"a@b.test","password":"secret123","transport":"support"}`,
		"legacy client":     `{"email":"a@b.test","password":"secret123","client":"sketchup-extension"}`,
		"missing transport": `{"email":"a@b.test","password":"secret123"}`,
		"unknown":           `{"email":"a@b.test","password":"secret123","transport":"web","device":"x"}`,
		"multiple values":   `{"email":"a@b.test","password":"secret123","transport":"web"} {}`,
	} {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body))
			rec := httptest.NewRecorder()
			if _, ok := decodeLoginCredentials(rec, req); ok || rec.Code != http.StatusBadRequest {
				t.Fatalf("ok=%v status=%d", ok, rec.Code)
			}
		})
	}
}

func TestTransportClaimSurvivesCanonicalToken(t *testing.T) {
	for _, transport := range []string{"web", "mobile", "sketchup"} {
		token, err := auth.GenerateTransportToken("00000000-0000-0000-0000-000000000001", "a@b.test", auth.TokenContext{}, transport, "secret")
		if err != nil {
			t.Fatal(err)
		}
		claims, err := auth.ValidateToken(token, "secret")
		if err != nil || claims.Transport != transport {
			t.Fatalf("transport=%s claims=%+v err=%v", transport, claims, err)
		}
		if transport == "sketchup" && claims.Client != auth.ExtensionClient {
			t.Fatalf("sketchup client=%q", claims.Client)
		}
	}
	if _, err := auth.GenerateTransportToken("00000000-0000-0000-0000-000000000001", "a@b.test", auth.TokenContext{}, "support", "secret"); err == nil {
		t.Fatal("normal token generator accepted support transport")
	}
}

func TestSupportTransportOnlyComesFromAuditedSupportToken(t *testing.T) {
	token, err := auth.GenerateSupportToken(
		"00000000-0000-0000-0000-000000000001",
		"support@example.test",
		auth.SupportClaims{OrgID: "00000000-0000-0000-0000-000000000002", SessionID: "session-448", Reason: "customer support"},
		"secret",
	)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := auth.ValidateToken(token, "secret")
	if err != nil || claims.Support == nil || claims.Support.SessionID != "session-448" || claims.Transport != "support" {
		t.Fatalf("claims=%+v err=%v", claims, err)
	}
	if ttl := claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time); ttl != auth.SupportTokenTTL {
		t.Fatalf("support ttl=%s want=%s", ttl, auth.SupportTokenTTL)
	}
}
