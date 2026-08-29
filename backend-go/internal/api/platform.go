// Platform console API (ADR-0005 §5 / #326): organization lifecycle,
// licenses, users overview, audit viewer and audited support sessions.
// Platform staff never read business data from here — entering a taller
// requires a support session.

package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
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

type PlatformOrgDTO = openapi.PlatformOrganization

func toPlatformOrgDTO(o domain.Organization, memberCount int) PlatformOrgDTO {
	return PlatformOrgDTO{
		ID:                   o.ID,
		Name:                 o.Name,
		Slug:                 o.Slug,
		Type:                 string(o.Type),
		LicensePlan:          string(o.LicensePlan),
		LicenseExpiresAt:     formatOptionalTime(o.LicenseExpiresAt),
		Active:               o.Active,
		ParentOrganizationID: o.ParentOrganizationID,
		CreatedAt:            o.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt:            o.UpdatedAt.UTC().Format(time.RFC3339Nano),
		MemberCount:          int64(memberCount),
		Version:              o.Version,
	}
}

func formatOptionalTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	out := value.UTC().Format(time.RFC3339Nano)
	return &out
}

// GET /api/platform/organizations
func (s *Server) HandlePlatformListOrganizations(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.ListOrganizations(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "platform orgs")
		return
	}
	out := make([]PlatformOrgDTO, 0, len(list))
	for _, o := range list {
		members, _ := s.Store.ListOrgTeam(r.Context(), o.ID)
		out = append(out, toPlatformOrgDTO(o, len(members)))
	}
	respondWithJSON(w, http.StatusOK, out)
}

// POST /api/platform/organizations {name, slug, type?, license_plan?, license_expires_at?, clone_catalog_from?}
func (s *Server) HandlePlatformCreateOrganization(w http.ResponseWriter, r *http.Request) {
	var body openapi.CreatePlatformOrganizationRequest
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
	var licenseExpiresAt *time.Time
	if body.LicenseExpiresAt != nil {
		parsed, err := time.Parse(time.RFC3339, *body.LicenseExpiresAt)
		if err != nil {
			respondWithError(w, http.StatusBadRequest, "license_expires_at inválido (formato ISO 8601 requerido)")
			return
		}
		licenseExpiresAt = &parsed
	}

	org := &domain.Organization{
		Name:             strings.TrimSpace(body.Name),
		Slug:             strings.TrimSpace(body.Slug),
		Type:             orgType,
		LicensePlan:      plan,
		LicenseExpiresAt: licenseExpiresAt,
		Active:           true,
	}
	if err := s.Store.CreateOrganization(r.Context(), org); err != nil {
		respondWithInternalError(w, err, "platform create org")
		return
	}

	// Optional base-catalog clone (defaults to the initial organization).
	if body.CloneCatalogFrom != nil && strings.TrimSpace(*body.CloneCatalogFrom) != "" {
		src := strings.TrimSpace(*body.CloneCatalogFrom)
		srcOrg, err := s.Store.GetOrganizationByID(r.Context(), src)
		if err != nil {
			srcOrg, err = s.Store.GetOrganizationBySlug(r.Context(), src)
		}
		if err != nil || srcOrg == nil {
			respondWithError(w, http.StatusBadRequest, "organización origen de clonación no encontrada")
			return
		}
		if err := s.Store.CloneCatalog(r.Context(), srcOrg.ID, org.ID); err != nil {
			respondWithInternalError(w, err, "clone base catalog")
			return
		}
	}

	s.audit(r.Context(), "organization_created", claims.UserID, org.ID, clientIP(r), map[string]interface{}{
		"name": org.Name, "slug": org.Slug, "type": string(org.Type), "source": "platform console",
	})
	respondWithJSON(w, http.StatusCreated, toPlatformOrgDTO(*org, 0))
}

