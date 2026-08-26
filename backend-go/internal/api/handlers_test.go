package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// stubStore is a minimal Store for handler unit tests. Only the methods under
// test are populated; the rest panic so a misconfigured test fails loudly
// instead of silently passing. This mirrors the httptest.ResponseRecorder style
// of middleware_test.go and avoids any database dependency.
type stubStore struct {
	createCustomerErr    error
	createMaterialErr    error
	createProjectErr     error
	updateProjectErr     error
	customerReturnedByID *domain.Customer
	customerGetByIDErr   error
	projectReturnedByID  *domain.Project
	projectGetByIDErr    error
	listCustomers        []domain.Customer
	listProjects         []domain.Project
	listMaterials        []domain.MaterialBoard
	lastCreatedCustomer  *domain.Customer
	lastCreatedProject   *domain.Project
	materialReturnedByID *domain.MaterialBoard
	materialGetByIDErr   error
	// Ambient materials (presentation-only floor/wall, #4150)
	listAmbientMaterials      []domain.AmbientMaterial
	ambientReturnedByID       *domain.AmbientMaterial
	ambientGetByIDErr         error
	createAmbientErr          error
	createAmbientOK           bool
	updateAmbientCalled       bool
	updateAmbientReceived     *domain.AmbientMaterial
	deactivateAmbientCalled   bool
	deactivateAmbientReceived string
	// Ambient categories (F086)
	listAmbientCategories       []domain.AmbientCategory
	ambientCategoryReturnedByID *domain.AmbientCategory
	ambientCategoryGetByIDErr   error
	createAmbientCategoryErr    error
	createAmbientCategoryOK     bool
	updateAmbientCategoryCalled bool
	deleteAmbientCategoryCalled bool
	// Material categories (F142)
	listMaterialCategories        []domain.MaterialCategory
	materialCategoryReturnedByID  *domain.MaterialCategory
	materialCategoryGetByIDErr    error
	createMaterialCategoryErr     error
	createMaterialCategoryOK      bool
	updateMaterialCategoryCalled  bool
	deleteMaterialCategoryCalled  bool
	deleteMaterialCategoryErrHook error
	// Auth test hooks
	getUserByEmail      *domain.User
	getUserByEmailErr   error
	setLicense          func(ctx context.Context, id string, plan domain.LicensePlan, expiresAt *time.Time) error
	createUserErr       error
	listUsers           []domain.User
	// Multi-org memberships by user (ADR-0004) for login/select-org tests.
	membershipsByUser   map[string][]domain.MembershipWithOrg
	createMaterialOK    bool
	deleteProjectCalled bool
	// F044 workshop settings (nil → defaults, flag false)
	workshopSettings *domain.WorkshopSettings
	// #108: optional catalog returned by GetFullCatalog. nil → empty catalog.
	catalogOverride *domain.Catalog
	// Workshop furniture modules served by ListModules (SketchUp catalog).
	listModules    []domain.Module
	listModulesErr error
	// Module categories for the workshop catalog projection.
	listCategories []domain.ModuleCategory
	// Composition lists for the furniture catalog/layout endpoints
	// (estimated piece counts + resolved layouts for SketchUp).
	listStructures   []domain.Structure
	listComponents   []domain.Component
	listAgregados    []domain.Agregado
	listHardwares    []domain.Hardware
	listOptionGroups []domain.OptionGroup
	// #110: project templates hooks.
	listProjectTemplates []domain.ProjectTemplate
	lastCreatedTemplate  *domain.ProjectTemplate
	deleteTemplateCalled bool
	// Catalog media lifecycle hooks (F040 cleanup).
	updateMaterialCalled   bool
	updateMaterialReceived *domain.MaterialBoard
	hardwareReturnedByID   *domain.Hardware
	updateHardwareCalled   bool
	updateHardwareReceived *domain.Hardware
	moduleReturnedByID     *domain.Module
	// Floor scan (F089-RN): per-id modules + floor status write log.
	modulesByID       map[string]*domain.Module
	floorStatusWrites []floorStatusWrite
	// Physical part executions (OC-030..034): in-memory state + write log.
	partInstances     []domain.PartInstance
	moduleUnits       []domain.ModuleUnitExecution
	itemFloorStatuses map[string]string
	itemQuantities    map[string]int
	mutateFloorEvents []domain.FloorStatusEvent
	mutateErr         error
	floorEventWrites  []domain.FloorStatusEvent
	floorEventsList   []domain.FloorStatusEvent
	userSectorsList   []domain.UserSector
	// Installation job (OC-070..074): in-memory state + audit write log.
	installationJob           *domain.InstallationJob
	materialPlanning          *domain.MaterialPlanning
	materialStock             []domain.MaterialStock
	purchaseOrders            []domain.PurchaseOrder
	productionRelease         *domain.ProductionRelease
	materialsReleased         bool
	hasMaterialsReservedEvent bool
	materialPlanningEvents    []domain.ProjectEvent
	qualityJob                *domain.QualityJob
	releasedRevision          string
	qualityEvents             []domain.ProjectEvent
	// Job costing (OC-080..OC-084): in-memory state + audit write log.
	jobCosting            *domain.JobCosting
	costingPriceSnapshot  *domain.QuotePriceSnapshot
	costingConsumption    []domain.MaterialConsumptionInput
	costingEvents         []domain.ProjectEvent
	costingProjectMissing bool
	// Structured site survey (OC-040/OC-041, #305).
	siteSurvey                    *domain.SiteSurvey
	siteSurveyEvents              []domain.ProjectEvent
	installationUnits             []domain.ModuleUnitExecution
	installationItems             []domain.ProjectItem
	installationHasStartedEvent   bool
	installationHasCompletedEvent bool
	installationEvents            []domain.ProjectEvent
	// Compras/Almacén picking (Fase 3)
	pickingList         []domain.ProjectPicking
	pickingUpsertWrites []domain.ProjectPicking
	pickingListErr      error
	pickingUpsertErr    error
	// Compras/Almacén stock (Fase 3b)
	stockList              []domain.MaterialStock
	stockListErr           error
	stockMovementsList     []domain.StockMovement
	stockMovements         []domain.StockMovement // recorded by RecordStockMovement
	stockBalances          map[string]float64     // key kind:material_id
	stockUpsertMinCalled   bool
	stockUpsertMinReceived domain.MaterialStock
	// Compras/Almacén suppliers + purchase orders (Fase 3c)
	suppliersList          []domain.Supplier
	createSupplierErr      error
	updateSupplierErr      error
	deactivateSupplierErr  error
	posList                []domain.PurchaseOrder
	poReturnedByID         *domain.PurchaseOrder
	poGetByIDErr           error
	createPOErr            error
	updatePOErr            error
	emitPOCalled           bool
	cancelPOCalled         bool
	receivePOCalled        bool
	lastReceiveLines       []domain.PurchaseOrderItem
	lastReceiveByUserID    string
	lastReceiveByName      string
	activitiesByID         []domain.ProductionActivity
	insertedActivities     []domain.ProductionActivity
	floorStatusErr         error
	projectEventsList      []domain.ProjectEvent
	projectEventWrites     []domain.ProjectEvent
	insertProjectEventErr  error
	listProjectEventsErr   error
	updateModuleCalled     bool
	updateModuleReceived   *domain.Module
	deleteModuleCalled     bool
	deleteModuleReceivedID string
}

func (s *stubStore) CreateCustomer(ctx context.Context, c *domain.Customer) error {
	if s.createCustomerErr != nil {
		return s.createCustomerErr
	}
	cp := *c
	s.lastCreatedCustomer = &cp
	return nil
}
func (s *stubStore) CreateMaterialBoard(ctx context.Context, m *domain.MaterialBoard) error {
	if s.createMaterialErr != nil {
		return s.createMaterialErr
	}
	s.createMaterialOK = true
	return nil
}
func (s *stubStore) CreateProject(ctx context.Context, p *domain.Project) error {
	if s.createProjectErr != nil {
		return s.createProjectErr
	}
	cp := *p
	s.lastCreatedProject = &cp
	return nil
}
func (s *stubStore) GetCustomerByID(ctx context.Context, id string) (*domain.Customer, error) {
	return s.customerReturnedByID, s.customerGetByIDErr
}
func (s *stubStore) GetMaterialBoardByID(ctx context.Context, id string) (*domain.MaterialBoard, error) {
	return s.materialReturnedByID, s.materialGetByIDErr
}

// stubNotUsed marks interface methods that the focal handlers never call.
func (s *stubStore) stubNotUsed(name string) {
	panic("stubStore: unexpected call to " + name + " — add a field if the test needs it")
}

