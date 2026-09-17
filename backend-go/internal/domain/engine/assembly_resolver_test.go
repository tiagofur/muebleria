package engine_test

import (
	"encoding/json"
	"errors"
	"math"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

func ptr[T any](v T) *T {
	return &v
}

// buildSyntheticDrawerFixture provides a reproducible, fully declarative Agregado assembly definition.
// Follows preferred architecture (R8):
// Agregado
// ├── Components (sole authority for fabricated boards: bottom and back)
// ├── HardwareLines (empty in this fixture)
// └── RigidMembers (runners, sides, locking clips)
func buildSyntheticDrawerFixture() domain.Agregado {
	kitID := "hw-kit-drawer-synth"

	return domain.Agregado{
		ID:                      "agr-drawer-synth",
		Code:                    "DRAWER-SYNTH",
		Name:                    "Synthetic Test Drawer System",
		CommercialKitHardwareID: &kitID,
		VariantSets: []domain.AgregadoVariantSet{
			{
				ID:        "vs-drawer-depth",
				Dimension: "depth",
				Variants: []domain.ProductVariant{
					{NominalDimensionMm: 450.0, HardwareID: "hw-side-450"},
					{NominalDimensionMm: 500.0, HardwareID: "hw-side-500"},
					{NominalDimensionMm: 550.0, HardwareID: "hw-side-550"},
				},
			},
		},
		CompatibilityRules: []domain.AssemblyCompatibilityRule{
			{
				VariantSetID:      "vs-drawer-depth",
				ClearanceMm:       3.0, // cabinet depth must exceed nominal by at least 3mm
				SelectionStrategy: "max_fitting",
			},
		},
		RigidMembers: []domain.AgregadoRigidMember{
			{
				MemberID: "side_left",
				Role:     "drawer_side_left",
				Source: domain.RigidMemberSource{
					Kind:    domain.RigidMemberSourceVariant,
					Variant: &domain.VariantHardwareSource{VariantSetID: "vs-drawer-depth"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
				},
				BOMRole: domain.BOMRoleIncludedInKit,
			},
			{
				MemberID: "side_right",
				Role:     "drawer_side_right",
				Source: domain.RigidMemberSource{
					Kind:    domain.RigidMemberSourceVariant,
					Variant: &domain.VariantHardwareSource{VariantSetID: "vs-drawer-depth"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMax, OffsetMm: 0.0},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
				},
				BOMRole: domain.BOMRoleIncludedInKit,
			},
			{
				MemberID: "runner_left",
				Role:     "drawer_runner_left",
				Source: domain.RigidMemberSource{
					Kind:    domain.RigidMemberSourceVariant,
					Variant: &domain.VariantHardwareSource{VariantSetID: "vs-drawer-depth"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
				},
				BOMRole: domain.BOMRoleIncludedInKit,
			},
			{
				MemberID: "runner_right",
				Role:     "drawer_runner_right",
				Source: domain.RigidMemberSource{
					Kind:    domain.RigidMemberSourceVariant,
					Variant: &domain.VariantHardwareSource{VariantSetID: "vs-drawer-depth"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMax, OffsetMm: 0.0},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
				},
				BOMRole: domain.BOMRoleIncludedInKit,
			},
			{
				MemberID: "locking_device_left",
				Role:     "drawer_coupling_left",
				Source: domain.RigidMemberSource{
					Kind:  domain.RigidMemberSourceFixed,
					Fixed: &domain.FixedHardwareSource{HardwareID: "hw-clip-l"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 10.0},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 5.0},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
				},
				BOMRole: domain.BOMRoleSeparatelyPurchased,
			},
			{
				MemberID: "locking_device_right",
				Role:     "drawer_coupling_right",
				Source: domain.RigidMemberSource{
					Kind:  domain.RigidMemberSourceFixed,
					Fixed: &domain.FixedHardwareSource{HardwareID: "hw-clip-r"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMax, OffsetMm: -10.0},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 5.0},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0.0},
				},
				BOMRole: domain.BOMRoleSeparatelyPurchased,
			},
		},
		Components: []domain.ComponentInstance{
			{
				ComponentID: "comp-drawer-bottom",
				Quantity:    1,
				Overrides: &domain.ComponentInstanceOverrides{
					WidthRule: &domain.AssemblyDimensionRule{
						Source:   domain.DimRuleAssemblyWidth,
						OffsetMm: -35.0, // multiplier omitted -> default 1.0 (R9)
					},
					LengthRule: &domain.AssemblyDimensionRule{
						Source:       domain.DimRuleSelectedVariant,
						VariantSetID: "vs-drawer-depth",
						OffsetMm:     -10.0, // multiplier omitted -> default 1.0 (R9)
					},
					PlacementRule: &domain.AssemblyAnchorRule{
						X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 17.5},
						Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 10.0},
						Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 16.0},
					},
				},
			},
			{
				ComponentID: "comp-drawer-back",
				Quantity:    1,
				Overrides: &domain.ComponentInstanceOverrides{
					WidthRule: &domain.AssemblyDimensionRule{
						Source:   domain.DimRuleAssemblyWidth,
						OffsetMm: -35.0,
					},
					LengthRule: &domain.AssemblyDimensionRule{
						Source:   domain.DimRuleAssemblyHeight,
						OffsetMm: -40.0,
					},
					PlacementRule: &domain.AssemblyAnchorRule{
						X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 17.5},
						Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMax, OffsetMm: -16.0},
						Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 16.0},
					},
				},
			},
		},
	}
}

