package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1422 slice 2 — workshop kit templates: org-scoped planning data for the
// hardware-kit wizard. Same catalog discipline as agregados: direct SQL under
// the runtime role (RLS-backed), client-minted ids, optimistic concurrency
// with version guards, soft deactivate instead of physical delete.

var ErrKitTemplateNotFound = errors.New("kit template not found")

const kitTemplateColumns = `id, code, label_es, agregado_label_es, motion, slots, active, version, created_at, updated_at`

func scanKitTemplateRow(scan func(dest ...any) error) (domain.KitTemplate, error) {
	var t domain.KitTemplate
	var code string
	var slotsJSON []byte
	if err := scan(&t.ID, &code, &t.LabelEs, &t.AgregadoLabelEs, &t.Motion, &slotsJSON, &t.Active, &t.Version, &t.CreatedAt, &t.UpdatedAt); err != nil {
		return domain.KitTemplate{}, err
	}
	t.Code = &code
	if len(slotsJSON) > 0 {
		if err := json.Unmarshal(slotsJSON, &t.Slots); err != nil {
			return domain.KitTemplate{}, fmt.Errorf("error decoding kit template slots: %w", err)
		}
	}
	return t, nil
}

func (s *PostgresStore) ListKitTemplates(ctx context.Context) ([]domain.KitTemplate, error) {
	query := `
		SELECT ` + kitTemplateColumns + `
		FROM hardware_kit_templates
		WHERE organization_id = $1 AND active
		ORDER BY label_es ASC, id ASC;
	`
	rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []domain.KitTemplate{}
	for rows.Next() {
		t, err := scanKitTemplateRow(rows.Scan)
		if err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	return list, rows.Err()
}

func (s *PostgresStore) GetKitTemplateByID(ctx context.Context, id string) (*domain.KitTemplate, error) {
	query := `
		SELECT ` + kitTemplateColumns + `
		FROM hardware_kit_templates
		WHERE id = $1 AND organization_id = $2;
	`
	t, err := scanKitTemplateRow(s.db(ctx).QueryRow(ctx, query, id, OrgFromCtx(ctx)).Scan)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrKitTemplateNotFound
		}
		return nil, err
	}
	return &t, nil
}

func (s *PostgresStore) CreateKitTemplate(ctx context.Context, t *domain.KitTemplate) error {
	slotsJSON, err := json.Marshal(t.Slots)
	if err != nil {
		return fmt.Errorf("error marshaling kit template slots: %w", err)
	}
	if len(slotsJSON) == 0 || string(slotsJSON) == "null" {
		slotsJSON = []byte("[]")
	}
	query := `
		INSERT INTO hardware_kit_templates (id, code, label_es, agregado_label_es, motion, slots, active, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
		RETURNING version, created_at, updated_at;
	`
	err = s.db(ctx).QueryRow(ctx, query,
		t.ID, *t.Code, t.LabelEs, t.AgregadoLabelEs, t.Motion, slotsJSON, OrgFromCtx(ctx),
	).Scan(&t.Version, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return err
	}
	t.Active = true
	return nil
}

func (s *PostgresStore) UpdateKitTemplate(ctx context.Context, id string, expectedVersion int64, t *domain.KitTemplate) error {
	slotsJSON, err := json.Marshal(t.Slots)
	if err != nil {
		return fmt.Errorf("error marshaling kit template slots: %w", err)
	}
	if len(slotsJSON) == 0 || string(slotsJSON) == "null" {
		slotsJSON = []byte("[]")
	}
	query := `
		UPDATE hardware_kit_templates
		SET code = $1, label_es = $2, agregado_label_es = $3, motion = $4, slots = $5, updated_at = CURRENT_TIMESTAMP, version = version + 1
		WHERE id = $6 AND organization_id = $7 AND version = $8
		RETURNING created_at, updated_at;
	`
	err = s.db(ctx).QueryRow(ctx, query,
		*t.Code, t.LabelEs, t.AgregadoLabelEs, t.Motion, slotsJSON, id, OrgFromCtx(ctx), expectedVersion,
	).Scan(&t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return s.disambiguateRowNotFound(ctx, "hardware_kit_templates", id, ErrKitTemplateNotFound)
		}
		return err
	}
	t.ID = id
	t.Version = expectedVersion + 1
	return nil
}

func (s *PostgresStore) DeactivateKitTemplate(ctx context.Context, id string, expectedVersion int64) error {
	query := `UPDATE hardware_kit_templates SET active = FALSE, updated_at = CURRENT_TIMESTAMP, version = version + 1 WHERE id = $1 AND organization_id = $2 AND version = $3;`
	tag, err := s.db(ctx).Exec(ctx, query, id, OrgFromCtx(ctx), expectedVersion)
	if err != nil {
		return fmt.Errorf("error deactivating kit template: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return s.disambiguateRowNotFound(ctx, "hardware_kit_templates", id, ErrKitTemplateNotFound)
	}
	return nil
}
