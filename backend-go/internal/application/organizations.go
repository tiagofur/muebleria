package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const OrganizationEntitlementDefaultsRevision = "organization-foundation-v2-2026-08-30"

var (
	ErrInvalidOrganizationCommand     = errors.New("invalid organization command")
	ErrOrganizationNotReady           = errors.New("organization not ready")
	ErrOrganizationStatusConflict     = errors.New("organization status conflict")
	ErrOrganizationOffboardingBlocked = errors.New("organization offboarding blocked")
)

type ReadinessCheck struct {
	Code     string
	Ready    bool
	Blocking bool
	Message  string
}

type OrganizationReadiness struct {
	OrganizationID      string
	OrganizationVersion int64
	Ready               bool
	Checks              []ReadinessCheck
	CheckedAt           time.Time
}

type OffboardingImpact struct {
	Code    string
	Count   int64
	Message string
}

type OrganizationOffboardingPreview struct {
	OrganizationID      string
	OrganizationVersion int64
	ImpactVersion       string
	Blockers            []OffboardingImpact
	Warnings            []OffboardingImpact
}

type LifecycleCommand struct {
	OrganizationID  string
	ActorUserID     string
	Reason          string
	ImpactVersion   string
	ExpectedVersion int64
	IP              string
	RequestID       string
}

type ProvisionOrganizationCommand struct {
	ActorUserID          string
	ActorMembershipID    string
	Name                 string
	Slug                 string
	Type                 domain.OrganizationType
	LicensePlan          domain.LicensePlan
	LicenseExpiresAt     *time.Time
	BootstrapAdminUserID string
	ParentOrganizationID *string
	CloneCatalogFrom     string
	Entitlements         *domain.OrganizationEntitlements
	AllowEmptyCatalog    bool
	IP                   string
	RequestID            string
}

type ProvisionOrganizationResult struct {
	Organization domain.Organization
	Readiness    OrganizationReadiness
}

type OrganizationStore interface {
	WithinTenantTx(context.Context, storage.TenantActor, func(context.Context) error) error
	GetUserByID(context.Context, string) (*domain.User, error)
	GetOrganizationByID(context.Context, string) (*domain.Organization, error)
	CreateOrganization(context.Context, *domain.Organization) error
	EnsureMembership(context.Context, string, string, []domain.UserRole) error
	CloneCatalog(context.Context, string, string) error
	UpsertWorkshopSettingsForOrganization(context.Context, string, domain.WorkshopSettings) (domain.WorkshopSettings, error)
	GetOrganizationReadiness(context.Context, string) (*storage.OrganizationReadiness, error)
	GetOrganizationOffboardingPreview(context.Context, string) (*storage.OrganizationOffboardingPreview, error)
	GetOrganizationEntitlements(context.Context, string) (*domain.OrganizationEntitlements, error)
	UpdateOrganizationEntitlementsVersion(context.Context, domain.OrganizationEntitlements, int64) (*domain.OrganizationEntitlements, error)
	TransitionOrganizationStatus(context.Context, string, domain.OrganizationStatus, domain.OrganizationStatus, string, string, int64) (*domain.Organization, error)
	InsertSecurityAuditEvent(context.Context, storage.SecurityAuditEvent) error
	EndOpenSupportSessionsByOrg(context.Context, string, string) (int64, error)
}

type OrganizationService struct {
	store OrganizationStore
	now   func() time.Time
}

func NewOrganizationService(store OrganizationStore) *OrganizationService {
	return &OrganizationService{store: store, now: time.Now}
}

func DefaultOrganizationEntitlements(orgType domain.OrganizationType, plan domain.LicensePlan) domain.OrganizationEntitlements {
	one := int64(1)
	out := domain.OrganizationEntitlements{
		MaxActiveMembers: &one,
		Source:           domain.OrganizationEntitlementSourcePlanDefault,
		DefaultsRevision: OrganizationEntitlementDefaultsRevision,
	}
	if (plan == domain.LicensePlanTrial || plan == domain.LicensePlanPro) && orgType == domain.OrganizationTypeFactory {
		out.ManufacturingEnabled = true
		out.SketchupSeats = 1
	}
	return out
}

func ValidateOrganizationEntitlements(value domain.OrganizationEntitlements) error {
	if value.MaxActiveMembers != nil && *value.MaxActiveMembers < 1 {
		return errors.New("max active members must be at least one")
	}
	if value.MaxSalesPartners < 0 || value.SketchupSeats < 0 {
		return errors.New("entitlement limits cannot be negative")
	}
	return nil
}