// PATCH /api/platform/organizations/{id} {name?, license_plan?, license_expires_at?, active?}
func (s *Server) HandlePlatformUpdateOrganization(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	expectedVersion, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	var raw map[string]json.RawMessage
	if !decodeJSONBody(w, r, &raw) {
		return
	}
	org, err := s.Store.GetOrganizationByID(r.Context(), id)
	if err != nil || org == nil {
		respondWithError(w, http.StatusNotFound, "organización no encontrada")
		return
	}
	claims := claimsFromRequest(r)

	var nameChanged bool
	var previousName string
	if rawName, ok := raw["name"]; ok {
		var name string
		if err := json.Unmarshal(rawName, &name); err != nil {
			respondWithError(w, http.StatusBadRequest, "name inválido")
			return
		}
		if strings.TrimSpace(name) == "" {
			respondWithError(w, http.StatusBadRequest, "el nombre no puede estar vacío")
			return
		}
		previousName = org.Name
		nameChanged = true
		org.Name = strings.TrimSpace(name)
	}

	var planChanged bool
	if rawPlan, ok := raw["license_plan"]; ok {
		var planStr string
		if err := json.Unmarshal(rawPlan, &planStr); err != nil {
			respondWithError(w, http.StatusBadRequest, "license_plan inválido")
			return
		}
		plan := domain.LicensePlan(planStr)
		if !domain.IsValidLicensePlan(plan) {
			respondWithError(w, http.StatusBadRequest, "license_plan inválido")
			return
		}
		if org.LicensePlan != plan {
			planChanged = true
		}
		org.LicensePlan = plan
	}

	var expiryChanged bool
	if rawExpiry, ok := raw["license_expires_at"]; ok {
		expiryChanged = true
		if string(rawExpiry) == "null" || string(rawExpiry) == `""` {
			org.LicenseExpiresAt = nil
		} else {
			var t time.Time
			if err := json.Unmarshal(rawExpiry, &t); err != nil {
				respondWithError(w, http.StatusBadRequest, "license_expires_at inválido (formato ISO 8601 requerido)")
				return
			}
			org.LicenseExpiresAt = &t
		}
	}

	var activeChanged bool
	if rawActive, ok := raw["active"]; ok {
		var active bool
		if err := json.Unmarshal(rawActive, &active); err != nil {
			respondWithError(w, http.StatusBadRequest, "active inválido")
			return
		}
		if org.Active != active {
			activeChanged = true
		}
		org.Active = active
	}

	if err := s.Store.UpdateOrganizationVersion(r.Context(), org, expectedVersion); err != nil {
		if errors.Is(err, storage.ErrVersionConflict) {
			respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "La organización fue modificada por otra sesión", nil)
			return
		}
		respondWithInternalError(w, err, "platform update org")
		return
	}

	if nameChanged {
		s.audit(r.Context(), "organization_renamed", claims.UserID, org.ID, clientIP(r), map[string]interface{}{
			"previous_name": previousName,
			"name":          org.Name,
		})
	}
	if activeChanged {
		event := "organization_suspended"
		if org.Active {
			event = "organization_reactivated"
		}
		details := map[string]interface{}{}
		if !org.Active {
			// Suspending cuts every open support session immediately — the
			// schema reserves ended_via='org_suspended' for this (000086).
			ended, err := s.Store.EndOpenSupportSessionsByOrg(r.Context(), org.ID, "org_suspended")
			if err != nil {
				respondWithInternalError(w, err, "platform suspend: end support sessions")
				return
			}
			if ended > 0 {
				details["support_sessions_ended"] = ended
			}
		}
		s.audit(r.Context(), event, claims.UserID, org.ID, clientIP(r), details)
	}
	if planChanged || expiryChanged {
		s.audit(r.Context(), "organization_license_updated", claims.UserID, org.ID, clientIP(r), map[string]interface{}{
			"license_plan":       string(org.LicensePlan),
			"license_expires_at": org.LicenseExpiresAt,
		})
	}
	members, _ := s.Store.ListOrgTeam(r.Context(), org.ID)
	w.Header().Set("ETag", FormatVersionETag(org.Version))
	respondWithJSON(w, http.StatusOK, toPlatformOrgDTO(*org, len(members)))
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
	out := make([]openapi.PlatformUser, 0, len(users))
	for _, u := range users {
		ms, err := s.Store.ListMembershipsByUser(r.Context(), u.ID)
		if err != nil {
			respondWithInternalError(w, err, "platform users memberships")
			return
		}
		memberships := make([]openapi.PlatformUserMembership, 0, len(ms))
		for _, m := range ms {
			memberships = append(memberships, openapi.PlatformUserMembership{OrganizationID: m.OrganizationID, OrganizationName: m.Organization.Name, OrganizationSlug: m.Organization.Slug, Roles: roleStrings(m.Roles), Active: m.Active, Version: m.Version})
		}
		out = append(out, openapi.PlatformUser{ID: u.ID, Email: u.Email, Name: u.Name, PlatformAdmin: u.PlatformAdmin, Active: u.Active, CreatedAt: u.CreatedAt.UTC().Format(time.RFC3339Nano), Memberships: memberships})
	}
	respondWithJSON(w, http.StatusOK, out)
}

