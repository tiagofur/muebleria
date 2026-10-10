package storage_test

import (
	"context"
	"math"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1263 — the design's opening reaches the commercial quote: the frozen
// snapshot section, the pricing through the ONE hardware channel, and the
// fingerprint's sensitivity to authoring defaults. The physical truth comes
// from the Cymisa 8006 datasheet slice (docs/fichas): reduction+clearance,
// interior-width run in meters, supports ceil(span/spacing)+1, caps per
// exposed end (v1: both ends exposed).

const (
	openingHWProfile = "95000000-0000-0000-0000-0000000000c1"
	openingHWSupport = "95000000-0000-0000-0000-0000000000c2"
	openingHWCap     = "95000000-0000-0000-0000-0000000000c3"
	openingProfileID = "96000000-0000-0000-0000-0000000000c1"
)

// seedOpeningQuoteContext attaches a structure with LATERAL sides to the
// fixture's module (the body fact the interior width derives from) and seeds
// the 8006 datasheet hardware (meter profile, piece supports/caps).
func seedOpeningQuoteContext(t *testing.T, fx *designQuoteFixture) {
	t.Helper()
	multiOrgExec(t, fx.admin, `
		INSERT INTO structures (id, code, name, width_mm, height_mm, depth_mm, organization_id)
		VALUES ('`+csStructure+`', 'CS-STRUCT-OPENING', 'Estructura apertura', 800, 720, 560, '`+rlsOrgA+`');
		INSERT INTO components (id, code, name, placement, length_mm, width_mm, length_formula, width_formula, thickness_mm, option_roles, construction, organization_id)
		VALUES ('`+csComponent+`', 'CS-LATERAL', 'Lateral CS', 'base', 560, 800, 'D', 'W', 18, '{INTERIOR}',
		        '{"constructive_role":"lateral"}'::jsonb, '`+rlsOrgA+`');
		INSERT INTO structure_components (structure_id, component_id, quantity, organization_id)
		VALUES ('`+csStructure+`', '`+csComponent+`', 2, '`+rlsOrgA+`');
		UPDATE modules SET structure_id='`+csStructure+`' WHERE id='`+csModule+`';
		INSERT INTO hardwares (id, code, name, unit, cost_per_unit, organization_id)
		VALUES ('`+openingHWProfile+`', '8006', 'Perfil GOLA L 8006', 'meter', 100, '`+rlsOrgA+`'),
		       ('`+openingHWSupport+`', 'SU116', 'Soporte GOLA atornillar', 'piece', 10, '`+rlsOrgA+`'),
		       ('`+openingHWCap+`', 'CF8006TP', 'Juego tapas terminales', 'piece', 5, '`+rlsOrgA+`');`)
}

func TestCreateInitialDesignQuoteRevisionFreezesOpeningBOM(t *testing.T) {
	fx := setupDesignQuoteFixture(t)
	seedOpeningQuoteContext(t, fx)

	spacing := 400
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		return fx.store.CreateOpeningProfile(ctx, &domain.OpeningProfile{
			ID: openingProfileID, Code: "GOLA-L-8006", Name: "Gola L Cymisa 8006",
			GripType: "gola", CrossSectionShape: "L", CompatiblePlacements: []string{"top"},
			FrontReductionMm: intPtr(38), GripClearanceMm: intPtr(2),
			ProfileHeightMm: intPtr(27), ProfileDepthMm: intPtr(56),
			GeometryOrigin:  "docs/fichas/perfil_gola_l_ficha_tecnica.pdf (Cymisa 8006)",
			DatasheetStatus: "verified", Active: true, BodyModifiers: []domain.OpeningBodyModifier{},
			BOMMembers: map[string]domain.OpeningBOMMember{
				"profile":  {HardwareID: openingHWProfile, Rule: "interior_width", Unit: "meter"},
				"supports": {HardwareID: openingHWSupport, Rule: "per_length", SpacingMm: &spacing},
				"endCaps":  {HardwareID: openingHWCap, Rule: "per_exposed_end"},
			},
		})
	})
	if err != nil {
		t.Fatalf("seed opening profile: %v", err)
	}

	// Explicit dims (the pilot's one-module scope) + the pinned gola
	// selection, persisted the same way the endpoint writes it.
	var profileVersion int64
	var fingerprintBefore string
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		profiles, err := fx.store.ListOpeningProfiles(ctx)
		if err != nil {
			return err
		}
		for _, profile := range profiles {
			if profile.ID == openingProfileID {
				profileVersion = profile.Version
			}
		}
		if _, err = UpdateWorkingCopyCurrent(ctx, fx.store, storage.UpdateDesignWorkingCopyCommand{
			DesignID: fx.designID, SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.instances[0], FurnitureDefinitionID: csModule, Parameters: map[string]any{"widthMm": 800.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"INTERIOR": csMaterial}},
				{FurnitureInstanceID: fx.instances[1], FurnitureDefinitionID: csModule, Parameters: map[string]any{"widthMm": 800.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"INTERIOR": csMaterial2}},
			},
		}); err != nil {
			return err
		}
		projection, err := fx.store.GetDesignCommercialProjection(ctx, csProject, fx.designID)
		if err != nil {
			return err
		}
		fingerprintBefore = projection.WorkingFingerprint
		_, err = fx.store.SetDesignWorkingCopyOpening(ctx, storage.SetDesignWorkingCopyOpeningCommand{
			DesignID: fx.designID, Opening: &domain.DesignOpeningSelection{
				System: "gola", ProfileID: openingProfileID, Placements: []string{"top"},
				ProfilePin: &domain.DesignOpeningProfilePin{
					ProfileCode: "GOLA-L-8006", FrontReductionMm: 38, GripClearanceMm: 2, DatasheetStatus: "verified",
					BOM: &domain.DesignOpeningProfilePinBOM{ProfileVersion: profileVersion, Members: map[string]domain.OpeningBOMMember{
						"profile":  {HardwareID: openingHWProfile, Rule: "interior_width", Unit: "meter"},
						"supports": {HardwareID: openingHWSupport, Rule: "per_length", SpacingMm: &spacing},
						"endCaps":  {HardwareID: openingHWCap, Rule: "per_exposed_end"},
					}},
				},
			},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("persist opening selection: %v", err)
	}

	// The fingerprint is sensitive to authoring defaults: identical items, a
	// different opening ⇒ a different commercial truth. The fresh tokens feed
	// the quote (the fixture's originals are stale after the writes).
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		projection, err := fx.store.GetDesignCommercialProjection(ctx, csProject, fx.designID)
		if err != nil {
			return err
		}
		fx.version, fx.fingerprint = projection.WorkingVersion, projection.WorkingFingerprint
		return nil
	})
	if err != nil {
		t.Fatalf("reproject: %v", err)
	}
	if fx.fingerprint == fingerprintBefore {
		t.Fatal("the opening selection must change the working fingerprint (authoring defaults join the hash)")
	}

	var result *storage.CreateInitialQuoteRevisionResult
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		result, err = createDesignQuote(ctx, fx)
		return err
	})
	if err != nil {
		t.Fatalf("design-first Q1 with opening: %v", err)
	}
	snapshot := result.Revision.CommercialSnapshot

	// Interior = 800 − 2×18 = 764: profile 0.764 m (cut 764), supports
	// ceil(764/400)+1 = 3, caps 2 (v1: both ends exposed).
	if len(snapshot.OpeningBOM) != 1 {
		t.Fatalf("opening BOM section = %+v, want one per-unit entry", snapshot.OpeningBOM)
	}
	entry := snapshot.OpeningBOM[0]
	if entry.UnitQuantity != 1 || len(entry.Lines) != 3 {
		t.Fatalf("opening BOM entry drifted: %+v", entry)
	}
	byMember := map[string]domain.QuoteCommercialOpeningBOMLine{}
	for _, line := range entry.Lines {
		byMember[line.MemberKey] = line
	}
	if line := byMember["profile"]; math.Abs(line.Quantity-0.764) > 1e-9 || line.CutLengthMm != 764 || line.Unit != "meter" || line.ProfileVersion != profileVersion {
		t.Fatalf("profile run drifted: %+v", line)
	}
	if line := byMember["supports"]; line.Quantity != 3 || line.Unit != "piece" {
		t.Fatalf("supports drifted: %+v", line)
	}
	if line := byMember["endCaps"]; line.Quantity != 2 {
		t.Fatalf("end caps drifted: %+v", line)
	}

	// Pricing through the one hardware channel: 0.764×100 + 3×10 + 2×5 = 116.4
	// — the opening's OWN hardware truth, independent of the module's board
	// geometry (the snapshot validator already enforces the sums).
	wantHardware := 0.764*100 + 3*10 + 2*5
	if math.Abs(snapshot.Breakdown.HardwareTotal-wantHardware) > 1e-6 {
		t.Fatalf("hardware total = %v, want %v", snapshot.Breakdown.HardwareTotal, wantHardware)
	}
	wantSale := snapshot.Breakdown.DirectCost*1.5 + snapshot.Breakdown.LaborModular + snapshot.Breakdown.LaborFixedCost
	if math.Abs(snapshot.Breakdown.SalePrice-wantSale) > 1e-6 {
		t.Fatalf("sale = %v, want the breakdown-consistent %v", snapshot.Breakdown.SalePrice, wantSale)
	}

	// The opening rides the FIRST unit's line only (pilot one-module scope):
	// that line's amounts include the hardware, the second line stays at the
	// fixture's per-unit truth.
	lineByID := map[string]domain.QuoteCommercialLine{}
	for _, line := range snapshot.Lines {
		lineByID[line.QuoteLineID] = line
	}
	openingLine := lineByID[entry.QuoteLineID]
	if math.Abs(openingLine.Amounts.HardwareTotal-wantHardware) > 1e-6 {
		t.Fatalf("opening line hardware = %v, want %v", openingLine.Amounts.HardwareTotal, wantHardware)
	}
}

