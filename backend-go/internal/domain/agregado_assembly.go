package domain

import (
	"errors"
	"fmt"
	"math"
	"strings"
)

// RigidMemberSourceKind discriminates whether a rigid member points directly to a fixed
// hardware ID or dynamically selects from a product variant set.
type RigidMemberSourceKind string

const (
	RigidMemberSourceFixed   RigidMemberSourceKind = "fixed"
	RigidMemberSourceVariant RigidMemberSourceKind = "variant"
)

// RigidMemberBOMRole defines how a rigid member participates in cost and purchasing.
type RigidMemberBOMRole string

const (
	// BOMRoleIncludedInKit: Member is physically included inside the commercial kit box.
	// It does NOT produce an individual purchasing line item in the BOM.
	BOMRoleIncludedInKit RigidMemberBOMRole = "included_in_kit"
	// BOMRoleSeparatelyPurchased: Member is an additional component purchased individually.
	// It produces its own purchasing line item in the BOM.
	BOMRoleSeparatelyPurchased RigidMemberBOMRole = "separately_purchased"
	// BOMRoleNonPurchasing: Member is a visual representation only (e.g. external reference).
	// It produces no purchasing line item.
	BOMRoleNonPurchasing RigidMemberBOMRole = "non_purchasing"
)

// AssemblyAxisRef defines the reference point along an axis of the assembly bounding box.
type AssemblyAxisRef string

const (
	AxisRefMin    AssemblyAxisRef = "min"    // minX = 0, minY = 0, minZ = 0
	AxisRefMax    AssemblyAxisRef = "max"    // maxX = W, maxY = D, maxZ = H
	AxisRefCenter AssemblyAxisRef = "center" // centerX = W/2, centerY = D/2, centerZ = H/2
)

// AssemblyAxisPlacement positions a coordinate along an axis via a reference point and offset in mm.
type AssemblyAxisPlacement struct {
	Ref      AssemblyAxisRef `json:"ref"`      // "min" | "max" | "center"
	OffsetMm float64         `json:"offsetMm"` // signed delta in mm from the reference
}

// AssemblyAnchorRule defines the rigid pose of a member inside the Assembly Space.
type AssemblyAnchorRule struct {
	X           AssemblyAxisPlacement `json:"x"`
	Y           AssemblyAxisPlacement `json:"y"`
	Z           AssemblyAxisPlacement `json:"z"`
	RotationDeg *HardwareRotationDeg  `json:"rotationDeg,omitempty"` // Arbitrary finite rigid rotation
}

// FixedHardwareSource points to a single fixed Hardware definition.
type FixedHardwareSource struct {
	HardwareID string `json:"hardwareId"`
}

// VariantHardwareSource points to an assembly-scoped VariantSet.
type VariantHardwareSource struct {
	VariantSetID string `json:"variantSetId"`
}

// RigidMemberSource is the discriminated union for hardware binding. Exactly one source must be populated.
type RigidMemberSource struct {
	Kind    RigidMemberSourceKind  `json:"kind"`
	Fixed   *FixedHardwareSource   `json:"fixed,omitempty"`
	Variant *VariantHardwareSource `json:"variant,omitempty"`
}

// AgregadoRigidMember defines an autonomous bought rigid hardware component inside an Agregado recipe.
type AgregadoRigidMember struct {
	MemberID  string             `json:"memberId"`
	Role      string             `json:"role"` // e.g. "side_left", "side_right", "runner_left", "runner_right"
	Source    RigidMemberSource  `json:"source"`
	Placement AssemblyAnchorRule `json:"placement"`
	BOMRole   RigidMemberBOMRole `json:"bomRole"`
}

// DimensionRuleSource defines the authoritative source for recalculating fabricated board dimensions.
type DimensionRuleSource string

const (
	DimRuleAssemblyWidth   DimensionRuleSource = "assembly_width"
	DimRuleAssemblyDepth   DimensionRuleSource = "assembly_depth"
	DimRuleAssemblyHeight  DimensionRuleSource = "assembly_height"
	DimRuleSelectedVariant DimensionRuleSource = "selected_variant"
)

