package api

// Project grip API (#1532, ADR-0009 Amendment 1 A2.3/A5/A7): read and change
// the project's grip style, set/clear one or several furniture overrides in
// one operation, and the explicit «Actualizar a los valores actuales del
// taller». Every write takes the project's grip_version with If-Match and is
// audited in the same transaction. The GET also reports the A3 layout per
// furniture (the per-front measures the owner asked for): the stack rows the
// engine resolved plus the applied discounts of the frozen copy.

import (
	"errors"
	"net/http"
	"strings"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// projectGripPayload is the grip state the GET and PUT return.
type projectGripPayload struct {
	ProjectID   string                       `json:"projectId"`
	GripStyleID *string                      `json:"gripStyleId"`
	Snapshot    *domain.GripSnapshot         `json:"snapshot"`
	GripVersion int64                        `json:"gripVersion"`
	Overrides   []projectGripOverridePayload `json:"overrides"`
	Report      *projectGripReportPayload    `json:"report,omitempty"`
}

type projectGripOverridePayload struct {
	FurnitureInstanceID string               `json:"furnitureInstanceId"`
	Snapshot            *domain.GripSnapshot `json:"snapshot"`
}

type projectGripReportPayload struct {
	Items []projectGripReportItem `json:"items"`
}

type projectGripReportItem struct {
	FurnitureInstanceID string                       `json:"furnitureInstanceId"`
	FurnitureType       string                       `json:"furnitureType"`
	Source              string                       `json:"source"` // project | override
	RecipeMode          string                       `json:"recipeMode"`
	Applied             *engine.OpeningEdgeGrips     `json:"applied,omitempty"`
	Layout              *projectGripReportItemLayout `json:"layout,omitempty"`
}

type projectGripReportItemLayout struct {
	State        string                               `json:"state"` // resolved | blocked | unknown_dims
	Reason       string                               `json:"reason,omitempty"`
	TopEdgeMm    *float64                             `json:"topEdgeMm,omitempty"`
	BottomEdgeMm *float64                             `json:"bottomEdgeMm,omitempty"`
	Rows         []engine.OpeningEdgeStackResolvedRow `json:"rows,omitempty"`
	RemainderRow string                               `json:"remainderRowId,omitempty"`
}

func gripStringPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

// HandleProjectGrip serves GET and PUT /api/projects/{projectId}/grip.
func (s *Server) HandleProjectGrip(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	roles := actorRoles(claims)
	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId inválido", nil)
		return
	}

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tienes permiso para ver el agarre del proyecto") {
			return
		}
		grip, err := s.Store.GetProjectGrip(r.Context(), projectID)
		if err != nil {
			if errors.Is(err, storage.ErrProjectGripNotFound) {
				respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "el proyecto no existe", nil)
				return
			}
			respondWithInternalError(w, err, "get project grip")
			return
		}
		payload := projectGripPayloadFromStorage(grip)
		payload.Report = s.projectGripReport(r, projectID, grip)
		respondWithJSON(w, http.StatusOK, payload)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateProjects), "no tienes permiso para cambiar el agarre del proyecto") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		var body struct {
			GripStyleID string `json:"gripStyleId"`
		}
		if !decodeJSONBody(w, r, &body) {
			return
		}
		styleID := strings.TrimSpace(body.GripStyleID)
		if styleID == "" || !isValidUUID(styleID) {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "gripStyleId inválido", nil)
			return
		}
		grip, err := s.Store.SetProjectGrip(r.Context(), projectID, styleID, expectedVersion, storage.ProjectGripWriteMeta{
			RequestID: RequestIDFromContext(r.Context()), IP: clientIP(r),
		})
		if err != nil {
			s.respondProjectGripError(w, err, "set project grip")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(grip.Version))
		respondWithJSON(w, http.StatusOK, projectGripPayloadFromStorage(grip))

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// HandleProjectFurnitureGrip serves PUT /api/projects/{projectId}/grip/furniture:
// set or clear one or several furniture overrides in ONE operation.
func (s *Server) HandleProjectFurnitureGrip(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	roles := actorRoles(claims)
	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId inválido", nil)
		return
	}
	if r.Method != http.MethodPut {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateProjects), "no tienes permiso para cambiar la excepción de agarre de los muebles") {
		return
	}
	expectedVersion, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	var body struct {
		Overrides []struct {
			FurnitureInstanceID string  `json:"furnitureInstanceId"`
			GripStyleID         *string `json:"gripStyleId"`
		} `json:"overrides"`
	}
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if len(body.Overrides) == 0 {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "overrides es obligatorio y no puede estar vacío", nil)
		return
	}
	commands := make([]storage.FurnitureGripOverrideCommand, 0, len(body.Overrides))
	for _, entry := range body.Overrides {
		instanceID := strings.TrimSpace(entry.FurnitureInstanceID)
		if instanceID == "" || !isValidUUID(instanceID) {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "furnitureInstanceId inválido en una de las entradas", nil)
			return
		}
		command := storage.FurnitureGripOverrideCommand{FurnitureInstanceID: instanceID}
		if entry.GripStyleID != nil {
			styleID := strings.TrimSpace(*entry.GripStyleID)
			if styleID != "" && !isValidUUID(styleID) {
				respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "gripStyleId inválido en una de las entradas", nil)
				return
			}
			if styleID != "" {
				command.StyleID = &styleID
			}
		}
		commands = append(commands, command)
	}
	if err := s.Store.SetFurnitureGripOverrides(r.Context(), projectID, commands, expectedVersion, storage.ProjectGripWriteMeta{
		RequestID: RequestIDFromContext(r.Context()), IP: clientIP(r),
	}); err != nil {
		s.respondProjectGripError(w, err, "set furniture grip overrides")
		return
	}
	grip, err := s.Store.GetProjectGrip(r.Context(), projectID)
	if err != nil {
		respondWithInternalError(w, err, "get project grip after overrides")
		return
	}
	w.Header().Set("ETag", FormatVersionETag(grip.Version))
	respondWithJSON(w, http.StatusOK, projectGripPayloadFromStorage(grip))
}

