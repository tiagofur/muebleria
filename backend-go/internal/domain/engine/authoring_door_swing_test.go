package engine

// authoring_door_swing_test.go — unit tests for #529 door-swing logic.
//
// These tests cover the canonical business rules directly without going
// through the HTTP layer so they are cheap, deterministic, and focused on
// the swing-side assignment and affinity stamping.

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// --- helpers ---------------------------------------------------------------

func makeDoorBoard(id string) layoutBoard {
	return layoutBoard{
		id:          id,
		optionRole:  "FRENTE",
		widthMm:     400,
		lengthMm:    720,
		thicknessMm: 18,
	}
}

func makeSideBoard(id string) layoutBoard {
	return layoutBoard{
		id:          id,
		optionRole:  "CARCASA",
		widthMm:     18,
		lengthMm:    720,
		thicknessMm: 18,
	}
}

func doorSwingDef() domain.FurnitureParameterDefinition {
	return domain.FurnitureParameterDefinition{
		Name:         "doorSwing",
		Label:        "Apertura",
		Type:         domain.FurnitureParameterTypeEnum,
		DefaultValue: "left",
		Options:      []string{"left", "right", "pair"},
		Category:     domain.FurnitureParameterCategoryMetadata,
	}
}

func hingePlacement(id, host, face string) effectiveManualPlacement {
	return effectiveManualPlacement{
		intent: AuthoringManualPlacement{
			HardwarePlacementID:     id,
			CatalogHardwareID:       "hw-hinge",
			HostComponentInstanceID: host,
			AnchorFace:              face,
			OffsetMm:                [2]float64{298, 100},
		},
	}
}

func handlePlacement(id, host, face string) effectiveManualPlacement {
	return effectiveManualPlacement{
		intent: AuthoringManualPlacement{
			HardwarePlacementID:     id,
			CatalogHardwareID:       "hw-handle",
			HostComponentInstanceID: host,
			AnchorFace:              face,
			OffsetMm:                [2]float64{40, 360},
		},
	}
}

func minimalCatalog() domain.Catalog {
	return domain.Catalog{
		Hardware: []domain.Hardware{
			{ID: "hw-hinge", Code: "H-1", Name: "Bisagra Test", Category: "hinge", Active: true},
			{ID: "hw-handle", Code: "J-1", Name: "Jaladera Test", Category: "handle", Active: true},
		},
	}
}

// withBoard patches a placement's board pointer to the matching board.
func withBoard(p effectiveManualPlacement, boards []layoutBoard) effectiveManualPlacement {
	for i := range boards {
		if boards[i].id == p.intent.HostComponentInstanceID {
			p.board = &boards[i]
			return p
		}
	}
	return p
}

// --- doorSlotSwing ---------------------------------------------------------

func TestDoorSlotSwing(t *testing.T) {
	cases := []struct {
		swing    string
		slot     int
		wantSide string
	}{
		{"left", 0, "left"},
		{"right", 0, "right"},
		{"pair", 0, "left"},
		{"pair", 1, "right"},
	}
	for _, tc := range cases {
		got := doorSlotSwing(tc.swing, tc.slot)
		if got != tc.wantSide {
			t.Errorf("doorSlotSwing(%q, %d) = %q, want %q", tc.swing, tc.slot, got, tc.wantSide)
		}
	}
}

// --- oppositeFace ----------------------------------------------------------

func TestOppositeFace(t *testing.T) {
	if oppositeFace("left") != "right" {
		t.Fatal("oppositeFace(left) must be right")
	}
	if oppositeFace("right") != "left" {
		t.Fatal("oppositeFace(right) must be left")
	}
	if oppositeFace("front") != "front" {
		t.Fatal("oppositeFace(front) must be front (no-op)")
	}
}

// --- computeDoorSwingAccessories -------------------------------------------

func TestComputeDoorSwingAccessories_NoDoorSwingParam(t *testing.T) {
	boards := []layoutBoard{makeDoorBoard("door-01")}
	placements := []effectiveManualPlacement{}
	groups := computeDoorSwingAccessories(nil, nil, boards, placements, minimalCatalog())
	if groups != nil {
		t.Fatal("expected nil when no doorSwing parameter is defined")
	}
}

