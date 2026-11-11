package engine

import (
	"math"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1592: the fixed plate of a door hinge kit (Copa, actor body) mounts ON
// the hinge-side panel's inner face — furniture x = W − tSide (hinge on the
// furniture-max half) or tSide (furniture-min half). The mobile arm (Brazo,
// actor:door) stays anchored on the door's back face. Repro geometry: the
// alacena 2P (W=800, sides 15mm at [0,15] and [785,800], doors at
// [402,799] and [2,399] with the rotateY-180 pose).

func kitPlateBoard(x float64) *layoutBoard {
	return &layoutBoard{
		id:          "door-board",
		placement:   "puerta",
		x:           x,
		y:           320,
		z:           2,
		rotX:        90,
		rotY:        180,
		widthMm:     397,
		thicknessMm: 18,
		lengthMm:    716,
	}
}

func kitPlateCatalog() domain.Catalog {
	membership := func(m string) []domain.HardwareDesignPart {
		return []domain.HardwareDesignPart{{ActorMembership: m}}
	}
	parent := "9f8212fb-f210-4862-a085-78e2f9ff2bc4"
	return domain.Catalog{
		Hardware: []domain.Hardware{
			{
				ID: parent, Active: true, Name: "Bisagra QA Kit",
				PreviewShape: strPtr("hinge"), PreviewSizeMm: floatPtr(35),
			},
			{
				ID: "brazo-1", Active: true, Name: "Bisagra QA — Brazo (móvil)",
				KitHardwareID: &parent,
				PreviewShape:  strPtr("hinge"), PreviewSizeMm: floatPtr(35),
				DesignParts: membership("actor:door"),
			},
			{
				ID: "copa-1", Active: true, Name: "Bisagra QA — Copa (fija al mueble)",
				KitHardwareID: &parent,
				PreviewShape:  strPtr("hinge"), PreviewSizeMm: floatPtr(35),
				DesignParts: membership("body"),
			},
		},
	}
}

func kitPlatePlacement() domain.HardwarePlacement {
	return domain.HardwarePlacement{
		HardwareID:       "9f8212fb-f210-4862-a085-78e2f9ff2bc4",
		AnchorFace:       "back",
		RelativePosition: domain.HardwareRelPosition{XMm: 20.5, YMm: 90},
		RotationDeg:      &domain.HardwareRotationDeg{Y: 180},
	}
}

func kitPlateX(t *testing.T, rows []LayoutHardware, name string) float64 {
	t.Helper()
	for _, row := range rows {
		if row.ActorMembership == name {
			return row.LocalTransform.TranslationMm[0]
		}
	}
	t.Fatalf("no row with actorMembership %q in %+v", name, rows)
	return 0
}

// The right door (board.x=402): the plate lands on the right side's inner
// face (W − tSide = 785); the arm stays on the door's back face (778.5).
func TestKitPlateMountsOnHingeSideInnerFace(t *testing.T) {
	rows := resolveHardwareOrKitToWorld(kitPlateBoard(402), kitPlatePlacement(),
		kitPlateCatalog(), 15, 800, "hp-kit")
	if len(rows) != 2 {
		t.Fatalf("want 2 kit rows (brazo+copa), got %d", len(rows))
	}
	brazo := kitPlateX(t, rows, "actor:door")
	if math.Abs(brazo-778.5) > 0.01 {
		t.Fatalf("brazo furniture x: want 778.5 (door back face, authored frame), got %.3f", brazo)
	}
	copa := kitPlateX(t, rows, "body")
	if math.Abs(copa-785) > 0.01 {
		t.Fatalf("copa furniture x: want 785 (right side inner face W − tSide), got %.3f", copa)
	}
}

// The mirrored (left) door: the plate lands on the left side's inner face
// (tSide = 15); the arm stays authored (furniture 22.5).
func TestKitPlateMountsOnInnerFaceMirroredDoor(t *testing.T) {
	// The izquierda recipe authors PW−20.5 (large local x = hinge near the
	// furniture-min side): the w/2 branch must route the plate to tSide.
	rows := resolveHardwareOrKitToWorld(kitPlateBoard(2), domain.HardwarePlacement{
		HardwareID:       "9f8212fb-f210-4862-a085-78e2f9ff2bc4",
		AnchorFace:       "back",
		RelativePosition: domain.HardwareRelPosition{XMm: 20.5, YMm: 90, XFormula: "PW-20.5"},
		RotationDeg:      &domain.HardwareRotationDeg{Y: 180},
	}, kitPlateCatalog(), 15, 800, "hp-kit-izq")
	if len(rows) != 2 {
		t.Fatalf("want 2 kit rows, got %d", len(rows))
	}
	brazo := kitPlateX(t, rows, "actor:door")
	// PW−20.5 evalúa a 377 (evaluador entero — brecha half-mm anotada en
	// #1591): face = board.x + w − 377 = 22.
	if math.Abs(brazo-22) > 0.01 {
		t.Fatalf("brazo furniture x: want 22, got %.3f", brazo)
	}
	copa := kitPlateX(t, rows, "body")
	if math.Abs(copa-15) > 0.01 {
		t.Fatalf("copa furniture x: want 15 (left side inner face tSide), got %.3f", copa)
	}
}

// Without a usable side thickness the plate still fails soft — it keeps the
// historic inward-shift fallback (door thickness) rather than guessing.
func TestKitPlateFallbackSideThickness(t *testing.T) {
	rows := resolveHardwareOrKitToWorld(kitPlateBoard(402), kitPlatePlacement(),
		kitPlateCatalog(), 0, 800, "hp-kit-fallback")
	if len(rows) != 2 {
		t.Fatalf("want 2 kit rows, got %d", len(rows))
	}
	copa := kitPlateX(t, rows, "body")
	// tSide falls back to the door thickness (18): target = 800 − 18 = 782.
	if math.Abs(copa-782) > 0.01 {
		t.Fatalf("copa furniture x: want 782 (fallback tSide=door thickness), got %.3f", copa)
	}
}
