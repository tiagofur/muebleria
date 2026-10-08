package api

// Contrato: stub del stubStore espejo de store_modules (store_modules.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_modules.go
import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

func (s *stubStore) ListOptionGroups(context.Context) ([]domain.OptionGroup, error) {
	if s.listOptionGroups != nil {
		return s.listOptionGroups, nil
	}
	return nil, nil
}

func (s *stubStore) GetOptionGroupByID(context.Context, string) (*domain.OptionGroup, error) {
	s.stubNotUsed("GetOptionGroupByID")
	return nil, nil
}

func (s *stubStore) CreateOptionGroup(context.Context, *domain.OptionGroup) error {
	s.stubNotUsed("CreateOptionGroup")
	return nil
}

func (s *stubStore) UpdateOptionGroup(_ context.Context, _ string, _ int64, _ *domain.OptionGroup) error {
	s.stubNotUsed("UpdateOptionGroup")
	return nil
}

func (s *stubStore) DeleteOptionGroup(_ context.Context, _ string, _ int64) error {
	s.stubNotUsed("DeleteOptionGroup")
	return nil
}

func (s *stubStore) ListCategories(context.Context) ([]domain.ModuleCategory, error) {
	if s.listCategories != nil {
		return s.listCategories, nil
	}
	return nil, nil
}

func (s *stubStore) GetCategoryByID(context.Context, string) (*domain.ModuleCategory, error) {
	s.stubNotUsed("GetCategoryByID")
	return nil, nil
}

func (s *stubStore) CreateCategory(context.Context, *domain.ModuleCategory) error {
	s.stubNotUsed("CreateCategory")
	return nil
}

func (s *stubStore) UpdateCategory(_ context.Context, _ string, _ int64, _ *domain.ModuleCategory) error {
	if s.updateCategoryErr != nil {
		return s.updateCategoryErr
	}
	s.stubNotUsed("UpdateCategory")
	return nil
}

func (s *stubStore) DeleteCategory(_ context.Context, _ string, _ int64) error {
	s.stubNotUsed("DeleteCategory")
	return nil
}

func (s *stubStore) ListModules(context.Context) ([]domain.Module, error) {
	return s.listModules, s.listModulesErr
}

func (s *stubStore) GetFactoryConstructionPolicy(context.Context) (*engine.FactoryConstructionPolicy, error) {
	if s.constructionPolicyErr != nil {
		return nil, s.constructionPolicyErr
	}
	return s.constructionPolicy, nil
}

func (s *stubStore) GetFullCatalog(context.Context) (domain.Catalog, error) {
	if s.catalogError != nil {
		return domain.Catalog{}, s.catalogError
	}
	// #108: HandleProjectByID now loads the catalog to pin structure revisions
	// when a quote is closed. Tests that need to exercise pinning inject a
	// catalog via catalogOverride; otherwise an empty catalog is fine —
	// CaptureProjectItemStructurePins leaves items without a structure/module
	// untouched.
	if s.catalogOverride != nil {
		return *s.catalogOverride, nil
	}
	return domain.Catalog{}, nil
}

func (s *stubStore) GetModuleByID(_ context.Context, id string) (*domain.Module, error) {
	if s.modulesByID != nil {
		if m, ok := s.modulesByID[id]; ok {
			return m, nil
		}
	}
	return s.moduleReturnedByID, nil
}

func (s *stubStore) CreateModule(_ context.Context, m *domain.Module) error {
	if !s.createModuleArmed {
		s.stubNotUsed("CreateModule")
	}
	cp := *m
	m.Version = 1
	s.createModuleReceived = &cp
	return s.createModuleErr
}

func (s *stubStore) UpdateModule(_ context.Context, _ string, expectedVersion int64, m *domain.Module) error {
	s.updateModuleCalled = true
	s.updateModuleExpectedVersion = expectedVersion
	if s.updateModuleErr == nil {
		m.Version = expectedVersion + 1
	}
	cp := *m
	s.updateModuleReceived = &cp
	return s.updateModuleErr
}

func (s *stubStore) DeleteModule(_ context.Context, id string) error {
	s.deleteModuleCalled = true
	s.deleteModuleReceivedID = id
	return nil
}

func (s *stubStore) ListStructures(context.Context) ([]domain.Structure, error) {
	if s.listStructures != nil {
		return s.listStructures, nil
	}
	return []domain.Structure{}, nil
}

func (s *stubStore) GetStructureByID(context.Context, string) (*domain.Structure, error) {
	s.stubNotUsed("GetStructureByID")
	return nil, nil
}

func (s *stubStore) CreateStructure(context.Context, *domain.Structure) error {
	s.stubNotUsed("CreateStructure")
	return nil
}

func (s *stubStore) UpdateStructure(_ context.Context, _ string, _ int64, _ *domain.Structure) error {
	s.stubNotUsed("UpdateStructure")
	return nil
}

func (s *stubStore) DeleteStructure(_ context.Context, _ string, _ int64) error {
	s.stubNotUsed("DeleteStructure")
	return nil
}

func (s *stubStore) ListAgregados(context.Context) ([]domain.Agregado, error) {
	if s.listAgregados != nil {
		return s.listAgregados, nil
	}
	return []domain.Agregado{}, nil
}

func (s *stubStore) GetAgregadoByID(context.Context, string) (*domain.Agregado, error) {
	s.stubNotUsed("GetAgregadoByID")
	return nil, nil
}

func (s *stubStore) CreateAgregado(context.Context, *domain.Agregado) error {
	s.stubNotUsed("CreateAgregado")
	return nil
}

func (s *stubStore) UpdateAgregado(_ context.Context, _ string, _ int64, _ *domain.Agregado) error {
	s.stubNotUsed("UpdateAgregado")
	return nil
}

func (s *stubStore) UpdateAgregadoWithRevision(_ context.Context, _ string, _ int64, _ *domain.Agregado, _ *string) error {
	s.stubNotUsed("UpdateAgregadoWithRevision")
	return nil
}

func (s *stubStore) DeleteAgregado(_ context.Context, _ string, _ int64) error {
	return nil
}

func (s *stubStore) DeactivateAgregado(_ context.Context, _ string, _ int64) error {
	s.stubNotUsed("DeactivateAgregado")
	return nil
}

func (s *stubStore) ListComponents(context.Context) ([]domain.Component, error) {
	if s.listComponents != nil {
		return s.listComponents, nil
	}
	return nil, nil
}

func (s *stubStore) GetComponentByID(context.Context, string) (*domain.Component, error) {
	s.stubNotUsed("GetComponentByID")
	return nil, nil
}

func (s *stubStore) CreateComponent(context.Context, *domain.Component) error {
	s.stubNotUsed("CreateComponent")
	return nil
}

func (s *stubStore) UpdateComponent(_ context.Context, _ string, _ int64, _ *domain.Component) error {
	s.stubNotUsed("UpdateComponent")
	return nil
}

func (s *stubStore) DeleteComponent(_ context.Context, _ string, _ int64) error {
	s.stubNotUsed("DeleteComponent")
	return nil
}

func (s *stubStore) DeriveLiveProfileDemand(ctx context.Context, project *domain.Project, catalog domain.Catalog) ([][]engine.HardwareProfileDemandLine, error) {
	return nil, nil
}
