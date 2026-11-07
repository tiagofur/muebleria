package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// Design-opening commercial derivation (#1263) — ONE resolution shared by the
// design-first Q1 path and the requote path: the same persisted intent, the
// same pin-first profile slice and the same body context produce the same
// frozen lines and the same pricing demand. The design opening endpoint's
// payload comes from the same engine functions; there is no second
// interpretation of a design's opening.
//
// Fail-closed: a gola selection that cannot produce its BOM fails the quote
// with ErrInvalidRevisionSnapshot — a design that DECLARES a gola never
// quotes without it (never a silent under-quote). A selection whose datasheet
// declares no members legitimately produces no lines and no demand.

// designOpeningUnit is the design-unit slice the derivation resolves against:
// one furniture of the design with its stable commercial line.
type designOpeningUnit struct {
	FurnitureInstanceID   string
	FurnitureDefinitionID string
	QuoteLineID           string
	Parameters            map[string]any
	MaterialChoices       map[string]string
}

// designOpeningCommercial is the derived commercial truth of one design's
// opening: the frozen snapshot section plus the pricing demand per furniture
// instance (merged into the profileDemandPerItem matrix by the snapshot
// builders — the one hardware channel, one validation).
type designOpeningCommercial struct {
	Snapshot         []domain.QuoteCommercialOpeningBOM
	DemandByInstance map[string][]engine.HardwareProfileDemandLine
}

// deriveDesignOpeningCommercial resolves the design's opening from the
// project grip (#1532): each unit's effective frozen snapshot (its override,
// else the project's) yields the recipe for its furniture type, and the
// engine resolves the BOM from the FROZEN profiles — the top run with the v1
// rules plus one run of the between profile per between edge of the unit's
// stack. nil return = nothing to contribute (no grip anywhere, or every
// governed unit declares no members) — pricing stays byte-identical.
//
// Fail-closed: a grip that cannot produce its BOM fails the quote with
// ErrInvalidRevisionSnapshot — a design that DECLARES a gola never quotes
// without it (never a silent under-quote). A recipe without declared
// members legitimately produces no lines and no demand.
func (s *PostgresStore) deriveDesignOpeningCommercial(ctx context.Context, projectID string, units []designOpeningUnit) (*designOpeningCommercial, error) {
	if len(units) == 0 {
		return nil, nil
	}
	grip, err := s.GetProjectGrip(ctx, projectID)
	if err != nil {
		return nil, err
	}
	catalog, err := s.GetFullCatalog(ctx)
	if err != nil {
		return nil, err
	}
	commercial := &designOpeningCommercial{
		Snapshot:         []domain.QuoteCommercialOpeningBOM{},
		DemandByInstance: map[string][]engine.HardwareProfileDemandLine{},
	}
	for _, unit := range units {
		var override *domain.GripSnapshot
		for _, candidate := range grip.Overrides {
			if candidate.FurnitureInstanceID == unit.FurnitureInstanceID {
				override = candidate.Snapshot
				break
			}
		}
		snapshot := domain.EffectiveGripSnapshot(override, grip.Snapshot)
		if snapshot == nil {
			continue
		}
		if err := domain.ValidateGripSnapshotShape(snapshot); err != nil {
			return nil, fmt.Errorf("%w: la copia congelada del agarre no se puede usar: %s", domain.ErrInvalidRevisionSnapshot, err.Error())
		}
		ftype := catalogModuleType(catalog, unit.FurnitureDefinitionID)
		recipe, recipeErr := snapshot.GripRecipeFor(ftype)
		if recipeErr != nil {
			return nil, fmt.Errorf("%w: %s", domain.ErrInvalidRevisionSnapshot, recipeErr.Error())
		}
		if recipe == nil || recipe.Mode != domain.GripModeGola {
			// Handle consumes nothing; a bottom_overhang recipe carries no
			// profile and no hardware (no BOM, no demand).
			continue
		}
		dims := domain.CommercialDimsFromParameters(unit.Parameters)
		if dims == nil {
			return nil, fmt.Errorf("%w: la apertura del diseño no puede resolverse sin dimensiones explícitas", domain.ErrInvalidRevisionSnapshot)
		}
		interiorWidth := openingQuoteInteriorWidth(unit, dims.WidthMm, catalog)
		betweenEdges, err := s.designGripBetweenEdges(ctx, catalog, unit, recipe, dims)
		if err != nil {
			return nil, err
		}
		lines, bomErr := engine.ResolveProjectGripBOM(engine.ProjectGripBOMInput{
			CabinetInteriorWidthMm: interiorWidth,
			Ends:                   engine.OpeningBOMDefaultEnds,
			Top:                    frozenBOMProfile(recipe.TopProfile),
			Between:                frozenBOMProfile(recipe.BetweenProfile),
			BetweenEdgeCount:       betweenEdges,
		})
		if bomErr != nil {
			return nil, fmt.Errorf("%w: el BOM de apertura del diseño no puede resolverse (%s)", domain.ErrInvalidRevisionSnapshot, bomErr.Code)
		}
		if len(lines) == 0 {
			// The frozen profiles declare no hardware members: nothing to
			// price, no section to freeze — the truthful emptiness.
			continue
		}
		if unit.QuoteLineID == "" {
			return nil, fmt.Errorf("%w: el BOM de apertura de la unidad %s no tiene línea comercial estable", domain.ErrInvalidRevisionSnapshot, unit.FurnitureInstanceID)
		}
		demand := make([]engine.HardwareProfileDemandLine, 0, len(lines))
		quoteLines := make([]domain.QuoteCommercialOpeningBOMLine, 0, len(lines))
		for _, line := range lines {
			// The FROZEN identity names the profile in the quote (A7): the
			// live catalog code is editable and a join could lie about what
			// was quoted. The version is the frozen revision too.
			quoteLines = append(quoteLines, domain.QuoteCommercialOpeningBOMLine{
				LineID: line.LineID, MemberKey: line.MemberKey, HardwareID: line.HardwareID,
				ProfileID: line.ProfileID, ProfileCode: frozenProfileCode(recipe, line.ProfileID),
				ProfileVersion: line.ProfileVersion,
				Boundary: line.Boundary, Rule: line.Rule, Quantity: line.Quantity,
				Unit: line.Unit, CutLengthMm: line.CutLengthMm,
			})
			demand = append(demand, engine.HardwareProfileDemandLine{
				HardwareID: line.HardwareID,
				Quantity:   line.Quantity,
			})
		}
		commercial.Snapshot = append(commercial.Snapshot, domain.QuoteCommercialOpeningBOM{
			QuoteLineID:  unit.QuoteLineID,
			UnitQuantity: 1,
			Lines:        quoteLines,
		})
		commercial.DemandByInstance[unit.FurnitureInstanceID] = demand
	}
	if len(commercial.Snapshot) == 0 {
		return nil, nil
	}
	return commercial, nil
}

