package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func organizationApplicationStore(s Store) (application.OrganizationStore, bool) {
	store, ok := s.(application.OrganizationStore)
	return store, ok
}

func (s *Server) HandleProvisionOrganization(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	var body openapi.ProvisionOrganizationRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len([]rune(name)) > 120 {
		respondWithError(w, http.StatusBadRequest, "name inválido")
		return
	}
	orgType := domain.OrganizationType(body.Type)
	if !domain.IsValidOrganizationType(orgType) {
		respondWithError(w, http.StatusBadRequest, "type inválido")
		return
	}
	plan := domain.LicensePlan(body.LicensePlan)
	if !domain.IsValidLicensePlan(plan) {
		respondWithError(w, http.StatusBadRequest, "license_plan inválido")
		return
	}
	slug := slugifyOrgName(name)
	if body.Slug != nil {
		slug = strings.TrimSpace(*body.Slug)
	}
	if !validOrganizationSlug.MatchString(slug) {
		respondWithError(w, http.StatusBadRequest, "slug inválido")
		return
	}
	var expiresAt *time.Time
	if body.LicenseExpiresAt != nil {
		parsed, err := time.Parse(time.RFC3339, *body.LicenseExpiresAt)
		if err != nil {
			respondWithError(w, http.StatusBadRequest, "license_expires_at inválido")
			return
		}
		expiresAt = &parsed
	}

	cmd := application.ProvisionOrganizationCommand{
		ActorUserID: claims.UserID, ActorMembershipID: claims.MembershipID, Name: name, Slug: slug, Type: orgType,
		LicensePlan: plan, LicenseExpiresAt: expiresAt, AllowEmptyCatalog: true, IP: clientIP(r), RequestID: RequestIDFromContext(r.Context()),
	}
	if claims.PlatformAdmin && claims.OrgID == "" {
		if body.BootstrapAdminUserID == nil || strings.TrimSpace(*body.BootstrapAdminUserID) == "" {
			respondWithError(w, http.StatusBadRequest, "bootstrap_admin_user_id es obligatorio")
			return
		}
		cmd.BootstrapAdminUserID = strings.TrimSpace(*body.BootstrapAdminUserID)
		if body.CloneCatalogFrom != nil {
			source, err := s.resolveOrganizationReference(r, strings.TrimSpace(*body.CloneCatalogFrom))
			if err != nil {
				respondWithError(w, http.StatusBadRequest, "organización origen de clonación no encontrada")
				return
			}
			cmd.CloneCatalogFrom = source.ID
		}
		if body.Entitlements != nil {
			cmd.Entitlements = entitlementOverride(body.Entitlements)
		}
	} else {
		_, source, ok := s.requireFactoryAdmin(w, r)
		if !ok {
			return
		}
		if orgType != domain.OrganizationTypeStore && orgType != domain.OrganizationTypeDealer {
			respondWithError(w, http.StatusBadRequest, "una fábrica sólo puede provisionar store o dealer")
			return
		}
		if plan != domain.LicensePlanNone || body.Entitlements != nil || body.CloneCatalogFrom != nil || body.BootstrapAdminUserID != nil {
			respondWithError(w, http.StatusForbidden, "licencia, entitlements, catálogo y administrador son autoridad de la plataforma")
			return
		}
		cmd.BootstrapAdminUserID = claims.UserID
		cmd.ParentOrganizationID = &source.ID
		cmd.CloneCatalogFrom = source.ID
		cmd.AllowEmptyCatalog = false
	}
	store, ok := organizationApplicationStore(s.Store)
	if !ok {
		respondWithError(w, http.StatusServiceUnavailable, "organization provisioning is unavailable")
		return
	}
	result, err := application.NewOrganizationService(store).ProvisionOrganization(r.Context(), cmd)
	if err != nil {
		respondWithOrganizationCommandError(w, err)
		return
	}
	respondWithJSON(w, http.StatusCreated, openapi.OrganizationProvisioningResult{
		Organization: toPlatformOrgDTO(result.Organization, 1),
		Readiness:    toOrganizationReadiness(result.Readiness),
	})
}

func entitlementOverride(value *openapi.ProvisionOrganizationEntitlements) *domain.OrganizationEntitlements {
	if value == nil {
		return nil
	}
	return &domain.OrganizationEntitlements{
		MaxActiveMembers: value.MaxActiveMembers, MaxSalesPartners: value.MaxSalesPartners,
		ManufacturingEnabled: value.ManufacturingEnabled, SalesNetworkEnabled: value.SalesNetworkEnabled,
		SketchupSeats: value.SketchupSeats, AdvancedAuditEnabled: value.AdvancedAuditEnabled,
	}
}

