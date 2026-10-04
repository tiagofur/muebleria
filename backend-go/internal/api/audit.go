package api

// Contrato: escritura de auditoría de seguridad — best-effort (audit) y
// requerida (auditRequired). Consumidas por handlers que mutan estado
// sensible; el evento incluye request_id cuando el middleware lo emitió.

import (
	"context"
	"log/slog"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

func (s *Server) audit(ctx context.Context, eventType, actorUserID, organizationID, ip string, details map[string]interface{}) {
	// Best-effort: an audit write failure must not fail the request; it is
	// logged server-side instead.
	if details == nil {
		details = map[string]interface{}{}
	}
	requestID := RequestIDFromContext(ctx)
	if requestID != "" {
		details["request_id"] = requestID
	}
	if err := s.Store.InsertSecurityAuditEvent(ctx, storage.SecurityAuditEvent{
		EventType:      eventType,
		SchemaVersion:  1,
		RequestID:      requestID,
		ActorUserID:    actorUserID,
		OrganizationID: organizationID,
		IP:             ip,
		Details:        details,
	}); err != nil {
		slog.Warn("security audit write failed", "event_type", eventType, "error", err)
	}
}

func (s *Server) auditRequired(ctx context.Context, eventType, actorUserID, organizationID, ip string, details map[string]interface{}) error {
	if details == nil {
		details = map[string]interface{}{}
	}
	requestID := RequestIDFromContext(ctx)
	if requestID != "" {
		details["request_id"] = requestID
	}
	return s.Store.InsertSecurityAuditEvent(ctx, storage.SecurityAuditEvent{
		EventType: eventType, SchemaVersion: 1, RequestID: requestID, ActorUserID: actorUserID, OrganizationID: organizationID, IP: ip, Details: details,
	})
}
