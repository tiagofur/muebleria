package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

const furnitureTestSecret = "test-secret-key-for-jwt-signing-32b"

// licenseTestServer builds a Server whose stub returns the given user for
// both email and id lookups, with the ORGANIZATION license the furniture
// gate checks (ADR-0005 §3). A nil org defaults to an active trial license.
func licenseTestServer(t *testing.T, u *domain.User, org *domain.Organization) *Server {
	t.Helper()
	if org == nil {
		org = &domain.Organization{
			ID: "org-1", Name: "Taller Test", Slug: "taller-test",
			Type: domain.OrganizationTypeFactory, LicensePlan: domain.LicensePlanTrial, Status: domain.OrganizationStatusActive, CredentialVersion: 1,
		}
	}
	return &Server{
		Store:     &stubStore{getUserByEmail: u, getOrgByID: org},
		JWTSecret: furnitureTestSecret,
	}
}

func TestFurnitureDefinitionsRequiresActiveLicense(t *testing.T) {
	expired := time.Now().Add(-24 * time.Hour)
	cases := []struct {
		name string
		user *domain.User
		org  *domain.Organization
		want int
	}{
		{"no license", &domain.User{ID: "u1", AccountStatus: domain.AccountStatusActive},
			&domain.Organization{ID: "org-1", Type: domain.OrganizationTypeFactory, Status: domain.OrganizationStatusActive, CredentialVersion: 1}, http.StatusForbidden},
		{"expired license", &domain.User{ID: "u1", AccountStatus: domain.AccountStatusActive},
			&domain.Organization{ID: "org-1", Type: domain.OrganizationTypeFactory, LicensePlan: domain.LicensePlanTrial, LicenseExpiresAt: &expired, Status: domain.OrganizationStatusActive, CredentialVersion: 1}, http.StatusForbidden},
		{"active trial no expiry", &domain.User{ID: "u1", AccountStatus: domain.AccountStatusActive},
			&domain.Organization{ID: "org-1", Type: domain.OrganizationTypeFactory, LicensePlan: domain.LicensePlanTrial, Status: domain.OrganizationStatusActive, CredentialVersion: 1}, http.StatusOK},
		{"active pro future expiry", &domain.User{ID: "u1", AccountStatus: domain.AccountStatusActive},
			&domain.Organization{ID: "org-1", Type: domain.OrganizationTypeFactory, LicensePlan: domain.LicensePlanPro, LicenseExpiresAt: ptrTime(time.Now().Add(30 * 24 * time.Hour)), Status: domain.OrganizationStatusActive, CredentialVersion: 1}, http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := licenseTestServer(t, tc.user, tc.org)
			token, err := auth.GenerateLegacyWebToken(tc.user.ID, "u@example.com", auth.TokenContext{Roles: []string{"user"}, OrgID: "org-1", MembershipID: tc.user.ID + ":org-1", MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1}, furnitureTestSecret)
			if err != nil {
				t.Fatalf("generate token: %v", err)
			}
			// Route through the real middleware so auth + license gate are both exercised.
			handler := AuthMiddleware(mustAuthority(furnitureTestSecret), server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitions))
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			handler.ServeHTTP(rec, req)

			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.want, rec.Body.String())
			}
			if tc.want == http.StatusForbidden {
				var body struct {
					Message string `json:"message"`
				}
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatalf("decode error body: %v", err)
				}
				if body.Message == "" || body.Message == "error interno del servidor" {
					t.Fatalf("license blocker must explain how to resolve it, got %q", body.Message)
				}
			}
		})
	}
}

