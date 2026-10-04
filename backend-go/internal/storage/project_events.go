package storage

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"time"
)

// Contrato: eventos de ciclo de vida del proyecto (OC-010) — append-only
// con upsert transaccional.
func (s *PostgresStore) ListProjectEvents(ctx context.Context, projectID string) ([]domain.ProjectEvent, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT id, project_id, type, at, by_user_id, source, note, payload, created_at
		FROM project_events
		WHERE project_id = $1
		ORDER BY at ASC, id ASC;
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("error listing project events: %w", err)
	}
	defer rows.Close()

	events := []domain.ProjectEvent{}
	for rows.Next() {
		var ev domain.ProjectEvent
		var byUser, note *string
		var source string
		var payload []byte
		if err := rows.Scan(&ev.ID, &ev.ProjectID, &ev.Type, &ev.At, &byUser, &source, &note, &payload, &ev.CreatedAt); err != nil {
			return nil, fmt.Errorf("error scanning project event: %w", err)
		}
		if byUser != nil {
			ev.ByUserID = byUser
		}
		ev.Source = domain.NormalizeProjectEventSource(source)
		if note != nil {
			ev.Note = *note
		}
		if len(payload) > 0 && string(payload) != "null" {
			ev.Payload = payload
		}
		events = append(events, ev)
	}
	return events, rows.Err()
}

// InsertProjectEvent writes one immutable lifecycle event to the audit log (OC-010).
func (s *PostgresStore) InsertProjectEvent(ctx context.Context, ev domain.ProjectEvent) error {
	var at interface{} = ev.At
	if ev.At.IsZero() {
		at = time.Now()
	}
	source := domain.NormalizeProjectEventSource(string(ev.Source))
	_, err := s.db(ctx).Exec(ctx, `
		INSERT INTO project_events
			(id, project_id, type, at, by_user_id, source, note, payload, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8, $9)
		ON CONFLICT (id) DO NOTHING;
	`, ev.ID, ev.ProjectID, ev.Type, at, ev.ByUserID, string(source), ev.Note, nullKitchenLayout(ev.Payload), OrgFromCtx(ctx))
	if err != nil {
		return fmt.Errorf("error inserting project event: %w", err)
	}
	return nil
}

// upsertProjectEventsTx merges client-supplied events into the audit log inside a project transaction.
func upsertProjectEventsTx(ctx context.Context, tx pgx.Tx, projectID string, events []domain.ProjectEvent) error {
	for _, ev := range events {
		if ev.ID == "" || ev.Type == "" {
			continue
		}
		var at interface{} = ev.At
		if ev.At.IsZero() {
			at = time.Now()
		}
		source := domain.NormalizeProjectEventSource(string(ev.Source))
		if _, err := tx.Exec(ctx, `
			INSERT INTO project_events
				(id, project_id, type, at, by_user_id, source, note, payload, organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8, $9)
			ON CONFLICT (id) DO NOTHING;
		`, ev.ID, projectID, ev.Type, at, ev.ByUserID, string(source), ev.Note, nullKitchenLayout(ev.Payload), OrgFromCtx(ctx)); err != nil {
			return fmt.Errorf("error upserting project event: %w", err)
		}
	}
	return nil
}
