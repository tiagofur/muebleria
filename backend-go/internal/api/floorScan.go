package api

/**
 * Floor scan endpoint (PROD-3.1 / F089-RN / F092): the mobile or web companion
 * scans a piece or module label QR, the server resolves the project line item
 * and atomically updates its shop-floor status — one row, no project rewrite,
 * returning the updated loading checklist progress.
 */

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

type floorScanRequest struct {
	Module       string `json:"module"`
	FactoryCode  string `json:"factory_code"`
	ItemID       string `json:"item_id"`
	TargetStatus string `json:"target_status"`
	Advance      bool   `json:"advance"`
}

type floorScanResponse struct {
	ProjectID       string                 `json:"project_id"`
	ProjectName     string                 `json:"project_name"`
	ItemID          string                 `json:"item_id"`
	FactoryCode     string                 `json:"factory_code"`
	ModuleCode      string                 `json:"module_code"`
	ModuleName      string                 `json:"module_name"`
	StatusBefore    string                 `json:"status_before"`
	StatusAfter     string                 `json:"status_after"`
	NextStatus      string                 `json:"next_status"`
	LoadingProgress domain.LoadingProgress `json:"loading_progress"`
}

// factoryCodeFor mirrors the TS row builder: first line of a module code
// keeps the bare code, duplicates get -L2, -L3…
func factoryCodeFor(moduleCode string, seen int) string {
	if seen <= 1 {
		return moduleCode
	}
	return moduleCode + "-L" + strconv.Itoa(seen)
}

func (s *Server) HandleProjectFloorScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	projectID := r.PathValue("id")
	if projectID == "" {
		respondWithError(w, http.StatusBadRequest, "missing project id")
		return
	}
	claims := claimsFromRequest(r)
	role := actorRole(claims)
	// Same gate as the web paperless panel: mark-produced or export-production.
	if !requirePermission(w,
		domain.RoleCanMarkProduced(role) || domain.RoleCanExportProduction(role),
		"no tenés permiso para avanzar el piso de fábrica") {
		return
	}

	var body floorScanRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	moduleNeedle := strings.TrimSpace(body.Module)
	factoryNeedle := strings.TrimSpace(body.FactoryCode)
	itemIDNeedle := strings.TrimSpace(body.ItemID)
	if moduleNeedle == "" && factoryNeedle == "" && itemIDNeedle == "" {
		respondWithError(w, http.StatusBadRequest, "falta el código de módulo o id de pieza")
		return
	}

	project, err := s.Store.GetProjectByID(r.Context(), projectID)
	if err != nil || project == nil {
		respondWithError(w, http.StatusNotFound, "obra no encontrada")
		return
	}

	// Resolve module codes per item; duplicate codes get -L2/-L3 suffixes.
	type resolved struct {
		item        *domain.ProjectItem
		moduleCode  string
		moduleName  string
		factoryCode string
	}
	counts := map[string]int{}
	var lines []resolved
	for i := range project.Items {
		item := &project.Items[i]
		code := item.ModuleID
		name := ""
		if mod, mErr := s.Store.GetModuleByID(r.Context(), item.ModuleID); mErr == nil && mod != nil {
			if mod.Code != "" {
				code = mod.Code
			}
			name = mod.Name
		}
		counts[code]++
		fc := factoryCodeFor(code, counts[code])
		lines = append(lines, resolved{item: item, moduleCode: code, moduleName: name, factoryCode: fc})
	}

	var match *resolved
	if itemIDNeedle != "" {
		for i := range lines {
			if lines[i].item.ID == itemIDNeedle {
				match = &lines[i]
				break
			}
		}
	}

	if match == nil {
		want := strings.ToLower(factoryNeedle)
		if want == "" {
			want = strings.ToLower(moduleNeedle)
		}
		for i := range lines {
			lc := strings.ToLower(lines[i].factoryCode)
			if lc == want || strings.ToLower(lines[i].moduleCode) == want {
				match = &lines[i]
				break
			}
		}
	}

	if match == nil {
		respondWithError(w, http.StatusNotFound, "módulo no encontrado en esta obra")
		return
	}

	before := domain.NormalizeItemFloorStatus(match.item.FloorStatus)
	after := before

	if body.TargetStatus != "" {
		target := domain.NormalizeItemFloorStatus(strings.TrimSpace(body.TargetStatus))
		if err := s.Store.SetProjectItemFloorStatus(r.Context(), projectID, match.item.ID, target); err != nil {
			respondWithError(w, http.StatusInternalServerError, "no se pudo actualizar el estado")
			return
		}
		after = target
	} else if body.Advance {
		if next := domain.NextItemFloorStatus(before); next != "" {
			if err := s.Store.SetProjectItemFloorStatus(r.Context(), projectID, match.item.ID, next); err != nil {
				respondWithError(w, http.StatusInternalServerError, "no se pudo avanzar el estado")
				return
			}
			after = next
		}
	}

	match.item.FloorStatus = after
	progress := domain.CalculateLoadingProgress(project)

	respondWithJSON(w, http.StatusOK, floorScanResponse{
		ProjectID:       project.ID,
		ProjectName:     project.Name,
		ItemID:          match.item.ID,
		FactoryCode:     match.factoryCode,
		ModuleCode:      match.moduleCode,
		ModuleName:      match.moduleName,
		StatusBefore:    before,
		StatusAfter:     after,
		NextStatus:      domain.NextItemFloorStatus(after),
		LoadingProgress: progress,
	})
}

