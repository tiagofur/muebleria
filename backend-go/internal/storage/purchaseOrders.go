package storage

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ─── Suppliers ─────────────────────────────────────────────────────────────

func (s *PostgresStore) ListSuppliers(ctx context.Context) ([]domain.Supplier, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, name, contact_name, email, phone, notes, active, created_at, updated_at
		FROM suppliers
		ORDER BY name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.Supplier
	for rows.Next() {
		var sp domain.Supplier
		if err := rows.Scan(&sp.ID, &sp.Name, &sp.ContactName, &sp.Email, &sp.Phone,
			&sp.Notes, &sp.Active, &sp.CreatedAt, &sp.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, sp)
	}
	if list == nil {
		list = []domain.Supplier{}
	}
	return list, rows.Err()
}

func (s *PostgresStore) CreateSupplier(ctx context.Context, sp domain.Supplier) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO suppliers (id, name, contact_name, email, phone, notes, active)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, sp.ID, sp.Name, sp.ContactName, sp.Email, sp.Phone, sp.Notes, sp.Active)
	return err
}

func (s *PostgresStore) UpdateSupplier(ctx context.Context, sp domain.Supplier) error {
	_, err := s.Pool.Exec(ctx, `
		UPDATE suppliers SET name = $2, contact_name = $3, email = $4, phone = $5,
			notes = $6, active = $7, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, sp.ID, sp.Name, sp.ContactName, sp.Email, sp.Phone, sp.Notes, sp.Active)
	return err
}

func (s *PostgresStore) DeactivateSupplier(ctx context.Context, id string) error {
	_, err := s.Pool.Exec(ctx, `
		UPDATE suppliers SET active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1
	`, id)
	return err
}

// ─── Purchase orders ───────────────────────────────────────────────────────

const poColumns = `id, number, supplier_id, status, notes, created_at, updated_at, received_at, created_by`

func scanPurchaseOrder(row pgx.Row) (domain.PurchaseOrder, error) {
	var po domain.PurchaseOrder
	err := row.Scan(&po.ID, &po.Number, &po.SupplierID, &po.Status, &po.Notes,
		&po.CreatedAt, &po.UpdatedAt, &po.ReceivedAt, &po.CreatedBy)
	return po, err
}

func (s *PostgresStore) ListPurchaseOrders(ctx context.Context) ([]domain.PurchaseOrder, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT `+poColumns+` FROM purchase_orders ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.PurchaseOrder
	for rows.Next() {
		var po domain.PurchaseOrder
		if err := rows.Scan(&po.ID, &po.Number, &po.SupplierID, &po.Status, &po.Notes,
			&po.CreatedAt, &po.UpdatedAt, &po.ReceivedAt, &po.CreatedBy); err != nil {
			return nil, err
		}
		list = append(list, po)
	}
	if list == nil {
		list = []domain.PurchaseOrder{}
	}
	return list, rows.Err()
}

func (s *PostgresStore) GetPurchaseOrderByID(ctx context.Context, id string) (*domain.PurchaseOrder, error) {
	po, err := scanPurchaseOrder(s.Pool.QueryRow(ctx, `
		SELECT `+poColumns+` FROM purchase_orders WHERE id = $1
	`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	items, err := s.listPOItems(ctx, id)
	if err != nil {
		return nil, err
	}
	po.Items = items
	return &po, nil
}

func (s *PostgresStore) listPOItems(ctx context.Context, poID string) ([]domain.PurchaseOrderItem, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT kind, material_id, quantity, received_quantity
		FROM purchase_order_items WHERE po_id = $1
		ORDER BY kind, material_id
	`, poID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []domain.PurchaseOrderItem
	for rows.Next() {
		var it domain.PurchaseOrderItem
		if err := rows.Scan(&it.Kind, &it.MaterialID, &it.Quantity, &it.ReceivedQuantity); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	if items == nil {
		items = []domain.PurchaseOrderItem{}
	}
	return items, rows.Err()
}

// CreatePurchaseOrder inserts a borrador PO with its items (replace semantics:
// items are deleted + reinserted so the client sends the full line set).
// Returns the saved PO with its generated number.
func (s *PostgresStore) CreatePurchaseOrder(ctx context.Context, po domain.PurchaseOrder) error {
	return s.upsertPOItems(ctx, &po, true)
}

// UpdatePurchaseOrder replaces a borrador PO's fields + items (used for edits).
func (s *PostgresStore) UpdatePurchaseOrder(ctx context.Context, po domain.PurchaseOrder) error {
	return s.upsertPOItems(ctx, &po, false)
}

func (s *PostgresStore) upsertPOItems(ctx context.Context, po *domain.PurchaseOrder, create bool) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if create {
		if po.Number == "" || strings.HasPrefix(po.Number, "OC-PO-") {
			var seq int64
			if err := tx.QueryRow(ctx, `SELECT nextval('purchase_order_number_seq')`).Scan(&seq); err != nil {
				// Fallback if sequence not found
				seq = time.Now().UnixMilli() % 10000
			}
			po.Number = fmt.Sprintf("OC-%04d", seq)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO purchase_orders (id, number, supplier_id, status, notes, created_by)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, po.ID, po.Number, po.SupplierID, domain.POBorrador, po.Notes, po.CreatedBy)
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE purchase_orders SET supplier_id = $2, notes = $3, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1 AND status = 'borrador'
		`, po.ID, po.SupplierID, po.Notes)
	}
	if err != nil {
		return err
	}

	if !create {
		if _, err := tx.Exec(ctx, `DELETE FROM purchase_order_items WHERE po_id = $1`, po.ID); err != nil {
			return err
		}
	}
	for _, it := range po.Items {
		if _, err := tx.Exec(ctx, `
			INSERT INTO purchase_order_items (po_id, kind, material_id, quantity, received_quantity)
			VALUES ($1, $2, $3, $4, 0)
		`, po.ID, it.Kind, it.MaterialID, it.Quantity); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// EmitPurchaseOrder advances borrador → emitida (items frozen).
func (s *PostgresStore) EmitPurchaseOrder(ctx context.Context, id string) (domain.PurchaseOrder, error) {
	po, err := scanPurchaseOrder(s.Pool.QueryRow(ctx, `
		UPDATE purchase_orders SET status = 'emitida', updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND status = 'borrador'
		RETURNING `+poColumns+`
	`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return po, pgx.ErrNoRows
		}
		return po, err
	}
	items, err := s.listPOItems(ctx, id)
	if err != nil {
		return po, err
	}
	po.Items = items
	return po, nil
}

// CancelPurchaseOrder advances borrador/emitida → cancelada.
func (s *PostgresStore) CancelPurchaseOrder(ctx context.Context, id string) (domain.PurchaseOrder, error) {
	po, err := scanPurchaseOrder(s.Pool.QueryRow(ctx, `
		UPDATE purchase_orders SET status = 'cancelada', updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND status IN ('borrador','emitida')
		RETURNING `+poColumns+`
	`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return po, pgx.ErrNoRows
		}
		return po, err
	}
	items, err := s.listPOItems(ctx, id)
	if err != nil {
		return po, err
	}
	po.Items = items
	return po, nil
}

// ReceivePurchaseOrder records stock entradas for the received lines and
// advances the PO — all in ONE transaction. For each line: a stock movement
// (entrada, note "OC-<number>") + received_quantity += qty. When every item
// reaches its quantity, the order becomes 'recibida' (received_at stamped).
func (s *PostgresStore) ReceivePurchaseOrder(ctx context.Context, id string, lines []domain.PurchaseOrderItem, byUserID, byName string) (domain.PurchaseOrder, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return domain.PurchaseOrder{}, err
	}
	defer tx.Rollback(ctx)

	// Lock the PO row so reception serializes (no double counting).
	po, err := scanPurchaseOrder(tx.QueryRow(ctx, `
		SELECT `+poColumns+` FROM purchase_orders WHERE id = $1 FOR UPDATE
	`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.PurchaseOrder{}, pgx.ErrNoRows
		}
		return domain.PurchaseOrder{}, err
	}
	if po.Status != domain.POEmitida {
		return domain.PurchaseOrder{}, domain.ErrPurchaseOrderNotReceivable
	}

	items, err := s.listPOItemsTx(ctx, tx, id)
	if err != nil {
		return domain.PurchaseOrder{}, err
	}

	// Validar que cada línea a recibir pertenezca a la OC y no exceda el remaining
	itemMap := map[string]*domain.PurchaseOrderItem{}
	for i := range items {
		key := string(items[i].Kind) + ":" + items[i].MaterialID
		itemMap[key] = &items[i]
	}

	byQty := map[domain.StockMaterialKind]map[string]float64{}
	for _, line := range lines {
		if line.Quantity <= 0 {
			return domain.PurchaseOrder{}, fmt.Errorf("la cantidad a recibir debe ser mayor a cero")
		}
		key := string(line.Kind) + ":" + line.MaterialID
		poItem, ok := itemMap[key]
		if !ok {
			return domain.PurchaseOrder{}, fmt.Errorf("el material %s (%s) no pertenece a esta orden de compra", line.MaterialID, line.Kind)
		}
		if byQty[line.Kind] == nil {
			byQty[line.Kind] = map[string]float64{}
		}
		byQty[line.Kind][line.MaterialID] += line.Quantity
		if poItem.ReceivedQuantity+byQty[line.Kind][line.MaterialID] > poItem.Quantity+1e-6 {
			return domain.PurchaseOrder{}, fmt.Errorf("la cantidad a recibir de %s excede el restante pendiente", line.MaterialID)
		}
	}

	updated := make([]domain.PurchaseOrderItem, 0, len(items))
	for _, it := range items {
		received := it.ReceivedQuantity + byQty[it.Kind][it.MaterialID]
		updated = append(updated, domain.PurchaseOrderItem{
			Kind:             it.Kind,
			MaterialID:       it.MaterialID,
			Quantity:         it.Quantity,
			ReceivedQuantity: received,
		})
	}
	// Persist received quantities.
	for _, it := range updated {
		if _, err := tx.Exec(ctx, `
			UPDATE purchase_order_items SET received_quantity = $4
			WHERE po_id = $1 AND kind = $2 AND material_id = $3
		`, id, it.Kind, it.MaterialID, it.ReceivedQuantity); err != nil {
			return domain.PurchaseOrder{}, err
		}
	}

	// Stock entradas for every received line (same balance rules as stock.go).
	// Note references the human number (already "OC-XXXXXX") so the ledger
	// links the entrada to the purchase order.
	note := po.Number
	for _, line := range lines {
		if line.Quantity <= 0 {
			continue
		}
		mov := domain.StockMovement{
			Kind:       line.Kind,
			MaterialID: line.MaterialID,
			Type:       domain.StockMovementEntrada,
			Delta:      line.Quantity,
			Note:       &note,
			ByUserID:   &byUserID,
			ByName:     &byName,
		}
		if _, err := recordStockMovementTx(ctx, tx, mov); err != nil {
			return domain.PurchaseOrder{}, err
		}
	}

	status := po.Status
	var receivedAt *time.Time
	if domain.PurchaseOrderFullyReceived(updated) {
		status = domain.PORecibida
		now := time.Now().UTC()
		receivedAt = &now
	}
	if _, err := tx.Exec(ctx, `
		UPDATE purchase_orders SET status = $2, received_at = $3, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, status, receivedAt); err != nil {
		return domain.PurchaseOrder{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.PurchaseOrder{}, err
	}
	po.Status = status
	po.ReceivedAt = receivedAt
	po.Items = updated
	return po, nil
}

func (s *PostgresStore) listPOItemsTx(ctx context.Context, tx pgx.Tx, poID string) ([]domain.PurchaseOrderItem, error) {
	rows, err := tx.Query(ctx, `
		SELECT kind, material_id, quantity, received_quantity
		FROM purchase_order_items WHERE po_id = $1
		ORDER BY kind, material_id
	`, poID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []domain.PurchaseOrderItem
	for rows.Next() {
		var it domain.PurchaseOrderItem
		if err := rows.Scan(&it.Kind, &it.MaterialID, &it.Quantity, &it.ReceivedQuantity); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	if items == nil {
		items = []domain.PurchaseOrderItem{}
	}
	return items, rows.Err()
}
