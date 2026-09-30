package domain

import (
	"time"

	"github.com/google/uuid"
)

// #772 [P1][LIB-1]: Manufacturing library identity, immutable releases and
// Free/Standard package semantics (Phase 1 foundation, ADR-0008).
//
// AUTHORIZATION RULE: GraneteStandardLibraryID is the ONLY authoritative identity
// for the Granete Standard library. Using LibraryCode "0001" for any authorization
// or routing decision is a bug. The code field is a human support label only.

// GraneteStandardLibraryID is the fixed, deterministic UUID for the Granete
// Standard manufacturing library. It is a constant, not a configuration value.
// Do not read it from environment, config files, or database lookups by code.
const GraneteStandardLibraryID = "00000000-0000-0000-0001-000000000001"

// GraneteStandardDraftReleaseID is the fixed UUID of the initial Standard draft
// release seeded by migration 000139. The LIB-2 publisher will populate its
// resource refs and manifest hash before it can be published.
const GraneteStandardDraftReleaseID = "00000000-0000-0000-0002-000000000001"

// LibraryKind identifies the structural role of a ManufacturingLibrary.
type LibraryKind string

const (
	// LibraryKindStandard is the Granete-managed upstream library (#0001).
	LibraryKindStandard LibraryKind = "standard"

	// LibraryKindOrganizationOverlay is a factory-specific overlay on top of
	// an upstream library. Overlay logic is implemented in LIB-4 (#775).
	LibraryKindOrganizationOverlay LibraryKind = "organization_overlay"

	// LibraryKindPrivate is a fully independent library (future; not yet implemented).
	LibraryKindPrivate LibraryKind = "private"
)

// ReleaseStatus is the lifecycle state of a LibraryRelease.
// Transitions: draft → published → withdrawn.
// A published release is immutable. Corrections require a new release version.
type ReleaseStatus string

const (
	ReleaseStatusDraft     ReleaseStatus = "draft"
	ReleaseStatusPublished ReleaseStatus = "published"
	ReleaseStatusWithdrawn ReleaseStatus = "withdrawn"
)

// PackageKind distinguishes Free-eligible from Standard-only resource references
// within a release. Free and Standard share canonical resource revisions;
// only the package_kind flag differs. There is no second ManufacturingLibrary
// row for Free (no second catalog invariant, §18 of manufacturing-library-platform.md).
type PackageKind string

const (
	// PackageKindFree marks a resource reference as included in the Free offering.
	PackageKindFree PackageKind = "free"

	// PackageKindStandard marks a resource reference as Standard-only.
	PackageKindStandard PackageKind = "standard"
)

// ManufacturingLibrary is the mutable authoring identity for a managed library
// lineage. It does NOT own or duplicate furniture/material/hardware semantic
// definitions; established typed domains remain authoritative.
type ManufacturingLibrary struct {
	ID                   uuid.UUID
	Code                 string       // display/support label only — never authorization
	Kind                 LibraryKind
	OwnerOrganizationID  *uuid.UUID   // nil for Granete-owned (platform-global)
	UpstreamLibraryID    *uuid.UUID   // nil for Standard; set for overlays
	UpdatePolicy         string
	Status               string
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// IsGraneteOwned returns true when the library is owned by Granete (platform-global),
// i.e. owner_organization_id IS NULL.
func (l *ManufacturingLibrary) IsGraneteOwned() bool {
	return l.OwnerOrganizationID == nil
}

// LibraryRelease is an immutable snapshot of one library lineage at a point in
// time. Once published, a release must not be mutated into a new meaning.
// ManifestHash is nil until LIB-2 populates it at publication time.
type LibraryRelease struct {
	ID               uuid.UUID
	LibraryID        uuid.UUID
	Version          string
	Status           ReleaseStatus
	SchemaVersion    int
	MinPluginVersion *string
	BaseReleaseID    *uuid.UUID   // upstream base release used when compiling overlays
	ManifestHash     *string      // nil until LIB-2 publisher populates it
	Changelog        *string
	PublishedAt      *time.Time
	PublishedBy      *uuid.UUID
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// IsPublished returns true when the release has been successfully published.
func (r *LibraryRelease) IsPublished() bool {
	return r.Status == ReleaseStatusPublished
}

// IsDraft returns true when the release is still in the authoring state.
func (r *LibraryRelease) IsDraft() bool {
	return r.Status == ReleaseStatusDraft
}

// LibraryReleaseResourceRef is a typed reference from a LibraryRelease to an
// existing canonical resource revision in one of Granete's domain tables.
// This table does NOT own or copy domain semantics — it only points to existing
// canonical entities at exact pinned revisions.
//
// PackageKind separates Free-eligible from Standard-only entries without
// duplicating the underlying resource definitions.
type LibraryReleaseResourceRef struct {
	ID               uuid.UUID
	ReleaseID        uuid.UUID
	ResourceKind     string      // e.g. "furniture_definition", "hardware", "material"
	ResourceID       uuid.UUID   // soft cross-domain ref; no FK at the Go layer
	ResourceRevision string      // exact canonical revision/fingerprint
	DefinitionHash   *string     // content hash; nil until LIB-2 populates it
	PackageKind      PackageKind
}
