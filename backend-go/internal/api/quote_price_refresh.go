package api

import (
	"errors"
	"net/http"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1662: price-only requote endpoints.

func (s *Server) priceRefreshCommand(w http.ResponseWriter, r *http.Request, dryRun bool) (*storage.PriceRefreshQuoteResult, bool) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return nil, false
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateProjects), "no tenés permiso para crear cotizaciones en esta obra") {
		return nil, false
	}
	projectID := r.PathValue("projectId")
	quoteRevisionID := r.PathValue("quoteRevisionId")
	if !isValidUUID(projectID) || !isValidUUID(quoteRevisionID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId o quoteRevisionId inválido", nil)
		return nil, false
	}
	result, err := s.Store.PriceRefreshQuoteRevision(r.Context(), storage.PriceRefreshQuoteCommand{
		ProjectID:           projectID,
		BaseQuoteRevisionID: quoteRevisionID,
		DryRun:              dryRun,
		ActorUserID:         claims.UserID,
		IP:                  clientIP(r),
		RequestID:           RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithPriceRefreshError(w, err)
		return nil, false
	}
	return result, true
}

// HandleQuotePriceRefreshPreview serves POST
// /api/projects/{projectId}/quote-revisions/{quoteRevisionId}:price-refresh-preview.
func (s *Server) HandleQuotePriceRefreshPreview(w http.ResponseWriter, r *http.Request) {
	result, ok := s.priceRefreshCommand(w, r, true)
	if !ok {
		return
	}
	respondWithJSON(w, http.StatusOK, openapi.QuotePriceRefreshPreview{
		BaseRevisionNumber: int64(result.BaseRevisionNumber),
		Currency:           result.Currency,
		PreviousSaleTotal:  result.PreviousSaleTotal,
		NewSaleTotal:       result.NewSaleTotal,
		Changed:            result.Changed,
	})
}

// HandleQuotePriceRefresh serves POST
// /api/projects/{projectId}/quote-revisions/{quoteRevisionId}:price-refresh.
func (s *Server) HandleQuotePriceRefresh(w http.ResponseWriter, r *http.Request) {
	result, ok := s.priceRefreshCommand(w, r, false)
	if !ok {
		return
	}
	respondWithJSON(w, http.StatusCreated, openapi.QuotePriceRefreshResult{
		QuoteRevision:     toQuoteRevisionDTO(result.Revision),
		Currency:          result.Currency,
		PreviousSaleTotal: result.PreviousSaleTotal,
		NewSaleTotal:      result.NewSaleTotal,
	})
}

func respondWithPriceRefreshError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrPriceRefreshNoChange):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodePriceRefreshNoChange, "Los precios del catálogo no cambiaron el total: no hace falta una nueva cotización.", nil)
	case errors.Is(err, domain.ErrPriceRefreshConfigurationChanged):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodePriceRefreshConfigurationChanged, "Cambió la configuración de aperturas/agarres de la obra: eso no es sólo precio. Re-cotizá desde el diseño.", nil)
	case errors.Is(err, domain.ErrQuoteRevisionConflict):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "Hay una revisión de cotización más nueva: re-cotizá desde la última.", nil)
	case errors.Is(err, domain.ErrQuoteRevisionInvalidTransition):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "Sólo una cotización publicada o aceptada se re-cotiza por precios.", nil)
	case errors.Is(err, domain.ErrQuoteCommercialSnapshotMissing):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "Esta revisión no congeló su verdad comercial completa (legado): creá una revisión de cotización nueva.", nil)
	case errors.Is(err, domain.ErrQuoteUnitUnfreezable):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, err.Error(), nil)
	default:
		respondWithQuoteLifecycleError(w, err, "price-refresh")
	}
}