// #1263 — fail-closed: a gola selection whose BOM cannot resolve fails the
// quote verbatim (a design that DECLARES a gola never quotes without it).

// seedVerifiedGolaProfile creates the Cymisa-8006 verified profile and
// returns its catalog revision (the version the pin freezes).
func seedVerifiedGolaProfile(t *testing.T, fx *designQuoteFixture) int64 {
	t.Helper()
	spacing := 400
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		return fx.store.CreateOpeningProfile(ctx, &domain.OpeningProfile{
			ID: openingProfileID, Code: "GOLA-L-8006", Name: "Gola L Cymisa 8006",
			GripType: "gola", CrossSectionShape: "L", CompatiblePlacements: []string{"top"},
			FrontReductionMm: intPtr(38), GripClearanceMm: intPtr(2),
			ProfileHeightMm: intPtr(27), ProfileDepthMm: intPtr(56),
			GeometryOrigin:  "docs/fichas/perfil_gola_l_ficha_tecnica.pdf (Cymisa 8006)",
			DatasheetStatus: "verified", Active: true, BodyModifiers: []domain.OpeningBodyModifier{},
			BOMMembers: map[string]domain.OpeningBOMMember{
				"profile":  {HardwareID: openingHWProfile, Rule: "interior_width", Unit: "meter"},
				"supports": {HardwareID: openingHWSupport, Rule: "per_length", SpacingMm: &spacing},
				"endCaps":  {HardwareID: openingHWCap, Rule: "per_exposed_end"},
			},
		})
	})
	if err != nil {
		t.Fatalf("seed opening profile: %v", err)
	}
	var version int64
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		profiles, err := fx.store.ListOpeningProfiles(ctx)
		if err != nil {
			return err
		}
		for _, profile := range profiles {
			if profile.ID == openingProfileID {
				version = profile.Version
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("read opening profile: %v", err)
	}
	return version
}

