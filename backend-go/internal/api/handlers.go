package api

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// actorCanViewCosts resolves COST-01/COST-02 for the request actor (F039 + F044).
func (s *Server) actorCanViewCosts(r *http.Request) bool {
	role := actorRole(claimsFromRequest(r))
	ws, err := s.Store.GetWorkshopSettings(r.Context())
	flag := false
	if err == nil {
		flag = ws.VendedorCanViewCosts
	}
	return domain.RoleCanViewCosts(role, flag)
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

// respondWithInternalError logs the real error server-side but returns a generic
// message to the client. Internal error strings (DB driver text, constraint
// names, etc.) must never reach the client (#5).
func respondWithInternalError(w http.ResponseWriter, err error, op string) {
	log.Printf("internal error in %s: %v", op, err)
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
}

type LoginResponse struct {
	Token string      `json:"token"`
	User  domain.User `json:"user"`
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

	u, err := s.Store.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		_ = auth.CheckPasswordHash(req.Password, auth.DummyHash)
		respondWithError(w, http.StatusUnauthorized, invalidCreds)
		return
	}

	if !auth.CheckPasswordHash(req.Password, u.PasswordHash) || !u.Active {
		respondWithError(w, http.StatusUnauthorized, invalidCreds)
		return
	}

	token, err := auth.GenerateToken(u.ID, u.Email, string(u.Role), s.JWTSecret)
	if err != nil {
		respondWithInternalError(w, err, "login: generate token")
		return
	}

	respondWithJSON(w, http.StatusOK, LoginResponse{
		Token: token,
		User:  *u,
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

	token, err := auth.GenerateToken(u.ID, u.Email, string(u.Role), s.JWTSecret)
	if err != nil {
		respondWithInternalError(w, err, "refresh: generate token")
		return
	}

	respondWithJSON(w, http.StatusOK, LoginResponse{
		Token: token,
		User:  *u,
	})
}

// --- CUSTOMERS ---

func (s *Server) HandleCustomers(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	role := actorRole(claims)
	id := actorID(claims)

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.RoleCanAccessCustomers(role), "no tenés permiso para ver clientes") {
			return
		}
		list, err := s.Store.ListCustomers(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, filterCustomersByOwner(list, id, role))

	case http.MethodPost:
		if !requirePermission(w, domain.RoleCanMutateCustomers(role), "no tenés permiso para crear clientes") {
			return
		}
		var c domain.Customer
		if !decodeJSONBody(w, r, &c) {
			return
		}
		c.Active = true
		c.OwnerUserID = domain.ResolveOwnerOnCreate(id, role, c.OwnerUserID)
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
	role := actorRole(claims)
	uid := actorID(claims)

	if !requirePermission(w, domain.RoleCanAccessCustomers(role), "no tenés permiso para ver clientes") {
		return
	}

	switch r.Method {
	case http.MethodGet:
		c, err := s.Store.GetCustomerByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		if !domain.CanAccessOwnedResource(uid, role, c.OwnerUserID) {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodPut:
		if !requirePermission(w, domain.RoleCanMutateCustomers(role), "no tenés permiso para editar clientes") {
			return
		}
		existing, err := s.Store.GetCustomerByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		if !domain.CanAccessOwnedResource(uid, role, existing.OwnerUserID) {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		var c domain.Customer
		if !decodeJSONBody(w, r, &c) {
			return
		}
		c.OwnerUserID = domain.ResolveOwnerOnUpdate(role, existing.OwnerUserID, c.OwnerUserID)
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
		if !requirePermission(w, domain.RoleCanMutateCustomers(role), "no tenés permiso para eliminar clientes") {
			return
		}
		existing, err := s.Store.GetCustomerByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		if !domain.CanAccessOwnedResource(uid, role, existing.OwnerUserID) {
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
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
			return
		}
		var m domain.MaterialBoard
		if !decodeJSONBody(w, r, &m) {
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
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
			return
		}
		var m domain.MaterialBoard
		if !decodeJSONBody(w, r, &m) {
			return
		}
		err := s.Store.UpdateMaterialBoard(r.Context(), id, &m)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, m)

	case http.MethodDelete:
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
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
	role := actorRole(claims)
	uid := actorID(claims)

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.RoleCanAccessProjects(role), "no tenés permiso para ver cotizaciones") {
			return
		}
		list, err := s.Store.ListProjects(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		filtered := filterProjectsByOwner(list, uid, role)
		if !s.actorCanViewCosts(r) {
			domain.RedactProjectsList(filtered)
		}
		respondWithJSON(w, http.StatusOK, filtered)

	case http.MethodPost:
		if !requirePermission(w, domain.RoleCanMutateProjects(role), "no tenés permiso para crear cotizaciones") {
			return
		}
		var p domain.Project
		if !decodeJSONBody(w, r, &p) {
			return
		}

		if claims != nil {
			p.CreatedBy = claims.UserID
		}
		p.OwnerUserID = domain.ResolveOwnerOnCreate(uid, role, p.OwnerUserID)

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
	role := actorRole(claims)
	uid := actorID(claims)

	if !requirePermission(w, domain.RoleCanAccessProjects(role), "no tenés permiso para ver cotizaciones") {
		return
	}

	switch r.Method {
	case http.MethodGet:
		p, err := s.Store.GetProjectByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "project not found")
			return
		}
		if !domain.CanAccessOwnedResource(uid, role, p.OwnerUserID) {
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
		if !domain.CanAccessOwnedResource(uid, role, existing.OwnerUserID) {
			respondWithError(w, http.StatusNotFound, "project not found")
			return
		}
		var p domain.Project
		if !decodeJSONBody(w, r, &p) {
			return
		}

		// F036 status transitions: reopen / mark produced vs general mutate.
		statusChanging := p.Status != "" && p.Status != existing.Status
		if statusChanging {
			reopen := engine.IsProjectClosed(existing.Status) && p.Status == domain.StatusDraft
			markProduced := p.Status == domain.StatusProduced
			if reopen {
				if !requirePermission(w, domain.RoleCanReopenProject(role), "no tenés permiso para reabrir cotizaciones") {
					return
				}
			} else if markProduced {
				if !requirePermission(w, domain.RoleCanMarkProduced(role), "no tenés permiso para marcar en producción") {
					return
				}
				// Production queue roles may only flip status (not rewrite BOM).
				if !domain.RoleCanMutateProjects(role) {
					next := *existing
					next.Status = domain.StatusProduced
					if next.PriceSnapshot == nil && existing.PriceSnapshot != nil {
						next.PriceSnapshot = existing.PriceSnapshot
					}
					// Keep closed→closed snapshot; engine-equivalent without catalog re-freeze.
					p = next
				}
			} else if !requirePermission(w, domain.RoleCanMutateProjects(role), "no tenés permiso para editar cotizaciones") {
				return
			}
		} else if !requirePermission(w, domain.RoleCanMutateProjects(role), "no tenés permiso para editar cotizaciones") {
			return
		}

		p.OwnerUserID = domain.ResolveOwnerOnUpdate(role, existing.OwnerUserID, p.OwnerUserID)
		// Reopen must clear snapshot even if client resends one.
		if statusChanging && p.Status == domain.StatusDraft && engine.IsProjectClosed(existing.Status) {
			p.PriceSnapshot = nil
		}
		// Preserve snapshot when moving accepted → produced if client omitted it.
		if statusChanging && p.Status == domain.StatusProduced && p.PriceSnapshot == nil {
			p.PriceSnapshot = existing.PriceSnapshot
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
		if !requirePermission(w, domain.RoleCanDeleteProject(role), "no tenés permiso para eliminar cotizaciones") {
			return
		}
		existing, err := s.Store.GetProjectByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "project not found")
			return
		}
		if !domain.CanAccessOwnedResource(uid, role, existing.OwnerUserID) {
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
	role := actorRole(claims)
	uid := actorID(claims)
	if !requirePermission(w, domain.RoleCanAccessProjects(role), "no tenés permiso para ver cotizaciones") {
		return
	}

	p, err := s.Store.GetProjectByID(r.Context(), id)
	if err != nil {
		respondWithError(w, http.StatusNotFound, "project not found")
		return
	}
	if !domain.CanAccessOwnedResource(uid, role, p.OwnerUserID) {
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
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
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
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
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
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
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
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
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
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
			return
		}
		var h domain.Hardware
		if !decodeJSONBody(w, r, &h) {
			return
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
		respondWithJSON(w, http.StatusOK, h)

	case http.MethodDelete:
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
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
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
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
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
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
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
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
		if !requirePermission(w, domain.RoleCanMutateModules(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar muebles plantilla") {
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
		if !requirePermission(w, domain.RoleCanMutateModules(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar muebles plantilla") {
			return
		}
		var m domain.Module
		if !decodeJSONBody(w, r, &m) {
			return
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
		respondWithJSON(w, http.StatusOK, m)

	case http.MethodDelete:
		if !requirePermission(w, domain.RoleCanMutateModules(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar muebles plantilla") {
			return
		}
		err := s.Store.DeleteModule(r.Context(), id)
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "module deleted"})

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
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
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
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
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
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
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
	respondWithJSON(w, http.StatusOK, list)
}

// HandleAssignableOwners: GET /api/assignable-owners
// Active users that can own a customer/project portfolio (admin + gerente).
func (s *Server) HandleAssignableOwners(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	role := actorRole(claimsFromRequest(r))
	if !requirePermission(w, domain.RoleCanAssignOwner(role), "no tenés permiso para asignar responsables") {
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
	role := actorRole(claimsFromRequest(r))
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
		if !requirePermission(w, domain.RoleCanAccessSettings(role), "no tenés permiso para editar ajustes del taller") {
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
