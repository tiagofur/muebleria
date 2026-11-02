package engine

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1453 F2: parity twin of packages/domain hardwarePlacementAnchoring.contract.test.ts —
// the placement mount point (panel refs + offsets − hwAnchor shift) agrees
// with the shared fixture in contracts/hardwarePlacementAnchoring.contract.json.
// Internal package so the shared resolver is exercised exactly like the
// layout/drilling paths do.
func TestHardwarePlacementAnchoringSharedContract(t *testing.T) {
	data, err := os.ReadFile("../../../../contracts/hardwarePlacementAnchoring.contract.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Hardware []struct {
			ID           string                           `json:"id"`
			Shape        string                           `json:"shape"`
			SizeMm       float64                          `json:"sizeMm"`
			DiameterMm   float64                          `json:"diameterMm"`
			ProjectionMm float64                          `json:"projectionMm"`
			Dimensions   *domain.HardwareDimensions       `json:"dimensions"`
			Machining    *domain.HardwareMachiningProfile `json:"machining"`
		} `json:"hardware"`
		Cases []struct {
			Name       string                   `json:"name"`
			Placement  domain.HardwarePlacement `json:"placement"`
			FaceDimXMm float64                  `json:"faceDimXMm"`
			FaceDimYMm float64                  `json:"faceDimYMm"`
			Expected   struct {
				XMm float64 `json:"xMm"`
				YMm float64 `json:"yMm"`
			} `json:"expected"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	if len(fixture.Hardware) != 1 {
		t.Fatalf("expected exactly 1 hardware entry, got %d", len(fixture.Hardware))
	}
	entry := fixture.Hardware[0]
	hw := domain.Hardware{
		ID:                  entry.ID,
		Code:                entry.ID,
		Name:                entry.ID,
		Unit:                domain.UnitPiece,
		Active:              true,
		PreviewShape:        &entry.Shape,
		PreviewSizeMm:       &entry.SizeMm,
		PreviewDiameterMm:   &entry.DiameterMm,
		PreviewProjectionMm: &entry.ProjectionMm,
		Dimensions:          entry.Dimensions,
		Machining:           entry.Machining,
	}
	w, h, d := HardwareFormulaDims(&hw)
	env := formulaDims{
		W: 600, H: 400, D: 400,
		PW: 600, PH: 400, PD: 400,
		T: 18, HW: int(w), HH: int(h), HD: int(d),
	}

	for _, c := range fixture.Cases {
		x, y := resolveHardwareFacePoint(c.Placement, &hw, hw.Machining, c.FaceDimXMm, c.FaceDimYMm, env)
		if x != c.Expected.XMm || y != c.Expected.YMm {
			t.Fatalf("%s: expected (%g, %g), got (%g, %g)", c.Name, c.Expected.XMm, c.Expected.YMm, x, y)
		}
	}
}
