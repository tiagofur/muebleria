// Organization team API (#326): the admin of the active organization manages
// their people — members with multi-role chips, invitations by link/code,
// offboarding — everything audited. Support sessions act as org admin here.

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

// requireOrgAdmin: org-scoped token with admin in the role set (regular
// membership admin or platform support session).
func (s *Server) requireOrgAdmin(w http.ResponseWriter, r *http.Request) (*auth.Claims, *domain.Organization, bool) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.OrgID == "" {
		respondWithError(w, http.StatusForbidden, "necesitás sesión en un taller")
		return nil, nil, false
	}
	if !domain.AnyRole(actorRoles(claims), func(rl domain.UserRole) bool { return rl == domain.RoleAdmin }) {
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

// GET /api/org/team
func (s *Server) HandleOrgTeam(w http.ResponseWriter, r *http.Request) {
	claims, _, ok := s.requireOrgAdmin(w, r)
	if !ok {
		return
	}
	team, err := s.Store.ListOrgTeam(r.Context(), claims.OrgID)
	if err != nil {
		respondWithInternalError(w, err, "org team")
		return
	}
	out := make([]openapi.TeamMember, len(team))
	for i, member := range team {
		out[i] = openapi.TeamMember{
			UserID: member.UserID, Email: member.Email, Name: member.Name, Active: member.Active,
			Roles: roleStrings(member.Roles), MemberSince: member.MemberSince.UTC().Format(time.RFC3339Nano), Version: member.Version,
		}
	}
	respondWithJSON(w, http.StatusOK, out)
}

// PUT /api/org/members/{userId}/roles {roles: []}
func (s *Server) HandleOrgMemberRoles(w http.ResponseWriter, r *http.Request) {
	claims, org, ok := s.requireOrgAdmin(w, r)
	if !ok {
		return
	}
	userID := r.PathValue("userId")
	expectedVersion, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	var body openapi.UpdateMemberRolesRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	roles := make([]domain.UserRole, len(body.Roles))
	for i, role := range body.Roles {
		roles[i] = domain.UserRole(role)
	}
	if !domain.RolesAllowedInOrg(roles, org.Type) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeRoleNotAllowed, "roles inválidos para este tipo de taller", nil)
		return
	}
	member, err := s.Store.UpdateMembershipRolesByOrg(r.Context(), claims.OrgID, userID, roles, expectedVersion)
	if err != nil {
		if errors.Is(err, storage.ErrVersionConflict) {
			respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeMembershipVersionConflict, "La membresía fue modificada por otra sesión", map[string]any{"currentVersionRequired": true})
			return
		}
		if errors.Is(err, storage.ErrMembershipNotFound) {
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeMembershipNotFound, "membresía no encontrada", nil)
			return
		}
		respondWithInternalError(w, err, "update membership roles")
		return
	}

	s.audit(r.Context(), "membership_roles_updated", claims.UserID, claims.OrgID, clientIP(r), map[string]interface{}{
		"target_user_id": userID, "roles": roles,
	})
	w.Header().Set("ETag", FormatVersionETag(member.Version))
	respondWithJSON(w, http.StatusOK, openapi.MembershipMutationResponse{UserID: userID, Roles: roleStrings(member.Roles), Active: member.Active, Version: member.Version})
}

// PUT /api/org/members/{userId}/active {active: bool}
func (s *Server) HandleOrgMemberActive(w http.ResponseWriter, r *http.Request) {
	claims, _, ok := s.requireOrgAdmin(w, r)
	if !ok {
		return
	}
	userID := r.PathValue("userId")
	expectedVersion, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	var body struct {
		Active *bool `json:"active"`
	}
	if !decodeJSONBody(w, r, &body) || body.Active == nil {
		respondWithError(w, http.StatusBadRequest, "active es obligatorio")
		return
	}
	member, err := s.Store.SetMembershipActive(r.Context(), claims.OrgID, userID, *body.Active, expectedVersion)
	if err != nil {
		if errors.Is(err, storage.ErrVersionConflict) {
			respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeMembershipVersionConflict, "La membresía fue modificada por otra sesión", nil)
			return
		}
		if errors.Is(err, storage.ErrMembershipNotFound) {
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeMembershipNotFound, "membresía no encontrada", nil)
			return
		}
		respondWithInternalError(w, err, "update membership active")
		return
	}
	event := "membership_deactivated"
	if *body.Active {
		event = "membership_reactivated"
	}
	s.audit(r.Context(), event, claims.UserID, claims.OrgID, clientIP(r), map[string]interface{}{
		"target_user_id": userID,
	})
	w.Header().Set("ETag", FormatVersionETag(member.Version))
	respondWithJSON(w, http.StatusOK, openapi.MembershipMutationResponse{UserID: userID, Roles: roleStrings(member.Roles), Active: member.Active, Version: member.Version})
}

