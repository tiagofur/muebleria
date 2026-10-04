package api

import (
	"context"
	"errors"
	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"net/http"
	"strings"
	"time"
)

// Contrato: handlers y plumbing de sesión — login/select-org/refresh,
// sesiones ver5 (SEC-1), credenciales de refresh, expiry absoluto, me y
// perfil SketchUp. Consumidos por routes_auth.go.
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

type issuedRefreshCredential struct {
	Raw       string
	ExpiresAt time.Time
}

// createRefreshableAuthSession commits the registry row and its first refresh
// credential in one transaction. SketchUp/support remain separate credential
// classes and deliberately do not enter this SEC-2 family.
func (s *Server) createRefreshableAuthSession(ctx context.Context, cmd storage.CreateAuthSessionCommand) (*domain.AuthSession, *issuedRefreshCredential, error) {
	return s.createRefreshableAuthSessionThen(ctx, cmd, nil)
}

// createRefreshableAuthSessionThen keeps creation of the authoritative session,
// its refresh family, and any required success evidence in one transaction.
// The callback runs before commit and must therefore fail closed.
func (s *Server) createRefreshableAuthSessionThen(ctx context.Context, cmd storage.CreateAuthSessionCommand, then func(context.Context, *domain.AuthSession) error) (*domain.AuthSession, *issuedRefreshCredential, error) {
	var raw string
	var verifier []byte
	var err error
	refreshable := (cmd.ClientType == domain.SessionClientWeb || cmd.ClientType == domain.SessionClientMobile) && s.RefreshCredentials != nil
	if refreshable {
		raw, verifier, err = s.RefreshCredentials.Generate()
		if err != nil {
			return nil, nil, err
		}
	}
	var session *domain.AuthSession
	var refresh *storage.AuthRefreshCredential
	execute := func(txCtx context.Context) error {
		created, err := s.Store.CreateAuthSession(txCtx, cmd)
		if err != nil {
			return err
		}
		session = created
		if refreshable {
			refresh, err = s.Store.CreateAuthRefreshCredential(txCtx, storage.CreateAuthRefreshCredentialCommand{
				SessionID: created.ID, UserID: created.UserID, Verifier: verifier,
			})
			if err != nil {
				return err
			}
		}
		if then != nil {
			return then(txCtx, created)
		}
		return nil
	}
	if runner, ok := s.Store.(tenantTransactionRunner); ok {
		err = runner.WithinTenantTx(ctx, storage.TenantActor{UserID: cmd.UserID, OrganizationID: cmd.OrganizationID}, execute)
	} else {
		err = execute(ctx)
	}
	if err != nil {
		return nil, nil, err
	}
	if !refreshable {
		return session, nil, nil
	}
	return session, &issuedRefreshCredential{Raw: raw, ExpiresAt: refresh.ExpiresAt}, nil
}

// attachRefreshCredential delivers the first refresh credential per transport
// (#460 SEC-4A): Mobile keeps the opaque secret in the JSON body (its
// secure-store flow, revisited by SEC-5), while Web receives it exclusively as
// a HttpOnly cookie — the raw secret never appears in Web JSON. The cookie's
// expiry is the session's absolute bound, which rotation preserves.
func (s *Server) attachRefreshCredential(w http.ResponseWriter, response *LoginResponse, refresh *issuedRefreshCredential, clientType domain.SessionClientType, session *domain.AuthSession) {
	if refresh == nil {
		return
	}
	if clientType == domain.SessionClientWeb && session != nil {
		s.setWebRefreshCookie(w, refresh.Raw, session.AbsoluteExpiresAt)
		return
	}
	if clientType != domain.SessionClientMobile {
		return
	}
	response.RefreshToken = &refresh.Raw
	expiresAt := refresh.ExpiresAt.UTC().Format(time.RFC3339Nano)
	response.RefreshExpiresAt = &expiresAt
}