// AssemblyDimensionRule provides declarative, bounded dimension calculation (no eval, no scripts).
// Multiplier contract (R9):
// - omitted (nil) -> default 1.0
// - explicit 0.0 -> mathematical 0.0
// Computed dimension = (SourceValue * effectiveMultiplier) + OffsetMm.
type AssemblyDimensionRule struct {
	Source       DimensionRuleSource `json:"source"`
	VariantSetID string              `json:"variantSetId,omitempty"` // Required if Source == DimRuleSelectedVariant
	Multiplier   *float64            `json:"multiplier,omitempty"`   // nil = 1.0; explicit 0.0 = 0.0
	OffsetMm     float64             `json:"offsetMm"`               // Delta in mm
}

// EffectiveMultiplier returns 1.0 if nil, or the explicit multiplier value.
func (r AssemblyDimensionRule) EffectiveMultiplier() float64 {
	if r.Multiplier == nil {
		return 1.0
	}
	return *r.Multiplier
}

// ProductVariant represents one discrete commercial option in a VariantSet.
type ProductVariant struct {
	NominalDimensionMm float64 `json:"nominalDimensionMm"` // e.g. 450.0, 500.0, 550.0
	HardwareID         string  `json:"hardwareId"`         // Catalog Hardware.ID with exact 3D Asset & MountFrame
}

// AgregadoVariantSet groups discrete commercial sizes available for a specific dimension.
type AgregadoVariantSet struct {
	ID        string           `json:"id"`
	Dimension string           `json:"dimension"` // "depth" | "height" | "width"
	Variants  []ProductVariant `json:"variants"`
}

// AssemblyCompatibilityRule specifies how the Agregado recipe selects and validates variants.
type AssemblyCompatibilityRule struct {
	VariantSetID      string  `json:"variantSetId"`
	ClearanceMm       float64 `json:"clearanceMm"`       // Minimum space clearance required beyond nominal dimension
	SelectionStrategy string  `json:"selectionStrategy"` // "max_fitting" | "exact"
}

// AssemblyMemberTransform defines the authoritative translation and orthonormal basis of a member.
type AssemblyMemberTransform struct {
	TranslationMm [3]float64    `json:"translationMm"`
	Basis         HardwareBasis `json:"basis"`
}

// ResolvedRigidMember is the fully resolved rigid hardware member produced by the assembly resolver.
// It resolves memberId, role, exact hardwareId, local rigid transform (det=+1), and bomRole.
// Visual pins (AssetID, AssetRevisionID, SHA256, MountFrame) are populated via visual binding authority (#668).
type ResolvedRigidMember struct {
	MemberID        string                  `json:"memberId"`
	Role            string                  `json:"role"`
	HardwareID      string                  `json:"hardwareId"`
	LocalTransform  AssemblyMemberTransform `json:"localTransform"` // Rigid placement in Assembly Space (det = +1.0)
	BOMRole         RigidMemberBOMRole      `json:"bomRole"`
	AssetID         *string                 `json:"assetId,omitempty"`
	AssetRevisionID *string                 `json:"assetRevisionId,omitempty"`
	SHA256          *string                 `json:"sha256,omitempty"`
	MountFrame      *HardwareMountFrame     `json:"mountFrame,omitempty"`
}

// AssemblyBOMItem is one purchasing row produced by the assembly.
type AssemblyBOMItem struct {
	HardwareID string  `json:"hardwareId"`
	Quantity   float64 `json:"quantity"`
	Role       string  `json:"role"`
	Notes      string  `json:"notes,omitempty"`
}

// ResolvedFabricatedComponent describes a dimensioned and placed fabricated board component.
// Originates solely from Agregado.Components without parallel domain entities (R8).
type ResolvedFabricatedComponent struct {
	ComponentID string                  `json:"componentId"`
	Quantity    int                     `json:"quantity"`
	LengthMm    float64                 `json:"lengthMm"`
	WidthMm     float64                 `json:"widthMm"`
	Transform   AssemblyMemberTransform `json:"transform"`
}

