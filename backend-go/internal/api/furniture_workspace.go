package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #500 / WEB-DT-1: authoritative contextual projection of the Project
// Furniture matrix. Server-owned: React never decides placed/pending, action
// codes/remediations or quantity grouping provenance.

// HandleProjectFurnitureWorkspace serves POST /api/projects/{projectId}/furniture-workspace.
func (s *Server) HandleProjectFurnitureWorkspace(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para ver los muebles del proyecto") {
		return
	}
	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId inválido", nil)
		return
	}

	var req openapi.ProjectFurnitureWorkspaceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err.Error() != "EOF" {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "payload JSON inválido", nil)
		return
	}

	query := storage.FurnitureWorkspaceQuery{}
	if req.QuoteRevisionId != nil && *req.QuoteRevisionId != "" {
		trimmed := strings.TrimSpace(*req.QuoteRevisionId)
		if !isValidUUID(trimmed) {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "quoteRevisionId inválido", nil)
			return
		}
		query.QuoteRevisionID = trimmed
	}

	if req.DesignId != nil && *req.DesignId != "" {
		trimmed := strings.TrimSpace(*req.DesignId)
		if !isValidUUID(trimmed) {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designId inválido", nil)
			return
		}
		query.DesignID = trimmed
	}

	var kind string
	if req.DesignContextKind != nil && *req.DesignContextKind != "" {
		kind = strings.TrimSpace(*req.DesignContextKind)
	}

	if req.DesignRevisionId != nil && *req.DesignRevisionId != "" {
		trimmed := strings.TrimSpace(*req.DesignRevisionId)
		if !isValidUUID(trimmed) {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designRevisionId inválido", nil)
			return
		}
		query.DesignRevisionID = trimmed
	}

	if query.DesignID == "" {
		if kind != "" && kind != domain.FurnitureWorkspaceContextNone {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designContextKind requiere designId", nil)
			return
		}
		if query.DesignRevisionID != "" {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designRevisionId requiere designId", nil)
			return
		}
		query.DesignContextKind = domain.FurnitureWorkspaceContextNone
	} else {
		if kind == "" {
			kind = domain.FurnitureWorkspaceContextWorking
		}
		switch kind {
		case domain.FurnitureWorkspaceContextWorking:
			if query.DesignRevisionID != "" {
				respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designRevisionId no es compatible con kind=working", nil)
				return
			}
		case domain.FurnitureWorkspaceContextRevision:
			if query.DesignRevisionID == "" {
				respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designRevisionId es requerido para kind=revision", nil)
				return
			}
		case domain.FurnitureWorkspaceContextNone:
			if query.DesignRevisionID != "" {
				respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designRevisionId no es compatible con kind=none", nil)
				return
			}
		default:
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designContextKind no soportado", nil)
			return
		}
		query.DesignContextKind = kind
	}

	workspace, err := s.Store.GetProjectFurnitureWorkspace(r.Context(), projectID, query)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrDesignNotFound),
			errors.Is(err, domain.ErrQuoteRevisionNotFound),
			errors.Is(err, domain.ErrDesignRevisionNotFound):
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "recurso del proyecto no encontrado", nil)
		case errors.Is(err, domain.ErrInvalidRevisionSnapshot):
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "snapshot de revisión inválido: payload corrupto", nil)
		default:
			respondWithInternalError(w, err, "get project furniture workspace")
		}
		return
	}

	respondWithJSON(w, http.StatusOK, toProjectFurnitureWorkspaceDTO(workspace))
}

