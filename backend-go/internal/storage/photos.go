package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ListProjectPhotos returns all photos attached to a project ordered by created_at DESC.
func (s *PostgresStore) ListProjectPhotos(ctx context.Context, projectID string) ([]domain.ProjectPhoto, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, project_id, stage, url, thumbnail_url, caption, is_showcase, created_by, created_at, updated_at
		FROM project_photos
		WHERE project_id = $1
		ORDER BY created_at DESC;
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list project photos: %w", err)
	}
	defer rows.Close()

	var photos []domain.ProjectPhoto
	for rows.Next() {
		var p domain.ProjectPhoto
		var thumbURL, caption, createdBy sql.NullString
		if err := rows.Scan(
			&p.ID,
			&p.ProjectID,
			&p.Stage,
			&p.URL,
			&thumbURL,
			&caption,
			&p.IsShowcase,
			&createdBy,
			&p.CreatedAt,
			&p.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan project photo: %w", err)
		}
		if thumbURL.Valid {
			p.ThumbnailURL = thumbURL.String
		}
		if caption.Valid {
			p.Caption = caption.String
		}
		if createdBy.Valid {
			p.CreatedBy = createdBy.String
		}
		photos = append(photos, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate project photos: %w", err)
	}
	if photos == nil {
		photos = []domain.ProjectPhoto{}
	}
	return photos, nil
}

// GetProjectPhotoByID returns a single photo by its ID.
func (s *PostgresStore) GetProjectPhotoByID(ctx context.Context, photoID string) (*domain.ProjectPhoto, error) {
	var p domain.ProjectPhoto
	var thumbURL, caption, createdBy sql.NullString
	err := s.Pool.QueryRow(ctx, `
		SELECT id, project_id, stage, url, thumbnail_url, caption, is_showcase, created_by, created_at, updated_at
		FROM project_photos
		WHERE id = $1;
	`, photoID).Scan(
		&p.ID,
		&p.ProjectID,
		&p.Stage,
		&p.URL,
		&thumbURL,
		&caption,
		&p.IsShowcase,
		&createdBy,
		&p.CreatedAt,
		&p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, fmt.Errorf("get project photo by id: %w", err)
	}

	if thumbURL.Valid {
		p.ThumbnailURL = thumbURL.String
	}
	if caption.Valid {
		p.Caption = caption.String
	}
	if createdBy.Valid {
		p.CreatedBy = createdBy.String
	}
	return &p, nil
}

// CreateProjectPhoto inserts a new photo record into the database.
func (s *PostgresStore) CreateProjectPhoto(ctx context.Context, photo *domain.ProjectPhoto) error {
	var createdByParam *string
	if photo.CreatedBy != "" {
		createdByParam = &photo.CreatedBy
	}
	var thumbParam *string
	if photo.ThumbnailURL != "" {
		thumbParam = &photo.ThumbnailURL
	}
	var captionParam *string
	if photo.Caption != "" {
		captionParam = &photo.Caption
	}

	err := s.Pool.QueryRow(ctx, `
		INSERT INTO project_photos (project_id, stage, url, thumbnail_url, caption, is_showcase, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at, updated_at;
	`, photo.ProjectID, string(photo.Stage), photo.URL, thumbParam, captionParam, photo.IsShowcase, createdByParam).Scan(
		&photo.ID,
		&photo.CreatedAt,
		&photo.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("create project photo: %w", err)
	}
	return nil
}

// UpdateProjectPhoto updates caption, showcase flag, stage and updated_at of a photo.
func (s *PostgresStore) UpdateProjectPhoto(ctx context.Context, photoID string, caption string, isShowcase bool, stage domain.ProjectPhotoStage) (*domain.ProjectPhoto, error) {
	var p domain.ProjectPhoto
	var thumbURL, captionNull, createdBy sql.NullString
	now := time.Now()

	err := s.Pool.QueryRow(ctx, `
		UPDATE project_photos
		SET caption = $1, is_showcase = $2, stage = $3, updated_at = $4
		WHERE id = $5
		RETURNING id, project_id, stage, url, thumbnail_url, caption, is_showcase, created_by, created_at, updated_at;
	`, caption, isShowcase, string(stage), now, photoID).Scan(
		&p.ID,
		&p.ProjectID,
		&p.Stage,
		&p.URL,
		&thumbURL,
		&captionNull,
		&p.IsShowcase,
		&createdBy,
		&p.CreatedAt,
		&p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, fmt.Errorf("update project photo: %w", err)
	}
	if thumbURL.Valid {
		p.ThumbnailURL = thumbURL.String
	}
	if captionNull.Valid {
		p.Caption = captionNull.String
	}
	if createdBy.Valid {
		p.CreatedBy = createdBy.String
	}
	return &p, nil
}

// DeleteProjectPhoto removes a photo record by ID.
func (s *PostgresStore) DeleteProjectPhoto(ctx context.Context, photoID string) error {
	ct, err := s.Pool.Exec(ctx, `
		DELETE FROM project_photos
		WHERE id = $1;
	`, photoID)
	if err != nil {
		return fmt.Errorf("delete project photo: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return sql.ErrNoRows
	}
	return nil
}

