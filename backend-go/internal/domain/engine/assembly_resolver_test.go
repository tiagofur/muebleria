package engine_test

import (
	"encoding/json"
	"errors"
	"math"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// FixtureDrawerSystem provides a synthetic, reproducible Agregado assembly definition.
// It models a standard drawer system with:
// - Left side (rigid member, variant-dependent depth)
// - Right side (rigid member, variant-dependent depth, anchored to maxX)
// - Left runner (rigid member, variant-dependent depth)
// - Right runner (rigid member, variant-dependent depth, anchored to maxX)
// - Fabricated bottom board (16mm, recalculated width and depth)
// - Fabricated back board (16mm, recalculated width and height)
func buildSyntheticDrawerFixture() (domain.Agregado, map[string]domain.Hardware, []engine.FabricatedBoardFormula) {
	kitID := "hw-kit-drawer-synth"

	agregado := domain.Agregado{
		ID:                      "agr-drawer-synth",
		Code:                    "DRAWER-SYNTH",
		Name:                    "Synthetic Test Drawer System",
		CommercialKitHardwareID: &kitID,
		VariantSets: []domain.AgregadoVariantSet{
			{
				ID:        "vs-drawer-depth",
				Dimension: "depth",
				Variants: []domain.ProductVariant{
					{NominalDimensionMm: 450.0, HardwareID: "hw-side-synth-450"},
					{NominalDimensionMm: 500.0, HardwareID: "hw-side-synth-500"},
					{NominalDimensionMm: 550.0, HardwareID: "hw-side-synth-550"},
				},
			},
		},
		CompatibilityRules: []domain.AssemblyCompatibilityRule{
			{
				VariantSetID:      "vs-drawer-depth",
				ClearanceMm:       3.0, // Available space must be >= nominal + 3mm
				SelectionStrategy: "max_fitting",
			},
		},
		RigidMembers: []domain.AgregadoRigidMember{
			{
				MemberID: "side_left",
				Role:     "side_left",
				Source: domain.RigidMemberSource{
					Kind:    domain.RigidMemberSourceVariant,
					Variant: &domain.VariantHardwareSource{VariantSetID: "vs-drawer-depth"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 2.0},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
				},
				BOMRole: domain.BOMRoleIncludedInKit,
			},
			{
				MemberID: "side_right",
				Role:     "side_right",
				Source: domain.RigidMemberSource{
					Kind:    domain.RigidMemberSourceVariant,
					Variant: &domain.VariantHardwareSource{VariantSetID: "vs-drawer-depth"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMax, OffsetMm: 0.0}, // Anchored to maxX
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 2.0},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
					// 180 deg rotation around Y or rigid flip:
					RotationDeg: &domain.HardwareRotationDeg{X: 0.0, Y: 180.0, Z: 180.0}, // Pure rigid rotation det=+1
				},
				BOMRole: domain.BOMRoleIncludedInKit,
			},
			{
				MemberID: "runner_left",
				Role:     "runner_left",
				Source: domain.RigidMemberSource{
					Kind:    domain.RigidMemberSourceVariant,
					Variant: &domain.VariantHardwareSource{VariantSetID: "vs-drawer-depth"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: -10.0},
				},
				BOMRole: domain.BOMRoleIncludedInKit,
			},
			{
				MemberID: "runner_right",
				Role:     "runner_right",
				Source: domain.RigidMemberSource{
					Kind:    domain.RigidMemberSourceVariant,
					Variant: &domain.VariantHardwareSource{VariantSetID: "vs-drawer-depth"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMax, OffsetMm: 0.0}, // Anchored to maxX
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: -10.0},
				},
				BOMRole: domain.BOMRoleIncludedInKit,
			},
		},
	}

	catalog := map[string]domain.Hardware{
		kitID: {
			ID:   kitID,
			Code: "KIT-DRAWER-SYNTH",
			Name: "Commercial Synthetic Drawer Kit",
		},
		"hw-side-synth-450": {
			ID:   "hw-side-synth-450",
			Code: "SIDE-SYNTH-450",
			Name: "Synthetic Side 450mm",
			VisualAsset: &domain.HardwareVisualAssetBinding{
				AssetID:         "ast-side-450",
				AssetRevisionID: "rev-side-450-r1",
				SHA256:          "a450a450a450a450a450a450a450a450a450a450a450a450a450a450a450a450",
				MountFrame: &domain.HardwareMountFrame{
					OriginMm: [3]float64{0.0, 0.0, 0.0},
					Basis: domain.HardwareBasis{
						X: [3]float64{1.0, 0.0, 0.0},
						Y: [3]float64{0.0, 1.0, 0.0},
						Z: [3]float64{0.0, 0.0, 1.0},
					},
				},
			},
		},
		"hw-side-synth-500": {
			ID:   "hw-side-synth-500",
			Code: "SIDE-SYNTH-500",
			Name: "Synthetic Side 500mm",
			VisualAsset: &domain.HardwareVisualAssetBinding{
				AssetID:         "ast-side-500",
				AssetRevisionID: "rev-side-500-r1",
				SHA256:          "a500a500a500a500a500a500a500a500a500a500a500a500a500a500a500a500",
				MountFrame: &domain.HardwareMountFrame{
					OriginMm: [3]float64{0.0, 0.0, 0.0},
					Basis: domain.HardwareBasis{
						X: [3]float64{1.0, 0.0, 0.0},
						Y: [3]float64{0.0, 1.0, 0.0},
						Z: [3]float64{0.0, 0.0, 1.0},
					},
				},
			},
		},
		"hw-side-synth-550": {
			ID:   "hw-side-synth-550",
			Code: "SIDE-SYNTH-550",
			Name: "Synthetic Side 550mm",
			VisualAsset: &domain.HardwareVisualAssetBinding{
				AssetID:         "ast-side-550",
				AssetRevisionID: "rev-side-550-r1",
				SHA256:          "a550a550a550a550a550a550a550a550a550a550a550a550a550a550a550a550",
			},
		},
	}

	fabricatedFormulas := []engine.FabricatedBoardFormula{
		{
			ComponentID: "cmp-drawer-bottom",
			SlotID:      "drawer_bottom",
			Name:        "Fondo de cajón",
			ThicknessMm: 16.0,
			// Width = W_free - 32mm, Length = VariantNominal - 10mm
			WidthFormulaMm: func(w, d, h, variantNominal float64) float64 {
				return w - 32.0
			},
			LengthFormulaMm: func(w, d, h, variantNominal float64) float64 {
				return variantNominal - 10.0
			},
			PlacementAnchorX: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 16.0},
			PlacementAnchorY: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 5.0},
			PlacementAnchorZ: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
		},
	}

	return agregado, catalog, fabricatedFormulas
}

