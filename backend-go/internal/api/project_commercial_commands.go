package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1647: deposits and commercial-status changes are server-authored commands.
// The server validates the payload, generates the event id, stamps the
// authenticated actor and writes event + commercial_status + audit in one
// transaction behind an Idempotency-Key. The generic project PUT no longer
// accepts new commercial events nor writes commercial_status.

// commercialEventSource maps the token transport to the event source.
func commercialEventSource(transport string) domain.ProjectEventSource {
	switch transport {
	case "web":
		return domain.ProjectEventSourceWeb
	case "mobile":
		return domain.ProjectEventSourceMobile
	case "sketchup":
		return domain.ProjectEventSourceDesktop
	default:
		return domain.ProjectEventSourceAPI
	}
}

func respondWithFieldError(w http.ResponseWriter, field, message string) {
	respondWithJSON(w, http.StatusBadRequest, openapi.ApiError{
		Code: openapi.ApiErrorCodeBadRequest, Message: message,
		FieldErrors: map[string]string{field: message}, RequestId: requestIDFromWriter(w),
		Details: map[string]any{},
	})
}

func toProjectLifecycleEventDTO(ev *domain.ProjectEvent) openapi.ProjectLifecycleEvent {
	out := openapi.ProjectLifecycleEvent{
		ID:        ev.ID,
		ProjectId: ev.ProjectID,
		Type:      ev.Type,
		At:        ev.At.UTC().Format(time.RFC3339Nano),
		Source:    string(ev.Source),
	}
	if ev.ByUserID != nil {
		out.ByUserId = *ev.ByUserID
	}
	if ev.Note != "" {
		note := ev.Note
		out.Note = &note
	}
	if len(ev.Payload) > 0 {
		var payload map[string]any
		if err := json.Unmarshal(ev.Payload, &payload); err == nil {
			out.Payload = payload
		}
	}
	return out
}

func respondWithCommercialCommandError(w http.ResponseWriter, err error, op string) {
	if errors.Is(err, storage.ErrProjectCommercialTargetNotFound) {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "obra no encontrada", nil)
		return
	}
	respondWithInternalError(w, err, op)
}

// HandleRecordProjectDeposit serves POST /api/projects/{projectId}/deposits.
func (s *Server) HandleRecordProjectDeposit(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), func(rr domain.UserRole) bool {
		return domain.RoleCanAppendProjectEvent(rr, "deposit_received")
	}), "no tenés permiso para registrar anticipos") {
		return
	}
	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "obra no encontrada", nil)
		return
	}
	var req openapi.RecordProjectDepositRequest
	if !decodeGeneratedJSONBody(w, r, &req) {
		return
	}
	in := domain.DepositPayloadInput{Amount: req.Amount, Currency: req.Currency}
	if req.PaymentMethod != nil {
		in.PaymentMethod = string(*req.PaymentMethod)
	}
	if req.Reference != nil {
		in.Reference = *req.Reference
	}
	if req.Note != nil {
		in.Note = *req.Note
	}
	payload, err := domain.ValidateDepositPayload(in)
	if err != nil {
		var fieldErr *domain.DepositFieldError
		if errors.As(err, &fieldErr) {
			respondWithFieldError(w, fieldErr.Field, fieldErr.Message)
			return
		}
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, err.Error(), nil)
		return
	}
	now := time.Now().UTC()
	at := now
	if req.ReceivedAt != nil {
		parsed, perr := time.Parse(time.RFC3339Nano, *req.ReceivedAt)
		if perr != nil {
			respondWithFieldError(w, "receivedAt", "fecha del anticipo inválida")
			return
		}
		if verr := domain.ValidateDepositReceivedAt(parsed, now); verr != nil {
			var fieldErr *domain.DepositFieldError
			errors.As(verr, &fieldErr)
			respondWithFieldError(w, fieldErr.Field, fieldErr.Message)
			return
		}
		at = parsed.UTC()
	}

	body := map[string]any{"amount": payload.Amount, "currency": payload.Currency}
	if payload.PaymentMethod != "" {
		body["paymentMethod"] = payload.PaymentMethod
	}
	if payload.Reference != "" {
		body["reference"] = payload.Reference
	}
	raw, err := json.Marshal(body)
	if err != nil {
		respondWithInternalError(w, err, "deposit payload")
		return
	}
	actor := claims.UserID
	stored, err := s.Store.RecordProjectCommercialEvent(r.Context(), storage.ProjectCommercialEventCommand{
		Event: domain.ProjectEvent{
			ID:        newProjectEventID(),
			ProjectID: projectID,
			Type:      "deposit_received",
			At:        at,
			ByUserID:  &actor,
			Source:    commercialEventSource(claims.Transport),
			Note:      payload.Note,
			Payload:   raw,
			CreatedAt: now,
		},
		AuditEventType: "project_deposit_recorded",
		IP:             clientIP(r),
		RequestID:      RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithCommercialCommandError(w, err, "record project deposit")
		return
	}
	respondWithJSON(w, http.StatusCreated, toProjectLifecycleEventDTO(stored))
}

// HandleSetProjectCommercialStatus serves POST /api/projects/{projectId}/commercial-status.
func (s *Server) HandleSetProjectCommercialStatus(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "obra no encontrada", nil)
		return
	}
	var req openapi.SetProjectCommercialStatusRequest
	if !decodeGeneratedJSONBody(w, r, &req) {
		return
	}
	status := domain.CommercialStatus(req.Status)
	eventType, ok := domain.CommercialStatusEventType(status)
	if !ok {
		respondWithFieldError(w, "status", "estado comercial desconocido")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), func(rr domain.UserRole) bool {
		return domain.RoleCanAppendProjectEvent(rr, eventType)
	}), "no tenés permiso para cambiar el estado comercial") {
		return
	}
	note := ""
	if req.Note != nil {
		note = *req.Note
	}
	if len([]rune(note)) > domain.DepositMaxNoteLen {
		respondWithFieldError(w, "note", "la nota admite hasta 500 caracteres")
		return
	}
	raw, err := json.Marshal(map[string]any{"commercialStatus": string(status)})
	if err != nil {
		respondWithInternalError(w, err, "commercial status payload")
		return
	}
	now := time.Now().UTC()
	actor := claims.UserID
	stored, err := s.Store.RecordProjectCommercialEvent(r.Context(), storage.ProjectCommercialEventCommand{
		Event: domain.ProjectEvent{
			ID:        newProjectEventID(),
			ProjectID: projectID,
			Type:      eventType,
			At:        now,
			ByUserID:  &actor,
			Source:    commercialEventSource(claims.Transport),
			Note:      note,
			Payload:   raw,
			CreatedAt: now,
		},
		CommercialStatus: &status,
		AuditEventType:   "project_commercial_status_changed",
		IP:               clientIP(r),
		RequestID:        RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithCommercialCommandError(w, err, "set project commercial status")
		return
	}
	respondWithJSON(w, http.StatusOK, openapi.SetProjectCommercialStatusResponse{
		CommercialStatus: openapi.ProjectCommercialStatus(status),
		Event:            toProjectLifecycleEventDTO(stored),
	})
}
