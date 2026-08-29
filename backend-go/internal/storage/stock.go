package storage

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ListStock returns every tracked material with its live balance + minimum.
func (s *PostgresStore) ListStock(ctx context.Context) ([]domain.MaterialStock, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT kind, material_id, quantity, min_stock, updated_at
		FROM material_stock
		WHERE organization_id = $1
		ORDER BY kind, material_id
	`, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stock []domain.MaterialStock
	for rows.Next() {
		var st domain.MaterialStock
		if err := rows.Scan(&st.Kind, &st.MaterialID, &st.Quantity, &st.MinStock, &st.UpdatedAt); err != nil {
			return nil, err
		}
		stock = append(stock, st)
	}
	if stock == nil {
		stock = []domain.MaterialStock{}
	}
	return stock, rows.Err()
}

// UpsertStockMin sets the minimum-stock threshold of a material. Creates the
// row (quantity 0) when the material was never tracked — the dashboard shows
// it as agotado until an entrada arrives.
func (s *PostgresStore) UpsertStockMin(ctx context.Context, kind domain.StockMaterialKind, materialID string, minStock float64) (domain.MaterialStock, error) {
	var st domain.MaterialStock
	err := s.db(ctx).QueryRow(ctx, `
		INSERT INTO material_stock (kind, material_id, quantity, min_stock, organization_id)
		VALUES ($1, $2, 0, $3, $4)
		ON CONFLICT (kind, material_id, organization_id) DO UPDATE SET
			min_stock = EXCLUDED.min_stock,
			updated_at = CURRENT_TIMESTAMP
		RETURNING kind, material_id, quantity, min_stock, updated_at
	`, kind, materialID, minStock, OrgFromCtx(ctx)).Scan(&st.Kind, &st.MaterialID, &st.Quantity, &st.MinStock, &st.UpdatedAt)
	return st, err
}

// GetStockMovementByID loads one ledger row (used to validate reversions).
func (s *PostgresStore) GetStockMovementByID(ctx context.Context, id string) (*domain.StockMovement, error) {
	row := s.db(ctx).QueryRow(ctx, `
		SELECT id, kind, material_id, type, delta, balance_after,
		       project_id, note, reverts_id, by_user_id, by_name, at
		FROM stock_movements WHERE id = $1 AND organization_id = $2
	`, id, OrgFromCtx(ctx))
	var m domain.StockMovement
	if err := row.Scan(&m.ID, &m.Kind, &m.MaterialID, &m.Type, &m.Delta, &m.BalanceAfter,
		&m.ProjectID, &m.Note, &m.RevertsID, &m.ByUserID, &m.ByName, &m.At); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

// GetStockMovementByRevertsID loads a ledger row that reverts the given movement id.
func (s *PostgresStore) GetStockMovementByRevertsID(ctx context.Context, revertsID string) (*domain.StockMovement, error) {
	row := s.db(ctx).QueryRow(ctx, `
		SELECT id, kind, material_id, type, delta, balance_after,
		       project_id, note, reverts_id, by_user_id, by_name, at
		FROM stock_movements WHERE reverts_id = $1 AND organization_id = $2
	`, revertsID, OrgFromCtx(ctx))
	var m domain.StockMovement
	if err := row.Scan(&m.ID, &m.Kind, &m.MaterialID, &m.Type, &m.Delta, &m.BalanceAfter,
		&m.ProjectID, &m.Note, &m.RevertsID, &m.ByUserID, &m.ByName, &m.At); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

// RecordStockMovement appends a ledger row and updates the live balance in one
// transaction. Invariants (06-stock-almacen.md §2.1):
//   - balance_after = previous balance + delta (never trusted from cache)
//   - only `entrada` creates the row; other types on untracked materials fail
//   - a negative balance is rejected (ErrStockInsufficient)
func (s *PostgresStore) RecordStockMovement(ctx context.Context, mov domain.StockMovement) (domain.StockMovement, error) {
	tx, err := s.beginTx(ctx)
	if err != nil {
		return mov, err
	}
	defer tx.Rollback(ctx)

	saved, err := recordStockMovementTx(ctx, tx, mov)
	if err != nil {
		return mov, err
	}
	if err := tx.Commit(ctx); err != nil {
		return mov, err
	}
	return saved, nil
}

// recordStockMovementTx is the shared transactional core: lock the balance row,
// compute balance_after, upsert the live balance and insert the ledger row. It
// runs inside the caller's transaction so multi-step operations (e.g. PO
// reception) stay atomic.
func recordStockMovementTx(ctx context.Context, tx pgx.Tx, mov domain.StockMovement) (domain.StockMovement, error) {
	// Lock the balance row so concurrent movements serialize per material.
	var current float64
	exists := true
	err := tx.QueryRow(ctx, `
		SELECT quantity FROM material_stock
		WHERE kind = $1 AND material_id = $2 AND organization_id = $3 FOR UPDATE
	`, mov.Kind, mov.MaterialID, OrgFromCtx(ctx)).Scan(&current)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			exists = false
		} else {
			return mov, err
		}
	}

	if !exists {
		if mov.Type != domain.StockMovementEntrada {
			return mov, domain.ErrStockNotTracked
		}
		current = 0
	}

	balance := current + mov.Delta
	if balance < 0 {
		return mov, fmt.Errorf("%w: faltan %.2f", domain.ErrStockInsufficient, -balance)
	}

	if !exists {
		_, err = tx.Exec(ctx, `
			INSERT INTO material_stock (kind, material_id, quantity, min_stock, organization_id)
			VALUES ($1, $2, $3, 0, $4)
		`, mov.Kind, mov.MaterialID, balance, OrgFromCtx(ctx))
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE material_stock SET quantity = $3, updated_at = CURRENT_TIMESTAMP
			WHERE kind = $1 AND material_id = $2 AND organization_id = $4
		`, mov.Kind, mov.MaterialID, balance, OrgFromCtx(ctx))
	}
	if err != nil {
		return mov, err
	}

	var saved domain.StockMovement
	err = tx.QueryRow(ctx, `
		INSERT INTO stock_movements (kind, material_id, type, delta, balance_after,
		                             project_id, note, reverts_id, by_user_id, by_name, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, kind, material_id, type, delta, balance_after,
		          project_id, note, reverts_id, by_user_id, by_name, at
	`, mov.Kind, mov.MaterialID, mov.Type, mov.Delta, balance,
		mov.ProjectID, mov.Note, mov.RevertsID, mov.ByUserID, mov.ByName, OrgFromCtx(ctx),
	).Scan(&saved.ID, &saved.Kind, &saved.MaterialID, &saved.Type, &saved.Delta, &saved.BalanceAfter,
		&saved.ProjectID, &saved.Note, &saved.RevertsID, &saved.ByUserID, &saved.ByName, &saved.At)
	return saved, err
}