func assertRigidBasis(t *testing.T, label string, basis domain.HardwareBasis) {
	t.Helper()
	tol := 1e-4

	magX := math.Sqrt((basis.X[0] * basis.X[0]) + (basis.X[1] * basis.X[1]) + (basis.X[2] * basis.X[2]))
	magY := math.Sqrt((basis.Y[0] * basis.Y[0]) + (basis.Y[1] * basis.Y[1]) + (basis.Y[2] * basis.Y[2]))
	magZ := math.Sqrt((basis.Z[0] * basis.Z[0]) + (basis.Z[1] * basis.Z[1]) + (basis.Z[2] * basis.Z[2]))

	if math.Abs(magX-1.0) > tol || math.Abs(magY-1.0) > tol || math.Abs(magZ-1.0) > tol {
		t.Fatalf("%s basis axes must have unit scale (got X=%.4f, Y=%.4f, Z=%.4f)", label, magX, magY, magZ)
	}

	det := basis.X[0]*((basis.Y[1]*basis.Z[2])-(basis.Y[2]*basis.Z[1])) -
		basis.X[1]*((basis.Y[0]*basis.Z[2])-(basis.Y[2]*basis.Z[0])) +
		basis.X[2]*((basis.Y[0]*basis.Z[1])-(basis.Y[1]*basis.Z[0]))

	if math.Abs(det-1.0) > tol {
		t.Fatalf("%s basis must have det=+1.0 (got det=%.4f, mirror rejected)", label, det)
	}
}

