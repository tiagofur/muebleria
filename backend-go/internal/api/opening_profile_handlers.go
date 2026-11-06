package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// --- OPENING PROFILES (#1130, épica #1128 / ADR-0009) ---
//
// The physical grip profile catalog (gola L/C, REACH…). Reads are any
// session member (catalog state); writes require the catalog-mutation role.
// Writes are If-Match guarded (If-Match: <version>) and the response echoes
// the stored entity — the simple-catalog family contract.

func (s *Server) HandleOpeningProfiles(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListOpeningProfiles(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "opening profiles list")
			return
		}
		for i := range list {
			list[i].WithUsage()
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tienes permiso para modificar el catálogo") {
			return
		}
		var profile domain.OpeningProfile
		if !decodeJSONBody(w, r, &profile) {
			return
		}
		if strings.TrimSpace(profile.ID) == "" {
			respondWithError(w, http.StatusBadRequest, "el id del perfil de apertura es obligatorio")
			return
		}
		if err := s.Store.CreateOpeningProfile(r.Context(), &profile); err != nil {
			if respondOpeningProfileInvalid(w, err) {
				return
			}
			respondWithInternalError(w, err, "opening profile create")
			return
		}
		profile.WithUsage()
		respondWithJSON(w, http.StatusCreated, profile)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleOpeningProfileByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if strings.TrimSpace(id) == "" {
		respondWithError(w, http.StatusBadRequest, "id requerido")
		return
	}
	switch r.Method {
	case http.MethodGet:
		profile, err := s.Store.GetOpeningProfileByID(r.Context(), id)
		if err != nil {
			if errors.Is(err, storage.ErrOpeningProfileNotFound) {
				respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "perfil de apertura inexistente", nil)
				return
			}
			respondWithInternalError(w, err, "opening profile read")
			return
		}
		profile.WithUsage()
		respondWithJSON(w, http.StatusOK, profile)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tienes permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		var profile domain.OpeningProfile
		if !decodeJSONBody(w, r, &profile) {
			return
		}
		if err := s.Store.UpdateOpeningProfile(r.Context(), id, expectedVersion, &profile); err != nil {
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión cambió; recarga y vuelve a intentar", nil)
				return
			}
			if errors.Is(err, storage.ErrOpeningProfileNotFound) {
				respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "perfil de apertura inexistente", nil)
				return
			}
			if respondOpeningProfileInvalid(w, err) {
				return
			}
			respondWithInternalError(w, err, "opening profile update")
			return
		}
		profile.WithUsage()
		respondWithJSON(w, http.StatusOK, profile)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tienes permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		if err := s.Store.DeactivateOpeningProfile(r.Context(), id, expectedVersion); err != nil {
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión cambió; recarga y vuelve a intentar", nil)
				return
			}
			if errors.Is(err, storage.ErrOpeningProfileNotFound) {
				respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "perfil de apertura inexistente", nil)
				return
			}
			respondWithInternalError(w, err, "opening profile deactivate")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]any{"deactivated": true, "id": id})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// respondOpeningProfileInvalid answers a rejected write with 422 and the
// Spanish message (#1530). It reports whether it wrote the response.
func respondOpeningProfileInvalid(w http.ResponseWriter, err error) bool {
	if !domain.IsOpeningProfileValidationError(err) {
		return false
	}
	respondWithAPIError(w, http.StatusUnprocessableEntity, openapi.ApiErrorCodeBadRequest, err.Error(), nil)
	return true
}

// HandleOpeningProfileSuggestions serves the manufacturer and owner defaults
// a new gola profile starts from (#1530). profile_depth_mm, when given, fills
// the Italian bevel size (depth − 2).
func (s *Server) HandleOpeningProfileSuggestions(w http.ResponseWriter, r *http.Request) {
	var depth *float64
	if raw := strings.TrimSpace(r.URL.Query().Get("profile_depth_mm")); raw != "" {
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil || value <= 0 {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "la profundidad del perfil debe ser un número mayor a 0", nil)
			return
		}
		depth = &value
	}
	respondWithJSON(w, http.StatusOK, domain.GolaProfileSuggestions(depth))
}
