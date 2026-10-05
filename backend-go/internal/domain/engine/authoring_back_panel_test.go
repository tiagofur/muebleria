package engine

import (
	"fmt"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// backPanelCabinetBoards builds a governed cabinet whose back panel joins the
// two sides, the floor and the top through perimeter edge-face contacts —
// the same geometry class as the floor-side joints, so the same verification
// and station machinery applies. The back panel is an UNROTATED vertical
// board: local width along X (cabinet width), thickness along Y (depth),
// length along Z (height).
func backPanelCabinetBoards(cabinetWidthMm, cabinetHeightMm float64) map[string]*layoutBoard {
	const sideThickness = 18.0
	const backThickness = 15.0
	const depth = 570.0
	interiorWidth := cabinetWidthMm - 2*sideThickness
	interiorHeight := cabinetHeightMm - 2*sideThickness
	return map[string]*layoutBoard{
		"side-left":  {id: "side-left", widthMm: depth, thicknessMm: sideThickness, lengthMm: cabinetHeightMm, rotX: -90, rotZ: 90},
		"side-right": {id: "side-right", widthMm: depth, thicknessMm: sideThickness, lengthMm: cabinetHeightMm, x: cabinetWidthMm - sideThickness, rotX: -90, rotZ: 90},
		"floor":      {id: "floor", widthMm: depth, thicknessMm: sideThickness, lengthMm: interiorWidth, x: sideThickness, rotY: -90},
		"top":        {id: "top", widthMm: depth, thicknessMm: sideThickness, lengthMm: interiorWidth, x: sideThickness, z: cabinetHeightMm - sideThickness, rotY: -90},
		"back":       {id: "back", widthMm: interiorWidth, thicknessMm: backThickness, lengthMm: interiorHeight, x: sideThickness, y: depth - backThickness, z: sideThickness, rotX: -90, rotZ: 180},
	}
}

// backPanelRelationship declares the back panel's perimeter contacts: left
// and right edges against the sides' inner faces (vertical runs scaling with
// the cabinet HEIGHT), bottom and top edges against the floor/top faces
// (horizontal runs scaling with the cabinet WIDTH).
func backPanelRelationship(cabinetID string) AuthoringRelationship {
	return AuthoringRelationship{
		RelationshipID: "rel-" + cabinetID + "-back-01",
		Kind:           "back-panel",
		Source:         AuthoringRelationshipAnchor{ComponentInstanceID: "back", Role: "back-perimeter"},
		Targets: []AuthoringRelationshipAnchor{
			{ComponentInstanceID: "side-left", Role: "side", Face: "back"},
			{ComponentInstanceID: "side-right", Role: "side", Face: "front"},
			{ComponentInstanceID: "floor", Role: "bottom-run", Face: "front"},
			{ComponentInstanceID: "top", Role: "top-run", Face: "back"},
		},
		Parameters: map[string]any{
			"maxSpacingMm":  float64(400),
			"startMarginMm": float64(50),
			"endMarginMm":   float64(50),
		},
	}
}

func TestBackPanelStationsScaleWithCabinetDimensions(t *testing.T) {
	derive := func(cabinetID string, widthMm, heightMm float64) JoineryRelationshipStatus {
		var collected []domain.ContractIssue
		var operations []ResolvedMachiningOperation
		status := deriveFixedShelfJoinery(
			backPanelRelationship(cabinetID),
			backPanelCabinetBoards(widthMm, heightMm),
			&collected, &operations)
		if status.Stage != JoineryTechnicalProfileMissing {
			t.Fatalf("%s (%.0fx%.0f): stage = %s, want TECHNICAL_PROFILE_REQUIRED; issues=%+v stations=%+v",
				cabinetID, widthMm, heightMm, status.Stage, collected, status.Stations)
		}
		return status
	}

	countsByContact := func(status JoineryRelationshipStatus) map[string]int {
		out := map[string]int{}
		for _, count := range status.Stations.StationCounts {
			out[count.ContactID] = count.StationCount
		}
		return out
	}

	// Base cabinet 582x720: vertical runs (sides) span the interior height
	// 684 − 50/50 margins → 584 usable → floor(584/400)+1 = 2 stations;
	// horizontal runs (floor/top) span the interior width 546 − 100 → 446 →
	// floor(446/400)+1 = 2 stations.
	base := countsByContact(derive("base", 582, 720))
	for _, contact := range []string{"side-left", "side-right", "floor", "top"} {
		id := fmt.Sprintf("rel-base-back-01:%s", contact)
		if base[id] != 2 {
			t.Fatalf("base %s = %d stations, want 2 (%+v)", id, base[id], base)
		}
	}

	// Tall pantry 1082x2100: the SAME relationship derives FIVE stations on
	// the vertical runs (interior 2064 − 100 → 1964 → floor(1964/400)+1 = 5)
	// while the horizontal runs grow only with the width (interior 1046 − 100
	// → 946 → 3). Height and width drive their own runs — never a fixed count.
	tall := countsByContact(derive("tall", 1082, 2100))
	for _, contact := range []string{"side-left", "side-right"} {
		id := fmt.Sprintf("rel-tall-back-01:%s", contact)
		if tall[id] != 5 {
			t.Fatalf("tall %s = %d stations, want 5 — the vertical runs must scale with the cabinet height (%+v)", id, tall[id], tall)
		}
	}
	for _, contact := range []string{"floor", "top"} {
		id := fmt.Sprintf("rel-tall-back-01:%s", contact)
		if tall[id] != 3 {
			t.Fatalf("tall %s = %d stations, want 3 — the horizontal runs must scale with the cabinet width (%+v)", id, tall[id], tall)
		}
	}
}

func TestBackPanelRecipesReachMachiningReady(t *testing.T) {
	relationship := backPanelRelationship("gab")
	relationship.Parameters["stationCount"] = float64(2)
	relationship.Parameters["startMarginMm"] = float64(50)
	relationship.Parameters["endMarginMm"] = float64(50)
	delete(relationship.Parameters, "maxSpacingMm")
	// Rules live in the CONTACT frame (along = the run, normal = A's entry
	// face): A's pilot enters its own contact face with axis [0,-1,0]
	// (into A); B's dowel enters B's contacted face with axis [0,+1,0]
	// (from A into B) at offset zero — the physical back-panel pattern of
	// #1065 (screw pilot through the panel edge, dowel in the neighbor).
	recipe := func(contactID, faceA, faceB string) ContactOperationRecipe {
		return ContactOperationRecipe{
			ContactID: contactID, RecipeID: "test:back-panel-spax", RecipeRevision: "test-1",
			TechnicalProfileID: "test:back-panel-profile", TechnicalProfileRevision: "test-1",
			Rules: []ContactOperationRule{
				{RuleID: "pilot", RuleRevision: "test-1", ParticipantRole: "A", OperationRole: "pilot",
					EntryFace: faceA, OffsetMm: [3]float64{0, 0, 0}, Axis: [3]float64{0, -1, 0}, DiameterMm: 3, DepthMm: 12},
				{RuleID: "dowel", RuleRevision: "test-1", ParticipantRole: "B", OperationRole: "dowel",
					EntryFace: faceB, OffsetMm: [3]float64{0, 0, 0}, Axis: [3]float64{0, 1, 0}, DiameterMm: 8, DepthMm: 9},
			},
		}
	}
	relationship.Recipes = []ContactOperationRecipe{
		recipe("rel-gab-back-01:side-left", "left", "back"),
		recipe("rel-gab-back-01:side-right", "right", "front"),
		recipe("rel-gab-back-01:floor", "bottom", "front"),
		recipe("rel-gab-back-01:top", "top", "back"),
	}

	var collected []domain.ContractIssue
	var operations []ResolvedMachiningOperation
	status := deriveFixedShelfJoinery(relationship, backPanelCabinetBoards(582, 720), &collected, &operations)
	if status.Stage != JoineryMachiningReady {
		t.Fatalf("stage = %s, want MACHINING_READY; issues=%+v", status.Stage, collected)
	}
	if len(status.Blockers) != 0 {
		t.Fatalf("a ready joint carries no blockers: %+v", status.Blockers)
	}
	// 4 contacts x 2 rules = 8 operations, each carrying one hole per
	// planned station (16 holes), all provenance-pinned.
	if len(operations) != 8 {
		t.Fatalf("operations = %d, want 8 (4 contacts x 2 rules)", len(operations))
	}
	totalHoles := 0
	for _, operation := range operations {
		if operation.Provenance.TechnicalProfileID != "test:back-panel-profile" {
			t.Fatalf("operation provenance = %+v", operation.Provenance)
		}
		if len(operation.Holes) != 2 {
			t.Fatalf("operation holes = %d, want one per planned station (2)", len(operation.Holes))
		}
		totalHoles += len(operation.Holes)
	}
	if totalHoles != 16 {
		t.Fatalf("total holes = %d, want 16 (4 contacts x 2 stations x 2 rules)", totalHoles)
	}
}

func TestBackPanelNegatives(t *testing.T) {
	t.Run("no station pattern fails closed", func(t *testing.T) {
		relationship := backPanelRelationship("gab")
		relationship.Parameters = nil
		var collected []domain.ContractIssue
		status := deriveFixedShelfJoinery(relationship, backPanelCabinetBoards(582, 720), &collected, nil)
		if status.Stage != JoineryStationInvalid {
			t.Fatalf("stage = %s, want STATION_INVALID (%+v)", status.Stage, status)
		}
	})
	t.Run("count and maxSpacing together fail closed", func(t *testing.T) {
		relationship := backPanelRelationship("gab")
		relationship.Parameters["stationCount"] = float64(3)
		var collected []domain.ContractIssue
		status := deriveFixedShelfJoinery(relationship, backPanelCabinetBoards(582, 720), &collected, nil)
		if status.Stage != JoineryStationInvalid {
			t.Fatalf("stage = %s, want STATION_INVALID (%+v)", status.Stage, status)
		}
	})
	t.Run("a missing neighbor blocks the whole joint", func(t *testing.T) {
		boards := backPanelCabinetBoards(582, 720)
		delete(boards, "top")
		var collected []domain.ContractIssue
		status := deriveFixedShelfJoinery(backPanelRelationship("gab"), boards, &collected, nil)
		if status.Stage != JoineryContactInvalid {
			t.Fatalf("stage = %s, want CONTACT_INVALID (%+v)", status.Stage, status)
		}
	})
	t.Run("recipes stay invalid on other kinds", func(t *testing.T) {
		relationship := backPanelRelationship("gab")
		relationship.Kind = "floor-side"
		relationship.Recipes = []ContactOperationRecipe{{ContactID: "x"}}
		if issues := validateRelationshipRecipes(relationship); len(issues) == 0 {
			t.Fatalf("floor-side must reject recipes")
		}
	})
}
