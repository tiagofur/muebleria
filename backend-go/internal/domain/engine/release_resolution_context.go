package engine

import (
	"fmt"
)

// ReleaseResolutionContext (#830) is the single manufacturing authority shared
// by the release preflight, the production approval and CreateProductionRelease.
// It carries exactly the frozen base-treatment authority each physical unit
// needs to resolve; a nil context is the quote-less policy — the module
// defaults of the same consistent catalog snapshot govern. Identity joins are
// by exact FurnitureInstanceID: never index, module code, name or position.
type ReleaseResolutionContext struct {
	baseByInstance map[string]*BaseResolutionContext
}

// NewReleaseResolutionContext freezes the per-unit base authority. Every unit
// context must carry a valid base mode: malformed frozen truth is rejected
// here instead of silently falling back to module defaults (#830 fail-closed).
func NewReleaseResolutionContext(baseByInstance map[string]*BaseResolutionContext) (*ReleaseResolutionContext, error) {
	frozen := make(map[string]*BaseResolutionContext, len(baseByInstance))
	for instanceID, ctx := range baseByInstance {
		if ctx == nil || !isModuleBaseMode(ctx.BaseMode) {
			return nil, fmt.Errorf("frozen base context for unit %s has an invalid base mode", instanceID)
		}
		frozen[instanceID] = ctx
	}
	return &ReleaseResolutionContext{baseByInstance: frozen}, nil
}

// BaseContextFor resolves one unit's frozen authority. A nil receiver is the
// quote-less policy and always resolves to nil (module defaults). A quoted
// authority must bind the EXACT physical identity: an unknown unit fails
// closed instead of borrowing another unit's commercial truth.
func (c *ReleaseResolutionContext) BaseContextFor(furnitureInstanceID string) (*BaseResolutionContext, error) {
	if c == nil {
		return nil, nil
	}
	ctx, ok := c.baseByInstance[furnitureInstanceID]
	if !ok {
		return nil, fmt.Errorf("the frozen base context does not bind the exact unit %s", furnitureInstanceID)
	}
	return ctx, nil
}

// IsValidBaseMode reports whether v is one of the canonical base modes. The
// frozen commercial context loaders validate the stored truth with it before
// any release path can consume it.
func IsValidBaseMode(v string) bool {
	return isModuleBaseMode(v)
}
