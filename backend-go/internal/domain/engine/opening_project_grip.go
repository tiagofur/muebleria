package engine

// Project grip producer (#1532, ADR-0009 Amendment 1 A2.3/A7): turns the
// furniture's effective frozen snapshot recipe into the contract v2 inputs —
// OpeningResolvedFront.EdgeGrips, the member hardware the layout
// materializes, the declared body modifiers and the BOM lines (the top run
// as v1, plus one run of the between profile per between edge of the stack).
// The A3 arithmetic is #1529's and is consumed, never re-derived here.

import (
	"fmt"
	"sort"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ProjectGripFronts produces the v2 fronts of one furniture from its
// effective recipe: nil (no constraint) when the grip constrains nothing
// (handle mode, or a recipe whose values are absent — the truthful no-grip
// baseline). The front carries EdgeGrips only: the layout pass reads the
// stack from the boards and applies A3 (#1529); position never comes from a
// user selection (A5). A recipe that cannot produce its grips (a gola
// without a usable frozen top profile, or the migrated bottom-gola marker)
// fails closed — never a silent no-grip resolve.
func ProjectGripFronts(recipe *domain.GripSnapshotRecipe) ([]OpeningResolvedFront, *OpeningResolutionError) {
	if recipe == nil {
		return nil, nil
	}
	if recipe.LegacyBottomGola {
		return nil, openingFail(OpeningErrStackedFronts,
			"el agarre inferior del diseño migrado no tiene equivalente en el agarre por bordes; aplica de nuevo el agarre del mueble con el estilo del taller")
	}
	grips := &OpeningEdgeGrips{}
	switch recipe.Mode {
	case domain.GripModeGola:
		if recipe.TopProfile == nil || recipe.TopProfile.FrontDiscountTopMm == nil || *recipe.TopProfile.FrontDiscountTopMm <= 0 {
			return nil, openingFail(OpeningErrLayoutInvalid,
				"la receta de gola congelada no tiene el descuento del frente de arriba")
		}
		discount := float64(*recipe.TopProfile.FrontDiscountTopMm)
		grips.TopDiscountMm = &discount
		if recipe.BetweenProfile != nil && recipe.BetweenProfile.FrontDiscountBetweenMm != nil && *recipe.BetweenProfile.FrontDiscountBetweenMm > 0 {
			between := float64(*recipe.BetweenProfile.FrontDiscountBetweenMm)
			grips.BetweenDiscountMm = &between
		}
	case domain.GripModeBottomOverhang:
		if recipe.OverhangMm == nil || *recipe.OverhangMm <= 0 {
			return nil, openingFail(OpeningErrLayoutInvalid,
				"la receta de rebase congelada no tiene los milímetros")
		}
		overhang := *recipe.OverhangMm
		grips.BottomOverhangMm = &overhang
	case domain.GripModeHandle:
		// A handled front consumes nothing: the baseline resolution.
	}
	if grips.empty() {
		return nil, nil
	}
	return []OpeningResolvedFront{{
		ZoneID:    "grip",
		Access:    "hinged",
		EdgeGrips: grips,
		Rules: OpeningResolvedFrontRules{
			Direction:   "vertical",
			Positioning: "project_grip",
			Ratio:       1,
			RatioSum:    1,
		},
	}}, nil
}

// ProjectGripEdgeGrips returns the recipe's edge grips alone — the stack
// report and the BOM resolution consume the numbers without a front shell.
// A recipe that cannot produce its grips fails closed like the fronts do.
func ProjectGripEdgeGrips(recipe *domain.GripSnapshotRecipe) (OpeningEdgeGrips, *OpeningResolutionError) {
	fronts, resErr := ProjectGripFronts(recipe)
	if resErr != nil {
		return OpeningEdgeGrips{}, resErr
	}
	if len(fronts) == 0 {
		return OpeningEdgeGrips{}, nil
	}
	return *fronts[0].EdgeGrips, nil
}

// ProjectGripBetweenStrips projects the frozen BETWEEN profile's declared
// component members (the italian strip between fronts, #1536): the same
// component projection ProjectGripMembers runs over the top profile, from
// the between copy. nil profile or members without declared dims place
// nothing (truthful absence).
func ProjectGripBetweenStrips(between *domain.FrozenGripProfile) []OpeningComponentMember {
	if between == nil || between.BOMMembers == nil {
		return nil
	}
	strips := []OpeningComponentMember{}
	for key, member := range between.BOMMembers {
		if member.ComponentID == "" {
			continue
		}
		// v2 strip contract (#1530/#1536): height_mm with no dimensions_mm
		// derives the depth from the profile's own band (the #1534 editor
		// authors exactly this shape) — never an invented number.
		depth, height := 0.0, 0.0
		if member.DimensionsMm != nil {
			depth, height = (*member.DimensionsMm)[1], (*member.DimensionsMm)[2]
		} else if member.HeightMm != nil && *member.HeightMm > 0 && between.ProfileDepthMm != nil && *between.ProfileDepthMm > 0 {
			height = *member.HeightMm
			depth = *between.ProfileDepthMm
		}
		if depth <= 0 || height <= 0 {
			continue
		}
		strips = append(strips, OpeningComponentMember{
			Key: key, ComponentID: member.ComponentID, DepthMm: depth, HeightMm: height,
		})
	}
	return strips
}

// ProjectGripBetweenHardware projects the frozen BETWEEN profile's hardware
// run onto the layout's derived-hardware input (#1536): the C profile
// between fronts places its own run — ONE projection, from the frozen copy.
// Empty id = the between profile declares no hardware (truthful absence).
func ProjectGripBetweenHardware(between *domain.FrozenGripProfile) (string, float64, float64) {
	if between == nil {
		return "", 0, 0
	}
	height := derefFrozenFloat(between.ProfileHeightMm)
	depth := derefFrozenFloat(between.ProfileDepthMm)
	profile, ok := between.BOMMembers[domain.GolaRoleProfile]
	if !ok || profile.HardwareID == "" || height <= 0 || depth <= 0 {
		return "", 0, 0
	}
	return profile.HardwareID, height, depth
}

// ProjectGripMembers projects the frozen top profile's declared members onto
// the layout's derived-hardware input — the same projection
// OpeningMembersFromFrozenPin performs over a pin, from the frozen copy
// instead (ONE member vocabulary, never two). nil = the profile declares no
// members.
func ProjectGripMembers(top *domain.FrozenGripProfile) *OpeningMembers {
	if top == nil {
		return nil
	}
	members := &OpeningMembers{
		ProfileHeightMm: derefFrozenFloat(top.ProfileHeightMm),
		ProfileDepthMm:  derefFrozenFloat(top.ProfileDepthMm),
	}
	if top.BOMMembers == nil {
		return nil
	}
	if profile, ok := top.BOMMembers[domain.GolaRoleProfile]; ok {
		members.ProfileHardwareID = profile.HardwareID
	}
	if supports, ok := top.BOMMembers[domain.GolaRoleSupports]; ok {
		members.SupportHardwareID = supports.HardwareID
		if supports.SpacingMm != nil {
			members.SupportSpacingMm = *supports.SpacingMm
		}
		if supports.DimensionsMm != nil {
			members.SupportDimsMm = refFrozenDims(*supports.DimensionsMm)
		}
	}
	if caps, ok := top.BOMMembers[domain.GolaRoleEndCaps]; ok {
		members.CapHardwareID = caps.HardwareID
		if caps.DimensionsMm != nil {
			members.CapDimsMm = refFrozenDims(*caps.DimensionsMm)
		}
	}
	// Component members (panels — the italian gola strip) place as boards:
	// declared dims [along-run, depth, height]; without declared dims the
	// member places nothing — EXCEPT the v2 strip contract (#1530/#1536):
	// a strip with height_mm and no dimensions_mm derives its depth from
	// the profile's own band (profile_depth_mm — the #1534 editor authors
	// exactly this shape), never an invented number.
	for key, member := range top.BOMMembers {
		if member.ComponentID == "" {
			continue
		}
		depth, height := 0.0, 0.0
		if member.DimensionsMm != nil {
			depth, height = (*member.DimensionsMm)[1], (*member.DimensionsMm)[2]
		} else if member.HeightMm != nil && *member.HeightMm > 0 && top.ProfileDepthMm != nil && *top.ProfileDepthMm > 0 {
			height = *member.HeightMm
			depth = *top.ProfileDepthMm
		}
		if depth <= 0 || height <= 0 {
			continue
		}
		members.ComponentMembers = append(members.ComponentMembers, OpeningComponentMember{
			Key: key, ComponentID: member.ComponentID, DepthMm: depth, HeightMm: height,
		})
	}
	if members.ProfileHardwareID == "" && members.SupportHardwareID == "" && members.CapHardwareID == "" && len(members.ComponentMembers) == 0 {
		return nil
	}
	return members
}

// ResolveProjectGripModifiers resolves the frozen profiles' declared body
// effects over the project grip's boundaries: the top profile at "top" and
// the between profile at "between". ONE effect definition feeds the layout
// pass (visible notch/bevel), the BOM annotations and the future machining
// slice. A declared effect without a consumer at its boundary fails closed —
// never a silently dropped declaration (A6).
func ResolveProjectGripModifiers(recipe *domain.GripSnapshotRecipe) ([]ResolvedOpeningBodyModifier, *OpeningResolutionError) {
	if recipe == nil || recipe.Mode != domain.GripModeGola {
		return nil, nil
	}
	resolved := []ResolvedOpeningBodyModifier{}
	if recipe.TopProfile != nil {
		topData := frozenProfileBodyData(recipe.TopProfile)
		for _, modifier := range topData.BodyModifiers {
			effect, resErr := resolveOpeningBodyModifierEffect(modifier, "top", 0, nil, "top", topData)
			if resErr != nil {
				return nil, resErr
			}
			effect.ProfileID = recipe.TopProfile.ProfileID
			effect.Boundary = "top"
			resolved = append(resolved, effect)
		}
	}
	if recipe.BetweenProfile != nil {
		betweenData := frozenProfileBodyData(recipe.BetweenProfile)
		if !openingPlacementCompatible(betweenData.CompatiblePlacements, "between") {
			return nil, openingFail(OpeningErrBodyModifierPlacement,
				fmt.Sprintf("el perfil %s no declara compatible la frontera between", betweenData.ProfileID))
		}
		for _, modifier := range betweenData.BodyModifiers {
			effect, resErr := resolveOpeningBodyModifierEffect(modifier, "between", 0, nil, "between", betweenData)
			if resErr != nil {
				return nil, resErr
			}
			effect.ProfileID = recipe.BetweenProfile.ProfileID
			effect.Boundary = "between"
			resolved = append(resolved, effect)
		}
	}
	return resolved, nil
}

// frozenProfileBodyData adapts a frozen profile onto the shared body-effect
// input (the entity modifiers map onto the contract shape once, here).
func frozenProfileBodyData(profile *domain.FrozenGripProfile) OpeningProfileBodyData {
	return OpeningProfileBodyData{
		ProfileID:            profile.ProfileID,
		CompatiblePlacements: profile.CompatiblePlacements,
		ProfileDepthMm:       derefFrozenFloat(profile.ProfileDepthMm),
		ProfileHeightMm:      derefFrozenFloat(profile.ProfileHeightMm),
		BodyModifiers:        ContractBodyModifiersFromEntities(profile.BodyModifiers),
	}
}

// ProjectGripBOMProfile is the frozen BOM slice of one profile: identity,
// revision and members (the quote's provenance — never a live join).
type ProjectGripBOMProfile struct {
	ProfileID  string
	Version    int64
	BOMMembers map[string]OpeningContractBOMMember
}

// ProjectGripBOMInput is the body context the project grip's BOM needs: the
// run's physical inputs (interior width, end conditions), the frozen top and
// between profiles and the number of between edges the furniture's stack has.
type ProjectGripBOMInput struct {
	CabinetInteriorWidthMm int
	Ends                   OpeningBOMEndConditions
	Top                    *ProjectGripBOMProfile
	Between                *ProjectGripBOMProfile
	// BetweenEdgeCount is the stack's between edges (rows − 1, read from the
	// furniture's boards). 0 = a single-row front: no between run exists.
	BetweenEdgeCount int
}

// ResolveProjectGripBOM generates the project grip's BOM lines: the top
// profile's run (the v1 rules verbatim) plus, when the stack has between
// edges, the between profile's runs — aggregated into one line per member
// with the edge count as the multiplier. Pure and deterministic; the same
// member rules, units and identities as ResolveOpeningBOM.
func ResolveProjectGripBOM(input ProjectGripBOMInput) ([]OpeningResolvedBOMLine, *OpeningResolutionError) {
	if input.CabinetInteriorWidthMm <= 0 {
		return nil, openingFail(OpeningErrBOMInvalid,
			"el interior del gabinete debe ser mayor a 0 para dimensionar corridas")
	}
	for _, end := range []struct{ name, value string }{{"leftEnd", input.Ends.LeftEnd}, {"rightEnd", input.Ends.RightEnd}} {
		if end.value != OpeningEndExposed && end.value != OpeningEndClosed {
			return nil, openingFail(OpeningErrBOMInvalid,
				fmt.Sprintf("la condición de extremo %s=%q no es válida (exposed|closed)", end.name, end.value))
		}
	}
	exposedEnds := 0
	for _, end := range []string{input.Ends.LeftEnd, input.Ends.RightEnd} {
		if end == OpeningEndExposed {
			exposedEnds++
		}
	}
	lines := []OpeningResolvedBOMLine{}
	type mounted struct {
		profile *ProjectGripBOMProfile
		boundary string
		runs    int
	}
	mountedProfiles := []mounted{{input.Top, "top", 1}}
	if input.BetweenEdgeCount > 0 {
		if input.Between == nil {
			return nil, openingFail(OpeningErrBOMInvalid,
				"la pila tiene aristas entre frentes pero la receta congelada no declara perfil entre frentes")
		}
		mountedProfiles = append(mountedProfiles, mounted{input.Between, "between", input.BetweenEdgeCount})
	}
	for _, run := range mountedProfiles {
		if run.profile == nil || len(run.profile.BOMMembers) == 0 {
			continue
		}
		if run.profile.Version <= 0 {
			return nil, openingFail(OpeningErrBOMInvalid,
				fmt.Sprintf("el perfil %s no tiene revisión referenciable", run.profile.ProfileID))
		}
		// Unknown member keys fail closed; component members are deliberate
		// panel data the despiece consumes — never hardware demand here.
		unknownKeys := []string{}
		for key, member := range run.profile.BOMMembers {
			if openingBOMMemberKeyKnown(key) || member.ComponentID != "" {
				continue
			}
			unknownKeys = append(unknownKeys, key)
		}
		sort.Strings(unknownKeys)
		if len(unknownKeys) > 0 {
			return nil, openingFail(OpeningErrBOMInvalid,
				fmt.Sprintf("el perfil %s declara claves de BOM desconocidas %v", run.profile.ProfileID, unknownKeys))
		}
		data := OpeningProfileBOMData{ProfileID: run.profile.ProfileID, Version: run.profile.Version, BOMMembers: run.profile.BOMMembers}
		for _, key := range openingBOMMemberKeys {
			member, declared := run.profile.BOMMembers[key]
			if !declared {
				continue
			}
			line, resErr := resolveOpeningBOMLine(data, key, member, run.boundary,
				input.CabinetInteriorWidthMm, exposedEnds)
			if resErr != nil {
				return nil, resErr
			}
			if run.runs > 1 {
				line.Quantity *= float64(run.runs)
			}
			lines = append(lines, line)
		}
	}
	return lines, nil
}

// OpeningFrontStackReport resolves a furniture's front stack (the boards of
// its default expansion — the SAME convention the BOM's stackBoards uses)
// and applies A3 over the given edge grips: the per-row built measures the
// project grip's API reports (#1532) and the between-edge count the BOM
// needs. A furniture without front boards resolves zero rows (nothing to
// grip); a stack A3 cannot read fails closed.
func OpeningFrontStackReport(module domain.Module, catalog domain.Catalog, dims LayoutDims, optionChoices map[string]string, grips OpeningEdgeGrips) (*OpeningEdgeStackResolution, error) {
	boards, err := resolveLayoutBoards(module, catalog, dims, optionChoices, resolveOptions{})
	if err != nil {
		return nil, err
	}
	_, resolution, err := openingA3Poses(boards, grips, float64(dims.HeightMm))
	if err != nil {
		return nil, err
	}
	return resolution, nil
}

func derefFrozenFloat(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

func refFrozenDims(dims [3]float64) *[3]float64 {
	copied := dims
	return &copied
}