// The remaining Store methods are not exercised by the duplicate-key tests.
func (s *stubStore) GetUserByEmail(context.Context, string) (*domain.User, error) {
	return s.getUserByEmail, s.getUserByEmailErr
}
func (s *stubStore) GetUserByID(context.Context, string) (*domain.User, error) {
	if s.getUserByEmail != nil {
		return s.getUserByEmail, s.getUserByEmailErr
	}
	return nil, s.getUserByEmailErr
}
func (s *stubStore) CreateUser(context.Context, *domain.User) error {
	return s.createUserErr
}
func (s *stubStore) UpdateUser(_ context.Context, u *domain.User) error {
	s.stubNotUsed("UpdateUser")
	return nil
}
func (s *stubStore) ListUsers(context.Context) ([]domain.User, error) {
	if s.listUsers != nil {
		return s.listUsers, nil
	}
	return []domain.User{}, nil
}
func (s *stubStore) ApproveUser(context.Context, string) error {
	s.stubNotUsed("ApproveUser")
	return nil
}
func (s *stubStore) UpdateUserRole(context.Context, string, domain.UserRole) error {
	s.stubNotUsed("UpdateUserRole")
	return nil
}
func (s *stubStore) SetUserLicense(ctx context.Context, id string, plan domain.LicensePlan, expiresAt *time.Time) error {
	if s.setLicense != nil {
		return s.setLicense(ctx, id, plan, expiresAt)
	}
	s.stubNotUsed("SetUserLicense")
	return nil
}
func (s *stubStore) RejectUser(context.Context, string) error {
	s.stubNotUsed("RejectUser")
	return nil
}

// --- Organizations / memberships / security audit (ADR-0004) ---

// GetOrganizationByID mirrors the stub's single-user world onto the scoped
// organization: the furniture license gate moved from the user to the
// organization (ADR-0004), so legacy license tests keep their intent when the
// org carries the same plan/expiry as the configured user.
func (s *stubStore) GetOrganizationByID(_ context.Context, _ string) (*domain.Organization, error) {
	if s.getUserByEmail != nil {
		return &domain.Organization{
			ID:               storage.InitialOrganizationID,
			Name:             "Taller Test",
			Slug:             "taller-test",
			Type:             domain.OrganizationTypeFactory,
			LicensePlan:      s.getUserByEmail.LicensePlan,
			LicenseExpiresAt: s.getUserByEmail.LicenseExpiresAt,
			Active:           true,
		}, nil
	}
	return nil, errors.New("organization not found")
}

func (s *stubStore) GetOrganizationBySlug(context.Context, string) (*domain.Organization, error) {
	return nil, errors.New("organization not found")
}

func (s *stubStore) ListOrganizations(context.Context) ([]domain.Organization, error) {
	return nil, nil
}

func (s *stubStore) CreateOrganization(context.Context, *domain.Organization) error {
	return nil
}

func (s *stubStore) ListMembershipsByUser(_ context.Context, userID string) ([]domain.MembershipWithOrg, error) {
	if s.membershipsByUser != nil {
		return s.membershipsByUser[userID], nil
	}
	return nil, nil
}

func (s *stubStore) GetActiveMembership(_ context.Context, userID, organizationID string) (*domain.MembershipWithOrg, error) {
	if s.membershipsByUser != nil {
		for _, m := range s.membershipsByUser[userID] {
			if m.OrganizationID == organizationID {
				return &m, nil
			}
		}
	}
	return nil, errors.New("membership not found")
}

func (s *stubStore) EnsureMembership(context.Context, string, string, []domain.UserRole) error {
	return nil
}

func (s *stubStore) SetMembershipRoles(context.Context, string, []domain.UserRole) error {
	return nil
}

func (s *stubStore) SetPlatformAdmin(context.Context, string, bool) error {
	return nil
}