// Test A: Rigid member never scales (scale ≡ [1,1,1], det ≡ +1.0)
func TestA_RigidMemberNeverScales(t *testing.T) {
	agregado := buildSyntheticDrawerFixture()
	params := engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 550.0, HeightMm: 200.0}

	snapshot, err := engine.ResolveAgregadoAssembly(agregado, params)
	if err != nil {
		t.Fatalf("unexpected error resolving assembly: %v", err)
	}

	for _, member := range snapshot.RigidMembers {
		b := member.LocalTransform.Basis

		// Lengths must be 1.0
		lenX := math.Sqrt(b.X[0]*b.X[0] + b.X[1]*b.X[1] + b.X[2]*b.X[2])
		lenY := math.Sqrt(b.Y[0]*b.Y[0] + b.Y[1]*b.Y[1] + b.Y[2]*b.Y[2])
		lenZ := math.Sqrt(b.Z[0]*b.Z[0] + b.Z[1]*b.Z[1] + b.Z[2]*b.Z[2])

		if math.Abs(lenX-1.0) > 1e-6 || math.Abs(lenY-1.0) > 1e-6 || math.Abs(lenZ-1.0) > 1e-6 {
			t.Errorf("member %s has non-unit scale: (|X|=%g, |Y|=%g, |Z|=%g)", member.MemberID, lenX, lenY, lenZ)
		}

		// Determinant must be +1.0
		crossYZ := [3]float64{
			b.Y[1]*b.Z[2] - b.Y[2]*b.Z[1],
			b.Y[2]*b.Z[0] - b.Y[0]*b.Z[2],
			b.Y[0]*b.Z[1] - b.Y[1]*b.Z[0],
		}
		det := b.X[0]*crossYZ[0] + b.X[1]*crossYZ[1] + b.X[2]*crossYZ[2]

		if math.Abs(det-1.0) > 1e-6 {
			t.Errorf("member %s determinant is not +1.0 (det=%g)", member.MemberID, det)
		}
	}
}

// Test B: Width expansion shifts right member only
func TestB_WidthExpansionShiftsRightMemberOnly(t *testing.T) {
	agregado := buildSyntheticDrawerFixture()

	res600, err := engine.ResolveAgregadoAssembly(agregado, engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 550.0, HeightMm: 200.0})
	if err != nil {
		t.Fatalf("res600 error: %v", err)
	}
	res800, err := engine.ResolveAgregadoAssembly(agregado, engine.AssemblyResolutionParams{WidthMm: 800.0, DepthMm: 550.0, HeightMm: 200.0})
	if err != nil {
		t.Fatalf("res800 error: %v", err)
	}

	findMember := func(snap domain.ResolvedAssembly, id string) domain.ResolvedRigidMember {
		for _, m := range snap.RigidMembers {
			if m.MemberID == id {
				return m
			}
		}
		t.Fatalf("member %s not found in snapshot", id)
		return domain.ResolvedRigidMember{}
	}

	right600 := findMember(res600, "side_right")
	right800 := findMember(res800, "side_right")

	if math.Abs(right600.LocalTransform.TranslationMm[0]-600.0) > 1e-6 {
		t.Errorf("expected right member at X=600 for W=600, got %g", right600.LocalTransform.TranslationMm[0])
	}
	if math.Abs(right800.LocalTransform.TranslationMm[0]-800.0) > 1e-6 {
		t.Errorf("expected right member at X=800 for W=800, got %g", right800.LocalTransform.TranslationMm[0])
	}
	deltaX := right800.LocalTransform.TranslationMm[0] - right600.LocalTransform.TranslationMm[0]
	if math.Abs(deltaX-200.0) > 1e-6 {
		t.Errorf("expected right member shift of +200mm, got %g", deltaX)
	}
}

