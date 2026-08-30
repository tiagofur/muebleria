package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func (s *Server) requireOrgAdmin(w http.ResponseWriter, r *http.Request) (*auth.Claims, *domain.Organization, bool) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.OrgID == "" {
		respondWithError(w, http.StatusForbidden, "necesitás sesión en un taller")
		return nil, nil, false
	}
	if !domain.AnyRole(actorRoles(claims), func(r domain.UserRole) bool { return r == domain.RoleAdmin }) {
		respondWithError(w, http.StatusForbidden, "solo el administrador del taller puede gestionar el equipo")
		return nil, nil, false
	}
	org, err := s.Store.GetOrganizationByID(r.Context(), claims.OrgID)
	if err != nil || org == nil || !org.Active {
		respondWithError(w, http.StatusNotFound, "organización no encontrada")
		return nil, nil, false
	}
	return claims, org, true
}

func (s *Server) requireOrgTeamCapability(w http.ResponseWriter, r *http.Request, capability domain.TeamCapability) (*auth.Claims, *domain.Organization, bool) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.OrgID == "" {
		respondWithError(w, http.StatusForbidden, "necesitás sesión en un taller")
		return nil, nil, false
	}
	if claims.Support != nil && capability != domain.TeamCapabilityView {
		respondWithError(w, http.StatusForbidden, "la sesión de soporte sólo puede consultar Team")
		return nil, nil, false
	}
	org, err := s.Store.GetOrganizationByID(r.Context(), claims.OrgID)
	if err != nil || org == nil || !org.Active {
		respondWithError(w, http.StatusNotFound, "organización no encontrada")
		return nil, nil, false
	}
	if !domain.HasTeamCapability(actorRoles(claims), org.Type, capability) {
		respondWithError(w, http.StatusForbidden, "no tenés permiso para esta acción de Team")
		return nil, nil, false
	}
	return claims, org, true
}

func (s *Server) requireOrgTeamMutation(w http.ResponseWriter, r *http.Request) (*auth.Claims, *domain.Organization, bool) {
	claims, org, ok := s.requireOrgTeamCapability(w, r, domain.TeamCapabilityView)
	if !ok {
		return nil, nil, false
	}
	if claims.Support != nil {
		respondWithError(w, http.StatusForbidden, "la sesión de soporte sólo puede consultar Team")
		return nil, nil, false
	}
	return claims, org, true
}

func teamRoleSetIsManageable(actorRoles, targetRoles []domain.UserRole, orgType domain.OrganizationType) bool {
	if domain.HasTeamCapability(actorRoles, orgType, domain.TeamCapabilityManageAll) {
		return true
	}
	for _, targetRole := range targetRoles {
		switch targetRole {
		case domain.RoleVendedor:
			if !domain.HasTeamCapability(actorRoles, orgType, domain.TeamCapabilityManageSales) {
				return false
			}
		case domain.RoleProduccion, domain.RoleAlmacen:
			if !domain.HasTeamCapability(actorRoles, orgType, domain.TeamCapabilityManageProduction) {
				return false
			}
		default:
			return false
		}
	}
	return len(targetRoles) > 0
}

func teamRoleSetIsInvitable(actorRoles, targetRoles []domain.UserRole, orgType domain.OrganizationType) bool {
	if domain.HasTeamCapability(actorRoles, orgType, domain.TeamCapabilityManageAll) {
		return len(targetRoles) > 0
	}
	for _, targetRole := range targetRoles {
		switch targetRole {
		case domain.RoleVendedor:
			if !domain.HasTeamCapability(actorRoles, orgType, domain.TeamCapabilityInviteSales) {
				return false
			}
		case domain.RoleProduccion, domain.RoleAlmacen:
			if !domain.HasTeamCapability(actorRoles, orgType, domain.TeamCapabilityInviteProduction) {
				return false
			}
		default:
			return false
		}
	}
	return len(targetRoles) > 0
}

func (s *Server) teamMutationTarget(w http.ResponseWriter, r *http.Request, claims *auth.Claims, org *domain.Organization, desiredRoles []domain.UserRole) (*storage.OrgTeamMember, bool) {
	team, err := s.Store.ListOrgTeam(r.Context(), claims.OrgID, claims.UserID)
	if err != nil {
		respondWithInternalError(w, err, "org team target")
		return nil, false
	}
	for i := range team {
		target := &team[i]
		if target.MembershipID != r.PathValue("membershipId") {
			continue
		}
		if target.UserID == claims.UserID {
			respondWithError(w, http.StatusForbidden, "no podés modificar tu propia membresía")
			return nil, false
		}
		if !teamRoleSetIsManageable(actorRoles(claims), target.Roles, org.Type) {
			respondWithError(w, http.StatusForbidden, "no tenés permiso para gestionar los roles actuales de esta membresía")
			return nil, false
		}
		if desiredRoles != nil {
			if !teamRoleSetIsManageable(actorRoles(claims), desiredRoles, org.Type) {
				respondWithError(w, http.StatusForbidden, "no tenés permiso para asignar esos roles")
				return nil, false
			}
			if containsRole(desiredRoles, domain.RoleAdmin) && !domain.HasTeamCapability(actorRoles(claims), org.Type, domain.TeamCapabilityAssignAdmin) {
				respondWithError(w, http.StatusForbidden, "no tenés permiso para asignar administradores")
				return nil, false
			}
		}
		return target, true
	}
	respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeMembershipNotFound, "membresía no encontrada", nil)
	return nil, false
}

