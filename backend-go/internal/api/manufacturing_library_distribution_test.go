package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestHandleStandardLibraryReleaseManifest_Success(t *testing.T) {
	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	relID := uuid.New()
	pubAt := time.Now().UTC()
	hash := "sha256:abcdef1234567890"

	rel := &domain.LibraryRelease{
		ID:           relID,
		LibraryID:    standardID,
		Version:      "1.0.0",
		Status:       domain.ReleaseStatusPublished,
		ManifestHash: &hash,
		PublishedAt:  &pubAt,
	}

	manifest := &domain.LibraryManifest{
		SchemaVersion:      1,
		LibraryID:          standardID,
		LibraryCode:        "0001",
		LibraryVersion:     "1.0.0",
		EffectiveReleaseID: relID,
		ManifestHash:       hash,
		Resources:          []domain.ManifestResourceRef{},
	}
	rawBytes, _ := json.Marshal(manifest)

	store := &stubStore{
		releaseByID: map[uuid.UUID]*domain.LibraryRelease{
			relID: rel,
		},
		releaseManifestsByID: map[uuid.UUID]*domain.LibraryManifest{
			relID: manifest,
		},
		releaseManifestRawByID: map[uuid.UUID][]byte{
			relID: rawBytes,
		},
	}
	server := &Server{Store: store}

	req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/standard/releases/"+relID.String()+"/manifest", nil)
	req.SetPathValue("releaseId", relID.String())
	rr := httptest.NewRecorder()

	server.HandleStandardLibraryReleaseManifest(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d (body: %s)", rr.Code, rr.Body.String())
	}

	etag := rr.Header().Get("ETag")
	if etag != `"`+hash+`"` {
		t.Errorf("expected ETag %q, got %q", `"`+hash+`"`, etag)
	}

	cacheControl := rr.Header().Get("Cache-Control")
	if cacheControl != "public, max-age=31536000, immutable" {
		t.Errorf("expected Cache-Control immutable, got %q", cacheControl)
	}
}

func TestHandleStandardLibraryReleaseManifest_UnpublishedRelease(t *testing.T) {
	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	relID := uuid.New()

	rel := &domain.LibraryRelease{
		ID:        relID,
		LibraryID: standardID,
		Version:   "1.0.0-draft",
		Status:    domain.ReleaseStatusDraft, // not published
	}

	store := &stubStore{
		releaseByID: map[uuid.UUID]*domain.LibraryRelease{
			relID: rel,
		},
	}
	server := &Server{Store: store}

	req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/standard/releases/"+relID.String()+"/manifest", nil)
	req.SetPathValue("releaseId", relID.String())
	rr := httptest.NewRecorder()

	server.HandleStandardLibraryReleaseManifest(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected status 404 for draft release manifest, got %d", rr.Code)
	}
}

func TestHandleStandardLibraryResourceBlob_SuccessFreeResource(t *testing.T) {
	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	relID := uuid.New()
	resID := uuid.New()
	hash := "sha256:1111222233334444"

	rel := &domain.LibraryRelease{
		ID:        relID,
		LibraryID: standardID,
		Version:   "1.0.0",
		Status:    domain.ReleaseStatusPublished,
	}

	blob := &domain.ResourceBlob{
		SHA256:       hash,
		ResourceKind: "furniture_definition",
		ResourceID:   resID,
		ContentType:  "application/json",
		SizeBytes:    30,
		Content:      json.RawMessage(`{"name":"Gabinete 60 Free"}`),
	}

	store := &stubStore{
		releaseByID: map[uuid.UUID]*domain.LibraryRelease{
			relID: rel,
		},
		resourceBlobEntitlementCheckFunc: func(rlID, rsID uuid.UUID, h string) (*domain.ResourceBlob, domain.PackageKind, error) {
			if rlID == relID && rsID == resID && h == hash {
				return blob, domain.PackageKindFree, nil
			}
			return nil, "", storage.ErrResourceNotInRelease
		},
	}
	server := &Server{Store: store}

	req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/standard/releases/"+relID.String()+"/resources/"+resID.String()+"/blobs/"+hash, nil)
	req.SetPathValue("releaseId", relID.String())
	req.SetPathValue("resourceId", resID.String())
	req.SetPathValue("hash", hash)
	rr := httptest.NewRecorder()

	server.HandleStandardLibraryResourceBlob(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200 for free package resource, got %d (body: %s)", rr.Code, rr.Body.String())
	}

	if rr.Header().Get("ETag") != `"`+hash+`"` {
		t.Errorf("expected ETag %q, got %q", `"`+hash+`"`, rr.Header().Get("ETag"))
	}
}

