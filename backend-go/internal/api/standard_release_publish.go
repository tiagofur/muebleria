package api

import (
	"errors"
	"net/http"

	"github.com/google/uuid"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Standard release publish surface (#955 / the #918 WU3 that stayed
// pending): Granete platform staff compiles and atomically publishes the
// Standard library — the only path that ever writes library releases.
// Tenants can never reach these handlers: the gate is the platform-admin
// claim, not a catalog/membership role.

type createStandardReleaseBody struct {
	Version   string  `json:"version"`
	Changelog *string `json:"changelog"`
}

// HandleCreateStandardLibraryRelease answers POST /api/manufacturing-libraries/standard/releases
// — create a new DRAFT release (version + optional changelog). Publishing
// is a separate deliberate step.
func (s *Server) HandleCreateStandardLibraryRelease(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	claims := claimsFromRequest(r)
	if claims == nil || !claims.PlatformAdmin {
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeForbidden, "sólo el equipo de plataforma Granete puede gestionar releases Standard", nil)
		return
	}
	var body createStandardReleaseBody
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	if body.Version == "" {
		respondWithError(w, http.StatusBadRequest, "version es obligatoria")
		return
	}
	release, err := s.Store.CreateDraftRelease(r.Context(), storage.CreateDraftReleaseParams{
		LibraryID:     uuid.MustParse(domain.GraneteStandardLibraryID),
		Version:       body.Version,
		SchemaVersion: domain.LibraryManifestSchemaVersion,
		Changelog:     body.Changelog,
	})
	if err != nil {
		respondWithInternalError(w, err, "create standard release draft")
		return
	}
	respondWithJSON(w, http.StatusCreated, mapLibraryReleaseToSummary(release))
}

// HandlePublishStandardLibraryRelease answers POST /api/manufacturing-libraries/standard/releases/{releaseId}/publish
// — compile (active hardware + active #912-valid profiles) and atomically
// publish. Fail-closed: an invalid profile rejects the compilation; the
// previous current release stays untouched on any error.
func (s *Server) HandlePublishStandardLibraryRelease(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	claims := claimsFromRequest(r)
	if claims == nil || !claims.PlatformAdmin {
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeForbidden, "sólo el equipo de plataforma Granete puede publicar releases Standard", nil)
		return
	}
	releaseID, err := uuid.Parse(r.PathValue("releaseId"))
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid release id")
		return
	}
	publishedBy, err := uuid.Parse(claims.UserID)
	if err != nil {
		respondWithError(w, http.StatusUnauthorized, "invalid user id")
		return
	}
	result, err := application.PublishStandardRelease(r.Context(), s.Store, releaseID, publishedBy)
	if err != nil {
		if errors.Is(err, application.ErrReleaseNotDraft) {
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "el release no está en draft (publicar es inmutable: creá un draft nuevo)", nil)
			return
		}
		if errors.Is(err, storage.ErrLibraryReleaseNotFound) {
			respondWithError(w, http.StatusNotFound, "release not found")
			return
		}
		if errors.Is(err, application.ErrNoHardwareProfileResource) {
			respondWithAPIError(w, http.StatusUnprocessableEntity, openapi.ApiErrorCodeBadRequest, "no hay perfiles activos para compilar: creá al menos un perfil de herrajes válido", nil)
			return
		}
		// Compilation fail-closed (invalid profile body) is a structured 422.
		respondWithAPIError(w, http.StatusUnprocessableEntity, openapi.ApiErrorCodeBadRequest, err.Error(), nil)
		return
	}
	respondWithJSON(w, http.StatusOK, map[string]any{
		"releaseId":     releaseID.String(),
		"manifestHash":  result.ManifestHash,
		"resourceCount": len(result.Manifest.Resources),
	})
}

// mapLibraryReleaseToSummary projects a domain release into the OpenAPI
// LibraryReleaseSummary shape served by the catalog endpoint.
func mapLibraryReleaseToSummary(release *domain.LibraryRelease) openapi.LibraryReleaseSummary {
	createdAt := release.CreatedAt.UTC().Format("2006-01-02T15:04:05Z")
	return openapi.LibraryReleaseSummary{
		ID:            release.ID.String(),
		LibraryId:     release.LibraryID.String(),
		Version:       release.Version,
		Status:        string(release.Status),
		SchemaVersion: int64(release.SchemaVersion),
		ManifestHash:  release.ManifestHash,
		Changelog:     release.Changelog,
		CreatedAt:     createdAt,
		UpdatedAt:     createdAt,
	}
}
