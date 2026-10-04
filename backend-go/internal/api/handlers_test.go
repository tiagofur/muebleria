package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// stubStore is a minimal Store for handler unit tests. Only the methods under
// test are populated; the rest panic so a misconfigured test fails loudly
// instead of silently passing. This mirrors the httptest.ResponseRecorder style
// of middleware_test.go and avoids any database dependency.
type stubStore struct {
	// Hardware 3D assets (#667 M1)
	assetSessionResult           *storage.HardwareAssetUploadSessionResult
	assetSession                 *domain.HardwareAssetUploadSession
	assetSessionErr              error
	promoteAssetBytesCmd         *storage.PromoteHardwareAssetSessionBytesCommand
	promoteAssetBytesErr         error
	assetPreviousStagedKey       string
	recordAssetBytesArmed        bool
	assetFinalized               *domain.HardwareAsset
	assetFinalizeCmd             *storage.FinalizeHardwareAssetUploadCommand
	assetFinalizeErr             error
	assetCancelledCmd            *storage.CancelHardwareAssetUploadSessionCommand
	assetResolvedBinding         *domain.HardwareVisualAssetBinding
	assetResolveBindingCmd       *[2]string
	assetRevisionResult          *domain.HardwareAssetRevision
	deriveRevisionCmd            *storage.DeriveHardwareAssetRevisionCommand
	deriveRevisionCalls          int
	recordValidationCmd          *storage.RecordHardwareAssetValidationCommand
	recordValidationErr          error
	listHardwareAssets           []domain.HardwareAsset
	createCustomerErr            error
	createMaterialErr            error
	createProjectErr             error
	createProjectWithInlineErr   error
	bootstrapProjectDesignResult *storage.BootstrapProjectDesignResult
	bootstrapProjectDesignErr    error
	bootstrapProjectDesignCmd    *storage.BootstrapProjectDesignCommand
	updateProjectErr             error
	// #714 inline-customer update transition.
	updateProjectWithInlineErr               error
	updateProjectWithInlineBase              string
	updateProjectWithInlineExpectedUpdatedAt time.Time
	updateProjectWithInlineCalls             int
	lastInlineUpdateCustomer                 *domain.Customer
	// In-memory durable-idempotency receipts (mirror api_idempotency_receipts
	// semantics: same scope+fingerprint replays, different fingerprint
	// conflicts, 5xx is retryable and never sealed).
	idempotencyReceipts        map[string]stubIdempotencyReceipt
	idempotencyErr             error
	customerReturnedByID       *domain.Customer
	customerGetByIDErr         error
	projectReturnedByID        *domain.Project
	projectReadbackAfterUpdate *domain.Project
	projectGetByIDErr          error
	listCustomers              []domain.Customer
	listProjects               []domain.Project
	listMaterials              []domain.MaterialBoard
	lastCreatedCustomer        *domain.Customer
	lastCreatedProject         *domain.Project
	lastInlineCustomer         *domain.Customer
	lastUpdatedProject         *domain.Project
	// Project furniture identity (#385 / DT-1)
	furnitureInstancesByID map[string]domain.FurnitureInstance
	listFurnitureInstances []domain.FurnitureInstance
	// #389 / DT-5 presentation summaries (nil = derive from the plain list).
	listFurnitureInstanceSummaries  []storage.FurnitureInstanceSummary
	createFurnitureInstanceCmd      *storage.CreateFurnitureInstanceCommand
	createFurnitureInstanceErr      error
	createFurnitureInstanceCalls    int
	removeFurnitureInstanceCmd      *storage.RemoveFurnitureInstanceCommand
	removeFurnitureInstanceErr      error
	duplicateFurnitureInstanceCmd   *storage.DuplicateFurnitureInstanceCommand
	duplicateFurnitureInstanceErr   error
	duplicateFurnitureInstanceCalls int
	// QuoteLine ↔ FurnitureInstance relation (#386 / DT-2)
	materializeQuoteLineCmd     *storage.MaterializeQuoteLineCommand
	materializeQuoteLineErr     error
	materializeQuoteLineResult  *domain.QuoteLineMaterialization
	listQuoteLineFurnitureErr   error
	listQuoteLineFurnitureLinks []domain.QuoteLineFurnitureInstance
	// Design aggregate & revisions (#387 / DT-3)
	designsByID                map[string]domain.Design
	listDesignsByProjectErr    error
	createDesignCmd            *storage.CreateDesignCommand
	createDesignErr            error
	getDesignByIDErr           error
	designRevisionsByID        map[string]domain.DesignRevision
	listDesignRevisionsErr     error
	publishDesignRevisionCmd   *storage.PublishDesignRevisionCommand
	publishDesignRevisionErr   error
	getDesignRevisionErr       error
	listDesignRevisionItemsErr error
	designWorkingCopiesByID    map[string]domain.DesignWorkingCopy
	commercialProjection       *domain.CommercialProjection
	commercialProjectionErr    error
	// SketchUp model binding validation (#388 / DT-4)
	modelBindingContext        *storage.ModelBindingContext
	modelBindingContextErr     error
	getDesignWorkingCopyErr    error
	updateDesignWorkingCopyCmd *storage.UpdateDesignWorkingCopyCommand
	// Web-to-SketchUp pairing grants (#499 / DT-SU-1)
	createPairingGrantCmd      *storage.CreateDesignPairingGrantCommand
	createPairingGrantErr      error
	exchangePairingGrantCmd    *storage.ExchangeDesignPairingGrantCommand
	exchangePairingGrantErr    error
	pairingGrant               *domain.DesignPairingGrant
	pairingGrantErr            error
	cancelPairingGrantCmd      *storage.CancelDesignPairingGrantCommand
	cancelPairingGrantErr      error
	confirmPairingGrantCmd     *storage.ConfirmDesignPairingGrantCommand
	confirmPairingGrantErr     error
	updateDesignWorkingCopyErr error
	resetDesignWorkingCopyCmd  *storage.ResetDesignWorkingCopyCommand
	resetDesignWorkingCopyErr  error
	// #637 / DT-MAT quoted-material provenance + reconciliation
	materialProvenance       *storage.DesignWorkingCopyMaterialProvenance
	materialProvenanceErr    error
	reconcileMaterialsCmd    *storage.ReconcileDesignWorkingMaterialsCommand
	reconcileMaterialsErr    error
	reconcileMaterialsResult *storage.DesignWorkingMaterialsReconciliation
	// #392 / DT-8 staged publish flow
	prepareDesignPublishCmd             *storage.PrepareDesignPublishCommand
	prepareDesignPublishErr             error
	prepareDesignPublishResult          *storage.PrepareResult
	publishSessionDetail                *storage.DesignPublishSessionDetail
	getPublishSessionErr                error
	recordDesignPublishArtifactCmd      *storage.RecordDesignPublishArtifactCommand
	recordDesignPublishArtifactErr      error
	recordDesignPublishArtifact         *domain.DesignRevisionArtifact
	recordDesignPublishArtifactReplaced string
	finalizeDesignPublishCmd            *storage.FinalizeDesignPublishCommand
	finalizeDesignPublishErr            error
	listDesignRevisionArtifactsResult   []domain.DesignRevisionArtifact
	listDesignRevisionArtifactsErr      error
	getDesignRevisionArtifactResult     *domain.DesignRevisionArtifact
	getDesignRevisionArtifactErr        error
	// Reconciliation (#393 / DT-9)
	reconcileProjectResult *domain.ReconciliationResult
	reconcileProjectErr    error
	reconcileProjectCalls  int

	quoteRevisionsList  []domain.QuoteRevisionDetail
	quoteRevisionsErr   error
	quoteRevisionsCalls int

	commercialSummariesList  []domain.ProjectCommercialSummary
	commercialSummariesErr   error
	commercialSummariesCalls int

	furnitureWorkspaceResult *domain.FurnitureWorkspace
	furnitureWorkspaceErr    error
	furnitureWorkspaceCalls  int
	furnitureWorkspaceQuery  *storage.FurnitureWorkspaceQuery
	// Requote (#394 / DT-10)
	requoteProjectQuoteResult *storage.RequoteProjectQuoteResult
	requoteProjectQuoteErr    error
	requoteProjectQuoteCalls  int
	requoteProjectQuoteCmd    *storage.RequoteProjectQuoteCommand
	// Commercial QuoteRevision lifecycle (#571 / WEB-DT-4)
	createInitialQuoteRevisionResult      *storage.CreateInitialQuoteRevisionResult
	createInitialQuoteRevisionErr         error
	createInitialQuoteRevisionCalls       int
	createInitialQuoteRevisionCmd         *storage.CreateInitialQuoteRevisionCommand
	createInitialDesignQuoteRevisionErr   error
	createInitialDesignQuoteRevisionCalls int
	createInitialDesignQuoteRevisionCmd   *storage.CreateInitialDesignQuoteRevisionCommand
	publishQuoteRevisionResult            *domain.QuoteRevision
	publishQuoteRevisionErr               error
	publishQuoteRevisionCalls             int
	publishQuoteRevisionCmd               *storage.QuoteRevisionLifecycleCommand
	acceptQuoteRevisionResult             *storage.AcceptQuoteRevisionResult
	acceptQuoteRevisionErr                error
	acceptQuoteRevisionCalls              int
	acceptQuoteRevisionCmd                *storage.QuoteRevisionLifecycleCommand
	// DesignRevision approval + ProductionRelease (#395 / DT-11)
	approveDesignRevisionResult   *domain.DesignRevision
	approveDesignRevisionErr      error
	approveDesignRevisionCalls    int
	approveDesignRevisionCmd      *storage.ApproveDesignRevisionCommand
	createProductionReleaseResult *storage.ProductionReleaseReadback
	createProductionReleaseErr    error
	createProductionReleaseCalls  int
	createProductionReleaseCmd    *storage.CreateProductionReleaseCommand
	// Always-gated production approval (#502 / WEB-DT-3)
	approveForProductionCalls int
	approveForProductionCmd   *storage.ApproveDesignRevisionForProductionCommand
	approveForProductionErr   error
	// Read-only preflight evaluation (#502 / WEB-DT-3)
	evaluatePreflightResult      *domain.ManufacturingPreflightResult
	evaluatePreflightErr         error
	evaluatePreflightCalls       int
	evaluatePreflightDesignID    string
	evaluatePreflightRevisionID  string
	evaluatePreflightQuoteID     string
	listProductionReleasesResult []storage.ProductionReleaseReadback
	listProductionReleasesErr    error
	getProductionReleaseResult   *storage.ProductionReleaseReadback
	getProductionReleaseErr      error
	cuttingDemandResult          *storage.ReleaseCuttingDemandView
	cuttingDemandErr             error
	workshopOccurrencesResult    *storage.WorkshopOccurrenceProjectionView
	workshopOccurrencesErr       error
	engineeringStateResult       *domain.ReleaseEngineeringState
	engineeringStateErr          error
	engineeringStartOutcome      *storage.ReleaseEngineeringOutcome
	engineeringStartErr          error
	engineeringCompleteOutcome   *storage.ReleaseEngineeringOutcome
	engineeringCompleteErr       error
	latestProductionRelease      *domain.ProductionRelease
	latestProductionReleaseErr   error
	materialReturnedByID         *domain.MaterialBoard
	materialGetByIDErr           error
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
	// Manufacturing Library (#772 / LIB-1, #773 / LIB-2)
	currentPublishedRelease          *domain.LibraryRelease
	currentPublishedReleaseErr       error
	publishedReleases                []*domain.LibraryRelease
	publishedReleasesErr             error
	releaseByID                      map[uuid.UUID]*domain.LibraryRelease
	getReleaseByIDErr                error
	releaseManifestsByID             map[uuid.UUID]*domain.LibraryManifest
	releaseManifestRawByID           map[uuid.UUID][]byte
	releaseManifestErr               error
	resourceBlobsByHash              map[string]*domain.ResourceBlob
	resourceBlobErr                  error
	resourceBlobEntitlementCheckFunc func(releaseID, resourceID uuid.UUID, hash string) (*domain.ResourceBlob, domain.PackageKind, error)
	// Manufacturing Library Overlays (#775 / LIB-4)
	overlaysByID                      map[uuid.UUID]*domain.LibraryOverlay
	overlayConflictsByID              map[uuid.UUID]*domain.LibraryOverlayConflict
	overlayConflictsByOverlayID       map[uuid.UUID][]domain.LibraryOverlayConflict
	createOverlayErr                  error
	getOverlayByIDErr                 error
	getActiveOverlayErr               error
	updateOverlayOverridesErr         error
	updateOverlayStatusErr            error
	updateOverlayBaseReleaseErr       error
	replaceOverlayPendingConflictsErr error
	listOverlayConflictsErr           error
	getOverlayConflictByIDErr         error
	resolveOverlayConflictErr         error
	countPendingConflictsErr          error
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
	// Session registry hooks (#460 / SEC-1)
	authSessions      map[string]*domain.AuthSession
	nextAuthSessionID string
	// Auth test hooks
	getUserByEmail    *domain.User
	getUserByEmailErr error
	createUserErr     error
	listUsers         []domain.User
	// Multi-org memberships by user (ADR-0004) for login/select-org tests.
	membershipsByUser        map[string][]domain.MembershipWithOrg
	getActiveMembershipErr   error
	getActiveMembershipEmpty bool
	listConnectedOrgs        []domain.Organization
	getOrgByID               *domain.Organization
	orgLicensePlan           domain.LicensePlan
	orgLicenseExpiresAt      *time.Time
	createdOrgs              []*domain.Organization
	auditEvents              []storage.SecurityAuditEvent
	createMaterialOK         bool
	deleteProjectCalled      bool
	// F044 workshop settings (nil → defaults, flag false)
	workshopSettings        *domain.WorkshopSettings
	machineOutputSelections []domain.MachineOutputSelectionRecord
	// #108: optional catalog returned by GetFullCatalog. nil → empty catalog.
	catalogOverride *domain.Catalog
	catalogError    error
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
	// #913 / HW-PROFILE catalog surface hooks.
	listHardwareProfiles                      []domain.HardwareProfile
	hardwareProfileReturnedByID               *domain.HardwareProfile
	hardwareProfileGetID                      string
	createHardwareProfileErr                  error
	createdHardwareProfile                    *domain.HardwareProfile
	updateHardwareProfileErr                  error
	updatedHardwareProfile                    *domain.HardwareProfile
	updatedHardwareProfileExpectedVersion     int64
	deactivateHardwareProfileErr              error
	deactivatedHardwareProfileID              string
	deactivatedHardwareProfileExpectedVersion int64
	// #915 side assignment hooks.
	listComponentSideAssignments  []domain.ComponentSideAssignment
	setComponentSideAssignment    *domain.ComponentSideAssignment
	setComponentSideAssignmentErr error
	removeAssignmentComponentID   string
	removeAssignmentSide          string
	removeAssignmentErr           error
	// #916 resolve synthesis hooks.
	allComponentSideAssignments []domain.ComponentSideAssignment
	// #955 publish surface hooks.
	createDraftReleaseErr            error
	listActiveHardwareProfilesAnyOrg []domain.HardwareProfile
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
	// #740 operational gate stub error for the read-only preflight.
	physicalAuthErr error
	// #577 canonical execution generation stubs.
	canonicalExecParts    []domain.PartInstance
	canonicalExecUnits    []domain.ModuleUnitExecution
	canonicalExecErr      error
	canonicalExecCalls    int
	canonicalRoutingReady bool
	floorEventWrites      []domain.FloorStatusEvent
	floorEventsList       []domain.FloorStatusEvent
	userSectorsList       []domain.UserSector
	// Installation job (OC-070..074): in-memory state + audit write log.
	installationJob           *domain.InstallationJob
	canonicalRequirements     []domain.MaterialRequirementLine
	materialPlanning          *domain.MaterialPlanning
	materialStock             []domain.MaterialStock
	purchaseOrders            []domain.PurchaseOrder
	productionRelease         *domain.ResolvedProductionRelease
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
	suppliersList               []domain.Supplier
	createSupplierErr           error
	updateSupplierErr           error
	deactivateSupplierErr       error
	posList                     []domain.PurchaseOrder
	poReturnedByID              *domain.PurchaseOrder
	poGetByIDErr                error
	createPOErr                 error
	updatePOErr                 error
	emitPOCalled                bool
	cancelPOCalled              bool
	receivePOCalled             bool
	lastReceiveLines            []domain.PurchaseOrderItem
	lastReceiveByUserID         string
	lastReceiveByName           string
	activitiesByID              []domain.ProductionActivity
	insertedActivities          []domain.ProductionActivity
	floorStatusErr              error
	projectEventsList           []domain.ProjectEvent
	projectEventWrites          []domain.ProjectEvent
	insertProjectEventErr       error
	listProjectEventsErr        error
	updateModuleCalled          bool
	updateModuleReceived        *domain.Module
	updateModuleExpectedVersion int64
	updateModuleErr             error
	createModuleArmed           bool
	createModuleReceived        *domain.Module
	createModuleErr             error
	deleteModuleCalled          bool
	deleteModuleReceivedID      string
	approveDeviceReceived       *storage.ApproveDeviceEnrollmentCommand
	resolveDeviceResult         *storage.DeviceTokenResult
	// MFA / step-up (#460 SEC-7)
	mfaEnabledFactors  int
	mfaStepUpFreshness storage.MFAStepUpFreshness
	mfaEnrollFn        func(context.Context, storage.CreateMFAEnrollmentCommand) (*domain.MFAFactor, error)
	mfaEnableFn        func(context.Context, storage.EnableMFAFactorCommand) (*storage.EnabledMFAFactor, error)
	mfaRevokeFn        func(context.Context, storage.RevokeMFAFactorCommand) (*domain.MFAFactor, error)
	mfaRegenFn         func(context.Context, storage.RegenerateMFARecoveryCommand) ([]string, error)
	mfaStepUpFn        func(context.Context, storage.MFAStepUpCommand) (*storage.MFAStepUpResult, error)
}

