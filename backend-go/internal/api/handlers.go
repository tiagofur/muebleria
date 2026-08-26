package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

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

// Helpers para JSON
func respondWithError(w http.ResponseWriter, code int, message string) {
	respondWithJSON(w, code, map[string]string{"error": message})
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
	slog.Error("internal server error", "op", op, "error", err)
	respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
}

// decodeJSONBody limits the request body and decodes JSON into dst.
// On failure it writes an error response and returns false (issue #20).
func decodeJSONBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
	dec := json.NewDecoder(r.Body)
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
	return true
}

// --- AUTH ---

// RegisterRequest intentionally has no Role field — self-registration always
// creates role "user" pending approval (issue #19).
type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

func (s *Server) HandleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req RegisterRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		respondWithError(w, http.StatusBadRequest, "missing fields")
		return
	}

	if err := auth.ValidatePassword(req.Password); err != nil {
		respondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		respondWithInternalError(w, err, "register: hash password")
		return
	}

	u := domain.User{
		Email:        req.Email,
		PasswordHash: hash,
		Name:         req.Name,
		Role:         domain.RoleUser, // all self-registered users start as 'user'
		Active:       false,           // pending admin approval
	}

	err = s.Store.CreateUser(r.Context(), &u)
	if err != nil {
		if isDuplicateKey(err) {
			respondWithError(w, http.StatusConflict, "email already registered")
			return
		}
		respondWithInternalError(w, err, "handler")
		return
	}

	respondWithJSON(w, http.StatusCreated, map[string]string{
		"message": "Solicitud de acceso enviada. El administrador revisará tu cuenta pronto.",
	})
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	// Client marks the requesting product. "sketchup-extension" receives a
	// long-lived read-only token (auth.ExtensionClient); empty means the web
	// app and gets the standard short-lived access token.
	Client string `json:"client"`
	// Org is an optional organization hint (slug): pre-selects that membership
	// instead of asking the user to choose (ADR-0004 §6).
	Org string `json:"org"`
}

// PublicUserDTO is the safe public representation of a user, guaranteeing
// that internal secrets (such as password hashes) are never serialized (OC-005).
type PublicUserDTO struct {
	ID               string             `json:"id"`
	Email            string             `json:"email"`
	Name             string             `json:"name"`
	Role             domain.UserRole    `json:"role"`
	Active           bool               `json:"active"`
	PlatformAdmin    bool               `json:"platform_admin"`
	LicensePlan      domain.LicensePlan `json:"license_plan"`
	LicenseExpiresAt *time.Time         `json:"license_expires_at,omitempty"`
	CreatedAt        time.Time          `json:"created_at"`
	UpdatedAt        time.Time          `json:"updated_at"`
}