func (s *Server) resolveOrganizationReference(r *http.Request, value string) (*domain.Organization, error) {
	if isValidUUID(value) {
		return s.Store.GetOrganizationByID(r.Context(), value)
	}
	return s.Store.GetOrganizationBySlug(r.Context(), value)
}

func toOrganizationReadiness(value application.OrganizationReadiness) openapi.OrganizationReadiness {
	checks := make([]openapi.OrganizationReadinessCheck, 0, len(value.Checks))
	for _, check := range value.Checks {
		checks = append(checks, openapi.OrganizationReadinessCheck{
			Code: check.Code, Ready: check.Ready, Blocking: check.Blocking, Message: check.Message,
		})
	}
	return openapi.OrganizationReadiness{
		OrganizationID: value.OrganizationID, OrganizationVersion: value.OrganizationVersion,
		Ready: value.Ready, Checks: checks, CheckedAt: value.CheckedAt.Format(time.RFC3339Nano),
	}
}

func respondWithOrganizationCommandError(w http.ResponseWriter, err error) {
	var pgErr *pgconn.PgError
	switch {
	case errors.Is(err, application.ErrInvalidOrganizationCommand):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "El comando de organización es inválido", nil)
	case errors.Is(err, application.ErrOrganizationNotReady):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeOrganizationNotReady, "La organización no está lista", nil)
	case errors.Is(err, application.ErrOrganizationStatusConflict):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeOrganizationStatusConflict, "La transición de estado ya no es válida", nil)
	case errors.Is(err, application.ErrOrganizationOffboardingBlocked):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeOrganizationOffboardingBlocked, "La organización tiene trabajo abierto", nil)
	case errors.As(err, &pgErr) && pgErr.Code == "23505" && (pgErr.ConstraintName == "organizations_slug_key" || strings.Contains(pgErr.ConstraintName, "slug")):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeOrganizationSlugConflict, "El slug ya está en uso", nil)
	case errors.Is(err, storage.ErrVersionConflict):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeVersionConflict, "La organización cambió; actualizá e intentá de nuevo", nil)
	default:
		respondWithInternalError(w, err, "organization command")
	}
}

func (s *Server) organizationService(w http.ResponseWriter) (*application.OrganizationService, bool) {
	store, ok := organizationApplicationStore(s.Store)
	if !ok {
		respondWithError(w, http.StatusServiceUnavailable, "organization lifecycle is unavailable")
		return nil, false
	}
	return application.NewOrganizationService(store), true
}

func (s *Server) HandleOrganizationReadiness(w http.ResponseWriter, r *http.Request) {
	service, ok := s.organizationService(w)
	if !ok {
		return
	}
	readiness, err := service.GetReadiness(r.Context(), r.PathValue("id"), claimsFromRequest(r).UserID)
	if err != nil {
		respondWithOrganizationCommandError(w, err)
		return
	}
	w.Header().Set("ETag", FormatVersionETag(readiness.OrganizationVersion))
	respondWithJSON(w, http.StatusOK, toOrganizationReadiness(readiness))
}

func (s *Server) HandleOrganizationLifecycleCommand(w http.ResponseWriter, r *http.Request) {
	service, ok := s.organizationService(w)
	if !ok {
		return
	}
	expectedVersion, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	command := r.PathValue("command")
	claims := claimsFromRequest(r)
	cmd := application.LifecycleCommand{
		OrganizationID: r.PathValue("id"), ActorUserID: claims.UserID,
		ExpectedVersion: expectedVersion, IP: clientIP(r), RequestID: RequestIDFromContext(r.Context()),
	}
	if command == "begin-offboarding" || command == "terminate" {
		var body openapi.OrganizationOffboardingMutationRequest
		if !decodeGeneratedJSONBody(w, r, &body) {
			return
		}
		cmd.Reason, cmd.ImpactVersion = strings.TrimSpace(body.Reason), strings.TrimSpace(body.ImpactVersion)
	} else {
		var body openapi.OrganizationLifecycleMutationRequest
		if !decodeGeneratedJSONBody(w, r, &body) {
			return
		}
		cmd.Reason = strings.TrimSpace(body.Reason)
	}
	if cmd.Reason == "" {
		respondWithError(w, http.StatusBadRequest, "reason es obligatorio")
		return
	}
	var organization *domain.Organization
	var readiness *application.OrganizationReadiness
	var err error
	switch command {
	case "suspend":
		organization, err = service.SuspendOrganization(r.Context(), cmd)
	case "reactivate":
		var value application.OrganizationReadiness
		organization, value, err = service.ReactivateOrganization(r.Context(), cmd)
		readiness = &value
	case "begin-offboarding":
		organization, err = service.BeginOffboarding(r.Context(), cmd)
	case "terminate":
		organization, err = service.TerminateOrganization(r.Context(), cmd)
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		respondWithOrganizationCommandError(w, err)
		return
	}
	memberCount := 0
	if members, listErr := s.Store.ListOrgTeam(r.Context(), organization.ID, claims.UserID); listErr == nil {
		memberCount = len(members)
	}
	response := openapi.OrganizationLifecycleMutationResponse{Organization: toPlatformOrgDTO(*organization, memberCount)}
	if readiness != nil {
		value := toOrganizationReadiness(*readiness)
		response.Readiness = &value
	}
	w.Header().Set("ETag", FormatVersionETag(organization.Version))
	respondWithJSON(w, http.StatusOK, response)
}

