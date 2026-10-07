package api

import (
	"net/http"
	"strings"

	"errors"
	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// --- CATALOG / AGREGADOS (reusable sub-assemblies) ---

func (s *Server) HandleAgregados(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListAgregados(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "agregados list")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var a domain.Agregado
		if !decodeJSONBody(w, r, &a) {
			return
		}
		a.Active = true
		if err := s.Store.CreateAgregado(r.Context(), &a); err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "agregado create")
			return
		}
		respondWithJSON(w, http.StatusCreated, a)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleAgregadoByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing agregado id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		a, err := s.Store.GetAgregadoByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "agregado not found")
			return
		}
		respondWithJSON(w, http.StatusOK, a)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		var a domain.Agregado
		if !decodeJSONBody(w, r, &a) {
			return
		}
		// #1168: the catalog update and its audit revision commit in ONE
		// transaction — every persisted change leaves a revision behind and
		// current_revision_id pointing at it.
		var createdBy *string
		if claims := claimsFromRequest(r); claims != nil && claims.UserID != "" {
			createdBy = &claims.UserID
		}
		if err := s.Store.UpdateAgregadoWithRevision(r.Context(), id, expectedVersion, &a, createdBy); err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión cambió; recargá y reintentá", nil)
				return
			}
			if errors.Is(err, domain.ErrAgregadoRevisionConflict) {
				respondWithError(w, http.StatusConflict, err.Error())
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "agregado update")
			return
		}
		respondWithJSON(w, http.StatusOK, a)

		case http.MethodDelete:
			if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
				return
			}
			var expectedVersion int64
			if r.Header.Get("If-Match") != "" {
				v, ok := RequireIfMatch(w, r)
				if !ok {
					return
				}
				expectedVersion = v
			}
			if err := s.Store.DeleteAgregado(r.Context(), id, expectedVersion); err != nil {
				if strings.Contains(err.Error(), "not found") {
					respondWithError(w, http.StatusNotFound, err.Error())
					return
				}
				if strings.Contains(err.Error(), "in use") {
					respondWithError(w, http.StatusConflict, err.Error())
					return
				}
				if errors.Is(err, storage.ErrVersionConflict) {
					respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión del agregado cambió; recargá y reintentá", nil)
					return
				}
				respondWithInternalError(w, err, "agregado delete")
				return
			}
			respondWithJSON(w, http.StatusOK, map[string]string{"message": "agregado deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