// Test A: Rigid member never scales under any parameter change
func TestA_RigidMemberNeverScales(t *testing.T) {
	agregado, catalog, formulas := buildSyntheticDrawerFixture()
	params := engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 520.0, HeightMm: 200.0}

	res, err := engine.ResolveAgregadoAssembly(agregado, params, catalog, formulas)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	for _, m := range res.Snapshot.RigidMembers {
		assertRigidBasis(t, m.MemberID, m.LocalTransform.Basis)
	}
}

// Test B: Width +200mm translates right member by exactly +200mm
func TestB_WidthExpansionShiftsRightMemberOnly(t *testing.T) {
	agregado, catalog, formulas := buildSyntheticDrawerFixture()

	p600 := engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 520.0, HeightMm: 200.0}
	res600, err := engine.ResolveAgregadoAssembly(agregado, p600, catalog, formulas)
	if err != nil {
		t.Fatalf("p600 resolution failed: %v", err)
	}

	p800 := engine.AssemblyResolutionParams{WidthMm: 800.0, DepthMm: 520.0, HeightMm: 200.0}
	res800, err := engine.ResolveAgregadoAssembly(agregado, p800, catalog, formulas)
	if err != nil {
		t.Fatalf("p800 resolution failed: %v", err)
	}

	var right600, right800 *domain.ResolvedRigidMember
	for i := range res600.Snapshot.RigidMembers {
		if res600.Snapshot.RigidMembers[i].MemberID == "side_right" {
			right600 = &res600.Snapshot.RigidMembers[i]
		}
	}
	for i := range res800.Snapshot.RigidMembers {
		if res800.Snapshot.RigidMembers[i].MemberID == "side_right" {
			right800 = &res800.Snapshot.RigidMembers[i]
		}
	}

	if right600 == nil || right800 == nil {
		t.Fatal("side_right not found in resolved members")
	}

	deltaX := right800.LocalTransform.TranslationMm[0] - right600.LocalTransform.TranslationMm[0]
	if math.Abs(deltaX-200.0) > 1e-4 {
		t.Fatalf("expected right member shift of +200.0mm, got %.4fmm", deltaX)
	}
}

// Test C: Left member remains identical on width change
func TestC_LeftMemberRemainsUnchangedOnWidthChange(t *testing.T) {
	agregado, catalog, formulas := buildSyntheticDrawerFixture()

	p600 := engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 520.0, HeightMm: 200.0}
	res600, err := engine.ResolveAgregadoAssembly(agregado, p600, catalog, formulas)
	if err != nil {
		t.Fatalf("p600 resolution failed: %v", err)
	}

	p800 := engine.AssemblyResolutionParams{WidthMm: 800.0, DepthMm: 520.0, HeightMm: 200.0}
	res800, err := engine.ResolveAgregadoAssembly(agregado, p800, catalog, formulas)
	if err != nil {
		t.Fatalf("p800 resolution failed: %v", err)
	}

	var left600, left800 *domain.ResolvedRigidMember
	for i := range res600.Snapshot.RigidMembers {
		if res600.Snapshot.RigidMembers[i].MemberID == "side_left" {
			left600 = &res600.Snapshot.RigidMembers[i]
		}
	}
	for i := range res800.Snapshot.RigidMembers {
		if res800.Snapshot.RigidMembers[i].MemberID == "side_left" {
			left800 = &res800.Snapshot.RigidMembers[i]
		}
	}

	if left600 == nil || left800 == nil {
		t.Fatal("side_left not found in resolved members")
	}

	if left600.LocalTransform.TranslationMm != left800.LocalTransform.TranslationMm {
		t.Fatalf("left member translation altered: p600=%v, p800=%v",
			left600.LocalTransform.TranslationMm, left800.LocalTransform.TranslationMm)
	}
}