func roleStrings(roles []domain.UserRole) []string {
	out := make([]string, len(roles))
	for i, r := range roles {
		out[i] = string(r)
	}
	return out
}

// GET /api/org/invitations
func (s *Server) HandleOrgListInvitations(w http.ResponseWriter, r *http.Request) {
	claims, _, ok := s.requireOrgAdmin(w, r)
	if !ok {
		return
	}
	list, err := s.Store.ListInvitations(r.Context(), claims.OrgID)
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

func invitationToOpenAPI(inv storage.Invitation) openapi.Invitation {
	out := openapi.Invitation{
		ID: inv.ID, Email: inv.Email, Roles: roleStrings(inv.Roles),
		ExpiresAt: inv.ExpiresAt.UTC().Format(time.RFC3339Nano), CreatedAt: inv.CreatedAt.UTC().Format(time.RFC3339Nano),
		InvitedBy: inv.InvitedBy, AcceptedBy: inv.AcceptedBy, Version: inv.Version,
	}
	if inv.AcceptedAt != nil {
		value := inv.AcceptedAt.UTC().Format(time.RFC3339Nano)
		out.AcceptedAt = &value
	}
	if inv.RevokedAt != nil {
		value := inv.RevokedAt.UTC().Format(time.RFC3339Nano)
		out.RevokedAt = &value
	}
	return out
}

// POST /api/org/invitations {email, roles} → link/código (no SMTP in pilots:
// the admin forwards it via WhatsApp). Token shown exactly once.
func (s *Server) HandleOrgCreateInvitation(w http.ResponseWriter, r *http.Request) {
	claims, org, ok := s.requireOrgAdmin(w, r)
	if !ok {
		return
	}
	var body openapi.CreateInvitationRequest
	email := ""
	if decodeJSONBody(w, r, &body) {
		email = strings.TrimSpace(strings.ToLower(body.Email))
	}
	roles := make([]domain.UserRole, len(body.Roles))
	for i, role := range body.Roles {
		roles[i] = domain.UserRole(role)
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
	inv, err := s.Store.CreateInvitation(r.Context(), claims.OrgID, email, roles,
		hashInvitationToken(token), time.Now().Add(14*24*time.Hour), claims.UserID)
	if err != nil {
		if isDuplicateKey(err) {
			// One open invitation per (org, email) — the partial unique index
			// rejects a second one; surface it as 409 instead of a 500.
			respondWithError(w, http.StatusConflict, "ya existe una invitación abierta para ese email")
			return
		}
		respondWithInternalError(w, err, "org create invitation")
		return
	}
	s.audit(r.Context(), "invitation_created", claims.UserID, claims.OrgID, clientIP(r), map[string]interface{}{
		"email": email, "roles": roles,
	})
	respondWithJSON(w, http.StatusCreated, openapi.CreateInvitationResponse{
		Invitation:      invitationToOpenAPI(*inv),
		InvitationToken: token, AcceptURL: "/accept-invitation?token=" + token,
	})
}

// DELETE /api/org/invitations/{id}
func (s *Server) HandleOrgRevokeInvitation(w http.ResponseWriter, r *http.Request) {
	claims, _, ok := s.requireOrgAdmin(w, r)
	if !ok {
		return
	}
	if err := s.Store.RevokeInvitation(r.Context(), claims.OrgID, r.PathValue("id")); err != nil {
		respondWithError(w, http.StatusNotFound, "invitación no encontrada")
		return
	}
	s.audit(r.Context(), "invitation_revoked", claims.UserID, claims.OrgID, clientIP(r), map[string]interface{}{
		"invitation_id": r.PathValue("id"),
	})
	respondWithJSON(w, http.StatusOK, openapi.RevokeInvitationResponse{Message: "invitation revoked"})
}
