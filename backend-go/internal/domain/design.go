package domain

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// #387 / DT-3: Design aggregate and immutable DesignRevision snapshots
// (ADR-0003, digital-thread §§7-10).

type DesignStatus string

const (
	DesignStatusDraft    DesignStatus = "draft"
	DesignStatusActive   DesignStatus = "active"
	DesignStatusArchived DesignStatus = "archived"
)

func IsValidDesignStatus(status DesignStatus) bool {
	switch status {
	case DesignStatusDraft, DesignStatusActive, DesignStatusArchived:
		return true
	default:
		return false
	}
}

type DesignRevisionSourceType string

const (
	DesignRevisionSourceSketchup  DesignRevisionSourceType = "sketchup"
	DesignRevisionSourceProyectar DesignRevisionSourceType = "proyectar"
	DesignRevisionSourceImport    DesignRevisionSourceType = "import"
	DesignRevisionSourceSystem    DesignRevisionSourceType = "system"
	DesignRevisionSourceManual    DesignRevisionSourceType = "manual"
)

func IsValidDesignRevisionSourceType(st DesignRevisionSourceType) bool {
	switch st {
	case DesignRevisionSourceSketchup, DesignRevisionSourceProyectar,
		DesignRevisionSourceImport, DesignRevisionSourceSystem, DesignRevisionSourceManual:
		return true
	default:
		return false
	}
}

type DesignRevisionStatus string

const (
	DesignRevisionStatusPublished  DesignRevisionStatus = "published"
	DesignRevisionStatusApproved   DesignRevisionStatus = "approved"
	DesignRevisionStatusSuperseded DesignRevisionStatus = "superseded"
)

func IsValidDesignRevisionStatus(status DesignRevisionStatus) bool {
	switch status {
	case DesignRevisionStatusPublished, DesignRevisionStatusApproved, DesignRevisionStatusSuperseded:
		return true
	default:
		return false
	}
}

// DesignMaterialChoiceMode is the #784 per-role inheritance lineage of one
// material choice. It is a dimension SEPARATE from DesignMaterialProvenance
// (commercial/authorial provenance): mode answers "does this role belong to
// the Design lineage or is it a furniture exception", provenance answers
// "where did this value historically come from". mode=design is lineage, NOT
// a live pointer: the item keeps its materialized choice until an explicit
// rollout/reset applies the current Design default (OWNER DECISIONS #784,
// 2026-09-28). mode=definition records the curated FurnitureDefinition
// fallback materialized at insertion (no compatible Design default existed
// and no user choice was made): it is not a user exception, so a future
// rollout may adopt it deliberately. Inheritance is never inferred from
// value equality.
type DesignMaterialChoiceMode string

const (
	DesignMaterialChoiceModeDesign     DesignMaterialChoiceMode = "design"
	DesignMaterialChoiceModeOverride   DesignMaterialChoiceMode = "override"
	DesignMaterialChoiceModeDefinition DesignMaterialChoiceMode = "definition"
)

func IsValidDesignMaterialChoiceMode(mode DesignMaterialChoiceMode) bool {
	switch mode {
	case DesignMaterialChoiceModeDesign, DesignMaterialChoiceModeOverride, DesignMaterialChoiceModeDefinition:
		return true
	default:
		return false
	}
}

// DesignAuthoringDefaults is the durable Design-scoped authoring defaults
// block (#784). The wrapper is deliberately extensible: hardwareChoices and
// parameters may join later through their own capability contracts, but this
// delivery only implements materialChoices. Canonical empty state is
// {"materialChoices":{}} — never a bare {} nor null.
type DesignAuthoringDefaults struct {
	MaterialChoices map[string]string `json:"materialChoices"`
}

// NormalizeDesignAuthoringDefaults returns the canonical form: a non-nil
// materialChoices map. It does not validate contents (see
// ValidateDesignAuthoringDefaults).
func (d DesignAuthoringDefaults) Normalize() DesignAuthoringDefaults {
	if d.MaterialChoices == nil {
		d.MaterialChoices = map[string]string{}
	}
	return d
}

