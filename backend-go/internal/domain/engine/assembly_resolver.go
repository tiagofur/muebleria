package engine

import (
	"fmt"
	"math"
	"sort"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// AssemblyResolutionParams provides concrete spatial dimensions for an assembly instance.
type AssemblyResolutionParams struct {
	WidthMm  float64 `json:"widthMm"`
	DepthMm  float64 `json:"depthMm"`
	HeightMm float64 `json:"heightMm"`
}

// FabricatedBoardFormula defines how a fabricated member's dimensions derive from assembly bounds.
type FabricatedBoardFormula struct {
	ComponentID      string  `json:"componentId"`
	SlotID           string  `json:"slotId"`
	Name             string  `json:"name"`
	WidthFormulaMm   func(w, d, h, variantNominal float64) float64
	LengthFormulaMm  func(w, d, h, variantNominal float64) float64
	ThicknessMm      float64
	PlacementAnchorX domain.AssemblyAxisPlacement
	PlacementAnchorY domain.AssemblyAxisPlacement
	PlacementAnchorZ domain.AssemblyAxisPlacement
}

// ResolvedAssemblyResult contains both the active 3D placements, BOM, and the historical snapshot.
type ResolvedAssemblyResult struct {
	Snapshot domain.ResolvedAssemblySnapshot
}

// ResolveAgregadoAssembly executes the deterministic resolution of an Agregado assembly.
func ResolveAgregadoAssembly(
	agregado domain.Agregado,
	params AssemblyResolutionParams,
	hardwareCatalog map[string]domain.Hardware,
	fabricatedFormulas []FabricatedBoardFormula,
) (*ResolvedAssemblyResult, error) {
	// 1. Validate assembly configuration
	hasKit := agregado.CommercialKitHardwareID != nil && *agregado.CommercialKitHardwareID != ""
	for _, m := range agregado.RigidMembers {
		if err := domain.ValidateAgregadoRigidMember(m, hasKit); err != nil {
			return nil, err
		}
	}
	variantSetsByID := make(map[string]domain.AgregadoVariantSet, len(agregado.VariantSets))
	for _, vs := range agregado.VariantSets {
		if err := domain.ValidateAgregadoVariantSet(vs); err != nil {
			return nil, err
		}
		variantSetsByID[vs.ID] = vs
	}

	// 2. Resolve discrete product variants
	selectedVariants := make(map[string]domain.ProductVariant)
	selectedNominals := make(map[string]float64)
	for _, rule := range agregado.CompatibilityRules {
		vs, ok := variantSetsByID[rule.VariantSetID]
		if !ok {
			return nil, fmt.Errorf("compatibility rule references unknown variantSetId '%s'", rule.VariantSetID)
		}
		availableSpace := getDimensionValue(params, vs.Dimension)
		variant, err := selectVariant(vs, availableSpace, rule.ClearanceMm, rule.SelectionStrategy)
		if err != nil {
			return nil, err
		}
		selectedVariants[vs.ID] = variant
		selectedNominals[vs.ID] = variant.NominalDimensionMm
	}

	// 3. Resolve each rigid member
	resolvedMembers := make([]domain.ResolvedRigidMember, 0, len(agregado.RigidMembers))
	for _, m := range agregado.RigidMembers {
		var resolvedHwID string
		switch m.Source.Kind {
		case domain.RigidMemberSourceFixed:
			resolvedHwID = m.Source.Fixed.HardwareID
		case domain.RigidMemberSourceVariant:
			v, ok := selectedVariants[m.Source.Variant.VariantSetID]
			if !ok {
				return nil, fmt.Errorf("member %s: no variant resolved for variantSetId '%s'", m.MemberID, m.Source.Variant.VariantSetID)
			}
			resolvedHwID = v.HardwareID
		default:
			return nil, fmt.Errorf("member %s: unhandled source kind '%s'", m.MemberID, m.Source.Kind)
		}

		hw, ok := hardwareCatalog[resolvedHwID]
		if !ok {
			return nil, fmt.Errorf("member %s: hardware '%s' not found in catalog", m.MemberID, resolvedHwID)
		}

		// Calculate 3D translation in Assembly Space
		tx := calculateAxisCoord(m.Placement.X, params.WidthMm)
		ty := calculateAxisCoord(m.Placement.Y, params.DepthMm)
		tz := calculateAxisCoord(m.Placement.Z, params.HeightMm)

		// Calculate orthonormal right-handed basis
		basis, err := calculateOrthonormalBasis(m.Placement.RotationDeg)
		if err != nil {
			return nil, fmt.Errorf("member %s: %w", m.MemberID, err)
		}

		var assetID, assetRevisionID, sha256 string
		var mountFrame *domain.HardwareMountFrame
		if hw.VisualAsset != nil {
			assetID = hw.VisualAsset.AssetID
			assetRevisionID = hw.VisualAsset.AssetRevisionID
			sha256 = hw.VisualAsset.SHA256
			mountFrame = hw.VisualAsset.MountFrame
		}

		resolvedMembers = append(resolvedMembers, domain.ResolvedRigidMember{
			MemberID:        m.MemberID,
			Role:            m.Role,
			HardwareID:      resolvedHwID,
			AssetID:         assetID,
			AssetRevisionID: assetRevisionID,
			SHA256:          sha256,
			MountFrame:      mountFrame,
			LocalTransform: domain.AssemblyMemberTransform{
				TranslationMm: [3]float64{tx, ty, tz},
				Basis:         basis,
			},
			BOMRole: m.BOMRole,
		})
	}

	// 4. Resolve fabricated components (boards)
	resolvedFabricated := make([]domain.ResolvedFabricatedComponent, 0, len(fabricatedFormulas))
	primaryVariantNominal := 0.0
	for _, v := range selectedNominals {
		primaryVariantNominal = v
		break
	}
	for _, f := range fabricatedFormulas {
		boardWidth := f.WidthFormulaMm(params.WidthMm, params.DepthMm, params.HeightMm, primaryVariantNominal)
		boardLength := f.LengthFormulaMm(params.WidthMm, params.DepthMm, params.HeightMm, primaryVariantNominal)

		tx := calculateAxisCoord(f.PlacementAnchorX, params.WidthMm)
		ty := calculateAxisCoord(f.PlacementAnchorY, params.DepthMm)
		tz := calculateAxisCoord(f.PlacementAnchorZ, params.HeightMm)

		resolvedFabricated = append(resolvedFabricated, domain.ResolvedFabricatedComponent{
			ComponentID: f.ComponentID,
			SlotID:      f.SlotID,
			Name:        f.Name,
			LengthMm:    boardLength,
			WidthMm:     boardWidth,
			ThicknessMm: f.ThicknessMm,
			Transform: domain.AssemblyMemberTransform{
				TranslationMm: [3]float64{tx, ty, tz},
				Basis: domain.HardwareBasis{
					X: [3]float64{1.0, 0.0, 0.0},
					Y: [3]float64{0.0, 1.0, 0.0},
					Z: [3]float64{0.0, 0.0, 1.0},
				},
			},
		})
	}

	// 5. Expand BOM deterministically
	bomItems := make([]domain.AssemblyBOMItem, 0)
	if hasKit {
		bomItems = append(bomItems, domain.AssemblyBOMItem{
			HardwareID: *agregado.CommercialKitHardwareID,
			Quantity:   1.0,
			Role:       "commercial_kit",
			Notes:      agregado.Name,
		})
	}
	for _, rm := range resolvedMembers {
		if rm.BOMRole == domain.BOMRoleSeparatelyPurchased {
			bomItems = append(bomItems, domain.AssemblyBOMItem{
				HardwareID: rm.HardwareID,
				Quantity:   1.0,
				Role:       rm.Role,
			})
		}
	}

	snapshot := domain.ResolvedAssemblySnapshot{
		AgregadoID:              agregado.ID,
		AgregadoRevisionNumber:  1,
		CommercialKitHardwareID: agregado.CommercialKitHardwareID,
		ResolvedDimensionsMm:    [3]float64{params.WidthMm, params.DepthMm, params.HeightMm},
		SelectedVariants:        selectedNominals,
		RigidMembers:            resolvedMembers,
		FabricatedComponents:    resolvedFabricated,
		BOMItems:                bomItems,
	}

	return &ResolvedAssemblyResult{Snapshot: snapshot}, nil
}

// Helpers

func getDimensionValue(params AssemblyResolutionParams, dim string) float64 {
	switch dim {
	case "depth":
		return params.DepthMm
	case "height":
		return params.HeightMm
	case "width":
		return params.WidthMm
	default:
		return 0.0
	}
}

func selectVariant(vs domain.AgregadoVariantSet, availableSpace float64, clearance float64, strategy string) (domain.ProductVariant, error) {
	_ = strategy
	usableSpace := availableSpace - clearance

	// Sort variants descending by nominal dimension
	sorted := make([]domain.ProductVariant, len(vs.Variants))
	copy(sorted, vs.Variants)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].NominalDimensionMm > sorted[j].NominalDimensionMm
	})

	for _, v := range sorted {
		if v.NominalDimensionMm <= usableSpace {
			return v, nil
		}
	}

	nominals := make([]float64, len(vs.Variants))
	for i, v := range vs.Variants {
		nominals[i] = v.NominalDimensionMm
	}
	return domain.ProductVariant{}, &domain.ErrAssemblyVariantNotFound{
		VariantSetID:       vs.ID,
		RequestedSpaceMm:   availableSpace,
		RequiredClearance: clearance,
		AvailableNominals:  nominals,
	}
}

