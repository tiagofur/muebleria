package api

import (
	"net/http"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// --- CATALOG / MATERIAL CATEGORIES (F142: subgrupos de tableros) ---
//
// Mirror of the ambient categories handlers (F086): GET for any authenticated
// user, mutations gated by RoleCanMutateCatalog (admin/ingeniero), storage
// error strings mapped to 400/404/409.

func (s *Server) HandleMaterialCategories(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListMaterialCategories(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "material categories list")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
			return
		}
		var c domain.MaterialCategory
		if !decodeJSONBody(w, r, &c) {
			return
		}
		err := s.Store.CreateMaterialCategory(r.Context(), &c)
		if err != nil {
			if strings.Contains(err.Error(), "invalid category placement") ||
				strings.Contains(err.Error(), "cannot exceed") ||
				strings.Contains(err.Error(), "name is required") {
				respondWithError(w, http.StatusBadRequest, err.Error())
				return
			}
			respondWithInternalError(w, err, "material category create")
			return
		}
		respondWithJSON(w, http.StatusCreated, c)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleMaterialCategoryByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing material category id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		c, err := s.Store.GetMaterialCategoryByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "material category not found")
			return
		}
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodPut:
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
			return
		}
		var c domain.MaterialCategory
		if !decodeJSONBody(w, r, &c) {
			return
		}
		err := s.Store.UpdateMaterialCategory(r.Context(), id, &c)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if strings.Contains(err.Error(), "invalid category placement") ||
				strings.Contains(err.Error(), "cannot exceed") ||
				strings.Contains(err.Error(), "name is required") ||
				strings.Contains(err.Error(), "cannot be its own") ||
				strings.Contains(err.Error(), "descendant") {
				respondWithError(w, http.StatusBadRequest, err.Error())
				return
			}
			respondWithInternalError(w, err, "material category update")
			return
		}
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodDelete:
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
			return
		}
		err := s.Store.DeleteMaterialCategory(r.Context(), id)
		if err != nil {
			if strings.Contains(err.Error(), "cannot delete category with children") {
				respondWithError(w, http.StatusConflict, err.Error())
				return
			}
			respondWithInternalError(w, err, "material category delete")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "material category deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
