package engine

import (
	"errors"
	"fmt"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ResolvedReleaseCollection is transient server-owned assembly, not another
// release or persisted snapshot. BOM rows retain their existing quantities;
// their IDs are not newly manufactured physical occurrence identities.
// Routing and ProfileDemand (#875 slice 2) are the derived neutral program
// and per-unit profile hardware demand (#917) when server inputs are
// provided — the freeze persists exactly these, so the gate-validated
// program and the frozen program are the same bytes, never two derivations.
type ResolvedReleaseCollection struct {
	Units        []ResolvedReleaseUnit
	Requirements []domain.MaterialRequirementLine
	Routing      *ReleaseRoutingProgram
	// ProfileDemand is index-aligned with Units (nil entries = no profile
	// demand for that unit).
	ProfileDemand [][]HardwareProfileDemandLine
}

// ResolveReleaseCollection assembles exact revision units through the existing
// engines. The caller owns tenant/project authorization, coherent catalog capture,
// canonical release pins and persistence. No mutable project items are consumed.
// authority (#830) carries each unit's frozen base-treatment context when an
// exact QuoteRevision governs the release; nil is the quote-less policy (the
// module defaults of the same catalog snapshot). Server inputs (#875 slice 2)
// are the organization's shared resolve inputs; non-nil server inputs also
// derive the routing program and per-unit profile demand, merging the demand
// into the material requirements BEFORE any package rounding, exactly like
// every other hardware line.
func ResolveReleaseCollection(designRevisionID string, items []domain.DesignRevisionItem, catalog domain.Catalog, authority *ReleaseResolutionContext, server *ReleaseServerInputs) (*ResolvedReleaseCollection, error) {
	if strings.TrimSpace(designRevisionID) == "" || len(items) == 0 || len(items) > releaseUnitExpansionLimit {
		return nil, fmt.Errorf("release collection requires an exact revision and 1..%d physical units", releaseUnitExpansionLimit)
	}
	seen := make(map[string]bool, len(items))
	for _, item := range items {
		if item.DesignRevisionID != designRevisionID {
			return nil, fmt.Errorf("release collection item must belong to the exact revision")
		}
		if strings.TrimSpace(item.FurnitureInstanceID) == "" || seen[item.FurnitureInstanceID] {
			return nil, fmt.Errorf("release collection requires unique nonempty physical identities")
		}
		seen[item.FurnitureInstanceID] = true
	}

	var budget releaseExpansionBudget
	units := make([]ResolvedReleaseUnit, 0, len(items))
	inputs := make([]ResolvedRequirementInput, 0, len(items))
	for _, item := range items {
		baseCtx, err := authority.BaseContextFor(item.FurnitureInstanceID)
		if err != nil {
			// #830: a quoted release whose frozen truth does not bind the exact
			// physical identity fails closed with the same typed unit failure.
			return nil, &domain.ReleaseUnitResolutionFailure{
				FurnitureInstanceID:   item.FurnitureInstanceID,
				FurnitureDefinitionID: item.FurnitureDefinitionID,
				Reason:                err.Error(),
			}
		}
		unit, err := resolveReleaseUnit(item, catalog, &budget, baseCtx)
		if err != nil {
			// #727: keep the exact physical identities and the business-safe
			// cause typed — the API surfaces an actionable 409, never a parsed
			// string or an internal error.
			var failure *domain.ReleaseUnitResolutionFailure
			if errors.As(err, &failure) {
				return nil, failure
			}
			return nil, &domain.ReleaseUnitResolutionFailure{
				FurnitureInstanceID:   item.FurnitureInstanceID,
				FurnitureDefinitionID: item.FurnitureDefinitionID,
				Reason:                err.Error(),
			}
		}
		if len(unit.BOM.BoardParts) == 0 && len(unit.BOM.HardwareLines) == 0 {
			return nil, &domain.ReleaseUnitResolutionFailure{
				FurnitureInstanceID:   item.FurnitureInstanceID,
				FurnitureDefinitionID: item.FurnitureDefinitionID,
				Reason:                "la unidad no genera demanda de fabricación",
			}
		}
		units = append(units, *unit)
		inputs = append(inputs, ResolvedRequirementInput{BOM: unit.BOM, PhysicalQuantity: 1})
	}
	// Round sheets and hardware packages only after all physical units
	// contribute — including the profile-driven hardware demand (#917),
	// which joins the same totals under the same validation and rounding.
	var routing *ReleaseRoutingProgram
	var profileDemand [][]HardwareProfileDemandLine
	if server != nil {
		var err error
		routing, profileDemand, err = DeriveReleaseRoutingProgram(items, units, catalog, server)
		if err != nil {
			return nil, err
		}
	}
	requirements, err := RequirementLinesFromResolvedBOMs(inputs, catalog, profileDemand)
	if err != nil {
		return nil, fmt.Errorf("release collection requirements: %w", err)
	}
	return &ResolvedReleaseCollection{Units: units, Requirements: requirements, Routing: routing, ProfileDemand: profileDemand}, nil
}
