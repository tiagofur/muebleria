package application

// #1185: a non-UUID authoring entity can never enter an immutable release
// (the refs pin resources by uuid), but the exclusion must never be silent:
// the gather reports the exact list and validate/publish surface it.

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestBuildStandardReleaseInputsReportsNonUUIDSkips(t *testing.T) {
	validProfile := domain.HardwareProfile{
		ID: "a0000010-0000-0000-0000-000000000001", Code: "PERF-X", Name: "X", Revision: "r1", Active: true,
		Items: []domain.HardwareProfileItem{{HardwareID: "a0000003-0000-0000-0000-000000000012", Quantity: 1}},
	}
	catalog := domain.Catalog{
		Hardware: []domain.Hardware{
			{ID: "a0000003-0000-0000-0000-000000000012", Code: "HW-UUID", Name: "Bisagra uuid", Active: true},
			{ID: "hw-text-id", Code: "HW-TEXT", Name: "Bisagra texto", Active: true},
		},
		Materials: []domain.MaterialBoard{
			{ID: "mat-text-id", Code: "MDF-TEXT", Name: "Tablero texto", Active: true},
		},
		Edges: []domain.EdgeBand{
			{ID: "edge-text-id", Code: "EDGE-TEXT", Name: "Canto texto", Active: true},
		},
		OptionGroups: []domain.OptionGroup{
			{ID: "group-text-id", Code: "GRP-TEXT", Name: "Grupo texto"},
		},
		Categories: []domain.ModuleCategory{
			{ID: "cat-text-id", Name: "Categoría texto"},
		},
		Agregados: []domain.Agregado{
			{ID: "agr-1788636544276-xfbr", Code: "AGR-TEXT", Name: "Puerta texto", Version: 1, Active: true},
			{ID: "a0000009-0000-0000-0000-000000000001", Code: "AGR-UUID", Name: "Puerta uuid", Version: 1, Active: true},
		},
		Components: []domain.Component{
			{ID: "comp-text-id", Code: "COMP-TEXT", Name: "Componente texto", Active: true},
		},
		Structures: []domain.Structure{
			{ID: "str-text-id", Code: "STR-TEXT", Name: "Estructura texto", Active: true},
		},
		Modules: []domain.Module{
			{ID: "mod-text-id", Code: "MOD-TEXT", Name: "Módulo texto"},
		},
	}

	inputs, skipped, err := BuildStandardReleaseInputs(catalog, nil, []domain.HardwareProfile{validProfile})
	if err != nil {
		t.Fatalf("gather: %v", err)
	}

	// Every text-id entity is reported by kind — never silently dropped.
	reported := map[string]SkippedReleaseResource{}
	for _, resource := range skipped {
		if _, seen := reported[resource.Kind]; seen {
			t.Fatalf("kind %s reported twice: %+v", resource.Kind, skipped)
		}
		reported[resource.Kind] = resource
	}
	for kind, wantID := range map[string]string{
		HardwareResourceKind:       "hw-text-id",
		MaterialResourceKind:       "mat-text-id",
		EdgeBandResourceKind:       "edge-text-id",
		OptionGroupResourceKind:    "group-text-id",
		ModuleCategoryResourceKind: "cat-text-id",
		AgregadoResourceKind:       "agr-1788636544276-xfbr",
		ComponentResourceKind:      "comp-text-id",
		StructureResourceKind:      "str-text-id",
		ModuleResourceKind:         "mod-text-id",
	} {
		got, ok := reported[kind]
		if !ok {
			t.Fatalf("kind %s missing from skip report: %+v", kind, skipped)
		}
		if got.ID != wantID || got.Label == "" {
			t.Fatalf("kind %s skip = %+v (want id %s and a label)", kind, got, wantID)
		}
	}
	if len(skipped) != 9 {
		t.Fatalf("skipped = %d entries, want 9: %+v", len(skipped), skipped)
	}

	// The UUID-identity entities made it into the inputs.
	ids := map[string]bool{}
	for _, input := range inputs {
		ids[input.Kind+"/"+input.ID.String()] = true
	}
	if !ids[AgregadoResourceKind+"/a0000009-0000-0000-0000-000000000001"] {
		t.Fatalf("uuid agregado missing from inputs: %+v", ids)
	}
	if !ids[HardwareResourceKind+"/a0000003-0000-0000-0000-000000000012"] {
		t.Fatalf("uuid hardware missing from inputs: %+v", ids)
	}
	if ids[AgregadoResourceKind+"/agr-1788636544276-xfbr"] {
		t.Fatal("a text-id entity entered the inputs")
	}
}

type stubPublishStore struct {
	release   *domain.LibraryRelease
	profiles  []domain.HardwareProfile
	catalog   domain.Catalog
	published *domain.LibraryManifest
}

