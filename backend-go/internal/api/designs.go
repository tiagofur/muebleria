package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #387 / DT-3: Design aggregate and immutable DesignRevision snapshots API (ADR-0003).

func toDesignDTO(d domain.Design) openapi.Design {
	dto := openapi.Design{
		ID:        d.ID,
		ProjectID: d.ProjectID,
		Name:      d.Name,
		Status:    openapi.DesignStatus(d.Status),
		CreatedAt: d.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt: d.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
	if d.SourceQuoteRevisionID != "" {
		dto.SourceQuoteRevisionID = &d.SourceQuoteRevisionID
	}
	if d.CreatedBy != "" {
		dto.CreatedBy = &d.CreatedBy
	}
	return dto
}

func toDesignRevisionItemDTO(item domain.DesignRevisionItem) openapi.DesignRevisionItem {
	dto := openapi.DesignRevisionItem{
		ID:                  item.ID,
		DesignRevisionID:    item.DesignRevisionID,
		FurnitureInstanceID: item.FurnitureInstanceID,
		Parameters:          item.Parameters,
		MaterialChoices:     item.MaterialChoices,
		CreatedAt:           item.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	if item.Parameters == nil {
		dto.Parameters = map[string]any{}
	}
	if item.MaterialChoices == nil {
		dto.MaterialChoices = map[string]string{}
	}
	if item.FurnitureDefinitionID != "" {
		dto.FurnitureDefinitionID = &item.FurnitureDefinitionID
	}
	if item.DefinitionVersion != nil {
		v := int64(*item.DefinitionVersion)
		dto.DefinitionVersion = &v
	}
	if item.Transform != nil {
		dto.Transform = &openapi.Transform3D{
			TranslationMm: item.Transform.TranslationMm[:],
			RotationDeg:   item.Transform.RotationDeg[:],
		}
	}
	if item.RoomID != "" {
		dto.RoomID = &item.RoomID
	}
	if item.TechnicalClientLocator != nil {
		dto.TechnicalClientLocator = &openapi.TechnicalClientLocator{
			Kind:  item.TechnicalClientLocator.Kind,
			Value: item.TechnicalClientLocator.Value,
		}
	}
	return dto
}

func toDesignRevisionDTO(rev domain.DesignRevision) openapi.DesignRevision {
	dto := openapi.DesignRevision{
		ID:             rev.ID,
		DesignID:       rev.DesignID,
		RevisionNumber: int64(rev.RevisionNumber),
		SourceType:     openapi.DesignRevisionSourceType(rev.SourceType),
		Status:         openapi.DesignRevisionStatus(rev.Status),
		CreatedAt:      rev.CreatedAt.UTC().Format(time.RFC3339Nano),
		Items:          make([]openapi.DesignRevisionItem, 0, len(rev.Items)),
	}
	if rev.ParentRevisionID != "" {
		dto.ParentRevisionID = &rev.ParentRevisionID
	}
	if rev.CreatedBy != "" {
		dto.CreatedBy = &rev.CreatedBy
	}
	for _, item := range rev.Items {
		dto.Items = append(dto.Items, toDesignRevisionItemDTO(item))
	}
	return dto
}

func toDesignWorkingCopyItemDTO(item domain.DesignWorkingItem) openapi.DesignWorkingCopyItem {
	dto := openapi.DesignWorkingCopyItem{
		ID:                  item.ID,
		DesignID:            item.DesignID,
		FurnitureInstanceID: item.FurnitureInstanceID,
		Parameters:          item.Parameters,
		MaterialChoices:     item.MaterialChoices,
		CreatedAt:           item.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt:           item.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
	if item.Parameters == nil {
		dto.Parameters = map[string]any{}
	}
	if item.MaterialChoices == nil {
		dto.MaterialChoices = map[string]string{}
	}
	if item.FurnitureDefinitionID != "" {
		dto.FurnitureDefinitionID = &item.FurnitureDefinitionID
	}
	if item.DefinitionVersion != nil {
		v := int64(*item.DefinitionVersion)
		dto.DefinitionVersion = &v
	}
	if item.Transform != nil {
		dto.Transform = &openapi.Transform3D{
			TranslationMm: item.Transform.TranslationMm[:],
			RotationDeg:   item.Transform.RotationDeg[:],
		}
	}
	if item.RoomID != "" {
		dto.RoomID = &item.RoomID
	}
	if item.TechnicalClientLocator != nil {
		dto.TechnicalClientLocator = &openapi.TechnicalClientLocator{
			Kind:  item.TechnicalClientLocator.Kind,
			Value: item.TechnicalClientLocator.Value,
		}
	}
	return dto
}

func toDesignWorkingCopyDTO(wc domain.DesignWorkingCopy) openapi.DesignWorkingCopy {
	dto := openapi.DesignWorkingCopy{
		DesignID:   wc.DesignID,
		ProjectID:  wc.ProjectID,
		SourceType: openapi.DesignRevisionSourceType(wc.SourceType),
		UpdatedAt:  wc.UpdatedAt.UTC().Format(time.RFC3339Nano),
		Items:      make([]openapi.DesignWorkingCopyItem, 0, len(wc.Items)),
	}
	if wc.BaseRevisionID != nil && *wc.BaseRevisionID != "" {
		dto.BaseRevisionID = wc.BaseRevisionID
	}
	if wc.UpdatedBy != "" {
		dto.UpdatedBy = &wc.UpdatedBy
	}
	for _, item := range wc.Items {
		dto.Items = append(dto.Items, toDesignWorkingCopyItemDTO(item))
	}
	return dto
}

func respondWithDesignError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrDesignNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "El diseño no existe", nil)
	case errors.Is(err, domain.ErrDesignRevisionNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "La revisión de diseño no existe", nil)
	case errors.Is(err, domain.ErrDesignNotActive):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "El diseño no está activo", nil)
	case errors.Is(err, domain.ErrDesignRevisionConflict):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, err.Error(), nil)
	case errors.Is(err, domain.ErrInvalidParentRevision):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "La revisión padre es inválida o no pertenece a este diseño", nil)
	case errors.Is(err, domain.ErrDuplicateFurnitureInstanceInRevision):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "Una unidad física (FurnitureInstance) no puede aparecer más de una vez en la misma revisión", nil)
	case errors.Is(err, domain.ErrCrossProjectFurnitureInstance):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "Todos los muebles de la revisión deben pertenecer al mismo proyecto", nil)
	case errors.Is(err, domain.ErrFurnitureInstanceLifecycleConflict):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "El mueble referenciado ya no está activo en el proyecto", nil)
	case errors.Is(err, storage.ErrFurnitureInstanceNotFound):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "Mueble referenciado no encontrado", nil)
	case errors.Is(err, domain.ErrWorkingCopyNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "El borrador de trabajo no existe", nil)
	case errors.Is(err, domain.ErrSerializationFailed):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "Error de serialización del diseño", nil)
	case errors.Is(err, domain.ErrFurnitureInstanceProjectNotWritable):
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeForbidden, "No tenés permiso para modificar el diseño de este proyecto", nil)
	default:
		respondWithInternalError(w, err, "design operation")
	}
}

