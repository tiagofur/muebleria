package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

func (s *PostgresStore) GetUserByEmail(ctx context.Context, email string) (*domain.User, error) {
	query := `
		SELECT id, email, password_hash, name, role, active, created_at, updated_at
		FROM users
		WHERE email = $1;
	`
	row := s.Pool.QueryRow(ctx, query, email)
	var u domain.User
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.Active, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("user not found")
		}
		return nil, err
	}
	// User found but pending admin approval
	if !u.Active {
		return nil, domain.ErrPendingApproval
	}
	return &u, nil
}

func (s *PostgresStore) GetUserByID(ctx context.Context, id string) (*domain.User, error) {
	query := `
		SELECT id, email, password_hash, name, role, active, created_at, updated_at
		FROM users
		WHERE id = $1;
	`
	row := s.Pool.QueryRow(ctx, query, id)
	var u domain.User
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.Active, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *PostgresStore) CreateUser(ctx context.Context, u *domain.User) error {
	query := `
		INSERT INTO users (email, password_hash, name, role, active)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at, updated_at;
	`
	err := s.Pool.QueryRow(ctx, query, u.Email, u.PasswordHash, u.Name, u.Role, u.Active).Scan(&u.ID, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return fmt.Errorf("error creating user: %w", err)
	}
	return nil
}

func (s *PostgresStore) ListUsers(ctx context.Context) ([]domain.User, error) {
	query := `
		SELECT id, email, name, role, active, created_at, updated_at
		FROM users
		ORDER BY active ASC, created_at DESC;
	`
	rows, err := s.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.User
	for rows.Next() {
		var u domain.User
		err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.Active, &u.CreatedAt, &u.UpdatedAt)
		if err != nil {
			return nil, err
		}
		list = append(list, u)
	}
	if list == nil {
		list = []domain.User{}
	}
	return list, nil
}

// ApproveUser activates a pending user account.
func (s *PostgresStore) ApproveUser(ctx context.Context, id string) error {
	result, err := s.Pool.Exec(ctx,
		`UPDATE users SET active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("user not found")
	}
	return nil
}

// UpdateUserRole changes the role of a user.
func (s *PostgresStore) UpdateUserRole(ctx context.Context, id string, role domain.UserRole) error {
	result, err := s.Pool.Exec(ctx,
		`UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, role, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("user not found")
	}
	return nil
}

// RejectUser deletes a pending user (hard delete — not yet approved).
func (s *PostgresStore) RejectUser(ctx context.Context, id string) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM users WHERE id = $1 AND active = false`, id)
	return err
}
