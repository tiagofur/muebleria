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
	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// PlatformAdminMiddleware requires the platform staff flag.
func PlatformAdminMiddleware(tokens *auth.Authority, users MembershipLookup) func(http.Handler) http.Handler {
	authMW := AuthMiddleware(tokens, users)
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
		Status:               openapi.OrganizationStatus(o.Status),
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
	claims := claimsFromRequest(r)
	list, err := s.Store.ListOrganizations(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "platform orgs")
		return
	}
	out := make([]PlatformOrgDTO, 0, len(list))
	for _, o := range list {
		members, _ := s.Store.ListOrgTeam(r.Context(), o.ID, claims.UserID)
		out = append(out, toPlatformOrgDTO(o, len(members)))
	}
	respondWithJSON(w, http.StatusOK, out)
}

// PATCH /api/platform/organizations/{id} {name?, license_plan?, license_expires_at?}
func (s *Server) HandlePlatformUpdateOrganization(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	expectedVersion, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	var raw map[string]json.RawMessage
	if !decodeGeneratedJSONBody(w, r, &raw) {
		return
	}
	allowed := map[string]bool{"name": true, "license_plan": true, "license_expires_at": true}
	for key := range raw {
		if !allowed[key] {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
			return
		}
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
	if planChanged || expiryChanged {
		s.audit(r.Context(), "organization_license_updated", claims.UserID, org.ID, clientIP(r), map[string]interface{}{
			"license_plan":       string(org.LicensePlan),
			"license_expires_at": org.LicenseExpiresAt,
		})
	}
	members, _ := s.Store.ListOrgTeam(r.Context(), org.ID, claims.UserID)
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
			memberships = append(memberships, openapi.PlatformUserMembership{OrganizationID: m.OrganizationID, OrganizationName: m.Organization.Name, OrganizationSlug: m.Organization.Slug, Roles: roleStrings(m.Roles), Status: openapi.MembershipStatus(m.Status), Version: m.Version})
		}
		out = append(out, openapi.PlatformUser{ID: u.ID, Email: u.Email, Name: u.Name, PlatformAdmin: u.PlatformAdmin, AccountStatus: openapi.AccountStatus(u.AccountStatus), CreatedAt: u.CreatedAt.UTC().Format(time.RFC3339Nano), Memberships: memberships})
	}
	respondWithJSON(w, http.StatusOK, out)
}

func (s *Server) HandlePlatformAccountStatus(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	var body openapi.UpdateAccountStatusRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	reason := strings.TrimSpace(body.Reason)
	status := domain.AccountStatus(body.AccountStatus)
	if reason == "" || (status != domain.AccountStatusActive && status != domain.AccountStatusDisabled) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "account_status y reason son obligatorios", nil)
		return
	}
	u, err := s.Store.UpdateAccountStatus(r.Context(), claims.UserID, r.PathValue("userId"), status, reason, clientIP(r))
	if errors.Is(err, storage.ErrAccountNotFound) {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeAccountNotFound, "cuenta no encontrada", nil)
		return
	}
	if err != nil {
		respondWithInternalError(w, err, "platform account status")
		return
	}
	respondWithJSON(w, http.StatusOK, openapi.AccountStatusMutationResponse{
		UserID: u.ID, AccountStatus: openapi.AccountStatus(u.AccountStatus), UpdatedAt: u.UpdatedAt.UTC().Format(time.RFC3339Nano),
	})
}

func (s *Server) HandlePlatformUserCommand(w http.ResponseWriter, r *http.Request) {
	command := r.PathValue("userCommand")
	if !strings.HasSuffix(command, ":set-account-status") {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "ruta no encontrada", nil)
		return
	}
	r.SetPathValue("userId", strings.TrimSuffix(command, ":set-account-status"))
	s.RequireIdempotency("platform.set-account-status", http.HandlerFunc(s.HandlePlatformAccountStatus)).ServeHTTP(w, r)
}