// HandleProjectGripRefresh serves POST /api/projects/{projectId}/grip:refresh —
// the explicit «Actualizar a los valores actuales del taller» (A7): never
// automatic, always audited.
func (s *Server) HandleProjectGripRefresh(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	roles := actorRoles(claims)
	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId inválido", nil)
		return
	}
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateProjects), "no tienes permiso para actualizar el agarre del proyecto") {
		return
	}
	expectedVersion, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	var body struct {
		IncludeOverrides bool `json:"includeOverrides"`
	}
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if err := s.Store.RefreshProjectGrip(r.Context(), projectID, body.IncludeOverrides, expectedVersion, storage.ProjectGripWriteMeta{
		RequestID: RequestIDFromContext(r.Context()), IP: clientIP(r),
	}); err != nil {
		s.respondProjectGripError(w, err, "refresh project grip")
		return
	}
	grip, err := s.Store.GetProjectGrip(r.Context(), projectID)
	if err != nil {
		respondWithInternalError(w, err, "get project grip after refresh")
		return
	}
	w.Header().Set("ETag", FormatVersionETag(grip.Version))
	respondWithJSON(w, http.StatusOK, projectGripPayloadFromStorage(grip))
}

// respondProjectGripError maps the grip storage errors onto the API surface.
func (s *Server) respondProjectGripError(w http.ResponseWriter, err error, op string) {
	var invalid *domain.GripSnapshotValidationError
	if errors.As(err, &invalid) {
		respondWithAPIError(w, http.StatusUnprocessableEntity, openapi.ApiErrorCodeConflict, invalid.Message, nil)
		return
	}
	if errors.Is(err, storage.ErrVersionConflict) {
		respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict,
			"la versión del agarre del proyecto cambió; vuelve a leerla y reintenta con el If-Match vigente", nil)
		return
	}
	if errors.Is(err, storage.ErrProjectGripNotFound) {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "el proyecto no existe", nil)
		return
	}
	respondWithInternalError(w, err, op)
}

func projectGripPayloadFromStorage(grip *storage.ProjectGrip) projectGripPayload {
	payload := projectGripPayload{
		ProjectID:   grip.ProjectID,
		GripStyleID: gripStringPtr(grip.StyleID),
		Snapshot:    grip.Snapshot,
		GripVersion: grip.Version,
		Overrides:   make([]projectGripOverridePayload, 0, len(grip.Overrides)),
	}
	for _, override := range grip.Overrides {
		payload.Overrides = append(payload.Overrides, projectGripOverridePayload{
			FurnitureInstanceID: override.FurnitureInstanceID,
			Snapshot:            override.Snapshot,
		})
	}
	return payload
}

