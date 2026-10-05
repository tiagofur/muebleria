package application

// #1102 Slice B: the read-only "probar borrador" — compile dry-run equals the
// publisher's inputs; furniture batch resolves through the plugin engine.

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

type stubValidationStore struct {
	release   *domain.LibraryRelease
	hardware  []domain.Hardware
	profiles  []domain.HardwareProfile
	modules   []domain.Module
	structure []domain.Structure
	component []domain.Component
	agregado  []domain.Agregado
	material  []domain.MaterialBoard
}

func (s *stubValidationStore) GetReleaseByID(_ context.Context, _ uuid.UUID) (*domain.LibraryRelease, error) {
	if s.release == nil {
		return nil, storage.ErrLibraryReleaseNotFound
	}
	return s.release, nil
}

func (s *stubValidationStore) ListHardwares(context.Context) ([]domain.Hardware, error) {
	return s.hardware, nil
}

func (s *stubValidationStore) ListActiveHardwareProfilesAnyOrg(context.Context) ([]domain.HardwareProfile, error) {
	return s.profiles, nil
}

func (s *stubValidationStore) ListModules(context.Context) ([]domain.Module, error) {
	return s.modules, nil
}

func (s *stubValidationStore) ListStructures(context.Context) ([]domain.Structure, error) {
	return s.structure, nil
}

func (s *stubValidationStore) ListComponents(context.Context) ([]domain.Component, error) {
	return s.component, nil
}

func (s *stubValidationStore) ListAgregados(context.Context) ([]domain.Agregado, error) {
	return s.agregado, nil
}

func (s *stubValidationStore) ListMaterialBoards(context.Context) ([]domain.MaterialBoard, error) {
	return s.material, nil
}

func validateTestRelease() *domain.LibraryRelease {
	return &domain.LibraryRelease{
		ID:            uuid.MustParse(domain.GraneteStandardDraftReleaseID),
		LibraryID:     uuid.MustParse(domain.GraneteStandardLibraryID),
		Version:       "0.4.0",
		Status:        domain.ReleaseStatusDraft,
		SchemaVersion: domain.LibraryManifestSchemaVersion,
	}
}

// validProfile mirrors the #912-valid fixture the publish flow tests use.
func validProfile() domain.HardwareProfile {
	return domain.HardwareProfile{
		ID: "a0000010-0000-0000-0000-000000000001", Code: "PERF-X", Name: "X", Revision: "r1", Active: true,
		Items: []domain.HardwareProfileItem{{HardwareID: "a0000003-0000-0000-0000-000000000012", Quantity: 1}},
	}
}

func TestValidateStandardDraft(t *testing.T) {
	ctx := context.Background()
	releaseID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)

	resolvableModule := func() domain.Module {
		return domain.Module{ID: "m-1", Code: "VIG-A", Name: "Vigas A", WidthMm: 600, HeightMm: 720, DepthMm: 560}
	}

	t.Run("reports a clean draft: compile dry-run and every module resolve", func(t *testing.T) {
		store := &stubValidationStore{
			release:  validateTestRelease(),
			profiles: []domain.HardwareProfile{validProfile()},
			modules:  []domain.Module{resolvableModule()},
		}
		report, err := ValidateStandardDraft(ctx, store, releaseID)
		if err != nil {
			t.Fatalf("validate: %v", err)
		}
		if !report.OK {
			t.Fatalf("report not ok: %+v", report)
		}
		if !report.Compile.OK || report.Compile.ResourceCount != 1 || report.Compile.ManifestHash == "" {
			t.Fatalf("compile check = %+v", report.Compile)
		}
		if report.Furniture.Total != 1 || report.Furniture.Resolved != 1 || report.Furniture.Failed != 0 {
			t.Fatalf("furniture check = %+v", report.Furniture)
		}
	})

	t.Run("compile failures surface in the report without aborting the batch", func(t *testing.T) {
		store := &stubValidationStore{
			release: validateTestRelease(),
			// No active profiles: the exact fail-closed condition publish hits.
			profiles: []domain.HardwareProfile{},
			modules:  []domain.Module{resolvableModule()},
		}
		report, err := ValidateStandardDraft(ctx, store, releaseID)
		if err != nil {
			t.Fatalf("validate: %v", err)
		}
		if report.OK {
			t.Fatal("report must not be ok when the compile dry-run fails")
		}
		if report.Compile.OK || !strings.Contains(report.Compile.Error, "profile") {
			t.Fatalf("compile check = %+v", report.Compile)
		}
		if report.Furniture.Resolved != 1 {
			t.Fatalf("batch must still run: %+v", report.Furniture)
		}
	})

	t.Run("unresolvable furniture is reported per definition", func(t *testing.T) {
		broken := resolvableModule()
		broken.ID = "m-2"
		broken.Code = "VIG-B"
		broken.WidthMm = 0 // no valid measures → resolve error
		store := &stubValidationStore{
			release:  validateTestRelease(),
			profiles: []domain.HardwareProfile{validProfile()},
			modules:  []domain.Module{resolvableModule(), broken},
		}
		report, err := ValidateStandardDraft(ctx, store, releaseID)
		if err != nil {
			t.Fatalf("validate: %v", err)
		}
		if report.OK {
			t.Fatal("report must not be ok when a definition fails to resolve")
		}
		if report.Furniture.Total != 2 || report.Furniture.Resolved != 1 || report.Furniture.Failed != 1 {
			t.Fatalf("furniture check = %+v", report.Furniture)
		}
		failure := report.Furniture.Failures[0]
		if failure.ID != "m-2" || failure.Code != "VIG-B" || failure.Error == "" {
			t.Fatalf("failure = %+v", failure)
		}
	})

	t.Run("mirrors publish guards: unknown, foreign library and not-draft", func(t *testing.T) {
		if _, err := ValidateStandardDraft(ctx, &stubValidationStore{}, releaseID); !errors.Is(err, storage.ErrLibraryReleaseNotFound) {
			t.Fatalf("unknown release err = %v", err)
		}
		foreign := validateTestRelease()
		foreign.LibraryID = uuid.MustParse("00000000-0000-0000-0002-000000000099")
		if _, err := ValidateStandardDraft(ctx, &stubValidationStore{release: foreign}, releaseID); !errors.Is(err, ErrStandardLibraryNotFound) {
			t.Fatalf("foreign library err = %v", err)
		}
		published := validateTestRelease()
		published.Status = domain.ReleaseStatusPublished
		if _, err := ValidateStandardDraft(ctx, &stubValidationStore{release: published}, releaseID); !errors.Is(err, ErrReleaseNotDraft) {
			t.Fatalf("not-draft err = %v", err)
		}
	})
}
