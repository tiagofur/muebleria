package api

/**
 * Floor scan endpoint (PROD-3.1 / F089-RN / F092): the mobile or web companion
 * scans a piece or module label QR, the server resolves the project line item
 * and atomically updates its shop-floor status — one row, no project rewrite,
 * returning the updated loading checklist progress.
 */

import (
	"crypto/rand"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

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
	ProjectID       string                     `json:"project_id"`
	ProjectName     string                     `json:"project_name"`
	ItemID          string                     `json:"item_id"`
	FactoryCode     string                     `json:"factory_code"`
	ModuleCode      string                     `json:"module_code"`
	ModuleName      string                     `json:"module_name"`
	StatusBefore    string                     `json:"status_before"`
	StatusAfter     string                     `json:"status_after"`
	NextStatus      string                     `json:"next_status"`
	LoadingProgress domain.LoadingProgress      `json:"loading_progress"`
	Event           *domain.FloorStatusEvent   `json:"event,omitempty"`
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
	// Station work gate (F094): supervisors (mark/export roles) plus the
	// scoped operators (claim roles) — the per-sector scope check below
	// constrains operators to their assigned stations.
	if !requirePermission(w,
		domain.RoleCanMarkProduced(role) || domain.RoleCanExportProduction(role) ||
			domain.RoleCanClaimProductionJob(role),
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
		after = domain.NormalizeItemFloorStatus(strings.TrimSpace(body.TargetStatus))
	} else if body.Advance {
		if next := domain.NextItemFloorStatus(before); next != "" {
			after = next
		}
	}

	// F094 — station separation: scoped operators only advance their sectors.
	if after != before {
		if !s.actorCanAdvanceStation(w, r, role, actorID(claims), after) {
			return
		}
		if err := s.Store.SetProjectItemFloorStatus(r.Context(), projectID, match.item.ID, after); err != nil {
			respondWithError(w, http.StatusInternalServerError, "no se pudo actualizar el estado")
			return
		}
	}

	// F092 — audit every real transition (who/when/how from the JWT actor).
	var event *domain.FloorStatusEvent
	if after != before {
		event = s.recordFloorEvent(r, projectID, match.item.ID, before, after, domain.FloorEventSourceScan)
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
		Event:           event,
	})
}

// actorCanAdvanceStation enforces the F094 station separation: sector-scoped
// operators (produccion/almacen) may only move items into statuses produced
// by THEIR assigned sectors. Responds 403 and returns false when denied;
// sector-list read failures fall open to the role-only check (logged).
func (s *Server) actorCanAdvanceStation(w http.ResponseWriter, r *http.Request, role domain.UserRole, userID, targetStatus string) bool {
	if !domain.RoleIsScopedBySector(role) {
		return true
	}
	sectors, err := s.Store.ListUserSectors(r.Context(), userID)
	if err != nil {
		log.Printf("[floor-scan] cannot read sectors for user %s: %v (falling open)", userID, err)
		return true
	}
	names := make([]string, 0, len(sectors))
	for _, us := range sectors {
		names = append(names, us.Sector)
	}
	if domain.RoleCanAdvanceStation(role, targetStatus, names) {
		return true
	}
	sector := domain.SectorForFloorStatus(targetStatus)
	respondWithError(w, http.StatusForbidden,
		"ese avance es de "+domain.SectorLabelES(sector)+" y no lo tenés asignado")
	return false
}

// recordFloorEvent appends the transition to the audit log with the
// authenticated actor. Failures are logged but never block the scan —
// the status write already succeeded.
func (s *Server) recordFloorEvent(r *http.Request, projectID, itemID, from, to string, source domain.FloorEventSource) *domain.FloorStatusEvent {	claims := claimsFromRequest(r)
	ev := domain.FloorStatusEvent{
		ID:        newFloorEventID(),
		ProjectID: projectID,
		ItemID:    itemID,
		From:      from,
		To:        to,
		At:        time.Now().UTC(),
		ByUserID:  actorID(claims),
		ByName:    claims.Email,
		Source:    source,
	}
	// Prefer the display name; email is the honest fallback.
	if ev.ByUserID != "" {
		if user, err := s.Store.GetUserByID(r.Context(), ev.ByUserID); err == nil && user != nil && user.Name != "" {
			ev.ByName = user.Name
		}
	}
	if domain.FloorStatusRank(to)-domain.FloorStatusRank(from) != 1 {
		ev.Note = domain.FloorEventJumpNote("", from, to)
	}
	if err := s.Store.InsertFloorEvent(r.Context(), ev); err != nil {
		log.Printf("[floor-events] insert failed for project %s item %s: %v", projectID, itemID, err)
	}
	return &ev
}

func newFloorEventID() string {
	// UUID v4 via crypto/rand — zero new dependencies.
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("fe-%d-%d", time.Now().UnixNano(), os.Getpid())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// HandleProjectFloorEvents handles GET /api/projects/{id}/floor-events —
// the shop-floor log, oldest first. Visible to any authenticated user with
// project access (visibility for the whole workshop, F092).
func (s *Server) HandleProjectFloorEvents(w http.ResponseWriter, r *http.Request) {
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

	events, err := s.Store.ListFloorEvents(r.Context(), projectID)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudo leer el historial de piso")
		return
	}
	if events == nil {
		events = []domain.FloorStatusEvent{}
	}
	respondWithJSON(w, http.StatusOK, events)
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
	ProjectID   string                   `json:"project_id"`
	ItemID      string                   `json:"item_id"`
	FloorStatus string                   `json:"floor_status"`
	NextStatus  string                   `json:"next_status"`
	Event       *domain.FloorStatusEvent `json:"event,omitempty"`
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
	// Station work gate (F094) — same as floor-scan; scope enforced below.
	if !requirePermission(w,
		domain.RoleCanMarkProduced(role) || domain.RoleCanExportProduction(role) ||
			domain.RoleCanClaimProductionJob(role),
		"no tenés permiso para modificar el piso de fábrica") {
		return
	}

	var body patchItemFloorStatusRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}

	// F092 — load current status first so the event records from → to.
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
	before := domain.NormalizeItemFloorStatus(currentItem.FloorStatus)

	targetStatus := strings.TrimSpace(body.Status)
	if targetStatus == "" {
		// If empty, advance to next
		if next := domain.NextItemFloorStatus(before); next != "" {
			targetStatus = next
		} else {
			targetStatus = before
		}
	} else {
		targetStatus = domain.NormalizeItemFloorStatus(targetStatus)
	}

	// F094 — station separation (same rule as floor-scan).
	if targetStatus != before {
		if !s.actorCanAdvanceStation(w, r, role, actorID(claims), targetStatus) {
			return
		}
	}

	if err := s.Store.SetProjectItemFloorStatus(r.Context(), projectID, itemID, targetStatus); err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudo actualizar el estado de fábrica")
		return
	}

	var event *domain.FloorStatusEvent
	if targetStatus != before {
		event = s.recordFloorEvent(r, projectID, itemID, before, targetStatus, domain.FloorEventSourceManual)
	}

	respondWithJSON(w, http.StatusOK, patchItemFloorStatusResponse{
		ProjectID:   projectID,
		ItemID:      itemID,
		FloorStatus: targetStatus,
		NextStatus:  domain.NextItemFloorStatus(targetStatus),
		Event:       event,
	})
}