func (s *stubStore) stubNotUsed(name string) {
	panic("stubStore: unexpected call to " + name + " — add a field if the test needs it")
}

type floorStatusWrite struct {
	projectID string
	itemID    string
	status    string
}

func (s *stubStore) mutateMaterialPlanning(
	exactReleaseID string,
	mutate func(*domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error),
) (*domain.MaterialPlanningMutation, error) {
	if exactReleaseID != "" && (s.productionRelease == nil || s.productionRelease.ReleaseID != exactReleaseID) {
		return nil, errors.New("CONFLICT:la liberación indicada no existe en esta obra")
	}
	snap := &domain.MaterialPlanningSnapshot{
		CanonicalRequirements:     s.canonicalRequirements,
		Planning:                  s.materialPlanning,
		AllPlannings:              []*domain.MaterialPlanning{s.materialPlanning},
		Stock:                     append([]domain.MaterialStock(nil), s.materialStock...),
		PurchaseOrders:            append([]domain.PurchaseOrder(nil), s.purchaseOrders...),
		ProductionRelease:         s.productionRelease,
		CanonicalReleaseExists:    s.productionRelease != nil && s.productionRelease.Source == domain.ProductionReleaseAuthorityCanonical,
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
func (s *stubStore) mutateQualityInMemory(
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

type stubIdempotencyReceipt struct {
	fingerprint string
	response    storage.IdempotencyResponse
}

func (s *stubStore) ExecuteIdempotent(
	ctx context.Context,
	req storage.IdempotencyRequest,
	execute func(context.Context) (storage.IdempotencyResponse, error),
) (storage.IdempotencyResponse, bool, error) {
	if s.idempotencyErr != nil {
		return storage.IdempotencyResponse{}, false, s.idempotencyErr
	}
	if prev, ok := s.idempotencyReceipts[req.ScopeKey]; ok {
		if prev.fingerprint != req.Fingerprint {
			return storage.IdempotencyResponse{}, false, storage.ErrIdempotencyConflict
		}
		return prev.response, true, nil
	}
	// The real store chains the request context (plus its transaction); the
	// handler below must keep seeing the caller's claims and org scope.
	response, err := execute(ctx)
	if err != nil {
		return storage.IdempotencyResponse{}, false, err
	}
	if response.Status < http.StatusInternalServerError {
		if s.idempotencyReceipts == nil {
			s.idempotencyReceipts = map[string]stubIdempotencyReceipt{}
		}
		s.idempotencyReceipts[req.ScopeKey] = stubIdempotencyReceipt{
			fingerprint: req.Fingerprint,
			response:    response,
		}
	}
	return response, false, nil
}
func dupErr(op string) error {
	return errors.New(op + ": duplicate key value violates unique constraint")
}

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
	body := strings.NewReader(`{"id":"77777777-8888-9999-0000-111111111111","name":"Dup","customer_id":"10000000-0000-0000-0000-000000000001","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0}`)
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
	body := strings.NewReader(`{"id":"` + sentID + `","name":"Nuevo","customer_id":"10000000-0000-0000-0000-000000000001","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0}`)
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

// #712 — the inline "nuevo cliente" create command on POST /projects.
func TestHandleProjectsCreateWithInlineCustomer(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"id":"88888888-9999-0000-1111-222222222222","name":"Cocina Ana","customer_id":"","inline_customer_name":"  Ana López  ","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusCreated, rr.Body.String())
	}
	var got struct {
		domain.Project
		InlineCustomer *domain.Customer `json:"inline_customer"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	const stubMintedID = "70000000-0000-0000-0000-000000000712"
	if got.CustomerID != stubMintedID {
		t.Fatalf("project.customer_id = %q, want the server-minted id %q", got.CustomerID, stubMintedID)
	}
	if got.InlineCustomer == nil {
		t.Fatal("response must include the created inline_customer for local reconciliation")
	}
	if got.InlineCustomer.ID != stubMintedID {
		t.Fatalf("inline_customer.id = %q, want %q", got.InlineCustomer.ID, stubMintedID)
	}
	// The name is trimmed at the command boundary — same rule every UI sends.
	if got.InlineCustomer.Name != "Ana López" {
		t.Fatalf("inline_customer.name = %q, want the trimmed name", got.InlineCustomer.Name)
	}
	if !got.InlineCustomer.Active {
		t.Fatal("inline customer must be created active")
	}
}

func TestHandleProjectsCreateInlinePlusExistingCustomerReturns400(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"name":"X","customer_id":"10000000-0000-0000-0000-000000000001","inline_customer_name":"Ana López","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "no ambos") {
		t.Errorf("error message = %q, want it to reject the ambiguous intent", msg)
	}
}

func TestHandleProjectsCreateInlineWhitespaceNameReturns400(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"name":"X","customer_id":"","inline_customer_name":"   ","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "cliente") {
		t.Errorf("error message = %q, want it to mention the cliente", msg)
	}
}

func TestHandleProjectsCreateInlineStillValidatesItems(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"name":"X","customer_id":"","inline_customer_name":"Ana López","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[{"id":"i1","module_id":"no-un-uuid","quantity":1,"option_choices":{}}]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "mueble") {
		t.Errorf("error message = %q, want item validation to keep applying", msg)
	}
}

// The invisible-customer storage guard surfaces as the neutral 404 — the same
// verdict for missing and other-tenant ids, never a cross-org oracle (#712 §8).
func TestHandleProjectsCreateInvisibleCustomerReturns404Neutral(t *testing.T) {
	srv := &Server{Store: &stubStore{createProjectErr: storage.ErrCustomerNotFound}}
	body := strings.NewReader(`{"name":"X","customer_id":"10000000-0000-0000-0000-0000000009ff","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); strings.Contains(msg, "otra organización") || strings.Contains(msg, "tenant") {
		t.Errorf("error message = %q, must stay neutral about other tenants", msg)
	}
}

func TestHandleProjectsCreateWithInlineDuplicateProjectReturns409(t *testing.T) {
	srv := &Server{Store: &stubStore{createProjectWithInlineErr: dupErr("error creating project")}}
	body := strings.NewReader(`{"id":"77777777-8888-9999-0000-111111111111","name":"Dup","customer_id":"","inline_customer_name":"Ana López","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body=%s)", rr.Code, rr.Body.String())
	}
}

// #714 — the inline "nuevo cliente" update command on PUT /projects/{id}.
const inlineUpdateProjectPath = "/api/projects/88888888-9999-0000-1111-222222222222"

func inlineUpdateRequest(body, idempotencyKey string) *http.Request {
	req := withClaims(httptest.NewRequest(http.MethodPut, inlineUpdateProjectPath, strings.NewReader(body)), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "88888888-9999-0000-1111-222222222222")
	req.Header.Set("Content-Type", "application/json")
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}
	return req
}

func serveInlineUpdate(srv *Server, rr http.ResponseWriter, req *http.Request) {
	srv.requireProjectInlineUpdateIdempotency(http.HandlerFunc(srv.HandleProjectByID)).ServeHTTP(rr, req)
}

func seedInlineUpdateStore(extra *stubStore) *stubStore {
	base := &domain.Project{
		ID: "88888888-9999-0000-1111-222222222222", Name: "Cocina base",
		CustomerID:  "10000000-0000-0000-0000-000000000001",
		OwnerUserID: "v1", Status: domain.StatusDraft, Items: []domain.ProjectItem{},
		UpdatedAt: time.Date(2026, 9, 13, 22, 0, 0, 0, time.UTC),
	}
	if extra == nil {
		extra = &stubStore{}
	}
	extra.projectReturnedByID = base
	return extra
}

const inlineUpdateBody = `{"id":"88888888-9999-0000-1111-222222222222","name":"Cocina editada","customer_id":"","inline_customer_name":"  Ana López  ","inline_customer_replaces":"10000000-0000-0000-0000-000000000001","expected_project_updated_at":"2026-09-13T22:00:00Z","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"status":"draft","items":[]}`

func TestHandleProjectByIDUpdateWithInlineCustomer(t *testing.T) {
	const stubMintedID = "70000000-0000-0000-0000-000000000714"
	// The read-back deliberately differs from the client payload: the server
	// resolved timestamps the caller never sent (#716 lesson — the response is
	// the authority, never a local reconstruction).
	readback := &domain.Project{
		ID: "88888888-9999-0000-1111-222222222222", Name: "Cocina editada",
		CustomerID: stubMintedID, OwnerUserID: "v1", Status: domain.StatusDraft,
		Items: []domain.ProjectItem{}, UpdatedAt: time.Date(2026, 9, 13, 23, 0, 0, 0, time.UTC),
	}
	store := seedInlineUpdateStore(&stubStore{projectReadbackAfterUpdate: readback})
	srv := &Server{Store: store}
	rr := httptest.NewRecorder()

	serveInlineUpdate(srv, rr, inlineUpdateRequest(inlineUpdateBody, "key-714-aaaaaaaaaaaa"))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusOK, rr.Body.String())
	}
	var got struct {
		domain.Project
		InlineCustomer *domain.Customer `json:"inline_customer"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.CustomerID != stubMintedID {
		t.Fatalf("project.customer_id = %q, want the server-minted id %q", got.CustomerID, stubMintedID)
	}
	if !got.UpdatedAt.Equal(readback.UpdatedAt) {
		t.Fatalf("updated_at = %v, want the authoritative read-back %v", got.UpdatedAt, readback.UpdatedAt)
	}
	if got.InlineCustomer == nil || got.InlineCustomer.ID != stubMintedID || got.InlineCustomer.Name != "Ana López" || !got.InlineCustomer.Active {
		t.Fatalf("inline_customer = %+v, want the active trimmed 'Ana López' with the minted id", got.InlineCustomer)
	}
	if store.updateProjectWithInlineCalls != 1 {
		t.Fatalf("inline transition calls = %d, want exactly 1", store.updateProjectWithInlineCalls)
	}
	if store.updateProjectWithInlineBase != "10000000-0000-0000-0000-000000000001" {
		t.Fatalf("base = %q, want the caller's base view of the customer assignment", store.updateProjectWithInlineBase)
	}
	if want := time.Date(2026, 9, 13, 22, 0, 0, 0, time.UTC); !store.updateProjectWithInlineExpectedUpdatedAt.Equal(want) {
		t.Fatalf("expected updated_at = %v, want %v", store.updateProjectWithInlineExpectedUpdatedAt, want)
	}
	if store.lastUpdatedProject != nil && store.lastUpdatedProject.CustomerID != stubMintedID {
		t.Fatalf("stored project customer = %q, want the minted id", store.lastUpdatedProject.CustomerID)
	}
}

func TestHandleProjectByIDUpdateInlinePlusExistingCustomerReturns400(t *testing.T) {
	srv := &Server{Store: seedInlineUpdateStore(nil)}
	body := `{"id":"88888888-9999-0000-1111-222222222222","name":"X","customer_id":"10000000-0000-0000-0000-000000000001","inline_customer_name":"Ana López","inline_customer_replaces":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"status":"draft","items":[]}`
	rr := httptest.NewRecorder()

	serveInlineUpdate(srv, rr, inlineUpdateRequest(body, "key-714-bbbbbbbbbbbb"))

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "no ambos") {
		t.Errorf("error message = %q, want it to reject the ambiguous intent", msg)
	}
}

func TestHandleProjectByIDUpdateInlineWithoutBaseReturns400(t *testing.T) {
	srv := &Server{Store: seedInlineUpdateStore(nil)}
	body := `{"id":"88888888-9999-0000-1111-222222222222","name":"X","customer_id":"","inline_customer_name":"Ana López","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"status":"draft","items":[]}`
	rr := httptest.NewRecorder()

	serveInlineUpdate(srv, rr, inlineUpdateRequest(body, "key-714-cccccccccccc"))

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "cliente actual") {
		t.Errorf("error message = %q, want it to demand the base customer view", msg)
	}
}

func TestHandleProjectByIDUpdateInlineWithoutProjectVersionReturns400(t *testing.T) {
	srv := &Server{Store: seedInlineUpdateStore(nil)}
	body := `{"id":"88888888-9999-0000-1111-222222222222","name":"X","customer_id":"","inline_customer_name":"Ana López","inline_customer_replaces":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"status":"draft","items":[]}`
	rr := httptest.NewRecorder()

	serveInlineUpdate(srv, rr, inlineUpdateRequest(body, "key-714-version-missing"))

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "versión") {
		t.Errorf("error message = %q, want it to demand the project version", msg)
	}
	if srv.Store.(*stubStore).updateProjectWithInlineCalls != 0 {
		t.Fatal("missing concurrency evidence must fail before the transition")
	}
}

// The inline capability rides the durable idempotency receipts: a missing or
// malformed key is rejected before anything persists.
func TestHandleProjectByIDUpdateInlineWithoutIdempotencyKeyReturns400(t *testing.T) {
	srv := &Server{Store: seedInlineUpdateStore(nil)}
	rr := httptest.NewRecorder()

	serveInlineUpdate(srv, rr, inlineUpdateRequest(inlineUpdateBody, ""))

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if srv.Store.(*stubStore).updateProjectWithInlineCalls != 0 {
		t.Fatal("nothing may persist when the idempotency key is missing")
	}
}

// Proof G at the HTTP boundary: the same intention replayed with the same key
// returns the EXACT committed response — no second customer, no re-execution.
func TestHandleProjectByIDUpdateInlineReplayReturnsSameResponse(t *testing.T) {
	store := seedInlineUpdateStore(nil)
	srv := &Server{Store: store}
	first := httptest.NewRecorder()
	second := httptest.NewRecorder()

	serveInlineUpdate(srv, first, inlineUpdateRequest(inlineUpdateBody, "key-714-dddddddddddd"))
	serveInlineUpdate(srv, second, inlineUpdateRequest(inlineUpdateBody, "key-714-dddddddddddd"))

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("status first=%d second=%d, want 200/200", first.Code, second.Code)
	}
	if second.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatalf("replay header = %q, want 'true'", second.Header().Get("Idempotency-Replayed"))
	}
	if first.Body.String() != second.Body.String() {
		t.Fatalf("replayed body differs:\nfirst=%s\nsecond=%s", first.Body.String(), second.Body.String())
	}
	if store.updateProjectWithInlineCalls != 1 {
		t.Fatalf("transition executions = %d, want 1 (the replay is served from the receipt)", store.updateProjectWithInlineCalls)
	}
}

// Key reuse with a different payload is an explicit conflict — never a silent
// second execution under someone else's key.
func TestHandleProjectByIDUpdateInlineKeyReuseWithOtherPayloadReturns409(t *testing.T) {
	srv := &Server{Store: seedInlineUpdateStore(nil)}
	other := `{"id":"88888888-9999-0000-1111-222222222222","name":"Otro nombre","customer_id":"","inline_customer_name":"Ana López","inline_customer_replaces":"10000000-0000-0000-0000-000000000001","expected_project_updated_at":"2026-09-13T22:00:00Z","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"status":"draft","items":[]}`
	first := httptest.NewRecorder()
	second := httptest.NewRecorder()

	serveInlineUpdate(srv, first, inlineUpdateRequest(inlineUpdateBody, "key-714-eeeeeeeeeeee"))
	serveInlineUpdate(srv, second, inlineUpdateRequest(other, "key-714-eeeeeeeeeeee"))

	if second.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body=%s)", second.Code, second.Body.String())
	}
}

