package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// actorCanViewCosts resolves COST-01/COST-02 for the request actor (F039 + F044).
func (s *Server) actorCanViewCosts(r *http.Request) bool {
	roles := actorRoles(claimsFromRequest(r))
	ws, err := s.Store.GetWorkshopSettings(r.Context())
	flag := false
	if err == nil {
		flag = ws.VendedorCanViewCosts
	}
	return domain.AnyRole(roles, func(r domain.UserRole) bool {
		return domain.RoleCanViewCosts(r, flag)
	})
}

// maxJSONBodyBytes caps request bodies to avoid OOM from huge payloads (issue #20).
const maxJSONBodyBytes = 1 << 20 // 1 MiB

type Server struct {
	Store          Store
	JWTSecret      string
	allowedOrigins []string
	rateLimitRPS   float64
	rateLimitBurst int
	// MediaDir filesystem root for catalog images (F040). Empty disables upload.
	MediaDir string
	// Tokens mints and validates ver5 credentials under the exact HS256 policy
	// (#460). When nil, a single-key authority is derived lazily from JWTSecret
	// (tests and minimal embedders); production always sets it from config so
	// issuer/keyring come from the environment.
	Tokens        *auth.Authority
	authorityOnce sync.Once
	lazyAuthority *auth.Authority
}

func NewServer(store Store, jwtSecret string, allowedOrigins []string, rateLimitRPS float64, rateLimitBurst int) *Server {
	return &Server{
		Store:          store,
		JWTSecret:      jwtSecret,
		allowedOrigins: allowedOrigins,
		rateLimitRPS:   rateLimitRPS,
		rateLimitBurst: rateLimitBurst,
	}
}

// NewServerWithMedia is NewServer plus media storage directory (F040).
func NewServerWithMedia(store Store, jwtSecret string, allowedOrigins []string, rateLimitRPS float64, rateLimitBurst int, mediaDir string) *Server {
	s := NewServer(store, jwtSecret, allowedOrigins, rateLimitRPS, rateLimitBurst)
	s.MediaDir = mediaDir
	return s
}

// tokenAuthority resolves the minting/validation authority. A server built
// with only a secret gets the implicit single-key ring under the legacy kid,
// matching the default config of a deployment without JWT_KEYRING.
func (s *Server) tokenAuthority() *auth.Authority {
	s.authorityOnce.Do(func() {
		if s.Tokens != nil {
			s.lazyAuthority = s.Tokens
			return
		}
		keyring, err := auth.SingleKeyKeyring(s.JWTSecret)
		if err != nil {
			panic("auth: invalid server JWT secret: " + err.Error())
		}
		authority, err := auth.NewAuthority(keyring, "")
		if err != nil {
			panic("auth: building token authority: " + err.Error())
		}
		s.lazyAuthority = authority
	})
	return s.lazyAuthority
}

// sessionClientType maps the login transport to the registry client type.
func sessionClientType(transport string) domain.SessionClientType {
	switch transport {
	case "mobile":
		return domain.SessionClientMobile
	case "sketchup":
		return domain.SessionClientSketchup
	default:
		return domain.SessionClientWeb
	}
}

// sanitizeDeviceHint reduces a User-Agent to a short, whitespace-collapsed
// hint. The registry stores sanitized metadata only — never free-form PII.
func sanitizeDeviceHint(userAgent string) string {
	hint := strings.Join(strings.Fields(userAgent), " ")
	runes := []rune(hint)
	if len(runes) > 120 {
		runes = runes[:120]
	}
	return string(runes)
}

// createAuthSession inserts a registry row inside a tenant transaction that
// carries the owning user, so the RLS insert policy (app.user_id = user_id)
// holds. Public routes (login, invitation accept) establish that context here
// right after validating credentials; routes already wrapped by AuthMiddleware
// reuse their ambient transaction.
func (s *Server) createAuthSession(ctx context.Context, cmd storage.CreateAuthSessionCommand) (*domain.AuthSession, error) {
	if runner, ok := s.Store.(tenantTransactionRunner); ok {
		var session *domain.AuthSession
		err := runner.WithinTenantTx(ctx, storage.TenantActor{
			UserID:         cmd.UserID,
			OrganizationID: cmd.OrganizationID,
		}, func(txCtx context.Context) error {
			created, err := s.Store.CreateAuthSession(txCtx, cmd)
			session = created
			return err
		})
		if err != nil {
			return nil, err
		}
		return session, nil
	}
	return s.Store.CreateAuthSession(ctx, cmd)
}

// Helpers para JSON
func respondWithError(w http.ResponseWriter, code int, message string) {
	respondWithAPIError(w, code, defaultErrorCode(code), message, nil)
}

func respondWithJSON(w http.ResponseWriter, code int, payload interface{}) {
	response, err := json.Marshal(payload)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal server error"))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	w.Write(response)
}

// respondWithInternalError logs the real error server-side via structured slog
// but returns a generic message to the client. Internal error strings (DB driver text,
// constraint names, etc.) must never reach the client (#5).
func respondWithInternalError(w http.ResponseWriter, err error, op string) {
	if total, denied := storage.RecordRLSDenial(err); denied {
		slog.Warn("postgres authorization denied", "op", op, "sqlstate", "42501", "rls_denial_total", total, "request_id", requestIDFromWriter(w))
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}
	slog.Error("internal server error", "op", op, "error", err, "request_id", requestIDFromWriter(w))
	respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
}

// decodeJSONBody limits the request body and decodes JSON into dst.
// On failure it writes an error response and returns false (issue #20).
func decodeJSONBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	return decodeJSONBodyWithPolicy(w, r, dst, false)
}

// decodeGeneratedJSONBody is the request-side counterpart of the generated
// response validator. It is intentionally used only by migrated OpenAPI
// operations so legacy endpoints keep their published compatibility surface.
func decodeGeneratedJSONBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	return decodeJSONBodyWithPolicy(w, r, dst, true)
}

func decodeJSONBodyWithPolicy(w http.ResponseWriter, r *http.Request, dst any, rejectUnknown bool) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
	dec := json.NewDecoder(r.Body)
	if rejectUnknown {
		dec.DisallowUnknownFields()
	}
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			respondWithError(w, http.StatusRequestEntityTooLarge, "request body too large")
			return false
		}
		// EOF / unexpected EOF also map to invalid body.
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
			return false
		}
		respondWithError(w, http.StatusBadRequest, "invalid request body")
		return false
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		respondWithError(w, http.StatusBadRequest, "request body must contain exactly one JSON value")
		return false
	}
	return true
}

// --- AUTH ---

type loginCredentials struct {
	Email, Password, Org string
	Transport            openapi.LoginTransport
}

func decodeLoginCredentials(w http.ResponseWriter, r *http.Request) (loginCredentials, bool) {
	var wire struct {
		Email     string                  `json:"email"`
		Password  string                  `json:"password"`
		Transport *openapi.LoginTransport `json:"transport,omitempty"`
		Org       *string                 `json:"org,omitempty"`
	}
	if !decodeGeneratedJSONBody(w, r, &wire) {
		return loginCredentials{}, false
	}
	if wire.Transport == nil {
		respondWithError(w, http.StatusBadRequest, "auth transport is required")
		return loginCredentials{}, false
	}
	transport := *wire.Transport
	switch transport {
	case openapi.LoginTransportWeb, openapi.LoginTransportMobile, openapi.LoginTransportSketchup:
	default:
		respondWithError(w, http.StatusBadRequest, "invalid auth transport")
		return loginCredentials{}, false
	}
	if wire.Email == "" || wire.Password == "" {
		respondWithError(w, http.StatusBadRequest, "email and password are required")
		return loginCredentials{}, false
	}
	org := ""
	if wire.Org != nil {
		org = *wire.Org
	}
	return loginCredentials{Email: wire.Email, Password: wire.Password, Org: org, Transport: transport}, true
}