func TestComputeDoorSwingAccessories_NoDoorBoards(t *testing.T) {
	boards := []layoutBoard{makeSideBoard("side-01")}
	defs := []domain.FurnitureParameterDefinition{doorSwingDef()}
	evaluated := map[string]any{"doorSwing": "left"}
	groups := computeDoorSwingAccessories(defs, evaluated, boards, nil, minimalCatalog())
	if groups != nil {
		t.Fatal("expected nil when there are no FRENTE boards")
	}
}

func TestComputeDoorSwingAccessories_LeftSwing(t *testing.T) {
	door := makeDoorBoard("door-01")
	boards := []layoutBoard{door, makeSideBoard("side-L"), makeSideBoard("side-R")}
	defs := []domain.FurnitureParameterDefinition{doorSwingDef()}
	evaluated := map[string]any{"doorSwing": "left"}

	hp := withBoard(hingePlacement("hp-hinge-1", "door-01", "left"), boards)
	hh := withBoard(handlePlacement("hp-handle-1", "door-01", "right"), boards)

	groups := computeDoorSwingAccessories(defs, evaluated, boards, []effectiveManualPlacement{hp, hh}, minimalCatalog())

	if len(groups) != 1 {
		t.Fatalf("expected 1 door group, got %d", len(groups))
	}
	g := groups[0]
	if g.SwingSide != "left" {
		t.Errorf("SwingSide = %q, want left", g.SwingSide)
	}
	if g.HingeFace != "left" {
		t.Errorf("HingeFace = %q, want left", g.HingeFace)
	}
	if g.HandleFace != "right" {
		t.Errorf("HandleFace = %q, want right", g.HandleFace)
	}
	if len(g.Hinges) != 1 {
		t.Errorf("expected 1 hinge, got %d", len(g.Hinges))
	}
	if len(g.Handles) != 1 {
		t.Errorf("expected 1 handle, got %d", len(g.Handles))
	}
	if g.DoorLabel != "Puerta 1" {
		t.Errorf("DoorLabel = %q, want Puerta 1", g.DoorLabel)
	}
}

func TestComputeDoorSwingAccessories_RightSwing(t *testing.T) {
	door := makeDoorBoard("door-01")
	boards := []layoutBoard{door}
	defs := []domain.FurnitureParameterDefinition{doorSwingDef()}
	evaluated := map[string]any{"doorSwing": "right"}

	hp := withBoard(hingePlacement("hp-hinge-1", "door-01", "right"), boards)
	hh := withBoard(handlePlacement("hp-handle-1", "door-01", "left"), boards)

	groups := computeDoorSwingAccessories(defs, evaluated, boards, []effectiveManualPlacement{hp, hh}, minimalCatalog())

	if len(groups) != 1 {
		t.Fatalf("expected 1 door group, got %d", len(groups))
	}
	g := groups[0]
	if g.SwingSide != "right" {
		t.Errorf("SwingSide = %q, want right", g.SwingSide)
	}
	if g.HingeFace != "right" {
		t.Errorf("HingeFace = %q, want right", g.HingeFace)
	}
	if g.HandleFace != "left" {
		t.Errorf("HandleFace = %q, want left", g.HandleFace)
	}
}

func TestComputeDoorSwingAccessories_PairSwing(t *testing.T) {
	door0 := makeDoorBoard("door-01")
	door1 := makeDoorBoard("door-02")
	boards := []layoutBoard{door0, door1, makeSideBoard("side-L")}
	defs := []domain.FurnitureParameterDefinition{doorSwingDef()}
	evaluated := map[string]any{"doorSwing": "pair"}

	hp0 := withBoard(hingePlacement("hp-hinge-01", "door-01", "left"), boards)
	hh0 := withBoard(handlePlacement("hp-handle-01", "door-01", "right"), boards)
	hp1 := withBoard(hingePlacement("hp-hinge-02", "door-02", "right"), boards)
	hh1 := withBoard(handlePlacement("hp-handle-02", "door-02", "left"), boards)

	groups := computeDoorSwingAccessories(defs, evaluated, boards,
		[]effectiveManualPlacement{hp0, hh0, hp1, hh1}, minimalCatalog())

	if len(groups) != 2 {
		t.Fatalf("expected 2 door groups for pair, got %d", len(groups))
	}
	if groups[0].SwingSide != "left" {
		t.Errorf("door[0] SwingSide = %q, want left", groups[0].SwingSide)
	}
	if groups[1].SwingSide != "right" {
		t.Errorf("door[1] SwingSide = %q, want right", groups[1].SwingSide)
	}
	if groups[0].DoorLabel != "Puerta 1" {
		t.Errorf("door[0] DoorLabel = %q, want Puerta 1", groups[0].DoorLabel)
	}
	if groups[1].DoorLabel != "Puerta 2" {
		t.Errorf("door[1] DoorLabel = %q, want Puerta 2", groups[1].DoorLabel)
	}
}

