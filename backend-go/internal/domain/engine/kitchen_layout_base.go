package engine

import (
	"encoding/json"
	"fmt"
	"math"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Minimal kitchen-layout reader for base treatment (#442).
//
// The kitchen plan is authored by the web app (TS owns the schema) and
// persisted as a raw JSONB blob on the project. The BOM only needs three
// things from it — the plan-level plinth height, wall lengths and the item's
// placement — so this reads just those fields (unknown fields are ignored)
// instead of duplicating the whole layout schema in Go. Mirrors TS
// baseContextForItem + resolveBaseClearanceMm + plinthSidesForPlacement
// (kitchenLayout.ts / plinth.ts); parity is frozen by
// contracts/plinthBaseParity.contract.json.

type kitchenWallInfo struct {
	ID       string `json:"id"`
	LengthMm int    `json:"lengthMm"`
}

type kitchenPlacementInfo struct {
	ItemID          string `json:"itemId"`
	WallID          string `json:"wallId"`
	OffsetMm        int    `json:"offsetMm"`
	Elevation       string `json:"elevation"`
	BaseClearanceMm *int   `json:"baseClearanceMm"`
	Mode            string `json:"mode"`
}

type kitchenLayoutBaseInfo struct {
	BaseClearanceMm *int                  `json:"baseClearanceMm"`
	Walls           []kitchenWallInfo     `json:"walls"`
	Placements      []kitchenPlacementInfo `json:"placements"`
}

// parseKitchenLayoutBase reads the active-space mirror fields the engine
// needs. Empty/absent raw JSON → nil (no plan context). Malformed JSON is an
// error: silently ignoring a corrupt plan would let quotes diverge from the
// plan the user sees.
func parseKitchenLayoutBase(raw json.RawMessage) (*kitchenLayoutBaseInfo, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var layout kitchenLayoutBaseInfo
	if err := json.Unmarshal(raw, &layout); err != nil {
		return nil, fmt.Errorf("kitchen layout no válido: %w", err)
	}
	return &layout, nil
}

// planBaseClearanceMm mirrors TS resolveBaseClearanceMm: wall elevation → 0;
// floor → placement override → layout default → domain default (100). The
// caller only invokes this when a layout exists, so the plan is authoritative
// for B whenever the item is placed on the floor without its own override.
func planBaseClearanceMm(layout *kitchenLayoutBaseInfo, placement *kitchenPlacementInfo) int {
	if placement != nil && placement.Elevation == "wall" {
		return 0
	}
	if placement != nil && placement.BaseClearanceMm != nil {
		return maxInt(0, *placement.BaseClearanceMm)
	}
	if layout.BaseClearanceMm != nil {
		return maxInt(0, *layout.BaseClearanceMm)
	}
	return defaultBaseClearanceMm
}

// plinthSidesForPlacement mirrors TS plinthSidesForPlacement (F088): a side
// needs a return when nothing covers it — no neighboring cabinet on the same
// wall within the gap tolerance and not against a wall end. Free placements
// (islands) expose left, right and back.
func plinthSidesForPlacement(
	layout *kitchenLayoutBaseInfo,
	placement kitchenPlacementInfo,
	widthOf func(itemID string) (int, bool),
) PlinthSides {
	if placement.Mode == "free" {
		return PlinthSides{Left: true, Right: true, Back: true}
	}

	wallLength := math.MaxInt64
	for _, w := range layout.Walls {
		if w.ID == placement.WallID && w.LengthMm > 0 {
			wallLength = w.LengthMm
			break
		}
	}

	type footprint struct{ start, end int }
	var onWall []footprint
	for _, p := range layout.Placements {
		if p.WallID != placement.WallID || p.ItemID == placement.ItemID || p.Mode == "free" {
			continue
		}
		w, ok := widthOf(p.ItemID)
		if !ok {
			w = 600
		}
		onWall = append(onWall, footprint{start: p.OffsetMm, end: p.OffsetMm + w})
	}

	width, ok := widthOf(placement.ItemID)
	if !ok {
		width = 600
	}
	start := placement.OffsetMm
	end := start + width
	tol := plinthSideGapMm

	coveredByNeighbor := func(from, to int) bool {
		for _, f := range onWall {
			if f.start < to && f.end > from {
				return true
			}
		}
		return false
	}

	return PlinthSides{
		Left:  !coveredByNeighbor(start-tol, start) && start > tol,
		Right: !coveredByNeighbor(end, end+tol) && end < wallLength-tol,
		Back:  false,
	}
}

// modulePlanWidthMm resolves the plan footprint width of a module: customDims
// → commercial preset → module external dims → structure external dims.
// Tolerant by design (mirrors TS modulePlanWidthMm): neighbor widths feed
// exposure heuristics only, so an unresolvable width falls back to the
// caller's default instead of failing the quote.
func modulePlanWidthMm(
	module *domain.Module,
	catalog *domain.Catalog,
	measurePresetID string,
	customDims *domain.ItemCustomDims,
) (int, bool) {
	if module == nil {
		return 0, false
	}
	if customDims != nil {
		return customDims.WidthMm, true
	}
	if measurePresetID != "" {
		for _, p := range module.Presets {
			if p.ID == measurePresetID {
				return p.WidthMm, true
			}
		}
	}
	if module.WidthMm > 0 {
		return module.WidthMm, true
	}
	if catalog != nil {
		for _, s := range catalog.Structures {
			if s.ID == module.StructureID && s.WidthMm > 0 {
				return s.WidthMm, true
			}
		}
	}
	return 0, false
}

// ResolveBaseContextForItem builds the quote-line base context the BOM needs:
// the item's baseMode override plus the plinth state resolved from the
// kitchen plan (placement → layout). Mirrors TS baseContextForItem.
func ResolveBaseContextForItem(
	project domain.Project,
	item domain.ProjectItem,
	catalog *domain.Catalog,
) (*BaseResolutionContext, error) {
	layout, err := parseKitchenLayoutBase(project.KitchenLayout)
	if err != nil {
		return nil, err
	}
	return resolveBaseContextForItem(layout, project, item, catalog), nil
}

func resolveBaseContextForItem(
	layout *kitchenLayoutBaseInfo,
	project domain.Project,
	item domain.ProjectItem,
	catalog *domain.Catalog,
) *BaseResolutionContext {
	ctx := &BaseResolutionContext{}
	if isModuleBaseMode(item.BaseMode) {
		ctx.BaseMode = item.BaseMode
	}
	if layout == nil {
		if ctx.BaseMode == "" {
			return nil
		}
		return ctx
	}

	var placement *kitchenPlacementInfo
	for i := range layout.Placements {
		if layout.Placements[i].ItemID == item.ID {
			placement = &layout.Placements[i]
			break
		}
	}

	// The plan is authoritative for B whenever a layout exists (TS parity:
	// resolveBaseClearanceMm always returns a value, defaulting to 100).
	planB := planBaseClearanceMm(layout, placement)
	ctx.BaseClearanceMm = &planB

	if placement != nil && catalog != nil {
		widthOf := func(itemID string) (int, bool) {
			var other *domain.ProjectItem
			for i := range project.Items {
				if project.Items[i].ID == itemID {
					other = &project.Items[i]
					break
				}
			}
			if other == nil {
				return 0, false
			}
			var module *domain.Module
			for i := range catalog.Modules {
				if catalog.Modules[i].ID == other.ModuleID {
					module = &catalog.Modules[i]
					break
				}
			}
			return modulePlanWidthMm(module, catalog, other.MeasurePresetID, other.CustomDims)
		}
		sides := plinthSidesForPlacement(layout, *placement, widthOf)
		ctx.PlinthSides = &sides
	}
	return ctx
}