// POST /api/platform/organizations/{id}/support-session {reason}
// Issues the short-lived support token: effective admin of the organization,
// real actor = the platform admin, banner data included.
func (s *Server) HandlePlatformStartSupportSession(w http.ResponseWriter, r *http.Request) {
	orgID := r.PathValue("id")
	var body openapi.StartSupportSessionRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	if len(strings.TrimSpace(body.Reason)) < 4 {
		respondWithError(w, http.StatusBadRequest, "la razón del acceso de soporte es obligatoria (mínimo 4 caracteres)")
		return
	}
	claims := claimsFromRequest(r)
	service, ok := s.organizationService(w)
	if !ok {
		return
	}
	result, err := service.StartSupportSession(r.Context(), application.StartSupportSessionCommand{
		OrganizationID: orgID, ActorUserID: claims.UserID,
		Reason: strings.TrimSpace(body.Reason), TTL: auth.SupportTokenTTL,
		IP: clientIP(r), RequestID: RequestIDFromContext(r.Context()),
	})
	if errors.Is(err, application.ErrOrganizationStatusConflict) || errors.Is(err, storage.ErrOrganizationNotFound) {
		respondWithError(w, http.StatusNotFound, "organización no encontrada o suspendida")
		return
	}
	if err != nil {
		respondWithInternalError(w, err, "support session start")
		return
	}
	ss := result.Session
	// Registry row for the support credential (#460): client_type=support
	// linked to the audited support_sessions row. The ver5 token carries this
	// sid, so revoking the registry session cuts the support credential even
	// before its own 2h expiry.
	authSession, err := s.createAuthSession(r.Context(), storage.CreateAuthSessionCommand{
		UserID:            claims.UserID,
		OrganizationID:    result.Organization.ID,
		SupportSessionID:  ss.ID,
		ClientType:        domain.SessionClientSupport,
		AbsoluteExpiresAt: ss.ExpiresAt,
	})
	if err != nil {
		respondWithInternalError(w, err, "support session registry")
		return
	}
	token, err := s.tokenAuthority().IssueSupportToken(claims.UserID, claims.Email, auth.SupportClaims{
		OrgID: result.Organization.ID, SessionID: ss.ID, Reason: ss.Reason,
		OrganizationCredentialVersion: ss.OrganizationCredentialVersion,
	}, authSession.ID)
	if err != nil {
		respondWithInternalError(w, err, "support token")
		return
	}

	orgDTO := toOrgSummaryDTO(result.Organization)
	respondWithJSON(w, http.StatusCreated, openapi.SupportSessionResponse{
		Token: token, SessionID: ss.ID, Reason: ss.Reason,
		ExpiresAt: ss.ExpiresAt.UTC().Format(time.RFC3339Nano), Organization: orgDTO, Support: true,
	})
}