func authTransportFromClaims(claims *auth.Claims) openapi.AuthTransport {
	if claims.Support != nil {
		return openapi.AuthTransportSupport
	}
	switch openapi.AuthTransport(claims.Transport) {
	case openapi.AuthTransportWeb, openapi.AuthTransportMobile, openapi.AuthTransportSketchup:
		return openapi.AuthTransport(claims.Transport)
	}
	// Finite compatibility for tokens issued before #448. Their maximum life is
	// 30 days (SketchUp); all other missing-transport tokens were web sessions.
	if claims.Client == auth.ExtensionClient {
		return openapi.AuthTransportSketchup
	}
	return openapi.AuthTransportWeb
}

// PublicUserDTO is the safe public representation of a user, guaranteeing
// that internal secrets (such as password hashes) are never serialized (OC-005).
// PublicUserDTO is the identity projection: roles live in the membership
// (sent as the `roles` sibling in auth responses) and licensing in the
// organization — users.role/users.license_* were dropped (000090).
type PublicUserDTO struct {
	ID            string               `json:"id"`
	Email         string               `json:"email"`
	Name          string               `json:"name"`
	AccountStatus domain.AccountStatus `json:"account_status"`
	PlatformAdmin bool                 `json:"platform_admin"`
	CreatedAt     time.Time            `json:"created_at"`
	UpdatedAt     time.Time            `json:"updated_at"`
}

func ToPublicUserDTO(u *domain.User) PublicUserDTO {
	if u == nil {
		return PublicUserDTO{}
	}
	return PublicUserDTO{
		ID:            u.ID,
		Email:         u.Email,
		Name:          u.Name,
		AccountStatus: u.AccountStatus,
		PlatformAdmin: u.PlatformAdmin,
		CreatedAt:     u.CreatedAt,
		UpdatedAt:     u.UpdatedAt,
	}
}

func ToPublicUserDTOs(users []domain.User) []PublicUserDTO {
	if users == nil {
		return []PublicUserDTO{}
	}
	out := make([]PublicUserDTO, len(users))
	for i, u := range users {
		out[i] = ToPublicUserDTO(&u)
	}
	return out
}

func toOpenAPIUser(u *domain.User) openapi.User {
	created, updated := u.CreatedAt.UTC().Format(time.RFC3339Nano), u.UpdatedAt.UTC().Format(time.RFC3339Nano)
	out := openapi.User{ID: u.ID, Email: u.Email, NormalizedEmail: u.NormalizedEmail, Name: u.Name, AccountStatus: openapi.AccountStatus(u.AccountStatus), PlatformAdmin: u.PlatformAdmin, CreatedAt: created, UpdatedAt: updated}
	if u.EmailVerifiedAt != nil {
		value := u.EmailVerifiedAt.UTC().Format(time.RFC3339Nano)
		out.EmailVerifiedAt = &value
	}
	if u.LastLoginAt != nil {
		value := u.LastLoginAt.UTC().Format(time.RFC3339Nano)
		out.LastLoginAt = &value
	}
	return out
}

func toOpenAPIOrganization(o domain.Organization) openapi.OrganizationSummary {
	license := openapi.License{Plan: string(o.LicensePlan), Status: string(domain.LicenseStatusAt(o.LicensePlan, o.LicenseExpiresAt, time.Now()))}
	if o.LicenseExpiresAt != nil {
		value := o.LicenseExpiresAt.UTC().Format(time.RFC3339Nano)
		license.ExpiresAt = &value
	}
	return openapi.OrganizationSummary{ID: o.ID, Name: o.Name, Slug: o.Slug, Type: string(o.Type), Status: openapi.OrganizationStatus(o.Status), License: license}
}

type LicenseDTO = openapi.License
type LoginResponse = openapi.LoginResponse
type OrgSummaryDTO = openapi.OrganizationSummary
type MembershipDTO = openapi.Membership

func toOrgSummaryDTO(o domain.Organization) OrgSummaryDTO {
	return toOpenAPIOrganization(o)
}

func toMembershipDTOs(list []domain.MembershipWithOrg) []MembershipDTO {
	out := make([]MembershipDTO, 0, len(list))
	for _, m := range list {
		if m.Status != domain.MembershipStatusActive || m.Organization.Status != domain.OrganizationStatusActive {
			continue
		}
		roles := make([]string, len(m.Roles))
		for i, role := range m.Roles {
			roles[i] = string(role)
		}
		out = append(out, MembershipDTO{
			ID: m.ID, OrganizationID: m.OrganizationID, UserID: m.UserID,
			Status: openapi.MembershipStatus(m.Status), Roles: roles,
			JoinedAt:     m.JoinedAt.UTC().Format(time.RFC3339Nano),
			Organization: toOrgSummaryDTO(m.Organization), Version: m.Version,
		})
	}
	return out
}

func (s *Server) audit(ctx context.Context, eventType, actorUserID, organizationID, ip string, details map[string]interface{}) {
	// Best-effort: an audit write failure must not fail the request; it is
	// logged server-side instead.
	if details == nil {
		details = map[string]interface{}{}
	}
	if requestID := RequestIDFromContext(ctx); requestID != "" {
		details["request_id"] = requestID
	}
	if err := s.Store.InsertSecurityAuditEvent(ctx, storage.SecurityAuditEvent{
		EventType:      eventType,
		ActorUserID:    actorUserID,
		OrganizationID: organizationID,
		IP:             ip,
		Details:        details,
	}); err != nil {
		slog.Warn("security audit write failed", "event_type", eventType, "error", err)
	}
}

func (s *Server) auditRequired(ctx context.Context, eventType, actorUserID, organizationID, ip string, details map[string]interface{}) error {
	if details == nil {
		details = map[string]interface{}{}
	}
	if requestID := RequestIDFromContext(ctx); requestID != "" {
		details["request_id"] = requestID
	}
	return s.Store.InsertSecurityAuditEvent(ctx, storage.SecurityAuditEvent{
		EventType: eventType, ActorUserID: actorUserID, OrganizationID: organizationID, IP: ip, Details: details,
	})
}

