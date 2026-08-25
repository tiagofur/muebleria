package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

/**
 * Installation job endpoints (OC-070..OC-074, #303).
 *
 * GET/PUT /api/projects/{id}/installation — read the job and its derived
 * closeout view / replace the job state with server-side transition
 * validation and audit events derived from the diff. Closeout facts are NOT
 * settable here: sign-off and close run through POST .../installation/closeout
 * where the OC-074 gates are evaluated against the locked state.
 */

func newInstallationEntityID(prefix string) string {
	return prefix + "_" + newProjectEventID()[4:]
}

func installationPayload(v interface{}) json.RawMessage {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return raw
}

func installationByUserID(claims *auth.Claims) *string {
	if claims == nil || claims.UserID == "" {
		return nil
	}
	return &claims.UserID
}

type installationViewResponse struct {
	Installation   *domain.InstallationJob      `json:"installation"`
	JobStatus      domain.InstallationJobStatus `json:"job_status"`
	Units          map[string]interface{}       `json:"units"`
	CloseoutChecks []domain.CloseoutCheck       `json:"closeout_checks"`
	CloseoutReady  bool                         `json:"closeout_ready"`
	EventsAppended int                          `json:"events_appended,omitempty"`
}

func projectHasInstallationCompleted(project *domain.Project) bool {
	for _, ev := range project.Events {
		if ev.Type == "installation_completed" {
			return true
		}
	}
	return false
}

func buildInstallationView(project *domain.Project, job *domain.InstallationJob) installationViewResponse {
	mode, installed, total := domain.InstallationUnitsSummary(project.ModuleUnits, project.Items)
	checks, ready := domain.EvaluateCloseoutReadiness(project.ModuleUnits, project.Items, job, false)
	if checks == nil {
		checks = []domain.CloseoutCheck{}
	}
	return installationViewResponse{
		Installation:   job,
		JobStatus:      domain.DeriveInstallationJobStatus(job, projectHasInstallationCompleted(project)),
		Units:          map[string]interface{}{"mode": mode, "installed": installed, "total": total},
		CloseoutChecks: checks,
		CloseoutReady:  ready,
	}
}

// roleCanManageInstallation mirrors the event RBAC matrix: the roles allowed
// to append installation_* lifecycle events are the roles that may work the
// installation job. Punch events are stricter (no produccion).
func roleCanManageInstallation(role domain.UserRole) bool {
	return domain.RoleCanAppendProjectEvent(role, "installation_started")
}

// closeoutFactsEqual compares the recorded closeout facts (sign-off + close).
func closeoutFactsEqual(a, b *domain.ClientCloseout) bool {
	if a == nil || b == nil {
		return a == b
	}
	closedEqual := (a.ClosedAt == nil) == (b.ClosedAt == nil) &&
		(a.ClosedAt == nil || a.ClosedAt.Equal(*b.ClosedAt))
	return a.SignedOffBy == b.SignedOffBy && a.SignedOffAt.Equal(b.SignedOffAt) && closedEqual
}

// installationDiffEvents derives the audit lifecycle events from the diff
// between the stored job and the candidate one: installation_started on first
// real visit work, punch_opened/punch_closed per punch item change.
func installationDiffEvents(role domain.UserRole, claims *auth.Claims, snap *domain.InstallationSnapshot, next *domain.InstallationJob) ([]domain.ProjectEvent, error) {
	byUserID := installationByUserID(claims)
	events := []domain.ProjectEvent{}

	if !snap.HasInstallationStartedEvent && next != nil {
		for _, v := range next.Visits {
			if v.Status == domain.InstallationVisitInProgress || v.Status == domain.InstallationVisitCompleted {
				events = append(events, domain.ProjectEvent{
					ID: newProjectEventID(), ProjectID: next.ProjectID,
					Type: "installation_started", At: time.Now().UTC(), ByUserID: byUserID, Source: "web",
					Note:    "Primera visita de instalación iniciada (" + v.Date + ")",
					Payload: installationPayload(map[string]interface{}{"visit_id": v.ID, "visit_date": v.Date}),
				})
				break
			}
		}
	}

	var prevPunch map[string]domain.PunchItem
	if snap.Job != nil {
		prevPunch = map[string]domain.PunchItem{}
		for _, p := range snap.Job.PunchItems {
			prevPunch[p.ID] = p
		}
	}
	if next == nil {
		return events, nil
	}

	for _, p := range next.PunchItems {
		before, existed := prevPunch[p.ID]
		opened := !existed || (before.Status == domain.PunchItemClosed && p.Status == domain.PunchItemOpen)
		closed := existed && before.Status == domain.PunchItemOpen && p.Status == domain.PunchItemClosed
		if !opened && !closed {
			continue
		}
		eventType := "punch_closed"
		note := "Punch cerrado: " + p.Description
		payload := map[string]interface{}{"punch_item_id": p.ID, "was_blocker": p.IsBlocker}
		if opened {
			eventType = "punch_opened"
			note = "Punch abierto: " + p.Description
			payload = map[string]interface{}{
				"punch_item_id": p.ID, "severity": p.Severity, "is_blocker": p.IsBlocker, "owner": p.Owner,
			}
		}
		if !domain.RoleCanAppendProjectEvent(role, eventType) {
			return nil, fmt.Errorf("FORBIDDEN_EVENTS:%s", eventType)
		}
		events = append(events, domain.ProjectEvent{
			ID: newProjectEventID(), ProjectID: next.ProjectID,
			Type: eventType, At: time.Now().UTC(), ByUserID: byUserID, Source: "web",
			Note: note, Payload: installationPayload(payload),
		})
	}
	return events, nil
}

