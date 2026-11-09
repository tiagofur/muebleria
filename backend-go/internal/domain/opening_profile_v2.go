package domain

// Gola profile v2 (#1530, ADR-0009 Amendment 1 A2.1, opening-front-system.md
// §14.2/§14.6): material, positions, the workshop's front discount per
// position, fixed part roles and the per-position use rule. Consumed by the
// opening profile API (storage + handlers) and, later, by grip styles (#1531),
// the project grip (#1532) and the engine (#1529).

import (
	"errors"
	"fmt"
	"strings"
)

const (
	GolaMaterialAluminum = "aluminum"
	GolaMaterialMelamine = "melamine"

	GolaPositionTop     = "top"
	GolaPositionBetween = "between"

	GolaRoleProfile  = "profile"
	GolaRoleSupports = "supports"
	GolaRoleEndCaps  = "endCaps"
	GolaRoleStrip    = "strip"

	// NotchDepthFromStripThickness: the notch depth is the resolved thickness
	// of the fronts' material (§14.6), never a typed constant.
	NotchDepthFromStripThickness = "strip_thickness"
)

var (
	GolaMaterials = []string{GolaMaterialAluminum, GolaMaterialMelamine}
	GolaPositions = []string{GolaPositionTop, GolaPositionBetween}
	// GolaHardwareRoles accept only hardware; GolaRoleStrip accepts only a
	// panel component. Any other key is rejected (422).
	GolaHardwareRoles = []string{GolaRoleProfile, GolaRoleSupports, GolaRoleEndCaps}
)

// OpeningProfileValidationError is a rejected write (the API answers 422).
type OpeningProfileValidationError struct{ Message string }

func (e *OpeningProfileValidationError) Error() string { return e.Message }

func invalidOpeningProfile(format string, args ...any) error {
	return &OpeningProfileValidationError{Message: fmt.Sprintf(format, args...)}
}

// IsOpeningProfileValidationError reports whether err is a rejected write.
func IsOpeningProfileValidationError(err error) bool {
	var target *OpeningProfileValidationError
	return errors.As(err, &target)
}

// OpeningProfilePositionUsage is the server's answer to "can this profile be
// used at this position?". Missing lists the wire names of the absent fields;
// Message is the Spanish explanation shown to the user.
type OpeningProfilePositionUsage struct {
	Usable  bool     `json:"usable"`
	Missing []string `json:"missing"`
	Message string   `json:"message,omitempty"`
}

var golaPositionLabels = map[string]string{
	GolaPositionTop:     "arriba",
	GolaPositionBetween: "entre frentes",
}

// UsageAt applies the v2 use rule (A2.1): the profile is active, declares the
// position, and has its height, depth and the front discount of that
// position. The datasheet status and the geometry origin are data only.
func (p *OpeningProfile) UsageAt(position string) OpeningProfilePositionUsage {
	label, known := golaPositionLabels[position]
	if !known {
		return OpeningProfilePositionUsage{
			Missing: []string{},
			Message: fmt.Sprintf("la posición %q no existe para un perfil de gola", position),
		}
	}
	if p == nil {
		return OpeningProfilePositionUsage{Missing: []string{}, Message: "el perfil no existe"}
	}
	if !p.Active {
		return OpeningProfilePositionUsage{Missing: []string{}, Message: "el perfil está desactivado"}
	}
	if !containsString(p.Positions, position) {
		return OpeningProfilePositionUsage{
			Missing: []string{},
			Message: fmt.Sprintf("el perfil no se declaró para usarse %s", label),
		}
	}
	type requirement struct {
		field   string
		label   string
		present bool
	}
	discount := p.FrontDiscountTopMm
	discountField := "front_discount_top_mm"
	if position == GolaPositionBetween {
		discount = p.FrontDiscountBetweenMm
		discountField = "front_discount_between_mm"
	}
	requirements := []requirement{
		{"profile_height_mm", "el alto del perfil", p.ProfileHeightMm != nil},
		{"profile_depth_mm", "la profundidad del perfil", p.ProfileDepthMm != nil},
		{discountField, "el descuento del frente " + label, discount != nil},
	}
	missing := []string{}
	labels := []string{}
	for _, req := range requirements {
		if !req.present {
			missing = append(missing, req.field)
			labels = append(labels, req.label)
		}
	}
	if len(missing) == 0 {
		return OpeningProfilePositionUsage{Usable: true, Missing: missing}
	}
	return OpeningProfilePositionUsage{
		Missing: missing,
		Message: fmt.Sprintf("Para usar el perfil %s falta %s.", label, joinSpanish(labels)),
	}
}