func toProjectFurnitureWorkspaceDTO(ws *domain.FurnitureWorkspace) openapi.ProjectFurnitureWorkspace {
	var quoteRev *openapi.FurnitureWorkspaceQuoteRevisionContext
	if ws.QuoteRevision != nil {
		quoteRev = &openapi.FurnitureWorkspaceQuoteRevisionContext{
			ID:             ws.QuoteRevision.ID,
			RevisionNumber: int64(ws.QuoteRevision.RevisionNumber),
			Status:         openapi.QuoteRevisionStatus(ws.QuoteRevision.Status),
		}
	}

	designHeader := openapi.FurnitureWorkspaceDesignContext{
		Kind: openapi.FurnitureWorkspaceContextKind(ws.DesignContext.Kind),
	}
	if ws.DesignContext.DesignID != "" {
		id := ws.DesignContext.DesignID
		designHeader.DesignId = &id
	}
	if ws.DesignContext.DesignRevisionID != "" {
		revID := ws.DesignContext.DesignRevisionID
		designHeader.DesignRevisionId = &revID
		revNum := int64(ws.DesignContext.DesignRevisionNumber)
		designHeader.DesignRevisionNumber = &revNum
	}

	var contextualRelease *openapi.FurnitureWorkspaceReleaseContext
	if ws.Release != nil {
		contextualRelease = toWorkspaceReleaseContextDTO(ws.Release)
	}

	var latestProjectRelease *openapi.FurnitureWorkspaceReleaseContext
	if ws.LatestProjectRelease != nil {
		latestProjectRelease = toWorkspaceReleaseContextDTO(ws.LatestProjectRelease)
	}

	units := make([]openapi.FurnitureWorkspaceUnit, 0, len(ws.Units))
	for _, u := range ws.Units {
		unitDTO := openapi.FurnitureWorkspaceUnit{
			FurnitureInstance: toFurnitureInstanceDTO(u.Instance),
			Commercial: openapi.FurnitureWorkspaceCommercial{
				Present: u.Commercial.Present,
			},
			Design: openapi.FurnitureWorkspaceDesign{
				Presence:    openapi.FurnitureWorkspaceDesignPresence(u.Design.Presence),
				ContextKind: openapi.FurnitureWorkspaceContextKind(u.Design.ContextKind),
			},
		}
		if u.Commercial.LifecycleStatus != "" {
			status := u.Commercial.LifecycleStatus
			unitDTO.Commercial.LifecycleStatus = &status
		}
		if u.Design.DesignID != "" {
			dID := u.Design.DesignID
			unitDTO.Design.DesignId = &dID
		}
		if u.Design.DesignRevisionID != "" {
			drID := u.Design.DesignRevisionID
			unitDTO.Design.DesignRevisionId = &drID
		}

		if u.CommercialGrouping != nil {
			var qRevID *string
			if u.CommercialGrouping.QuoteRevisionID != "" {
				qr := u.CommercialGrouping.QuoteRevisionID
				qRevID = &qr
			}
			unitDTO.CommercialGrouping = &openapi.FurnitureWorkspaceCommercialGrouping{
				QuoteRevisionId: qRevID,
				QuoteLineId:     u.CommercialGrouping.QuoteLineID,
				UnitIndex:       int64(u.CommercialGrouping.UnitIndex),
				UnitTotal:       int64(u.CommercialGrouping.UnitTotal),
			}
		}

		if u.ActionRequired != nil {
			var remediation *string
			if u.ActionRequired.Remediation != "" {
				rem := u.ActionRequired.Remediation
				remediation = &rem
			}
			unitDTO.ActionRequired = &openapi.FurnitureWorkspaceAction{
				Code:        openapi.FurnitureWorkspaceActionCode(u.ActionRequired.Code),
				Message:     u.ActionRequired.Message,
				Remediation: remediation,
			}
		}

		if u.Reconciliation != nil {
			reconcileDTO := toReconciliationItemDTO(u.Reconciliation.Item, u.Reconciliation.Impact)
			unitDTO.Reconciliation = &reconcileDTO
		}

		units = append(units, unitDTO)
	}

	return openapi.ProjectFurnitureWorkspace{
		ProjectId:            ws.ProjectID,
		QuoteRevision:        quoteRev,
		DesignContext:        designHeader,
		Release:              contextualRelease,
		LatestProjectRelease: latestProjectRelease,
		Summary: openapi.FurnitureWorkspaceSummary{
			Total:          int64(ws.Summary.Total),
			ActiveUnits:    int64(ws.Summary.ActiveUnits),
			Quoted:         int64(ws.Summary.Quoted),
			Placed:         int64(ws.Summary.Placed),
			Pending:        int64(ws.Summary.Pending),
			ActionRequired: int64(ws.Summary.ActionRequired),
			Removed:        int64(ws.Summary.Removed),
			Cancelled:      int64(ws.Summary.Cancelled),
		},
		Units: units,
	}
}

func toWorkspaceReleaseContextDTO(rel *domain.FurnitureWorkspaceRelease) *openapi.FurnitureWorkspaceReleaseContext {
	if rel == nil {
		return nil
	}
	dto := &openapi.FurnitureWorkspaceReleaseContext{
		ID:                   rel.ID,
		ReleaseNumber:        int64(rel.ReleaseNumber),
		DesignRevisionId:     rel.DesignRevisionID,
		DesignRevisionNumber: int64(rel.DesignRevisionNumber),
		ManufacturingStale:   rel.ManufacturingStale,
	}
	if rel.QuoteRevisionID != "" {
		qid := rel.QuoteRevisionID
		dto.QuoteRevisionId = &qid
	}
	if rel.CurrentDesignRevisionID != "" {
		cid := rel.CurrentDesignRevisionID
		dto.CurrentDesignRevisionId = &cid
		cnum := int64(rel.CurrentDesignRevisionNumber)
		dto.CurrentDesignRevisionNumber = &cnum
	}
	return dto
}