func containsRole(roles []domain.UserRole, wanted domain.UserRole) bool {
	for _, role := range roles {
		if role == wanted {
			return true
		}
	}
	return false
}

func teamMemberToOpenAPI(m storage.OrgTeamMember) openapi.TeamMember {
	sectors := make([]openapi.ProductionSector, len(m.Sectors))
	for i, sector := range m.Sectors {
		sectors[i] = openapi.ProductionSector(sector)
	}
	out := openapi.TeamMember{
		MembershipID: m.MembershipID, UserID: m.UserID, Email: m.Email, Name: m.Name,
		AccountStatus: openapi.AccountStatus(m.AccountStatus), MembershipStatus: openapi.MembershipStatus(m.Status),
		Roles: roleStrings(m.Roles), JoinedAt: m.JoinedAt.UTC().Format(time.RFC3339Nano), Version: m.Version,
		CredentialVersion: m.CredentialVersion, Sectors: sectors, OffboardingBlockingCount: m.OffboardingBlockingCount,
	}
	if m.LastActivity != nil {
		value := m.LastActivity.UTC().Format(time.RFC3339Nano)
		out.LastActivity = &value
	}
	if m.SessionsRevokedAt != nil {
		value := m.SessionsRevokedAt.UTC().Format(time.RFC3339Nano)
		out.SessionsRevokedAt = &value
	}
	return out
}

func teamSummaryToOpenAPI(summary storage.OrgTeamSummary, claims *auth.Claims, org *domain.Organization) openapi.TeamSummary {
	capabilities := domain.TeamCapabilitiesForRoles(actorRoles(claims), org.Type)
	out := make([]openapi.TeamCapability, len(capabilities))
	for i, capability := range capabilities {
		out[i] = openapi.TeamCapability(capability)
	}
	return openapi.TeamSummary{
		ActiveMembers: summary.ActiveMembers, SuspendedMembers: summary.SuspendedMembers, LeftMembers: summary.LeftMembers,
		MaxActiveMembers: summary.MaxActiveMembers, TeamVersion: summary.TeamVersion,
		EntitlementsVersion: summary.EntitlementsVersion, Capabilities: out,
	}
}

func (s *Server) orgTeamSummary(w http.ResponseWriter, r *http.Request) (*auth.Claims, *domain.Organization, openapi.TeamSummary, bool) {
	claims, org, ok := s.requireOrgTeamCapability(w, r, domain.TeamCapabilityView)
	if !ok {
		return nil, nil, openapi.TeamSummary{}, false
	}
	summary, err := s.Store.GetOrgTeamSummary(r.Context(), claims.OrgID, claims.UserID)
	if err != nil {
		respondWithInternalError(w, err, "org team summary")
		return nil, nil, openapi.TeamSummary{}, false
	}
	return claims, org, teamSummaryToOpenAPI(*summary, claims, org), true
}

func (s *Server) HandleOrgTeam(w http.ResponseWriter, r *http.Request) {
	claims, _, summary, ok := s.orgTeamSummary(w, r)
	if !ok {
		return
	}
	team, err := s.Store.ListOrgTeam(r.Context(), claims.OrgID, claims.UserID)
	if err != nil {
		respondWithInternalError(w, err, "org team")
		return
	}
	out := make([]openapi.TeamMember, len(team))
	for i, m := range team {
		out[i] = teamMemberToOpenAPI(m)
	}
	respondWithJSON(w, http.StatusOK, openapi.TeamDirectory{Items: out, Summary: summary})
}

func (s *Server) HandleOrgTeamSummary(w http.ResponseWriter, r *http.Request) {
	_, _, summary, ok := s.orgTeamSummary(w, r)
	if !ok {
		return
	}
	respondWithJSON(w, http.StatusOK, summary)
}

func (s *Server) HandleOrgTeamMember(w http.ResponseWriter, r *http.Request) {
	claims, _, ok := s.requireOrgTeamCapability(w, r, domain.TeamCapabilityView)
	if !ok {
		return
	}
	team, err := s.Store.ListOrgTeam(r.Context(), claims.OrgID, claims.UserID)
	if err != nil {
		respondWithInternalError(w, err, "org team member")
		return
	}
	for _, member := range team {
		if member.MembershipID == r.PathValue("membershipId") {
			w.Header().Set("ETag", FormatVersionETag(member.Version))
			respondWithJSON(w, http.StatusOK, teamMemberToOpenAPI(member))
			return
		}
	}
	respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeMembershipNotFound, "membresía no encontrada", nil)
}

