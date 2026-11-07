package api

// Contrato: stub del stubStore espejo de store_catalog (store_catalog.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_catalog.go
import (
	"context"
	"fmt"

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

// #1507: hardware categories — same stub shape as the material categories.
func (s *stubStore) ListHardwareCategories(context.Context) ([]domain.HardwareCategory, error) {
	if s.listHardwareCategories != nil {
		return s.listHardwareCategories, nil
	}
	return []domain.HardwareCategory{}, nil
}

func (s *stubStore) GetHardwareCategoryByID(_ context.Context, _ string) (*domain.HardwareCategory, error) {
	return s.hardwareCategoryReturnedByID, s.hardwareCategoryGetByIDErr
}

func (s *stubStore) CreateHardwareCategory(_ context.Context, _ *domain.HardwareCategory) error {
	if s.createHardwareCategoryErr != nil {
		return s.createHardwareCategoryErr
	}
	s.createHardwareCategoryOK = true
	return nil
}

func (s *stubStore) UpdateHardwareCategory(_ context.Context, _ string, _ int64, _ *domain.HardwareCategory) error {
	s.updateHardwareCategoryCalled = true
	return nil
}

func (s *stubStore) DeleteHardwareCategory(_ context.Context, _ string, _ int64) error {
	s.deleteHardwareCategoryCalled = true
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

// #1553: no-op — the stub never opens a real transaction to lock.
func (s *stubStore) LockCatalogCodes(context.Context, []string) error {
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

// #1138 — case C overhang rule stub: nil (no backed rule) unless a test
// injects one.
func (s *stubStore) GetOpeningOverhangRule(context.Context) (*domain.OpeningOverhangRule, error) {
	return nil, nil
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
	// El store real normaliza y valida en el write boundary — el stub respeta el contrato.
	domain.NormalizeOpeningProfileWrite(profile, nil)
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
	domain.NormalizeOpeningProfileWrite(profile, nil)
	return domain.ValidateOpeningProfile(*profile)
}

func (s *stubStore) DeactivateOpeningProfile(_ context.Context, _ string, _ int64) error {
	return s.openingProfileErr
}

// #1531 — grip styles stub: validates the shape like the real store (the
// catalog checks need PostgreSQL) and keeps rows in memory.
func (s *stubStore) ListGripStyles(context.Context) ([]domain.GripStyle, error) {
	if s.gripStyleErr != nil {
		return nil, s.gripStyleErr
	}
	return append([]domain.GripStyle{}, s.gripStyles...), nil
}

func (s *stubStore) GetGripStyle(_ context.Context, id string) (*domain.GripStyle, error) {
	for i := range s.gripStyles {
		if s.gripStyles[i].ID == id {
			style := s.gripStyles[i]
			return &style, nil
		}
	}
	return nil, storage.ErrGripStyleNotFound
}

func (s *stubStore) CreateGripStyle(_ context.Context, style *domain.GripStyle, _ storage.GripStyleWriteMeta) error {
	if s.gripStyleErr != nil {
		return s.gripStyleErr
	}
	if style.ByFurnitureType == nil {
		style.ByFurnitureType = map[string]domain.GripStyleRecipe{}
	}
	domain.NormalizeGripStyle(style)
	if err := domain.ValidateGripStyleShape(*style); err != nil {
		return err
	}
	style.ID = fmt.Sprintf("gs-%d", len(s.gripStyles)+1)
	style.Version = 1
	s.gripStyles = append(s.gripStyles, *style)
	return nil
}

func (s *stubStore) UpdateGripStyle(_ context.Context, id string, expectedVersion int64, style *domain.GripStyle, _ storage.GripStyleWriteMeta) error {
	if s.gripStyleErr != nil {
		return s.gripStyleErr
	}
	for i := range s.gripStyles {
		if s.gripStyles[i].ID != id {
			continue
		}
		if s.gripStyles[i].Version != expectedVersion {
			return storage.ErrVersionConflict
		}
		domain.NormalizeGripStyle(style)
		if err := domain.ValidateGripStyleShape(*style); err != nil {
			return err
		}
		style.ID, style.Version = id, expectedVersion+1
		s.gripStyles[i] = *style
		return nil
	}
	return storage.ErrGripStyleNotFound
}

func (s *stubStore) DeleteGripStyle(_ context.Context, id string, expectedVersion int64, _ storage.GripStyleWriteMeta) error {
	if s.gripStyleErr != nil {
		return s.gripStyleErr
	}
	for i := range s.gripStyles {
		if s.gripStyles[i].ID == id {
			if s.gripStyles[i].Version != expectedVersion {
				return storage.ErrVersionConflict
			}
			s.gripStyles = append(s.gripStyles[:i], s.gripStyles[i+1:]...)
			return nil
		}
	}
	return storage.ErrGripStyleNotFound
}

func (s *stubStore) GetProjectGrip(_ context.Context, _ string) (*storage.ProjectGrip, error) {
	s.stubNotUsed("GetProjectGrip")
	return nil, nil
}

func (s *stubStore) SetProjectGrip(_ context.Context, _, _ string, _ int64, _ storage.ProjectGripWriteMeta) (*storage.ProjectGrip, error) {
	s.stubNotUsed("SetProjectGrip")
	return nil, nil
}

func (s *stubStore) SetFurnitureGripOverrides(_ context.Context, _ string, _ []storage.FurnitureGripOverrideCommand, _ int64, _ storage.ProjectGripWriteMeta) error {
	s.stubNotUsed("SetFurnitureGripOverrides")
	return nil
}

func (s *stubStore) RefreshProjectGrip(_ context.Context, _ string, _ bool, _ int64, _ storage.ProjectGripWriteMeta) error {
	s.stubNotUsed("RefreshProjectGrip")
	return nil
}

func (s *stubStore) GetDesignOpeningFacadeState(_ context.Context, _ string) (*storage.DesignOpeningFacadeState, error) {
	if s.designGripFacadeState == nil {
		return &storage.DesignOpeningFacadeState{ProjectID: "proj-1"}, nil
	}
	return s.designGripFacadeState, nil
}

func (s *stubStore) ApplyDesignOpeningFacade(_ context.Context, designID string, selection domain.DesignOpeningSelection, expectedWorkingVersion string, _ storage.ProjectGripWriteMeta) error {
	s.designGripFacadeApply = &designGripFacadeApplyCapture{
		DesignID: designID, Selection: selection, ExpectedWorkingVersion: expectedWorkingVersion,
	}
	return nil
}

func (s *stubStore) GetFurnitureEffectiveGrip(_ context.Context, _, _ string) (*domain.GripSnapshot, error) {
	s.stubNotUsed("GetFurnitureEffectiveGrip")
	return nil, nil
}