// SelectedAssemblyVariant explicitly records the chosen product variant per variant set (R4).
// Freezes both nominal dimension and exact commercial hardwareId to avoid historical ambiguity.
type SelectedAssemblyVariant struct {
	VariantSetID       string  `json:"variantSetId"`
	HardwareID         string  `json:"hardwareId"`
	NominalDimensionMm float64 `json:"nominalDimensionMm"`
}

// ResolvedAssembly is the pure deterministic result of resolving an Agregado recipe against dimensions.
// Represents mechanical positions, discrete variant SKUs, BOM lines, and recalculated fabricated components.
// Does NOT assert historical publication or snapshot immutability (R11).
type ResolvedAssembly struct {
	AgregadoID              string                        `json:"agregadoId"`
	CommercialKitHardwareID *string                       `json:"commercialKitHardwareId,omitempty"`
	ResolvedDimensionsMm    [3]float64                    `json:"resolvedDimensionsMm"`
	SelectedVariants        []SelectedAssemblyVariant     `json:"selectedVariants"`
	RigidMembers            []ResolvedRigidMember         `json:"rigidMembers"`
	FabricatedComponents    []ResolvedFabricatedComponent `json:"fabricatedComponents"`
	BOMItems                []AssemblyBOMItem             `json:"bomItems"`
}

// PublishedAssemblySnapshot freezes all resolved state with an authoritative recipe revision and visual pins.
// Produced during publication freeze (R11, R13); will be persisted in Increment B/C.
type PublishedAssemblySnapshot struct {
	AgregadoID              string                        `json:"agregadoId"`
	AgregadoRevisionNumber  int                           `json:"agregadoRevisionNumber"` // Must come from persistent authoritative recipe revision
	CommercialKitHardwareID *string                       `json:"commercialKitHardwareId,omitempty"`
	ResolvedDimensionsMm    [3]float64                    `json:"resolvedDimensionsMm"`
	SelectedVariants        []SelectedAssemblyVariant     `json:"selectedVariants"`
	RigidMembers            []ResolvedRigidMember         `json:"rigidMembers"` // Fully pinned with visual assets
	FabricatedComponents    []ResolvedFabricatedComponent `json:"fabricatedComponents"`
	BOMItems                []AssemblyBOMItem             `json:"bomItems"`
}

// Domain Errors

type ErrAssemblyVariantNotFound struct {
	VariantSetID      string
	RequestedSpaceMm  float64
	RequiredClearance float64
	AvailableNominals []float64
}

func (e *ErrAssemblyVariantNotFound) Error() string {
	return fmt.Sprintf(
		"assembly variant not found for variantSetId '%s': requested space %.1fmm (clearance %.1fmm) cannot accommodate available nominals %v",
		e.VariantSetID, e.RequestedSpaceMm, e.RequiredClearance, e.AvailableNominals,
	)
}

// Math and Geometry Helpers

// DeriveHardwareBasisFromEuler converts arbitrary finite Euler angles in degrees (X, Y, Z order)
// into an orthonormal right-handed basis with det = +1.0 (R2).
func DeriveHardwareBasisFromEuler(rot HardwareRotationDeg) (HardwareBasis, error) {
	for _, angle := range []float64{rot.X, rot.Y, rot.Z} {
		if math.IsNaN(angle) || math.IsInf(angle, 0) {
			return HardwareBasis{}, errors.New("rotation angles must be finite")
		}
	}

	radX := rot.X * math.Pi / 180.0
	radY := rot.Y * math.Pi / 180.0
	radZ := rot.Z * math.Pi / 180.0

	cx, sx := math.Cos(radX), math.Sin(radX)
	cy, sy := math.Cos(radY), math.Sin(radY)
	cz, sz := math.Cos(radZ), math.Sin(radZ)

	basis := HardwareBasis{
		X: [3]float64{cz * cy, sz * cy, -sy},
		Y: [3]float64{cz*sy*sx - sz*cx, sz*sy*sx + cz*cx, cy * sx},
		Z: [3]float64{cz*sy*cx + sz*sx, sz*sy*cx - cz*sx, cy * cx},
	}

	cleanVec := func(v [3]float64) [3]float64 {
		for i := 0; i < 3; i++ {
			if math.Abs(v[i]) < 1e-12 {
				v[i] = 0.0
			} else if math.Abs(v[i]-1.0) < 1e-12 {
				v[i] = 1.0
			} else if math.Abs(v[i]+1.0) < 1e-12 {
				v[i] = -1.0
			}
		}
		return v
	}

	basis.X = cleanVec(basis.X)
	basis.Y = cleanVec(basis.Y)
	basis.Z = cleanVec(basis.Z)

	if err := ValidateHardwareBasis(basis, "derivedEulerBasis"); err != nil {
		return HardwareBasis{}, err
	}
	return basis, nil
}