// POST /api/platform/organizations/{id}/support-session {reason}
// Issues the short-lived support token: effective admin of the organization,
// real actor = the platform admin, banner data included.
func (s *Server) HandlePlatformStartSupportSession(w http.ResponseWriter, r *http.Request) {
	orgID := r.PathValue("id")
	var body openapi.StartSupportSessionRequest
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
	respondWithJSON(w, http.StatusCreated, openapi.SupportSessionResponse{
		Token: token, SessionID: ss.ID, Reason: ss.Reason,
		ExpiresAt: ss.ExpiresAt.UTC().Format(time.RFC3339Nano), Organization: orgDTO, Support: true,
	})
}

// DELETE /api/platform/support-sessions/{sessionId} — explicit logout.
func (s *Server) HandlePlatformEndSupportSession(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	sessionID := r.PathValue("sessionId")

	// F179: attribute the end event to the organization the session was
	// opened into, so the org's audit viewer shows the complete
	// started/ended trail (an org-less event was invisible there).
	orgID := ""
	if ss, err := s.Store.GetOpenSupportSession(r.Context(), sessionID); err == nil && ss != nil {
		orgID = ss.OrganizationID
	}
	ended, err := s.Store.EndSupportSession(r.Context(), sessionID, claims.UserID, "logout")
	if err != nil {
		respondWithInternalError(w, err, "support session end")
		return
	}
	s.audit(r.Context(), "support_session_ended", claims.UserID, orgID, clientIP(r), map[string]interface{}{
		"session_id": sessionID, "via": "logout", "found": ended,
	})
	respondWithJSON(w, http.StatusOK, openapi.EndSupportSessionResponse{Ended: ended})
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
			Token: token, User: toOpenAPIUser(u), License: org.License,
			Roles: roles, Organization: &org, Memberships: []MembershipDTO{}, Transport: openapi.AuthTransportWeb,
		})
		return
	}
	orgless, err := auth.GenerateToken(u.ID, u.Email, auth.TokenContext{PlatformAdmin: u.PlatformAdmin}, s.JWTSecret)
	if err != nil {
		respondWithInternalError(w, err, "accept invitation orgless token")
		return
	}
	respondWithJSON(w, http.StatusOK, LoginResponse{
		Token: orgless, User: toOpenAPIUser(u), License: openapi.License{Plan: string(domain.LicensePlanNone), Status: string(domain.LicenseStatusNone)},
		Roles: []string{}, Memberships: toMembershipDTOs(memberships), SelectionRequired: true, Transport: openapi.AuthTransportWeb,
	})
}

// POST /api/auth/accept-invitation {token, password, name?} — public (rate
// limited at the route). Existing users authenticate with their password;
// new users are created active with the invitation as approval.
func (s *Server) HandleAcceptInvitation(w http.ResponseWriter, r *http.Request) {
	var body openapi.AcceptInvitationRequest
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

	createdUser := false
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
		name := ""
		if body.Name != nil {
			name = strings.TrimSpace(*body.Name)
		}
		if name == "" {
			name = strings.SplitN(inv.Email, "@", 2)[0]
		}
		u = &domain.User{Email: inv.Email, PasswordHash: hash, Name: name, Active: true}
		if err := s.Store.CreateUser(r.Context(), u); err != nil {
			respondWithInternalError(w, err, "accept invitation create user")
			return
		}
		createdUser = true
	}

	if err := s.Store.AcceptInvitationTx(r.Context(), inv.ID, u.ID); err != nil {
		// A user created in THIS request that failed to attach to any org
		// would be orphaned (active, member of nothing, unable to log in).
		// Clean it up before failing; existing users are left untouched.
		if createdUser {
			_ = s.Store.DeleteOrphanInvitedUser(r.Context(), u.ID)
		}
		s.audit(r.Context(), "invitation_accept_failed", u.ID, inv.OrganizationID, clientIP(r), map[string]interface{}{
			"reason": "invitation no longer open",
		})
		respondWithError(w, http.StatusConflict, "la invitación ya no está disponible")
		return
	}
	s.audit(r.Context(), "invitation_accepted", u.ID, inv.OrganizationID, clientIP(r), map[string]interface{}{
		"invitation_id": inv.ID, "email": inv.Email,
	})
	s.acceptInvitationLogin(w, r, u)
}