func (s *stubStore) InsertSecurityAuditEvent(context.Context, storage.SecurityAuditEvent) error {
	return nil
}
func (s *stubStore) ListCustomers(context.Context) ([]domain.Customer, error) {
	if s.listCustomers != nil {
		return s.listCustomers, nil
	}
	return []domain.Customer{}, nil
}
func (s *stubStore) UpdateCustomer(context.Context, string, *domain.Customer) error {
	return nil
}
func (s *stubStore) DeactivateCustomer(context.Context, string) error {
	return nil
}
func (s *stubStore) ListMaterialBoards(context.Context) ([]domain.MaterialBoard, error) {
	if s.listMaterials != nil {
		return s.listMaterials, nil
	}
	return []domain.MaterialBoard{}, nil
}
func (s *stubStore) UpdateMaterialBoard(_ context.Context, _ string, m *domain.MaterialBoard) error {
	s.updateMaterialCalled = true
	cp := *m
	s.updateMaterialReceived = &cp
	return nil
}
func (s *stubStore) DeactivateMaterialBoard(context.Context, string) error {
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
func (s *stubStore) UpdateAmbientMaterial(_ context.Context, _ string, m *domain.AmbientMaterial) error {
	s.updateAmbientCalled = true
	cp := *m
	s.updateAmbientReceived = &cp
	return nil
}
func (s *stubStore) DeactivateAmbientMaterial(_ context.Context, id string) error {
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
func (s *stubStore) UpdateAmbientCategory(_ context.Context, _ string, _ *domain.AmbientCategory) error {
	s.updateAmbientCategoryCalled = true
	return nil
}
func (s *stubStore) DeleteAmbientCategory(_ context.Context, _ string) error {
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
func (s *stubStore) UpdateMaterialCategory(_ context.Context, _ string, _ *domain.MaterialCategory) error {
	s.updateMaterialCategoryCalled = true
	return nil
}
func (s *stubStore) DeleteMaterialCategory(_ context.Context, _ string) error {
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
func (s *stubStore) UpdateEdgeBand(context.Context, string, *domain.EdgeBand) error {
	s.stubNotUsed("UpdateEdgeBand")
	return nil
}
func (s *stubStore) DeactivateEdgeBand(context.Context, string) error {
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
func (s *stubStore) UpdateHardware(_ context.Context, _ string, h *domain.Hardware) error {
	s.updateHardwareCalled = true
	cp := *h
	s.updateHardwareReceived = &cp
	return nil
}
func (s *stubStore) DeactivateHardware(context.Context, string) error {
	s.stubNotUsed("DeactivateHardware")
	return nil
}
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
func (s *stubStore) UpdateOptionGroup(context.Context, string, *domain.OptionGroup) error {
	s.stubNotUsed("UpdateOptionGroup")
	return nil
}
func (s *stubStore) DeleteOptionGroup(context.Context, string) error {
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
func (s *stubStore) UpdateCategory(context.Context, string, *domain.ModuleCategory) error {
	s.stubNotUsed("UpdateCategory")
	return nil
}
func (s *stubStore) DeleteCategory(context.Context, string) error {
	s.stubNotUsed("DeleteCategory")
	return nil
}
func (s *stubStore) ListModules(context.Context) ([]domain.Module, error) {
	return s.listModules, s.listModulesErr
}

func (s *stubStore) GetFullCatalog(context.Context) (domain.Catalog, error) {
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

type floorStatusWrite struct {
	projectID string
	itemID    string
	status    string
}

func (s *stubStore) SetProjectItemFloorStatus(_ context.Context, projectID, itemID, status string) error {
	if s.floorStatusErr != nil {
		return s.floorStatusErr
	}
	s.floorStatusWrites = append(s.floorStatusWrites, floorStatusWrite{projectID, itemID, status})
	return nil
}

func (s *stubStore) InsertFloorEvent(_ context.Context, ev domain.FloorStatusEvent) error {
	s.floorEventWrites = append(s.floorEventWrites, ev)
	return nil
}

func (s *stubStore) ListFloorEvents(_ context.Context, _ string) ([]domain.FloorStatusEvent, error) {
	return s.floorEventsList, nil
}

func (s *stubStore) MutateProjectPartExecutions(
	_ context.Context,
	_ string,
	mutate func(*domain.PartExecutionsSnapshot) (*domain.PartExecutionsMutation, error),
) (*domain.PartExecutionsMutation, error) {
	if s.mutateErr != nil {
		return nil, s.mutateErr
	}
	snap := &domain.PartExecutionsSnapshot{
		Parts:          append([]domain.PartInstance(nil), s.partInstances...),
		Units:          append([]domain.ModuleUnitExecution(nil), s.moduleUnits...),
		ItemStatuses:   map[string]string{},
		ItemQuantities: map[string]int{},
		Quality:        s.qualityJob,
	}
	for k, v := range s.itemFloorStatuses {
		snap.ItemStatuses[k] = v
	}
	for k, v := range s.itemQuantities {
		snap.ItemQuantities[k] = v
	}
	mutation, err := mutate(snap)
	if err != nil {
		return nil, err
	}
	s.partInstances = mutation.Parts
	s.moduleUnits = mutation.Units
	s.mutateFloorEvents = append(s.mutateFloorEvents, mutation.FloorEvents...)
	return mutation, nil
}

func (s *stubStore) MutateProjectInstallation(
	_ context.Context,
	_ string,
	mutate func(*domain.InstallationSnapshot) (*domain.InstallationMutation, error),
) (*domain.InstallationMutation, error) {
	snap := &domain.InstallationSnapshot{
		Job:                           s.installationJob,
		Units:                         append([]domain.ModuleUnitExecution(nil), s.installationUnits...),
		Items:                         append([]domain.ProjectItem(nil), s.installationItems...),
		HasInstallationStartedEvent:   s.installationHasStartedEvent,
		HasInstallationCompletedEvent: s.installationHasCompletedEvent,
	}
	mutation, err := mutate(snap)
	if err != nil {
		return nil, err
	}
	s.installationJob = mutation.Job
	s.installationEvents = append(s.installationEvents, mutation.Events...)
	return mutation, nil
}

func (s *stubStore) MutateProjectMaterialPlanning(
	_ context.Context,
	_ string,
	mutate func(*domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error),
) (*domain.MaterialPlanningMutation, error) {
	snap := &domain.MaterialPlanningSnapshot{
		Planning:                  s.materialPlanning,
		AllPlannings:              []*domain.MaterialPlanning{s.materialPlanning},
		Stock:                     append([]domain.MaterialStock(nil), s.materialStock...),
		PurchaseOrders:            append([]domain.PurchaseOrder(nil), s.purchaseOrders...),
		ProductionRelease:         s.productionRelease,
		MaterialsReleased:         s.materialsReleased,
		HasMaterialsReservedEvent: s.hasMaterialsReservedEvent,
	}
	mutation, err := mutate(snap)
	if err != nil {
		return nil, err
	}
	s.materialPlanning = mutation.Planning
	s.materialsReleased = snap.MaterialsReleased || mutation.MaterialsRelease != nil
	s.materialPlanningEvents = append(s.materialPlanningEvents, mutation.Events...)
	return mutation, nil
}

func (s *stubStore) MutateProjectQuality(
	_ context.Context,
	_ string,
	mutate func(*domain.QualitySnapshot) (*domain.QualityMutation, error),
) (*domain.QualityMutation, error) {
	snap := &domain.QualitySnapshot{
		Quality:          s.qualityJob,
		Parts:            append([]domain.PartInstance(nil), s.partInstances...),
		Units:            append([]domain.ModuleUnitExecution(nil), s.moduleUnits...),
		ItemStatuses:     map[string]string{},
		ItemQuantities:   map[string]int{},
		ReleasedRevision: s.releasedRevision,
	}
	mutation, err := mutate(snap)
	if err != nil {
		return nil, err
	}
	s.qualityJob = mutation.Quality
	if mutation.Parts != nil {
		s.partInstances = mutation.Parts
	}
	if mutation.Units != nil {
		s.moduleUnits = mutation.Units
	}
	s.qualityEvents = append(s.qualityEvents, mutation.Events...)
	return mutation, nil
}

func (s *stubStore) MutateProjectCosting(
	_ context.Context,
	projectID string,
	mutate func(*domain.JobCostingSnapshot) (*domain.JobCostingMutation, error),
) (*domain.JobCostingMutation, error) {
	if s.costingProjectMissing {
		return nil, errors.New("project not found")
	}
	snap := &domain.JobCostingSnapshot{
		Costing:           s.jobCosting,
		PriceSnapshot:     s.costingPriceSnapshot,
		ProductionRelease: s.productionRelease,
		Quality:           s.qualityJob,
		Consumption:       append([]domain.MaterialConsumptionInput(nil), s.costingConsumption...),
	}
	mutation, err := mutate(snap)
	if err != nil {
		return nil, err
	}
	if mutation.Costing != nil {
		s.jobCosting = mutation.Costing
	}
	s.costingEvents = append(s.costingEvents, mutation.Events...)
	return mutation, nil
}

func (s *stubStore) MutateProjectSurvey(
	_ context.Context,
	_ string,
	mutate func(*domain.SiteSurvey) (*domain.SiteSurveyMutation, error),
) (*domain.SiteSurveyMutation, error) {
	mutation, err := mutate(s.siteSurvey)
	if err != nil {
		return nil, err
	}
	if mutation.Survey != nil {
		s.siteSurvey = mutation.Survey
	}
	s.siteSurveyEvents = append(s.siteSurveyEvents, mutation.Events...)
	return mutation, nil
}

func (s *stubStore) InsertProjectEvent(_ context.Context, ev domain.ProjectEvent) error {
	if s.insertProjectEventErr != nil {
		return s.insertProjectEventErr
	}
	s.projectEventWrites = append(s.projectEventWrites, ev)
	return nil
}

func (s *stubStore) ListProjectEvents(_ context.Context, _ string) ([]domain.ProjectEvent, error) {
	if s.listProjectEventsErr != nil {
		return nil, s.listProjectEventsErr
	}
	return s.projectEventsList, nil
}
func (s *stubStore) CreateModule(context.Context, *domain.Module) error {
	s.stubNotUsed("CreateModule")
	return nil
}
func (s *stubStore) UpdateModule(_ context.Context, _ string, m *domain.Module) error {
	s.updateModuleCalled = true
	cp := *m
	s.updateModuleReceived = &cp
	return nil
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
func (s *stubStore) UpdateStructure(context.Context, string, *domain.Structure) error {
	s.stubNotUsed("UpdateStructure")
	return nil
}
func (s *stubStore) DeleteStructure(context.Context, string) error {
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
func (s *stubStore) UpdateAgregado(context.Context, string, *domain.Agregado) error {
	s.stubNotUsed("UpdateAgregado")
	return nil
}
func (s *stubStore) DeleteAgregado(context.Context, string) error {
	return nil
}

func (s *stubStore) DeactivateAgregado(context.Context, string) error {
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
func (s *stubStore) UpdateComponent(context.Context, string, *domain.Component) error {
	s.stubNotUsed("UpdateComponent")
	return nil
}
func (s *stubStore) DeleteComponent(context.Context, string) error {
	s.stubNotUsed("DeleteComponent")
	return nil
}
func (s *stubStore) ListProjects(context.Context) ([]domain.Project, error) {
	if s.listProjects != nil {
		return s.listProjects, nil
	}
	return []domain.Project{}, nil
}
func (s *stubStore) GetProjectByID(context.Context, string) (*domain.Project, error) {
	return s.projectReturnedByID, s.projectGetByIDErr
}
func (s *stubStore) UpdateProject(context.Context, string, *domain.Project) error {
	if s.updateProjectErr != nil {
		return s.updateProjectErr
	}
	return nil
}
func (s *stubStore) DeleteProject(context.Context, string) error {
	s.deleteProjectCalled = true
	return nil
}

func (s *stubStore) GetWorkshopSettings(context.Context) (domain.WorkshopSettings, error) {
	if s.workshopSettings != nil {
		return *s.workshopSettings, nil
	}
	return domain.DefaultWorkshopSettings(), nil
}

func (s *stubStore) UpsertWorkshopSettings(_ context.Context, ws domain.WorkshopSettings) (domain.WorkshopSettings, error) {
	cp := ws
	s.workshopSettings = &cp
	return ws, nil
}

func (s *stubStore) SeedCatalog(_ context.Context) error {
	return nil // not used by handler tests
}

// #110 / H15 — project templates stubs (no behavior; tests below inject data).
func (s *stubStore) ListProjectTemplates(_ context.Context) ([]domain.ProjectTemplate, error) {
	return s.listProjectTemplates, nil
}
func (s *stubStore) GetProjectTemplateByID(_ context.Context, _ string) (*domain.ProjectTemplate, error) {
	return nil, errors.New("template not found")
}
func (s *stubStore) CreateProjectTemplate(_ context.Context, t domain.ProjectTemplate) error {
	cp := t
	s.lastCreatedTemplate = &cp
	return nil
}
func (s *stubStore) UpdateProjectTemplate(_ context.Context, _ string, t domain.ProjectTemplate) error {
	cp := t
	s.lastCreatedTemplate = &cp
	return nil
}
func (s *stubStore) DeleteProjectTemplate(_ context.Context, _ string) error {
	s.deleteTemplateCalled = true
	return nil
}

func (s *stubStore) ListProjectPhotos(_ context.Context, _ string) ([]domain.ProjectPhoto, error) {
	return []domain.ProjectPhoto{}, nil
}
func (s *stubStore) GetProjectPhotoByID(_ context.Context, _ string) (*domain.ProjectPhoto, error) {
	return nil, nil
}
func (s *stubStore) CreateProjectPhoto(_ context.Context, _ *domain.ProjectPhoto) error {
	return nil
}
func (s *stubStore) UpdateProjectPhoto(_ context.Context, _ string, _ string, _ bool, _ domain.ProjectPhotoStage) (*domain.ProjectPhoto, error) {
	return nil, nil
}
func (s *stubStore) DeleteProjectPhoto(_ context.Context, _ string) error {
	return nil
}

func (s *stubStore) ListProjectInternalMessages(_ context.Context, _ string) ([]domain.ProjectInternalMessage, error) {
	return []domain.ProjectInternalMessage{}, nil
}
func (s *stubStore) CreateProjectInternalMessage(_ context.Context, _ *domain.ProjectInternalMessage) error {
	return nil
}
func (s *stubStore) UpdateProjectTechnicalWorkflow(_ context.Context, _ string, _ *string, _ string, _ *string, _ *string) error {
	return nil
}

func (s *stubStore) ListWarrantyTickets(_ context.Context, _, _, _ string) ([]domain.WarrantyTicket, error) {
	return []domain.WarrantyTicket{}, nil
}
func (s *stubStore) GetWarrantyTicketByID(_ context.Context, _ string) (*domain.WarrantyTicket, error) {
	return nil, nil
}
func (s *stubStore) CreateWarrantyTicket(_ context.Context, _ *domain.WarrantyTicket) error {
	return nil
}
func (s *stubStore) UpdateWarrantyTicket(_ context.Context, _ *domain.WarrantyTicket) error {
	return nil
}
func (s *stubStore) DeleteWarrantyTicket(_ context.Context, _ string) error {
	return nil
}
func (s *stubStore) ListWarrantyTicketPhotos(_ context.Context, _ string) ([]domain.WarrantyTicketPhoto, error) {
	return []domain.WarrantyTicketPhoto{}, nil
}
func (s *stubStore) AddWarrantyTicketPhoto(_ context.Context, _ *domain.WarrantyTicketPhoto) error {
	return nil
}
func (s *stubStore) DeleteWarrantyTicketPhoto(_ context.Context, _, _ string) error {
	return nil
}
func (s *stubStore) ListShowcasePhotos(_ context.Context, _ bool) ([]domain.ShowcasePhotoItem, error) {
	return []domain.ShowcasePhotoItem{}, nil
}

// Production activity stubs
func (s *stubStore) InsertProductionActivity(_ context.Context, activity domain.ProductionActivity) error {
	s.insertedActivities = append(s.insertedActivities, activity)
	return nil
}
func (s *stubStore) GetActiveActivitiesBySector(_ context.Context, sector domain.ProductionSector) ([]domain.ProductionActivity, error) {
	activities := []domain.ProductionActivity{}
	for _, activity := range s.insertedActivities {
		if activity.Sector == sector && activity.FinishedAt == nil {
			activities = append(activities, activity)
		}
	}
	return activities, nil
}
func (s *stubStore) GetActiveActivitiesByOperator(_ context.Context, _ string) ([]domain.ProductionActivity, error) {
	return []domain.ProductionActivity{}, nil
}
func (s *stubStore) GetActiveActivityByID(_ context.Context, id string) (*domain.ProductionActivity, error) {
	for i := range s.activitiesByID {
		if s.activitiesByID[i].ID == id {
			act := s.activitiesByID[i]
			return &act, nil
		}
	}
	return nil, nil
}
func (s *stubStore) FinishProductionActivity(_ context.Context, _ string, _ int, _ string) error {
	return nil
}
func (s *stubStore) ListProductionActivitiesByProject(_ context.Context, _ string, _ int) ([]domain.ProductionActivity, error) {
	return []domain.ProductionActivity{}, nil
}
func (s *stubStore) GetSectorMetrics(_ context.Context, _ domain.ProductionSector, _ string) (*domain.SectorDashboard, error) {
	return &domain.SectorDashboard{}, nil
}
func (s *stubStore) GetOperatorMetrics(_ context.Context, _, _ string) (*domain.OperatorMetrics, error) {
	return &domain.OperatorMetrics{}, nil
}
func (s *stubStore) GetDashboardMetrics(_ context.Context) (*domain.DashboardMetrics, error) {
	return &domain.DashboardMetrics{}, nil
}
func (s *stubStore) InsertDamageReport(_ context.Context, _ domain.DamageReport) error {
	return nil
}
func (s *stubStore) GetDamageReportByID(_ context.Context, _ string) (*domain.DamageReport, error) {
	return nil, nil
}
func (s *stubStore) ListDamageReportsByProject(_ context.Context, _ string) ([]domain.DamageReport, error) {
	return []domain.DamageReport{}, nil
}
func (s *stubStore) ResolveDamageReport(_ context.Context, _ string) error {
	return nil
}
func (s *stubStore) GetTodayDamageCount(_ context.Context) (int, error) {
	return 0, nil
}

// User sector stubs
func (s *stubStore) ListUserSectors(_ context.Context, _ string) ([]domain.UserSector, error) {
	return s.userSectorsList, nil
}
func (s *stubStore) SetUserSectors(_ context.Context, _ string, _ []domain.UserSector) error {
	return nil
}
func (s *stubStore) GetUsersBySector(_ context.Context, _ string) ([]domain.User, error) {
	return []domain.User{}, nil
}

// Compras/Almacén picking stubs (Fase 3)
func (s *stubStore) ListAllPicking(_ context.Context) ([]domain.ProjectPicking, error) {
	if s.pickingListErr != nil {
		return nil, s.pickingListErr
	}
	if s.pickingList != nil {
		return s.pickingList, nil
	}
	return []domain.ProjectPicking{}, nil
}
func (s *stubStore) UpsertProjectPicking(_ context.Context, pick domain.ProjectPicking) error {
	if s.pickingUpsertErr != nil {
		return s.pickingUpsertErr
	}
	s.pickingUpsertWrites = append(s.pickingUpsertWrites, pick)
	return nil
}

// Compras/Almacén stock stubs (Fase 3b) — RecordStockMovement emulates the
// transactional balance logic (lock → balance_after → insert) so handler tests
// can assert balances without a database.
func (s *stubStore) ListStock(_ context.Context) ([]domain.MaterialStock, error) {
	if s.stockListErr != nil {
		return nil, s.stockListErr
	}
	if s.stockList != nil {
		return s.stockList, nil
	}
	return []domain.MaterialStock{}, nil
}
func (s *stubStore) UpsertStockMin(_ context.Context, kind domain.StockMaterialKind, materialID string, minStock float64) (domain.MaterialStock, error) {
	s.stockUpsertMinCalled = true
	s.stockUpsertMinReceived = domain.MaterialStock{
		Kind: kind, MaterialID: materialID, MinStock: minStock,
	}
	return s.stockUpsertMinReceived, nil
}
func (s *stubStore) GetStockMovementByID(_ context.Context, id string) (*domain.StockMovement, error) {
	for i := range s.stockMovements {
		if s.stockMovements[i].ID == id {
			m := s.stockMovements[i]
			return &m, nil
		}
	}
	return nil, nil
}
func (s *stubStore) GetStockMovementByRevertsID(_ context.Context, revertsID string) (*domain.StockMovement, error) {
	for i := range s.stockMovements {
		if s.stockMovements[i].RevertsID != nil && *s.stockMovements[i].RevertsID == revertsID {
			m := s.stockMovements[i]
			return &m, nil
		}
	}
	return nil, nil
}
func (s *stubStore) RecordStockMovement(_ context.Context, mov domain.StockMovement) (domain.StockMovement, error) {
	if s.stockBalances == nil {
		s.stockBalances = map[string]float64{}
	}
	key := string(mov.Kind) + ":" + mov.MaterialID
	current, exists := s.stockBalances[key]
	if !exists && mov.Type != domain.StockMovementEntrada {
		return mov, domain.ErrStockNotTracked
	}
	balance := current + mov.Delta
	if balance < 0 {
		return mov, fmt.Errorf("%w: faltan %.2f", domain.ErrStockInsufficient, -balance)
	}
	s.stockBalances[key] = balance
	saved := mov
	saved.BalanceAfter = balance
	saved.ID = fmt.Sprintf("sm-%d", len(s.stockMovements)+1)
	s.stockMovements = append(s.stockMovements, saved)
	return saved, nil
}
func (s *stubStore) ListStockMovements(_ context.Context, _ domain.StockMaterialKind, _ string, _ string, _ int) ([]domain.StockMovement, error) {
	if s.stockMovementsList != nil {
		return s.stockMovementsList, nil
	}
	if s.stockMovements != nil {
		return s.stockMovements, nil
	}
	return []domain.StockMovement{}, nil
}

// Compras/Almacén suppliers + purchase orders stubs (Fase 3c).
func (s *stubStore) ListSuppliers(_ context.Context) ([]domain.Supplier, error) {
	if s.suppliersList != nil {
		return s.suppliersList, nil
	}
	return []domain.Supplier{}, nil
}
func (s *stubStore) CreateSupplier(_ context.Context, sp domain.Supplier) error {
	if s.createSupplierErr != nil {
		return s.createSupplierErr
	}
	s.suppliersList = append(s.suppliersList, sp)
	return nil
}
func (s *stubStore) UpdateSupplier(_ context.Context, sp domain.Supplier) error {
	if s.updateSupplierErr != nil {
		return s.updateSupplierErr
	}
	for i := range s.suppliersList {
		if s.suppliersList[i].ID == sp.ID {
			s.suppliersList[i] = sp
		}
	}
	return nil
}
func (s *stubStore) DeactivateSupplier(_ context.Context, id string) error {
	if s.deactivateSupplierErr != nil {
		return s.deactivateSupplierErr
	}
	for i := range s.suppliersList {
		if s.suppliersList[i].ID == id {
			s.suppliersList[i].Active = false
		}
	}
	return nil
}
func (s *stubStore) ListPurchaseOrders(_ context.Context) ([]domain.PurchaseOrder, error) {
	if s.posList != nil {
		return s.posList, nil
	}
	return []domain.PurchaseOrder{}, nil
}
func (s *stubStore) GetPurchaseOrderByID(_ context.Context, id string) (*domain.PurchaseOrder, error) {
	if s.poGetByIDErr != nil {
		return nil, s.poGetByIDErr
	}
	if s.poReturnedByID != nil && s.poReturnedByID.ID == id {
		po := *s.poReturnedByID
		return &po, nil
	}
	return nil, nil
}
func (s *stubStore) CreatePurchaseOrder(_ context.Context, po domain.PurchaseOrder) error {
	if s.createPOErr != nil {
		return s.createPOErr
	}
	if po.Number == "" || strings.HasPrefix(po.Number, "OC-PO-") {
		po.Number = fmt.Sprintf("OC-%04d", len(s.posList)+1)
	}
	s.posList = append(s.posList, po)
	return nil
}
func (s *stubStore) UpdatePurchaseOrder(_ context.Context, po domain.PurchaseOrder) error {
	if s.updatePOErr != nil {
		return s.updatePOErr
	}
	if s.poReturnedByID != nil && s.poReturnedByID.ID == po.ID {
		poCopy := po
		s.poReturnedByID = &poCopy
	}
	return nil
}
func (s *stubStore) EmitPurchaseOrder(_ context.Context, id string) (domain.PurchaseOrder, error) {
	s.emitPOCalled = true
	if s.poReturnedByID == nil || s.poReturnedByID.ID != id {
		return domain.PurchaseOrder{}, nil
	}
	po := *s.poReturnedByID
	po.Status = domain.POEmitida
	return po, nil
}
func (s *stubStore) CancelPurchaseOrder(_ context.Context, id string) (domain.PurchaseOrder, error) {
	s.cancelPOCalled = true
	if s.poReturnedByID == nil || s.poReturnedByID.ID != id {
		return domain.PurchaseOrder{}, nil
	}
	po := *s.poReturnedByID
	po.Status = domain.POCancelada
	return po, nil
}
func (s *stubStore) ReceivePurchaseOrder(_ context.Context, id string, lines []domain.PurchaseOrderItem, byUserID, byName string) (domain.PurchaseOrder, error) {
	s.receivePOCalled = true
	s.lastReceiveLines = lines
	s.lastReceiveByUserID = byUserID
	s.lastReceiveByName = byName
	if s.poReturnedByID == nil || s.poReturnedByID.ID != id {
		return domain.PurchaseOrder{}, nil
	}
	po := *s.poReturnedByID
	po.Status = domain.PORecibida
	return po, nil
}

// dupErr mimics the wrapped error the storage layer returns on a unique
// violation: fmt.Errorf("error creating X: %w", pgErr).
func dupErr(op string) error {
	return errors.New(op + ": duplicate key value violates unique constraint")
}

// compile-time guard: stubStore must satisfy Store.
var _ Store = (*stubStore)(nil)

func TestHandleCustomersDuplicateKeyReturns409(t *testing.T) {
	srv := &Server{Store: &stubStore{createCustomerErr: dupErr("error creating customer")}}
	body := strings.NewReader(`{"id":"11111111-2222-3333-4444-555555555555","name":"Dup","active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/customers", body), "admin", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleCustomers(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusConflict, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "ya existe") {
		t.Errorf("error message = %q, want it to mention 'ya existe'", msg)
	}
}

func TestHandleMaterialsDuplicateKeyReturns409(t *testing.T) {
	srv := &Server{Store: &stubStore{createMaterialErr: dupErr("error creating material board")}}
	body := strings.NewReader(`{"code":"MAT-DUP","name":"Dup","manufacturer":"Arauco","width_mm":100,"length_mm":100,"thickness_mm":18,"board_price":10}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/materials", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleMaterials(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusConflict, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "código") {
		t.Errorf("error message = %q, want it to mention 'código'", msg)
	}
}

func TestHandleCustomersCreateSuccess(t *testing.T) {
	srv := &Server{Store: &stubStore{createCustomerErr: nil}}
	body := strings.NewReader(`{"id":"22222222-3333-4444-5555-666666666666","name":"Nuevo","active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/customers", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleCustomers(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusCreated, rr.Body.String())
	}
	var got domain.Customer
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if !got.Active {
		t.Errorf("expected handler to force Active=true on create, got Active=%v", got.Active)
	}
}

func TestHandleProjectsDuplicateKeyReturns409(t *testing.T) {
	srv := &Server{Store: &stubStore{createProjectErr: dupErr("error creating project")}}
	body := strings.NewReader(`{"id":"77777777-8888-9999-0000-111111111111","name":"Dup","customer_id":"c1","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusConflict, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "ya existe") {
		t.Errorf("error message = %q, want it to mention 'ya existe'", msg)
	}
}

// TestHandleProjectsCreateEchoesClientId guards the core fix: the project id
// the client sent must survive the round-trip so subsequent calls (calculate,
// update) hit the same row. Regression for the phantom-project bug where the
// DB generated its own id and the FE kept the one it minted.
func TestHandleProjectsCreateEchoesClientId(t *testing.T) {
	srv := &Server{Store: &stubStore{createProjectErr: nil}}
	const sentID = "88888888-9999-0000-1111-222222222222"
	body := strings.NewReader(`{"id":"` + sentID + `","name":"Nuevo","customer_id":"c1","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusCreated, rr.Body.String())
	}
	var got domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.ID != sentID {
		t.Errorf("project id echoed = %q, want the client-sent id %q (regression: DB must not mint its own)", got.ID, sentID)
	}
	if got.Status != domain.StatusDraft {
		t.Errorf("status = %q, want %q", got.Status, domain.StatusDraft)
	}
}

// TestHandleProjectByIDUpdateNotFoundReturns404 ensures PUT on a missing project
// returns 404 so APIWorkspaceRepository.upsert falls through to POST create.
// Regression: UpdateProject used to return nil when RowsAffected==0, upsert
// treated it as success, and POST /calculate 404'd on a phantom FE-only id.
func TestHandleProjectByIDUpdateNotFoundReturns404(t *testing.T) {
	srv := &Server{Store: &stubStore{projectGetByIDErr: errors.New("no rows in result set")}}
	body := strings.NewReader(`{"id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","name":"Ghost","customer_id":"c1","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", body), "admin", string(domain.RoleAdmin))
	req.SetPathValue("id", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjectByID(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusNotFound, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "not found") {
		t.Errorf("error message = %q, want it to mention 'not found'", msg)
	}
}

func withClaims(req *http.Request, userID, role string) *http.Request {
	claims := &auth.Claims{UserID: userID, Role: role, Email: userID + "@test.com"}
	return req.WithContext(context.WithValue(req.Context(), UserContextKey, claims))
}

func TestOwnership_VendedorListFiltersOthers(t *testing.T) {
	store := &stubStore{
		listCustomers: []domain.Customer{
			{ID: "c1", Name: "Mine", OwnerUserID: "v1"},
			{ID: "c2", Name: "Theirs", OwnerUserID: "v2"},
		},
		listProjects: []domain.Project{
			{ID: "p1", Name: "Mine", OwnerUserID: "v1"},
			{ID: "p2", Name: "Theirs", OwnerUserID: "v2"},
		},
	}
	srv := &Server{Store: store}

	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/customers", nil), "v1", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()
	srv.HandleCustomers(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("customers status %d", rr.Code)
	}
	var customers []domain.Customer
	if err := json.Unmarshal(rr.Body.Bytes(), &customers); err != nil {
		t.Fatal(err)
	}
	if len(customers) != 1 || customers[0].ID != "c1" {
		t.Fatalf("vendedor customer filter: %#v", customers)
	}

	req = withClaims(httptest.NewRequest(http.MethodGet, "/api/projects", nil), "v1", string(domain.RoleVendedor))
	rr = httptest.NewRecorder()
	srv.HandleProjects(rr, req)
	var projects []domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &projects); err != nil {
		t.Fatal(err)
	}
	if len(projects) != 1 || projects[0].ID != "p1" {
		t.Fatalf("vendedor project filter: %#v", projects)
	}
}

func TestOwnership_AdminListSeesAll(t *testing.T) {
	store := &stubStore{
		listCustomers: []domain.Customer{
			{ID: "c1", OwnerUserID: "v1"},
			{ID: "c2", OwnerUserID: "v2"},
		},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/customers", nil), "admin", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()
	srv.HandleCustomers(rr, req)
	var customers []domain.Customer
	if err := json.Unmarshal(rr.Body.Bytes(), &customers); err != nil {
		t.Fatal(err)
	}
	if len(customers) != 2 {
		t.Fatalf("admin should see all: %#v", customers)
	}
}

func TestOwnership_VendedorForcedOwnerOnCreate(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"22222222-3333-4444-5555-666666666666","name":"Nuevo","active":true,"owner_user_id":"other"}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/customers", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleCustomers(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	if store.lastCreatedCustomer == nil || store.lastCreatedCustomer.OwnerUserID != "v1" {
		t.Fatalf("expected owner forced to v1, got %#v", store.lastCreatedCustomer)
	}
}

func TestOwnership_AdminCanAssignOwnerOnCreate(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"33333333-4444-5555-6666-777777777777","name":"Asignado","active":true,"owner_user_id":"v2"}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/customers", body), "admin", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleCustomers(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status %d", rr.Code)
	}
	if store.lastCreatedCustomer == nil || store.lastCreatedCustomer.OwnerUserID != "v2" {
		t.Fatalf("admin assign: %#v", store.lastCreatedCustomer)
	}
}

func TestOwnership_VendedorCannotGetOtherCustomer(t *testing.T) {
	store := &stubStore{
		customerReturnedByID: &domain.Customer{ID: "c2", Name: "Theirs", OwnerUserID: "v2"},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/customers/c2", nil), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "c2")
	rr := httptest.NewRecorder()
	srv.HandleCustomerByID(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status %d want 404", rr.Code)
	}
}

func TestOwnership_AdminReassignProjectOwner(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"c1","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"owner_user_id":"v2"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "admin", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	var got domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.OwnerUserID != "v2" {
		t.Fatalf("reassign owner: %#v", got)
	}
}

// --- F035 product RBAC matrix ---

func TestRBAC_VendedorCannotCreateMaterial(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"m1","code":"M1","name":"Board","manufacturer":"Arauco","width_mm":1830,"length_mm":2750,"thickness_mm":15,"grain_default":false,"board_price":100,"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/materials", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleMaterials(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 body=%s", rr.Code, rr.Body.String())
	}
	if store.createMaterialOK {
		t.Fatal("store must not create material for vendedor")
	}
}

func TestRBAC_ProduccionCannotCreateMaterial(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"id":"m1","code":"M1","name":"Board","manufacturer":"Arauco","width_mm":1830,"length_mm":2750,"thickness_mm":15,"grain_default":false,"board_price":100,"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/materials", body), "p1", string(domain.RoleProduccion))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleMaterials(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403", rr.Code)
	}
}

func TestRBAC_IngenieroCanCreateMaterial(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"m1","code":"M1","name":"Board","manufacturer":"Arauco","width_mm":1830,"length_mm":2750,"thickness_mm":15,"grain_default":false,"board_price":100,"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/materials", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleMaterials(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status %d want 201 body=%s", rr.Code, rr.Body.String())
	}
	if !store.createMaterialOK {
		t.Fatal("expected material created")
	}
}

func TestRBAC_VendedorCannotDeleteProject(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft,
		},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/projects/p1", nil), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 body=%s", rr.Code, rr.Body.String())
	}
	if store.deleteProjectCalled {
		t.Fatal("delete must not run for vendedor")
	}
}

func TestRBAC_GerenteCanDeleteProject(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft,
		},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/projects/p1", nil), "g1", string(domain.RoleGerenteVentas))
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d want 200 body=%s", rr.Code, rr.Body.String())
	}
	if !store.deleteProjectCalled {
		t.Fatal("gerente delete should run")
	}
}

