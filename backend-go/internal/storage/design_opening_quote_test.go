package storage_test

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1263 → #1532 — the design's opening reaches the commercial quote from the
// PROJECT GRIP: every unit's effective frozen snapshot (its override, else
// the project's) yields the recipe for its furniture type, the engine
// resolves the BOM from the FROZEN profiles (the top run with the v1 rules),
// and the pricing demand joins the ONE hardware channel. The physical truth
// comes from the Cymisa 8006 datasheet slice (docs/fichas): interior-width
// run in meters, supports ceil(span/spacing)+1, caps per exposed end (v1:
// both ends exposed). The legacy authoring-defaults selection is dead data
// (#1532): these tests seed the grip the same way the API does — one style,
// ONE frozen snapshot, If-Match on grip_version.

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

// golaStyleForAllTypes builds an offered grip style whose three recipes mount
// the given top profile: a style declares inferior, superior and alto, so a
// furniture never resolves without a grip (#1531 A2.2).
func golaStyleForAllTypes(name, topProfileID string) *domain.GripStyle {
	return &domain.GripStyle{
		Name: name, Offered: true,
		ByFurnitureType: map[string]domain.GripStyleRecipe{
			"inferior": {Mode: domain.GripModeGola, TopProfileID: topProfileID},
			"superior": {Mode: domain.GripModeGola, TopProfileID: topProfileID},
			"alto":     {Mode: domain.GripModeGola, TopProfileID: topProfileID},
		},
	}
}

// handleStyleForAllTypes builds an offered handle-only style (the baseline
// that consumes nothing).
func handleStyleForAllTypes(name string) *domain.GripStyle {
	return &domain.GripStyle{
		Name: name, Offered: true,
		ByFurnitureType: map[string]domain.GripStyleRecipe{
			"inferior": {Mode: domain.GripModeHandle},
			"superior": {Mode: domain.GripModeHandle},
			"alto":     {Mode: domain.GripModeHandle},
		},
	}
}

