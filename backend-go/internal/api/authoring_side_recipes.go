package api

import (
	"errors"
	"log/slog"
	"net/http"

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
func (s *Server) resolvedSideRecipes(r *http.Request) ([]engine.ResolvedSideRecipe, string) {
	ctx := r.Context()
	release, err := s.Store.GetCurrentPublishedRelease(ctx, uuid.MustParse(domain.GraneteStandardLibraryID))
	if err != nil {
		if !errors.Is(err, storage.ErrLibraryReleaseNotFound) {
			slog.Error("resolve profile pin load failed", "error", err)
		}
		return nil, ""
	}
	profiles, err := application.HardwareProfilesForRelease(ctx, s.Store, release.ID)
	if err != nil {
		slog.Error("resolve pinned profile load failed", "release", release.ID, "error", err)
		return nil, ""
	}
	assignments, err := s.Store.ListAllComponentSideAssignments(ctx)
	if err != nil {
		slog.Error("resolve side assignment load failed", "error", err)
		return nil, ""
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
	return recipes, release.ID.String()
}
