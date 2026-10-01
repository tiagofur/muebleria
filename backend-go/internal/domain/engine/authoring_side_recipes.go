package engine

// Server-resolved side recipes (#916): the api layer loads the pinned
// hardware profiles (release-resolved, no latest) and the organization's
// component side assignments, synthesizes one recipe per
// (catalogComponentID, side) pair, and hands the lookup to the engine. The
// engine joins relationship targets to boards (catalogComponentID) and the
// targets' declared faces, and injects complete recipe sets into
// fixed-shelf-side relationships that declare none — authored-override-wins.

// ResolvedSideRecipe is one synthesized recipe keyed by the catalog
// component and the canonical contact side of that component's face.
type ResolvedSideRecipe struct {
	CatalogComponentID       string                 `json:"catalogComponentId"`
	Side                     string                 `json:"side"`
	RecipeID                 string                 `json:"recipeId"`
	RecipeRevision           string                 `json:"recipeRevision"`
	TechnicalProfileID       string                 `json:"technicalProfileId"`
	TechnicalProfileRevision string                 `json:"technicalProfileRevision"`
	Rules                    []ContactOperationRule `json:"rules"`
}

// injectResolvedSideRecipes returns the relationships with server-resolved
// recipes injected into fixed-shelf-side relationships that declare none.
// Injection is all-or-nothing per relationship: every target must resolve a
// recipe, otherwise the relationship keeps its honest
// TECHNICAL_PROFILE_REQUIRED terminal — a partial set would flip the
// terminal into a coverage rejection and change the failure semantics.
func injectResolvedSideRecipes(relationships []AuthoringRelationship, boards []layoutBoard, resolved []ResolvedSideRecipe) []AuthoringRelationship {
	if len(resolved) == 0 || len(relationships) == 0 {
		return relationships
	}
	componentByBoard := make(map[string]string, len(boards))
	for i := range boards {
		componentByBoard[boards[i].id] = boards[i].catalogComponentID
	}
	byKey := make(map[string]ResolvedSideRecipe, len(resolved))
	for _, recipe := range resolved {
		byKey[recipe.CatalogComponentID+"\x00"+recipe.Side] = recipe
	}
	result := append([]AuthoringRelationship(nil), relationships...)
	for i := range result {
		relationship := &result[i]
		if relationship.Kind != "fixed-shelf-side" || len(relationship.Recipes) > 0 {
			continue
		}
		synthesized := make([]ContactOperationRecipe, 0, len(relationship.Targets))
		complete := true
		for _, anchor := range relationship.Targets {
			componentID := componentByBoard[anchor.ComponentInstanceID]
			recipe, ok := byKey[componentID+"\x00"+anchor.Face]
			if !ok {
				complete = false
				break
			}
			synthesized = append(synthesized, ContactOperationRecipe{
				ContactID:                relationship.RelationshipID + ":" + anchor.ComponentInstanceID,
				RecipeID:                 recipe.RecipeID,
				RecipeRevision:           recipe.RecipeRevision,
				TechnicalProfileID:       recipe.TechnicalProfileID,
				TechnicalProfileRevision: recipe.TechnicalProfileRevision,
				Rules:                    append([]ContactOperationRule(nil), recipe.Rules...),
			})
		}
		if !complete || len(synthesized) == 0 {
			continue
		}
		relationship.Recipes = synthesized
	}
	return result
}
