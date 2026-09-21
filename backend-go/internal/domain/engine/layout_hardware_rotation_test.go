package engine

import (
	"math"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// F6 (#668): HardwarePlacement.rotationDeg must reach
// LayoutHardware.localTransform.basis with Web parity. The web renderer
// (HardwareMesh.tsx) mounts each placement as a child group of the posed
// board: outer rotation = Euler XYZ of rotationDeg (board frame), inner
// quaternion = shortest arc +Y→face normal. The grip of a bar-pull runs along
// the primitive X, and the canonical hardware space (mount_frame.rb) is
// +X longitudinal, +Y in-plane, +Z outward normal — so basis.X is the
// longitudinal (grip) axis and basis.Z the outward mount normal.

func rotationTestBoard() *layoutBoard {
	return &layoutBoard{
		id:          "front-board-1",
		widthMm:     560,
		thicknessMm: 18,
		lengthMm:    400,
	}
}

func rotationTestCatalog(withMountFrame bool) domain.Catalog {
	hw := domain.Hardware{
		ID:     "hw-bar-pull",
		Active: true,
		Name:   "Tirador 160",
		// bar-pull: extentU (size) runs along the longitudinal axis u.
		PreviewShape:    strPtr("bar-pull"),
		PreviewSizeMm:   floatPtr(160),
		PreviewDiameterMm: floatPtr(12),
	}
	if withMountFrame {
		hw.VisualAsset = &domain.HardwareVisualAssetBinding{
			AssetID:         "asset-handle-1",
			AssetRevisionID: "rev-handle-1",
			SHA256:          "sha256-rotation-test-0000000000000000000000000000000000000000000000000000",
			Representation:  domain.HardwareAssetRepresentationSKP,
			ValidationState: domain.HardwareAssetValidationPending,
			PreparationState: domain.HardwareAssetPreparationPrepared,
			// Non-identity, right-handed mount frame: the asset is authored
			// rotated 90° about its own mount normal (+Z canonical) with an
			// offset origin — placement rotation must coexist with it, not
			// compensate it.
			MountFrame: &domain.HardwareMountFrame{
				OriginMm: [3]float64{4, 5, 6},
				Basis: domain.HardwareBasis{
					X: [3]float64{0, 1, 0},
					Y: [3]float64{-1, 0, 0},
					Z: [3]float64{0, 0, 1},
				},
			},
		}
	}
	return domain.Catalog{Hardware: []domain.Hardware{hw}}
}

func rotationTestPlacement(rotation *domain.HardwareRotationDeg) domain.HardwarePlacement {
	return domain.HardwarePlacement{
		HardwareID:       "hw-bar-pull",
		AnchorFace:       "front",
		RelativePosition: domain.HardwareRelPosition{XMm: 280, YMm: 60},
		RotationDeg:      rotation,
	}
}

func requireValidRotationBasis(t *testing.T, hw LayoutHardware, label string) {
	t.Helper()
	if err := validateLayoutBasis(hw.LocalTransform.Basis); err != nil {
		t.Fatalf("%s: %v", label, err)
	}
}

// A. Same board, same hardware, same position: rotationDeg 0 vs 90 must keep
// translation and face normal while rotating the longitudinal axis 90° in the
// face plane — unit, orthogonal, right-handed (det +1), no scale.
func TestResolveHardwareRotationFrontFace0Vs90(t *testing.T) {
	board := rotationTestBoard()
	catalog := rotationTestCatalog(false)

	hw0, ok := resolveHardwareToWorld(board, rotationTestPlacement(nil), catalog, "hp-rot-0")
	if !ok {
		t.Fatal("rotation 0 placement must resolve")
	}
	hw90, ok := resolveHardwareToWorld(board, rotationTestPlacement(&domain.HardwareRotationDeg{Y: 90}), catalog, "hp-rot-90")
	if !ok {
		t.Fatal("rotation 90 placement must resolve")
	}

	requireValidRotationBasis(t, hw0, "rotation 0")
	requireValidRotationBasis(t, hw90, "rotation 90")

	if hw0.LocalTransform.TranslationMm != hw90.LocalTransform.TranslationMm {
		t.Fatalf("rotation must not move the mount point: %v vs %v",
			hw0.LocalTransform.TranslationMm, hw90.LocalTransform.TranslationMm)
	}
	if hw0.LocalTransform.Basis.Z != hw90.LocalTransform.Basis.Z {
		t.Fatalf("rotation in the face plane must keep the mount normal: %v vs %v",
			hw0.LocalTransform.Basis.Z, hw90.LocalTransform.Basis.Z)
	}
	// Front face of a rot-0 board: mount normal = workshop +Z.
	if hw0.LocalTransform.Basis.Z != [3]float64{0, 0, 1} {
		t.Fatalf("front-face mount normal, got %v", hw0.LocalTransform.Basis.Z)
	}
	x0 := hw0.LocalTransform.Basis.X
	x90 := hw90.LocalTransform.Basis.X
	if d := dot3(x0, x90); math.Abs(d) > 1e-9 {
		t.Fatalf("longitudinal axis must rotate 90°, dot = %v (%v vs %v)", d, x0, x90)
	}
	// Workshop frame for a rot-0 front board: X = board X (width, horizontal),
	// Y = board Z (length, vertical). Web horizontal handle ⇒ basis.X = +X.
	if x0 != [3]float64{1, 0, 0} {
		t.Fatalf("rotation 0 longitudinal axis must be workshop +X (horizontal), got %v", x0)
	}
	if x90 != [3]float64{0, 1, 0} && x90 != [3]float64{0, -1, 0} {
		t.Fatalf("rotation 90 longitudinal axis must be vertical (workshop ±Y), got %v", x90)
	}
}

// B. The exact owner repro: a drawer front with a bar-pull configured
// horizontally in Web (rotationDeg 0) must resolve to a horizontal workshop
// basis; the same placement rotated 90° resolves vertical.
func TestResolveHardwareRotationDrawerPullHorizontalParity(t *testing.T) {
	board := rotationTestBoard() // drawer front 560×18×400 (W×T×L)
	catalog := rotationTestCatalog(false)

	hw, ok := resolveHardwareToWorld(board, rotationTestPlacement(nil), catalog, "hp-drawer")
	if !ok {
		t.Fatal("drawer pull must resolve")
	}
	requireValidRotationBasis(t, hw, "drawer pull")
	// Web renders the grip along board X (width) ⇒ workshop X ⇒ horizontal.
	if hw.LocalTransform.Basis.X != [3]float64{1, 0, 0} {
		t.Fatalf("drawer pull must be horizontal in the workshop frame (basis.X=+X), got %v",
			hw.LocalTransform.Basis.X)
	}

	hwVert, ok := resolveHardwareToWorld(board, rotationTestPlacement(&domain.HardwareRotationDeg{Y: 90}), catalog, "hp-drawer-v")
	if !ok {
		t.Fatal("rotated drawer pull must resolve")
	}
	if v := hwVert.LocalTransform.Basis.X; v != [3]float64{0, 1, 0} && v != [3]float64{0, -1, 0} {
		t.Fatalf("rotated drawer pull must be vertical in the workshop frame (basis.X=±Y), got %v", v)
	}
}

// C. Not a front-only rule: a top-face placement rotates in its own face plane
// (board Z is the top normal, so rotationDeg.z is the in-plane angle).
func TestResolveHardwareRotationTopFace(t *testing.T) {
	board := rotationTestBoard()
	catalog := rotationTestCatalog(false)
	placement := rotationTestPlacement(nil)
	placement.AnchorFace = "top"

	hw0, ok := resolveHardwareToWorld(board, placement, catalog, "hp-top-0")
	if !ok {
		t.Fatal("top-face placement must resolve")
	}
	placement.RotationDeg = &domain.HardwareRotationDeg{Z: 90}
	hw90, ok := resolveHardwareToWorld(board, placement, catalog, "hp-top-90")
	if !ok {
		t.Fatal("top-face rotated placement must resolve")
	}

	requireValidRotationBasis(t, hw0, "top 0")
	requireValidRotationBasis(t, hw90, "top 90")

	// Top-face mount normal: board +Z → workshop +Y.
	if hw0.LocalTransform.Basis.Z != [3]float64{0, 1, 0} {
		t.Fatalf("top-face mount normal, got %v", hw0.LocalTransform.Basis.Z)
	}
	if hw0.LocalTransform.Basis.Z != hw90.LocalTransform.Basis.Z {
		t.Fatalf("in-plane rotation must keep the top-face normal")
	}
	if d := dot3(hw0.LocalTransform.Basis.X, hw90.LocalTransform.Basis.X); math.Abs(d) > 1e-9 {
		t.Fatalf("top-face longitudinal axis must rotate 90°, dot = %v", d)
	}
	// Web parity at rotation 0: the grip stays along board X (width).
	if hw0.LocalTransform.Basis.X != [3]float64{1, 0, 0} {
		t.Fatalf("top-face rotation-0 longitudinal axis, got %v", hw0.LocalTransform.Basis.X)
	}
}

// D. Host board with a non-identity orientation: the placement rotation is
// composed in the board frame (local to the face), then carried by the board
// rotation — never applied around a world axis.
func TestResolveHardwareRotationOnRotatedBoardIsLocalToFace(t *testing.T) {
	board := rotationTestBoard()
	board.rotZ = 90
	catalog := rotationTestCatalog(false)

	hw0, ok := resolveHardwareToWorld(board, rotationTestPlacement(nil), catalog, "hp-board-rot-0")
	if !ok {
		t.Fatal("rotated-board placement must resolve")
	}
	hw90, ok := resolveHardwareToWorld(board, rotationTestPlacement(&domain.HardwareRotationDeg{Y: 90}), catalog, "hp-board-rot-90")
	if !ok {
		t.Fatal("rotated-board rotated placement must resolve")
	}

	requireValidRotationBasis(t, hw0, "board rot, placement 0")
	requireValidRotationBasis(t, hw90, "board rot, placement 90")

	if hw0.LocalTransform.TranslationMm != hw90.LocalTransform.TranslationMm {
		t.Fatalf("rotation must not move the mount point on a rotated board")
	}
	// The 90° placement rotation is composed BEFORE the board rotation:
	// local grip axis for Y:90 is board (0,0,-1); the board Rz(90°) leaves it
	// at (0,0,-1); render→workshop swaps Y/Z ⇒ (0,-1,0).
	if want := [3]float64{0, -1, 0}; hw90.LocalTransform.Basis.X != want {
		t.Fatalf("rotated board × rotated placement longitudinal axis, want %v, got %v",
			want, hw90.LocalTransform.Basis.X)
	}
	if d := dot3(hw0.LocalTransform.Basis.X, hw90.LocalTransform.Basis.X); math.Abs(d) > 1e-9 {
		t.Fatalf("placement rotation must stay local to the face, dot = %v", d)
	}
}

// E. The authoring/manual path must not drop the authored rotation between the
// intent and the domain HardwarePlacement consumed by resolveHardwareToWorld.
func TestAuthoringResolveManualPlacementKeepsRotationDeg(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	base := AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		Occurrences:            defaultAuthoringOccurrences(),
		Relationships:          []AuthoringRelationship{},
		ManualPlacementsPresent: true,
	}

	flat := base
	flat.ManualPlacements = []AuthoringManualPlacement{{
		HardwarePlacementID:     "hp-manual-flat",
		CatalogHardwareID:       "hw-handle",
		HostComponentInstanceID: "door-01",
		AnchorFace:              "front",
		OffsetMm:                [2]float64{200, 100},
	}}
	rotated := base
	rotated.ManualPlacements = []AuthoringManualPlacement{{
		HardwarePlacementID:     "hp-manual-rot",
		CatalogHardwareID:       "hw-handle",
		HostComponentInstanceID: "door-01",
		AnchorFace:              "front",
		OffsetMm:                [2]float64{200, 100},
		RotationDeg:             &domain.HardwareRotationDeg{Y: 90},
	}}

	resFlat, err := ResolveAuthoringLayout(flat)
	if err != nil {
		t.Fatalf("flat resolve: %v", err)
	}
	resRot, err := ResolveAuthoringLayout(rotated)
	if err != nil {
		t.Fatalf("rotated resolve: %v", err)
	}
	if len(resFlat.StructuralIssues) > 0 || len(resRot.StructuralIssues) > 0 {
		t.Fatalf("unexpected structural issues: %v / %v",
			resFlat.StructuralIssues, resRot.StructuralIssues)
	}
	if len(resFlat.Layout.Hardware) != 1 || len(resRot.Layout.Hardware) != 1 {
		t.Fatalf("expected exactly one manual placement each, got %d / %d",
			len(resFlat.Layout.Hardware), len(resRot.Layout.Hardware))
	}

	hwFlat := resFlat.Layout.Hardware[0]
	hwRot := resRot.Layout.Hardware[0]
	requireValidRotationBasis(t, hwFlat, "manual flat")
	requireValidRotationBasis(t, hwRot, "manual rotated")

	if hwFlat.LocalTransform.Basis.Z != hwRot.LocalTransform.Basis.Z {
		t.Fatalf("manual rotation must keep the mount normal")
	}
	if d := dot3(hwFlat.LocalTransform.Basis.X, hwRot.LocalTransform.Basis.X); math.Abs(d) > 1e-9 {
		t.Fatalf("manual placement rotation lost: longitudinal dot = %v (%v vs %v)", d,
			hwFlat.LocalTransform.Basis.X, hwRot.LocalTransform.Basis.X)
	}
}

