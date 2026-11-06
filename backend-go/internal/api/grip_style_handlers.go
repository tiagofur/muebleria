package api

// Grip styles API (#1531, ADR-0009 A2.2): the workshop's named grip recipes.
// Reads are any member; writes need the catalog-mutation role and If-Match.
// Consumed by the web settings (#1533) and the project grip (#1532).

import (
	"errors"
	"net/http"
	"strings"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func gripStyleMeta(r *http.Request) storage.GripStyleWriteMeta {
	return storage.GripStyleWriteMeta{RequestID: RequestIDFromContext(r.Context()), IP: clientIP(r)}
}

// respondGripStyleError maps the store's errors; it reports whether it wrote.
func respondGripStyleError(w http.ResponseWriter, err error) bool {
	var invalid *domain.GripStyleValidationError
	switch {
	case errors.As(err, &invalid):
		respondWithAPIError(w, http.StatusUnprocessableEntity, openapi.ApiErrorCodeBadRequest, invalid.Message, nil)
	case errors.Is(err, storage.ErrVersionConflict):
		respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión cambió; recarga y vuelve a intentar", nil)
	case errors.Is(err, storage.ErrGripStyleNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "estilo de agarre inexistente", nil)
	default:
		return false
	}
	return true
}

func (s *Server) HandleGripStyles(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListGripStyles(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "grip styles list")
			return
		}
		respondWithJSON(w, http.StatusOK, list)
	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tienes permiso para modificar el catálogo") {
			return
		}
		var style domain.GripStyle
		if !decodeJSONBody(w, r, &style) {
			return
		}
		if err := s.Store.CreateGripStyle(r.Context(), &style, gripStyleMeta(r)); err != nil {
			if respondGripStyleError(w, err) {
				return
			}
			respondWithInternalError(w, err, "grip style create")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(style.Version))
		respondWithJSON(w, http.StatusCreated, style)
	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleGripStyleByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "id requerido")
		return
	}
	switch r.Method {
	case http.MethodGet:
		style, err := s.Store.GetGripStyle(r.Context(), id)
		if err != nil {
			if respondGripStyleError(w, err) {
				return
			}
			respondWithInternalError(w, err, "grip style read")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(style.Version))
		respondWithJSON(w, http.StatusOK, style)
	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tienes permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		var style domain.GripStyle
		if !decodeJSONBody(w, r, &style) {
			return
		}
		if err := s.Store.UpdateGripStyle(r.Context(), id, expectedVersion, &style, gripStyleMeta(r)); err != nil {
			if respondGripStyleError(w, err) {
				return
			}
			respondWithInternalError(w, err, "grip style update")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(style.Version))
		respondWithJSON(w, http.StatusOK, style)
	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tienes permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		if err := s.Store.DeleteGripStyle(r.Context(), id, expectedVersion, gripStyleMeta(r)); err != nil {
			if respondGripStyleError(w, err) {
				return
			}
			respondWithInternalError(w, err, "grip style delete")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]any{"deleted": true, "id": id})
	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
