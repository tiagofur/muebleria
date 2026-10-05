package api

import (
	"context"
	"encoding/json"
	"fmt"
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

// TestHandleStandardLibraryDraftReleases (#1102 Slice A): the authoring
// workspace read — platform staff see open Standard drafts, tenants get 403,
// empty list means "no draft open".
func TestHandleStandardLibraryDraftReleases(t *testing.T) {
	draftRequest := func(store *stubStore, platform bool, method string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/manufacturing-libraries/standard/releases/drafts", nil)
		req = platformClaims(req, platform)
		rec := httptest.NewRecorder()
		(&Server{Store: store}).HandleStandardLibraryDraftReleases(rec, req)
		return rec
	}

	t.Run("lists open drafts newest first for platform staff", func(t *testing.T) {
		store := &stubStore{
			draftReleases: []*domain.LibraryRelease{
				{ID: uuid.MustParse(domain.GraneteStandardDraftReleaseID), LibraryID: uuid.MustParse(domain.GraneteStandardLibraryID), Version: "0.4.0", Status: domain.ReleaseStatusDraft, SchemaVersion: domain.LibraryManifestSchemaVersion},
			},
		}
		rec := draftRequest(store, true, http.MethodGet)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		var drafts []map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &drafts); err != nil || len(drafts) != 1 {
			t.Fatalf("drafts = %s err=%v", rec.Body.String(), err)
		}
		if drafts[0]["version"] != "0.4.0" || drafts[0]["status"] != "draft" {
			t.Fatalf("draft[0] = %v", drafts[0])
		}
	})

	t.Run("returns an empty list when no draft is open", func(t *testing.T) {
		rec := draftRequest(&stubStore{}, true, http.MethodGet)
		if rec.Code != http.StatusOK || rec.Body.String() != "[]" {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("rejects a non-platform user with 403", func(t *testing.T) {
		rec := draftRequest(&stubStore{}, false, http.MethodGet)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d", rec.Code)
		}
	})

	t.Run("405 on non-GET", func(t *testing.T) {
		rec := draftRequest(&stubStore{}, true, http.MethodPost)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("status = %d", rec.Code)
		}
	})
}

func TestHandleCreateStandardLibraryReleaseDuplicateVersion(t *testing.T) {
	store := &stubStore{
		createDraftReleaseErr: fmt.Errorf("%w: 1.2.3", storage.ErrReleaseDuplicateVersion),
	}
	body := strings.NewReader(`{"version":"1.2.3"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/standard/releases", body)
	req.Header.Set("Content-Type", "application/json")
	req = platformClaims(req, true)
	rec := httptest.NewRecorder()
	(&Server{Store: store}).HandleCreateStandardLibraryRelease(rec, req)
	// #1102 Slice A: racing the same suggested version is a user-resolvable
	// conflict, not a 500.
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
}

// TestHandleValidateStandardLibraryDraft (#1102 Slice B): the read-only
// "probar borrador" — platform staff gate, publish's 404/409 semantics and a
// structured report instead of a write.
func TestHandleValidateStandardLibraryDraft(t *testing.T) {
	releaseID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)

	validateRequest := func(store *stubStore, platform bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/manufacturing-libraries/standard/releases/"+releaseID.String()+"/validate", nil)
		req.SetPathValue("releaseId", releaseID.String())
		req = platformClaims(req, platform)
		rec := httptest.NewRecorder()
		(&Server{Store: store}).HandleValidateStandardLibraryDraft(rec, req)
		return rec
	}

	t.Run("validates a draft through the real compiler and engine", func(t *testing.T) {
		store := &stubStore{
			releaseByID: map[uuid.UUID]*domain.LibraryRelease{
				releaseID: {ID: releaseID, LibraryID: uuid.MustParse(domain.GraneteStandardLibraryID), Version: "0.4.0", Status: domain.ReleaseStatusDraft, SchemaVersion: domain.LibraryManifestSchemaVersion},
			},
			listActiveHardwareProfilesAnyOrg: []domain.HardwareProfile{{
				ID: "a0000010-0000-0000-0000-000000000001", Code: "PERF-X", Name: "X", Revision: "r1", Active: true,
				Items: []domain.HardwareProfileItem{{HardwareID: "a0000003-0000-0000-0000-000000000012", Quantity: 1}},
			}},
			listHardwares: []domain.Hardware{},
			listModules: []domain.Module{
				{ID: "m-1", Code: "VIG-A", Name: "Vigas A", WidthMm: 600, HeightMm: 720, DepthMm: 560},
			},
		}
		rec := validateRequest(store, true)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		var report struct {
			Ok      bool `json:"ok"`
			Compile struct {
				Ok            bool `json:"ok"`
				ResourceCount int  `json:"resourceCount"`
			} `json:"compile"`
			Furniture struct {
				Total    int `json:"total"`
				Resolved int `json:"resolved"`
				Failed   int `json:"failed"`
			} `json:"furniture"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &report); err != nil {
			t.Fatalf("body = %s err=%v", rec.Body.String(), err)
		}
		if !report.Ok || !report.Compile.Ok || report.Compile.ResourceCount != 1 {
			t.Fatalf("report = %s", rec.Body.String())
		}
		if report.Furniture.Total != 1 || report.Furniture.Resolved != 1 || report.Furniture.Failed != 0 {
			t.Fatalf("furniture = %+v", report.Furniture)
		}
	})

	t.Run("409 when the release is not a draft", func(t *testing.T) {
		store := &stubStore{
			releaseByID: map[uuid.UUID]*domain.LibraryRelease{
				releaseID: {ID: releaseID, LibraryID: uuid.MustParse(domain.GraneteStandardLibraryID), Version: "0.1.0", Status: domain.ReleaseStatusPublished, SchemaVersion: domain.LibraryManifestSchemaVersion},
			},
		}
		rec := validateRequest(store, true)
		if rec.Code != http.StatusConflict {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("404 when the release does not exist", func(t *testing.T) {
		rec := validateRequest(&stubStore{}, true)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d", rec.Code)
		}
	})

	t.Run("rejects a non-platform user with 403", func(t *testing.T) {
		rec := validateRequest(&stubStore{}, false)
		if rec.Code != http.StatusForbidden {
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
