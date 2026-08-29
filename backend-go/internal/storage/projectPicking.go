package storage

import (
	"context"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ListAllPicking returns every project × material picking row (Fase 3 —
// Compras/Almacén). Oldest first by project, then material. The display name
// of who marked the despacho is joined from users.
func (s *PostgresStore) ListAllPicking(ctx context.Context) ([]domain.ProjectPicking, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT pp.project_id, pp.material, pp.status, pp.marked_at, pp.marked_by, u.name
		FROM project_picking pp
		LEFT JOIN users u ON u.id = pp.marked_by
		WHERE pp.organization_id = $1
		ORDER BY pp.project_id, pp.material
	`, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var picks []domain.ProjectPicking
	for rows.Next() {
		var p domain.ProjectPicking
		if err := rows.Scan(&p.ProjectID, &p.Material, &p.Status, &p.MarkedAt, &p.MarkedBy, &p.MarkedByName); err != nil {
			return nil, err
		}
		picks = append(picks, p)
	}
	if picks == nil {
		picks = []domain.ProjectPicking{}
	}
	return picks, rows.Err()
}

// UpsertProjectPicking sets one project × material picking row (idempotent).
// MarkedAt/MarkedBy are stamped by the caller (the API handler) so the server
// is the single source of who/when — clients never supply them.
func (s *PostgresStore) UpsertProjectPicking(ctx context.Context, pick domain.ProjectPicking) error {
	_, err := s.db(ctx).Exec(ctx, `
		INSERT INTO project_picking (project_id, material, status, marked_at, marked_by, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (project_id, material, organization_id) DO UPDATE SET
			status    = EXCLUDED.status,
			marked_at = EXCLUDED.marked_at,
			marked_by = EXCLUDED.marked_by
	`, pick.ProjectID, pick.Material, pick.Status, pick.MarkedAt, pick.MarkedBy, OrgFromCtx(ctx))
	return err
}
