package application

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Standard release builder (#918): assembles the canonical resource inputs
// that CompileLibraryRelease turns into an immutable manifest. Hardware
// Profiles travel as kind "hardware_profile" — id and revision map 1:1 to
// the #912 contract; the payload carries references only (hardware ids,
// quantities, versioned recipe ref), never commercial identity. A factory
// never enters this path: Standard profiles are Granete-authored catalog
// rows, factory parameterization rides the overlay (#775), and private
// libraries are explicitly out of scope (platform doc §4.4).

var (
	ErrEmptyReleaseResources = errors.New("a standard release must reference at least one canonical resource")
)

// HardwareProfileResourceKind is the library resource kind for a pinned
// hardware profile definition blob.
const HardwareProfileResourceKind = "hardware_profile"

// HardwareResourceKind is the library resource kind for canonical catalog
// hardware included in a release.
const HardwareResourceKind = "hardware"

// hardwareProfileResourcePayload is the canonical blob shape for kind
// hardware_profile: exactly the #912 wire contract minus server-owned
// lifecycle fields. Price/unit data is deliberately absent — a hardware
// price change never rewrites the pinned definition (the pinning test
// pins this), while a technical change (recipeRef revision, quantities)
// produces a new definition hash.
type hardwareProfileResourcePayload struct {
	ID          string                       `json:"id"`
	Code        string                       `json:"code"`
	Name        string                       `json:"name"`
	Description string                       `json:"description,omitempty"`
	Revision    string                       `json:"revision"`
	Items       []domain.HardwareProfileItem `json:"items"`
	RecipeRef   *domain.ProfileRecipeRef     `json:"recipeRef,omitempty"`
	Active      bool                         `json:"active"`
}

// BuildHardwareProfileResource serializes one validated profile into its
// canonical compilation input. Validation is fail-closed: a profile that
// does not satisfy the frozen #912 contract must not enter an immutable
// release — the compiler rejects the whole draft instead of pinning a
// broken definition.
func BuildHardwareProfileResource(profile *domain.HardwareProfile, packageKind domain.PackageKind) (CompilationResourceInput, error) {
	if profile == nil {
		return CompilationResourceInput{}, errors.New("hardware profile must not be nil")
	}
	if issues := profile.Validate(); len(issues) > 0 {
		return CompilationResourceInput{}, fmt.Errorf("hardware profile %s is invalid: %s (%s)", profile.Code, issues[0].Message, issues[0].Path)
	}
	payload := hardwareProfileResourcePayload{
		ID:          profile.ID,
		Code:        profile.Code,
		Name:        profile.Name,
		Description: profile.Description,
		Revision:    profile.Revision,
		Items:       profile.Items,
		RecipeRef:   profile.RecipeRef,
		Active:      profile.Active,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return CompilationResourceInput{}, fmt.Errorf("marshal hardware profile %s: %w", profile.Code, err)
	}
	id, err := uuid.Parse(profile.ID)
	if err != nil {
		return CompilationResourceInput{}, fmt.Errorf("hardware profile %s id is not a uuid: %w", profile.Code, err)
	}
	return CompilationResourceInput{
		Kind:        HardwareProfileResourceKind,
		ID:          id,
		Revision:    profile.Revision,
		PackageKind: packageKind,
		RawJSON:     raw,
	}, nil
}
