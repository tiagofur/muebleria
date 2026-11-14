package storage

// #1627 slice 3 — the quoted release applies the inserts the quote froze per
// unit (QuoteCommercialPricingContext.AccessoryChoices) over the design
// revision items before resolving, so a frozen quote releases exactly what
// it priced. Consumed by evaluateReleaseManufacturingReadiness.

import (
	"context"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// applyQuotedReleaseAccessories returns a copy of items with the frozen
// inserts applied. Units the snapshot does not describe, or a snapshot that
// cannot be read, keep their items untouched: the frozen base authority
// (loadReleaseBaseAuthority, run before) already fails the release for a
// missing/corrupt snapshot or an unbound unit, so this never masks those.
func (s *PostgresStore) applyQuotedReleaseAccessories(ctx context.Context, quoteRevisionID string, items []domain.DesignRevisionItem, catalog domain.Catalog) ([]domain.DesignRevisionItem, error) {
	var payload []byte
	if err := s.db(ctx).QueryRow(ctx, `SELECT commercial_snapshot FROM quote_revisions WHERE id = $1`, quoteRevisionID).Scan(&payload); err != nil {
		return nil, err
	}
	snapshot, err := parseQuoteCommercialSnapshot(payload)
	if err != nil || snapshot == nil {
		return items, nil
	}
	return applyFrozenAccessoriesToItems(snapshot, items, catalog), nil
}

// applyFrozenAccessoriesToItems is the pure part: per unit the snapshot
// describes, apply its frozen inserts (nil map = snapshot frozen before #1627)
// over a copy of the items. Unbound units and unknown definitions keep their
// items untouched.
func applyFrozenAccessoriesToItems(snapshot *domain.QuoteCommercialSnapshot, items []domain.DesignRevisionItem, catalog domain.Catalog) []domain.DesignRevisionItem {
	frozenByInstance := make(map[string]*domain.QuoteCommercialPricingContext, len(snapshot.Units))
	for i := range snapshot.Units {
		frozenByInstance[snapshot.Units[i].FurnitureInstanceID] = snapshot.Units[i].PricingContext
	}
	moduleByID := make(map[string]domain.Module, len(catalog.Modules))
	for _, module := range catalog.Modules {
		moduleByID[module.ID] = module
	}
	out := make([]domain.DesignRevisionItem, len(items))
	copy(out, items)
	for i := range out {
		pricingContext, bound := frozenByInstance[out[i].FurnitureInstanceID]
		module, known := moduleByID[out[i].FurnitureDefinitionID]
		if !bound || !known {
			continue
		}
		var frozen map[string]string
		if pricingContext != nil {
			frozen = pricingContext.AccessoryChoices
		}
		out[i].MaterialChoices = engine.ApplyFrozenAccessoryChoices(module, catalog, out[i].MaterialChoices, frozen)
	}
	return out
}
