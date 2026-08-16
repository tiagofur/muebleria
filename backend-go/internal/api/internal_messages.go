package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// HandleProjectInternalMessages handles GET (list messages) and POST (create message) for /api/projects/{id}/messages
func (s *Server) HandleProjectInternalMessages(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	if projectID == "" {
		respondWithError(w, http.StatusBadRequest, "falta el id del proyecto")
		return
	}

	// Verify project exists
	_, err := s.Store.GetProjectByID(r.Context(), projectID)
	if err != nil {
		respondWithError(w, http.StatusNotFound, "proyecto no encontrado")
		return
	}

	switch r.Method {
	case http.MethodGet:
		messages, err := s.Store.ListProjectInternalMessages(r.Context(), projectID)
		if err != nil {
			respondWithInternalError(w, err, "list internal messages")
			return
		}
		respondWithJSON(w, http.StatusOK, messages)

	case http.MethodPost:
		claims := claimsFromRequest(r)
		var senderID string
		var senderName string
		if claims != nil {
			senderID = claims.UserID
			senderName = claims.Email
		}


		var req struct {
			SenderName  string                            `json:"sender_name,omitempty"`
			MessageType domain.ProjectInternalMessageType `json:"message_type"`
			Content     string                            `json:"content"`
			IsResolved  *bool                             `json:"is_resolved,omitempty"`
			Attachments json.RawMessage                   `json:"attachments,omitempty"`
		}
		if !decodeJSONBody(w, r, &req) {
			return
		}

		if strings.TrimSpace(req.Content) == "" {
			respondWithError(w, http.StatusBadRequest, "el contenido del mensaje no puede estar vacío")
			return
		}

		msgType := req.MessageType
		if msgType == "" {
			msgType = domain.InternalMsgComment
		}

		if req.SenderName != "" {
			senderName = req.SenderName
		}
		if senderName == "" {
			senderName = "Usuario"
		}

		isResolved := true
		if req.IsResolved != nil {
			isResolved = *req.IsResolved
		}

		msg := domain.ProjectInternalMessage{
			ProjectID:   projectID,
			SenderID:    senderID,
			SenderName:  senderName,
			MessageType: msgType,
			Content:     strings.TrimSpace(req.Content),
			IsResolved:  isResolved,
			Attachments: req.Attachments,
		}

		if err := s.Store.CreateProjectInternalMessage(r.Context(), &msg); err != nil {
			respondWithInternalError(w, err, "create internal message")
			return
		}

		respondWithJSON(w, http.StatusCreated, msg)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
	}
}

// HandleProjectTechnicalWorkflow handles PATCH /api/projects/{id}/technical-workflow
func (s *Server) HandleProjectTechnicalWorkflow(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	if projectID == "" {
		respondWithError(w, http.StatusBadRequest, "falta el id del proyecto")
		return
	}

	project, err := s.Store.GetProjectByID(r.Context(), projectID)
	if err != nil {
		respondWithError(w, http.StatusNotFound, "proyecto no encontrado")
		return
	}

	if r.Method != http.MethodPatch {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}

	var req struct {
		AssignedEngineerID        *string `json:"assigned_engineer_id"`
		TechnicalStatus           *string `json:"technical_status"`
		SurveyCompletedAt         *string `json:"survey_completed_at"`
		InstallationScheduledDate *string `json:"installation_scheduled_date"`
		Comment                   string  `json:"comment,omitempty"`
		ForceRelease              bool    `json:"force_release,omitempty"`
	}

	if !decodeJSONBody(w, r, &req) {
		return
	}

	targetEngineerID := &project.AssignedEngineerID
	if req.AssignedEngineerID != nil {
		targetEngineerID = req.AssignedEngineerID
	}

	targetStatus := project.TechnicalStatus
	if targetStatus == "" {
		targetStatus = string(domain.TechStatusPendingAssignment)
	}
	if req.TechnicalStatus != nil && strings.TrimSpace(*req.TechnicalStatus) != "" {
		targetStatus = *req.TechnicalStatus
	}

	// Guard: Transitioning to ready_to_install, installing or completed requires 100% of modules loaded on transport
	if (targetStatus == "ready_to_install" || targetStatus == "installing" || targetStatus == "completed") && len(project.Items) > 0 {
		progress := domain.CalculateLoadingProgress(project)
		if !progress.AllLoaded && !req.ForceRelease {
			missing := progress.TotalPackages - progress.LoadedPackages
			respondWithError(w, http.StatusBadRequest,
				fmt.Sprintf("No se puede liberar a despacho / entrega: faltan %d de %d muebles por escanear y cargar al transporte", missing, progress.TotalPackages))
			return
		}
	}

	var surveyStr *string
	if req.SurveyCompletedAt != nil {
		surveyStr = req.SurveyCompletedAt
	} else if project.SurveyCompletedAt != nil {
		s := project.SurveyCompletedAt.Format("2006-01-02T15:04:05Z07:00")
		surveyStr = &s
	}

	var installDate *string
	if req.InstallationScheduledDate != nil {
		installDate = req.InstallationScheduledDate
	} else if project.InstallationScheduledDate != nil {
		installDate = project.InstallationScheduledDate
	}

	if err := s.Store.UpdateProjectTechnicalWorkflow(
		r.Context(),
		projectID,
		targetEngineerID,
		targetStatus,
		surveyStr,
		installDate,
	); err != nil {
		respondWithInternalError(w, err, "update technical workflow")
		return
	}

	// Optionally log automatic internal message if comment was attached
	if strings.TrimSpace(req.Comment) != "" {
		claims := claimsFromRequest(r)
		var senderID string
		var senderName string
		if claims != nil {
			senderID = claims.UserID
			senderName = claims.Email
		}
		if senderName == "" {
			senderName = "Sistema"
		}


		autoMsg := domain.ProjectInternalMessage{
			ProjectID:   projectID,
			SenderID:    senderID,
			SenderName:  senderName,
			MessageType: domain.InternalMsgGateApproval,
			Content:     req.Comment,
			IsResolved:  true,
		}
		_ = s.Store.CreateProjectInternalMessage(r.Context(), &autoMsg)
	}

	updatedProject, err := s.Store.GetProjectByID(r.Context(), projectID)
	if err != nil {
		respondWithInternalError(w, err, "fetch updated project")
		return
	}

	respondWithJSON(w, http.StatusOK, updatedProject)
}
