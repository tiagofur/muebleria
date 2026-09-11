package api

import (
	"errors"
	"net/http"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #500 / WEB-DT-1: exact commercial context read for the Project Furniture
// matrix. The generated DTO carries the immutable per-unit items so React
// derives commercial presence from the exact selected revision — never from
// the live mutable quote or a client-side snapshot.

// HandleProjectQuoteRevisions serves GET /api/projects/{projectId}/quote-revisions.
func (s *Server) HandleProjectQuoteRevisions(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para ver las revisiones de cotización") {
		return
	}
	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId inválido", nil)
		return
	}

	details, err := s.Store.ListQuoteRevisionsByProject(r.Context(), projectID)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrQuoteRevisionNotFound):
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "proyecto no encontrado", nil)
		case errors.Is(err, domain.ErrInvalidRevisionSnapshot):
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "snapshot de revisión inválido: payload corrupto", nil)
		default:
			respondWithInternalError(w, err, "list quote revisions")
		}
		return
	}

	dtos := make([]openapi.QuoteRevisionDetail, 0, len(details))
	for _, detail := range details {
		// #642: cost-blind actors see the same commercial truth with the
		// workshop cost stack redacted (sale price is commercial and stays) —
		// identical policy to project payloads.
		if !s.actorCanViewCosts(r) {
			detail.CommercialSnapshot = domain.RedactQuoteCommercialSnapshot(detail.CommercialSnapshot)
		}
		dtos = append(dtos, toQuoteRevisionDetailDTO(detail))
	}
	respondWithJSON(w, http.StatusOK, dtos)
}

func toQuoteRevisionDetailDTO(d domain.QuoteRevisionDetail) openapi.QuoteRevisionDetail {
	items := make([]openapi.QuoteRevisionItem, 0, len(d.Items))
	for _, item := range d.Items {
		var definitionID *string
		if item.FurnitureDefinitionID != "" {
			id := item.FurnitureDefinitionID
			definitionID = &id
		}
		var definitionVersion *int64
		if item.DefinitionVersion != nil {
			version := int64(*item.DefinitionVersion)
			definitionVersion = &version
		}
		parameters := item.Parameters
		if parameters == nil {
			parameters = map[string]any{}
		}
		materialChoices := item.MaterialChoices
		if materialChoices == nil {
			materialChoices = map[string]string{}
		}
		items = append(items, openapi.QuoteRevisionItem{
			FurnitureInstanceId:   item.FurnitureInstanceID,
			FurnitureDefinitionId: definitionID,
			DefinitionVersion:     definitionVersion,
			Parameters:            parameters,
			MaterialChoices:       materialChoices,
			LifecycleStatus:       openapi.FurnitureInstanceLifecycleStatus(item.LifecycleStatus),
		})
	}

	var notes *string
	if d.Notes != "" {
		value := d.Notes
		notes = &value
	}
	var createdBy *string
	if d.CreatedBy != "" {
		created := d.CreatedBy
		createdBy = &created
	}
	var baseRevisionID *string
	if d.BaseQuoteRevisionID != "" {
		base := d.BaseQuoteRevisionID
		baseRevisionID = &base
	}
	var sourceDesignRevisionID *string
	if d.SourceDesignRevisionID != "" {
		source := d.SourceDesignRevisionID
		sourceDesignRevisionID = &source
	}

	var publishedAt, acceptedAt *string
	if d.PublishedAt != nil {
		published := d.PublishedAt.UTC().Format(time.RFC3339Nano)
		publishedAt = &published
	}
	if d.AcceptedAt != nil {
		accepted := d.AcceptedAt.UTC().Format(time.RFC3339Nano)
		acceptedAt = &accepted
	}

	return openapi.QuoteRevisionDetail{
		ID:                     d.ID,
		ProjectId:              d.ProjectID,
		RevisionNumber:         int64(d.RevisionNumber),
		Status:                 openapi.QuoteRevisionStatus(d.Status),
		SourceType:             openapi.QuoteRevisionSourceType(d.SourceType),
		BaseQuoteRevisionId:    baseRevisionID,
		SourceDesignRevisionId: sourceDesignRevisionID,
		Notes:                  notes,
		CreatedBy:              createdBy,
		CreatedAt:              d.CreatedAt.UTC().Format(time.RFC3339Nano),
		PublishedAt:            publishedAt,
		AcceptedAt:             acceptedAt,
		CommercialSnapshot:     toQuoteCommercialSnapshotDTO(d.CommercialSnapshot),
		Items:                  items,
	}
}

