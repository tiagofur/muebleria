package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

/**
 * Site survey endpoints (OC-040/OC-041, issue #305).
 *
 * GET   /api/projects/{id}/site-survey — survey + OC-041 fabrication blockers.
 * POST  /api/projects/{id}/site-survey — start the structured survey.
 * PUT   /api/projects/{id}/site-survey/spaces — create/update a space
 *       (commercial entry starts as preliminary).
 * DELETE /api/projects/{id}/site-survey/spaces/{spaceId} — remove a space.
 * POST  /api/projects/{id}/site-survey/spaces/{spaceId}/capture — capture
 *       field measures (preliminary → field, revision bump).
 * POST  /api/projects/{id}/site-survey/spaces/{spaceId}/approve — approve
 *       measures against the design (field → approved, OC-041 hard gate).
 * POST  /api/projects/{id}/site-survey/verify — verify the whole survey.
 * POST  /api/projects/{id}/site-survey/freeze — freeze approved measures as
 *       the fabrication basis (approved → fabrication).
 *
 * RBAC mirrors the survey_* event matrix (rbac.go / rbac.ts, contract
 * contracts/siteSurvey.json).
 */

func roleCanCaptureSurvey(role domain.UserRole) bool {
	return domain.RoleCanAppendProjectEvent(role, "survey_captured")
}

func roleCanVerifySurvey(role domain.UserRole) bool {
	return domain.RoleCanAppendProjectEvent(role, "survey_verified")
}

func roleCanApproveSurveyMeasures(role domain.UserRole) bool {
	return domain.RoleCanAppendProjectEvent(role, "survey_measures_approved")
}

type siteSurveyViewResponse struct {
	Survey         *domain.SiteSurvey         `json:"survey"`
	Blockers       []domain.SurveyGateBlocker `json:"blockers"`
	EventsAppended int                        `json:"events_appended,omitempty"`
}

func surveyPayload(v interface{}) json.RawMessage {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return raw
}

func buildSurveyView(survey *domain.SiteSurvey) siteSurveyViewResponse {
	blockers := domain.SurveyFabricationBlockers(survey)
	if blockers == nil {
		blockers = []domain.SurveyGateBlocker{}
	}
	return siteSurveyViewResponse{Survey: survey, Blockers: blockers}
}

// HandleProjectSiteSurvey handles GET (view) and POST (start) of the
// structured survey.
func (s *Server) HandleProjectSiteSurvey(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	claims := claimsFromRequest(r)
	switch r.Method {
	case http.MethodGet:
		var view siteSurveyViewResponse
		_, err := s.Store.MutateProjectSurvey(r.Context(), projectID, func(survey *domain.SiteSurvey) (*domain.SiteSurveyMutation, error) {
			view = buildSurveyView(survey)
			return &domain.SiteSurveyMutation{}, nil
		})
		if err != nil {
			respondWithMutationError(w, err)
			return
		}
		respondWithJSON(w, http.StatusOK, view)
	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claims), roleCanCaptureSurvey),
			"no tenés permiso para iniciar el levantamiento") {
			return
		}
		var view siteSurveyViewResponse
		mutation, err := s.Store.MutateProjectSurvey(r.Context(), projectID, func(survey *domain.SiteSurvey) (*domain.SiteSurveyMutation, error) {
			if survey != nil {
				return nil, fmt.Errorf("CONFLICT:la obra ya tiene un levantamiento estructurado")
			}
			now := time.Now().UTC()
			next := &domain.SiteSurvey{
				ID: domain.NewSiteSurveyEntityID("svy"), ProjectID: projectID,
				Revision: 1, Spaces: []domain.SurveySpace{}, CreatedAt: now,
				CapturedByUserID: actorID(claims),
			}
			events := []domain.ProjectEvent{{
				ID: newProjectEventID(), ProjectID: projectID,
				Type: "survey_captured", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
				Note: "Levantamiento estructurado iniciado",
				Payload: surveyPayload(map[string]interface{}{
					"survey_id": next.ID, "revision": next.Revision,
				}),
			}}
			view = buildSurveyView(next)
			return &domain.SiteSurveyMutation{Survey: next, Events: events}, nil
		})
		if err != nil {
			respondWithMutationError(w, err)
			return
		}
		view.EventsAppended = len(mutation.Events)
		respondWithJSON(w, http.StatusOK, view)
	default:
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
	}
}

