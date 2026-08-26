// Organization team API (#326): the admin of the active organization manages
// their people — members with multi-role chips, invitations by link/code,
// offboarding — everything audited. Support sessions act as org admin here.

package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
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
	respondWithJSON(w, http.StatusOK, team)
}

// PUT /api/org/members/{userId}/roles {roles: []}
func (s *Server) HandleOrgMemberRoles(w http.ResponseWriter, r *http.Request) {
	claims, org, ok := s.requireOrgAdmin(w, r)
	if !ok {
		return
	}
	userID := r.PathValue("userId")
	var body struct {
		Roles []domain.UserRole `json:"roles"`
	}
	if !decodeJSONBody(w, r, &body) || !domain.RolesAllowedInOrg(body.Roles, org.Type) {
		respondWithError(w, http.StatusBadRequest, "roles inválidos para este tipo de taller")
		return
	}
	if err := s.Store.UpdateMembershipRolesByOrg(r.Context(), claims.OrgID, userID, body.Roles); err != nil {
		respondWithError(w, http.StatusNotFound, "membresía no encontrada")
		return
	}
	// Bridge: keep deprecated users.role aligned with the primary role.
	_ = s.Store.UpdateUserRole(r.Context(), userID, primaryUserRole(body.Roles))

	s.audit(r.Context(), "membership_roles_updated", claims.UserID, claims.OrgID, clientIP(r), map[string]interface{}{
		"target_user_id": userID, "roles": body.Roles,
	})
	respondWithJSON(w, http.StatusOK, map[string][]domain.UserRole{"roles": body.Roles})
}

// PUT /api/org/members/{userId}/active {active: bool}
func (s *Server) HandleOrgMemberActive(w http.ResponseWriter, r *http.Request) {
	claims, _, ok := s.requireOrgAdmin(w, r)
	if !ok {
		return
	}
	userID := r.PathValue("userId")
	var body struct {
		Active *bool `json:"active"`
	}
	if !decodeJSONBody(w, r, &body) || body.Active == nil {
		respondWithError(w, http.StatusBadRequest, "active es obligatorio")
		return
	}
	if err := s.Store.SetMembershipActive(r.Context(), claims.OrgID, userID, *body.Active); err != nil {
		respondWithError(w, http.StatusNotFound, "membresía no encontrada")
		return
	}
	event := "membership_deactivated"
	if *body.Active {
		event = "membership_reactivated"
	}
	s.audit(r.Context(), event, claims.UserID, claims.OrgID, clientIP(r), map[string]interface{}{
		"target_user_id": userID,
	})
	respondWithJSON(w, http.StatusOK, map[string]bool{"active": *body.Active})
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
	respondWithJSON(w, http.StatusOK, list)
}

// POST /api/org/invitations {email, roles} → link/código (no SMTP in pilots:
// the admin forwards it via WhatsApp). Token shown exactly once.
func (s *Server) HandleOrgCreateInvitation(w http.ResponseWriter, r *http.Request) {
	claims, org, ok := s.requireOrgAdmin(w, r)
	if !ok {
		return
	}
	var body struct {
		Email string             `json:"email"`
		Roles []domain.UserRole `json:"roles"`
	}
	email := ""
	if decodeJSONBody(w, r, &body) {
		email = strings.TrimSpace(strings.ToLower(body.Email))
	}
	if email == "" || !strings.Contains(email, "@") || !domain.RolesAllowedInOrg(body.Roles, org.Type) {
		respondWithError(w, http.StatusBadRequest, "email válido y roles permitidos son obligatorios")
		return
	}

	token, err := randomToken32()
	if err != nil {
		respondWithInternalError(w, err, "invitation token")
		return
	}
	inv, err := s.Store.CreateInvitation(r.Context(), claims.OrgID, email, body.Roles,
		hashInvitationToken(token), time.Now().Add(14*24*time.Hour), claims.UserID)
	if err != nil {
		respondWithInternalError(w, err, "org create invitation")
		return
	}
	s.audit(r.Context(), "invitation_created", claims.UserID, claims.OrgID, clientIP(r), map[string]interface{}{
		"email": email, "roles": body.Roles,
	})
	respondWithJSON(w, http.StatusCreated, map[string]interface{}{
		"id":         inv.ID,
		"email":      inv.Email,
		"roles":      inv.Roles,
		"expires_at": inv.ExpiresAt,
		// The raw token travels exactly once; only its hash is stored.
		"invitation_token": token,
		"accept_url":       "/accept-invitation?token=" + token,
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
	respondWithJSON(w, http.StatusOK, map[string]string{"message": "invitation revoked"})
}

// primaryUserRole resolves the first canonical role of a set (bridge for the
// deprecated users.role column).
func primaryUserRole(roles []domain.UserRole) domain.UserRole {
	if len(roles) == 0 {
		return domain.RoleUser
	}
	return roles[0]
}