func (s *Server) HandleOrgMemberRoles(w http.ResponseWriter, r *http.Request) {
	var body openapi.UpdateMemberRolesRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	s.changeMembershipRoles(w, r, body.Roles)
}

// HandleChangeMembershipRoles is the canonical command route. The legacy PUT
// route remains temporarily for existing clients and delegates to the same flow.
func (s *Server) HandleChangeMembershipRoles(w http.ResponseWriter, r *http.Request) {
	var body openapi.ChangeMembershipRolesRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	s.changeMembershipRoles(w, r, body.Roles)
}

func (s *Server) changeMembershipRoles(w http.ResponseWriter, r *http.Request, requestedRoles []string) {
	claims, org, ok := s.requireOrgTeamMutation(w, r)
	if !ok {
		return
	}
	expected, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	roles := make([]domain.UserRole, len(requestedRoles))
	for i, v := range requestedRoles {
		roles[i] = domain.UserRole(v)
	}
	if !domain.RolesAllowedInOrg(roles, org.Type) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeRoleNotAllowed, "roles inválidos para este tipo de taller", nil)
		return
	}
	target, ok := s.teamMutationTarget(w, r, claims, org, roles)
	if !ok {
		return
	}
	member, err := s.Store.UpdateMembershipRolesByOrg(r.Context(), claims.OrgID, r.PathValue("membershipId"), roles, expected)
	if membershipMutationError(w, err) {
		return
	}
	if err := s.auditRequired(r.Context(), "membership_roles_changed", claims.UserID, claims.OrgID, clientIP(r), map[string]interface{}{
		"target_membership_id": member.MembershipID,
		"target_user_id":       member.UserID,
		"before":               map[string]interface{}{"roles": roleStrings(target.Roles), "version": target.Version},
		"after":                map[string]interface{}{"roles": roleStrings(member.Roles), "version": member.Version},
	}); err != nil {
		respondWithInternalError(w, err, "audit membership roles")
		return
	}
	w.Header().Set("ETag", FormatVersionETag(member.Version))
	respondWithJSON(w, http.StatusOK, membershipMutationResponse(*member))
}

func (s *Server) HandleOrgMemberStatus(w http.ResponseWriter, r *http.Request) {
	var body openapi.UpdateMembershipStatusRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	s.changeMembershipStatus(w, r, domain.MembershipStatus(body.Status), body.Reason)
}

// HandleSuspendMembership is the canonical command route. Its request cannot
// smuggle a lifecycle status different from suspension.
func (s *Server) HandleSuspendMembership(w http.ResponseWriter, r *http.Request) {
	var body openapi.SuspendMembershipRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	s.changeMembershipStatus(w, r, domain.MembershipStatusSuspended, &body.Reason)
}

// HandleReactivateMembership is the canonical command route. It intentionally
// has no request body because reactivation has no client-controlled fields.
func (s *Server) HandleReactivateMembership(w http.ResponseWriter, r *http.Request) {
	s.changeMembershipStatus(w, r, domain.MembershipStatusActive, nil)
}

func (s *Server) changeMembershipStatus(w http.ResponseWriter, r *http.Request, status domain.MembershipStatus, bodyReason *string) {
	claims, org, ok := s.requireOrgTeamMutation(w, r)
	if !ok {
		return
	}
	expected, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	reason := ""
	if bodyReason != nil {
		reason = strings.TrimSpace(*bodyReason)
	}
	if status != domain.MembershipStatusActive && status != domain.MembershipStatusSuspended {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "el offboarding de membresías queda reservado para el flujo de Team", nil)
		return
	}
	if status == domain.MembershipStatusSuspended && reason == "" {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "reason es obligatorio para suspender una membresía", nil)
		return
	}
	target, ok := s.teamMutationTarget(w, r, claims, org, nil)
	if !ok {
		return
	}
	member, err := s.Store.UpdateMembershipStatus(r.Context(), claims.OrgID, r.PathValue("membershipId"), status, reason, claims.UserID, expected)
	if membershipMutationError(w, err) {
		return
	}
	event := "membership_reactivated"
	if status == domain.MembershipStatusSuspended {
		event = "membership_suspended"
	}
	if err := s.auditRequired(r.Context(), event, claims.UserID, claims.OrgID, clientIP(r), map[string]interface{}{
		"target_membership_id": member.MembershipID,
		"target_user_id":       member.UserID,
		"reason":               reason,
		"before":               map[string]interface{}{"status": target.Status, "version": target.Version},
		"after":                map[string]interface{}{"status": member.Status, "version": member.Version},
	}); err != nil {
		respondWithInternalError(w, err, "audit membership status")
		return
	}
	w.Header().Set("ETag", FormatVersionETag(member.Version))
	respondWithJSON(w, http.StatusOK, membershipMutationResponse(*member))
}