// setAuthExpiryMetadata stamps the server-clock session metadata SEC-4B uses
// to schedule refreshes without decoding JWTs client-side (#460 SEC-4A §21):
// access_expires_at mirrors the minting arithmetic exactly (auth.AccessTokenExpiry
// is the same helper issueToken uses) and absolute_session_expires_at is the
// registry's authoritative re-login deadline.
func setAuthExpiryMetadata(response *LoginResponse, authStartedAt time.Time, transport openapi.AuthTransport, absoluteSessionExpiry *time.Time) {
	var cap time.Time
	if absoluteSessionExpiry != nil {
		cap = *absoluteSessionExpiry
	}
	accessExpiry, err := auth.AccessTokenExpiry(time.Now(), authStartedAt, string(transport), cap)
	if err != nil {
		return
	}
	formatted := accessExpiry.UTC().Format(time.RFC3339Nano)
	response.AccessExpiresAt = &formatted
	if absoluteSessionExpiry != nil {
		absolute := absoluteSessionExpiry.UTC().Format(time.RFC3339Nano)
		response.AbsoluteSessionExpiresAt = &absolute
	}
}

// Helpers para JSON
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
		var orgless string
		session, refresh, err := s.createRefreshableAuthSessionThen(r.Context(), storage.CreateAuthSessionCommand{
			UserID:            u.ID,
			ClientType:        sessionClientType(string(transport)),
			AbsoluteExpiresAt: time.Now().Add(auth.TransportSessionTTL(string(transport))),
			DeviceHint:        sanitizeDeviceHint(r.UserAgent()),
		}, func(txCtx context.Context, created *domain.AuthSession) error {
			var issueErr error
			orgless, issueErr = s.tokenAuthority().IssueTransportTokenUntil(u.ID, u.Email, auth.TokenContext{
				PlatformAdmin: u.PlatformAdmin, SessionID: created.ID,
			}, string(transport), created.AbsoluteExpiresAt)
			if issueErr != nil {
				return issueErr
			}
			if err := s.Store.UpdateLastLogin(txCtx, u.ID); err != nil {
				return err
			}
			return s.auditRequired(txCtx, "login_success", u.ID, "", clientIP(r), map[string]interface{}{
				"transport": transport, "selection_required": true, "session_id": created.ID,
			})
		})
		if err != nil {
			respondWithInternalError(w, err, "login: create session and audit")
			return
		}
		response := LoginResponse{
			Token:             orgless,
			SessionID:         &session.ID,
			User:              toOpenAPIUser(u),
			License:           LicenseDTO{Plan: string(domain.LicensePlanNone), Status: string(domain.LicenseStatusNone)},
			Roles:             []string{},
			Memberships:       toMembershipDTOs(memberships),
			SelectionRequired: true,
			Transport:         openapi.AuthTransport(transport),
		}
		s.attachRefreshCredential(w, &response, refresh, sessionClientType(string(transport)), session)
		setAuthExpiryMetadata(&response, time.Time{}, openapi.AuthTransport(transport), &session.AbsoluteExpiresAt)
		respondWithJSON(w, http.StatusOK, response)
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
	var token string
	session, refresh, err := s.createRefreshableAuthSessionThen(r.Context(), storage.CreateAuthSessionCommand{
		UserID:            u.ID,
		MembershipID:      tc.MembershipID,
		OrganizationID:    tc.OrgID,
		ClientType:        sessionClientType(string(transport)),
		AbsoluteExpiresAt: time.Now().Add(auth.TransportSessionTTL(string(transport))),
		DeviceHint:        sanitizeDeviceHint(r.UserAgent()),
	}, func(txCtx context.Context, created *domain.AuthSession) error {
		tc.SessionID = created.ID
		var issueErr error
		token, issueErr = s.tokenAuthority().IssueTransportTokenUntil(u.ID, u.Email, tc, string(transport), created.AbsoluteExpiresAt)
		if issueErr != nil {
			return issueErr
		}
		if err := s.Store.UpdateLastLogin(txCtx, u.ID); err != nil {
			return err
		}
		return s.auditRequired(txCtx, "login_success", u.ID, tc.OrgID, clientIP(r), map[string]interface{}{
			"transport": transport, "session_id": created.ID,
		})
	})
	if err != nil {
		respondWithInternalError(w, err, "login: create session and audit")
		return
	}

	roles := tc.Roles
	if roles == nil {
		roles = []string{}
	}

	response := LoginResponse{
		Token:             token,
		SessionID:         &session.ID,
		User:              toOpenAPIUser(u),
		License:           license,
		Roles:             roles,
		Organization:      orgDTO,
		Memberships:       toMembershipDTOs(memberships),
		SelectionRequired: false,
		Transport:         openapi.AuthTransport(transport),
	}
	s.attachRefreshCredential(w, &response, refresh, sessionClientType(string(transport)), session)
	setAuthExpiryMetadata(&response, time.Time{}, openapi.AuthTransport(transport), &session.AbsoluteExpiresAt)
	respondWithJSON(w, http.StatusOK, response)
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

	// Atomic switch contract (F199 + #460): a FAILED switch must leave the
	// current session scope untouched. Every step that can still fail runs
	// BEFORE the scope mutation: the user payload fetch and the token mint
	// (and, for a ver4 exchange, the registration of the new row — an unused
	// row that simply expires if the flow dies afterwards). The scope update
	// itself is the last scope mutation; the required audit below shares the
	// request transaction, so no success can commit a switch without evidence (a
	// serialization failure would surface as 500 and roll the transaction back
	// together with the scope change).
	u, err := s.Store.GetUserByID(r.Context(), claims.UserID)
	if err != nil || u == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}

	// Absolute session bound for the bounded mint + response metadata. For a
	// ver5 token the registry row must resolve (the middleware validated it
	// live moments ago); a nil lookup means the session died in between — the
	// switch aborts with the same revoked-session 401 the scope update below
	// would produce. SEC-4B: web mints REQUIRE this cap.
	var sessionAbsoluteExpiry *time.Time
	if claims.Sid == "" {
		// A ver4 token has no session yet: this exchange registers one scoped
		// to the target organization, preserving the absolute origin.
		session, createErr := s.createAuthSession(r.Context(), storage.CreateAuthSessionCommand{
			UserID:            claims.UserID,
			MembershipID:      m.ID,
			OrganizationID:    m.OrganizationID,
			ClientType:        sessionClientType(string(transport)),
			AbsoluteExpiresAt: claims.AuthStartedAt.Time.Add(auth.TransportSessionTTL(string(transport))),
			DeviceHint:        sanitizeDeviceHint(r.UserAgent()),
		})
		if createErr != nil {
			respondWithInternalError(w, createErr, "select-org: create session")
			return
		}
		tc.SessionID = session.ID
		sessionAbsoluteExpiry = &session.AbsoluteExpiresAt
	} else {
		tc.SessionID = claims.Sid
		sessionAbsoluteExpiry = s.authSessionAbsoluteExpiry(r.Context(), claims)
		if sessionAbsoluteExpiry == nil {
			respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeSessionRevoked, "La sesión ya no está activa. Iniciá sesión de nuevo.", nil)
			return
		}
	}

	// Bounded mint for every transport (web REQUIRES the cap; the others are
	// capped at their own origin+TTL, which this row already equals).
	token, err := s.tokenAuthority().IssueTransportTokenUntil(claims.UserID, claims.Email, tc, string(transport), *sessionAbsoluteExpiry)
	if err != nil {
		respondWithInternalError(w, err, "select-org: generate token")
		return
	}

	// Last mutation of the switch: the registry session keeps its id across it
	// (#460 / ADR-0007). From this point the previous scope's bearers stop
	// validating immediately (middleware current-scope check).
	if claims.Sid != "" {
		if err := s.Store.UpdateAuthSessionScope(r.Context(), claims.Sid, m.ID, m.OrganizationID); err != nil {
			respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeSessionRevoked, "La sesión ya no está activa. Iniciá sesión de nuevo.", nil)
			return
		}
	}

	if err := s.auditRequired(r.Context(), "organization_selected", claims.UserID, m.OrganizationID, clientIP(r), map[string]interface{}{
		"session_id": tc.SessionID,
	}); err != nil {
		respondWithInternalError(w, err, "select-org: durable audit")
		return
	}

	org := toOrgSummaryDTO(m.Organization)
	sessionID := tc.SessionID
	// select-org deliberately rotates NO refresh credential: the Web cookie /
	// Mobile secret of this session keeps its family (scope updated in place
	// by UpdateAuthSessionScope). Only the access bearer is re-scoped.
	response := LoginResponse{
		Token:        token,
		SessionID:    &sessionID,
		User:         toOpenAPIUser(u),
		License:      org.License,
		Roles:        rolesToStrings(m.Roles),
		Organization: &org,
		Memberships:  []MembershipDTO{},
		Transport:    transport,
	}
	setAuthExpiryMetadata(&response, claims.AuthStartedAt.Time, transport, sessionAbsoluteExpiry)
	respondWithJSON(w, http.StatusOK, response)
}

