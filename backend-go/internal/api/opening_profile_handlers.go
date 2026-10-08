package api

import (
	"net/http"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
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
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
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
			respondWithInternalError(w, err, "opening profile create")
			return
		}
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
			respondWithInternalError(w, err, "opening profile read")
			return
		}
		respondWithJSON(w, http.StatusOK, profile)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
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
			respondWithInternalError(w, err, "opening profile update")
			return
		}
		respondWithJSON(w, http.StatusOK, profile)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		if err := s.Store.DeactivateOpeningProfile(r.Context(), id, expectedVersion); err != nil {
			respondWithInternalError(w, err, "opening profile deactivate")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]any{"deactivated": true, "id": id})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