// ValidateDesignAuthoringDefaults enforces the known durable schema
// fail-closed: role keys and material ids must be non-empty strings. Role
// names stay free-form option group codes (consistent with material_choices);
// unknown top-level fields are rejected at the API decode boundary, not here.
func ValidateDesignAuthoringDefaults(defaults DesignAuthoringDefaults) error {
	for role, materialID := range defaults.MaterialChoices {
		if strings.TrimSpace(role) == "" {
			return fmt.Errorf("%w: authoring defaults carry an empty material role", ErrInvalidDesignCommand)
		}
		if strings.TrimSpace(materialID) == "" {
			return fmt.Errorf("%w: authoring default for role %s carries an empty material id", ErrInvalidDesignCommand, role)
		}
	}
	return nil
}

// ErrInvalidMaterialChoiceModes marks a violation of the #784 inheritance
// contract: unknown mode, empty role, or a mode without its materialized
// choice (key parity — every choice carries an explicit mode and vice versa).
var ErrInvalidMaterialChoiceModes = errors.New("invalid material choice modes")

// ValidateDesignMaterialChoiceModes enforces the #784 per-item invariants:
// every mode is known, every role key is non-empty, and keys(material modes)
// == keys(material choices). Parity is the honest representation: choices are
// always materialized, so a mode without a value or a value without a lineage
// statement is a contract violation, never a silent default.
func ValidateDesignMaterialChoiceModes(choices map[string]string, modes map[string]DesignMaterialChoiceMode) error {
	for role, mode := range modes {
		if strings.TrimSpace(role) == "" {
			return fmt.Errorf("%w: empty material role", ErrInvalidMaterialChoiceModes)
		}
		if !IsValidDesignMaterialChoiceMode(mode) {
			return fmt.Errorf("%w: unknown mode %q for role %s", ErrInvalidMaterialChoiceModes, mode, role)
		}
	}
	for role := range choices {
		if _, ok := modes[role]; !ok {
			return fmt.Errorf("%w: role %s carries a materialized choice without an inheritance mode", ErrInvalidMaterialChoiceModes, role)
		}
	}
	for role := range modes {
		if _, ok := choices[role]; !ok {
			return fmt.Errorf("%w: role %s carries an inheritance mode without a materialized choice", ErrInvalidMaterialChoiceModes, role)
		}
	}
	return nil
}

// ValidatePresentMaterialChoiceModes enforces the STRICT wire contract for
// writers that speak #784 (the modes field is present): every mode known,
// every role key non-empty, no mode without a materialized choice, no choice
// without a mode, and the statement may not be empty while choices exist.
// Partial statements reject; nothing is silently completed or deduplicated.
func ValidatePresentMaterialChoiceModes(choices map[string]string, modes map[string]DesignMaterialChoiceMode) error {
	return ValidateDesignMaterialChoiceModes(choices, modes)
}

// MergeLegacyMaterialChoiceModes applies the pre-#784 writer policy when the
// modes field is ABSENT from a working-copy item (owner decision 2026-09-28):
//
//	incoming choice == persisted choice → PRESERVE the persisted lineage mode
//	incoming choice != persisted choice → override (a legacy client changing a
//	                                   materialized value creates an exception)
//	role new to the item               → override
//	role removed from choices          → its mode drops with it (parity)
//
// Equality is used ONLY to detect whether the legacy writer changed a
// materialized value; it NEVER infers Design lineage from equality with the
// Design default — lineage comes exclusively from the already-persisted
// explicit mode. Without this rule, an unrelated full-replace PUT from an
// older plugin would silently destroy a design-backed lineage.
func MergeLegacyMaterialChoiceModes(incoming, persistedChoices map[string]string, persistedModes map[string]DesignMaterialChoiceMode) map[string]DesignMaterialChoiceMode {
	merged := make(map[string]DesignMaterialChoiceMode, len(incoming))
	for role := range incoming {
		if incoming[role] != "" && persistedChoices[role] == incoming[role] {
			if mode, ok := persistedModes[role]; ok && IsValidDesignMaterialChoiceMode(mode) {
				merged[role] = mode
				continue
			}
		}
		merged[role] = DesignMaterialChoiceModeOverride
	}
	return merged
}