// Test D: Fabricated dimensions recalculate, not scale
func TestD_FabricatedDimensionsRecalculateNotScale(t *testing.T) {
	agregado, catalog, formulas := buildSyntheticDrawerFixture()

	p600 := engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 520.0, HeightMm: 200.0}
	res600, _ := engine.ResolveAgregadoAssembly(agregado, p600, catalog, formulas)

	p800 := engine.AssemblyResolutionParams{WidthMm: 800.0, DepthMm: 520.0, HeightMm: 200.0}
	res800, _ := engine.ResolveAgregadoAssembly(agregado, p800, catalog, formulas)

	bottom600 := res600.Snapshot.FabricatedComponents[0]
	bottom800 := res800.Snapshot.FabricatedComponents[0]

	// 600 - 32 = 568 mm
	if math.Abs(bottom600.WidthMm-568.0) > 1e-4 {
		t.Fatalf("expected bottom width 568mm for W=600, got %.1f", bottom600.WidthMm)
	}
	// 800 - 32 = 768 mm
	if math.Abs(bottom800.WidthMm-768.0) > 1e-4 {
		t.Fatalf("expected bottom width 768mm for W=800, got %.1f", bottom800.WidthMm)
	}

	// Length = 500 - 10 = 490 mm for both
	if math.Abs(bottom600.LengthMm-490.0) > 1e-4 || math.Abs(bottom800.LengthMm-490.0) > 1e-4 {
		t.Fatalf("expected bottom length 490mm, got %.1f / %.1f", bottom600.LengthMm, bottom800.LengthMm)
	}

	// Transform basis is strictly identity (scale is 1.0, geometry regenerated)
	assertRigidBasis(t, "bottom_board", bottom800.Transform.Basis)
}

// Test E: Deterministic variant resolution
func TestE_DeterministicVariantResolution(t *testing.T) {
	agregado, catalog, formulas := buildSyntheticDrawerFixture()

	// Available depth = 520mm. Clearance = 3mm -> Usable = 517mm.
	// Variants: 450, 500, 550.
	// Expected: 500mm (hardware hw-side-synth-500).
	params := engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 520.0, HeightMm: 200.0}
	res, err := engine.ResolveAgregadoAssembly(agregado, params, catalog, formulas)
	if err != nil {
		t.Fatalf("resolution failed: %v", err)
	}

	selectedNominal := res.Snapshot.SelectedVariants["vs-drawer-depth"]
	if selectedNominal != 500.0 {
		t.Fatalf("expected 500mm variant, got %.1f", selectedNominal)
	}

	for _, m := range res.Snapshot.RigidMembers {
		if m.HardwareID != "hw-side-synth-500" {
			t.Fatalf("member %s expected hardware 'hw-side-synth-500', got '%s'", m.MemberID, m.HardwareID)
		}
	}
}

// Test F: Missing variant returns typed error
func TestF_MissingVariantTypedError(t *testing.T) {
	agregado, catalog, formulas := buildSyntheticDrawerFixture()

	// Available depth = 400mm. Minimum variant is 450mm (+3mm clearance = 453mm).
	params := engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 400.0, HeightMm: 200.0}
	_, err := engine.ResolveAgregadoAssembly(agregado, params, catalog, formulas)
	if err == nil {
		t.Fatal("expected ErrAssemblyVariantNotFound, got nil")
	}

	var variantErr *domain.ErrAssemblyVariantNotFound
	if !errors.As(err, &variantErr) {
		t.Fatalf("expected *domain.ErrAssemblyVariantNotFound, got %T: %v", err, err)
	}
	expectedSubstr := "assembly variant not found for variantSetId 'vs-drawer-depth'"
	if !stringsContains(err.Error(), expectedSubstr) {
		t.Fatalf("expected error containing %q, got %q", expectedSubstr, err.Error())
	}
}

// Test G: Fixed/Variant source exclusivity
func TestG_FixedVariantSourceExclusivity(t *testing.T) {
	// Member with both sources populated
	bothSources := domain.AgregadoRigidMember{
		MemberID: "bad_member",
		Role:     "test",
		Source: domain.RigidMemberSource{
			Kind:    domain.RigidMemberSourceFixed,
			Fixed:   &domain.FixedHardwareSource{HardwareID: "hw-fixed"},
			Variant: &domain.VariantHardwareSource{VariantSetID: "vs-var"},
		},
		Placement: domain.AssemblyAnchorRule{
			X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
		},
		BOMRole: domain.BOMRoleSeparatelyPurchased,
	}

	if err := domain.ValidateAgregadoRigidMember(bothSources, false); err == nil {
		t.Fatal("expected validation error for dual-source member, got nil")
	}

	// Member with neither source populated
	emptySource := domain.AgregadoRigidMember{
		MemberID: "bad_empty",
		Role:     "test",
		Source: domain.RigidMemberSource{
			Kind: domain.RigidMemberSourceFixed,
		},
		Placement: domain.AssemblyAnchorRule{
			X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
		},
		BOMRole: domain.BOMRoleSeparatelyPurchased,
	}

	if err := domain.ValidateAgregadoRigidMember(emptySource, false); err == nil {
		t.Fatal("expected validation error for empty-source member, got nil")
	}
}

