package application

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
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

// CatalogReader reads the assembled organization catalog (one consistent
// snapshot incl. module board parts / hardware lines) for compilation.
type CatalogReader interface {
	GetFullCatalog(ctx context.Context) (domain.Catalog, error)
}

// MaterialCategoryReader reads material categories for compilation (#1102
// frozen geometry: the furniture projection needs them).
type MaterialCategoryReader interface {
	ListMaterialCategories(ctx context.Context) ([]domain.MaterialCategory, error)
}

// Compilation resource kinds. hardware/hardware_profile predate #1102; the
// frozen-geometry kinds freeze the authoring org's catalog so a pinned
// resolve never reads live tables for geometry.
const (
	ModuleResourceKind           = "module"
	StructureResourceKind        = "structure"
	ComponentResourceKind        = "component"
	AgregadoResourceKind         = "agregado"
	MaterialResourceKind         = "material"
	EdgeBandResourceKind         = "edge_band"
	OptionGroupResourceKind      = "option_group"
	ModuleCategoryResourceKind   = "module_category"
	MaterialCategoryResourceKind = "material_category"
)

// BuildStandardReleaseInputs assembles the compilation resources from the
// assembled organization catalog (one consistent GetFullCatalog snapshot —
// module board parts and hardware lines included) plus every active
// hardware profile (cross-org, Granete-staff authority). Fail-closed: an
// invalid module or a non-uuid id never enters an immutable release.
func BuildStandardReleaseInputs(
	catalog domain.Catalog,
	materialCategories []domain.MaterialCategory,
	profiles []domain.HardwareProfile,
) ([]CompilationResourceInput, error) {
	inputs := make([]CompilationResourceInput, 0, 64)

	emit := func(kind, rawID, revision, label string, entity any) error {
		id, err := uuid.Parse(rawID)
		if err != nil {
			// The release contract pins resources by uuid (#772); some
			// catalog tables legitimately carry TEXT ids (agregados). A
			// non-uuid entity cannot be represented in a release, so it is
			// skipped loudly rather than failing the publish — a pinned
			// consumer will not see it.
			slog.Warn("release_compile_skipped_non_uuid_resource", "kind", kind, "id", rawID, "label", label)
			return nil
		}
		raw, err := json.Marshal(entity)
		if err != nil {
			return fmt.Errorf("marshal %s %s: %w", kind, label, err)
		}
		inputs = append(inputs, CompilationResourceInput{
			Kind:        kind,
			ID:          id,
			Revision:    revision,
			PackageKind: domain.PackageKindFree,
			RawJSON:     raw,
		})
		return nil
	}
	versionRevision := func(version int64) string {
		if version <= 0 {
			return "rev-1"
		}
		return fmt.Sprintf("v%d", version)
	}

	for i := range catalog.Hardware {
		hw := &catalog.Hardware[i]
		if !hw.Active {
			continue
		}
		if err := emit(HardwareResourceKind, hw.ID, hardwareRevision(hw), hw.Code, hw); err != nil {
			return nil, err
		}
	}
	for i := range catalog.Materials {
		material := &catalog.Materials[i]
		if err := emit(MaterialResourceKind, material.ID, versionRevision(material.Version), material.Code, material); err != nil {
			return nil, err
		}
	}
	for i := range catalog.Edges {
		edge := &catalog.Edges[i]
		if err := emit(EdgeBandResourceKind, edge.ID, versionRevision(edge.Version), edge.Code, edge); err != nil {
			return nil, err
		}
	}
	for i := range catalog.OptionGroups {
		group := &catalog.OptionGroups[i]
		if err := emit(OptionGroupResourceKind, group.ID, versionRevision(group.Version), group.Code, group); err != nil {
			return nil, err
		}
	}
	for i := range catalog.Categories {
		category := &catalog.Categories[i]
		if err := emit(ModuleCategoryResourceKind, category.ID, versionRevision(category.Version), category.Name, category); err != nil {
			return nil, err
		}
	}
	for i := range materialCategories {
		category := &materialCategories[i]
		if err := emit(MaterialCategoryResourceKind, category.ID, versionRevision(category.Version), category.Name, category); err != nil {
			return nil, err
		}
	}
	for i := range catalog.Agregados {
		agregado := &catalog.Agregados[i]
		if err := emit(AgregadoResourceKind, agregado.ID, versionRevision(agregado.Version), agregado.Code, agregado); err != nil {
			return nil, err
		}
	}
	for i := range catalog.Components {
		component := &catalog.Components[i]
		if err := emit(ComponentResourceKind, component.ID, versionRevision(component.Version), component.Code, component); err != nil {
			return nil, err
		}
	}
	for i := range catalog.Structures {
		structure := &catalog.Structures[i]
		if err := emit(StructureResourceKind, structure.ID, versionRevision(int64(structure.Revision)), structure.Code, structure); err != nil {
			return nil, err
		}
	}
	for i := range catalog.Modules {
		module := &catalog.Modules[i]
		// Same gate the resolve runs: a module that cannot validate must not
		// be frozen into an immutable release.
		if err := engine.ValidateModule(*module); err != nil {
			return nil, fmt.Errorf("module %s (%s): %w", module.Code, module.ID, err)
		}
		if err := emit(ModuleResourceKind, module.ID, versionRevision(module.Version), module.Code, module); err != nil {
			return nil, err
		}
	}

	profileCount := 0
	for i := range profiles {
		resource, err := BuildHardwareProfileResource(&profiles[i], domain.PackageKindFree)
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

	// ONE consistent org-catalog snapshot feeds the frozen geometry: the
	// same assembled rows (board parts, hardware lines) the live resolve
	// reads, frozen per entity into the release.
	catalog, err := store.GetFullCatalog(ctx)
	if err != nil {
		return nil, fmt.Errorf("gather authoring catalog: %w", err)
	}
	materialCategories, err := store.ListMaterialCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("gather material categories: %w", err)
	}
	profiles, err := store.ListActiveHardwareProfilesAnyOrg(ctx)
	if err != nil {
		return nil, fmt.Errorf("gather hardware profile resources: %w", err)
	}
	inputs, err := BuildStandardReleaseInputs(catalog, materialCategories, profiles)
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
	CatalogReader
	MaterialCategoryReader
	HardwareProfileReader
	GetReleaseByID(ctx context.Context, releaseID uuid.UUID) (*domain.LibraryRelease, error)
	PublishReleaseWithManifest(ctx context.Context, releaseID uuid.UUID, manifest *domain.LibraryManifest, manifestBytes []byte, blobs []domain.ResourceBlob, publishedBy *uuid.UUID) error
	// Demo seed surface (#955/#964): org-scoped like every catalog call;
	// the seed runs under the caller's organization context (per-org
	// provisioning).
	GetHardwareProfileByID(ctx context.Context, id string) (*domain.HardwareProfile, error)
	CreateHardwareProfile(ctx context.Context, p *domain.HardwareProfile) error
	CreateHardware(ctx context.Context, h *domain.Hardware) error
	EnsureSeedPlatformUser(ctx context.Context) (string, error)
	// ResetManifestlessPublishedRelease is strictly a test/demo fixture repair helper (#955).
	ResetManifestlessPublishedRelease(ctx context.Context, releaseID string) (bool, error)
	// Overlay surface of the tuned demo construction policy (#1065): the
	// seed provisions the org's factory overlay only when the org does not
	// own one yet — an explicit factory decision is never overwritten.
	GetActiveOverlayByLibrary(ctx context.Context, organizationID, libraryID uuid.UUID) (*domain.LibraryOverlay, error)
	CreateOverlay(ctx context.Context, overlay *domain.LibraryOverlay) (*domain.LibraryOverlay, error)
	UpdateOverlayOverrides(ctx context.Context, id uuid.UUID, expectedVersion int64, overrides json.RawMessage, customResourceIDs []uuid.UUID) error
}