func (s *Server) HandleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	req, ok := decodeLoginCredentials(w, r)
	if !ok {
		return
	}
	transport, orgHint := req.Transport, req.Org

	// Uniform 401 for not found, wrong password, or a disabled account so clients
	// cannot enumerate accounts (issue #19). Dummy bcrypt when user missing
	// keeps response timing closer to the password-check path.
	const invalidCreds = "invalid email or password"

	failLogin := func(userID string) {
		s.audit(r.Context(), "login_failed", userID, "", clientIP(r), map[string]interface{}{
			"transport": transport,
		})
		respondWithError(w, http.StatusUnauthorized, invalidCreds)
	}

	u, err := s.Store.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		_ = auth.CheckPasswordHash(req.Password, auth.DummyHash)
		failLogin("")
		return
	}

	if !auth.CheckPasswordHash(req.Password, u.PasswordHash) || u.AccountStatus != domain.AccountStatusActive {
		failLogin(u.ID)
		return
	}

	memberships, err := s.Store.ListMembershipsByUser(r.Context(), u.ID)
	if err != nil {
		respondWithInternalError(w, err, "login: memberships")
		return
	}

	// Resolve the active organization: explicit slug hint wins, then the
	// single membership, then a selection is required. Platform staff without
	// any membership gets an org-less console token.
	var chosen *domain.MembershipWithOrg
	if orgHint != "" {
		for i := range memberships {
			if memberships[i].Organization.Slug == orgHint {
				chosen = &memberships[i]
				break
			}
		}
		if chosen == nil {
			failLogin(u.ID)
			return
		}
	} else if len(memberships) == 1 {
		chosen = &memberships[0]
	}

	if chosen == nil && len(memberships) > 1 {
		// Multi-organization user without a hint: an org-less token is issued
		// ONLY to complete /api/auth/select-org (it carries no business scope
		// — the middleware denies data access to org-less non-staff tokens).
		session, err := s.createAuthSession(r.Context(), storage.CreateAuthSessionCommand{
			UserID:            u.ID,
			ClientType:        sessionClientType(string(transport)),
			AbsoluteExpiresAt: time.Now().Add(auth.TransportSessionTTL(string(transport))),
			DeviceHint:        sanitizeDeviceHint(r.UserAgent()),
		})
		if err != nil {
			respondWithInternalError(w, err, "login: create session")
			return
		}
		orgless, err := s.tokenAuthority().IssueTransportToken(u.ID, u.Email, auth.TokenContext{
			PlatformAdmin: u.PlatformAdmin, SessionID: session.ID,
		}, string(transport))
		if err != nil {
			respondWithInternalError(w, err, "login: generate orgless token")
			return
		}
		if err := s.Store.UpdateLastLogin(r.Context(), u.ID); err != nil {
			respondWithInternalError(w, err, "login: update last login")
			return
		}
		s.audit(r.Context(), "login_success", u.ID, "", clientIP(r), map[string]interface{}{
			"transport": transport, "selection_required": true, "session_id": session.ID,
		})
		respondWithJSON(w, http.StatusOK, LoginResponse{
			Token:             orgless,
			SessionID:         &session.ID,
			User:              toOpenAPIUser(u),
			License:           LicenseDTO{Plan: string(domain.LicensePlanNone), Status: string(domain.LicenseStatusNone)},
			Roles:             []string{},
			Memberships:       toMembershipDTOs(memberships),
			SelectionRequired: true,
			Transport:         openapi.AuthTransport(transport),
		})
		return
	}

	if chosen == nil && !u.PlatformAdmin {
		// No membership and not platform staff: nothing to log in to.
		s.audit(r.Context(), "login_failed", u.ID, "", clientIP(r), map[string]interface{}{
			"transport": transport, "reason": "no_membership",
		})
		respondWithError(w, http.StatusForbidden, "tu cuenta no pertenece a ningún taller todavía. Pedile al administrador que te asigne.")
		return
	}

	tc := auth.TokenContext{PlatformAdmin: u.PlatformAdmin}
	var orgDTO *OrgSummaryDTO
	var license LicenseDTO
	if chosen != nil {
		roles := make([]string, len(chosen.Roles))
		for i, rl := range chosen.Roles {
			roles[i] = string(rl)
		}
		tc.Roles = roles
		tc.OrgID = chosen.OrganizationID
		tc.MembershipID = chosen.ID
		tc.MembershipCredentialVersion = chosen.CredentialVersion
		tc.OrganizationCredentialVersion = chosen.Organization.CredentialVersion
		sum := toOrgSummaryDTO(chosen.Organization)
		orgDTO = &sum
		license = sum.License
	} else {
		license = LicenseDTO{Plan: string(domain.LicensePlanNone), Status: string(domain.LicenseStatusNone)}
	}

	// Registry row first: the ver5 token embeds its sid, and the row's
	// absolute_expires_at is the authoritative 18h/#441 bound refresh can
	// never extend.
	session, err := s.createAuthSession(r.Context(), storage.CreateAuthSessionCommand{
		UserID:            u.ID,
		MembershipID:      tc.MembershipID,
		OrganizationID:    tc.OrgID,
		ClientType:        sessionClientType(string(transport)),
		AbsoluteExpiresAt: time.Now().Add(auth.TransportSessionTTL(string(transport))),
		DeviceHint:        sanitizeDeviceHint(r.UserAgent()),
	})
	if err != nil {
		respondWithInternalError(w, err, "login: create session")
		return
	}
	tc.SessionID = session.ID

	var token string
	token, err = s.tokenAuthority().IssueTransportToken(u.ID, u.Email, tc, string(transport))
	if err != nil {
		respondWithInternalError(w, err, "login: generate token")
		return
	}

	if err := s.Store.UpdateLastLogin(r.Context(), u.ID); err != nil {
		respondWithInternalError(w, err, "login: update last login")
		return
	}
	s.audit(r.Context(), "login_success", u.ID, tc.OrgID, clientIP(r), map[string]interface{}{
		"transport": transport, "session_id": session.ID,
	})

	respondWithJSON(w, http.StatusOK, LoginResponse{
		Token:             token,
		SessionID:         &session.ID,
		User:              toOpenAPIUser(u),
		License:           license,
		Roles:             tc.Roles,
		Organization:      orgDTO,
		Memberships:       toMembershipDTOs(memberships),
		SelectionRequired: false,
		Transport:         openapi.AuthTransport(transport),
	})
}

