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
	CatalogReader
	MaterialCategoryReader
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

	// ONE catalog snapshot feeds both checks — the exact rows the publisher
	// would freeze.
	catalog, catalogErr := store.GetFullCatalog(ctx)
	if catalogErr != nil {
		return nil, fmt.Errorf("gather authoring catalog: %w", catalogErr)
	}
	materialCategories, err := store.ListMaterialCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("gather material categories: %w", err)
	}
	profiles, err := store.ListActiveHardwareProfilesAnyOrg(ctx)
	if err != nil {
		return nil, fmt.Errorf("gather hardware profile resources: %w", err)
	}

	report.Compile = validateDraftCompile(release, catalog, materialCategories, profiles)

	report.Furniture = validateDraftFurniture(catalog)

	report.OK = report.Compile.OK && report.Furniture.Failed == 0
	return report, nil
}

// validateDraftCompile mirrors PublishStandardRelease's gather+compile step
// and discards the result — the pre-publish answer to "would this publish?".
func validateDraftCompile(release *domain.LibraryRelease, catalog domain.Catalog, materialCategories []domain.MaterialCategory, profiles []domain.HardwareProfile) DraftCompileCheck {
	inputs, err := BuildStandardReleaseInputs(catalog, materialCategories, profiles)
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
// assembled catalog through the plugin-insertion engine.
func validateDraftFurniture(catalog domain.Catalog) DraftFurnitureCheck {
	modules := catalog.Modules
	// The engine accepts nil dims: the module's own dimensions — what a
	// consumer gets before touching any dialog. Hardware choices are seeded
	// like the insertion configurator does (#1174): first ACTIVE member of
	// every kind=hardware group. Since #1046/#1146 a required hardware group
	// without a choice fails the resolve closed by design — the concrete
	// model is the consumer's pick, never the release's — so the old
	// nil-choices baseline failed every definition that consumes one. A
	// required group with no active member still fails: a real catalog
	// defect the report must surface (the configurator blocks Insert with a
	// reason in that case). Board-kind roles stay unseeded: an unchosen
	// board role keeps its deterministic fallback, exactly as before.

	check := DraftFurnitureCheck{Failures: []DraftFurnitureFailure{}}
	choices := defaultHardwareChoices(catalog)
	// Modules carry no active flag (hard delete owns retirement): every
	// module row in the caller's catalog IS the draft's furniture surface.
	for i := range modules {
		module := &modules[i]
		check.Total++
		if _, err := engine.ResolveFurnitureLayout(*module, catalog, nil, choices); err != nil {
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
	return check
}

// defaultHardwareChoices seeds every kind=hardware option group with its
// first ACTIVE member — the same default the insertion configurator
// preselects before Insert (seedLibraryHardwareChoices: optionIds[0] of the
// active-filtered role). Groups with no active member stay unseeded:
// required ones fail the resolve closed (a real catalog defect) and
// optional ones keep the engine's drop-the-placement semantics. Board-kind
// groups are never seeded — board roles own their deterministic fallback.
func defaultHardwareChoices(catalog domain.Catalog) map[string]string {
	active := make(map[string]bool, len(catalog.Hardware))
	for _, h := range catalog.Hardware {
		if h.Active {
			active[h.ID] = true
		}
	}
	choices := make(map[string]string)
	for _, g := range catalog.OptionGroups {
		if g.Kind != "hardware" {
			continue
		}
		for _, optionID := range g.OptionIDs {
			if active[optionID] {
				choices[g.Code] = optionID
				break
			}
		}
	}
	if len(choices) == 0 {
		return nil
	}
	return choices
}
