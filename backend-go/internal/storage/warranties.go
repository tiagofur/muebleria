package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ListWarrantyTickets returns warranty tickets matching the optional filters.
func (s *PostgresStore) ListWarrantyTickets(ctx context.Context, projectID, customerID, status string) ([]domain.WarrantyTicket, error) {
	query := `
		SELECT id, ticket_number, project_id, customer_id, title, description, category, priority, status,
		       assigned_technician_id, scheduled_date, resolved_at, resolution_notes, refabrication_pieces,
		       created_at, updated_at
		FROM warranty_tickets
		WHERE organization_id = $1
	`
	args := []any{OrgFromCtx(ctx)}
	argIdx := 2

	if projectID != "" {
		query += fmt.Sprintf(" AND project_id = $%d", argIdx)
		args = append(args, projectID)
		argIdx++
	}
	if customerID != "" {
		query += fmt.Sprintf(" AND customer_id = $%d", argIdx)
		args = append(args, customerID)
		argIdx++
	}
	if status != "" {
		query += fmt.Sprintf(" AND status = $%d", argIdx)
		args = append(args, status)
		argIdx++
	}

	query += " ORDER BY created_at DESC;"

	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list warranty tickets: %w", err)
	}
	defer rows.Close()

	var tickets []domain.WarrantyTicket
	for rows.Next() {
		var t domain.WarrantyTicket
		var custID, techID, resNotes sql.NullString
		var schedDate sql.NullTime
		var resAt sql.NullTime
		var piecesRaw []byte

		if err := rows.Scan(
			&t.ID,
			&t.TicketNumber,
			&t.ProjectID,
			&custID,
			&t.Title,
			&t.Description,
			&t.Category,
			&t.Priority,
			&t.Status,
			&techID,
			&schedDate,
			&resAt,
			&resNotes,
			&piecesRaw,
			&t.CreatedAt,
			&t.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan warranty ticket: %w", err)
		}

		if custID.Valid {
			s := custID.String
			t.CustomerID = &s
		}
		if techID.Valid {
			s := techID.String
			t.AssignedTechnicianID = &s
		}
		if schedDate.Valid {
			s := schedDate.Time.Format("2006-01-02")
			t.ScheduledDate = &s
		}
		if resAt.Valid {
			t.ResolvedAt = &resAt.Time
		}
		if resNotes.Valid {
			t.ResolutionNotes = resNotes.String
		}
		if len(piecesRaw) > 0 {
			_ = json.Unmarshal(piecesRaw, &t.RefabricationPieces)
		}
		if t.RefabricationPieces == nil {
			t.RefabricationPieces = []domain.WarrantyRefabricationPiece{}
		}

		tickets = append(tickets, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate warranty tickets: %w", err)
	}
	if tickets == nil {
		tickets = []domain.WarrantyTicket{}
	}

	return tickets, nil
}

// GetWarrantyTicketByID retrieves a ticket along with its photos.
func (s *PostgresStore) GetWarrantyTicketByID(ctx context.Context, id string) (*domain.WarrantyTicket, error) {
	row := s.Pool.QueryRow(ctx, `
		SELECT id, ticket_number, project_id, customer_id, title, description, category, priority, status,
		       assigned_technician_id, scheduled_date, resolved_at, resolution_notes, refabrication_pieces,
		       created_at, updated_at
		FROM warranty_tickets
		WHERE id = $1 AND organization_id = $2;
	`, id, OrgFromCtx(ctx))

	var t domain.WarrantyTicket
	var custID, techID, resNotes sql.NullString
	var schedDate sql.NullTime
	var resAt sql.NullTime
	var piecesRaw []byte

	if err := row.Scan(
		&t.ID,
		&t.TicketNumber,
		&t.ProjectID,
		&custID,
		&t.Title,
		&t.Description,
		&t.Category,
		&t.Priority,
		&t.Status,
		&techID,
		&schedDate,
		&resAt,
		&resNotes,
		&piecesRaw,
		&t.CreatedAt,
		&t.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("warranty ticket not found")
		}
		return nil, fmt.Errorf("get warranty ticket by id: %w", err)
	}

	if custID.Valid {
		s := custID.String
		t.CustomerID = &s
	}
	if techID.Valid {
		s := techID.String
		t.AssignedTechnicianID = &s
	}
	if schedDate.Valid {
		s := schedDate.Time.Format("2006-01-02")
		t.ScheduledDate = &s
	}
	if resAt.Valid {
		t.ResolvedAt = &resAt.Time
	}
	if resNotes.Valid {
		t.ResolutionNotes = resNotes.String
	}
	if len(piecesRaw) > 0 {
		_ = json.Unmarshal(piecesRaw, &t.RefabricationPieces)
	}
	if t.RefabricationPieces == nil {
		t.RefabricationPieces = []domain.WarrantyRefabricationPiece{}
	}

	photos, err := s.ListWarrantyTicketPhotos(ctx, id)
	if err == nil {
		t.Photos = photos
	}

	return &t, nil
}

