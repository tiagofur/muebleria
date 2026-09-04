package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #395 / DT-11: DesignRevision approval + ProductionRelease API (ADR-0003,
// digital-thread §§17, 21–23, 25.6).
//
// Approval is an explicit, permission-protected lifecycle decision on an
// exact revision — publish never auto-approves. Release runs the whole §17
// gate server-side against exact revisions and pins the immutable row to
// them. The client supplies no verdicts: no approved flags, no preflight
// results, no fingerprints (§§32–33).

// HandleDesignRevisionApprove serves POST
// /api/designs/{designId}/revisions/{revisionId}:approve.
func (s *Server) HandleDesignRevisionApprove(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanApproveDesignRevisions), "no tenés permiso para aprobar revisiones de diseño") {
		return
	}

	designID := r.PathValue("designId")
	revisionID := r.PathValue("revisionId")
	if !isValidUUID(designID) || !isValidUUID(revisionID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		return
	}

	rev, err := s.Store.ApproveDesignRevision(r.Context(), storage.ApproveDesignRevisionCommand{
		DesignID:         designID,
		DesignRevisionID: revisionID,
		ActorUserID:      claims.UserID,
		IP:               clientIP(r),
		RequestID:        RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithDesignApprovalError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, toDesignRevisionDTO(*rev))
}

func respondWithDesignApprovalError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrDesignRevisionNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "La revisión de diseño no existe", nil)
	case errors.Is(err, domain.ErrInvalidDesignCommand):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "comando de aprobación inválido", nil)
	case errors.Is(err, domain.ErrDesignRevisionApprovalInvalid):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "la revisión no puede aprobarse desde su estado actual", nil)
	default:
		respondWithInternalError(w, err, "approve design revision")
	}
}

// HandleProjectProductionReleases serves GET (list) and POST (create) for
// /api/projects/{projectId}/production-releases.
func (s *Server) HandleProjectProductionReleases(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId inválido", nil)
		return
	}

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para ver releases de producción") {
			return
		}
		readbacks, err := s.Store.ListProjectProductionReleases(r.Context(), projectID)
		if err != nil {
			respondWithProductionReleaseError(w, err)
			return
		}
		items := make([]openapi.ProductionRelease, 0, len(readbacks))
		for _, readback := range readbacks {
			items = append(items, toProductionReleaseDTO(readback))
		}
		respondWithJSON(w, http.StatusOK, items)
	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanReleaseProduction), "no tenés permiso para liberar producción") {
			return
		}
		var payload openapi.CreateProductionReleaseRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "cuerpo de solicitud inválido", nil)
			return
		}
		designRevisionID := strings.TrimSpace(payload.DesignRevisionID)
		if !isValidUUID(designRevisionID) {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designRevisionId debe ser un UUID válido", nil)
			return
		}
		quoteRevisionID := ""
		if payload.QuoteRevisionID != nil && strings.TrimSpace(*payload.QuoteRevisionID) != "" {
			quoteRevisionID = strings.TrimSpace(*payload.QuoteRevisionID)
			if !isValidUUID(quoteRevisionID) {
				respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "quoteRevisionId debe ser un UUID válido", nil)
				return
			}
		}

		readback, err := s.Store.CreateProductionRelease(r.Context(), storage.CreateProductionReleaseCommand{
			ProjectID:        projectID,
			DesignRevisionID: designRevisionID,
			QuoteRevisionID:  quoteRevisionID,
			ActorUserID:      claims.UserID,
			IP:               clientIP(r),
			RequestID:        RequestIDFromContext(r.Context()),
		})
		if err != nil {
			respondWithProductionReleaseError(w, err)
			return
		}
		respondWithJSON(w, http.StatusCreated, toProductionReleaseDTO(*readback))
	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// HandleProjectProductionRelease serves GET