func (s *Server) HandleOrganizationOffboardingPreview(w http.ResponseWriter, r *http.Request) {
	service, ok := s.organizationService(w)
	if !ok {
		return
	}
	ctx := r.Context()
	if setter, ok := s.Store.(tenantActorSetter); ok {
		claims := claimsFromRequest(r)
		var err error
		ctx, err = setter.SetTenantActor(ctx, storage.TenantActor{
			UserID:                    claims.UserID,
			AuthorizedOrganizationIDs: []string{r.PathValue("id")},
		})
		if err != nil {
			respondWithOrganizationCommandError(w, err)
			return
		}
	}
	preview, err := service.PreviewOffboarding(ctx, r.PathValue("id"))
	if err != nil {
		respondWithOrganizationCommandError(w, err)
		return
	}
	blockers := make([]openapi.OrganizationOffboardingImpact, 0, len(preview.Blockers))
	for _, impact := range preview.Blockers {
		blockers = append(blockers, openapi.OrganizationOffboardingImpact{Code: impact.Code, Count: impact.Count, Message: impact.Message})
	}
	warnings := make([]openapi.OrganizationOffboardingImpact, 0, len(preview.Warnings))
	for _, impact := range preview.Warnings {
		warnings = append(warnings, openapi.OrganizationOffboardingImpact{Code: impact.Code, Count: impact.Count, Message: impact.Message})
	}
	w.Header().Set("ETag", FormatVersionETag(preview.OrganizationVersion))
	respondWithJSON(w, http.StatusOK, openapi.OrganizationOffboardingPreview{
		OrganizationID: preview.OrganizationID, OrganizationVersion: preview.OrganizationVersion,
		ImpactVersion: preview.ImpactVersion, Blockers: blockers, Warnings: warnings,
	})
}

func (s *Server) HandleOrganizationEntitlements(w http.ResponseWriter, r *http.Request) {
	service, ok := s.organizationService(w)
	if !ok {
		return
	}
	organizationID := r.PathValue("id")
	if r.Method == http.MethodGet {
		value, err := service.GetEntitlements(r.Context(), organizationID)
		if err != nil {
			respondWithOrganizationCommandError(w, err)
			return
		}
		w.Header().Set("ETag", FormatVersionETag(value.Version))
		respondWithJSON(w, http.StatusOK, toOpenAPIOrganizationEntitlements(*value))
		return
	}
	expectedVersion, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	var body openapi.UpdateOrganizationEntitlementsRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	value := domain.OrganizationEntitlements{
		MaxActiveMembers: body.MaxActiveMembers, MaxSalesPartners: body.MaxSalesPartners,
		ManufacturingEnabled: body.ManufacturingEnabled, SalesNetworkEnabled: body.SalesNetworkEnabled,
		SketchupSeats: body.SketchupSeats, AdvancedAuditEnabled: body.AdvancedAuditEnabled,
	}
	result, err := service.UpdateEntitlements(r.Context(), application.LifecycleCommand{
		OrganizationID: organizationID, ActorUserID: claimsFromRequest(r).UserID,
		ExpectedVersion: expectedVersion, IP: clientIP(r), RequestID: RequestIDFromContext(r.Context()),
	}, value)
	if err != nil {
		respondWithOrganizationCommandError(w, err)
		return
	}
	w.Header().Set("ETag", FormatVersionETag(result.Version))
	respondWithJSON(w, http.StatusOK, toOpenAPIOrganizationEntitlements(*result))
}

func toOpenAPIOrganizationEntitlements(value domain.OrganizationEntitlements) openapi.OrganizationEntitlements {
	return openapi.OrganizationEntitlements{
		OrganizationID: value.OrganizationID, MaxActiveMembers: value.MaxActiveMembers,
		MaxSalesPartners: value.MaxSalesPartners, ManufacturingEnabled: value.ManufacturingEnabled,
		SalesNetworkEnabled: value.SalesNetworkEnabled, SketchupSeats: value.SketchupSeats,
		AdvancedAuditEnabled: value.AdvancedAuditEnabled,
		Source:               openapi.OrganizationEntitlementSource(value.Source), DefaultsRevision: value.DefaultsRevision,
		Version: value.Version, UpdatedAt: value.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}
