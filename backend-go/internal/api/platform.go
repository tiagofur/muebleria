// Platform console API (ADR-0005 §5 / #326): organization lifecycle,
// licenses, users overview, audit viewer and audited support sessions.
// Platform staff never read business data from here — entering a taller
// requires a support session.

package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// PlatformAdminMiddleware requires the platform staff flag.
func PlatformAdminMiddleware(jwtSecret string, users MembershipLookup) func(http.Handler) http.Handler {
	authMW := AuthMiddleware(jwtSecret, users)
	return func(next http.Handler) http.Handler {
		return authMW(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := r.Context().Value(UserContextKey).(*auth.Claims)
			if !ok || claims == nil || !claims.PlatformAdmin {
				respondWithError(w, http.StatusForbidden, "platform admin required")
				return
			}
			next.ServeHTTP(w, r)
		}))
	}
}

func hashInvitationToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func randomToken32() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// GET /api/platform/organizations
func (s *Server) HandlePlatformListOrganizations(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.ListOrganizations(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "platform orgs")
		return
	}
	out := make([]OrgSummaryDTO, 0, len(list))
	for _, o := range list {
		out = append(out, toOrgSummaryDTO(o))
	}
	respondWithJSON(w, http.StatusOK, out)
}

// POST /api/platform/organizations {name, slug, type?, license_plan?, clone_catalog_from?}
func (s *Server) HandlePlatformCreateOrganization(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name               string `json:"name"`
		Slug               string `json:"slug"`
		Type               string `json:"type"`
		LicensePlan        string `json:"license_plan"`
		CloneCatalogFrom   string `json:"clone_catalog_from"`
	}
	if !decodeJSONBody(w, r, &body) || strings.TrimSpace(body.Name) == "" || strings.TrimSpace(body.Slug) == "" {
		respondWithError(w, http.StatusBadRequest, "name y slug son obligatorios")
		return
	}
	orgType := domain.OrganizationType(body.Type)
	if orgType == "" {
		orgType = domain.OrganizationTypeFactory
	}
	if !domain.IsValidOrganizationType(orgType) {
		respondWithError(w, http.StatusBadRequest, "type inválido (factory|store|dealer)")
		return
	}
	plan := domain.LicensePlan(body.LicensePlan)
	if plan == "" {
		plan = domain.LicensePlanNone
	}
	if !domain.IsValidLicensePlan(plan) {
		respondWithError(w, http.StatusBadRequest, "license_plan inválido")
		return
	}
	claims := claimsFromRequest(r)

	org := &domain.Organization{Name: strings.TrimSpace(body.Name), Slug: strings.TrimSpace(body.Slug),
		Type: orgType, LicensePlan: plan, Active: true}
	if err := s.Store.CreateOrganization(r.Context(), org); err != nil {
		respondWithInternalError(w, err, "platform create org")
		return
	}

	// Optional base-catalog clone (defaults to the initial organization).
	if strings.TrimSpace(body.CloneCatalogFrom) != "" {
		src := strings.TrimSpace(body.CloneCatalogFrom)
		srcOrg, err := s.Store.GetOrganizationByID(r.Context(), src)
		if err != nil {
			srcOrg, err = s.Store.GetOrganizationBySlug(r.Context(), src)
		}
		if err != nil || srcOrg == nil || srcOrg.ID == org.ID {
			respondWithError(w, http.StatusBadRequest, "clone_catalog_from no resolve a una organización válida")
			return
		}
		if err := s.Store.CloneCatalog(r.Context(), srcOrg.ID, org.ID); err != nil {
			respondWithInternalError(w, err, "platform clone catalog")
			return
		}
	}

	s.audit(r.Context(), "organization_created", claims.UserID, org.ID, clientIP(r), map[string]interface{}{
		"name": org.Name, "slug": org.Slug, "type": string(org.Type), "source": "platform console",
	})
	sum := toOrgSummaryDTO(*org)
	respondWithJSON(w, http.StatusCreated, sum)
}

