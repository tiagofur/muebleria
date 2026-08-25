package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

const furnitureTestSecret = "test-secret-key-for-jwt-signing-32b"

// licenseTestServer builds a Server whose stub returns the given user for
// both email and id lookups (the stub's single-user world).
func licenseTestServer(t *testing.T, u *domain.User) *Server {
	t.Helper()
	return &Server{
		Store:     &stubStore{getUserByEmail: u},
		JWTSecret: furnitureTestSecret,
	}
}

func TestFurnitureDefinitionsRequiresActiveLicense(t *testing.T) {
	expired := time.Now().Add(-24 * time.Hour)
	cases := []struct {
		name string
		user *domain.User
		want int
	}{
		{"no license", &domain.User{ID: "u1", Active: true, LicensePlan: domain.LicensePlanNone}, http.StatusForbidden},
		{"expired license", &domain.User{ID: "u1", Active: true, LicensePlan: domain.LicensePlanPro, LicenseExpiresAt: &expired}, http.StatusForbidden},
		{"active trial no expiry", &domain.User{ID: "u1", Active: true, LicensePlan: domain.LicensePlanTrial}, http.StatusOK},
		{"active pro future expiry", &domain.User{ID: "u1", Active: true, LicensePlan: domain.LicensePlanPro, LicenseExpiresAt: ptrTime(time.Now().Add(30 * 24 * time.Hour))}, http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := licenseTestServer(t, tc.user)
			token, err := auth.GenerateToken(tc.user.ID, "u@example.com", "user", furnitureTestSecret)
			if err != nil {
				t.Fatalf("generate token: %v", err)
			}
			// Route through the real middleware so auth + license gate are both exercised.
			handler := AuthMiddleware(furnitureTestSecret, server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitions))
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			handler.ServeHTTP(rec, req)

			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.want, rec.Body.String())
			}
			if tc.want == http.StatusForbidden {
				var body map[string]string
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatalf("decode error body: %v", err)
				}
				if body["error"] == "" || body["error"] == "error interno del servidor" {
					t.Fatalf("license blocker must explain how to resolve it, got %q", body["error"])
				}
			}
		})
	}
}

func TestFurnitureDefinitionsServesContractVerbatim(t *testing.T) {
	u := &domain.User{ID: "u1", Active: true, LicensePlan: domain.LicensePlanPro}
	server := licenseTestServer(t, u)
	token, _ := auth.GenerateToken(u.ID, "u@example.com", "user", furnitureTestSecret)

	handler := AuthMiddleware(furnitureTestSecret, server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitions))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("content-type = %q", got)
	}
	if etag := rec.Header().Get("ETag"); etag != `"pilot-rev-1"` {
		t.Fatalf("etag = %q", etag)
	}

	var served map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &served); err != nil {
		t.Fatalf("decode served: %v", err)
	}
	if served["schemaId"] != "granete.pilotFurnitureCatalog.v1" {
		t.Fatalf("schemaId = %v", served["schemaId"])
	}
	defs, _ := served["definitions"].(map[string]any)
	presets, _ := served["presets"].([]any)
	if len(defs) != 4 || len(presets) != 10 {
		t.Fatalf("expected 4 definitions / 10 presets, got %d/%d", len(defs), len(presets))
	}
}

// TestFurnitureContractMatchesSharedArtifact is the Go side of the contract
// parity gate: the embedded copy must be byte-identical to
// contracts/pilotFurnitureCatalog.json (TS-side golden test lives in
// packages/domain). Tolerates both internal/api and backend-root working dirs.
func TestFurnitureContractMatchesSharedArtifact(t *testing.T) {
	candidates := []string{
		filepath.Join("..", "..", "..", "contracts", "pilotFurnitureCatalog.json"),
		filepath.Join("..", "contracts", "pilotFurnitureCatalog.json"),
	}
	var shared []byte
	var found string
	for _, c := range candidates {
		if b, err := os.ReadFile(c); err == nil {
			shared = b
			found = c
			break
		}
	}
	if shared == nil {
		t.Skip("shared contract artifact not found relative to test working dir")
	}
	if !bytes.Equal(bytes.TrimSpace(shared), bytes.TrimSpace(pilotFurnitureCatalogJSON)) {
		t.Fatalf("embedded catalog drifted from %s — run `go generate ./internal/api`", found)
	}
}