// F. Placement rotation and the asset MountFrame are independent authorities:
// a non-identity MountFrame passes through untouched while the basis carries
// the rotation (composition T_placement × inverse(T_mountFrame) happens in
// SketchUp — see the Ruby regression).
func TestResolveHardwareRotationWithNonIdentityMountFrame(t *testing.T) {
	board := rotationTestBoard()
	catalog := rotationTestCatalog(true)

	hw0, ok := resolveHardwareToWorld(board, rotationTestPlacement(nil), catalog, "hp-mf-0")
	if !ok {
		t.Fatal("prepared asset placement must resolve")
	}
	hw90, ok := resolveHardwareToWorld(board, rotationTestPlacement(&domain.HardwareRotationDeg{Y: 90}), catalog, "hp-mf-90")
	if !ok {
		t.Fatal("prepared asset rotated placement must resolve")
	}

	requireValidRotationBasis(t, hw0, "mount frame rotation 0")
	requireValidRotationBasis(t, hw90, "mount frame rotation 90")

	wantFrame := rotationTestCatalog(true).Hardware[0].VisualAsset.MountFrame
	if hw0.MountFrame == nil || *hw0.MountFrame != *wantFrame || hw90.MountFrame == nil || *hw90.MountFrame != *wantFrame {
		t.Fatalf("mount frame must pass through unchanged: %v / %v", hw0.MountFrame, hw90.MountFrame)
	}
	if d := dot3(hw0.LocalTransform.Basis.X, hw90.LocalTransform.Basis.X); math.Abs(d) > 1e-9 {
		t.Fatalf("rotation must survive alongside the mount frame, dot = %v", d)
	}
}
