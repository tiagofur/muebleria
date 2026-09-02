package api

import (
	"context"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
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
	// Auth Devices (#460 SEC-6)
	CreateAuthDeviceEnrollment(ctx context.Context, cmd storage.DeviceEnrollmentCommand) (*domain.AuthDeviceEnrollment, error)
	GetAuthDeviceEnrollmentByID(ctx context.Context, id string) (*domain.AuthDeviceEnrollment, error)
	ApproveAuthDeviceEnrollment(ctx context.Context, cmd storage.ApproveDeviceEnrollmentCommand) (*domain.AuthDeviceEnrollment, error)
	ExchangeAuthDeviceEnrollment(ctx context.Context, cmd storage.ExchangeDeviceCommand) (*storage.ExchangedDevice, error)
	ResolveDeviceToken(ctx context.Context, cmd storage.DeviceTokenCommand, execute func(ctx context.Context, result storage.DeviceTokenResult) error) error
	ListAuthDevicesByUser(ctx context.Context, userID string) ([]domain.AuthDevice, error)
	RevokeAuthDevice(ctx context.Context, cmd storage.RevokeDeviceCommand) error

	// Auth / users
	GetUserByEmail(ctx context.Context, email string) (*domain.User, error)
	// GetUserByID loads the user for JWT re-validation of role/active (issue #16).
	GetUserByID(ctx context.Context, id string) (*domain.User, error)
	CreateUser(ctx context.Context, u *domain.User) error
	UpdateLastLogin(ctx context.Context, id string) error
	UpdateAccountStatus(ctx context.Context, actorID, userID string, status domain.AccountStatus, reason, ip string) (*domain.User, error)
	ListUsers(ctx context.Context) ([]domain.User, error)
	// ListUsersByOrganization scopes the directory to the context's
	// organization (ADR-0005: org admins never see other orgs' users).
	ListUsersByOrganization(ctx context.Context) ([]domain.User, error)

	// Organizations / memberships / security audit (ADR-0004)
	GetOrganizationByID(ctx context.Context, id string) (*domain.Organization, error)
	GetOrganizationBySlug(ctx context.Context, slug string) (*domain.Organization, error)
	ListOrganizations(ctx context.Context) ([]domain.Organization, error)
	CreateOrganization(ctx context.Context, o *domain.Organization) error
	ListMembershipsByUser(ctx context.Context, userID string) ([]domain.MembershipWithOrg, error)
	// ListConnectedOrganizations returns the sales network of a factory (#326).
	ListConnectedOrganizations(ctx context.Context, parentOrganizationID string) ([]domain.Organization, error)
	GetActiveMembership(ctx context.Context, userID, organizationID string) (*domain.MembershipWithOrg, error)
	EnsureMembership(ctx context.Context, organizationID, userID string, roles []domain.UserRole) error
	SetPlatformAdmin(ctx context.Context, userID string, admin bool) error
	InsertSecurityAuditEvent(ctx context.Context, ev storage.SecurityAuditEvent) error
	UpdateOrganization(ctx context.Context, o *domain.Organization) error
	UpdateOrganizationVersion(ctx context.Context, o *domain.Organization, expectedVersion int64) error
	CloneCatalog(ctx context.Context, srcOrg, dstOrg string) error

	// Session registry (#460 / SEC-1): revocation and absolute-lifetime
	// authority behind every ver5 token.
	CreateAuthSession(ctx context.Context, cmd storage.CreateAuthSessionCommand) (*domain.AuthSession, error)
	GetAuthSessionForRequest(ctx context.Context, sessionID, expectedUserID string) (*domain.AuthSession, error)
	UpdateAuthSessionScope(ctx context.Context, sessionID, membershipID, organizationID string) error
	RevokeAuthSession(ctx context.Context, sessionID, revokedBy, reason string) (bool, error)
	ListOwnAuthSessions(ctx context.Context, userID string, limit int) ([]storage.AuthSessionDirectoryEntry, error)
	ListMembershipAuthSessions(ctx context.Context, actorUserID, organizationID, membershipID string, limit int) ([]storage.AuthSessionDirectoryEntry, error)
	ListPlatformUserAuthSessions(ctx context.Context, userID string, limit int) ([]storage.AuthSessionDirectoryEntry, error)
	RevokeOwnAuthSession(ctx context.Context, cmd storage.RevokeAuthSessionCommand) (*storage.AuthSessionRevocation, error)
	RevokeMembershipAuthSession(ctx context.Context, cmd storage.RevokeAuthSessionCommand) (*storage.AuthSessionRevocation, error)
	RevokePlatformAuthSession(ctx context.Context, cmd storage.RevokeAuthSessionCommand) (*storage.AuthSessionRevocation, error)
	CreateAuthRefreshCredential(ctx context.Context, cmd storage.CreateAuthRefreshCredentialCommand) (*storage.AuthRefreshCredential, error)
	RotateAuthRefreshCredential(ctx context.Context, cmd storage.RotateAuthRefreshCredentialCommand, execute storage.AuthRefreshRotationCallback) (*storage.AuthRefreshRotation, error)
	LogoutByRefreshCredential(ctx context.Context, verifier []byte, ip, requestID string) error

	// Support sessions (ADR-0005 §5)
	StartSupportSession(ctx context.Context, adminUserID, organizationID, reason string, ttl time.Duration, organizationCredentialVersion int64) (*domain.SupportSession, error)
	GetOpenSupportSession(ctx context.Context, sessionID string) (*domain.SupportSession, error)
	EndSupportSession(ctx context.Context, sessionID, adminUserID, via string) (bool, error)
	// EndOpenSupportSessionsByOrg cuts every open support session of an org
	// (suspension path, ADR-0005 §5).
	EndOpenSupportSessionsByOrg(ctx context.Context, organizationID, via string) (int64, error)

	// Org team & invitations (#326)
	ListOrgTeam(ctx context.Context, organizationID, actorID string) ([]storage.OrgTeamMember, error)
	GetOrgTeamSummary(ctx context.Context, organizationID, actorID string) (*storage.OrgTeamSummary, error)
	UpdateMembershipRolesByOrg(ctx context.Context, organizationID, membershipID string, roles []domain.UserRole, expectedVersion int64) (*storage.OrgTeamMember, error)
	UpdateMembershipStatus(ctx context.Context, organizationID, membershipID string, status domain.MembershipStatus, reason, actorID string, expectedVersion int64) (*storage.OrgTeamMember, error)
	RevokeMembershipSessions(ctx context.Context, organizationID, membershipID, actorID, reason string, expectedVersion int64) (*storage.OrgTeamMember, error)
	GetMembershipResponsibilityInventory(ctx context.Context, membershipID string) (*storage.MembershipResponsibilityInventory, error)
	CreateInvitation(ctx context.Context, organizationID, email string, roles []domain.UserRole, tokenHash string, expiresAt time.Time, invitedBy string) (*storage.Invitation, error)
	ListInvitations(ctx context.Context, organizationID, actorID string) ([]storage.Invitation, error)
	ResendInvitation(ctx context.Context, organizationID, id, tokenHash string, expiresAt time.Time, expectedVersion int64) (*storage.Invitation, error)
	RevokeInvitation(ctx context.Context, organizationID, id, reason, actorID string, expectedVersion int64) (*storage.Invitation, error)
	AcceptInvitation(ctx context.Context, cmd storage.AcceptInvitationCommand, verifyPassword func(string, string) bool, validateNewPassword func(string) error) (*storage.AcceptInvitationResult, error)
	ListSecurityAuditEvents(ctx context.Context, organizationID string, limit int) ([]openapi.SecurityAuditEvent, error)
	GetUserByEmailAnyState(ctx context.Context, email string) (*domain.User, error)

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

	// Catalog: material categories (F142: subgrupos de tableros)
	ListMaterialCategories(ctx context.Context) ([]domain.MaterialCategory, error)
	GetMaterialCategoryByID(ctx context.Context, id string) (*domain.MaterialCategory, error)
	CreateMaterialCategory(ctx context.Context, c *domain.MaterialCategory) error
	UpdateMaterialCategory(ctx context.Context, id string, c *domain.MaterialCategory) error
	DeleteMaterialCategory(ctx context.Context, id string) error

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
	// DeleteAgregado hard-deletes with an in-use guard (F116 C4).
	DeleteAgregado(ctx context.Context, id string) error

	// Catalog: categories
	ListCategories(ctx context.Context) ([]domain.ModuleCategory, error)
	GetCategoryByID(ctx context.Context, id string) (*domain.ModuleCategory, error)
	CreateCategory(ctx context.Context, c *domain.ModuleCategory) error
	UpdateCategory(ctx context.Context, id string, c *domain.ModuleCategory) error
	DeleteCategory(ctx context.Context, id string) error

	// Catalog: modules + full catalog
	// ListModules returns modules with their measure presets only (catalog
	// projections like the SketchUp furniture definitions endpoint).
	ListModules(ctx context.Context) ([]domain.Module, error)
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
	// Physical part/unit execution (OC-030..034): locked read-modify-write of
	// part_instances/module_units with derived legacy statuses + audit events.
	MutateProjectPartExecutions(
		ctx context.Context,
		projectID string,
		mutate func(snap *domain.PartExecutionsSnapshot) (*domain.PartExecutionsMutation, error),
	) (*domain.PartExecutionsMutation, error)
	// Installation job (OC-070..074): locked read-modify-write of the
	// installation JSONB (visits, field issues, punch, closeout) with the
	// audit lifecycle events appended in the same transaction.
	MutateProjectInstallation(
		ctx context.Context,
		projectID string,
		mutate func(snap *domain.InstallationSnapshot) (*domain.InstallationMutation, error),
	) (*domain.InstallationMutation, error)
	// Material planning (OC-050..054): locked read-modify-write of the
	// material_planning JSONB with the warehouse context (stock, plannings,
	// POs), the evidence gates and the audit lifecycle events.
	MutateProjectMaterialPlanning(
		ctx context.Context,
		projectID string,
		mutate func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error),
	) (*domain.MaterialPlanningMutation, error)
	// Quality job (OC-060..062): locked read-modify-write of the quality JSONB
	// (issues, rework actions, unit QC) plus the physical executions a rework
	// action may touch, with audit events in the same transaction.
	MutateProjectQuality(
		ctx context.Context,
		projectID string,
		mutate func(snap *domain.QualitySnapshot) (*domain.QualityMutation, error),
	) (*domain.QualityMutation, error)
	// Job costing (OC-080..084): locked read-modify-write of the costing JSONB
	// (baseline, time entries, other costs) with the valuation context (quote
	// snapshot, release, rework, job consumption) and audit events.
	MutateProjectCosting(
		ctx context.Context,
		projectID string,
		mutate func(snap *domain.JobCostingSnapshot) (*domain.JobCostingMutation, error),
	) (*domain.JobCostingMutation, error)
	// Structured site survey (OC-040/OC-041): locked read-modify-write of the
	// site_survey JSONB (spaces, field measures, verification, freeze) with
	// audit events.
	MutateProjectSurvey(
		ctx context.Context,
		projectID string,
		mutate func(survey *domain.SiteSurvey) (*domain.SiteSurveyMutation, error),
	) (*domain.SiteSurveyMutation, error)
	// Project lifecycle events log (OC-010): immutable append-only events.
	InsertProjectEvent(ctx context.Context, ev domain.ProjectEvent) error
	ListProjectEvents(ctx context.Context, projectID string) ([]domain.ProjectEvent, error)

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

	// Compras/Almacén picking (Fase 3): project × material despacho state.
	ListAllPicking(ctx context.Context) ([]domain.ProjectPicking, error)
	UpsertProjectPicking(ctx context.Context, pick domain.ProjectPicking) error

	// Compras/Almacén stock (Fase 3b): live balances + immutable movement ledger.
	ListStock(ctx context.Context) ([]domain.MaterialStock, error)
	UpsertStockMin(ctx context.Context, kind domain.StockMaterialKind, materialID string, minStock float64) (domain.MaterialStock, error)
	RecordStockMovement(ctx context.Context, mov domain.StockMovement) (domain.StockMovement, error)
	GetStockMovementByID(ctx context.Context, id string) (*domain.StockMovement, error)
	GetStockMovementByRevertsID(ctx context.Context, revertsID string) (*domain.StockMovement, error)
	ListStockMovements(ctx context.Context, kind domain.StockMaterialKind, materialID string, projectID string, limit int) ([]domain.StockMovement, error)

	// Compras/Almacén suppliers + purchase orders (Fase 3c).
	ListSuppliers(ctx context.Context) ([]domain.Supplier, error)
	CreateSupplier(ctx context.Context, sp domain.Supplier) error
	UpdateSupplier(ctx context.Context, sp domain.Supplier) error
	DeactivateSupplier(ctx context.Context, id string) error
	ListPurchaseOrders(ctx context.Context) ([]domain.PurchaseOrder, error)
	GetPurchaseOrderByID(ctx context.Context, id string) (*domain.PurchaseOrder, error)
	CreatePurchaseOrder(ctx context.Context, po domain.PurchaseOrder) error
	UpdatePurchaseOrder(ctx context.Context, po domain.PurchaseOrder) error
	EmitPurchaseOrder(ctx context.Context, id string) (domain.PurchaseOrder, error)
	CancelPurchaseOrder(ctx context.Context, id string) (domain.PurchaseOrder, error)
	ReceivePurchaseOrder(ctx context.Context, id string, lines []domain.PurchaseOrderItem, byUserID, byName string) (domain.PurchaseOrder, error)

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
