package api

import (
	"net/http"
	"strings"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// HandleDesignEffectiveMaterials serves POST for
// /api/designs/{designId}/effective-materials: definition-aware composition of
// effective material choices and lineage modes (override || design default || definition fallback)
// for a furniture definition in the context of the design working copy (#784 / R4).
func (s *Server) HandleDesignEffectiveMaterials(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para ver el diseño") {
		return
	}
	designID := r.PathValue("designId")
	if !isValidUUID(designID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designId inválido", nil)
		return
	}

	var req openapi.ComposeDesignEffectiveMaterialsRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}

	defID := strings.TrimSpace(req.FurnitureDefinitionId)
	if defID == "" {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "furnitureDefinitionId requerido", nil)
		return
	}

	// 1. Load the design working copy to obtain its AuthoringDefaults.
	wc, err := s.Store.GetDesignWorkingCopy(r.Context(), designID)
	if err != nil {
		respondWithDesignError(w, err)
		return
	}

	// 2. Load the workshop catalog to resolve the furniture definition and its curated material roles.
	snapshot, err := s.loadWorkshopCatalogOnce(r)
	if err != nil {
		respondWithInternalError(w, err, "load workshop catalog")
		return
	}

	var def *workshopFurnitureDefinition
	if d, ok := snapshot.Projection.Definitions[defID]; ok {
		def = &d
	} else {
		for _, d := range snapshot.Projection.Definitions {
			if strings.EqualFold(d.Code, defID) {
				copyDef := d
				def = &copyDef
				break
			}
		}
	}

	if def == nil {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "definición de mueble no encontrada", nil)
		return
	}

	// 3. Convert definition's material roles to domain specs.
	roleSpecs := make([]domain.DefinitionRoleOptionSpec, 0, len(def.MaterialRoles))
	for _, mr := range def.MaterialRoles {
		roleSpecs = append(roleSpecs, domain.DefinitionRoleOptionSpec{
			Role:      mr.Role,
			Label:     mr.Label,
			OptionIDs: mr.OptionIDs,
		})
	}

	// 4. Pure composition rule in domain.
	effective := domain.ComposeEffectiveDefinitionMaterials(
		def.FurnitureDefinitionID,
		roleSpecs,
		wc.AuthoringDefaults,
		req.MaterialChoices,
	)

	// 5. Build DTO response with openapi types.
	modes := make(map[string]openapi.DesignMaterialChoiceMode, len(effective.MaterialChoiceModes))
	for k, v := range effective.MaterialChoiceModes {
		modes[k] = openapi.DesignMaterialChoiceMode(v)
	}

	choices := effective.MaterialChoices
	if choices == nil {
		choices = map[string]string{}
	}

	respondWithJSON(w, http.StatusOK, openapi.DesignEffectiveMaterials{
		FurnitureDefinitionId: effective.FurnitureDefinitionID,
		MaterialChoices:       choices,
		MaterialChoiceModes:   modes,
	})
}
