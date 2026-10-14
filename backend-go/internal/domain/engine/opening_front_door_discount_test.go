package engine

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1316 — the workshop-facing DOOR DISCOUNT resolves per profile: the
// declared door_reduction_mm wins over the legacy datasheet pair
// (front + clearance), which stays as documentation; nil keeps the frozen
// legacy arithmetic so every pin authored before the field keeps consuming
// exactly what it froze.
func TestOpeningFrontDoorDiscountWinsOverDatasheetPair(t *testing.T) {
	intent := OpeningIntent{
		// Vertical like the design resolve: zones divide the HEIGHT (720) and
		// the top grip consumes from it.
		Layout: OpeningLayout{Direction: "vertical", Zones: []OpeningZone{
			{ID: "z1", Access: "hinged", Ratio: 1},
		}},
		Grips:       []OpeningGrip{{Boundary: "top", ProfileID: "p"}},
		Positioning: "overlay",
	}

	// Legacy pin (front 38 + clearance 2): consumes 40.
	legacy := []OpeningProfileData{{ProfileID: "p", DatasheetStatus: "verified", FrontReductionMm: 38, GripClearanceMm: 2}}
	layout, resErr := ResolveOpeningFrontLayout(intent, 600, 720, legacy, nil)
	if resErr != nil {
		t.Fatalf("legacy resolve rejected: %s", resErr.Code)
	}
	if layout.Resolution.Boundaries[0].ConsumedMm != 40 {
		t.Fatalf("legacy pin must consume 40 (38+2), got %d", layout.Resolution.Boundaries[0].ConsumedMm)
	}

	// Declared door discount 32: WINS over the pair — the workshop number is
	// the one the owner tuned, the pair is documentation.
	thirtyTwo := 32
	declared := []OpeningProfileData{{ProfileID: "p", DatasheetStatus: "verified", FrontReductionMm: 38, GripClearanceMm: 2, DoorReductionMm: &thirtyTwo}}
	layout, resErr = ResolveOpeningFrontLayout(intent, 600, 720, declared, nil)
	if resErr != nil {
		t.Fatalf("declared resolve rejected: %s", resErr.Code)
	}
	if layout.Resolution.Boundaries[0].ConsumedMm != 32 {
		t.Fatalf("declared door discount must consume 32 (not the 40 pair), got %d", layout.Resolution.Boundaries[0].ConsumedMm)
	}
	if layout.Resolution.AvailableFrontHeightMm != 688 {
		t.Fatalf("available = 720 − 32 = 688, got %d", layout.Resolution.AvailableFrontHeightMm)
	}
}

// #1316 — the domain contract refuses a non-positive door discount at the
// write boundary; the 30–40 workshop scoping lives in the UI.
func TestOpeningProfileDoorDiscountValidation(t *testing.T) {
	zero := 0
	if err := domain.ValidateOpeningProfile(domain.OpeningProfile{
		Code: "X", Name: "X", GripType: "gola", CrossSectionShape: "L",
		CompatiblePlacements: []string{"top"}, DatasheetStatus: "pending",
		DoorReductionMm: &zero,
	}); err == nil {
		t.Fatal("door discount 0 must fail closed")
	}
	negative := -5
	if err := domain.ValidateOpeningProfile(domain.OpeningProfile{
		Code: "X", Name: "X", GripType: "gola", CrossSectionShape: "L",
		CompatiblePlacements: []string{"top"}, DatasheetStatus: "pending",
		DoorReductionMm: &negative,
	}); err == nil {
		t.Fatal("negative door discount must fail closed")
	}
	valid := 32
	if err := domain.ValidateOpeningProfile(domain.OpeningProfile{
		Code: "X", Name: "X", GripType: "gola", CrossSectionShape: "L",
		CompatiblePlacements: []string{"top"}, DatasheetStatus: "pending",
		DoorReductionMm: &valid,
	}); err != nil {
		t.Fatalf("valid door discount rejected: %v", err)
	}
}