// HandleSiteSurveySpaces handles PUT /api/projects/{id}/site-survey/spaces —
// create or update a space (commercial entry starts as preliminary).
func (s *Server) HandleSiteSurveySpaces(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	projectID := r.PathValue("id")
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), roleCanCaptureSurvey),
		"no tenés permiso para editar el levantamiento") {
		return
	}
	var body domain.SurveySpaceInput
	if !decodeJSONBody(w, r, &body) {
		return
	}

	var view siteSurveyViewResponse
	mutation, err := s.Store.MutateProjectSurvey(r.Context(), projectID, func(survey *domain.SiteSurvey) (*domain.SiteSurveyMutation, error) {
		next, err := domain.UpsertSurveySpace(survey, body)
		if err != nil {
			return nil, err
		}
		view = buildSurveyView(next)
		return &domain.SiteSurveyMutation{Survey: next}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = len(mutation.Events)
	respondWithJSON(w, http.StatusOK, view)
}

// HandleSiteSurveySpaceDelete handles DELETE
// /api/projects/{id}/site-survey/spaces/{spaceId}.
func (s *Server) HandleSiteSurveySpaceDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	projectID := r.PathValue("id")
	spaceID := r.PathValue("spaceId")
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), roleCanCaptureSurvey),
		"no tenés permiso para editar el levantamiento") {
		return
	}

	var view siteSurveyViewResponse
	mutation, err := s.Store.MutateProjectSurvey(r.Context(), projectID, func(survey *domain.SiteSurvey) (*domain.SiteSurveyMutation, error) {
		next, err := domain.RemoveSurveySpace(survey, spaceID)
		if err != nil {
			return nil, err
		}
		view = buildSurveyView(next)
		return &domain.SiteSurveyMutation{Survey: next}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = len(mutation.Events)
	respondWithJSON(w, http.StatusOK, view)
}

// HandleSiteSurveyCapture handles POST
// /api/projects/{id}/site-survey/spaces/{spaceId}/capture — capture field
// measures (preliminary → field, revision bump, survey_captured event).
func (s *Server) HandleSiteSurveyCapture(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	projectID := r.PathValue("id")
	spaceID := r.PathValue("spaceId")
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), roleCanCaptureSurvey),
		"no tenés permiso para capturar medidas en obra") {
		return
	}
	var body domain.SpaceMeasures
	if !decodeJSONBody(w, r, &body) {
		return
	}

	var view siteSurveyViewResponse
	mutation, err := s.Store.MutateProjectSurvey(r.Context(), projectID, func(survey *domain.SiteSurvey) (*domain.SiteSurveyMutation, error) {
		now := time.Now().UTC()
		next, spaceName, err := domain.CaptureSpaceMeasures(survey, spaceID, body, actorID(claims), now)
		if err != nil {
			return nil, err
		}
		events := []domain.ProjectEvent{{
			ID: newProjectEventID(), ProjectID: projectID,
			Type: "survey_captured", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
			Note: "Medidas levantadas en obra: " + spaceName,
			Payload: surveyPayload(map[string]interface{}{
				"survey_id": next.ID, "space_id": spaceID, "revision": next.Revision,
				"width_mm": body.WidthMm, "height_mm": body.HeightMm, "depth_mm": body.DepthMm,
			}),
		}}
		view = buildSurveyView(next)
		return &domain.SiteSurveyMutation{Survey: next, Events: events}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = len(mutation.Events)
	respondWithJSON(w, http.StatusOK, view)
}

// HandleSiteSurveyApprove handles POST
// /api/projects/{id}/site-survey/spaces/{spaceId}/approve — approve measures
// against the design (field → approved, OC-041 hard gate: preliminary never
// passes).
func (s *Server) HandleSiteSurveyApprove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	projectID := r.PathValue("id")
	spaceID := r.PathValue("spaceId")
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), roleCanApproveSurveyMeasures),
		"no tenés permiso para aprobar medidas (ingeniería)") {
		return
	}

	var view siteSurveyViewResponse
	mutation, err := s.Store.MutateProjectSurvey(r.Context(), projectID, func(survey *domain.SiteSurvey) (*domain.SiteSurveyMutation, error) {
		now := time.Now().UTC()
		next, spaceName, err := domain.ApproveSpaceMeasures(survey, spaceID, actorID(claims), now)
		if err != nil {
			return nil, err
		}
		events := []domain.ProjectEvent{{
			ID: newProjectEventID(), ProjectID: projectID,
			Type: "survey_measures_approved", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
			Note: "Medidas aprobadas: " + spaceName,
			Payload: surveyPayload(map[string]interface{}{
				"survey_id": next.ID, "space_id": spaceID,
			}),
		}}
		view = buildSurveyView(next)
		return &domain.SiteSurveyMutation{Survey: next, Events: events}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = len(mutation.Events)
	respondWithJSON(w, http.StatusOK, view)
}

// HandleSiteSurveyVerify handles POST /api/projects/{id}/site-survey/verify —
// verify the whole survey (OC-040 verifiedAt/verifiedBy).
func (s *Server) HandleSiteSurveyVerify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	projectID := r.PathValue("id")
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), roleCanVerifySurvey),
		"no tenés permiso para verificar el levantamiento") {
		return
	}

	var view siteSurveyViewResponse
	mutation, err := s.Store.MutateProjectSurvey(r.Context(), projectID, func(survey *domain.SiteSurvey) (*domain.SiteSurveyMutation, error) {
		now := time.Now().UTC()
		next, err := domain.VerifySiteSurvey(survey, actorID(claims), now)
		if err != nil {
			return nil, err
		}
		events := []domain.ProjectEvent{{
			ID: newProjectEventID(), ProjectID: projectID,
			Type: "survey_verified", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
			Note: "Levantamiento verificado",
			Payload: surveyPayload(map[string]interface{}{
				"survey_id": next.ID,
				"spaces":    len(next.Spaces),
			}),
		}}
		view = buildSurveyView(next)
		return &domain.SiteSurveyMutation{Survey: next, Events: events}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = len(mutation.Events)
	respondWithJSON(w, http.StatusOK, view)
}

// HandleSiteSurveyFreeze handles POST /api/projects/{id}/site-survey/freeze —
// freeze approved measures as the fabrication basis (approved → fabrication).
func (s *Server) HandleSiteSurveyFreeze(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	projectID := r.PathValue("id")
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), roleCanApproveSurveyMeasures),
		"no tenés permiso para congelar medidas (ingeniería)") {
		return
	}

	var view siteSurveyViewResponse
	mutation, err := s.Store.MutateProjectSurvey(r.Context(), projectID, func(survey *domain.SiteSurvey) (*domain.SiteSurveyMutation, error) {
		now := time.Now().UTC()
		next, err := domain.FreezeMeasuresForFabrication(survey, actorID(claims), now)
		if err != nil {
			return nil, err
		}
		events := []domain.ProjectEvent{{
			ID: newProjectEventID(), ProjectID: projectID,
			Type: "survey_measures_approved", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
			Note: "Medidas congeladas para fabricación",
			Payload: surveyPayload(map[string]interface{}{
				"survey_id": next.ID, "revision": next.Revision, "frozen": len(next.Spaces),
			}),
		}}
		view = buildSurveyView(next)
		return &domain.SiteSurveyMutation{Survey: next, Events: events}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = len(mutation.Events)
	respondWithJSON(w, http.StatusOK, view)
}
