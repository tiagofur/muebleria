package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

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

func teamMemberToOpenAPI(m storage.OrgTeamMember) openapi.TeamMember {
	return openapi.TeamMember{
		MembershipID: m.MembershipID, UserID: m.UserID, Email: m.Email, Name: m.Name,
		AccountStatus: openapi.AccountStatus(m.AccountStatus), MembershipStatus: openapi.MembershipStatus(m.Status),
		Roles: roleStrings(m.Roles), JoinedAt: m.JoinedAt.UTC().Format(time.RFC3339Nano), Version: m.Version,
	}
}

func (s *Server) HandleOrgTeam(w http.ResponseWriter, r *http.Request) {
	claims, _, ok := s.requireOrgAdmin(w, r)
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
	respondWithJSON(w, http.StatusOK, out)
}

func (s *Server) HandleOrgMemberRoles(w http.ResponseWriter, r *http.Request) {
	claims, org, ok := s.requireOrgAdmin(w, r)
	if !ok {
		return
	}
	expected, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	var body openapi.UpdateMemberRolesRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	roles := make([]domain.UserRole, len(body.Roles))
	for i, v := range body.Roles {
		roles[i] = domain.UserRole(v)
	}
	if !domain.RolesAllowedInOrg(roles, org.Type) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeRoleNotAllowed, "roles inválidos para este tipo de taller", nil)
		return
	}
	member, err := s.Store.UpdateMembershipRolesByOrg(r.Context(), claims.OrgID, r.PathValue("membershipId"), roles, expected)
	if membershipMutationError(w, err) {
		return
	}
	if err := s.auditRequired(r.Context(), "membership_roles_updated", claims.UserID, claims.OrgID, clientIP(r), map[string]interface{}{"membership_id": member.MembershipID, "roles": roles}); err != nil {
		respondWithInternalError(w, err, "audit membership roles")
		return
	}
	w.Header().Set("ETag", FormatVersionETag(member.Version))
	respondWithJSON(w, http.StatusOK, membershipMutationResponse(*member))
}

func (s *Server) HandleOrgMemberStatus(w http.ResponseWriter, r *http.Request) {
	claims, _, ok := s.requireOrgAdmin(w, r)
	if !ok {
		return
	}
	expected, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	var body openapi.UpdateMembershipStatusRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	reason := ""
	if body.Reason != nil {
		reason = strings.TrimSpace(*body.Reason)
	}
	status := domain.MembershipStatus(body.Status)
	if status != domain.MembershipStatusActive && status != domain.MembershipStatusSuspended {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "el offboarding de membresías queda reservado para el flujo de Team", nil)
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
	if err := s.auditRequired(r.Context(), event, claims.UserID, claims.OrgID, clientIP(r), map[string]interface{}{"membership_id": member.MembershipID, "reason": reason}); err != nil {
		respondWithInternalError(w, err, "audit membership status")
		return
	}
	w.Header().Set("ETag", FormatVersionETag(member.Version))
	respondWithJSON(w, http.StatusOK, membershipMutationResponse(*member))
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
	respondWithInternalError(w, err, "membership mutation")
	return true
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
	claims, _, ok := s.requireOrgAdmin(w, r)
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
	claims, org, ok := s.requireOrgAdmin(w, r)
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
	claims, _, ok := s.requireOrgAdmin(w, r)
	if !ok {
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
	claims, _, ok := s.requireOrgAdmin(w, r)
	if !ok {
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
