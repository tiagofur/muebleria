package api

import (
	"net/http"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1651: bulk price updates of the factory catalog. Preview and apply are
// server-computed; the web only reads the supplier file and displays.

func authorizePriceUpdate(w http.ResponseWriter, r *http.Request) (string, bool) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return "", false
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateCatalog), "no tenés permiso para cambiar precios del catálogo") {
		return "", false
	}
	return claims.UserID, true
}

func priceKindOrError(w http.ResponseWriter, kind openapi.PriceResourceKind) (domain.PriceResourceKind, bool) {
	k := domain.PriceResourceKind(kind)
	if !domain.ValidPriceResourceKind(k) {
		respondWithFieldError(w, "kind", "tipo de recurso desconocido")
		return "", false
	}
	return k, true
}

func toPriceIssues(issues []domain.PriceImportIssue) []openapi.PriceImportIssue {
	out := make([]openapi.PriceImportIssue, 0, len(issues))
	for _, i := range issues {
		dto := openapi.PriceImportIssue{Line: int64(i.Line), Message: i.Message}
		if i.Code != "" {
			code := i.Code
			dto.Code = &code
		}
		out = append(out, dto)
	}
	return out
}

func toPricePreviewDTO(kind domain.PriceResourceKind, changed []domain.PriceChange, unchanged []domain.PricedItem, notFound, invalid []domain.PriceImportIssue) openapi.PriceUpdatePreview {
	out := openapi.PriceUpdatePreview{
		Kind:      openapi.PriceResourceKind(kind),
		Changed:   make([]openapi.PriceChangePreview, 0, len(changed)),
		Unchanged: make([]openapi.PriceUnchangedItem, 0, len(unchanged)),
		NotFound:  toPriceIssues(notFound),
		Invalid:   toPriceIssues(invalid),
	}
	for _, c := range changed {
		out.Changed = append(out.Changed, openapi.PriceChangePreview{
			ID: c.Item.ID, Code: c.Item.Code, Name: c.Item.Name,
			CurrentPrice: domain.RoundPrice(c.Item.Price), NewPrice: c.NewPrice, Version: c.Item.Version,
		})
	}
	for _, u := range unchanged {
		out.Unchanged = append(out.Unchanged, openapi.PriceUnchangedItem{ID: u.ID, Code: u.Code, Name: u.Name, Price: domain.RoundPrice(u.Price)})
	}
	return out
}

// HandlePreviewCatalogPriceUpdate serves POST /api/catalog/price-updates/preview.
func (s *Server) HandlePreviewCatalogPriceUpdate(w http.ResponseWriter, r *http.Request) {
	if _, ok := authorizePriceUpdate(w, r); !ok {
		return
	}
	var req openapi.PriceUpdatePreviewRequest
	if !decodeGeneratedJSONBody(w, r, &req) {
		return
	}
	kind, ok := priceKindOrError(w, req.Kind)
	if !ok {
		return
	}
	switch req.Mode {
	case "percent":
		if req.Percent == nil {
			respondWithFieldError(w, "percent", "indicá el porcentaje")
			return
		}
		if err := domain.ValidatePricePercent(*req.Percent); err != nil {
			respondWithFieldError(w, "percent", err.Error())
			return
		}
		filter := storage.PriceItemFilter{}
		if f := req.Filter; f != nil {
			if f.CategoryId != nil {
				filter.CategoryID = strings.TrimSpace(*f.CategoryId)
			}
			if f.Group != nil {
				filter.Group = strings.TrimSpace(*f.Group)
			}
			filter.IncludeInactive = f.IncludeInactive != nil && *f.IncludeInactive
		}
		items, err := s.Store.ListPricedItems(r.Context(), kind, filter)
		if err != nil {
			respondWithInternalError(w, err, "list priced items")
			return
		}
		changed, unchanged := domain.ApplyPricePercent(items, *req.Percent)
		respondWithJSON(w, http.StatusOK, toPricePreviewDTO(kind, changed, unchanged, nil, nil))
	case "import":
		if len(req.Rows) == 0 {
			respondWithFieldError(w, "rows", "el archivo no tiene filas para importar")
			return
		}
		if len(req.Rows) > domain.PriceImportMaxRows {
			respondWithFieldError(w, "rows", "el archivo supera las 5000 filas")
			return
		}
		items, err := s.Store.ListPricedItems(r.Context(), kind, storage.PriceItemFilter{IncludeInactive: true})
		if err != nil {
			respondWithInternalError(w, err, "list priced items")
			return
		}
		rows := make([]domain.PriceImportRow, 0, len(req.Rows))
		for _, row := range req.Rows {
			rows = append(rows, domain.PriceImportRow{Line: int(row.Line), Code: row.Code, Price: row.Price})
		}
		p := domain.ClassifyPriceImport(items, rows)
		respondWithJSON(w, http.StatusOK, toPricePreviewDTO(kind, p.Changed, p.Unchanged, p.NotFound, p.Invalid))
	default:
		respondWithFieldError(w, "mode", "modo desconocido")
	}
}

