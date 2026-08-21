package api

/**
 * Production activity handlers — claim/finish/damage endpoints for the
 * Production Manager Dashboard (gerente_produccion).
 *
 * Endpoints:
 *   POST   /api/production/activity/claim      — Operator claims a job
 *   POST   /api/production/activity/finish     — Operator finishes a job
 *   POST   /api/production/activity/damage     — Report damaged piece
 *   GET    /api/production/dashboard           — Full dashboard metrics
 *   GET    /api/production/sector/{sector}     — Sector-specific metrics
 *   GET    /api/production/operator/{id}       — Operator metrics
 *   GET    /api/production/active              — All active jobs right now
 *   PATCH  /api/production/damage/{id}/resolve — Mark damage resolved
 */

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ─── Request/Response Types ──────────────────────────────────────────────────

type claimRequest struct {
	ProjectID   string `json:"project_id"`
	ItemID      string `json:"item_id,omitempty"`
	Sector      string `json:"sector"`
	MachineID   string `json:"machine_id,omitempty"`
	MachineName string `json:"machine_name,omitempty"`
}

type claimResponse struct {
	Activity domain.ProductionActivity `json:"activity"`
}

type finishRequest struct {
	PiecesCount int    `json:"pieces_count"`
	Notes       string `json:"notes,omitempty"`
}

type finishResponse struct {
	Activity domain.ProductionActivity `json:"activity"`
}

type damageRequest struct {
	ProjectID    string `json:"project_id"`
	ItemID       string `json:"item_id"`
	Sector       string `json:"sector"`
	DamageType   string `json:"damage_type"`
	Description  string `json:"description"`
	PhotoURL     string `json:"photo_url,omitempty"`
	NeedsReplace bool   `json:"needs_replace"`
}

type damageResponse struct {
	Report domain.DamageReport `json:"report"`
}

type dashboardResponse struct {
	Metrics domain.DashboardMetrics `json:"metrics"`
}

type activeJobsResponse struct {
	Jobs []domain.ActiveJob `json:"jobs"`
}

// ─── Handlers ────────────────────────────────────────────────────────────────

// HandleProductionClaim handles POST /api/production/activity/claim
// Operator claims a job — marks them as "working on this" and locks it.
func (s *Server) HandleProductionClaim(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}

	claims := claimsFromRequest(r)
	role := actorRole(claims)
	if !requirePermission(w,
		domain.RoleCanClaimProductionJob(role),
		"no tenés permiso para reclamar trabajos") {
		return
	}

	var body claimRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}

	if body.ProjectID == "" || body.Sector == "" {
		respondWithError(w, http.StatusBadRequest, "faltan project_id o sector")
		return
	}

	sector := domain.ProductionSector(body.Sector)
	if !isValidSector(sector) {
		respondWithError(w, http.StatusBadRequest, "sector inválido: "+body.Sector)
		return
	}

	// For operadores, verify they have access to this sector
	if domain.RoleIsScopedBySector(role) {
		actorID := actorID(claims)
		if !s.userCanWorkSector(r.Context(), role, actorID, sector) {
			respondWithError(w, http.StatusForbidden, "no tenés acceso a este sector")
			return
		}
	}

	actorID := actorID(claims)
	// Claims are deliberately NOT exclusive across operators: one station can
	// need several people on the same obra. We only prevent the same operator
	// from opening the same project × station claim twice.
	existing, err := s.Store.GetActiveActivitiesBySector(r.Context(), sector)
	if err == nil {
		for _, act := range existing {
			if act.ProjectID == body.ProjectID && act.ItemID == body.ItemID && act.OperatorID == actorID {
				respondWithError(w, http.StatusConflict, "ya tenés una actividad activa en esta obra y estación")
				return
			}
		}
	}

	// Get project and optional item info. Empty item_id is a project × station claim.
	project, err := s.Store.GetProjectByID(r.Context(), body.ProjectID)
	if err != nil || project == nil {
		respondWithError(w, http.StatusNotFound, "obra no encontrada")
		return
	}

	var item *domain.ProjectItem
	var moduleCode, moduleName, statusBefore string
	if body.ItemID != "" {
		for i := range project.Items {
			if project.Items[i].ID == body.ItemID {
				item = &project.Items[i]
				break
			}
		}
		if item == nil {
			respondWithError(w, http.StatusNotFound, "item no encontrado")
			return
		}
		statusBefore = string(domain.NormalizeItemFloorStatus(item.FloorStatus))
		if mod, mErr := s.Store.GetModuleByID(r.Context(), item.ModuleID); mErr == nil && mod != nil {
			moduleCode = mod.Code
			moduleName = mod.Name
		}
	}

	now := time.Now().UTC()
	actorName := claims.Email
	if user, uErr := s.Store.GetUserByID(r.Context(), actorID); uErr == nil && user != nil && user.Name != "" {
		actorName = user.Name
	}

	activity := domain.ProductionActivity{
		ID:           newFloorEventID(), // Reuse UUID generator
		ProjectID:    body.ProjectID,
		ProjectName:  project.Name,
		ItemID:       body.ItemID,
		ModuleCode:   moduleCode,
		ModuleName:   moduleName,
		Sector:       sector,
		Type:         domain.ActivityClaim,
		OperatorID:   actorID,
		OperatorName: actorName,
		MachineID:    body.MachineID,
		MachineName:  body.MachineName,
		StartedAt:    &now,
		StatusBefore: statusBefore,
		CreatedAt:    now,
	}

	if err := s.Store.InsertProductionActivity(r.Context(), activity); err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudo registrar la actividad")
		return
	}

	respondWithJSON(w, http.StatusOK, claimResponse{Activity: activity})
}