// HandleSelectOrg: POST /api/auth/select-org {organization_id}
// Exchanges an authenticated (usually org-less) token for one scoped to the
// chosen organization, after re-validating the live membership.
func (s *Server) HandleSelectOrg(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	claims, ok := r.Context().Value(UserContextKey).(*auth.Claims)
	if !ok || claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	var body openapi.SelectOrganizationRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	if body.OrganizationID == "" {
		respondWithError(w, http.StatusBadRequest, "missing organization_id")
		return
	}

	m, err := s.Store.GetActiveMembership(r.Context(), claims.UserID, body.OrganizationID)
	if err != nil {
		if !errors.Is(err, storage.ErrMembershipNotFound) {
			respondWithInternalError(w, err, "select organization membership")
			return
		}
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeMembershipNotSelectable, "no tenés membresía activa en ese taller", nil)
		return
	}
	if m == nil {
		respondWithInternalError(w, errors.New("active membership lookup returned no result"), "select organization membership")
		return
	}
	if m.Status != domain.MembershipStatusActive || m.Organization.Status != domain.OrganizationStatusActive || len(m.Roles) == 0 {
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeMembershipNotSelectable, "no tenés membresía activa en ese taller", nil)
		return
	}
	if setter, ok := s.Store.(tenantActorSetter); ok {
		ctx, err := setter.SetTenantActor(r.Context(), storage.TenantActor{
			OrganizationID: m.OrganizationID,
			UserID:         claims.UserID,
		})
		if err != nil {
			respondWithInternalError(w, err, "select-org: set tenant actor")
			return
		}
		r = r.WithContext(ctx)
	}

	roles := make([]string, len(m.Roles))
	for i, rl := range m.Roles {
		roles[i] = string(rl)
	}
	tc := auth.TokenContext{
		Roles: roles, OrgID: m.OrganizationID, MembershipID: m.ID,
		MembershipCredentialVersion: m.CredentialVersion, PlatformAdmin: claims.PlatformAdmin,
		OrganizationCredentialVersion: m.Organization.CredentialVersion,
		AuthStartedAt:                 claims.AuthStartedAt.Time,
	}
	transport := authTransportFromClaims(claims)
	if claims.Support != nil {
		respondWithError(w, http.StatusForbidden, "support sessions cannot change organization")
		return
	}

	// The registry session keeps its id across the switch: select-org updates
	// the active scope in place (#460 / ADR-0007). A ver4 token has no session
	// yet, so this exchange registers one now, preserving the absolute origin.
	if claims.Sid == "" {
		session, err := s.createAuthSession(r.Context(), storage.CreateAuthSessionCommand{
			UserID:            claims.UserID,
			MembershipID:      m.ID,
			OrganizationID:    m.OrganizationID,
			ClientType:        sessionClientType(string(transport)),
			AbsoluteExpiresAt: claims.AuthStartedAt.Time.Add(auth.TransportSessionTTL(string(transport))),
			DeviceHint:        sanitizeDeviceHint(r.UserAgent()),
		})
		if err != nil {
			respondWithInternalError(w, err, "select-org: create session")
			return
		}
		tc.SessionID = session.ID
	} else {
		if err := s.Store.UpdateAuthSessionScope(r.Context(), claims.Sid, m.ID, m.OrganizationID); err != nil {
			respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeSessionRevoked, "La sesión ya no está activa. Iniciá sesión de nuevo.", nil)
			return
		}
		tc.SessionID = claims.Sid
	}

	token, err := s.tokenAuthority().IssueTransportToken(claims.UserID, claims.Email, tc, string(transport))
	if err != nil {
		respondWithInternalError(w, err, "select-org: generate token")
		return
	}

	s.audit(r.Context(), "organization_selected", claims.UserID, m.OrganizationID, clientIP(r), map[string]interface{}{
		"session_id": tc.SessionID,
	})

	u, err := s.Store.GetUserByID(r.Context(), claims.UserID)
	if err != nil || u == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	org := toOrgSummaryDTO(m.Organization)
	sessionID := tc.SessionID
	respondWithJSON(w, http.StatusOK, LoginResponse{
		Token:        token,
		SessionID:    &sessionID,
		User:         toOpenAPIUser(u),
		License:      org.License,
		Roles:        rolesToStrings(m.Roles),
		Organization: &org,
		Memberships:  []MembershipDTO{},
		Transport:    transport,
	})
}

// HandleRefresh re-issues an access token for the authenticated user after
// AuthMiddleware has already re-validated role/active against the DB (issue #16).
// Clients should call this before AccessTokenTTL elapses to avoid re-login.
func (s *Server) HandleRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	claims, ok := r.Context().Value(UserContextKey).(*auth.Claims)
	if !ok || claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}

	// AuthMiddleware already loaded live role/active into claims; re-fetch for
	// a complete User payload in the response.
	u, err := s.Store.GetUserByID(r.Context(), claims.UserID)
	if err != nil || u == nil || u.AccountStatus != domain.AccountStatusActive {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}

	// Preserve the token kind (extension keeps read-only client + long TTL)
	// and the live organization scope; the middleware already refreshed the
	// membership roles into claims.
	tc := auth.TokenContext{
		Roles: claims.Roles, OrgID: claims.OrgID, MembershipID: claims.MembershipID,
		MembershipCredentialVersion:   claims.MembershipCredentialVersion,
		OrganizationCredentialVersion: claims.OrganizationCredentialVersion,
		PlatformAdmin:                 claims.PlatformAdmin, AuthStartedAt: claims.AuthStartedAt.Time,
		SessionID: claims.Sid,
	}
	transport := authTransportFromClaims(claims)

	// A ver4 refresh upgrades to the current credential version: the registry
	// row is created here, bounded by the ORIGINAL absolute origin so the
	// upgrade can never extend the session (#441/#445).
	if tc.SessionID == "" {
		cmd := storage.CreateAuthSessionCommand{
			UserID:            u.ID,
			MembershipID:      tc.MembershipID,
			OrganizationID:    tc.OrgID,
			ClientType:        sessionClientType(string(transport)),
			AbsoluteExpiresAt: claims.AuthStartedAt.Time.Add(auth.TransportSessionTTL(string(transport))),
			DeviceHint:        sanitizeDeviceHint(r.UserAgent()),
		}
		if claims.Support != nil {
			cmd = storage.CreateAuthSessionCommand{
				UserID:            u.ID,
				OrganizationID:    claims.Support.OrgID,
				SupportSessionID:  claims.Support.SessionID,
				ClientType:        domain.SessionClientSupport,
				AbsoluteExpiresAt: claims.AuthStartedAt.Time.Add(auth.SupportTokenTTL),
			}
		}
		upgraded, createErr := s.createAuthSession(r.Context(), cmd)
		if createErr != nil {
			respondWithInternalError(w, createErr, "refresh: create session")
			return
		}
		tc.SessionID = upgraded.ID
	}

	var token string
	if claims.Support != nil {
		token, err = s.tokenAuthority().IssueSupportTokenFrom(u.ID, u.Email, *claims.Support, claims.AuthStartedAt.Time, tc.SessionID)
	} else {
		token, err = s.tokenAuthority().IssueTransportToken(u.ID, u.Email, tc, string(transport))
	}
	if err != nil {
		respondWithInternalError(w, err, "refresh: generate token")
		return
	}

	resp := LoginResponse{
		Token:       token,
		SessionID:   &tc.SessionID,
		User:        toOpenAPIUser(u),
		Roles:       append([]string(nil), claims.Roles...),
		Memberships: []MembershipDTO{},
		License: LicenseDTO{
			Plan:   string(domain.LicensePlanNone),
			Status: string(domain.LicenseStatusNone),
		},
		Transport: transport,
	}
	if claims.OrgID != "" {
		if m, err := s.Store.GetActiveMembership(r.Context(), claims.UserID, claims.OrgID); err == nil && m != nil {
			org := toOrgSummaryDTO(m.Organization)
			resp.Organization = &org
			resp.License = org.License
		}
	}

	respondWithJSON(w, http.StatusOK, resp)
}

// --- CUSTOMERS ---