// UsageError returns nil when the profile can be used at the position, or a
// validation error with the Spanish message naming what is missing.
func (p *OpeningProfile) UsageError(position string) error {
	usage := p.UsageAt(position)
	if usage.Usable {
		return nil
	}
	return &OpeningProfileValidationError{Message: usage.Message}
}

// WithUsage fills the read-only Usage map for every declared position.
func (p *OpeningProfile) WithUsage() {
	if p.Positions == nil {
		p.Positions = []string{}
	}
	p.Usage = map[string]OpeningProfilePositionUsage{}
	for _, position := range p.Positions {
		p.Usage[position] = p.UsageAt(position)
	}
}

func joinSpanish(items []string) string {
	switch len(items) {
	case 0:
		return ""
	case 1:
		return items[0]
	default:
		return strings.Join(items[:len(items)-1], ", ") + " y " + items[len(items)-1]
	}
}

// IsLegacyShapedWrite reports whether a write came from a client that only
// knows the pre-#1530 fields (the #1526 editor). Retired by #1534.
func (p *OpeningProfile) IsLegacyShapedWrite() bool {
	return strings.TrimSpace(p.Material) == ""
}

// NormalizeOpeningProfileWrite keeps the legacy and the v2 fields consistent
// on every write while both are readable (bridge until #1529/#1532/#1534).
// existing is the stored row on update, nil on create.
//
//   - v2-shaped write (material sent): grip_type becomes gola,
//     a change made only to door_reduction_mm (whole-row round trip) moves
//     to front_discount_top_mm,
//     compatible_placements mirrors positions, and door_reduction_mm mirrors
//     front_discount_top_mm, because the engine and the design pin still read
//     door_reduction_mm (#1529).
//   - legacy-shaped write: positions come from compatible_placements ∩
//     {top, between}; front_discount_top_mm from door_reduction_mm or the
//     legacy pair (the 000180 rule); the values the legacy client cannot
//     express (material, between discount, strip height, notch source and
//     clearance) are carried over from the stored row.
func NormalizeOpeningProfileWrite(p *OpeningProfile, existing *OpeningProfile) {
	p.V2Migration = nil
	p.Usage = nil
	if !p.IsLegacyShapedWrite() {
		if strings.TrimSpace(p.GripType) == "" {
			p.GripType = "gola"
		}
		if strings.TrimSpace(p.DatasheetStatus) == "" {
			p.DatasheetStatus = "pending" // informational since #1530
		}
		if p.Material == GolaMaterialMelamine && strings.TrimSpace(p.CrossSectionShape) == "" {
			p.CrossSectionShape = "flat"
		}
		// #1534 — the bridge is SYMMETRIC: a client may declare the positions
		// through either field (the gola editor sends compatible_placements
		// as the #1530 bridge did). Whichever carries the declaration feeds
		// the other, restricted to the v2 positions vocabulary.
		if len(p.Positions) == 0 && len(p.CompatiblePlacements) > 0 {
			for _, position := range GolaPositions {
				if containsString(p.CompatiblePlacements, position) {
					p.Positions = append(p.Positions, position)
				}
			}
		}
		p.CompatiblePlacements = append([]string{}, p.Positions...)
		// A client that round-trips the whole row and edits only the legacy
		// door_reduction_mm meant the top discount: apply it there.
		if existing != nil && !intPtrEqual(p.DoorReductionMm, existing.DoorReductionMm) &&
			intPtrEqual(p.FrontDiscountTopMm, existing.FrontDiscountTopMm) && p.DoorReductionMm != nil {
			p.FrontDiscountTopMm = copyIntPtr(p.DoorReductionMm)
		}
		if containsString(p.Positions, GolaPositionTop) {
			p.DoorReductionMm = copyIntPtr(p.FrontDiscountTopMm)
		} else {
			p.DoorReductionMm = nil
		}
		return
	}

	p.Positions = []string{}
	for _, position := range GolaPositions {
		if containsString(p.CompatiblePlacements, position) {
			p.Positions = append(p.Positions, position)
		}
	}
	p.FrontDiscountTopMm = nil
	if containsString(p.Positions, GolaPositionTop) {
		p.FrontDiscountTopMm = legacyEffectiveDiscount(p)
	}
	p.FrontDiscountBetweenMm = nil
	if existing != nil {
		p.Material = existing.Material
		if containsString(p.Positions, GolaPositionBetween) {
			p.FrontDiscountBetweenMm = copyIntPtr(existing.FrontDiscountBetweenMm)
		}
		carryLegacyUnknownFields(p, existing)
	}
	if p.Material == "" {
		p.Material = GolaMaterialAluminum
		for _, member := range p.BOMMembers {
			if member.ComponentID != "" {
				p.Material = GolaMaterialMelamine
				break
			}
		}
	}
}

