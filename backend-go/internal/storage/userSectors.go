package storage

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ListUserSectors returns all sector assignments for a user.
func (s *PostgresStore) ListUserSectors(ctx context.Context, userID string) ([]domain.UserSector, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT m.user_id, ms.sector, '', ms.assigned_at
		FROM membership_sectors ms
		JOIN memberships m ON m.id = ms.membership_id
		WHERE m.user_id = $1 AND ms.organization_id = $2
		ORDER BY ms.sector
	`, userID, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanUserSectors(rows)
}

// SetUserSectors replaces assignments through the exact membership in this tenant.
func (s *PostgresStore) SetUserSectors(ctx context.Context, userID string, sectors []domain.UserSector) error {
	tx, err := s.beginTx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var membershipID string
	if err := tx.QueryRow(ctx, `SELECT id FROM memberships WHERE user_id=$1 AND organization_id=$2`, userID, OrgFromCtx(ctx)).Scan(&membershipID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM membership_sectors WHERE membership_id=$1`, membershipID); err != nil {
		return err
	}
	for _, sec := range sectors {
		if _, err := tx.Exec(ctx, `
			INSERT INTO membership_sectors (membership_id, organization_id, sector)
			VALUES ($1, $2, $3) ON CONFLICT (membership_id, sector) DO NOTHING
		`, membershipID, OrgFromCtx(ctx), sec.Sector); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// GetUsersBySector returns all users assigned to a given sector.
func (s *PostgresStore) GetUsersBySector(ctx context.Context, sector string) ([]domain.User, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT u.id, u.email, u.name, u.account_status, u.created_at, u.updated_at
		FROM users u
		INNER JOIN memberships m ON m.user_id = u.id AND m.organization_id = $2
		INNER JOIN membership_sectors ms ON ms.membership_id = m.id
		WHERE ms.sector = $1 AND u.account_status = 'active' AND m.status = 'active'
		ORDER BY u.name
	`, sector, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanUsers(rows)
}

// ─── Scan Helpers ────────────────────────────────────────────────────────────

func scanUserSectors(rows pgx.Rows) ([]domain.UserSector, error) {
	var sectors []domain.UserSector
	for rows.Next() {
		var sec domain.UserSector
		if err := rows.Scan(&sec.UserID, &sec.Sector, &sec.SubSector, &sec.CreatedAt); err != nil {
			return nil, err
		}
		sectors = append(sectors, sec)
	}
	if sectors == nil {
		sectors = []domain.UserSector{}
	}
	return sectors, rows.Err()
}

func scanUsers(rows pgx.Rows) ([]domain.User, error) {
	var users []domain.User
	for rows.Next() {
		var u domain.User
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.AccountStatus, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	if users == nil {
		users = []domain.User{}
	}
	return users, rows.Err()
}
