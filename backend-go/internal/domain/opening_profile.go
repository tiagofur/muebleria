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
	ID                   string   `json:"id"`
	OrganizationID       string   `json:"organization_id"`
	Code                 string   `json:"code"`
	Name                 string   `json:"name"`
	GripType             string   `json:"grip_type"`
	CrossSectionShape    string   `json:"cross_section_shape,omitempty"`
	CompatiblePlacements []string `json:"compatible_placements"`
	// Datasheet-backed geometry. nil = not provided yet (blocked authoring).
	FrontReductionMm *int `json:"front_reduction_mm,omitempty"`
	GripClearanceMm  *int `json:"grip_clearance_mm,omitempty"`
	ProfileHeightMm  *int `json:"profile_height_mm,omitempty"`
	ProfileDepthMm   *int `json:"profile_depth_mm,omitempty"`
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
type OpeningBodyModifier struct {
	Role             string `json:"role"`
	DepthReductionMm *int   `json:"depth_reduction_mm,omitempty"`
	NotchHeightMm    *int   `json:"notch_height_mm,omitempty"`
	NotchDepthMm     *int   `json:"notch_depth_mm,omitempty"`
	NotchAt          string `json:"notch_at,omitempty"`
}

// OpeningBOMMember is a BOM reference/rule (exact SKU + length rule), never a
// second BOM resolver.
type OpeningBOMMember struct {
	HardwareID string `json:"hardware_id"`
	Rule       string `json:"rule"`
	Unit       string `json:"unit,omitempty"`
	SpacingMm  *int   `json:"spacing_mm,omitempty"`
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
	return p.FrontReductionMm != nil && p.GripClearanceMm != nil &&
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
		"profile_height_mm":  p.ProfileHeightMm,
		"profile_depth_mm":   p.ProfileDepthMm,
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
		if p.FrontReductionMm == nil || p.GripClearanceMm == nil || p.ProfileHeightMm == nil || p.ProfileDepthMm == nil {
			return fmt.Errorf("un perfil con ficha verificada requiere los cuatro parámetros geométricos")
		}
		if strings.TrimSpace(p.GeometryOrigin) == "" {
			return fmt.Errorf("un perfil con ficha verificada requiere el origen auditable de sus valores")
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
