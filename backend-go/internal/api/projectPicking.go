package api

/**
 * Compras/Almacén picking (Fase 3) — persistence for the warehouse picking
 * lists. One row per project × material (herrajes/tableros/cintillas) with a
 * pendiente/despachado status. The server stamps who/when on despacho from the
 * JWT actor (marked_at / marked_by), mirroring the floor-event audit pattern.
 */

import (
	"net/http"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

var pickingMaterials = map[string]bool{
	"herrajes":  true,
	"tableros":  true,
	"cintillas": true,
}

// HandlePickingList handles GET /api/picking — every project × material
// picking state. Visible to admin / gerente_produccion / almacen (the same
// roles that open the Compras/Almacén workspace).
func (s *Server) HandlePickingList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	if !requirePermission(w, domain.RoleCanAccessPurchasingNav(actorRole(claimsFromRequest(r))),
		"no tenés permiso para ver las listas de picking") {
		return
	}
	picks, err := s.Store.ListAllPicking(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudieron leer los estados de picking")
		return
	}
	respondWithJSON(w, http.StatusOK, picks)
}

type pickingUpsertRequest struct {
	ProjectID string `json:"project_id"`
	Material  string `json:"material"`
	Status    string `json:"status"`
}

// HandlePickingUpsert handles PUT /api/picking — sets one project × material
// picking state. Only admin / almacen mark (gerente_produccion is read-only
// in the workspace — Fase 3 parity).
func (s *Server) HandlePickingUpsert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.RoleCanMarkPicking(actorRole(claims)),
		"no tenés permiso para marcar despachos") {
		return
	}
	var body pickingUpsertRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	projectID := strings.TrimSpace(body.ProjectID)
	material := strings.TrimSpace(body.Material)
	status := strings.TrimSpace(body.Status)
	if projectID == "" {
		respondWithError(w, http.StatusBadRequest, "falta project_id")
		return
	}
	if !pickingMaterials[material] {
		respondWithError(w, http.StatusBadRequest, "material inválido (herrajes | tableros | cintillas)")
		return
	}
	if status != "pendiente" && status != "despachado" {
		respondWithError(w, http.StatusBadRequest, "status inválido (pendiente | despachado)")
		return
	}

	project, err := s.Store.GetProjectByID(r.Context(), projectID)
	if err != nil || project == nil {
		respondWithError(w, http.StatusNotFound, "obra no encontrada")
		return
	}

	pick := domain.ProjectPicking{
		ProjectID: projectID,
		Material:  material,
		Status:    status,
	}
	if status == "despachado" {
		now := time.Now().UTC()
		userID := actorID(claims)
		pick.MarkedAt = &now
		pick.MarkedBy = &userID
	}

	if err := s.Store.UpsertProjectPicking(r.Context(), pick); err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudo guardar el estado de picking")
		return
	}
	respondWithJSON(w, http.StatusOK, pick)
}