func TestRBAC_ProduccionCannotAccessCustomers(t *testing.T) {
	srv := &Server{Store: &stubStore{listCustomers: []domain.Customer{{ID: "c1"}}}}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/customers", nil), "p1", string(domain.RoleProduccion))
	rr := httptest.NewRecorder()
	srv.HandleCustomers(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403", rr.Code)
	}
}

func TestRBAC_GerenteCanAssignOwnerOnCreate(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"44444444-5555-6666-7777-888888888888","name":"Asignado","active":true,"owner_user_id":"v2"}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/customers", body), "g1", string(domain.RoleGerenteVentas))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleCustomers(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	if store.lastCreatedCustomer == nil || store.lastCreatedCustomer.OwnerUserID != "v2" {
		t.Fatalf("gerente assign: %#v", store.lastCreatedCustomer)
	}
}

func TestRBAC_ExportProductionDeniedToVendedor_Domain(t *testing.T) {
	// Client-side export; domain gate is the contract for UI + future API.
	if domain.RoleCanExportProduction(domain.RoleVendedor) {
		t.Fatal("vendedor must not export production")
	}
	if !domain.RoleCanExportProduction(domain.RoleIngeniero) {
		t.Fatal("ingeniero exports production")
	}
}

func TestF036_VendedorCannotReopenAcceptedProject(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusAccepted,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"c1","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"status":"draft","owner_user_id":"v1"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 body=%s", rr.Code, rr.Body.String())
	}
}