// Test C: Left member remains unchanged on width change
func TestC_LeftMemberRemainsUnchangedOnWidthChange(t *testing.T) {
	agregado := buildSyntheticDrawerFixture()

	res600, _ := engine.ResolveAgregadoAssembly(agregado, engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 550.0, HeightMm: 200.0})
	res800, _ := engine.ResolveAgregadoAssembly(agregado, engine.AssemblyResolutionParams{WidthMm: 800.0, DepthMm: 550.0, HeightMm: 200.0})

	findMember := func(snap domain.ResolvedAssembly, id string) domain.ResolvedRigidMember {
		for _, m := range snap.RigidMembers {
			if m.MemberID == id {
				return m
			}
		}
		t.Fatalf("member %s not found", id)
		return domain.ResolvedRigidMember{}
	}

	left600 := findMember(res600, "side_left")
	left800 := findMember(res800, "side_left")

	for i := 0; i < 3; i++ {
		if math.Abs(left600.LocalTransform.TranslationMm[i]-left800.LocalTransform.TranslationMm[i]) > 1e-6 {
			t.Errorf("left member position changed at index %d: 600=%g, 800=%g",
				i, left600.LocalTransform.TranslationMm[i], left800.LocalTransform.TranslationMm[i])
		}
	}
}

// Test D (R1): Fabricated dimensions recalculate deterministically from declarative rules
func TestD_FabricatedDimensionsRecalculateNotScale(t *testing.T) {
	agregado := buildSyntheticDrawerFixture()

	// W=600 -> bottom width = 600 - 35 = 565.0
	res600, err := engine.ResolveAgregadoAssembly(agregado, engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 550.0, HeightMm: 200.0})
	if err != nil {
		t.Fatalf("res600 error: %v", err)
	}
	// W=800 -> bottom width = 800 - 35 = 765.0
	res800, err := engine.ResolveAgregadoAssembly(agregado, engine.AssemblyResolutionParams{WidthMm: 800.0, DepthMm: 550.0, HeightMm: 200.0})
	if err != nil {
		t.Fatalf("res800 error: %v", err)
	}

	findComp := func(snap domain.ResolvedAssembly, compID string) domain.ResolvedFabricatedComponent {
		for _, c := range snap.FabricatedComponents {
			if c.ComponentID == compID {
				return c
			}
		}
		t.Fatalf("component %s not found", compID)
		return domain.ResolvedFabricatedComponent{}
	}

	bottom600 := findComp(res600, "comp-drawer-bottom")
	back800 := findComp(res800, "comp-drawer-back")

	// Bottom board width at W=600: 565mm
	if math.Abs(bottom600.WidthMm-565.0) > 1e-6 {
		t.Errorf("expected bottom board width 565mm for W=600, got %g", bottom600.WidthMm)
	}
	// Depth=550mm, nominal=500mm -> LengthRule = 500 - 10 = 490mm
	if math.Abs(bottom600.LengthMm-490.0) > 1e-6 {
		t.Errorf("expected bottom board length 490mm for Depth=550, got %g", bottom600.LengthMm)
	}

	// Back board width at W=800: 800 - 35 = 765mm
	if math.Abs(back800.WidthMm-765.0) > 1e-6 {
		t.Errorf("expected back board width 765mm for W=800, got %g", back800.WidthMm)
	}
}

// Test E: Deterministic variant resolution
func TestE_DeterministicVariantResolution(t *testing.T) {
	agregado := buildSyntheticDrawerFixture()

	// Available depth = 550mm. Clearance = 3mm -> max nominal = 547mm. Chosen = 500mm.
	res550, err := engine.ResolveAgregadoAssembly(agregado, engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 550.0, HeightMm: 200.0})
	if err != nil {
		t.Fatalf("res550 error: %v", err)
	}
	if len(res550.SelectedVariants) != 1 {
		t.Fatalf("expected 1 selected variant, got %d", len(res550.SelectedVariants))
	}
	if res550.SelectedVariants[0].NominalDimensionMm != 500.0 {
		t.Errorf("expected 500mm variant for 550mm depth, got %g", res550.SelectedVariants[0].NominalDimensionMm)
	}
	if res550.SelectedVariants[0].HardwareID != "hw-side-500" {
		t.Errorf("expected hw-side-500, got %s", res550.SelectedVariants[0].HardwareID)
	}

	// Available depth = 500mm. Clearance = 3mm -> max nominal = 497mm. Chosen = 450mm.
	res500, err := engine.ResolveAgregadoAssembly(agregado, engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 500.0, HeightMm: 200.0})
	if err != nil {
		t.Fatalf("res500 error: %v", err)
	}
	if res500.SelectedVariants[0].NominalDimensionMm != 450.0 {
		t.Errorf("expected 450mm variant for 500mm depth, got %g", res500.SelectedVariants[0].NominalDimensionMm)
	}
}

