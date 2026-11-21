package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1662 — price-only requote on real PostgreSQL under the runtime role:
//   - preview writes nothing and reports unchanged totals when prices did not
//     move; the command then refuses (no empty revision);
//   - after a catalog price change, preview reports the new total and the
//     command freezes Q2 as a draft price_refresh revision based on Q1, with
//     the same units, line identities and configuration, and audits it;
//   - the base revision stays byte-identical (immutable history);
//   - a stale base (not the latest) and a draft base are refused; another
//     organization gets the uniform not-found.
func TestQuotePriceRefresh_PreviewCreateAndGuards(t *testing.T) {
	fx := setupQuoteLifecycleFixture(t)
	ctx := context.Background()
	q1 := createInitialRevision(t, fx).Revision.ID

	run := func(actor storage.TenantActor, base string, dry bool) (*storage.PriceRefreshQuoteResult, error) {
		var result *storage.PriceRefreshQuoteResult
		err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
			var txErr error
			result, txErr = fx.store.PriceRefreshQuoteRevision(ctx, storage.PriceRefreshQuoteCommand{
				ProjectID: fx.projectID, BaseQuoteRevisionID: base, DryRun: dry,
				ActorUserID: rlsUserA, RequestID: "price-refresh-test",
			})
			return txErr
		})
		return result, err
	}

	// A draft base is refused.
	if _, err := run(fiActorA(), q1, true); !errors.Is(err, domain.ErrQuoteRevisionInvalidTransition) {
		t.Fatalf("draft base must be refused, got %v", err)
	}
	publishRevision(t, fx, q1)

	var baseSnapshotBefore string
	if err := fx.admin.QueryRow(ctx, `SELECT commercial_snapshot::text FROM quote_revisions WHERE id = $1`, q1).Scan(&baseSnapshotBefore); err != nil {
		t.Fatal(err)
	}

	// Same catalog: preview unchanged, command refuses, nothing written.
	preview, err := run(fiActorA(), q1, true)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if preview.Changed || preview.PreviousSaleTotal != preview.NewSaleTotal || preview.PreviousSaleTotal <= 0 {
		t.Fatalf("unchanged preview = %+v", preview)
	}
	if _, err := run(fiActorA(), q1, false); !errors.Is(err, domain.ErrPriceRefreshNoChange) {
		t.Fatalf("unchanged command must refuse, got %v", err)
	}
	if n := len(listRevisions(t, fx)); n != 1 {
		t.Fatalf("refused command must write nothing, revisions = %d", n)
	}

	// The board price doubles in the catalog.
	if _, err := fx.admin.Exec(ctx, `UPDATE material_boards SET board_price = board_price * 2 WHERE id = $1`, releaseMaterial); err != nil {
		t.Fatalf("raise price: %v", err)
	}
	preview, err = run(fiActorA(), q1, true)
	if err != nil {
		t.Fatalf("preview after price change: %v", err)
	}
	if !preview.Changed || preview.NewSaleTotal <= preview.PreviousSaleTotal {
		t.Fatalf("preview after price change = %+v", preview)
	}
	if n := len(listRevisions(t, fx)); n != 1 {
		t.Fatalf("preview must write nothing, revisions = %d", n)
	}

	// Org B: uniform not-found, nothing written.
	if _, err := run(fiActorB(), q1, false); !errors.Is(err, domain.ErrQuoteRevisionNotFound) {
		t.Fatalf("org B must get the uniform 404, got %v", err)
	}

	created, err := run(fiActorA(), q1, false)
	if err != nil {
		t.Fatalf("price refresh: %v", err)
	}
	q2 := created.Revision
	if q2.RevisionNumber != 2 || q2.Status != "draft" || q2.SourceType != "price_refresh" || q2.BaseQuoteRevisionID != q1 {
		t.Fatalf("created revision = %+v", q2)
	}
	if created.NewSaleTotal != preview.NewSaleTotal || created.PreviousSaleTotal != preview.PreviousSaleTotal {
		t.Fatalf("command totals %+v differ from preview %+v", created, preview)
	}

	// Same units and line identities; new total; base untouched.
	var details []domain.QuoteRevisionDetail = listRevisions(t, fx)
	var d1, d2 *domain.QuoteRevisionDetail
	for i := range details {
		switch details[i].ID {
		case q1:
			d1 = &details[i]
		case q2.ID:
			d2 = &details[i]
		}
	}
	if d1 == nil || d2 == nil {
		t.Fatalf("revisions not listed")
	}
	if len(d1.Items) != len(d2.Items) || len(d2.Items) == 0 {
		t.Fatalf("items: base %d, refreshed %d", len(d1.Items), len(d2.Items))
	}
	baseLines := map[string]string{}
	for _, unit := range d1.CommercialSnapshot.Units {
		baseLines[unit.FurnitureInstanceID] = unit.QuoteLineID
	}
	for _, unit := range d2.CommercialSnapshot.Units {
		if baseLines[unit.FurnitureInstanceID] != unit.QuoteLineID {
			t.Fatalf("unit %s line identity changed", unit.FurnitureInstanceID)
		}
	}
	if d2.CommercialSnapshot.Breakdown.SalePrice <= d1.CommercialSnapshot.Breakdown.SalePrice {
		t.Fatalf("refreshed total %v not above base %v", d2.CommercialSnapshot.Breakdown.SalePrice, d1.CommercialSnapshot.Breakdown.SalePrice)
	}
	var baseSnapshotAfter string
	if err := fx.admin.QueryRow(ctx, `SELECT commercial_snapshot::text FROM quote_revisions WHERE id = $1`, q1).Scan(&baseSnapshotAfter); err != nil {
		t.Fatal(err)
	}
	if baseSnapshotAfter != baseSnapshotBefore {
		t.Fatalf("base revision snapshot must stay immutable")
	}
	if n := countAuditEvents(t, fx, "quote_revision_created_price_refresh", q2.ID); n != 1 {
		t.Fatalf("price refresh audit events = %d, want 1", n)
	}

	// Q1 is no longer the latest: refused as stale.
	if _, err := run(fiActorA(), q1, false); !errors.Is(err, domain.ErrQuoteRevisionConflict) {
		t.Fatalf("stale base must be refused, got %v", err)
	}
}