// PATCH /api/platform/organizations/{id} {name?, license_plan?, license_expires_at?, active?}
func (s *Server) HandlePlatformUpdateOrganization(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Name              *string    `json:"name"`
		LicensePlan       *string    `json:"license_plan"`
		LicenseExpiresAt  *time.Time `json:"license_expires_at"`
		Active            *bool      `json:"active"`
	}
	if !decodeJSONBody(w, r, &body) {
		return
	}
	org, err := s.Store.GetOrganizationByID(r.Context(), id)
	if err != nil || org == nil {
		respondWithError(w, http.StatusNotFound, "organización no encontrada")
		return
	}
	claims := claimsFromRequest(r)

	if body.Name != nil && strings.TrimSpace(*body.Name) != "" {
		org.Name = strings.TrimSpace(*body.Name)
	}
	if body.LicensePlan != nil {
		plan := domain.LicensePlan(*body.LicensePlan)
		if !domain.IsValidLicensePlan(plan) {
			respondWithError(w, http.StatusBadRequest, "license_plan inválido")
			return
		}
		org.LicensePlan = plan
	}
	if body.LicenseExpiresAt != nil {
		org.LicenseExpiresAt = body.LicenseExpiresAt
	}
	if body.Active != nil {
		org.Active = *body.Active
	}
	if err := s.Store.UpdateOrganization(r.Context(), org); err != nil {
		respondWithInternalError(w, err, "platform update org")
		return
	}

	if body.Active != nil {
		event := "organization_suspended"
		if *body.Active {
			event = "organization_reactivated"
		}
		s.audit(r.Context(), event, claims.UserID, org.ID, clientIP(r), nil)
	}
	if body.LicensePlan != nil || body.LicenseExpiresAt != nil {
		s.audit(r.Context(), "organization_license_updated", claims.UserID, org.ID, clientIP(r), map[string]interface{}{
			"license_plan": string(org.LicensePlan),
		})
	}
	respondWithJSON(w, http.StatusOK, toOrgSummaryDTO(*org))
}

// GET /api/platform/organizations/{id}/audit?limit=
func (s *Server) HandlePlatformOrgAudit(w http.ResponseWriter, r *http.Request) {
	limit := 100
	events, err := s.Store.ListSecurityAuditEvents(r.Context(), r.PathValue("id"), limit)
	if err != nil {
		respondWithInternalError(w, err, "platform audit")
		return
	}
	respondWithJSON(w, http.StatusOK, events)
}

// GET /api/platform/users — global users with their memberships.
func (s *Server) HandlePlatformUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.Store.ListUsers(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "platform users")
		return
	}
	type row struct {
		PublicUserDTO
		Memberships []MembershipDTO `json:"memberships"`
	}
	out := make([]row, 0, len(users))
	for _, u := range users {
		ms, err := s.Store.ListMembershipsByUser(r.Context(), u.ID)
		if err != nil {
			respondWithInternalError(w, err, "platform users memberships")
			return
		}
		dto := ToPublicUserDTO(&u)
		out = append(out, row{PublicUserDTO: dto, Memberships: toMembershipDTOs(ms)})
	}
	respondWithJSON(w, http.StatusOK, out)
}

// POST /api/platform/organizations/{id}/support-session {reason}
// Issues the short-lived support token: effective admin of the organization,
// real actor = the platform admin, banner data included.
func (s *Server) HandlePlatformStartSupportSession(w http.ResponseWriter, r *http.Request) {
	orgID := r.PathValue("id")
	var body struct {
		Reason string `json:"reason"`
	}
	if !decodeJSONBody(w, r, &body) || len(strings.TrimSpace(body.Reason)) < 4 {
		respondWithError(w, http.StatusBadRequest, "la razón del acceso de soporte es obligatoria (mínimo 4 caracteres)")
		return
	}
	org, err := s.Store.GetOrganizationByID(r.Context(), orgID)
	if err != nil || org == nil || !org.Active {
		respondWithError(w, http.StatusNotFound, "organización no encontrada o suspendida")
		return
	}
	claims := claimsFromRequest(r)

	ss, err := s.Store.StartSupportSession(r.Context(), claims.UserID, org.ID, strings.TrimSpace(body.Reason), auth.SupportTokenTTL)
	if err != nil {
		respondWithInternalError(w, err, "support session start")
		return
	}
	token, err := auth.GenerateSupportToken(claims.UserID, claims.Email, auth.SupportClaims{
		OrgID: org.ID, SessionID: ss.ID, Reason: ss.Reason,
	}, s.JWTSecret)
	if err != nil {
		respondWithInternalError(w, err, "support token")
		return
	}

	s.audit(r.Context(), "support_session_started", claims.UserID, org.ID, clientIP(r), map[string]interface{}{
		"session_id": ss.ID, "reason": ss.Reason, "expires_at": ss.ExpiresAt,
	})
	orgDTO := toOrgSummaryDTO(*org)
	respondWithJSON(w, http.StatusCreated, map[string]interface{}{
		"token":        token,
		"session_id":   ss.ID,
		"reason":       ss.Reason,
		"expires_at":   ss.ExpiresAt,
		"organization": orgDTO,
		"support":      true,
	})
}

