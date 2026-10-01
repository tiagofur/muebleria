package api

import (
	"errors"
	"log/slog"
	"net/http"
	"sort"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// resolvedSideRecipes loads the resolve's server-side recipe inputs (#916):
// the organization's component side assignments joined with the pinned
// hardware profiles of the currently published Standard release, synthesized
// into (catalogComponentID, side)-keyed recipes. Degradation is honest and
// explicit:
//   - no published release / no manifest  -> no recipes (profiles
//     unavailable; unauthored relationships stay at the
//     TECHNICAL_PROFILE_REQUIRED terminal), empty release id;
//   - assignment pointing at a missing/inactive profile or a profile
//     without a recipe body for that face -> that key simply resolves no
//     recipe (the terminal stands); never a guessed fallback.
//
// Errors that indicate real breakage (DB down) are logged and degrade the
// same way — the resolve stays usable while the incident is visible.
func (s *Server) resolvedSideRecipes(r *http.Request) ([]engine.ResolvedSideRecipe, string, map[string]domain.HardwareProfile) {
	ctx := r.Context()
	release, err := s.Store.GetCurrentPublishedRelease(ctx, uuid.MustParse(domain.GraneteStandardLibraryID))
	if err != nil {
		if !errors.Is(err, storage.ErrLibraryReleaseNotFound) {
			slog.Error("resolve profile pin load failed", "error", err)
		}
		return nil, "", nil
	}
	profiles, err := application.HardwareProfilesForRelease(ctx, s.Store, release.ID)
	if err != nil {
		slog.Error("resolve pinned profile load failed", "release", release.ID, "error", err)
		return nil, "", nil
	}
	assignments, err := s.Store.ListAllComponentSideAssignments(ctx)
	if err != nil {
		slog.Error("resolve side assignment load failed", "error", err)
		return nil, "", nil
	}

	profileByID := make(map[string]domain.HardwareProfile, len(profiles))
	for _, profile := range profiles {
		profileByID[profile.ID] = profile
	}
	recipes := make([]engine.ResolvedSideRecipe, 0, len(assignments))
	for _, assignment := range assignments {
		profile, ok := profileByID[assignment.ProfileID]
		if !ok || !profile.Active || profile.Recipe == nil {
			continue
		}
		for _, variant := range profile.Recipe.Variants {
			if variant.TargetFace != assignment.Side {
				continue
			}
			rules := make([]engine.ContactOperationRule, len(variant.Rules))
			for i, rule := range variant.Rules {
				rules[i] = engine.ContactOperationRule{
					RuleID: rule.RuleID, RuleRevision: rule.RuleRevision,
					ParticipantRole: rule.ParticipantRole, OperationRole: rule.OperationRole,
					EntryFace: rule.EntryFace, OffsetMm: rule.OffsetMm, Axis: rule.Axis,
					DiameterMm: rule.DiameterMm, DepthMm: rule.DepthMm,
				}
			}
			recipes = append(recipes, engine.ResolvedSideRecipe{
				CatalogComponentID:       assignment.ComponentID,
				Side:                     assignment.Side,
				RecipeID:                 profile.Recipe.RecipeID,
				RecipeRevision:           profile.Recipe.RecipeRevision,
				TechnicalProfileID:       profile.ID,
				TechnicalProfileRevision: profile.Revision,
				Rules:                    rules,
			})
		}
	}
	return recipes, release.ID.String(), profileByID
}

// deriveHardwareProfileDemand projects the commercial consumption of the
// resolved profiles (#917): for every relationship that reached
// MACHINING_READY through server-resolved profiles, each VERIFIED contact
// consumes one application of the profile's items. Aggregated by catalog
// hardware id with a per-relationship provenance trail. The source is the
// profile RESOLUTION (assignments × pinned items) — never the drilling
// output: a hardware producing five operations is still one purchase line,
// and the machining geometry stays out of the commercial path.
func deriveHardwareProfileDemand(
	machining *engine.AuthoringMachining,
	profilesByID map[string]domain.HardwareProfile,
) []engine.HardwareProfileDemandLine {
	if machining == nil || len(profilesByID) == 0 || len(machining.JoineryStatuses) == 0 {
		return nil
	}
	profileByRelationship := map[string]domain.HardwareProfile{}
	recipeByRelationship := map[string][2]string{}
	for _, operation := range machining.Operations {
		provenance := operation.Provenance
		if provenance.TechnicalProfileID == "" || provenance.RelationshipID == "" {
			continue
		}
		profile, ok := profilesByID[provenance.TechnicalProfileID]
		if !ok || len(profile.Items) == 0 {
			continue
		}
		profileByRelationship[provenance.RelationshipID] = profile
		recipeByRelationship[provenance.RelationshipID] = [2]string{provenance.CatalogRuleID, provenance.RecipeRevision}
	}
	if len(profileByRelationship) == 0 {
		return nil
	}

	type accumulator struct {
		quantity float64
		sources  []engine.HardwareProfileDemandSource
	}
	byHardware := map[string]*accumulator{}
	order := []string{}
	for _, status := range machining.JoineryStatuses {
		profile, ok := profileByRelationship[status.RelationshipID]
		if !ok || status.Stage != engine.JoineryMachiningReady {
			continue
		}
		verifiedContacts := 0
		for _, contact := range status.Contacts {
			if contact.Status == "VALID" {
				verifiedContacts++
			}
		}
		if verifiedContacts == 0 {
			continue
		}
		recipe := recipeByRelationship[status.RelationshipID]
		for _, item := range profile.Items {
			line, ok := byHardware[item.HardwareID]
			if !ok {
				line = &accumulator{}
				byHardware[item.HardwareID] = line
				order = append(order, item.HardwareID)
			}
			line.quantity += item.Quantity * float64(verifiedContacts)
			line.sources = append(line.sources, engine.HardwareProfileDemandSource{
				TechnicalProfileID:       profile.ID,
				TechnicalProfileRevision: profile.Revision,
				RecipeID:                 recipe[0],
				RecipeRevision:           recipe[1],
				RelationshipID:           status.RelationshipID,
				ContactCount:             verifiedContacts,
			})
		}
	}
	if len(order) == 0 {
		return nil
	}
	sort.Strings(order)
	lines := make([]engine.HardwareProfileDemandLine, 0, len(order))
	for _, hardwareID := range order {
		acc := byHardware[hardwareID]
		lines = append(lines, engine.HardwareProfileDemandLine{
			HardwareID: hardwareID,
			Quantity:   acc.quantity,
			Sources:    acc.sources,
		})
	}
	return lines
}
