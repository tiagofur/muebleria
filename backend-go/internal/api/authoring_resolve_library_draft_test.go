package api

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// TestAuthoringResolveLibraryDraftIsEngineeringOnly (#1598): the SketchUp
// extension drops its release pin in library dev mode, so an unpinned
// extension resolve reads the DRAFT. Only admin/ingeniero may; everyone else
// is refused by name once the workshop has a published release to pin. The
// web previews (also unpinned) and a workshop without any release keep
// today's behaviour, and a pinned resolve never consults the draft gate.
func TestAuthoringResolveLibraryDraftIsEngineeringOnly(t *testing.T) {
	releaseID := uuid.MustParse("22222222-2222-2222-2222-000000001598")
	published := func(stub *stubStore) {
		stub.currentPublishedRelease = &domain.LibraryRelease{
			ID: releaseID, LibraryID: uuid.MustParse(domain.GraneteStandardLibraryID),
			Version: "0.3.53", Status: domain.ReleaseStatusPublished,
		}
		stub.releaseManifestsByID = map[uuid.UUID]*domain.LibraryManifest{
			releaseID: {SchemaVersion: domain.LibraryManifestSchemaVersion, Resources: []domain.ManifestResourceRef{}},
		}
	}
	unknownPin := "22222222-2222-2222-2222-00000000dead"

	cases := []struct {
		name       string
		roles      []domain.UserRole
		extension  bool
		stage      func(stub *stubStore)
		pin        string
		wantStatus int
		wantCode   string
	}{
		{name: "vendedor on the extension is refused the draft", roles: []domain.UserRole{domain.RoleVendedor},
			extension: true, stage: published, wantStatus: http.StatusForbidden, wantCode: "LIBRARY_DRAFT_FORBIDDEN"},
		{name: "gerente de producción is refused too", roles: []domain.UserRole{domain.RoleGerenteProduccion},
			extension: true, stage: published, wantStatus: http.StatusForbidden, wantCode: "LIBRARY_DRAFT_FORBIDDEN"},
		{name: "ingeniero resolves the draft", roles: []domain.UserRole{domain.RoleIngeniero},
			extension: true, stage: published, wantStatus: http.StatusOK},
		{name: "admin resolves the draft", roles: []domain.UserRole{domain.RoleAdmin},
			extension: true, stage: published, wantStatus: http.StatusOK},
		{name: "role union: vendedor + ingeniero resolves the draft", roles: []domain.UserRole{domain.RoleVendedor, domain.RoleIngeniero},
			extension: true, stage: published, wantStatus: http.StatusOK},
		{name: "no published release: the live catalog is the only catalog", roles: []domain.UserRole{domain.RoleVendedor},
			extension: true, stage: func(*stubStore) {}, wantStatus: http.StatusOK},
		{name: "web previews stay unpinned for every role", roles: []domain.UserRole{domain.RoleVendedor},
			extension: false, stage: published, wantStatus: http.StatusOK},
		{name: "a pinned resolve never consults the draft gate", roles: []domain.UserRole{domain.RoleVendedor},
			extension: true, stage: published, pin: unknownPin,
			wantStatus: http.StatusUnprocessableEntity, wantCode: "LIBRARY_RELEASE_UNAVAILABLE"},
		{name: "an unreadable release state fails closed, never serves the draft", roles: []domain.UserRole{domain.RoleVendedor},
			extension: true, stage: func(stub *stubStore) { stub.currentPublishedReleaseErr = errors.New("release lookup down") },
			wantStatus: http.StatusInternalServerError},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server, _ := authoringStubServer(t)
			stub := server.Store.(*stubStore)
			// The revision is content-addressed over the catalog only; compute
			// it before staging so a failing release lookup cannot disturb it.
			revision := authoringCatalogRevision(t, server)
			stub.membershipsByUser = map[string][]domain.MembershipWithOrg{
				"u1": {orgTestMembership("u1", "org-1", "taller-test", tc.roles)},
			}
			tc.stage(stub)

			roleNames := make([]string, len(tc.roles))
			for i, role := range tc.roles {
				roleNames[i] = string(role)
			}
			tokenContext := auth.TokenContext{
				Roles: roleNames, OrgID: "org-1", MembershipID: "u1:org-1",
				MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1,
			}
			generate := auth.GenerateLegacyWebToken
			if tc.extension {
				generate = auth.GenerateLegacyExtensionToken
			}
			token, err := generate("u1", "u@example.com", tokenContext, furnitureTestSecret)
			if err != nil {
				t.Fatalf("generate token: %v", err)
			}

			rec := postAuthoringResolve(server, token, "", authoringFixtureRequest(revision, authoringResolveFurniture{
				FurnitureDefinitionID: authoringFixtureModuleID,
				LibraryReleaseID:      tc.pin,
			}))
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			body := rec.Body.String()
			if tc.wantCode != "" && !strings.Contains(body, `"code":"`+tc.wantCode+`"`) {
				t.Fatalf("missing issue code %s; body=%s", tc.wantCode, body)
			}
			if tc.wantCode != "LIBRARY_DRAFT_FORBIDDEN" && strings.Contains(body, "LIBRARY_DRAFT_FORBIDDEN") {
				t.Fatalf("draft gate fired where it must not; body=%s", body)
			}
			if tc.wantCode == "LIBRARY_DRAFT_FORBIDDEN" {
				// The refusal is a structured rejection the plugin can parse:
				// same envelope identity as the request, no resolved layout.
				for _, want := range []string{`"status":"rejected"`, `"inReplyToMessageId":"msg-fixture-0001"`, `"path":"furniture.libraryReleaseId"`} {
					if !strings.Contains(body, want) {
						t.Fatalf("rejection envelope lacks %s; body=%s", want, body)
					}
				}
			}
		})
	}
}