// authSessionAbsoluteExpiry resolves the registry's authoritative absolute
// bound for a live session when the store exposes the lookup. Nil means the
// row cannot be resolved here (older embedders); callers then omit the
// metadata instead of guessing a client-side value.
func (s *Server) authSessionAbsoluteExpiry(ctx context.Context, claims *auth.Claims) *time.Time {
	if claims == nil || claims.Sid == "" {
		return nil
	}
	lookup, ok := s.Store.(authSessionLookup)
	if !ok {
		return nil
	}
	session, err := lookup.GetAuthSessionForRequest(ctx, claims.Sid, claims.UserID)
	if err != nil || session == nil {
		return nil
	}
	return &session.AbsoluteExpiresAt
}

// HandleRefresh re-issues an access token for the authenticated user after
// AuthMiddleware has already re-validated role/active against the DB (issue #16).
// Clients should call this before their transport's access TTL elapses to
// avoid re-login.
//
// #460 SEC-4A: this bodyless bearer branch is a FINITE compatibility bridge
// restricted to the credential classes that have no opaque refresh family —
// the SketchUp extension (until SEC-6 device credentials) and platform support
// sessions. Web/mobile sessions own SEC-2A families and must rotate through
// their canonical transports (HttpOnly cookie / JSON body).
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

	transport := authTransportFromClaims(claims)
	if claims.Support == nil && transport != openapi.AuthTransportSketchup {
		respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeRefreshInvalid,
			"La credencial de renovación no es válida. Iniciá sesión de nuevo.", nil)
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

	// A ver4 refresh upgrades to the current credential version: the registry
	// row is created here, bounded by the ORIGINAL absolute origin so the
	// upgrade can never extend the session (#441/#445).
	var absoluteExpiry *time.Time
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
		absoluteExpiry = &upgraded.AbsoluteExpiresAt
	} else {
		absoluteExpiry = s.authSessionAbsoluteExpiry(r.Context(), claims)
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
	setAuthExpiryMetadata(&resp, claims.AuthStartedAt.Time, transport, absoluteExpiry)

	respondWithJSON(w, http.StatusOK, resp)
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

// HandleSketchupProfile is the extension's current-session identity read.
// Unlike /auth/me it never lists the account's other organizations or roles.
// Org-less device sessions (no active membership yet) still get their account
// identity, with the organization block omitted.
func (s *Server) HandleSketchupProfile(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value(UserContextKey).(*auth.Claims)
	if !ok || claims == nil || claims.Client != auth.ExtensionClient ||
		authTransportFromClaims(claims) != openapi.AuthTransportSketchup ||
		claims.Support != nil {
		respondWithError(w, http.StatusForbidden, "SketchUp session required")
		return
	}
	u, err := s.Store.GetUserByID(r.Context(), claims.UserID)
	if err != nil || u == nil || u.AccountStatus != domain.AccountStatusActive {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	resp := openapi.SketchupProfileResponse{
		User: openapi.SketchupProfileUser{Name: u.Name, Email: u.Email},
	}
	if claims.OrgID != "" {
		m, err := s.Store.GetActiveMembership(r.Context(), claims.UserID, claims.OrgID)
		if err != nil || m == nil || m.ID != claims.MembershipID || m.Organization.ID != claims.OrgID ||
			m.Organization.Status != domain.OrganizationStatusActive {
			respondWithError(w, http.StatusUnauthorized, "invalid token")
			return
		}
		resp.Organization = &openapi.SketchupProfileOrganization{
			ID: claims.OrgID, Name: m.Organization.Name, License: toOpenAPIOrganization(m.Organization).License,
		}
		resp.SessionScope = &openapi.SketchupProfileScope{OrganizationID: claims.OrgID}
	}
	respondWithJSON(w, http.StatusOK, resp)
}
