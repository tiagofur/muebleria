package storage

import (
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestSelectCommercialProjectionReferences_PrefersAcceptedAndKeepsNewerPublished(t *testing.T) {
	acceptedAt := time.Now().Add(-time.Hour)
	publishedAt := time.Now()
	revisions := []domain.QuoteRevisionDetail{
		{QuoteRevision: domain.QuoteRevision{ID: "q2", RevisionNumber: 2, Status: "accepted", AcceptedAt: &acceptedAt, PublishedAt: &acceptedAt, CommercialSnapshot: projectionSnapshot(100)}},
		{QuoteRevision: domain.QuoteRevision{ID: "q3", RevisionNumber: 3, Status: "published", PublishedAt: &publishedAt, CommercialSnapshot: projectionSnapshot(120)}},
	}
	selected, accepted, latestPublished := selectCommercialProjectionReferences(revisions)
	if selected == nil || selected.QuoteRevisionID != "q2" || accepted.QuoteRevisionID != "q2" {
		t.Fatalf("accepted reference not authoritative: %#v %#v", selected, accepted)
	}
	if latestPublished == nil || latestPublished.QuoteRevisionID != "q3" {
		t.Fatalf("newer published reference lost: %#v", latestPublished)
	}
}

func TestCompareCommercialProjection_ZeroReferenceHasAbsoluteDeltaWithoutFakePercentage(t *testing.T) {
	zero, current := 0.0, 25.0
	p := &domain.CommercialProjection{Currency: "MXN", Amounts: &domain.CommercialProjectionAmounts{SaleTotal: &current}, Reference: &domain.CommercialProjectionReference{Currency: "MXN", SaleTotal: &zero}}
	comparison := compareCommercialProjection(p)
	if comparison == nil || comparison.AbsoluteDelta != 25 || comparison.PercentageDelta != nil {
		t.Fatalf("comparison=%#v", comparison)
	}
}

func TestCompareCommercialProjection_CurrencyMismatchHasNoComparison(t *testing.T) {
	reference, current := 100.0, 125.0
	p := &domain.CommercialProjection{
		Currency:  "MXN",
		Amounts:   &domain.CommercialProjectionAmounts{SaleTotal: &current},
		Reference: &domain.CommercialProjectionReference{Currency: "USD", SaleTotal: &reference},
	}
	if comparison := compareCommercialProjection(p); comparison != nil {
		t.Fatalf("currency mismatch comparison=%#v", comparison)
	}
}

func projectionSnapshot(total float64) *domain.QuoteCommercialSnapshot {
	return &domain.QuoteCommercialSnapshot{Currency: "MXN", Breakdown: domain.QuoteBreakdown{SalePrice: total}}
}
