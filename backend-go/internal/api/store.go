package api

import (
	"context"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Store is the subset of storage operations the HTTP handlers depend on.
//
// It is satisfied by *storage.PostgresStore in production. Defining it as an
// interface lets handler unit tests substitute a stub (see handlers_test.go)
// without standing up a database — mirroring the httptest style of
// middleware_test.go. Methods not used by handlers (RunMigrations, Close,
// AppliedVersions, admin password helpers) intentionally stay on the concrete
// type and are called only from cmd/server.
type Store interface {
	// Auth / users
	GetUserByEmail(ctx context.Context, email string) (*domain.User, error)
	// GetUserByID loads the user for JWT re-validation of role/active (issue #16).
	GetUserByID(ctx context.Context, id string) (*domain.User, error)
	CreateUser(ctx context.Context, u *domain.User) error
	ListUsers(ctx context.Context) ([]domain.User, error)
	ApproveUser(ctx context.Context, id string) error
	UpdateUserRole(ctx context.Context, id string, role domain.UserRole) error
	RejectUser(ctx context.Context, id string) error

	// Customers
	ListCustomers(ctx context.Context) ([]domain.Customer, error)
	GetCustomerByID(ctx context.Context, id string) (*domain.Customer, error)
	CreateCustomer(ctx context.Context, c *domain.Customer) error
	UpdateCustomer(ctx context.Context, id string, c *domain.Customer) error
	DeactivateCustomer(ctx context.Context, id string) error

	// Catalog: materials
	ListMaterialBoards(ctx context.Context) ([]domain.MaterialBoard, error)
	GetMaterialBoardByID(ctx context.Context, id string) (*domain.MaterialBoard, error)
	CreateMaterialBoard(ctx context.Context, m *domain.MaterialBoard) error
	UpdateMaterialBoard(ctx context.Context, id string, m *domain.MaterialBoard) error
	DeactivateMaterialBoard(ctx context.Context, id string) error

	// Catalog: edge bands
	ListEdgeBands(ctx context.Context) ([]domain.EdgeBand, error)
	GetEdgeBandByID(ctx context.Context, id string) (*domain.EdgeBand, error)
	CreateEdgeBand(ctx context.Context, e *domain.EdgeBand) error
	UpdateEdgeBand(ctx context.Context, id string, e *domain.EdgeBand) error
	DeactivateEdgeBand(ctx context.Context, id string) error

	// Catalog: hardware
	ListHardwares(ctx context.Context) ([]domain.Hardware, error)
	GetHardwareByID(ctx context.Context, id string) (*domain.Hardware, error)
	CreateHardware(ctx context.Context, h *domain.Hardware) error
	UpdateHardware(ctx context.Context, id string, h *domain.Hardware) error
	DeactivateHardware(ctx context.Context, id string) error

	// Catalog: option groups
	ListOptionGroups(ctx context.Context) ([]domain.OptionGroup, error)
	GetOptionGroupByID(ctx context.Context, id string) (*domain.OptionGroup, error)
	CreateOptionGroup(ctx context.Context, og *domain.OptionGroup) error
	UpdateOptionGroup(ctx context.Context, id string, og *domain.OptionGroup) error
	DeleteOptionGroup(ctx context.Context, id string) error

	// Catalog: categories
	ListCategories(ctx context.Context) ([]domain.ModuleCategory, error)
	GetCategoryByID(ctx context.Context, id string) (*domain.ModuleCategory, error)
	CreateCategory(ctx context.Context, c *domain.ModuleCategory) error
	UpdateCategory(ctx context.Context, id string, c *domain.ModuleCategory) error
	DeleteCategory(ctx context.Context, id string) error

	// Catalog: modules + full catalog
	GetFullCatalog(ctx context.Context) (domain.Catalog, error)
	GetModuleByID(ctx context.Context, id string) (*domain.Module, error)
	CreateModule(ctx context.Context, m *domain.Module) error
	UpdateModule(ctx context.Context, id string, m *domain.Module) error
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

	// Projects
	ListProjects(ctx context.Context) ([]domain.Project, error)
	GetProjectByID(ctx context.Context, id string) (*domain.Project, error)
	CreateProject(ctx context.Context, p *domain.Project) error
	UpdateProject(ctx context.Context, id string, p *domain.Project) error
	DeleteProject(ctx context.Context, id string) error

	// Seed: populate catalog from plantilla fixtures
	SeedCatalog(ctx context.Context) error

	// Workshop settings (F031 defaults + F044 COST-02 flag)
	GetWorkshopSettings(ctx context.Context) (domain.WorkshopSettings, error)
	UpsertWorkshopSettings(ctx context.Context, ws domain.WorkshopSettings) (domain.WorkshopSettings, error)
}
