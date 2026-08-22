package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

/**
 * Quality & rework endpoints (OC-060..OC-062, issue #302).
 *
 * GET    /api/projects/{id}/quality — job + derived view (open issues, rework
 *        cost, per-unit QC gates).
 * POST   /api/projects/{id}/quality/issue — report a quality issue (OC-060).
 * POST   /api/projects/{id}/quality/issue/{issueId}/transition — resolve /
 *        verify / reopen.
 * POST   /api/projects/{id}/quality/rework — record the resolution
 *        (rework/refabricate/scrap/accept_as_is) with job costing; physical
 *        piece effects (reopen/scrap) run in the same transaction (OC-061).
 * POST   /api/projects/{id}/quality/qc/{unitId} — per-unit QC checklist
 *        (OC-062); packaging reads it through the QC gate.
 * POST   /api/projects/{id}/quality/qc/{unitId}/override — supervisor-only
 *        audited override (OC-062).
 */

func qualityPayload(v interface{}) json.RawMessage {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return raw
}

// roleCanManageQuality mirrors the event RBAC matrix (quality_issue_reported).
func roleCanManageQuality(role domain.UserRole) bool {
	return domain.RoleCanAppendProjectEvent(role, "quality_issue_reported")
}

type qualityUnitGateView struct {
	UnitID    string                 `json:"unit_id"`
	Status    domain.ModuleUnitStatus `json:"status"`
	Gate      domain.UnitQcGateResult `json:"gate"`
}

type qualityViewResponse struct {
	Quality        *domain.QualityJob `json:"quality"`
	OpenIssues     int                `json:"open_issues"`
	ReworkCost     map[string]float64 `json:"rework_cost"`
	UnitGates      []qualityUnitGateView `json:"unit_gates"`
	EventsAppended int                `json:"events_appended,omitempty"`
}

func buildQualityView(job *domain.QualityJob, units []domain.ModuleUnitExecution) qualityViewResponse {
	open := 0
	materialCost := 0.0
	laborMinutes := 0.0
	if job != nil {
		for _, i := range job.Issues {
			if i.Status == domain.QualityIssueOpen {
				open++
			}
		}
		for _, a := range job.ReworkActions {
			materialCost += a.MaterialCost
			laborMinutes += a.LaborMinutes
		}
	}
	gates := make([]qualityUnitGateView, 0, len(units))
	for _, u := range units {
		if u.Status == domain.ModuleUnitStatusModuleQC || u.Status == domain.ModuleUnitStatusPackaged {
			gates = append(gates, qualityUnitGateView{
				UnitID: u.ID,
				Status: u.Status,
				Gate:   domain.EvaluateUnitQcGate(job, u),
			})
		}
	}
	return qualityViewResponse{
		Quality:    job,
		OpenIssues: open,
		ReworkCost: map[string]float64{"material_cost": materialCost, "labor_minutes": laborMinutes},
		UnitGates:  gates,
	}
}

func ensureQualityJob(job *domain.QualityJob, projectID string, now time.Time) *domain.QualityJob {
	if job != nil {
		return job
	}
	return &domain.QualityJob{
		ID:        domain.NewQualityEntityID("qjob"),
		ProjectID: projectID,
		Issues:    []domain.QualityIssue{},
		ReworkActions: []domain.ReworkAction{},
		UnitQC:    []domain.UnitQcRecord{},
		CreatedAt: now,
	}
}

// HandleProjectQuality handles GET /api/projects/{id}/quality.
func (s *Server) HandleProjectQuality(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	projectID := r.PathValue("id")
	if !requirePermission(w, roleCanManageQuality(actorRole(claimsFromRequest(r))),
		"no tenés permiso para ver la calidad de la obra") {
		return
	}
	project, err := s.Store.GetProjectByID(r.Context(), projectID)
	if err != nil || project == nil {
		respondWithError(w, http.StatusNotFound, "obra no encontrada")
		return
	}
	respondWithJSON(w, http.StatusOK, buildQualityView(project.Quality, project.ModuleUnits))
}