// Test F: Missing variant returns typed error
func TestF_MissingVariantTypedError(t *testing.T) {
	agregado := buildSyntheticDrawerFixture()

	// Available depth = 400mm. Minimum variant is 450mm (+3mm clearance = 453mm).
	params := engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 400.0, HeightMm: 200.0}
	_, err := engine.ResolveAgregadoAssembly(agregado, params)
	if err == nil {
		t.Fatal("expected ErrAssemblyVariantNotFound, got nil")
	}

	var variantErr *domain.ErrAssemblyVariantNotFound
	if !errors.As(err, &variantErr) {
		t.Fatalf("expected *domain.ErrAssemblyVariantNotFound, got %T: %v", err, err)
	}
	expectedSubstr := "assembly variant not found for variantSetId 'vs-drawer-depth'"
	if !strings.Contains(err.Error(), expectedSubstr) {
		t.Fatalf("expected error containing %q, got %q", expectedSubstr, err.Error())
	}
}

// Test G: Fixed/Variant source exclusivity
func TestG_FixedVariantSourceExclusivity(t *testing.T) {
	bothSources := domain.AgregadoRigidMember{
		MemberID: "bad_member",
		Role:     "test",
		Source: domain.RigidMemberSource{
			Kind:    domain.RigidMemberSourceFixed,
			Fixed:   &domain.FixedHardwareSource{HardwareID: "hw-1"},
			Variant: &domain.VariantHardwareSource{VariantSetID: "vs-1"},
		},
		Placement: domain.AssemblyAnchorRule{
			X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
		},
		BOMRole: domain.BOMRoleNonPurchasing,
	}
	if err := domain.ValidateAgregadoRigidMember(bothSources, false); err == nil {
		t.Fatal("expected error for member with both fixed and variant populated, got nil")
	}
}

// Test H: BOM role combinations validated
func TestH_BOMRoleCombinationsValidated(t *testing.T) {
	kitID := "hw-kit-1"

	validMember := domain.AgregadoRigidMember{
		MemberID: "valid_m",
		Role:     "side",
		Source:   domain.RigidMemberSource{Kind: domain.RigidMemberSourceFixed, Fixed: &domain.FixedHardwareSource{HardwareID: "hw-1"}},
		Placement: domain.AssemblyAnchorRule{
			X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
		},
		BOMRole: domain.BOMRoleIncludedInKit,
	}
	if err := domain.ValidateAgregadoRigidMember(validMember, kitID != ""); err != nil {
		t.Fatalf("unexpected error for valid kit member: %v", err)
	}

	if err := domain.ValidateAgregadoRigidMember(validMember, false); err == nil {
		t.Fatal("expected error for included_in_kit without commercialKitHardwareId, got nil")
	}

	sepMember := validMember
	sepMember.BOMRole = domain.BOMRoleSeparatelyPurchased
	if err := domain.ValidateAgregadoRigidMember(sepMember, false); err != nil {
		t.Errorf("separately_purchased should be valid without kit: %v", err)
	}
}

// Test I (R2): Arbitrary finite rigid rotation contract (det=+1.0, no mirror, no shear)
func TestI_ArbitraryFiniteRotationContract(t *testing.T) {
	testCases := []struct {
		name      string
		rot       domain.HardwareRotationDeg
		shouldErr bool
	}{
		{name: "zero rotation", rot: domain.HardwareRotationDeg{X: 0, Y: 0, Z: 0}, shouldErr: false},
		{name: "90 deg Z", rot: domain.HardwareRotationDeg{X: 0, Y: 0, Z: 90}, shouldErr: false},
		{name: "180 deg Z", rot: domain.HardwareRotationDeg{X: 0, Y: 0, Z: 180}, shouldErr: false},
		{name: "arbitrary 45 deg Y", rot: domain.HardwareRotationDeg{X: 0, Y: 45, Z: 0}, shouldErr: false},
		{name: "compound 30-45-60 deg", rot: domain.HardwareRotationDeg{X: 30, Y: 45, Z: 60}, shouldErr: false},
		{name: "NaN angle", rot: domain.HardwareRotationDeg{X: math.NaN(), Y: 0, Z: 0}, shouldErr: true},
		{name: "Inf angle", rot: domain.HardwareRotationDeg{X: 0, Y: math.Inf(1), Z: 0}, shouldErr: true},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			basis, err := domain.DeriveHardwareBasisFromEuler(tc.rot)
			if tc.shouldErr {
				if err == nil {
					t.Fatalf("expected error for %s, got nil", tc.name)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error deriving basis for %s: %v", tc.name, err)
			}
			if err := domain.ValidateHardwareBasis(basis, tc.name); err != nil {
				t.Fatalf("basis validation failed for %s: %v", tc.name, err)
			}
		})
	}
}

