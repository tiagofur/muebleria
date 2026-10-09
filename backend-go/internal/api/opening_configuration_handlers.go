package api

import (
	"net/http"

	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1135: server-authoritative validation of NEW-authoring opening
// selections. Hiding an option in the UI is UX, never authorization — every
// authoring surface validates here. Available ≠ valid: the capability gate
// blocks new selections only; persisted designs keep resolving against
// their pinned release.
//
// Responses follow the shared contract-error pattern (one envelope for web
// and SketchUp): invalid selections answer 422 with code
// INVALID_OPENING_CONFIGURATION and details.reason (the stable reason code
// the fixture pins); valid answers 200; available-but-blocked (OQ-3
// evidence pending) answers 200 with the truthful blocked state — a state,
// never an error and never invented.
func (s *Server) HandleOpeningConfigurationValidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var selection engine.OpeningConfigurationSelection
	if !decodeJSONBody(w, r, &selection) {
		return
	}

	capabilities, err := s.Store.GetOpeningCapabilities(r.Context())
	if err != nil {
		// A broken overlay fails closed — never a silent library default.
		respondWithInternalError(w, err, "opening capabilities read")
		return
	}
	overhangRule, err := s.Store.GetOpeningOverhangRule(r.Context())
	if err != nil {
		// A broken overlay fails closed — never a silent library default.
		respondWithInternalError(w, err, "opening overhang rule read")
		return
	}
	profileList, err := s.Store.ListOpeningProfiles(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "opening profiles list")
		return
	}
	profiles := make([]engine.OpeningProfileSelectionData, 0, len(profileList))
	for _, profile := range profileList {
		profiles = append(profiles, engine.OpeningProfileSelectionData{
			ProfileID:            profile.ID,
			CompatiblePlacements: profile.CompatiblePlacements,
			DatasheetStatus:      profile.DatasheetStatus,
		})
	}

	validation := engine.ValidateOpeningConfiguration(selection, capabilities, profiles, overhangRule)
	if validation.State == engine.OpeningSelectionInvalid {
		respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"code":    "INVALID_OPENING_CONFIGURATION",
			"message": openingSelectionMessage(validation.Reason),
			"details": map[string]any{
				"reason":    validation.Reason,
				"system":    selection.System,
				"profileId": selection.ProfileID,
			},
		})
		return
	}
	respondWithJSON(w, http.StatusOK, map[string]any{"validation": map[string]any{
		"state":  validation.State,
		"reason": validation.Reason,
	}})
}

func openingSelectionMessage(reason string) string {
	if reason == "" {
		return "la configuración de apertura no es válida"
	}
	return "la configuración de apertura no es válida: " + engine.OpeningSelectionReasonMessage(reason)
}
