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
	Recipe      *ProfileRecipeBody    `json:"recipe,omitempty"`
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

// ProfileRecipeBody is the profile-embedded recipe definition (#916): the
// full technical content a release pins — one variant per target-face
// orientation, each carrying the complete rule set for both participants.
// The wire shape of rules mirrors the frozen engine ContactOperationRule
// contract exactly; identity (recipeId+revision) must agree with RecipeRef
// when both are present. One resource (the profile) stays the authoring
// surface — the recipe remains server/domain authoritative because it only
// ever takes effect through the pinned release blob.
type ProfileRecipeBody struct {
	RecipeID       string                 `json:"recipeId"`
	RecipeRevision string                 `json:"recipeRevision"`
	Variants       []ProfileRecipeVariant `json:"variants"`
}

// ProfileRecipeVariant machines one target-face orientation: the contact
// target's declared face selects the variant.
type ProfileRecipeVariant struct {
	TargetFace string            `json:"targetFace"`
	Rules      []ProfileRuleSpec `json:"rules"`
}

// ProfileRuleSpec mirrors the engine ContactOperationRule wire (same json
// tags) so the pinned blob needs no reshaping at consumption time. It lives
// in domain because the profile contract validates it before compilation.
type ProfileRuleSpec struct {
	RuleID          string     `json:"ruleId"`
	RuleRevision    string     `json:"ruleRevision"`
	ParticipantRole string     `json:"participantRole"`
	OperationRole   string     `json:"operationRole"`
	EntryFace       string     `json:"entryFace"`
	OffsetMm        [3]float64 `json:"offsetMm"` // contact axis, normal, axis × normal
	Axis            [3]float64 `json:"axis"`
	DiameterMm      float64    `json:"diameterMm"`
	DepthMm         float64    `json:"depthMm"`
}

// ValidateProfileRecipeBody returns the structured issues of an embedded
// recipe: identity coherence with the profile pin, unique target faces, and
// the same per-rule shape the engine validator enforces (both participant
// roles present, unique rule ids, revisions, six entry faces, unit axis,
// positive finite diameter/depth). Fail-closed: a broken body must never
// enter an immutable release nor resolve productively.
func ValidateProfileRecipeBody(ref *ProfileRecipeRef, body *ProfileRecipeBody) []ContractIssue {
	issues := []ContractIssue{}
	add := func(message, path string) {
		issues = append(issues, ContractIssue{
			Code: "PROFILE_INVALID", Message: message, Severity: IssueSeverityError, Path: path,
		})
	}
	if body == nil {
		return issues
	}
	path := func(suffix string) string { return "hardwareProfile.recipe." + suffix }
	if body.RecipeID == "" || body.RecipeRevision == "" {
		add("recipe body needs a non-blank recipeId and recipeRevision", path("recipeId"))
	}
	if ref != nil && ref.RecipeID != "" && ref.RecipeRevision != "" &&
		(ref.RecipeID != body.RecipeID || ref.RecipeRevision != body.RecipeRevision) {
		add("recipe body identity must agree with the profile recipeRef", path("recipeId"))
	}
	if len(body.Variants) == 0 {
		add("recipe body needs at least one target-face variant", path("variants"))
	}
	seenFaces := map[string]bool{}
	for index, variant := range body.Variants {
		variantPath := path(fmt.Sprintf("variants[%d]", index))
		if !IsBoardFace(variant.TargetFace) {
			add(fmt.Sprintf("variant targetFace %q is not one of the six canonical board faces", variant.TargetFace), variantPath+".targetFace")
			continue
		}
		if seenFaces[variant.TargetFace] {
			add(fmt.Sprintf("targetFace %s declares more than one variant", variant.TargetFace), variantPath+".targetFace")
		}
		seenFaces[variant.TargetFace] = true
		roleA, roleB := false, false
		ruleIDs := map[string]bool{}
		for ruleIndex, rule := range variant.Rules {
			rulePath := fmt.Sprintf("%s.rules[%d]", variantPath, ruleIndex)
			roleA = roleA || rule.ParticipantRole == "A"
			roleB = roleB || rule.ParticipantRole == "B"
			if rule.RuleID == "" || rule.RuleRevision == "" || rule.OperationRole == "" || ruleIDs[rule.RuleID] ||
				(rule.ParticipantRole != "A" && rule.ParticipantRole != "B") ||
				!IsBoardFace(rule.EntryFace) || !isFiniteVec3(rule.OffsetMm) || !isFiniteVec3(rule.Axis) ||
				rule.DiameterMm <= 0 || math.IsNaN(rule.DiameterMm) || math.IsInf(rule.DiameterMm, 0) ||
				rule.DepthMm <= 0 || math.IsNaN(rule.DepthMm) || math.IsInf(rule.DepthMm, 0) ||
				math.Abs(dotVec3(rule.Axis, rule.Axis)-1) > 1e-6 {
				add("rule needs unique ruleId, revision, operationRole, participantRole, one of the six entry faces, finite offset, unit axis, positive finite diameter and depth", rulePath)
			}
			ruleIDs[rule.RuleID] = true
		}
		if !roleA || !roleB {
			add(fmt.Sprintf("variant %s needs at least one rule per participant role (source and target)", variant.TargetFace), variantPath+".rules")
		}
	}
	return issues
}

func isFiniteVec3(v [3]float64) bool {
	for _, value := range v {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return true
}

func dotVec3(a, b [3]float64) float64 {
	return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
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
	issues = append(issues, ValidateProfileRecipeBody(p.RecipeRef, p.Recipe)...)
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