// designGripBetweenEdges counts the between edges of a unit's front stack —
// the number of between-profile runs the BOM adds. Only a recipe that
// declares a between profile needs the stack; a unit whose stack cannot be
// read fails closed (never a guessed count).
func (s *PostgresStore) designGripBetweenEdges(ctx context.Context, catalog domain.Catalog, unit designOpeningUnit, recipe *domain.GripSnapshotRecipe, dims *domain.ItemCustomDims) (int, error) {
	if recipe.BetweenProfile == nil {
		return 0, nil
	}
	var module *domain.Module
	for i := range catalog.Modules {
		if catalog.Modules[i].ID == unit.FurnitureDefinitionID {
			module = &catalog.Modules[i]
			break
		}
	}
	if module == nil {
		return 0, fmt.Errorf("%w: la definición %s del mueble no existe en el catálogo", domain.ErrInvalidRevisionSnapshot, unit.FurnitureDefinitionID)
	}
	grips, gripsErr := engine.ProjectGripEdgeGrips(recipe)
	if gripsErr != nil {
		return 0, fmt.Errorf("%w: %s", domain.ErrInvalidRevisionSnapshot, gripsErr.Message)
	}
	stack, stackErr := engine.OpeningFrontStackReport(*module, catalog, engine.LayoutDims{
		WidthMm: dims.WidthMm, HeightMm: dims.HeightMm, DepthMm: dims.DepthMm,
	}, unit.MaterialChoices, grips)
	if stackErr != nil {
		return 0, fmt.Errorf("%w: la pila de frentes de %s no se puede leer: %s", domain.ErrInvalidRevisionSnapshot, unit.FurnitureInstanceID, stackErr.Error())
	}
	if stack == nil {
		return 0, nil
	}
	if len(stack.Rows) <= 1 {
		return 0, nil
	}
	return len(stack.Rows) - 1, nil
}

// frozenBOMProfile adapts a frozen profile onto the engine's BOM slice.
func frozenBOMProfile(profile *domain.FrozenGripProfile) *engine.ProjectGripBOMProfile {
	if profile == nil {
		return nil
	}
	members := make(map[string]engine.OpeningContractBOMMember, len(profile.BOMMembers))
	for key, member := range profile.BOMMembers {
		members[key] = engine.OpeningContractBOMMember{
			HardwareID: member.HardwareID, ComponentID: member.ComponentID,
			Rule: member.Rule, Unit: member.Unit, SpacingMm: member.SpacingMm,
		}
	}
	return &engine.ProjectGripBOMProfile{
		ProfileID: profile.ProfileID, Version: profile.BOMVersion, BOMMembers: members,
	}
}