// Test J (R4): Historical snapshot completeness with explicit variant metadata
// Test J (R4, R13): Historical published snapshot completeness with explicit variant metadata and visual pins
func TestJ_HistoricalSnapshotCompleteness(t *testing.T) {
	agregado := buildSyntheticDrawerFixture()
	params := engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 550.0, HeightMm: 200.0}

	resolved, err := engine.ResolveAgregadoAssembly(agregado, params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(resolved.SelectedVariants) == 0 {
		t.Fatal("resolved assembly must contain SelectedVariants")
	}
	sel := resolved.SelectedVariants[0]
	if sel.VariantSetID != "vs-drawer-depth" || sel.HardwareID != "hw-side-500" || sel.NominalDimensionMm != 500.0 {
		t.Errorf("unexpected selected variant metadata: %+v", sel)
	}

	mockLookup := func(hardwareID string) (*domain.HardwareMountFrame, string, string, string, error) {
		return &domain.HardwareMountFrame{
			OriginMm: [3]float64{0, 0, 0},
			Basis: domain.HardwareBasis{
				X: [3]float64{1, 0, 0},
				Y: [3]float64{0, 1, 0},
				Z: [3]float64{0, 0, 1},
			},
		}, "asset-" + hardwareID, "rev-7", "sha256-dummy", nil
	}

	snapshot, err := engine.FreezePublishedAssemblySnapshot(resolved, 7, mockLookup)
	if err != nil {
		t.Fatalf("unexpected freeze error: %v", err)
	}
	if snapshot.AgregadoRevisionNumber != 7 {
		t.Fatalf("expected snapshot revision 7, got %d", snapshot.AgregadoRevisionNumber)
	}

	bytes, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("snapshot failed JSON marshal: %v", err)
	}
	var roundtrip domain.PublishedAssemblySnapshot
	if err := json.Unmarshal(bytes, &roundtrip); err != nil {
		t.Fatalf("snapshot failed JSON unmarshal: %v", err)
	}

	if roundtrip.AgregadoID != snapshot.AgregadoID {
		t.Errorf("roundtrip AgregadoID mismatch: %s vs %s", roundtrip.AgregadoID, snapshot.AgregadoID)
	}
	if roundtrip.AgregadoRevisionNumber != 7 {
		t.Errorf("expected roundtrip revision 7, got %d", roundtrip.AgregadoRevisionNumber)
	}
}