// HandleApplyCatalogPriceUpdate serves POST /api/catalog/price-updates.
func (s *Server) HandleApplyCatalogPriceUpdate(w http.ResponseWriter, r *http.Request) {
	actor, ok := authorizePriceUpdate(w, r)
	if !ok {
		return
	}
	var req openapi.ApplyPriceUpdateRequest
	if !decodeGeneratedJSONBody(w, r, &req) {
		return
	}
	kind, ok := priceKindOrError(w, req.Kind)
	if !ok {
		return
	}
	if req.Source != "percent" && req.Source != "import" {
		respondWithFieldError(w, "source", "origen desconocido")
		return
	}
	if len(req.Items) == 0 || len(req.Items) > domain.PriceUpdateMaxItems {
		respondWithFieldError(w, "items", "no hay cambios para aplicar")
		return
	}
	note := ""
	if req.Note != nil {
		note = strings.TrimSpace(*req.Note)
		if len([]rune(note)) > domain.PriceNoteMaxLen {
			respondWithFieldError(w, "note", "la nota admite hasta 500 caracteres")
			return
		}
	}
	seen := map[string]bool{}
	items := make([]storage.PriceUpdateItem, 0, len(req.Items))
	for _, it := range req.Items {
		if !isValidUUID(it.ID) || seen[it.ID] || it.ExpectedVersion < 1 || it.NewPrice < 0 || it.NewPrice > domain.PriceMax {
			respondWithFieldError(w, "items", "hay un cambio inválido o repetido")
			return
		}
		seen[it.ID] = true
		items = append(items, storage.PriceUpdateItem{ID: it.ID, ExpectedVersion: it.ExpectedVersion, NewPrice: domain.RoundPrice(it.NewPrice)})
	}
	result, err := s.Store.ApplyPriceUpdate(r.Context(), storage.ApplyPriceUpdateCommand{
		Kind: kind, Source: req.Source, Note: note, Percent: req.Percent, Items: items,
		ActorUserID: actor, IP: clientIP(r), RequestID: RequestIDFromContext(r.Context()),
	})
	if err != nil {
		if stale, ok := storage.IsPriceUpdateStale(err); ok {
			respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict,
				"algunos precios cambiaron desde la vista previa; volvé a previsualizar. No se aplicó ningún cambio",
				map[string]any{"staleIds": stale.IDs})
			return
		}
		respondWithInternalError(w, err, "apply price update")
		return
	}
	respondWithJSON(w, http.StatusOK, openapi.ApplyPriceUpdateResult{
		BatchId: result.BatchID, Applied: int64(result.Applied), AppliedAt: result.AppliedAt.UTC().Format(time.RFC3339Nano),
	})
}

// HandleCatalogPriceHistory serves GET /api/catalog/price-history/{kind}/{resourceId}.
func (s *Server) HandleCatalogPriceHistory(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateCatalog), "no tenés permiso para ver el historial de precios") {
		return
	}
	kind := domain.PriceResourceKind(r.PathValue("kind"))
	resourceID := r.PathValue("resourceId")
	if !domain.ValidPriceResourceKind(kind) || !isValidUUID(resourceID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "recurso inválido", nil)
		return
	}
	entries, err := s.Store.ListPriceHistory(r.Context(), kind, resourceID, 50)
	if err != nil {
		respondWithInternalError(w, err, "price history")
		return
	}
	out := openapi.PriceHistoryResponse{Entries: make([]openapi.PriceHistoryEntry, 0, len(entries))}
	for _, e := range entries {
		dto := openapi.PriceHistoryEntry{
			BatchId: e.BatchID, Code: e.Code, OldPrice: e.OldPrice, NewPrice: e.NewPrice,
			Source: e.Source, ChangedAt: e.ChangedAt.UTC().Format(time.RFC3339Nano),
		}
		if e.Note != "" {
			v := e.Note
			dto.Note = &v
		}
		if e.ChangedBy != "" {
			v := e.ChangedBy
			dto.ChangedBy = &v
		}
		out.Entries = append(out.Entries, dto)
	}
	respondWithJSON(w, http.StatusOK, out)
}