// HandleRevokeMembershipSessions invalidates the target membership's token
// generation without changing membership lifecycle or roles.
func (s *Server) HandleRevokeMembershipSessions(w http.ResponseWriter, r *http.Request) {
	claims, org, ok := s.requireOrgTeamCapability(w, r, domain.TeamCapabilityRevokeSessions)
	if !ok {
		return
	}
	if claims.Support != nil {
		respondWithError(w, http.StatusForbidden, "la sesión de soporte sólo puede consultar Team")
		return
	}
	expected, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	var body openapi.RevokeMembershipSessionsRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	reason := strings.TrimSpace(body.Reason)
	if reason == "" {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "reason es obligatorio para revocar sesiones", nil)
		return
	}
	target, ok := s.teamMutationTarget(w, r, claims, org, nil)
	if !ok {
		return
	}
	member, err := s.Store.RevokeMembershipSessions(r.Context(), claims.OrgID, r.PathValue("membershipId"), claims.UserID, reason, expected)
	if membershipMutationError(w, err) {
		return
	}
	if err := s.auditRequired(r.Context(), "membership_sessions_revoked", claims.UserID, claims.OrgID, clientIP(r), map[string]interface{}{
		"target_membership_id": member.MembershipID,
		"target_user_id":       member.UserID,
		"reason":               reason,
		"before":               map[string]interface{}{"version": target.Version},
		"after":                map[string]interface{}{"version": member.Version},
	}); err != nil {
		respondWithInternalError(w, err, "audit membership session revocation")
		return
	}
	w.Header().Set("ETag", FormatVersionETag(member.Version))
	respondWithJSON(w, http.StatusOK, membershipMutationResponse(*member))
}

// HandleMembershipOffboardingPreview returns the authoritative responsibility
// inventory used by the later offboarding command. It intentionally performs
// no lifecycle transition or reassignment.
func (s *Server) HandleMembershipOffboardingPreview(w http.ResponseWriter, r *http.Request) {
	claims, org, ok := s.requireOrgTeamMutation(w, r)
	if !ok {
		return
	}
	expected, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	target, ok := s.teamMutationTarget(w, r, claims, org, nil)
	if !ok {
		return
	}
	if target.Version != expected {
		respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeMembershipVersionConflict, "La membresía fue modificada por otra sesión", nil)
		return
	}
	store, ok := s.Store.(interface {
		GetMembershipOffboardingImpact(context.Context, string, string, string) (*storage.MembershipResponsibilityInventory, int64, string, error)
	})
	if !ok {
		respondWithAPIError(w, http.StatusServiceUnavailable, openapi.ApiErrorCodeInternalError, "El command store de offboarding no está disponible", nil)
		return
	}
	inventory, membershipVersion, impactVersion, err := store.GetMembershipOffboardingImpact(r.Context(), claims.OrgID, target.MembershipID, claims.UserID)
	if errors.Is(err, storage.ErrMembershipNotFound) {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeMembershipNotFound, "membresía no encontrada", nil)
		return
	}
	if err != nil {
		respondWithInternalError(w, err, "membership offboarding preview")
		return
	}
	if membershipVersion != expected {
		respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeMembershipVersionConflict, "La membresía fue modificada por otra sesión", nil)
		return
	}
	preview := membershipOffboardingPreviewToOpenAPI(*inventory, membershipVersion, impactVersion)
	if err := s.auditRequired(r.Context(), "membership_offboarding_previewed", claims.UserID, claims.OrgID, clientIP(r), map[string]interface{}{
		"membership_id": target.MembershipID, "impact_version": preview.ImpactVersion,
		"transfer_required_count": preview.Inventory.TransferRequiredCount, "blocking_count": preview.Inventory.BlockingCount,
	}); err != nil {
		respondWithInternalError(w, err, "audit membership offboarding preview")
		return
	}
	w.Header().Set("ETag", FormatVersionETag(target.Version))
	respondWithJSON(w, http.StatusOK, preview)
}

func membershipOffboardingPreviewToOpenAPI(inventory storage.MembershipResponsibilityInventory, membershipVersion int64, impactVersion string) openapi.MembershipOffboardingPreview {
	return openapi.MembershipOffboardingPreview{
		MembershipID: inventory.MembershipID, MembershipVersion: membershipVersion, ImpactVersion: impactVersion,
		Inventory: openapi.MembershipResponsibilityInventory{
			CustomerOwnershipCount: int64(inventory.CustomerOwnershipCount), SalesProjectOwnershipCount: int64(inventory.SalesProjectOwnershipCount),
			EngineerAssignmentCount: int64(inventory.EngineerAssignmentCount), OpenWarrantyAssignmentCount: int64(inventory.OpenWarrantyAssignmentCount),
			ActiveProductionClaimCount: int64(inventory.ActiveProductionClaimCount), TransferRequiredCount: int64(inventory.TransferRequiredCount()), BlockingCount: int64(inventory.BlockingCount()),
		},
	}
}