// Test K (R5): Transversal recipe validation rejects malformed definitions
func TestK_RecipeValidationRejectsMalformedDefinitions(t *testing.T) {
	t.Run("duplicate memberId", func(t *testing.T) {
		agr := buildSyntheticDrawerFixture()
		agr.RigidMembers = append(agr.RigidMembers, agr.RigidMembers[0]) // duplicate side_left
		err := domain.ValidateAgregadoAssemblyDefinition(agr)
		if err == nil || !strings.Contains(err.Error(), "duplicate memberId 'side_left'") {
			t.Fatalf("expected duplicate memberId error, got %v", err)
		}
	})

	t.Run("duplicate variantSetId", func(t *testing.T) {
		agr := buildSyntheticDrawerFixture()
		agr.VariantSets = append(agr.VariantSets, agr.VariantSets[0])
		err := domain.ValidateAgregadoAssemblyDefinition(agr)
		if err == nil || !strings.Contains(err.Error(), "duplicate variantSetId 'vs-drawer-depth'") {
			t.Fatalf("expected duplicate variantSetId error, got %v", err)
		}
	})

	t.Run("non-existent variantSetId in member source", func(t *testing.T) {
		agr := buildSyntheticDrawerFixture()
		agr.RigidMembers[0].Source.Variant.VariantSetID = "vs-non-existent"
		err := domain.ValidateAgregadoAssemblyDefinition(agr)
		if err == nil || !strings.Contains(err.Error(), "references non-existent variantSetId 'vs-non-existent'") {
			t.Fatalf("expected non-existent variantSetId error, got %v", err)
		}
	})

	t.Run("non-existent variantSetId in compatibility rule", func(t *testing.T) {
		agr := buildSyntheticDrawerFixture()
		agr.CompatibilityRules[0].VariantSetID = "vs-ghost"
		err := domain.ValidateAgregadoAssemblyDefinition(agr)
		if err == nil || !strings.Contains(err.Error(), "references non-existent variantSetId 'vs-ghost'") {
			t.Fatalf("expected non-existent rule error, got %v", err)
		}
	})

	t.Run("ambiguous duplicate compatibility rules", func(t *testing.T) {
		agr := buildSyntheticDrawerFixture()
		agr.CompatibilityRules = append(agr.CompatibilityRules, agr.CompatibilityRules[0])
		err := domain.ValidateAgregadoAssemblyDefinition(agr)
		if err == nil || !strings.Contains(err.Error(), "multiple ambiguous compatibility rules") {
			t.Fatalf("expected ambiguous rules error, got %v", err)
		}
	})

	t.Run("duplicate nominalDimensionMm in variant set", func(t *testing.T) {
		agr := buildSyntheticDrawerFixture()
		agr.VariantSets[0].Variants = append(agr.VariantSets[0].Variants, domain.ProductVariant{
			NominalDimensionMm: 500.0, // duplicate 500
			HardwareID:         "hw-dup-500",
		})
		err := domain.ValidateAgregadoAssemblyDefinition(agr)
		if err == nil || !strings.Contains(err.Error(), "duplicate nominalDimensionMm: 500") {
			t.Fatalf("expected duplicate nominal error, got %v", err)
		}
	})

	t.Run("empty hardwareId in variant", func(t *testing.T) {
		agr := buildSyntheticDrawerFixture()
		agr.VariantSets[0].Variants[0].HardwareID = "   "
		err := domain.ValidateAgregadoAssemblyDefinition(agr)
		if err == nil || !strings.Contains(err.Error(), "hardwareId must be non-empty") {
			t.Fatalf("expected non-empty hardwareId error, got %v", err)
		}
	})

	t.Run("non-finite dimension in resolution params", func(t *testing.T) {
		agr := buildSyntheticDrawerFixture()
		params := engine.AssemblyResolutionParams{WidthMm: math.NaN(), DepthMm: 500, HeightMm: 200}
		_, err := engine.ResolveAgregadoAssembly(agr, params)
		if err == nil || !strings.Contains(err.Error(), "invalid width") {
			t.Fatalf("expected non-finite param error, got %v", err)
		}
	})
}

// Test L (R3): Visual asset authority (#668) remains decoupled from assembly resolver
func TestL_VisualAssetBindingDecoupled(t *testing.T) {
	agr := buildSyntheticDrawerFixture()
	params := engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 550.0, HeightMm: 200.0}

	snapshot, err := engine.ResolveAgregadoAssembly(agr, params)
	if err != nil {
		t.Fatalf("pure resolver error: %v", err)
	}
	if snapshot.RigidMembers[0].HardwareID == "" {
		t.Fatal("hardwareId must be populated by pure resolver")
	}
	if snapshot.RigidMembers[0].AssetID != nil {
		t.Fatal("pure resolver must not populate visual AssetID directly")
	}
}

