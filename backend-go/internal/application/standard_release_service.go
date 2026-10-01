package application

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// StandardReleaseService orchestrates the Granete Standard publish flow
// (#918): gather canonical resources → CompileLibraryRelease →
// PublishReleaseWithManifest. The primitives are pre-existing and tested;
// this is the missing production wiring. It is Granete-staff surface: no
// factory authorization ever reaches it (Standard is immutable upstream).

var (
	ErrStandardLibraryNotFound   = errors.New("standard manufacturing library not found")
	ErrNoHardwareProfileResource = errors.New("release gathers no hardware profile resources")
)

// HardwareProfileReader reads active hardware profiles across organizations
// for compilation (Granete-staff authority, not tenant-scoped).
type HardwareProfileReader interface {
	ListActiveHardwareProfilesAnyOrg(ctx context.Context) ([]domain.HardwareProfile, error)
}

// HardwareReader reads catalog hardware for compilation.
type HardwareReader interface {
	ListHardwares(ctx context.Context) ([]domain.Hardware, error)
}

// BuildStandardReleaseInputs assembles the compilation resources from the
// store: canonical hardware (kind hardware) and every active hardware
// profile (kind hardware_profile). Fail-closed on any invalid profile —
// a broken definition never enters an immutable release.
func BuildStandardReleaseInputs(
	ctx context.Context,
	hardware HardwareReader,
	profiles HardwareProfileReader,
) ([]CompilationResourceInput, error) {
	hardwareList, err := hardware.ListHardwares(ctx)
	if err != nil {
		return nil, fmt.Errorf("gather hardware resources: %w", err)
	}
	inputs := make([]CompilationResourceInput, 0, len(hardwareList)+8)
	for i := range hardwareList {
		hw := &hardwareList[i]
		if !hw.Active {
			continue
		}
		raw, err := json.Marshal(hw)
		if err != nil {
			return nil, fmt.Errorf("marshal hardware %s: %w", hw.Code, err)
		}
		id, err := uuid.Parse(hw.ID)
		if err != nil {
			return nil, fmt.Errorf("hardware %s id is not a uuid: %w", hw.Code, err)
		}
		inputs = append(inputs, CompilationResourceInput{
			Kind:        HardwareResourceKind,
			ID:          id,
			Revision:    hardwareRevision(hw),
			PackageKind: domain.PackageKindFree,
			RawJSON:     raw,
		})
	}

	profileList, err := profiles.ListActiveHardwareProfilesAnyOrg(ctx)
	if err != nil {
		return nil, fmt.Errorf("gather hardware profile resources: %w", err)
	}
	profileCount := 0
	for i := range profileList {
		profile := &profileList[i]
		resource, err := BuildHardwareProfileResource(profile, domain.PackageKindFree)
		if err != nil {
			return nil, err
		}
		inputs = append(inputs, resource)
		profileCount++
	}
	if profileCount == 0 {
		return nil, ErrNoHardwareProfileResource
	}
	return inputs, nil
}

// hardwareRevision derives the canonical hardware resource revision: the
// updated_at timestamp. A price-only change re-revisions the hardware
// resource (commercial surface) while leaving pinned profile blobs intact —
// the exact commercial/technical separation #918 demands.
func hardwareRevision(hw *domain.Hardware) string {
	if hw.UpdatedAt.IsZero() {
		return "rev-0"
	}
	return hw.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z")
}