// pinnedGolaSelection builds the persisted selection the way the endpoint
// writes it: intent + the frozen datasheet/BOM slice.
func pinnedGolaSelection(version int64) *domain.DesignOpeningSelection {
	spacing := 400
	return &domain.DesignOpeningSelection{
		System: "gola", ProfileID: openingProfileID, Placements: []string{"top"},
		ProfilePin: &domain.DesignOpeningProfilePin{
			ProfileCode: "GOLA-L-8006", FrontReductionMm: 38, GripClearanceMm: 2, DatasheetStatus: "verified",
			BOM: &domain.DesignOpeningProfilePinBOM{ProfileVersion: version, Members: map[string]domain.OpeningBOMMember{
				"profile":  {HardwareID: openingHWProfile, Rule: "interior_width", Unit: "meter"},
				"supports": {HardwareID: openingHWSupport, Rule: "per_length", SpacingMm: &spacing},
				"endCaps":  {HardwareID: openingHWCap, Rule: "per_exposed_end"},
			}},
		},
	}
}

// rewriteDesignItemsWithDims gives the fixture's working items explicit
// dimensions (the pilot's one-module scope) and refreshes the quote tokens.
func rewriteDesignItemsWithDims(t *testing.T, fx *designQuoteFixture) {
	t.Helper()
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		if _, err := UpdateWorkingCopyCurrent(ctx, fx.store, storage.UpdateDesignWorkingCopyCommand{
			DesignID: fx.designID, SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.instances[0], FurnitureDefinitionID: csModule, Parameters: map[string]any{"widthMm": 800.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"INTERIOR": csMaterial}},
				{FurnitureInstanceID: fx.instances[1], FurnitureDefinitionID: csModule, Parameters: map[string]any{"widthMm": 800.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"INTERIOR": csMaterial2}},
			},
		}); err != nil {
			return err
		}
		return refreshDesignQuoteTokens(ctx, fx)
	})
	if err != nil {
		t.Fatalf("rewrite items: %v", err)
	}
}

