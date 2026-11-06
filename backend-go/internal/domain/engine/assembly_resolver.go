package engine

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// AssemblyResolutionParams provides target bounding-box dimensions for resolving an Agregado assembly.
type AssemblyResolutionParams struct {
	WidthMm  float64 `json:"widthMm"`
	DepthMm  float64 `json:"depthMm"`
	HeightMm float64 `json:"heightMm"`
	// HardwareDimensions maps hardwareId → effective dimensions (mm) for
	// rigid-member offset formulas (#1453 F1): they expose HW/HH/HD. Server
	// derived only — json:"-" keeps client payloads from injecting it; a
	// missing id evaluates all three to 0 (the historical behavior).
	HardwareDimensions map[string]domain.HardwareDimensions `json:"-"`
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
	selectedVariantsList, err := SelectAgregadoVariants(agregado, params)
	if err != nil {
		return domain.ResolvedAssembly{}, err
	}
	for _, sv := range selectedVariantsList {
		selectedVariantsMap[sv.VariantSetID] = sv
	}

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

		// #1460 F2: las fórmulas del miembro (offset y dimensiones) ven las
		// dimensiones EFECTIVAS — override aplicado sobre el catálogo.
		hwDims, err := resolveMemberEffectiveDimensions(
			member.MemberID,
			member.DimensionOverrides,
			params.HardwareDimensions[hardwareID],
			params.WidthMm, params.DepthMm, params.HeightMm,
		)
		if err != nil {
			return domain.ResolvedAssembly{}, err
		}
		// #1512 M3: closed hand vocabulary — an unknown value is a recipe
		// authoring bug and must fail closed, never resolve as legacy (the
		// definition validation also guards; this is the runtime defense).
		if !domain.IsValidMemberHand(member.Hand) {
			return domain.ResolvedAssembly{}, fmt.Errorf("member %s: hand inválida %q (valores: left|right)", member.MemberID, member.Hand)
		}
		// #1512 M3: default X anchor by hand (left → min/+, right → max/−)
		// when the member declares no explicit X ref — single authority in
		// domain.EffectivePlacement.
		xCoord, err := calculateAxisPlacementCoord("x", member.EffectivePlacement().X, params.WidthMm, hwDims)
		if err != nil {
			return domain.ResolvedAssembly{}, fmt.Errorf("member %s: %w", member.MemberID, err)
		}
		yCoord, err := calculateAxisPlacementCoord("y", member.Placement.Y, params.DepthMm, hwDims)
		if err != nil {
			return domain.ResolvedAssembly{}, fmt.Errorf("member %s: %w", member.MemberID, err)
		}
		zCoord, err := calculateAxisPlacementCoord("z", member.Placement.Z, params.HeightMm, hwDims)
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

		resolvedMember := domain.ResolvedRigidMember{
			MemberID:   member.MemberID,
			Role:       member.Role,
			HardwareID: hardwareID,
			LocalTransform: domain.AssemblyMemberTransform{
				TranslationMm: [3]float64{xCoord, yCoord, zCoord},
				Basis:         basis,
			},
			BOMRole:         member.BOMRole,
			ActorMembership: member.ActorMembership,
			HostPlacement:   member.HostPlacement, // #1429 slice A: declared external host rides to the machining derivation.
			Hand:            member.Hand,          // #1512 M3: side rides to the per-hand asset binding.
		}
		// #1460 F2: sólo con override — payloads legacy byte-idénticos.
		if member.DimensionOverrides != nil {
			dims := hwDims
			resolvedMember.ResolvedDimensions = &dims
		}
		resolvedRigidMembers = append(resolvedRigidMembers, resolvedMember)
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
			xCoord, err := calculateAxisPlacementCoord("x", c.Overrides.PlacementRule.X, params.WidthMm, domain.HardwareDimensions{})
			if err != nil {
				return domain.ResolvedAssembly{}, fmt.Errorf("component %s: %w", c.ComponentID, err)
			}
			yCoord, err := calculateAxisPlacementCoord("y", c.Overrides.PlacementRule.Y, params.DepthMm, domain.HardwareDimensions{})
			if err != nil {
				return domain.ResolvedAssembly{}, fmt.Errorf("component %s: %w", c.ComponentID, err)
			}
			zCoord, err := calculateAxisPlacementCoord("z", c.Overrides.PlacementRule.Z, params.HeightMm, domain.HardwareDimensions{})
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

	// 7. Generate BOM — #1493: el kit efectivo puede venir de la variante
	// seleccionada (una altura de cajón = un kit). Fallback: kit del agregado.
	effectiveKit, err := EffectiveKitHardwareID(agregado, selectedVariantsList)
	if err != nil {
		return domain.ResolvedAssembly{}, err
	}
	if effectiveKit == "" {
		for _, m := range resolvedRigidMembers {
			if m.BOMRole == domain.BOMRoleIncludedInKit {
				return domain.ResolvedAssembly{}, fmt.Errorf(
					"member '%s' has bomRole 'included_in_kit' but no effective commercial kit is declared (agregado level or on the selected variant)", m.MemberID)
			}
		}
	}

	bomItems := make([]domain.AssemblyBOMItem, 0)
	if effectiveKit != "" {
		bomItems = append(bomItems, domain.AssemblyBOMItem{
			HardwareID: effectiveKit,
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

	// #1493: CommercialKitHardwareID refleja el kit EFECTIVO (variante o
	// agregado); legacy sin kits de variante ⇒ valor idéntico al anterior.
	var effectiveKitPtr *string
	if effectiveKit != "" {
		k := effectiveKit
		effectiveKitPtr = &k
	}

	resolved := domain.ResolvedAssembly{
		AgregadoID:              agregado.ID,
		CommercialKitHardwareID: effectiveKitPtr,
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

// AttachHardwareDesignParts (#1417): enriches each resolved member with the
// design parts declared on its catalog hardware (by SKP component name) —
// the same flow as visual pins. A monolithic hardware (no parts) leaves its
// members untouched; unknown hardware ids simply attach nothing.
func AttachHardwareDesignParts(
	assembly domain.ResolvedAssembly,
	hardwareByID map[string]domain.Hardware,
) domain.ResolvedAssembly {
	if len(hardwareByID) == 0 {
		return assembly
	}
	updated := make([]domain.ResolvedRigidMember, len(assembly.RigidMembers))
	changed := false
	for i, m := range assembly.RigidMembers {
		updated[i] = m
		hw, ok := hardwareByID[m.HardwareID]
		if !ok || len(hw.DesignParts) == 0 {
			continue
		}
		parts := make([]domain.HardwareDesignPart, len(hw.DesignParts))
		copy(parts, hw.DesignParts)
		updated[i].DesignParts = parts
		changed = true
	}
	if !changed {
		return assembly
	}
	assemblyCopy := assembly
	assemblyCopy.RigidMembers = updated
	return assemblyCopy
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

// SelectAgregadoVariants deterministically selects one variant per variant set
// of the agregado (max_fitting by default, exact by compatibility rule) and
// returns the list sorted by variantSetId. #1493: extracted from
// ResolveAgregadoAssembly so the layout engine can pre-select variants per
// drawer bay BEFORE syncing kit parts — the commercial kit may come from the
// selected variant (one Blum MERIVOBOX kit per drawer height N/M/K/E).
func SelectAgregadoVariants(
	agregado domain.Agregado,
	params AssemblyResolutionParams,
) ([]domain.SelectedAssemblyVariant, error) {
	compatRuleBySet := make(map[string]domain.AssemblyCompatibilityRule)
	for _, rule := range agregado.CompatibilityRules {
		compatRuleBySet[rule.VariantSetID] = rule
	}

	selectedVariantsList := make([]domain.SelectedAssemblyVariant, 0, len(agregado.VariantSets))
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
			return nil, fmt.Errorf("unsupported variant dimension: '%s'", vs.Dimension)
		}

		selectedVariant, err := selectAssemblyVariant(vs, targetDimensionSpace, rule)
		if err != nil {
			return nil, err
		}
		selectedVariantsList = append(selectedVariantsList, selectedVariant)
	}

	sort.Slice(selectedVariantsList, func(i, j int) bool {
		return selectedVariantsList[i].VariantSetID < selectedVariantsList[j].VariantSetID
	})
	return selectedVariantsList, nil
}

// EffectiveKitHardwareID returns the commercial kit that governs a resolved
// variant selection (#1493). A variant may declare its own
// commercialKitHardwareId (one Blum MERIVOBOX kit per drawer height); when the
// selected variants declare kits, the variant kit wins over the agregado-level
// kit. Two or more DISTINCT declared kits are ambiguous and fail closed; no
// declared kit falls back to the agregado-level kit ("" when the recipe
// declares none). A declared-but-unselected variant kit is ignored — the
// selection is the only commercial truth of this resolution.
func EffectiveKitHardwareID(agregado domain.Agregado, selected []domain.SelectedAssemblyVariant) (string, error) {
	variantsBySet := make(map[string][]domain.ProductVariant, len(agregado.VariantSets))
	for _, vs := range agregado.VariantSets {
		variantsBySet[vs.ID] = vs.Variants
	}

	kitOwner := make(map[string]string)  // kit -> first variantSetId that declared it
	distinctKits := make([]string, 0, 2) // deterministic declaration order
	for _, sv := range selected {
		kit := ""
		for _, v := range variantsBySet[sv.VariantSetID] {
			if v.NominalDimensionMm == sv.NominalDimensionMm {
				kit = strings.TrimSpace(v.CommercialKitHardwareID)
				break
			}
		}
		if kit == "" {
			continue
		}
		if _, seen := kitOwner[kit]; !seen {
			kitOwner[kit] = sv.VariantSetID
			distinctKits = append(distinctKits, kit)
		}
	}

	if len(distinctKits) > 1 {
		owners := make([]string, 0, len(distinctKits))
		for _, kit := range distinctKits {
			owners = append(owners, fmt.Sprintf("'%s' (set '%s')", kit, kitOwner[kit]))
		}
		return "", fmt.Errorf("ambiguous commercial kit: selected variants declare %d distinct kits: %s",
			len(distinctKits), strings.Join(owners, ", "))
	}
	if len(distinctKits) == 1 {
		return distinctKits[0], nil
	}
	if agregado.CommercialKitHardwareID != nil {
		return strings.TrimSpace(*agregado.CommercialKitHardwareID), nil
	}
	return "", nil
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

// #1460 F2: merge de DimensionOverrides sobre las dims de catálogo del
// herraje del miembro. La fórmula (env: PW/PH/PD del envelope + HW/HH/HD de
// catálogo) reemplaza al mm; el evaluador compartido redondea a mm entero
// (mitad lejos de cero) para que TS y Go resuelvan idéntico. Fail-closed:
// negativo, no finito o fuera de cota es error de autoría, nunca un guess.
func resolveMemberEffectiveDimensions(
	memberID string,
	override *domain.HardwareDimensionOverride,
	catalog domain.HardwareDimensions,
	widthMm, depthMm, heightMm float64,
) (domain.HardwareDimensions, error) {
	base := catalog
	if override == nil {
		return base, nil
	}
	resolveAxis := func(label string, axis *domain.HardwareDimensionOverrideAxis, catalogMm, envelopeMm float64) (float64, error) {
		if axis == nil {
			return catalogMm, nil
		}
		hasFormula := axis.Formula != nil && strings.TrimSpace(*axis.Formula) != ""
		if !hasFormula && axis.Mm == nil {
			return catalogMm, nil
		}
		if hasFormula {
			// Strip ALL whitespace before evaluating (TS strips \s+ — parity).
			formula := strings.Map(func(r rune) rune {
				if unicode.IsSpace(r) {
					return -1
				}
				return r
			}, strings.TrimSpace(*axis.Formula))
			dims := formulaDims{
				W:  int(math.Round(widthMm)),
				H:  int(math.Round(heightMm)),
				D:  int(math.Round(depthMm)),
				PW: int(math.Round(widthMm)),
				PH: int(math.Round(heightMm)),
				PD: int(math.Round(depthMm)),
				HW: int(math.Round(base.WidthMm)),
				HH: int(math.Round(base.HeightMm)),
				HD: int(math.Round(base.DepthMm)),
			}
			evaluated, err := evaluatePartFormula(formula, dims)
			if err != nil {
				return 0, fmt.Errorf("member %s %s dimension override formula: %w", memberID, label, err)
			}
			v := float64(evaluated)
			if v < 0 {
				return 0, fmt.Errorf("member %s %s dimension override evaluates invalid: %v (must be a finite value ≥ 0 mm)", memberID, label, v)
			}
			if math.Abs(v) > 100000.0 {
				return 0, fmt.Errorf("member %s %s dimension override evaluates out of bounds: %v (must be ≤ 100000 mm)", memberID, label, v)
			}
			return v, nil
		}
		mm := *axis.Mm
		if math.IsNaN(mm) || math.IsInf(mm, 0) || mm < 0 {
			return 0, fmt.Errorf("member %s %s dimension override invalid: %v (must be a finite value ≥ 0 mm)", memberID, label, mm)
		}
		if mm > 100000.0 {
			return 0, fmt.Errorf("member %s %s dimension override out of bounds: %v (must be ≤ 100000 mm)", memberID, label, mm)
		}
		return mm, nil
	}
	width, err := resolveAxis("width", override.Width, base.WidthMm, widthMm)
	if err != nil {
		return domain.HardwareDimensions{}, err
	}
	height, err := resolveAxis("height", override.Height, base.HeightMm, heightMm)
	if err != nil {
		return domain.HardwareDimensions{}, err
	}
	depth, err := resolveAxis("depth", override.Depth, base.DepthMm, depthMm)
	if err != nil {
		return domain.HardwareDimensions{}, err
	}
	return domain.HardwareDimensions{WidthMm: width, HeightMm: height, DepthMm: depth}, nil
}

func calculateAxisPlacementCoord(axisName string, p domain.AssemblyAxisPlacement, dimensionMm float64, hwDims domain.HardwareDimensions) (float64, error) {
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
	if p.OffsetFormula != nil && strings.TrimSpace(*p.OffsetFormula) != "" {
		// #1418: the formula replaces the numeric offset; whole-mm rounding
		// (the shared evaluator's convention) keeps TS and Go identical.
		d := int(math.Round(dimensionMm))
		dims := formulaDims{W: d, H: d, D: d}
		// #1453 F1: HW/HH/HD from the member's effective dimensions
		// (zero value → 0/0/0, matching the TS env fallback).
		dims.HW = int(math.Round(hwDims.WidthMm))
		dims.HH = int(math.Round(hwDims.HeightMm))
		dims.HD = int(math.Round(hwDims.DepthMm))
		switch axisName {
		case "x":
			dims.PW = d
		case "y":
			dims.PD = d
		default:
			dims.PH = d
		}
		// Strip ALL whitespace before evaluating (TS strips \s+ — parity).
		formula := strings.Map(func(r rune) rune {
			if unicode.IsSpace(r) {
				return -1
			}
			return r
		}, strings.TrimSpace(*p.OffsetFormula))
		offset, err := evaluatePartFormula(formula, dims)
		if err != nil {
			return 0.0, fmt.Errorf("axis %s offset formula: %w", axisName, err)
		}
		// Same magnitude bound as offsetMm (#1421 rev, TS parity).
		if math.Abs(float64(offset)) > 100000.0 {
			return 0.0, fmt.Errorf("axis %s offset formula evaluates out of bounds: %d (|offset| must be ≤ 100000 mm)", axisName, offset)
		}
		return base + float64(offset), nil
	}
	return base + p.OffsetMm, nil
}