func TestFurnitureDefinitionsServesWorkshopModules(t *testing.T) {
	u := &domain.User{ID: "u1", AccountStatus: domain.AccountStatusActive}
	modules := []domain.Module{
		{
			ID: "11111111-1111-1111-1111-111111111111", Code: "MOD-BASE-600", Name: "Base Cocina 600",
			WidthMm: 600, HeightMm: 720, DepthMm: 560, CategoryID: "cat-base", Notes: "Módulo inferior del taller.",
			Presets: []domain.DimensionPreset{
				{ID: "preset-a", Name: "600 × 720", WidthMm: 600, HeightMm: 720, DepthMm: 560},
				{ID: "preset-b", Name: "900 × 720", WidthMm: 900, HeightMm: 720, DepthMm: 560},
			},
		},
		{
			ID: "22222222-2222-2222-2222-222222222222", Code: "MOD-ALTO-400", Name: "Alacena 400",
			WidthMm: 400, HeightMm: 900, DepthMm: 350,
		},
	}
	server := licenseTestServer(t, u, nil)
	server.Store = &stubStore{
		getUserByEmail: u,
		listModules:    modules,
		listCategories: []domain.ModuleCategory{{ID: "cat-base", Name: "Cocinas"}},
	}
	token, _ := auth.GenerateLegacyWebToken(u.ID, "u@example.com", auth.TokenContext{Roles: []string{"user"}, OrgID: "org-1", MembershipID: u.ID + ":org-1", MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1}, furnitureTestSecret)

	handler := AuthMiddleware(mustAuthority(furnitureTestSecret), server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitions))
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

	var served workshopFurnitureCatalog
	if err := json.Unmarshal(rec.Body.Bytes(), &served); err != nil {
		t.Fatalf("decode served: %v", err)
	}
	if served.SchemaID != workshopFurnitureSchemaID {
		t.Fatalf("schemaId = %q", served.SchemaID)
	}
	// Only the workshop's own modules: no generic/pilot furniture may leak in.
	if len(served.Definitions) != 2 || len(served.Presets) != 2 {
		t.Fatalf("expected 2 definitions / 2 presets (workshop rows only), got %d/%d",
			len(served.Definitions), len(served.Presets))
	}

	base := served.Definitions["11111111-1111-1111-1111-111111111111"]
	if base.FurnitureDefinitionID != "11111111-1111-1111-1111-111111111111" || base.Code != "MOD-BASE-600" ||
		base.Name != "Base Cocina 600" || base.Category != "Cocinas" || base.Description != "Módulo inferior del taller." {
		t.Fatalf("module identity not preserved: %+v", base)
	}
	if len(base.Parameters) != 3 {
		t.Fatalf("expected width/height/depth parameters, got %d", len(base.Parameters))
	}
	width := parameterByName(base.Parameters, "widthMm")
	if width == nil || width.DefaultValue != float64(600) || numberPtrValue(width.Min) != 600 || numberPtrValue(width.Max) != 900 || width.Unit != "mm" {
		t.Fatalf("widthMm parameter not derived from module + presets: %+v", width)
	}
	// Modules without a catalog category fall into an explicit bucket.
	wall := served.Definitions["22222222-2222-2222-2222-222222222222"]
	if wall.Category != workshopUncategorizedLabel {
		t.Fatalf("uncategorized module category = %q, want %q", wall.Category, workshopUncategorizedLabel)
	}

	preset := served.Presets[0]
	if preset.PresetID != "preset-a" || preset.FurnitureDefinitionID != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("preset identity not preserved: %+v", preset)
	}
	if preset.Parameters["widthMm"] != 600 || preset.Parameters["heightMm"] != 720 || preset.Parameters["depthMm"] != 560 {
		t.Fatalf("preset parameters not preserved: %+v", preset.Parameters)
	}

	if etag := rec.Header().Get("ETag"); etag == "" || etag == `"pilot-rev-1"` {
		t.Fatalf("etag must be content-derived, got %q", etag)
	}
}

