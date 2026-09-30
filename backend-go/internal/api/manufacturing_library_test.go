package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestStandardLibraryCurrentRelease_Success(t *testing.T) {
	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	releaseID := uuid.New()
	pubAt := time.Now().UTC()
	hash := "sha256:abc123456"
	minPlugin := "1.0.0"

	rel := &domain.LibraryRelease{
		ID:               releaseID,
		LibraryID:        standardID,
		Version:          "1.0.0",
		Status:           domain.ReleaseStatusPublished,
		SchemaVersion:    1,
		MinPluginVersion: &minPlugin,
		ManifestHash:     &hash,
		PublishedAt:      &pubAt,
		CreatedAt:        pubAt.Add(-time.Hour),
		UpdatedAt:        pubAt,
	}

	store := &stubStore{
		currentPublishedRelease: rel,
	}
	server := &Server{Store: store}

	req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/standard/releases/current", nil)
	rr := httptest.NewRecorder()

	server.HandleStandardLibraryCurrentRelease(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d (body: %s)", rr.Code, rr.Body.String())
	}

	var resp openapi.LibraryReleaseSummary
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.ID != releaseID.String() {
		t.Errorf("expected id %s, got %s", releaseID.String(), resp.ID)
	}
	if resp.LibraryId != standardID.String() {
		t.Errorf("expected library_id %s, got %s", standardID.String(), resp.LibraryId)
	}
	if resp.Version != "1.0.0" {
		t.Errorf("expected version 1.0.0, got %s", resp.Version)
	}
	if resp.Status != string(domain.ReleaseStatusPublished) {
		t.Errorf("expected status published, got %s", resp.Status)
	}
}

func TestStandardLibraryCurrentRelease_NotFound(t *testing.T) {
	store := &stubStore{
		currentPublishedReleaseErr: storage.ErrLibraryReleaseNotFound,
	}
	server := &Server{Store: store}

	req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/standard/releases/current", nil)
	rr := httptest.NewRecorder()

	server.HandleStandardLibraryCurrentRelease(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", rr.Code)
	}
}

func TestStandardLibraryReleaseByID_Success(t *testing.T) {
	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	releaseID := uuid.New()
	baseID := uuid.New()
	pubAt := time.Now().UTC()
	hash := "sha256:def789"
	changelog := "Initial release"
	minPlugin := "1.0.0"

	rel := &domain.LibraryRelease{
		ID:               releaseID,
		LibraryID:        standardID,
		Version:          "1.1.0",
		Status:           domain.ReleaseStatusPublished,
		SchemaVersion:    1,
		MinPluginVersion: &minPlugin,
		BaseReleaseID:    &baseID,
		ManifestHash:     &hash,
		Changelog:        &changelog,
		PublishedAt:      &pubAt,
		CreatedAt:        pubAt.Add(-time.Hour),
		UpdatedAt:        pubAt,
	}

	store := &stubStore{
		releaseByID: map[uuid.UUID]*domain.LibraryRelease{
			releaseID: rel,
		},
	}
	server := &Server{Store: store}

	req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/standard/releases/"+releaseID.String(), nil)
	req.SetPathValue("releaseId", releaseID.String())
	rr := httptest.NewRecorder()

	server.HandleStandardLibraryReleaseByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d (body: %s)", rr.Code, rr.Body.String())
	}

	var resp openapi.LibraryReleaseDetail
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.ID != releaseID.String() {
		t.Errorf("expected id %s, got %s", releaseID.String(), resp.ID)
	}
	if resp.BaseReleaseId == nil || *resp.BaseReleaseId != baseID.String() {
		t.Errorf("expected base_release_id %s, got %v", baseID.String(), resp.BaseReleaseId)
	}
}

func TestStandardLibraryReleaseByID_InvalidUUID(t *testing.T) {
	server := &Server{Store: &stubStore{}}

	req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/standard/releases/not-a-uuid", nil)
	req.SetPathValue("releaseId", "not-a-uuid")
	rr := httptest.NewRecorder()

	server.HandleStandardLibraryReleaseByID(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rr.Code)
	}
}

func TestStandardLibraryReleaseByID_ForeignLibraryNotFound(t *testing.T) {
	foreignLibID := uuid.New()
	releaseID := uuid.New()

	rel := &domain.LibraryRelease{
		ID:        releaseID,
		LibraryID: foreignLibID,
		Version:   "1.0.0",
		Status:    domain.ReleaseStatusPublished,
	}

	store := &stubStore{
		releaseByID: map[uuid.UUID]*domain.LibraryRelease{
			releaseID: rel,
		},
	}
	server := &Server{Store: store}

	req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/standard/releases/"+releaseID.String(), nil)
	req.SetPathValue("releaseId", releaseID.String())
	rr := httptest.NewRecorder()

	server.HandleStandardLibraryReleaseByID(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected status 404 for release not belonging to Standard, got %d", rr.Code)
	}
}

func TestManufacturingLibraryRoutes_AuthRequired(t *testing.T) {
	router := RegisterRoutes(&Server{
		JWTSecret: "routes-test-secret-0123456789abc",
		Store:     &stubStore{},
	})

	paths := []string{
		"/api/manufacturing-libraries/standard/releases/current",
		"/api/manufacturing-libraries/standard/releases/" + uuid.NewString(),
	}

	for _, p := range paths {
		t.Run(p, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, p, nil)
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)
			if rr.Code != http.StatusUnauthorized {
				t.Fatalf("expected 401 Unauthorized without auth headers, got %d", rr.Code)
			}
		})
	}
}
