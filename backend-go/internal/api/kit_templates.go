package api

import (
	"errors"
	"net/http"
	"strings"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// --- CATALOG / KIT TEMPLATES (#1422 slice 2) ---
//
// Workshop kit templates: declarative "juego de herraje" blueprints the
// hardware-kit wizard arms. Pure planning data — creating one never touches
// geometry, so no geometry-authoring gate; writes need the catalog-mutate
// permission like every other catalog entity. Validation is the fail-closed
// Go twin of the TS validator over the shared fixture.

// validateKitTemplateForWrite enforces the workshop-row invariants beyond the
// shared structural validation: a persisted template always carries a code
// (unique per organization) and a non-empty slot list.
func validateKitTemplateForWrite(t *domain.KitTemplate) (field string, message string) {
	if t.Code == nil || strings.TrimSpace(*t.Code) == "" {
		return "code", "la plantilla del taller necesita un código"
	}
	*t.Code = strings.TrimSpace(*t.Code)
	t.LabelEs = strings.TrimSpace(t.LabelEs)
	t.AgregadoLabelEs = strings.TrimSpace(t.AgregadoLabelEs)
	issues := t.Validate()
	if len(issues) == 0 {
		return "", ""
	}
	return issues[0].Path, issues[0].Message
}

func respondKitTemplateInvalid(w http.ResponseWriter, field, message string) {
	respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
		"code":    "KIT_TEMPLATE_INVALID",
		"message": message,
		"field":   field,
	})
}

func (s *Server) HandleKitTemplates(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListKitTemplates(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "kit templates list")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var t domain.KitTemplate
		if !decodeJSONBody(w, r, &t) {
			return
		}
		if field, message := validateKitTemplateForWrite(&t); field != "" {
			respondKitTemplateInvalid(w, field, message)
			return
		}
		if err := s.Store.CreateKitTemplate(r.Context(), &t); err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "Ya existe una plantilla con ese código en este taller")
				return
			}
			respondWithInternalError(w, err, "kit template create")
			return
		}
		respondWithJSON(w, http.StatusCreated, t)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleKitTemplateByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing kit template id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		t, err := s.Store.GetKitTemplateByID(r.Context(), id)
		if err != nil {
			if errors.Is(err, storage.ErrKitTemplateNotFound) {
				respondWithError(w, http.StatusNotFound, "kit template not found")
				return
			}
			respondWithInternalError(w, err, "kit template get")
			return
		}
		respondWithJSON(w, http.StatusOK, t)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		var t domain.KitTemplate
		if !decodeJSONBody(w, r, &t) {
			return
		}
		// Identity comes from the path, never the body.
		t.ID = id
		if field, message := validateKitTemplateForWrite(&t); field != "" {
			respondKitTemplateInvalid(w, field, message)
			return
		}
		if err := s.Store.UpdateKitTemplate(r.Context(), id, expectedVersion, &t); err != nil {
			if errors.Is(err, storage.ErrKitTemplateNotFound) {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión cambió; recargá y reintentá", nil)
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "Ya existe una plantilla con ese código en este taller")
				return
			}
			respondWithInternalError(w, err, "kit template update")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(t.Version))
		respondWithJSON(w, http.StatusOK, t)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		if err := s.Store.DeactivateKitTemplate(r.Context(), id, expectedVersion); err != nil {
			if errors.Is(err, storage.ErrKitTemplateNotFound) {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión de la plantilla cambió; recargá y reintentá", nil)
				return
			}
			respondWithInternalError(w, err, "kit template delete")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "kit template deactivated"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
