package application

// #1102 Slice B: read-only pre-publish validation — the bibliotecario's
// "probar borrador". Runs the EXACT compile inputs the publisher will gather
// (BuildStandardReleaseInputs → CompileLibraryRelease) without persisting
// anything, plus a batch resolve of every furniture definition through
// the same engine the plugin insertion uses (ResolveFurnitureLayout). Nothing
// here mutates state: the only writers remain create/publish (#955).

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// StandardDraftValidationStore is the read surface the draft validation
// needs; satisfied by *storage.PostgresStore (org-scoped via RLS — the
// furniture batch validates the caller's organization catalog) and by
// handler-test stubs.
type StandardDraftValidationStore interface {
	GetReleaseByID(ctx context.Context, releaseID uuid.UUID) (*domain.LibraryRelease, error)
	HardwareReader
	HardwareProfileReader
	ListModules(ctx context.Context) ([]domain.Module, error)
	ListStructures(ctx context.Context) ([]domain.Structure, error)
	ListComponents(ctx context.Context) ([]domain.Component, error)
	ListAgregados(ctx context.Context) ([]domain.Agregado, error)
	ListMaterialBoards(ctx context.Context) ([]domain.MaterialBoard, error)
}

// DraftCompileCheck reports the publish dry-run: the exact resource gather +
// deterministic compilation the publisher performs, executed without writing.
type DraftCompileCheck struct {
	OK            bool
	ResourceCount int
	ManifestHash  string
	Error         string
}

// DraftFurnitureFailure is one furniture definition that did not resolve.
type DraftFurnitureFailure struct {
	ID    string
	Code  string
	Name  string
	Error string
}

// DraftFurnitureCheck aggregates the batch resolve of active definitions.
type DraftFurnitureCheck struct {
	Total    int
	Resolved int
	Failed   int
	Failures []DraftFurnitureFailure
}

// DraftValidationReport is the structured "probar borrador" result.
type DraftValidationReport struct {
	ReleaseID   uuid.UUID
	Version     string
	OK          bool
	Compile     DraftCompileCheck
	Furniture   DraftFurnitureCheck
	ValidatedAt time.Time
}

// ValidateStandardDraft validates the authoring state against a draft release
// identity: compile dry-run (hardware + #912-valid hardware profiles — the
// publisher's exact inputs) and one resolve per furniture definition.
// Catalog-list failures are infrastructure errors (returned, not reported);
// per-definition resolve failures ARE the report.
func ValidateStandardDraft(
	ctx context.Context,
	store StandardDraftValidationStore,
	releaseID uuid.UUID,
) (*DraftValidationReport, error) {
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

	report := &DraftValidationReport{
		ReleaseID:   releaseID,
		Version:     release.Version,
		ValidatedAt: time.Now().UTC(),
	}

	report.Compile = validateDraftCompile(ctx, store, release)

	furniture, err := validateDraftFurniture(ctx, store)
	if err != nil {
		return nil, err
	}
	report.Furniture = furniture

	report.OK = report.Compile.OK && report.Furniture.Failed == 0
	return report, nil
}

// validateDraftCompile mirrors PublishStandardRelease's gather+compile step
// and discards the result — the pre-publish answer to "would this publish?".
func validateDraftCompile(ctx context.Context, store StandardDraftValidationStore, release *domain.LibraryRelease) DraftCompileCheck {
	inputs, err := BuildStandardReleaseInputs(ctx, store, store)
	if err != nil {
		return DraftCompileCheck{OK: false, Error: err.Error()}
	}
	result, err := CompileLibraryRelease(CompilationInput{
		Library:   &domain.ManufacturingLibrary{ID: release.LibraryID, Code: "0001", Kind: domain.LibraryKindStandard, Status: "active"},
		Release:   release,
		Resources: inputs,
	})
	if err != nil {
		return DraftCompileCheck{OK: false, ResourceCount: len(inputs), Error: err.Error()}
	}
	return DraftCompileCheck{OK: true, ResourceCount: len(result.Manifest.Resources), ManifestHash: result.ManifestHash}
}

// validateDraftFurniture resolves every furniture definition of the
// caller's organization catalog through the plugin-insertion engine.
func validateDraftFurniture(ctx context.Context, store StandardDraftValidationStore) (DraftFurnitureCheck, error) {
	modules, err := store.ListModules(ctx)
	if err != nil {
		return DraftFurnitureCheck{}, fmt.Errorf("list modules: %w", err)
	}
	structures, err := store.ListStructures(ctx)
	if err != nil {
		return DraftFurnitureCheck{}, fmt.Errorf("list structures: %w", err)
	}
	components, err := store.ListComponents(ctx)
	if err != nil {
		return DraftFurnitureCheck{}, fmt.Errorf("list components: %w", err)
	}
	agregados, err := store.ListAgregados(ctx)
	if err != nil {
		return DraftFurnitureCheck{}, fmt.Errorf("list agregados: %w", err)
	}
	hardware, err := store.ListHardwares(ctx)
	if err != nil {
		return DraftFurnitureCheck{}, fmt.Errorf("list hardware: %w", err)
	}
	materials, err := store.ListMaterialBoards(ctx)
	if err != nil {
		return DraftFurnitureCheck{}, fmt.Errorf("list materials: %w", err)
	}

	// The engine accepts nil dims/choices: the module's own dimensions and its
	// catalog defaults — what a consumer gets before touching any dialog.
	catalog := domain.Catalog{
		Structures: structures,
		Components: components,
		Agregados:  agregados,
		Hardware:   hardware,
		Materials:  materials,
	}

	check := DraftFurnitureCheck{Failures: []DraftFurnitureFailure{}}
	// Modules carry no active flag (hard delete owns retirement): every
	// module row in the caller's catalog IS the draft's furniture surface.
	for i := range modules {
		module := &modules[i]
		check.Total++
		if _, err := engine.ResolveFurnitureLayout(*module, catalog, nil, nil); err != nil {
			check.Failed++
			check.Failures = append(check.Failures, DraftFurnitureFailure{
				ID:    module.ID,
				Code:  module.Code,
				Name:  module.Name,
				Error: err.Error(),
			})
			continue
		}
		check.Resolved++
	}
	return check, nil
}