// Proof H mapping: the storage's explicit concurrency error surfaces as an
// honest 409, never as a 500 or a silent overwrite.
func TestHandleProjectByIDUpdateInlineConcurrentConflictReturns409(t *testing.T) {
	store := seedInlineUpdateStore(&stubStore{updateProjectWithInlineErr: storage.ErrProjectConcurrentUpdate})
	srv := &Server{Store: store}
	rr := httptest.NewRecorder()

	serveInlineUpdate(srv, rr, inlineUpdateRequest(inlineUpdateBody, "key-714-ffffffffffff"))

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "cambió") {
		t.Errorf("error message = %q, want the honest concurrent-update message", msg)
	}
}

// Proof J: the inline capability cannot bypass the commercial lifecycle — a
// non-draft project is rejected with an explicit conflict.
func TestHandleProjectByIDUpdateInlineClosedProjectReturns409(t *testing.T) {
	store := seedInlineUpdateStore(nil)
	store.projectReturnedByID.Status = domain.StatusQuoted
	srv := &Server{Store: store}
	rr := httptest.NewRecorder()

	serveInlineUpdate(srv, rr, inlineUpdateRequest(inlineUpdateBody, "key-714-gggggggggggg"))

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.updateProjectWithInlineCalls != 0 {
		t.Fatal("a closed project must never reach the inline transition")
	}
}

