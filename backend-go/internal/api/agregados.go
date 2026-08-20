package api

import (
	"net/http"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
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
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
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
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
			return
		}
		var a domain.Agregado
		if !decodeJSONBody(w, r, &a) {
			return
		}
		if err := s.Store.UpdateAgregado(r.Context(), id, &a); err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
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
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
			return
		}
		if err := s.Store.DeleteAgregado(r.Context(), id); err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if strings.Contains(err.Error(), "in use") {
				respondWithError(w, http.StatusConflict, err.Error())
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
