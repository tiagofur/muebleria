package storage_test

import (
	"context"
	"encoding/json"
	"math"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #986 acceptance against real disposable PostgreSQL: the quote commercial
// snapshot prices the governed resolve's profile hardware demand and freezes
// its provenance. The same factory state that makes the release freeze carry
// hardwareProfileDemand makes the NEXT quote revision carry the demand in its
// price, while a revision frozen BEFORE the assignments keeps its pre-demand
// truth byte for byte.

func TestQuoteCommercialSnapshotCarriesProfileDemand(t *testing.T) {
	const (
		sideL   = "76000000-0000-0000-0000-0000000000a1"
		sideR   = "76000000-0000-0000-0000-0000000000a2"
		shelf   = "76000000-0000-0000-0000-0000000000a3"
		hwA     = "76000000-0000-0000-0000-0000000000a4"
		profA   = "76000000-0000-0000-0000-0000000000a5"
		binding = `[{"name":"shelfJoints","label":"Fijaciones de entrepaño","type":"number","defaultValue":3,"required":true,"integer":true,"unit":"count","category":"configuration","binding":{"version":1,"kind":"structureRelationship","componentId":"` + shelf + `","relationship":{"kind":"fixed-shelf-side","sourceRole":"shelf-edge","targets":[{"componentId":"` + sideL + `","role":"side","face":"front"},{"componentId":"` + sideR + `","role":"side","face":"back"}],"station":{"startMarginMm":40,"endMarginMm":40}}}}]`
		recipe  = `{"recipeId":"qt:minifix","recipeRevision":"rev-1","variants":[
			{"targetFace":"front","rules":[
				{"ruleId":"qt-cam","ruleRevision":"rev-1","participantRole":"A","operationRole":"housing","entryFace":"bottom","offsetMm":[0,0,0],"axis":[0,-1,0],"diameterMm":15,"depthMm":13},
				{"ruleId":"qt-dowel","ruleRevision":"rev-1","participantRole":"B","operationRole":"dowel","entryFace":"back","offsetMm":[0,18,0],"axis":[0,-1,0],"diameterMm":8,"depthMm":17}]},
			{"targetFace":"back","rules":[
				{"ruleId":"qt-cam","ruleRevision":"rev-1","participantRole":"A","operationRole":"housing","entryFace":"top","offsetMm":[0,0,0],"axis":[0,-1,0],"diameterMm":15,"depthMm":13},
				{"ruleId":"qt-dowel","ruleRevision":"rev-1","participantRole":"B","operationRole":"dowel","entryFace":"front","offsetMm":[0,18,0],"axis":[0,-1,0],"diameterMm":8,"depthMm":17}]}]}`
	)

	fx := setupReleaseFixtureWithOptions(t, releaseFixtureOptions{
		choices: map[string]string{"BODY": releaseMaterial},
		seedCatalog: func(t *testing.T, admin *pgxpool.Pool) {
			t.Helper()
			statements := []string{
				// The governed cabinet: two sides + a shelf inside the fixture
				// structure (the geometry proven by the freeze and browser gates).
				`INSERT INTO components (id, code, name, placement, length_mm, width_mm, length_formula, width_formula, thickness_mm, option_roles, organization_id) VALUES
				 ('` + sideL + `', 'QPD-LAT', 'Cotizado lateral izq', 'lateral_izquierdo', 684, 560, 'PH - 2*T', 'PD', 18, '{BODY}', '` + rlsOrgA + `'),
				 ('` + sideR + `', 'QPD-LATD', 'Cotizado lateral der', 'lateral_derecho', 684, 560, 'PH - 2*T', 'PD', 18, '{BODY}', '` + rlsOrgA + `'),
				 ('` + shelf + `', 'QPD-ENTRE', 'Cotizado entrepaño', 'interno', 564, 542, 'PW - 2*T', 'PD - T', 18, '{BODY}', '` + rlsOrgA + `')`,
				`INSERT INTO structure_components (structure_id, component_id, quantity, organization_id) VALUES
				 ('71000000-0000-0000-0000-000000000001', '` + sideL + `', 1, '` + rlsOrgA + `'),
				 ('71000000-0000-0000-0000-000000000001', '` + sideR + `', 1, '` + rlsOrgA + `'),
				 ('71000000-0000-0000-0000-000000000001', '` + shelf + `', 1, '` + rlsOrgA + `')`,
				// The definition's OWN binding with its station default of 3: the
				// demand under test is station-independent (#917).
				`UPDATE modules SET parameter_definitions = '` + binding + `'::jsonb WHERE id='` + fiModuleA + `'`,
				`INSERT INTO hardwares (id, code, name, unit, cost_per_unit, organization_id)
				 VALUES ('` + hwA + `', 'QPD-MINIFIX', 'Minifix cotizado', 'piece', 10, '` + rlsOrgA + `')`,
				`INSERT INTO hardware_profiles (id, organization_id, code, name, revision, items, recipe_ref, recipe, active)
				 VALUES ('` + profA + `', '` + rlsOrgA + `', 'PERF-QPD', 'Unión cotizada', 'rev-1',
				 '[{"hardwareId":"` + hwA + `","quantity":1,"applicationRole":"cam"}]'::jsonb,
				 '{"recipeId":"qt:minifix","recipeRevision":"rev-1"}'::jsonb,
				 '` + recipe + `'::jsonb, TRUE)`,
			}
			for _, statement := range statements {
				if _, err := admin.Exec(context.Background(), statement); err != nil {
					t.Fatalf("seed governed catalog: %v", err)
				}
			}
			// Publish the Standard release carrying the profile BEFORE the
			// fixture flow: the shared loader pins THIS release.
			draftID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)
			if _, err := admin.Exec(context.Background(), `UPDATE library_releases SET version = '0.1.0-quote-demand' WHERE id = $1`, draftID); err != nil {
				t.Fatalf("retarget draft: %v", err)
			}
			if _, err := application.PublishStandardRelease(storage.WithOrgCtx(context.Background(), rlsOrgA), &storage.PostgresStore{Pool: admin}, draftID, uuid.MustParse(rlsUserA)); err != nil {
				t.Fatalf("publish: %v", err)
			}
		},
	})
	actorA := fiActorA()

	// Baseline: the fixture's Q3 was frozen BEFORE any side assignment — no
	// governed demand existed yet, so its price carries no profile hardware.
	baseline := readQuoteRevisionSnapshot(t, fx, fx.quoteQ3)
	if len(baseline.ProfileDemand) != 0 {
		t.Fatalf("pre-assignment snapshot must carry no profile demand: %+v", baseline.ProfileDemand)
	}
	if math.Abs(baseline.Breakdown.HardwareTotal) > 1e-9 {
		t.Fatalf("pre-assignment HardwareTotal=%v want 0 (no manual lines, no demand)", baseline.Breakdown.HardwareTotal)
	}
	// The stable commercial identities the requote must keep for its units.
	lineByInstance := map[string]string{}
	for _, unit := range baseline.Units {
		if unit.QuoteLineID == "" {
			t.Fatalf("baseline unit %s has no frozen quote line identity", unit.FurnitureInstanceID)
		}
		lineByInstance[unit.FurnitureInstanceID] = unit.QuoteLineID
	}

	// The factory assigns the pinned profile to both shelf contacts.
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		for _, pair := range [][2]string{{sideL, "front"}, {sideR, "back"}} {
			if err := fx.store.SetComponentSideAssignment(ctx, &domain.ComponentSideAssignment{
				ComponentID: pair[0], Side: pair[1], ProfileID: profA,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("assignments: %v", err)
	}

	// A real commercial change drives the next revision: one unit grows 50mm
	// (the governed joint stays valid), the design republishes as R4 and the
	// requote reprices it — now WITH the factory's governed demand.
	var revR4 string
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		if _, err := UpdateWorkingCopyCurrent(ctx, fx.store, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   fx.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 650.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
				{FurnitureInstanceID: fx.fiB, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		pubReadback, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       fx.designID,
			BaseRevisionID: fx.revR3,
			SourceType:     domain.DesignRevisionSourceSketchup,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		revR4 = pubReadback.ID
		return nil
	})
	if err != nil {
		t.Fatalf("design R4: %v", err)
	}

	var requoted *storage.RequoteProjectQuoteResult
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		requoted, err = fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID:           fx.projectID,
			BaseQuoteRevisionID: fx.quoteQ3,
			DesignRevisionID:    revR4,
			ActorUserID:         rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("requote: %v", err)
	}

	snapshot := readQuoteRevisionSnapshot(t, fx, requoted.Revision.ID)

	// The price: 2 physical units × 2 verified contacts × 3 stations (the
	// binding's own station default) × 1 minifix × $10 = $120 of governed
	// demand joined the SAME hardware total as manual lines. #1065: demand
	// applies per PLANNED STATION — the binding drills 3 stations per
	// contact, so buying per contact under-counted by 3×.
	if math.Abs(snapshot.Breakdown.HardwareTotal-120) > 1e-9 {
		t.Fatalf("HardwareTotal=%v want 120 (2 units × 2 contacts × 3 stations × $10)", snapshot.Breakdown.HardwareTotal)
	}

	// The provenance: ONE entry per physical unit under its unit's frozen
	// line identity, each with the exact profile/recipe/relationship trail.
	if len(snapshot.ProfileDemand) != 2 {
		t.Fatalf("ProfileDemand entries=%d want one per physical unit: %+v", len(snapshot.ProfileDemand), snapshot.ProfileDemand)
	}
	linesSeen := map[string]bool{}
	for _, entry := range snapshot.ProfileDemand {
		wantLine, ok := lineByInstance[fx.fiA]
		if entry.QuoteLineID != wantLine {
			if wantLine, ok = lineByInstance[fx.fiB]; ok && entry.QuoteLineID != wantLine {
				t.Fatalf("provenance line = %q want a frozen unit line identity (%v)", entry.QuoteLineID, lineByInstance)
			} else if !ok {
				t.Fatalf("provenance line = %q want %q", entry.QuoteLineID, wantLine)
			}
		}
		linesSeen[entry.QuoteLineID] = true
		if entry.UnitQuantity != 1 {
			t.Fatalf("per-unit provenance UnitQuantity=%d want 1", entry.UnitQuantity)
		}
		if len(entry.Lines) != 1 {
			t.Fatalf("demand lines=%d want 1: %+v", len(entry.Lines), entry.Lines)
		}
		line := entry.Lines[0]
		if line.HardwareID != hwA || math.Abs(line.Quantity-6) > 1e-9 {
			t.Fatalf("demand line = %+v want hardware %s quantity 6 per unit (2 contacts x 3 stations)", line, hwA)
		}
		if len(line.Sources) != 1 {
			t.Fatalf("sources=%d want 1: %+v", len(line.Sources), line.Sources)
		}
		source := line.Sources[0]
		want := domain.QuoteCommercialDemandSource{
			TechnicalProfileID: profA, TechnicalProfileRevision: "rev-1",
			RecipeID: "qt:minifix", RecipeRevision: "rev-1",
			RelationshipID: "parameter-shelfJoints-1", ContactCount: 2, StationCount: 6,
		}
		if source != want {
			t.Fatalf("source = %+v want %+v", source, want)
		}
	}
	if len(linesSeen) != 2 {
		t.Fatalf("provenance must cover both units' frozen line identities: %v", linesSeen)
	}

	// The live derivation (estimate/projection path) reads the SAME governed
	// inputs from PostgreSQL and produces the same per-unit demand.
	var live [][]engine.HardwareProfileDemandLine
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		catalog, err := fx.store.GetFullCatalog(ctx)
		if err != nil {
			return err
		}
		live, err = fx.store.DeriveLiveProfileDemand(ctx, &domain.Project{
			Items: []domain.ProjectItem{
				{ID: fx.fiA, ModuleID: fiModuleA, Quantity: 1, OptionChoices: map[string]string{"BODY": releaseMaterial},
					CustomDims: &domain.ItemCustomDims{WidthMm: 650, HeightMm: 720, DepthMm: 560}},
				{ID: fx.fiB, ModuleID: fiModuleA, Quantity: 1, OptionChoices: map[string]string{"BODY": releaseMaterial},
					CustomDims: &domain.ItemCustomDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}},
			},
		}, catalog)
		return err
	})
	if err != nil {
		t.Fatalf("live demand: %v", err)
	}
	if len(live) != 2 || len(live[0]) != 1 || live[0][0].HardwareID != hwA || math.Abs(live[0][0].Quantity-6) > 1e-9 ||
		len(live[1]) != 1 || live[1][0].HardwareID != hwA || math.Abs(live[1][0].Quantity-6) > 1e-9 {
		t.Fatalf("live demand matrix = %+v want one minifix line of 6 per unit (2 contacts x 3 stations)", live)
	}

	// The revision frozen before the assignments keeps its pre-demand truth.
	after := readQuoteRevisionSnapshot(t, fx, fx.quoteQ3)
	before, err := json.Marshal(baseline)
	if err != nil {
		t.Fatal(err)
	}
	afterBytes, err := json.Marshal(after)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(afterBytes) {
		t.Fatal("the revision frozen before the assignments changed after a requote")
	}
}

func readQuoteRevisionSnapshot(t *testing.T, fx *releaseFixture, revisionID string) *domain.QuoteCommercialSnapshot {
	t.Helper()
	var revisions []domain.QuoteRevisionDetail
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		revisions, err = fx.store.ListQuoteRevisionsByProject(ctx, fx.projectID)
		return err
	})
	if err != nil {
		t.Fatalf("list quote revisions: %v", err)
	}
	for _, revision := range revisions {
		if revision.ID == revisionID {
			if revision.CommercialSnapshot == nil {
				t.Fatalf("revision %s has no commercial snapshot", revisionID)
			}
			return revision.CommercialSnapshot
		}
	}
	t.Fatalf("revision %s not found in project %s", revisionID, fx.projectID)
	return nil
}
