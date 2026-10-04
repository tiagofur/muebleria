package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"time"
)

// Contrato: estado de piso por ítem (F089/F092) y log inmutable de
// eventos de piso, incluidos helpers JSONB compartidos del archivo.
func (s *PostgresStore) SetProjectItemFloorStatus(ctx context.Context, projectID, itemID, status string) error {
	if !isValidItemFloorStatus(status) {
		return fmt.Errorf("invalid floor status %q", status)
	}
	tag, err := s.db(ctx).Exec(ctx, `
		UPDATE project_items
		SET floor_status = $1
		WHERE id = $2 AND project_id = $3 AND organization_id = $4;
	`, status, itemID, projectID, OrgFromCtx(ctx))
	if err != nil {
		return fmt.Errorf("error updating floor status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("project item not found")
	}
	if _, err := s.db(ctx).Exec(ctx, `
		UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND organization_id = $2;
	`, projectID, OrgFromCtx(ctx)); err != nil {
		return fmt.Errorf("error touching project updated_at: %w", err)
	}
	return nil
}

func isValidItemFloorStatus(s string) bool {
	for _, v := range domain.ItemFloorStatuses {
		if v == s {
			return true
		}
	}
	return false
}

// InsertFloorEvent appends one shop-floor transition to the audit log
// (F092). Idempotent by event id — client re-saves and offline sync
// retries never duplicate rows.
func (s *PostgresStore) InsertFloorEvent(ctx context.Context, ev domain.FloorStatusEvent) error {
	if ev.ID == "" || ev.ProjectID == "" || ev.ItemID == "" {
		return fmt.Errorf("floor event requires id, project and item")
	}
	var byUser *string
	if ev.ByUserID != "" {
		byUser = &ev.ByUserID
	}
	var at interface{} = ev.At
	if ev.At.IsZero() {
		at = time.Now()
	}
	_, err := s.db(ctx).Exec(ctx, `
		INSERT INTO project_item_floor_events
			(id, project_id, item_id, from_status, to_status, at, by_user_id, by_name, source, note, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''), $9, NULLIF($10, ''), $11)
		ON CONFLICT (id) DO NOTHING;
	`, ev.ID, ev.ProjectID, ev.ItemID, domain.NormalizeItemFloorStatus(ev.From),
		domain.NormalizeItemFloorStatus(ev.To), at, byUser, ev.ByName,
		string(domain.NormalizeFloorEventSource(string(ev.Source))), ev.Note, OrgFromCtx(ctx))
	if err != nil {
		return fmt.Errorf("error inserting floor event: %w", err)
	}
	return nil
}

// ListFloorEvents returns the shop-floor log of a project, oldest first (F092).
func (s *PostgresStore) ListFloorEvents(ctx context.Context, projectID string) ([]domain.FloorStatusEvent, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT id, project_id, item_id, from_status, to_status, at, by_user_id, by_name, source, note
		FROM project_item_floor_events
		WHERE project_id = $1
		ORDER BY at ASC, id ASC;
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("error listing floor events: %w", err)
	}
	defer rows.Close()

	events := []domain.FloorStatusEvent{}
	for rows.Next() {
		var ev domain.FloorStatusEvent
		var byUser *string
		var byName, note *string
		if err := rows.Scan(&ev.ID, &ev.ProjectID, &ev.ItemID, &ev.From, &ev.To, &ev.At, &byUser, &byName, &ev.Source, &note); err != nil {
			return nil, fmt.Errorf("error scanning floor event: %w", err)
		}
		if byUser != nil {
			ev.ByUserID = *byUser
		}
		if byName != nil {
			ev.ByName = *byName
		}
		if note != nil {
			ev.Note = *note
		}
		events = append(events, ev)
	}
	return events, rows.Err()
}

// upsertFloorEventsTx merges client-supplied events (web project saves)
// into the audit log inside a project update transaction. History rows
// are never rewritten — ON CONFLICT keeps existing ids untouched.
func upsertFloorEventsTx(ctx context.Context, tx pgx.Tx, projectID string, events []domain.FloorStatusEvent) error {
	for _, ev := range events {
		if ev.ID == "" || ev.ItemID == "" {
			continue
		}
		var byUser *string
		if ev.ByUserID != "" {
			byUser = &ev.ByUserID
		}
		var at interface{} = ev.At
		if ev.At.IsZero() {
			at = time.Now()
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO project_item_floor_events
				(id, project_id, item_id, from_status, to_status, at, by_user_id, by_name, source, note, organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''), $9, NULLIF($10, ''), $11)
			ON CONFLICT (id) DO NOTHING;
		`, ev.ID, projectID, ev.ItemID, domain.NormalizeItemFloorStatus(ev.From),
			domain.NormalizeItemFloorStatus(ev.To), at, byUser, ev.ByName,
			string(domain.NormalizeFloorEventSource(string(ev.Source))), ev.Note, OrgFromCtx(ctx)); err != nil {
			return fmt.Errorf("error upserting floor event: %w", err)
		}
	}
	return nil
}

func commercialStatusArg(cs *domain.CommercialStatus) interface{} {
	if cs == nil || *cs == "" {
		return nil
	}
	return string(*cs)
}

func jsonbSliceArg(v interface{}) interface{} {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil || len(b) == 0 || string(b) == "null" || string(b) == "[]" {
		return nil
	}
	return b
}

func jsonbStructArg(v interface{}) interface{} {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil || len(b) == 0 || string(b) == "null" {
		return nil
	}
	return b
}

// ListProjectEvents returns the lifecycle event log of a project, oldest first (OC-010).
