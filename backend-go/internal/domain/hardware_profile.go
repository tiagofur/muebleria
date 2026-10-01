package domain

import (
	"fmt"
	"math"
	"regexp"
	"time"
)

// Hardware Profiles (#912): the reusable technical/commercial solution
// applied at a component side/contact. A profile references catalog hardware
// by ID — it never copies codes, prices or units — and references the
// versioned ContactOperationRecipe that machines it. The recipe stays the
// machining authority (one engine); the profile is the commercial
// application and the home recipes anchor to.
//
// Identity contract: ContactOperationRecipe.TechnicalProfileID (the wire the
// fixed-shelf slice declares per relationship) is the ID of a HardwareProfile.
// Provenance slots ResolvedMachiningProvenance.TechnicalProfileID /
// TechnicalProfileRevision / RecipeRevision are filled from here once the
// resolve consumes profiles (#916); until then production stays at the honest
// TECHNICAL_PROFILE_REQUIRED terminal.
//
// Versioning: a profile carries a non-blank Revision from day one so a
// manufacturing library release can pin it (LibraryReleaseResourceRef with
// kind "hardware_profile"); factory parameterization rides the manufacturing
// overlay, never a copy of the Standard upstream.

const hardwareProfileCodePattern = `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`

var hardwareProfileCodeRE = regexp.MustCompile(hardwareProfileCodePattern)

// Canonical board faces — the existing joinery/anchor/entry-face vocabulary.
// A component side assignment uses these; no aliases are introduced.
var BoardFaces = []string{"front", "back", "left", "right", "top", "bottom"}

func IsBoardFace(value string) bool {
	for _, face := range BoardFaces {
		if value == face {
			return true
		}
	}
	return false
}

// HardwareProfile is one reusable application solution: what to buy and where
// it applies, plus the recipe reference that machines it.
//
// Version/CreatedAt/UpdatedAt are server-owned persistence fields (#913):
// the version is the optimistic-concurrency token surfaced as a strong ETag
// ("v<N>", #443/#448); they take no part in the #912 structural contract.
type HardwareProfile struct {
	ID          string                `json:"id"`
	Code        string                `json:"code"`
	Name        string                `json:"name"`
	Description string                `json:"description,omitempty"`
	Revision    string                `json:"revision"`
	Items       []HardwareProfileItem `json:"items"`
	RecipeRef   *ProfileRecipeRef     `json:"recipeRef,omitempty"`
	Active      bool                  `json:"active"`
	Version     int64                 `json:"version,omitempty"`
	CreatedAt   time.Time             `json:"createdAt,omitempty"`
	UpdatedAt   time.Time             `json:"updatedAt,omitempty"`
}

// HardwareProfileItem references one catalog hardware and its per-application
// quantity. Prices and units are resolved from the catalog at consumption
// time; duplicating them here is forbidden (#912).
type HardwareProfileItem struct {
	HardwareID      string  `json:"hardwareId"`
	Quantity        float64 `json:"quantity"`
	ApplicationRole string  `json:"applicationRole,omitempty"`
}

// ProfileRecipeRef pins the exact versioned ContactOperationRecipe the
// profile embodies. RecipeID and RecipeRevision are always set together;
// there is no implicit latest (#912).
type ProfileRecipeRef struct {
	RecipeID       string `json:"recipeId"`
	RecipeRevision string `json:"recipeRevision"`
}

// Validate returns the structured issues that make this profile unusable.
// Structural only: reference existence (hardware, recipe) is enforced by the
// consumers that own those catalogs (#913/#916), never by guessing.
func (p HardwareProfile) Validate() []ContractIssue {
	issues := []ContractIssue{}
	add := func(code, message, path string) {
		issues = append(issues, ContractIssue{
			Code: code, Message: message, Severity: IssueSeverityError,
			EntityID: p.ID, Path: path,
		})
	}
	path := func(suffix string) string {
		if suffix == "" {
			return "hardwareProfile"
		}
		return "hardwareProfile." + suffix
	}
	if p.ID == "" {
		add("PROFILE_INVALID", "hardware profile needs a non-blank id", path("id"))
	}
	if p.Code == "" || !hardwareProfileCodeRE.MatchString(p.Code) {
		add("PROFILE_INVALID", "hardware profile code must match "+hardwareProfileCodePattern, path("code"))
	}
	if p.Name == "" {
		add("PROFILE_INVALID", "hardware profile needs a non-blank name", path("name"))
	}
	if p.Revision == "" {
		add("PROFILE_INVALID", "hardware profile needs a non-blank revision: releases pin exact revisions, never latest", path("revision"))
	}
	if len(p.Items) == 0 {
		add("PROFILE_INVALID", "hardware profile needs at least one hardware item", path("items"))
	}
	seenHardware := map[string]bool{}
	for index, item := range p.Items {
		itemPath := fmt.Sprintf("items[%d]", index)
		if item.HardwareID == "" {
			add("PROFILE_INVALID", "profile item needs a non-blank hardwareId", path(itemPath+".hardwareId"))
		} else if seenHardware[item.HardwareID] {
			add("PROFILE_INVALID", fmt.Sprintf("hardware %s appears more than once: split quantities are ambiguous", item.HardwareID), path(itemPath+".hardwareId"))
		}
		seenHardware[item.HardwareID] = true
		if item.Quantity <= 0 || math.IsNaN(item.Quantity) || math.IsInf(item.Quantity, 0) {
			add("PROFILE_INVALID", "profile item quantity must be a positive finite number", path(itemPath+".quantity"))
		}
	}
	if p.RecipeRef != nil {
		if p.RecipeRef.RecipeID == "" || p.RecipeRef.RecipeRevision == "" {
			add("PROFILE_INVALID", "recipeRef needs a non-blank recipeId and recipeRevision together", path("recipeRef"))
		}
	}
	return issues
}

// ComponentSideAssignment declares which HardwareProfile applies to one side
// of a component definition. Side uses the six canonical board faces; the
// physical mounting face and the tool entry face are recipe concerns and stay
// separate (#912). Assignments live on the component definition in the
// library and are overridable through the manufacturing overlay.
type ComponentSideAssignment struct {
	ID          string    `json:"id,omitempty"`
	ComponentID string    `json:"componentId"`
	Side        string    `json:"side"`
	ProfileID   string    `json:"profileId"`
	CreatedAt   time.Time `json:"createdAt,omitempty"`
	UpdatedAt   time.Time `json:"updatedAt,omitempty"`
}

// Validate returns the structured issues that make this assignment unusable.
// Profile existence and side compatibility are enforced by the resolver that
// owns the catalogs (#916), never inferred.
func (a ComponentSideAssignment) Validate() []ContractIssue {
	issues := []ContractIssue{}
	add := func(message, path string) {
		issues = append(issues, ContractIssue{
			Code: "ASSIGNMENT_INVALID", Message: message, Severity: IssueSeverityError,
			EntityID: a.ComponentID, Path: path,
		})
	}
	if a.ComponentID == "" {
		add("component side assignment needs a non-blank componentId", "componentId")
	}
	if !IsBoardFace(a.Side) {
		add(fmt.Sprintf("side %q is not one of the six canonical board faces", a.Side), "side")
	}
	if a.ProfileID == "" {
		add("component side assignment needs a non-blank profileId", "profileId")
	}
	return issues
}