// toQuoteCommercialSnapshotDTO maps the frozen commercial payload (#642). A
// NULL snapshot (legacy revision) maps to an absent DTO value — the honest
// fail-closed state, never a recalculated one.
func toQuoteCommercialSnapshotDTO(snapshot *domain.QuoteCommercialSnapshot) *openapi.QuoteCommercialSnapshot {
	if snapshot == nil {
		return nil
	}
	units := make([]openapi.QuoteCommercialUnit, 0, len(snapshot.Units))
	for _, unit := range snapshot.Units {
		options := make([]openapi.QuoteCommercialOption, 0, len(unit.Options))
		for _, option := range unit.Options {
			options = append(options, openapi.QuoteCommercialOption{
				GroupCode:   option.GroupCode,
				GroupLabel:  option.GroupLabel,
				ChoiceId:    option.ChoiceID,
				ChoiceLabel: option.ChoiceLabel,
			})
		}
		units = append(units, openapi.QuoteCommercialUnit{
			FurnitureInstanceId: unit.FurnitureInstanceID,
			QuoteLineId:         unit.QuoteLineID,
			ModuleCode:          unit.ModuleCode,
			ModuleName:          unit.ModuleName,
			LifecycleStatus:     openapi.FurnitureInstanceLifecycleStatus(unit.LifecycleStatus),
			Options:             options,
		})
	}
	lines := make([]openapi.QuoteCommercialLine, 0, len(snapshot.Lines))
	for _, line := range snapshot.Lines {
		lines = append(lines, openapi.QuoteCommercialLine{
			QuoteLineId:          line.QuoteLineID,
			Quantity:             int64(line.Quantity),
			FurnitureInstanceIds: append([]string(nil), line.FurnitureInstanceIDs...),
			Amounts: openapi.QuoteCommercialLineAmounts{
				MaterialsCost: line.Amounts.MaterialsCost,
				EdgeTotal:     line.Amounts.EdgeTotal,
				HardwareTotal: line.Amounts.HardwareTotal,
				DirectCost:    line.Amounts.DirectCost,
				LaborModular:  line.Amounts.LaborModular,
				SalePrice:     line.Amounts.SalePrice,
			},
		})
	}
	return &openapi.QuoteCommercialSnapshot{
		Schema:     snapshot.Schema,
		CapturedAt: snapshot.CapturedAt.UTC().Format(time.RFC3339Nano),
		Currency:   snapshot.Currency,
		Customer: openapi.QuoteCommercialIdentity{
			ID:   snapshot.Customer.ID,
			Name: snapshot.Customer.Name,
		},
		Project: openapi.QuoteCommercialIdentity{
			ID:   snapshot.Project.ID,
			Name: snapshot.Project.Name,
		},
		Breakdown: openapi.QuoteCommercialBreakdown{
			MaterialsCost:  snapshot.Breakdown.MaterialsCost,
			EdgeTotal:      snapshot.Breakdown.EdgeTotal,
			HardwareTotal:  snapshot.Breakdown.HardwareTotal,
			DirectCost:     snapshot.Breakdown.DirectCost,
			LaborModular:   snapshot.Breakdown.LaborModular,
			LaborFixedCost: snapshot.Breakdown.LaborFixedCost,
			MarginFactor:   snapshot.Breakdown.MarginFactor,
			SalePrice:      snapshot.Breakdown.SalePrice,
		},
		Lines: lines,
		Units: units,
	}
}

// HandleProjectCommercialSummaries serves GET /api/projects/commercial-summaries (#642 / 2A).
func (s *Server) HandleProjectCommercialSummaries(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	roles := actorRoles(claims)
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver las cotizaciones") {
		return
	}

	summaries, err := s.Store.ListProjectCommercialSummaries(r.Context())
	if err != nil {
		if errors.Is(err, domain.ErrInvalidRevisionSnapshot) {
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "snapshot de revisión inválido: payload corrupto", nil)
			return
		}
		respondWithInternalError(w, err, "list project commercial summaries")
		return
	}

	// Filter by portfolio owner if caller does not see all owners (F034)
	if !domain.RolesSeesAllOwners(roles) {
		filtered := make([]domain.ProjectCommercialSummary, 0, len(summaries))
		for _, item := range summaries {
			if item.OwnerUserID == claims.UserID {
				filtered = append(filtered, item)
			}
		}
		summaries = filtered
	}

	dtos := make([]openapi.ProjectCommercialSummary, 0, len(summaries))
	for _, item := range summaries {
		dtos = append(dtos, toProjectCommercialSummaryDTO(item))
	}
	respondWithJSON(w, http.StatusOK, dtos)
}

func toProjectCommercialSummaryDTO(s domain.ProjectCommercialSummary) openapi.ProjectCommercialSummary {
	var quoteStatus openapi.ProjectCommercialQuoteStatus
	switch s.QuoteStatus {
	case domain.ProjectCommercialQuoteStatusNone:
		quoteStatus = openapi.ProjectCommercialQuoteStatusNone
	case domain.ProjectCommercialQuoteStatusDraft:
		quoteStatus = openapi.ProjectCommercialQuoteStatusDraft
	case domain.ProjectCommercialQuoteStatusPublished:
		quoteStatus = openapi.ProjectCommercialQuoteStatusPublished
	case domain.ProjectCommercialQuoteStatusAccepted:
		quoteStatus = openapi.ProjectCommercialQuoteStatusAccepted
	case domain.ProjectCommercialQuoteStatusSuperseded:
		quoteStatus = openapi.ProjectCommercialQuoteStatusSuperseded
	default:
		quoteStatus = openapi.ProjectCommercialQuoteStatusNone
	}

	return openapi.ProjectCommercialSummary{
		ProjectId:                 s.ProjectID,
		ProjectName:               s.ProjectName,
		CustomerId:                s.CustomerID,
		CustomerName:              s.CustomerName,
		Currency:                  s.Currency,
		QuoteStatus:               quoteStatus,
		QuoteRevisionId:           s.QuoteRevisionID,
		QuoteRevisionNumber:       s.QuoteRevisionNumber,
		ActiveDraftRevisionNumber: s.ActiveDraftRevisionNumber,
		IsLegacy:                  s.IsLegacy,
		SaleTotal:                 s.SaleTotal,
		FurnitureQuantity:         s.FurnitureQuantity,
		CommercialActivityAt:      s.CommercialActivityAt,
	}
}