func (s *OrganizationService) ProvisionOrganization(ctx context.Context, cmd ProvisionOrganizationCommand) (*ProvisionOrganizationResult, error) {
	cmd.Name = strings.TrimSpace(cmd.Name)
	cmd.Slug = strings.TrimSpace(cmd.Slug)
	if cmd.ActorUserID == "" || cmd.Name == "" || cmd.Slug == "" || cmd.BootstrapAdminUserID == "" {
		return nil, fmt.Errorf("%w: actor, name, slug and bootstrap admin are required", ErrInvalidOrganizationCommand)
	}
	if !domain.IsValidOrganizationType(cmd.Type) || !domain.IsValidLicensePlan(cmd.LicensePlan) {
		return nil, fmt.Errorf("%w: invalid organization type or license plan", ErrInvalidOrganizationCommand)
	}
	entitlements := DefaultOrganizationEntitlements(cmd.Type, cmd.LicensePlan)
	if cmd.Entitlements != nil {
		entitlements = *cmd.Entitlements
		entitlements.Source = domain.OrganizationEntitlementSourcePlatformOverride
		entitlements.DefaultsRevision = OrganizationEntitlementDefaultsRevision
	}
	if err := ValidateOrganizationEntitlements(entitlements); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidOrganizationCommand, err)
	}

	actor := storage.TenantActor{UserID: cmd.ActorUserID}
	if cmd.ParentOrganizationID != nil {
		actor.OrganizationID = *cmd.ParentOrganizationID
		actor.MembershipID = cmd.ActorMembershipID
	}
	var result ProvisionOrganizationResult
	err := s.store.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
		bootstrap, err := s.store.GetUserByID(txCtx, cmd.BootstrapAdminUserID)
		if err != nil || bootstrap == nil || bootstrap.AccountStatus != domain.AccountStatusActive {
			return fmt.Errorf("%w: bootstrap admin must be an active user", ErrInvalidOrganizationCommand)
		}
		org := domain.Organization{
			Name: cmd.Name, Slug: cmd.Slug, Type: cmd.Type,
			LicensePlan: cmd.LicensePlan, LicenseExpiresAt: cmd.LicenseExpiresAt,
			Status:               domain.OrganizationStatusProvisioning,
			ParentOrganizationID: cmd.ParentOrganizationID,
		}
		if err := s.store.CreateOrganization(txCtx, &org); err != nil {
			return fmt.Errorf("create organization: %w", err)
		}
		entitlements.OrganizationID = org.ID
		entitlements.Version = 1
		if _, err := s.store.UpdateOrganizationEntitlementsVersion(txCtx, entitlements, 1); err != nil {
			return fmt.Errorf("write organization entitlements: %w", err)
		}
		if _, err := s.store.UpsertWorkshopSettingsForOrganization(txCtx, org.ID, domain.DefaultWorkshopSettings()); err != nil {
			return fmt.Errorf("write workshop settings: %w", err)
		}
		if err := s.store.EnsureMembership(txCtx, org.ID, cmd.BootstrapAdminUserID, []domain.UserRole{domain.RoleAdmin}); err != nil {
			return fmt.Errorf("create bootstrap admin membership: %w", err)
		}
		if cmd.CloneCatalogFrom != "" {
			if err := s.store.CloneCatalog(txCtx, cmd.CloneCatalogFrom, org.ID); err != nil {
				return fmt.Errorf("clone catalog: %w", err)
			}
		} else if !cmd.AllowEmptyCatalog {
			return errors.New("catalog strategy is required")
		}
		if err := s.store.InsertSecurityAuditEvent(txCtx, storage.SecurityAuditEvent{
			EventType: "organization_provisioning_started", ActorUserID: cmd.ActorUserID,
			OrganizationID: org.ID, IP: cmd.IP,
			Details: map[string]interface{}{"bootstrap_admin_user_id": cmd.BootstrapAdminUserID, "catalog_strategy": catalogStrategy(cmd), "request_id": cmd.RequestID},
		}); err != nil {
			return fmt.Errorf("audit provisioning start: %w", err)
		}
		readiness, err := s.evaluateReadiness(txCtx, org, cmd.CloneCatalogFrom != "" || cmd.AllowEmptyCatalog)
		if err != nil {
			return err
		}
		if !readiness.Ready {
			return ErrOrganizationNotReady
		}
		active, err := s.store.TransitionOrganizationStatus(txCtx, org.ID, domain.OrganizationStatusProvisioning, domain.OrganizationStatusActive, cmd.ActorUserID, "initial provisioning completed", org.Version)
		if err != nil {
			return fmt.Errorf("activate organization: %w", err)
		}
		readiness.OrganizationVersion = active.Version
		if err := s.store.InsertSecurityAuditEvent(txCtx, storage.SecurityAuditEvent{
			EventType: "organization_provisioning_completed", ActorUserID: cmd.ActorUserID,
			OrganizationID: active.ID, IP: cmd.IP,
			Details: map[string]interface{}{"status": string(active.Status), "version": active.Version, "request_id": cmd.RequestID},
		}); err != nil {
			return fmt.Errorf("audit provisioning completion: %w", err)
		}
		result = ProvisionOrganizationResult{Organization: *active, Readiness: readiness}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}

