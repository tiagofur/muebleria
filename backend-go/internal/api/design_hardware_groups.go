package api

import (
	"net/http"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1252: consumed hardware option groups for the SketchUp Design Inspector.
// Read-only projection — discovery of por-grupo demand lives server-side so
// the plugin and the web never re-derive it (single authority, one rule).

func toConsumedHardwareOptionGroupDTO(group storage.ConsumedHardwareOptionGroup) openapi.ConsumedHardwareOptionGroup {
	dto := openapi.ConsumedHardwareOptionGroup{
		Code:       group.Code,
		Name:       group.Name,
		OptionIds:  group.OptionIDs,
		ConsumedBy: int64(group.ConsumedBy),
	}
	if group.ChosenHardwareID != "" {
		dto.ChosenHardwareID = &group.ChosenHardwareID
	}
	return dto
}

func toDesignConsumedHardwareOptionGroupsDTO(groups storage.DesignConsumedHardwareOptionGroups) openapi.DesignConsumedHardwareOptionGroups {
	dto := openapi.DesignConsumedHardwareOptionGroups{
		DesignID:  groups.DesignID,
		ProjectID: groups.ProjectID,
		Scope:     groups.Scope,
		Groups:    make([]openapi.ConsumedHardwareOptionGroup, 0, len(groups.Groups)),
	}
	for _, group := range groups.Groups {
		dto.Groups = append(dto.Groups, toConsumedHardwareOptionGroupDTO(group))
	}
	return dto
}

// HandleDesignHardwareOptionGroups serves GET for
// /api/designs/{designId}/hardware-option-groups.
func (s *Server) HandleDesignHardwareOptionGroups(w http.ResponseWriter, r *http.Request) {
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
	groups, err := s.Store.GetDesignConsumedHardwareOptionGroups(r.Context(), designID)
	if err != nil {
		respondWithDesignError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, toDesignConsumedHardwareOptionGroupsDTO(*groups))
}
