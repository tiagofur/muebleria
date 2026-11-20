package storage

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1651: bulk price updates of the factory catalog. Preview reads the current
// prices; Apply re-locks every row, verifies the version each change was
// previewed at and writes all prices + history + one audit row atomically
// (all-or-nothing). cost_per_m2 of materials is generated from board_price.

// priceTable describes the priced column of one resource kind.
type priceTable struct {
	table, priceCol, categoryCol, groupCol string
}

func priceTableFor(kind domain.PriceResourceKind) (priceTable, error) {
	switch kind {
	case domain.PriceResourceMaterial:
		return priceTable{"material_boards", "board_price", "category_id::text", "manufacturer"}, nil
	case domain.PriceResourceEdge:
		return priceTable{"edge_bands", "cost_per_ml", "NULL::text", "NULL::text"}, nil
	case domain.PriceResourceHardware:
		return priceTable{"hardwares", "cost_per_unit", "category_id::text", "brand"}, nil
	}
	return priceTable{}, fmt.Errorf("unknown price resource kind %q", kind)
}

// PriceItemFilter narrows the items of a percent adjustment.
type PriceItemFilter struct {
	CategoryID      string
	Group           string
	IDs             []string
	IncludeInactive bool
}

// ListPricedItems returns the current price state of one kind for the
// caller's organization, ordered by code.
func (s *PostgresStore) ListPricedItems(ctx context.Context, kind domain.PriceResourceKind, filter PriceItemFilter) ([]domain.PricedItem, error) {
	t, err := priceTableFor(kind)
	if err != nil {
		return nil, err
	}
	var out []domain.PricedItem
	err = s.inTenantTx(ctx, func(ctx context.Context) error {
		query := fmt.Sprintf(`
			SELECT id::text, code, name, %s::float8, version, COALESCE(%s, ''), COALESCE(%s, ''), active
			FROM %s
			WHERE organization_id = $1
			  AND ($2 OR active)
			  AND ($3 = '' OR COALESCE(%s, '') = $3)
			  AND ($4 = '' OR COALESCE(%s, '') = $4)
			  AND (cardinality($5::text[]) = 0 OR id::text = ANY($5::text[]))
			ORDER BY code`, t.priceCol, t.categoryCol, t.groupCol, t.table, t.categoryCol, t.groupCol)
		ids := filter.IDs
		if ids == nil {
			ids = []string{}
		}
		rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx), filter.IncludeInactive, filter.CategoryID, filter.Group, ids)
		if err != nil {
			return fmt.Errorf("list priced items: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var it domain.PricedItem
			if err := rows.Scan(&it.ID, &it.Code, &it.Name, &it.Price, &it.Version, &it.Category, &it.Group, &it.Active); err != nil {
				return fmt.Errorf("scan priced item: %w", err)
			}
			out = append(out, it)
		}
		return rows.Err()
	})
	return out, err
}

// PriceUpdateItem is one change to apply, pinned to its previewed version.
type PriceUpdateItem struct {
	ID              string
	ExpectedVersion int64
	NewPrice        float64
}

// ApplyPriceUpdateCommand is one bulk price update.
type ApplyPriceUpdateCommand struct {
	Kind        domain.PriceResourceKind
	Source      string // "percent" | "import"
	Note        string
	Percent     *float64
	Items       []PriceUpdateItem
	ActorUserID string
	IP          string
	RequestID   string
}

// ApplyPriceUpdateResult reports the applied batch.
type ApplyPriceUpdateResult struct {
	BatchID   string
	Applied   int
	AppliedAt time.Time
}

// ErrPriceUpdateStale lists the items whose version changed since preview
// (or that no longer exist); nothing was applied.
type ErrPriceUpdateStale struct {
	IDs []string
}

func (e *ErrPriceUpdateStale) Error() string {
	return fmt.Sprintf("%d price item(s) changed since preview", len(e.IDs))
}

// IsPriceUpdateStale unwraps ErrPriceUpdateStale.
func IsPriceUpdateStale(err error) (*ErrPriceUpdateStale, bool) {
	var stale *ErrPriceUpdateStale
	ok := errors.As(err, &stale)
	return stale, ok
}