type reportQualityIssueRequest struct {
	Description    string   `json:"description"`
	Category       string   `json:"category"`
	ProjectItemID  string   `json:"project_item_id,omitempty"`
	PartInstanceID string   `json:"part_instance_id,omitempty"`
	ModuleUnitID   string   `json:"module_unit_id,omitempty"`
	Station        string   `json:"station,omitempty"`
	Notes          string   `json:"notes,omitempty"`
	PhotoIDs       []string `json:"photo_ids,omitempty"`
}

// HandleQualityIssue handles POST /api/projects/{id}/quality/issue (OC-060).
func (s *Server) HandleQualityIssue(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	claims := claimsFromRequest(r)
	if !requirePermission(w, roleCanManageQuality(actorRole(claims)),
		"no tenés permiso para reportar problemas de calidad") {
		return
	}
	var body reportQualityIssueRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.Description) == "" {
		respondWithError(w, http.StatusBadRequest, "el problema de calidad requiere una descripción")
		return
	}
	if !domain.IsValidQualityIssueCategory(body.Category) {
		respondWithError(w, http.StatusBadRequest, "categoría de calidad inválida: "+body.Category)
		return
	}

	var view qualityViewResponse
	mutation, err := s.Store.MutateProjectQuality(r.Context(), projectID, func(snap *domain.QualitySnapshot) (*domain.QualityMutation, error) {
		now := time.Now().UTC()
		job := ensureQualityJob(snap.Quality, projectID, now)
		issue := domain.QualityIssue{
			ID:             domain.NewQualityEntityID("qiss"),
			Description:    strings.TrimSpace(body.Description),
			Category:       domain.QualityIssueCategory(body.Category),
			Status:         domain.QualityIssueOpen,
			ProjectItemID:  body.ProjectItemID,
			PartInstanceID: body.PartInstanceID,
			ModuleUnitID:   body.ModuleUnitID,
			Station:        body.Station,
			PhotoIDs:       body.PhotoIDs,
			Notes:          strings.TrimSpace(body.Notes),
			ReportedBy:     actorID(claims),
			ReportedAt:     now,
		}
		next := *job
		next.Issues = append(append([]domain.QualityIssue{}, job.Issues...), issue)
		if err := domain.ValidateQualityJobTransition(snap.Quality, &next); err != nil {
			return nil, fmt.Errorf("BAD_REQUEST:%s", err.Error())
		}
		event := domain.ProjectEvent{
			ID: newProjectEventID(), ProjectID: projectID,
			Type: "quality_issue_reported", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
			Note: fmt.Sprintf("Problema de calidad (%s): %s", body.Category, issue.Description),
			Payload: qualityPayload(map[string]interface{}{
				"issue_id": issue.ID, "category": issue.Category,
				"part_instance_id": issue.PartInstanceID, "project_item_id": issue.ProjectItemID,
				"module_unit_id": issue.ModuleUnitID, "station": issue.Station,
			}),
		}
		view = buildQualityView(&next, snap.Units)
		return &domain.QualityMutation{Quality: &next, Events: []domain.ProjectEvent{event}}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = len(mutation.Events)
	respondWithJSON(w, http.StatusOK, view)
}

type qualityTransitionRequest struct {
	ToStatus string `json:"to_status"`
	Notes    string `json:"notes,omitempty"`
}

// HandleQualityIssueTransition handles
// POST /api/projects/{id}/quality/issue/{issueId}/transition.
func (s *Server) HandleQualityIssueTransition(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	issueID := r.PathValue("issueId")
	claims := claimsFromRequest(r)
	if !requirePermission(w, roleCanManageQuality(actorRole(claims)),
		"no tenés permiso para gestionar problemas de calidad") {
		return
	}
	var body qualityTransitionRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if !domain.IsValidQualityIssueStatus(body.ToStatus) {
		respondWithError(w, http.StatusBadRequest, "estado de calidad inválido: "+body.ToStatus)
		return
	}

	var view qualityViewResponse
	_, err := s.Store.MutateProjectQuality(r.Context(), projectID, func(snap *domain.QualitySnapshot) (*domain.QualityMutation, error) {
		if snap.Quality == nil {
			return nil, fmt.Errorf("NOT_FOUND:el proyecto no tiene registro de calidad")
		}
		idx := -1
		for i, issue := range snap.Quality.Issues {
			if issue.ID == issueID {
				idx = i
				break
			}
		}
		if idx == -1 {
			return nil, fmt.Errorf("NOT_FOUND:problema de calidad no encontrado: %s", issueID)
		}
		issue := snap.Quality.Issues[idx]
		to := domain.QualityIssueStatus(body.ToStatus)
		if issue.Status == to {
			return &domain.QualityMutation{Quality: snap.Quality}, nil
		}
		if !domain.CanTransitionQualityIssueStatus(issue.Status, to) {
			return nil, fmt.Errorf("CONFLICT:transición inválida: %s → %s", issue.Status, to)
		}

		now := time.Now().UTC()
		updated := issue
		updated.Status = to
		updated.Notes = strings.TrimSpace(body.Notes)
		if to == domain.QualityIssueResolved {
			if updated.ResolvedAt == nil {
				updated.ResolvedAt = &now
			}
			updated.ResolvedBy = actorID(claims)
			updated.ResolutionNotes = strings.TrimSpace(body.Notes)
		} else if to == domain.QualityIssueOpen {
			updated.ResolvedAt = nil
			updated.ResolvedBy = ""
			updated.VerifiedAt = nil
			updated.VerifiedBy = ""
		} else if to == domain.QualityIssueVerified {
			if updated.VerifiedAt == nil {
				verifiedAt := now
				updated.VerifiedAt = &verifiedAt
			}
			updated.VerifiedBy = actorID(claims)
		}
		next := *snap.Quality
		next.Issues = append([]domain.QualityIssue{}, snap.Quality.Issues...)
		next.Issues[idx] = updated
		if err := domain.ValidateQualityJobTransition(snap.Quality, &next); err != nil {
			return nil, fmt.Errorf("BAD_REQUEST:%s", err.Error())
		}
		view = buildQualityView(&next, snap.Units)
		return &domain.QualityMutation{Quality: &next}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, view)
}

type reworkRequest struct {
	IssueID         string   `json:"issue_id"`
	Action          string   `json:"action"`
	Reason          string   `json:"reason,omitempty"`
	PartInstanceID  string   `json:"part_instance_id,omitempty"`
	TargetOperation string   `json:"target_operation,omitempty"`
	MaterialCost    *float64 `json:"material_cost,omitempty"`
	LaborMinutes    *float64 `json:"labor_minutes,omitempty"`
}

// HandleQualityRework handles POST /api/projects/{id}/quality/rework — the
// OC-061 resolution with job costing and the physical piece effect (reopen
// route or scrap) in the same transaction.
func (s *Server) HandleQualityRework(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	claims := claimsFromRequest(r)
	if !requirePermission(w, roleCanManageQuality(actorRole(claims)),
		"no tenés permiso para registrar retrabajos") {
		return
	}
	var body reworkRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if !domain.IsValidReworkActionType(body.Action) {
		respondWithError(w, http.StatusBadRequest, "action debe ser rework, refabricate, scrap o accept_as_is")
		return
	}
	if body.Action == "accept_as_is" && strings.TrimSpace(body.Reason) == "" {
		respondWithError(w, http.StatusBadRequest, "aceptar como está requiere un motivo de desviación")
		return
	}
	if body.TargetOperation != "" && !domain.IsValidPartOperationType(body.TargetOperation) {
		respondWithError(w, http.StatusBadRequest, "operación objetivo desconocida: "+body.TargetOperation)
		return
	}
	if body.MaterialCost != nil && *body.MaterialCost < 0 {
		respondWithError(w, http.StatusBadRequest, "material_cost no puede ser negativo")
		return
	}
	if body.LaborMinutes != nil && *body.LaborMinutes < 0 {
		respondWithError(w, http.StatusBadRequest, "labor_minutes no puede ser negativo")
		return
	}

	var view qualityViewResponse
	mutation, err := s.Store.MutateProjectQuality(r.Context(), projectID, func(snap *domain.QualitySnapshot) (*domain.QualityMutation, error) {
		if snap.Quality == nil {
			return nil, fmt.Errorf("NOT_FOUND:el proyecto no tiene registro de calidad")
		}
		idx := -1
		for i, issue := range snap.Quality.Issues {
			if issue.ID == body.IssueID {
				idx = i
				break
			}
		}
		if idx == -1 {
			return nil, fmt.Errorf("NOT_FOUND:problema de calidad no encontrado: %s", body.IssueID)
		}
		issue := snap.Quality.Issues[idx]

		now := time.Now().UTC()
		parts := append([]domain.PartInstance{}, snap.Parts...)
		itemStatuses := map[string]string{}
		for k, v := range snap.ItemStatuses {
			itemStatuses[k] = v
		}
		var floorEvents []domain.FloorStatusEvent

		if body.Action != "accept_as_is" {
			if body.PartInstanceID == "" {
				return nil, fmt.Errorf("BAD_REQUEST:%s requiere la pieza afectada", body.Action)
			}
			partIdx := -1
			for i, p := range parts {
				if p.ID == body.PartInstanceID {
					partIdx = i
					break
				}
			}
			if partIdx == -1 {
				return nil, fmt.Errorf("NOT_FOUND:pieza no encontrada: %s", body.PartInstanceID)
			}
			before := itemStatuses[parts[partIdx].ProjectItemID]
			if body.Action == "scrap" {
				parts[partIdx].Status = domain.PartInstanceStatusScrapped
			} else {
				reworked, changed := domain.TriggerPartRework(parts[partIdx], body.Action, body.Reason, domain.PartOperationType(body.TargetOperation))
				if !changed {
					return nil, fmt.Errorf("CONFLICT:no se pudo reabrir la pieza para retrabajo")
				}
				parts[partIdx] = reworked
			}
			after := domain.DeriveLegacyItemFloorStatus(unitsOfItem(snap.Units, parts[partIdx].ProjectItemID), partsOfItem(parts, parts[partIdx].ProjectItemID))
			itemStatuses[parts[partIdx].ProjectItemID] = after
			if before != after {
				floorEvents = append(floorEvents, s.buildFloorEvent(r, projectID, parts[partIdx].ProjectItemID, before, after,
					domain.FloorEventSourceManual,
					fmt.Sprintf("Retrabajo calidad (%s): %s", body.Action, body.Reason)))
			}
		}

		materialCost := 0.0
		if body.MaterialCost != nil {
			materialCost = *body.MaterialCost
		}
		laborMinutes := 0.0
		if body.LaborMinutes != nil {
			laborMinutes = *body.LaborMinutes
		}
		action := domain.ReworkAction{
			ID:             domain.NewQualityEntityID("rwrk"),
			IssueID:        issue.ID,
			Action:         domain.ReworkActionType(body.Action),
			Reason:         strings.TrimSpace(body.Reason),
			MaterialCost:   materialCost,
			LaborMinutes:   laborMinutes,
			PartInstanceID: body.PartInstanceID,
			ByUserID:       actorID(claims),
			At:             now,
		}

		resolutionNote := map[string]string{
			"rework": "Retrabajar", "refabricate": "Refabricar", "scrap": "Chatarrear", "accept_as_is": "Aceptar como está",
		}[body.Action]
		if action.Reason != "" {
			resolutionNote += ": " + action.Reason
		}
		updated := issue
		updated.Status = domain.QualityIssueResolved
		if updated.ResolvedAt == nil {
			updated.ResolvedAt = &now
		}
		updated.ResolvedBy = actorID(claims)
		updated.ResolutionNotes = resolutionNote

		next := *snap.Quality
		next.Issues = append([]domain.QualityIssue{}, snap.Quality.Issues...)
		next.Issues[idx] = updated
		next.ReworkActions = append(append([]domain.ReworkAction{}, snap.Quality.ReworkActions...), action)
		if err := domain.ValidateQualityJobTransition(snap.Quality, &next); err != nil {
			return nil, fmt.Errorf("BAD_REQUEST:%s", err.Error())
		}

		var events []domain.ProjectEvent
		if body.Action != "accept_as_is" {
			events = append(events, domain.ProjectEvent{
				ID: newProjectEventID(), ProjectID: projectID,
				Type: "rework_started", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
				Note: fmt.Sprintf("Retrabajo (%s): %s", resolutionNote, issue.Description),
				Payload: qualityPayload(map[string]interface{}{
					"issue_id": issue.ID, "action": body.Action,
					"part_instance_id": body.PartInstanceID,
					"material_cost": materialCost, "labor_minutes": laborMinutes,
				}),
			})
		}

		view = buildQualityView(&next, snap.Units)
		return &domain.QualityMutation{
			Quality:      &next,
			Parts:        parts,
			Units:        snap.Units,
			ItemStatuses: itemStatuses,
			FloorEvents:  floorEvents,
			Events:       events,
		}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = len(mutation.Events)
	respondWithJSON(w, http.StatusOK, view)
}

func unitsOfItem(units []domain.ModuleUnitExecution, itemID string) []domain.ModuleUnitExecution {
	var out []domain.ModuleUnitExecution
	for _, u := range units {
		if u.ProjectItemID == itemID {
			out = append(out, u)
		}
	}
	return out
}

func partsOfItem(parts []domain.PartInstance, itemID string) []domain.PartInstance {
	var out []domain.PartInstance
	for _, p := range parts {
		if p.ProjectItemID == itemID {
			out = append(out, p)
		}
	}
	return out
}

type unitQcRequest struct {
	Checklist []struct {
		Code   string `json:"code"`
		Passed bool   `json:"passed"`
	} `json:"checklist"`
	Notes    string   `json:"notes,omitempty"`
	PhotoIDs []string `json:"photo_ids,omitempty"`
}

// HandleQualityUnitQc handles POST /api/projects/{id}/quality/qc/{unitId} —
// the per-unit QC checklist (OC-062). Passes only when every item passed.
func (s *Server) HandleQualityUnitQc(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	unitID := r.PathValue("unitId")
	claims := claimsFromRequest(r)
	if !requirePermission(w, roleCanManageQuality(actorRole(claims)),
		"no tenés permiso para registrar QC de unidades") {
		return
	}
	var body unitQcRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if len(body.Checklist) == 0 {
		respondWithError(w, http.StatusBadRequest, "el checklist de QC requiere al menos un punto")
		return
	}
	checklist := make([]domain.UnitQcChecklistItem, 0, len(body.Checklist))
	for _, item := range body.Checklist {
		if !domain.IsValidQcCheckCode(item.Code) {
			respondWithError(w, http.StatusBadRequest, "punto de QC inválido: "+item.Code)
			return
		}
		checklist = append(checklist, domain.UnitQcChecklistItem{Code: domain.QcCheckCode(item.Code), Passed: item.Passed})
	}

	var view qualityViewResponse
	_, err := s.Store.MutateProjectQuality(r.Context(), projectID, func(snap *domain.QualitySnapshot) (*domain.QualityMutation, error) {
		var unit *domain.ModuleUnitExecution
		for i := range snap.Units {
			if snap.Units[i].ID == unitID {
				unit = &snap.Units[i]
				break
			}
		}
		if unit == nil {
			return nil, fmt.Errorf("NOT_FOUND:unidad no encontrada: %s", unitID)
		}

		now := time.Now().UTC()
		job := ensureQualityJob(snap.Quality, projectID, now)
		passed := true
		for _, item := range checklist {
			if !item.Passed {
				passed = false
				break
			}
		}

		var previous *domain.UnitQcRecord
		for i := range job.UnitQC {
			if job.UnitQC[i].UnitID == unitID {
				previous = &job.UnitQC[i]
				break
			}
		}
		newRecord := domain.UnitQcRecord{
			UnitID:    unitID,
			Checklist: checklist,
			Notes:     strings.TrimSpace(body.Notes),
			PhotoIDs:  body.PhotoIDs,
		}
		if previous != nil {
			newRecord.Override = previous.Override
		}
		if passed {
			if previous != nil && previous.PassedAt != nil {
				newRecord.PassedAt = previous.PassedAt
				newRecord.PassedBy = previous.PassedBy
			} else {
				newRecord.PassedAt = &now
				newRecord.PassedBy = actorID(claims)
			}
		}

		next := *job
		next.UnitQC = []domain.UnitQcRecord{}
		for _, rec := range job.UnitQC {
			if rec.UnitID != unitID {
				next.UnitQC = append(next.UnitQC, rec)
			}
		}
		next.UnitQC = append(next.UnitQC, newRecord)
		if err := domain.ValidateQualityJobTransition(snap.Quality, &next); err != nil {
			return nil, fmt.Errorf("BAD_REQUEST:%s", err.Error())
		}

		view = buildQualityView(&next, snap.Units)
		return &domain.QualityMutation{Quality: &next, Parts: snap.Parts, Units: snap.Units, ItemStatuses: snap.ItemStatuses}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, view)
}

type qcOverrideRequest struct {
	Reason string `json:"reason"`
}

// HandleQualityUnitQcOverride handles
// POST /api/projects/{id}/quality/qc/{unitId}/override — supervisor-only
// audited pass to package without approved QC (OC-062).
func (s *Server) HandleQualityUnitQcOverride(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	unitID := r.PathValue("unitId")
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.RoleCanSuperviseFloor(actorRole(claims)),
		"sólo supervisión puede habilitar packaging sin QC aprobado") {
		return
	}
	var body qcOverrideRequest
	if !decodeJSONBody(w, r, &body) || strings.TrimSpace(body.Reason) == "" {
		respondWithError(w, http.StatusBadRequest, "el motivo del override es obligatorio")
		return
	}

	var view qualityViewResponse
	_, err := s.Store.MutateProjectQuality(r.Context(), projectID, func(snap *domain.QualitySnapshot) (*domain.QualityMutation, error) {
		var unit *domain.ModuleUnitExecution
		for i := range snap.Units {
			if snap.Units[i].ID == unitID {
				unit = &snap.Units[i]
				break
			}
		}
		if unit == nil {
			return nil, fmt.Errorf("NOT_FOUND:unidad no encontrada: %s", unitID)
		}

		now := time.Now().UTC()
		job := ensureQualityJob(snap.Quality, projectID, now)
		var previous *domain.UnitQcRecord
		for i := range job.UnitQC {
			if job.UnitQC[i].UnitID == unitID {
				previous = &job.UnitQC[i]
				break
			}
		}
		record := domain.UnitQcRecord{UnitID: unitID, Override: &domain.QcOverride{
			Reason:   strings.TrimSpace(body.Reason),
			ByUserID: actorID(claims),
			At:       now,
		}}
		if previous != nil {
			record.Checklist = previous.Checklist
			record.PassedAt = previous.PassedAt
			record.PassedBy = previous.PassedBy
			record.Notes = previous.Notes
			record.PhotoIDs = previous.PhotoIDs
		}

		next := *job
		next.UnitQC = []domain.UnitQcRecord{}
		for _, rec := range job.UnitQC {
			if rec.UnitID != unitID {
				next.UnitQC = append(next.UnitQC, rec)
			}
		}
		next.UnitQC = append(next.UnitQC, record)
		if err := domain.ValidateQualityJobTransition(snap.Quality, &next); err != nil {
			return nil, fmt.Errorf("BAD_REQUEST:%s", err.Error())
		}

		view = buildQualityView(&next, snap.Units)
		return &domain.QualityMutation{Quality: &next, Parts: snap.Parts, Units: snap.Units, ItemStatuses: snap.ItemStatuses}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, view)
}
