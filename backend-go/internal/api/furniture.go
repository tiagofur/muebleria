package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// HandleFurnitureDefinitions: GET /api/furniture/definitions
// Serves the workshop's real furniture catalog to authenticated clients
// (today: the SketchUp extension). Requires the scoped organization's license
// to be active; the response is the shared furniture contract envelope
// (schemaId, revisionId, definitions, presets) projected from the same module
// rows the React app edits under /catalog/modules — there is no second
// furniture list. The deployment is single-workshop, so authentication +
// license are the ownership boundary of what the caller can see here.
func (s *Server) HandleFurnitureDefinitions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	claims, ok := r.Context().Value(UserContextKey).(*auth.Claims)
	if !ok || claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}

	u, err := s.Store.GetUserByID(r.Context(), claims.UserID)
	if err != nil || u == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}

	// The license belongs to the workshop (organization), not the user: load
	// the scoped organization and gate on its plan/expiry (ADR-0004).
	org, err := s.Store.GetOrganizationByID(r.Context(), storage.OrgFromCtx(r.Context()))
	if err != nil {
		respondWithInternalError(w, err, "load organization license")
		return
	}
	if org == nil || domain.LicenseStatusAt(org.LicensePlan, org.LicenseExpiresAt, time.Now()) != domain.LicenseStatusActive {
		// Blockers must explain how to resolve them: point the user at the
		// workshop admin instead of a bare 403.
		respondWithError(w, http.StatusForbidden,
			"la licencia del taller no está activa. Pedile al administrador del taller que la renueve (plan y vencimiento) para usar la biblioteca de Granete.")
		return
	}

	modules, err := s.Store.ListModules(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}
	categories, err := s.Store.ListCategories(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}

	// Composition context for the estimated piece counts of each definition.
	structures, err := s.Store.ListStructures(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}
	components, err := s.Store.ListComponents(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}
	agregados, err := s.Store.ListAgregados(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}
	hardware, err := s.Store.ListHardwares(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}
	materials, err := s.Store.ListMaterialBoards(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}
	optionGroups, err := s.Store.ListOptionGroups(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}
	materialCategories, err := s.Store.ListMaterialCategories(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}
	composition := domain.Catalog{
		Structures:   structures,
		Components:   components,
		Agregados:    agregados,
		Hardware:     hardware,
		Materials:    materials,
		OptionGroups: optionGroups,
	}

	catalog, err := buildWorkshopFurnitureCatalogValidated(modules, categories, materialCategories, composition)
	if err != nil {
		if definitionErr, ok := furnitureParameterDefinitionsError(err); ok {
			respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"code": "PARAMETER_DEFINITION_INVALID", "message": "furniture parameter definition is invalid", "issues": definitionErr.Issues,
			})
			return
		}
		respondWithInternalError(w, err, "project furniture catalog")
		return
	}
	catalog.RevisionID = workshopCatalogRevisionID(catalog)
	body, err := json.Marshal(catalog)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, max-age=300")
	if r.Header.Get("If-None-Match") == `"`+catalog.RevisionID+`"` {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("ETag", `"`+catalog.RevisionID+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
