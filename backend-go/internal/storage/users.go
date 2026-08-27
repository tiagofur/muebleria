package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// User identity persistence. Roles live in memberships and licensing in the
// organization (ADR-0005): the deprecated users.role / users.license_* columns
// were dropped in migration 000090.

const userColumns = `id, email, password_hash, name, active, platform_admin, created_at, updated_at`

func (s *PostgresStore) GetUserByEmail(ctx context.Context, email string) (*domain.User, error) {
	row := s.Pool.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE email = $1`, email)
	var u domain.User
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Active, &u.PlatformAdmin,
		&u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("user not found")
		}
		return nil, err
	}
	// Return inactive (pending) users too — login maps all failures to the same
	// 401 so clients cannot enumerate registered/pending emails (issue #19).
	// Callers that require an approved account must check u.Active themselves.
	return &u, nil
}

// GetUserByEmailAnyState is like GetUserByEmail but returns the user regardless
// of its active flag and never returns ErrPendingApproval. Used by the admin CLI
// (cmd/admin) to locate a user — including inactive ones — for password rotation.
func (s *PostgresStore) GetUserByEmailAnyState(ctx context.Context, email string) (*domain.User, error) {
	row := s.Pool.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE email = $1`, email)
	var u domain.User
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Active, &u.PlatformAdmin,
		&u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("user not found")
		}
		return nil, err
	}
	return &u, nil
}

// UpdateUserPassword sets a new password hash for the given user id.
// Used by the admin CLI to rotate credentials.
func (s *PostgresStore) UpdateUserPassword(ctx context.Context, id string, passwordHash string) error {
	result, err := s.Pool.Exec(ctx,
		`UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, passwordHash, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("user not found")
	}
	return nil
}

func (s *PostgresStore) GetUserByID(ctx context.Context, id string) (*domain.User, error) {
	row := s.Pool.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE id = $1`, id)
	var u domain.User
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Active, &u.PlatformAdmin,
		&u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *PostgresStore) CreateUser(ctx context.Context, u *domain.User) error {
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, active)
		VALUES ($1, $2, $3, $4)
		RETURNING id, created_at, updated_at;
	`, u.Email, u.PasswordHash, u.Name, u.Active).Scan(&u.ID, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return fmt.Errorf("error creating user: %w", err)
	}
	return nil
}

func (s *PostgresStore) ListUsers(ctx context.Context) ([]domain.User, error) {
	rows, err := s.Pool.Query(ctx,
		`SELECT `+userColumns+` FROM users ORDER BY active ASC, created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.User
	for rows.Next() {
		var u domain.User
		if err := rows.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Active, &u.PlatformAdmin,
			&u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, u)
	}
	if list == nil {
		list = []domain.User{}
	}
	return list, nil
}

// ListUsersByOrganization returns only the users holding an ACTIVE membership
// in the context's organization (ADR-0005: an org admin never sees other
// organizations' users). The global ListUsers stays reserved for the platform
// console.
func (s *PostgresStore) ListUsersByOrganization(ctx context.Context) ([]domain.User, error) {
	orgID, err := RequireOrgFromCtx(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT u.id, u.email, u.password_hash, u.name, u.active, u.platform_admin, u.created_at, u.updated_at
		FROM users u
		JOIN memberships m ON m.user_id = u.id AND m.active
		JOIN organizations o ON o.id = m.organization_id AND o.active
		WHERE m.organization_id = $1
		ORDER BY u.active ASC, u.created_at DESC;
	`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.User
	for rows.Next() {
		var u domain.User
		if err := rows.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Active, &u.PlatformAdmin,
			&u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, u)
	}
	if list == nil {
		list = []domain.User{}
	}
	return list, rows.Err()
}

// ApproveUser activates a pending user account.
func (s *PostgresStore) ApproveUser(ctx context.Context, id string) error {
	// Approval also grants the membership that lets the user log in: while a
	// single organization exists, approvals target it explicitly (ADR-0004
	// transitional bridge; the F172 team screen assigns per organization).
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	result, err := tx.Exec(ctx,
		`UPDATE users SET active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("user not found")
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO memberships (organization_id, user_id, roles)
		VALUES ($1, $2, ARRAY['user']::text[])
		ON CONFLICT (user_id, organization_id) DO NOTHING`,
		InitialOrganizationID, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DeleteOrphanInvitedUser removes a just-created user that failed to attach
// to any organization (invitation revoked/expired mid-accept). Refuses when
// the user already holds memberships — a user that belongs nowhere cannot
// log into any organization.
func (s *PostgresStore) DeleteOrphanInvitedUser(ctx context.Context, id string) error {
	_, err := s.Pool.Exec(ctx,
		`DELETE FROM users WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = $1)`, id)
	return err
}

// RejectUser deletes a pending user (hard delete — not yet approved).
func (s *PostgresStore) RejectUser(ctx context.Context, id string) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM users WHERE id = $1 AND active = false`, id)
	return err
}
