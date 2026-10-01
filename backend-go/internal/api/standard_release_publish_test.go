package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #955: the Granete platform-staff publish surface — permission gate,
// draft creation, publish happy path and structured failures.

func platformClaims(req *http.Request, platform bool) *http.Request {
	claims := &auth.Claims{
		OrgID:         "11111111-1111-1111-1111-111111111111",
		UserID:        "22222222-2222-2222-2222-222222222222",
		PlatformAdmin: platform,
	}
	claims.Subject = claims.UserID
	ctx := context.WithValue(req.Context(), UserContextKey, claims)
	return req.WithContext(ctx)
}

func TestHandleCreateStandardLibraryRelease(t *testing.T) {
	t.Run("creates a draft with version and changelog", func(t *testing.T) {
		store := &stubStore{}
		body := strings.NewReader(`{"version":"1.2.0","changelog":"perfiles minifix"}`)
		req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/standard/releases", body)
		req.Header.Set("Content-Type", "application/json")
		req = platformClaims(req, true)
		rec := httptest.NewRecorder()
		(&Server{Store: store}).HandleCreateStandardLibraryRelease(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		var created map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil || created["version"] != "1.2.0" || created["status"] != "draft" {
			t.Fatalf("created = %s err=%v", rec.Body.String(), err)
		}
	})

	t.Run("rejects a non-platform user with 403", func(t *testing.T) {
		store := &stubStore{}
		body := strings.NewReader(`{"version":"1.2.0"}`)
		req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/standard/releases", body)
		req.Header.Set("Content-Type", "application/json")
		req = platformClaims(req, false)
		rec := httptest.NewRecorder()
		(&Server{Store: store}).HandleCreateStandardLibraryRelease(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d", rec.Code)
		}
	})

	t.Run("rejects a missing version with 400", func(t *testing.T) {
		store := &stubStore{}
		req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/standard/releases", strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		req = platformClaims(req, true)
		rec := httptest.NewRecorder()
		(&Server{Store: store}).HandleCreateStandardLibraryRelease(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d", rec.Code)
		}
	})
}

func TestHandlePublishStandardLibraryRelease(t *testing.T) {
	releaseID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)

	publishRequest := func(store *stubStore) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/standard/releases/"+releaseID.String()+"/publish", nil)
		req.SetPathValue("releaseId", releaseID.String())
		req = platformClaims(req, true)
		rec := httptest.NewRecorder()
		(&Server{Store: store}).HandlePublishStandardLibraryRelease(rec, req)
		return rec
	}

	t.Run("publishes a draft through the real compiler", func(t *testing.T) {
		store := &stubStore{
			releaseByID: map[uuid.UUID]*domain.LibraryRelease{
				releaseID: {ID: releaseID, LibraryID: uuid.MustParse(domain.GraneteStandardLibraryID), Version: "0.1.0", Status: domain.ReleaseStatusDraft, SchemaVersion: domain.LibraryManifestSchemaVersion},
			},
			listActiveHardwareProfilesAnyOrg: []domain.HardwareProfile{{
				ID: "a0000010-0000-0000-0000-000000000001", Code: "PERF-X", Name: "X", Revision: "r1", Active: true,
				Items: []domain.HardwareProfileItem{{HardwareID: "a0000003-0000-0000-0000-000000000012", Quantity: 1}},
			}},
			listHardwares: []domain.Hardware{},
		}
		rec := publishRequest(store)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		var result map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil || result["manifestHash"] == "" {
			t.Fatalf("result = %s err=%v", rec.Body.String(), err)
		}
	})

	t.Run("409 when the release is not a draft", func(t *testing.T) {
		store := &stubStore{
			releaseByID: map[uuid.UUID]*domain.LibraryRelease{
				releaseID: {ID: releaseID, LibraryID: uuid.MustParse(domain.GraneteStandardLibraryID), Version: "0.1.0", Status: domain.ReleaseStatusPublished, SchemaVersion: domain.LibraryManifestSchemaVersion},
			},
		}
		rec := publishRequest(store)
		if rec.Code != http.StatusConflict {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("404 when the release does not exist", func(t *testing.T) {
		rec := publishRequest(&stubStore{})
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d", rec.Code)
		}
	})

	t.Run("422 when no active profiles exist to compile", func(t *testing.T) {
		store := &stubStore{
			releaseByID: map[uuid.UUID]*domain.LibraryRelease{
				releaseID: {ID: releaseID, LibraryID: uuid.MustParse(domain.GraneteStandardLibraryID), Version: "0.1.0", Status: domain.ReleaseStatusDraft, SchemaVersion: domain.LibraryManifestSchemaVersion},
			},
			listActiveHardwareProfilesAnyOrg: []domain.HardwareProfile{},
			listHardwares:                    []domain.Hardware{},
		}
		rec := publishRequest(store)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("rejects a non-platform user with 403", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/standard/releases/"+releaseID.String()+"/publish", nil)
		req.SetPathValue("releaseId", releaseID.String())
		req = platformClaims(req, false)
		rec := httptest.NewRecorder()
		(&Server{Store: &stubStore{}}).HandlePublishStandardLibraryRelease(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d", rec.Code)
		}
	})
}

// Compile guard: keep the application error referenced so renames surface.
var _ = application.ErrNoHardwareProfileResource
var _ = storage.ErrLibraryReleaseNotFound