// legacyEffectiveDiscount is the single discount the legacy fields declare:
// door_reduction_mm, or the datasheet pair front + clearance (000180 rule).
func legacyEffectiveDiscount(p *OpeningProfile) *int {
	if p.DoorReductionMm != nil {
		return copyIntPtr(p.DoorReductionMm) // ≤ 0 is rejected by validation
	}
	if p.FrontReductionMm != nil && p.GripClearanceMm != nil &&
		*p.FrontReductionMm > 0 && *p.GripClearanceMm >= 0 {
		sum := *p.FrontReductionMm + *p.GripClearanceMm
		return &sum
	}
	return nil
}

func carryLegacyUnknownFields(p *OpeningProfile, existing *OpeningProfile) {
	if strip, ok := p.BOMMembers[GolaRoleStrip]; ok && strip.HeightMm == nil {
		if stored, ok := existing.BOMMembers[GolaRoleStrip]; ok && stored.HeightMm != nil {
			height := *stored.HeightMm
			strip.HeightMm = &height
			p.BOMMembers[GolaRoleStrip] = strip
		}
	}
	for i, modifier := range p.BodyModifiers {
		if modifier.NotchAt == "" && modifier.NotchHeightMm == nil {
			continue
		}
		for _, stored := range existing.BodyModifiers {
			if stored.Role != modifier.Role || stored.NotchAt != modifier.NotchAt {
				continue
			}
			if modifier.NotchClearanceMm == nil && stored.NotchClearanceMm != nil {
				clearance := *stored.NotchClearanceMm
				p.BodyModifiers[i].NotchClearanceMm = &clearance
			}
			if modifier.NotchDepthSource == "" && modifier.NotchDepthMm == nil {
				p.BodyModifiers[i].NotchDepthSource = stored.NotchDepthSource
			}
			break
		}
	}
}