// Validation Functions

// ValidateRigidMemberSource enforces strict discriminated union exclusivity.
func ValidateRigidMemberSource(s RigidMemberSource) error {
	switch s.Kind {
	case RigidMemberSourceFixed:
		if s.Fixed == nil || strings.TrimSpace(s.Fixed.HardwareID) == "" {
			return errors.New("fixed source requires non-empty hardwareId")
		}
		if s.Variant != nil {
			return errors.New("fixed source must not contain variant payload")
		}
	case RigidMemberSourceVariant:
		if s.Variant == nil || strings.TrimSpace(s.Variant.VariantSetID) == "" {
			return errors.New("variant source requires non-empty variantSetId")
		}
		if s.Fixed != nil {
			return errors.New("variant source must not contain fixed payload")
		}
	default:
		return fmt.Errorf("invalid rigid member source kind: '%s'", s.Kind)
	}
	return nil
}

// ValidateAxisPlacement verifies axis reference and finite offset.
func ValidateAxisPlacement(axisName string, p AssemblyAxisPlacement) error {
	switch p.Ref {
	case AxisRefMin, AxisRefMax, AxisRefCenter:
		// valid
	default:
		return fmt.Errorf("axis %s has invalid reference '%s' (expected min, max, or center)", axisName, p.Ref)
	}
	if math.IsNaN(p.OffsetMm) || math.IsInf(p.OffsetMm, 0) || math.Abs(p.OffsetMm) > 100000.0 {
		return fmt.Errorf("axis %s has non-finite or out-of-bounds offsetMm: %g", axisName, p.OffsetMm)
	}
	return nil
}

// ValidateAssemblyAnchorRule validates placement references and rigid rotation.
func ValidateAssemblyAnchorRule(r AssemblyAnchorRule) error {
	if err := ValidateAxisPlacement("x", r.X); err != nil {
		return err
	}
	if err := ValidateAxisPlacement("y", r.Y); err != nil {
		return err
	}
	if err := ValidateAxisPlacement("z", r.Z); err != nil {
		return err
	}
	if r.RotationDeg != nil {
		for _, angle := range []float64{r.RotationDeg.X, r.RotationDeg.Y, r.RotationDeg.Z} {
			if math.IsNaN(angle) || math.IsInf(angle, 0) {
				return errors.New("rotationDeg angles must be finite")
			}
		}
		basis, err := DeriveHardwareBasisFromEuler(*r.RotationDeg)
		if err != nil {
			return fmt.Errorf("invalid anchor rotation: %w", err)
		}
		if err := ValidateHardwareBasis(basis, "anchorRule.rotation"); err != nil {
			return fmt.Errorf("invalid rotation basis: %w", err)
		}
	}
	return nil
}

