package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// CommitProjectDeliveryCommand sets or changes the committed delivery date of
// a project (#1648). EventID/ActorUserID/At are server-authored by the API.
type CommitProjectDeliveryCommand struct {
	ProjectID   string
	Date        string
	Reason      string
	EventID     string
	ActorUserID string
	Source      domain.ProjectEventSource
	At          time.Time
	IP          string
	RequestID   string
}

// CommitProjectDeliveryResult is the committed state after the command.
type CommitProjectDeliveryResult struct {
	ProjectID             string
	CommittedDeliveryDate string
	PreviousDate          *string
	Event                 domain.ProjectEvent
}

// CommitProjectDelivery validates the command against the locked project row
// and writes the column, the lifecycle event and the audit row atomically.
func (s *PostgresStore) CommitProjectDelivery(ctx context.Context, cmd CommitProjectDeliveryCommand) (*CommitProjectDeliveryResult, error) {
	if transactionFromContext(ctx) == nil {
		var out *CommitProjectDeliveryResult
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		actor.UserID = nonEmptyOrDefault(actor.UserID, cmd.ActorUserID)
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			var txErr error
			out, txErr = s.CommitProjectDelivery(txCtx, cmd)
			return txErr
		})
		return out, err
	}
	if cmd.EventID == "" || cmd.ProjectID == "" || cmd.ActorUserID == "" {
		return nil, fmt.Errorf("delivery commitment requires event id, project and server actor")
	}
	org := OrgFromCtx(ctx)

	var current *time.Time
	var status *string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT committed_delivery_date, commercial_status FROM projects
		WHERE id = $1 AND (organization_id = $2 OR sales_organization_id = $2 OR manufacturing_organization_id = $2)
		FOR UPDATE`, cmd.ProjectID, org).Scan(&current, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrProjectCommercialTargetNotFound
		}
		return nil, fmt.Errorf("lock project for delivery commitment: %w", err)
	}
	var currentStr *string
	if current != nil {
		formatted := current.Format("2006-01-02")
		currentStr = &formatted
	}
	var cs *domain.CommercialStatus
	if status != nil && *status != "" {
		v := domain.CommercialStatus(*status)
		cs = &v
	}
	decision, err := domain.DecideDeliveryCommitment(currentStr, cs, cmd.Date, cmd.Reason)
	if err != nil {
		return nil, err
	}

	tag, err := s.db(ctx).Exec(ctx, `
		UPDATE projects SET committed_delivery_date = $2::date, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1`, cmd.ProjectID, decision.Date)
	if err != nil {
		return nil, fmt.Errorf("update committed delivery date: %w", err)
	}
	// Fail closed: if RLS hid the row from UPDATE, neither event nor audit
	// may claim a commitment that was not stored.
	if tag.RowsAffected() != 1 {
		return nil, ErrProjectCommercialTargetNotFound
	}

	payload := map[string]any{"date": decision.Date}
	if decision.Previous != nil {
		payload["previousDate"] = *decision.Previous
	}
	if decision.Reason != "" {
		payload["reason"] = decision.Reason
	}
	note := "Entrega comprometida para el " + decision.Date
	if decision.Previous != nil {
		note = "Entrega comprometida movida del " + *decision.Previous + " al " + decision.Date + ": " + decision.Reason
	}
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	actor := cmd.ActorUserID
	ev := domain.ProjectEvent{
		ID:        cmd.EventID,
		ProjectID: cmd.ProjectID,
		Type:      decision.EventType,
		At:        cmd.At.UTC(),
		ByUserID:  &actor,
		Source:    domain.NormalizeProjectEventSource(string(cmd.Source)),
		Note:      note,
		Payload:   rawPayload,
	}
	if _, err := s.db(ctx).Exec(ctx, `
		INSERT INTO project_events
			(id, project_id, type, at, by_user_id, source, note, payload, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		ev.ID, ev.ProjectID, ev.Type, ev.At, actor, string(ev.Source), ev.Note, []byte(ev.Payload), org); err != nil {
		return nil, fmt.Errorf("insert delivery commitment event: %w", err)
	}

	details := map[string]interface{}{
		"project_id":       cmd.ProjectID,
		"project_event_id": ev.ID,
		"project_event":    ev.Type,
		"date":             decision.Date,
	}
	if decision.Previous != nil {
		details["previous_date"] = *decision.Previous
		details["reason"] = decision.Reason
	}
	if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType:      "project_delivery_date_committed",
		ActorUserID:    actor,
		OrganizationID: org,
		IP:             cmd.IP,
		RequestID:      cmd.RequestID,
		Details:        details,
	}); err != nil {
		return nil, fmt.Errorf("audit project_delivery_date_committed: %w", err)
	}

	return &CommitProjectDeliveryResult{
		ProjectID:             cmd.ProjectID,
		CommittedDeliveryDate: decision.Date,
		PreviousDate:          decision.Previous,
		Event:                 ev,
	}, nil
}