// The inline transition writes BOTH entities, so a caller without the
// customer-mutation capability is refused even though it may edit projects.
func TestHandleProjectByIDUpdateInlineWithoutCustomerPermissionReturns403(t *testing.T) {
	store := seedInlineUpdateStore(nil)
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodPut, inlineUpdateProjectPath, strings.NewReader(inlineUpdateBody)), "prod-1", string(domain.RoleProduccion))
	req.SetPathValue("id", "88888888-9999-0000-1111-222222222222")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "key-714-hhhhhhhhhhhh")
	rr := httptest.NewRecorder()

	serveInlineUpdate(srv, rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusForbidden, rr.Body.String())
	}
	if store.updateProjectWithInlineCalls != 0 {
		t.Fatal("production-only roles must never run the inline transition")
	}
}

// Regression (proof D): legacy PUTs — no inline fields, no idempotency key —
// keep the exact previous contract: plain UpdateProject, flat project echo.
func TestHandleProjectByIDUpdateLegacyPutUnchanged(t *testing.T) {
	store := seedInlineUpdateStore(nil)
	srv := &Server{Store: store}
	body := `{"id":"88888888-9999-0000-1111-222222222222","name":"Edición normal","customer_id":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"status":"draft","items":[]}`
	req := withClaims(httptest.NewRequest(http.MethodPut, inlineUpdateProjectPath, strings.NewReader(body)), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "88888888-9999-0000-1111-222222222222")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjectByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.updateProjectWithInlineCalls != 0 {
		t.Fatal("legacy PUT must never touch the inline transition")
	}
	if store.lastUpdatedProject == nil {
		t.Fatal("legacy PUT must go through UpdateProject")
	}
	var got domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.CustomerID != "10000000-0000-0000-0000-000000000001" {
		t.Fatalf("customer_id = %q, want the selected existing customer", got.CustomerID)
	}
}

