package engine

// #1702 — the workshop's piece offsets authored in the Web (designParts
// label pos:<anchor>:<x>:<y>:<z>) are the placement language for kit
// children on doors: anchor min/max = flush with THAT side panel's inner
// face, xOff = mm from it; y/z = depth/height deltas from the hinge
// placement. Verbatim — no defaults: 0 = no displacement. The owner's
// numbers: copa piece, label pos:min:0:-37:0 (Lado Izquierda, Offset X 0,
// Offset Y Prof −37, Offset Z 0), SKP origin at the perforations center.

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func kitOffsetsFixture() (domain.Module, domain.Catalog) {
	module, catalog := oneDoorCabinetCatalog()
	// The kit: parent hinge (placed by the door's BISAGRA-style placement)
	// with the two workshop pieces as kit children.
	parent := domain.Hardware{ID: "hw-hinge-kit", Code: "HER-BIS-QA1031", Name: "Bisagra QA", Active: true}
	copa := domain.Hardware{
		ID: "hw-copa", Code: copaChildCode, Name: "Bisagra QA — Copa (fija al mueble)",
		KitHardwareID: strPtr(parent.ID), Active: true,
		PreviewShape: strPtr("hinge"),
		DesignParts: []domain.HardwareDesignPart{{
			Label:           "pos:min:0:-37:0",
			ComponentName:   copaChildCode,
			ActorMembership: "body",
		}},
	}
	brazo := domain.Hardware{
		ID: "hw-brazo", Code: "HER-BIS-QA1031-BRAZO", Name: "Bisagra QA — Brazo (móvil de la puerta)",
		KitHardwareID: strPtr(parent.ID), Active: true,
		PreviewShape: strPtr("hinge"),
	}
	catalog.Hardware = append(catalog.Hardware, parent, copa, brazo)
	// The door's hinge placement now references the kit PARENT.
	module.Components = []domain.ComponentInstance{{
		ComponentID: "comp-door", Quantity: 1,
		Overrides: &domain.ComponentInstanceOverrides{
			HardwarePlacements: []domain.HardwarePlacement{{
				HardwareID: parent.ID, AnchorFace: "back", RotationDeg: &domain.HardwareRotationDeg{Y: 180},
				RelativePosition: domain.HardwareRelPosition{
					XMm: 20.5, YFormula: "90",
				},
			}},
		},
	}}
	return module, catalog
}

const copaChildCode = "HER-BIS-QA1031-COPA"

// hardwareByChildID finds a kit child by ITS hardware id (each kit child
// carries the piece's own hardware id on the wire).
func hardwareByChildID(layout FurnitureLayout, hardwareID string) *LayoutHardware {
	for i := range layout.Hardware {
		if layout.Hardware[i].HardwareID == hardwareID {
			return &layout.Hardware[i]
		}
	}
	return nil
}

// The owner's declaration: Lado Izquierda (label min) + Offset X 0 + Offset
// Y −37 + Offset Z 0 → the copa lands flush with the LEFT panel's inner
// face, shifted 37 mm toward the cabinet back, at the hinge height.
func TestKitChildAppliesWebPieceOffsetsVerbatim(t *testing.T) {
	module, catalog := kitOffsetsFixture()
	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}, nil, resolveOptions{})
	if err != nil {
		t.Fatalf("resolve with kit children: %v", err)
	}

	copa := hardwareByChildID(layout, "hw-copa")
	if copa == nil {
		t.Fatalf("the copa kit child must materialize, hardware: %+v", layout.Hardware)
	}
	pos := copa.LocalTransform.TranslationMm
	// Flush with the left panel's inner face (tSide 18): the plate's anchor
	// lands on the inner face plane.
	if pos[0] != 18 {
		t.Fatalf("copa must sit flush at the left panel inner face (x=18), got x=%g", pos[0])
	}
	// Depth delta −37 from the hinge placement (the hinge's own box starts
	// at the door's back face y=560): 560 − 37 = 523.
	if pos[1] != 523 {
		t.Fatalf("copa depth delta −37 must land at y=523, got y=%g", pos[1])
	}
	// Height delta 0: no vertical displacement.
	if pos[2] != 92 {
		t.Fatalf("copa height delta 0 must keep the hinge height z=92, got z=%g", pos[2])
	}
	if copa.ActorMembership != "body" {
		t.Fatalf("the copa is a fixed (body) piece, got %q", copa.ActorMembership)
	}
}

