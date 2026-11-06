package domain

// Grip styles (#1531, ADR-0009 Amendment 1 A2.2/A4): a workshop's named
// grip recipe per furniture type. Consumed by the grip style API/storage, by
// the opening-capabilities projection that replaced the overlay blobs, and
// later by the project grip (#1532).

import (
	"fmt"
	"math"
	"strings"
	"time"
)

const (
	GripModeHandle         = "handle"
	GripModeGola           = "gola"
	GripModeBottomOverhang = "bottom_overhang"

	// DefaultGripOverhangMm is the owner's default overhang (A4).
	DefaultGripOverhangMm = 20
)

// GripStyleFurnitureTypes are the furniture types a style covers. Every
// style declares all of them, so a furniture never resolves without a grip.
var GripStyleFurnitureTypes = []string{"inferior", "superior", "alto"}

// GripStyleRecipe is the grip of one furniture type.
type GripStyleRecipe struct {
	Mode string `json:"mode"`
	// HandleHardwareID is the handle hardware for mode handle; nil = the
	// furniture keeps the handle its catalog options choose.
	HandleHardwareID *string `json:"handleHardwareId,omitempty"`
	TopProfileID     string  `json:"topProfileId,omitempty"`
	BetweenProfileID string  `json:"betweenProfileId,omitempty"`
	// OverhangMm is decoded as a number so a decimal is rejected with 422
	// instead of a decode error; stored values are whole millimetres.
	OverhangMm *float64 `json:"overhangMm,omitempty"`
}

// GripStyle is one workshop style.
type GripStyle struct {
	ID              string                     `json:"id"`
	OrganizationID  string                     `json:"organizationId"`
	Name            string                     `json:"name"`
	Offered         bool                       `json:"offered"`
	IsDefault       bool                       `json:"isDefault"`
	ByFurnitureType map[string]GripStyleRecipe `json:"byFurnitureType"`
	// MigrationReport is the per-row report of migration 000181 (read-only).
	MigrationReport map[string]any `json:"migrationReport,omitempty"`
	Version         int64          `json:"version"`
	CreatedAt       time.Time      `json:"createdAt"`
	UpdatedAt       time.Time      `json:"updatedAt"`
}

// GripStyleValidationError is a rejected write (the API answers 422).
type GripStyleValidationError struct{ Message string }

func (e *GripStyleValidationError) Error() string { return e.Message }

func invalidGripStyle(format string, args ...any) error {
	return &GripStyleValidationError{Message: fmt.Sprintf(format, args...)}
}

var gripFurnitureTypeLabels = map[string]string{
	"inferior": "muebles bajos",
	"superior": "alacenas",
	"alto":     "muebles altos",
}

// NormalizeGripStyle trims the name and fills the A4 default overhang.
func NormalizeGripStyle(style *GripStyle) {
	style.Name = strings.TrimSpace(style.Name)
	for ftype, recipe := range style.ByFurnitureType {
		if recipe.Mode == GripModeBottomOverhang && recipe.OverhangMm == nil {
			value := float64(DefaultGripOverhangMm)
			recipe.OverhangMm = &value
		}
		if recipe.HandleHardwareID != nil && strings.TrimSpace(*recipe.HandleHardwareID) == "" {
			recipe.HandleHardwareID = nil
		}
		style.ByFurnitureType[ftype] = recipe
	}
	style.MigrationReport = nil
}

// ValidateGripStyleShape checks everything that needs no catalog lookup.
// Profile usability and hardware existence are checked by the store.
func ValidateGripStyleShape(style GripStyle) error {
	if style.Name == "" {
		return invalidGripStyle("el nombre del estilo es obligatorio")
	}
	if len([]rune(style.Name)) > 120 {
		return invalidGripStyle("el nombre del estilo debe tener como máximo 120 caracteres")
	}
	if style.IsDefault && !style.Offered {
		return invalidGripStyle("el estilo predeterminado tiene que estar ofrecido")
	}
	for ftype := range style.ByFurnitureType {
		if !containsString(GripStyleFurnitureTypes, ftype) {
			return invalidGripStyle("el tipo de mueble %q no existe: usa inferior, superior o alto", ftype)
		}
	}
	for _, ftype := range GripStyleFurnitureTypes {
		recipe, ok := style.ByFurnitureType[ftype]
		label := gripFurnitureTypeLabels[ftype]
		if !ok {
			return invalidGripStyle("falta el agarre de %s", label)
		}
		switch recipe.Mode {
		case GripModeHandle:
			if recipe.TopProfileID != "" || recipe.BetweenProfileID != "" || recipe.OverhangMm != nil {
				return invalidGripStyle("el agarre con jaladera de %s no lleva perfiles ni rebase", label)
			}
		case GripModeGola:
			if strings.TrimSpace(recipe.TopProfileID) == "" {
				return invalidGripStyle("la gola de %s necesita el perfil de arriba", label)
			}
			if recipe.HandleHardwareID != nil || recipe.OverhangMm != nil {
				return invalidGripStyle("la gola de %s no lleva jaladera ni rebase", label)
			}
		case GripModeBottomOverhang:
			if recipe.OverhangMm == nil {
				return invalidGripStyle("el rebase de %s necesita los milímetros", label)
			}
			value := *recipe.OverhangMm
			if value <= 0 || value != math.Trunc(value) || math.IsInf(value, 0) {
				return invalidGripStyle("el rebase de %s debe ser un número entero de milímetros mayor a 0", label)
			}
			if recipe.HandleHardwareID != nil || recipe.TopProfileID != "" || recipe.BetweenProfileID != "" {
				return invalidGripStyle("el rebase de %s no lleva jaladera ni perfiles", label)
			}
		default:
			return invalidGripStyle("el modo de agarre %q de %s no existe: usa handle, gola o bottom_overhang", recipe.Mode, label)
		}
	}
	return nil
}

// ValidateGripStyleProfiles checks that every referenced gola profile is
// active and usable at its position (the #1530 use rule). lookup returns
// nil when the profile does not exist in the organization.
func ValidateGripStyleProfiles(style GripStyle, lookup func(id string) *OpeningProfile) error {
	for _, ftype := range GripStyleFurnitureTypes {
		recipe := style.ByFurnitureType[ftype]
		if recipe.Mode != GripModeGola {
			continue
		}
		label := gripFurnitureTypeLabels[ftype]
		checks := []struct{ id, position, name string }{{recipe.TopProfileID, GolaPositionTop, "de arriba"}}
		if recipe.BetweenProfileID != "" {
			checks = append(checks, struct{ id, position, name string }{recipe.BetweenProfileID, GolaPositionBetween, "entre frentes"})
		}
		for _, check := range checks {
			profile := lookup(check.id)
			if profile == nil {
				return invalidGripStyle("el perfil %s de %s no existe en el catálogo", check.name, label)
			}
			if err := profile.UsageError(check.position); err != nil {
				return invalidGripStyle("el perfil %s de %s (%s) no se puede usar: %s", check.name, label, profile.Code, err.Error())
			}
		}
	}
	return nil
}

// OverhangMmFor returns the style's whole-millimetre overhang for a
// furniture type, or nil when that type does not use an overhang.
func (style GripStyle) OverhangMmFor(ftype string) *int {
	recipe, ok := style.ByFurnitureType[ftype]
	if !ok || recipe.Mode != GripModeBottomOverhang || recipe.OverhangMm == nil {
		return nil
	}
	value := int(*recipe.OverhangMm)
	return &value
}
