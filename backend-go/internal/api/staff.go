package api

/**
 * Staff management handlers — gerente_produccion manages production staff,
 * gerente_ventas manages sales staff, admin manages all.
 *
 * Endpoints:
 *   GET    /api/staff/production    — List production operators
 *   POST   /api/staff/production    — Create production operator
 *   PUT    /api/staff/production/{id} — Update production operator
 *   DELETE /api/staff/production/{id} — Delete production operator
 *   GET    /api/staff/sales         — List sales staff
 *   POST   /api/staff/sales         — Create sales staff
 *   PUT    /api/staff/sales/{id}    — Update sales staff
 *   DELETE /api/staff/sales/{id}    — Delete sales staff
 */

import (
	"net/http"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

type staffRequest struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password,omitempty"`
	Role     string `json:"role"`
	Active   *bool  `json:"active,omitempty"`
}

// HandleStaffByRole handles GET /api/staff/{department}
// department = "production" or "sales"
func (s *Server) HandleStaffByRole(w http.ResponseWriter, r *http.Request) {
	department := r.PathValue("department")
	if department == "" {
		respondWithError(w, http.StatusBadRequest, "department required")
		return
	}

	var roles []domain.UserRole
	switch department {
	case "production":
		roles = []domain.UserRole{domain.RoleProduccion}
	case "warehouse":
		roles = []domain.UserRole{domain.RoleAlmacen}
	case "sales":
		roles = []domain.UserRole{domain.RoleVendedor}
	default:
		respondWithError(w, http.StatusBadRequest, "invalid department")
		return
	}

	users, err := s.Store.ListUsers(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "failed to list users")
		return
	}

	// Filter by roles
	var filtered []domain.User
	roleSet := make(map[domain.UserRole]bool)
	for _, role := range roles {
		roleSet[role] = true
	}
	for _, u := range users {
		if roleSet[u.Role] {
			filtered = append(filtered, u)
		}
	}

	respondWithJSON(w, http.StatusOK, filtered)
}

// HandleStaffCreate handles POST /api/staff/{department}
func (s *Server) HandleStaffCreate(w http.ResponseWriter, r *http.Request) {
	department := r.PathValue("department")
	if department == "" {
		respondWithError(w, http.StatusBadRequest, "department required")
		return
	}

	var req staffRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}

	// Validate role matches department
	role := domain.UserRole(req.Role)
	switch department {
	case "production":
		if role != domain.RoleProduccion {
			respondWithError(w, http.StatusBadRequest, "invalid role for production department")
			return
		}
	case "warehouse":
		if role != domain.RoleAlmacen {
			respondWithError(w, http.StatusBadRequest, "invalid role for warehouse department")
			return
		}
	case "sales":
		if role != domain.RoleVendedor {
			respondWithError(w, http.StatusBadRequest, "invalid role for sales department")
			return
		}
	default:
		respondWithError(w, http.StatusBadRequest, "invalid department")
		return
	}

	// Validate required fields
	if req.Email == "" || req.Name == "" || req.Password == "" {
		respondWithError(w, http.StatusBadRequest, "email, name, and password required")
		return
	}

	// Hash password
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		respondWithInternalError(w, err, "staff create: hash password")
		return
	}

	// Create user
	user := &domain.User{
		Email:        req.Email,
		Name:         req.Name,
		PasswordHash: hash,
		Role:         role,
		Active:       true,
	}
	if err := s.Store.CreateUser(r.Context(), user); err != nil {
		respondWithError(w, http.StatusInternalServerError, "failed to create user")
		return
	}

	respondWithJSON(w, http.StatusCreated, user)
}

// HandleStaffUpdate handles PUT /api/staff/{department}/{id}
func (s *Server) HandleStaffUpdate(w http.ResponseWriter, r *http.Request) {
	department := r.PathValue("department")
	userID := r.PathValue("id")
	if department == "" || userID == "" {
		respondWithError(w, http.StatusBadRequest, "department and user ID required")
		return
	}

	var req staffRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}

	// Get existing user
	existing, err := s.Store.GetUserByID(r.Context(), userID)
	if err != nil || existing == nil {
		respondWithError(w, http.StatusNotFound, "user not found")
		return
	}

	// Validate role matches department
	role := domain.UserRole(req.Role)
	switch department {
	case "production":
		if role != domain.RoleProduccion {
			respondWithError(w, http.StatusBadRequest, "invalid role for production department")
			return
		}
	case "warehouse":
		if role != domain.RoleAlmacen {
			respondWithError(w, http.StatusBadRequest, "invalid role for warehouse department")
			return
		}
	case "sales":
		if role != domain.RoleVendedor {
			respondWithError(w, http.StatusBadRequest, "invalid role for sales department")
			return
		}
	default:
		respondWithError(w, http.StatusBadRequest, "invalid department")
		return
	}

	// Update user
	existing.Name = req.Name
	existing.Role = role
	if req.Active != nil {
		existing.Active = *req.Active
	}

	if err := s.Store.UpdateUser(r.Context(), existing); err != nil {
		respondWithError(w, http.StatusInternalServerError, "failed to update user")
		return
	}

	respondWithJSON(w, http.StatusOK, existing)
}

// HandleStaffDelete handles DELETE /api/staff/{department}/{id}
// Soft delete: sets active = false
func (s *Server) HandleStaffDelete(w http.ResponseWriter, r *http.Request) {
	department := r.PathValue("department")
	userID := r.PathValue("id")
	if department == "" || userID == "" {
		respondWithError(w, http.StatusBadRequest, "department and user ID required")
		return
	}

	// Get existing user
	existing, err := s.Store.GetUserByID(r.Context(), userID)
	if err != nil || existing == nil {
		respondWithError(w, http.StatusNotFound, "user not found")
		return
	}

	// Soft delete
	existing.Active = false
	if err := s.Store.UpdateUser(r.Context(), existing); err != nil {
		respondWithError(w, http.StatusInternalServerError, "failed to deactivate user")
		return
	}

	respondWithJSON(w, http.StatusOK, map[string]string{"status": "deactivated"})
}