// HandleProjectDesigns serves GET (list) and POST (create) for /api/projects/{projectId}/designs.
func (s *Server) HandleProjectDesigns(w http.ResponseWriter, r *http.Request) {
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
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver los diseños del proyecto") {
			return
		}
		designs, err := s.Store.ListDesignsByProject(r.Context(), projectID)
		if err != nil {
			respondWithInternalError(w, err, "list designs")
			return
		}
		dtos := make([]openapi.Design, 0, len(designs))
		for _, design := range designs {
			dtos = append(dtos, toDesignDTO(design))
		}
		respondWithJSON(w, http.StatusOK, dtos)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateProjects), "no tenés permiso para crear diseños en el proyecto") {
			return
		}
		var body openapi.CreateDesignRequest
		if !decodeGeneratedJSONBody(w, r, &body) {
			return
		}
		name := strings.TrimSpace(body.Name)
		if name == "" {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "El nombre del diseño es requerido", nil)
			return
		}
		sourceQuoteRevID := ""
		if body.SourceQuoteRevisionID != nil {
			sourceQuoteRevID = strings.TrimSpace(*body.SourceQuoteRevisionID)
			if sourceQuoteRevID != "" && !isValidUUID(sourceQuoteRevID) {
				respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "source_quote_revision_id inválido", nil)
				return
			}
		}

		design, err := s.Store.CreateDesign(r.Context(), storage.CreateDesignCommand{
			ProjectID:             projectID,
			Name:                  name,
			SourceQuoteRevisionID: sourceQuoteRevID,
			ActorUserID:           claims.UserID,
			IP:                    clientIP(r),
			RequestID:             RequestIDFromContext(r.Context()),
		})
		if err != nil {
			respondWithDesignError(w, err)
			return
		}
		respondWithJSON(w, http.StatusCreated, toDesignDTO(*design))

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// HandleDesign serves GET for /api/designs/{designId}.
func (s *Server) HandleDesign(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	roles := actorRoles(claims)
	designID := r.PathValue("designId")
	if !isValidUUID(designID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designId inválido", nil)
		return
	}

	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver el diseño") {
		return
	}

	design, err := s.Store.GetDesignByID(r.Context(), designID)
	if err != nil {
		respondWithDesignError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, toDesignDTO(*design))
}