// ListStockMovements returns the ledger, newest first. kind/materialID/projectID filter
// optionally; limit caps the page (handler enforces max).
func (s *PostgresStore) ListStockMovements(ctx context.Context, kind domain.StockMaterialKind, materialID string, projectID string, limit int) ([]domain.StockMovement, error) {
	query := `
		SELECT id, kind, material_id, type, delta, balance_after,
		       project_id, note, reverts_id, by_user_id, by_name, at
		FROM stock_movements
	`
	whereClauses := []string{"organization_id = $1"}
	args := []any{OrgFromCtx(ctx)}
	if kind != "" {
		args = append(args, kind)
		whereClauses = append(whereClauses, fmt.Sprintf("kind = $%d", len(args)))
	}
	if materialID != "" {
		args = append(args, materialID)
		whereClauses = append(whereClauses, fmt.Sprintf("material_id = $%d", len(args)))
	}
	if projectID != "" {
		args = append(args, projectID)
		whereClauses = append(whereClauses, fmt.Sprintf("project_id = $%d", len(args)))
	}
	if len(whereClauses) > 0 {
		query += " WHERE " + strings.Join(whereClauses, " AND ")
	}
	args = append(args, limit)
	query += fmt.Sprintf(" ORDER BY at DESC LIMIT $%d", len(args))

	rows, err := s.db(ctx).Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var moves []domain.StockMovement
	for rows.Next() {
		var m domain.StockMovement
		if err := rows.Scan(&m.ID, &m.Kind, &m.MaterialID, &m.Type, &m.Delta, &m.BalanceAfter,
			&m.ProjectID, &m.Note, &m.RevertsID, &m.ByUserID, &m.ByName, &m.At); err != nil {
			return nil, err
		}
		moves = append(moves, m)
	}
	if moves == nil {
		moves = []domain.StockMovement{}
	}
	return moves, rows.Err()
}
