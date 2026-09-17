package engine

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

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

// EvaluateDimensionRule deterministically calculates dimension from declarative rules (R1, R9).
func EvaluateDimensionRule(
	rule domain.AssemblyDimensionRule,
	params AssemblyResolutionParams,
	selectedVariants map[string]domain.SelectedAssemblyVariant,
) (float64, error) {
	if rule.Multiplier != nil {
		if math.IsNaN(*rule.Multiplier) || math.IsInf(*rule.Multiplier, 0) {
			return 0, fmt.Errorf("dimension rule has non-finite multiplier: %g", *rule.Multiplier)
		}
	}
	if math.IsNaN(rule.OffsetMm) || math.IsInf(rule.OffsetMm, 0) {
		return 0, fmt.Errorf("dimension rule has non-finite offsetMm: %g", rule.OffsetMm)
	}

	mult := rule.EffectiveMultiplier()
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
// 2. Pure mechanical evaluation: does NOT assert historical snapshot or invent revision numbers (R11).
// 3. Fabricated boards resolve solely from Agregado.Components (R8, R12).
// 4. RigidMember geometry NEVER scales (scale = [1,1,1], det = +1.0).
// 5. Variant resolution selects discrete commercial SKUs based on available space and clearance rules.
// 6. BOM lines are expanded strictly according to commercial kit and member BOM roles.
// 7. Visual asset binding remains decoupled: #668 retains sole visual authority (R10, R13).
func ResolveAgregadoAssembly(
	agregado domain.Agregado,
	params AssemblyResolutionParams,
) (domain.ResolvedAssembly, error) {
	// 1. Full definition validation
	if err := domain.ValidateAgregadoAssemblyDefinition(agregado); err != nil {
		return domain.ResolvedAssembly{}, fmt.Errorf("assembly definition validation failed: %w", err)
	}

	// 2. Parameter validation
	if err := ValidateAssemblyResolutionParams(params); err != nil {
		return domain.ResolvedAssembly{}, err
	}

	// 4. Variant resolution
	selectedVariantsMap := make(map[string]domain.SelectedAssemblyVariant)
	selectedVariantsList := make([]domain.SelectedAssemblyVariant, 0, len(agregado.VariantSets))

	compatRuleBySet := make(map[string]domain.AssemblyCompatibilityRule)
	for _, rule := range agregado.CompatibilityRules {
		compatRuleBySet[rule.VariantSetID] = rule
	}

	for _, vs := range agregado.VariantSets {
		rule, hasRule := compatRuleBySet[vs.ID]
		if !hasRule {
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
			return domain.ResolvedAssembly{}, fmt.Errorf("unsupported variant dimension: '%s'", vs.Dimension)
		}

		selectedVariant, err := selectAssemblyVariant(vs, targetDimensionSpace, rule)
		if err != nil {
			return domain.ResolvedAssembly{}, err
		}

		selectedVariantsMap[vs.ID] = selectedVariant
		selectedVariantsList = append(selectedVariantsList, selectedVariant)
	}

	sort.Slice(selectedVariantsList, func(i, j int) bool {
		return selectedVariantsList[i].VariantSetID < selectedVariantsList[j].VariantSetID
	})

	// 5. Resolve Rigid Members
	resolvedRigidMembers := make([]domain.ResolvedRigidMember, 0, len(agregado.RigidMembers))
	for _, member := range agregado.RigidMembers {
		var hardwareID string
		switch member.Source.Kind {
		case domain.RigidMemberSourceFixed:
			hardwareID = member.Source.Fixed.HardwareID
		case domain.RigidMemberSourceVariant:
			v, ok := selectedVariantsMap[member.Source.Variant.VariantSetID]
			if !ok {
				return domain.ResolvedAssembly{}, fmt.Errorf("member %s: variantSet %s not resolved",
					member.MemberID, member.Source.Variant.VariantSetID)
			}
			hardwareID = v.HardwareID
		default:
			return domain.ResolvedAssembly{}, fmt.Errorf("member %s: unknown source kind %s",
				member.MemberID, member.Source.Kind)
		}

		xCoord, err := calculateAxisPlacementCoord("x", member.Placement.X, params.WidthMm)
		if err != nil {
			return domain.ResolvedAssembly{}, fmt.Errorf("member %s: %w", member.MemberID, err)
		}
		yCoord, err := calculateAxisPlacementCoord("y", member.Placement.Y, params.DepthMm)
		if err != nil {
			return domain.ResolvedAssembly{}, fmt.Errorf("member %s: %w", member.MemberID, err)
		}
		zCoord, err := calculateAxisPlacementCoord("z", member.Placement.Z, params.HeightMm)
		if err != nil {
			return domain.ResolvedAssembly{}, fmt.Errorf("member %s: %w", member.MemberID, err)
		}

		var basis domain.HardwareBasis
		if member.Placement.RotationDeg != nil {
			b, err := domain.DeriveHardwareBasisFromEuler(*member.Placement.RotationDeg)
			if err != nil {
				return domain.ResolvedAssembly{}, fmt.Errorf("member %s rotation error: %w", member.MemberID, err)
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

	// 6. Resolve Fabricated Components (Sole authority: Agregado.Components - R8)
	resolvedFabricated := make([]domain.ResolvedFabricatedComponent, 0, len(agregado.Components))
	for _, c := range agregado.Components {
		var length, width float64
		var basis domain.HardwareBasis
		var translation [3]float64
		var err error

		if c.Overrides != nil && c.Overrides.LengthRule != nil {
			length, err = EvaluateDimensionRule(*c.Overrides.LengthRule, params, selectedVariantsMap)
			if err != nil {
				return domain.ResolvedAssembly{}, fmt.Errorf("component '%s' length error: %w", c.ComponentID, err)
			}
		}
		if c.Overrides != nil && c.Overrides.WidthRule != nil {
			width, err = EvaluateDimensionRule(*c.Overrides.WidthRule, params, selectedVariantsMap)
			if err != nil {
				return domain.ResolvedAssembly{}, fmt.Errorf("component '%s' width error: %w", c.ComponentID, err)
			}
		}

		if c.Overrides != nil && c.Overrides.PlacementRule != nil {
			xCoord, err := calculateAxisPlacementCoord("x", c.Overrides.PlacementRule.X, params.WidthMm)
			if err != nil {
				return domain.ResolvedAssembly{}, fmt.Errorf("component '%s': %w", c.ComponentID, err)
			}
			yCoord, err := calculateAxisPlacementCoord("y", c.Overrides.PlacementRule.Y, params.DepthMm)
			if err != nil {
				return domain.ResolvedAssembly{}, fmt.Errorf("component '%s': %w", c.ComponentID, err)
			}
			zCoord, err := calculateAxisPlacementCoord("z", c.Overrides.PlacementRule.Z, params.HeightMm)
			if err != nil {
				return domain.ResolvedAssembly{}, fmt.Errorf("component '%s': %w", c.ComponentID, err)
			}
			translation = [3]float64{xCoord, yCoord, zCoord}

			if c.Overrides.PlacementRule.RotationDeg != nil {
				b, err := domain.DeriveHardwareBasisFromEuler(*c.Overrides.PlacementRule.RotationDeg)
				if err != nil {
					return domain.ResolvedAssembly{}, fmt.Errorf("component '%s' rotation error: %w", c.ComponentID, err)
				}
				basis = b
			} else {
				basis = domain.HardwareBasis{
					X: [3]float64{1, 0, 0},
					Y: [3]float64{0, 1, 0},
					Z: [3]float64{0, 0, 1},
				}
			}
		} else {
			basis = domain.HardwareBasis{
				X: [3]float64{1, 0, 0},
				Y: [3]float64{0, 1, 0},
				Z: [3]float64{0, 0, 1},
			}
		}

		resolvedFabricated = append(resolvedFabricated, domain.ResolvedFabricatedComponent{
			ComponentID: c.ComponentID,
			Quantity:    c.Quantity,
			LengthMm:    length,
			WidthMm:     width,
			Transform: domain.AssemblyMemberTransform{
				TranslationMm: translation,
				Basis:         basis,
			},
		})
	}

	// 7. Generate BOM
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

	resolved := domain.ResolvedAssembly{
		AgregadoID:              agregado.ID,
		CommercialKitHardwareID: agregado.CommercialKitHardwareID,
		ResolvedDimensionsMm:    [3]float64{params.WidthMm, params.DepthMm, params.HeightMm},
		SelectedVariants:        selectedVariantsList,
		RigidMembers:            resolvedRigidMembers,
		FabricatedComponents:    resolvedFabricated,
		BOMItems:                bomItems,
	}

	return resolved, nil
}

// VisualAssetLookupFunc defines the binding function supplied by #668 visual asset authority.
type VisualAssetLookupFunc func(hardwareID string) (mountFrame *domain.HardwareMountFrame, assetID, revisionID, sha256 string, err error)

// AttachVisualPins optionally enriches a resolved assembly with #668 visual assets (R10: fail closed).
// If lookup is nil, the resolved mechanical assembly is returned unmodified.
// If lookup is provided and finds an asset, it validates complete identity (non-empty assetId, assetRevisionId, sha256)
// and validates MountFrame basis. Fails closed on partial/malformed pins.
func AttachVisualPins(
	assembly domain.ResolvedAssembly,
	lookup VisualAssetLookupFunc,
) (domain.ResolvedAssembly, error) {
	if lookup == nil {
		return assembly, nil
	}

	updatedMembers := make([]domain.ResolvedRigidMember, len(assembly.RigidMembers))
	for i, m := range assembly.RigidMembers {
		mf, assetID, revID, sha256, err := lookup(m.HardwareID)
		if err != nil {
			return domain.ResolvedAssembly{}, fmt.Errorf("failed looking up visual asset for hardware '%s': %w", m.HardwareID, err)
		}
		if strings.TrimSpace(assetID) == "" {
			return domain.ResolvedAssembly{}, fmt.Errorf("visual asset for hardware '%s' returned empty assetId: fail closed", m.HardwareID)
		}
		if strings.TrimSpace(revID) == "" {
			return domain.ResolvedAssembly{}, fmt.Errorf("visual asset for hardware '%s' returned empty assetRevisionId: fail closed", m.HardwareID)
		}
		if strings.TrimSpace(sha256) == "" {
			return domain.ResolvedAssembly{}, fmt.Errorf("visual asset for hardware '%s' returned empty sha256: fail closed", m.HardwareID)
		}
		if mf != nil {
			if err := domain.ValidateHardwareBasis(mf.Basis, "mountFrame.basis"); err != nil {
				return domain.ResolvedAssembly{}, fmt.Errorf("visual asset for hardware '%s' has invalid mountFrame basis: %w", m.HardwareID, err)
			}
			for axisIdx, v := range mf.OriginMm {
				if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > 100000.0 {
					return domain.ResolvedAssembly{}, fmt.Errorf("visual asset for hardware '%s' mountFrame origin[%d] is non-finite: %g", m.HardwareID, axisIdx, v)
				}
			}
		}

		memberCopy := m
		memberCopy.MountFrame = mf
		memberCopy.AssetID = &assetID
		memberCopy.AssetRevisionID = &revID
		memberCopy.SHA256 = &sha256
		updatedMembers[i] = memberCopy
	}

	assemblyCopy := assembly
	assemblyCopy.RigidMembers = updatedMembers
	return assemblyCopy, nil
}

// FreezePublishedAssemblySnapshot explicitly produces an immutable published snapshot (R11, R13).
// Enforces:
// 1. Authoritative positive recipe revision (recipeRevision > 0).
// 2. Mandatory #668 visual asset authority; nil lookup is rejected.
// 3. Complete visual identity for every rigid member.
// Fails closed if revision <= 0, lookup is nil, or any member cannot be fully pinned.
func FreezePublishedAssemblySnapshot(
	assembly domain.ResolvedAssembly,
	recipeRevision int,
	lookup VisualAssetLookupFunc,
) (domain.PublishedAssemblySnapshot, error) {
	if recipeRevision <= 0 {
		return domain.PublishedAssemblySnapshot{}, fmt.Errorf("publication freeze requires authoritative positive recipe revision (got %d)", recipeRevision)
	}
	if lookup == nil {
		return domain.PublishedAssemblySnapshot{}, errors.New("publication freeze requires #668 visual asset authority; nil lookup is rejected")
	}

	pinnedAssembly, err := AttachVisualPins(assembly, lookup)
	if err != nil {
		return domain.PublishedAssemblySnapshot{}, fmt.Errorf("publication freeze visual binding failed: %w", err)
	}

	for _, m := range pinnedAssembly.RigidMembers {
		if m.AssetID == nil || strings.TrimSpace(*m.AssetID) == "" {
			return domain.PublishedAssemblySnapshot{}, fmt.Errorf("publication freeze incomplete: rigid member '%s' missing visual assetId", m.MemberID)
		}
		if m.AssetRevisionID == nil || strings.TrimSpace(*m.AssetRevisionID) == "" {
			return domain.PublishedAssemblySnapshot{}, fmt.Errorf("publication freeze incomplete: rigid member '%s' missing visual assetRevisionId", m.MemberID)
		}
		if m.SHA256 == nil || strings.TrimSpace(*m.SHA256) == "" {
			return domain.PublishedAssemblySnapshot{}, fmt.Errorf("publication freeze incomplete: rigid member '%s' missing visual sha256", m.MemberID)
		}
	}

	return domain.PublishedAssemblySnapshot{
		AgregadoID:              assembly.AgregadoID,
		AgregadoRevisionNumber:  recipeRevision,
		CommercialKitHardwareID: assembly.CommercialKitHardwareID,
		ResolvedDimensionsMm:    assembly.ResolvedDimensionsMm,
		SelectedVariants:        assembly.SelectedVariants,
		RigidMembers:            pinnedAssembly.RigidMembers,
		FabricatedComponents:    assembly.FabricatedComponents,
		BOMItems:                assembly.BOMItems,
	}, nil
}

func selectAssemblyVariant(
	vs domain.AgregadoVariantSet,
	availableSpaceMm float64,
	rule domain.AssemblyCompatibilityRule,
) (domain.SelectedAssemblyVariant, error) {
	maxAllowedNominal := availableSpaceMm - rule.ClearanceMm

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