func TestFurnitureDefinitionsFailsClosedOnInvalidPublishedParameter(t *testing.T) {
	u := &domain.User{ID: "u1", AccountStatus: domain.AccountStatusActive}
	server := licenseTestServer(t, u, nil)
	server.Store = &stubStore{
		getUserByEmail: u,
		getOrgByID:     &domain.Organization{ID: "org-1", Type: domain.OrganizationTypeFactory, LicensePlan: domain.LicensePlanTrial, Status: domain.OrganizationStatusActive, CredentialVersion: 1},
		listModules: []domain.Module{{
			ID: "m1", Code: "M1", Name: "Invalid",
			ParameterDefinitions: []domain.FurnitureParameterDefinition{{Name: "unbound", Label: "Unbound", Type: domain.FurnitureParameterTypeString, Category: domain.FurnitureParameterCategoryConfiguration}},
		}},
	}
	token, _ := auth.GenerateLegacyWebToken(u.ID, "u@example.com", auth.TokenContext{Roles: []string{"user"}, OrgID: "org-1", MembershipID: "u1:org-1", MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1}, furnitureTestSecret)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	AuthMiddleware(mustAuthority(furnitureTestSecret), server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitions)).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var response struct {
		Code   string                                     `json:"code"`
		Issues []domain.FurnitureParameterDefinitionIssue `json:"issues"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != "PARAMETER_DEFINITION_INVALID" || len(response.Issues) == 0 {
		t.Fatalf("unexpected response: %+v", response)
	}
}

func TestFurnitureDefinitionsEmptyWorkshop(t *testing.T) {
	u := &domain.User{ID: "u1", AccountStatus: domain.AccountStatusActive}
	server := licenseTestServer(t, u, nil)
	token, _ := auth.GenerateLegacyWebToken(u.ID, "u@example.com", auth.TokenContext{Roles: []string{"user"}, OrgID: "org-1", MembershipID: u.ID + ":org-1", MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1}, furnitureTestSecret)

	handler := AuthMiddleware(mustAuthority(furnitureTestSecret), server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitions))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var served workshopFurnitureCatalog
	if err := json.Unmarshal(rec.Body.Bytes(), &served); err != nil {
		t.Fatalf("decode served: %v", err)
	}
	// An empty workshop is a valid catalog: 200 + empty, never generic filler.
	if len(served.Definitions) != 0 || len(served.Presets) != 0 {
		t.Fatalf("expected empty catalog for workshop without furniture, got %d definitions", len(served.Definitions))
	}
}

func TestFurnitureDefinitionsStoreErrorIs500(t *testing.T) {
	u := &domain.User{ID: "u1", AccountStatus: domain.AccountStatusActive}
	server := licenseTestServer(t, u, nil)
	server.Store = &stubStore{getUserByEmail: u, listModulesErr: errors.New("db down")}
	token, _ := auth.GenerateLegacyWebToken(u.ID, "u@example.com", auth.TokenContext{Roles: []string{"user"}, OrgID: "org-1", MembershipID: u.ID + ":org-1", MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1}, furnitureTestSecret)

	handler := AuthMiddleware(mustAuthority(furnitureTestSecret), server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitions))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestFurnitureDefinitionsCachesPerContentRevision(t *testing.T) {
	u := &domain.User{ID: "u1", AccountStatus: domain.AccountStatusActive}
	modules := []domain.Module{{ID: "m1", Code: "M1", Name: "Módulo 1", WidthMm: 600, HeightMm: 720, DepthMm: 500}}
	server := licenseTestServer(t, u, nil)
	server.Store = &stubStore{getUserByEmail: u, listModules: modules}
	token, _ := auth.GenerateLegacyWebToken(u.ID, "u@example.com", auth.TokenContext{Roles: []string{"user"}, OrgID: "org-1", MembershipID: u.ID + ":org-1", MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1}, furnitureTestSecret)
	handler := AuthMiddleware(mustAuthority(furnitureTestSecret), server.Store)(http.HandlerFunc(server.HandleFurnitureDefinitions))

	get := func(ifNoneMatch string) int {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		if ifNoneMatch != "" {
			req.Header.Set("If-None-Match", ifNoneMatch)
		}
		handler.ServeHTTP(rec, req)
		return rec.Code
	}

	if got := get(""); got != http.StatusOK {
		t.Fatalf("first fetch status = %d", got)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/furniture/definitions", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	handler.ServeHTTP(rec, req)
	etag := rec.Header().Get("ETag")

	if got := get(etag); got != http.StatusNotModified {
		t.Fatalf("revalidation with current etag = %d, want 304 (etag %q)", got, etag)
	}
	if got := get(`"stale-rev"`); got != http.StatusOK {
		t.Fatalf("revalidation with stale etag = %d, want 200", got)
	}
}

func parameterByName(params []workshopFurnitureParameter, name string) *workshopFurnitureParameter {
	for i := range params {
		if params[i].Name == name {
			return &params[i]
		}
	}
	return nil
}

func TestLoginIssuesExtensionTokenAndLicenseBlock(t *testing.T) {
	hash, err := auth.HashPassword("secret123")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	u := &domain.User{
		ID: "u1", Email: "u@example.com", Name: "U", AccountStatus: domain.AccountStatusActive,
		PasswordHash: hash}
	server := &Server{
		Store: &stubStore{
			getUserByEmail: u,
			membershipsByUser: map[string][]domain.MembershipWithOrg{
				"u1": {{
					Membership: domain.Membership{
						ID: "u1:org-1", OrganizationID: "org-1", UserID: "u1",
						Roles: []domain.UserRole{domain.RoleUser}, Status: domain.MembershipStatusActive, CredentialVersion: 1,
					},
					Organization: domain.Organization{
						ID: "org-1", Name: "T", Slug: "t",
						Type:        domain.OrganizationTypeFactory,
						LicensePlan: domain.LicensePlanTrial,
						Status:      domain.OrganizationStatusActive, CredentialVersion: 1,
					},
				}},
			},
		},
		JWTSecret: furnitureTestSecret,
	}

	body, _ := json.Marshal(map[string]string{
		"email": "u@example.com", "password": "secret123", "transport": "sketchup",
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
	claims, err := mustAuthority(furnitureTestSecret).Validate(resp.Token)
	if err != nil {
		t.Fatalf("validate issued token: %v", err)
	}
	if claims.Client != auth.ExtensionClient {
		t.Fatalf("claims.Client = %q, want %q", claims.Client, auth.ExtensionClient)
	}
	// #460 SEC-6: the extension ACCESS bearer is short-lived (15 min); the
	// workshop-spanning policy lives in the registry session bound and the
	// durable device secret, not in this token.
	remaining := time.Until(claims.ExpiresAt.Time)
	if remaining <= 0 || remaining > auth.SketchUpAccessTokenTTL {
		t.Fatalf("extension token TTL = %v, want <= %v", remaining, auth.SketchUpAccessTokenTTL)
	}
	if resp.License.Plan != "trial" || resp.License.Status != string(domain.LicenseStatusActive) {
		t.Fatalf("license block = %+v", resp.License)
	}
}

func TestExtensionTokenIsReadOnly(t *testing.T) {
	u := &domain.User{ID: "u1", AccountStatus: domain.AccountStatusActive}
	server := licenseTestServer(t, u, nil)
	token, _ := auth.GenerateLegacyExtensionToken(u.ID, "u@example.com", auth.TokenContext{Roles: []string{"admin"}, OrgID: "org-1", MembershipID: u.ID + ":org-1", MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1}, furnitureTestSecret)

	handler := AuthMiddleware(mustAuthority(furnitureTestSecret), server.Store)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	webToken, _ := auth.GenerateLegacyWebToken(u.ID, "u@example.com", auth.TokenContext{Roles: []string{"admin"}, OrgID: "org-1", MembershipID: u.ID + ":org-1", MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1}, furnitureTestSecret)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/projects/1", nil)
	req.Header.Set("Authorization", "Bearer "+webToken)
	handler.ServeHTTP(rec, req)
	if rec.Code == http.StatusForbidden {
		t.Fatalf("web token must not be read-only restricted")
	}
}

// TestExtensionTokenDenyByDefault locks the #460 SEC-6 least-privilege
// boundary: a VALID SketchUp bearer (even owned by an admin) is rejected on
// every authenticated surface that is not the plugin's furniture/media
// contract. Administration, session/device management, platform and support
// belong to web/mobile/admin credentials, never to the extension class.
func TestExtensionTokenDenyByDefault(t *testing.T) {
	u := &domain.User{ID: "u1", AccountStatus: domain.AccountStatusActive, PlatformAdmin: true}
	server := licenseTestServer(t, u, nil)
	// Platform admin owner on purpose: the boundary must hold even when the
	// claims would otherwise pass platform gates.
	token, _ := auth.GenerateLegacyExtensionToken(u.ID, "u@example.com", auth.TokenContext{Roles: []string{"admin"}, OrgID: "org-1", MembershipID: u.ID + ":org-1", MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1}, furnitureTestSecret)

	handler := AuthMiddleware(mustAuthority(furnitureTestSecret), server.Store)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	send := func(method, path string) int {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		handler.ServeHTTP(rec, req)
		return rec.Code
	}

	// The plugin's real surface stays open.
	for _, path := range []string{
		"/api/furniture/definitions",
		"/api/furniture/definitions/kitchen-base-standard/layout",
		"/api/media/picture.png",
	} {
		if got := send(http.MethodGet, path); got != http.StatusOK {
			t.Fatalf("GET %s with extension token = %d, want 200 (plugin surface)", path, got)
		}
	}
	if got := send(http.MethodPost, "/api/furniture/authoring/resolve"); got == http.StatusForbidden {
		t.Fatal("authoring resolve is part of the extension POST contract")
	}
	if got := send(http.MethodPost, "/api/media:authorize"); got == http.StatusForbidden {
		t.Fatal("media authorize is part of the extension POST contract")
	}

	// #388 / DT-4 model binding: project/design discovery reads and the
	// stateless binding validation are part of the plugin contract now.
	if got := send(http.MethodGet, "/api/projects"); got != http.StatusOK {
		t.Fatalf("GET /api/projects with extension token = %d, want 200 (#388 discovery)", got)
	}
	if got := send(http.MethodGet, "/api/projects/41000000-0000-0000-0000-000000000001/designs"); got != http.StatusOK {
		t.Fatalf("GET project designs with extension token = %d, want 200 (#388 discovery)", got)
	}
	if got := send(http.MethodPost, "/api/projects/41000000-0000-0000-0000-000000000001/designs/52000000-0000-0000-0000-000000000001/binding:validate"); got == http.StatusForbidden {
		t.Fatal("binding validate is part of the extension POST contract (#388)")
	}

	// #389 / DT-5 Project Furniture: the plugin lists the connected
	// project's furniture instances and reads/writes the design working
	// copy. The PUT working-copy is the credential's ONLY write; identity
	// creation (POST furniture-instances, #390) stays denied below.
	if got := send(http.MethodGet, "/api/projects/41000000-0000-0000-0000-000000000001/furniture-instances"); got != http.StatusOK {
		t.Fatalf("GET project furniture instances with extension token = %d, want 200 (#389 panel)", got)
	}
	if got := send(http.MethodGet, "/api/designs/52000000-0000-0000-0000-000000000001/working-copy"); got != http.StatusOK {
		t.Fatalf("GET working copy with extension token = %d, want 200 (#389 pending/placed)", got)
	}
	if got := send(http.MethodPut, "/api/designs/52000000-0000-0000-0000-000000000001/working-copy"); got != http.StatusOK {
		t.Fatalf("PUT working copy with extension token = %d, want 200 (#389 place existing)", got)
	}

	// Everything else denies the credential CLASS: team admin, session and
	// device management, org/business reads and writes, platform — even for
	// a platform-admin owner. Project discovery (#388) is intentionally
	// narrow: only the project list and the per-project designs list open;
	// furniture identity creation (#390) and revision publication (#392)
	// stay out of the extension contract.
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/org/team/summary"},
		{http.MethodGet, "/api/org/memberships"},
		{http.MethodPut, "/api/org/memberships/m1/roles"},
		{http.MethodGet, "/api/auth/sessions"},
		{http.MethodPost, "/api/auth/sessions/sess-1/revoke"},
		{http.MethodGet, "/api/auth/devices"},
		{http.MethodPost, "/api/auth/devices/revoke"},
		{http.MethodPost, "/api/projects"},
		{http.MethodDelete, "/api/projects/1"},
		// #390: catalog insertion creating a project unit must NOT be
		// reachable by the extension credential — place existing never
		// mints business identity.
		{http.MethodPost, "/api/projects/1/furniture-instances"},
		{http.MethodGet, "/api/projects/1/loading-status"},
		{http.MethodPost, "/api/designs/52000000-0000-0000-0000-000000000001/working-copy:reset"},
		{http.MethodPost, "/api/designs/52000000-0000-0000-0000-000000000001/revisions"},
		{http.MethodPut, "/api/projects/1/designs/2/binding:validate"},
		{http.MethodGet, "/api/customers"},
		{http.MethodGet, "/api/platform/organizations"},
		{http.MethodPost, "/api/platform/organizations/org-1/support-session"},
		{http.MethodGet, "/api/catalog/ambient-materials"},
		{http.MethodPost, "/api/media"},
	} {
		if got := send(tc.method, tc.path); got != http.StatusForbidden {
			t.Fatalf("%s %s with extension token = %d, want 403 (deny by default)", tc.method, tc.path, got)
		}
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
