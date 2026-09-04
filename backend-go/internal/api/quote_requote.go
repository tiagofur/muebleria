package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #394 / DT-10: explicit re-quote API (ADR-0003, digital-thread §§16, 25.5).
//
// POST /api/projects/{projectId}/quote-revisions:requote creates the next
// DRAFT QuoteRevision from an exact base quote revision and an exact design
// revision. The command is explicit: reconciliation/classification never
// creates revisions by itself, and the accepted source revision is never
// rewritten. Everything (reconciliation, classification, values) is
// recomputed server-side; the client only chooses which FurnitureInstances
// incorporate design truth.

// HandleProjectQuoteRequote serves POST
// /api/projects/{projectId}/quote-revisions:requote.
func (s *Server) HandleProjectQuoteRequote(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateProjects), "no tenés permiso para crear cotizaciones en esta obra") {
		return
	}

	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId inválido", nil)
		return
	}

	var payload openapi.RequoteProjectQuoteRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "cuerpo de solicitud inválido", nil)
		return
	}

	baseQuoteRevID := strings.TrimSpace(payload.BaseQuoteRevisionId)
	designRevID := strings.TrimSpace(payload.DesignRevisionId)
	if !isValidUUID(baseQuoteRevID) || !isValidUUID(designRevID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "baseQuoteRevisionId y designRevisionId deben ser UUID válidos", nil)
		return
	}
	for _, id := range payload.IncludeFurnitureInstanceIds {
		if !isValidUUID(strings.TrimSpace(id)) {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "includeFurnitureInstanceIds debe contener UUID válidos", nil)
			return
		}
	}

	result, err := s.Store.RequoteProjectQuote(r.Context(), storage.RequoteProjectQuoteCommand{
		ProjectID:                   projectID,
		BaseQuoteRevisionID:         baseQuoteRevID,
		DesignRevisionID:            designRevID,
		IncludeFurnitureInstanceIDs: payload.IncludeFurnitureInstanceIds,
		ActorUserID:                 claims.UserID,
		IP:                          clientIP(r),
		RequestID:                   RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithQuoteRequoteError(w, err)
		return
	}

	respondWithJSON(w, http.StatusCreated, openapi.ProjectQuoteRequoteResult{
		QuoteRevision: toQuoteRevisionDTO(result.Revision),
		Impact:        toImpactSummaryDTO(result.Classification.Summary),
	})
}

func toQuoteRevisionDTO(rev *domain.QuoteRevision) openapi.QuoteRevision {
	dto := openapi.QuoteRevision{
		ID:             rev.ID,
		ProjectId:      rev.ProjectID,
		RevisionNumber: int64(rev.RevisionNumber),
		Status:         openapi.QuoteRevisionStatus(rev.Status),
		SourceType:     openapi.QuoteRevisionSourceType(rev.SourceType),
	}
	if rev.BaseQuoteRevisionID != "" {
		b := rev.BaseQuoteRevisionID
		dto.BaseQuoteRevisionId = &b
	}
	if rev.SourceDesignRevisionID != "" {
		d := rev.SourceDesignRevisionID
		dto.SourceDesignRevisionId = &d
	}
	if rev.Notes != "" {
		n := rev.Notes
		dto.Notes = &n
	}
	if rev.CreatedBy != "" {
		c := rev.CreatedBy
		dto.CreatedBy = &c
	}
	return dto
}

func respondWithQuoteRequoteError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrInvalidRevisionID):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "revision ID inválido", nil)
	case errors.Is(err, domain.ErrDesignNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "proyecto no encontrado", nil)
	case errors.Is(err, domain.ErrDesignRevisionNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "revisión de diseño no encontrada", nil)
	case errors.Is(err, domain.ErrQuoteRevisionNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "revisión comercial base no encontrada", nil)
	case errors.Is(err, domain.ErrCrossProjectReconciliation):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "cross-project requote rejected", nil)
	case errors.Is(err, domain.ErrFurnitureInstanceProjectNotWritable):
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeForbidden, "Sólo la organización dueña de la obra puede crear sus cotizaciones", nil)
	case errors.Is(err, domain.ErrRequoteBlockedByConflict):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "La reconciliación tiene conflictos: resolvelos antes de crear una nueva cotización", nil)
	case errors.Is(err, domain.ErrRequoteNoCommercialChange):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "No hay cambios comerciales que incorporen: no se crea una nueva cotización", nil)
	case errors.Is(err, domain.ErrQuoteRevisionConflict):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeVersionConflict, "La cotización base quedó desactualizada (hay una revisión más nueva): reconciliá de nuevo contra la última revisión", nil)
	case errors.Is(err, domain.ErrInvalidRevisionSnapshot):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "invalid revision snapshot: corrupt or malformed payload", nil)
	case errors.Is(err, domain.ErrRequoteInconsistentInput):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "inconsistent requote input", nil)
	default:
		respondWithInternalError(w, err, "quote requote command")
	}
}
