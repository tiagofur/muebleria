package api

/**
 * Compras/Almacén — purchase orders (Fase 3c). Lifecycle:
 * borrador → emitida → recibida (via receive, which records stock entradas),
 * with cancelada available from borrador/emitida. Writes are admin/almacen.
 */

import (
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

type poItemRequest struct {
	Kind       string  `json:"kind"`
	MaterialID string  `json:"material_id"`
	Quantity   float64 `json:"quantity"`
	// OC-053: unit cost snapshot (job costing) frozen with the line.
	UnitCost *float64 `json:"unit_cost,omitempty"`
	// OC-052: the obra this line was bought for (real-need allocation).
	AllocatedProjectID *string `json:"allocated_project_id,omitempty"`
}

type purchaseOrderRequest struct {
	ID         string          `json:"id"`
	SupplierID string          `json:"supplier_id"`
	Notes      string          `json:"notes"`
	Items      []poItemRequest `json:"items"`
	// OC-053: need-by / supplier-promised dates (YYYY-MM-DD).
	RequiredBy *string `json:"required_by,omitempty"`
	ExpectedAt *string `json:"expected_at,omitempty"`
}

var poDatePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// validatePOExtras checks the OC-052/053 fields: dates are YYYY-MM-DD, the
// unit cost is non-negative and the allocated obra exists.
func (s *Server) validatePOExtras(r *http.Request, body *purchaseOrderRequest) string {
	for _, date := range []*string{body.RequiredBy, body.ExpectedAt} {
		if date != nil && *date != "" && !poDatePattern.MatchString(*date) {
			return "required_by/expected_at deben tener formato YYYY-MM-DD"
		}
	}
	seenProjects := map[string]bool{}
	for _, it := range body.Items {
		if it.UnitCost != nil && *it.UnitCost < 0 {
			return "unit_cost no puede ser negativo"
		}
		if it.AllocatedProjectID != nil && *it.AllocatedProjectID != "" {
			if seenProjects[*it.AllocatedProjectID] {
				continue
			}
			project, err := s.Store.GetProjectByID(r.Context(), *it.AllocatedProjectID)
			if err != nil || project == nil {
				return "la obra allocada no existe: " + *it.AllocatedProjectID
			}
			seenProjects[*it.AllocatedProjectID] = true
		}
	}
	return ""
}

func poItemsFromRequest(items []poItemRequest) []domain.PurchaseOrderItem {
	out := make([]domain.PurchaseOrderItem, 0, len(items))
	for _, it := range items {
		out = append(out, domain.PurchaseOrderItem{
			Kind:               domain.StockMaterialKind(it.Kind),
			MaterialID:         strings.TrimSpace(it.MaterialID),
			Quantity:           it.Quantity,
			UnitCost:           it.UnitCost,
			AllocatedProjectID: it.AllocatedProjectID,
		})
	}
	return out
}

// poNumber derives a stable human number from the client-minted id: OC-XXXXXX.
func poNumber(id string) string {
	short := id
	if len(short) > 6 {
		short = short[:6]
	}
	return "OC-" + strings.ToUpper(short)
}

func validPOItems(items []poItemRequest) bool {
	if len(items) == 0 {
		return false
	}
	for _, it := range items {
		if !domain.ValidStockMaterialKind(it.Kind) || strings.TrimSpace(it.MaterialID) == "" {
			return false
		}
		if it.Quantity <= 0 {
			return false
		}
	}
	return true
}

// HandlePurchaseOrders handles GET (list) / POST (create) /api/purchase-orders.
func (s *Server) HandlePurchaseOrders(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessPurchasingNav),
			"no tenés permiso para ver órdenes de compra") {
			return
		}
		list, err := s.Store.ListPurchaseOrders(r.Context())
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "no se pudieron leer las órdenes de compra")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanManagePurchasing),
			"no tenés permiso para crear órdenes de compra") {
			return
		}
		var body purchaseOrderRequest
		if !decodeJSONBody(w, r, &body) {
			return
		}
		id := strings.TrimSpace(body.ID)
		if id == "" {
			respondWithError(w, http.StatusBadRequest, "falta id")
			return
		}
		supplierID := strings.TrimSpace(body.SupplierID)
		if supplierID == "" {
			respondWithError(w, http.StatusBadRequest, "el proveedor es obligatorio")
			return
		}
		if !validPOItems(body.Items) {
			respondWithError(w, http.StatusBadRequest, "la orden necesita al menos un ítem válido (material + cantidad > 0)")
			return
		}
		if msg := s.validatePOExtras(r, &body); msg != "" {
			respondWithError(w, http.StatusBadRequest, msg)
			return
		}
		po := domain.PurchaseOrder{
			ID:         id,
			Number:     poNumber(id),
			SupplierID: supplierID,
			Status:     domain.POBorrador,
			Items:      poItemsFromRequest(body.Items),
			Notes:      strings.TrimSpace(body.Notes),
			RequiredBy: body.RequiredBy,
			ExpectedAt: body.ExpectedAt,
		}
		if uid := actorID(claims); uid != "" {
			po.CreatedBy = &uid
		}
		if err := s.Store.CreatePurchaseOrder(r.Context(), po); err != nil {
			respondWithError(w, http.StatusInternalServerError, "no se pudo crear la orden de compra")
			return
		}
		respondWithJSON(w, http.StatusCreated, po)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
	}
}

