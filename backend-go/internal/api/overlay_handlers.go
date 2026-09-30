package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #775 [P1][LIB-4]: HTTP Handlers for organization manufacturing library overlays,
// 3-way rebase, and conflict resolution.

func (s *Server) overlayService() *application.OverlayService {
	return application.NewOverlayService(s.Store)
}

// HandleCreateLibraryOverlay handles POST /api/manufacturing-libraries/overlays.
func (s *Server) HandleCreateLibraryOverlay(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	claims := claimsFromRequest(r)
	if claims == nil || claims.OrgID == "" {
		respondWithError(w, http.StatusUnauthorized, "unauthorized: organization context required")
		return
	}
	orgUUID, err := uuid.Parse(claims.OrgID)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid organization id in claims")
		return
	}

	var req openapi.CreateLibraryOverlayRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	baseRelUUID, err := uuid.Parse(req.BaseReleaseId)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid baseReleaseId")
		return
	}

	var overridesRaw json.RawMessage
	if req.Overrides != nil {
		bytes, err := json.Marshal(req.Overrides)
		if err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid overrides format")
			return
		}
		overridesRaw = bytes
	}

	var customResUUIDs []uuid.UUID
	for _, idStr := range req.CustomResourceIds {
		resUUID, err := uuid.Parse(idStr)
		if err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid customResourceId: "+idStr)
			return
		}
		customResUUIDs = append(customResUUIDs, resUUID)
	}

	standardID := uuid.MustParse(domain.GraneteStandardLibraryID)

	created, err := s.overlayService().CreateOverlay(r.Context(), application.CreateOverlayParams{
		OrganizationID:    orgUUID,
		LibraryID:         standardID,
		BaseReleaseID:     baseRelUUID,
		Overrides:         overridesRaw,
		CustomResourceIDs: customResUUIDs,
	})
	if err != nil {
		if errors.Is(err, application.ErrBaseReleaseNotPublished) || errors.Is(err, application.ErrInvalidOverridePath) {
			respondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		if errors.Is(err, storage.ErrLibraryReleaseNotFound) {
			respondWithError(w, http.StatusNotFound, "base release not found")
			return
		}
		respondWithInternalError(w, err, "create library overlay")
		return
	}

	respondWithJSON(w, http.StatusCreated, mapOverlayDetailToOpenAPI(created))
}

// HandleGetActiveLibraryOverlay handles GET /api/manufacturing-libraries/overlays/active.
//
// The absent-overlay case responds 200 with a null detail, NOT 404: the web
// shell fetches this on every page load, and a 404 would emit a browser
// console error on every screen — breaking the console-clean journeys the
// organization browser gate pins (#943 review). "No overlay yet" is a normal
// state, not an error.
func (s *Server) HandleGetActiveLibraryOverlay(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	claims := claimsFromRequest(r)
	if claims == nil || claims.OrgID == "" {
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	orgUUID, err := uuid.Parse(claims.OrgID)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid organization id")
		return
	}

	targetLibID := uuid.MustParse(domain.GraneteStandardLibraryID)
	if qLib := r.URL.Query().Get("libraryId"); qLib != "" {
		parsed, err := uuid.Parse(qLib)
		if err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid libraryId query parameter")
			return
		}
		targetLibID = parsed
	}

	overlay, err := s.overlayService().GetActiveOverlay(r.Context(), orgUUID, targetLibID)
	if err != nil {
		if errors.Is(err, storage.ErrOverlayNotFound) {
			respondWithJSON(w, http.StatusOK, nil)
			return
		}
		respondWithInternalError(w, err, "get active overlay")
		return
	}

	if overlay.OrganizationID != orgUUID {
		// Defense in depth below the ownership check: another organization's
		// overlay is as good as absent for this caller — same null response.
		respondWithJSON(w, http.StatusOK, nil)
		return
	}

	respondWithJSON(w, http.StatusOK, mapOverlayDetailToOpenAPI(overlay))
}

// HandleGetLibraryOverlayByID handles GET /api/manufacturing-libraries/overlays/{id}.
func (s *Server) HandleGetLibraryOverlayByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	claims := claimsFromRequest(r)
	if claims == nil || claims.OrgID == "" {
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	orgUUID, err := uuid.Parse(claims.OrgID)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid organization id")
		return
	}

	rawID := r.PathValue("id")
	overlayUUID, err := uuid.Parse(rawID)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid overlay id")
		return
	}

	overlay, err := s.Store.GetOverlayByID(r.Context(), overlayUUID)
	if err != nil {
		if errors.Is(err, storage.ErrOverlayNotFound) {
			respondWithError(w, http.StatusNotFound, "overlay not found")
			return
		}
		respondWithInternalError(w, err, "get overlay by id")
		return
	}

	// Server authority & tenant boundary: refuse access to other tenants' overlays
	if overlay.OrganizationID != orgUUID {
		respondWithError(w, http.StatusNotFound, "overlay not found")
		return
	}

	respondWithJSON(w, http.StatusOK, mapOverlayDetailToOpenAPI(overlay))
}