// Test H: BOM role combinations validated
func TestH_BOMRoleCombinationsValidated(t *testing.T) {
	// Member declared as 'included_in_kit' when hasCommercialKit is false
	member := domain.AgregadoRigidMember{
		MemberID: "member_kit",
		Role:     "side",
		Source: domain.RigidMemberSource{
			Kind:  domain.RigidMemberSourceFixed,
			Fixed: &domain.FixedHardwareSource{HardwareID: "hw-side"},
		},
		Placement: domain.AssemblyAnchorRule{
			X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
		},
		BOMRole: domain.BOMRoleIncludedInKit,
	}

	err := domain.ValidateAgregadoRigidMember(member, false) // false = no kit configured
	if err == nil {
		t.Fatal("expected error when included_in_kit is used without commercial kit, got nil")
	}

	errValid := domain.ValidateAgregadoRigidMember(member, true) // true = kit configured
	if errValid != nil {
		t.Fatalf("unexpected validation error: %v", errValid)
	}
}

// Test I: No mirror / det = +1 on all members
func TestI_NoMirrorDeterminantPositive(t *testing.T) {
	agregado, catalog, formulas := buildSyntheticDrawerFixture()
	params := engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 520.0, HeightMm: 200.0}

	res, err := engine.ResolveAgregadoAssembly(agregado, params, catalog, formulas)
	if err != nil {
		t.Fatalf("resolution failed: %v", err)
	}

	for _, m := range res.Snapshot.RigidMembers {
		assertRigidBasis(t, m.MemberID, m.LocalTransform.Basis)
	}
}

// Test J: Snapshot structure contains enough authority for historical freeze
func TestJ_HistoricalSnapshotCompleteness(t *testing.T) {
	agregado, catalog, formulas := buildSyntheticDrawerFixture()
	params := engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 520.0, HeightMm: 200.0}

	res, err := engine.ResolveAgregadoAssembly(agregado, params, catalog, formulas)
	if err != nil {
		t.Fatalf("resolution failed: %v", err)
	}

	// 1. Serialize snapshot to JSON
	bytes, err := json.Marshal(res.Snapshot)
	if err != nil {
		t.Fatalf("json.Marshal snapshot failed: %v", err)
	}

	// 2. Deserialize into a new snapshot struct
	var reconstituted domain.ResolvedAssemblySnapshot
	if err := json.Unmarshal(bytes, &reconstituted); err != nil {
		t.Fatalf("json.Unmarshal snapshot failed: %v", err)
	}

	// 3. Verify all necessary frozen attributes survive without calling catalog
	if reconstituted.AgregadoID != "agr-drawer-synth" {
		t.Errorf("expected agregadoId 'agr-drawer-synth', got '%s'", reconstituted.AgregadoID)
	}
	if len(reconstituted.RigidMembers) != 4 {
		t.Errorf("expected 4 rigid members, got %d", len(reconstituted.RigidMembers))
	}
	if len(reconstituted.FabricatedComponents) != 1 {
		t.Errorf("expected 1 fabricated component, got %d", len(reconstituted.FabricatedComponents))
	}
	if len(reconstituted.BOMItems) != 1 {
		t.Errorf("expected 1 commercial kit BOM item, got %d", len(reconstituted.BOMItems))
	}
	if reconstituted.BOMItems[0].HardwareID != "hw-kit-drawer-synth" {
		t.Errorf("expected kit hardwareId 'hw-kit-drawer-synth', got '%s'", reconstituted.BOMItems[0].HardwareID)
	}

	// Verify exact pinned asset revisions survived
	sideLeft := reconstituted.RigidMembers[0]
	if sideLeft.AssetRevisionID != "rev-side-500-r1" || sideLeft.SHA256 == "" {
		t.Errorf("reconstituted side_left missing exact pinned revision: %+v", sideLeft)
	}
}

func stringsContains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 || (len(s) > 0 && len(substr) > 0 && indexOf(s, substr) >= 0))
}

func indexOf(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}
