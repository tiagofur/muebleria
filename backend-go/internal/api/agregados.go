package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
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

// --- #1369 slice 1: recipe change simulation (dry-run) ---

// recipeChangeSimulationRequest is the wire body of the dry-run. The candidate
// is the complete recipe the user intends to save (same shape as the PUT body);
// params default to the agregado's own external dims; variantSelections pin an
// explicit nominal per variant set (narrowing the set — never a clamp).
type recipeChangeSimulationRequest struct {
	Candidate         domain.Agregado                  `json:"candidate"`
	Params            *engine.AssemblyResolutionParams `json:"params,omitempty"`
	VariantSelections map[string]float64               `json:"variantSelections,omitempty"`
}

type recipeChangeSimulationResponse struct {
	AgregadoID string `json:"agregadoId"`
	// CurrentVersion is the If-Match the apply (PUT) must carry: a stale apply
	// after someone else saved gets 412 and the simulation must be redone.
	CurrentVersion int64                   `json:"currentVersion"`
	Diff           engine.RecipeChangeDiff `json:"diff"`
}

// HandleAgregadoRecipeSimulation — POST /api/catalog/agregados/{id}/recipe-change/simulate
//
// Resolves the persisted recipe and the candidate against the same dimensions
// and returns the classified diff. It never mutates: two identical requests
// return byte-identical bodies. The apply is the existing guarded PUT.
func (s *Server) HandleAgregadoRecipeSimulation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing agregado id")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
		return
	}
	var req recipeChangeSimulationRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}
	current, err := s.Store.GetAgregadoByID(r.Context(), id)
	if err != nil || current == nil {
		respondWithError(w, http.StatusNotFound, "agregado not found")
		return
	}

	params := engine.AssemblyResolutionParams{
		WidthMm:  float64(current.WidthMm),
		HeightMm: float64(current.HeightMm),
		DepthMm:  float64(current.DepthMm),
	}
	if req.Params != nil {
		params = *req.Params
	}
	if err := engine.ValidateAssemblyResolutionParams(params); err != nil {
		respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"code":    "RECIPE_SIMULATION_DIMENSIONS_REQUIRED",
			"message": "la simulación necesita ancho, alto y profundidad positivos (del agregado o explícitos): " + err.Error(),
		})
		return
	}

	// The candidate is a recipe for THIS agregado: identity is never taken from
	// the body.
	candidate := req.Candidate
	candidate.ID = current.ID
	candidate, err = engine.RestrictVariantSelections(candidate, req.VariantSelections)
	if err != nil {
		respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"code":    "RECIPE_CANDIDATE_INVALID",
			"message": err.Error(),
		})
		return
	}

	diff, err := engine.SimulateRecipeChange(*current, candidate, params)
	if err != nil {
		var curErr *engine.ErrCurrentRecipeUnresolvable
		var candErr *engine.ErrCandidateRecipeInvalid
		switch {
		case errors.As(err, &curErr):
			respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"code":    "CURRENT_RECIPE_UNRESOLVABLE",
				"message": err.Error(),
			})
		case errors.As(err, &candErr):
			respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"code":    "RECIPE_CANDIDATE_INVALID",
				"message": err.Error(),
			})
		default:
			respondWithInternalError(w, err, "agregado recipe simulation")
		}
		return
	}

	w.Header().Set("ETag", fmt.Sprintf(`"v%d"`, current.Version))
	respondWithJSON(w, http.StatusOK, recipeChangeSimulationResponse{
		AgregadoID:     current.ID,
		CurrentVersion: current.Version,
		Diff:           diff,
	})
}
