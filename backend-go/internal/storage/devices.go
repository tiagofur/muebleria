package storage

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

var (
	ErrDeviceNotFound     = errors.New("device not found")
	ErrEnrollmentNotFound = errors.New("enrollment not found")
)

const deviceColumns = `id, user_id, client_type, display_name, credential_hash, last_seen_at, revoked_at, credential_version, metadata, created_at, updated_at, version`
const enrollmentColumns = `id, code, user_id, client_type, display_name, status, expires_at, created_at, updated_at, version`

func scanAuthDevice(row pgx.Row) (*domain.AuthDevice, error) {
	var d domain.AuthDevice
	if err := row.Scan(&d.ID, &d.UserID, &d.ClientType, &d.DisplayName, &d.CredentialHash,
		&d.LastSeenAt, &d.RevokedAt, &d.CredentialVersion, &d.Metadata,
		&d.CreatedAt, &d.UpdatedAt, &d.Version); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDeviceNotFound
		}
		return nil, err
	}
	return &d, nil
}

func scanAuthDeviceEnrollment(row pgx.Row) (*domain.AuthDeviceEnrollment, error) {
	var e domain.AuthDeviceEnrollment
	if err := row.Scan(&e.ID, &e.Code, &e.UserID, &e.ClientType, &e.DisplayName,
		&e.Status, &e.ExpiresAt, &e.CreatedAt, &e.UpdatedAt, &e.Version); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrEnrollmentNotFound
		}
		return nil, err
	}
	return &e, nil
}

// CreateAuthDeviceEnrollment saves a new enrollment request.
func (s *PostgresStore) CreateAuthDeviceEnrollment(ctx context.Context, e *domain.AuthDeviceEnrollment) error {
	query := `INSERT INTO auth_device_enrollments (id, code, client_type, display_name, expires_at) 
		VALUES ($1, $2, $3, $4, $5) RETURNING ` + enrollmentColumns
	return s.db(ctx).QueryRow(ctx, query, e.ID, e.Code, e.ClientType, e.DisplayName, e.ExpiresAt).Scan(
		&e.ID, &e.Code, &e.UserID, &e.ClientType, &e.DisplayName,
		&e.Status, &e.ExpiresAt, &e.CreatedAt, &e.UpdatedAt, &e.Version,
	)
}

// GetAuthDeviceEnrollmentByCode looks up a pending enrollment by the user-facing PIN.
func (s *PostgresStore) GetAuthDeviceEnrollmentByCode(ctx context.Context, code string) (*domain.AuthDeviceEnrollment, error) {
	query := `SELECT ` + enrollmentColumns + ` FROM auth_device_enrollments WHERE code = $1`
	return scanAuthDeviceEnrollment(s.db(ctx).QueryRow(ctx, query, code))
}

// GetAuthDeviceEnrollmentByID looks up an enrollment by its ID (for polling).
func (s *PostgresStore) GetAuthDeviceEnrollmentByID(ctx context.Context, id string) (*domain.AuthDeviceEnrollment, error) {
	query := `SELECT ` + enrollmentColumns + ` FROM auth_device_enrollments WHERE id = $1`
	return scanAuthDeviceEnrollment(s.db(ctx).QueryRow(ctx, query, id))
}

// ApproveAuthDeviceEnrollment marks an enrollment as approved and links it to a user.
func (s *PostgresStore) ApproveAuthDeviceEnrollment(ctx context.Context, id, userID string) error {
	query := `UPDATE auth_device_enrollments SET status = $1, user_id = $2 WHERE id = $3 AND status = $4`
	cmd, err := s.db(ctx).Exec(ctx, query, domain.EnrollmentStatusApproved, userID, id, domain.EnrollmentStatusPending)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrEnrollmentNotFound
	}
	return nil
}

// MarkAuthDeviceEnrollmentExchanged marks it exchanged.
func (s *PostgresStore) MarkAuthDeviceEnrollmentExchanged(ctx context.Context, id string) error {
	query := `UPDATE auth_device_enrollments SET status = $1 WHERE id = $2 AND status = $3`
	cmd, err := s.db(ctx).Exec(ctx, query, domain.EnrollmentStatusExchanged, id, domain.EnrollmentStatusApproved)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrEnrollmentNotFound
	}
	return nil
}

// CreateAuthDevice saves a new linked device.
func (s *PostgresStore) CreateAuthDevice(ctx context.Context, d *domain.AuthDevice) error {
	query := `INSERT INTO auth_devices (id, user_id, client_type, display_name, credential_hash) 
		VALUES ($1, $2, $3, $4, $5) RETURNING ` + deviceColumns
	return s.db(ctx).QueryRow(ctx, query, d.ID, d.UserID, d.ClientType, d.DisplayName, d.CredentialHash).Scan(
		&d.ID, &d.UserID, &d.ClientType, &d.DisplayName, &d.CredentialHash,
		&d.LastSeenAt, &d.RevokedAt, &d.CredentialVersion, &d.Metadata,
		&d.CreatedAt, &d.UpdatedAt, &d.Version,
	)
}

// GetAuthDevice retrieves a device by ID.
func (s *PostgresStore) GetAuthDevice(ctx context.Context, id string) (*domain.AuthDevice, error) {
	query := `SELECT ` + deviceColumns + ` FROM auth_devices WHERE id = $1`
	return scanAuthDevice(s.db(ctx).QueryRow(ctx, query, id))
}

// UpdateAuthDeviceLastSeen updates the last_seen_at timestamp.
func (s *PostgresStore) UpdateAuthDeviceLastSeen(ctx context.Context, id string) error {
	query := `UPDATE auth_devices SET last_seen_at = $1 WHERE id = $2`
	_, err := s.db(ctx).Exec(ctx, query, time.Now(), id)
	return err
}

// RevokeAuthDevice revokes a device.
func (s *PostgresStore) RevokeAuthDevice(ctx context.Context, id string) error {
	query := `UPDATE auth_devices SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL`
	_, err := s.db(ctx).Exec(ctx, query, time.Now(), id)
	return err
}

// ListAuthDevicesByUser returns all devices for a given user.
func (s *PostgresStore) ListAuthDevicesByUser(ctx context.Context, userID string) ([]domain.AuthDevice, error) {
	query := `SELECT ` + deviceColumns + ` FROM auth_devices WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := s.db(ctx).Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var res []domain.AuthDevice
	for rows.Next() {
		d, err := scanAuthDevice(rows)
		if err != nil {
			return nil, err
		}
		res = append(res, *d)
	}
	return res, rows.Err()
}