// seedVerifiedGolaProfile creates the Cymisa-8006 verified profile with the
// v2 fields the grip contract consumes (#1530): aluminum, the top position
// and the workshop's 40 mm front discount — the datasheet pair 38+2, the
// same arithmetic the v1 pin froze. The referenced hardware must already
// exist in the organization. Returns the catalog revision the freeze
// captures (the quote's provenance).
func seedVerifiedGolaProfile(t *testing.T, store *storage.PostgresStore, profileID string) int64 {
	t.Helper()
	spacing := 400
	supportDims := [3]float64{17, 19.5, 39.5}
	capDims := [3]float64{3, 28.8, 58}
	var version int64
	err := fiTx(t, store, fiActorA(), func(ctx context.Context) error {
		if err := store.CreateOpeningProfile(ctx, &domain.OpeningProfile{
			ID: profileID, Code: "GOLA-L-8006", Name: "Gola L Cymisa 8006",
			GripType: "gola", CrossSectionShape: "L",
			Material:           domain.GolaMaterialAluminum,
			Positions:          []string{domain.GolaPositionTop},
			FrontDiscountTopMm: intPtr(40),
			FrontReductionMm:   intPtr(38), GripClearanceMm: intPtr(2),
			ProfileHeightMm: floatPtr(56.5), ProfileDepthMm: floatPtr(27.2),
			GeometryOrigin:  "docs/fichas/perfil_gola_l_ficha_tecnica.pdf (SCILM GOLA PROFILES 2022-04-01 pp. 42-45)",
			DatasheetStatus: "verified", Active: true, BodyModifiers: []domain.OpeningBodyModifier{},
			BOMMembers: map[string]domain.OpeningBOMMember{
				"profile":  {HardwareID: openingHWProfile, Rule: "interior_width", Unit: "meter"},
				"supports": {HardwareID: openingHWSupport, Rule: "per_length", SpacingMm: &spacing, DimensionsMm: &supportDims},
				"endCaps":  {HardwareID: openingHWCap, Rule: "per_exposed_end", DimensionsMm: &capDims},
			},
		}); err != nil {
			return err
		}
		profiles, err := store.ListOpeningProfiles(ctx)
		if err != nil {
			return err
		}
		for _, profile := range profiles {
			if profile.ID == profileID {
				version = profile.Version
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("seed opening profile: %v", err)
	}
	return version
}

// applyGripStyle creates the style and applies it to the project with the
// If-Match version the project currently carries — one read-modify-write
// round trip, the same the API serves. Returns the new grip version.
func applyGripStyle(t *testing.T, store *storage.PostgresStore, projectID string, style *domain.GripStyle) int64 {
	t.Helper()
	var version int64
	err := fiTx(t, store, fiActorA(), func(ctx context.Context) error {
		if err := store.CreateGripStyle(ctx, style, storage.GripStyleWriteMeta{}); err != nil {
			return err
		}
		grip, err := store.GetProjectGrip(ctx, projectID)
		if err != nil {
			return err
		}
		updated, err := store.SetProjectGrip(ctx, projectID, style.ID, grip.Version, storage.ProjectGripWriteMeta{})
		if err != nil {
			return err
		}
		version = updated.Version
		return nil
	})
	if err != nil {
		t.Fatalf("apply grip style %s to project %s: %v", style.Name, projectID, err)
	}
	return version
}

func TestCreateInitialDesignQuoteRevisionFreezesOpeningBOM(t *testing.T) {
	fx := setupDesignQuoteFixture(t)
	seedOpeningQuoteContext(t, fx)
	profileVersion := seedVerifiedGolaProfile(t, fx.store, openingProfileID)

	// Explicit dims (the pilot's one-module scope) for both units.
	rewriteDesignItemsWithDims(t, fx)

	// v2 (#1532): the grip is PROJECT state. Applying a style freezes ONE
	// complete snapshot under If-Match; a stale grip_version is refused.
	var versionBefore int64
	style := golaStyleForAllTypes("Gola L del taller", openingProfileID)
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		grip, err := fx.store.GetProjectGrip(ctx, csProject)
		if err != nil {
			return err
		}
		versionBefore = grip.Version
		if err := fx.store.CreateGripStyle(ctx, style, storage.GripStyleWriteMeta{}); err != nil {
			return err
		}
		if _, err := fx.store.SetProjectGrip(ctx, csProject, style.ID, versionBefore+7, storage.ProjectGripWriteMeta{}); !errors.Is(err, storage.ErrVersionConflict) {
			return fmt.Errorf("a stale If-Match version must refuse the write with ErrVersionConflict, got %v", err)
		}
		_, err = fx.store.SetProjectGrip(ctx, csProject, style.ID, versionBefore, storage.ProjectGripWriteMeta{})
		return err
	})
	if err != nil {
		t.Fatalf("apply project grip: %v", err)
	}

	// ONE complete frozen copy (A7): the style's recipe per furniture type
	// with every referenced profile frozen completely — identity, discount
	// and BOM revision ride frozen, and the version moved by exactly one.
	var grip *storage.ProjectGrip
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		grip, err = fx.store.GetProjectGrip(ctx, csProject)
		return err
	})
	if err != nil {
		t.Fatalf("read project grip: %v", err)
	}
	if grip.Version != versionBefore+1 || grip.StyleID != style.ID {
		t.Fatalf("grip after apply: version=%d style=%s, want version=%d style=%s", grip.Version, grip.StyleID, versionBefore+1, style.ID)
	}
	for _, ftype := range domain.GripStyleFurnitureTypes {
		recipe, recipeErr := grip.Snapshot.GripRecipeFor(ftype)
		if recipeErr != nil || recipe == nil || recipe.Mode != domain.GripModeGola || recipe.TopProfile == nil {
			t.Fatalf("frozen recipe %s drifted: %+v (%v)", ftype, recipe, recipeErr)
		}
		top := recipe.TopProfile
		if top.ProfileID != openingProfileID || top.Code != "GOLA-L-8006" ||
			top.FrontDiscountTopMm == nil || *top.FrontDiscountTopMm != 40 || top.BOMVersion != profileVersion {
			t.Fatalf("frozen top profile of %s drifted: %+v", ftype, top)
		}
	}

	// The live catalog stays editable AFTER the freeze (A7): renaming the
	// profile must not touch the frozen copy the quote will name.
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		live, err := fx.store.GetOpeningProfileByID(ctx, openingProfileID)
		if err != nil {
			return err
		}
		live.Code = "GOLA-L-8006-EDITADA"
		return fx.store.UpdateOpeningProfile(ctx, openingProfileID, live.Version, live)
	})
	if err != nil {
		t.Fatalf("rename live profile: %v", err)
	}

	// The grip is project state, not design authoring state: the working
	// fingerprint must NOT move when the grip changes (identical items).
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		projection, err := fx.store.GetDesignCommercialProjection(ctx, csProject, fx.designID)
		if err != nil {
			return err
		}
		if projection.WorkingFingerprint != fx.fingerprint {
			return errors.New("the project grip must not change the working fingerprint")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("reproject after grip: %v", err)
	}

	var result *storage.CreateInitialQuoteRevisionResult
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		result, err = createDesignQuote(ctx, fx)
		return err
	})
	if err != nil {
		t.Fatalf("design-first Q1 with grip: %v", err)
	}
	snapshot := result.Revision.CommercialSnapshot

	// EVERY unit resolves the project grip (v1 resolved only the first):
	// two entries, one per quote line, with identical frozen lines.
	// Interior = 800 − 2×18 = 764 per unit: profile 0.764 m (cut 764),
	// supports ceil(764/400)+1 = 3, caps 2 (v1: both ends exposed).
	if len(snapshot.OpeningBOM) != 2 {
		t.Fatalf("opening BOM section = %+v, want one entry per unit", snapshot.OpeningBOM)
	}
	assertOpeningBOMEntry := func(entry domain.QuoteCommercialOpeningBOM) {
		t.Helper()
		if entry.UnitQuantity != 1 || len(entry.Lines) != 3 {
			t.Fatalf("opening BOM entry drifted: %+v", entry)
		}
		byMember := map[string]domain.QuoteCommercialOpeningBOMLine{}
		for _, line := range entry.Lines {
			byMember[line.MemberKey] = line
			if line.Boundary != "top" || line.ProfileID != openingProfileID {
				t.Fatalf("line %s drifted: %+v", line.MemberKey, line)
			}
			// #1532: every line names the FROZEN code and revision (A7) —
			// the quote's provenance never joins the live catalog, which
			// this test renamed after the freeze.
			if line.ProfileCode != "GOLA-L-8006" || line.ProfileVersion != profileVersion {
				t.Fatalf("line %s missing the frozen profile provenance (code %q version %d): %+v", line.MemberKey, line.ProfileCode, line.ProfileVersion, line)
			}
		}
		if line := byMember["profile"]; line.LineID != "top|profile" || line.HardwareID != openingHWProfile ||
			math.Abs(line.Quantity-0.764) > 1e-9 || line.CutLengthMm != 764 || line.Unit != "meter" {
			t.Fatalf("profile run drifted: %+v", line)
		}
		if line := byMember["supports"]; line.LineID != "top|supports" || line.HardwareID != openingHWSupport ||
			line.Quantity != 3 || line.Unit != "piece" {
			t.Fatalf("supports drifted: %+v", line)
		}
		if line := byMember["endCaps"]; line.LineID != "top|endCaps" || line.HardwareID != openingHWCap || line.Quantity != 2 {
			t.Fatalf("end caps drifted: %+v", line)
		}
	}
	for _, entry := range snapshot.OpeningBOM {
		assertOpeningBOMEntry(entry)
	}

	// Pricing through the one hardware channel: per unit 0.764×100 + 3×10 +
	// 2×5 = 116.4, doubled by the two-unit collection = 232.8 — the
	// opening's OWN hardware truth, independent of the module's board
	// geometry (the snapshot validator already enforces the sums).
	wantHardwarePerUnit := 0.764*100 + 3*10 + 2*5
	if math.Abs(snapshot.Breakdown.HardwareTotal-2*wantHardwarePerUnit) > 1e-6 {
		t.Fatalf("hardware total = %v, want %v", snapshot.Breakdown.HardwareTotal, 2*wantHardwarePerUnit)
	}
	wantSale := snapshot.Breakdown.DirectCost*1.5 + snapshot.Breakdown.LaborModular + snapshot.Breakdown.LaborFixedCost
	if math.Abs(snapshot.Breakdown.SalePrice-wantSale) > 1e-6 {
		t.Fatalf("sale = %v, want the breakdown-consistent %v", snapshot.Breakdown.SalePrice, wantSale)
	}

	// BOTH units' lines carry the opening hardware: each line's amounts
	// price the demand the same derivation froze into the section.
	lineByID := map[string]domain.QuoteCommercialLine{}
	for _, line := range snapshot.Lines {
		lineByID[line.QuoteLineID] = line
	}
	for _, entry := range snapshot.OpeningBOM {
		openingLine, ok := lineByID[entry.QuoteLineID]
		if !ok {
			t.Fatalf("opening entry %s has no commercial line", entry.QuoteLineID)
		}
		if math.Abs(openingLine.Amounts.HardwareTotal-wantHardwarePerUnit) > 1e-6 {
			t.Fatalf("line %s hardware = %v, want %v", entry.QuoteLineID, openingLine.Amounts.HardwareTotal, wantHardwarePerUnit)
		}
	}
}