// HandleDesignRevisions serves GET (list) and POST (publish) for /api/designs/{designId}/revisions.
func (s *Server) HandleDesignRevisions(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	roles := actorRoles(claims)
	designID := r.PathValue("designId")
	if !isValidUUID(designID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designId inválido", nil)
		return
	}

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver las revisiones del diseño") {
			return
		}
		revs, err := s.Store.ListDesignRevisions(r.Context(), designID)
		if err != nil {
			respondWithDesignError(w, err)
			return
		}
		dtos := make([]openapi.DesignRevision, 0, len(revs))
		for _, rev := range revs {
			dtos = append(dtos, toDesignRevisionDTO(rev))
		}
		respondWithJSON(w, http.StatusOK, dtos)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateProjects), "no tenés permiso para publicar revisiones de diseño") {
			return
		}
		var body openapi.PublishDesignRevisionRequest
		if !decodeGeneratedJSONBody(w, r, &body) {
			return
		}

		parentRevID := ""
		if body.ParentRevisionID != nil {
			parentRevID = strings.TrimSpace(*body.ParentRevisionID)
			if parentRevID != "" && !isValidUUID(parentRevID) {
				respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "parent_revision_id inválido", nil)
				return
			}
		}

		baseRevID := ""
		if body.BaseRevisionID != nil {
			baseRevID = strings.TrimSpace(*body.BaseRevisionID)
			if baseRevID != "" && !isValidUUID(baseRevID) {
				respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "base_revision_id inválido", nil)
				return
			}
		}

		items := make([]storage.PublishDesignRevisionItemCommand, 0, len(body.Items))
		for _, item := range body.Items {
			fiID := strings.TrimSpace(item.FurnitureInstanceID)
			if !isValidUUID(fiID) {
				respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "furniture_instance_id inválido en uno de los items", nil)
				return
			}

			cmdItem := storage.PublishDesignRevisionItemCommand{
				FurnitureInstanceID: fiID,
				Parameters:          item.Parameters,
				MaterialChoices:     item.MaterialChoices,
			}
			if item.FurnitureDefinitionID != nil {
				defID := strings.TrimSpace(*item.FurnitureDefinitionID)
				if defID != "" && !isValidUUID(defID) {
					respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "furniture_definition_id inválido en uno de los items", nil)
					return
				}
				cmdItem.FurnitureDefinitionID = defID
			}
			if item.DefinitionVersion != nil {
				v := int(*item.DefinitionVersion)
				cmdItem.DefinitionVersion = &v
			}
			if item.Transform != nil {
				var t3d domain.Transform3D
				if len(item.Transform.TranslationMm) == 3 {
					copy(t3d.TranslationMm[:], item.Transform.TranslationMm)
				}
				if len(item.Transform.RotationDeg) == 3 {
					copy(t3d.RotationDeg[:], item.Transform.RotationDeg)
				}
				cmdItem.Transform = t3d
			}
			if item.RoomID != nil {
				cmdItem.RoomID = strings.TrimSpace(*item.RoomID)
			}
			if item.TechnicalClientLocator != nil {
				cmdItem.TechnicalClientLocator = &domain.TechnicalClientLocator{
					Kind:  item.TechnicalClientLocator.Kind,
					Value: item.TechnicalClientLocator.Value,
				}
			}
			items = append(items, cmdItem)
		}

		rev, err := s.Store.PublishDesignRevision(r.Context(), storage.PublishDesignRevisionCommand{
			DesignID:         designID,
			ParentRevisionID: parentRevID,
			BaseRevisionID:   baseRevID,
			SourceType:       domain.DesignRevisionSourceType(body.SourceType),
			Items:            items,
			ActorUserID:      claims.UserID,
			IP:               clientIP(r),
			RequestID:        RequestIDFromContext(r.Context()),
		})
		if err != nil {
			respondWithDesignError(w, err)
			return
		}
		respondWithJSON(w, http.StatusCreated, toDesignRevisionDTO(*rev))

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// HandleDesignRevision serves GET for /api/designs/{designId}/revisions/{revisionId}.
func (s *Server) HandleDesignRevision(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	roles := actorRoles(claims)
	designID := r.PathValue("designId")
	revisionID := r.PathValue("revisionId")
	if !isValidUUID(designID) || !isValidUUID(revisionID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		return
	}

	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver la revisión de diseño") {
		return
	}

	rev, err := s.Store.GetDesignRevision(r.Context(), designID, revisionID)
	if err != nil {
		respondWithDesignError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, toDesignRevisionDTO(*rev))
}

