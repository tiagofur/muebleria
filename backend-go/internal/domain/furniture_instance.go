package domain

import (
	"errors"
	"time"
)

// FurnitureInstanceOrigin records how a physical unit's identity came to
// exist (ADR-0003). It is provenance, never identity: two instances with the
// same origin, definition and parameters keep distinct IDs (I2).
type FurnitureInstanceOrigin string

const (
	// FurnitureInstanceOriginQuote: materialized from a quote revision (#386).
	FurnitureInstanceOriginQuote FurnitureInstanceOrigin = "quote"
	// FurnitureInstanceOriginDesign: created by an authoring client (design-first).
	FurnitureInstanceOriginDesign FurnitureInstanceOrigin = "design"
	// FurnitureInstanceOriginManual: created through the project API by a user.
	FurnitureInstanceOriginManual FurnitureInstanceOrigin = "manual"
	// FurnitureInstanceOriginImport: created by an import flow.
	FurnitureInstanceOriginImport FurnitureInstanceOrigin = "import"
	// FurnitureInstanceOriginDuplicate: copy of another instance (I8).
	FurnitureInstanceOriginDuplicate FurnitureInstanceOrigin = "duplicate"
)

// IsValidFurnitureInstanceOrigin reports whether the origin is a canonical
// enum value; anything else must be rejected before persistence.
func IsValidFurnitureInstanceOrigin(origin FurnitureInstanceOrigin) bool {
	switch origin {
	case FurnitureInstanceOriginQuote, FurnitureInstanceOriginDesign,
		FurnitureInstanceOriginManual, FurnitureInstanceOriginImport,
		FurnitureInstanceOriginDuplicate:
		return true
	default:
		return false
	}
}

// FurnitureInstanceLifecycle is the minimal identity lifecycle
// (digital-thread §5). removed/cancelled are terminal: a FurnitureInstance ID
// is never reused for a replacement unit (anti-pattern 12).
type FurnitureInstanceLifecycle string

const (
	FurnitureInstanceLifecycleActive    FurnitureInstanceLifecycle = "active"
	FurnitureInstanceLifecycleRemoved   FurnitureInstanceLifecycle = "removed"
	FurnitureInstanceLifecycleCancelled FurnitureInstanceLifecycle = "cancelled"
)

// FurnitureInstanceLifecycleTerminal reports whether the status accepts no
// further transitions.
func FurnitureInstanceLifecycleTerminal(status FurnitureInstanceLifecycle) bool {
	return status == FurnitureInstanceLifecycleRemoved || status == FurnitureInstanceLifecycleCancelled
}

var (
	// ErrInvalidFurnitureInstanceCommand rejects a malformed create/remove
	// command (unknown origin enum, duplicate without provenance, …) before
	// it can reach persistence.
	ErrInvalidFurnitureInstanceCommand = errors.New("invalid furniture instance command")
	// ErrFurnitureInstanceLifecycleConflict rejects a transition that the
	// current lifecycle status no longer allows (e.g. removing an already
	// removed unit): terminal identities never change again.
	ErrFurnitureInstanceLifecycleConflict = errors.New("furniture instance lifecycle conflict")
	// ErrFurnitureInstanceProjectNotWritable rejects identity mutations on a
	// project the caller can see but does not own: creation/removal stays
	// with the project's owning organization (I1).
	ErrFurnitureInstanceProjectNotWritable = errors.New("furniture instance project not writable by organization")
)

// FurnitureInstance is the persisted project-owned business identity of one
// intended physical furniture unit (ADR-0003 / digital-thread §5). It carries
// identity, provenance and lifecycle ONLY — configuration snapshots,
// transforms, BOM, machining, pricing and production state belong to their
// owning revisions/contexts, never to this row.
type FurnitureInstance struct {
	ID                        string                     `json:"id"`
	ProjectID                 string                     `json:"project_id"`
	FurnitureDefinitionID     string                     `json:"furniture_definition_id,omitempty"`
	Origin                    FurnitureInstanceOrigin    `json:"origin"`
	OriginFurnitureInstanceID string                     `json:"origin_furniture_instance_id,omitempty"`
	LifecycleStatus           FurnitureInstanceLifecycle `json:"lifecycle_status"`
	Version                   int64                      `json:"version"`
	CreatedAt                 time.Time                  `json:"created_at"`
	UpdatedAt                 time.Time                  `json:"updated_at"`

	// OrganizationID mirrors projects.organization_id for RLS. It is internal
	// tenant plumbing and never part of the public API DTO.
	OrganizationID string `json:"-"`
}