func (s *Server) HandleCustomers(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	id := actorID(claims)

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessCustomers), "no tenés permiso para ver clientes") {
			return
		}
		list, err := s.Store.ListCustomers(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, filterCustomersByOwner(list, id, roles))

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateCustomers), "no tenés permiso para crear clientes") {
			return
		}
		var c domain.Customer
		if !decodeJSONBody(w, r, &c) {
			return
		}
		c.Active = true
		c.OwnerUserID = domain.ResolveOwnerOnCreateRoles(id, roles, c.OwnerUserID)
		err := s.Store.CreateCustomer(r.Context(), &c)
		if err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El registro ya existe")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, c)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleCustomerByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing customer id")
		return
	}
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	uid := actorID(claims)

	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessCustomers), "no tenés permiso para ver clientes") {
		return
	}

	switch r.Method {
	case http.MethodGet:
		c, err := s.Store.GetCustomerByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		if !domain.CanAccessOwnedResourceRoles(uid, roles, c.OwnerUserID) {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateCustomers), "no tenés permiso para editar clientes") {
			return
		}
		existing, err := s.Store.GetCustomerByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		if !domain.CanAccessOwnedResourceRoles(uid, roles, existing.OwnerUserID) {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		var c domain.Customer
		if !decodeJSONBody(w, r, &c) {
			return
		}
		c.OwnerUserID = domain.ResolveOwnerOnUpdateRoles(roles, existing.OwnerUserID, c.OwnerUserID)
		err = s.Store.UpdateCustomer(r.Context(), id, &c)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateCustomers), "no tenés permiso para eliminar clientes") {
			return
		}
		existing, err := s.Store.GetCustomerByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		if !domain.CanAccessOwnedResourceRoles(uid, roles, existing.OwnerUserID) {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		err = s.Store.DeactivateCustomer(r.Context(), id)
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "customer deactivated"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- CATALOG / MATERIALS ---

func (s *Server) HandleMaterials(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListMaterialBoards(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactMaterialsList(list)
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var m domain.MaterialBoard
		if !decodeJSONBody(w, r, &m) {
			return
		}
		if strings.TrimSpace(m.Manufacturer) == "" {
			respondWithError(w, http.StatusBadRequest, "El fabricante del tablero es obligatorio")
			return
		}
		m.Active = true
		err := s.Store.CreateMaterialBoard(r.Context(), &m)
		if err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, m)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleMaterialByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing material id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		m, err := s.Store.GetMaterialBoardByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "material board not found")
			return
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactMaterialCosts(m)
		}
		respondWithJSON(w, http.StatusOK, m)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var m domain.MaterialBoard
		if !decodeJSONBody(w, r, &m) {
			return
		}
		// Snapshot current media URLs so we can clean up replaced files after a
		// successful commit. Reading first keeps cleanup off the failure path.
		prevImage, prevTexture := "", ""
		if cur, err := s.Store.GetMaterialBoardByID(r.Context(), id); err == nil && cur != nil {
			prevImage = cur.ImageURL
			prevTexture = cur.PreviewTextureURL
			if strings.TrimSpace(m.Manufacturer) == "" {
				// Syncs de catálogos legacy (pre-fabricante obligatorio) llegan sin
				// fabricante: conservar el existente en vez de romper la sincronización.
				m.Manufacturer = cur.Manufacturer
			}
		}
		err := s.Store.UpdateMaterialBoard(r.Context(), id, &m)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			// F116 A1: renaming to an existing code must surface as 409, not 500
			// (edges and hardware already map this).
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		if prevImage != m.ImageURL {
			deleteMediaFileByURL(r.Context(), s.MediaDir, prevImage)
		}
		if prevTexture != m.PreviewTextureURL {
			deleteMediaFileByURL(r.Context(), s.MediaDir, prevTexture)
		}
		respondWithJSON(w, http.StatusOK, m)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		err := s.Store.DeactivateMaterialBoard(r.Context(), id)
		if err != nil {
			// F179: a missing or cross-org board must surface as 404 (the
			// scoped UPDATE affects no rows), never as a 500.
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "material board deactivated"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- PROJECTS ---

func (s *Server) HandleProjects(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	uid := actorID(claims)

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver cotizaciones") {
			return
		}
		list, err := s.Store.ListProjects(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		filtered := filterProjectsByOwner(list, uid, roles)
		redactProjectsForCaller(claims, filtered)
		if !s.actorCanViewCosts(r) {
			domain.RedactProjectsList(filtered)
		}
		respondWithJSON(w, http.StatusOK, filtered)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateProjects), "no tenés permiso para crear cotizaciones") {
			return
		}
		var p domain.Project
		if !decodeJSONBody(w, r, &p) {
			return
		}

		if claims != nil {
			p.CreatedBy = claims.UserID
		}
		p.OwnerUserID = domain.ResolveOwnerOnCreateRoles(uid, roles, p.OwnerUserID)

		// #327: ownership may only point at organizations the caller belongs
		// to (manufacturing must be a factory); empty values default to the
		// caller's organization in the storage layer.
		if !s.authorizeProjectOrgOwnership(w, r, &p) {
			return
		}
		if !validateProjectPayloadRequiredIDs(w, &p) {
			return
		}

		p.Status = domain.StatusDraft
		// Product default currency (Mexico).
		if p.Currency == "" {
			p.Currency = "MXN"
		}
		err := s.Store.CreateProject(r.Context(), &p)
		if err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El registro ya existe")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		if !orgSeesManufacturing(claims, &p) {
			domain.RedactProjectManufacturing(&p)
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactProjectCosts(&p)
		}
		respondWithJSON(w, http.StatusCreated, p)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func isValidUUID(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) != 36 {
		return false
	}
	for i := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if value[i] != '-' {
				return false
			}
			continue
		}
		c := value[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// validateProjectPayloadRequiredIDs rejects malformed UUIDs before they reach
// Postgres and become 22P02 internal errors (pre-demo audit P1-5).
func validateProjectPayloadRequiredIDs(w http.ResponseWriter, p *domain.Project) bool {
	if !isValidUUID(p.CustomerID) {
		respondWithError(w, http.StatusBadRequest, "la cotización necesita un cliente válido")
		return false
	}
	for i := range p.Items {
		if !isValidUUID(p.Items[i].ModuleID) {
			respondWithError(w, http.StatusBadRequest, "hay una línea de la cotización sin mueble válido")
			return false
		}
		for role, choice := range p.Items[i].OptionChoices {
			if !isValidUUID(choice) {
				respondWithError(w, http.StatusBadRequest, "opción inválida ("+role+") en una línea de la cotización")
				return false
			}
		}
	}
	for role, choice := range p.ProjectLevelChoices {
		if !isValidUUID(choice) {
			respondWithError(w, http.StatusBadRequest, "opción global inválida ("+role+") en la cotización")
			return false
		}
	}
	return true
}

func (s *Server) HandleProjectByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing project id")
		return
	}
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	uid := actorID(claims)

	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver cotizaciones") {
		return
	}

	switch r.Method {
	case http.MethodGet:
		p, err := s.Store.GetProjectByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "project not found")
			return
		}
		if !domain.CanAccessOwnedResourceRoles(uid, roles, p.OwnerUserID) {
			respondWithError(w, http.StatusNotFound, "project not found")
			return
		}
		if !orgSeesManufacturing(claims, p) {
			domain.RedactProjectManufacturing(p)
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactProjectCosts(p)
		}
		respondWithJSON(w, http.StatusOK, p)

	case http.MethodPut:
		existing, err := s.Store.GetProjectByID(r.Context(), id)
		if err != nil {
			// 404 lets the FE upsert fall through to POST create.
			if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "no rows") {
				respondWithError(w, http.StatusNotFound, "project not found")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		if !domain.CanAccessOwnedResourceRoles(uid, roles, existing.OwnerUserID) {
			respondWithError(w, http.StatusNotFound, "project not found")
			return
		}
		var p domain.Project
		if !decodeJSONBody(w, r, &p) {
			return
		}
		// OC-070..OC-074: the installation job is server-authoritative — it
		// only changes through the dedicated installation endpoints (gates,
		// RBAC and audit). A client-sent copy is ignored, never persisted.
		p.Installation = existing.Installation

		// #327: organization ownership is server-authoritative. It is
		// assigned once at create (validated against the caller's
		// memberships); reassignment requires a dedicated audited flow. A
		// client-sent copy is ignored, never persisted.
		p.OrganizationID = existing.OrganizationID
		p.SalesOrganizationID = existing.SalesOrganizationID
		p.ManufacturingOrganizationID = existing.ManufacturingOrganizationID
		// Sales-organization callers never receive the manufacturing payload;
		// restore the stored copy so their round-trip PUTs cannot wipe it.
		if !orgSeesManufacturing(claims, existing) {
			domain.RestoreProjectManufacturing(&p, existing)
		}
		if !validateProjectPayloadRequiredIDs(w, &p) {
			return
		}

		// F036 status transitions: reopen / mark produced vs general mutate.
		statusChanging := p.Status != "" && p.Status != existing.Status
		if statusChanging {
			reopen := engine.IsProjectClosed(existing.Status) && p.Status == domain.StatusDraft
			markProduced := p.Status == domain.StatusProduced
			if reopen {
				if !requirePermission(w, domain.AnyRole(roles, func(rr domain.UserRole) bool { return domain.ProjectAllowsReopenToDraft(existing.Status, rr) }), "no tenés permiso para reabrir cotizaciones") {
					return
				}
			} else if markProduced {
				if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMarkProduced), "no tenés permiso para marcar en producción") {
					return
				}
				// Production queue roles may only flip status (not rewrite BOM).
				if !domain.AnyRole(roles, domain.RoleCanMutateProjects) {
					next := *existing
					next.Status = domain.StatusProduced
					if next.PriceSnapshot == nil && existing.PriceSnapshot != nil {
						next.PriceSnapshot = existing.PriceSnapshot
					}
					// Keep closed→closed snapshot; engine-equivalent without catalog re-freeze.
					p = next
				}
			} else if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateProjects), "no tenés permiso para editar cotizaciones") {
				return
			}
		} else if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateProjects), "no tenés permiso para editar cotizaciones") {
			return
		}

		p.OwnerUserID = domain.ResolveOwnerOnUpdateRoles(roles, existing.OwnerUserID, p.OwnerUserID)
		// Reopen must clear snapshot even if client resends one.
		if statusChanging && p.Status == domain.StatusDraft && engine.IsProjectClosed(existing.Status) {
			p.PriceSnapshot = nil
		}
		// Preserve snapshot when moving accepted → produced if client omitted it.
		if statusChanging && p.Status == domain.StatusProduced && p.PriceSnapshot == nil {
			p.PriceSnapshot = existing.PriceSnapshot
		}
		// #108: closing a quote pins each item's structure revision so later
		// edits to the structure do not silently mutate the closed quote's BOM.
		// Same caveat as PriceSnapshot above: the handler builds the freeze
		// inline rather than calling TransitionProjectStatus.
		if statusChanging && engine.IsProjectClosed(p.Status) {
			catalog, cerr := s.Store.GetFullCatalog(r.Context())
			if cerr != nil {
				respondWithInternalError(w, cerr, "handler: load catalog for structure pins")
				return
			}
			p.Items = engine.CaptureProjectItemStructurePins(p.Items, catalog)
		}
		// OC-010 server authority: lifecycle events also arrive via the project
		// aggregate (dual-write). New event ids must pass the same vocabulary +
		// RBAC gates as POST /api/projects/{id}/events; resending the existing
		// log is always allowed.
		if !authorizeProjectEventAppends(w, roles, existing.Events, p.Events) {
			return
		}
		// OC-074: new closeout events in the dual-write path must pass the
		// closeout gates against the stored project state.
		if !authorizeCloseoutEventAppends(w, existing, p.Events) {
			return
		}
		err = s.Store.UpdateProject(r.Context(), id, &p)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		if !orgSeesManufacturing(claims, &p) {
			domain.RedactProjectManufacturing(&p)
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactProjectCosts(&p)
		}
		respondWithJSON(w, http.StatusOK, p)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanDeleteProject), "no tenés permiso para eliminar cotizaciones") {
			return
		}
		existing, err := s.Store.GetProjectByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "project not found")
			return
		}
		if !domain.CanAccessOwnedResourceRoles(uid, roles, existing.OwnerUserID) {
			respondWithError(w, http.StatusNotFound, "project not found")
			return
		}
		err = s.Store.DeleteProject(r.Context(), id)
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "project deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// Endpoint para calcular el breakdown financiero de un proyecto usando el motor de Go
func (s *Server) HandleProjectCalculate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing project id")
		return
	}

	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	uid := actorID(claims)
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver cotizaciones") {
		return
	}

	p, err := s.Store.GetProjectByID(r.Context(), id)
	if err != nil {
		respondWithError(w, http.StatusNotFound, "project not found")
		return
	}
	if !domain.CanAccessOwnedResourceRoles(uid, roles, p.OwnerUserID) {
		respondWithError(w, http.StatusNotFound, "project not found")
		return
	}

	catalog, err := s.Store.GetFullCatalog(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "calculate: load catalog")
		return
	}

	breakdown, err := engine.CalcProjectBreakdown(*p, catalog)
	if err != nil {
		// Calculation errors are business-validation failures (bad inputs), not
		// internal leaks — surface a clean, actionable message.
		respondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	if !s.actorCanViewCosts(r) {
		domain.RedactQuoteBreakdown(&breakdown)
	}
	respondWithJSON(w, http.StatusOK, breakdown)
}