// #1532 — fail-closed: a grip the design cannot resolve fails the quote
// verbatim (a design under a gola never quotes without it). The dims path:
// a governed unit needs explicit dimensions — the derivation never invents
// them, and a unit without dims never under-prices the declared gola.

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

func TestCreateInitialDesignQuoteRevisionFailsWhenOpeningDimsMissing(t *testing.T) {
	fx := setupDesignQuoteFixture(t)
	seedOpeningQuoteContext(t, fx)
	seedVerifiedGolaProfile(t, fx.store, openingProfileID)
	applyGripStyle(t, fx.store, csProject, golaStyleForAllTypes("Gola L del taller", openingProfileID))

	// One unit keeps explicit dims; the other loses them. The grip is
	// project state: the unit still inherits the gola, and the quote must
	// refuse to under-price it instead of silently skipping the unit.
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		if _, err := UpdateWorkingCopyCurrent(ctx, fx.store, storage.UpdateDesignWorkingCopyCommand{
			DesignID: fx.designID, SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.instances[0], FurnitureDefinitionID: csModule, Parameters: map[string]any{"widthMm": 800.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"INTERIOR": csMaterial}},
				{FurnitureInstanceID: fx.instances[1], FurnitureDefinitionID: csModule, Parameters: map[string]any{}, MaterialChoices: map[string]string{"INTERIOR": csMaterial2}},
			},
		}); err != nil {
			return err
		}
		return refreshDesignQuoteTokens(ctx, fx)
	})
	if err != nil {
		t.Fatalf("rewrite items without dims: %v", err)
	}

	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := createDesignQuote(ctx, fx)
		return err
	})
	if err == nil {
		t.Fatal("a grip whose unit lacks explicit dims must fail the quote")
	}
	if got := err.Error(); !strings.Contains(got, "no puede resolverse sin dimensiones explícitas") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// #1532 — the requote reflects the project's grip: switching the project to
