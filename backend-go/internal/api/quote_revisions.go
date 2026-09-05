package api

import (
	"errors"
	"net/http"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #500 / WEB-DT-1: exact commercial context read for the Project Furniture
// matrix. The generated DTO carries the immutable per-unit items so React
// derives commercial presence from the exact selected revision — never from
// the live mutable quote or a client-side snapshot.

// HandleProjectQuoteRevisions serves GET /api/projects/{projectId}/quote-revisions.
func (s *Server) HandleProjectQuoteRevisions(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para ver las revisiones de cotización") {
		return
	}
	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId inválido", nil)
		return
	}

	details, err := s.Store.ListQuoteRevisionsByProject(r.Context(), projectID)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrQuoteRevisionNotFound):
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "proyecto no encontrado", nil)
		case errors.Is(err, domain.ErrInvalidRevisionSnapshot):
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "snapshot de revisión inválido: payload corrupto", nil)
		default:
			respondWithInternalError(w, err, "list quote revisions")
		}
		return
	}

	dtos := make([]openapi.QuoteRevisionDetail, 0, len(details))
	for _, detail := range details {
		dtos = append(dtos, toQuoteRevisionDetailDTO(detail))
	}
	respondWithJSON(w, http.StatusOK, dtos)
}

func toQuoteRevisionDetailDTO(d domain.QuoteRevisionDetail) openapi.QuoteRevisionDetail {
	items := make([]openapi.QuoteRevisionItem, 0, len(d.Items))
	for _, item := range d.Items {
		var definitionID *string
		if item.FurnitureDefinitionID != "" {
			id := item.FurnitureDefinitionID
			definitionID = &id
		}
		var definitionVersion *int64
		if item.DefinitionVersion != nil {
			version := int64(*item.DefinitionVersion)
			definitionVersion = &version
		}
		parameters := item.Parameters
		if parameters == nil {
			parameters = map[string]any{}
		}
		materialChoices := item.MaterialChoices
		if materialChoices == nil {
			materialChoices = map[string]string{}
		}
		items = append(items, openapi.QuoteRevisionItem{
			FurnitureInstanceId:   item.FurnitureInstanceID,
			FurnitureDefinitionId: definitionID,
			DefinitionVersion:     definitionVersion,
			Parameters:            parameters,
			MaterialChoices:       materialChoices,
			LifecycleStatus:       openapi.FurnitureInstanceLifecycleStatus(item.LifecycleStatus),
		})
	}

	var notes *string
	if d.Notes != "" {
		value := d.Notes
		notes = &value
	}
	var createdBy *string
	if d.CreatedBy != "" {
		created := d.CreatedBy
		createdBy = &created
	}
	var baseRevisionID *string
	if d.BaseQuoteRevisionID != "" {
		base := d.BaseQuoteRevisionID
		baseRevisionID = &base
	}
	var sourceDesignRevisionID *string
	if d.SourceDesignRevisionID != "" {
		source := d.SourceDesignRevisionID
		sourceDesignRevisionID = &source
	}

	return openapi.QuoteRevisionDetail{
		ID:                     d.ID,
		ProjectId:              d.ProjectID,
		RevisionNumber:         int64(d.RevisionNumber),
		Status:                 openapi.QuoteRevisionStatus(d.Status),
		SourceType:             openapi.QuoteRevisionSourceType(d.SourceType),
		BaseQuoteRevisionId:    baseRevisionID,
		SourceDesignRevisionId: sourceDesignRevisionID,
		Notes:                  notes,
		CreatedBy:              createdBy,
		CreatedAt:              d.CreatedAt.UTC().Format(time.RFC3339Nano),
		Items:                  items,
	}
}
