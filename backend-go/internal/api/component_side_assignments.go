package api

import (
	"errors"
	"net/http"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Component side assignment surface (#915 backend): declare which hardware
// profile applies to one canonical board face of a component definition.
// Reads are authenticated; writes require catalog-mutation permission. The
// side vocabulary and reference integrity are enforced server-side — React
// never computes assignments (#915 "no se generan perforaciones desde
// React", no geometric interpretation of sides).

type componentSideAssignmentBody struct {
	Side      string `json:"side"`
	ProfileID string `json:"profileId"`
}

func (s *Server) HandleComponentSideAssignments(w http.ResponseWriter, r *http.Request) {
	componentID := r.PathValue("id")
	switch r.Method {
	case http.MethodGet:
		assignments, err := s.Store.ListComponentSideAssignments(r.Context(), componentID)
		if err != nil {
			respondWithInternalError(w, err, "list component side assignments")
			return
		}
		respondWithJSON(w, http.StatusOK, assignments)
	case http.MethodPut:
		claims := claimsFromRequest(r)
		if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateCatalog), "sólo roles con permiso de catálogo pueden asignar perfiles por lado") {
			return
		}
		var body componentSideAssignmentBody
		if !decodeGeneratedJSONBody(w, r, &body) {
			return
		}
		assignment := &domain.ComponentSideAssignment{
			ComponentID: componentID,
			Side:        body.Side,
			ProfileID:   body.ProfileID,
		}
		if issues := assignment.Validate(); len(issues) > 0 {
			respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"code": "HARDWARE_PROFILE_INVALID", "message": "component side assignment is invalid", "issues": issues,
			})
			return
		}
		if err := s.Store.SetComponentSideAssignment(r.Context(), assignment); err != nil {
			if errors.Is(err, storage.ErrAssignmentReferenceInvalid) {
				respondWithAPIError(w, http.StatusUnprocessableEntity, openapi.ApiErrorCodeBadRequest, err.Error(), nil)
				return
			}
			respondWithInternalError(w, err, "set component side assignment")
			return
		}
		respondWithJSON(w, http.StatusOK, assignment)
	case http.MethodDelete:
		claims := claimsFromRequest(r)
		if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateCatalog), "sólo roles con permiso de catálogo pueden quitar asignaciones por lado") {
			return
		}
		side := r.PathValue("side")
		if side == "" {
			respondWithError(w, http.StatusBadRequest, "missing side")
			return
		}
		if err := s.Store.RemoveComponentSideAssignment(r.Context(), componentID, side); err != nil {
			if err.Error() == "component side assignment not found" {
				respondWithError(w, http.StatusNotFound, "component side assignment not found")
				return
			}
			respondWithInternalError(w, err, "remove component side assignment")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"status": "removed"})
	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
