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

// #571 / WEB-DT-4: commercial QuoteRevision lifecycle API (ADR-0003,
// digital-thread §§15–16, 25).
//
// POST /api/projects/{projectId}/quote-revisions converts the project's
// current editable commercial state into the FIRST immutable draft revision.
// The client sends no commercial payload — the server snapshots quote lines,
// their materialized physical units, authored design truth and catalog
// definitions. POST .../{quoteRevisionId}:publish and :accept are the explicit
// lifecycle commands on an exact revision; acceptance supersedes the previous
// accepted revision atomically in one server-side transaction.

// quoteRevisionCommandRouter adapts the command-oriented OpenAPI path
// /api/projects/{projectId}/quote-revisions/{quoteRevisionId}:{command} to
// net/http's ServeMux (same pattern as designRevisionCommandRouter). The
// wildcard must occupy an entire segment, so the revisionId:command segment is
// captured and split here.
func quoteRevisionCommandRouter(commands map[string]http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		segment := r.PathValue("quoteRevisionCommand")
		quoteRevisionID, command, ok := strings.Cut(segment, ":")
		if !ok || quoteRevisionID == "" || command == "" || strings.Contains(command, ":") {
			http.NotFound(w, r)
			return
		}
		handler, ok := commands[command]
		if !ok {
			http.NotFound(w, r)
			return
		}
		r.SetPathValue("quoteRevisionId", quoteRevisionID)
		handler.ServeHTTP(w, r)
	})
}

// HandleCreateInitialQuoteRevision serves POST
// /api/projects/{projectId}/quote-revisions.
func (s *Server) HandleCreateInitialQuoteRevision(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateProjects), "no tenés permiso para crear revisiones de cotización en esta obra") {
		return
	}

	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId inválido", nil)
		return
	}

	var payload openapi.CreateInitialQuoteRevisionRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "cuerpo de solicitud inválido", nil)
		return
	}
	notes := ""
	if payload.Notes != nil {
		notes = strings.TrimSpace(*payload.Notes)
	}

	result, err := s.Store.CreateInitialQuoteRevision(r.Context(), storage.CreateInitialQuoteRevisionCommand{
		ProjectID:   projectID,
		Notes:       notes,
		ActorUserID: claims.UserID,
		IP:          clientIP(r),
		RequestID:   RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithQuoteLifecycleError(w, err, "create")
		return
	}

	respondWithJSON(w, http.StatusCreated, toQuoteRevisionDTO(result.Revision))
}

// HandleQuoteRevisionPublish serves POST
// /api/projects/{projectId}/quote-revisions/{quoteRevisionId}:publish.
func (s *Server) HandleQuoteRevisionPublish(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateProjects), "no tenés permiso para publicar revisiones de cotización") {
		return
	}

	projectID := r.PathValue("projectId")
	quoteRevisionID := r.PathValue("quoteRevisionId")
	if !isValidUUID(projectID) || !isValidUUID(quoteRevisionID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId o quoteRevisionId inválido", nil)
		return
	}

	rev, err := s.Store.PublishQuoteRevision(r.Context(), storage.QuoteRevisionLifecycleCommand{
		ProjectID:       projectID,
		QuoteRevisionID: quoteRevisionID,
		ActorUserID:     claims.UserID,
		IP:              clientIP(r),
		RequestID:       RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithQuoteLifecycleError(w, err, "publish")
		return
	}
	respondWithJSON(w, http.StatusOK, toQuoteRevisionDTO(rev))
}

// HandleQuoteRevisionAccept serves POST
// /api/projects/{projectId}/quote-revisions/{quoteRevisionId}:accept.
func (s *Server) HandleQuoteRevisionAccept(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAcceptQuoteRevisions), "no tenés permiso para aceptar revisiones de cotización") {
		return
	}

	projectID := r.PathValue("projectId")
	quoteRevisionID := r.PathValue("quoteRevisionId")
	if !isValidUUID(projectID) || !isValidUUID(quoteRevisionID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId o quoteRevisionId inválido", nil)
		return
	}

	result, err := s.Store.AcceptQuoteRevision(r.Context(), storage.QuoteRevisionLifecycleCommand{
		ProjectID:       projectID,
		QuoteRevisionID: quoteRevisionID,
		ActorUserID:     claims.UserID,
		IP:              clientIP(r),
		RequestID:       RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithQuoteLifecycleError(w, err, "accept")
		return
	}
	respondWithJSON(w, http.StatusOK, toQuoteRevisionDTO(result.Revision))
}

// respondWithQuoteLifecycleError maps the storage verdicts to the API error
// taxonomy. Missing, foreign and cross-project objects share the uniform 404
// (no existence oracle); lifecycle violations are typed 409s; ownership stays
// 403. The command discriminates only the conflict copy.
func respondWithQuoteLifecycleError(w http.ResponseWriter, err error, command string) {
	switch {
	case errors.Is(err, domain.ErrInvalidRevisionID):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "revision ID inválido", nil)
	case errors.Is(err, domain.ErrDesignNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "proyecto no encontrado", nil)
	case errors.Is(err, domain.ErrQuoteRevisionNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "La revisión de cotización no existe en esta obra", nil)
	case errors.Is(err, domain.ErrFurnitureInstanceProjectNotWritable):
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeForbidden, "Sólo la organización dueña de la obra puede administrar sus cotizaciones", nil)
	case errors.Is(err, domain.ErrQuoteRevisionAccepted):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "La obra ya tiene una cotización aceptada por el flujo operacional: reabrila antes de crear la revisión comercial inicial", nil)
	case errors.Is(err, domain.ErrQuoteRevisionConflict):
		// The #393 writer rejects a baseless create once revisions exist: the
		// initial command is Q1-only by contract (requote owns Q2+).
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "Esta obra ya tiene una revisión de cotización: las revisiones siguientes se crean desde la reconciliación (requote)", nil)
	case errors.Is(err, domain.ErrQuoteRevisionInvalidTransition):
		if command == "accept" {
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "La cotización no puede aceptarse desde su estado actual: publicá el borrador primero. Una cotización aceptada o reemplazada es histórico inmutable.", nil)
		}
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "La cotización no puede publicarse desde su estado actual: sólo un borrador se publica, y lo publicado/aceptado/reemplazado es histórico inmutable.", nil)
	case errors.Is(err, domain.ErrInvalidRevisionSnapshot):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "La obra no tiene líneas de cotización para crear la revisión inicial", nil)
	default:
		respondWithInternalError(w, err, "quote revision lifecycle command")
	}
}