// TestHandleProjectByIDUpdateNotFoundReturns404 ensures PUT on a missing project
// returns 404 so APIWorkspaceRepository.upsert falls through to POST create.
// Regression: UpdateProject used to return nil when RowsAffected==0, upsert
// treated it as success, and POST /calculate 404'd on a phantom FE-only id.
func TestHandleProjectByIDUpdateNotFoundReturns404(t *testing.T) {
	srv := &Server{Store: &stubStore{projectGetByIDErr: errors.New("no rows in result set")}}
	body := strings.NewReader(`{"id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","name":"Ghost","customer_id":"10000000-0000-0000-0000-000000000001","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
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

// Pre-demo audit P1-5: PUT with empty-string uuid fields (e.g. the minimal
// {"status":"accepted"} payload or a round-trip with unset optionals) used to
// reach SQL as "" on NOT NULL uuid columns and surface as 500 22P02
// "error interno del servidor". It must be a 400 that names the field.
func TestHandleProjectByIDUpdateEmptyCustomerReturns400(t *testing.T) {
	srv := &Server{Store: &stubStore{projectReturnedByID: &domain.Project{
		ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "u1", Status: domain.StatusDraft,
	}}}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "admin", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjectByID(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "cliente") {
		t.Errorf("error message = %q, want it to mention 'cliente'", msg)
	}
}

func TestHandleProjectByIDUpdateEmptyModuleIDReturns400(t *testing.T) {
	srv := &Server{Store: &stubStore{projectReturnedByID: &domain.Project{
		ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "u1", Status: domain.StatusDraft,
	}}}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"10000000-0000-0000-0000-000000000001","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"items":[{"id":"i1","module_id":"","quantity":1,"option_choices":{"FRENTE":""}}]}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "admin", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjectByID(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "mueble") {
		t.Errorf("error message = %q, want it to mention 'mueble'", msg)
	}
}

func TestHandleProjectsCreateEmptyCustomerReturns400(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"name":"X","customer_id":"","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "admin", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "cliente") {
		t.Errorf("error message = %q, want it to mention 'cliente'", msg)
	}
}

func TestHandleProjectByIDUpdateMalformedRequiredUUIDsReturn400(t *testing.T) {
	const validCustomer = "10000000-0000-0000-0000-000000000001"
	const validModule = "20000000-0000-0000-0000-000000000001"
	const validChoice = "30000000-0000-0000-0000-000000000001"
	tests := []struct {
		name string
		body string
		want string
	}{
		{
			name: "customer",
			body: `{"id":"p1","name":"P","customer_id":"not-a-uuid","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`,
			want: "cliente",
		},
		{
			name: "module",
			body: `{"id":"p1","name":"P","customer_id":"` + validCustomer + `","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"items":[{"id":"i1","module_id":"bad-module","quantity":1,"option_choices":{}}]}`,
			want: "mueble",
		},
		{
			name: "item choice",
			body: `{"id":"p1","name":"P","customer_id":"` + validCustomer + `","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"items":[{"id":"i1","module_id":"` + validModule + `","quantity":1,"option_choices":{"FRENTE":"bad-choice"}}]}`,
			want: "opción inválida",
		},
		{
			name: "project choice",
			body: `{"id":"p1","name":"P","customer_id":"` + validCustomer + `","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"project_level_choices":{"FRENTE":"bad-choice"},"items":[{"id":"i1","module_id":"` + validModule + `","quantity":1,"option_choices":{"FRENTE":"` + validChoice + `"}}]}`,
			want: "opción global inválida",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := &Server{Store: &stubStore{projectReturnedByID: &domain.Project{
				ID: "p1", Name: "P", CustomerID: validCustomer, OwnerUserID: "u1", Status: domain.StatusDraft,
			}}}
			req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", strings.NewReader(tt.body)), "admin", string(domain.RoleAdmin))
			req.SetPathValue("id", "p1")
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()

			srv.HandleProjectByID(rr, req)

			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusBadRequest, rr.Body.String())
			}
			if msg := errorBody(t, rr); !strings.Contains(msg, tt.want) {
				t.Errorf("error message = %q, want it to mention %q", msg, tt.want)
			}
		})
	}
}