// ApplyPriceUpdate applies every change or none.
func (s *PostgresStore) ApplyPriceUpdate(ctx context.Context, cmd ApplyPriceUpdateCommand) (*ApplyPriceUpdateResult, error) {
	t, err := priceTableFor(cmd.Kind)
	if err != nil {
		return nil, err
	}
	if len(cmd.Items) == 0 || cmd.ActorUserID == "" {
		return nil, fmt.Errorf("price update requires items and a server actor")
	}
	var out *ApplyPriceUpdateResult
	err = s.inTenantTx(ctx, func(ctx context.Context) error {
		org := OrgFromCtx(ctx)
		items := append([]PriceUpdateItem(nil), cmd.Items...)
		// Deterministic lock order avoids deadlocks between concurrent batches.
		sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
		ids := make([]string, len(items))
		for i, it := range items {
			ids[i] = it.ID
		}
		type current struct {
			code    string
			price   float64
			version int64
		}
		state := map[string]current{}
		rows, err := s.db(ctx).Query(ctx, fmt.Sprintf(`
			SELECT id::text, code, %s::float8, version FROM %s
			WHERE organization_id = $1 AND id::text = ANY($2::text[])
			ORDER BY id FOR UPDATE`, t.priceCol, t.table), org, ids)
		if err != nil {
			return fmt.Errorf("lock priced items: %w", err)
		}
		for rows.Next() {
			var id string
			var c current
			if err := rows.Scan(&id, &c.code, &c.price, &c.version); err != nil {
				rows.Close()
				return err
			}
			state[id] = c
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		var stale []string
		for _, it := range items {
			c, ok := state[it.ID]
			if !ok || c.version != it.ExpectedVersion {
				stale = append(stale, it.ID)
			}
		}
		if len(stale) > 0 {
			return &ErrPriceUpdateStale{IDs: stale}
		}
		batchID := uuid.NewString()
		var appliedAt time.Time
		for _, it := range items {
			c := state[it.ID]
			if _, err := s.db(ctx).Exec(ctx, fmt.Sprintf(`
				UPDATE %s SET %s = $1, updated_at = CURRENT_TIMESTAMP, version = version + 1
				WHERE id = $2 AND organization_id = $3 AND version = $4`, t.table, t.priceCol),
				it.NewPrice, it.ID, org, it.ExpectedVersion); err != nil {
				return fmt.Errorf("update price %s: %w", c.code, err)
			}
			if err := s.db(ctx).QueryRow(ctx, `
				INSERT INTO catalog_price_history
					(id, organization_id, batch_id, resource_kind, resource_id, resource_code,
					 old_price, new_price, source, note, changed_by)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULLIF($10, ''), $11)
				RETURNING changed_at`,
				uuid.NewString(), org, batchID, string(cmd.Kind), it.ID, c.code,
				domain.RoundPrice(c.price), it.NewPrice, cmd.Source, cmd.Note, cmd.ActorUserID).Scan(&appliedAt); err != nil {
				return fmt.Errorf("insert price history: %w", err)
			}
		}
		details := map[string]interface{}{
			"batch_id": batchID,
			"kind":     string(cmd.Kind),
			"source":   cmd.Source,
			"items":    len(items),
		}
		if cmd.Percent != nil {
			details["percent"] = *cmd.Percent
		}
		if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
			EventType:      "catalog_prices_updated",
			ActorUserID:    cmd.ActorUserID,
			OrganizationID: org,
			IP:             cmd.IP,
			RequestID:      cmd.RequestID,
			Details:        details,
		}); err != nil {
			return fmt.Errorf("audit catalog_prices_updated: %w", err)
		}
		out = &ApplyPriceUpdateResult{BatchID: batchID, Applied: len(items), AppliedAt: appliedAt}
		return nil
	})
	return out, err
}

// PriceHistoryEntry is one recorded price change.
type PriceHistoryEntry struct {
	BatchID   string
	Code      string
	OldPrice  float64
	NewPrice  float64
	Source    string
	Note      string
	ChangedBy string
	ChangedAt time.Time
}

// ListPriceHistory returns the newest-first price history of one resource.
func (s *PostgresStore) ListPriceHistory(ctx context.Context, kind domain.PriceResourceKind, resourceID string, limit int) ([]PriceHistoryEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var out []PriceHistoryEntry
	err := s.inTenantTx(ctx, func(ctx context.Context) error {
		rows, err := s.db(ctx).Query(ctx, `
			SELECT batch_id::text, resource_code, old_price::float8, new_price::float8, source,
			       COALESCE(note, ''), changed_by::text, changed_at
			FROM catalog_price_history
			WHERE organization_id = $1 AND resource_kind = $2 AND resource_id::text = $3
			ORDER BY changed_at DESC, id DESC
			LIMIT $4`, OrgFromCtx(ctx), string(kind), resourceID, limit)
		if err != nil {
			return fmt.Errorf("list price history: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var e PriceHistoryEntry
			if err := rows.Scan(&e.BatchID, &e.Code, &e.OldPrice, &e.NewPrice, &e.Source, &e.Note, &e.ChangedBy, &e.ChangedAt); err != nil {
				return err
			}
			out = append(out, e)
		}
		return rows.Err()
	})
	return out, err
}