func refreshDesignQuoteTokens(ctx context.Context, fx *designQuoteFixture) error {
	projection, err := fx.store.GetDesignCommercialProjection(ctx, csProject, fx.designID)
	if err != nil {
		return err
	}
	fx.version, fx.fingerprint = projection.WorkingVersion, projection.WorkingFingerprint
	return nil
}

func TestCreateInitialDesignQuoteRevisionFailsWhenOpeningBOMUnderivable(t *testing.T) {
	fx := setupDesignQuoteFixture(t)
	seedOpeningQuoteContext(t, fx)

	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		if _, err := UpdateWorkingCopyCurrent(ctx, fx.store, storage.UpdateDesignWorkingCopyCommand{
			DesignID: fx.designID, SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.instances[0], FurnitureDefinitionID: csModule, Parameters: map[string]any{"widthMm": 800.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"INTERIOR": csMaterial}},
				{FurnitureInstanceID: fx.instances[1], FurnitureDefinitionID: csModule, Parameters: map[string]any{"widthMm": 800.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"INTERIOR": csMaterial2}},
			},
		}); err != nil {
			return err
		}
		_, err := fx.store.SetDesignWorkingCopyOpening(ctx, storage.SetDesignWorkingCopyOpeningCommand{
			DesignID: fx.designID, Opening: &domain.DesignOpeningSelection{
				System: "gola", ProfileID: openingProfileID, Placements: []string{"top"},
				// Pre-#1263 pin: no BOM slice — the truthful absence, and the
				// quote refuses to under-price the declared gola.
				ProfilePin: &domain.DesignOpeningProfilePin{
					ProfileCode: "GOLA-L-8006", FrontReductionMm: 38, GripClearanceMm: 2, DatasheetStatus: "verified",
				},
			},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("persist legacy-pin selection: %v", err)
	}
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		projection, err := fx.store.GetDesignCommercialProjection(ctx, csProject, fx.designID)
		if err != nil {
			return err
		}
		fx.version, fx.fingerprint = projection.WorkingVersion, projection.WorkingFingerprint
		return nil
	})
	if err != nil {
		t.Fatalf("reproject: %v", err)
	}

	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := createDesignQuote(ctx, fx)
		return err
	})
	if err == nil {
		t.Fatal("a gola selection without a resolvable BOM must fail the quote")
	}
	if got := err.Error(); !strings.Contains(got, "OPENING_BOM_PIN_SLICE_MISSING") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// #1263 — the requote reflects the published design's opening: removing the