// HandleUpdateLibraryOverlay handles PATCH /api/manufacturing-libraries/overlays/{id}.
func (s *Server) HandleUpdateLibraryOverlay(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	claims := claimsFromRequest(r)
	if claims == nil || claims.OrgID == "" {
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	orgUUID, err := uuid.Parse(claims.OrgID)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid organization id")
		return
	}

	rawID := r.PathValue("id")
	overlayUUID, err := uuid.Parse(rawID)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid overlay id")
		return
	}

	var req openapi.UpdateLibraryOverlayRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var overridesRaw json.RawMessage
	if req.Overrides != nil {
		bytes, err := json.Marshal(req.Overrides)
		if err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid overrides format")
			return
		}
		overridesRaw = bytes
	}

	var customResUUIDs []uuid.UUID
	for _, idStr := range req.CustomResourceIds {
		resUUID, err := uuid.Parse(idStr)
		if err != nil {
			respondWithError(w, http.StatusBadRequest, "invalid customResourceId: "+idStr)
			return
		}
		customResUUIDs = append(customResUUIDs, resUUID)
	}

	if err := s.overlayService().UpdateOverrides(r.Context(), overlayUUID, orgUUID, overridesRaw, customResUUIDs); err != nil {
		if errors.Is(err, application.ErrUnauthorizedOverlayAccess) || errors.Is(err, storage.ErrOverlayNotFound) {
			respondWithError(w, http.StatusNotFound, "overlay not found")
			return
		}
		if errors.Is(err, application.ErrInvalidOverridePath) {
			respondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		respondWithInternalError(w, err, "update overlay overrides")
		return
	}

	updated, err := s.Store.GetOverlayByID(r.Context(), overlayUUID)
	if err != nil {
		respondWithInternalError(w, err, "fetch updated overlay")
		return
	}

	respondWithJSON(w, http.StatusOK, mapOverlayDetailToOpenAPI(updated))
}

// HandleRebaseLibraryOverlay handles POST /api/manufacturing-libraries/overlays/{id}/rebase.
func (s *Server) HandleRebaseLibraryOverlay(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	claims := claimsFromRequest(r)
	if claims == nil || claims.OrgID == "" {
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	orgUUID, err := uuid.Parse(claims.OrgID)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid organization id")
		return
	}

	rawID := r.PathValue("id")
	overlayUUID, err := uuid.Parse(rawID)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid overlay id")
		return
	}

	var req openapi.RebaseLibraryOverlayRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	targetRelUUID, err := uuid.Parse(req.TargetReleaseId)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid targetReleaseId")
		return
	}

	res, err := s.overlayService().ExecuteRebase(r.Context(), overlayUUID, orgUUID, targetRelUUID)
	if err != nil {
		if errors.Is(err, application.ErrUnauthorizedOverlayAccess) || errors.Is(err, storage.ErrOverlayNotFound) {
			respondWithError(w, http.StatusNotFound, "overlay not found")
			return
		}
		if errors.Is(err, application.ErrBaseReleaseNotPublished) {
			respondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		if errors.Is(err, storage.ErrLibraryReleaseNotFound) {
			respondWithError(w, http.StatusNotFound, "target release not found")
			return
		}
		respondWithInternalError(w, err, "rebase library overlay")
		return
	}

	var conflictsDTO []openapi.LibraryOverlayConflictDetail
	for _, c := range res.Conflicts {
		conflictsDTO = append(conflictsDTO, mapOverlayConflictToOpenAPI(&c))
	}

	dto := openapi.LibraryOverlayRebaseResult{
		OverlayId:        res.OverlayID.String(),
		OldBaseReleaseId: res.OldBaseReleaseID.String(),
		NewBaseReleaseId: res.NewBaseReleaseID.String(),
		HasConflicts:     res.HasConflicts,
		Status:           res.Status,
		Conflicts:        conflictsDTO,
	}

	respondWithJSON(w, http.StatusOK, dto)
}

// HandleListLibraryOverlayConflicts handles GET /api/manufacturing-libraries/overlays/{id}/conflicts.
func (s *Server) HandleListLibraryOverlayConflicts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	claims := claimsFromRequest(r)
	if claims == nil || claims.OrgID == "" {
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	orgUUID, err := uuid.Parse(claims.OrgID)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid organization id")
		return
	}

	rawID := r.PathValue("id")
	overlayUUID, err := uuid.Parse(rawID)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid overlay id")
		return
	}

	overlay, err := s.Store.GetOverlayByID(r.Context(), overlayUUID)
	if err != nil {
		if errors.Is(err, storage.ErrOverlayNotFound) {
			respondWithError(w, http.StatusNotFound, "overlay not found")
			return
		}
		respondWithInternalError(w, err, "get overlay")
		return
	}
	if overlay.OrganizationID != orgUUID {
		respondWithError(w, http.StatusNotFound, "overlay not found")
		return
	}

	statusFilter := r.URL.Query().Get("status")

	conflicts, err := s.Store.ListOverlayConflicts(r.Context(), overlayUUID, statusFilter)
	if err != nil {
		respondWithInternalError(w, err, "list overlay conflicts")
		return
	}

	conflictsDTO := make([]openapi.LibraryOverlayConflictDetail, 0, len(conflicts))
	for _, c := range conflicts {
		conflictsDTO = append(conflictsDTO, mapOverlayConflictToOpenAPI(&c))
	}

	respondWithJSON(w, http.StatusOK, conflictsDTO)
}

