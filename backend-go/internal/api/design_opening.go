package api

import (
	"errors"
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

// handleDesignOpeningState serves the facade GET (#1532): the state derives
// from the EFFECTIVE grip (the design's first furniture's override, else the
// project's frozen snapshot) as the v1-shaped selection the plugin renders.
// The derived selection always carries a complete pin built from the frozen
// profile — the live catalog is never consulted for a migrated design.
func (s *Server) handleDesignOpeningState(w http.ResponseWriter, r *http.Request, wc *domain.DesignWorkingCopy) {
	state := designOpeningPayload{
		WorkingVersion: wc.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
	facadeState, err := s.Store.GetDesignOpeningFacadeState(r.Context(), wc.DesignID)
	if err != nil {
		respondWithInternalError(w, err, "design opening facade state")
		return
	}
	if facadeState.Snapshot == nil {
		respondWithJSON(w, http.StatusOK, state)
		return
	}
	if err := domain.ValidateGripSnapshotShape(facadeState.Snapshot); err != nil {
		// C1 (judgment-day r1): the SAME shape gate every authoritative
		// surface applies — the plugin card sees the honest blocked state
		// instead of a resolve this grip can never produce.
		state.Resolution = &engine.DesignOpeningResolution{
			State: engine.DesignOpeningStateBlocked, Reason: "GRIP_SNAPSHOT_INVALID",
		}
		respondWithJSON(w, http.StatusOK, state)
		return
	}
	selection := derivedDesignOpeningSelection(facadeState.Snapshot, facadeState.FurnitureType)
	if selection == nil {
		// Reaching here after the shape gate means the snapshot does not
		// cover this furniture's type (GRIP_TYPE_UNCOVERED): the SAME code
		// the authoritative resolve reports for the condition.
		state.Resolution = &engine.DesignOpeningResolution{
			State: engine.DesignOpeningStateBlocked, Reason: "GRIP_SNAPSHOT_INVALID",
		}
		respondWithJSON(w, http.StatusOK, state)
		return
	}
	state.Opening = selection
	dims := designOpeningDims(wc)
	if dims == nil {
		respondWithJSON(w, http.StatusOK, state)
		return
	}
	state.DimsKnown = true
	// The derived pin resolves the historical design: the frozen profile IS
	// the pin (A7). A datasheet update never silently changes the fronts.
	// Handle and rebase selections carry no profile: the baseline resolve.
	var profileData []engine.OpeningProfileData
	var bomProfiles []engine.OpeningProfileBOMData
	if pin := selection.ProfilePin; pin != nil {
		profileData = []engine.OpeningProfileData{{
			ProfileID:            selection.ProfileID,
			DatasheetStatus:      "verified",
			FrontReductionMm:     pin.FrontReductionMm,
			GripClearanceMm:      pin.GripClearanceMm,
			DoorReductionMm:      pin.DoorReductionMm,
			ProfileDepthMm:       pin.ProfileDepthMm,
			ProfileHeightMm:      pin.ProfileHeightMm,
			CompatiblePlacements: pin.CompatiblePlacements,
			BodyModifiers:        engine.ContractBodyModifiersFromEntities(pin.BodyModifiers),
		}}
		bomProfiles = []engine.OpeningProfileBOMData{{
			ProfileID:  selection.ProfileID,
			Version:    pin.BOM.ProfileVersion,
			BOMMembers: openingContractMembers(pin.BOM.Members),
		}}
	}
	if rule, ruleErr := s.Store.GetOpeningOverhangRule(r.Context()); ruleErr == nil {
		var bomCtx *engine.DesignOpeningBOMContext
		if selection.System == domain.OpeningGripSystemGola {
			bomCtx = s.designOpeningBOMContext(r, wc, bomProfiles)
		}
		resolution, resErr := engine.ResolveDesignOpening(dims.widthMm, dims.heightMm, selection, profileData, engine.OpeningOverhangRuleMm(rule), bomCtx)
		if resErr != nil {
			state.Resolution = &engine.DesignOpeningResolution{
				State: engine.DesignOpeningStateBlocked, Reason: resErr.Code,
			}
		} else {
			state.Resolution = resolution
		}
	}
	respondWithJSON(w, http.StatusOK, state)
}

// derivedDesignOpeningSelection maps the effective frozen snapshot onto the
// v1 selection shape the plugin consumes until #1535. The pin is built FROM
// the frozen profile — the complete copy, never a partial capture.
func derivedDesignOpeningSelection(snapshot *domain.GripSnapshot, furnitureType string) *domain.DesignOpeningSelection {
	recipe, err := snapshot.GripRecipeFor(furnitureType)
	if err != nil || recipe == nil {
		return nil
	}
	switch recipe.Mode {
	case domain.GripModeHandle:
		if recipe.LegacyBottomGola {
			// unreachable for handle mode; kept for shape safety
			return nil
		}
		return &domain.DesignOpeningSelection{System: domain.OpeningGripSystemHandle}
	case domain.GripModeBottomOverhang:
		return &domain.DesignOpeningSelection{System: domain.OpeningGripSystemBottomOverhang}
	case domain.GripModeGola:
		if recipe.TopProfile == nil || recipe.TopProfile.FrontDiscountTopMm == nil || *recipe.TopProfile.FrontDiscountTopMm <= 0 {
			// C1 (judgment-day r1): a frozen copy without its top discount is
			// exactly what the authoritative surfaces block as
			// GRIP_PROFILE_UNUSABLE — the facade NEVER substitutes 0 (A6: no
			// invented values); the caller reports the honest blocked state.
			return nil
		}
		placements := []string{"top"}
		if recipe.LegacyBottomGola {
			placements = []string{"bottom"}
		}
		top := recipe.TopProfile
		members := top.BOMMembers
		if members == nil {
			members = map[string]domain.OpeningBOMMember{}
		}
		discount := *top.FrontDiscountTopMm
		return &domain.DesignOpeningSelection{
			System:     domain.OpeningGripSystemGola,
			ProfileID:  top.ProfileID,
			Placements: placements,
			ProfilePin: &domain.DesignOpeningProfilePin{
				ProfileCode:          top.Code,
				DoorReductionMm:      &discount,
				DatasheetStatus:      "verified",
				ProfileHeightMm:      derefFloat(top.ProfileHeightMm),
				ProfileDepthMm:       derefFloat(top.ProfileDepthMm),
				CompatiblePlacements: top.CompatiblePlacements,
				BodyModifiers:        top.BodyModifiers,
				BOM: &domain.DesignOpeningProfilePinBOM{
					ProfileVersion: top.BOMVersion,
					Members:        members,
				},
			},
		}
	}
	return nil
}

func openingContractMembers(members map[string]domain.OpeningBOMMember) map[string]engine.OpeningContractBOMMember {
	converted := make(map[string]engine.OpeningContractBOMMember, len(members))
	for key, member := range members {
		converted[key] = engine.OpeningContractBOMMember{
			HardwareID: member.HardwareID,
			Rule:       member.Rule,
			Unit:       member.Unit,
			SpacingMm:  member.SpacingMm,
		}
	}
	return converted
}

// designOpeningBOMContext assembles the body context the BOM resolution
// needs (#1263): the cabinet interior width derived from the design's
// furniture structure (commercial width minus the two lateral panels) and
// the live BOM profile slice — only consumed for pre-pin rows, so pinned
// designs never read the live catalog. An underivable width stays 0 and the
// engine reports OPENING_BOM_BODY_CONTEXT_MISSING; nothing is guessed.
func (s *Server) designOpeningBOMContext(r *http.Request, wc *domain.DesignWorkingCopy, profiles []engine.OpeningProfileBOMData) *engine.DesignOpeningBOMContext {
	ctx := &engine.DesignOpeningBOMContext{
		Ends:     engine.OpeningBOMDefaultEnds,
		Profiles: profiles,
	}
	pilot := designOpeningPilotItem(wc)
	if pilot == nil {
		return ctx
	}
	dims := domain.CommercialDimsFromParameters(pilot.Parameters)
	if dims == nil {
		return ctx
	}
	catalog, err := s.Store.GetFullCatalog(r.Context())
	if err != nil {
		return ctx
	}
	for _, module := range catalog.Modules {
		if module.ID != pilot.FurnitureDefinitionID || module.StructureID == "" {
			continue
		}
		for _, structure := range catalog.Structures {
			if structure.ID != module.StructureID {
				continue
			}
			if thickness, ok := engine.StructureSidePanelThicknessMm(structure, catalog); ok {
				if interior := dims.WidthMm - 2*thickness; interior > 0 {
					ctx.CabinetInteriorWidthMm = interior
				}
			}
		}
		break
	}
	return ctx
}

type openingDims struct{ widthMm, heightMm int }

// designOpeningPilotItem is the ONE module the v1 opening resolves over: the
// working copy's first REPRESENTABLE unit — an item with an explicit furniture
// definition. Definition-less rows (legacy seeds, placement-sync gaps) are not
// addressable furniture: skipping them keeps the pilot deterministic instead
// of silently landing on a row no surface can resolve (#1261 host smoke).
func designOpeningPilotItem(wc *domain.DesignWorkingCopy) *domain.DesignWorkingItem {
	for i := range wc.Items {
		if strings.TrimSpace(wc.Items[i].FurnitureDefinitionID) != "" {
			return &wc.Items[i]
		}
	}
	return nil
}

// designOpeningDims resolves the furniture's explicit dimensions from the
// pilot item (first representable unit). No explicit dims = nil: the caller
// sees DimsKnown=false, never a guessed size.
func designOpeningDims(wc *domain.DesignWorkingCopy) *openingDims {
	pilot := designOpeningPilotItem(wc)
	if pilot == nil {
		return nil
	}
	custom := domain.CommercialDimsFromParameters(pilot.Parameters)
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
		if !s.checkDesignAuthoringSurfaceGate(w, r, designID) {
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

	// The facade write (#1532): the selection maps onto per-furniture
	// override snapshots over the design's instances — ONE operation under
	// the working-copy version the plugin sends; the project grip version
	// bumps and the audit commits with the mutation. The real surface is the
	// project grip API; this facade dies with #1535.
	expectedVersion := strings.TrimSpace(body.ExpectedWorkingVersion)
	if expectedVersion == "" {
		wc, err := s.Store.GetDesignWorkingCopy(r.Context(), designID)
		if err != nil {
			respondWithDesignError(w, err)
			return
		}
		expectedVersion = wc.UpdatedAt.UTC().Format(time.RFC3339Nano)
	}
	if err := s.Store.ApplyDesignOpeningFacade(r.Context(), designID, selection, expectedVersion, storage.ProjectGripWriteMeta{
		RequestID: RequestIDFromContext(r.Context()), IP: clientIP(r),
	}); err != nil {
		if errors.Is(err, storage.ErrWorkingCopyVersionConflict) || errors.Is(err, storage.ErrWorkingCopyPreconditionRequired) {
			respondWithDesignError(w, err)
			return
		}
		var invalid *domain.GripSnapshotValidationError
		if errors.As(err, &invalid) {
			respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"code":    "INVALID_OPENING_CONFIGURATION",
				"message": invalid.Message,
				"details": map[string]any{
					"reason":    invalid.Code,
					"system":    selection.System,
					"profileId": selection.ProfileID,
				},
			})
			return
		}
		respondWithInternalError(w, err, "design opening facade write")
		return
	}

	// Respond with the authoritative state (re-read through the same path
	// the GET serves, so the client never renders a local guess).
	fresh, err := s.Store.GetDesignWorkingCopy(r.Context(), designID)
	if err != nil {
		respondWithInternalError(w, err, "design working copy read")
		return
	}
	s.handleDesignOpeningState(w, r, fresh)
}

func derefInt(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func derefFloat(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

// designOpeningResolveFailure is a fail-closed opening failure for the
// authoring resolve (#1264): the code surfaces verbatim (the opening
// family's contract codes), the message is workshop-facing.
type designOpeningResolveFailure struct {
	code    string
	message string
}

// designOpeningFrontsForResolve produces the v2 fronts of ONE furniture
// (#1532): the furniture's effective grip — its override when the resolve
// declares its instance id, else the design's first furniture's effective
// grip — yields the recipe for its type, and the engine producer emits the
// EdgeGrips fronts, the member hardware and the declared body modifiers
// from the FROZEN profiles. The A3 arithmetic (#1529) consumes them; the
// live catalog is never consulted here. Returns nil fronts with nil failure
// when there is nothing to constrain: no designId, no grip anywhere, or the
// handle baseline. A BLOCKED grip fails closed — a design that declares a
// grip never resolves a degraded layout, exactly like its quote never
// under-prices it.
func (s *Server) designOpeningFrontsForResolve(r *http.Request, req authoringResolveRequest, module *domain.Module, dims *engine.LayoutDims) ([]engine.OpeningResolvedFront, *engine.OpeningMembers, []engine.ResolvedOpeningBodyModifier, *designOpeningResolveFailure) {
	designID := strings.TrimSpace(req.Furniture.DesignID)
	if designID == "" {
		return nil, nil, nil, nil
	}
	if !isValidUUID(designID) {
		return nil, nil, nil, &designOpeningResolveFailure{code: "DESIGN_UNKNOWN", message: "el designId no es un identificador válido"}
	}
	facadeState, err := s.Store.GetDesignOpeningFacadeState(r.Context(), designID)
	if err != nil {
		return nil, nil, nil, &designOpeningResolveFailure{code: "DESIGN_UNKNOWN", message: "el diseño no existe o no es accesible"}
	}
	snapshot := facadeState.Snapshot
	ftype := facadeState.FurnitureType
	if instanceID := strings.TrimSpace(req.Furniture.FurnitureInstanceID); instanceID != "" {
		if !isValidUUID(instanceID) {
			return nil, nil, nil, &designOpeningResolveFailure{code: "FURNITURE_INSTANCE_UNKNOWN", message: "el furnitureInstanceId no es un identificador válido"}
		}
		effective, gripErr := s.Store.GetFurnitureEffectiveGrip(r.Context(), facadeState.ProjectID, instanceID)
		if gripErr != nil {
			var invalid *domain.GripSnapshotValidationError
			if errors.As(gripErr, &invalid) {
				return nil, nil, nil, &designOpeningResolveFailure{code: invalid.Code, message: invalid.Message}
			}
			return nil, nil, nil, &designOpeningResolveFailure{code: "DESIGN_UNKNOWN", message: "el agarre del mueble no está disponible"}
		}
		snapshot = effective
	}
	if module != nil && strings.TrimSpace(module.FurnitureType) != "" {
		ftype = module.FurnitureType
	}
	if snapshot == nil {
		return nil, nil, nil, nil
	}
	if err := domain.ValidateGripSnapshotShape(snapshot); err != nil {
		return nil, nil, nil, &designOpeningResolveFailure{code: "GRIP_SNAPSHOT_INVALID", message: err.Error()}
	}
	recipe, recipeErr := snapshot.GripRecipeFor(ftype)
	if recipeErr != nil {
		return nil, nil, nil, &designOpeningResolveFailure{code: "GRIP_SNAPSHOT_INVALID", message: recipeErr.Error()}
	}
	fronts, frontsErr := engine.ProjectGripFronts(recipe)
	if frontsErr != nil {
		return nil, nil, nil, &designOpeningResolveFailure{code: frontsErr.Code, message: frontsErr.Message}
	}
	if len(fronts) == 0 {
		return nil, nil, nil, nil
	}
	// #1536 r2: the between profile's declared strips/hardware attach even
	// when the TOP profile declares no parts (the suggested 8006 L has an
	// empty BOMMembers — usability does not require top parts, and dropping
	// the between content here silently lost its strips while its modifiers
	// still applied).
	betweenStrips := engine.ProjectGripBetweenStrips(recipe.BetweenProfile)
	betweenHWID, betweenHWHeight, betweenHWDepth := engine.ProjectGripBetweenHardware(recipe.BetweenProfile)
	members := engine.ProjectGripMembers(recipe.TopProfile)
	if members == nil && (len(betweenStrips) > 0 || betweenHWID != "") {
		members = &engine.OpeningMembers{}
	}
	if members != nil {
		members.BetweenComponentMembers = betweenStrips
		members.BetweenProfileHardwareID, members.BetweenProfileHeightMm, members.BetweenProfileDepthMm =
			betweenHWID, betweenHWHeight, betweenHWDepth
	}
	modifiers, modErr := engine.ResolveProjectGripModifiers(recipe)
	if modErr != nil {
		return nil, nil, nil, &designOpeningResolveFailure{code: modErr.Code, message: modErr.Message}
	}
	// #1287 / §13.3: the resolved declared body effects ride with the fronts
	// so the layout pass materializes the notch from the SAME definition.
	return fronts, members, modifiers, nil
}
