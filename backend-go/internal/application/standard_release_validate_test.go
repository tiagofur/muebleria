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
	groups    []domain.OptionGroup
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

func (s *stubValidationStore) GetFullCatalog(context.Context) (domain.Catalog, error) {
	return domain.Catalog{
		Modules:      s.modules,
		Hardware:     s.hardware,
		OptionGroups: s.groups,
		Structures:   s.structure,
		Components:   s.component,
		Agregados:    s.agregado,
	}, nil
}

func (s *stubValidationStore) ListMaterialCategories(context.Context) ([]domain.MaterialCategory, error) {
	return nil, nil
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

// hardwareRoleDraftStore assembles the minimal composed catalog whose layout
// consumes a kind=hardware group through a component placement override (the
// #1046 shape): structure board + role-based hardware placement.
func hardwareRoleDraftStore(group domain.OptionGroup) *stubValidationStore {
	return &stubValidationStore{
		release:  validateTestRelease(),
		profiles: []domain.HardwareProfile{validProfile()},
		hardware: []domain.Hardware{
			{ID: "a0000003-0000-0000-0000-000000000021", Code: "JAL-ACTIVA", Name: "Jaladera activa", Active: true},
			{ID: "a0000003-0000-0000-0000-000000000022", Code: "JAL-RETIRADA", Name: "Jaladera retirada", Active: false},
		},
		groups: []domain.OptionGroup{group},
		structure: []domain.Structure{{
			ID: "a0000006-0000-0000-0000-000000000003", Code: "ST-GRP", Name: "Estructura con puerta", Active: true,
			Components: []domain.ComponentInstance{{
				ComponentID: "a0000007-0000-0000-0000-000000000003",
				Quantity:    1,
				Overrides: &domain.ComponentInstanceOverrides{
					HardwarePlacements: []domain.HardwarePlacement{{
						OptionRole:       "JALADERA",
						AnchorFace:       "front",
						RelativePosition: domain.HardwareRelPosition{XPercent: 50, YPercent: 90},
					}},
				},
			}},
		}},
		component: []domain.Component{{
			ID: "a0000007-0000-0000-0000-000000000003", Code: "PUERTA", Name: "Puerta",
			Placement: domain.PlacementPuerta, GeometryKind: "panel",
			LengthMm: 500, WidthMm: 680, ThicknessMm: 18, Active: true,
			OptionRoles: []string{"FRENTE"},
		}},
		modules: []domain.Module{{
			ID: "a0000005-0000-0000-0000-000000000003", Code: "MOD-GRP", Name: "Módulo con jaladera por grupo",
			StructureID: "a0000006-0000-0000-0000-000000000003",
			WidthMm:     600, HeightMm: 720, DepthMm: 560,
		}},
	}
}

// #1174: the draft validation seeds the same hardware defaults the insertion
// configurator preselects — first ACTIVE member per kind=hardware group.
func TestDefaultHardwareChoices(t *testing.T) {
	catalog := domain.Catalog{
		Hardware: []domain.Hardware{
			{ID: "hw-activa", Active: true},
			{ID: "hw-retirada", Active: false},
		},
		OptionGroups: []domain.OptionGroup{
			{Code: "JALADERA", Kind: "hardware", Required: true, OptionIDs: []string{"hw-retirada", "hw-activa"}},
			{Code: "BISAGRA", Kind: "hardware", OptionIDs: []string{"hw-activa"}},
			{Code: "FRENTE", Kind: "board", OptionIDs: []string{"hw-activa"}},
			{Code: "VACANTE", Kind: "hardware", OptionIDs: []string{"hw-retirada"}},
		},
	}
	choices := defaultHardwareChoices(catalog)
	if choices["JALADERA"] != "hw-activa" {
		t.Errorf("JALADERA debe defaultear a la primera miembro ACTIVA: %v", choices)
	}
	if choices["BISAGRA"] != "hw-activa" {
		t.Errorf("los grupos opcionales con miembros activos también se preseleccionan: %v", choices)
	}
	if _, ok := choices["FRENTE"]; ok {
		t.Errorf("los grupos kind=board no se tocan: %v", choices)
	}
	if _, ok := choices["VACANTE"]; ok {
		t.Errorf("un grupo sin miembros activos queda sin elección (required falla cerrado): %v", choices)
	}
	if seeded := defaultHardwareChoices(domain.Catalog{}); seeded != nil {
		t.Errorf("sin grupos hardware no hay mapa de choices: %v", seeded)
	}
}

func TestValidateStandardDraft(t *testing.T) {
	ctx := context.Background()
	releaseID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)

	resolvableModule := func() domain.Module {
		return domain.Module{ID: "a0000005-0000-0000-0000-000000000001", Code: "VIG-A", Name: "Vigas A", WidthMm: 600, HeightMm: 720, DepthMm: 560}
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
		// Two resources: the module frozen as geometry + the hardware profile.
		if !report.Compile.OK || report.Compile.ResourceCount != 2 || report.Compile.ManifestHash == "" {
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
		broken.ID = "a0000005-0000-0000-0000-000000000002"
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
		if failure.ID != "a0000005-0000-0000-0000-000000000002" || failure.Code != "VIG-B" || failure.Error == "" {
			t.Fatalf("failure = %+v", failure)
		}
	})

	t.Run("required hardware group resolves with the configurator's first-active-member default", func(t *testing.T) {
		store := hardwareRoleDraftStore(domain.OptionGroup{
			ID: "a0000008-0000-0000-0000-000000000003", Code: "JALADERA", Name: "Jaladera",
			Kind: "hardware", Required: true,
			// The retired member is curated first: the default must skip it.
			OptionIDs: []string{"a0000003-0000-0000-0000-000000000022", "a0000003-0000-0000-0000-000000000021"},
		})
		report, err := ValidateStandardDraft(ctx, store, releaseID)
		if err != nil {
			t.Fatalf("validate: %v", err)
		}
		if report.Furniture.Total != 1 || report.Furniture.Resolved != 1 || report.Furniture.Failed != 0 {
			t.Fatalf("furniture check = %+v", report.Furniture)
		}
	})

	t.Run("required hardware group without active members still fails closed", func(t *testing.T) {
		store := hardwareRoleDraftStore(domain.OptionGroup{
			ID: "a0000008-0000-0000-0000-000000000003", Code: "JALADERA", Name: "Jaladera",
			Kind: "hardware", Required: true,
			OptionIDs: []string{"a0000003-0000-0000-0000-000000000022"}, // sólo la retirada
		})
		report, err := ValidateStandardDraft(ctx, store, releaseID)
		if err != nil {
			t.Fatalf("validate: %v", err)
		}
		if report.Furniture.Failed != 1 || len(report.Furniture.Failures) != 1 {
			t.Fatalf("furniture check = %+v", report.Furniture)
		}
		if !strings.Contains(report.Furniture.Failures[0].Error, "sin elección") {
			t.Fatalf("failure must name the unchosen required group: %+v", report.Furniture.Failures[0])
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