// PublishStandardRelease compiles and atomically publishes one draft
// release of the Granete Standard library. The release must exist in draft
// status (create it with storage.CreateDraftRelease first); publish is
// fail-closed and leaves the previous current release untouched on error.
func PublishStandardRelease(
	ctx context.Context,
	store StandardReleaseStore,
	releaseID uuid.UUID,
	publishedBy uuid.UUID,
) (*CompilationResult, error) {
	release, err := store.GetReleaseByID(ctx, releaseID)
	if err != nil {
		return nil, fmt.Errorf("load release: %w", err)
	}
	if release.LibraryID.String() != domain.GraneteStandardLibraryID {
		return nil, ErrStandardLibraryNotFound
	}
	if release.Status != domain.ReleaseStatusDraft {
		return nil, ErrReleaseNotDraft
	}

	inputs, err := BuildStandardReleaseInputs(ctx, store, store)
	if err != nil {
		return nil, err
	}
	result, err := CompileLibraryRelease(CompilationInput{
		Library:   &domain.ManufacturingLibrary{ID: release.LibraryID, Code: "0001", Kind: domain.LibraryKindStandard, Status: "active"},
		Release:   release,
		Resources: inputs,
	})
	if err != nil {
		return nil, fmt.Errorf("compile standard release %s: %w", release.Version, err)
	}
	if err := store.PublishReleaseWithManifest(ctx, releaseID, result.Manifest, result.ManifestBytes, result.Blobs, &publishedBy); err != nil {
		return nil, fmt.Errorf("publish standard release %s: %w", release.Version, err)
	}
	return result, nil
}

// StandardReleaseStore is the surface the publish flow needs: satisfied by
// *storage.PostgresStore and by handler-test stubs.
type StandardReleaseStore interface {
	HardwareReader
	HardwareProfileReader
	PinnedReleaseReader
	GetReleaseByID(ctx context.Context, releaseID uuid.UUID) (*domain.LibraryRelease, error)
	PublishReleaseWithManifest(ctx context.Context, releaseID uuid.UUID, manifest *domain.LibraryManifest, manifestBytes []byte, blobs []domain.ResourceBlob, publishedBy *uuid.UUID) error
	// Demo seed surface (#955): org-scoped like every catalog call; the
	// seed runs under the initial organization context.
	GetHardwareProfileByID(ctx context.Context, id string) (*domain.HardwareProfile, error)
	CreateHardwareProfile(ctx context.Context, p *domain.HardwareProfile) error
	EnsureSeedPlatformUser(ctx context.Context) (string, error)
}

// PinnedReleaseReader is the minimal read surface for resolving pinned
// profile definitions: satisfied by *storage.PostgresStore and by the API
// Store subset.
type PinnedReleaseReader interface {
	GetReleaseManifest(ctx context.Context, releaseID uuid.UUID) (*domain.LibraryManifest, []byte, error)
	GetResourceBlob(ctx context.Context, sha256 string) (*domain.ResourceBlob, error)
}

// HardwareProfilesForRelease resolves the pinned hardware profiles of one
// exact release — the authoritative pinned read (#918): kind
// hardware_profile manifest refs are resolved to their content-addressed
// blobs and decoded with the frozen #912 contract. There is no "latest"
// variant on purpose: callers pass the design revision's pin (or resolve
// the release id explicitly before calling).
func HardwareProfilesForRelease(
	ctx context.Context,
	store PinnedReleaseReader,
	releaseID uuid.UUID,
) ([]domain.HardwareProfile, error) {
	_, manifestBytes, err := store.GetReleaseManifest(ctx, releaseID)
	if err != nil {
		if errors.Is(err, storage.ErrManifestNotFound) {
			return nil, fmt.Errorf("release %s has no manifest; it is not a published release", releaseID)
		}
		return nil, fmt.Errorf("load release manifest: %w", err)
	}
	var manifest domain.LibraryManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return nil, fmt.Errorf("decode release manifest: %w", err)
	}
	profiles := make([]domain.HardwareProfile, 0)
	for _, ref := range manifest.Resources {
		if ref.Kind != HardwareProfileResourceKind {
			continue
		}
		blob, err := store.GetResourceBlob(ctx, ref.DefinitionHash)
		if err != nil {
			return nil, fmt.Errorf("load pinned profile blob %s: %w", ref.DefinitionHash, err)
		}
		var profile domain.HardwareProfile
		if err := json.Unmarshal(blob.Content, &profile); err != nil {
			return nil, fmt.Errorf("decode pinned profile %s: %w", ref.ID, err)
		}
		if strings.TrimSpace(profile.Revision) == "" {
			return nil, fmt.Errorf("pinned profile %s has no revision: fail closed", ref.ID)
		}
		profiles = append(profiles, profile)
	}
	return profiles, nil
}
