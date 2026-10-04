package api

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Contrato: librerías de manufactura (#772/#773) y overlays por fábrica
// (#775) — releases inmutables, blobs, conflictos.
type ManufacturingLibraryStore interface {
	// Manufacturing Libraries (#772 / LIB-1, #773 / LIB-2)
	GetStandardLibrary(ctx context.Context) (*domain.ManufacturingLibrary, error)
	GetCurrentPublishedRelease(ctx context.Context, libraryID uuid.UUID) (*domain.LibraryRelease, error)
	// ReleaseServerResolveInputs is the ONE loader both resolve surfaces
	// share (#916/#875): pinned profiles, synthesized side recipes and the
	// organization's factory construction policy.
	ReleaseServerResolveInputs(ctx context.Context, orgID string) (*engine.ReleaseServerInputs, error)
	// GetProductionReleaseManufacturingSnapshot (export bridge K1): the exact
	// release's frozen manufacturing snapshot — routing program included.
	GetProductionReleaseManufacturingSnapshot(ctx context.Context, projectID, releaseID string) (*storage.ReleaseManufacturingSnapshot, error)
	HardwareProfilesForRelease(ctx context.Context, releaseID uuid.UUID) ([]domain.HardwareProfile, error)
	GetPublishedReleases(ctx context.Context, libraryID uuid.UUID) ([]*domain.LibraryRelease, error)
	CreateDraftRelease(ctx context.Context, params storage.CreateDraftReleaseParams) (*domain.LibraryRelease, error)
	PublishReleaseWithManifest(ctx context.Context, releaseID uuid.UUID, manifest *domain.LibraryManifest, manifestBytes []byte, blobs []domain.ResourceBlob, publishedBy *uuid.UUID) error
	GetReleaseByID(ctx context.Context, releaseID uuid.UUID) (*domain.LibraryRelease, error)
	GetReleaseManifest(ctx context.Context, releaseID uuid.UUID) (*domain.LibraryManifest, []byte, error)
	GetResourceBlob(ctx context.Context, sha256 string) (*domain.ResourceBlob, error)
	GetResourceBlobWithEntitlementCheck(ctx context.Context, releaseID uuid.UUID, resourceID uuid.UUID, sha256 string) (*domain.ResourceBlob, domain.PackageKind, error)

	// Manufacturing Library Overlays (#775 / LIB-4)
	CreateOverlay(ctx context.Context, overlay *domain.LibraryOverlay) (*domain.LibraryOverlay, error)
	GetOverlayByID(ctx context.Context, id uuid.UUID) (*domain.LibraryOverlay, error)
	GetActiveOverlayByLibrary(ctx context.Context, organizationID, libraryID uuid.UUID) (*domain.LibraryOverlay, error)
	UpdateOverlayOverrides(ctx context.Context, id uuid.UUID, expectedVersion int64, overrides json.RawMessage, customResourceIDs []uuid.UUID) error
	SavePolicyDraft(ctx context.Context, id uuid.UUID, expectedVersion int64, draft json.RawMessage) error
	ActivatePolicyDraft(ctx context.Context, id uuid.UUID, expectedVersion int64, mergedOverrides json.RawMessage) error
	UpdateOverlayStatus(ctx context.Context, id uuid.UUID, status string) error
	UpdateOverlayBaseRelease(ctx context.Context, id uuid.UUID, newBaseReleaseID uuid.UUID, overrides json.RawMessage, status string) error
	ReplaceOverlayPendingConflicts(ctx context.Context, overlayID uuid.UUID, conflicts []domain.LibraryOverlayConflict) error
	ListOverlayConflicts(ctx context.Context, overlayID uuid.UUID, statusFilter string) ([]domain.LibraryOverlayConflict, error)
	GetOverlayConflictByID(ctx context.Context, conflictID uuid.UUID) (*domain.LibraryOverlayConflict, error)
	ResolveOverlayConflict(ctx context.Context, conflictID uuid.UUID, action domain.ResolutionAction, resolvedValue any, resolvedBy *uuid.UUID) error
	CountPendingConflicts(ctx context.Context, overlayID uuid.UUID) (int, error)
}