// HandleProjectInstallation handles:
// - GET /api/projects/{id}/installation (job + derived closeout view)
// - PUT /api/projects/{id}/installation (validated job replace + audit events)
func (s *Server) HandleProjectInstallation(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	if projectID == "" {
		respondWithError(w, http.StatusBadRequest, "missing project id")
		return
	}
	claims := claimsFromRequest(r)
	role := actorRole(claims)

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, roleCanManageInstallation(role), "no tenés permiso para ver la instalación") {
			return
		}
		project, err := s.Store.GetProjectByID(r.Context(), projectID)
		if err != nil || project == nil {
			respondWithError(w, http.StatusNotFound, "obra no encontrada")
			return
		}
		respondWithJSON(w, http.StatusOK, buildInstallationView(project, project.Installation))

	case http.MethodPut:
		if !requirePermission(w, roleCanManageInstallation(role), "no tenés permiso para gestionar la instalación") {
			return
		}
		var next domain.InstallationJob
		if !decodeJSONBody(w, r, &next) {
			return
		}
		next.ProjectID = projectID

		mutation, err := s.Store.MutateProjectInstallation(r.Context(), projectID, func(snap *domain.InstallationSnapshot) (*domain.InstallationMutation, error) {
			if err := domain.ValidateInstallationJobTransition(snap.Job, &next); err != nil {
				return nil, fmt.Errorf("BAD_REQUEST:%s", err.Error())
			}
			// Closeout facts are only produced by the closeout endpoint.
			var prevCloseout *domain.ClientCloseout
			if snap.Job != nil {
				prevCloseout = snap.Job.Closeout
			}
			if !closeoutFactsEqual(prevCloseout, next.Closeout) {
				return nil, fmt.Errorf("CONFLICT:conformidad/cierre sólo vía POST /installation/closeout")
			}
			events, err := installationDiffEvents(role, claims, snap, &next)
			if err != nil {
				return nil, err
			}
			return &domain.InstallationMutation{Job: &next, Events: events}, nil
		})
		if err != nil {
			if strings.HasPrefix(err.Error(), "FORBIDDEN_EVENTS:") {
				eventType := strings.TrimPrefix(err.Error(), "FORBIDDEN_EVENTS:")
				respondWithError(w, http.StatusForbidden, "no tenés permiso para registrar eventos de punch ("+eventType+")")
				return
			}
			respondWithMutationError(w, err)
			return
		}

		project, err := s.Store.GetProjectByID(r.Context(), projectID)
		if err != nil || project == nil {
			respondWithError(w, http.StatusNotFound, "obra no encontrada")
			return
		}
		view := buildInstallationView(project, mutation.Job)
		view.EventsAppended = len(mutation.Events)
		respondWithJSON(w, http.StatusOK, view)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
	}
}

type installationCloseoutRequest struct {
	Action      string   `json:"action"`
	SignedOffBy string   `json:"signed_off_by,omitempty"`
	Notes       string   `json:"notes,omitempty"`
	PhotoIDs    []string `json:"photo_ids,omitempty"`
}

