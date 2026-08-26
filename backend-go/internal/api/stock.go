package api

/**
 * Compras/Almacén stock (Fase 3b, diseño 06-stock-almacen.md): real inventory
 * per catalog material. GET/PUT /api/stock manage balances + mínimos; the
 * movement ledger (POST/GET /api/stock/movements) is the auditable truth —
 * every entrada/salida/ajuste/despacho records who/when/why and a balance
 * snapshot, mirroring the floor-event audit pattern (F092).
 */

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// stockRowResponse adds the derived alert status to a MaterialStock row.
type stockRowResponse struct {
	domain.MaterialStock
	Status domain.StockStatus `json:"status"`
}

// HandleStockList handles GET /api/stock — every tracked material with its
// balance, minimum and derived status. Visible to the workspace roles
// (admin / gerente_produccion / almacen).
func (s *Server) HandleStockList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanAccessPurchasingNav),
		"no tenés permiso para ver el stock") {
		return
	}
	rows, err := s.Store.ListStock(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudo leer el stock")
		return
	}
	out := make([]stockRowResponse, 0, len(rows))
	for _, st := range rows {
		out = append(out, stockRowResponse{
			MaterialStock: st,
			Status:        domain.StockStatusOf(st.Quantity, st.MinStock),
		})
	}
	respondWithJSON(w, http.StatusOK, out)
}

type stockUpsertMinRequest struct {
	Kind       string  `json:"kind"`
	MaterialID string  `json:"material_id"`
	MinStock   float64 `json:"min_stock"`
}

// HandleStockUpsertMin handles PUT /api/stock — sets the minimum-stock
// threshold of a material (creates the row if never tracked).
func (s *Server) HandleStockUpsertMin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanManageStock),
		"no tenés permiso para modificar el stock") {
		return
	}
	var body stockUpsertMinRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	kind := strings.TrimSpace(body.Kind)
	materialID := strings.TrimSpace(body.MaterialID)
	if !domain.ValidStockMaterialKind(kind) {
		respondWithError(w, http.StatusBadRequest, "material inválido (herrajes | tableros | cintillas)")
		return
	}
	if materialID == "" {
		respondWithError(w, http.StatusBadRequest, "falta material_id")
		return
	}
	if body.MinStock < 0 {
		respondWithError(w, http.StatusBadRequest, "el mínimo no puede ser negativo")
		return
	}
	st, err := s.Store.UpsertStockMin(r.Context(), domain.StockMaterialKind(kind), materialID, body.MinStock)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudo guardar el mínimo")
		return
	}
	respondWithJSON(w, http.StatusOK, stockRowResponse{
		MaterialStock: st,
		Status:        domain.StockStatusOf(st.Quantity, st.MinStock),
	})
}

type stockMovementRequest struct {
	Kind       string  `json:"kind"`
	MaterialID string  `json:"material_id"`
	Type       string  `json:"type"`
	Quantity   float64 `json:"quantity"`
	ProjectID  string  `json:"project_id"`
	Note       string  `json:"note"`
	RevertsID  string  `json:"reverts_id"`
}