// selection retires EVERY opening line and its hardware from Q2 (no residue
// of a previous resolution ever survives).
func TestRequoteRetiresRemovedOpeningBOM(t *testing.T) {
	fx := setupDesignQuoteFixture(t)
	seedOpeningQuoteContext(t, fx)
	version := seedVerifiedGolaProfile(t, fx)

	rewriteDesignItemsWithDims(t, fx)
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := fx.store.SetDesignWorkingCopyOpening(ctx, storage.SetDesignWorkingCopyOpeningCommand{
			DesignID: fx.designID, Opening: pinnedGolaSelection(version), ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("persist opening: %v", err)
	}
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		return refreshDesignQuoteTokens(ctx, fx)
	})
	if err != nil {
		t.Fatalf("reproject: %v", err)
	}
	var q1 *storage.CreateInitialQuoteRevisionResult
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		q1, err = createDesignQuote(ctx, fx)
		return err
	})
	if err != nil {
		t.Fatalf("Q1 with opening: %v", err)
	}
	if len(q1.Revision.CommercialSnapshot.OpeningBOM) != 1 || q1.Revision.CommercialSnapshot.Breakdown.HardwareTotal <= 0 {
		t.Fatalf("Q1 must freeze the opening BOM and price it: %+v", q1.Revision.CommercialSnapshot.OpeningBOM)
	}

	// Remove the opening, publish the design revision (the requote's frozen
	// defaults source) and requote from the accepted Q1.
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		if _, err := fx.store.SetDesignWorkingCopyOpening(ctx, storage.SetDesignWorkingCopyOpeningCommand{
			DesignID: fx.designID, Opening: nil, ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		if _, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID: fx.designID, SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		if _, err := fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: q1.Revision.ID, Status: "published",
		}); err != nil {
			return err
		}
		if _, err := fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: q1.Revision.ID, Status: "accepted",
		}); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		t.Fatalf("remove+publish+accept: %v", err)
	}
	var q2 *storage.RequoteProjectQuoteResult
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		result, rqErr := fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID: csProject, BaseQuoteRevisionID: q1.Revision.ID, DesignRevisionID: latestDesignRevisionID(t, fx),
			ActorUserID: rlsUserA,
		})
		if rqErr != nil {
			return rqErr
		}
		q2 = result
		return nil
	})
	if err != nil {
		t.Fatalf("requote: %v", err)
	}
	snapshot := q2.Revision.CommercialSnapshot
	if len(snapshot.OpeningBOM) != 0 {
		t.Fatalf("Q2 must retire every opening line, got %+v", snapshot.OpeningBOM)
	}
	if snapshot.Breakdown.HardwareTotal != 0 {
		t.Fatalf("Q2 hardware must return to the fixture baseline, got %v", snapshot.Breakdown.HardwareTotal)
	}
}

// latestDesignRevisionID reads the design's newest published revision id.
func latestDesignRevisionID(t *testing.T, fx *designQuoteFixture) string {
	t.Helper()
	var id string
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT id::text FROM design_revisions WHERE design_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`,
		fx.designID).Scan(&id); err != nil {
		t.Fatalf("latest design revision: %v", err)
	}
	return id
}
