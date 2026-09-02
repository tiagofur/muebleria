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

const transportTestSecret = "transport-test-secret-0123456789ab"

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
		token, err := auth.GenerateLegacyToken("00000000-0000-0000-0000-000000000001", "a@b.test", auth.TokenContext{}, transport, transportTestSecret)
		if err != nil {
			t.Fatal(err)
		}
		claims, err := mustAuthority(transportTestSecret).Validate(token)
		if err != nil || claims.Transport != transport {
			t.Fatalf("transport=%s claims=%+v err=%v", transport, claims, err)
		}
		if transport == "sketchup" && claims.Client != auth.ExtensionClient {
			t.Fatalf("sketchup client=%q", claims.Client)
		}
	}
	if _, err := auth.GenerateLegacyToken("00000000-0000-0000-0000-000000000001", "a@b.test", auth.TokenContext{}, "support", transportTestSecret); err == nil {
		t.Fatal("normal token generator accepted support transport")
	}
}

// TestVer5TokenTypeAndAudiencePerTransport locks the #460 credential classes:
// every transport mints its own typ/aud pair, and the registry client type
// matches the transport.
func TestVer5TokenTypeAndAudiencePerTransport(t *testing.T) {
	authority := mustAuthority(transportTestSecret)
	cases := []struct {
		transport  string
		typ        string
		audience   string
		clientType string
	}{
		{"web", auth.TokenTypeAccessWeb, auth.AudienceWeb, "web"},
		{"mobile", auth.TokenTypeAccessMobile, auth.AudienceMobile, "mobile"},
		{"sketchup", auth.TokenTypeDeviceSketchup, auth.AudienceSketchup, "sketchup"},
	}
	for _, tc := range cases {
		t.Run(tc.transport, func(t *testing.T) {
			token, err := issueTransportTokenCapped(authority, "00000000-0000-0000-0000-000000000001", "a@b.test", auth.TokenContext{SessionID: "sess-1"}, tc.transport)
			if err != nil {
				t.Fatal(err)
			}
			claims, err := authority.Validate(token)
			if err != nil {
				t.Fatal(err)
			}
			if claims.Typ != tc.typ {
				t.Fatalf("typ=%q want %q", claims.Typ, tc.typ)
			}
			if len(claims.Audience) != 1 || claims.Audience[0] != tc.audience {
				t.Fatalf("aud=%v want [%s]", claims.Audience, tc.audience)
			}
			if got := string(sessionClientType(tc.transport)); got != tc.clientType {
				t.Fatalf("registry client type=%q want %q", got, tc.clientType)
			}
		})
	}
}

func TestSupportTransportOnlyComesFromAuditedSupportToken(t *testing.T) {
	token, err := auth.GenerateLegacySupportToken(
		"00000000-0000-0000-0000-000000000001",
		"support@example.test",
		auth.SupportClaims{OrgID: "00000000-0000-0000-0000-000000000002", SessionID: "session-448", OrganizationCredentialVersion: 1, Reason: "customer support"},
		transportTestSecret,
	)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := mustAuthority(transportTestSecret).Validate(token)
	if err != nil || claims.Support == nil || claims.Support.SessionID != "session-448" || claims.Transport != "support" {
		t.Fatalf("claims=%+v err=%v", claims, err)
	}
	if ttl := claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time); ttl != auth.SupportTokenTTL {
		t.Fatalf("support ttl=%s want=%s", ttl, auth.SupportTokenTTL)
	}
}