// HandleProductionFinish handles POST /api/production/activity/finish/{activityId}
// Operator finishes a job — records duration and pieces count.
func (s *Server) HandleProductionFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}

	activityID := r.PathValue("activityId")
	if activityID == "" {
		respondWithError(w, http.StatusBadRequest, "missing activity id")
		return
	}

	claims := claimsFromRequest(r)
	role := actorRole(claims)
	if !requirePermission(w,
		domain.RoleCanClaimProductionJob(role),
		"no tenés permiso para finalizar trabajos") {
		return
	}

	activity, err := s.Store.GetActiveActivityByID(r.Context(), activityID)
	if err != nil || activity == nil {
		respondWithError(w, http.StatusNotFound, "actividad no encontrada")
		return
	}

	// Verify the caller is the operator who claimed it (or admin)
	actorID := actorID(claims)
	if activity.OperatorID != actorID && role != "admin" {
		respondWithError(w, http.StatusForbidden, "solo el operador que reclamó puede finalizar")
		return
	}

	// For operadores, verify they have access to this sector
	if domain.RoleIsScopedBySector(role) {
		if !s.userCanWorkSector(r.Context(), role, actorID, activity.Sector) {
			respondWithError(w, http.StatusForbidden, "no tenés acceso a este sector")
			return
		}
	}

	var body finishRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}

	if err := s.Store.FinishProductionActivity(r.Context(), activityID, body.PiecesCount, body.Notes); err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudo finalizar la actividad")
		return
	}

	// F094 — finishing a station job moves the floor pipeline (and leaves
	// the F092 audit trail). Claims are no longer floating telemetry: when
	// the sector produces a floor status and the item has not reached it,
	// the finish advances it exactly like the station queue would.
	s.advanceItemOnActivityFinish(r, *activity, actorID)

	// Update the activity with finish info
	now := time.Now().UTC()
	activity.FinishedAt = &now
	activity.PiecesCount = body.PiecesCount
	activity.Notes = body.Notes
	if activity.StartedAt != nil {
		activity.DurationMillis = now.Sub(*activity.StartedAt).Milliseconds()
	}

	respondWithJSON(w, http.StatusOK, finishResponse{Activity: *activity})
}

