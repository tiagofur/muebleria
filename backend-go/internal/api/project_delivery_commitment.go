package api

import (
	"errors"
	"net/http"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// HandleCommitProjectDeliveryDate serves POST
// /api/projects/{projectId}/delivery-commitment (#1648): the committed
// delivery date is server-authored — the server validates against the locked
// project row, stamps the actor and writes column + event + audit together.
func (s *Server) HandleCommitProjectDeliveryDate(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), func(rr domain.UserRole) bool {
		return domain.RoleCanAppendProjectEvent(rr, "delivery_date_changed")
	}), "no tenés permiso para comprometer la fecha de entrega") {
		return
	}
	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "obra no encontrada", nil)
		return
	}
	var req openapi.CommitDeliveryDateRequest
	if !decodeGeneratedJSONBody(w, r, &req) {
		return
	}
	reason := ""
	if req.Reason != nil {
		reason = *req.Reason
	}
	result, err := s.Store.CommitProjectDelivery(r.Context(), storage.CommitProjectDeliveryCommand{
		ProjectID:   projectID,
		Date:        req.Date,
		Reason:      reason,
		EventID:     newProjectEventID(),
		ActorUserID: claims.UserID,
		Source:      commercialEventSource(claims.Transport),
		At:          time.Now().UTC(),
		IP:          clientIP(r),
		RequestID:   RequestIDFromContext(r.Context()),
	})
	if err != nil {
		var fieldErr *domain.DepositFieldError
		switch {
		case errors.As(err, &fieldErr):
			respondWithFieldError(w, fieldErr.Field, fieldErr.Message)
		case errors.Is(err, domain.ErrDeliveryCommitmentUnchanged):
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "La entrega ya está comprometida para esa fecha", nil)
		case errors.Is(err, domain.ErrDeliveryCommitmentClosedProject):
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "La obra está perdida o cancelada: no se compromete fecha de entrega", nil)
		default:
			respondWithCommercialCommandError(w, err, "commit project delivery date")
		}
		return
	}
	ev := result.Event
	ev.CreatedAt = ev.At
	respondWithJSON(w, http.StatusOK, openapi.DeliveryCommitmentResult{
		ProjectId:             result.ProjectID,
		CommittedDeliveryDate: result.CommittedDeliveryDate,
		PreviousDate:          result.PreviousDate,
		Event:                 toProjectLifecycleEventDTO(&ev),
	})
}