// DELETE /api/platform/support-sessions/{sessionId} — explicit logout.
func (s *Server) HandlePlatformEndSupportSession(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	sessionID := r.PathValue("sessionId")

	service, ok := s.organizationService(w)
	if !ok {
		return
	}
	ended, err := service.EndSupportSession(r.Context(), application.EndSupportSessionCommand{
		SessionID: sessionID, ActorUserID: claims.UserID,
		IP: clientIP(r), RequestID: RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithInternalError(w, err, "support session end")
		return
	}
	respondWithJSON(w, http.StatusOK, openapi.EndSupportSessionResponse{Ended: ended})
}

// POST /api/auth/invitations:accept is invite-only onboarding. The storage
// command owns the exact-token lock, identity/membership mutation and required
// audit writes in the same idempotency transaction.
func (s *Server) HandleAcceptInvitation(w http.ResponseWriter, r *http.Request) {
	var body openapi.AcceptInvitationRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.Token) == "" || body.Password == "" {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "token y password son obligatorios", nil)
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
	result, err := s.Store.AcceptInvitation(r.Context(), storage.AcceptInvitationCommand{TokenHash: hashInvitationToken(strings.TrimSpace(body.Token)), Password: body.Password, NewPasswordHash: hash, Name: name, IP: clientIP(r)}, auth.CheckPasswordHash, auth.ValidatePassword)
	if err != nil {
		switch {
		case errors.Is(err, storage.ErrInvitationNotFound):
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeInvitationNotFound, "invitación inválida o no disponible", nil)
		case errors.Is(err, storage.ErrInvitationExpired):
			respondWithAPIError(w, http.StatusGone, openapi.ApiErrorCodeInvitationExpired, "la invitación expiró", nil)
		case errors.Is(err, storage.ErrInvitationRevoked):
			respondWithAPIError(w, http.StatusGone, openapi.ApiErrorCodeInvitationRevoked, "la invitación fue revocada", nil)
		case errors.Is(err, storage.ErrInvitationAlreadyUsed):
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeInvitationAlreadyUsed, "la invitación ya fue usada", nil)
		case errors.Is(err, storage.ErrInvitationTokenRotated):
			respondWithAPIError(w, http.StatusGone, openapi.ApiErrorCodeInvitationTokenRotated, "el token fue reemplazado", nil)
		case errors.Is(err, storage.ErrAccountDisabled):
			respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeAccountDisabled, "credenciales inválidas", nil)
		case errors.Is(err, storage.ErrInvalidInvitationCredentials):
			respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeUnauthorized, "credenciales inválidas", nil)
		case errors.Is(err, storage.ErrInvitationNameRequired):
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "name es obligatorio para una cuenta nueva", map[string]any{"fieldErrors": map[string]string{"name": "required"}})
		case errors.Is(err, storage.ErrInvitationPasswordInvalid):
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "la contraseña nueva no cumple la política de seguridad", nil)
		case errors.Is(err, storage.ErrMembershipAlreadyActive):
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeMembershipAlreadyActive, "la membresía ya está activa", nil)
		default:
			respondWithInternalError(w, err, "accept invitation")
		}
		return
	}
	roles := roleStrings(result.Membership.Roles)
	// Invitation acceptance is a fresh login (#450): it registers the session
	// and returns the sid alongside the ver5 token like /auth/login does.
	session, refresh, err := s.createRefreshableAuthSession(r.Context(), storage.CreateAuthSessionCommand{
		UserID:            result.User.ID,
		MembershipID:      result.Membership.ID,
		OrganizationID:    result.Organization.ID,
		ClientType:        domain.SessionClientWeb,
		AbsoluteExpiresAt: time.Now().Add(auth.TransportSessionTTL("web")),
		DeviceHint:        sanitizeDeviceHint(r.UserAgent()),
	})
	if err != nil {
		respondWithInternalError(w, err, "accept invitation session")
		return
	}
	// SEC-4B: web mints REQUIRE the registry's absolute cap.
	token, err := s.tokenAuthority().IssueTransportTokenUntil(result.User.ID, result.User.Email, auth.TokenContext{Roles: roles, OrgID: result.Organization.ID, MembershipID: result.Membership.ID, MembershipCredentialVersion: result.Membership.CredentialVersion, OrganizationCredentialVersion: result.Organization.CredentialVersion, PlatformAdmin: result.User.PlatformAdmin, SessionID: session.ID}, "web", session.AbsoluteExpiresAt)
	if err != nil {
		respondWithInternalError(w, err, "accept invitation token")
		return
	}
	org := toOrgSummaryDTO(result.Organization)
	membership := MembershipDTO{ID: result.Membership.ID, OrganizationID: result.Membership.OrganizationID, UserID: result.Membership.UserID, Status: openapi.MembershipStatus(result.Membership.Status), Roles: roles, JoinedAt: result.Membership.JoinedAt.UTC().Format(time.RFC3339Nano), Version: result.Membership.Version, Organization: org}
	// Invitation acceptance is Web onboarding today (no mobile caller), so the
	// first refresh credential is delivered through the SEC-4A Web cookie —
	// the raw secret never appears in the response body. A future mobile
	// acceptance flow must add an explicit transport to this contract first.
	response := LoginResponse{Token: token, SessionID: &session.ID, User: toOpenAPIUser(&result.User), License: org.License, Roles: roles, Organization: &org, Memberships: []MembershipDTO{membership}, SelectionRequired: false, Transport: openapi.AuthTransportWeb}
	s.attachRefreshCredential(w, &response, refresh, domain.SessionClientWeb, session)
	setAuthExpiryMetadata(&response, time.Time{}, openapi.AuthTransportWeb, &session.AbsoluteExpiresAt)
	respondWithJSON(w, http.StatusOK, response)
}
