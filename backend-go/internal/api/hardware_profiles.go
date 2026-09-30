package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Hardware Profiles catalog surface (#913 / HW-PROFILE): tenant-scoped CRUD
// over the frozen #912 domain contract. Hardware is referenced by id only —
// prices and units are never accepted or echoed from this surface. Writes
// are optimistic-concurrency guarded (#443/#448): the server owns id,
// version, active and timestamps; PUT/DELETE require a strong If-Match ETag.

// hardwareProfileWriteBody is the closed request shape: exactly the #912
// contract fields the client may author. id/version/active and timestamps
// are server-owned and rejected here rather than silently reset.
type hardwareProfileWriteBody struct {
	Code        string                       `json:"code"`
	Name        string                       `json:"name"`
	Description string                       `json:"description"`
	Revision    string                       `json:"revision"`
	Items       []domain.HardwareProfileItem `json:"items"`
	RecipeRef   *domain.ProfileRecipeRef     `json:"recipeRef"`
}

func (b hardwareProfileWriteBody) toDomain() *domain.HardwareProfile {
	items := b.Items
	if items == nil {
		items = []domain.HardwareProfileItem{}
	}
	return &domain.HardwareProfile{
		Code: b.Code, Name: b.Name, Description: b.Description, Revision: b.Revision,
		Items: items, RecipeRef: b.RecipeRef,
	}
}

// validateHardwareProfile returns the domain contract issues plus the
// reference-integrity issues: every item hardwareId must exist in the
// caller's organization scope (#913 acceptance — never a silent accept).
func validateHardwareProfile(s Store, w http.ResponseWriter, r *http.Request, profile *domain.HardwareProfile) bool {
	issues := profile.Validate()
	if len(profile.Items) > 0 {
		ids := make([]string, 0, len(profile.Items))
		for _, item := range profile.Items {
			ids = append(ids, item.HardwareID)
		}
		existing, err := s.ExistingHardwareIDs(r.Context(), ids)
		if err != nil {
			respondWithInternalError(w, err, "validate hardware references")
			return false
		}
		for index, item := range profile.Items {
			if item.HardwareID != "" && !existing[item.HardwareID] {
				issues = append(issues, domain.ContractIssue{
					Code: "HARDWARE_REFERENCE_INVALID", Message: fmt.Sprintf("hardware %s does not exist in this organization", item.HardwareID),
					Severity: domain.IssueSeverityError, EntityID: profile.ID,
					Path: fmt.Sprintf("hardwareProfile.items[%d].hardwareId", index),
				})
			}
		}
	}
	if len(issues) > 0 {
		respondWithHardwareProfileIssues(w, issues)
		return false
	}
	return true
}

// respondWithHardwareProfileIssues answers every rejected profile write with
// one 422 issues envelope, mirroring the parameter-definition contract so web
// and SketchUp clients share a single error shape.
func respondWithHardwareProfileIssues(w http.ResponseWriter, issues []domain.ContractIssue) {
	respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
		"code": "HARDWARE_PROFILE_INVALID", "message": "hardware profile is invalid", "issues": issues,
	})
}

func (s *Server) HandleHardwareProfiles(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		profiles, err := s.Store.ListHardwareProfiles(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "list hardware profiles")
			return
		}
		respondWithJSON(w, http.StatusOK, profiles)
	case http.MethodPost:
		claims := claimsFromRequest(r)
		if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateCatalog), "sólo roles con permiso de catálogo pueden crear perfiles de herrajes") {
			return
		}
		var body hardwareProfileWriteBody
		if !decodeGeneratedJSONBody(w, r, &body) {
			return
		}
		profile := body.toDomain()
		// Identity is server-owned from the first moment: the #912 contract
		// validates a non-blank id, and the storage honors the provided id.
		profile.ID = uuid.New().String()
		profile.Active = true
		if !validateHardwareProfile(s.Store, w, r, profile) {
			return
		}
		if err := s.Store.CreateHardwareProfile(r.Context(), profile); err != nil {
			if isDuplicateKey(err) {
				respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "El código ingresado ya está registrado", nil)
				return
			}
			respondWithInternalError(w, err, "create hardware profile")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(profile.Version))
		respondWithJSON(w, http.StatusCreated, profile)
	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleHardwareProfileByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	switch r.Method {
	case http.MethodGet:
		profile, err := s.Store.GetHardwareProfileByID(r.Context(), id)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, "hardware profile not found")
				return
			}
			respondWithInternalError(w, err, "get hardware profile")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(profile.Version))
		respondWithJSON(w, http.StatusOK, profile)
	case http.MethodPut:
		claims := claimsFromRequest(r)
		if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateCatalog), "sólo roles con permiso de catálogo pueden editar perfiles de herrajes") {
			return
		}
		current, err := s.Store.GetHardwareProfileByID(r.Context(), id)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, "hardware profile not found")
				return
			}
			respondWithInternalError(w, err, "get hardware profile")
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		var body hardwareProfileWriteBody
		if !decodeGeneratedJSONBody(w, r, &body) {
			return
		}
		profile := body.toDomain()
		// Server-owned fields survive the write: identity, lifecycle and
		// concurrency never come from the body.
		profile.ID = current.ID
		profile.Active = current.Active
		if !validateHardwareProfile(s.Store, w, r, profile) {
			return
		}
		if err := s.Store.UpdateHardwareProfile(r.Context(), id, expectedVersion, profile); err != nil {
			if err.Error() == "hardware profile not found" {
				respondWithError(w, http.StatusNotFound, "hardware profile not found")
				return
			}
			if isDuplicateKey(err) {
				respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "El código ingresado ya está registrado", nil)
				return
			}
			respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión del perfil cambió; recargá y reintentá", nil)
			return
		}
		w.Header().Set("ETag", FormatVersionETag(profile.Version))
		respondWithJSON(w, http.StatusOK, profile)
	case http.MethodDelete:
		claims := claimsFromRequest(r)
		if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateCatalog), "sólo roles con permiso de catálogo pueden desactivar perfiles de herrajes") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		if err := s.Store.DeactivateHardwareProfile(r.Context(), id, expectedVersion); err != nil {
			if err.Error() == "hardware profile not found" {
				respondWithError(w, http.StatusNotFound, "hardware profile not found")
				return
			}
			respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión del perfil cambió; recargá y reintentá", nil)
			return
		}
		profile, err := s.Store.GetHardwareProfileByID(r.Context(), id)
		if err != nil {
			respondWithInternalError(w, err, "get deactivated hardware profile")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(profile.Version))
		respondWithJSON(w, http.StatusOK, profile)
	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
