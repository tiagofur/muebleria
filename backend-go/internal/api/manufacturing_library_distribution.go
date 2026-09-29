package api

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #773 [P1][LIB-2]: Manufacturing library manifest & content distribution handlers.

// HandleStandardLibraryReleaseManifest handles GET /api/manufacturing-libraries/standard/releases/{releaseId}/manifest.
func (s *Server) HandleStandardLibraryReleaseManifest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	rawID := r.PathValue("releaseId")
	relUUID, err := uuid.Parse(rawID)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid release id")
		return
	}

	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	rel, err := s.Store.GetReleaseByID(r.Context(), relUUID)
	if err != nil {
		if errors.Is(err, storage.ErrLibraryReleaseNotFound) {
			respondWithError(w, http.StatusNotFound, "library release not found")
			return
		}
		respondWithInternalError(w, err, "get library release by id")
		return
	}

	if rel.LibraryID != standardID {
		respondWithError(w, http.StatusNotFound, "library release not found in Granete Standard")
		return
	}

	// Only published releases have manifests accessible to clients
	if rel.Status != domain.ReleaseStatusPublished {
		respondWithError(w, http.StatusNotFound, "release is not published")
		return
	}

	manifest, rawBytes, err := s.Store.GetReleaseManifest(r.Context(), relUUID)
	if err != nil {
		if errors.Is(err, storage.ErrManifestNotFound) {
			respondWithError(w, http.StatusNotFound, "manifest not found for release")
			return
		}
		respondWithInternalError(w, err, "get release manifest")
		return
	}

	// Immutable content-addressed caching headers
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", fmt.Sprintf("\"%s\"", manifest.ManifestHash))
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(rawBytes)
}

// HandleStandardLibraryResourceBlob handles GET /api/manufacturing-libraries/standard/releases/{releaseId}/resources/{resourceId}/blobs/{hash}.
func (s *Server) HandleStandardLibraryResourceBlob(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	relUUID, err := uuid.Parse(r.PathValue("releaseId"))
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid release id")
		return
	}

	resUUID, err := uuid.Parse(r.PathValue("resourceId"))
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid resource id")
		return
	}

	hash := r.PathValue("hash")
	if hash == "" {
		respondWithError(w, http.StatusBadRequest, "missing hash parameter")
		return
	}

	// Verify standard release
	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	rel, err := s.Store.GetReleaseByID(r.Context(), relUUID)
	if err != nil {
		if errors.Is(err, storage.ErrLibraryReleaseNotFound) {
			respondWithError(w, http.StatusNotFound, "library release not found")
			return
		}
		respondWithInternalError(w, err, "get library release")
		return
	}
	if rel.LibraryID != standardID {
		respondWithError(w, http.StatusNotFound, "library release not found in Granete Standard")
		return
	}

	// Fetch blob and check package kind
	blob, pkgKind, err := s.Store.GetResourceBlobWithEntitlementCheck(r.Context(), relUUID, resUUID, hash)
	if err != nil {
		if errors.Is(err, storage.ErrResourceNotInRelease) || errors.Is(err, storage.ErrResourceBlobNotFound) {
			respondWithError(w, http.StatusNotFound, "resource blob not found in release")
			return
		}
		respondWithInternalError(w, err, "get resource blob with entitlement check")
		return
	}

	// Check entitlement: Free plan callers cannot download standard-only resource blobs
	if pkgKind == domain.PackageKindStandard {
		orgID := storage.OrgFromCtx(r.Context())
		if orgID != "" {
			org, orgErr := s.Store.GetOrganizationByID(r.Context(), orgID)
			if orgErr != nil {
				respondWithInternalError(w, orgErr, "check organization license")
				return
			}
			if org != nil && (org.LicensePlan == domain.LicensePlanNone || domain.LicenseStatusAt(org.LicensePlan, org.LicenseExpiresAt, time.Now()) != domain.LicenseStatusActive) {
				respondWithError(w, http.StatusForbidden, "standard package resource requires an active Standard license")
				return
			}
		}
	}

	// Return immutable content-addressed blob
	w.Header().Set("Content-Type", blob.ContentType)
	w.Header().Set("ETag", fmt.Sprintf("\"%s\"", blob.SHA256))
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(blob.Content)
}
