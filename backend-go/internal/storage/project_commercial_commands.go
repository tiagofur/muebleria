package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ErrProjectCommercialTargetNotFound is the uniform 404 for a commercial
// command on a project that does not exist or is outside the caller's tenant.
var ErrProjectCommercialTargetNotFound = errors.New("project not found for commercial command")

// ProjectCommercialEventCommand is one server-authored commercial fact (#1647):
// a deposit or a commercial-status change. Event is fully built by the API
// (server id, server actor, validated payload); CommercialStatus, when set, is
// written to projects.commercial_status in the same transaction.
type ProjectCommercialEventCommand struct {
	Event            domain.ProjectEvent
	CommercialStatus *domain.CommercialStatus
	AuditEventType   string
	IP               string
	RequestID        string
}

// RecordProjectCommercialEvent persists the event, the optional commercial
// status and the security audit row atomically. The project row is locked so
// concurrent commands on the same project serialize.
func (s *PostgresStore) RecordProjectCommercialEvent(ctx context.Context, cmd ProjectCommercialEventCommand) (*domain.ProjectEvent, error) {
	if transactionFromContext(ctx) == nil {
		var out *domain.ProjectEvent
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			var txErr error
			out, txErr = s.RecordProjectCommercialEvent(txCtx, cmd)
			return txErr
		})
		return out, err
	}

	ev := cmd.Event
	if ev.ID == "" || ev.ProjectID == "" || ev.Type == "" || ev.ByUserID == nil || *ev.ByUserID == "" {
		return nil, fmt.Errorf("commercial event requires id, project, type and server actor")
	}
	org := OrgFromCtx(ctx)

	var projectID string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT id FROM projects
		WHERE id = $1 AND (organization_id = $2 OR sales_organization_id = $2 OR manufacturing_organization_id = $2)
		FOR UPDATE`, ev.ProjectID, org).Scan(&projectID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrProjectCommercialTargetNotFound
		}
		return nil, fmt.Errorf("lock project for commercial command: %w", err)
	}

	if _, err := s.db(ctx).Exec(ctx, `
		INSERT INTO project_events
			(id, project_id, type, at, by_user_id, source, note, payload, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8, $9)`,
		ev.ID, ev.ProjectID, ev.Type, ev.At, ev.ByUserID, string(domain.NormalizeProjectEventSource(string(ev.Source))),
		ev.Note, nullKitchenLayout(ev.Payload), org); err != nil {
		return nil, fmt.Errorf("insert commercial project event: %w", err)
	}

	if cmd.CommercialStatus != nil {
		if _, err := s.db(ctx).Exec(ctx, `
			UPDATE projects SET commercial_status = $2, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1`, ev.ProjectID, string(*cmd.CommercialStatus)); err != nil {
			return nil, fmt.Errorf("update commercial status: %w", err)
		}
	}

	details := map[string]interface{}{
		"project_id":       ev.ProjectID,
		"project_event_id": ev.ID,
		"project_event":    ev.Type,
	}
	if cmd.CommercialStatus != nil {
		details["commercial_status"] = string(*cmd.CommercialStatus)
	}
	if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      cmd.AuditEventType,
		ActorUserID:    *ev.ByUserID,
		OrganizationID: org,
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details:        details,
	}); err != nil {
		return nil, fmt.Errorf("audit %s: %w", cmd.AuditEventType, err)
	}

	stored := ev
	stored.Source = domain.NormalizeProjectEventSource(string(ev.Source))
	return &stored, nil
}
