package api

/**
 * Durable per-release Engineering state endpoints (#740 PR 1).
 *
 * Engineering completion is its own authority: it records that the
 * preparation of ONE exact ProductionRelease finished. It never implies
 * material authorization or physical work, and reads never write. The
 * commands are server-authoritative — actor and timestamps come from the
 * server, the exact release is resolved under the project row lock, and the
 * audit + lifecycle events land in the same transaction as the transition.
 */

import (
	"errors"
	"net/http"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// toReleaseEngineeringStateDTO maps the durable evidence row (nil = pending)
// onto the generated contract shape.
func toReleaseEngineeringStateDTO(releaseID string, state *domain.ReleaseEngineeringState) openapi.ReleaseEngineeringState {
	dto := openapi.ReleaseEngineeringState{
		ReleaseID: releaseID,
		Status:    "pending",
		Version:   0,
	}
	if state == nil {
		return dto
	}
	dto.Status = string(state.Status)
	dto.Version = int64(state.Version)
	if state.StartedBy != "" {
		startedBy := state.StartedBy
		dto.StartedBy = &startedBy
	}
	if !state.StartedAt.IsZero() {
		startedAt := state.StartedAt.UTC().Format(time.RFC3339Nano)
		dto.StartedAt = &startedAt
	}
	if state.CompletedBy != nil && *state.CompletedBy != "" {
		completedBy := *state.CompletedBy
		dto.CompletedBy = &completedBy
	}
	if state.CompletedAt != nil {
		completedAt := state.CompletedAt.UTC().Format(time.RFC3339Nano)
		dto.CompletedAt = &completedAt
	}
	return dto
}

// respondWithEngineeringError maps the command errors onto honest HTTP
// answers; unknown states fail closed.
func respondWithEngineeringError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrReleaseNotFound), errors.Is(err, domain.ErrCrossProjectRelease),
		errors.Is(err, domain.ErrDesignNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound,
			"la liberación no corresponde a esta obra", nil)
	case errors.Is(err, domain.ErrEngineeringNotStarted):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict,
			"la Ingeniería de esta liberación no fue iniciada", map[string]any{"blocker": "engineering_not_started"})
	case errors.Is(err, domain.ErrEngineeringRoutingUnavailable):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict,
			"la preparación de esta liberación no está disponible (despiece congelado sin evidencia de routing)",
			map[string]any{"blocker": "engineering_routing_unavailable"})
	case errors.Is(err, storage.ErrVersionConflict):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict,
			"el estado de Ingeniería cambió: revisalo y volvé a intentar", map[string]any{"blocker": "version_conflict"})
	case errors.Is(err, domain.ErrInvalidReleaseCommand):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "comando inválido", nil)
	default:
		respondWithProductionReleaseError(w, err)
	}
}

// HandleProjectProductionReleaseEngineering serves GET
// /api/projects/{projectId}/production-releases/{releaseId}/engineering.
// Read-only: a missing evidence row IS the honest pending answer.
func (s *Server) HandleProjectProductionReleaseEngineering(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanReleaseProduction), "no tenés permiso para ver el estado de Ingeniería de esta liberación") {
		return
	}
	projectID := r.PathValue("projectId")
	releaseID := r.PathValue("releaseId")
	if !isValidUUID(projectID) || !isValidUUID(releaseID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		return
	}
	state, err := s.Store.GetReleaseEngineeringState(r.Context(), projectID, releaseID)
	if err != nil {
		respondWithEngineeringError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, toReleaseEngineeringStateDTO(releaseID, state))
}

// HandleProjectProductionReleaseEngineeringStart serves POST
// /api/projects/{projectId}/production-releases/{releaseId}/engineering:start.
// Idempotent durable start of the engineering preparation of the exact
// release. Requires release permission (admin/gerente_produccion/ingeniero).
func (s *Server) HandleProjectProductionReleaseEngineeringStart(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanReleaseProduction), "no tenés permiso para iniciar la Ingeniería de esta liberación") {
		return
	}
	projectID := r.PathValue("projectId")
	releaseID := r.PathValue("releaseId")
	if !isValidUUID(projectID) || !isValidUUID(releaseID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		return
	}
	if r.ContentLength > 0 {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "el comando no admite cuerpo", nil)
		return
	}
	outcome, err := s.Store.StartReleaseEngineering(r.Context(), storage.StartReleaseEngineeringCommand{
		ProjectID:   projectID,
		ReleaseID:   releaseID,
		ActorUserID: actorID(claims),
		IP:          clientIP(r),
		RequestID:   RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithEngineeringError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, toReleaseEngineeringStateDTO(releaseID, &outcome.State))
}

// HandleProjectProductionReleaseEngineeringComplete serves POST
// /api/projects/{projectId}/production-releases/{releaseId}/engineering:complete.
// Final one-way completion of the engineering preparation of the exact
// release, guarded by the expected version (If-Match), a prior start and the
// frozen routing evidence. Never authorizes materials or physical work.
func (s *Server) HandleProjectProductionReleaseEngineeringComplete(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanReleaseProduction), "no tenés permiso para completar la Ingeniería de esta liberación") {
		return
	}
	projectID := r.PathValue("projectId")
	releaseID := r.PathValue("releaseId")
	if !isValidUUID(projectID) || !isValidUUID(releaseID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		return
	}
	if r.ContentLength > 0 {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "el comando no admite cuerpo", nil)
		return
	}
	expectedVersion, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	if expectedVersion < 1 {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "If-Match inválido para completar Ingeniería", nil)
		return
	}
	outcome, err := s.Store.CompleteReleaseEngineering(r.Context(), storage.CompleteReleaseEngineeringCommand{
		ProjectID:       projectID,
		ReleaseID:       releaseID,
		ActorUserID:     actorID(claims),
		ExpectedVersion: int(expectedVersion),
		IP:              clientIP(r),
		RequestID:       RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithEngineeringError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, toReleaseEngineeringStateDTO(releaseID, &outcome.State))
}