// --- EDGE BANDS ---

func (s *Server) HandleEdgeBands(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListEdgeBands(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactEdgesList(list)
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var e domain.EdgeBand
		if !decodeJSONBody(w, r, &e) {
			return
		}
		e.Active = true
		err := s.Store.CreateEdgeBand(r.Context(), &e)
		if err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, e)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleEdgeBandByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		e, err := s.Store.GetEdgeBandByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "edge band not found")
			return
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactEdgeCosts(e)
		}
		respondWithJSON(w, http.StatusOK, e)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var e domain.EdgeBand
		if !decodeJSONBody(w, r, &e) {
			return
		}
		err := s.Store.UpdateEdgeBand(r.Context(), id, &e)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, e)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		err := s.Store.DeactivateEdgeBand(r.Context(), id)
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "edge band deactivated"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- HARDWARES ---

func (s *Server) HandleHardwares(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListHardwares(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactHardwareList(list)
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var h domain.Hardware
		if !decodeJSONBody(w, r, &h) {
			return
		}
		h.Active = true
		err := s.Store.CreateHardware(r.Context(), &h)
		if err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, h)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleHardwareByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		h, err := s.Store.GetHardwareByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "hardware not found")
			return
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactHardwareCosts(h)
		}
		respondWithJSON(w, http.StatusOK, h)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var h domain.Hardware
		if !decodeJSONBody(w, r, &h) {
			return
		}
		// Snapshot current media URL so we can clean up the replaced file after
		// a successful commit.
		prevImage := ""
		if cur, err := s.Store.GetHardwareByID(r.Context(), id); err == nil && cur != nil {
			prevImage = cur.ImageURL
		}
		err := s.Store.UpdateHardware(r.Context(), id, &h)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		if prevImage != h.ImageURL {
			deleteMediaFileByURL(r.Context(), s.MediaDir, prevImage)
		}
		respondWithJSON(w, http.StatusOK, h)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		err := s.Store.DeactivateHardware(r.Context(), id)
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "hardware deactivated"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- OPTION GROUPS ---

