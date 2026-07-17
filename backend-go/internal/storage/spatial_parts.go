package storage

import "github.com/tiagofur/muebles-backend/internal/domain"

// Helpers for optional S1 spatial columns on board parts.

func applySpatialPtrs(
	p *domain.BoardPart,
	face, placement, ox, oy, oz *string,
	designT *int,
) {
	if face != nil {
		p.Face = *face
	}
	if placement != nil {
		p.Placement = *placement
	}
	if ox != nil {
		p.OriginXFormula = *ox
	}
	if oy != nil {
		p.OriginYFormula = *oy
	}
	if oz != nil {
		p.OriginZFormula = *oz
	}
	if designT != nil && *designT > 0 {
		p.DesignThicknessMm = *designT
	}
}

func spatialWriteArgs(p domain.BoardPart) (face, placement, ox, oy, oz interface{}, designT interface{}) {
	face = nullIfEmpty(p.Face)
	placement = nullIfEmpty(p.Placement)
	ox = nullIfEmpty(p.OriginXFormula)
	oy = nullIfEmpty(p.OriginYFormula)
	oz = nullIfEmpty(p.OriginZFormula)
	if p.DesignThicknessMm > 0 {
		designT = p.DesignThicknessMm
	} else {
		designT = nil
	}
	return
}

func applyRefSpatialPtrs(
	ref *domain.ModuleComponentRef,
	placement, ox, oy, oz *string,
) {
	if placement != nil {
		ref.Placement = *placement
	}
	if ox != nil {
		ref.OriginXFormula = *ox
	}
	if oy != nil {
		ref.OriginYFormula = *oy
	}
	if oz != nil {
		ref.OriginZFormula = *oz
	}
}
