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

	// Catalog: ambient materials (presentation-only floor/wall surfaces, #4150 / F086)
	ListAmbientMaterials(ctx context.Context) ([]domain.AmbientMaterial, error)
	GetAmbientMaterialByID(ctx context.Context, id string) (*domain.AmbientMaterial, error)
	CreateAmbientMaterial(ctx context.Context, m *domain.AmbientMaterial) error
	UpdateAmbientMaterial(ctx context.Context, id string, m *domain.AmbientMaterial) error
	DeactivateAmbientMaterial(ctx context.Context, id string) error

	// Catalog: ambient / finish categories (F086)
	ListAmbientCategories(ctx context.Context) ([]domain.AmbientCategory, error)
	GetAmbientCategoryByID(ctx context.Context, id string) (*domain.AmbientCategory, error)
	CreateAmbientCategory(ctx context.Context, c *domain.AmbientCategory) error
	UpdateAmbientCategory(ctx context.Context, id string, c *domain.AmbientCategory) error
	DeleteAmbientCategory(ctx context.Context, id string) error

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

	// Catalog: agregados (reusable sub-assemblies)
	ListAgregados(ctx context.Context) ([]domain.Agregado, error)
	GetAgregadoByID(ctx context.Context, id string) (*domain.Agregado, error)
	CreateAgregado(ctx context.Context, a *domain.Agregado) error
	UpdateAgregado(ctx context.Context, id string, a *domain.Agregado) error
	DeactivateAgregado(ctx context.Context, id string) error

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
	// Floor scan (PROD-3.1 / F089-RN): atomic single-item floor status write.
	SetProjectItemFloorStatus(ctx context.Context, projectID, itemID, status string) error
	// Floor event log (F092): immutable who/when/how audit trail.
	InsertFloorEvent(ctx context.Context, ev domain.FloorStatusEvent) error
	ListFloorEvents(ctx context.Context, projectID string) ([]domain.FloorStatusEvent, error)

	// Project templates (#110 / H15)
	ListProjectTemplates(ctx context.Context) ([]domain.ProjectTemplate, error)
	GetProjectTemplateByID(ctx context.Context, id string) (*domain.ProjectTemplate, error)
	CreateProjectTemplate(ctx context.Context, t domain.ProjectTemplate) error
	UpdateProjectTemplate(ctx context.Context, id string, t domain.ProjectTemplate) error
	DeleteProjectTemplate(ctx context.Context, id string) error

	// Project photos (CRM Gallery)
	ListProjectPhotos(ctx context.Context, projectID string) ([]domain.ProjectPhoto, error)
	GetProjectPhotoByID(ctx context.Context, photoID string) (*domain.ProjectPhoto, error)
	CreateProjectPhoto(ctx context.Context, photo *domain.ProjectPhoto) error
	UpdateProjectPhoto(ctx context.Context, photoID string, caption string, isShowcase bool, stage domain.ProjectPhotoStage) (*domain.ProjectPhoto, error)
	DeleteProjectPhoto(ctx context.Context, photoID string) error
	ListShowcasePhotos(ctx context.Context, onlyShowcase bool) ([]domain.ShowcasePhotoItem, error)


	// Project internal messages & technical workflow (CRM Phase 2)
	ListProjectInternalMessages(ctx context.Context, projectID string) ([]domain.ProjectInternalMessage, error)
	CreateProjectInternalMessage(ctx context.Context, msg *domain.ProjectInternalMessage) error
	UpdateProjectTechnicalWorkflow(ctx context.Context, projectID string, engineerID *string, status string, surveyCompletedAt *string, installDate *string) error

	// Warranty tickets (CRM Phase 3)
	ListWarrantyTickets(ctx context.Context, projectID, customerID, status string) ([]domain.WarrantyTicket, error)
	GetWarrantyTicketByID(ctx context.Context, id string) (*domain.WarrantyTicket, error)
	CreateWarrantyTicket(ctx context.Context, ticket *domain.WarrantyTicket) error
	UpdateWarrantyTicket(ctx context.Context, ticket *domain.WarrantyTicket) error
	DeleteWarrantyTicket(ctx context.Context, id string) error
	ListWarrantyTicketPhotos(ctx context.Context, ticketID string) ([]domain.WarrantyTicketPhoto, error)
	AddWarrantyTicketPhoto(ctx context.Context, photo *domain.WarrantyTicketPhoto) error
	DeleteWarrantyTicketPhoto(ctx context.Context, ticketID, photoID string) error

	// Seed: populate catalog from plantilla fixtures
	SeedCatalog(ctx context.Context) error

	// Workshop settings (F031 defaults + F044 COST-02 flag)
	GetWorkshopSettings(ctx context.Context) (domain.WorkshopSettings, error)
	UpsertWorkshopSettings(ctx context.Context, ws domain.WorkshopSettings) (domain.WorkshopSettings, error)

	// User sector assignments (operador role)
	ListUserSectors(ctx context.Context, userID string) ([]domain.UserSector, error)
	SetUserSectors(ctx context.Context, userID string, sectors []domain.UserSector) error
	GetUsersBySector(ctx context.Context, sector string) ([]domain.User, error)

	// Production activity tracking (gerente_produccion dashboard)
	InsertProductionActivity(ctx context.Context, act domain.ProductionActivity) error
	GetActiveActivitiesBySector(ctx context.Context, sector domain.ProductionSector) ([]domain.ProductionActivity, error)
	GetActiveActivitiesByOperator(ctx context.Context, operatorID string) ([]domain.ProductionActivity, error)
	GetActiveActivityByID(ctx context.Context, id string) (*domain.ProductionActivity, error)
	FinishProductionActivity(ctx context.Context, id string, piecesCount int, notes string) error
	ListProductionActivitiesByProject(ctx context.Context, projectID string, limit int) ([]domain.ProductionActivity, error)
	GetSectorMetrics(ctx context.Context, sector domain.ProductionSector, since string) (*domain.SectorDashboard, error)
	GetOperatorMetrics(ctx context.Context, operatorID, since string) (*domain.OperatorMetrics, error)
	GetDashboardMetrics(ctx context.Context) (*domain.DashboardMetrics, error)

	// Damage reporting
	InsertDamageReport(ctx context.Context, dmg domain.DamageReport) error
	GetDamageReportByID(ctx context.Context, id string) (*domain.DamageReport, error)
	ListDamageReportsByProject(ctx context.Context, projectID string) ([]domain.DamageReport, error)
	ResolveDamageReport(ctx context.Context, id string) error
	GetTodayDamageCount(ctx context.Context) (int, error)
}

