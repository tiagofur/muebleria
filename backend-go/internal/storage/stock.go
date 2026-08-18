package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ListStock returns every tracked material with its live balance + minimum.
func (s *PostgresStore) ListStock(ctx context.Context) ([]domain.MaterialStock, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT kind, material_id, quantity, min_stock, updated_at
		FROM material_stock
		ORDER BY kind, material_id
	`)
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
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO material_stock (kind, material_id, quantity, min_stock)
		VALUES ($1, $2, 0, $3)
		ON CONFLICT (kind, material_id) DO UPDATE SET
			min_stock = EXCLUDED.min_stock,
			updated_at = CURRENT_TIMESTAMP
		RETURNING kind, material_id, quantity, min_stock, updated_at
	`, kind, materialID, minStock).Scan(&st.Kind, &st.MaterialID, &st.Quantity, &st.MinStock, &st.UpdatedAt)
	return st, err
}

// GetStockMovementByID loads one ledger row (used to validate reversions).
func (s *PostgresStore) GetStockMovementByID(ctx context.Context, id string) (*domain.StockMovement, error) {
	row := s.Pool.QueryRow(ctx, `
		SELECT id, kind, material_id, type, delta, balance_after,
		       project_id, note, reverts_id, by_user_id, by_name, at
		FROM stock_movements WHERE id = $1
	`, id)
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
	tx, err := s.Pool.Begin(ctx)
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
		WHERE kind = $1 AND material_id = $2 FOR UPDATE
	`, mov.Kind, mov.MaterialID).Scan(&current)
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
			INSERT INTO material_stock (kind, material_id, quantity, min_stock)
			VALUES ($1, $2, $3, 0)
		`, mov.Kind, mov.MaterialID, balance)
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE material_stock SET quantity = $3, updated_at = CURRENT_TIMESTAMP
			WHERE kind = $1 AND material_id = $2
		`, mov.Kind, mov.MaterialID, balance)
	}
	if err != nil {
		return mov, err
	}

	var saved domain.StockMovement
	err = tx.QueryRow(ctx, `
		INSERT INTO stock_movements (kind, material_id, type, delta, balance_after,
		                             project_id, note, reverts_id, by_user_id, by_name)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, kind, material_id, type, delta, balance_after,
		          project_id, note, reverts_id, by_user_id, by_name, at
	`, mov.Kind, mov.MaterialID, mov.Type, mov.Delta, balance,
		mov.ProjectID, mov.Note, mov.RevertsID, mov.ByUserID, mov.ByName,
	).Scan(&saved.ID, &saved.Kind, &saved.MaterialID, &saved.Type, &saved.Delta, &saved.BalanceAfter,
		&saved.ProjectID, &saved.Note, &saved.RevertsID, &saved.ByUserID, &saved.ByName, &saved.At)
	return saved, err
}

// ListStockMovements returns the ledger, newest first. kind/materialID filter
// optionally; limit caps the page (handler enforces max).
func (s *PostgresStore) ListStockMovements(ctx context.Context, kind domain.StockMaterialKind, materialID string, limit int) ([]domain.StockMovement, error) {
	query := `
		SELECT id, kind, material_id, type, delta, balance_after,
		       project_id, note, reverts_id, by_user_id, by_name, at
		FROM stock_movements
	`
	args := []any{}
	if kind != "" {
		args = append(args, kind)
		query += ` WHERE kind = $` + fmt.Sprint(len(args))
	}
	if materialID != "" {
		args = append(args, materialID)
		if len(args) == 1 {
			query += ` WHERE material_id = $1`
		} else {
			query += ` AND material_id = $` + fmt.Sprint(len(args))
		}
	}
	args = append(args, limit)
	query += ` ORDER BY at DESC LIMIT $` + fmt.Sprint(len(args))

	rows, err := s.Pool.Query(ctx, query, args...)
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
