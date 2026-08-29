package storage

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

const userColumns = `id, email, normalized_email, password_hash, name, account_status,
	email_verified_at, last_login_at, platform_admin, created_at, updated_at`

var ErrUserNotFound = errors.New("user not found")

func scanUser(row pgx.Row) (*domain.User, error) {
	var u domain.User
	if err := row.Scan(&u.ID, &u.Email, &u.NormalizedEmail, &u.PasswordHash, &u.Name,
		&u.AccountStatus, &u.EmailVerifiedAt, &u.LastLoginAt, &u.PlatformAdmin,
		&u.CreatedAt, &u.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return &u, nil
}

func (s *PostgresStore) GetUserByEmail(ctx context.Context, email string) (*domain.User, error) {
	return scanUser(s.db(ctx).QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE normalized_email = $1`, domain.NormalizeEmail(email)))
}

func (s *PostgresStore) GetUserByEmailAnyState(ctx context.Context, email string) (*domain.User, error) {
	return s.GetUserByEmail(ctx, email)
}

func (s *PostgresStore) UpdateUserPassword(ctx context.Context, id, passwordHash string) error {
	result, err := s.db(ctx).Exec(ctx, `UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2`, passwordHash, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("user not found")
	}
	return nil
}

func (s *PostgresStore) UpdateLastLogin(ctx context.Context, id string) error {
	result, err := s.db(ctx).Exec(ctx, `UPDATE users SET last_login_at=NOW(), updated_at=NOW() WHERE id=$1 AND account_status='active'`, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("user not found")
	}
	return nil
}

var ErrAccountNotFound = errors.New("account not found")

// UpdateAccountStatus is platform-only at the transport boundary. The account
// mutation and its required security event share the caller's idempotency
// transaction, so audit failure rolls the status change back.
func (s *PostgresStore) UpdateAccountStatus(ctx context.Context, actorID, userID string, status domain.AccountStatus, reason, ip string) (*domain.User, error) {
	if status != domain.AccountStatusActive && status != domain.AccountStatusDisabled {
		return nil, fmt.Errorf("invalid account status")
	}
	if tx := transactionFromContext(ctx); tx != nil {
		if err := setTenantContext(ctx, tx, TenantActor{UserID: actorID}); err != nil {
			return nil, err
		}
	}
	u, err := scanUser(s.db(ctx).QueryRow(ctx, `UPDATE users SET account_status=$2,updated_at=NOW()
		WHERE id=$1 RETURNING `+userColumns, userID, status))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAccountNotFound
	}
	if err != nil {
		return nil, err
	}
	event := "account_disabled"
	if status == domain.AccountStatusActive {
		event = "account_reactivated"
	}
	if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{EventType: event, ActorUserID: actorID, TargetUserID: userID, IP: ip, Details: map[string]interface{}{"reason": reason}}); err != nil {
		return nil, err
	}
	return u, nil
}

func (s *PostgresStore) GetUserByID(ctx context.Context, id string) (*domain.User, error) {
	return scanUser(s.db(ctx).QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE id=$1`, id))
}

func (s *PostgresStore) CreateUser(ctx context.Context, u *domain.User) error {
	u.NormalizedEmail = domain.NormalizeEmail(u.Email)
	u.Email = stringsTrimmedEmail(u.Email)
	if u.AccountStatus == "" {
		u.AccountStatus = domain.AccountStatusActive
	}
	return s.db(ctx).QueryRow(ctx, `
		INSERT INTO users (email, normalized_email, password_hash, name, account_status)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id, created_at, updated_at`, u.Email, u.NormalizedEmail, u.PasswordHash, u.Name, u.AccountStatus).
		Scan(&u.ID, &u.CreatedAt, &u.UpdatedAt)
}

func stringsTrimmedEmail(email string) string {
	// Preserve display casing but never surrounding whitespace.
	return strings.TrimSpace(email)
}

func (s *PostgresStore) ListUsers(ctx context.Context) ([]domain.User, error) {
	rows, err := s.db(ctx).Query(ctx, `SELECT `+userColumns+` FROM users ORDER BY account_status DESC, created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

func (s *PostgresStore) ListUsersByOrganization(ctx context.Context) ([]domain.User, error) {
	orgID, err := RequireOrgFromCtx(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT u.id, u.email, u.normalized_email, u.password_hash, u.name, u.account_status,
		u.email_verified_at, u.last_login_at, u.platform_admin, u.created_at, u.updated_at
		FROM users u JOIN memberships m ON m.user_id=u.id AND m.status='active'
		JOIN organizations o ON o.id=m.organization_id AND o.active
		WHERE m.organization_id=$1 ORDER BY u.account_status DESC, u.created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}