// ValidateAgregadoRigidMember validates an individual rigid member definition against kit policy.
func ValidateAgregadoRigidMember(m AgregadoRigidMember, hasCommercialKit bool) error {
	if strings.TrimSpace(m.MemberID) == "" {
		return errors.New("rigid member must have a non-empty memberId")
	}
	if strings.TrimSpace(m.Role) == "" {
		return fmt.Errorf("rigid member '%s' must have a non-empty role", m.MemberID)
	}
	if err := ValidateRigidMemberSource(m.Source); err != nil {
		return fmt.Errorf("rigid member '%s': %w", m.MemberID, err)
	}
	if err := ValidateAssemblyAnchorRule(m.Placement); err != nil {
		return fmt.Errorf("rigid member '%s': %w", m.MemberID, err)
	}

	switch m.BOMRole {
	case BOMRoleIncludedInKit:
		if !hasCommercialKit {
			return fmt.Errorf("rigid member '%s': bomRole 'included_in_kit' is invalid when no commercialKitHardwareId is configured", m.MemberID)
		}
	case BOMRoleSeparatelyPurchased, BOMRoleNonPurchasing:
		// Always valid
	default:
		return fmt.Errorf("rigid member '%s': invalid bomRole '%s'", m.MemberID, m.BOMRole)
	}

	return nil
}

// ValidateAgregadoVariantSet validates variant set consistency.
func ValidateAgregadoVariantSet(vs AgregadoVariantSet) error {
	if strings.TrimSpace(vs.ID) == "" {
		return errors.New("variant set must have a non-empty id")
	}
	switch vs.Dimension {
	case "depth", "height", "width":
		// valid
	default:
		return fmt.Errorf("variant set '%s' has invalid dimension '%s' (expected depth, height, or width)", vs.ID, vs.Dimension)
	}
	if len(vs.Variants) == 0 {
		return fmt.Errorf("variant set '%s' must define at least one ProductVariant", vs.ID)
	}
	seenNominals := make(map[float64]bool)
	for i, v := range vs.Variants {
		if math.IsNaN(v.NominalDimensionMm) || math.IsInf(v.NominalDimensionMm, 0) || v.NominalDimensionMm <= 0 {
			return fmt.Errorf("variant set '%s' variant %d: nominalDimensionMm must be finite and positive", vs.ID, i)
		}
		if seenNominals[v.NominalDimensionMm] {
			return fmt.Errorf("variant set '%s' has duplicate nominalDimensionMm: %g", vs.ID, v.NominalDimensionMm)
		}
		seenNominals[v.NominalDimensionMm] = true
		if strings.TrimSpace(v.HardwareID) == "" {
			return fmt.Errorf("variant set '%s' variant %d: hardwareId must be non-empty", vs.ID, i)
		}
	}
	return nil
}

// ValidateDimensionRule validates declarative dimension calculation rules.
func ValidateDimensionRule(axisName string, rule AssemblyDimensionRule, validVariantSets map[string]bool) error {
	switch rule.Source {
	case DimRuleAssemblyWidth, DimRuleAssemblyDepth, DimRuleAssemblyHeight:
		// Valid
	case DimRuleSelectedVariant:
		if strings.TrimSpace(rule.VariantSetID) == "" {
			return fmt.Errorf("%s dimension rule with 'selected_variant' requires non-empty variantSetId", axisName)
		}
		if validVariantSets != nil && !validVariantSets[rule.VariantSetID] {
			return fmt.Errorf("%s dimension rule references non-existent variantSetId '%s'", axisName, rule.VariantSetID)
		}
	default:
		return fmt.Errorf("%s dimension rule has invalid source '%s'", axisName, rule.Source)
	}

	if rule.Multiplier != nil {
		if math.IsNaN(*rule.Multiplier) || math.IsInf(*rule.Multiplier, 0) {
			return fmt.Errorf("%s dimension rule has non-finite multiplier: %g", axisName, *rule.Multiplier)
		}
	}
	if math.IsNaN(rule.OffsetMm) || math.IsInf(rule.OffsetMm, 0) || math.Abs(rule.OffsetMm) > 100000.0 {
		return fmt.Errorf("%s dimension rule has non-finite or out-of-bounds offsetMm: %g", axisName, rule.OffsetMm)
	}
	return nil
}

