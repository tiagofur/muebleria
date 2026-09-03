package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #386 / DT-2: QuoteLine ↔ FurnitureInstance API (ADR-0003, digital-thread
// §6). The list endpoint answers "which physical units does this quote line
// represent"; the :materialize command converges those units to the line's
// commercial quantity. The command carries no client identity inputs —
// FurnitureInstance identity stays server/database-authoritative (I2), and
// accepted quotes never change materialization in place (I3).

// quoteLineCommandRouter adapts the command-oriented OpenAPI path
// /api/projects/{projectId}/quote-lines/{quoteLineId}:{command} to net/http's
// ServeMux (same pattern as furnitureInstanceCommandRouter).
func quoteLineCommandRouter(commands map[string]http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		segment := r.PathValue("quoteLineCommand")
		quoteLineID, command, ok := strings.Cut(segment, ":")
		if !ok || quoteLineID == "" || command == "" || strings.Contains(command, ":") {
			http.NotFound(w, r)
			return
		}
		handler, ok := commands[command]
		if !ok {
			http.NotFound(w, r)
			return
		}
		r.SetPathValue("quoteLineId", quoteLineID)
		handler.ServeHTTP(w, r)
	})
}

func toQuoteLineFurnitureInstanceDTO(link domain.QuoteLineFurnitureInstance) openapi.QuoteLineFurnitureInstance {
	return openapi.QuoteLineFurnitureInstance{
		ID:                  link.ID,
		ProjectID:           link.ProjectID,
		QuoteLineID:         link.QuoteLineID,
		FurnitureInstanceID: link.FurnitureInstanceID,
		FurnitureInstance:   toFurnitureInstanceDTO(link.FurnitureInstance),
		CreatedAt:           link.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func respondWithQuoteLineFurnitureError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storage.ErrQuoteLineNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "La línea de cotización no existe en esta obra", nil)
	case errors.Is(err, domain.ErrFurnitureInstanceProjectNotWritable):
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeForbidden, "Sólo la organización dueña de la obra puede administrar sus muebles", nil)
	case errors.Is(err, domain.ErrQuoteRevisionAccepted):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "La cotización ya fue aceptada: su materialización es inmutable y los cambios requieren una nueva revisión", nil)
	case errors.Is(err, domain.ErrFurnitureInstanceDurableHistory):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "El mueble ya tiene historia asociada: su identidad se conserva y no se recicla", nil)
	case errors.Is(err, domain.ErrQuoteLineStillMaterialized):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "La línea de cotización todavía representa muebles físicos: retirá su materialización antes de eliminarla", nil)
	case errors.Is(err, storage.ErrFurnitureDefinitionNotFound):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "La definición de mueble no existe en tu catálogo", nil)
	case errors.Is(err, storage.ErrVersionConflict):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeVersionConflict, "El mueble cambió; actualizá e intentá de nuevo", nil)
	default:
		respondWithInternalError(w, err, "quote line furniture command")
	}
}

// HandleQuoteLineFurnitureInstances serves GET
// /api/projects/{projectId}/quote-lines/{quoteLineId}/furniture-instances.
func (s *Server) HandleQuoteLineFurnitureInstances(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para ver la cotización de esta obra") {
		return
	}
	projectID := r.PathValue("projectId")
	quoteLineID := r.PathValue("quoteLineId")
	if !isValidUUID(projectID) || !isValidUUID(quoteLineID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId o quoteLineId inválido", nil)
		return
	}
	links, err := s.Store.ListQuoteLineFurnitureInstances(r.Context(), projectID, quoteLineID)
	if err != nil {
		respondWithQuoteLineFurnitureError(w, err)
		return
	}
	dtos := make([]openapi.QuoteLineFurnitureInstance, 0, len(links))
	for _, link := range links {
		dtos = append(dtos, toQuoteLineFurnitureInstanceDTO(link))
	}
	respondWithJSON(w, http.StatusOK, dtos)
}

// HandleQuoteLineMaterialize serves POST
// /api/projects/{projectId}/quote-lines/{quoteLineId}:materialize — the
// idempotent convergence command (quantity → physical identities). No request
// body: identities are allocated server-side, never proposed by the client.
func (s *Server) HandleQuoteLineMaterialize(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateProjects), "no tenés permiso para materializar los muebles de la cotización") {
		return
	}
	projectID := r.PathValue("projectId")
	quoteLineID := r.PathValue("quoteLineId")
	if !isValidUUID(projectID) || !isValidUUID(quoteLineID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId o quoteLineId inválido", nil)
		return
	}
	result, err := s.Store.MaterializeQuoteLine(r.Context(), storage.MaterializeQuoteLineCommand{
		ProjectID:   projectID,
		QuoteLineID: quoteLineID,
		ActorUserID: claims.UserID,
		IP:          clientIP(r),
		RequestID:   RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithQuoteLineFurnitureError(w, err)
		return
	}
	dtos := make([]openapi.QuoteLineFurnitureInstance, 0, len(result.Instances))
	for _, link := range result.Instances {
		dtos = append(dtos, toQuoteLineFurnitureInstanceDTO(link))
	}
	respondWithJSON(w, http.StatusOK, openapi.MaterializeQuoteLineFurniture{
		ProjectID:                     result.ProjectID,
		QuoteLineID:                   result.QuoteLineID,
		Quantity:                      int64(result.Quantity),
		Instances:                     dtos,
		CreatedFurnitureInstanceIds:   result.CreatedInstanceIDs,
		CancelledFurnitureInstanceIds: result.CancelledInstanceIDs,
		UnlinkedFurnitureInstanceIds:  result.UnlinkedInstanceIDs,
	})
}
