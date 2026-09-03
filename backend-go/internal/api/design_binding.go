package api

import (
	"net/http"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #388 / DT-4: authoritative validation of a SketchUp model binding
// candidate against the Project/Design working context (digital-thread §12).
// Stateless read: the server answers with the exact organization/project/
// design truth so the plugin can write the model binding only after this
// succeeds. Stale and incompatible states are derived client-side by
// comparing the stored binding against the authoritative base returned here.

// ModelBindingSchemaVersion is the server's current binding contract
// version (digital-thread §12 `schemaVersion`). Clients that do not
// understand it must refuse to bind (incompatible state), never guess.
const ModelBindingSchemaVersion = 1

// HandleProjectDesignBindingValidate serves POST for
// /api/projects/{projectId}/designs/{designId}/binding:validate.
func (s *Server) HandleProjectDesignBindingValidate(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	roles := actorRoles(claims)
	projectID := r.PathValue("projectId")
	designID := r.PathValue("designId")
	if !isValidUUID(projectID) || !isValidUUID(designID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		return
	}
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para validar el enlace del diseño") {
		return
	}

	var body openapi.ValidateModelBindingRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	if body.ClientSchemaVersion < 1 {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "client_schema_version inválido", nil)
		return
	}

	// The client's currently bound base, when the model is already bound. A
	// first binding sends no expectation and adopts the authoritative base.
	var clientBaseRevisionID *string
	if body.BaseRevisionID != nil {
		trimmed := strings.TrimSpace(*body.BaseRevisionID)
		if trimmed != "" {
			clientBaseRevisionID = &trimmed
		}
	}

	ctx, err := s.Store.GetModelBindingContext(r.Context(), projectID, designID, clientBaseRevisionID)
	if err != nil {
		switch {
		case err == domain.ErrDesignNotFound:
			// Uniform 404: missing, foreign and cross-project objects are
			// indistinguishable by design (#388 negative proof).
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "El proyecto o el diseño no existe", nil)
		case err == domain.ErrDesignRevisionNotFound:
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "La revisión de diseño no existe", nil)
		default:
			respondWithInternalError(w, err, "validate model binding")
		}
		return
	}

	state := openapi.ModelBindingStateValid
	if ctx.Design.Status == domain.DesignStatusArchived {
		state = openapi.ModelBindingStateDesignArchived
	}

	// Capabilities mirror the exact permission gates of the working-copy and
	// publish handlers — the binding never widens them.
	canEdit := state == openapi.ModelBindingStateValid &&
		domain.AnyRole(roles, domain.RoleCanAccessProjects)
	canPublish := state == openapi.ModelBindingStateValid &&
		domain.AnyRole(roles, domain.RoleCanMutateProjects)

	var baseRevID *string
	var baseRevNum *int64
	if ctx.WorkingCopyBaseRevisionID != nil && *ctx.WorkingCopyBaseRevisionID != "" {
		id := *ctx.WorkingCopyBaseRevisionID
		baseRevID = &id
		if ctx.BaseRevisionNumber != nil {
			num := int64(*ctx.BaseRevisionNumber)
			baseRevNum = &num
		}
	}

	respondWithJSON(w, http.StatusOK, openapi.ModelBindingValidation{
		State:         state,
		SchemaVersion: ModelBindingSchemaVersion,
		Organization: openapi.ModelBindingOrganizationSummary{
			ID:   ctx.OrganizationID,
			Name: ctx.OrganizationName,
		},
		Project: openapi.ModelBindingProjectSummary{
			ID:   ctx.ProjectID,
			Name: ctx.ProjectName,
		},
		Design: openapi.ModelBindingDesignSummary{
			ID:     ctx.Design.ID,
			Name:   ctx.Design.Name,
			Status: openapi.DesignStatus(ctx.Design.Status),
		},
		WorkingCopy: openapi.ModelBindingWorkingCopySummary{
			BaseRevisionID:     baseRevID,
			BaseRevisionNumber: baseRevNum,
			UpdatedAt:          ctx.WorkingCopyUpdatedAt.UTC().Format(time.RFC3339Nano),
		},
		Capabilities: openapi.ModelBindingCapabilities{
			CanEditWorkingCopy: canEdit,
			CanPublishRevision: canPublish,
		},
	})
}
