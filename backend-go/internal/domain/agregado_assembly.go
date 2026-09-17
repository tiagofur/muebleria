package domain

import (
	"errors"
	"fmt"
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
	RotationDeg *HardwareRotationDeg  `json:"rotationDeg,omitempty"` // Rigid rotation (multiples of 90 deg: 0, 90, 180, 270)
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

// ResolvedRigidMember is the fully resolved rigid hardware member ready for 3D placement.
type ResolvedRigidMember struct {
	MemberID        string                  `json:"memberId"`
	Role            string                  `json:"role"`
	HardwareID      string                  `json:"hardwareId"`
	AssetID         string                  `json:"assetId"`
	AssetRevisionID string                  `json:"assetRevisionId"`
	SHA256          string                  `json:"sha256"`
	MountFrame      *HardwareMountFrame     `json:"mountFrame,omitempty"`
	LocalTransform  AssemblyMemberTransform `json:"localTransform"` // Rigid placement in Assembly Space (det = +1.0)
	BOMRole         RigidMemberBOMRole      `json:"bomRole"`
}

// AssemblyBOMItem is one purchasing row produced by the assembly.
type AssemblyBOMItem struct {
	HardwareID string  `json:"hardwareId"`
	Quantity   float64 `json:"quantity"`
	Role       string  `json:"role"`
	Notes      string  `json:"notes,omitempty"`
}

// ResolvedFabricatedComponent describes a dimensioned and placed fabricated board.
type ResolvedFabricatedComponent struct {
	ComponentID string                  `json:"componentId"`
	SlotID      string                  `json:"slotId"`
	Name        string                  `json:"name"`
	LengthMm    float64                 `json:"lengthMm"`
	WidthMm     float64                 `json:"widthMm"`
	ThicknessMm float64                 `json:"thicknessMm"`
	Transform   AssemblyMemberTransform `json:"transform"`
}

// ResolvedAssemblySnapshot freezes all resolved state for immutable historical DesignRevisions.
type ResolvedAssemblySnapshot struct {
	AgregadoID              string                        `json:"agregadoId"`
	AgregadoRevisionNumber  int                           `json:"agregadoRevisionNumber"`
	CommercialKitHardwareID *string                       `json:"commercialKitHardwareId,omitempty"`
	ResolvedDimensionsMm    [3]float64                    `json:"resolvedDimensionsMm"`
	SelectedVariants        map[string]float64            `json:"selectedVariants"` // variantSetId -> nominalDimensionMm
	RigidMembers            []ResolvedRigidMember         `json:"rigidMembers"`
	FabricatedComponents    []ResolvedFabricatedComponent `json:"fabricatedComponents"`
	BOMItems                []AssemblyBOMItem             `json:"bomItems"`
}

// Domain Errors
type ErrAssemblyVariantNotFound struct {
	VariantSetID       string
	RequestedSpaceMm   float64
	RequiredClearance float64
	AvailableNominals  []float64
}

func (e *ErrAssemblyVariantNotFound) Error() string {
	return fmt.Sprintf(
		"assembly variant not found for variantSetId '%s': requested space %.1fmm (clearance %.1fmm) cannot accommodate available nominals %v",
		e.VariantSetID, e.RequestedSpaceMm, e.RequiredClearance, e.AvailableNominals,
	)
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

// ValidateAxisPlacement verifies axis reference value.
func ValidateAxisPlacement(axisName string, p AssemblyAxisPlacement) error {
	switch p.Ref {
	case AxisRefMin, AxisRefMax, AxisRefCenter:
		return nil
	default:
		return fmt.Errorf("axis %s has invalid reference '%s' (expected min, max, or center)", axisName, p.Ref)
	}
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
	return nil
}

// ValidateAgregadoRigidMember validates an individual rigid member definition against kit policy.
func ValidateAgregadoRigidMember(m AgregadoRigidMember, hasCommercialKit bool) error {
	if strings.TrimSpace(m.MemberID) == "" {
		return errors.New("rigid member must have a non-empty memberId")
	}
	if strings.TrimSpace(m.Role) == "" {
		return fmt.Errorf("rigid member %s must have a non-empty role", m.MemberID)
	}
	if err := ValidateRigidMemberSource(m.Source); err != nil {
		return fmt.Errorf("rigid member %s: %w", m.MemberID, err)
	}
	if err := ValidateAssemblyAnchorRule(m.Placement); err != nil {
		return fmt.Errorf("rigid member %s: %w", m.MemberID, err)
	}

	switch m.BOMRole {
	case BOMRoleIncludedInKit:
		if !hasCommercialKit {
			return fmt.Errorf("rigid member %s: bomRole 'included_in_kit' is invalid when no commercialKitHardwareId is configured", m.MemberID)
		}
	case BOMRoleSeparatelyPurchased, BOMRoleNonPurchasing:
		// Always valid
	default:
		return fmt.Errorf("rigid member %s: invalid bomRole '%s'", m.MemberID, m.BOMRole)
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
		return fmt.Errorf("variant set %s has invalid dimension '%s' (expected depth, height, or width)", vs.ID, vs.Dimension)
	}
	if len(vs.Variants) == 0 {
		return fmt.Errorf("variant set %s must define at least one ProductVariant", vs.ID)
	}
	for i, v := range vs.Variants {
		if v.NominalDimensionMm <= 0 {
			return fmt.Errorf("variant set %s variant %d: nominalDimensionMm must be positive", vs.ID, i)
		}
		if strings.TrimSpace(v.HardwareID) == "" {
			return fmt.Errorf("variant set %s variant %d: hardwareId must be non-empty", vs.ID, i)
		}
	}
	return nil
}
