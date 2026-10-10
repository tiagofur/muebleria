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

// designOpeningUnit is the design-unit slice the derivation resolves against
// (pilot v1: the first unit carries the opening — same scope as the design
// opening endpoint's designOpeningDims).
type designOpeningUnit struct {
	FurnitureInstanceID   string
	FurnitureDefinitionID string
	QuoteLineID           string
	Parameters            map[string]any
}

// designOpeningCommercial is the derived commercial truth of one design's
// opening: the frozen snapshot section plus the pricing demand per furniture
// instance (merged into the profileDemandPerItem matrix by the snapshot
// builders — the one hardware channel, one validation).
type designOpeningCommercial struct {
	Snapshot         []domain.QuoteCommercialOpeningBOM
	DemandByInstance map[string][]engine.HardwareProfileDemandLine
}

// deriveDesignOpeningCommercial resolves the persisted opening selection of a
// design (working copy or published revision defaults) into its commercial
// truth. nil return = nothing to contribute (no selection, non-gola system,
// or a datasheet that declares no members) — pricing stays byte-identical.
func (s *PostgresStore) deriveDesignOpeningCommercial(ctx context.Context, defaults *domain.DesignAuthoringDefaults, units []designOpeningUnit) (*designOpeningCommercial, error) {
	selection := defaults.Opening
	if selection == nil || selection.System != domain.OpeningGripSystemGola || len(units) == 0 {
		return nil, nil
	}
	unit := units[0]
	dims := domain.CommercialDimsFromParameters(unit.Parameters)
	if dims == nil {
		return nil, fmt.Errorf("%w: la apertura del diseño no puede resolverse sin dimensiones explícitas", domain.ErrInvalidRevisionSnapshot)
	}

	profiles, err := s.ListOpeningProfiles(ctx)
	if err != nil {
		return nil, err
	}
	var profileData []engine.OpeningProfileData
	bomProfiles := make([]engine.OpeningProfileBOMData, 0, len(profiles))
	if pin := selection.ProfilePin; pin != nil {
		profileData = []engine.OpeningProfileData{{
			ProfileID:        selection.ProfileID,
			DatasheetStatus:  pin.DatasheetStatus,
			FrontReductionMm: pin.FrontReductionMm,
			GripClearanceMm:  pin.GripClearanceMm,
		}}
	} else {
		profileData = make([]engine.OpeningProfileData, 0, len(profiles))
	}
	for _, profile := range profiles {
		if pin := selection.ProfilePin; pin == nil {
			profileData = append(profileData, engine.OpeningProfileData{
				ProfileID:        profile.ID,
				DatasheetStatus:  profile.DatasheetStatus,
				FrontReductionMm: derefOpeningInt(profile.FrontReductionMm),
				GripClearanceMm:  derefOpeningInt(profile.GripClearanceMm),
			})
		}
		bomProfiles = append(bomProfiles, engine.OpeningProfileBOMData{
			ProfileID:  profile.ID,
			Version:    profile.Version,
			BOMMembers: openingQuoteMembers(profile.BOMMembers),
		})
	}

	overhangMm, err := s.GetOpeningOverhangRule(ctx)
	if err != nil {
		return nil, err
	}
	bomCtx := &engine.DesignOpeningBOMContext{
		Ends:     engine.OpeningBOMDefaultEnds,
		Profiles: bomProfiles,
	}
	catalog, catalogErr := s.GetFullCatalog(ctx)
	if catalogErr == nil {
		bomCtx.CabinetInteriorWidthMm = openingQuoteInteriorWidth(unit, dims.WidthMm, catalog)
	}

	resolution, resErr := engine.ResolveDesignOpening(dims.WidthMm, dims.HeightMm, selection, profileData, engine.OpeningOverhangRuleMm(overhangMm), bomCtx)
	if resErr != nil {
		return nil, fmt.Errorf("%w: resolución de apertura: %s", domain.ErrInvalidRevisionSnapshot, resErr.Code)
	}
	if resolution.State != engine.DesignOpeningStateResolved {
		return nil, fmt.Errorf("%w: la apertura del diseño está bloqueada (%s)", domain.ErrInvalidRevisionSnapshot, resolution.Reason)
	}
	if resolution.BOMReason != "" {
		return nil, fmt.Errorf("%w: el BOM de apertura del diseño no puede resolverse (%s)", domain.ErrInvalidRevisionSnapshot, resolution.BOMReason)
	}
	if len(resolution.BOM) == 0 {
		// The pinned datasheet declares no members: nothing to price, no
		// section to freeze — the truthful emptiness.
		return nil, nil
	}
	if unit.QuoteLineID == "" {
		return nil, fmt.Errorf("%w: el BOM de apertura de la unidad %s no tiene línea comercial estable", domain.ErrInvalidRevisionSnapshot, unit.FurnitureInstanceID)
	}

	lines := make([]domain.QuoteCommercialOpeningBOMLine, 0, len(resolution.BOM))
	demand := make([]engine.HardwareProfileDemandLine, 0, len(resolution.BOM))
	for _, line := range resolution.BOM {
		lines = append(lines, domain.QuoteCommercialOpeningBOMLine{
			LineID: line.LineID, MemberKey: line.MemberKey, HardwareID: line.HardwareID,
			ProfileID: line.ProfileID, ProfileVersion: line.ProfileVersion,
			Boundary: line.Boundary, Rule: line.Rule, Quantity: line.Quantity,
			Unit: line.Unit, CutLengthMm: line.CutLengthMm,
		})
		// Same channel as the governed profile demand: one entry per line,
		// priced and validated by CalcHardwareLineCost — missing or inactive
		// hardware fails the quote exactly like a broken manual line.
		demand = append(demand, engine.HardwareProfileDemandLine{
			HardwareID: line.HardwareID,
			Quantity:   line.Quantity,
		})
	}
	return &designOpeningCommercial{
		Snapshot: []domain.QuoteCommercialOpeningBOM{{
			QuoteLineID:  unit.QuoteLineID,
			UnitQuantity: 1,
			Lines:        lines,
		}},
		DemandByInstance: map[string][]engine.HardwareProfileDemandLine{
			unit.FurnitureInstanceID: demand,
		},
	}, nil
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
