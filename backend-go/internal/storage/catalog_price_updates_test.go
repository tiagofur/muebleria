package storage_test

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1651 on real PostgreSQL under the runtime role.

const (
	priceBoardB  = "70000000-0000-0000-0000-0000000016b1" // org B board with the same code
	priceBoardA2 = "70000000-0000-0000-0000-0000000016a2"
)

func pricedMaterial(t *testing.T, fx *quoteLifecycleFixture, actor storage.TenantActor) []domain.PricedItem {
	t.Helper()
	var items []domain.PricedItem
	if err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
		var err error
		items, err = fx.store.ListPricedItems(ctx, domain.PriceResourceMaterial, storage.PriceItemFilter{IncludeInactive: true})
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return items
}

func applyPrices(t *testing.T, fx *quoteLifecycleFixture, actor storage.TenantActor, items ...storage.PriceUpdateItem) (*storage.ApplyPriceUpdateResult, error) {
	t.Helper()
	var out *storage.ApplyPriceUpdateResult
	err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
		var err error
		out, err = fx.store.ApplyPriceUpdate(ctx, storage.ApplyPriceUpdateCommand{
			Kind: domain.PriceResourceMaterial, Source: "percent", Note: "lista noviembre",
			Items: items, ActorUserID: actor.UserID, RequestID: "price-test",
		})
		return err
	})
	return out, err
}

func boardState(t *testing.T, fx *quoteLifecycleFixture, id string) (price, costPerM2 float64, version int64) {
	t.Helper()
	if err := fx.admin.QueryRow(context.Background(), `SELECT board_price::float8, cost_per_m2::float8, version FROM material_boards WHERE id = $1`, id).Scan(&price, &costPerM2, &version); err != nil {
		t.Fatal(err)
	}
	return
}