func catalogStrategy(cmd ProvisionOrganizationCommand) string {
	if cmd.CloneCatalogFrom != "" {
		return "clone"
	}
	return "empty_baseline"
}

func (s *OrganizationService) evaluateReadiness(ctx context.Context, org domain.Organization, catalogReady bool) (OrganizationReadiness, error) {
	stored, err := s.store.GetOrganizationReadiness(ctx, org.ID)
	if err != nil {
		return OrganizationReadiness{}, fmt.Errorf("read organization readiness: %w", err)
	}
	entitlements, err := s.store.GetOrganizationEntitlements(ctx, org.ID)
	if err != nil {
		return OrganizationReadiness{}, fmt.Errorf("read entitlements readiness: %w", err)
	}
	entitlementsReady := stored.EntitlementsReady && entitlements != nil && ValidateOrganizationEntitlements(*entitlements) == nil
	checks := []ReadinessCheck{
		{Code: "bootstrap_admin", Ready: stored.ActiveAdminReady && stored.TeamStateReady, Blocking: true, Message: "An active bootstrap administrator is required."},
		{Code: "workshop_settings", Ready: stored.SettingsReady, Blocking: true, Message: "Workshop settings must be materialized."},
		{Code: "entitlements", Ready: entitlementsReady, Blocking: true, Message: "A complete entitlement snapshot is required."},
		{Code: "catalog", Ready: stored.CatalogReady && catalogReady, Blocking: true, Message: "A catalog strategy must complete."},
		{Code: "media_namespace", Ready: stored.MediaReady, Blocking: true, Message: "The media namespace is derived from the organization identifier."},
	}
	ready := true
	for _, check := range checks {
		if check.Blocking && !check.Ready {
			ready = false
		}
	}
	return OrganizationReadiness{OrganizationID: org.ID, OrganizationVersion: org.Version, Ready: ready, Checks: checks, CheckedAt: s.now().UTC()}, nil
}

func (s *OrganizationService) GetReadiness(ctx context.Context, organizationID, actorID string) (OrganizationReadiness, error) {
	org, err := s.store.GetOrganizationByID(ctx, organizationID)
	if err != nil {
		return OrganizationReadiness{}, err
	}
	return s.evaluateReadiness(ctx, *org, true)
}

func (s *OrganizationService) GetEntitlements(ctx context.Context, organizationID string) (*domain.OrganizationEntitlements, error) {
	return s.store.GetOrganizationEntitlements(ctx, organizationID)
}

func (s *OrganizationService) UpdateEntitlements(ctx context.Context, cmd LifecycleCommand, value domain.OrganizationEntitlements) (*domain.OrganizationEntitlements, error) {
	value.OrganizationID = cmd.OrganizationID
	value.Source = domain.OrganizationEntitlementSourcePlatformOverride
	value.DefaultsRevision = OrganizationEntitlementDefaultsRevision
	if err := ValidateOrganizationEntitlements(value); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidOrganizationCommand, err)
	}
	var result *domain.OrganizationEntitlements
	err := s.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: cmd.OrganizationID, UserID: cmd.ActorUserID}, func(txCtx context.Context) error {
		before, err := s.store.GetOrganizationEntitlements(txCtx, cmd.OrganizationID)
		if err != nil {
			return err
		}
		result, err = s.store.UpdateOrganizationEntitlementsVersion(txCtx, value, cmd.ExpectedVersion)
		if err != nil {
			return err
		}
		return s.store.InsertSecurityAuditEvent(txCtx, storage.SecurityAuditEvent{
			EventType: "organization_entitlements_changed", ActorUserID: cmd.ActorUserID,
			OrganizationID: cmd.OrganizationID, IP: cmd.IP,
			Details: map[string]interface{}{"from_version": before.Version, "to_version": result.Version, "reason": strings.TrimSpace(cmd.Reason), "request_id": cmd.RequestID},
		})
	})
	return result, err
}