// HandleProjectLoadingStatus handles GET /api/projects/{id}/loading-status
func (s *Server) HandleProjectLoadingStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	projectID := r.PathValue("id")
	if projectID == "" {
		respondWithError(w, http.StatusBadRequest, "missing project id")
		return
	}

	project, err := s.Store.GetProjectByID(r.Context(), projectID)
	if err != nil || project == nil {
		respondWithError(w, http.StatusNotFound, "obra no encontrada")
		return
	}

	progress := domain.CalculateLoadingProgress(project)
	respondWithJSON(w, http.StatusOK, map[string]any{
		"project_id":       project.ID,
		"project_name":     project.Name,
		"loading_progress": progress,
	})
}

type patchItemFloorStatusRequest struct {
	Status string `json:"status"`
}

type patchItemFloorStatusResponse struct {
	ProjectID   string `json:"project_id"`
	ItemID      string `json:"item_id"`
	FloorStatus string `json:"floor_status"`
	NextStatus  string `json:"next_status"`
}

// HandleProjectItemFloorStatus handles PATCH /api/projects/{id}/items/{itemId}/floor-status
func (s *Server) HandleProjectItemFloorStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	projectID := r.PathValue("id")
	itemID := r.PathValue("itemId")
	if projectID == "" || itemID == "" {
		respondWithError(w, http.StatusBadRequest, "faltan parámetros de ruta")
		return
	}
	claims := claimsFromRequest(r)
	role := actorRole(claims)
	if !requirePermission(w,
		domain.RoleCanMarkProduced(role) || domain.RoleCanExportProduction(role),
		"no tenés permiso para modificar el piso de fábrica") {
		return
	}

	var body patchItemFloorStatusRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}

	targetStatus := strings.TrimSpace(body.Status)
	if targetStatus == "" {
		// If empty, look up current item and advance to next
		project, err := s.Store.GetProjectByID(r.Context(), projectID)
		if err != nil || project == nil {
			respondWithError(w, http.StatusNotFound, "obra no encontrada")
			return
		}
		var currentItem *domain.ProjectItem
		for i := range project.Items {
			if project.Items[i].ID == itemID {
				currentItem = &project.Items[i]
				break
			}
		}
		if currentItem == nil {
			respondWithError(w, http.StatusNotFound, "item no encontrado en esta obra")
			return
		}
		currentStatus := domain.NormalizeItemFloorStatus(currentItem.FloorStatus)
		next := domain.NextItemFloorStatus(currentStatus)
		if next == "" {
			targetStatus = currentStatus
		} else {
			targetStatus = next
		}
	} else {
		targetStatus = domain.NormalizeItemFloorStatus(targetStatus)
	}

	if err := s.Store.SetProjectItemFloorStatus(r.Context(), projectID, itemID, targetStatus); err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudo actualizar el estado de fábrica")
		return
	}

	respondWithJSON(w, http.StatusOK, patchItemFloorStatusResponse{
		ProjectID:   projectID,
		ItemID:      itemID,
		FloorStatus: targetStatus,
		NextStatus:  domain.NextItemFloorStatus(targetStatus),
	})
}