// projectGripReport resolves the A3 stack of every furniture with known
// dimensions: the per-front measures (rows) plus the applied discounts of
// the effective frozen recipe. A furniture without dimensions or a recipe
// the engine cannot resolve reports its honest state — the report never
// fails the whole GET.
func (s *Server) projectGripReport(r *http.Request, projectID string, grip *storage.ProjectGrip) *projectGripReportPayload {
	summaries, err := s.Store.ListFurnitureInstanceSummariesByProject(r.Context(), projectID, false)
	if err != nil {
		return nil
	}
	catalog, err := s.Store.GetFullCatalog(r.Context())
	if err != nil {
		return nil
	}
	report := &projectGripReportPayload{Items: make([]projectGripReportItem, 0, len(summaries))}
	for _, summary := range summaries {
		instance := summary.Instance
		snapshot := domain.EffectiveGripSnapshot(grip.OverrideFor(instance.ID), grip.Snapshot)
		if snapshot == nil {
			continue
		}
		if err := domain.ValidateGripSnapshotShape(snapshot); err != nil {
			continue
		}
		ftype := "inferior"
		if module := catalogModuleByID(catalog, instance.FurnitureDefinitionID); module != nil && module.FurnitureType != "" {
			ftype = module.FurnitureType
		}
		recipe, recipeErr := snapshot.GripRecipeFor(ftype)
		if recipeErr != nil || recipe == nil {
			continue
		}
		item := projectGripReportItem{
			FurnitureInstanceID: instance.ID,
			FurnitureType:       ftype,
			RecipeMode:          recipe.Mode,
		}
		if grip.OverrideFor(instance.ID) != nil {
			item.Source = "override"
		} else {
			item.Source = "project"
		}
		grips, gripsErr := engine.ProjectGripEdgeGrips(recipe)
		if gripsErr != nil {
			item.Layout = &projectGripReportItemLayout{State: "blocked", Reason: gripsErr.Message}
			report.Items = append(report.Items, item)
			continue
		}
		if grips.TopDiscountMm != nil || grips.BetweenDiscountMm != nil || grips.BottomOverhangMm != nil {
			item.Applied = &grips
		}
		if summary.DisplayDims == nil {
			item.Layout = &projectGripReportItemLayout{State: "unknown_dims"}
			report.Items = append(report.Items, item)
			continue
		}
		module := catalogModuleByID(catalog, instance.FurnitureDefinitionID)
		if module == nil {
			item.Layout = &projectGripReportItemLayout{State: "unknown_dims"}
			report.Items = append(report.Items, item)
			continue
		}
		resolution, stackErr := engine.OpeningFrontStackReport(*module, catalog, engine.LayoutDims{
			WidthMm: summary.DisplayDims.WidthMm, HeightMm: summary.DisplayDims.HeightMm, DepthMm: summary.DisplayDims.DepthMm,
		}, summary.DisplayMaterialChoices, grips)
		layout := &projectGripReportItemLayout{}
		if stackErr != nil {
			layout.State = "blocked"
			layout.Reason = stackErr.Error()
		} else if resolution == nil {
			layout.State = "resolved"
			layout.Rows = []engine.OpeningEdgeStackResolvedRow{}
		} else {
			layout.State = "resolved"
			topEdge := resolution.TopEdgeMm
			bottomEdge := resolution.BottomEdgeMm
			layout.TopEdgeMm = &topEdge
			layout.BottomEdgeMm = &bottomEdge
			layout.Rows = resolution.Rows
			layout.RemainderRow = resolution.RemainderRow
		}
		item.Layout = layout
		report.Items = append(report.Items, item)
	}
	return report
}

// catalogModuleByID finds one catalog module (nil = unknown).
func catalogModuleByID(catalog domain.Catalog, definitionID string) *domain.Module {
	if definitionID == "" {
		return nil
	}
	for i := range catalog.Modules {
		if catalog.Modules[i].ID == definitionID {
			return &catalog.Modules[i]
		}
	}
	return nil
}
