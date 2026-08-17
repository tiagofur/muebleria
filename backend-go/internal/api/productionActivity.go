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
	"net/http"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ─── Request/Response Types ──────────────────────────────────────────────────

type claimRequest struct {
	ProjectID  string `json:"project_id"`
	ItemID     string `json:"item_id"`
	Sector     string `json:"sector"`
	MachineID  string `json:"machine_id,omitempty"`
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
	ProjectID  string `json:"project_id"`
	ItemID     string `json:"item_id"`
	Sector     string `json:"sector"`
	DamageType string `json:"damage_type"`
	Description string `json:"description"`
	PhotoURL   string `json:"photo_url,omitempty"`
	NeedsReplace bool `json:"needs_replace"`
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
		domain.RoleCanMarkProduced(role) || domain.RoleCanExportProduction(role),
		"no tenés permiso para reclamar trabajos") {
		return
	}

	var body claimRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}

	if body.ProjectID == "" || body.ItemID == "" || body.Sector == "" {
		respondWithError(w, http.StatusBadRequest, "faltan project_id, item_id o sector")
		return
	}

	sector := domain.ProductionSector(body.Sector)
	if !isValidSector(sector) {
		respondWithError(w, http.StatusBadRequest, "sector inválido: "+body.Sector)
		return
	}

	// Check if item is already claimed by someone else
	existing, err := s.Store.GetActiveActivitiesBySector(r.Context(), sector)
	if err == nil {
		for _, act := range existing {
			if act.ProjectID == body.ProjectID && act.ItemID == body.ItemID && act.Type == domain.ActivityClaim {
				respondWithError(w, http.StatusConflict, "esta pieza ya está siendo trabajada por otro operador")
				return
			}
		}
	}

	// Get project and item info
	project, err := s.Store.GetProjectByID(r.Context(), body.ProjectID)
	if err != nil || project == nil {
		respondWithError(w, http.StatusNotFound, "obra no encontrada")
		return
	}

	var item *domain.ProjectItem
	var moduleCode, moduleName string
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

	// Get module info
	if mod, mErr := s.Store.GetModuleByID(r.Context(), item.ModuleID); mErr == nil && mod != nil {
		moduleCode = mod.Code
		moduleName = mod.Name
	}

	now := time.Now().UTC()
	actorID := actorID(claims)
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
		StatusBefore: string(domain.NormalizeItemFloorStatus(item.FloorStatus)),
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
		domain.RoleCanMarkProduced(role) || domain.RoleCanExportProduction(role),
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

	var body finishRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}

	if err := s.Store.FinishProductionActivity(r.Context(), activityID, body.PiecesCount, body.Notes); err != nil {
		respondWithError(w, http.StatusInternalServerError, "no se pudo finalizar la actividad")
		return
	}

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
		domain.RoleCanMarkProduced(role) || domain.RoleCanExportProduction(role),
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
// All active jobs right now across all sectors.
func (s *Server) HandleProductionActiveJobs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}

	claims := claimsFromRequest(r)
	role := actorRole(claims)
	if !requirePermission(w,
		domain.RoleCanAccessProductionDashboard(role),
		"no tenés permiso para ver trabajos activos") {
		return
	}

	sectors := []domain.ProductionSector{
		domain.SectorCutting,
		domain.SectorEdgeBanding,
		domain.SectorCNC,
		domain.SectorAssembly,
		domain.SectorPackaging,
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
	if !requirePermission(w,
		domain.RoleCanMarkProduced(role) || domain.RoleCanExportProduction(role),
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
func (s *Server) HandleOperatorsBySector(w http.ResponseWriter, r *http.Request) {
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
	respondWithJSON(w, http.StatusOK, users)
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
