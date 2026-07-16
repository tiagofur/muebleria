package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

type Server struct {
	Store           Store
	JWTSecret       string
	allowedOrigins  []string
	rateLimitRPS    float64
	rateLimitBurst  int
}

func NewServer(store Store, jwtSecret string, allowedOrigins []string, rateLimitRPS float64, rateLimitBurst int) *Server {
	return &Server{
		Store:           store,
		JWTSecret:       jwtSecret,
		allowedOrigins:  allowedOrigins,
		rateLimitRPS:    rateLimitRPS,
		rateLimitBurst:  rateLimitBurst,
	}
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid request body")
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid request body")
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

// --- CUSTOMERS ---

func (s *Server) HandleCustomers(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListCustomers(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		var c domain.Customer
		if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		c.Active = true
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

	switch r.Method {
	case http.MethodGet:
		c, err := s.Store.GetCustomerByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodPut:
		var c domain.Customer
		if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		err := s.Store.UpdateCustomer(r.Context(), id, &c)
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
		err := s.Store.DeactivateCustomer(r.Context(), id)
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
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		var m domain.MaterialBoard
		if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
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
		respondWithJSON(w, http.StatusOK, m)

	case http.MethodPut:
		var m domain.MaterialBoard
		if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
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
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListProjects(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		var p domain.Project
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		// Si viene el usuario autenticado en contexto, registrar como creador
		claims, ok := r.Context().Value(UserContextKey).(*auth.Claims)
		if ok && claims != nil {
			p.CreatedBy = claims.UserID
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

	switch r.Method {
	case http.MethodGet:
		p, err := s.Store.GetProjectByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "project not found")
			return
		}
		respondWithJSON(w, http.StatusOK, p)

	case http.MethodPut:
		var p domain.Project
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		err := s.Store.UpdateProject(r.Context(), id, &p)
		if err != nil {
			// 404 lets the FE upsert fall through to POST create (same pattern as
			// materials/customers). A silent 200 on missing id left phantom projects.
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, p)

	case http.MethodDelete:
		err := s.Store.DeleteProject(r.Context(), id)
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

	p, err := s.Store.GetProjectByID(r.Context(), id)
	if err != nil {
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
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		var e domain.EdgeBand
		if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
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
		respondWithJSON(w, http.StatusOK, e)

	case http.MethodPut:
		var e domain.EdgeBand
		if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
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
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		var h domain.Hardware
		if err := json.NewDecoder(r.Body).Decode(&h); err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
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
		respondWithJSON(w, http.StatusOK, h)

	case http.MethodPut:
		var h domain.Hardware
		if err := json.NewDecoder(r.Body).Decode(&h); err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
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
		var og domain.OptionGroup
		if err := json.NewDecoder(r.Body).Decode(&og); err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
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
		var og domain.OptionGroup
		if err := json.NewDecoder(r.Body).Decode(&og); err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
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
		var m domain.Module
		if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
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
		var m domain.Module
		if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
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
		var c domain.ModuleCategory
		if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
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
		var c domain.ModuleCategory
		if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
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
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Role == "" {
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
