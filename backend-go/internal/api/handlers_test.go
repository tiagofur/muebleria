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
	// #1178 password reset: configurable issuance outcome, org team fixture
	// and capture of the issued reset target.
	passwordResetIssuance *storage.PasswordResetIssuance
	orgTeam               []storage.OrgTeamMember
	issuedResetUserID     string
	issuedResetVia        string
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
	draftReleases                    []*domain.LibraryRelease
	draftReleasesErr                 error
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
	// #1084 (#443 slice 1): expected version observed on guarded writes.
	updateHardwareExpectedVersion int64
	updateHardwareErr             error
	deactivateHardwareCalled      bool
	deactivateHardwareExpectedVer int64
	deactivateHardwareErr         error
	// #1091 (#443 slice 2): conflict injection for simple catalog families.
	updateMaterialBoardErr error
	updateCategoryErr      error
	updateCustomerErr      error
	deactivateCustomerErr  error
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

func TestRBAC_ExportProductionDeniedToVendedor_Domain(t *testing.T) {
	// Client-side export; domain gate is the contract for UI + future API.
	if domain.RoleCanExportProduction(domain.RoleVendedor) {
		t.Fatal("vendedor must not export production")
	}
	if !domain.RoleCanExportProduction(domain.RoleIngeniero) {
		t.Fatal("ingeniero exports production")
	}
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