// The zero rule: same kit with the label zeroed (pos:min:0:0:0) — the X
// reference still flushes to the declared side's inner face, and y/z get NO
// displacement (no hidden defaults like the historic 10/35).
func TestKitChildZeroOffsetsMeansNoDisplacement(t *testing.T) {
	module, catalog := kitOffsetsFixture()
	for i := range catalog.Hardware {
		if catalog.Hardware[i].ID == "hw-copa" {
			catalog.Hardware[i].DesignParts[0].Label = "pos:min:0:0:0"
		}
	}
	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}, nil, resolveOptions{})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	copa := hardwareByChildID(layout, "hw-copa")
	if copa == nil {
		t.Fatalf("copa missing")
	}
	pos := copa.LocalTransform.TranslationMm
	if pos[0] != 18 {
		t.Fatalf("declared side still flushes at x=18 with offset 0, got x=%g", pos[0])
	}
	if pos[1] != 560 {
		t.Fatalf("zero depth offset must keep the hinge depth y=560 (no hidden default), got y=%g", pos[1])
	}
	if pos[2] != 92 {
		t.Fatalf("zero height offset must keep the hinge height z=92, got z=%g", pos[2])
	}
}

// Lado Derecha (label max) flips the reference to the right panel's inner
// face; the y delta still rides.
func TestKitChildMaxSideReferencesTheOtherPanel(t *testing.T) {
	module, catalog := kitOffsetsFixture()
	for i := range catalog.Hardware {
		if catalog.Hardware[i].ID == "hw-copa" {
			catalog.Hardware[i].DesignParts[0].Label = "pos:max:0:-37:0"
		}
	}
	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}, nil, resolveOptions{})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	copa := hardwareByChildID(layout, "hw-copa")
	if copa == nil {
		t.Fatalf("copa missing")
	}
	// The right panel spans x[582,600] (18 thick; inner face 582 = W−tSide);
	// the plate lands flush there.
	if pos := copa.LocalTransform.TranslationMm; pos[0] != 582 {
		t.Fatalf("Lado Derecha must flush the copa at the right panel inner face (x=582), got x=%g", pos[0])
	}
	if pos := copa.LocalTransform.TranslationMm; pos[1] != 523 {
		t.Fatalf("depth delta −37 still applies, got y=%g", pos[1])
	}
}

// Without a web declaration the legacy #1592 half-heuristic snap keeps
// working (MERIVOBOX members unchanged).
func TestKitChildWithoutDeclarationKeepsLegacySnap(t *testing.T) {
	module, catalog := kitOffsetsFixture()
	for i := range catalog.Hardware {
		if catalog.Hardware[i].ID == "hw-copa" {
			catalog.Hardware[i].DesignParts = nil
		}
	}
	layout, _, err := resolveFurnitureLayoutOpts(module, catalog, &LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}, nil, resolveOptions{})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	copa := hardwareByChildID(layout, "hw-copa")
	if copa == nil {
		t.Fatalf("copa missing")
	}
	// The hinge mount sits on the door's max half (xFormula-less x=20.5 on
	// a 595 door → max half): the legacy snap targets W − tSide = 582, the
	// RIGHT panel's inner face.
	if pos := copa.LocalTransform.TranslationMm; pos[0] != 582 {
		t.Fatalf("legacy snap must land at x=582 (W−tSide), got x=%g", pos[0])
	}
	// No label → no y/z deltas: the hinge placement's own depth/height.
	if pos := copa.LocalTransform.TranslationMm; pos[1] != 560 || pos[2] != 92 {
		t.Fatalf("legacy: no deltas, got y=%g z=%g", pos[1], pos[2])
	}
}