func (s *stubPublishStore) GetReleaseByID(_ context.Context, id uuid.UUID) (*domain.LibraryRelease, error) {
	if s.release == nil || s.release.ID != id {
		return nil, storage.ErrLibraryReleaseNotFound
	}
	return s.release, nil
}
func (s *stubPublishStore) GetFullCatalog(context.Context) (domain.Catalog, error) {
	return s.catalog, nil
}
func (s *stubPublishStore) ListMaterialCategories(context.Context) ([]domain.MaterialCategory, error) {
	return nil, nil
}
func (s *stubPublishStore) ListActiveHardwareProfilesAnyOrg(context.Context) ([]domain.HardwareProfile, error) {
	return s.profiles, nil
}
func (s *stubPublishStore) PublishReleaseWithManifest(_ context.Context, _ uuid.UUID, manifest *domain.LibraryManifest, _ []byte, _ []domain.ResourceBlob, _ *uuid.UUID) error {
	s.published = manifest
	return nil
}
func (s *stubPublishStore) GetHardwareProfileByID(_ context.Context, id string) (*domain.HardwareProfile, error) {
	for i := range s.profiles {
		if s.profiles[i].ID == id {
			return &s.profiles[i], nil
		}
	}
	return nil, fmt.Errorf("hardware profile not found")
}
func (s *stubPublishStore) CreateHardwareProfile(_ context.Context, p *domain.HardwareProfile) error {
	s.profiles = append(s.profiles, *p)
	return nil
}
func (s *stubPublishStore) CreateHardware(context.Context, *domain.Hardware) error { return nil }
func (s *stubPublishStore) EnsureSeedPlatformUser(context.Context) (string, error) {
	return "22222222-2222-2222-2222-222222222222", nil
}
func (s *stubPublishStore) ResetManifestlessPublishedRelease(context.Context, string) (bool, error) {
	return false, nil
}
func (s *stubPublishStore) GetActiveOverlayByLibrary(context.Context, uuid.UUID, uuid.UUID) (*domain.LibraryOverlay, error) {
	return nil, storage.ErrOverlayNotFound
}
func (s *stubPublishStore) CreateOverlay(_ context.Context, overlay *domain.LibraryOverlay) (*domain.LibraryOverlay, error) {
	return overlay, nil
}
func (s *stubPublishStore) UpdateOverlayOverrides(context.Context, uuid.UUID, int64, json.RawMessage, []uuid.UUID) error {
	return nil
}

func TestPublishStandardReleaseReturnsSkips(t *testing.T) {
	releaseID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)
	store := &stubPublishStore{
		release: &domain.LibraryRelease{
			ID: releaseID, LibraryID: uuid.MustParse(domain.GraneteStandardLibraryID),
			Version: "0.4.0", Status: domain.ReleaseStatusDraft, SchemaVersion: domain.LibraryManifestSchemaVersion,
		},
		profiles: []domain.HardwareProfile{{
			ID: "a0000010-0000-0000-0000-000000000001", Code: "PERF-X", Name: "X", Revision: "r1", Active: true,
			Items: []domain.HardwareProfileItem{{HardwareID: "a0000003-0000-0000-0000-000000000012", Quantity: 1}},
		}},
		catalog: domain.Catalog{
			Hardware: []domain.Hardware{},
			Agregados: []domain.Agregado{
				{ID: "agr-1788636544276-xfbr", Code: "AGR-TEXT", Name: "Puerta texto", Version: 1, Active: true},
			},
		},
	}

	result, skipped, err := PublishStandardRelease(context.Background(), store, releaseID, uuid.MustParse("22222222-2222-2222-2222-222222222222"))
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if store.published == nil {
		t.Fatal("publish did not persist the manifest")
	}
	if len(skipped) != 1 || skipped[0].Kind != AgregadoResourceKind || skipped[0].ID != "agr-1788636544276-xfbr" {
		t.Fatalf("skips = %+v", skipped)
	}
	if store.published == nil || len(store.published.Resources) == 0 {
		t.Fatal("publish did not persist the manifest")
	}
	// The catalog's only agregado carries a text id, so the manifest may not
	// contain any agregado resource at all.
	for _, resource := range result.Manifest.Resources {
		if resource.Kind == AgregadoResourceKind {
			t.Fatalf("the skipped entity leaked into the manifest: %+v", resource)
		}
	}
}

// TestValidateStandardDraftReportsSkips (#1185): the dry-run surfaces the
// same exclusion list the publish will carry — the bibliotecario sees it
// BEFORE publishing. The chronic text-id agregados do not flip ok.
func TestValidateStandardDraftReportsSkips(t *testing.T) {
	store := &stubValidationStore{
		release: validateTestRelease(),
		profiles: []domain.HardwareProfile{{
			ID: "a0000010-0000-0000-0000-000000000001", Code: "PERF-X", Name: "X", Revision: "r1", Active: true,
			Items: []domain.HardwareProfileItem{{HardwareID: "a0000003-0000-0000-0000-000000000012", Quantity: 1}},
		}},
		agregado: []domain.Agregado{
			{ID: "agr-1788636544276-xfbr", Code: "AGR-TEXT", Name: "Puerta texto", Version: 1, Active: true},
		},
	}

	report, err := ValidateStandardDraft(context.Background(), store, uuid.MustParse(domain.GraneteStandardDraftReleaseID))
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if len(report.Skipped) != 1 || report.Skipped[0].Kind != AgregadoResourceKind || report.Skipped[0].Label != "AGR-TEXT" {
		t.Fatalf("report.Skipped = %+v", report.Skipped)
	}
	if !report.Compile.OK {
		t.Fatalf("compile check = %+v", report.Compile)
	}
	if !report.OK {
		t.Fatalf("ok flipped by a reported skip: %+v", report)
	}
}
