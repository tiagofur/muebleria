package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #393 / DT-9: QuoteRevision ↔ DesignRevision reconciliation by FurnitureInstance
// (ADR-0003, digital-thread §§15–16, 25, 26, 28, 30–31).

// HandleProjectReconciliation handles POST /api/projects/{projectId}/reconciliation.
// It performs a pure, read-only deterministic comparison between an exact QuoteRevision
// and an exact DesignRevision.
func (s *Server) HandleProjectReconciliation(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	roles := actorRoles(claims)
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver la reconciliación del proyecto") {
		return
	}

	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId inválido", nil)
		return
	}

	var payload openapi.ReconcileProjectDesignRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "cuerpo de solicitud inválido", nil)
		return
	}

	quoteRevID := strings.TrimSpace(payload.QuoteRevisionId)
	designRevID := strings.TrimSpace(payload.DesignRevisionId)

	if !isValidUUID(quoteRevID) || !isValidUUID(designRevID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "quoteRevisionId y designRevisionId deben ser UUID válidos", nil)
		return
	}

	result, err := s.Store.ReconcileProject(r.Context(), projectID, quoteRevID, designRevID)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrCrossProjectReconciliation):
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "cross-project reconciliation rejected", nil)
		case errors.Is(err, domain.ErrDesignNotFound):
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "proyecto no encontrado", nil)
		case errors.Is(err, domain.ErrDesignRevisionNotFound):
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "revisión de diseño no encontrada", nil)
		case errors.Is(err, domain.ErrQuoteRevisionNotFound):
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "revisión comercial no encontrada", nil)
		case errors.Is(err, domain.ErrInvalidRevisionSnapshot):
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "invalid revision snapshot: corrupt or malformed payload", nil)
		case errors.Is(err, domain.ErrInvalidRevisionID):
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "revision ID inválido", nil)
		default:
			respondWithError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	// #394 / DT-10: classify the exact reconciliation server-side so backend
	// and every surface share ONE classification authority — UI conditionals
	// never fork the policy.
	classification, err := domain.ClassifyReconciliation(result)
	if err != nil {
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "invalid revision snapshot: corrupt or malformed payload", nil)
		return
	}

	respondWithJSON(w, http.StatusOK, toReconciliationResultDTO(result, classification))
}

func toChangeImpactDTO(impact domain.ChangeImpact) openapi.ChangeImpact {
	return openapi.ChangeImpact{
		Commercial:    impact.Commercial,
		Manufacturing: impact.Manufacturing,
		Spatial:       impact.Spatial,
	}
}

func toImpactSummaryDTO(summary domain.ImpactClassificationSummary) openapi.ReconciliationImpactSummary {
	return openapi.ReconciliationImpactSummary{
		RequiresRequote:      summary.RequiresRequote,
		RequiresResolution:   summary.RequiresResolution,
		CanRequote:           summary.CanRequote,
		CommercialChanges:    int64(summary.CommercialChanges),
		ManufacturingChanges: int64(summary.ManufacturingChanges),
		SpatialChanges:       int64(summary.SpatialChanges),
	}
}

func toReconciliationResultDTO(r *domain.ReconciliationResult, classification *domain.ImpactClassificationResult) openapi.ProjectDesignReconciliationResult {
	impactsByID := make(map[string]domain.ChangeImpact, len(classification.Items))
	for _, item := range classification.Items {
		impactsByID[item.FurnitureInstanceID] = item.Impact
	}

	items := make([]openapi.ReconciliationItem, len(r.Items))
	for i, it := range r.Items {
		diffs := make([]openapi.StructuredDifference, len(it.Differences))
		for d, diff := range it.Differences {
			var qVal, dVal *any
			if diff.QuoteValue != nil {
				v := diff.QuoteValue
				qVal = &v
			}
			if diff.DesignValue != nil {
				v := diff.DesignValue
				dVal = &v
			}
			diffs[d] = openapi.StructuredDifference{
				Path:        diff.Path,
				QuoteValue:  qVal,
				DesignValue: dVal,
				Impact:      toChangeImpactDTO(domain.ClassifyDifferencePath(diff.Path)),
			}
		}
		var notes *string
		if it.Notes != "" {
			n := it.Notes
			notes = &n
		}
		items[i] = openapi.ReconciliationItem{
			FurnitureInstanceId: it.FurnitureInstanceID,
			Status:              openapi.ReconciliationStatus(it.Status),
			Differences:         diffs,
			Impact:              toChangeImpactDTO(impactsByID[it.FurnitureInstanceID]),
			Notes:               notes,
		}
	}

	return openapi.ProjectDesignReconciliationResult{
		ProjectId:        r.ProjectID,
		QuoteRevisionId:  r.QuoteRevisionID,
		DesignRevisionId: r.DesignRevisionID,
		Summary: openapi.ReconciliationSummary{
			Total:            int64(r.Summary.Total),
			Synced:           int64(r.Summary.Synced),
			QuotedNotModeled: int64(r.Summary.QuotedNotModeled),
			ModeledNotQuoted: int64(r.Summary.ModeledNotQuoted),
			Modified:         int64(r.Summary.Modified),
			Removed:          int64(r.Summary.Removed),
			Conflict:         int64(r.Summary.Conflict),
		},
		Items:  items,
		Impact: toImpactSummaryDTO(classification.Summary),
	}
}
