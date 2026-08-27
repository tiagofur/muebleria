package storage

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

func (s *PostgresStore) GetUserByEmail(ctx context.Context, email string) (*domain.User, error) {
	query := `
		SELECT id, email, password_hash, name, role, active, platform_admin, license_plan, license_expires_at,
		       created_at, updated_at
		FROM users
		WHERE email = $1;
	`
	row := s.Pool.QueryRow(ctx, query, email)
	var u domain.User
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.Active, &u.PlatformAdmin,
		&u.LicensePlan, &u.LicenseExpiresAt, &u.CreatedAt, &u.UpdatedAt)
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
	query := `
		SELECT id, email, password_hash, name, role, active, platform_admin, license_plan, license_expires_at,
		       created_at, updated_at
		FROM users
		WHERE email = $1;
	`
	row := s.Pool.QueryRow(ctx, query, email)
	var u domain.User
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.Active, &u.PlatformAdmin,
		&u.LicensePlan, &u.LicenseExpiresAt, &u.CreatedAt, &u.UpdatedAt)
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
	query := `
		SELECT id, email, password_hash, name, role, active, platform_admin, license_plan, license_expires_at,
		       created_at, updated_at
		FROM users
		WHERE id = $1;
	`
	row := s.Pool.QueryRow(ctx, query, id)
	var u domain.User
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.Active, &u.PlatformAdmin,
		&u.LicensePlan, &u.LicenseExpiresAt, &u.CreatedAt, &u.UpdatedAt)
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
		SELECT id, email, name, role, active, platform_admin, license_plan, license_expires_at, created_at, updated_at
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
		err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.Active, &u.PlatformAdmin,
			&u.LicensePlan, &u.LicenseExpiresAt, &u.CreatedAt, &u.UpdatedAt)
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

// ListUsersByOrganization returns only the users holding an ACTIVE membership
// in the context's organization (ADR-0005: an org admin never sees other
// organizations' users). The global ListUsers stays reserved for the platform
// console.
func (s *PostgresStore) ListUsersByOrganization(ctx context.Context) ([]domain.User, error) {
	orgID, err := RequireOrgFromCtx(ctx)
	if err != nil {
		return nil, err
	}
	query := `
		SELECT u.id, u.email, u.name, u.role, u.active, u.platform_admin, u.license_plan, u.license_expires_at, u.created_at, u.updated_at
		FROM users u
		JOIN memberships m ON m.user_id = u.id AND m.active
		JOIN organizations o ON o.id = m.organization_id AND o.active
		WHERE m.organization_id = $1
		ORDER BY u.active ASC, u.created_at DESC;
	`
	rows, err := s.Pool.Query(ctx, query, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.User
	for rows.Next() {
		var u domain.User
		err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.Active, &u.PlatformAdmin,
			&u.LicensePlan, &u.LicenseExpiresAt, &u.CreatedAt, &u.UpdatedAt)
		if err != nil {
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

// UpdateUserRole changes the role of a user. users.role is deprecated
// (memberships are the source of truth, ADR-0004): both are updated in the
// same transaction so middleware resolution stays consistent.
func (s *PostgresStore) UpdateUserRole(ctx context.Context, id string, role domain.UserRole) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	result, err := tx.Exec(ctx,
		`UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, role, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("user not found")
	}
	if _, err := tx.Exec(ctx, `
		UPDATE memberships SET roles = ARRAY[$1]::text[], updated_at = CURRENT_TIMESTAMP
		WHERE user_id = $2`, string(role), id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// UpdateUser updates a user's name, role, and active status.
func (s *PostgresStore) UpdateUser(ctx context.Context, u *domain.User) error {
	result, err := s.Pool.Exec(ctx,
		`UPDATE users SET name = $1, role = $2, active = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
		u.Name, u.Role, u.Active, u.ID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("user not found")
	}
	return nil
}

// SetUserLicense sets the per-user licensing tier and optional expiry.
// A NULL expiry means the license does not expire (managed manually).
func (s *PostgresStore) SetUserLicense(ctx context.Context, id string, plan domain.LicensePlan, expiresAt *time.Time) error {
	result, err := s.Pool.Exec(ctx,
		`UPDATE users SET license_plan = $1, license_expires_at = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
		plan, expiresAt, id)
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
