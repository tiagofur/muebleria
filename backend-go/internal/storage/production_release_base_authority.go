package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #830 — frozen base-treatment authority for quoted releases. The exact
// accepted QuoteRevision's immutable commercial snapshot is the ONLY base
// authority a quoted release may consume: per-unit QuoteCommercialPricingContext
// (BaseMode + BaseClearanceMm + PlinthSides as one coherent unit), joined by
// exact FurnitureInstanceID. Missing, malformed/incomplete or unbound frozen
// truth fails closed with the typed blocker; history is never refilled from
// the live catalog, mutable project state or module defaults.

// loadReleaseBaseAuthority builds the per-unit frozen base authority from the
// exact QuoteRevision's immutable commercial snapshot, inside the caller's
// tenant/consistency boundary (same transaction as the catalog capture and the
// release resolution — no cross-moment authority mixing).
func (s *PostgresStore) loadReleaseBaseAuthority(ctx context.Context, quoteRevisionID string, items []domain.DesignRevisionItem) (*engine.ReleaseResolutionContext, error) {
	var commercialSnapshot []byte
	err := s.db(ctx).QueryRow(ctx, `
		SELECT commercial_snapshot FROM quote_revisions WHERE id = $1
	`, quoteRevisionID).Scan(&commercialSnapshot)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrQuoteRevisionNotFound
		}
		return nil, err
	}
	snapshot, err := parseQuoteCommercialSnapshot(commercialSnapshot)
	if err != nil {
		// A present-but-corrupt payload is malformed frozen truth, not a
		// generic decode failure the API would 500 on.
		return nil, &domain.FrozenBaseContextError{
			Cause:  domain.FrozenBaseContextInvalidCause,
			Reason: "la verdad comercial congelada de la cotización está corrupta",
		}
	}
	if snapshot == nil {
		return nil, &domain.FrozenBaseContextError{
			Cause:  domain.FrozenBaseContextMissingCause,
			Reason: "la cotización aceptada no congeló su verdad comercial",
		}
	}

	unitByInstance := make(map[string]domain.QuoteCommercialUnit, len(snapshot.Units))
	for _, unit := range snapshot.Units {
		unitByInstance[unit.FurnitureInstanceID] = unit
	}
	baseByInstance := make(map[string]*engine.BaseResolutionContext, len(items))
	for _, item := range items {
		unit, bound := unitByInstance[item.FurnitureInstanceID]
		if !bound {
			return nil, &domain.FrozenBaseContextError{
				FurnitureInstanceID:   item.FurnitureInstanceID,
				FurnitureDefinitionID: item.FurnitureDefinitionID,
				Cause:                 domain.FrozenBaseContextUnitMismatchCause,
				Reason:                "la cotización aceptada no vincula la unidad exacta con su contexto comercial",
			}
		}
		pricing := unit.PricingContext
		if pricing == nil {
			return nil, &domain.FrozenBaseContextError{
				FurnitureInstanceID:   item.FurnitureInstanceID,
				FurnitureDefinitionID: item.FurnitureDefinitionID,
				Cause:                 domain.FrozenBaseContextMissingCause,
				Reason:                "la unidad no congeló su contexto de base al cotizar",
			}
		}
		// BaseMode + BaseClearanceMm + PlinthSides govern as ONE unit (#830 §8):
		// a mode without its frozen clearance is incomplete frozen truth, and a
		// malformed mode never reaches here (snapshot validation rejects it at
		// parse; the authority constructor re-checks fail-closed).
		if !engine.IsValidBaseMode(pricing.BaseMode) || pricing.BaseClearanceMm == nil {
			return nil, &domain.FrozenBaseContextError{
				FurnitureInstanceID:   item.FurnitureInstanceID,
				FurnitureDefinitionID: item.FurnitureDefinitionID,
				Cause:                 domain.FrozenBaseContextInvalidCause,
				Reason:                "el contexto de base congelado de la unidad está incompleto o malformado",
			}
		}
		baseCtx := &engine.BaseResolutionContext{
			BaseMode:        pricing.BaseMode,
			BaseClearanceMm: pricing.BaseClearanceMm,
		}
		if pricing.PlinthSides != nil {
			baseCtx.PlinthSides = &engine.PlinthSides{
				Left: pricing.PlinthSides.Left, Right: pricing.PlinthSides.Right, Back: pricing.PlinthSides.Back,
			}
		}
		baseByInstance[item.FurnitureInstanceID] = baseCtx
	}
	authority, err := engine.NewReleaseResolutionContext(baseByInstance)
	if err != nil {
		return nil, fmt.Errorf("frozen base authority: %w", err)
	}
	return authority, nil
}

// preflightBlockedByFrozenBaseContext derives the honest BLOCKED verdict from
// a typed frozen-base blocker (#830): same scope, same revision, one issue
// carrying the exact physical identities and the business-safe reason, so the
// read-only preflight can never report READY for a revision whose quoted
// release would fail on the frozen base authority.
func preflightBlockedByFrozenBaseContext(ready *domain.ManufacturingPreflightResult, err error) *domain.ManufacturingPreflightResult {
	blocked := &domain.ManufacturingPreflightResult{
		DesignRevisionID: ready.DesignRevisionID,
		Scope:            ready.Scope,
		Status:           domain.ManufacturingPreflightBlocked,
		Items:            ready.Items,
	}
	issue := domain.ManufacturingPreflightIssue{
		Code:    domain.PreflightIssueFrozenBaseContext,
		Message: domain.FrozenBaseContextUserMessage,
	}
	var frozen *domain.FrozenBaseContextError
	if errors.As(err, &frozen) {
		issue.FurnitureInstanceID = frozen.FurnitureInstanceID
		issue.FurnitureDefinitionID = frozen.FurnitureDefinitionID
		issue.Message = frozen.Error()
	} else {
		issue.Message = err.Error()
	}
	blocked.Issues = append(blocked.Issues, issue)
	if issue.FurnitureInstanceID != "" {
		for i := range blocked.Items {
			if blocked.Items[i].FurnitureInstanceID == issue.FurnitureInstanceID {
				blocked.Items[i].Status = domain.ManufacturingPreflightItemBlocked
				blocked.Items[i].Issues = append(blocked.Items[i].Issues, issue)
				break
			}
		}
	}
	return blocked
}
