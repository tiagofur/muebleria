package application

import (
	"context"
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

type organizationStoreFake struct {
	user           *domain.User
	organization   *domain.Organization
	entitlements   *domain.OrganizationEntitlements
	readiness      storage.OrganizationReadiness
	offboarding    storage.OrganizationOffboardingPreview
	cloneErr       error
	entitlementErr error
	settingsErr    error
	membershipErr  error
	readinessErr   error
	transitionErr  error
	auditErrEvent  string
	audits         []storage.SecurityAuditEvent
	supportCuts    int
}

func (f *organizationStoreFake) WithinTenantTx(ctx context.Context, _ storage.TenantActor, execute func(context.Context) error) error {
	var organization *domain.Organization
	if f.organization != nil {
		value := *f.organization
		organization = &value
	}
	var entitlements *domain.OrganizationEntitlements
	if f.entitlements != nil {
		value := *f.entitlements
		entitlements = &value
	}
	readiness, audits, supportCuts := f.readiness, append([]storage.SecurityAuditEvent(nil), f.audits...), f.supportCuts
	if err := execute(ctx); err != nil {
		f.organization, f.entitlements, f.readiness, f.audits, f.supportCuts = organization, entitlements, readiness, audits, supportCuts
		return err
	}
	return nil
}
func (f *organizationStoreFake) GetUserByID(context.Context, string) (*domain.User, error) {
	if f.user == nil {
		return nil, errors.New("not found")
	}
	return f.user, nil
}
func (f *organizationStoreFake) GetOrganizationByID(context.Context, string) (*domain.Organization, error) {
	if f.organization == nil {
		return nil, errors.New("not found")
	}
	copy := *f.organization
	return &copy, nil
}
func (f *organizationStoreFake) CreateOrganization(_ context.Context, value *domain.Organization) error {
	value.ID, value.Version, value.CredentialVersion = "00000000-0000-0000-0000-000000000111", 1, 1
	copy := *value
	f.organization = &copy
	f.entitlements = &domain.OrganizationEntitlements{OrganizationID: value.ID, Version: 1, Source: domain.OrganizationEntitlementSourceLegacyUnlimited, DefaultsRevision: "legacy"}
	return nil
}
func (f *organizationStoreFake) EnsureMembership(context.Context, string, string, []domain.UserRole) error {
	if f.membershipErr != nil {
		return f.membershipErr
	}
	f.readiness.ActiveAdminReady, f.readiness.TeamStateReady = true, true
	return nil
}
func (f *organizationStoreFake) CloneCatalog(context.Context, string, string) error {
	return f.cloneErr
}
func (f *organizationStoreFake) UpsertWorkshopSettingsForOrganization(_ context.Context, _ string, value domain.WorkshopSettings) (domain.WorkshopSettings, error) {
	if f.settingsErr != nil {
		return domain.WorkshopSettings{}, f.settingsErr
	}
	f.readiness.SettingsReady = true
	return value, nil
}
func (f *organizationStoreFake) GetOrganizationReadiness(context.Context, string) (*storage.OrganizationReadiness, error) {
	if f.readinessErr != nil {
		return nil, f.readinessErr
	}
	copy := f.readiness
	copy.CatalogReady, copy.MediaReady = true, true
	return &copy, nil
}
func (f *organizationStoreFake) GetOrganizationOffboardingPreview(context.Context, string) (*storage.OrganizationOffboardingPreview, error) {
	copy := f.offboarding
	return &copy, nil
}
func (f *organizationStoreFake) GetOrganizationEntitlements(context.Context, string) (*domain.OrganizationEntitlements, error) {
	if f.entitlements == nil {
		return nil, errors.New("not found")
	}
	copy := *f.entitlements
	return &copy, nil
}
func (f *organizationStoreFake) UpdateOrganizationEntitlementsVersion(_ context.Context, value domain.OrganizationEntitlements, expected int64) (*domain.OrganizationEntitlements, error) {
	if f.entitlementErr != nil {
		return nil, f.entitlementErr
	}
	if f.entitlements == nil || f.entitlements.Version != expected {
		return nil, storage.ErrVersionConflict
	}
	value.Version = expected + 1
	f.entitlements = &value
	f.readiness.EntitlementsReady = true
	copy := value
	return &copy, nil
}
func (f *organizationStoreFake) TransitionOrganizationStatus(_ context.Context, _ string, from, to domain.OrganizationStatus, _ string, _ string, expected int64) (*domain.Organization, error) {
	if f.transitionErr != nil {
		return nil, f.transitionErr
	}
	if f.organization.Status != from || f.organization.Version != expected {
		return nil, storage.ErrOrganizationStatusConflict
	}
	f.organization.Status, f.organization.Version = to, expected+1
	f.organization.CredentialVersion++
	copy := *f.organization
	return &copy, nil
}
func (f *organizationStoreFake) InsertSecurityAuditEvent(_ context.Context, event storage.SecurityAuditEvent) error {
	if f.auditErrEvent == event.EventType {
		return errors.New("injected audit failure")
	}
	f.audits = append(f.audits, event)
	return nil
}
func (f *organizationStoreFake) EndOpenSupportSessionsByOrg(context.Context, string, string) (int64, error) {
	f.supportCuts++
	return 2, nil
}

func TestDefaultOrganizationEntitlementsFailClosed(t *testing.T) {
	tests := []struct {
		name          string
		kind          domain.OrganizationType
		plan          domain.LicensePlan
		manufacturing bool
		seats         int64
	}{
		{"factory pro", domain.OrganizationTypeFactory, domain.LicensePlanPro, true, 1},
		{"factory none", domain.OrganizationTypeFactory, domain.LicensePlanNone, false, 0},
		{"store pro", domain.OrganizationTypeStore, domain.LicensePlanPro, false, 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			value := DefaultOrganizationEntitlements(test.kind, test.plan)
			if value.ManufacturingEnabled != test.manufacturing || value.SketchupSeats != test.seats || value.SalesNetworkEnabled || value.AdvancedAuditEnabled || value.MaxSalesPartners != 0 || value.MaxActiveMembers == nil || *value.MaxActiveMembers != 1 {
				t.Fatalf("defaults = %+v", value)
			}
		})
	}
}

