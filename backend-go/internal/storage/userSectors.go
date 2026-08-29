package storage

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ListUserSectors returns all sector assignments for a user.
func (s *PostgresStore) ListUserSectors(ctx context.Context, userID string) ([]domain.UserSector, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT user_id, sector, sub_sector, created_at
		FROM user_sectors
		WHERE user_id = $1 AND organization_id = $2
		ORDER BY sector, sub_sector
	`, userID, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanUserSectors(rows)
}

// SetUserSectors replaces all sector assignments for a user (transactional delete+insert).
func (s *PostgresStore) SetUserSectors(ctx context.Context, userID string, sectors []domain.UserSector) error {
	tx, err := s.beginTx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Delete existing (only the active organization's assignments — the same
	// operator may work in other talleres).
	if _, err := tx.Exec(ctx, `DELETE FROM user_sectors WHERE user_id = $1 AND organization_id = $2`, userID, OrgFromCtx(ctx)); err != nil {
		return err
	}

	// Insert new
	for _, sec := range sectors {
		if _, err := tx.Exec(ctx, `
			INSERT INTO user_sectors (user_id, sector, sub_sector, organization_id)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (user_id, sector, sub_sector) DO NOTHING
		`, userID, sec.Sector, sec.SubSector, OrgFromCtx(ctx)); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// GetUsersBySector returns all users assigned to a given sector.
func (s *PostgresStore) GetUsersBySector(ctx context.Context, sector string) ([]domain.User, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT u.id, u.email, u.name, u.active, u.created_at, u.updated_at
		FROM users u
		INNER JOIN user_sectors us ON us.user_id = u.id
		WHERE us.sector = $1 AND u.active = true AND us.organization_id = $2
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
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Active, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	if users == nil {
		users = []domain.User{}
	}
	return users, rows.Err()
}
