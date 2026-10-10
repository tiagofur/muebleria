package engine

import "github.com/tiagofur/muebles-backend/internal/domain"

// Design-level BOM context helpers (#1263). The #1133 contract keeps the run
// length as an INPUT from the body context — these helpers are how the
// DESIGN-level surfaces (design opening endpoint, commercial quote) derive
// that input from the catalog they already own. Nothing here guesses: an
// underivable context reports the truthful absence and the BOM stays out.

// BOM absence reasons for a gola selection (truthful states, never invented
// lines). Mirrored verbatim by the surfaces that render them.
const (
	// OpeningReasonBOMPinSliceMissing: the pin predates #1263 and never froze
	// the BOM slice — no live-catalog fallback for historical designs.
	OpeningReasonBOMPinSliceMissing = "OPENING_BOM_PIN_SLICE_MISSING"
	// OpeningReasonBOMBodyContextMissing: the body context (cabinet interior
	// width) cannot be derived for this design's furniture — no BOM lines.
	OpeningReasonBOMBodyContextMissing = "OPENING_BOM_BODY_CONTEXT_MISSING"
)

// OpeningBOMDefaultEnds is the v1 declared end condition of a profile run:
// both ends exposed. Real end-condition authoring (adjacent cabinets, walls)
// is explicit follow-up scope; until then the quote over-counts end caps
// rather than inventing closed ends — and the resolution payload carries
// these ends visibly (BOMEnds), never silently.
var OpeningBOMDefaultEnds = OpeningBOMEndConditions{
	LeftEnd:  OpeningEndExposed,
	RightEnd: OpeningEndExposed,
}

// StructureSidePanelThicknessMm resolves the thickness of a composed module's
// LATERAL panels from its structure definition — the body fact the interior
// width derives from (interior = width − 2×thickness). False when the
// structure has no lateral components or declares inconsistent thicknesses:
// the caller then reports the missing body context instead of guessing.
func StructureSidePanelThicknessMm(structure domain.Structure, catalog domain.Catalog) (int, bool) {
	thickness := 0
	for _, instance := range structure.Components {
		var component *domain.Component
		for i := range catalog.Components {
			if catalog.Components[i].ID == instance.ComponentID {
				component = &catalog.Components[i]
				break
			}
		}
		if component == nil || component.Construction == nil ||
			component.Construction.ConstructiveRole != "lateral" || component.ThicknessMm <= 0 {
			continue
		}
		if thickness != 0 && thickness != component.ThicknessMm {
			return 0, false
		}
		thickness = component.ThicknessMm
	}
	if thickness <= 0 {
		return 0, false
	}
	return thickness, true
}