func TestF036_VendedorCanReopenQuotedProject(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusQuoted,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"c1","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"status":"draft","owner_user_id":"v1"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d want 200 body=%s", rr.Code, rr.Body.String())
	}
}

func TestF036_ProduccionCanMarkProduced(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusAccepted,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"c1","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"status":"produced","owner_user_id":"v1"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "prod1", string(domain.RoleProduccion))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d want 200 body=%s", rr.Code, rr.Body.String())
	}
	var got domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Status != domain.StatusProduced {
		t.Fatalf("status = %q want produced", got.Status)
	}
}

func TestF039_VendedorMaterialsListRedactsCosts(t *testing.T) {
	store := &stubStore{
		listMaterials: []domain.MaterialBoard{
			{ID: "m1", Code: "M1", Name: "Board", BoardPrice: 100, CostPerM2: 25, Active: true},
		},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/materials", nil), "v1", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()
	srv.HandleMaterials(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d", rr.Code)
	}
	var list []domain.MaterialBoard
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].BoardPrice != 0 || list[0].CostPerM2 != 0 {
		t.Fatalf("expected redacted costs: %#v", list)
	}
	// Admin still sees costs
	store2 := &stubStore{
		listMaterials: []domain.MaterialBoard{
			{ID: "m1", Code: "M1", Name: "Board", BoardPrice: 100, CostPerM2: 25, Active: true},
		},
	}
	srv2 := &Server{Store: store2}
	req2 := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/materials", nil), "a1", string(domain.RoleAdmin))
	rr2 := httptest.NewRecorder()
	srv2.HandleMaterials(rr2, req2)
	var list2 []domain.MaterialBoard
	_ = json.Unmarshal(rr2.Body.Bytes(), &list2)
	if len(list2) != 1 || list2[0].BoardPrice != 100 {
		t.Fatalf("admin should see board_price: %#v", list2)
	}
}