// DesignRoleInheritance is the server-side projection of one item/role pair:
// the authoritative answer for #784 badges and impact review. Applied is the
// materialized choice; DesignDefault is the current Design default when one
// exists. NeedsRollout compares the applied value against the current default
// ONLY AFTER the stored mode proves the design lineage — equality decides
// up-to-date vs behind, never design vs override (OWNER DECISIONS #784).
type DesignRoleInheritance struct {
	Role          string
	Mode          DesignMaterialChoiceMode
	AppliedChoice string
	DesignDefault string
	NeedsRollout  bool
}

// EvaluateDesignRoleInheritance is the pure composition rule:
//
//	mode=override ⇒ needsRollout=false (rollout preserves overrides);
//	mode=design   ⇒ needsRollout = applied != current Design default
//	                (no default ⇒ nothing to roll out).
func EvaluateDesignRoleInheritance(role string, mode DesignMaterialChoiceMode, appliedChoice, designDefault string) DesignRoleInheritance {
	out := DesignRoleInheritance{
		Role:          role,
		Mode:          mode,
		AppliedChoice: appliedChoice,
		DesignDefault: designDefault,
	}
	if mode == DesignMaterialChoiceModeDesign && designDefault != "" && appliedChoice != designDefault {
		out.NeedsRollout = true
	}
	return out
}

// DesignRoleInheritanceCount aggregates one role's inheritance state across
// every item of a working copy — the exact numbers the #784 impact review
// shows (linked / needs-rollout / up-to-date / overridden). "Unsupported"
// (definition does not offer the role) is deliberately NOT computed here: it
// depends on catalog capabilities, a different authority than this read
// model; consumers join it separately and never by guessing.
type DesignRoleInheritanceCount struct {
	Role             string
	Items            int
	DesignBacked     int
	DefinitionBacked int
	NeedsRollout     int
	DesignCurrent    int
	Overridden       int
}

// SummarizeDesignInheritance folds per-item role projections into per-role
// counts. Roles are returned sorted for deterministic readbacks.
func SummarizeDesignInheritance(entries []DesignRoleInheritance) []DesignRoleInheritanceCount {
	byRole := map[string]*DesignRoleInheritanceCount{}
	for _, entry := range entries {
		count, ok := byRole[entry.Role]
		if !ok {
			count = &DesignRoleInheritanceCount{Role: entry.Role}
			byRole[entry.Role] = count
		}
		count.Items++
		switch entry.Mode {
		case DesignMaterialChoiceModeDesign:
			count.DesignBacked++
			if entry.NeedsRollout {
				count.NeedsRollout++
			} else {
				count.DesignCurrent++
			}
		case DesignMaterialChoiceModeDefinition:
			// Curated fallback lineage: counted separately so an explicit
			// rollout (R5) can adopt these deliberately; they never inflate
			// the design-backed rollout numbers nor the override count.
			count.DefinitionBacked++
		case DesignMaterialChoiceModeOverride:
			count.Overridden++
		}
	}
	roles := make([]string, 0, len(byRole))
	for role := range byRole {
		roles = append(roles, role)
	}
	sort.Strings(roles)
	out := make([]DesignRoleInheritanceCount, 0, len(roles))
	for _, role := range roles {
		out = append(out, *byRole[role])
	}
	return out
}

var (
	ErrDesignNotFound                       = errors.New("design not found")
	ErrDesignRevisionNotFound               = errors.New("design revision not found")
	ErrDesignRevisionConflict               = errors.New("design revision conflict")
	ErrInvalidParentRevision                = errors.New("invalid parent revision: must belong to the same design")
	ErrInvalidDesignCommand                 = errors.New("invalid design command")
	ErrDuplicateFurnitureInstanceInRevision = errors.New("duplicate furniture instance in design revision")
	ErrCrossProjectFurnitureInstance        = errors.New("furniture instance does not belong to the design project")
	ErrDesignRevisionImmutable              = errors.New("design revision is immutable")
	ErrDesignNotActive                      = errors.New("design is not active")
	ErrWorkingCopyNotFound                  = errors.New("design working copy not found")
	// #637 / DT-MAT: the exact furniture instance is not part of this
	// design's working copy — nothing to reconcile, fail closed.
	ErrWorkingItemNotFound = errors.New("design working item not found")
	ErrSerializationFailed = errors.New("snapshot serialization failed")
	// #395: approval is an explicit, permission-protected lifecycle decision
	// on an exact revision — publishing alone never authorizes production.
	ErrDesignRevisionApprovalInvalid = errors.New("design revision cannot transition to approved from its current status")
)

