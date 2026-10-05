package api

import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// Contrato: biblioteca paramétrica — option groups, agregados, categorías de
// módulo, módulos + catálogo completo, estructuras y componentes.
type ModuleStore interface {
	// Catalog: option groups
	ListOptionGroups(ctx context.Context) ([]domain.OptionGroup, error)
	GetOptionGroupByID(ctx context.Context, id string) (*domain.OptionGroup, error)
	CreateOptionGroup(ctx context.Context, og *domain.OptionGroup) error
	UpdateOptionGroup(ctx context.Context, id string, expectedVersion int64, og *domain.OptionGroup) error
	DeleteOptionGroup(ctx context.Context, id string, expectedVersion int64) error

	// Catalog: agregados (reusable sub-assemblies)
	ListAgregados(ctx context.Context) ([]domain.Agregado, error)
	GetAgregadoByID(ctx context.Context, id string) (*domain.Agregado, error)
	CreateAgregado(ctx context.Context, a *domain.Agregado) error
	UpdateAgregado(ctx context.Context, id string, a *domain.Agregado) error
	DeactivateAgregado(ctx context.Context, id string) error
	// DeleteAgregado hard-deletes with an in-use guard (F116 C4).
	DeleteAgregado(ctx context.Context, id string) error

	// Catalog: categories
	ListCategories(ctx context.Context) ([]domain.ModuleCategory, error)
	GetCategoryByID(ctx context.Context, id string) (*domain.ModuleCategory, error)
	CreateCategory(ctx context.Context, c *domain.ModuleCategory) error
	UpdateCategory(ctx context.Context, id string, expectedVersion int64, c *domain.ModuleCategory) error
	DeleteCategory(ctx context.Context, id string, expectedVersion int64) error

	// Catalog: modules + full catalog
	// ListModules returns modules with their measure presets only (catalog
	// projections like the SketchUp furniture definitions endpoint).
	ListModules(ctx context.Context) ([]domain.Module, error)
	GetFullCatalog(ctx context.Context) (domain.Catalog, error)
	// DeriveLiveProfileDemand (#986): per-item profile hardware demand for the
	// live pricing truth — the same derivation the release freeze persists.
	DeriveLiveProfileDemand(ctx context.Context, project *domain.Project, catalog domain.Catalog) ([][]engine.HardwareProfileDemandLine, error)
	GetModuleByID(ctx context.Context, id string) (*domain.Module, error)
	CreateModule(ctx context.Context, m *domain.Module) error
	UpdateModule(ctx context.Context, id string, expectedVersion int64, m *domain.Module) error
	DeleteModule(ctx context.Context, id string) error

	// Catalog: structures (F049 cuerpos)
	ListStructures(ctx context.Context) ([]domain.Structure, error)
	GetStructureByID(ctx context.Context, id string) (*domain.Structure, error)
	CreateStructure(ctx context.Context, st *domain.Structure) error
	UpdateStructure(ctx context.Context, id string, st *domain.Structure) error
	DeleteStructure(ctx context.Context, id string) error

	// Catalog: components
	ListComponents(ctx context.Context) ([]domain.Component, error)
	GetComponentByID(ctx context.Context, id string) (*domain.Component, error)
	CreateComponent(ctx context.Context, c *domain.Component) error
	UpdateComponent(ctx context.Context, id string, c *domain.Component) error
	DeleteComponent(ctx context.Context, id string) error
}