// Test M (R11, R13): Mechanical resolution vs publication freeze (never invent revision numbers)
func TestM_MechanicalResolutionVsPublicationFreeze(t *testing.T) {
	agr := buildSyntheticDrawerFixture()
	params := engine.AssemblyResolutionParams{WidthMm: 600, DepthMm: 500, HeightMm: 200}

	t.Run("pure mechanical resolution succeeds without revision or visual pins", func(t *testing.T) {
		resolved, err := engine.ResolveAgregadoAssembly(agr, params)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resolved.AgregadoID != "agr-drawer-synth" {
			t.Fatalf("expected AgregadoID 'agr-drawer-synth', got %s", resolved.AgregadoID)
		}
		for _, m := range resolved.RigidMembers {
			if m.AssetID != nil {
				t.Fatalf("expected unpopulated assetId in pure mechanical resolution, got %v", *m.AssetID)
			}
		}
	})

	t.Run("freeze publication fails closed if recipeRevision is missing or <= 0 (R11)", func(t *testing.T) {
		resolved, err := engine.ResolveAgregadoAssembly(agr, params)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		mockLookup := func(hardwareID string) (*domain.HardwareMountFrame, string, string, string, error) {
			return nil, "asset-1", "rev-1", "sha-1", nil
		}
		_, err = engine.FreezePublishedAssemblySnapshot(resolved, 0, mockLookup)
		if err == nil || !strings.Contains(err.Error(), "requires authoritative positive recipe revision") {
			t.Fatalf("expected positive revision error, got %v", err)
		}
	})

	t.Run("freeze publication fails closed if visual authority is nil (R13)", func(t *testing.T) {
		resolved, err := engine.ResolveAgregadoAssembly(agr, params)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		_, err = engine.FreezePublishedAssemblySnapshot(resolved, 7, nil)
		if err == nil || !strings.Contains(err.Error(), "requires #668 visual asset authority") {
			t.Fatalf("expected nil visual authority error, got %v", err)
		}
	})
}

// Test N (R8, R12): Components is sole authority for fabricated pieces; recipe re-evaluates without mutating prior instances
func TestN_ComponentsSoleAuthorityAndReevaluation(t *testing.T) {
	agr := buildSyntheticDrawerFixture()
	params600 := engine.AssemblyResolutionParams{WidthMm: 600, DepthMm: 550, HeightMm: 200}

	snap600, err := engine.ResolveAgregadoAssembly(agr, params600)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Bottom board in Components produces exactly ONE fabricated component
	bottomCount := 0
	for _, fc := range snap600.FabricatedComponents {
		if fc.ComponentID == "comp-drawer-bottom" {
			bottomCount++
			if math.Abs(fc.WidthMm-565.0) > 1e-6 {
				t.Errorf("expected bottom board width 565, got %g", fc.WidthMm)
			}
			if math.Abs(fc.LengthMm-490.0) > 1e-6 {
				t.Errorf("expected bottom board length 490, got %g", fc.LengthMm)
			}
		}
	}
	if bottomCount != 1 {
		t.Fatalf("expected exactly 1 fabricated bottom board, got %d", bottomCount)
	}

	// Re-evaluate with W=800 (R12)
	params800 := engine.AssemblyResolutionParams{WidthMm: 800, DepthMm: 550, HeightMm: 200}
	snap800, err := engine.ResolveAgregadoAssembly(agr, params800)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bottom800 := snap800.FabricatedComponents[0]
	if math.Abs(bottom800.WidthMm-765.0) > 1e-6 {
		t.Errorf("expected bottom board width 765, got %g", bottom800.WidthMm)
	}

	// Immutability check (R12): snap600 was NOT mutated
	if math.Abs(snap600.FabricatedComponents[0].WidthMm-565.0) > 1e-6 {
		t.Errorf("snap600 was mutated: expected width 565.0, got %g", snap600.FabricatedComponents[0].WidthMm)
	}
}

// Test O (R9): Multiplier contract (omitted = 1.0, explicit 0.0 = 0.0, non-finite rejected)
func TestO_MultiplierContract(t *testing.T) {
	params := engine.AssemblyResolutionParams{WidthMm: 600, DepthMm: 500, HeightMm: 200}
	selectedVariants := map[string]domain.SelectedAssemblyVariant{
		"vs-1": {VariantSetID: "vs-1", HardwareID: "hw-1", NominalDimensionMm: 500},
	}

	t.Run("omitted multiplier defaults to 1.0", func(t *testing.T) {
		rule := domain.AssemblyDimensionRule{
			Source:   domain.DimRuleAssemblyWidth,
			OffsetMm: -35,
		}
		val, err := engine.EvaluateDimensionRule(rule, params, selectedVariants)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// 600 * 1.0 - 35 = 565
		if math.Abs(val-565.0) > 1e-6 {
			t.Fatalf("expected 565, got %g", val)
		}
	})

	t.Run("explicit multiplier 0.0 behaves as mathematical 0.0", func(t *testing.T) {
		rule := domain.AssemblyDimensionRule{
			Source:     domain.DimRuleAssemblyWidth,
			Multiplier: ptr(0.0),
			OffsetMm:   50.0,
		}
		val, err := engine.EvaluateDimensionRule(rule, params, selectedVariants)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// 600 * 0.0 + 50 = 50
		if math.Abs(val-50.0) > 1e-6 {
			t.Fatalf("expected 50, got %g", val)
		}
	})

	t.Run("explicit multiplier 0.5 behaves mathematically", func(t *testing.T) {
		rule := domain.AssemblyDimensionRule{
			Source:     domain.DimRuleAssemblyWidth,
			Multiplier: ptr(0.5),
			OffsetMm:   10.0,
		}
		val, err := engine.EvaluateDimensionRule(rule, params, selectedVariants)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// 600 * 0.5 + 10 = 310
		if math.Abs(val-310.0) > 1e-6 {
			t.Fatalf("expected 310, got %g", val)
		}
	})

	t.Run("non-finite multiplier rejected", func(t *testing.T) {
		rule := domain.AssemblyDimensionRule{
			Source:     domain.DimRuleAssemblyWidth,
			Multiplier: ptr(math.NaN()),
			OffsetMm:   0,
		}
		_, err := engine.EvaluateDimensionRule(rule, params, selectedVariants)
		if err == nil || !strings.Contains(err.Error(), "non-finite multiplier") {
			t.Fatalf("expected non-finite multiplier error, got %v", err)
		}
	})
}