func (s *Server) HandleOptionGroups(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListOptionGroups(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var og domain.OptionGroup
		if !decodeJSONBody(w, r, &og) {
			return
		}
		err := s.Store.CreateOptionGroup(r.Context(), &og)
		if err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, og)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleOptionGroupByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		og, err := s.Store.GetOptionGroupByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "option group not found")
			return
		}
		respondWithJSON(w, http.StatusOK, og)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var og domain.OptionGroup
		if !decodeJSONBody(w, r, &og) {
			return
		}
		err := s.Store.UpdateOptionGroup(r.Context(), id, &og)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, og)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		err := s.Store.DeleteOptionGroup(r.Context(), id)
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "option group deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- SEED ---

// HandleSeed populates the database with plantilla fixture data.
// Idempotent: skips if materials already exist.
func (s *Server) HandleSeed(w http.ResponseWriter, r *http.Request) {
	if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "solo administradores") {
		return
	}
	if err := s.Store.SeedCatalog(r.Context()); err != nil {
		respondWithInternalError(w, err, "seed")
		return
	}
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

// --- MODULES / TEMPLATES ---

func (s *Server) HandleModules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		catalog, err := s.Store.GetFullCatalog(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, catalog.Modules)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar muebles plantilla") {
			return
		}
		var m domain.Module
		if !decodeJSONBody(w, r, &m) {
			return
		}
		err := s.Store.CreateModule(r.Context(), &m)
		if err != nil {
			var definitionsErr *domain.FurnitureParameterDefinitionsError
			if errors.As(err, &definitionsErr) {
				respondWithError(w, http.StatusBadRequest, definitionsErr.Error())
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, m)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleModuleByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		m, err := s.Store.GetModuleByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "module not found")
			return
		}
		respondWithJSON(w, http.StatusOK, m)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar muebles plantilla") {
			return
		}
		var m domain.Module
		if !decodeJSONBody(w, r, &m) {
			return
		}
		// Snapshot current media URL so we can clean up the replaced file after
		// a successful commit.
		prevImage := ""
		if cur, err := s.Store.GetModuleByID(r.Context(), id); err == nil && cur != nil {
			prevImage = cur.ImageURL
		}
		err := s.Store.UpdateModule(r.Context(), id, &m)
		if err != nil {
			var definitionsErr *domain.FurnitureParameterDefinitionsError
			if errors.As(err, &definitionsErr) {
				respondWithError(w, http.StatusBadRequest, definitionsErr.Error())
				return
			}
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		if prevImage != m.ImageURL {
			deleteMediaFileByURL(r.Context(), s.MediaDir, prevImage)
		}
		respondWithJSON(w, http.StatusOK, m)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar muebles plantilla") {
			return
		}
		// Physical delete: capture the image URL before deleting the row, then
		// remove the file so we don't accumulate orphaned media on disk.
		prevImage := ""
		if cur, err := s.Store.GetModuleByID(r.Context(), id); err == nil && cur != nil {
			prevImage = cur.ImageURL
		}
		err := s.Store.DeleteModule(r.Context(), id)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if strings.Contains(err.Error(), "in use") {
				respondWithError(w, http.StatusConflict, err.Error())
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		deleteMediaFileByURL(r.Context(), s.MediaDir, prevImage)
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "module deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- STRUCTURES / CUERPOS (F049 / #99) ---

func (s *Server) HandleStructures(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListStructures(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar estructuras") {
			return
		}
		var st domain.Structure
		if !decodeJSONBody(w, r, &st) {
			return
		}
		err := s.Store.CreateStructure(r.Context(), &st)
		if err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, st)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleStructureByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		st, err := s.Store.GetStructureByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "structure not found")
			return
		}
		respondWithJSON(w, http.StatusOK, st)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar estructuras") {
			return
		}
		var st domain.Structure
		if !decodeJSONBody(w, r, &st) {
			return
		}
		err := s.Store.UpdateStructure(r.Context(), id, &st)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, st)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar estructuras") {
			return
		}
		err := s.Store.DeleteStructure(r.Context(), id)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "structure deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- MODULE CATEGORIES (F025) ---

func (s *Server) HandleCategories(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListCategories(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var c domain.ModuleCategory
		if !decodeJSONBody(w, r, &c) {
			return
		}
		err := s.Store.CreateCategory(r.Context(), &c)
		if err != nil {
			if strings.Contains(err.Error(), "invalid category placement") ||
				strings.Contains(err.Error(), "cannot exceed") ||
				strings.Contains(err.Error(), "name is required") {
				respondWithError(w, http.StatusBadRequest, err.Error())
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, c)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleCategoryByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		c, err := s.Store.GetCategoryByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "category not found")
			return
		}
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var c domain.ModuleCategory
		if !decodeJSONBody(w, r, &c) {
			return
		}
		err := s.Store.UpdateCategory(r.Context(), id, &c)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if strings.Contains(err.Error(), "invalid category placement") ||
				strings.Contains(err.Error(), "cannot exceed") ||
				strings.Contains(err.Error(), "name is required") ||
				strings.Contains(err.Error(), "cannot be its own") ||
				strings.Contains(err.Error(), "descendant") {
				respondWithError(w, http.StatusBadRequest, err.Error())
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		err := s.Store.DeleteCategory(r.Context(), id)
		if err != nil {
			if strings.Contains(err.Error(), "cannot delete category with children") {
				respondWithError(w, http.StatusBadRequest, err.Error())
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "category deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- ADMIN: User Management ---

// HandleAssignableOwners: GET /api/assignable-owners
// Active members of the current organization that can own a customer/project
// portfolio (admin + gerente + vendedor). Roles come from the org membership,
// not the deprecated users.role column.
func (s *Server) HandleAssignableOwners(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	roles := actorRoles(claimsFromRequest(r))
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAssignOwner), "no tenés permiso para asignar responsables") {
		return
	}
	claims := claimsFromRequest(r)
	if claims == nil || claims.OrgID == "" {
		respondWithError(w, http.StatusForbidden, "elegí un taller para continuar")
		return
	}
	team, err := s.Store.ListOrgTeam(r.Context(), claims.OrgID, claims.UserID)
	if err != nil {
		respondWithInternalError(w, err, "handler")
		return
	}
	// Portfolio owners are sales-facing roles (plus admin). When a membership
	// holds several of them, report the most privileged one for display.
	ownerRank := map[domain.UserRole]int{
		domain.RoleAdmin: 0, domain.RoleGerenteVentas: 1,
		domain.RoleVendedor: 2, domain.RoleUser: 3,
	}
	out := make([]map[string]string, 0, len(team))
	for _, m := range team {
		if m.Status != domain.MembershipStatusActive {
			continue
		}
		best, bestRank := "", -1
		for _, rl := range m.Roles {
			if rank, ok := ownerRank[rl]; ok && (bestRank == -1 || rank < bestRank) {
				best, bestRank = string(rl), rank
			}
		}
		if best == "" {
			continue
		}
		out = append(out, map[string]string{
			"id":   m.UserID,
			"name": m.Name,
			"role": best,
		})
	}
	respondWithJSON(w, http.StatusOK, out)
}

// HandleWorkshopSettings: GET/PUT /api/settings (F031 + F044 COST-02).
func (s *Server) HandleWorkshopSettings(w http.ResponseWriter, r *http.Request) {
	roles := actorRoles(claimsFromRequest(r))
	switch r.Method {
	case http.MethodGet:
		// Any authenticated user may read settings (needed for cost visibility on client).
		ws, err := s.Store.GetWorkshopSettings(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, ws)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessSettings), "no tenés permiso para editar ajustes del taller") {
			return
		}
		var ws domain.WorkshopSettings
		if !decodeJSONBody(w, r, &ws) {
			return
		}
		saved, err := s.Store.UpsertWorkshopSettings(r.Context(), ws)
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, saved)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- COMPONENTS (F050 / #101) ---

func (s *Server) HandleComponents(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListComponents(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar componentes") {
			return
		}
		var c domain.Component
		if !decodeJSONBody(w, r, &c) {
			return
		}
		// #403 / MT-2: material binding role contract — a board follows
		// exactly one material selection; ambiguous roles are surfaced at
		// authoring time instead of silently half-honored by the engine.
		if err := engine.ValidateComponent(c); err != nil {
			respondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		err := s.Store.CreateComponent(r.Context(), &c)
		if err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, c)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleComponentByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		c, err := s.Store.GetComponentByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "component not found")
			return
		}
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar componentes") {
			return
		}
		var c domain.Component
		if !decodeJSONBody(w, r, &c) {
			return
		}
		// #403 / MT-2 — same authoring-time contract check as POST.
		if err := engine.ValidateComponent(c); err != nil {
			respondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		err := s.Store.UpdateComponent(r.Context(), id, &c)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "no tenés permiso para modificar componentes") {
			return
		}
		err := s.Store.DeleteComponent(r.Context(), id)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "component deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- Project templates (#110 / H15) ---

