package domain

// Project grip (#1532, ADR-0009 Amendment 1 A2.3/A5/A7): the project picks a
// grip style once, and every furniture inherits it; a furniture may carry an
// override. Applying a style (or an override) freezes ONE complete snapshot —
// the style's recipe per furniture type plus the full values of every profile
// it uses — at the moment it is applied (A7). Later workshop edits never
// change an existing project until the explicit «Actualizar a los valores
// actuales del taller», which is audited. Quotes and production releases
// consume the snapshot.
//
// The server resolves the inheritance: a furniture without an override uses
// the project's snapshot. The engine (#1529 A3) consumes the effective
// snapshot's recipe for the furniture's type; it never reads live catalog
// rows through this path.

import (
	"fmt"
	"time"
)

// GripSnapshot is the frozen copy of a style (or of a workshop selection in
// migrated rows): one recipe per furniture type, with every referenced
// profile frozen completely. StyleID is the style it was frozen from — empty
// on a custom snapshot (per-furniture values that are not a workshop style,
// e.g. the rows migrated from DesignOpeningSelection).
type GripSnapshot struct {
	StyleID   string                      `json:"styleId"`
	StyleName string                      `json:"styleName"`
	Recipes   map[string]GripSnapshotRecipe `json:"recipes"`
	FrozenAt  time.Time                   `json:"frozenAt"`
}

// GripSnapshotRecipe is the frozen grip of one furniture type.
type GripSnapshotRecipe struct {
	Mode             string            `json:"mode"` // handle | gola | bottom_overhang
	HandleHardwareID *string           `json:"handleHardwareId,omitempty"`
	TopProfile       *FrozenGripProfile `json:"top,omitempty"`
	BetweenProfile   *FrozenGripProfile `json:"between,omitempty"`
	OverhangMm       *float64          `json:"overhangMm,omitempty"`
}

// FrozenGripProfile is one gola profile frozen completely (A7): the values
// the engine and the quote consume, never a live-catalog join. The v2 fields
// carry the truth; legacy-sourced rows (migrated pins) fill them from the
// pin's own values, and absent legacy fields stay absent — the truthful
// freeze, never an invented default.
type FrozenGripProfile struct {
	ProfileID string `json:"profileId"`
	Code      string `json:"code"`
	Name      string `json:"name"`
	Material  string `json:"material,omitempty"`
	Positions []string `json:"positions"`
	// Datasheet envelope (may be absent on migrated pre-#1283 rows).
	ProfileHeightMm *float64 `json:"profileHeightMm,omitempty"`
	ProfileDepthMm  *float64 `json:"profileDepthMm,omitempty"`
	// The workshop's front discount per position (A3), measured from H.
	FrontDiscountTopMm     *int `json:"frontDiscountTopMm,omitempty"`
	FrontDiscountBetweenMm *int `json:"frontDiscountBetweenMm,omitempty"`
	// CompatiblePlacements mirrors Positions (the #1530 bridge).
	CompatiblePlacements []string `json:"compatiblePlacements"`
	// Declared body effects and BOM members, frozen verbatim. BOMVersion is
	// the profile revision the members were frozen from (the quote's
	// provenance, like the pin's ProfileVersion).
	BodyModifiers []OpeningBodyModifier       `json:"bodyModifiers,omitempty"`
	BOMMembers    map[string]OpeningBOMMember `json:"bomMembers,omitempty"`
	BOMVersion    int64                       `json:"bomVersion"`
}

// GripSnapshotValidationError is a rejected write or an unusable snapshot
// (the API answers 422; the resolve reports the code).
type GripSnapshotValidationError struct {
	Message string
	Code    string
}

func (e *GripSnapshotValidationError) Error() string { return e.Message }

func invalidGripSnapshot(code, format string, args ...any) error {
	return &GripSnapshotValidationError{Code: code, Message: fmt.Sprintf(format, args...)}
}

// IsGripSnapshotValidationError reports whether err is a grip snapshot
// validation error.
func IsGripSnapshotValidationError(err error) bool {
	var target *GripSnapshotValidationError
	return AsGripSnapshotValidation(err, &target)
}