// Test P (R10): AttachVisualPins fails closed on incomplete identity or invalid MountFrame
func TestP_AttachVisualPinsFailClosed(t *testing.T) {
	agr := buildSyntheticDrawerFixture()
	params := engine.AssemblyResolutionParams{WidthMm: 600, DepthMm: 550, HeightMm: 200}
	snap, err := engine.ResolveAgregadoAssembly(agr, params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	t.Run("empty revisionId fails closed", func(t *testing.T) {
		mockLookup := func(hwID string) (*domain.HardwareMountFrame, string, string, string, error) {
			return nil, "asset-1", "", "sha256-val", nil // empty revisionId
		}
		_, err := engine.AttachVisualPins(snap, mockLookup)
		if err == nil || !strings.Contains(err.Error(), "empty assetRevisionId: fail closed") {
			t.Fatalf("expected empty revisionId fail closed error, got %v", err)
		}
	})

	t.Run("empty assetId fails closed", func(t *testing.T) {
		mockLookup := func(hwID string) (*domain.HardwareMountFrame, string, string, string, error) {
			return nil, "", "rev-1", "sha256-val", nil // empty assetId
		}
		_, err := engine.AttachVisualPins(snap, mockLookup)
		if err == nil || !strings.Contains(err.Error(), "empty assetId: fail closed") {
			t.Fatalf("expected empty assetId fail closed error, got %v", err)
		}
	})

	t.Run("empty sha256 fails closed", func(t *testing.T) {
		mockLookup := func(hwID string) (*domain.HardwareMountFrame, string, string, string, error) {
			return nil, "asset-1", "rev-1", "", nil // empty sha256
		}
		_, err := engine.AttachVisualPins(snap, mockLookup)
		if err == nil || !strings.Contains(err.Error(), "empty sha256: fail closed") {
			t.Fatalf("expected empty sha256 fail closed error, got %v", err)
		}
	})

	t.Run("invalid MountFrame basis fails closed", func(t *testing.T) {
		mockLookup := func(hwID string) (*domain.HardwareMountFrame, string, string, string, error) {
			return &domain.HardwareMountFrame{
				OriginMm: [3]float64{0, 0, 0},
				Basis: domain.HardwareBasis{
					X: [3]float64{2, 0, 0}, // non-unit
					Y: [3]float64{0, 1, 0},
					Z: [3]float64{0, 0, 1},
				},
			}, "asset-1", "rev-1", "sha256-val", nil
		}
		_, err := engine.AttachVisualPins(snap, mockLookup)
		if err == nil || !strings.Contains(err.Error(), "invalid mountFrame basis") {
			t.Fatalf("expected invalid basis error, got %v", err)
		}
	})

	t.Run("complete valid metadata succeeds", func(t *testing.T) {
		mockLookup := func(hwID string) (*domain.HardwareMountFrame, string, string, string, error) {
			return &domain.HardwareMountFrame{
				OriginMm: [3]float64{0, 0, 0},
				Basis: domain.HardwareBasis{
					X: [3]float64{1, 0, 0},
					Y: [3]float64{0, 1, 0},
					Z: [3]float64{0, 0, 1},
				},
			}, "asset-" + hwID, "rev-1", "sha-" + hwID, nil
		}
		attached, err := engine.AttachVisualPins(snap, mockLookup)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if *attached.RigidMembers[0].AssetID != "asset-hw-side-500" {
			t.Errorf("expected pinned assetId asset-hw-side-500, got %v", *attached.RigidMembers[0].AssetID)
		}
	})
}