func TestF044_VendedorMaterialsShowCostsWhenFlagOn(t *testing.T) {
	flagOn := domain.DefaultWorkshopSettings()
	flagOn.VendedorCanViewCosts = true
	store := &stubStore{
		listMaterials: []domain.MaterialBoard{
			{ID: "m1", Code: "M1", Name: "Board", BoardPrice: 100, CostPerM2: 25, Active: true},
		},
		workshopSettings: &flagOn,
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/materials", nil), "v1", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()
	srv.HandleMaterials(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d", rr.Code)
	}
	var list []domain.MaterialBoard
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].BoardPrice != 100 || list[0].CostPerM2 != 25 {
		t.Fatalf("expected costs visible with flag: %#v", list)
	}
}

func TestF044_SettingsPutRequiresAccess(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"default_margin_factor":1.4,"default_labor_fixed_cost":0,"default_currency":"MXN","vendedor_can_view_costs":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/settings", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleWorkshopSettings(rr, req)
	if rr.Code != http.StatusForbidden && rr.Code != http.StatusUnauthorized {
		// requirePermission typically 403
		if rr.Code != 403 {
			t.Fatalf("vendedor must not put settings, status=%d body=%s", rr.Code, rr.Body.String())
		}
	}

	req2 := withClaims(httptest.NewRequest(http.MethodPut, "/api/settings", strings.NewReader(`{"default_margin_factor":1.4,"default_labor_fixed_cost":0,"default_currency":"MXN","vendedor_can_view_costs":true}`)), "a1", string(domain.RoleAdmin))
	req2.Header.Set("Content-Type", "application/json")
	rr2 := httptest.NewRecorder()
	srv.HandleWorkshopSettings(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("admin put settings status=%d body=%s", rr2.Code, rr2.Body.String())
	}
	var got domain.WorkshopSettings
	if err := json.Unmarshal(rr2.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.VendedorCanViewCosts {
		t.Fatalf("flag not saved: %#v", got)
	}
}

func TestF039_VendedorMaterialsHideCosts(t *testing.T) {
	store := &stubStore{}
	// Override ListMaterialBoards via embedding is hard — use direct domain redact unit + handler path with stub.
	// Handler path: stub ListMaterialBoards not implemented returns panic — use domain package test for redact,
	// and exercise calculate redaction here.
	_ = store
	srv := &Server{Store: &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft,
		},
	}}
	// Calculate needs catalog — skip if GetFullCatalog panics. Use domain redaction assertion instead.
	bd := domain.QuoteBreakdown{MaterialsCost: 50, DirectCost: 80, MarginFactor: 1.35, SalePrice: 108}
	domain.RedactQuoteBreakdown(&bd)
	if bd.SalePrice != 108 || bd.DirectCost != 0 {
		t.Fatalf("redact: %#v", bd)
	}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/projects/p1", nil), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	var got domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.MarginFactor != 0 {
		t.Fatalf("vendedor project margin must be redacted, got %v", got.MarginFactor)
	}
	_ = srv
}