func membershipInventoryToOpenAPI(inventory storage.MembershipResponsibilityInventory) openapi.MembershipResponsibilityInventory {
	return openapi.MembershipResponsibilityInventory{
		CustomerOwnershipCount: int64(inventory.CustomerOwnershipCount), SalesProjectOwnershipCount: int64(inventory.SalesProjectOwnershipCount),
		EngineerAssignmentCount: int64(inventory.EngineerAssignmentCount), OpenWarrantyAssignmentCount: int64(inventory.OpenWarrantyAssignmentCount),
		ActiveProductionClaimCount: int64(inventory.ActiveProductionClaimCount), TransferRequiredCount: int64(inventory.TransferRequiredCount()), BlockingCount: int64(inventory.BlockingCount()),
	}
}

func (s *Server) HandleTransferOrganizationAdmin(w http.ResponseWriter, r *http.Request) {
	claims, org, ok := s.requireOrgTeamCapability(w, r, domain.TeamCapabilityTransferAdmin)
	if !ok {
		return
	}
	expectedSource, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	var body openapi.TransferOrganizationAdminRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	if body.Reason == "" || body.TargetMembershipID == "" || body.TargetVersion < 1 {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeAdminTransferInvalid, "transferencia de administración inválida", nil)
		return
	}
	if !domain.HasTeamCapability(actorRoles(claims), org.Type, domain.TeamCapabilityAssignAdmin) {
		respondWithError(w, http.StatusForbidden, "no tenés permiso para asignar administradores")
		return
	}
	store, ok := s.Store.(interface {
		TransferOrganizationAdmin(context.Context, storage.TransferOrganizationAdminCommand) (*storage.AdminTransferResult, error)
	})
	if !ok {
		respondWithAPIError(w, http.StatusServiceUnavailable, openapi.ApiErrorCodeInternalError, "El command store de Team no está disponible", nil)
		return
	}
	result, err := store.TransferOrganizationAdmin(r.Context(), storage.TransferOrganizationAdminCommand{
		OrganizationID: claims.OrgID, ActorUserID: claims.UserID, SourceMembershipID: r.PathValue("membershipId"), TargetMembershipID: body.TargetMembershipID,
		ExpectedSourceVersion: expectedSource, ExpectedTargetVersion: body.TargetVersion, DemoteSource: body.DemoteSource, Reason: body.Reason,
		RequestID: RequestIDFromContext(r.Context()), IP: clientIP(r),
	})
	if teamCommandError(w, err) {
		return
	}
	w.Header().Set("ETag", FormatVersionETag(result.Source.Version))
	respondWithJSON(w, http.StatusOK, openapi.AdminTransferResponse{Source: membershipMutationResponse(*result.Source), Target: membershipMutationResponse(*result.Target)})
}