// ValidateAgregadoAssemblyDefinition performs comprehensive validation of an entire assembly recipe.
// Fails closed if any identifier is duplicate, missing, referencing non-existent sets, ambiguous, or non-finite.
func ValidateAgregadoAssemblyDefinition(agregado Agregado) error {
	if strings.TrimSpace(agregado.ID) == "" {
		return errors.New("agregado must have a non-empty id")
	}

	hasKit := agregado.CommercialKitHardwareID != nil && strings.TrimSpace(*agregado.CommercialKitHardwareID) != ""
	if agregado.CommercialKitHardwareID != nil && strings.TrimSpace(*agregado.CommercialKitHardwareID) == "" {
		return errors.New("commercialKitHardwareId cannot be empty or whitespace")
	}

	// 1. Validate VariantSets & detect duplicates
	seenVariantSets := make(map[string]bool)
	for _, vs := range agregado.VariantSets {
		if seenVariantSets[vs.ID] {
			return fmt.Errorf("duplicate variantSetId '%s' in assembly definition", vs.ID)
		}
		seenVariantSets[vs.ID] = true
		if err := ValidateAgregadoVariantSet(vs); err != nil {
			return err
		}
	}

	// 2. Validate CompatibilityRules
	seenRuleSets := make(map[string]bool)
	for _, rule := range agregado.CompatibilityRules {
		if strings.TrimSpace(rule.VariantSetID) == "" {
			return errors.New("compatibility rule requires non-empty variantSetId")
		}
		if !seenVariantSets[rule.VariantSetID] {
			return fmt.Errorf("compatibility rule references non-existent variantSetId '%s'", rule.VariantSetID)
		}
		if seenRuleSets[rule.VariantSetID] {
			return fmt.Errorf("multiple ambiguous compatibility rules for variantSetId '%s'", rule.VariantSetID)
		}
		seenRuleSets[rule.VariantSetID] = true
		if math.IsNaN(rule.ClearanceMm) || math.IsInf(rule.ClearanceMm, 0) || rule.ClearanceMm < 0 {
			return fmt.Errorf("compatibility rule for '%s' has non-finite or negative clearance: %g", rule.VariantSetID, rule.ClearanceMm)
		}
		switch rule.SelectionStrategy {
		case "max_fitting", "exact":
			// Valid
		default:
			return fmt.Errorf("compatibility rule for '%s' has invalid selectionStrategy '%s'", rule.VariantSetID, rule.SelectionStrategy)
		}
	}

	// 3. Validate Rigid Member IDs & definitions
	seenMemberIDs := make(map[string]bool)
	for _, m := range agregado.RigidMembers {
		if seenMemberIDs[m.MemberID] {
			return fmt.Errorf("duplicate memberId '%s' in assembly definition", m.MemberID)
		}
		seenMemberIDs[m.MemberID] = true
		if err := ValidateAgregadoRigidMember(m, hasKit); err != nil {
			return err
		}
		if m.Source.Kind == RigidMemberSourceVariant {
			if !seenVariantSets[m.Source.Variant.VariantSetID] {
				return fmt.Errorf("rigid member '%s' references non-existent variantSetId '%s'", m.MemberID, m.Source.Variant.VariantSetID)
			}
		}
	}

	// 4. Validate Components (Fabricated board members authority - R8)
	for i, c := range agregado.Components {
		if strings.TrimSpace(c.ComponentID) == "" {
			return fmt.Errorf("component index %d must have non-empty componentId", i)
		}
		if c.Quantity <= 0 {
			return fmt.Errorf("component '%s' index %d must have positive quantity", c.ComponentID, i)
		}
		if c.Overrides != nil {
			if c.Overrides.LengthRule != nil {
				if err := ValidateDimensionRule("lengthRule", *c.Overrides.LengthRule, seenVariantSets); err != nil {
					return fmt.Errorf("component '%s': %w", c.ComponentID, err)
				}
			}
			if c.Overrides.WidthRule != nil {
				if err := ValidateDimensionRule("widthRule", *c.Overrides.WidthRule, seenVariantSets); err != nil {
					return fmt.Errorf("component '%s': %w", c.ComponentID, err)
				}
			}
			if c.Overrides.PlacementRule != nil {
				if err := ValidateAssemblyAnchorRule(*c.Overrides.PlacementRule); err != nil {
					return fmt.Errorf("component '%s': %w", c.ComponentID, err)
				}
			}
		}
	}

	return nil
}