// DELETE /api/platform/support-sessions/{sessionId} — explicit logout.
func (s *Server) HandlePlatformEndSupportSession(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	sessionID := r.PathValue("sessionId")

	ended, err := s.Store.EndSupportSession(r.Context(), sessionID, claims.UserID, "logout")
	if err != nil {
		respondWithInternalError(w, err, "support session end")
		return
	}
	s.audit(r.Context(), "support_session_ended", claims.UserID, "", clientIP(r), map[string]interface{}{
		"session_id": sessionID, "via": "logout", "found": ended,
	})
	respondWithJSON(w, http.StatusOK, map[string]bool{"ended": ended})
}

// acceptInvitationLogin builds the login response after a user accepts an
// invitation (single membership → straight in; several → select).
func (s *Server) acceptInvitationLogin(w http.ResponseWriter, r *http.Request, u *domain.User) {
	memberships, err := s.Store.ListMembershipsByUser(r.Context(), u.ID)
	if err != nil {
		respondWithInternalError(w, err, "accept invitation memberships")
		return
	}
	if len(memberships) == 1 {
		m := memberships[0]
		roles := make([]string, len(m.Roles))
		for i, rl := range m.Roles {
			roles[i] = string(rl)
		}
		token, err := auth.GenerateToken(u.ID, u.Email, auth.TokenContext{
			Roles: roles, OrgID: m.OrganizationID, PlatformAdmin: u.PlatformAdmin,
		}, s.JWTSecret)
		if err != nil {
			respondWithInternalError(w, err, "accept invitation token")
			return
		}
		org := toOrgSummaryDTO(m.Organization)
		respondWithJSON(w, http.StatusOK, LoginResponse{
			Token: token, User: ToPublicUserDTO(u), License: org.License,
			Roles: m.Roles, Organization: &org,
		})
		return
	}
	respondWithJSON(w, http.StatusOK, LoginResponse{
		User: ToPublicUserDTO(u), Memberships: toMembershipDTOs(memberships), SelectionRequired: true,
	})
}

// POST /api/auth/accept-invitation {token, password, name?} — public (rate
// limited at the route). Existing users authenticate with their password;
// new users are created active with the invitation as approval.
func (s *Server) HandleAcceptInvitation(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token    string `json:"token"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if !decodeJSONBody(w, r, &body) || strings.TrimSpace(body.Token) == "" || body.Password == "" {
		respondWithError(w, http.StatusBadRequest, "token y password son obligatorios")
		return
	}
	inv, err := s.Store.GetOpenInvitationByToken(r.Context(), hashInvitationToken(strings.TrimSpace(body.Token)))
	if err != nil {
		respondWithError(w, http.StatusNotFound, "invitación inválida o expirada")
		return
	}
	if !domain.RolesAllowedInOrg(inv.Roles, inv.OrganizationType) {
		respondWithError(w, http.StatusForbidden, "la invitación contiene roles no permitidos para este tipo de organización")
		return
	}

	u, err := s.Store.GetUserByEmailAnyState(r.Context(), inv.Email)
	if err == nil && u != nil {
		if !auth.CheckPasswordHash(body.Password, u.PasswordHash) || !u.Active {
			s.audit(r.Context(), "invitation_accept_failed", u.ID, inv.OrganizationID, clientIP(r), nil)
			respondWithError(w, http.StatusUnauthorized, "credenciales inválidas")
			return
		}
	} else {
		if err := auth.ValidatePassword(body.Password); err != nil {
			respondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		hash, err := auth.HashPassword(body.Password)
		if err != nil {
			respondWithInternalError(w, err, "accept invitation hash")
			return
		}
		name := strings.TrimSpace(body.Name)
		if name == "" {
			name = strings.SplitN(inv.Email, "@", 2)[0]
		}
		u = &domain.User{Email: inv.Email, PasswordHash: hash, Name: name,
			Role: primaryUserRole(inv.Roles), Active: true}
		if err := s.Store.CreateUser(r.Context(), u); err != nil {
			respondWithInternalError(w, err, "accept invitation create user")
			return
		}
	}

	if err := s.Store.AcceptInvitationTx(r.Context(), inv.ID, u.ID); err != nil {
		respondWithInternalError(w, err, "accept invitation")
		return
	}
	s.audit(r.Context(), "invitation_accepted", u.ID, inv.OrganizationID, clientIP(r), map[string]interface{}{
		"invitation_id": inv.ID, "email": inv.Email,
	})
	s.acceptInvitationLogin(w, r, u)
}