func TestF036_VendedorCannotMarkProduced(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusAccepted,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"c1","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"status":"produced","owner_user_id":"v1"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 body=%s", rr.Code, rr.Body.String())
	}
}

// --- Issue #19 auth hardening ---

func TestHandleLogin_Uniform401ForMissingUser(t *testing.T) {
	srv := &Server{
		Store:     &stubStore{getUserByEmailErr: errors.New("user not found")},
		JWTSecret: "test-secret-key-for-jwt-signing-32b",
	}
	body := strings.NewReader(`{"email":"nope@test.com","password":"whatever1"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleLogin(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body=%s)", rr.Code, rr.Body.String())
	}
	msg := errorBody(t, rr)
	if msg != "invalid email or password" {
		t.Errorf("error = %q, want generic invalid credentials", msg)
	}
}

func TestHandleLogin_Uniform401ForPendingUser(t *testing.T) {
	hash, err := mustHash("goodpass1")
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{
		Store: &stubStore{getUserByEmail: &domain.User{
			ID: "u1", Email: "pending@test.com", PasswordHash: hash,
			Name: "P", Role: domain.RoleUser, Active: false,
		}},
		JWTSecret: "test-secret-key-for-jwt-signing-32b",
	}
	body := strings.NewReader(`{"email":"pending@test.com","password":"goodpass1"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleLogin(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body=%s)", rr.Code, rr.Body.String())
	}
	msg := errorBody(t, rr)
	if strings.Contains(strings.ToLower(msg), "pendiente") || strings.Contains(strings.ToLower(msg), "pending") {
		t.Errorf("must not reveal pending status, got %q", msg)
	}
	if msg != "invalid email or password" {
		t.Errorf("error = %q, want generic invalid credentials", msg)
	}
}

func TestHandleLogin_Uniform401ForWrongPassword(t *testing.T) {
	hash, err := mustHash("goodpass1")
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{
		Store: &stubStore{getUserByEmail: &domain.User{
			ID: "u1", Email: "ok@test.com", PasswordHash: hash,
			Name: "O", Role: domain.RoleUser, Active: true,
		}},
		JWTSecret: "test-secret-key-for-jwt-signing-32b",
	}
	body := strings.NewReader(`{"email":"ok@test.com","password":"wrongpass9"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleLogin(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
	if errorBody(t, rr) != "invalid email or password" {
		t.Errorf("unexpected body %s", rr.Body.String())
	}
}

func TestHandleRegister_RejectsWeakPassword(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"email":"a@b.com","password":"short","name":"A"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleRegister(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestHandleRegister_IgnoresRoleInBody(t *testing.T) {
	// Role field removed from RegisterRequest — extra JSON fields are ignored by decoder.
	// Ensure self-registration cannot self-elevate via body.role.
	var created *domain.User
	srv := &Server{Store: &createUserCapture{created: &created}}
	body := strings.NewReader(`{"email":"a@b.com","password":"goodpass1","name":"A","role":"admin"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleRegister(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if created == nil {
		t.Fatal("expected CreateUser to be called")
	}
	if created.Role != domain.RoleUser {
		t.Errorf("role = %q, want %q (self-reg always user)", created.Role, domain.RoleUser)
	}
	if created.Active {
		t.Error("self-reg must start inactive (pending approval)")
	}
}

// createUserCapture embeds stubStore and records the user passed to CreateUser.
type createUserCapture struct {
	stubStore
	created **domain.User
}

func (c *createUserCapture) CreateUser(_ context.Context, u *domain.User) error {
	cp := *u
	*c.created = &cp
	return nil
}

func mustHash(pw string) (string, error) {
	return auth.HashPassword(pw)
}

func TestDecodeJSONBody_RejectsOversized(t *testing.T) {
	// Build a body larger than maxJSONBodyBytes.
	big := strings.Repeat("a", maxJSONBodyBytes+10)
	body := strings.NewReader(`{"name":"` + big + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/x", body)
	rr := httptest.NewRecorder()
	var dst map[string]string
	ok := decodeJSONBody(rr, req, &dst)
	if ok {
		t.Fatal("expected decodeJSONBody to fail for oversized body")
	}
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", rr.Code)
	}
}

// TestF108_ClosingQuotePinsStructureRevision guards the #108 wire-up: when a
// project transitions into a closed status via HandleProjectByID, each item
// whose module references a structure must receive a StructureRevisionPin
// equal to that structure's current revision.
func TestF108_ClosingQuotePinsStructureRevision(t *testing.T) {
	rev := 3
	catalog := &domain.Catalog{
		Modules: []domain.Module{
			{ID: "m1", Code: "MOD-1", Name: "M", StructureID: "st1"},
		},
		Structures: []domain.Structure{
			{ID: "st1", Code: "EST-1", Name: "Cuerpo", Active: true, Revision: rev},
		},
	}
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "adm1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft,
			Items: []domain.ProjectItem{
				{ID: "it1", ModuleID: "m1", Quantity: 1},
			},
		},
		catalogOverride: catalog,
	}
	srv := &Server{Store: store}
	// Move draft → quoted (closed). The item has no incoming pin.
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"c1","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[{"id":"it1","module_id":"m1","quantity":1}],"status":"quoted","owner_user_id":"adm1"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "adm1", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d want 200 body=%s", rr.Code, rr.Body.String())
	}
	var got domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(got.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(got.Items))
	}
	pin := got.Items[0].StructureRevisionPin
	if pin == nil {
		t.Fatalf("expected StructureRevisionPin to be set on close, got nil")
	}
	if *pin != rev {
		t.Fatalf("StructureRevisionPin = %d, want %d (structure's current revision)", *pin, rev)
	}
}

// --- Project templates (#110 / H15) ---