// a handle-only style retires EVERY opening line and its hardware from Q2
// (no residue of a previous resolution ever survives).
func TestRequoteRetiresRemovedOpeningBOM(t *testing.T) {
	fx := setupDesignQuoteFixture(t)
	seedOpeningQuoteContext(t, fx)
	seedVerifiedGolaProfile(t, fx.store, openingProfileID)

	rewriteDesignItemsWithDims(t, fx)
	applyGripStyle(t, fx.store, csProject, golaStyleForAllTypes("Gola L del taller", openingProfileID))
	var q1 *storage.CreateInitialQuoteRevisionResult
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) (err error) {
		q1, err = createDesignQuote(ctx, fx)
		return err
	})
	if err != nil {
		t.Fatalf("Q1 with grip: %v", err)
	}
	// Every unit resolves the grip: both entries frozen, 232.8 priced.
	if len(q1.Revision.CommercialSnapshot.OpeningBOM) != 2 {
		t.Fatalf("Q1 must freeze one opening BOM entry per unit: %+v", q1.Revision.CommercialSnapshot.OpeningBOM)
	}
	if hw := q1.Revision.CommercialSnapshot.Breakdown.HardwareTotal; math.Abs(hw-232.8) > 1e-6 {
		t.Fatalf("Q1 hardware = %v, want 232.8", hw)
	}

	// Remove the opening the v2 way: the project takes a handle-only style
	// under the grip_version it currently carries (If-Match), then publish
	// the design revision (the requote's frozen items source) and requote
	// from the accepted Q1.
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		grip, err := fx.store.GetProjectGrip(ctx, csProject)
		if err != nil {
			return err
		}
		handleStyle := handleStyleForAllTypes("Jaladera del taller")
		if err := fx.store.CreateGripStyle(ctx, handleStyle, storage.GripStyleWriteMeta{}); err != nil {
			return err
		}
		if _, err := fx.store.SetProjectGrip(ctx, csProject, handleStyle.ID, grip.Version, storage.ProjectGripWriteMeta{}); err != nil {
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
		t.Fatalf("switch to handle+publish+accept: %v", err)
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