// frozenProfileCode names the quoted profile from the frozen copy itself.
func frozenProfileCode(recipe *domain.GripSnapshotRecipe, profileID string) string {
	if recipe.TopProfile != nil && recipe.TopProfile.ProfileID == profileID {
		return recipe.TopProfile.Code
	}
	if recipe.BetweenProfile != nil && recipe.BetweenProfile.ProfileID == profileID {
		return recipe.BetweenProfile.Code
	}
	return ""
}

// catalogModuleType maps a definition id onto its furniture type ('' =
// inferior) — the recipe lookup key.
func catalogModuleType(catalog domain.Catalog, definitionID string) string {
	for i := range catalog.Modules {
		if catalog.Modules[i].ID == definitionID {
			if catalog.Modules[i].FurnitureType == "" {
				return "inferior"
			}
			return catalog.Modules[i].FurnitureType
		}
	}
	return "inferior"
}

// loadDesignRevisionAuthoringDefaults reads a published design revision's
// frozen #784 defaults (legacy NULL ⇒ canonical empty — never the mutable
// working defaults). The requote path resolves the opening from this exact
// snapshot.
func (s *PostgresStore) loadDesignRevisionAuthoringDefaults(ctx context.Context, designRevisionID string) (*domain.DesignAuthoringDefaults, error) {
	var raw []byte
	err := s.db(ctx).QueryRow(ctx, `
		SELECT authoring_defaults_snapshot FROM design_revisions WHERE id = $1
	`, designRevisionID).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDesignRevisionNotFound
		}
		return nil, err
	}
	defaults := domain.DesignAuthoringDefaults{}.Normalize()
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &defaults); err != nil {
			return nil, fmt.Errorf("%w: read revision authoring defaults: %v", domain.ErrSerializationFailed, err)
		}
		defaults = defaults.Normalize()
	}
	return &defaults, nil
}

// openingQuoteInteriorWidth derives the run input from the unit's structure
// (commercial width minus the two lateral panels); 0 = underivable body
// context — reported truthfully by the engine, never guessed here.
func openingQuoteInteriorWidth(unit designOpeningUnit, widthMm int, catalog domain.Catalog) int {
	if unit.FurnitureDefinitionID == "" {
		return 0
	}
	for _, module := range catalog.Modules {
		if module.ID != unit.FurnitureDefinitionID || module.StructureID == "" {
			continue
		}
		for _, structure := range catalog.Structures {
			if structure.ID != module.StructureID {
				continue
			}
			if thickness, ok := engine.StructureSidePanelThicknessMm(structure, catalog); ok {
				if interior := widthMm - 2*thickness; interior > 0 {
					return interior
				}
			}
		}
		break
	}
	return 0
}

// openingQuoteMembers maps the persisted entity members onto the engine
// contract shape (nil-safe).
func openingQuoteMembers(members map[string]domain.OpeningBOMMember) map[string]engine.OpeningContractBOMMember {
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

func derefOpeningInt(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func derefOpeningFloat(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

// sameOpeningCommercialLines reports whether the base quote's frozen opening
// section and the design revision's freshly derived one are the SAME
// commercial truth (identity-to-identity: hardware, quantity and cut). An
// opening-only change — add, remove or profile swap — differs here even when
// no design item changed.
func sameOpeningCommercialLines(frozen *domain.QuoteCommercialSnapshot, opening *designOpeningCommercial) bool {
	var frozenLines []domain.QuoteCommercialOpeningBOMLine
	if frozen != nil {
		for _, entry := range frozen.OpeningBOM {
			frozenLines = append(frozenLines, entry.Lines...)
		}
	}
	var derivedLines []domain.QuoteCommercialOpeningBOMLine
	if opening != nil {
		for _, entry := range opening.Snapshot {
			derivedLines = append(derivedLines, entry.Lines...)
		}
	}
	if len(frozenLines) != len(derivedLines) {
		return false
	}
	key := func(line domain.QuoteCommercialOpeningBOMLine) string {
		return fmt.Sprintf("%s|%s|%d|%g", line.HardwareID, line.LineID, line.CutLengthMm, line.Quantity)
	}
	seen := make(map[string]int, len(frozenLines))
	for _, line := range frozenLines {
		seen[key(line)]++
	}
	for _, line := range derivedLines {
		k := key(line)
		if seen[k] == 0 {
			return false
		}
		seen[k]--
	}
	return true
}