// Design represents a logical, client-agnostic design aggregate owned by a Project (ADR-0003 §3, digital-thread §7).
type Design struct {
	ID                    string       `json:"id"`
	ProjectID             string       `json:"project_id"`
	Name                  string       `json:"name"`
	SourceQuoteRevisionID string       `json:"source_quote_revision_id,omitempty"`
	Status                DesignStatus `json:"status"`
	CreatedBy             string       `json:"created_by,omitempty"`
	CreatedAt             time.Time    `json:"created_at"`
	UpdatedAt             time.Time    `json:"updated_at"`

	// OrganizationID mirrors projects.organization_id for RLS.
	OrganizationID string `json:"-"`
}

// Transform3D represents 3D translation and rotation for authoring layout.
type Transform3D struct {
	TranslationMm [3]float64 `json:"translationMm"`
	RotationDeg   [3]float64 `json:"rotationDeg"`
}

// TechnicalClientLocator is an optional technical locator (e.g. SketchUp persistent_id).
// It is NEVER business identity (ADR-0003 §4, I7).
type TechnicalClientLocator struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

// DesignRevisionItem represents the authoring snapshot of one physical FurnitureInstance in a revision (digital-thread §9).
type DesignRevisionItem struct {
	ID                    string                              `json:"id"`
	ProjectID             string                              `json:"project_id"`
	DesignRevisionID      string                              `json:"design_revision_id"`
	FurnitureInstanceID   string                              `json:"furniture_instance_id"`
	FurnitureDefinitionID string                              `json:"furniture_definition_id,omitempty"`
	DefinitionVersion     *int                                `json:"definition_version,omitempty"`
	Parameters            map[string]any                      `json:"parameters"`
	MaterialChoices       map[string]string                   `json:"material_choices"`
	MaterialChoiceSources map[string]DesignMaterialProvenance `json:"-"`
	// MaterialChoiceModes freezes the #784 inheritance lineage per role.
	// Nil marks a LEGACY pre-#784 revision item: published before the
	// contract existed and never backfilled (immutability), read
	// conservatively as override for every materialized role.
	MaterialChoiceModes    map[string]DesignMaterialChoiceMode `json:"material_choice_modes,omitempty"`
	PresentationSnapshot   *DesignRevisionPresentationSnapshot `json:"presentation_snapshot,omitempty"`
	Transform              *Transform3D                        `json:"transform,omitempty"`
	RoomID                 string                              `json:"room_id,omitempty"`
	TechnicalClientLocator *TechnicalClientLocator             `json:"technical_client_locator,omitempty"`
	CreatedAt              time.Time                           `json:"created_at"`

	OrganizationID string `json:"-"`
}

