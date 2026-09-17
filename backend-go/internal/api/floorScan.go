package api

/**
 * Floor scan endpoint (PROD-3.1 / F089-RN / F092): the mobile or web companion
 * scans a piece or module label QR, the server resolves the project line item
 * and atomically updates its shop-floor status — one row, no project rewrite,
 * returning the updated loading checklist progress.
 */

import (
	"crypto/rand"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

type floorScanRequest struct {
	Module       string `json:"module"`
	FactoryCode  string `json:"factory_code"`
	ItemID       string `json:"item_id"`
	TargetStatus string `json:"target_status"`
	Advance      bool   `json:"advance"`
}

type floorScanResponse struct {
	ProjectID       string                   `json:"project_id"`
	ProjectName     string                   `json:"project_name"`
	ItemID          string                   `json:"item_id"`
	FactoryCode     string                   `json:"factory_code"`
	ModuleCode      string                   `json:"module_code"`
	ModuleName      string                   `json:"module_name"`
	StatusBefore    string                   `json:"status_before"`
	StatusAfter     string                   `json:"status_after"`
	NextStatus      string                   `json:"next_status"`
	LoadingProgress domain.LoadingProgress   `json:"loading_progress"`
	Event           *domain.FloorStatusEvent `json:"event,omitempty"`
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
	roles := actorRoles(claims)
	// Station work gate (F094): supervisors (mark/export roles) plus the
	// scoped operators (claim roles) — the per-sector scope check below
	// constrains operators to their assigned stations.
	if !requirePermission(w,
		domain.AnyRole(roles, domain.RoleCanMarkProduced) || domain.AnyRole(roles, domain.RoleCanExportProduction) ||
			domain.AnyRole(roles, domain.RoleCanClaimProductionJob),
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

	// OC-033/034 split-brain guard: lines with physical module units advance
	// through the part/unit endpoints; the item status is derived from them.
	for _, u := range project.ModuleUnits {
		if u.ProjectItemID == match.item.ID {
			respondWithError(w, http.StatusConflict,
				"esta línea se controla por unidades físicas: escaneá el QR de la unidad o pieza")
			return
		}
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
	// #740 — the physical advance goes through the operational gate under the
	// project row lock: Engineering completed + materials authorized for the
	// exact release, atomically with the status write and its F092 event.
	var event *domain.FloorStatusEvent
	if after != before {
		if !s.actorCanAdvanceStation(w, r, roles, actorID(claims), after) {
			return
		}
		ev := s.buildFloorScanEvent(r, projectID, match.item.ID, before, after, domain.FloorEventSourceScan)
		if err := s.Store.SetProjectItemFloorStatusGated(r.Context(), storage.ItemFloorAdvance{
			ProjectID: projectID,
			ItemID:    match.item.ID,
			Status:    after,
			Event:     &ev,
		}); err != nil {
			if respondWithFloorGateError(w, err) {
				return
			}
			respondWithError(w, http.StatusInternalServerError, "no se pudo actualizar el estado")
			return
		}
		event = &ev
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
// sector-list read failures deny the scoped operation.
func (s *Server) actorCanAdvanceStation(w http.ResponseWriter, r *http.Request, roles []domain.UserRole, userID, targetStatus string) bool {
	// Multi-role union (ADR-0005): the actor may advance when any of their
	// roles allows it — unscoped roles directly, sector-scoped roles through
	// their assigned sectors.
	if len(roles) == 0 {
		respondWithError(w, http.StatusForbidden, "no tenés permiso para avanzar estaciones")
		return false
	}
	anyUnscoped := false
	for _, role := range roles {
		if !domain.RoleIsScopedBySector(role) {
			anyUnscoped = true
			break
		}
	}
	if anyUnscoped {
		return true
	}
	sectors, err := s.Store.ListUserSectors(r.Context(), userID)
	if err != nil {
		log.Printf("[floor-scan] cannot read sectors for user %s: %v", userID, err)
		respondWithError(w, http.StatusForbidden, "no se pudieron verificar tus sectores")
		return false
	}
	names := make([]string, 0, len(sectors))
	for _, us := range sectors {
		names = append(names, us.Sector)
	}
	for _, role := range roles {
		if domain.RoleCanAdvanceStation(role, targetStatus, names) {
			return true
		}
	}
	sector := domain.SectorForFloorStatus(targetStatus)
	respondWithError(w, http.StatusForbidden,
		"ese avance es de "+domain.SectorLabelES(sector)+" y no lo tenés asignado")
	return false
}

// buildFloorEvent builds the F092 transition record with the authenticated
// actor WITHOUT inserting it — the gated floor writers persist it atomically
// with the status change (#740), so a blocked gate leaves no orphan audit row.
func (s *Server) buildFloorScanEvent(r *http.Request, projectID, itemID, from, to string, source domain.FloorEventSource) domain.FloorStatusEvent {
	claims := claimsFromRequest(r)
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
	return ev
}

// recordFloorEvent appends the transition to the audit log with the
// authenticated actor. Failures are logged but never block the scan —
// the status write already succeeded.
func (s *Server) recordFloorEvent(r *http.Request, projectID, itemID, from, to string, source domain.FloorEventSource) *domain.FloorStatusEvent {
	ev := s.buildFloorScanEvent(r, projectID, itemID, from, to, source)
	if err := s.Store.InsertFloorEvent(r.Context(), ev); err != nil {
		log.Printf("[floor-events] insert failed for project %s item %s: %v", projectID, itemID, err)
	}
	return &ev
}

// respondWithFloorGateError surfaces the #740 operational gate blockers with
// their actionable copy; returns false when the error is not a gate blocker.
func respondWithFloorGateError(w http.ResponseWriter, err error) bool {
	if errors.Is(err, domain.ErrPhysicalWorkEngineeringPending) ||
		errors.Is(err, domain.ErrPhysicalWorkMaterialsPending) ||
		errors.Is(err, domain.ErrPhysicalWorkReleaseMismatch) ||
		errors.Is(err, domain.ErrPhysicalWorkMaterialsCommitted) {
		respondWithError(w, http.StatusConflict, err.Error())
		return true
	}
	return false
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
	roles := actorRoles(claims)
	// Station work gate (F094) — same as floor-scan; scope enforced below.
	if !requirePermission(w,
		domain.AnyRole(roles, domain.RoleCanMarkProduced) || domain.AnyRole(roles, domain.RoleCanExportProduction) ||
			domain.AnyRole(roles, domain.RoleCanClaimProductionJob),
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
	// OC-033/034 split-brain guard: once a line has physical module units,
	// the item-level status is DERIVED from the units/pieces truth. Direct
	// legacy writes would let the item contradict the physical state — the
	// unit endpoints own the transitions from that point on.
	for _, u := range project.ModuleUnits {
		if u.ProjectItemID == itemID {
			respondWithError(w, http.StatusConflict,
				"esta línea se controla por unidades físicas: avanzala por /units/"+u.ID+"/advance")
			return
		}
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
	// #740 — the manual write passes the SAME operational gate as the scan
	// route: under lock, atomically with its F092 event, fail-closed on
	// missing Engineering completion or material authorization for the exact
	// release (this was a confirmed bypass of the item-level floor status).
	var event *domain.FloorStatusEvent
	if targetStatus != before {
		if !s.actorCanAdvanceStation(w, r, roles, actorID(claims), targetStatus) {
			return
		}
		ev := s.buildFloorScanEvent(r, projectID, itemID, before, targetStatus, domain.FloorEventSourceManual)
		if err := s.Store.SetProjectItemFloorStatusGated(r.Context(), storage.ItemFloorAdvance{
			ProjectID: projectID,
			ItemID:    itemID,
			Status:    targetStatus,
			Event:     &ev,
		}); err != nil {
			if respondWithFloorGateError(w, err) {
				return
			}
			respondWithError(w, http.StatusInternalServerError, "no se pudo actualizar el estado de fábrica")
			return
		}
		event = &ev
	}

	respondWithJSON(w, http.StatusOK, patchItemFloorStatusResponse{
		ProjectID:   projectID,
		ItemID:      itemID,
		FloorStatus: targetStatus,
		NextStatus:  domain.NextItemFloorStatus(targetStatus),
		Event:       event,
	})
}
