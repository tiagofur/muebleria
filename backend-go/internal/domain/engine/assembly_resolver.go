package engine

import (
	"errors"
	"fmt"
	"math"
	"sort"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// AssemblyResolutionParams provides target bounding-box dimensions for resolving an Agregado assembly.
type AssemblyResolutionParams struct {
	WidthMm  float64 `json:"widthMm"`
	DepthMm  float64 `json:"depthMm"`
	HeightMm float64 `json:"heightMm"`
}

func ValidateAssemblyResolutionParams(params AssemblyResolutionParams) error {
	if math.IsNaN(params.WidthMm) || math.IsInf(params.WidthMm, 0) || params.WidthMm <= 0 {
		return fmt.Errorf("invalid width: %g mm (must be finite and positive)", params.WidthMm)
	}
	if math.IsNaN(params.DepthMm) || math.IsInf(params.DepthMm, 0) || params.DepthMm <= 0 {
		return fmt.Errorf("invalid depth: %g mm (must be finite and positive)", params.DepthMm)
	}
	if math.IsNaN(params.HeightMm) || math.IsInf(params.HeightMm, 0) || params.HeightMm <= 0 {
		return fmt.Errorf("invalid height: %g mm (must be finite and positive)", params.HeightMm)
	}
	return nil
}

// EvaluateDimensionRule deterministically calculates dimension from declarative rules (no eval, no scripts).
func EvaluateDimensionRule(
	rule domain.AssemblyDimensionRule,
	params AssemblyResolutionParams,
	selectedVariants map[string]domain.SelectedAssemblyVariant,
) (float64, error) {
	mult := rule.Multiplier
	if mult == 0 {
		mult = 1.0
	}
	var base float64
	switch rule.Source {
	case domain.DimRuleAssemblyWidth:
		base = params.WidthMm
	case domain.DimRuleAssemblyDepth:
		base = params.DepthMm
	case domain.DimRuleAssemblyHeight:
		base = params.HeightMm
	case domain.DimRuleSelectedVariant:
		if rule.VariantSetID == "" {
			return 0, errors.New("dimension rule with 'selected_variant' requires variantSetId")
		}
		variant, ok := selectedVariants[rule.VariantSetID]
		if !ok {
			return 0, fmt.Errorf("selected variant for variantSetId '%s' not found", rule.VariantSetID)
		}
		base = variant.NominalDimensionMm
	default:
		return 0, fmt.Errorf("unknown dimension rule source: '%s'", rule.Source)
	}

	result := (base * mult) + rule.OffsetMm
	if math.IsNaN(result) || math.IsInf(result, 0) || result <= 0 {
		return 0, fmt.Errorf("dimension rule (%s, mult=%g, offset=%g) evaluated to non-positive dimension: %g mm",
			rule.Source, mult, rule.OffsetMm, result)
	}
	return result, nil
}

// ResolveAgregadoAssembly executes deterministic, pure resolution of an Agregado assembly.
//
// Invariants enforced:
// 1. Definition is fully validated (ValidateAgregadoAssemblyDefinition) before resolution.
// 2. RigidMember geometry NEVER scales (scale = [1,1,1], det = +1.0).
// 3. Fabricated member dimensions are recalculated from declarative rules (not geometrically scaled).
// 4. Variant resolution selects discrete commercial SKUs based on available space and clearance rules.
// 5. BOM lines are expanded strictly according to commercial kit and member BOM roles.
// 6. Visual asset binding remains decoupled: #668 retains sole visual authority; pins are attached on publication.
func ResolveAgregadoAssembly(
	agregado domain.Agregado,
	params AssemblyResolutionParams,
) (domain.ResolvedAssemblySnapshot, error) {
	// 1. Full definition validation
	if err := domain.ValidateAgregadoAssemblyDefinition(agregado); err != nil {
		return domain.ResolvedAssemblySnapshot{}, fmt.Errorf("assembly definition validation failed: %w", err)
	}

	// 2. Parameter validation
	if err := ValidateAssemblyResolutionParams(params); err != nil {
		return domain.ResolvedAssemblySnapshot{}, err
	}

	// 3. Variant resolution
	selectedVariantsMap := make(map[string]domain.SelectedAssemblyVariant)
	selectedVariantsList := make([]domain.SelectedAssemblyVariant, 0, len(agregado.VariantSets))

	compatRuleBySet := make(map[string]domain.AssemblyCompatibilityRule)
	for _, rule := range agregado.CompatibilityRules {
		compatRuleBySet[rule.VariantSetID] = rule
	}

	for _, vs := range agregado.VariantSets {
		rule, hasRule := compatRuleBySet[vs.ID]
		if !hasRule {
			// Default rule: 0 clearance, max_fitting
			rule = domain.AssemblyCompatibilityRule{
				VariantSetID:      vs.ID,
				ClearanceMm:       0.0,
				SelectionStrategy: "max_fitting",
			}
		}

		var targetDimensionSpace float64
		switch vs.Dimension {
		case "depth":
			targetDimensionSpace = params.DepthMm
		case "height":
			targetDimensionSpace = params.HeightMm
		case "width":
			targetDimensionSpace = params.WidthMm
		default:
			return domain.ResolvedAssemblySnapshot{}, fmt.Errorf("unsupported variant dimension: '%s'", vs.Dimension)
		}

		selectedVariant, err := selectAssemblyVariant(vs, targetDimensionSpace, rule)
		if err != nil {
			return domain.ResolvedAssemblySnapshot{}, err
		}

		selectedVariantsMap[vs.ID] = selectedVariant
		selectedVariantsList = append(selectedVariantsList, selectedVariant)
	}

	// Sort selected variants deterministically by variantSetId
	sort.Slice(selectedVariantsList, func(i, j int) bool {
		return selectedVariantsList[i].VariantSetID < selectedVariantsList[j].VariantSetID
	})

	// 4. Resolve Rigid Members
	resolvedRigidMembers := make([]domain.ResolvedRigidMember, 0, len(agregado.RigidMembers))
	for _, member := range agregado.RigidMembers {
		var hardwareID string
		switch member.Source.Kind {
		case domain.RigidMemberSourceFixed:
			hardwareID = member.Source.Fixed.HardwareID
		case domain.RigidMemberSourceVariant:
			v, ok := selectedVariantsMap[member.Source.Variant.VariantSetID]
			if !ok {
				return domain.ResolvedAssemblySnapshot{}, fmt.Errorf("member %s: variantSet %s not resolved",
					member.MemberID, member.Source.Variant.VariantSetID)
			}
			hardwareID = v.HardwareID
		default:
			return domain.ResolvedAssemblySnapshot{}, fmt.Errorf("member %s: unknown source kind %s",
				member.MemberID, member.Source.Kind)
		}

		xCoord, err := calculateAxisPlacementCoord("x", member.Placement.X, params.WidthMm)
		if err != nil {
			return domain.ResolvedAssemblySnapshot{}, fmt.Errorf("member %s: %w", member.MemberID, err)
		}
		yCoord, err := calculateAxisPlacementCoord("y", member.Placement.Y, params.DepthMm)
		if err != nil {
			return domain.ResolvedAssemblySnapshot{}, fmt.Errorf("member %s: %w", member.MemberID, err)
		}
		zCoord, err := calculateAxisPlacementCoord("z", member.Placement.Z, params.HeightMm)
		if err != nil {
			return domain.ResolvedAssemblySnapshot{}, fmt.Errorf("member %s: %w", member.MemberID, err)
		}

		var basis domain.HardwareBasis
		if member.Placement.RotationDeg != nil {
			b, err := domain.DeriveHardwareBasisFromEuler(*member.Placement.RotationDeg)
			if err != nil {
				return domain.ResolvedAssemblySnapshot{}, fmt.Errorf("member %s rotation error: %w", member.MemberID, err)
			}
			basis = b
		} else {
			basis = domain.HardwareBasis{
				X: [3]float64{1, 0, 0},
				Y: [3]float64{0, 1, 0},
				Z: [3]float64{0, 0, 1},
			}
		}

		resolvedRigidMembers = append(resolvedRigidMembers, domain.ResolvedRigidMember{
			MemberID:   member.MemberID,
			Role:       member.Role,
			HardwareID: hardwareID,
			LocalTransform: domain.AssemblyMemberTransform{
				TranslationMm: [3]float64{xCoord, yCoord, zCoord},
				Basis:         basis,
			},
			BOMRole: member.BOMRole,
		})
	}

	// 5. Resolve Fabricated Members
	resolvedFabricated := make([]domain.ResolvedFabricatedComponent, 0, len(agregado.FabricatedMembers))
	for _, fm := range agregado.FabricatedMembers {
		length, err := EvaluateDimensionRule(fm.LengthRule, params, selectedVariantsMap)
		if err != nil {
			return domain.ResolvedAssemblySnapshot{}, fmt.Errorf("fabricated member '%s' length error: %w", fm.MemberID, err)
		}
		width, err := EvaluateDimensionRule(fm.WidthRule, params, selectedVariantsMap)
		if err != nil {
			return domain.ResolvedAssemblySnapshot{}, fmt.Errorf("fabricated member '%s' width error: %w", fm.MemberID, err)
		}

		xCoord, err := calculateAxisPlacementCoord("x", fm.Placement.X, params.WidthMm)
		if err != nil {
			return domain.ResolvedAssemblySnapshot{}, fmt.Errorf("fabricated member '%s': %w", fm.MemberID, err)
		}
		yCoord, err := calculateAxisPlacementCoord("y", fm.Placement.Y, params.DepthMm)
		if err != nil {
			return domain.ResolvedAssemblySnapshot{}, fmt.Errorf("fabricated member '%s': %w", fm.MemberID, err)
		}
		zCoord, err := calculateAxisPlacementCoord("z", fm.Placement.Z, params.HeightMm)
		if err != nil {
			return domain.ResolvedAssemblySnapshot{}, fmt.Errorf("fabricated member '%s': %w", fm.MemberID, err)
		}

		var basis domain.HardwareBasis
		if fm.Placement.RotationDeg != nil {
			b, err := domain.DeriveHardwareBasisFromEuler(*fm.Placement.RotationDeg)
			if err != nil {
				return domain.ResolvedAssemblySnapshot{}, fmt.Errorf("fabricated member '%s' rotation error: %w", fm.MemberID, err)
			}
			basis = b
		} else {
			basis = domain.HardwareBasis{
				X: [3]float64{1, 0, 0},
				Y: [3]float64{0, 1, 0},
				Z: [3]float64{0, 0, 1},
			}
		}

		resolvedFabricated = append(resolvedFabricated, domain.ResolvedFabricatedComponent{
			MemberID:    fm.MemberID,
			SlotID:      fm.SlotID,
			Name:        fm.Name,
			LengthMm:    length,
			WidthMm:     width,
			ThicknessMm: fm.ThicknessMm,
			Transform: domain.AssemblyMemberTransform{
				TranslationMm: [3]float64{xCoord, yCoord, zCoord},
				Basis:         basis,
			},
		})
	}

	// 6. Generate BOM
	bomItems := make([]domain.AssemblyBOMItem, 0)
	if agregado.CommercialKitHardwareID != nil && *agregado.CommercialKitHardwareID != "" {
		bomItems = append(bomItems, domain.AssemblyBOMItem{
			HardwareID: *agregado.CommercialKitHardwareID,
			Quantity:   1.0,
			Role:       "commercial_kit",
			Notes:      fmt.Sprintf("Commercial kit for assembly %s", agregado.ID),
		})
	}

	separateCounts := make(map[string]float64)
	separateRoles := make(map[string]string)
	for _, m := range resolvedRigidMembers {
		if m.BOMRole == domain.BOMRoleSeparatelyPurchased {
			separateCounts[m.HardwareID]++
			separateRoles[m.HardwareID] = m.Role
		}
	}

	// Deterministic sorting of separately purchased BOM items
	hwIDs := make([]string, 0, len(separateCounts))
	for hwID := range separateCounts {
		hwIDs = append(hwIDs, hwID)
	}
	sort.Strings(hwIDs)

	for _, hwID := range hwIDs {
		bomItems = append(bomItems, domain.AssemblyBOMItem{
			HardwareID: hwID,
			Quantity:   separateCounts[hwID],
			Role:       separateRoles[hwID],
		})
	}

	snapshot := domain.ResolvedAssemblySnapshot{
		AgregadoID:              agregado.ID,
		AgregadoRevisionNumber:  1,
		CommercialKitHardwareID: agregado.CommercialKitHardwareID,
		ResolvedDimensionsMm:    [3]float64{params.WidthMm, params.DepthMm, params.HeightMm},
		SelectedVariants:        selectedVariantsList,
		RigidMembers:            resolvedRigidMembers,
		FabricatedComponents:    resolvedFabricated,
		BOMItems:                bomItems,
	}

	return snapshot, nil
}

// VisualAssetLookupFunc defines the binding function supplied by #668 visual asset authority.
type VisualAssetLookupFunc func(hardwareID string) (mountFrame *domain.HardwareMountFrame, assetID, revisionID, sha256 string, err error)

// AttachVisualPins binds #668 visual asset authorities into a resolved assembly snapshot
// without duplicating asset selection logic inside the assembly resolver.
func AttachVisualPins(
	snapshot domain.ResolvedAssemblySnapshot,
	lookup VisualAssetLookupFunc,
) (domain.ResolvedAssemblySnapshot, error) {
	if lookup == nil {
		return snapshot, nil
	}

	updatedMembers := make([]domain.ResolvedRigidMember, len(snapshot.RigidMembers))
	for i, m := range snapshot.RigidMembers {
		mf, assetID, revID, sha256, err := lookup(m.HardwareID)
		if err != nil {
			return domain.ResolvedAssemblySnapshot{}, fmt.Errorf("failed looking up visual asset for hardware '%s': %w", m.HardwareID, err)
		}
		memberCopy := m
		memberCopy.MountFrame = mf
		memberCopy.AssetID = &assetID
		memberCopy.AssetRevisionID = &revID
		memberCopy.SHA256 = &sha256
		updatedMembers[i] = memberCopy
	}

	snapshot.RigidMembers = updatedMembers
	return snapshot, nil
}

func selectAssemblyVariant(
	vs domain.AgregadoVariantSet,
	availableSpaceMm float64,
	rule domain.AssemblyCompatibilityRule,
) (domain.SelectedAssemblyVariant, error) {
	maxAllowedNominal := availableSpaceMm - rule.ClearanceMm

	// Sort variants ascending by nominal dimension
	variants := make([]domain.ProductVariant, len(vs.Variants))
	copy(variants, vs.Variants)
	sort.Slice(variants, func(i, j int) bool {
		return variants[i].NominalDimensionMm < variants[j].NominalDimensionMm
	})

	var chosen *domain.ProductVariant
	switch rule.SelectionStrategy {
	case "max_fitting":
		for i := len(variants) - 1; i >= 0; i-- {
			if variants[i].NominalDimensionMm <= maxAllowedNominal {
				v := variants[i]
				chosen = &v
				break
			}
		}
	case "exact":
		for _, v := range variants {
			if math.Abs(v.NominalDimensionMm-maxAllowedNominal) < 1e-3 {
				varCopy := v
				chosen = &varCopy
				break
			}
		}
	default:
		return domain.SelectedAssemblyVariant{}, fmt.Errorf("unknown selection strategy '%s'", rule.SelectionStrategy)
	}

	if chosen == nil {
		nominals := make([]float64, len(variants))
		for i, v := range variants {
			nominals[i] = v.NominalDimensionMm
		}
		return domain.SelectedAssemblyVariant{}, &domain.ErrAssemblyVariantNotFound{
			VariantSetID:      vs.ID,
			RequestedSpaceMm:  availableSpaceMm,
			RequiredClearance: rule.ClearanceMm,
			AvailableNominals: nominals,
		}
	}

	return domain.SelectedAssemblyVariant{
		VariantSetID:       vs.ID,
		HardwareID:         chosen.HardwareID,
		NominalDimensionMm: chosen.NominalDimensionMm,
	}, nil
}

func calculateAxisPlacementCoord(axisName string, p domain.AssemblyAxisPlacement, dimensionMm float64) (float64, error) {
	var base float64
	switch p.Ref {
	case domain.AxisRefMin:
		base = 0.0
	case domain.AxisRefMax:
		base = dimensionMm
	case domain.AxisRefCenter:
		base = dimensionMm / 2.0
	default:
		return 0.0, fmt.Errorf("axis %s has invalid reference '%s'", axisName, p.Ref)
	}
	return base + p.OffsetMm, nil
}