// HandlePurchaseOrderByID handles GET (read) / PUT (edit borrador).
func (s *Server) HandlePurchaseOrderByID(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "falta id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessPurchasingNav),
			"no tenés permiso para ver órdenes de compra") {
			return
		}
		po, err := s.Store.GetPurchaseOrderByID(r.Context(), id)
		if err != nil || po == nil {
			respondWithError(w, http.StatusNotFound, "orden de compra no encontrada")
			return
		}
		respondWithJSON(w, http.StatusOK, po)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanManagePurchasing),
			"no tenés permiso para editar órdenes de compra") {
			return
		}
		current, err := s.Store.GetPurchaseOrderByID(r.Context(), id)
		if err != nil || current == nil {
			respondWithError(w, http.StatusNotFound, "orden de compra no encontrada")
			return
		}
		if current.Status != domain.POBorrador {
			respondWithError(w, http.StatusBadRequest, "solo se puede editar una orden en borrador")
			return
		}
		var body purchaseOrderRequest
		if !decodeJSONBody(w, r, &body) {
			return
		}
		if !validPOItems(body.Items) {
			respondWithError(w, http.StatusBadRequest, "la orden necesita al menos un ítem válido (material + cantidad > 0)")
			return
		}
		if msg := s.validatePOExtras(r, &body); msg != "" {
			respondWithError(w, http.StatusBadRequest, msg)
			return
		}
		current.SupplierID = strings.TrimSpace(body.SupplierID)
		current.Notes = strings.TrimSpace(body.Notes)
		current.Items = poItemsFromRequest(body.Items)
		current.RequiredBy = body.RequiredBy
		current.ExpectedAt = body.ExpectedAt
		if err := s.Store.UpdatePurchaseOrder(r.Context(), *current); err != nil {
			respondWithError(w, http.StatusInternalServerError, "no se pudo actualizar la orden de compra")
			return
		}
		respondWithJSON(w, http.StatusOK, current)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
	}
}

// HandlePurchaseOrderEmit handles POST /api/purchase-orders/{id}/emit.
func (s *Server) HandlePurchaseOrderEmit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanManagePurchasing),
		"no tenés permiso para emitir órdenes de compra") {
		return
	}
	id := r.PathValue("id")
	current, err := s.Store.GetPurchaseOrderByID(r.Context(), id)
	if err != nil || current == nil {
		respondWithError(w, http.StatusNotFound, "orden de compra no encontrada")
		return
	}
	if !domain.PurchaseOrderCanEmit(current.Status) {
		respondWithError(w, http.StatusBadRequest, "solo una orden en borrador se puede emitir")
		return
	}
	po, err := s.Store.EmitPurchaseOrder(r.Context(), id)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudo emitir la orden")
		return
	}
	respondWithJSON(w, http.StatusOK, po)
}

// HandlePurchaseOrderCancel handles POST /api/purchase-orders/{id}/cancel.
func (s *Server) HandlePurchaseOrderCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanManagePurchasing),
		"no tenés permiso para cancelar órdenes de compra") {
		return
	}
	id := r.PathValue("id")
	current, err := s.Store.GetPurchaseOrderByID(r.Context(), id)
	if err != nil || current == nil {
		respondWithError(w, http.StatusNotFound, "orden de compra no encontrada")
		return
	}
	if !domain.PurchaseOrderCanCancel(current.Status) {
		respondWithError(w, http.StatusBadRequest, "esta orden no se puede cancelar (estado terminal)")
		return
	}
	po, err := s.Store.CancelPurchaseOrder(r.Context(), id)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudo cancelar la orden")
		return
	}
	respondWithJSON(w, http.StatusOK, po)
}

type receivePORequest struct {
	Lines []poItemRequest `json:"lines"`
}

// HandlePurchaseOrderReceive handles POST /api/purchase-orders/{id}/receive —
// records stock entradas (note "OC-<number>") and advances the order.
func (s *Server) HandlePurchaseOrderReceive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanManagePurchasing),
		"no tenés permiso para recibir órdenes de compra") {
		return
	}
	id := r.PathValue("id")
	current, err := s.Store.GetPurchaseOrderByID(r.Context(), id)
	if err != nil || current == nil {
		respondWithError(w, http.StatusNotFound, "orden de compra no encontrada")
		return
	}
	if !domain.PurchaseOrderCanReceive(current.Status) {
		respondWithError(w, http.StatusBadRequest, "solo una orden emitida se puede recibir")
		return
	}
	var body receivePORequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if !validPOItems(body.Lines) {
		respondWithError(w, http.StatusBadRequest, "faltan líneas válidas para recibir (material + cantidad > 0)")
		return
	}
	lines := make([]domain.PurchaseOrderItem, 0, len(body.Lines))
	for _, it := range body.Lines {
		lines = append(lines, domain.PurchaseOrderItem{
			Kind:       domain.StockMaterialKind(it.Kind),
			MaterialID: strings.TrimSpace(it.MaterialID),
			Quantity:   it.Quantity,
		})
	}

	byUserID := actorID(claims)
	byName := claims.Email
	if user, uErr := s.Store.GetUserByID(r.Context(), byUserID); uErr == nil && user != nil && user.Name != "" {
		byName = user.Name
	}
	po, err := s.Store.ReceivePurchaseOrder(r.Context(), id, lines, byUserID, byName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			respondWithError(w, http.StatusNotFound, "orden de compra no encontrada")
			return
		}
		if errors.Is(err, domain.ErrPurchaseOrderNotReceivable) {
			respondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		if strings.Contains(err.Error(), "no pertenece a esta orden") || strings.Contains(err.Error(), "excede el restante") || strings.Contains(err.Error(), "mayor a cero") {
			respondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		respondWithError(w, http.StatusInternalServerError, "no se pudo registrar la recepción")
		return
	}
	respondWithJSON(w, http.StatusOK, po)
}