func TestLoginIssuesExtensionTokenAndLicenseBlock(t *testing.T) {
	hash, err := auth.HashPassword("secret123")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	u := &domain.User{
		ID: "u1", Email: "u@example.com", Name: "U", Role: domain.RoleUser, Active: true,
		PasswordHash: hash, LicensePlan: domain.LicensePlanTrial,
	}
	server := &Server{
		Store:     &stubStore{getUserByEmail: u},
		JWTSecret: furnitureTestSecret,
	}

	body, _ := json.Marshal(map[string]string{
		"email": "u@example.com", "password": "secret123", "client": auth.ExtensionClient,
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	server.HandleLogin(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Token   string        `json:"token"`
		License LicenseDTO    `json:"license"`
		User    PublicUserDTO `json:"user"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	claims, err := auth.ValidateToken(resp.Token, furnitureTestSecret)
	if err != nil {
		t.Fatalf("validate issued token: %v", err)
	}
	if claims.Client != auth.ExtensionClient {
		t.Fatalf("claims.Client = %q, want %q", claims.Client, auth.ExtensionClient)
	}
	remaining := time.Until(claims.ExpiresAt.Time)
	if remaining < 29*24*time.Hour || remaining > auth.ExtensionTokenTTL {
		t.Fatalf("extension token TTL = %v, want ~%v", remaining, auth.ExtensionTokenTTL)
	}
	if resp.License.Plan != "trial" || resp.License.Status != domain.LicenseStatusActive {
		t.Fatalf("license block = %+v", resp.License)
	}
}

func TestExtensionTokenIsReadOnly(t *testing.T) {
	u := &domain.User{ID: "u1", Active: true, Role: domain.RoleAdmin, LicensePlan: domain.LicensePlanPro}
	server := licenseTestServer(t, u)
	token, _ := auth.GenerateExtensionToken(u.ID, "u@example.com", "admin", furnitureTestSecret)

	handler := AuthMiddleware(furnitureTestSecret, server.Store)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	send := func(method, path string) int {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		handler.ServeHTTP(rec, req)
		return rec.Code
	}
	if got := send(http.MethodGet, "/api/furniture/definitions"); got != http.StatusOK {
		t.Fatalf("GET with extension token = %d, want 200", got)
	}
	if got := send(http.MethodDelete, "/api/projects/1"); got != http.StatusForbidden {
		t.Fatalf("DELETE with extension token = %d, want 403", got)
	}
	if got := send(http.MethodPost, "/api/auth/refresh"); got != http.StatusOK {
		t.Fatalf("POST refresh with extension token = %d, want 200", got)
	}

	// Web tokens keep full access.
	webToken, _ := auth.GenerateToken(u.ID, "u@example.com", "admin", furnitureTestSecret)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/projects/1", nil)
	req.Header.Set("Authorization", "Bearer "+webToken)
	handler.ServeHTTP(rec, req)
	if rec.Code == http.StatusForbidden {
		t.Fatalf("web token must not be read-only restricted")
	}
}

func TestAdminUserLicenseEndpoint(t *testing.T) {
	var gotPlan domain.LicensePlan
	var gotExpiry *time.Time
	server := &Server{
		Store: &stubStore{setLicense: func(_ context.Context, _ string, p domain.LicensePlan, e *time.Time) error {
			gotPlan, gotExpiry = p, e
			return nil
		}},
		JWTSecret: furnitureTestSecret,
	}

	expiry := time.Now().Add(90 * 24 * time.Hour).UTC().Truncate(time.Second)
	body, _ := json.Marshal(map[string]any{
		"license_plan": "pro", "license_expires_at": expiry.Format(time.RFC3339),
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/admin/users/u1/license", bytes.NewReader(body))
	req.SetPathValue("id", "u1")
	server.HandleAdminUserLicense(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if gotPlan != domain.LicensePlanPro || gotExpiry == nil || !gotExpiry.Equal(expiry) {
		t.Fatalf("stored plan=%v expiry=%v want=%v", gotPlan, gotExpiry, expiry)
	}

	rec2 := httptest.NewRecorder()
	body2, _ := json.Marshal(map[string]any{"license_plan": "enterprise"})
	req2 := httptest.NewRequest(http.MethodPut, "/api/admin/users/u1/license", bytes.NewReader(body2))
	req2.SetPathValue("id", "u1")
	server.HandleAdminUserLicense(rec2, req2)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("invalid plan status = %d", rec2.Code)
	}
}

func TestLicenseStatusAtDerivation(t *testing.T) {
	now := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)
	past := now.Add(-time.Hour)
	future := now.Add(time.Hour)

	if s := domain.LicenseStatusAt(domain.LicensePlanNone, nil, now); s != domain.LicenseStatusNone {
		t.Errorf("none plan => %v", s)
	}
	if s := domain.LicenseStatusAt(domain.LicensePlanTrial, nil, now); s != domain.LicenseStatusActive {
		t.Errorf("trial no expiry => %v", s)
	}
	if s := domain.LicenseStatusAt(domain.LicensePlanPro, &past, now); s != domain.LicenseStatusExpired {
		t.Errorf("pro past expiry => %v", s)
	}
	if s := domain.LicenseStatusAt(domain.LicensePlanPro, &future, now); s != domain.LicenseStatusActive {
		t.Errorf("pro future expiry => %v", s)
	}
	if s := domain.LicenseStatusAt("", nil, now); s != domain.LicenseStatusNone {
		t.Errorf("empty plan => %v", s)
	}
}

func ptrTime(t time.Time) *time.Time { return &t }
