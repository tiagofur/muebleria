package domain

import (
	"errors"
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

var (
	ErrDesignNotFound                       = errors.New("design not found")
	ErrDesignRevisionNotFound               = errors.New("design revision not found")
	ErrDesignRevisionConflict               = errors.New("design revision conflict")
	ErrInvalidParentRevision                 = errors.New("invalid parent revision: must belong to the same design")
	ErrInvalidDesignCommand                 = errors.New("invalid design command")
	ErrDuplicateFurnitureInstanceInRevision = errors.New("duplicate furniture instance in design revision")
	ErrCrossProjectFurnitureInstance        = errors.New("furniture instance does not belong to the design project")
	ErrDesignRevisionImmutable              = errors.New("design revision is immutable")
	ErrDesignNotActive                      = errors.New("design is not active")
	ErrWorkingCopyNotFound                  = errors.New("design working copy not found")
	ErrSerializationFailed                  = errors.New("snapshot serialization failed")
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
	ID                     string                  `json:"id"`
	ProjectID              string                  `json:"project_id"`
	DesignRevisionID       string                  `json:"design_revision_id"`
	FurnitureInstanceID    string                  `json:"furniture_instance_id"`
	FurnitureDefinitionID  string                  `json:"furniture_definition_id,omitempty"`
	DefinitionVersion      *int                    `json:"definition_version,omitempty"`
	Parameters             map[string]any          `json:"parameters"`
	MaterialChoices        map[string]string       `json:"material_choices"`
	Transform              *Transform3D            `json:"transform,omitempty"`
	RoomID                 string                  `json:"room_id,omitempty"`
	TechnicalClientLocator *TechnicalClientLocator `json:"technical_client_locator,omitempty"`
	CreatedAt              time.Time               `json:"created_at"`

	OrganizationID string `json:"-"`
}

// DesignRevision is an immutable published snapshot of spatial/design truth (ADR-0003 §3, digital-thread §8).
type DesignRevision struct {
	ID               string                   `json:"id"`
	ProjectID        string                   `json:"project_id"`
	DesignID         string                   `json:"design_id"`
	RevisionNumber   int                      `json:"revision_number"`
	ParentRevisionID string                   `json:"parent_revision_id,omitempty"`
	SourceType       DesignRevisionSourceType `json:"source_type"`
	Status           DesignRevisionStatus     `json:"status"`
	CreatedBy        string                   `json:"created_by,omitempty"`
	CreatedAt        time.Time                `json:"created_at"`
	// Approval metadata (#395 / §17): written exactly once by the explicit
	// published→approved transition, never by publish and never from client
	// input. The snapshot itself stays immutable (I4 / I12).
	ApprovedBy string     `json:"approved_by,omitempty"`
	ApprovedAt *time.Time `json:"approved_at,omitempty"`
	Items      []DesignRevisionItem `json:"items,omitempty"`
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
	ID                     string                  `json:"id"`
	ProjectID              string                  `json:"project_id"`
	DesignID               string                  `json:"design_id"`
	FurnitureInstanceID    string                  `json:"furniture_instance_id"`
	FurnitureDefinitionID  string                  `json:"furniture_definition_id,omitempty"`
	DefinitionVersion      *int                    `json:"definition_version,omitempty"`
	Parameters             map[string]any          `json:"parameters"`
	MaterialChoices        map[string]string       `json:"material_choices"`
	Transform              *Transform3D            `json:"transform,omitempty"`
	RoomID                 string                  `json:"room_id,omitempty"`
	TechnicalClientLocator *TechnicalClientLocator `json:"technical_client_locator,omitempty"`
	CreatedAt              time.Time               `json:"created_at"`
	UpdatedAt              time.Time               `json:"updated_at"`

	OrganizationID string `json:"-"`
}

// DesignWorkingCopy represents the mutable authoring draft of a Design (ADR-0003, digital-thread §8).
type DesignWorkingCopy struct {
	DesignID       string                   `json:"design_id"`
	ProjectID      string                   `json:"project_id"`
	BaseRevisionID *string                  `json:"base_revision_id,omitempty"`
	SourceType     DesignRevisionSourceType `json:"source_type"`
	Items          []DesignWorkingItem      `json:"items"`
	UpdatedAt      time.Time                `json:"updated_at"`
	UpdatedBy      string                   `json:"updated_by,omitempty"`

	OrganizationID string `json:"-"`
}