func (s *Server) HandleChangeMembershipSectors(w http.ResponseWriter, r *http.Request) {
	claims, org, ok := s.requireOrgTeamCapability(w, r, domain.TeamCapabilityManageSectors)
	if !ok {
		return
	}
	expected, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	var body openapi.ChangeMembershipSectorsRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	if _, ok := s.teamMutationTarget(w, r, claims, org, nil); !ok {
		return
	}
	sectors := make([]domain.ProductionSector, len(body.Sectors))
	for i, sector := range body.Sectors {
		sectors[i] = domain.ProductionSector(sector)
	}
	store, ok := s.Store.(interface {
		ChangeMembershipSectors(context.Context, storage.ChangeMembershipSectorsCommand) (*storage.MembershipSectorChangeResult, error)
	})
	if !ok {
		respondWithAPIError(w, http.StatusServiceUnavailable, openapi.ApiErrorCodeInternalError, "El command store de Team no está disponible", nil)
		return
	}
	result, err := store.ChangeMembershipSectors(r.Context(), storage.ChangeMembershipSectorsCommand{
		OrganizationID: claims.OrgID, ActorUserID: claims.UserID, MembershipID: r.PathValue("membershipId"), ExpectedMembershipVersion: expected,
		Sectors: sectors, Reason: strings.TrimSpace(body.Reason), RequestID: RequestIDFromContext(r.Context()), IP: clientIP(r),
	})
	if teamCommandError(w, err) {
		return
	}
	outSectors := make([]openapi.ProductionSector, len(result.Sectors))
	for i, sector := range result.Sectors {
		outSectors[i] = openapi.ProductionSector(sector)
	}
	w.Header().Set("ETag", FormatVersionETag(result.Member.Version))
	respondWithJSON(w, http.StatusOK, openapi.MembershipSectorMutationResponse{Member: membershipMutationResponse(result.Member), Sectors: outSectors})
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (s *Server) HandleOffboardMembership(w http.ResponseWriter, r *http.Request) {
	claims, org, ok := s.requireOrgTeamMutation(w, r)
	if !ok {
		return
	}
	expected, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	var body openapi.OffboardMembershipRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	if _, ok := s.teamMutationTarget(w, r, claims, org, nil); !ok {
		return
	}
	store, ok := s.Store.(interface {
		OffboardMember(context.Context, storage.OffboardMemberCommand) (*storage.OffboardMemberResult, error)
	})
	if !ok {
		respondWithAPIError(w, http.StatusServiceUnavailable, openapi.ApiErrorCodeInternalError, "El command store de Team no está disponible", nil)
		return
	}
	result, err := store.OffboardMember(r.Context(), storage.OffboardMemberCommand{
		OrganizationID: claims.OrgID, ActorUserID: claims.UserID, MembershipID: r.PathValue("membershipId"), ExpectedMembershipVersion: expected,
		ExpectedImpactVersion: body.ImpactVersion, Reason: strings.TrimSpace(body.Reason), RequestID: RequestIDFromContext(r.Context()), IP: clientIP(r),
		Plan: storage.MembershipReassignmentPlan{CustomerOwnerMembershipID: valueOrEmpty(body.Reassignment.CustomerOwnerMembershipID), SalesProjectOwnerMembershipID: valueOrEmpty(body.Reassignment.SalesProjectOwnerMembershipID), EngineerMembershipID: valueOrEmpty(body.Reassignment.EngineerMembershipID), WarrantyTechnicianMembershipID: valueOrEmpty(body.Reassignment.WarrantyTechnicianMembershipID)},
	})
	if teamCommandError(w, err) {
		return
	}
	w.Header().Set("ETag", FormatVersionETag(result.Member.Version))
	respondWithJSON(w, http.StatusOK, openapi.OffboardMembershipResponse{Member: membershipMutationResponse(result.Member), Inventory: membershipInventoryToOpenAPI(result.Inventory)})
}

func teamCommandError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	if membershipMutationErrorWithoutInternal(w, err) {
		return true
	}
	switch {
	case errors.Is(err, storage.ErrAdminTransferInvalid):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeAdminTransferInvalid, "transferencia de administración inválida", nil)
	case errors.Is(err, storage.ErrSectorAssignmentInvalid):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeSectorNotAllowed, "los sectores no son compatibles con la membresía", nil)
	case errors.Is(err, storage.ErrImpactVersionConflict):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeImpactVersionConflict, "las responsabilidades cambiaron; generá un nuevo preview", nil)
	case errors.Is(err, storage.ErrReassignmentInvalid):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeReassignmentRequired, "el plan de reasignación está incompleto o no es válido", nil)
	case errors.Is(err, storage.ErrOffboardingBlocked):
		details := map[string]any{}
		var blocked *storage.OffboardingBlockedError
		if errors.As(err, &blocked) {
			details["inventory"] = membershipInventoryToOpenAPI(blocked.Inventory)
		}
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeOffboardingBlocked, "la membresía conserva trabajo activo que bloquea el offboarding", details)
	default:
		respondWithInternalError(w, err, "team command")
	}
	return true
}

func membershipMutationErrorWithoutInternal(w http.ResponseWriter, err error) bool {
	if errors.Is(err, storage.ErrVersionConflict) {
		respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeMembershipVersionConflict, "La membresía fue modificada por otra sesión", nil)
		return true
	}
	if errors.Is(err, storage.ErrMembershipNotFound) {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeMembershipNotFound, "membresía no encontrada", nil)
		return true
	}
	return respondWithTeamInvariantError(w, err)
}

func membershipMutationError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, storage.ErrVersionConflict) {
		respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeMembershipVersionConflict, "La membresía fue modificada por otra sesión", nil)
		return true
	}
	if errors.Is(err, storage.ErrMembershipNotFound) {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeMembershipNotFound, "membresía no encontrada", nil)
		return true
	}
	if errors.Is(err, storage.ErrSectorAssignmentInvalid) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeSectorNotAllowed, "quitá o corregí los sectores incompatibles antes de cambiar roles", nil)
		return true
	}
	if respondWithTeamInvariantError(w, err) {
		return true
	}
	respondWithInternalError(w, err, "membership mutation")
	return true
}

const (
	organizationRequiresActiveAdminConstraint   = "organization_requires_active_admin"
	organizationActiveMemberSeatLimitConstraint = "organization_active_member_seat_limit"
)

// respondWithTeamInvariantError translates only named Postgres constraints.
// Constraint identity survives driver wrapping; error text does not.
func respondWithTeamInvariantError(w http.ResponseWriter, err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
		return false
	}
	switch pgErr.ConstraintName {
	case organizationRequiresActiveAdminConstraint:
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeLastAdmin, "la organización activa debe conservar al menos un administrador", nil)
		return true
	case organizationActiveMemberSeatLimitConstraint:
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeSeatLimitReached, "se alcanzó el límite de miembros activos", nil)
		return true
	default:
		return false
	}
}

