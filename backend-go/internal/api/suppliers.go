package api

/**
 * Compras/Almacén — supplier directory (Fase 3c). CRUD for vendors; writes are
 * admin/almacen, reads are the workspace roles.
 */

import (
	"net/http"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

type supplierRequest struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	ContactName string `json:"contact_name"`
	Email       string `json:"email"`
	Phone       string `json:"phone"`
	Notes       string `json:"notes"`
	Active      *bool  `json:"active"`
}

func supplierFromRequest(body supplierRequest) domain.Supplier {
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	return domain.Supplier{
		ID:          strings.TrimSpace(body.ID),
		Name:        strings.TrimSpace(body.Name),
		ContactName: strings.TrimSpace(body.ContactName),
		Email:       strings.TrimSpace(body.Email),
		Phone:       strings.TrimSpace(body.Phone),
		Notes:       strings.TrimSpace(body.Notes),
		Active:      active,
	}
}

// HandleSuppliers handles GET (list) / POST (create) /api/suppliers.
func (s *Server) HandleSuppliers(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessPurchasingNav),
			"no tenés permiso para ver proveedores") {
			return
		}
		list, err := s.Store.ListSuppliers(r.Context())
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "no se pudieron leer los proveedores")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanManagePurchasing),
			"no tenés permiso para crear proveedores") {
			return
		}
		var body supplierRequest
		if !decodeJSONBody(w, r, &body) {
			return
		}
		sp := supplierFromRequest(body)
		if sp.ID == "" {
			respondWithError(w, http.StatusBadRequest, "falta id")
			return
		}
		if sp.Name == "" {
			respondWithError(w, http.StatusBadRequest, "el nombre del proveedor es obligatorio")
			return
		}
		if err := s.Store.CreateSupplier(r.Context(), sp); err != nil {
			respondWithError(w, http.StatusInternalServerError, "no se pudo crear el proveedor")
			return
		}
		respondWithJSON(w, http.StatusCreated, sp)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
	}
}

// HandleSupplierByID handles PUT (update) / DELETE (deactivate) /api/suppliers/{id}.
func (s *Server) HandleSupplierByID(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanManagePurchasing),
		"no tenés permiso para modificar proveedores") {
		return
	}
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "falta id")
		return
	}

	switch r.Method {
	case http.MethodPut:
		var body supplierRequest
		if !decodeJSONBody(w, r, &body) {
			return
		}
		sp := supplierFromRequest(body)
		sp.ID = id
		if sp.Name == "" {
			respondWithError(w, http.StatusBadRequest, "el nombre del proveedor es obligatorio")
			return
		}
		if err := s.Store.UpdateSupplier(r.Context(), sp); err != nil {
			respondWithError(w, http.StatusInternalServerError, "no se pudo actualizar el proveedor")
			return
		}
		respondWithJSON(w, http.StatusOK, sp)

	case http.MethodDelete:
		if err := s.Store.DeactivateSupplier(r.Context(), id); err != nil {
			respondWithError(w, http.StatusInternalServerError, "no se pudo desactivar el proveedor")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]bool{"ok": true})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
	}
}
