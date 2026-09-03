package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #385 / DT-1: project-owned furniture identity API (ADR-0003). The endpoints
// are deliberately minimal — create/list plus the terminal removal command.
// Provenance (origin) is server-authoritative: the public create endpoint
// records origin='manual' for web/standard callers, and origin='design'
// when invoked by an authoring client (SketchUp extension, #390 / DT-6);
// quote/duplicate origins arrive with their owning server flows (#386/#388),
// never from a client payload.

// furnitureInstanceCommandRouter adapts the command-oriented OpenAPI path
// /api/furniture-instances/{instanceId}:{command} to net/http's ServeMux
// (same pattern as membershipCommandRouter).
func furnitureInstanceCommandRouter(commands map[string]http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		segment := r.PathValue("instanceCommand")
		instanceID, command, ok := strings.Cut(segment, ":")
		if !ok || instanceID == "" || command == "" || strings.Contains(command, ":") {
			http.NotFound(w, r)
			return
		}
		handler, ok := commands[command]
		if !ok {
			http.NotFound(w, r)
			return
		}
		r.SetPathValue("instanceId", instanceID)
		handler.ServeHTTP(w, r)
	})
}

func toFurnitureInstanceDTO(instance domain.FurnitureInstance) openapi.FurnitureInstance {
	dto := openapi.FurnitureInstance{
		ID:              instance.ID,
		ProjectID:       instance.ProjectID,
		Origin:          openapi.FurnitureInstanceOrigin(instance.Origin),
		LifecycleStatus: openapi.FurnitureInstanceLifecycleStatus(instance.LifecycleStatus),
		Version:         instance.Version,
		CreatedAt:       instance.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt:       instance.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
	if instance.FurnitureDefinitionID != "" {
		dto.FurnitureDefinitionID = &instance.FurnitureDefinitionID
	}
	if instance.OriginFurnitureInstanceID != "" {
		dto.OriginFurnitureInstanceID = &instance.OriginFurnitureInstanceID
	}
	return dto
}

// toFurnitureInstanceSummaryDTO composes the list DTO with the server-computed
// presentation block (#389 / DT-5): catalog label + quoted-or-default
// dimensions. Presentation only — the identity fields come verbatim from the
// FurnitureInstance row.
func toFurnitureInstanceSummaryDTO(summary storage.FurnitureInstanceSummary) openapi.FurnitureInstance {
	dto := toFurnitureInstanceDTO(summary.Instance)
	if summary.DisplayName == "" && summary.DisplayDims == nil {
		return dto
	}
	display := openapi.FurnitureInstanceDisplay{}
	if summary.DisplayName != "" {
		name := summary.DisplayName
		display.Name = &name
	}
	if summary.DisplayDims != nil {
		dims := openapi.FurnitureInstanceDimensionsMm{}
		if summary.DisplayDims.WidthMm > 0 {
			w := int64(summary.DisplayDims.WidthMm)
			dims.Width = &w
		}
		if summary.DisplayDims.HeightMm > 0 {
			h := int64(summary.DisplayDims.HeightMm)
			dims.Height = &h
		}
		if summary.DisplayDims.DepthMm > 0 {
			d := int64(summary.DisplayDims.DepthMm)
			dims.Depth = &d
		}
		display.DimensionsMm = &dims
	}
	dto.Display = &display
	return dto
}

func respondWithFurnitureInstanceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storage.ErrFurnitureInstanceNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "El mueble del proyecto no existe", nil)
	case errors.Is(err, storage.ErrFurnitureDefinitionNotFound):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "La definición de mueble no existe en tu catálogo", nil)
	case errors.Is(err, domain.ErrFurnitureInstanceProjectNotWritable):
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeForbidden, "Sólo la organización dueña de la obra puede administrar sus muebles", nil)
	case errors.Is(err, domain.ErrInvalidFurnitureInstanceCommand):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "El comando de mueble es inválido", nil)
	case errors.Is(err, storage.ErrVersionConflict):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeVersionConflict, "El mueble cambió; actualizá e intentá de nuevo", nil)
	case errors.Is(err, domain.ErrFurnitureInstanceLifecycleConflict):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "El mueble ya fue eliminado y su identidad no se reutiliza", nil)
	default:
		respondWithInternalError(w, err, "furniture instance command")
	}
}

// HandleProjectFurnitureInstances serves GET (list) and POST (create) for
// /api/projects/{projectId}/furniture-instances.
func (s *Server) HandleProjectFurnitureInstances(w http.ResponseWriter, r *http.Request) {
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
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver los muebles del proyecto") {
			return
		}
		// #389 / DT-5: the list carries the presentation summary so the
		// SketchUp Project Furniture panel renders server-computed labels and
		// dimensions — the plugin never guesses dimensions client-side.
		summaries, err := s.Store.ListFurnitureInstanceSummariesByProject(r.Context(), projectID, true)
		if err != nil {
			respondWithInternalError(w, err, "list furniture instances")
			return
		}
		dtos := make([]openapi.FurnitureInstance, 0, len(summaries))
		for _, summary := range summaries {
			dtos = append(dtos, toFurnitureInstanceSummaryDTO(summary))
		}
		respondWithJSON(w, http.StatusOK, dtos)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateProjects), "no tenés permiso para crear muebles del proyecto") {
			return
		}
		var body openapi.CreateFurnitureInstanceRequest
		if !decodeGeneratedJSONBody(w, r, &body) {
			return
		}
		definitionID := ""
		if body.FurnitureDefinitionID != nil {
			definitionID = strings.TrimSpace(*body.FurnitureDefinitionID)
		}
		if definitionID != "" && !isValidUUID(definitionID) {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "furniture_definition_id inválido", nil)
			return
		}
		origin := domain.FurnitureInstanceOriginManual
		if claims.Client == auth.ExtensionClient {
			origin = domain.FurnitureInstanceOriginDesign
		}
		instance, err := s.Store.CreateFurnitureInstance(r.Context(), storage.CreateFurnitureInstanceCommand{
			ProjectID:             projectID,
			FurnitureDefinitionID: definitionID,
			Origin:                origin,
			ActorUserID:           claims.UserID,
			IP:                    clientIP(r),
			RequestID:             RequestIDFromContext(r.Context()),
		})
		if err != nil {
			respondWithFurnitureInstanceError(w, err)
			return
		}
		w.Header().Set("ETag", FormatVersionETag(instance.Version))
		respondWithJSON(w, http.StatusCreated, toFurnitureInstanceDTO(*instance))

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// HandleFurnitureInstanceRemove serves POST
// /api/furniture-instances/{instanceId}:remove — the terminal lifecycle
// command under optimistic concurrency.
func (s *Server) HandleFurnitureInstanceRemove(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateProjects), "no tenés permiso para eliminar muebles del proyecto") {
		return
	}
	expectedVersion, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	instanceID := r.PathValue("instanceId")
	if !isValidUUID(instanceID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "instanceId inválido", nil)
		return
	}
	instance, err := s.Store.RemoveFurnitureInstance(r.Context(), storage.RemoveFurnitureInstanceCommand{
		FurnitureInstanceID: instanceID,
		ExpectedVersion:     expectedVersion,
		ActorUserID:         claims.UserID,
		IP:                  clientIP(r),
		RequestID:           RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithFurnitureInstanceError(w, err)
		return
	}
	w.Header().Set("ETag", FormatVersionETag(instance.Version))
	respondWithJSON(w, http.StatusOK, toFurnitureInstanceDTO(*instance))
}