// DesignRevision is an immutable published snapshot of spatial/design truth (ADR-0003 §3, digital-thread §8).
type DesignRevision struct {
	ID                   string                   `json:"id"`
	ProjectID            string                   `json:"project_id"`
	DesignID             string                   `json:"design_id"`
	RevisionNumber       int                      `json:"revision_number"`
	ParentRevisionID     string                   `json:"parent_revision_id,omitempty"`
	SourceType           DesignRevisionSourceType `json:"source_type"`
	Status               DesignRevisionStatus     `json:"status"`
	CreatedBy            string                   `json:"created_by,omitempty"`
	CreatedByDisplayName string                   `json:"created_by_display_name,omitempty"`
	CreatedAt            time.Time                `json:"created_at"`
	// Approval metadata (#395 / §17): written exactly once by the explicit
	// published→approved transition, never by publish and never from client
	// input. The snapshot itself stays immutable (I4 / I12).
	ApprovedBy            string               `json:"approved_by,omitempty"`
	ApprovedByDisplayName string               `json:"approved_by_display_name,omitempty"`
	ApprovedAt            *time.Time           `json:"approved_at,omitempty"`
	Items                 []DesignRevisionItem `json:"items,omitempty"`
	// AuthoringDefaultsSnapshot freezes the working copy's #784 Design
	// authoring defaults at publish time. Nil marks a LEGACY revision
	// published before the contract existed (reads as canonical empty).
	AuthoringDefaultsSnapshot *DesignAuthoringDefaults `json:"authoring_defaults_snapshot,omitempty"`
	// Artifacts carries the #392 published artifact metadata (model/manifest/
	// preview). Nil for legacy artifact-less publishes; readers treat nil as
	// "no artifacts".
	Artifacts []DesignRevisionArtifact `json:"artifacts,omitempty"`

	OrganizationID string `json:"-"`
}

// ValidateDesignRevisionApproval returns whether the explicit approval command
// applies to a revision in the given status. Approval targets an exact
// revisionId (#395 §6): published→approved is the only transition; an already
// approved revision is an idempotent no-op handled by the caller, and any
// other status rejects the command (superseded history is terminal).
func ValidateDesignRevisionApproval(status DesignRevisionStatus) error {
	switch status {
	case DesignRevisionStatusPublished:
		return nil
	case DesignRevisionStatusApproved:
		return nil // idempotent replay: no new transition, no metadata rewrite
	default:
		return ErrDesignRevisionApprovalInvalid
	}
}

// DesignWorkingItem represents a mutable draft item in a design's working copy.
type DesignWorkingItem struct {
	ID                    string                              `json:"id"`
	ProjectID             string                              `json:"project_id"`
	DesignID              string                              `json:"design_id"`
	FurnitureInstanceID   string                              `json:"furniture_instance_id"`
	FurnitureDefinitionID string                              `json:"furniture_definition_id,omitempty"`
	DefinitionVersion     *int                                `json:"definition_version,omitempty"`
	Parameters            map[string]any                      `json:"parameters"`
	MaterialChoices       map[string]string                   `json:"material_choices"`
	MaterialChoiceSources map[string]DesignMaterialProvenance `json:"-"`
	// MaterialChoiceModes is the #784 per-role inheritance lineage
	// (design|override), client-authorable intent persisted verbatim —
	// never derived by equality. Canonical parity: keys == material_choices.
	MaterialChoiceModes    map[string]DesignMaterialChoiceMode `json:"material_choice_modes,omitempty"`
	Transform              *Transform3D                        `json:"transform,omitempty"`
	RoomID                 string                              `json:"room_id,omitempty"`
	TechnicalClientLocator *TechnicalClientLocator             `json:"technical_client_locator,omitempty"`
	CreatedAt              time.Time                           `json:"created_at"`
	UpdatedAt              time.Time                           `json:"updated_at"`

	OrganizationID string `json:"-"`
}

// DesignWorkingCopy represents the mutable authoring draft of a Design (ADR-0003, digital-thread §8).
type DesignWorkingCopy struct {
	DesignID       string                   `json:"design_id"`
	ProjectID      string                   `json:"project_id"`
	BaseRevisionID *string                  `json:"base_revision_id,omitempty"`
	SourceType     DesignRevisionSourceType `json:"source_type"`
	// AuthoringDefaults is the durable Design-scoped authoring defaults
	// block (#784): the preferred inherited choices for this Design. Changing
	// a default never mutates existing items — materialization happens only
	// through the explicit rollout (#471) or per-item intent.
	AuthoringDefaults DesignAuthoringDefaults `json:"authoring_defaults"`
	Items             []DesignWorkingItem     `json:"items"`
	UpdatedAt         time.Time               `json:"updated_at"`
	UpdatedBy         string                  `json:"updated_by,omitempty"`

	OrganizationID string `json:"-"`
}