func intPtrEqual(a, b *int) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func copyIntPtr(value *int) *int {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

// validateOpeningProfileV2 enforces the v2 contract on a normalized write.
func validateOpeningProfileV2(p OpeningProfile) error {
	if !containsString(GolaMaterials, p.Material) {
		return invalidOpeningProfile("el material del perfil debe ser aluminio o melamina")
	}
	if p.Material == GolaMaterialAluminum && !containsString([]string{"L", "C", "J"}, p.CrossSectionShape) {
		return invalidOpeningProfile("un perfil de aluminio declara una sección L, C o J")
	}
	if len(p.Positions) == 0 {
		return invalidOpeningProfile("el perfil debe declarar al menos una posición: arriba o entre frentes")
	}
	seen := map[string]bool{}
	for _, position := range p.Positions {
		if !containsString(GolaPositions, position) {
			return invalidOpeningProfile("la posición %q no es válida: usa arriba (top) o entre frentes (between)", position)
		}
		if seen[position] {
			return invalidOpeningProfile("la posición %q está repetida", position)
		}
		seen[position] = true
	}
	if p.FrontDiscountTopMm != nil && *p.FrontDiscountTopMm <= 0 {
		return invalidOpeningProfile("el descuento del frente arriba debe ser mayor a 0")
	}
	if p.FrontDiscountBetweenMm != nil && *p.FrontDiscountBetweenMm <= 0 {
		return invalidOpeningProfile("el descuento del frente entre frentes debe ser mayor a 0")
	}
	if p.ProfileHeightMm != nil && *p.ProfileHeightMm <= 0 {
		return invalidOpeningProfile("el alto del perfil debe ser mayor a 0")
	}
	if p.ProfileDepthMm != nil && *p.ProfileDepthMm <= 0 {
		return invalidOpeningProfile("la profundidad del perfil debe ser mayor a 0")
	}
	if err := validateGolaParts(p); err != nil {
		return err
	}
	return validateGolaBodyEffects(p)
}

var golaRoleLabels = map[string]string{
	GolaRoleProfile:  "Perfil",
	GolaRoleSupports: "Soportes",
	GolaRoleEndCaps:  "Tapas",
	GolaRoleStrip:    "Tira",
}

func validateGolaParts(p OpeningProfile) error {
	for key, member := range p.BOMMembers {
		label, known := golaRoleLabels[key]
		if !known {
			return invalidOpeningProfile("el rol %q no existe: usa profile, supports, endCaps o strip", key)
		}
		hardware := strings.TrimSpace(member.HardwareID)
		component := strings.TrimSpace(member.ComponentID)
		if key == GolaRoleStrip {
			if hardware != "" || component == "" {
				return invalidOpeningProfile("el rol «%s» sólo acepta un componente tablero", label)
			}
			if p.Material != GolaMaterialMelamine {
				return invalidOpeningProfile("la tira sólo se usa en la gola italiana (melamina)")
			}
			if member.HeightMm != nil && *member.HeightMm <= 0 {
				return invalidOpeningProfile("el alto de la tira debe ser mayor a 0")
			}
			continue
		}
		if component != "" || hardware == "" {
			return invalidOpeningProfile("el rol «%s» sólo acepta un herraje", label)
		}
		if member.HeightMm != nil {
			return invalidOpeningProfile("el alto sólo se declara en la tira")
		}
		if member.SpacingMm != nil && *member.SpacingMm <= 0 {
			return invalidOpeningProfile("el espaciado de «%s» debe ser mayor a 0", label)
		}
		if member.DimensionsMm != nil {
			for _, dimension := range member.DimensionsMm {
				if dimension <= 0 {
					return invalidOpeningProfile("las medidas de «%s» deben ser mayores a 0", label)
				}
			}
		}
	}
	return nil
}

func validateGolaBodyEffects(p OpeningProfile) error {
	_, hasStrip := p.BOMMembers[GolaRoleStrip]
	for _, modifier := range p.BodyModifiers {
		switch modifier.NotchDepthSource {
		case "":
		case NotchDepthFromStripThickness:
			if !hasStrip {
				return invalidOpeningProfile("la muesca que sigue el espesor de la tira exige la tira")
			}
			if modifier.NotchDepthMm != nil {
				return invalidOpeningProfile("la muesca toma su profundidad del espesor de la tira; no declares otra")
			}
		default:
			return invalidOpeningProfile("la fuente de profundidad de la muesca %q no es válida", modifier.NotchDepthSource)
		}
		if modifier.NotchClearanceMm != nil && *modifier.NotchClearanceMm < 0 {
			return invalidOpeningProfile("la holgura de la muesca no puede ser negativa")
		}
		if modifier.NotchHeightMm != nil && *modifier.NotchHeightMm <= 0 {
			return invalidOpeningProfile("el alto de la muesca debe ser mayor a 0")
		}
		if modifier.NotchDepthMm != nil && *modifier.NotchDepthMm <= 0 {
			return invalidOpeningProfile("la profundidad de la muesca debe ser mayor a 0")
		}
		if modifier.BevelSizeMm != nil && *modifier.BevelSizeMm <= 0 {
			return invalidOpeningProfile("el tamaño del bisel debe ser mayor a 0")
		}
	}
	return nil
}
