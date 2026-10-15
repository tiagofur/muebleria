package domain

import (
	"fmt"
	"strings"
	"time"
)

// OpeningProfile (#1130, épica #1128 / ADR-0009): the physical grip profile
// (gola L/C, REACH…) as a library-release catalog entity. It declares WHAT
// the system physically is — datasheet-backed geometry, body modifiers by
// constructive role, BOM members as references — never how a layout resolves
// (that is the resolver's, #1131). Within a release the entity is immutable
// except through optimistic-concurrency writes; historical designs resolve
// against the release they pinned, never "latest".
//
// Fail-closed authoring: the entity may exist with a pending datasheet, but
// it is not authorable until every required geometry value exists WITH its
// auditable origin. Missing values are a blocked state, never defaults.
type OpeningProfile struct {
	ID             string `json:"id"`
	OrganizationID string `json:"organization_id"`
	Code           string `json:"code"`
	Name           string `json:"name"`
	// Manufacturer (#1329) names who makes the physical profile (e.g. SCILM)
	// so two gola L of different makers are distinguishable in the picker.
	// Informational only: the code stays the identity and the auditable
	// geometry origin stays GeometryOrigin.
	Manufacturer         string   `json:"manufacturer,omitempty"`
	GripType             string   `json:"grip_type"`
	CrossSectionShape    string   `json:"cross_section_shape,omitempty"`
	CompatiblePlacements []string `json:"compatible_placements"`
	// Datasheet-backed geometry. nil = not provided yet (blocked authoring).
	FrontReductionMm *int `json:"front_reduction_mm,omitempty"`
	GripClearanceMm  *int `json:"grip_clearance_mm,omitempty"`
	// #1283 / §13.2: decimal datasheet values (8006: 56.5 tall × 27.2 deep,
	// SCILM 2022-04-01 p. 42). HeightMm is the vertical drop from the
	// mounting reference; DepthMm is the under-top flange reach toward the
	// back. REAL columns since 000161 — rounding the datasheet into ints
	// would be the silent invention the contract forbids.
	ProfileHeightMm *float64 `json:"profile_height_mm,omitempty"`
	ProfileDepthMm  *float64 `json:"profile_depth_mm,omitempty"`
	// #1316: the workshop-facing DOOR DISCOUNT as ONE number (30–40 mm for
	// the metal gola per the owner). Nil = the profile resolves the legacy
	// datasheet pair (FrontReductionMm + GripClearanceMm); present = it wins
	// over the pair, which stays as documentation. Editing it creates a new
	// version — pinned designs keep their frozen arithmetic.
	DoorReductionMm *int `json:"door_reduction_mm,omitempty"`
	// Auditable origin of the geometry values (supplier datasheet reference).
	// Required when DatasheetStatus is "verified".
	GeometryOrigin  string                      `json:"geometry_origin,omitempty"`
	DatasheetStatus string                      `json:"datasheet_status"`
	BodyModifiers   []OpeningBodyModifier       `json:"body_modifiers,omitempty"`
	BOMMembers      map[string]OpeningBOMMember `json:"bom_members,omitempty"`
	Active          bool                        `json:"active"`
	Version         int64                       `json:"version"`
	CreatedAt       time.Time                   `json:"created_at"`
	UpdatedAt       time.Time                   `json:"updated_at"`
}

// OpeningBodyModifier declares (data, not logic) how the profile modifies a
// body component addressed by constructive role — never by name (#1052).
// #1292 / §13.3: the notch is the profile's own section passage (8006:
// 56.5 × 27.2) — decimal by datasheet, so REAL/float64, never truncated.
type OpeningBodyModifier struct {
	Role string `json:"role"`
	// Effect names the declared effect explicitly; it is the channel for a
	// depth_reduction WITHOUT an explicit value (#1317): the value then
	// derives from the profile's own profile_depth_mm. Additive on the JSONB
	// slice — rows authored before #1317 decode with it empty.
	Effect           string   `json:"effect,omitempty"`
	DepthReductionMm *int     `json:"depth_reduction_mm,omitempty"`
	NotchHeightMm    *float64 `json:"notch_height_mm,omitempty"`
	NotchDepthMm     *float64 `json:"notch_depth_mm,omitempty"`
	NotchAt          string   `json:"notch_at,omitempty"`
	// #1327 slice 3: the italian gola's declared 45° door bevel — the wedge
	// cut at the door's boundary edge so the strip forms the grip. BevelAt
	// names the door edge (top_front | bottom_front); v1 resolves only a
	// 45° angle. Additive on the JSONB slice — rows authored before #1327
	// decode with these empty.
	BevelAngleDeg *float64 `json:"bevel_angle_deg,omitempty"`
	BevelSizeMm   *float64 `json:"bevel_size_mm,omitempty"`
	BevelAt       string   `json:"bevel_at,omitempty"`
}

// OpeningBOMMember is a BOM reference/rule (exact SKU + length rule), never a
// second BOM resolver.
type OpeningBOMMember struct {
	HardwareID string `json:"hardware_id"`
	// #1327: the CATALOG COMPONENT reference — a panel (e.g. the italian gola
	// strip, a real board that travels to the despiece) the profile places as
	// its gola element INSTEAD of a hardware SKU. Empty for hardware members;
	// exactly one reference per member.
	ComponentID string `json:"component_id,omitempty"`
	Rule        string `json:"rule"`
	Unit        string `json:"unit,omitempty"`
	SpacingMm   *int   `json:"spacing_mm,omitempty"`
	// DimensionsMm is the accessory's declared physical envelope
	// [length-along-run, depth, height] from the same verified datasheet as
	// the profile (#1283 / §13.1: herrajes conservan dimensiones aunque sean
	// de solo lectura). It pins the layout render box; nil = the member does
	// not declare geometry and the layout places nothing for it (fail-closed,
	// never an engine default).
	DimensionsMm *[3]float64 `json:"dimensions_mm,omitempty"`
}