// HandleDesignWorkingCopy serves GET (read) and PUT (save/replace draft items) for /api/designs/{designId}/working-copy.
func (s *Server) HandleDesignWorkingCopy(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	roles := actorRoles(claims)
	designID := r.PathValue("designId")
	if !isValidUUID(designID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designId inválido", nil)
		return
	}

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver el diseño") {
			return
		}
		wc, err := s.Store.GetDesignWorkingCopy(r.Context(), designID)
		if err != nil {
			respondWithDesignError(w, err)
			return
		}
		respondWithJSON(w, http.StatusOK, toDesignWorkingCopyDTO(*wc))

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para editar el diseño") {
			return
		}
		var body openapi.UpdateDesignWorkingCopyRequest
		if !decodeJSONBody(w, r, &body) {
			return
		}

		var baseRevID *string
		if body.BaseRevisionID != nil {
			trimmed := strings.TrimSpace(*body.BaseRevisionID)
			if trimmed != "" {
				if !isValidUUID(trimmed) {
					respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "base_revision_id inválido", nil)
					return
				}
				baseRevID = &trimmed
			}
		}

		var sourceType domain.DesignRevisionSourceType
		if body.SourceType != nil {
			sourceType = domain.DesignRevisionSourceType(*body.SourceType)
			if !domain.IsValidDesignRevisionSourceType(sourceType) {
				respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "source_type inválido", nil)
				return
			}
		}

		items := make([]storage.UpdateDesignWorkingCopyItemCommand, 0, len(body.Items))
		for _, item := range body.Items {
			fiID := strings.TrimSpace(item.FurnitureInstanceID)
			if !isValidUUID(fiID) {
				respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "furniture_instance_id inválido en uno de los items", nil)
				return
			}
			cmdItem := storage.UpdateDesignWorkingCopyItemCommand{
				FurnitureInstanceID: fiID,
				Parameters:          item.Parameters,
				MaterialChoices:     item.MaterialChoices,
			}
			if item.FurnitureDefinitionID != nil {
				defID := strings.TrimSpace(*item.FurnitureDefinitionID)
				if defID != "" && !isValidUUID(defID) {
					respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "furniture_definition_id inválido en uno de los items", nil)
					return
				}
				cmdItem.FurnitureDefinitionID = defID
			}
			if item.DefinitionVersion != nil {
				v := int(*item.DefinitionVersion)
				cmdItem.DefinitionVersion = &v
			}
			if item.Transform != nil {
				var t3d domain.Transform3D
				if len(item.Transform.TranslationMm) == 3 {
					copy(t3d.TranslationMm[:], item.Transform.TranslationMm)
				}
				if len(item.Transform.RotationDeg) == 3 {
					copy(t3d.RotationDeg[:], item.Transform.RotationDeg)
				}
				cmdItem.Transform = t3d
			}
			if item.RoomID != nil {
				cmdItem.RoomID = strings.TrimSpace(*item.RoomID)
			}
			if item.TechnicalClientLocator != nil {
				cmdItem.TechnicalClientLocator = &domain.TechnicalClientLocator{
					Kind:  item.TechnicalClientLocator.Kind,
					Value: item.TechnicalClientLocator.Value,
				}
			}
			items = append(items, cmdItem)
		}

		wc, err := s.Store.UpdateDesignWorkingCopy(r.Context(), storage.UpdateDesignWorkingCopyCommand{
			DesignID:       designID,
			BaseRevisionID: baseRevID,
			SourceType:     sourceType,
			Items:          items,
			ActorUserID:    claims.UserID,
		})
		if err != nil {
			respondWithDesignError(w, err)
			return
		}
		respondWithJSON(w, http.StatusOK, toDesignWorkingCopyDTO(*wc))

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// HandleDesignWorkingCopyReset serves POST for /api/designs/{designId}/working-copy:reset.
func (s *Server) HandleDesignWorkingCopyReset(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	roles := actorRoles(claims)
	designID := r.PathValue("designId")
	if !isValidUUID(designID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designId inválido", nil)
		return
	}

	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para resetear el diseño") {
		return
	}

	var body openapi.ResetDesignWorkingCopyRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	revID := strings.TrimSpace(body.RevisionID)
	if !isValidUUID(revID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "revision_id inválido", nil)
		return
	}

	wc, err := s.Store.ResetDesignWorkingCopy(r.Context(), storage.ResetDesignWorkingCopyCommand{
		DesignID:    designID,
		RevisionID:  revID,
		ActorUserID: claims.UserID,
	})
	if err != nil {
		respondWithDesignError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, toDesignWorkingCopyDTO(*wc))
}
