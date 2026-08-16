package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ListProjectInternalMessages returns all internal collaboration messages for a project ordered by created_at ASC.
func (s *PostgresStore) ListProjectInternalMessages(ctx context.Context, projectID string) ([]domain.ProjectInternalMessage, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, project_id, sender_id, sender_name, message_type, content, is_resolved, attachments, created_at
		FROM project_internal_messages
		WHERE project_id = $1
		ORDER BY created_at ASC;
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list project internal messages: %w", err)
	}
	defer rows.Close()

	var messages []domain.ProjectInternalMessage
	for rows.Next() {
		var m domain.ProjectInternalMessage
		var senderID sql.NullString
		var attachmentsRaw []byte

		if err := rows.Scan(
			&m.ID,
			&m.ProjectID,
			&senderID,
			&m.SenderName,
			&m.MessageType,
			&m.Content,
			&m.IsResolved,
			&attachmentsRaw,
			&m.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan project internal message: %w", err)
		}

		if senderID.Valid {
			m.SenderID = senderID.String
		}
		if len(attachmentsRaw) > 0 {
			m.Attachments = json.RawMessage(attachmentsRaw)
		} else {
			m.Attachments = json.RawMessage("[]")
		}

		messages = append(messages, m)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate project internal messages: %w", err)
	}
	if messages == nil {
		messages = []domain.ProjectInternalMessage{}
	}
	return messages, nil
}

// CreateProjectInternalMessage inserts a new internal message or query into the database.
func (s *PostgresStore) CreateProjectInternalMessage(ctx context.Context, msg *domain.ProjectInternalMessage) error {
	var senderIDParam *string
	if msg.SenderID != "" {
		senderIDParam = &msg.SenderID
	}
	attachmentsJSON := []byte("[]")
	if len(msg.Attachments) > 0 {
		attachmentsJSON = []byte(msg.Attachments)
	}

	err := s.Pool.QueryRow(ctx, `
		INSERT INTO project_internal_messages (project_id, sender_id, sender_name, message_type, content, is_resolved, attachments)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at;
	`, msg.ProjectID, senderIDParam, msg.SenderName, string(msg.MessageType), msg.Content, msg.IsResolved, attachmentsJSON).Scan(
		&msg.ID,
		&msg.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("create project internal message: %w", err)
	}
	return nil
}

// UpdateProjectTechnicalWorkflow updates technical status, assigned engineer, and survey/installation dates.
func (s *PostgresStore) UpdateProjectTechnicalWorkflow(
	ctx context.Context,
	projectID string,
	engineerID *string,
	status string,
	surveyCompletedAt *string,
	installDate *string,
) error {
	var surveyTime *time.Time
	if surveyCompletedAt != nil && *surveyCompletedAt != "" {
		t, err := time.Parse(time.RFC3339, *surveyCompletedAt)
		if err == nil {
			surveyTime = &t
		}
	}

	now := time.Now()
	tag, err := s.Pool.Exec(ctx, `
		UPDATE projects
		SET assigned_engineer_id = $1,
		    technical_status = $2,
		    survey_completed_at = $3,
		    installation_scheduled_date = $4,
		    updated_at = $5
		WHERE id = $6;
	`, engineerID, status, surveyTime, installDate, now, projectID)
	if err != nil {
		return fmt.Errorf("update project technical workflow: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("project not found")
	}
	return nil
}
