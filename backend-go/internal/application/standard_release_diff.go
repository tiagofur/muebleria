package application

// #1102 Slice C: the publish-confirmation diff — what WOULD change between
// the current published release and the draft's authoring state. Read-only:
// it runs the same compile dry-run as the "probar borrador" validation and
// compares per-resource definition hashes against the published manifest.
// The publish itself stays the only writer (#955).

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// StandardDraftDiffStore is the read surface the publish diff needs;
// satisfied by *storage.PostgresStore and by handler-test stubs.
type StandardDraftDiffStore interface {
	GetReleaseByID(ctx context.Context, releaseID uuid.UUID) (*domain.LibraryRelease, error)
	GetCurrentPublishedRelease(ctx context.Context, libraryID uuid.UUID) (*domain.LibraryRelease, error)
	GetReleaseManifest(ctx context.Context, releaseID uuid.UUID) (*domain.LibraryManifest, []byte, error)
	GetResourceBlob(ctx context.Context, sha256 string) (*domain.ResourceBlob, error)
	CatalogReader
	MaterialCategoryReader
	HardwareProfileReader
}

// DraftResourceChange is one resource that differs between the published
// release and the draft, with its human label when recoverable.
type DraftResourceChange struct {
	Kind string
	ID   string
	Code string
	Name string
}

// DraftDiffBase identifies the release the draft is compared against; nil
// when nothing has been published yet.
type DraftDiffBase struct {
	ReleaseID string
	Version   string
}

// DraftDiffReport is the publish-confirmation summary.
type DraftDiffReport struct {
	ReleaseID  string
	Version    string
	Base       *DraftDiffBase
	Added      []DraftResourceChange
	Modified   []DraftResourceChange
	Removed    []DraftResourceChange
	Unchanged  int
	ComputedAt time.Time
}

// DiffStandardDraft computes the draft-vs-published comparison. Fail-closed
// guards mirror publish/validate (404/409 at the HTTP layer). A published
// release without its manifest is an infrastructure error, never an empty
// diff: a publish decision needs the real base.
func DiffStandardDraft(
	ctx context.Context,
	store StandardDraftDiffStore,
	releaseID uuid.UUID,
) (*DraftDiffReport, error) {
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

	// The draft side: the publisher's exact inputs, with human labels parsed
	// from the canonical payloads (hardware and profiles both carry
	// code/name).
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
		return nil, fmt.Errorf("gather draft resources: %w", err)
	}
	type draftResource struct {
		hash   string
		change DraftResourceChange
	}
	draft := make(map[string]draftResource, len(inputs))
	for _, input := range inputs {
		code, name := resourceLabel(input.RawJSON)
		draft[input.Kind+":"+input.ID.String()] = draftResource{
			change: DraftResourceChange{
				Kind: input.Kind,
				ID:   input.ID.String(),
				Code: code,
				Name: name,
			},
		}
	}

	// The draft hashes come from a dry-run compilation: same canonicalization
	// the publisher records.
	dryRun, err := CompileLibraryRelease(CompilationInput{
		Library:   &domain.ManufacturingLibrary{ID: release.LibraryID, Code: "0001", Kind: domain.LibraryKindStandard, Status: "active"},
		Release:   release,
		Resources: inputs,
	})
	if err != nil {
		return nil, fmt.Errorf("compile draft for diff: %w", err)
	}
	for _, ref := range dryRun.Manifest.Resources {
		key := ref.Kind + ":" + ref.ID.String()
		entry := draft[key]
		entry.hash = ref.DefinitionHash
		draft[key] = entry
	}

	report := &DraftDiffReport{
		ReleaseID:  releaseID.String(),
		Version:    release.Version,
		Added:      []DraftResourceChange{},
		Modified:   []DraftResourceChange{},
		Removed:    []DraftResourceChange{},
		ComputedAt: time.Now().UTC(),
	}

	// The published side: nil base means the library has NO usable published
	// base — either nothing was ever published, or the current release is in
	// the #955 manifestless repair state (it cannot serve pinned content, so
	// it is not a base the draft can be diffed against). Either way the whole
	// draft is then "added".
	base, err := store.GetCurrentPublishedRelease(ctx, release.LibraryID)
	if err != nil && !errors.Is(err, storage.ErrLibraryReleaseNotFound) {
		return nil, fmt.Errorf("load published base: %w", err)
	}
	var baseManifest *domain.LibraryManifest
	if base != nil {
		baseManifest, _, err = store.GetReleaseManifest(ctx, base.ID)
		if err != nil {
			if !errors.Is(err, storage.ErrManifestNotFound) {
				return nil, fmt.Errorf("load published manifest for diff (base %s): %w", base.ID, err)
			}
			base = nil
		}
	}
	if base == nil {
		report.Base = nil
		for _, entry := range draft {
			report.Added = append(report.Added, entry.change)
		}
		return report, nil
	}
	report.Base = &DraftDiffBase{ReleaseID: base.ID.String(), Version: base.Version}

	published := make(map[string]domain.ManifestResourceRef, len(baseManifest.Resources))
	for _, ref := range baseManifest.Resources {
		published[ref.Kind+":"+ref.ID.String()] = ref
	}

	for key, entry := range draft {
		baseRef, exists := published[key]
		switch {
		case !exists:
			report.Added = append(report.Added, entry.change)
		case baseRef.DefinitionHash != entry.hash:
			report.Modified = append(report.Modified, entry.change)
			delete(published, key)
		default:
			report.Unchanged++
			delete(published, key)
		}
	}
	// Whatever survived in `published` is not in the draft anymore.
	for _, ref := range published {
		report.Removed = append(report.Removed, removedResourceChange(ctx, store, ref))
	}
	return report, nil
}

// removedResourceChange labels a removed resource from its content-addressed
// blob; an unreadable blob degrades to kind+id rather than failing the diff.
func removedResourceChange(ctx context.Context, store StandardDraftDiffStore, ref domain.ManifestResourceRef) DraftResourceChange {
	change := DraftResourceChange{Kind: ref.Kind, ID: ref.ID.String()}
	blob, err := store.GetResourceBlob(ctx, ref.DefinitionHash)
	if err != nil {
		return change
	}
	code, name := resourceLabel(blob.Content)
	change.Code, change.Name = code, name
	return change
}

// resourceLabel extracts code/name from a canonical resource payload; both
// gathered kinds (hardware, hardware profiles) carry those JSON fields.
func resourceLabel(raw json.RawMessage) (string, string) {
	var labeled struct {
		Code string `json:"code"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(raw, &labeled); err != nil {
		return "", ""
	}
	return labeled.Code, labeled.Name
}