// HandleProjectTemplates: GET (list) / POST (create). Templates are a recipe
// collection (no customer/owner scoping) — readable by anyone who can access
// projects, mutable by engineer/admin (catalog-style RBAC).
func (s *Server) HandleProjectTemplates(w http.ResponseWriter, r *http.Request) {
	roles := actorRoles(claimsFromRequest(r))

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver cotizaciones") {
			return
		}
		list, err := s.Store.ListProjectTemplates(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateModules), "no tenés permiso para crear plantillas") {
			return
		}
		var t domain.ProjectTemplate
		if !decodeJSONBody(w, r, &t) {
			return
		}
		if t.Currency == "" {
			t.Currency = "MXN"
		}
		if t.MarginFactor == 0 {
			t.MarginFactor = 1.35
		}
		if t.Items == nil {
			t.Items = []domain.ProjectItem{}
		}
		if err := s.Store.CreateProjectTemplate(r.Context(), t); err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El registro ya existe")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, t)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// HandleProjectTemplateByID: GET / PUT / DELETE on /project-templates/{id}.
func (s *Server) HandleProjectTemplateByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing template id")
		return
	}
	roles := actorRoles(claimsFromRequest(r))

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver cotizaciones") {
			return
		}
		t, err := s.Store.GetProjectTemplateByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "template not found")
			return
		}
		respondWithJSON(w, http.StatusOK, t)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateModules), "no tenés permiso para editar plantillas") {
			return
		}
		var t domain.ProjectTemplate
		if !decodeJSONBody(w, r, &t) {
			return
		}
		if t.Currency == "" {
			t.Currency = "MXN"
		}
		if t.Items == nil {
			t.Items = []domain.ProjectItem{}
		}
		if err := s.Store.UpdateProjectTemplate(r.Context(), id, t); err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		updated, err := s.Store.GetProjectTemplateByID(r.Context(), id)
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, updated)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateModules), "no tenés permiso para borrar plantillas") {
			return
		}
		if err := s.Store.DeleteProjectTemplate(r.Context(), id); err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]bool{"ok": true})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func rolesToStrings(roles []domain.UserRole) []string {
	out := make([]string, len(roles))
	for i, role := range roles {
		out[i] = string(role)
	}
	return out
}

// HandleMe: GET /api/auth/me — current session snapshot for the shell:
// user, active organization, roles and support-session context (banner).
func (s *Server) HandleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	claims, ok := r.Context().Value(UserContextKey).(*auth.Claims)
	if !ok || claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	u, err := s.Store.GetUserByID(r.Context(), claims.UserID)
	if err != nil || u == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if claims.ExpiresAt == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	memberships, err := s.Store.ListMembershipsByUser(r.Context(), claims.UserID)
	if err != nil {
		respondWithInternalError(w, err, "me: memberships")
		return
	}
	transport := authTransportFromClaims(claims)
	scope := openapi.SessionScope{
		UserID:            claims.UserID,
		Mode:              "auth",
		AbsoluteExpiresAt: claims.ExpiresAt.Time.UTC().Format(time.RFC3339Nano),
	}
	// sid is present on ver5 tokens; null only while pre-#460 tokens are
	// exchanged (the field becomes required at the SEC-9 gate).
	if claims.Sid != "" {
		value := claims.Sid
		scope.SessionID = &value
	}
	if claims.MembershipID != "" {
		scope.MembershipID = &claims.MembershipID
	}
	if claims.OrgID != "" {
		scope.OrganizationID = &claims.OrgID
	}
	if claims.MembershipCredentialVersion > 0 {
		scope.MembershipCredentialVersion = &claims.MembershipCredentialVersion
	}
	if claims.OrganizationCredentialVersion > 0 {
		scope.OrganizationCredentialVersion = &claims.OrganizationCredentialVersion
	}
	resp := openapi.MeResponse{User: toOpenAPIUser(u), Roles: claims.Roles, Memberships: toMembershipDTOs(memberships), Transport: transport, SessionScope: scope}
	if claims.Support != nil {
		org, err := s.Store.GetOrganizationByID(r.Context(), claims.Support.OrgID)
		if err != nil || org == nil || claims.OrgID != claims.Support.OrgID || org.ID != claims.OrgID || org.Status != domain.OrganizationStatusActive {
			respondWithError(w, http.StatusUnauthorized, "invalid token")
			return
		}
		summary := toOpenAPIOrganization(*org)
		resp.Organization = &summary
	} else if claims.OrgID != "" {
		if m, err := s.Store.GetActiveMembership(r.Context(), claims.UserID, claims.OrgID); err == nil && m != nil {
			org := toOpenAPIOrganization(m.Organization)
			resp.Organization = &org
		}
	}
	if claims.Support != nil {
		scope.Mode = "support"
		scope.SupportSessionID = &claims.Support.SessionID
		scope.OrganizationCredentialVersion = &claims.Support.OrganizationCredentialVersion
		resp.SessionScope = scope
		resp.Support = &openapi.SupportInfo{OrganizationID: claims.Support.OrgID, SessionID: claims.Support.SessionID, Reason: claims.Support.Reason}
	}
	respondWithJSON(w, http.StatusOK, resp)
}