func teamInvariantAuditEvent(err error) string {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
		return ""
	}
	switch pgErr.ConstraintName {
	case organizationRequiresActiveAdminConstraint:
		return "last_admin_blocked"
	case organizationActiveMemberSeatLimitConstraint:
		return "seat_limit_blocked"
	default:
		return ""
	}
}
func membershipMutationResponse(m storage.OrgTeamMember) openapi.MembershipMutationResponse {
	return openapi.MembershipMutationResponse{MembershipID: m.MembershipID, UserID: m.UserID, Status: openapi.MembershipStatus(m.Status), Roles: roleStrings(m.Roles), Version: m.Version}
}
func roleStrings(roles []domain.UserRole) []string {
	out := make([]string, len(roles))
	for i, r := range roles {
		out[i] = string(r)
	}
	return out
}

func invitationToOpenAPI(inv storage.Invitation) openapi.Invitation {
	out := openapi.Invitation{ID: inv.ID, OrganizationID: inv.OrganizationID, Email: inv.Email, Status: openapi.InvitationStatus(inv.Status), Roles: roleStrings(inv.Roles), ExpiresAt: inv.ExpiresAt.UTC().Format(time.RFC3339Nano), CreatedAt: inv.CreatedAt.UTC().Format(time.RFC3339Nano), InvitedBy: inv.InvitedBy, AcceptedBy: inv.AcceptedBy, RevokedBy: inv.RevokedBy, RevokedReason: inv.RevokedReason, Version: inv.Version}
	if inv.AcceptedAt != nil {
		v := inv.AcceptedAt.UTC().Format(time.RFC3339Nano)
		out.AcceptedAt = &v
	}
	if inv.RevokedAt != nil {
		v := inv.RevokedAt.UTC().Format(time.RFC3339Nano)
		out.RevokedAt = &v
	}
	return out
}
func (s *Server) HandleOrgListInvitations(w http.ResponseWriter, r *http.Request) {
	claims, _, ok := s.requireOrgTeamCapability(w, r, domain.TeamCapabilityView)
	if !ok {
		return
	}
	list, err := s.Store.ListInvitations(r.Context(), claims.OrgID, claims.UserID)
	if err != nil {
		respondWithInternalError(w, err, "org invitations")
		return
	}
	out := make([]openapi.Invitation, len(list))
	for i := range list {
		out[i] = invitationToOpenAPI(list[i])
	}
	respondWithJSON(w, http.StatusOK, out)
}

func (s *Server) HandleOrgCreateInvitation(w http.ResponseWriter, r *http.Request) {
	claims, org, ok := s.requireOrgTeamCapability(w, r, domain.TeamCapabilityView)
	if !ok {
		return
	}
	var body openapi.CreateInvitationRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	email := domain.NormalizeEmail(body.Email)
	roles := make([]domain.UserRole, len(body.Roles))
	for i, v := range body.Roles {
		roles[i] = domain.UserRole(v)
	}
	if email == "" || !strings.Contains(email, "@") || !domain.RolesAllowedInOrg(roles, org.Type) {
		respondWithError(w, http.StatusBadRequest, "email válido y roles permitidos son obligatorios")
		return
	}
	bootstrapSupport := false
	if claims.Support != nil {
		summary, summaryErr := s.Store.GetOrgTeamSummary(r.Context(), claims.OrgID, claims.UserID)
		bootstrapSupport = summaryErr == nil && summary.ActiveMembers == 0 && len(roles) == 1 && roles[0] == domain.RoleAdmin
		if !bootstrapSupport {
			respondWithError(w, http.StatusForbidden, "la sesión de soporte sólo puede crear la invitación inicial del administrador")
			return
		}
	}
	if !bootstrapSupport && !teamRoleSetIsInvitable(actorRoles(claims), roles, org.Type) {
		respondWithError(w, http.StatusForbidden, "no tenés permiso para invitar esos roles")
		return
	}
	token, err := randomToken32()
	if err != nil {
		respondWithInternalError(w, err, "invitation token")
		return
	}
	inv, err := s.Store.CreateInvitation(r.Context(), claims.OrgID, email, roles, hashInvitationToken(token), time.Now().Add(14*24*time.Hour), claims.UserID)
	if err != nil {
		if isDuplicateKey(err) {
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "ya existe una invitación abierta para ese email", nil)
		} else {
			respondWithInternalError(w, err, "org create invitation")
		}
		return
	}
	if err = s.auditRequired(r.Context(), "invitation_created", claims.UserID, claims.OrgID, clientIP(r), map[string]interface{}{"invitation_id": inv.ID}); err != nil {
		respondWithInternalError(w, err, "audit invitation creation")
		return
	}
	respondWithJSON(w, http.StatusCreated, openapi.CreateInvitationResponse{Invitation: invitationToOpenAPI(*inv), InvitationToken: token, AcceptURL: "/accept-invitation?token=" + token})
}