var (
	OpeningGripTypes         = []string{"gola", "handle", "bottom_reveal", "none"}
	OpeningCrossSections     = []string{"L", "C", "J", "flat"}
	OpeningProfilePlacements = []string{"top", "between", "bottom"}
)

// AuthoringReady reports whether the profile may participate in authoring:
// a verified datasheet with every required geometry value present AND its
// auditable origin. Anything less is a blocked state (the contract's
// OPENING_PROFILE_DATASHEET_PENDING keeps real authoring out).
func (p *OpeningProfile) AuthoringReady() bool {
	if p == nil || p.DatasheetStatus != "verified" {
		return false
	}
	// #1316: the effective discount is the declared door number or the
	// legacy datasheet pair.
	discount := p.DoorReductionMm != nil ||
		(p.FrontReductionMm != nil && p.GripClearanceMm != nil)
	return discount &&
		p.ProfileHeightMm != nil && p.ProfileDepthMm != nil &&
		strings.TrimSpace(p.GeometryOrigin) != ""
}

// AuthoringBlocker names the explicit reason a profile is not authorable
// (workshop-facing, empty when ready).
func (p *OpeningProfile) AuthoringBlocker() string {
	if p.AuthoringReady() {
		return ""
	}
	if p.DatasheetStatus != "verified" {
		return "falta la ficha técnica verificada del proveedor (OQ-2)"
	}
	for missing, value := range map[string]*int{
		"front_reduction_mm": p.FrontReductionMm,
		"grip_clearance_mm":  p.GripClearanceMm,
	} {
		if value == nil {
			return fmt.Sprintf("falta el parámetro de ficha %s", missing)
		}
	}
	for missing, value := range map[string]*float64{
		"profile_height_mm": p.ProfileHeightMm,
		"profile_depth_mm":  p.ProfileDepthMm,
	} {
		if value == nil {
			return fmt.Sprintf("falta el parámetro de ficha %s", missing)
		}
	}
	if strings.TrimSpace(p.GeometryOrigin) == "" {
		return "los valores de ficha sin origen auditable no son utilizables"
	}
	return "perfil no apto para authoring"
}

// ValidateOpeningProfile enforces the write-time shape: identity, known
// enums, placement vocabulary, and the verified-implies-complete rule (a
// profile cannot claim a verified datasheet with missing geometry or missing
// origin — that state would silently pass the pending gate).
func ValidateOpeningProfile(p OpeningProfile) error {
	if strings.TrimSpace(p.Code) == "" {
		return fmt.Errorf("el código del perfil de apertura es obligatorio")
	}
	if strings.TrimSpace(p.Name) == "" {
		return fmt.Errorf("el nombre del perfil de apertura es obligatorio")
	}
	// #1329: informational identity, never required — but bounded so the
	// picker line stays readable.
	if len([]rune(p.Manufacturer)) > 120 {
		return fmt.Errorf("el fabricante del perfil debe tener como máximo 120 caracteres")
	}
	if !containsString(OpeningGripTypes, p.GripType) {
		return fmt.Errorf("el tipo de grip %q no es válido", p.GripType)
	}
	if p.GripType == "gola" && !containsString(OpeningCrossSections, p.CrossSectionShape) {
		return fmt.Errorf("el perfil gola declara una sección desconocida (%q)", p.CrossSectionShape)
	}
	if len(p.CompatiblePlacements) == 0 {
		return fmt.Errorf("el perfil debe declarar al menos una placement compatible")
	}
	for _, placement := range p.CompatiblePlacements {
		if !containsString(OpeningProfilePlacements, placement) {
			return fmt.Errorf("la placement %q no es válida para un perfil de apertura", placement)
		}
	}
	if p.DatasheetStatus != "pending" && p.DatasheetStatus != "verified" {
		return fmt.Errorf("el estado de ficha %q no es válido", p.DatasheetStatus)
	}
	if p.DatasheetStatus == "verified" {
		// #1316: the workshop-facing requirement is the ENVELOPE (height,
		// depth, origin) plus an EFFECTIVE door discount — the declared
		// single number, or the legacy datasheet pair as documentation.
		if p.ProfileHeightMm == nil || p.ProfileDepthMm == nil {
			return fmt.Errorf("un perfil con ficha verificada requiere el alto y la profundidad del perfil")
		}
		if p.DoorReductionMm == nil && (p.FrontReductionMm == nil || p.GripClearanceMm == nil) {
			return fmt.Errorf("un perfil con ficha verificada exige un descuento de puerta (o el par de ficha frontal + holgura)")
		}
		if strings.TrimSpace(p.GeometryOrigin) == "" {
			return fmt.Errorf("un perfil con ficha verificada requiere el origen auditable de sus valores")
		}
	}
	// #1316: the workshop-facing door discount is a positive measure — the
	// UI scopes 30–40 for the metal gola, the contract only refuses nonsense.
	if p.DoorReductionMm != nil && *p.DoorReductionMm <= 0 {
		return fmt.Errorf("el descuento de puerta debe ser mayor a 0")
	}
	// #1327: a member references exactly ONE thing — a hardware SKU or a
	// catalog component, never both.
	for key, member := range p.BOMMembers {
		if member.HardwareID != "" && member.ComponentID != "" {
			return fmt.Errorf("el miembro %q no puede referenciar herraje y componente a la vez", key)
		}
	}
	return nil
}

func containsString(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}