// advanceItemOnActivityFinish moves the item to its station's floor status
// when the finished activity's sector owns one. Idempotent (no-op when the
// item already reached it); failures are logged, never block the finish.
func (s *Server) advanceItemOnActivityFinish(r *http.Request, activity domain.ProductionActivity, actorID string) {
	if activity.ItemID == "" {
		// F095 project × station claims measure work but do not advance items.
		return
	}
	target := domain.TargetStatusForSector(string(activity.Sector))
	if target == "" {
		// warehouse / cnc produce no floor status yet (Fase 3).
		return
	}
	project, err := s.Store.GetProjectByID(r.Context(), activity.ProjectID)
	if err != nil || project == nil {
		return
	}
	for i := range project.Items {
		if project.Items[i].ID != activity.ItemID {
			continue
		}
		before := domain.NormalizeItemFloorStatus(project.Items[i].FloorStatus)
		if before == target || domain.FloorStatusRank(before) >= domain.FloorStatusRank(target) {
			return
		}
		if err := s.Store.SetProjectItemFloorStatus(r.Context(), activity.ProjectID, activity.ItemID, target); err != nil {
			log.Printf("[activity-finish] floor status update failed for item %s: %v", activity.ItemID, err)
			return
		}
		ev := domain.FloorStatusEvent{
			ID:        newFloorEventID(),
			ProjectID: activity.ProjectID,
			ItemID:    activity.ItemID,
			From:      before,
			To:        target,
			At:        time.Now().UTC(),
			ByUserID:  actorID,
			ByName:    activity.OperatorName,
			Source:    domain.FloorEventSourceActivity,
			Note:      "fin de actividad en " + string(activity.Sector),
		}
		if domain.FloorStatusRank(target)-domain.FloorStatusRank(before) != 1 {
			ev.Note = domain.FloorEventJumpNote(ev.Note, before, target)
		}
		if err := s.Store.InsertFloorEvent(r.Context(), ev); err != nil {
			log.Printf("[activity-finish] floor event insert failed for item %s: %v", activity.ItemID, err)
		}
		return
	}
}

// HandleProductionDamage handles POST /api/production/activity/damage
// Report a damaged piece.
func (s *Server) HandleProductionDamage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}

	claims := claimsFromRequest(r)
	role := actorRole(claims)
	if !requirePermission(w,
		domain.RoleCanClaimProductionJob(role),
		"no tenés permiso para reportar daños") {
		return
	}

	var body damageRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}

	if body.ProjectID == "" || body.ItemID == "" || body.DamageType == "" {
		respondWithError(w, http.StatusBadRequest, "faltan project_id, item_id o damage_type")
		return
	}

	// For operadores, verify they have access to this sector
	if domain.RoleIsScopedBySector(role) {
		actorID := actorID(claims)
		sector := domain.ProductionSector(body.Sector)
		if !s.userCanWorkSector(r.Context(), role, actorID, sector) {
			respondWithError(w, http.StatusForbidden, "no tenés acceso a este sector")
			return
		}
	}

	// Get project info
	project, err := s.Store.GetProjectByID(r.Context(), body.ProjectID)
	if err != nil || project == nil {
		respondWithError(w, http.StatusNotFound, "obra no encontrada")
		return
	}

	actorID := actorID(claims)
	actorName := claims.Email
	if user, uErr := s.Store.GetUserByID(r.Context(), actorID); uErr == nil && user != nil && user.Name != "" {
		actorName = user.Name
	}

	report := domain.DamageReport{
		ID:             newFloorEventID(),
		ProjectID:      body.ProjectID,
		ProjectName:    project.Name,
		ItemID:         body.ItemID,
		Sector:         domain.ProductionSector(body.Sector),
		DamageType:     domain.DamageType(body.DamageType),
		Description:    body.Description,
		PhotoURL:       body.PhotoURL,
		ReportedBy:     actorID,
		ReportedByName: actorName,
		ReportedAt:     time.Now().UTC(),
		NeedsReplace:   body.NeedsReplace,
	}

	if err := s.Store.InsertDamageReport(r.Context(), report); err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudo reportar el daño")
		return
	}

	respondWithJSON(w, http.StatusOK, damageResponse{Report: report})
}