func withClaims(req *http.Request, userID, role string) *http.Request {
	claims := &auth.Claims{UserID: userID, Role: role, Email: userID + "@test.com"}
	ctx := context.WithValue(req.Context(), UserContextKey, claims)
	ctx = storage.WithOrgCtx(ctx, storage.InitialOrganizationID)
	return req.WithContext(ctx)
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
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"owner_user_id":"v2"}`)
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
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"status":"draft","owner_user_id":"v1"}`)
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
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"status":"draft","owner_user_id":"v1"}`)
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
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"status":"produced","owner_user_id":"v1"}`)
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
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"status":"produced","owner_user_id":"v1"}`)
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
	body := strings.NewReader(`{"email":"nope@test.com","password":"whatever1","transport":"web"}`)
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
			Name: "P", AccountStatus: domain.AccountStatusDisabled,
		}},
		JWTSecret: "test-secret-key-for-jwt-signing-32b",
	}
	body := strings.NewReader(`{"email":"pending@test.com","password":"goodpass1","transport":"web"}`)
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
			Name: "O", AccountStatus: domain.AccountStatusActive,
		}},
		JWTSecret: "test-secret-key-for-jwt-signing-32b",
	}
	body := strings.NewReader(`{"email":"ok@test.com","password":"wrongpass9","transport":"web"}`)
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
			{ID: "20000000-0000-0000-0000-000000000001", Code: "MOD-1", Name: "M", StructureID: "st1"},
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
				{ID: "it1", ModuleID: "20000000-0000-0000-0000-000000000001", Quantity: 1},
			},
		},
		catalogOverride: catalog,
	}
	srv := &Server{Store: store}
	// Move draft → quoted (closed). The item has no incoming pin.
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[{"id":"it1","module_id":"20000000-0000-0000-0000-000000000001","quantity":1}],"status":"quoted","owner_user_id":"adm1"}`)
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
	req.Header.Set("If-Match", `"v1"`)
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
		ID:            "u-123",
		Email:         "carlos@carpinteria.com",
		PasswordHash:  "$2a$12$eImiTXuWVxfM37uY4JANjOL.oUvhqp7VOHWcxSGYV7G4j7n",
		Name:          "Carlos Carpintero",
		AccountStatus: domain.AccountStatusActive,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	resp := LoginResponse{
		Token: "jwt-token-example",
		User:  toOpenAPIUser(&u),
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
	// Roles live in the membership (`roles` sibling in auth responses) — the
	// user payload itself must NOT carry a role anymore (000090).
	if strings.Contains(raw, `"role"`) {
		t.Errorf("user payload must not carry role: %s", raw)
	}
}

// --- F172 stubs: platform / org team / invitations / support sessions ---
func (s *stubStore) LockOrganizationForCommand(context.Context, string) error { return nil }
func TestHandleComponentsAmbiguousRolesRejected400(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"code":"AMB","name":"Ambigua","placement":"puerta","geometry_kind":"rectangular_board","thickness_mm":18,"option_roles":["FRONT","BODY"],"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/components", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleComponents(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "una única selección") {
		t.Errorf("error message = %q, want the single-binding contract hint", msg)
	}
}

func TestHandleComponentsEmptyRolesRejected400(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"code":"VAC","name":"Vacía","placement":"puerta","geometry_kind":"rectangular_board","thickness_mm":18,"option_roles":["","  "],"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/components", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleComponents(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "al menos un rol") {
		t.Errorf("error message = %q, want the empty-roles hint", msg)
	}
}