func TestHandleStandardLibraryResourceBlob_StandardResourceForbiddenForFreePlan(t *testing.T) {
	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	relID := uuid.New()
	resID := uuid.New()
	orgID := uuid.New()
	hash := "sha256:5555666677778888"

	rel := &domain.LibraryRelease{
		ID:        relID,
		LibraryID: standardID,
		Version:   "1.0.0",
		Status:    domain.ReleaseStatusPublished,
	}

	blob := &domain.ResourceBlob{
		SHA256:       hash,
		ResourceKind: "furniture_definition",
		ResourceID:   resID,
		ContentType:  "application/json",
		SizeBytes:    34,
		Content:      json.RawMessage(`{"name":"Gabinete 60 Standard"}`),
	}

	freeOrg := &domain.Organization{
		ID:          orgID.String(),
		LicensePlan: domain.LicensePlanNone, // no active paying standard license
	}

	store := &stubStore{
		releaseByID: map[uuid.UUID]*domain.LibraryRelease{
			relID: rel,
		},
		getOrgByID: freeOrg,
		resourceBlobEntitlementCheckFunc: func(rlID, rsID uuid.UUID, h string) (*domain.ResourceBlob, domain.PackageKind, error) {
			return blob, domain.PackageKindStandard, nil
		},
	}
	server := &Server{Store: store}

	req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/standard/releases/"+relID.String()+"/resources/"+resID.String()+"/blobs/"+hash, nil)
	req = req.WithContext(storage.WithOrgCtx(req.Context(), orgID.String()))
	req.SetPathValue("releaseId", relID.String())
	req.SetPathValue("resourceId", resID.String())
	req.SetPathValue("hash", hash)
	rr := httptest.NewRecorder()

	server.HandleStandardLibraryResourceBlob(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected status 403 Forbidden for standard package resource on free plan, got %d", rr.Code)
	}
}

func TestHandleStandardLibraryResourceBlob_StandardResourceAllowedWithActivePlan(t *testing.T) {
	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	relID := uuid.New()
	resID := uuid.New()
	orgID := uuid.New()
	hash := "sha256:5555666677778888"
	future := time.Now().Add(30 * 24 * time.Hour)

	rel := &domain.LibraryRelease{
		ID:        relID,
		LibraryID: standardID,
		Version:   "1.0.0",
		Status:    domain.ReleaseStatusPublished,
	}

	blob := &domain.ResourceBlob{
		SHA256:       hash,
		ResourceKind: "furniture_definition",
		ResourceID:   resID,
		ContentType:  "application/json",
		SizeBytes:    34,
		Content:      json.RawMessage(`{"name":"Gabinete 60 Standard"}`),
	}

	proOrg := &domain.Organization{
		ID:               orgID.String(),
		LicensePlan:      domain.LicensePlanPro,
		LicenseExpiresAt: &future,
	}

	store := &stubStore{
		releaseByID: map[uuid.UUID]*domain.LibraryRelease{
			relID: rel,
		},
		getOrgByID: proOrg,
		resourceBlobEntitlementCheckFunc: func(rlID, rsID uuid.UUID, h string) (*domain.ResourceBlob, domain.PackageKind, error) {
			return blob, domain.PackageKindStandard, nil
		},
	}
	server := &Server{Store: store}

	req := httptest.NewRequest(http.MethodGet, "/api/manufacturing-libraries/standard/releases/"+relID.String()+"/resources/"+resID.String()+"/blobs/"+hash, nil)
	req = req.WithContext(storage.WithOrgCtx(req.Context(), orgID.String()))
	req.SetPathValue("releaseId", relID.String())
	req.SetPathValue("resourceId", resID.String())
	req.SetPathValue("hash", hash)
	rr := httptest.NewRecorder()

	server.HandleStandardLibraryResourceBlob(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200 for standard package resource on pro plan, got %d", rr.Code)
	}
}

func TestStandardLibraryDistributionRoutes_AuthRequired(t *testing.T) {
	router := RegisterRoutes(&Server{
		JWTSecret: "routes-test-secret-0123456789abc",
		Store:     &stubStore{},
	})

	relID := uuid.NewString()
	resID := uuid.NewString()
	hash := "sha256:1234"

	paths := []string{
		"/api/manufacturing-libraries/standard/releases/" + relID + "/manifest",
		"/api/manufacturing-libraries/standard/releases/" + relID + "/resources/" + resID + "/blobs/" + hash,
	}

	for _, p := range paths {
		t.Run(p, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, p, nil)
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)
			if rr.Code != http.StatusUnauthorized {
				t.Fatalf("expected 401 Unauthorized, got %d for %s", rr.Code, p)
			}
		})
	}
}