func (s *OrganizationService) SuspendOrganization(ctx context.Context, cmd LifecycleCommand) (*domain.Organization, error) {
	return s.transition(ctx, cmd, domain.OrganizationStatusActive, domain.OrganizationStatusSuspended, "organization_suspended", true, false)
}

func (s *OrganizationService) ReactivateOrganization(ctx context.Context, cmd LifecycleCommand) (*domain.Organization, OrganizationReadiness, error) {
	var readiness OrganizationReadiness
	var result *domain.Organization
	err := s.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: cmd.OrganizationID, UserID: cmd.ActorUserID}, func(txCtx context.Context) error {
		org, err := s.store.GetOrganizationByID(txCtx, cmd.OrganizationID)
		if err != nil {
			return err
		}
		if org.Status != domain.OrganizationStatusSuspended || org.Version != cmd.ExpectedVersion {
			return ErrOrganizationStatusConflict
		}
		readiness, err = s.evaluateReadiness(txCtx, *org, true)
		if err != nil {
			return err
		}
		if !readiness.Ready {
			return ErrOrganizationNotReady
		}
		result, err = s.store.TransitionOrganizationStatus(txCtx, org.ID, org.Status, domain.OrganizationStatusActive, cmd.ActorUserID, strings.TrimSpace(cmd.Reason), cmd.ExpectedVersion)
		if err != nil {
			return mapOrganizationStatusError(err)
		}
		readiness.OrganizationVersion = result.Version
		return s.auditLifecycle(txCtx, cmd, "organization_reactivated", *org, *result, nil)
	})
	return result, readiness, err
}

func (s *OrganizationService) PreviewOffboarding(ctx context.Context, organizationID string) (*OrganizationOffboardingPreview, error) {
	org, err := s.store.GetOrganizationByID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	stored, err := s.store.GetOrganizationOffboardingPreview(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	blockers := make([]OffboardingImpact, 0, 10)
	add := func(code string, count int, message string) {
		if count > 0 {
			blockers = append(blockers, OffboardingImpact{Code: code, Count: int64(count), Message: message})
		}
	}
	add("open_projects", stored.OpenProjectCount, "Open projects must be completed or cancelled.")
	add("active_production_claims", stored.ActiveProductionClaimCount, "Active production claims must be finished.")
	add("active_part_operations", stored.ActivePartOperationCount, "Active part operations must be completed or skipped.")
	add("active_module_units", stored.ActiveModuleUnitCount, "Active module units must be installed.")
	add("active_installation_visits", stored.ActiveInstallationVisitCount, "Active installation visits must be completed or cancelled.")
	add("open_installation_field_issues", stored.OpenInstallationFieldIssueCount, "Installation field issues must be resolved or verified.")
	add("open_installation_punch_items", stored.OpenInstallationPunchItemCount, "Installation punch items must be closed.")
	add("open_purchase_orders", stored.OpenPurchaseOrderCount, "Open purchase orders must be received or cancelled.")
	add("open_warranties", stored.OpenWarrantyTicketCount, "Open warranty work must be resolved.")
	add("active_child_organizations", stored.ActiveChildOrganizationCount, "Child organizations must be terminated first.")
	fingerprint := sha256.Sum256([]byte(fmt.Sprintf(
		"%s:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d",
		org.ID, org.Version, stored.OpenProjectCount, stored.ActiveProductionClaimCount,
		stored.ActivePartOperationCount, stored.ActiveModuleUnitCount,
		stored.ActiveInstallationVisitCount, stored.OpenInstallationFieldIssueCount,
		stored.OpenInstallationPunchItemCount, stored.OpenPurchaseOrderCount,
		stored.OpenWarrantyTicketCount, stored.ActiveChildOrganizationCount,
	)))
	return &OrganizationOffboardingPreview{
		OrganizationID: org.ID, OrganizationVersion: org.Version,
		ImpactVersion: hex.EncodeToString(fingerprint[:]), Blockers: blockers, Warnings: []OffboardingImpact{},
	}, nil
}

func (s *OrganizationService) BeginOffboarding(ctx context.Context, cmd LifecycleCommand) (*domain.Organization, error) {
	return s.offboardingTransition(ctx, cmd, domain.OrganizationStatusOffboarding, "organization_offboarding_started", true)
}

func (s *OrganizationService) TerminateOrganization(ctx context.Context, cmd LifecycleCommand) (*domain.Organization, error) {
	return s.offboardingTransition(ctx, cmd, domain.OrganizationStatusTerminated, "organization_terminated", false)
}

func (s *OrganizationService) offboardingTransition(ctx context.Context, cmd LifecycleCommand, to domain.OrganizationStatus, event string, cutSupport bool) (*domain.Organization, error) {
	var result *domain.Organization
	err := s.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: cmd.OrganizationID, UserID: cmd.ActorUserID}, func(txCtx context.Context) error {
		org, err := s.store.GetOrganizationByID(txCtx, cmd.OrganizationID)
		if err != nil {
			return err
		}
		fromOK := to == domain.OrganizationStatusOffboarding && (org.Status == domain.OrganizationStatusActive || org.Status == domain.OrganizationStatusSuspended)
		fromOK = fromOK || (to == domain.OrganizationStatusTerminated &&
			(org.Status == domain.OrganizationStatusOffboarding || org.Status == domain.OrganizationStatusProvisioningFailed))
		if !fromOK || org.Version != cmd.ExpectedVersion {
			return ErrOrganizationStatusConflict
		}
		preview, err := s.PreviewOffboarding(txCtx, org.ID)
		if err != nil {
			return err
		}
		if cmd.ImpactVersion == "" || cmd.ImpactVersion != preview.ImpactVersion {
			return ErrOrganizationStatusConflict
		}
		if len(preview.Blockers) > 0 {
			return ErrOrganizationOffboardingBlocked
		}
		result, err = s.store.TransitionOrganizationStatus(txCtx, org.ID, org.Status, to, cmd.ActorUserID, strings.TrimSpace(cmd.Reason), cmd.ExpectedVersion)
		if err != nil {
			return mapOrganizationStatusError(err)
		}
		var ended int64
		if cutSupport {
			ended, err = s.store.EndOpenSupportSessionsByOrg(txCtx, org.ID, "org_offboarding")
			if err != nil {
				return err
			}
		}
		return s.auditLifecycle(txCtx, cmd, event, *org, *result, map[string]interface{}{"support_sessions_ended": ended, "impact_version": cmd.ImpactVersion})
	})
	return result, err
}

