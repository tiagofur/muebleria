package api

import (
	"errors"
	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"net/http"
	"strings"
)

// // Contrato: biblioteca paramétrica — módulos plantilla, estructuras (F049),
// // categorías (F025) y componentes (F050). Consumidos por routes_catalog.go.
// --- MODULES / TEMPLATES ---

func (s *Server) HandleModules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		catalog, err := s.Store.GetFullCatalog(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, catalog.Modules)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar muebles plantilla") {
			return
		}
		var m domain.Module
		if !decodeJSONBody(w, r, &m) {
			return
		}
		err := s.Store.CreateModule(r.Context(), &m)
		if err != nil {
			var definitionsErr *domain.FurnitureParameterDefinitionsError
			if errors.As(err, &definitionsErr) {
				respondWithParameterDefinitionIssues(w, definitionsErr.Issues)
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(m.Version))
		respondWithJSON(w, http.StatusCreated, m)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleModuleByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		m, err := s.Store.GetModuleByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "module not found")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(m.Version))
		respondWithJSON(w, http.StatusOK, m)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar muebles plantilla") {
			return
		}
		// Existence first: PUT of a module the server does not know must stay
		// a 404 so clients can fall back to POST create; the If-Match
		// precondition only governs writes to a row that exists.
		cur, err := s.Store.GetModuleByID(r.Context(), id)
		if err != nil || cur == nil {
			respondWithError(w, http.StatusNotFound, "module not found")
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		var m domain.Module
		if !decodeJSONBody(w, r, &m) {
			return
		}
		// cur doubles as the media-cleanup snapshot for the replaced file.
		prevImage := cur.ImageURL
		err = s.Store.UpdateModule(r.Context(), id, expectedVersion, &m)
		if err != nil {
			var definitionsErr *domain.FurnitureParameterDefinitionsError
			if errors.As(err, &definitionsErr) {
				respondWithParameterDefinitionIssues(w, definitionsErr.Issues)
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict,
					"El mueble cambió en otra sesión. Recargá el catálogo y volvé a intentar con la versión actual.", nil)
				return
			}
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		if prevImage != m.ImageURL {
			deleteMediaFileByURL(r.Context(), s.MediaDir, prevImage)
		}
		w.Header().Set("ETag", FormatVersionETag(m.Version))
		respondWithJSON(w, http.StatusOK, m)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar muebles plantilla") {
			return
		}
		// Physical delete: capture the image URL before deleting the row, then
		// remove the file so we don't accumulate orphaned media on disk.
		prevImage := ""
		if cur, err := s.Store.GetModuleByID(r.Context(), id); err == nil && cur != nil {
			prevImage = cur.ImageURL
		}
		err := s.Store.DeleteModule(r.Context(), id)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if strings.Contains(err.Error(), "in use") {
				respondWithError(w, http.StatusConflict, err.Error())
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		deleteMediaFileByURL(r.Context(), s.MediaDir, prevImage)
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "module deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- STRUCTURES / CUERPOS (F049 / #99) ---

func (s *Server) HandleStructures(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListStructures(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar estructuras") {
			return
		}
		var st domain.Structure
		if !decodeJSONBody(w, r, &st) {
			return
		}
		err := s.Store.CreateStructure(r.Context(), &st)
		if err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, st)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleStructureByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		st, err := s.Store.GetStructureByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "structure not found")
			return
		}
		respondWithJSON(w, http.StatusOK, st)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar estructuras") {
			return
		}
		var st domain.Structure
		if !decodeJSONBody(w, r, &st) {
			return
		}
		err := s.Store.UpdateStructure(r.Context(), id, &st)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, st)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar estructuras") {
			return
		}
		err := s.Store.DeleteStructure(r.Context(), id)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "structure deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- MODULE CATEGORIES (F025) ---

func (s *Server) HandleCategories(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListCategories(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var c domain.ModuleCategory
		if !decodeJSONBody(w, r, &c) {
			return
		}
		err := s.Store.CreateCategory(r.Context(), &c)
		if err != nil {
			if strings.Contains(err.Error(), "invalid category placement") ||
				strings.Contains(err.Error(), "cannot exceed") ||
				strings.Contains(err.Error(), "name is required") {
				respondWithError(w, http.StatusBadRequest, err.Error())
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, c)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleCategoryByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		c, err := s.Store.GetCategoryByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "category not found")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(c.Version))
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		var c domain.ModuleCategory
		if !decodeJSONBody(w, r, &c) {
			return
		}
		err := s.Store.UpdateCategory(r.Context(), id, expectedVersion, &c)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión cambió; recargá y reintentá", nil)
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
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		err := s.Store.DeleteCategory(r.Context(), id, expectedVersion)
		if err != nil {
			if strings.Contains(err.Error(), "cannot delete category with children") {
				respondWithError(w, http.StatusBadRequest, err.Error())
				return
			}
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión cambió; recargá y reintentá", nil)
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "category deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- COMPONENTS (F050 / #101) ---

func (s *Server) HandleComponents(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListComponents(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar componentes") {
			return
		}
		var c domain.Component
		if !decodeJSONBody(w, r, &c) {
			return
		}
		// #403 / MT-2: material binding role contract — a board follows
		// exactly one material selection; ambiguous roles are surfaced at
		// authoring time instead of silently half-honored by the engine.
		if err := engine.ValidateComponent(c); err != nil {
			respondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		err := s.Store.CreateComponent(r.Context(), &c)
		if err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, c)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleComponentByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		c, err := s.Store.GetComponentByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "component not found")
			return
		}
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar componentes") {
			return
		}
		var c domain.Component
		if !decodeJSONBody(w, r, &c) {
			return
		}
		// #403 / MT-2 — same authoring-time contract check as POST.
		if err := engine.ValidateComponent(c); err != nil {
			respondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		err := s.Store.UpdateComponent(r.Context(), id, &c)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar componentes") {
			return
		}
		err := s.Store.DeleteComponent(r.Context(), id)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "component deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