// HandleProjectInstallationCloseout handles
// POST /api/projects/{id}/installation/closeout — server-authoritative
// client sign-off and project close behind the OC-074 gates.
func (s *Server) HandleProjectInstallationCloseout(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	if projectID == "" {
		respondWithError(w, http.StatusBadRequest, "missing project id")
		return
	}
	claims := claimsFromRequest(r)
	role := actorRole(claims)

	var body installationCloseoutRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	// Each action carries its own RBAC: completing the installation is a
	// plant milestone (produccion may do it); sign-off/close are gerente calls.
	actionEvent := map[string]string{
		"complete_installation": "installation_completed",
		"sign_off":              "client_signed_off",
		"close":                 "project_closed",
	}[body.Action]
	if actionEvent == "" {
		respondWithError(w, http.StatusBadRequest, "action debe ser complete_installation, sign_off o close")
		return
	}
	if !requirePermission(w,
		domain.RoleCanAppendProjectEvent(role, actionEvent),
		"no tenés permiso para esta acción de instalación ("+body.Action+")") {
		return
	}

	var gateChecks []domain.CloseoutCheck
	gateBlocked := false
	mutation, err := s.Store.MutateProjectInstallation(r.Context(), projectID, func(snap *domain.InstallationSnapshot) (*domain.InstallationMutation, error) {
		job := snap.Job
		if job == nil {
			job = &domain.InstallationJob{
				ID:          newInstallationEntityID("ijob"),
				ProjectID:   projectID,
				Visits:      []domain.InstallationVisit{},
				FieldIssues: []domain.FieldIssue{},
				PunchItems:  []domain.PunchItem{},
				CreatedAt:   time.Now().UTC(),
			}
		}

		if body.Action != "complete_installation" {
			checks, ready := domain.EvaluateCloseoutReadiness(snap.Units, snap.Items, job, body.Action == "close")
			gateChecks = checks
			if !ready {
				gateBlocked = true
				return nil, fmt.Errorf("CLOSEOUT_GATE")
			}
		}

		now := time.Now().UTC()
		byUserID := installationByUserID(claims)
		next := *job

		if body.Action == "complete_installation" {
			// Mirror of TS completeInstallation: every unit installed and no
			// open visits — completion is an audited milestone, not a close.
			if snap.HasInstallationCompletedEvent {
				return nil, fmt.Errorf("CONFLICT:la instalación ya fue marcada como completada")
			}
			mode, installed, total := domain.InstallationUnitsSummary(snap.Units, snap.Items)
			if total == 0 || installed != total {
				return nil, fmt.Errorf("CONFLICT:no se puede completar la instalación: %d de %d unidades instaladas", installed, total)
			}
			if open := domain.OpenInstallationVisits(job); len(open) > 0 {
				return nil, fmt.Errorf("CONFLICT:no se puede completar la instalación con %d visita(s) pendiente(s)", len(open))
			}
			return &domain.InstallationMutation{Job: &next, Events: []domain.ProjectEvent{{
				ID: newProjectEventID(), ProjectID: projectID,
				Type: "installation_completed", At: now, ByUserID: byUserID, Source: "web",
				Note:    "Instalación completada en obra",
				Payload: installationPayload(map[string]interface{}{"installed_units": installed, "total_units": total, "mode": mode}),
			}}}, nil
		}

		if body.Action == "sign_off" {
			if strings.TrimSpace(body.SignedOffBy) == "" {
				return nil, fmt.Errorf("BAD_REQUEST:la conformidad requiere el nombre de quien firma")
			}
			var closeout domain.ClientCloseout
			if job.Closeout != nil {
				closeout = *job.Closeout
			}
			closeout.SignedOffBy = strings.TrimSpace(body.SignedOffBy)
			closeout.SignedOffAt = now
			if byUserID != nil {
				closeout.SignedOffByUserID = *byUserID
			}
			closeout.SignedOffNotes = body.Notes
			closeout.SignedOffPhotoIDs = body.PhotoIDs
			next.Closeout = &closeout

			note := body.Notes
			if note == "" {
				note = "Conformidad firmada por " + closeout.SignedOffBy
			}
			return &domain.InstallationMutation{Job: &next, Events: []domain.ProjectEvent{{
				ID: newProjectEventID(), ProjectID: projectID,
				Type: "client_signed_off", At: now, ByUserID: byUserID, Source: "web",
				Note:    note,
				Payload: installationPayload(map[string]interface{}{"signed_off_by": closeout.SignedOffBy}),
			}}}, nil
		}

		// close
		if job.Closeout == nil {
			return nil, fmt.Errorf("CONFLICT:registrar primero la conformidad del cliente")
		}
		if job.Closeout.ClosedAt != nil {
			return nil, fmt.Errorf("CONFLICT:la obra ya está cerrada")
		}
		closeout := *job.Closeout
		closedAt := now
		closeout.ClosedAt = &closedAt
		if byUserID != nil {
			closeout.ClosedByUserID = *byUserID
		}
		next.Closeout = &closeout
		return &domain.InstallationMutation{Job: &next, Events: []domain.ProjectEvent{{
			ID: newProjectEventID(), ProjectID: projectID,
			Type: "project_closed", At: now, ByUserID: byUserID, Source: "web",
			Note:    "Proyecto cerrado tras conformidad",
			Payload: installationPayload(map[string]interface{}{"closed_at": now, "signed_off_by": job.Closeout.SignedOffBy}),
		}}}, nil
	})
	if err != nil {
		if gateBlocked {
			respondWithJSON(w, http.StatusConflict, map[string]interface{}{
				"error":           "gates de cierre pendientes",
				"closeout_checks": gateChecks,
			})
			return
		}
		respondWithMutationError(w, err)
		return
	}

	project, err := s.Store.GetProjectByID(r.Context(), projectID)
	if err != nil || project == nil {
		respondWithError(w, http.StatusNotFound, "obra no encontrada")
		return
	}
	checks, ready := domain.EvaluateCloseoutReadiness(project.ModuleUnits, project.Items, mutation.Job, true)
	if checks == nil {
		checks = []domain.CloseoutCheck{}
	}
	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"installation":    mutation.Job,
		"closeout":        mutation.Job.Closeout,
		"closeout_checks": checks,
		"ready":           ready,
	})
}