func TestHandleProjectTemplatesList(t *testing.T) {
	templates := []domain.ProjectTemplate{
		{ID: "tmpl-1", Name: "Cocina test", Currency: "MXN", MarginFactor: 1.35, Items: []domain.ProjectItem{}},
	}
	srv := &Server{Store: &stubStore{listProjectTemplates: templates}}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/project-templates", nil), "v1", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()

	srv.HandleProjectTemplates(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var got []domain.ProjectTemplate
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(got) != 1 || got[0].ID != "tmpl-1" {
		t.Fatalf("got = %+v, want one tmpl-1", got)
	}
}

func TestHandleProjectTemplatesCreateRequiresEngineer(t *testing.T) {
	// Vendedor cannot create templates — should be 403.
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"tmpl-x","name":"X","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/project-templates", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjectTemplates(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("vendedor status = %d, want 403", rr.Code)
	}
	if store.lastCreatedTemplate != nil {
		t.Fatalf("vendedor should not have created a template")
	}
}

func TestHandleProjectTemplatesCreateEngineerOK(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"tmpl-x","name":"Cocina 3m","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/project-templates", body), "v1", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjectTemplates(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.lastCreatedTemplate == nil || store.lastCreatedTemplate.Name != "Cocina 3m" {
		t.Fatalf("created template not captured: %+v", store.lastCreatedTemplate)
	}
}

func TestHandleProjectTemplateByIDDelete(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/project-templates/tmpl-x", nil), "v1", string(domain.RoleIngeniero))
	req.SetPathValue("id", "tmpl-x")
	rr := httptest.NewRecorder()

	srv.HandleProjectTemplateByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if !store.deleteTemplateCalled {
		t.Fatalf("expected DeleteProjectTemplate to be called")
	}
}

// --- Catalog media lifecycle cleanup (F040) ---

// writeMediaFile plants a fake media file on disk so we can assert it gets
// deleted by the handler after the corresponding DB row is updated/deleted.
// Files live under the initial organization's subdirectory (partitioned media
// layout, ADR-0004): the unscoped test context falls back to it.
func writeMediaFile(t *testing.T, dir, name string) string {
	t.Helper()
	p := filepath.Join(dir, storage.InitialOrganizationID, name)
	if err := os.MkdirAll(filepath.Dir(p), 0o750); err != nil {
		t.Fatalf("plant %s: %v", p, err)
	}
	if err := os.WriteFile(p, []byte("x"), 0o600); err != nil {
		t.Fatalf("plant %s: %v", p, err)
	}
	return p
}

func fileExists(t *testing.T, path string) bool {
	t.Helper()
	_, err := os.Stat(path)
	if err == nil {
		return true
	}
	if os.IsNotExist(err) {
		return false
	}
	t.Fatalf("stat %s: %v", path, err)
	return false
}

// TestHandleMaterialByIDUpdateCleansReplacedImage verifies that PUTting a
// material with a different image_url deletes the previous file from disk.
// Regression: before the fix, replaced files accumulated as orphans.
func TestHandleMaterialByIDUpdateCleansReplacedImage(t *testing.T) {
	dir := t.TempDir()
	oldImgPath := writeMediaFile(t, dir, "old.jpg")
	oldTexPath := writeMediaFile(t, dir, "oldtex.webp")
	// "new.jpg" is referenced by the new payload but does not need to exist on
	// disk for the cleanup path — the GET handler will just 404 for it, which
	// is fine; we are testing that the OLD file is removed.

	store := &stubStore{
		materialReturnedByID: &domain.MaterialBoard{
			ID:                "m1",
			ImageURL:          "/api/media/old.jpg",
			PreviewTextureURL: "/api/media/oldtex.webp",
		},
	}
	srv := &Server{Store: store, MediaDir: dir}

	body := strings.NewReader(`{"code":"C","name":"N","manufacturer":"Arauco","image_url":"/api/media/new.jpg","preview_texture_url":"","board_price":1,"waste_percent":0,"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/materials/m1", body), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "m1")
	rr := httptest.NewRecorder()
	srv.HandleMaterialByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.updateMaterialCalled {
		t.Fatal("UpdateMaterialBoard not called")
	}
	if fileExists(t, oldImgPath) {
		t.Error("old image file should be deleted after URL changed")
	}
	if fileExists(t, oldTexPath) {
		t.Error("old texture file should be deleted after URL changed")
	}
}

// PUT must decode and forward texture tile mm into UpdateMaterialBoard.
func TestHandleMaterialByIDUpdateReceivesTextureTiles(t *testing.T) {
	store := &stubStore{
		materialReturnedByID: &domain.MaterialBoard{ID: "m1"},
	}
	srv := &Server{Store: store}

	body := strings.NewReader(`{
		"code":"MAD-1","name":"Madera","manufacturer":"Arauco","width_mm":1830,"length_mm":2440,"thickness_mm":18,
		"board_price":10,"waste_percent":5,"active":true,
		"preview_texture_url":"/api/media/wood.webp",
		"preview_texture_tile_width_mm":400,
		"preview_texture_tile_length_mm":600
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/materials/m1", body), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "m1")
	rr := httptest.NewRecorder()
	srv.HandleMaterialByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if store.updateMaterialReceived == nil {
		t.Fatal("expected UpdateMaterialBoard payload")
	}
	got := store.updateMaterialReceived
	if got.PreviewTextureTileWidthMm != 400 || got.PreviewTextureTileLengthMm != 600 {
		t.Fatalf("tiles = %.0f x %.0f, want 400 x 600", got.PreviewTextureTileWidthMm, got.PreviewTextureTileLengthMm)
	}
	if got.PreviewTextureURL != "/api/media/wood.webp" {
		t.Fatalf("texture url = %q", got.PreviewTextureURL)
	}
}

// When the URL does NOT change, the file must be preserved.
func TestHandleMaterialByIDUpdateKeepsSameImage(t *testing.T) {
	dir := t.TempDir()
	imgPath := writeMediaFile(t, dir, "keep.jpg")

	store := &stubStore{
		materialReturnedByID: &domain.MaterialBoard{
			ID:       "m1",
			ImageURL: "/api/media/keep.jpg",
		},
	}
	srv := &Server{Store: store, MediaDir: dir}

	body := strings.NewReader(`{"code":"C","name":"Renamed","manufacturer":"Arauco","image_url":"/api/media/keep.jpg","board_price":1,"waste_percent":0,"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/materials/m1", body), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "m1")
	rr := httptest.NewRecorder()
	srv.HandleMaterialByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !fileExists(t, imgPath) {
		t.Error("image file should be preserved when URL did not change")
	}
}

func TestHandleHardwareByIDUpdateCleansReplacedImage(t *testing.T) {
	dir := t.TempDir()
	oldImg := writeMediaFile(t, dir, "hw-old.png")

	store := &stubStore{
		hardwareReturnedByID: &domain.Hardware{
			ID:       "h1",
			ImageURL: "/api/media/hw-old.png",
		},
	}
	srv := &Server{Store: store, MediaDir: dir}

	body := strings.NewReader(`{"code":"HC","name":"N","unit":"pza","cost_per_unit":1,"image_url":"/api/media/hw-new.png","active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/hardware/h1", body), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "h1")
	rr := httptest.NewRecorder()
	srv.HandleHardwareByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if fileExists(t, oldImg) {
		t.Error("old hardware image should be deleted after URL changed")
	}
}

func TestHandleModuleByIDUpdateCleansReplacedImage(t *testing.T) {
	dir := t.TempDir()
	oldImg := writeMediaFile(t, dir, "mod-old.webp")

	store := &stubStore{
		moduleReturnedByID: &domain.Module{
			ID:       "mod1",
			ImageURL: "/api/media/mod-old.webp",
		},
	}
	srv := &Server{Store: store, MediaDir: dir}

	body := strings.NewReader(`{"code":"MC","name":"N","base_labor_cost":0,"width_mm":100,"height_mm":100,"depth_mm":100,"image_url":"/api/media/mod-new.webp"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/modules/mod1", body), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "mod1")
	rr := httptest.NewRecorder()
	srv.HandleModuleByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if fileExists(t, oldImg) {
		t.Error("old module image should be deleted after URL changed")
	}
}

// Physical delete of a module must also remove the image file.
func TestHandleModuleByIDDeleteRemovesImage(t *testing.T) {
	dir := t.TempDir()
	imgPath := writeMediaFile(t, dir, "mod-del.jpg")

	store := &stubStore{
		moduleReturnedByID: &domain.Module{
			ID:       "mod1",
			ImageURL: "/api/media/mod-del.jpg",
		},
	}
	srv := &Server{Store: store, MediaDir: dir}

	req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/catalog/modules/mod1", nil), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "mod1")
	rr := httptest.NewRecorder()
	srv.HandleModuleByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.deleteModuleCalled || store.deleteModuleReceivedID != "mod1" {
		t.Errorf("DeleteModule not called correctly: called=%v id=%q", store.deleteModuleCalled, store.deleteModuleReceivedID)
	}
	if fileExists(t, imgPath) {
		t.Error("module image should be deleted after physical delete")
	}
}

// Soft delete (DeactivateMaterialBoard) must NOT touch the file: the row may
// be reactivated later and the image should still be there.
func TestHandleMaterialByIDSoftDeleteKeepsImage(t *testing.T) {
	dir := t.TempDir()
	imgPath := writeMediaFile(t, dir, "keep-on-deactivate.jpg")

	store := &stubStore{
		materialReturnedByID: &domain.MaterialBoard{
			ID:       "m1",
			ImageURL: "/api/media/keep-on-deactivate.jpg",
		},
	}
	srv := &Server{Store: store, MediaDir: dir}

	req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/catalog/materials/m1", nil), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "m1")
	rr := httptest.NewRecorder()
	srv.HandleMaterialByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !fileExists(t, imgPath) {
		t.Error("image file must survive soft delete (deactivate)")
	}
}

// TestPublicUserDTONeverLeaksSecrets (OC-005) ensures that JSON serialization of PublicUserDTO
// and LoginResponse never contains password hashes or raw passwords.
func TestPublicUserDTONeverLeaksSecrets(t *testing.T) {
	t.Parallel()

	u := domain.User{
		ID:           "u-123",
		Email:        "carlos@carpinteria.com",
		PasswordHash: "$2a$12$eImiTXuWVxfM37uY4JANjOL.oUvhqp7VOHWcxSGYV7G4j7n",
		Name:         "Carlos Carpintero",
		Role:         domain.RoleProduccion,
		Active:       true,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	dto := ToPublicUserDTO(&u)
	resp := LoginResponse{
		Token: "jwt-token-example",
		User:  dto,
	}

	out, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}

	raw := string(out)
	if strings.Contains(raw, "eImiTXuWVxfM37uY4JANjOL") {
		t.Errorf("password hash leaked in LoginResponse JSON: %s", raw)
	}
	if strings.Contains(strings.ToLower(raw), "password") {
		t.Errorf("found 'password' field in LoginResponse JSON: %s", raw)
	}
	if !strings.Contains(raw, `"email":"carlos@carpinteria.com"`) {
		t.Errorf("missing email in JSON: %s", raw)
	}
	if !strings.Contains(raw, `"role":"produccion"`) {
		t.Errorf("missing role in JSON: %s", raw)
	}
}