// HandleStockMovementCreate handles POST /api/stock/movements — appends a
// ledger row and updates the live balance atomically (who/when from the JWT).
func (s *Server) HandleStockMovementCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanManageStock),
		"no tenés permiso para registrar movimientos de stock") {
		return
	}
	var body stockMovementRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	kind := strings.TrimSpace(body.Kind)
	materialID := strings.TrimSpace(body.MaterialID)
	if !domain.ValidStockMaterialKind(kind) {
		respondWithError(w, http.StatusBadRequest, "material inválido (herrajes | tableros | cintillas)")
		return
	}
	if materialID == "" {
		respondWithError(w, http.StatusBadRequest, "falta material_id")
		return
	}
	if !domain.ValidStockMovementType(body.Type) {
		respondWithError(w, http.StatusBadRequest, "tipo inválido (entrada | salida | ajuste | despacho)")
		return
	}
	delta, err := domain.StockDeltaForType(domain.StockMovementType(body.Type), body.Quantity)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	projectID := strings.TrimSpace(body.ProjectID)
	if projectID != "" {
		project, pErr := s.Store.GetProjectByID(r.Context(), projectID)
		if pErr != nil || project == nil {
			respondWithError(w, http.StatusNotFound, "obra no encontrada")
			return
		}
	}
	// Reversión (desmarcar un despacho): un movimiento `despacho` con
	// reverts_id ACREDITA de vuelta el saldo (delta positivo), enlazado al
	// movimiento original para auditoría. Solo se revierten despachos del
	// mismo material y con el monto exacto del original.
	reverting := false
	revertsID := strings.TrimSpace(body.RevertsID)
	if revertsID != "" {
		if body.Type != string(domain.StockMovementDespacho) {
			respondWithError(w, http.StatusBadRequest, "solo un movimiento de tipo despacho puede tener reverts_id")
			return
		}
		original, mErr := s.Store.GetStockMovementByID(r.Context(), revertsID)
		if mErr != nil || original == nil {
			respondWithError(w, http.StatusNotFound, "movimiento a revertir no encontrado")
			return
		}
		if original.Type != domain.StockMovementDespacho {
			respondWithError(w, http.StatusBadRequest, "solo se puede revertir un despacho")
			return
		}
		if original.Kind != domain.StockMaterialKind(kind) || original.MaterialID != materialID {
			respondWithError(w, http.StatusBadRequest, "el movimiento a revertir no corresponde a este material")
			return
		}
		if math.Abs(body.Quantity)-math.Abs(original.Delta) > 1e-6 || math.Abs(original.Delta)-math.Abs(body.Quantity) > 1e-6 {
			respondWithError(w, http.StatusBadRequest, "el monto de la reversión debe ser exactamente igual al despacho original")
			return
		}
		alreadyReverted, rErr := s.Store.GetStockMovementByRevertsID(r.Context(), revertsID)
		if rErr == nil && alreadyReverted != nil {
			respondWithError(w, http.StatusConflict, "este despacho ya fue revertido")
			return
		}
		reverting = true
	}
	if reverting {
		delta = -delta // despacho debitó (−qty) → reversión acredita (+qty)
	}

	mov := domain.StockMovement{
		Kind:       domain.StockMaterialKind(kind),
		MaterialID: materialID,
		Type:       domain.StockMovementType(body.Type),
		Delta:      delta,
	}
	if projectID != "" {
		mov.ProjectID = &projectID
	}
	note := strings.TrimSpace(body.Note)
	if note != "" {
		mov.Note = &note
	}
	if revertsID != "" {
		mov.RevertsID = &revertsID
	}
	// Who/when stamped by the server (floor-event audit parity).
	if uid := actorID(claims); uid != "" {
		mov.ByUserID = &uid
	}
	name := claims.Email
	if user, uErr := s.Store.GetUserByID(r.Context(), actorID(claims)); uErr == nil && user != nil && user.Name != "" {
		name = user.Name
	}
	if name != "" {
		mov.ByName = &name
	}

	saved, err := s.Store.RecordStockMovement(r.Context(), mov)
	if err != nil {
		if errors.Is(err, domain.ErrStockNotTracked) {
			respondWithError(w, http.StatusNotFound, "material sin stock cargado — recibí una entrada primero")
			return
		}
		if errors.Is(err, domain.ErrStockInsufficient) {
			respondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		if isDuplicateKey(err) {
			respondWithError(w, http.StatusConflict, "este despacho ya fue revertido")
			return
		}
		respondWithError(w, http.StatusInternalServerError, "no se pudo registrar el movimiento")
		return
	}
	respondWithJSON(w, http.StatusCreated, saved)
}

// HandleStockMovementsList handles GET /api/stock/movements — the ledger,
// newest first, optionally filtered by kind/material_id/project_id. Visible to the
// workspace roles (read-only for gerente_produccion).
func (s *Server) HandleStockMovementsList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanAccessPurchasingNav),
		"no tenés permiso para ver los movimientos de stock") {
		return
	}
	q := r.URL.Query()
	kind := strings.TrimSpace(q.Get("kind"))
	if kind != "" && !domain.ValidStockMaterialKind(kind) {
		respondWithError(w, http.StatusBadRequest, "material inválido (herrajes | tableros | cintillas)")
		return
	}
	materialID := strings.TrimSpace(q.Get("material_id"))
	projectID := strings.TrimSpace(q.Get("project_id"))
	limit := 50
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			respondWithError(w, http.StatusBadRequest, "limit inválido")
			return
		}
		if n > 200 {
			n = 200
		}
		limit = n
	}

	moves, err := s.Store.ListStockMovements(r.Context(), domain.StockMaterialKind(kind), materialID, projectID, limit)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudo leer el historial de stock")
		return
	}
	respondWithJSON(w, http.StatusOK, moves)
}
