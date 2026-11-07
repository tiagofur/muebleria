package api

// Grip styles API (#1531, ADR-0009 A2.2): the workshop's named grip recipes.
// Reads are any member; writes need the catalog-mutation role and If-Match.
// Consumed by the web settings (#1533) and the project grip (#1532).

import (
	"errors"
	"net/http"
	"strings"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func gripStyleMeta(r *http.Request) storage.GripStyleWriteMeta {
	return storage.GripStyleWriteMeta{RequestID: RequestIDFromContext(r.Context()), IP: clientIP(r)}
}

// respondGripStyleError maps the store's errors; it reports whether it wrote.
func respondGripStyleError(w http.ResponseWriter, err error) bool {
	var invalid *domain.GripStyleValidationError
	switch {
	case errors.As(err, &invalid):
		respondWithAPIError(w, http.StatusUnprocessableEntity, openapi.ApiErrorCodeBadRequest, invalid.Message, nil)
	case errors.Is(err, storage.ErrVersionConflict):
		respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión cambió; recarga y vuelve a intentar", nil)
	case errors.Is(err, storage.ErrGripStyleNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "estilo de agarre inexistente", nil)
	default:
		return false
	}
	return true
}

func (s *Server) HandleGripStyles(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListGripStyles(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "grip styles list")
			return
		}
		respondWithJSON(w, http.StatusOK, list)
	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tienes permiso para modificar el catálogo") {
			return
		}
		var style domain.GripStyle
		if !decodeJSONBody(w, r, &style) {
			return
		}
		if err := s.Store.CreateGripStyle(r.Context(), &style, gripStyleMeta(r)); err != nil {
			if respondGripStyleError(w, err) {
				return
			}
			respondWithInternalError(w, err, "grip style create")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(style.Version))
		respondWithJSON(w, http.StatusCreated, style)
	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleGripStyleByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "id requerido")
		return
	}
	switch r.Method {
	case http.MethodGet:
		style, err := s.Store.GetGripStyle(r.Context(), id)
		if err != nil {
			if respondGripStyleError(w, err) {
				return
			}
			respondWithInternalError(w, err, "grip style read")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(style.Version))
		respondWithJSON(w, http.StatusOK, style)
	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tienes permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		var style domain.GripStyle
		if !decodeJSONBody(w, r, &style) {
			return
		}
		if err := s.Store.UpdateGripStyle(r.Context(), id, expectedVersion, &style, gripStyleMeta(r)); err != nil {
			if respondGripStyleError(w, err) {
				return
			}
			respondWithInternalError(w, err, "grip style update")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(style.Version))
		respondWithJSON(w, http.StatusOK, style)
	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tienes permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		if err := s.Store.DeleteGripStyle(r.Context(), id, expectedVersion, gripStyleMeta(r)); err != nil {
			if respondGripStyleError(w, err) {
				return
			}
			respondWithInternalError(w, err, "grip style delete")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]any{"deleted": true, "id": id})
	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// gripTypeLabels are the workshop-facing furniture type names the preview
// errors name (the domain vocabulary, spelled for the UI).
var gripTypeLabels = map[string]string{
	"inferior": "muebles bajos",
	"superior": "alacenas",
	"alto":     "muebles altos",
}

// HandleGripStylePreview serves POST /api/catalog/grip-styles/preview
// (#1533): the editor's in-flight recipes + a reference height come in; the
// server joins the profile IDs against the catalog (the #1530 use rule — a
// profile that is not usable at its position fails closed with the exact
// message) and resolves the «Mueble de 720 → puerta de 680» sentences with
// the A3 contract. React renders them verbatim — never computes.
func (s *Server) HandleGripStylePreview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		HeightMm        int                               `json:"heightMm"`
		ByFurnitureType map[string]domain.GripStyleRecipe `json:"byFurnitureType"`
	}
	if !decodeJSONBody(w, r, &body) {
		return
	}
	profiles, err := s.Store.ListOpeningProfiles(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "grip style preview profiles")
		return
	}
	byID := make(map[string]domain.OpeningProfile, len(profiles))
	for _, profile := range profiles {
		byID[profile.ID] = profile
	}
	resolve := func(profileID string, position string) (*int, error) {
		profile, known := byID[profileID]
		if !known {
			return nil, &domain.GripSnapshotValidationError{
				Code:    "GRIP_SNAPSHOT_INVALID",
				Message: "el perfil de gola no existe en el catálogo"}
		}
		usage := profile.UsageAt(position)
		if !usage.Usable {
			return nil, &domain.GripSnapshotValidationError{
				Code:    "GRIP_SNAPSHOT_INVALID",
				Message: "el perfil " + profile.Code + " no se puede usar: " + usage.Message}
		}
		if position == domain.GolaPositionBetween {
			return profile.FrontDiscountBetweenMm, nil
		}
		return profile.FrontDiscountTopMm, nil
	}
	previews := make([]domain.GripStylePreview, 0, len(body.ByFurnitureType))
	for _, ftype := range domain.GripStyleFurnitureTypes {
		recipe, known := body.ByFurnitureType[ftype]
		if !known {
			continue
		}
		var topDiscount, betweenDiscount *int
		if recipe.Mode == domain.GripModeGola {
			if recipe.TopProfileID == "" {
				respondWithAPIError(w, http.StatusUnprocessableEntity, openapi.ApiErrorCodeBadRequest,
					"la gola de "+gripTypeLabels[ftype]+" necesita el perfil superior", nil)
				return
			}
			if topDiscount, err = resolve(recipe.TopProfileID, domain.GolaPositionTop); err != nil {
				respondGripPreviewError(w, err)
				return
			}
			if recipe.BetweenProfileID != "" {
				if betweenDiscount, err = resolve(recipe.BetweenProfileID, domain.GolaPositionBetween); err != nil {
					respondGripPreviewError(w, err)
					return
				}
			}
		} else if recipe.Mode == domain.GripModeBottomOverhang {
			if recipe.OverhangMm == nil || *recipe.OverhangMm <= 0 {
				respondWithAPIError(w, http.StatusUnprocessableEntity, openapi.ApiErrorCodeBadRequest,
					"el rebase de "+gripTypeLabels[ftype]+" necesita milímetros mayores a 0", nil)
				return
			}
			// The rebase's millimetres ride in the top slot: the preview
			// sentence names the extension the style declares.
			mm := int(*recipe.OverhangMm)
			topDiscount = &mm
		}
		sentence, sentenceErr := engine.GripStylePreviewSentence(body.HeightMm, recipe.Mode, topDiscount, betweenDiscount)
		if sentenceErr != nil {
			respondGripPreviewError(w, sentenceErr)
			return
		}
		previews = append(previews, domain.GripStylePreview{
			FurnitureType: ftype, Mode: recipe.Mode, Preview: sentence,
		})
	}
	respondWithJSON(w, http.StatusOK, map[string]any{"previews": previews})
}

func respondGripPreviewError(w http.ResponseWriter, err error) {
	var invalid *domain.GripSnapshotValidationError
	if errors.As(err, &invalid) {
		respondWithAPIError(w, http.StatusUnprocessableEntity, openapi.ApiErrorCodeBadRequest, invalid.Message, nil)
		return
	}
	respondWithInternalError(w, err, "grip style preview")
}