func (s *Server) HandleOrgResendInvitation(w http.ResponseWriter, r *http.Request) {
	claims, org, ok := s.requireOrgTeamMutation(w, r)
	if !ok {
		return
	}
	if !s.requireInvitationTarget(w, r, claims, org) {
		return
	}
	expected, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	token, err := randomToken32()
	if err != nil {
		respondWithInternalError(w, err, "invitation token")
		return
	}
	inv, err := s.Store.ResendInvitation(r.Context(), claims.OrgID, r.PathValue("invitationId"), hashInvitationToken(token), time.Now().Add(14*24*time.Hour), expected)
	if invitationMutationError(w, err) {
		return
	}
	if err = s.auditRequired(r.Context(), "invitation_resent", claims.UserID, claims.OrgID, clientIP(r), map[string]interface{}{"invitation_id": inv.ID}); err != nil {
		respondWithInternalError(w, err, "audit invitation resend")
		return
	}
	w.Header().Set("ETag", FormatVersionETag(inv.Version))
	respondWithJSON(w, http.StatusOK, openapi.ResendInvitationResponse{Invitation: invitationToOpenAPI(*inv), InvitationToken: token, AcceptURL: "/accept-invitation?token=" + token})
}

// HandleOrgInvitationCommand adapts the OpenAPI action-suffix routes to Go's
// ServeMux, which does not allow a literal suffix after a path wildcard.
func (s *Server) HandleOrgInvitationCommand(w http.ResponseWriter, r *http.Request) {
	command := r.PathValue("invitationCommand")
	var operation string
	switch {
	case strings.HasSuffix(command, ":resend"):
		operation = "org.resend-invitation"
		r.SetPathValue("invitationId", strings.TrimSuffix(command, ":resend"))
		s.RequireIdempotency(operation, http.HandlerFunc(s.HandleOrgResendInvitation)).ServeHTTP(w, r)
	case strings.HasSuffix(command, ":revoke"):
		operation = "org.revoke-invitation"
		r.SetPathValue("invitationId", strings.TrimSuffix(command, ":revoke"))
		s.RequireIdempotency(operation, http.HandlerFunc(s.HandleOrgRevokeInvitation)).ServeHTTP(w, r)
	default:
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "ruta no encontrada", nil)
	}
}
func (s *Server) HandleOrgRevokeInvitation(w http.ResponseWriter, r *http.Request) {
	claims, org, ok := s.requireOrgTeamMutation(w, r)
	if !ok {
		return
	}
	if !s.requireInvitationTarget(w, r, claims, org) {
		return
	}
	expected, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	var body openapi.RevokeInvitationRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	reason := strings.TrimSpace(body.Reason)
	if reason == "" {
		respondWithError(w, http.StatusBadRequest, "reason es obligatorio")
		return
	}
	inv, err := s.Store.RevokeInvitation(r.Context(), claims.OrgID, r.PathValue("invitationId"), reason, claims.UserID, expected)
	if invitationMutationError(w, err) {
		return
	}
	if err = s.auditRequired(r.Context(), "invitation_revoked", claims.UserID, claims.OrgID, clientIP(r), map[string]interface{}{"invitation_id": inv.ID, "reason": reason}); err != nil {
		respondWithInternalError(w, err, "audit invitation revoke")
		return
	}
	w.Header().Set("ETag", FormatVersionETag(inv.Version))
	respondWithJSON(w, http.StatusOK, openapi.RevokeInvitationResponse{Invitation: invitationToOpenAPI(*inv)})
}

func (s *Server) requireInvitationTarget(w http.ResponseWriter, r *http.Request, claims *auth.Claims, org *domain.Organization) bool {
	invitations, err := s.Store.ListInvitations(r.Context(), claims.OrgID, claims.UserID)
	if err != nil {
		respondWithInternalError(w, err, "invitation authorization")
		return false
	}
	for _, invitation := range invitations {
		if invitation.ID != r.PathValue("invitationId") {
			continue
		}
		if !teamRoleSetIsInvitable(actorRoles(claims), invitation.Roles, org.Type) {
			respondWithError(w, http.StatusForbidden, "no tenés permiso para gestionar esta invitación")
			return false
		}
		return true
	}
	respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeInvitationNotFound, "invitación no encontrada", nil)
	return false
}
func invitationMutationError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, storage.ErrVersionConflict) {
		respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "La invitación fue modificada por otra sesión", nil)
		return true
	}
	if errors.Is(err, storage.ErrInvitationNotFound) {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeInvitationNotFound, "invitación no encontrada", nil)
		return true
	}
	respondWithInternalError(w, err, "invitation mutation")
	return true
}