// /api/projects/{projectId}/production-releases/{releaseId}.
func (s *Server) HandleProjectProductionRelease(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para ver releases de producción") {
		return
	}
	projectID := r.PathValue("projectId")
	releaseID := r.PathValue("releaseId")
	if !isValidUUID(projectID) || !isValidUUID(releaseID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		return
	}

	readback, err := s.Store.GetProjectProductionRelease(r.Context(), projectID, releaseID)
	if err != nil {
		respondWithProductionReleaseError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, toProductionReleaseDTO(*readback))
}

func toProductionReleaseDTO(readback storage.ProductionReleaseReadback) openapi.ProductionRelease {
	release := readback.Release
	dto := openapi.ProductionRelease{
		ID:                       release.ID,
		ProjectID:                release.ProjectID,
		ReleaseNumber:            int64(release.ReleaseNumber),
		DesignRevisionID:         release.DesignRevisionID,
		DesignRevisionNumber:     int64(release.DesignRevisionNumber),
		ManufacturingFingerprint: release.ManufacturingFingerprint,
		Status:                   openapi.ProductionReleaseStatus(release.Status),
		ReleasedBy:               release.ReleasedBy,
		ReleasedAt:               release.ReleasedAt.UTC().Format(time.RFC3339Nano),
		Staleness: openapi.ProductionReleaseStaleness{
			ManufacturingStale: readback.Staleness.ManufacturingStale,
		},
	}
	if release.QuoteRevisionID != "" {
		q := release.QuoteRevisionID
		dto.QuoteRevisionID = &q
	}
	if readback.Staleness.CurrentDesignRevisionID != "" {
		id := readback.Staleness.CurrentDesignRevisionID
		dto.Staleness.CurrentDesignRevisionID = &id
		if readback.Staleness.CurrentDesignRevisionNumber > 0 {
			n := int64(readback.Staleness.CurrentDesignRevisionNumber)
			dto.Staleness.CurrentDesignRevisionNumber = &n
		}
	}
	return dto
}

// respondWithProductionReleaseError maps the gate verdicts to exact HTTP
// semantics: gate rejections are 409 CONFLICT with the authoritative blockers
// in details; missing and cross-project objects share the uniform 404.
func respondWithProductionReleaseError(w http.ResponseWriter, err error) {
	var preflightBlocked *domain.ReleasePreflightBlockedError
	if errors.As(err, &preflightBlocked) {
		issues := make([]map[string]any, 0, len(preflightBlocked.Result.Issues))
		for _, issue := range preflightBlocked.Result.Issues {
			issues = append(issues, map[string]any{
				"code":                  string(issue.Code),
				"furnitureInstanceId":   issue.FurnitureInstanceID,
				"furnitureDefinitionId": issue.FurnitureDefinitionID,
				"parameter":             issue.Parameter,
				"message":               issue.Message,
			})
		}
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict,
			"el preflight de fabricación bloqueó el release",
			map[string]any{
				"blocker": "manufacturing_preflight_blocked",
				"issues":  issues,
			})
		return
	}
	var commercialBlocked *domain.ReleaseCommercialGateError
	if errors.As(err, &commercialBlocked) {
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict,
			commercialBlocked.Error(),
			map[string]any{
				"blocker":            string(commercialBlocked.Cause),
				"requiresRequote":    commercialBlocked.Classification.Summary.RequiresRequote,
				"requiresResolution": commercialBlocked.Classification.Summary.RequiresResolution,
			})
		return
	}
	switch {
	case errors.Is(err, domain.ErrDesignNotFound), errors.Is(err, domain.ErrDesignRevisionNotFound),
		errors.Is(err, domain.ErrQuoteRevisionNotFound), errors.Is(err, domain.ErrReleaseNotFound),
		errors.Is(err, domain.ErrCrossProjectRelease):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "El proyecto, la revisión o el release no existe", nil)
	case errors.Is(err, domain.ErrInvalidReleaseCommand):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "comando de release inválido", nil)
	case errors.Is(err, domain.ErrDesignRevisionNotApproved):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "la revisión de diseño no está aprobada para producción", nil)
	case errors.Is(err, domain.ErrReleaseQuoteNotAccepted):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "la cotización base no está aceptada", nil)
	default:
		respondWithInternalError(w, err, "production release")
	}
}