func calculateAxisCoord(p domain.AssemblyAxisPlacement, totalDim float64) float64 {
	var refValue float64
	switch p.Ref {
	case domain.AxisRefMin:
		refValue = 0.0
	case domain.AxisRefMax:
		refValue = totalDim
	case domain.AxisRefCenter:
		refValue = totalDim / 2.0
	default:
		refValue = 0.0
	}
	return refValue + p.OffsetMm
}

func calculateOrthonormalBasis(rot *domain.HardwareRotationDeg) (domain.HardwareBasis, error) {
	if rot == nil {
		return domain.HardwareBasis{
			X: [3]float64{1.0, 0.0, 0.0},
			Y: [3]float64{0.0, 1.0, 0.0},
			Z: [3]float64{0.0, 0.0, 1.0},
		}, nil
	}

	// Convert Euler angles in degrees to radians (XYZ order)
	degToRad := math.Pi / 180.0
	rx := rot.X * degToRad
	ry := rot.Y * degToRad
	rz := rot.Z * degToRad

	cx, sx := math.Cos(rx), math.Sin(rx)
	cy, sy := math.Cos(ry), math.Sin(ry)
	cz, sz := math.Cos(rz), math.Sin(rz)

	// Rotation matrix R = Rz * Ry * Rx
	// Column 0 (+X):
	r00 := cy * cz
	r10 := cy * sz
	r20 := -sy

	// Column 1 (+Y):
	r01 := (sx * sy * cz) - (cx * sz)
	r11 := (sx * sy * sz) + (cx * cz)
	r21 := sx * cy

	// Column 2 (+Z):
	r02 := (cx * sy * cz) + (sx * sz)
	r12 := (cx * sy * sz) - (sx * cz)
	r22 := cx * cy

	basis := domain.HardwareBasis{
		X: [3]float64{roundTol(r00), roundTol(r10), roundTol(r20)},
		Y: [3]float64{roundTol(r01), roundTol(r11), roundTol(r21)},
		Z: [3]float64{roundTol(r02), roundTol(r12), roundTol(r22)},
	}

	// Verify determinant is +1.0
	det := basis.X[0]*((basis.Y[1]*basis.Z[2])-(basis.Y[2]*basis.Z[1])) -
		basis.X[1]*((basis.Y[0]*basis.Z[2])-(basis.Y[2]*basis.Z[0])) +
		basis.X[2]*((basis.Y[0]*basis.Z[1])-(basis.Y[1]*basis.Z[0]))

	if math.Abs(det-1.0) > 1e-4 {
		return domain.HardwareBasis{}, fmt.Errorf("rotation produces non-rigid basis with det=%.4f (mirror rejected)", det)
	}

	return basis, nil
}

func roundTol(v float64) float64 {
	if math.Abs(v) < 1e-9 {
		return 0.0
	}
	if math.Abs(v-1.0) < 1e-9 {
		return 1.0
	}
	if math.Abs(v+1.0) < 1e-9 {
		return -1.0
	}
	return v
}