// HandleProductionDashboard handles GET /api/production/dashboard
// Full dashboard metrics for the Production Manager.
func (s *Server) HandleProductionDashboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}

	claims := claimsFromRequest(r)
	role := actorRole(claims)
	if !requirePermission(w,
		domain.RoleCanAccessProductionDashboard(role),
		"no tenés permiso para ver el dashboard de producción") {
		return
	}

	metrics, err := s.Store.GetDashboardMetrics(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudieron obtener las métricas")
		return
	}

	respondWithJSON(w, http.StatusOK, dashboardResponse{Metrics: *metrics})
}

// HandleProductionActiveJobs handles GET /api/production/active
// All active jobs right now across all sectors (filtered by operator's sectors if operador).
func (s *Server) HandleProductionActiveJobs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}

	claims := claimsFromRequest(r)
	role := actorRole(claims)
	if !requirePermission(w,
		domain.RoleCanAccessProductionDashboard(role) || domain.RoleCanClaimProductionJob(role),
		"no tenés permiso para ver trabajos activos") {
		return
	}

	// Determine which sectors to query
	var sectors []domain.ProductionSector
	if domain.RoleIsScopedBySector(role) {
		// Operadores only see their assigned sectors
		actorID := actorID(claims)
		userSectors, err := s.Store.ListUserSectors(r.Context(), actorID)
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "no se pudieron obtener tus sectores")
			return
		}
		for _, us := range userSectors {
			sectors = append(sectors, domain.ProductionSector(us.Sector))
		}
		if len(sectors) == 0 {
			sectors = []domain.ProductionSector{}
		}
	} else {
		// Managers/admin see every sector (single vocabulary, F094).
		sectors = append(sectors, domain.ProductionSectorsOrdered...)
	}

	var allJobs []domain.ActiveJob
	for _, sector := range sectors {
		activities, err := s.Store.GetActiveActivitiesBySector(r.Context(), sector)
		if err != nil {
			continue
		}
		for _, act := range activities {
			if act.FinishedAt == nil {
				duration := time.Since(*act.StartedAt).Minutes()
				allJobs = append(allJobs, domain.ActiveJob{
					ActivityID:   act.ID,
					ProjectID:    act.ProjectID,
					ProjectName:  act.ProjectName,
					Sector:       act.Sector,
					ItemID:       act.ItemID,
					ModuleCode:   act.ModuleCode,
					OperatorID:   act.OperatorID,
					OperatorName: act.OperatorName,
					MachineID:    act.MachineID,
					MachineName:  act.MachineName,
					StartedAt:    *act.StartedAt,
					DurationMin:  duration,
				})
			}
		}
	}

	if allJobs == nil {
		allJobs = []domain.ActiveJob{}
	}

	respondWithJSON(w, http.StatusOK, activeJobsResponse{Jobs: allJobs})
}

// HandleProductionDamageResolve handles PATCH /api/production/damage/{id}/resolve
func (s *Server) HandleProductionDamageResolve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}

	damageID := r.PathValue("id")
	if damageID == "" {
		respondWithError(w, http.StatusBadRequest, "missing damage id")
		return
	}

	claims := claimsFromRequest(r)
	role := actorRole(claims)
	// F094 — resolving damage (refabrication decision) is a production
	// supervisor call, not an operator one.
	if !requirePermission(w,
		domain.RoleCanManageProductionStaff(role),
		"no tenés permiso para resolver daños") {
		return
	}

	if err := s.Store.ResolveDamageReport(r.Context(), damageID); err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudo resolver el reporte")
		return
	}

	respondWithJSON(w, http.StatusOK, map[string]string{"status": "resolved"})
}

// ─── User Sector Management (Admin assigns sectors to operators) ──────────────

type userSectorsRequest struct {
	Sectors []domain.UserSector `json:"sectors"`
}

