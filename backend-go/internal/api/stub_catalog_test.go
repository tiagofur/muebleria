package api

// Contrato: stub del stubStore espejo de store_catalog (store_catalog.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_catalog.go
import (
	"context"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func (s *stubStore) CreateMaterialBoard(ctx context.Context, m *domain.MaterialBoard) error {
	if s.createMaterialErr != nil {
		return s.createMaterialErr
	}
	s.createMaterialOK = true
	return nil
}

func (s *stubStore) GetMaterialBoardByID(ctx context.Context, id string) (*domain.MaterialBoard, error) {
	return s.materialReturnedByID, s.materialGetByIDErr
}

// stubNotUsed marks interface methods that the focal handlers never call.

func (s *stubStore) ListMaterialBoards(context.Context) ([]domain.MaterialBoard, error) {
	if s.listMaterials != nil {
		return s.listMaterials, nil
	}
	return []domain.MaterialBoard{}, nil
}

func (s *stubStore) UpdateMaterialBoard(_ context.Context, _ string, _ int64, m *domain.MaterialBoard) error {
	if s.updateMaterialBoardErr != nil {
		return s.updateMaterialBoardErr
	}
	s.updateMaterialCalled = true
	cp := *m
	s.updateMaterialReceived = &cp
	return nil
}

func (s *stubStore) DeactivateMaterialBoard(_ context.Context, _ string, _ int64) error {
	return nil
}

func (s *stubStore) ListAmbientMaterials(context.Context) ([]domain.AmbientMaterial, error) {
	if s.listAmbientMaterials != nil {
		return s.listAmbientMaterials, nil
	}
	return []domain.AmbientMaterial{}, nil
}

func (s *stubStore) GetAmbientMaterialByID(_ context.Context, _ string) (*domain.AmbientMaterial, error) {
	return s.ambientReturnedByID, s.ambientGetByIDErr
}

func (s *stubStore) CreateAmbientMaterial(_ context.Context, m *domain.AmbientMaterial) error {
	if s.createAmbientErr != nil {
		return s.createAmbientErr
	}
	s.createAmbientOK = true
	cp := *m
	s.updateAmbientReceived = &cp // record for create-roundtrip assertions
	return nil
}

func (s *stubStore) UpdateAmbientMaterial(_ context.Context, _ string, _ int64, m *domain.AmbientMaterial) error {
	s.updateAmbientCalled = true
	cp := *m
	s.updateAmbientReceived = &cp
	return nil
}

func (s *stubStore) DeactivateAmbientMaterial(_ context.Context, id string, _ int64) error {
	s.deactivateAmbientCalled = true
	s.deactivateAmbientReceived = id
	return nil
}

func (s *stubStore) ListAmbientCategories(context.Context) ([]domain.AmbientCategory, error) {
	if s.listAmbientCategories != nil {
		return s.listAmbientCategories, nil
	}
	return []domain.AmbientCategory{}, nil
}

func (s *stubStore) GetAmbientCategoryByID(_ context.Context, _ string) (*domain.AmbientCategory, error) {
	return s.ambientCategoryReturnedByID, s.ambientCategoryGetByIDErr
}

func (s *stubStore) CreateAmbientCategory(_ context.Context, _ *domain.AmbientCategory) error {
	if s.createAmbientCategoryErr != nil {
		return s.createAmbientCategoryErr
	}
	s.createAmbientCategoryOK = true
	return nil
}

func (s *stubStore) UpdateAmbientCategory(_ context.Context, _ string, _ int64, _ *domain.AmbientCategory) error {
	s.updateAmbientCategoryCalled = true
	return nil
}

func (s *stubStore) DeleteAmbientCategory(_ context.Context, _ string, _ int64) error {
	s.deleteAmbientCategoryCalled = true
	return nil
}

func (s *stubStore) ListMaterialCategories(context.Context) ([]domain.MaterialCategory, error) {
	if s.listMaterialCategories != nil {
		return s.listMaterialCategories, nil
	}
	return []domain.MaterialCategory{}, nil
}

func (s *stubStore) GetMaterialCategoryByID(_ context.Context, _ string) (*domain.MaterialCategory, error) {
	return s.materialCategoryReturnedByID, s.materialCategoryGetByIDErr
}

func (s *stubStore) CreateMaterialCategory(_ context.Context, _ *domain.MaterialCategory) error {
	if s.createMaterialCategoryErr != nil {
		return s.createMaterialCategoryErr
	}
	s.createMaterialCategoryOK = true
	return nil
}

func (s *stubStore) UpdateMaterialCategory(_ context.Context, _ string, _ int64, _ *domain.MaterialCategory) error {
	s.updateMaterialCategoryCalled = true
	return nil
}

func (s *stubStore) DeleteMaterialCategory(_ context.Context, _ string, _ int64) error {
	s.deleteMaterialCategoryCalled = true
	if s.deleteMaterialCategoryErrHook != nil {
		return s.deleteMaterialCategoryErrHook
	}
	return nil
}

func (s *stubStore) ListEdgeBands(context.Context) ([]domain.EdgeBand, error) {
	s.stubNotUsed("ListEdgeBands")
	return nil, nil
}

func (s *stubStore) GetEdgeBandByID(context.Context, string) (*domain.EdgeBand, error) {
	s.stubNotUsed("GetEdgeBandByID")
	return nil, nil
}

func (s *stubStore) CreateEdgeBand(context.Context, *domain.EdgeBand) error {
	s.stubNotUsed("CreateEdgeBand")
	return nil
}

func (s *stubStore) UpdateEdgeBand(_ context.Context, _ string, _ int64, _ *domain.EdgeBand) error {
	s.stubNotUsed("UpdateEdgeBand")
	return nil
}

func (s *stubStore) DeactivateEdgeBand(_ context.Context, _ string, _ int64) error {
	s.stubNotUsed("DeactivateEdgeBand")
	return nil
}

func (s *stubStore) ListHardwares(context.Context) ([]domain.Hardware, error) {
	if s.listHardwares != nil {
		return s.listHardwares, nil
	}
	return nil, nil
}

func (s *stubStore) GetHardwareByID(context.Context, string) (*domain.Hardware, error) {
	return s.hardwareReturnedByID, nil
}

func (s *stubStore) CreateHardware(context.Context, *domain.Hardware) error {
	s.stubNotUsed("CreateHardware")
	return nil
}

func (s *stubStore) UpdateHardware(_ context.Context, _ string, expectedVersion int64, h *domain.Hardware) error {
	if s.updateHardwareErr != nil {
		return s.updateHardwareErr
	}
	s.updateHardwareCalled = true
	s.updateHardwareExpectedVersion = expectedVersion
	// Simulate the server-owned bump so the handler's ETag reflects the
	// persisted version, never the client payload's echoed one.
	h.Version = expectedVersion + 1
	cp := *h
	s.updateHardwareReceived = &cp
	return nil
}

func (s *stubStore) DeactivateHardware(_ context.Context, _ string, expectedVersion int64) error {
	if s.deactivateHardwareErr != nil {
		return s.deactivateHardwareErr
	}
	s.deactivateHardwareCalled = true
	s.deactivateHardwareExpectedVer = expectedVersion
	return nil
}

// #1130 — opening profile catalog stub.
func (s *stubStore) ListOpeningProfiles(context.Context) ([]domain.OpeningProfile, error) {
	if s.openingProfileErr != nil {
		return nil, s.openingProfileErr
	}
	if s.openingProfiles != nil {
		return s.openingProfiles, nil
	}
	return []domain.OpeningProfile{}, nil
}

// #1134 — opening capabilities stub: nil unless a test injects a blob.
func (s *stubStore) GetOpeningCapabilities(context.Context) (*domain.OpeningCapabilities, error) {
	return s.openingCapabilities, nil
}

func (s *stubStore) GetOpeningProfileByID(_ context.Context, id string) (*domain.OpeningProfile, error) {
	for i := range s.openingProfiles {
		if s.openingProfiles[i].ID == id {
			return &s.openingProfiles[i], nil
		}
	}
	// The real store returns the typed sentinel — the 404 mapping depends on it.
	return nil, storage.ErrOpeningProfileNotFound
}

func (s *stubStore) CreateOpeningProfile(_ context.Context, profile *domain.OpeningProfile) error {
	if s.openingProfileErr != nil {
		return s.openingProfileErr
	}
	// El store real valida en el write boundary — el stub respeta el contrato.
	if err := domain.ValidateOpeningProfile(*profile); err != nil {
		return err
	}
	s.createdOpeningProfile = profile
	return nil
}

func (s *stubStore) UpdateOpeningProfile(_ context.Context, _ string, _ int64, profile *domain.OpeningProfile) error {
	if s.openingProfileErr != nil {
		return s.openingProfileErr
	}
	return domain.ValidateOpeningProfile(*profile)
}

func (s *stubStore) DeactivateOpeningProfile(_ context.Context, _ string, _ int64) error {
	return s.openingProfileErr
}