// CreateWarrantyTicket creates a new warranty ticket.
func (s *PostgresStore) CreateWarrantyTicket(ctx context.Context, ticket *domain.WarrantyTicket) error {
	now := time.Now().UTC()
	ticket.CreatedAt = now
	ticket.UpdatedAt = now

	piecesJSON, err := json.Marshal(ticket.RefabricationPieces)
	if err != nil {
		piecesJSON = []byte("[]")
	}

	var schedDate *time.Time
	if ticket.ScheduledDate != nil && *ticket.ScheduledDate != "" {
		if d, err := time.Parse("2006-01-02", *ticket.ScheduledDate); err == nil {
			schedDate = &d
		}
	}

	_, err = s.Pool.Exec(ctx, `
		INSERT INTO warranty_tickets (
			id, ticket_number, project_id, customer_id, title, description, category, priority, status,
			assigned_technician_id, scheduled_date, resolved_at, resolution_notes, refabrication_pieces,
			created_at, updated_at, organization_id
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
		);
	`,
		ticket.ID,
		ticket.TicketNumber,
		ticket.ProjectID,
		ticket.CustomerID,
		ticket.Title,
		ticket.Description,
		ticket.Category,
		ticket.Priority,
		ticket.Status,
		ticket.AssignedTechnicianID,
		schedDate,
		ticket.ResolvedAt,
		ticket.ResolutionNotes,
		piecesJSON,
		ticket.CreatedAt,
		ticket.UpdatedAt,
		OrgFromCtx(ctx),
	)
	if err != nil {
		return fmt.Errorf("create warranty ticket: %w", err)
	}

	return nil
}

// UpdateWarrantyTicket updates an existing warranty ticket.
func (s *PostgresStore) UpdateWarrantyTicket(ctx context.Context, ticket *domain.WarrantyTicket) error {
	ticket.UpdatedAt = time.Now().UTC()

	piecesJSON, err := json.Marshal(ticket.RefabricationPieces)
	if err != nil {
		piecesJSON = []byte("[]")
	}

	var schedDate *time.Time
	if ticket.ScheduledDate != nil && *ticket.ScheduledDate != "" {
		if d, err := time.Parse("2006-01-02", *ticket.ScheduledDate); err == nil {
			schedDate = &d
		}
	}

	res, err := s.Pool.Exec(ctx, `
		UPDATE warranty_tickets SET
			title = $2,
			description = $3,
			category = $4,
			priority = $5,
			status = $6,
			assigned_technician_id = $7,
			scheduled_date = $8,
			resolved_at = $9,
			resolution_notes = $10,
			refabrication_pieces = $11,
			updated_at = $12
		WHERE id = $1 AND organization_id = $13;
	`,
		ticket.ID,
		ticket.Title,
		ticket.Description,
		ticket.Category,
		ticket.Priority,
		ticket.Status,
		ticket.AssignedTechnicianID,
		schedDate,
		ticket.ResolvedAt,
		ticket.ResolutionNotes,
		piecesJSON,
		ticket.UpdatedAt,
		OrgFromCtx(ctx),
	)
	if err != nil {
		return fmt.Errorf("update warranty ticket: %w", err)
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("warranty ticket not found")
	}

	return nil
}

// DeleteWarrantyTicket deletes a warranty ticket.
func (s *PostgresStore) DeleteWarrantyTicket(ctx context.Context, id string) error {
	res, err := s.Pool.Exec(ctx, `DELETE FROM warranty_tickets WHERE id = $1 AND organization_id = $2;`, id, OrgFromCtx(ctx))
	if err != nil {
		return fmt.Errorf("delete warranty ticket: %w", err)
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("warranty ticket not found")
	}
	return nil
}

// ListWarrantyTicketPhotos returns all photos attached to a ticket.
func (s *PostgresStore) ListWarrantyTicketPhotos(ctx context.Context, ticketID string) ([]domain.WarrantyTicketPhoto, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, ticket_id, kind, url, thumbnail_url, caption, created_at
		FROM warranty_ticket_photos
		WHERE ticket_id = $1 AND organization_id = $2
		ORDER BY created_at ASC;
	`, ticketID, OrgFromCtx(ctx))
	if err != nil {
		return nil, fmt.Errorf("list warranty ticket photos: %w", err)
	}
	defer rows.Close()

	var photos []domain.WarrantyTicketPhoto
	for rows.Next() {
		var p domain.WarrantyTicketPhoto
		var caption sql.NullString
		if err := rows.Scan(
			&p.ID,
			&p.TicketID,
			&p.Kind,
			&p.URL,
			&p.ThumbnailURL,
			&caption,
			&p.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan warranty ticket photo: %w", err)
		}
		if caption.Valid {
			p.Caption = caption.String
		}
		photos = append(photos, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate warranty ticket photos: %w", err)
	}
	if photos == nil {
		photos = []domain.WarrantyTicketPhoto{}
	}

	return photos, nil
}

// AddWarrantyTicketPhoto inserts a photo for a warranty ticket.
func (s *PostgresStore) AddWarrantyTicketPhoto(ctx context.Context, photo *domain.WarrantyTicketPhoto) error {
	photo.CreatedAt = time.Now().UTC()

	_, err := s.Pool.Exec(ctx, `
		INSERT INTO warranty_ticket_photos (
			id, ticket_id, kind, url, thumbnail_url, caption, created_at, organization_id
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8
		);
	`,
		photo.ID,
		photo.TicketID,
		photo.Kind,
		photo.URL,
		photo.ThumbnailURL,
		photo.Caption,
		photo.CreatedAt,
		OrgFromCtx(ctx),
	)
	if err != nil {
		return fmt.Errorf("add warranty ticket photo: %w", err)
	}

	return nil
}

// DeleteWarrantyTicketPhoto removes a photo from a warranty ticket.
func (s *PostgresStore) DeleteWarrantyTicketPhoto(ctx context.Context, ticketID, photoID string) error {
	res, err := s.Pool.Exec(ctx, `DELETE FROM warranty_ticket_photos WHERE ticket_id = $1 AND id = $2 AND organization_id = $3;`, ticketID, photoID, OrgFromCtx(ctx))
	if err != nil {
		return fmt.Errorf("delete warranty ticket photo: %w", err)
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("warranty ticket photo not found")
	}
	return nil
}
