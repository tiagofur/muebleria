package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #772 [P1][LIB-1]: Manufacturing library HTTP handlers (read-only stubs).
// Phase 1 scope: GET current published release and GET release by ID for Granete Standard.
// Authoring / publishing / withdrawing mutations are admin-internal and not exposed via public API.

// HandleStandardLibraryCurrentRelease handles GET /api/manufacturing-libraries/standard/releases/current.
func (s *Server) HandleStandardLibraryCurrentRelease(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	rel, err := s.Store.GetCurrentPublishedRelease(r.Context(), standardID)
	if err != nil {
		if errors.Is(err, storage.ErrLibraryReleaseNotFound) {
			respondWithError(w, http.StatusNotFound, "no published release found for Granete Standard")
			return
		}
		respondWithInternalError(w, err, "get current standard library release")
		return
	}

	summary := openapi.LibraryReleaseSummary{
		ID:               rel.ID.String(),
		LibraryId:        rel.LibraryID.String(),
		Version:          rel.Version,
		Status:           string(rel.Status),
		SchemaVersion:    int64(rel.SchemaVersion),
		MinPluginVersion: rel.MinPluginVersion,
		ManifestHash:     rel.ManifestHash,
		CreatedAt:        rel.CreatedAt.Format(time.RFC3339),
		UpdatedAt:        rel.UpdatedAt.Format(time.RFC3339),
	}
	if rel.PublishedAt != nil {
		tStr := rel.PublishedAt.Format(time.RFC3339)
		summary.PublishedAt = &tStr
	}

	respondWithJSON(w, http.StatusOK, summary)
}

// HandleStandardLibraryReleaseByID handles GET /api/manufacturing-libraries/standard/releases/{releaseId}.
func (s *Server) HandleStandardLibraryReleaseByID(w http.ResponseWriter, r *http.Request) {
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

	rel, err := s.Store.GetReleaseByID(r.Context(), relUUID)
	if err != nil {
		if errors.Is(err, storage.ErrLibraryReleaseNotFound) {
			respondWithError(w, http.StatusNotFound, "library release not found")
			return
		}
		respondWithInternalError(w, err, "get library release by id")
		return
	}

	// Verify the release belongs to Granete Standard (since this is under the /standard/ route)
	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)
	if rel.LibraryID != standardID {
		respondWithError(w, http.StatusNotFound, "library release not found in Granete Standard")
		return
	}

	detail := openapi.LibraryReleaseDetail{
		ID:               rel.ID.String(),
		LibraryId:        rel.LibraryID.String(),
		Version:          rel.Version,
		Status:           string(rel.Status),
		SchemaVersion:    int64(rel.SchemaVersion),
		MinPluginVersion: rel.MinPluginVersion,
		BaseReleaseId:    nil,
		ManifestHash:     rel.ManifestHash,
		Changelog:        rel.Changelog,
		ResourceRefs:     []openapi.LibraryResourceRef{},
		CreatedAt:        rel.CreatedAt.Format(time.RFC3339),
		UpdatedAt:        rel.UpdatedAt.Format(time.RFC3339),
	}
	if rel.BaseReleaseID != nil {
		bStr := rel.BaseReleaseID.String()
		detail.BaseReleaseId = &bStr
	}
	if rel.PublishedAt != nil {
		tStr := rel.PublishedAt.Format(time.RFC3339)
		detail.PublishedAt = &tStr
	}

	respondWithJSON(w, http.StatusOK, detail)
}