// --- stampDoorAffinity -----------------------------------------------------

func TestStampDoorAffinity_AnnotatesCorrectly(t *testing.T) {
	door := makeDoorBoard("door-01")
	boards := []layoutBoard{door}
	defs := []domain.FurnitureParameterDefinition{doorSwingDef()}
	evaluated := map[string]any{"doorSwing": "left"}

	hp := withBoard(hingePlacement("hp-hinge-1", "door-01", "left"), boards)
	hh := withBoard(handlePlacement("hp-handle-1", "door-01", "right"), boards)
	groups := computeDoorSwingAccessories(defs, evaluated, boards,
		[]effectiveManualPlacement{hp, hh}, minimalCatalog())

	placements := []AuthoringManualPlacement{
		{HardwarePlacementID: "hp-hinge-1", CatalogHardwareID: "hw-hinge"},
		{HardwarePlacementID: "hp-handle-1", CatalogHardwareID: "hw-handle"},
		{HardwarePlacementID: "unrelated-hw", CatalogHardwareID: "hw-other"},
	}
	stampDoorAffinity(placements, groups)

	hinge := placements[0]
	if hinge.DoorAffinity == nil {
		t.Fatal("hinge placement must have DoorAffinity after stamp")
	}
	if hinge.DoorAffinity.AccessoryRole != domain.DoorAccessoryHinge {
		t.Errorf("hinge role = %q, want hinge", hinge.DoorAffinity.AccessoryRole)
	}
	if hinge.DoorAffinity.SwingSide != "left" {
		t.Errorf("hinge SwingSide = %q, want left", hinge.DoorAffinity.SwingSide)
	}
	if hinge.DoorAffinity.DoorLabel != "Puerta 1" {
		t.Errorf("hinge DoorLabel = %q, want Puerta 1", hinge.DoorAffinity.DoorLabel)
	}

	handle := placements[1]
	if handle.DoorAffinity == nil {
		t.Fatal("handle placement must have DoorAffinity after stamp")
	}
	if handle.DoorAffinity.AccessoryRole != domain.DoorAccessoryHandle {
		t.Errorf("handle role = %q, want handle", handle.DoorAffinity.AccessoryRole)
	}

	unrelated := placements[2]
	if unrelated.DoorAffinity != nil {
		t.Error("non-door placement must not have DoorAffinity")
	}
}

func TestStampDoorAffinity_EmptyGroups(t *testing.T) {
	placements := []AuthoringManualPlacement{
		{HardwarePlacementID: "hw-1"},
	}
	stampDoorAffinity(placements, nil)
	if placements[0].DoorAffinity != nil {
		t.Error("nil groups must leave DoorAffinity nil")
	}
}

// --- hardware name resolution in rows --------------------------------------

func TestComputeDoorSwingAccessories_HardwareNamePopulated(t *testing.T) {
	door := makeDoorBoard("door-01")
	boards := []layoutBoard{door}
	defs := []domain.FurnitureParameterDefinition{doorSwingDef()}
	evaluated := map[string]any{"doorSwing": "left"}

	hp := withBoard(hingePlacement("hp-hinge-1", "door-01", "left"), boards)
	groups := computeDoorSwingAccessories(defs, evaluated, boards,
		[]effectiveManualPlacement{hp}, minimalCatalog())

	if len(groups) == 0 || len(groups[0].Hinges) == 0 {
		t.Fatal("expected hinge in group")
	}
	if groups[0].Hinges[0].HardwareName != "Bisagra Test" {
		t.Errorf("HardwareName = %q, want Bisagra Test", groups[0].Hinges[0].HardwareName)
	}
}
