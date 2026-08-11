package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// --- AGREGADOS (reusable sub-assemblies catalog entity) ---

func (s *PostgresStore) ListAgregados(ctx context.Context) ([]domain.Agregado, error) {
	query := `
		SELECT id, code, name, description, components, active, created_at, updated_at
		FROM agregados
		ORDER BY name ASC;
	`
	rows, err := s.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.Agregado
	for rows.Next() {
		a, err := scanAgregado(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	if list == nil {
		list = []domain.Agregado{}
	}
	return list, rows.Err()
}

func (s *PostgresStore) GetAgregadoByID(ctx context.Context, id string) (*domain.Agregado, error) {
	query := `
		SELECT id, code, name, description, components, active, created_at, updated_at
		FROM agregados
		WHERE id = $1;
	`
	row := s.Pool.QueryRow(ctx, query, id)
	a, err := scanAgregado(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("agregado not found")
		}
		return nil, err
	}
	return &a, nil
}

func (s *PostgresStore) CreateAgregado(ctx context.Context, a *domain.Agregado) error {
	componentsJSON, err := json.Marshal(a.Components)
	if err != nil {
		return fmt.Errorf("error marshaling agregado components: %w", err)
	}
	if len(componentsJSON) == 0 || string(componentsJSON) == "null" {
		componentsJSON = []byte("[]")
	}

	query := `
		INSERT INTO agregados (id, code, name, description, components, active)
		VALUES ($1, $2, $3, $4, $5, $6);
	`
	_, err = s.Pool.Exec(ctx, query,
		a.ID, a.Code, a.Name, nullIfEmpty(a.Description),
		componentsJSON, a.Active,
	)
	if err != nil {
		return fmt.Errorf("error creating agregado: %w", err)
	}
	return nil
}

func (s *PostgresStore) UpdateAgregado(ctx context.Context, id string, a *domain.Agregado) error {
	componentsJSON, err := json.Marshal(a.Components)
	if err != nil {
		return fmt.Errorf("error marshaling agregado components: %w", err)
	}
	if len(componentsJSON) == 0 || string(componentsJSON) == "null" {
		componentsJSON = []byte("[]")
	}

	query := `
		UPDATE agregados
		SET code = $1, name = $2, description = $3, components = $4, active = $5, updated_at = CURRENT_TIMESTAMP
		WHERE id = $6;
	`
	tag, err := s.Pool.Exec(ctx, query,
		a.Code, a.Name, nullIfEmpty(a.Description),
		componentsJSON, a.Active, id,
	)
	if err != nil {
		return fmt.Errorf("error updating agregado: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("agregado not found")
	}
	a.ID = id
	return nil
}

func (s *PostgresStore) DeactivateAgregado(ctx context.Context, id string) error {
	query := `UPDATE agregados SET active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1;`
	_, err := s.Pool.Exec(ctx, query, id)
	return err
}

func scanAgregado(r rowScanner) (domain.Agregado, error) {
	var a domain.Agregado
	var desc *string
	var componentsRaw []byte
	err := r.Scan(
		&a.ID, &a.Code, &a.Name, &desc, &componentsRaw, &a.Active,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		return a, err
	}
	if desc != nil {
		a.Description = *desc
	}
	if len(componentsRaw) > 0 {
		_ = json.Unmarshal(componentsRaw, &a.Components)
	}
	if a.Components == nil {
		a.Components = []domain.ComponentInstance{}
	}
	return a, nil
}
