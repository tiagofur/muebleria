package engine

// #1696 (vivo r6): the gola run is a DERIVED box placed by the engine, and
// its physical invariant is that the profile NEVER passes through a front or
// through the panel the depth reduction receded — it rides the carcass front
// plane, in front of that panel and BEHIND the fronts overlaying its lower
// band (the door is shorter by the front discount, the fingers reach past).
// The front-stack plane experiment (#1697) put the run through the door
// (15 × 28.5 mm on the owner's furniture) and was reverted; this pins the
// clearance with the exact arithmetic so no anchor change can reintroduce a
// collision unnoticed.

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// furnitureBox is the furniture-frame AABB of a published placement: its
// transform translation is the min corner and dimensionsMm the size.
func furnitureBox(min, size [3]float64) [2][3]float64 {
	return [2][3]float64{min, {min[0] + size[0], min[1] + size[1], min[2] + size[2]}}
}

func boxesCross(a, b [2][3]float64) bool {
	for axis := 0; axis < 3; axis++ {
		lo, hi := a[0][axis], a[1][axis]
		if b[0][axis] > lo {
			lo = b[0][axis]
		}
		if b[1][axis] < hi {
			hi = b[1][axis]
		}
		if hi-lo <= 1e-6 {
			return false
		}
	}
	return true
}

func TestOpeningGolaRunNeverCrossesFrontsOrTopPanel(t *testing.T) {
	module, catalog := depthReductionGolaModule()
	// The fixture body carries no fronts: add the overlay door the profile
	// band must stay behind (pose at the carcass front plane, 18 mm proud).
	door := domain.Component{
		ID: "comp-door", Code: "PTA", Name: "Puerta", Placement: domain.PlacementPuerta,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"FRENTE"},
		LengthFormula: "PH - 4", WidthFormula: "PW - 4", Active: true,
	}
	catalog.Components = append(catalog.Components, door)
	catalog.Hardware = append(catalog.Hardware, domain.Hardware{
		ID: "hw-gola-8006", Code: "8006", Name: "Perfil GOLA L 8006", Unit: domain.UnitMeter, Active: true,
	})
	module.Components = []domain.ComponentInstance{{ComponentID: "comp-door", Quantity: 1}}

	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 580},
		nil, resolveOptions{
			fronts: openingPassFront("top", 40),
			openingMembers: &OpeningMembers{
				ProfileHardwareID: "hw-gola-8006", ProfileHeightMm: 56.5, ProfileDepthMm: 27.2,
			},
			openingBodyModifiers: depthReductionModifiers(),
		})
	if err != nil {
		t.Fatalf("resolve with the gola run: %v", err)
	}

	var run [2][3]float64
	found := false
	for _, hw := range layout.Hardware {
		if hw.PlacementID == "opening-profile-hw-gola-8006" {
			run = furnitureBox(hw.Transform.TranslationMm, hw.DimensionsMm)
			found = true
		}
	}
	if !found {
		t.Fatalf("the layout must carry the gola run, hardware: %+v", layout.Hardware)
	}
	// The run rides the CARCASS front plane (580) and its declared depth
	// reaches back to 552.8 — never the fronts' plane.
	if d := run[1][1] - 580; d > 1e-6 || d < -1e-6 {
		t.Fatalf("the gola run must be flush with the carcass front plane (y=580), got front y=%g", run[1][1])
	}
	if d := run[0][1] - 552.8; d > 1e-6 || d < -1e-6 {
		t.Fatalf("the gola run must span the declared 27.2 depth (y from 552.8), got back y=%g", run[0][1])
	}

	isFront := func(slot string) bool { return slot == "puerta" || slot == "frente_cajon" }
	isLateral := func(slot string) bool {
		return slot == "lateral_izquierdo" || slot == "lateral_derecho"
	}
	fronts, notched := 0, 0
	for i := range layout.Components {
		component := &layout.Components[i]
		if component.Kind != "board" {
			continue
		}
		if isFront(component.SlotID) {
			fronts++
		}
		board := furnitureBox(component.Transform.TranslationMm, component.DimensionsMm)
		if !boxesCross(run, board) {
			continue
		}
		// A NOTCHED LATERAL is the profile's own crossing — the notch is cut
		// for exactly that. Any other board the run enters is a collision.
		if isLateral(component.SlotID) && len(component.Notches) > 0 {
			notched++
			continue
		}
		t.Fatalf("the gola run passes through %s (%s): run y[%g,%g] z[%g,%g] vs board y[%g,%g] z[%g,%g]",
			component.Name, component.SlotID,
			run[0][1], run[1][1], run[0][2], run[1][2], board[0][1], board[1][1], board[0][2], board[1][2])
	}
	// The guard must have had a front to clear, or it proves nothing.
	if fronts != 1 || notched != 2 {
		t.Fatalf("expected one front clear of the run and exactly the two notched laterals crossing it, got fronts=%d notched=%d",
			fronts, notched)
	}
}