// HandleUserSectors handles GET/PUT /api/admin/users/{id}/sectors
func (s *Server) HandleUserSectors(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("id")
	if userID == "" {
		respondWithError(w, http.StatusBadRequest, "user ID required")
		return
	}

	switch r.Method {
	case http.MethodGet:
		sectors, err := s.Store.ListUserSectors(r.Context(), userID)
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "failed to list sectors")
			return
		}
		respondWithJSON(w, http.StatusOK, sectors)

	case http.MethodPut:
		var req userSectorsRequest
		if !decodeJSONBody(w, r, &req) {
			return
		}

		// Validate sectors against user's role (F094 — role↔sector binding).
		user, err := s.Store.GetUserByID(r.Context(), userID)
		if err != nil || user == nil {
			respondWithError(w, http.StatusNotFound, "user not found")
			return
		}
		for _, sec := range req.Sectors {
			if !domain.IsValidSector(domain.ProductionSector(sec.Sector)) {
				respondWithError(w, http.StatusBadRequest, "invalid sector: "+sec.Sector)
				return
			}
			if !domain.SectorAllowedForRole(user.Role, domain.ProductionSector(sec.Sector)) {
				respondWithError(w, http.StatusBadRequest,
					"sector '"+sec.Sector+"' is not allowed for role '"+string(user.Role)+"'")
				return
			}
		}

		if err := s.Store.SetUserSectors(r.Context(), userID, req.Sectors); err != nil {
			respondWithError(w, http.StatusInternalServerError, "failed to set sectors")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"status": "updated"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// HandleOperatorsBySector handles GET /api/production/operators?sector=X
// Staff directory data (who works each station) — production staff
// management only (F094; was unauthenticated-by-role before).
func (s *Server) HandleOperatorsBySector(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	role := actorRole(claimsFromRequest(r))
	if !requirePermission(w,
		domain.RoleCanManageProductionStaff(role),
		"no tenés permiso para ver operadores por sector") {
		return
	}

	sector := r.URL.Query().Get("sector")
	if sector == "" {
		respondWithError(w, http.StatusBadRequest, "sector query parameter required")
		return
	}

	users, err := s.Store.GetUsersBySector(r.Context(), sector)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "failed to get operators")
		return
	}
	respondWithJSON(w, http.StatusOK, ToPublicUserDTOs(users))
}

// HandleMySectors handles GET /api/me/sectors — the caller's own station
// assignments. Any authenticated user: the web shell needs it to scope Mi
// Estación (F094); it leaks nothing (it is your own profile).
func (s *Server) HandleMySectors(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	claims := claimsFromRequest(r)
	userID := actorID(claims)
	if userID == "" {
		respondWithError(w, http.StatusUnauthorized, "sesión inválida")
		return
	}
	sectors, err := s.Store.ListUserSectors(r.Context(), userID)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudieron leer tus sectores")
		return
	}
	if sectors == nil {
		sectors = []domain.UserSector{}
	}
	respondWithJSON(w, http.StatusOK, sectors)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func isValidSector(s domain.ProductionSector) bool {
	switch s {
	case domain.SectorWarehouse, domain.SectorCutting, domain.SectorCNC,
		domain.SectorEdgeBanding, domain.SectorAssembly, domain.SectorPackaging,
		domain.SectorShipping, domain.SectorInstall:
		return true
	default:
		return false
	}
}

// userHasSectorAccess checks if a user has access to a specific sector.
// userCanWorkSector — F094 semantics, mirroring RoleCanAdvanceStation:
// produccion with NO assignments works every station (legacy operators);
// with assignments, only members; almacen always needs explicit membership.
func (s *Server) userCanWorkSector(ctx context.Context, role domain.UserRole, userID string, sector domain.ProductionSector) bool {
	sectors, err := s.Store.ListUserSectors(ctx, userID)
	if err != nil {
		return false
	}
	if role == domain.RoleProduccion && len(sectors) == 0 {
		return true
	}
	for _, us := range sectors {
		if domain.ProductionSector(us.Sector) == sector {
			return true
		}
	}
	return false
}

func (s *Server) userHasSectorAccess(ctx context.Context, userID string, sector domain.ProductionSector) bool {
	sectors, err := s.Store.ListUserSectors(ctx, userID)
	if err != nil {
		return false
	}
	for _, us := range sectors {
		if domain.ProductionSector(us.Sector) == sector {
			return true
		}
	}
	return false
}