func (s *OrganizationService) transition(ctx context.Context, cmd LifecycleCommand, from, to domain.OrganizationStatus, event string, cutSupport, requireReady bool) (*domain.Organization, error) {
	var result *domain.Organization
	err := s.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: cmd.OrganizationID, UserID: cmd.ActorUserID}, func(txCtx context.Context) error {
		org, err := s.store.GetOrganizationByID(txCtx, cmd.OrganizationID)
		if err != nil {
			return err
		}
		if org.Status != from || org.Version != cmd.ExpectedVersion {
			return ErrOrganizationStatusConflict
		}
		if requireReady {
			readiness, err := s.evaluateReadiness(txCtx, *org, true)
			if err != nil || !readiness.Ready {
				return ErrOrganizationNotReady
			}
		}
		result, err = s.store.TransitionOrganizationStatus(txCtx, org.ID, from, to, cmd.ActorUserID, strings.TrimSpace(cmd.Reason), cmd.ExpectedVersion)
		if err != nil {
			return mapOrganizationStatusError(err)
		}
		var ended int64
		if cutSupport {
			ended, err = s.store.EndOpenSupportSessionsByOrg(txCtx, org.ID, "org_suspended")
			if err != nil {
				return err
			}
		}
		return s.auditLifecycle(txCtx, cmd, event, *org, *result, map[string]interface{}{"support_sessions_ended": ended})
	})
	return result, err
}

func (s *OrganizationService) auditLifecycle(ctx context.Context, cmd LifecycleCommand, event string, before, after domain.Organization, details map[string]interface{}) error {
	if details == nil {
		details = map[string]interface{}{}
	}
	details["from_status"] = string(before.Status)
	details["to_status"] = string(after.Status)
	details["from_version"] = before.Version
	details["to_version"] = after.Version
	details["credential_version"] = after.CredentialVersion
	details["reason"] = strings.TrimSpace(cmd.Reason)
	details["request_id"] = cmd.RequestID
	return s.store.InsertSecurityAuditEvent(ctx, storage.SecurityAuditEvent{EventType: event, ActorUserID: cmd.ActorUserID, OrganizationID: cmd.OrganizationID, IP: cmd.IP, Details: details})
}

func mapOrganizationStatusError(err error) error {
	if errors.Is(err, storage.ErrOrganizationStatusConflict) || errors.Is(err, storage.ErrVersionConflict) {
		return ErrOrganizationStatusConflict
	}
	return err
}
