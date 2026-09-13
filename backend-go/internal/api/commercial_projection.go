package api

import (
	"errors"
	"net/http"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// HandleDesignCommercialProjection serves the read-only, non-binding estimate
// consumed by SketchUp and available to generated Web clients.
func (s *Server) HandleDesignCommercialProjection(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para ver el presupuesto del diseño") {
		return
	}
	projectID, designID := r.PathValue("projectId"), r.PathValue("designId")
	if !isValidUUID(projectID) || !isValidUUID(designID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId o designId inválido", nil)
		return
	}
	roles := actorRoles(claims)
	project, err := s.Store.GetProjectByID(r.Context(), projectID)
	if err != nil || project == nil || !canAccessCommercialProjectionPortfolio(claims.UserID, roles, project.OwnerUserID) {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "diseño no encontrado", nil)
		return
	}
	projection, err := s.Store.GetDesignCommercialProjection(r.Context(), projectID, designID)
	if err != nil {
		if errors.Is(err, domain.ErrDesignNotFound) || errors.Is(err, domain.ErrQuoteRevisionNotFound) {
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "diseño no encontrado", nil)
			return
		}
		respondWithInternalError(w, err, "get design commercial projection")
		return
	}
	if projection == nil {
		respondWithInternalError(w, errors.New("nil commercial projection"), "get design commercial projection")
		return
	}
	if !s.actorCanViewCosts(r) {
		domain.RedactCommercialProjectionCosts(projection)
	}
	respondWithJSON(w, http.StatusOK, toCommercialProjectionDTO(projection))
}

func canAccessCommercialProjectionPortfolio(actorID string, roles []domain.UserRole, ownerUserID string) bool {
	// Seller access remains portfolio-scoped. Operational project roles rely on
	// the repository/RLS organization relationship authority instead of sales
	// ownership, so an assigned manufacturing organization is not denied here.
	if domain.AnyRole(roles, func(role domain.UserRole) bool {
		return role != domain.RoleVendedor && domain.RoleCanAccessProjects(role)
	}) {
		return true
	}
	return ownerUserID != "" && ownerUserID == actorID
}

func toCommercialProjectionDTO(p *domain.CommercialProjection) openapi.CommercialProjection {
	var amounts *openapi.CommercialProjectionAmounts
	if p.Amounts != nil {
		amounts = &openapi.CommercialProjectionAmounts{
			MaterialsCost: p.Amounts.MaterialsCost, EdgeTotal: p.Amounts.EdgeTotal,
			HardwareTotal: p.Amounts.HardwareTotal, DirectCost: p.Amounts.DirectCost,
			LaborModular: p.Amounts.LaborModular, LaborFixedCost: p.Amounts.LaborFixedCost,
			MarginFactor: p.Amounts.MarginFactor, SaleTotal: p.Amounts.SaleTotal,
		}
	}
	return openapi.CommercialProjection{
		Schema: p.Schema, Status: string(p.Status), ProjectId: p.ProjectID, DesignId: p.DesignID,
		WorkingVersion: p.WorkingVersion, WorkingFingerprint: p.WorkingFingerprint,
		CatalogFingerprint: p.CatalogFingerprint, ProjectionFingerprint: p.ProjectionFingerprint,
		PricingAuthority: p.PricingAuthority, CalculatedAt: p.CalculatedAt.UTC().Format(time.RFC3339Nano),
		Currency: p.Currency, ItemCount: int64(p.ItemCount), Amounts: amounts,
		CostsWithheld: p.CostsWithheld, SaleAmountsWithheld: p.SaleAmountsWithheld,
		Reference: projectionReferenceDTO(p.Reference), AcceptedReference: projectionReferenceDTO(p.AcceptedReference),
		LatestPublishedReference: projectionReferenceDTO(p.LatestPublishedReference), Comparison: projectionComparisonDTO(p.Comparison),
		Issues: p.Issues,
	}
}

func projectionReferenceDTO(ref *domain.CommercialProjectionReference) *openapi.CommercialProjectionReference {
	if ref == nil {
		return nil
	}
	return &openapi.CommercialProjectionReference{
		QuoteRevisionId: ref.QuoteRevisionID, RevisionNumber: int64(ref.RevisionNumber),
		Status: openapi.QuoteRevisionStatus(ref.Status), Currency: ref.Currency, SaleTotal: ref.SaleTotal,
	}
}

func projectionComparisonDTO(comparison *domain.CommercialProjectionComparison) *openapi.CommercialProjectionComparison {
	if comparison == nil {
		return nil
	}
	return &openapi.CommercialProjectionComparison{
		AbsoluteDelta: comparison.AbsoluteDelta, PercentageDelta: comparison.PercentageDelta,
	}
}