// HandleResolveLibraryOverlayConflict handles POST /api/manufacturing-libraries/overlays/{id}/conflicts/{conflictId}/resolve.
func (s *Server) HandleResolveLibraryOverlayConflict(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	claims := claimsFromRequest(r)
	if claims == nil || claims.OrgID == "" {
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	orgUUID, err := uuid.Parse(claims.OrgID)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid organization id")
		return
	}

	var userUUID *uuid.UUID
	if claims.Subject != "" {
		if parsed, err := uuid.Parse(claims.Subject); err == nil {
			userUUID = &parsed
		}
	}

	overlayUUID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid overlay id")
		return
	}

	conflictUUID, err := uuid.Parse(r.PathValue("conflictId"))
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid conflict id")
		return
	}

	var req openapi.ResolveLibraryOverlayConflictRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	action := domain.ResolutionAction(req.Action)
	var customVal any
	if req.CustomValue != nil {
		customVal = *req.CustomValue
	}

	resolved, err := s.overlayService().ResolveConflict(r.Context(), application.ResolveConflictParams{
		OverlayID:   overlayUUID,
		ConflictID:  conflictUUID,
		OrgID:       orgUUID,
		Action:      action,
		CustomValue: customVal,
		ResolvedBy:  userUUID,
	})
	if err != nil {
		if errors.Is(err, application.ErrUnauthorizedOverlayAccess) || errors.Is(err, storage.ErrOverlayConflictNotFound) {
			respondWithError(w, http.StatusNotFound, "conflict not found")
			return
		}
		if errors.Is(err, storage.ErrOverlayConflictAlreadyResolved) {
			respondWithError(w, http.StatusBadRequest, "conflict is already resolved")
			return
		}
		if errors.Is(err, domain.ErrInvalidResolutionAction) || errors.Is(err, domain.ErrCustomValueRequired) {
			respondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		respondWithInternalError(w, err, "resolve overlay conflict")
		return
	}

	respondWithJSON(w, http.StatusOK, mapOverlayConflictToOpenAPI(resolved))
}

// ─── Mapping Helpers ─────────────────────────────────────────────────────────

func mapOverlayDetailToOpenAPI(o *domain.LibraryOverlay) openapi.LibraryOverlayDetail {
	overridesMap := make(map[string]any)
	if len(o.Overrides) > 0 && string(o.Overrides) != "{}" {
		_ = json.Unmarshal(o.Overrides, &overridesMap)
	}

	var customResStrings []string
	for _, id := range o.CustomResourceIDs {
		customResStrings = append(customResStrings, id.String())
	}
	if customResStrings == nil {
		customResStrings = make([]string, 0)
	}

	return openapi.LibraryOverlayDetail{
		ID:                o.ID.String(),
		OrganizationId:    o.OrganizationID.String(),
		LibraryId:         o.LibraryID.String(),
		BaseReleaseId:     o.BaseReleaseID.String(),
		Status:            o.Status,
		Overrides:         overridesMap,
		CustomResourceIds: customResStrings,
		CreatedAt:         o.CreatedAt.Format(time.RFC3339),
		UpdatedAt:         o.UpdatedAt.Format(time.RFC3339),
	}
}

func mapOverlayConflictToOpenAPI(c *domain.LibraryOverlayConflict) openapi.LibraryOverlayConflictDetail {
	dto := openapi.LibraryOverlayConflictDetail{
		ID:               c.ID.String(),
		OverlayId:        c.OverlayID.String(),
		OrganizationId:   c.OrganizationID.String(),
		OldBaseReleaseId: c.OldBaseReleaseID.String(),
		NewBaseReleaseId: c.NewBaseReleaseID.String(),
		ConflictType:     string(c.ConflictType),
		Path:             c.Path,
		OldBaseValue:     &c.OldBaseValue,
		NewBaseValue:     &c.NewBaseValue,
		CustomValue:      &c.CustomValue,
		Status:           c.Status,
		ResolvedValue:    &c.ResolvedValue,
		CreatedAt:        c.CreatedAt.Format(time.RFC3339),
	}
	if c.ResolutionAction != nil {
		actionStr := string(*c.ResolutionAction)
		dto.ResolutionAction = &actionStr
	}
	if c.ResolvedBy != nil {
		byStr := c.ResolvedBy.String()
		dto.ResolvedBy = &byStr
	}
	if c.ResolvedAt != nil {
		tStr := c.ResolvedAt.Format(time.RFC3339)
		dto.ResolvedAt = &tStr
	}
	return dto
}