func TestProvisionOrganizationActivatesOnlyAfterReadiness(t *testing.T) {
	store := &organizationStoreFake{user: &domain.User{ID: "00000000-0000-0000-0000-000000000222", AccountStatus: domain.AccountStatusActive}}
	service := NewOrganizationService(store)
	result, err := service.ProvisionOrganization(context.Background(), ProvisionOrganizationCommand{
		ActorUserID: store.user.ID, BootstrapAdminUserID: store.user.ID,
		Name: "Factory", Slug: "factory", Type: domain.OrganizationTypeFactory,
		LicensePlan: domain.LicensePlanPro, AllowEmptyCatalog: true, RequestID: "request-provision-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Organization.Status != domain.OrganizationStatusActive || !result.Readiness.Ready {
		t.Fatalf("result = %+v", result)
	}
	if len(store.audits) != 2 || store.audits[0].EventType != "organization_provisioning_started" || store.audits[1].EventType != "organization_provisioning_completed" {
		t.Fatalf("audits = %+v", store.audits)
	}
	if store.audits[0].Details["request_id"] != "request-provision-1" || store.audits[1].Details["request_id"] != "request-provision-1" {
		t.Fatalf("provisioning audit lineage = %+v", store.audits)
	}
}

func TestProvisionOrganizationRollsBackEveryMaterialStepFailure(t *testing.T) {
	injected := errors.New("injected provisioning step failure")
	tests := []struct {
		name      string
		configure func(*organizationStoreFake, *ProvisionOrganizationCommand)
	}{
		{"entitlements", func(store *organizationStoreFake, _ *ProvisionOrganizationCommand) { store.entitlementErr = injected }},
		{"settings", func(store *organizationStoreFake, _ *ProvisionOrganizationCommand) { store.settingsErr = injected }},
		{"bootstrap membership", func(store *organizationStoreFake, _ *ProvisionOrganizationCommand) { store.membershipErr = injected }},
		{"catalog clone", func(store *organizationStoreFake, cmd *ProvisionOrganizationCommand) {
			store.cloneErr = injected
			cmd.AllowEmptyCatalog = false
			cmd.CloneCatalogFrom = "00000000-0000-0000-0000-000000000333"
		}},
		{"provisioning start audit", func(store *organizationStoreFake, _ *ProvisionOrganizationCommand) {
			store.auditErrEvent = "organization_provisioning_started"
		}},
		{"readiness", func(store *organizationStoreFake, _ *ProvisionOrganizationCommand) { store.readinessErr = injected }},
		{"activation", func(store *organizationStoreFake, _ *ProvisionOrganizationCommand) { store.transitionErr = injected }},
		{"provisioning completion audit", func(store *organizationStoreFake, _ *ProvisionOrganizationCommand) {
			store.auditErrEvent = "organization_provisioning_completed"
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &organizationStoreFake{user: &domain.User{ID: "00000000-0000-0000-0000-000000000222", AccountStatus: domain.AccountStatusActive}}
			cmd := ProvisionOrganizationCommand{
				ActorUserID: store.user.ID, BootstrapAdminUserID: store.user.ID,
				Name: "Factory", Slug: "rollback-factory", Type: domain.OrganizationTypeFactory,
				LicensePlan: domain.LicensePlanPro, AllowEmptyCatalog: true,
			}
			test.configure(store, &cmd)
			if _, err := NewOrganizationService(store).ProvisionOrganization(context.Background(), cmd); err == nil {
				t.Fatal("injected step failure must reject provisioning")
			}
			if store.organization != nil || store.entitlements != nil || len(store.audits) != 0 {
				t.Fatalf("transaction leaked organization=%+v entitlements=%+v audits=%+v", store.organization, store.entitlements, store.audits)
			}
		})
	}
}

func TestSuspendOrganizationCutsSupportAndBumpsEpoch(t *testing.T) {
	store := &organizationStoreFake{organization: &domain.Organization{ID: "00000000-0000-0000-0000-000000000111", Status: domain.OrganizationStatusActive, Version: 4, CredentialVersion: 7}}
	result, err := NewOrganizationService(store).SuspendOrganization(context.Background(), LifecycleCommand{
		OrganizationID: store.organization.ID, ActorUserID: "00000000-0000-0000-0000-000000000222", Reason: "security incident", ExpectedVersion: 4, RequestID: "request-suspend-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != domain.OrganizationStatusSuspended || result.CredentialVersion != 8 || store.supportCuts != 1 || len(store.audits) != 1 {
		t.Fatalf("result=%+v support=%d audits=%+v", result, store.supportCuts, store.audits)
	}
	if store.audits[0].Details["request_id"] != "request-suspend-1" {
		t.Fatalf("lifecycle audit lineage = %+v", store.audits[0])
	}
}

func TestReactivateOrganizationRequiresReadiness(t *testing.T) {
	store := &organizationStoreFake{
		organization: &domain.Organization{ID: "00000000-0000-0000-0000-000000000111", Status: domain.OrganizationStatusSuspended, Version: 2, CredentialVersion: 2},
		entitlements: &domain.OrganizationEntitlements{OrganizationID: "00000000-0000-0000-0000-000000000111", MaxSalesPartners: 0, SketchupSeats: 0, DefaultsRevision: "v1"},
		readiness:    storage.OrganizationReadiness{EntitlementsReady: true, SettingsReady: false, ActiveAdminReady: true, TeamStateReady: true},
	}
	_, _, err := NewOrganizationService(store).ReactivateOrganization(context.Background(), LifecycleCommand{OrganizationID: store.organization.ID, ActorUserID: "00000000-0000-0000-0000-000000000222", Reason: "resolved", ExpectedVersion: 2})
	if !errors.Is(err, ErrOrganizationNotReady) {
		t.Fatalf("err = %v", err)
	}
	if store.organization.Status != domain.OrganizationStatusSuspended {
		t.Fatalf("status = %s", store.organization.Status)
	}
}

func TestBeginOffboardingRejectsBlockers(t *testing.T) {
	store := &organizationStoreFake{
		organization: &domain.Organization{ID: "00000000-0000-0000-0000-000000000111", Status: domain.OrganizationStatusActive, Version: 3, CredentialVersion: 2},
		offboarding:  storage.OrganizationOffboardingPreview{OpenProjectCount: 1},
	}
	service := NewOrganizationService(store)
	preview, err := service.PreviewOffboarding(context.Background(), store.organization.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.BeginOffboarding(context.Background(), LifecycleCommand{OrganizationID: store.organization.ID, ActorUserID: "00000000-0000-0000-0000-000000000222", Reason: "closure", ExpectedVersion: 3, ImpactVersion: preview.ImpactVersion})
	if !errors.Is(err, ErrOrganizationOffboardingBlocked) {
		t.Fatalf("err = %v", err)
	}
}

func TestTerminateOrganizationAllowsFailedProvisioningCleanup(t *testing.T) {
	store := &organizationStoreFake{
		organization: &domain.Organization{ID: "00000000-0000-0000-0000-000000000111", Status: domain.OrganizationStatusProvisioningFailed, Version: 3, CredentialVersion: 2},
	}
	service := NewOrganizationService(store)
	preview, err := service.PreviewOffboarding(context.Background(), store.organization.ID)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.TerminateOrganization(context.Background(), LifecycleCommand{
		OrganizationID:  store.organization.ID,
		ActorUserID:     "00000000-0000-0000-0000-000000000222",
		Reason:          "abandon failed provisioning",
		ExpectedVersion: 3,
		ImpactVersion:   preview.ImpactVersion,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != domain.OrganizationStatusTerminated || result.CredentialVersion != 3 {
		t.Fatalf("terminated failed provisioning=%+v", result)
	}
}

func TestOrganizationOffboardingPreviewIncludesPhysicalWorkInDeterministicFingerprint(t *testing.T) {
	store := &organizationStoreFake{
		organization: &domain.Organization{ID: "00000000-0000-0000-0000-000000000111", Status: domain.OrganizationStatusActive, Version: 3},
		offboarding: storage.OrganizationOffboardingPreview{
			OpenProjectCount: 1, ActiveProductionClaimCount: 1,
			ActivePartOperationCount: 1, ActiveModuleUnitCount: 1,
			ActiveInstallationVisitCount: 1, OpenInstallationFieldIssueCount: 1,
			OpenInstallationPunchItemCount: 1, OpenPurchaseOrderCount: 1,
			OpenWarrantyTicketCount: 1, ActiveChildOrganizationCount: 1,
		},
	}
	service := NewOrganizationService(store)
	first, err := service.PreviewOffboarding(context.Background(), store.organization.ID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.PreviewOffboarding(context.Background(), store.organization.ID)
	if err != nil {
		t.Fatal(err)
	}
	if first.ImpactVersion == "" || first.ImpactVersion != second.ImpactVersion {
		t.Fatalf("fingerprint is not deterministic: first=%q second=%q", first.ImpactVersion, second.ImpactVersion)
	}
	if len(first.Blockers) != 10 {
		t.Fatalf("blockers=%+v", first.Blockers)
	}
	wantPhysicalCodes := map[string]bool{
		"active_part_operations": false, "active_module_units": false,
		"active_installation_visits": false, "open_installation_field_issues": false,
		"open_installation_punch_items": false,
	}
	for _, blocker := range first.Blockers {
		if _, ok := wantPhysicalCodes[blocker.Code]; ok {
			wantPhysicalCodes[blocker.Code] = true
		}
	}
	for code, found := range wantPhysicalCodes {
		if !found {
			t.Fatalf("missing physical blocker %q in %+v", code, first.Blockers)
		}
	}
	store.offboarding.OpenInstallationPunchItemCount++
	changed, err := service.PreviewOffboarding(context.Background(), store.organization.ID)
	if err != nil {
		t.Fatal(err)
	}
	if changed.ImpactVersion == first.ImpactVersion {
		t.Fatal("physical blocker change must change impact fingerprint")
	}
}