func ToPublicUserDTO(u *domain.User) PublicUserDTO {
	if u == nil {
		return PublicUserDTO{}
	}
	plan := u.LicensePlan
	if plan == "" {
		plan = domain.LicensePlanNone
	}
	return PublicUserDTO{
		ID:               u.ID,
		Email:            u.Email,
		Name:             u.Name,
		Role:             u.Role,
		Active:           u.Active,
		PlatformAdmin:    u.PlatformAdmin,
		LicensePlan:      plan,
		LicenseExpiresAt: u.LicenseExpiresAt,
		CreatedAt:        u.CreatedAt,
		UpdatedAt:        u.UpdatedAt,
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

// LicenseDTO is the derived licensing state surfaced to clients (login,
// refresh, and the SketchUp extension session card).
type LicenseDTO struct {
	Plan      string               `json:"plan"`
	ExpiresAt *time.Time           `json:"expires_at,omitempty"`
	Status    domain.LicenseStatus `json:"status"`
}

func ToLicenseDTO(u *domain.User) LicenseDTO {
	if u == nil {
		return LicenseDTO{Plan: string(domain.LicensePlanNone), Status: domain.LicenseStatusNone}
	}
	return LicenseDTO{
		Plan:      string(u.LicensePlan),
		ExpiresAt: u.LicenseExpiresAt,
		Status:    domain.LicenseStatusAt(u.LicensePlan, u.LicenseExpiresAt, time.Now()),
	}
}

type LoginResponse struct {
	Token   string        `json:"token,omitempty"`
	User    PublicUserDTO `json:"user"`
	License LicenseDTO    `json:"license"`
	// Organization is the active organization when the token is org-scoped.
	Organization *OrgSummaryDTO `json:"organization,omitempty"`
	// Memberships lists the user's selectable organizations.
	Memberships []MembershipDTO `json:"memberships,omitempty"`
	// SelectionRequired is true when the user belongs to several
	// organizations and must call /api/auth/select-org before working.
	SelectionRequired bool `json:"selection_required,omitempty"`
}

// OrgSummaryDTO is the organization projection clients need (selector, banner).
type OrgSummaryDTO struct {
	ID       string                  `json:"id"`
	Name     string                  `json:"name"`
	Slug     string                  `json:"slug"`
	Type     domain.OrganizationType `json:"type"`
	License  LicenseDTO              `json:"license"`
}

type MembershipDTO struct {
	OrganizationID string                  `json:"organization_id"`
	Roles          []domain.UserRole      `json:"roles"`
	Organization   OrgSummaryDTO          `json:"organization"`
}

func toOrgSummaryDTO(o domain.Organization) OrgSummaryDTO {
	return OrgSummaryDTO{
		ID:   o.ID,
		Name: o.Name,
		Slug: o.Slug,
		Type: o.Type,
		License: LicenseDTO{
			Plan:      string(o.LicensePlan),
			ExpiresAt: o.LicenseExpiresAt,
			Status:    domain.LicenseStatusAt(o.LicensePlan, o.LicenseExpiresAt, time.Now()),
		},
	}
}

func toMembershipDTOs(list []domain.MembershipWithOrg) []MembershipDTO {
	out := make([]MembershipDTO, 0, len(list))
	for _, m := range list {
		out = append(out, MembershipDTO{
			OrganizationID: m.OrganizationID,
			Roles:          m.Roles,
			Organization:   toOrgSummaryDTO(m.Organization),
		})
	}
	return out
}

func (s *Server) audit(ctx context.Context, eventType, actorUserID, organizationID, ip string, details map[string]interface{}) {
	// Best-effort: an audit write failure must not fail the request; it is
	// logged server-side instead.
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

func (s *Server) HandleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req LoginRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}

	// Uniform 401 for not found / wrong password / pending approval so clients
	// cannot enumerate accounts (issue #19). Dummy bcrypt when user missing
	// keeps response timing closer to the password-check path.
	const invalidCreds = "invalid email or password"

	failLogin := func(userID string) {
		s.audit(r.Context(), "login_failed", userID, "", clientIP(r), map[string]interface{}{
			"client": req.Client,
		})
		respondWithError(w, http.StatusUnauthorized, invalidCreds)
	}

	u, err := s.Store.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		_ = auth.CheckPasswordHash(req.Password, auth.DummyHash)
		failLogin("")
		return
	}

	if !auth.CheckPasswordHash(req.Password, u.PasswordHash) || !u.Active {
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
	if req.Org != "" {
		for i := range memberships {
			if memberships[i].Organization.Slug == req.Org {
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
		// Multi-organization user without a hint: no token yet, the client
		// must POST /api/auth/select-org with the chosen organization.
		s.audit(r.Context(), "login_success", u.ID, "", clientIP(r), map[string]interface{}{
			"client": req.Client, "selection_required": true,
		})
		respondWithJSON(w, http.StatusOK, LoginResponse{
			User:             ToPublicUserDTO(u),
			License:          LicenseDTO{Plan: string(domain.LicensePlanNone), Status: domain.LicenseStatusNone},
			Memberships:      toMembershipDTOs(memberships),
			SelectionRequired: true,
		})
		return
	}

	if chosen == nil && !u.PlatformAdmin {
		// No membership and not platform staff: nothing to log in to.
		s.audit(r.Context(), "login_failed", u.ID, "", clientIP(r), map[string]interface{}{
			"client": req.Client, "reason": "no_membership",
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
		sum := toOrgSummaryDTO(chosen.Organization)
		orgDTO = &sum
		license = sum.License
	} else {
		license = LicenseDTO{Plan: string(domain.LicensePlanNone), Status: domain.LicenseStatusNone}
	}

	var token string
	if req.Client == auth.ExtensionClient {
		// The extension always works inside the user's (single) organization.
		token, err = auth.GenerateExtensionToken(u.ID, u.Email, tc, s.JWTSecret)
	} else {
		token, err = auth.GenerateToken(u.ID, u.Email, tc, s.JWTSecret)
	}
	if err != nil {
		respondWithInternalError(w, err, "login: generate token")
		return
	}

	s.audit(r.Context(), "login_success", u.ID, tc.OrgID, clientIP(r), map[string]interface{}{
		"client": req.Client,
	})

	respondWithJSON(w, http.StatusOK, LoginResponse{
		Token:        token,
		User:         ToPublicUserDTO(u),
		License:      license,
		Organization: orgDTO,
		Memberships:  toMembershipDTOs(memberships),
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
	var body struct {
		OrganizationID string `json:"organization_id"`
	}
	if !decodeJSONBody(w, r, &body) || body.OrganizationID == "" {
		respondWithError(w, http.StatusBadRequest, "missing organization_id")
		return
	}

	m, err := s.Store.GetActiveMembership(r.Context(), claims.UserID, body.OrganizationID)
	if err != nil || m == nil || !m.Active || !m.Organization.Active || len(m.Roles) == 0 {
		respondWithError(w, http.StatusForbidden, "no tenés membresía activa en ese taller")
		return
	}

	roles := make([]string, len(m.Roles))
	for i, rl := range m.Roles {
		roles[i] = string(rl)
	}
	tc := auth.TokenContext{Roles: roles, OrgID: m.OrganizationID, PlatformAdmin: claims.PlatformAdmin}
	token, err := auth.GenerateToken(claims.UserID, claims.Email, tc, s.JWTSecret)
	if err != nil {
		respondWithInternalError(w, err, "select-org: generate token")
		return
	}

	s.audit(r.Context(), "organization_selected", claims.UserID, m.OrganizationID, clientIP(r), nil)

	u, err := s.Store.GetUserByID(r.Context(), claims.UserID)
	if err != nil || u == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	org := toOrgSummaryDTO(m.Organization)
	respondWithJSON(w, http.StatusOK, LoginResponse{
		Token:        token,
		User:         ToPublicUserDTO(u),
		License:      org.License,
		Organization: &org,
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
	if err != nil || u == nil || !u.Active {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}

	// Preserve the token kind (extension keeps read-only client + long TTL)
	// and the live organization scope; the middleware already refreshed the
	// membership roles into claims.
	tc := auth.TokenContext{
		Roles:         claims.Roles,
		OrgID:         claims.OrgID,
		PlatformAdmin: claims.PlatformAdmin,
	}
	var token string
	if claims.Client == auth.ExtensionClient {
		token, err = auth.GenerateExtensionToken(u.ID, u.Email, tc, s.JWTSecret)
	} else {
		token, err = auth.GenerateToken(u.ID, u.Email, tc, s.JWTSecret)
	}
	if err != nil {
		respondWithInternalError(w, err, "refresh: generate token")
		return
	}

	resp := LoginResponse{
		Token: token,
		User:  ToPublicUserDTO(u),
		License: LicenseDTO{
			Plan:      string(domain.LicensePlanNone),
			Status:    domain.LicenseStatusNone,
		},
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
		if !s.actorCanViewCosts(r) {
			domain.RedactProjectCosts(&p)
		}
		respondWithJSON(w, http.StatusCreated, p)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
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

// HandleAdminUsers: GET /api/admin/users — list all users (pending first).
func (s *Server) HandleAdminUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	list, err := s.Store.ListUsers(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "handler")
		return
	}
	respondWithJSON(w, http.StatusOK, ToPublicUserDTOs(list))
}

// HandleAssignableOwners: GET /api/assignable-owners
// Active users that can own a customer/project portfolio (admin + gerente).
func (s *Server) HandleAssignableOwners(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	roles := actorRoles(claimsFromRequest(r))
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAssignOwner), "no tenés permiso para asignar responsables") {
		return
	}
	list, err := s.Store.ListUsers(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "handler")
		return
	}
	out := make([]map[string]string, 0, len(list))
	for _, u := range list {
		if !u.Active {
			continue
		}
		// Portfolio owners are sales-facing roles (plus admin).
		switch u.Role {
		case domain.RoleAdmin, domain.RoleGerenteVentas, domain.RoleVendedor, domain.RoleUser:
			out = append(out, map[string]string{
				"id":   u.ID,
				"name": u.Name,
				"role": string(u.Role),
			})
		}
	}
	respondWithJSON(w, http.StatusOK, out)
}

// HandleAdminUserApprove: PUT /api/admin/users/{id}/approve
func (s *Server) HandleAdminUserApprove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing user id")
		return
	}
	if err := s.Store.ApproveUser(r.Context(), id); err != nil {
		respondWithInternalError(w, err, "handler")
		return
	}
	respondWithJSON(w, http.StatusOK, map[string]string{"message": "user approved"})
}

// HandleAdminUserRole: PUT /api/admin/users/{id}/role
func (s *Server) HandleAdminUserRole(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing user id")
		return
	}
	var body struct {
		Role domain.UserRole `json:"role"`
	}
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if body.Role == "" {
		respondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !domain.IsValidUserRole(body.Role) {
		respondWithError(w, http.StatusBadRequest, "invalid role")
		return
	}
	if err := s.Store.UpdateUserRole(r.Context(), id, body.Role); err != nil {
		respondWithInternalError(w, err, "handler")
		return
	}
	respondWithJSON(w, http.StatusOK, map[string]string{"message": "role updated"})
}

// HandleAdminUserLicense: PUT /api/admin/users/{id}/license
// Manually assigns the per-user licensing tier and optional expiry. Expiry is
// RFC 3339; omitting it (or null) means the license does not expire.
func (s *Server) HandleAdminUserLicense(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing user id")
		return
	}
	var body struct {
		LicensePlan      domain.LicensePlan `json:"license_plan"`
		LicenseExpiresAt *time.Time         `json:"license_expires_at"`
	}
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if !domain.IsValidLicensePlan(body.LicensePlan) {
		respondWithError(w, http.StatusBadRequest, "invalid license_plan")
		return
	}
	if err := s.Store.SetUserLicense(r.Context(), id, body.LicensePlan, body.LicenseExpiresAt); err != nil {
		respondWithInternalError(w, err, "handler")
		return
	}
	respondWithJSON(w, http.StatusOK, map[string]string{"message": "license updated"})
}

// HandleAdminUserReject: DELETE /api/admin/users/{id}
func (s *Server) HandleAdminUserReject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing user id")
		return
	}
	if err := s.Store.RejectUser(r.Context(), id); err != nil {
		respondWithInternalError(w, err, "handler")
		return
	}
	respondWithJSON(w, http.StatusOK, map[string]string{"message": "user rejected"})
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
