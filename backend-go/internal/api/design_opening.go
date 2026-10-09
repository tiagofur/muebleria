package api

import (
	"net/http"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1137 — the design opening endpoints: the authoring surface sends the
// semantic INTENT (PUT) and reads the RESOLVED result (GET). The plugin
// never computes front sizes, BOM or machining; every derived value here is
// read-only resolve output (the #1131 layout resolver over the #1130
// profile catalog).
//
// PUT validates the selection as NEW authoring: factory capabilities
// (#1134) + profile catalog (#1130) through the #1135 validator — a
// disabled capability or an unverified datasheet answers 422
// INVALID_OPENING_CONFIGURATION with details.reason, and the previously
// persisted selection stays untouched (the client keeps rendering it).
// GET returns the persisted intent plus its resolution; a PERSISTED
// selection resolves regardless of today's capabilities (historical rule),
// with pending evidence surfacing as a truthful blocked state.

// designOpeningPayload is the shared response shape of GET and PUT.
type designOpeningPayload struct {
	Opening    *domain.DesignOpeningSelection  `json:"opening"`
	Resolution *engine.DesignOpeningResolution `json:"resolution"`
	// WorkingVersion is the working copy's optimistic-concurrency token:
	// the next PUT carries it back so a concurrent authoring write is a
	// conflict, never a silent clobber.
	WorkingVersion string `json:"workingVersion"`
	// DimsKnown reports whether the design's furniture carries explicit
	// dimensions: without them the resolution cannot run (nothing is
	// invented — the caller sees the truthful absence).
	DimsKnown bool `json:"dimsKnown"`
}

func (s *Server) handleDesignOpeningState(w http.ResponseWriter, r *http.Request, wc *domain.DesignWorkingCopy) {
	state := designOpeningPayload{
		Opening:        wc.AuthoringDefaults.Opening,
		WorkingVersion: wc.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
	dims := designOpeningDims(wc)
	if dims != nil {
		state.DimsKnown = true
		if state.Opening != nil {
			// B2 (review of the review): the PINNED datasheet slice resolves
			// the historical design — the live catalog is only a fallback for
			// rows authored before the pin existed. A datasheet update never
			// silently changes a persisted design's fronts.
			var profileData []engine.OpeningProfileData
			if pin := state.Opening.ProfilePin; pin != nil {
				profileData = []engine.OpeningProfileData{{
					ProfileID:        state.Opening.ProfileID,
					DatasheetStatus:  pin.DatasheetStatus,
					FrontReductionMm: pin.FrontReductionMm,
					GripClearanceMm:  pin.GripClearanceMm,
				}}
			} else if profiles, err := s.Store.ListOpeningProfiles(r.Context()); err == nil {
				profileData = make([]engine.OpeningProfileData, 0, len(profiles))
				for _, profile := range profiles {
					profileData = append(profileData, engine.OpeningProfileData{
						ProfileID:        profile.ID,
						DatasheetStatus:  profile.DatasheetStatus,
						FrontReductionMm: derefInt(profile.FrontReductionMm),
						GripClearanceMm:  derefInt(profile.GripClearanceMm),
					})
				}
			}
			if profileData != nil {
				// #1138: the backed case C rule rides with the overlay. A
				// broken overlay fails closed like the profile catalog: no
				// resolution rendered instead of a stale or invented one.
				if rule, ruleErr := s.Store.GetOpeningOverhangRule(r.Context()); ruleErr == nil {
					resolution, resErr := engine.ResolveDesignOpening(dims.widthMm, dims.heightMm, state.Opening, profileData, engine.OpeningOverhangRuleMm(rule))
					if resErr != nil {
						state.Resolution = &engine.DesignOpeningResolution{
							State: engine.DesignOpeningStateBlocked, Reason: resErr.Code,
						}
					} else {
						state.Resolution = resolution
					}
				}
			}
			// A broken profile catalog fails closed: no resolution rendered
			// instead of a stale or invented one.
		}
	}
	respondWithJSON(w, http.StatusOK, state)
}

type openingDims struct{ widthMm, heightMm int }

// designOpeningDims resolves the furniture's explicit dimensions from the
// working copy's first item (the pilot's one-module scope). No explicit
// dims = nil: the caller sees DimsKnown=false, never a guessed size.
func designOpeningDims(wc *domain.DesignWorkingCopy) *openingDims {
	if len(wc.Items) == 0 {
		return nil
	}
	custom := domain.CommercialDimsFromParameters(wc.Items[0].Parameters)
	if custom == nil {
		return nil
	}
	return &openingDims{widthMm: custom.WidthMm, heightMm: custom.HeightMm}
}

// HandleDesignOpening reads (GET) or validates-and-persists (PUT) the
// design's opening intent.
func (s *Server) HandleDesignOpening(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	designID := r.PathValue("designId")
	if !isValidUUID(designID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designId inválido", nil)
		return
	}

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para ver el diseño") {
			return
		}
		wc, err := s.Store.GetDesignWorkingCopy(r.Context(), designID)
		if err != nil {
			respondWithDesignError(w, err)
			return
		}
		s.handleDesignOpeningState(w, r, wc)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para editar el diseño") {
			return
		}
		s.handleDesignOpeningPut(w, r, claims.UserID, designID)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleDesignOpeningPut(w http.ResponseWriter, r *http.Request, userID, designID string) {
	var body struct {
		System                 string   `json:"system"`
		ProfileID              string   `json:"profileId"`
		Placements             []string `json:"placements"`
		ExpectedWorkingVersion string   `json:"expectedWorkingVersion"`
	}
	if !decodeJSONBody(w, r, &body) {
		return
	}
	selection := domain.DesignOpeningSelection{
		System:     strings.TrimSpace(body.System),
		ProfileID:  strings.TrimSpace(body.ProfileID),
		Placements: body.Placements,
	}
	if err := domain.ValidateDesignOpeningSelection(selection); err != nil {
		respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"code":    "INVALID_OPENING_CONFIGURATION",
			"message": err.Error(),
			"details": map[string]any{"reason": "OPENING_SELECTION_INVALID"},
		})
		return
	}

	// The NEW-selection gate: factory capabilities + profile catalog. An
	// invalid selection never touches the persisted state.
	capabilities, err := s.Store.GetOpeningCapabilities(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "opening capabilities read")
		return
	}
	overhangRule, err := s.Store.GetOpeningOverhangRule(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "opening overhang rule read")
		return
	}
	profileList, err := s.Store.ListOpeningProfiles(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "opening profiles list")
		return
	}
	profileSelection := make([]engine.OpeningProfileSelectionData, 0, len(profileList))
	for _, profile := range profileList {
		profileSelection = append(profileSelection, engine.OpeningProfileSelectionData{
			ProfileID:            profile.ID,
			CompatiblePlacements: profile.CompatiblePlacements,
			DatasheetStatus:      profile.DatasheetStatus,
		})
	}
	validation := engine.ValidateOpeningConfiguration(engine.OpeningConfigurationSelection{
		System:     selection.System,
		ProfileID:  selection.ProfileID,
		Placements: selection.Placements,
	}, capabilities, profileSelection, overhangRule)
	if validation.State == engine.OpeningSelectionValid && selection.System == domain.OpeningGripSystemGola {
		// B2: capture the datasheet slice the selection was validated
		// against — the historical resolution consumes the pin, never the
		// live catalog.
		for _, profile := range profileList {
			if profile.ID == selection.ProfileID {
				selection.ProfilePin = &domain.DesignOpeningProfilePin{
					ProfileCode:      profile.Code,
					FrontReductionMm: derefInt(profile.FrontReductionMm),
					GripClearanceMm:  derefInt(profile.GripClearanceMm),
					DatasheetStatus:  profile.DatasheetStatus,
				}
				break
			}
		}
	}
	if validation.State != engine.OpeningSelectionValid {
		respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"code":    "INVALID_OPENING_CONFIGURATION",
			"message": "la configuración de apertura no es válida: " + engine.OpeningSelectionReasonMessage(validation.Reason),
			"details": map[string]any{
				"reason":    validation.Reason,
				"system":    selection.System,
				"profileId": selection.ProfileID,
			},
		})
		return
	}

	// Persist surgically: the write touches only the defaults' opening —
	// never the working items. The version token protects concurrent
	// authoring writes when the client declares its read.
	wc, err := s.Store.GetDesignWorkingCopy(r.Context(), designID)
	if err != nil {
		respondWithDesignError(w, err)
		return
	}
	var expected *time.Time
	if strings.TrimSpace(body.ExpectedWorkingVersion) != "" {
		parsed, parseErr := time.Parse(time.RFC3339Nano, strings.TrimSpace(body.ExpectedWorkingVersion))
		if parseErr != nil {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "expected_working_version inválido", nil)
			return
		}
		expected = &parsed
	} else {
		token := wc.UpdatedAt
		expected = &token
	}
	defaults, err := s.Store.SetDesignWorkingCopyOpening(r.Context(), storage.SetDesignWorkingCopyOpeningCommand{
		DesignID:               designID,
		ExpectedWorkingVersion: expected,
		Opening:                &selection,
		ActorUserID:            userID,
	})
	if err != nil {
		if err == storage.ErrWorkingCopyVersionConflict || err == storage.ErrWorkingCopyPreconditionRequired {
			respondWithDesignError(w, err)
			return
		}
		respondWithInternalError(w, err, "design opening write")
		return
	}

	// Respond with the authoritative state (re-read through the same path
	// the GET serves, so the client never renders a local guess).
	fresh, err := s.Store.GetDesignWorkingCopy(r.Context(), designID)
	if err != nil {
		respondWithInternalError(w, err, "design working copy read")
		return
	}
	_ = defaults
	s.handleDesignOpeningState(w, r, fresh)
}

func derefInt(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}