// AsGripSnapshotValidation unwraps err into a GripSnapshotValidationError.
func AsGripSnapshotValidation(err error, target **GripSnapshotValidationError) bool {
	for err != nil {
		if typed, ok := err.(*GripSnapshotValidationError); ok {
			*target = typed
			return true
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}

// ValidateGripSnapshotShape checks everything that needs no catalog lookup:
// the recipe vocabulary per type, and the fields each mode requires. The
// profile VALUES ride frozen — the snapshot never re-checks datasheet status
// (that gate retired with the design selection, #1530 §14.9.1).
func ValidateGripSnapshotShape(snapshot *GripSnapshot) error {
	if snapshot == nil {
		return nil
	}
	for ftype, recipe := range snapshot.Recipes {
		if !containsString(GripStyleFurnitureTypes, ftype) {
			return invalidGripSnapshot("GRIP_TYPE_UNKNOWN", "el tipo de mueble %q no existe: usa inferior, superior o alto", ftype)
		}
		label := gripFurnitureTypeLabels[ftype]
		switch recipe.Mode {
		case GripModeHandle:
		case GripModeGola:
			if recipe.TopProfile == nil {
				return invalidGripSnapshot("GRIP_PROFILE_MISSING", "la gola de %s necesita el perfil de arriba congelado", label)
			}
			if recipe.OverhangMm != nil || recipe.HandleHardwareID != nil {
				return invalidGripSnapshot("GRIP_RECIPE_CONFLICT", "la gola de %s no lleva jaladera ni rebase", label)
			}
			if err := validateFrozenProfileAt(recipe.TopProfile, GolaPositionTop, label); err != nil {
				return err
			}
			if recipe.BetweenProfile != nil {
				if err := validateFrozenProfileAt(recipe.BetweenProfile, GolaPositionBetween, label); err != nil {
					return err
				}
			}
		case GripModeBottomOverhang:
			if recipe.OverhangMm == nil || *recipe.OverhangMm <= 0 {
				return invalidGripSnapshot("GRIP_OVERHANG_INVALID", "el rebase de %s necesita milímetros mayores a 0", label)
			}
			if recipe.TopProfile != nil || recipe.BetweenProfile != nil {
				return invalidGripSnapshot("GRIP_RECIPE_CONFLICT", "el rebase de %s no lleva perfiles", label)
			}
		default:
			return invalidGripSnapshot("GRIP_MODE_UNKNOWN", "el modo de agarre %q de %s no existe: usa handle, gola o bottom_overhang", recipe.Mode, label)
		}
	}
	return nil
}

// validateFrozenProfileAt checks one frozen profile against the position its
// recipe mounts it at: the discount that position needs must be present —
// the same use rule as UsageAt (#1530), evaluated over the frozen copy.
func validateFrozenProfileAt(profile *FrozenGripProfile, position, label string) error {
	if profile.ProfileID == "" || profile.Code == "" {
		return invalidGripSnapshot("GRIP_PROFILE_INVALID", "el perfil de gola de %s no tiene identidad congelada", label)
	}
	discount := profile.FrontDiscountTopMm
	if position == GolaPositionBetween {
		discount = profile.FrontDiscountBetweenMm
	}
	if discount == nil || *discount <= 0 {
		return invalidGripSnapshot("GRIP_PROFILE_UNUSABLE",
			"el perfil %s de %s no tiene congelado el descuento del frente que su posición necesita",
			profile.Code, label)
	}
	return nil
}

// FreezeGripSnapshot freezes ONE complete copy of a style at the moment it
// is applied (A7). lookup resolves a style profile id against the caller's
// catalog under RLS (nil = unknown). Every referenced gola profile must be
// usable at its position right now — freezing an unusable profile fails
// closed instead of applying a grip the engine cannot resolve.
func FreezeGripSnapshot(style GripStyle, lookup func(id string) (*OpeningProfile, error), at time.Time) (*GripSnapshot, error) {
	if err := ValidateGripStyleShape(style); err != nil {
		return nil, invalidGripSnapshot("GRIP_STYLE_INVALID", "el estilo no se puede aplicar: %s", err.Error())
	}
	snapshot := &GripSnapshot{
		StyleID:   style.ID,
		StyleName: style.Name,
		Recipes:   make(map[string]GripSnapshotRecipe, len(GripStyleFurnitureTypes)),
		FrozenAt:  at.UTC(),
	}
	for _, ftype := range GripStyleFurnitureTypes {
		recipe := style.ByFurnitureType[ftype]
		frozen := GripSnapshotRecipe{Mode: recipe.Mode, HandleHardwareID: recipe.HandleHardwareID}
		if recipe.OverhangMm != nil {
			value := *recipe.OverhangMm
			frozen.OverhangMm = &value
		}
		if recipe.Mode == GripModeGola {
			top, err := freezeGripProfile(lookup, recipe.TopProfileID, GolaPositionTop, ftype)
			if err != nil {
				return nil, err
			}
			frozen.TopProfile = top
			if recipe.BetweenProfileID != "" {
				between, err := freezeGripProfile(lookup, recipe.BetweenProfileID, GolaPositionBetween, ftype)
				if err != nil {
					return nil, err
				}
				frozen.BetweenProfile = between
			}
		}
		snapshot.Recipes[ftype] = frozen
	}
	return snapshot, nil
}

// freezeGripProfile freezes one profile for one position, enforcing the use
// rule over the LIVE row at the moment of freezing (available ≠ valid).
func freezeGripProfile(lookup func(id string) (*OpeningProfile, error), profileID, position, ftype string) (*FrozenGripProfile, error) {
	profile, err := lookup(profileID)
	if err != nil {
		return nil, err
	}
	if profile == nil {
		return nil, invalidGripSnapshot("GRIP_PROFILE_UNKNOWN",
			"el perfil de gola de %s no existe en el catálogo", gripFurnitureTypeLabels[ftype])
	}
	if usage := profile.UsageAt(position); !usage.Usable {
		return nil, invalidGripSnapshot("GRIP_PROFILE_UNUSABLE",
			"el perfil %s de %s no se puede usar: %s", profile.Code, gripFurnitureTypeLabels[ftype], usage.Message)
	}
	frozen := &FrozenGripProfile{
		ProfileID:              profile.ID,
		Code:                   profile.Code,
		Name:                   profile.Name,
		Material:               profile.Material,
		Positions:              append([]string{}, profile.Positions...),
		ProfileHeightMm:        profile.ProfileHeightMm,
		ProfileDepthMm:         profile.ProfileDepthMm,
		FrontDiscountTopMm:     profile.FrontDiscountTopMm,
		FrontDiscountBetweenMm: profile.FrontDiscountBetweenMm,
		CompatiblePlacements:   append([]string{}, profile.CompatiblePlacements...),
		BodyModifiers:          append([]OpeningBodyModifier{}, profile.BodyModifiers...),
		BOMVersion:             profile.Version,
	}
	if len(profile.BOMMembers) > 0 {
		frozen.BOMMembers = make(map[string]OpeningBOMMember, len(profile.BOMMembers))
		for key, member := range profile.BOMMembers {
			frozen.BOMMembers[key] = member
		}
	}
	return frozen, nil
}

// EffectiveGripSnapshot resolves the inheritance: the furniture's override
// when it has one, the project's snapshot otherwise. nil = no grip at all
// (no project snapshot and no override).
func EffectiveGripSnapshot(override, project *GripSnapshot) *GripSnapshot {
	if override != nil {
		return override
	}
	return project
}

// GripRecipeFor returns the frozen recipe of one furniture type. A type the
// snapshot does not cover is an explicit blocked state for that furniture —
// never a silent fallback to another type's recipe.
func (s *GripSnapshot) GripRecipeFor(ftype string) (*GripSnapshotRecipe, error) {
	if s == nil {
		return nil, nil
	}
	recipe, ok := s.Recipes[ftype]
	if !ok {
		return nil, invalidGripSnapshot("GRIP_TYPE_UNCOVERED",
			"la copia congelada del agarre no cubre el tipo de mueble %q", ftype)
	}
	return &recipe, nil
}