func TestCatalogPriceUpdates_AtomicVersionedHistoryAndTenancy(t *testing.T) {
	fx := setupQuoteLifecycleFixture(t)
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO material_boards (id, code, name, width_mm, length_mm, thickness_mm, board_price, organization_id) VALUES
		 ($1, 'MEL-1651', 'Melamina 1651', 1830, 2440, 18, 500, $2),
		 ($3, 'RELEASE-BOARD', 'Org B board', 1830, 2440, 18, 777, $4)`,
		priceBoardA2, rlsOrgA, priceBoardB, rlsOrgB); err != nil {
		t.Fatal(err)
	}

	// Accept Q1 first: its frozen sale total must survive any price change.
	q1 := createInitialRevision(t, fx).Revision
	publishRevision(t, fx, q1.ID)
	acceptRevision(t, fx, q1.ID)
	before, err := summaryFor(t, fx, fiActorA(), fx.projectID)
	if err != nil || before.AcceptedQuote == nil {
		t.Fatalf("accepted quote: %+v %v", before, err)
	}

	// Org A sees only its own boards (same code exists in org B).
	items := pricedMaterial(t, fx, fiActorA())
	versions := map[string]int64{}
	for _, it := range items {
		versions[it.ID] = it.Version
		if it.ID == priceBoardB {
			t.Fatal("org A lists an org B board")
		}
	}
	_, costBefore, _ := boardState(t, fx, releaseMaterial)

	// 1. All-or-nothing: one stale item blocks the whole batch.
	_, err = applyPrices(t, fx, fiActorA(),
		storage.PriceUpdateItem{ID: releaseMaterial, ExpectedVersion: versions[releaseMaterial], NewPrice: 1500},
		storage.PriceUpdateItem{ID: priceBoardA2, ExpectedVersion: versions[priceBoardA2] + 7, NewPrice: 600},
	)
	stale, ok := storage.IsPriceUpdateStale(err)
	if !ok || len(stale.IDs) != 1 || stale.IDs[0] != priceBoardA2 {
		t.Fatalf("stale batch: %v", err)
	}
	if price, _, _ := boardState(t, fx, releaseMaterial); price != 1000 {
		t.Fatalf("stale batch leaked a price: %v", price)
	}

	// 2. Apply: prices, version, generated cost_per_m2, history and audit.
	res, err := applyPrices(t, fx, fiActorA(),
		storage.PriceUpdateItem{ID: releaseMaterial, ExpectedVersion: versions[releaseMaterial], NewPrice: 1500},
		storage.PriceUpdateItem{ID: priceBoardA2, ExpectedVersion: versions[priceBoardA2], NewPrice: 550},
	)
	if err != nil || res.Applied != 2 {
		t.Fatalf("apply: %+v %v", res, err)
	}
	price, costAfter, version := boardState(t, fx, releaseMaterial)
	if price != 1500 || version != versions[releaseMaterial]+1 || costAfter <= costBefore {
		t.Fatalf("board after apply: price=%v cost=%v->%v version=%d", price, costBefore, costAfter, version)
	}
	var history []storage.PriceHistoryEntry
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		history, err = fx.store.ListPriceHistory(ctx, domain.PriceResourceMaterial, releaseMaterial, 10)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 || history[0].OldPrice != 1000 || history[0].NewPrice != 1500 || history[0].BatchID != res.BatchID || history[0].ChangedBy != rlsUserA || history[0].Note != "lista noviembre" {
		t.Fatalf("history: %+v", history)
	}
	var audits int
	if err := fx.admin.QueryRow(ctx, `SELECT COUNT(*) FROM security_audit_events WHERE event_type = 'catalog_prices_updated' AND details->>'batch_id' = $1`, res.BatchID).Scan(&audits); err != nil || audits != 1 {
		t.Fatalf("audit rows: %d %v", audits, err)
	}

	// 3. The accepted quote keeps its frozen total.
	after, err := summaryFor(t, fx, fiActorA(), fx.projectID)
	if err != nil || after.AcceptedQuote.SaleTotal != before.AcceptedQuote.SaleTotal {
		t.Fatalf("accepted quote changed: %v -> %v (%v)", before.AcceptedQuote.SaleTotal, after.AcceptedQuote.SaleTotal, err)
	}

	// 4. Org B cannot touch org A's board, nor read its history.
	_, err = applyPrices(t, fx, fiActorB(), storage.PriceUpdateItem{ID: releaseMaterial, ExpectedVersion: version, NewPrice: 1})
	if _, ok := storage.IsPriceUpdateStale(err); !ok {
		t.Fatalf("org B apply on org A board: %v", err)
	}
	if err := fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		h, err := fx.store.ListPriceHistory(ctx, domain.PriceResourceMaterial, releaseMaterial, 10)
		if err == nil && len(h) != 0 {
			t.Fatalf("org B reads org A history: %+v", h)
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if p, _, _ := boardState(t, fx, priceBoardB); p != 777 {
		t.Fatalf("org B board changed: %v", p)
	}

	// 5. Two concurrent batches on the same previewed version: exactly one wins.
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, target := range []float64{2000, 2100} {
		wg.Add(1)
		go func(i int, target float64) {
			defer wg.Done()
			_, errs[i] = applyPrices(t, fx, fiActorA(), storage.PriceUpdateItem{ID: releaseMaterial, ExpectedVersion: version, NewPrice: target})
		}(i, target)
	}
	wg.Wait()
	wins, stales := 0, 0
	for _, err := range errs {
		if err == nil {
			wins++
		} else if _, ok := storage.IsPriceUpdateStale(err); ok {
			stales++
		} else {
			t.Fatalf("race error: %v", err)
		}
	}
	if wins != 1 || stales != 1 {
		t.Fatalf("race: wins=%d stales=%d", wins, stales)
	}

	// 6. History is append-only for the runtime role.
	for _, stmt := range []string{`UPDATE catalog_price_history SET new_price = 0`, `DELETE FROM catalog_price_history`} {
		withRLSActor(t, fx.app, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
			if _, err := tx.Exec(ctx, stmt); err == nil || !strings.Contains(err.Error(), "permission denied") {
				t.Fatalf("%s: %v", stmt, err)
			}
		})
	}
}
