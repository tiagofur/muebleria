package storage_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #963 review pass B — the historical release freeze, semantic not just
// structural: the factory construction policy EFFECTIVE AT FREEZE TIME is
// what a release's frozen manufacturing truth carries, and a later policy
// change never rewrites an existing release. Against real disposable
// PostgreSQL: R1 frozen under shelfToSide=4 carries the 4-station routing,
// its hardwareProfileDemand and the demand-merged requirements; moving the
// policy to 2 leaves R1 byte-identical, and R2 freezes the 2-station
// pattern. The two releases never retarget each other.
func TestProductionReleaseFreezesFactoryConstructionPolicy(t *testing.T) {
	const (
		sideL   = "74000000-0000-0000-0000-0000000000a1"
		sideR   = "74000000-0000-0000-0000-0000000000a2"
		shelf   = "74000000-0000-0000-0000-0000000000a3"
		hwA     = "74000000-0000-0000-0000-0000000000a4"
		profA   = "74000000-0000-0000-0000-0000000000a5"
		binding = `[{"name":"shelfJoints","label":"Fijaciones de entrepaño","type":"number","defaultValue":3,"required":true,"integer":true,"unit":"count","category":"configuration","binding":{"version":1,"kind":"structureRelationship","componentId":"` + shelf + `","relationship":{"kind":"fixed-shelf-side","sourceRole":"shelf-edge","targets":[{"componentId":"` + sideL + `","role":"side","face":"front"},{"componentId":"` + sideR + `","role":"side","face":"back"}],"station":{"startMarginMm":40,"endMarginMm":40}}}}]`
		recipe  = `{"recipeId":"frz:minifix","recipeRevision":"rev-1","variants":[
			{"targetFace":"front","rules":[
				{"ruleId":"frz-cam","ruleRevision":"rev-1","participantRole":"A","operationRole":"housing","entryFace":"bottom","offsetMm":[0,0,0],"axis":[0,-1,0],"diameterMm":15,"depthMm":13},
				{"ruleId":"frz-dowel","ruleRevision":"rev-1","participantRole":"B","operationRole":"dowel","entryFace":"back","offsetMm":[0,18,0],"axis":[0,-1,0],"diameterMm":8,"depthMm":17}]},
			{"targetFace":"back","rules":[
				{"ruleId":"frz-cam","ruleRevision":"rev-1","participantRole":"A","operationRole":"housing","entryFace":"top","offsetMm":[0,0,0],"axis":[0,-1,0],"diameterMm":15,"depthMm":13},
				{"ruleId":"frz-dowel","ruleRevision":"rev-1","participantRole":"B","operationRole":"dowel","entryFace":"front","offsetMm":[0,18,0],"axis":[0,-1,0],"diameterMm":8,"depthMm":17}]}]}`
	)

	fx := setupReleaseFixtureWithOptions(t, releaseFixtureOptions{
		choices: map[string]string{"BODY": releaseMaterial},
		seedCatalog: func(t *testing.T, admin *pgxpool.Pool) {
			t.Helper()
			statements := []string{
				// The governed cabinet: two sides + a shelf inside the fixture
				// structure (the geometry proven by the browser gate).
				`INSERT INTO components (id, code, name, placement, length_mm, width_mm, length_formula, width_formula, thickness_mm, option_roles, organization_id) VALUES
				 ('` + sideL + `', 'FRZ-LAT', 'Congelado lateral izq', 'lateral_izquierdo', 684, 560, 'PH - 2*T', 'PD', 18, '{BODY}', '` + rlsOrgA + `'),
				 ('` + sideR + `', 'FRZ-LATD', 'Congelado lateral der', 'lateral_derecho', 684, 560, 'PH - 2*T', 'PD', 18, '{BODY}', '` + rlsOrgA + `'),
				 ('` + shelf + `', 'FRZ-ENTRE', 'Congelado entrepaño', 'interno', 564, 542, 'PW - 2*T', 'PD - T', 18, '{BODY}', '` + rlsOrgA + `')`,
				`INSERT INTO structure_components (structure_id, component_id, quantity, organization_id) VALUES
				 ('71000000-0000-0000-0000-000000000001', '` + sideL + `', 1, '` + rlsOrgA + `'),
				 ('71000000-0000-0000-0000-000000000001', '` + sideR + `', 1, '` + rlsOrgA + `'),
				 ('71000000-0000-0000-0000-000000000001', '` + shelf + `', 1, '` + rlsOrgA + `')`,
				// The definition's OWN binding: fixed-shelf-side whose station
				// parameter defaults to 3. Any resolved pattern that is not 3
				// can only come from the factory policy.
				`UPDATE modules SET parameter_definitions = '` + binding + `'::jsonb WHERE id='` + fiModuleA + `'`,
				`INSERT INTO hardwares (id, code, name, unit, cost_per_unit, organization_id)
				 VALUES ('` + hwA + `', 'FRZ-MINIFIX', 'Minifix congelado', 'piece', 10, '` + rlsOrgA + `')`,
				`INSERT INTO hardware_profiles (id, organization_id, code, name, revision, items, recipe_ref, recipe, active)
				 VALUES ('` + profA + `', '` + rlsOrgA + `', 'PERF-FRZ', 'Unión congelada', 'rev-1',
				 '[{"hardwareId":"` + hwA + `","quantity":1,"applicationRole":"cam"}]'::jsonb,
				 '{"recipeId":"frz:minifix","recipeRevision":"rev-1"}'::jsonb,
				 '` + recipe + `'::jsonb, TRUE)`,
			}
			for _, statement := range statements {
				if _, err := admin.Exec(context.Background(), statement); err != nil {
					t.Fatalf("seed governed catalog: %v", err)
				}
			}
			// Publish the Standard release carrying the profile BEFORE the
			// release flow: the freeze-time loader pins THIS release.
			draftID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)
			if _, err := admin.Exec(context.Background(), `UPDATE library_releases SET version = '0.1.0-freeze' WHERE id = $1`, draftID); err != nil {
				t.Fatalf("retarget draft: %v", err)
			}
			if _, _, err := application.PublishStandardRelease(storage.WithOrgCtx(context.Background(), rlsOrgA), &storage.PostgresStore{Pool: admin}, draftID, uuid.MustParse(rlsUserA)); err != nil {
				t.Fatalf("publish: %v", err)
			}
		},
	})
	actorA := fiActorA()

	// Per-face assignments + factory policy v1 (shelfToSide = 4).
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		for _, pair := range [][2]string{{sideL, "front"}, {sideR, "back"}} {
			if err := fx.store.SetComponentSideAssignment(ctx, &domain.ComponentSideAssignment{
				ComponentID: pair[0], Side: pair[1], ProfileID: profA,
			}); err != nil {
				return err
			}
		}
		overrides, _ := json.Marshal(map[string]any{
			"joint.shelfToSide.systemId":      "minifix-dowel",
			"joint.shelfToSide.stationsCount": 4,
			"joint.shelfToSide.startMarginMm": 40,
			"joint.shelfToSide.endMarginMm":   40,
		})
		release, err := fx.store.GetCurrentPublishedRelease(ctx, uuid.MustParse(domain.GraneteStandardLibraryID))
		if err != nil {
			return err
		}
		_, err = fx.store.CreateOverlay(ctx, &domain.LibraryOverlay{
			OrganizationID: uuid.MustParse(rlsOrgA), LibraryID: uuid.MustParse(domain.GraneteStandardLibraryID),
			BaseReleaseID: release.ID, Status: "active", Overrides: overrides,
		})
		return err
	})
	if err != nil {
		t.Fatalf("governed fixture state: %v", err)
	}

	createRelease := func(tag string) *storage.ProductionReleaseReadback {
		t.Helper()
		var readback *storage.ProductionReleaseReadback
		err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
			var err error
			readback, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
				ProjectID:        fx.projectID,
				DesignRevisionID: fx.revR3,
				QuoteRevisionID:  fx.quoteQ3,
				ActorUserID:      rlsUserA,
			})
			return err
		})
		if err != nil {
			t.Fatalf("create release %s: %v", tag, err)
		}
		return readback
	}

	readFrozen := func(t *testing.T, releaseID string) (d15, d8 int, demand, requirements map[string]float64, raw []byte) {
		t.Helper()
		var snapshot *storage.ReleaseManufacturingSnapshot
		err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
			var err error
			snapshot, err = fx.store.GetProductionReleaseManufacturingSnapshot(ctx, fx.projectID, releaseID)
			return err
		})
		if err != nil {
			t.Fatalf("read snapshot: %v", err)
		}
		raw, err = json.Marshal(snapshot)
		if err != nil {
			t.Fatalf("marshal snapshot: %v", err)
		}
		for _, unit := range snapshot.Routing.Units {
			for _, part := range unit.Parts {
				for _, operation := range part.Operations {
					for _, hole := range operation.Holes {
						switch hole.DiameterMm {
						case 15:
							d15++
						case 8:
							d8++
						}
					}
				}
			}
		}
		demand = map[string]float64{}
		for _, unit := range snapshot.Units {
			for _, line := range unit.HardwareProfileDemand {
				demand[line.HardwareID] += line.Quantity
			}
		}
		requirements = map[string]float64{}
		for _, line := range snapshot.Requirements {
			if line.Kind == "herrajes" {
				requirements[line.MaterialID] += line.Quantity
			}
		}
		t.Logf("frozen %s: d15=%d d8=%d demand=%v requirements=%v", releaseID[:8], d15, d8, demand, requirements)
		return d15, d8, demand, requirements, raw
	}

	// 1-3. R1 under policy 4: routing, demand and merged requirements freeze.
	r1 := createRelease("R1")
	r1d15, r1d8, r1Demand, r1Requirements, r1Raw := readFrozen(t, r1.Release.ID)
	// 2 units x 2 contacts x 4 stations, per recipe rule diameter.
	if r1d15 != 16 || r1d8 != 16 {
		t.Fatalf("R1 frozen routing must carry exactly the 4-station pattern: d15=%d d8=%d", r1d15, r1d8)
	}
	// #1065: demand applies the profile items PER PLANNED STATION — the same
	// 2 units x 2 contacts x 4 stations the frozen routing drills — never
	// the old per-contact count that bought half the fasteners.
	if r1Demand[hwA] != 16 {
		t.Fatalf("R1 demand = %+v, want 2 units x 2 contacts x 4 stations of the pinned profile hardware", r1Demand)
	}
	if r1Requirements[hwA] != 16 {
		t.Fatalf("R1 requirements = %+v, want the 16-station demand merged into herrajes before rounding", r1Requirements)
	}

	// 4. The factory changes its policy to 2.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		overrides, _ := json.Marshal(map[string]any{
			"joint.shelfToSide.systemId":      "minifix-dowel",
			"joint.shelfToSide.stationsCount": 2,
			"joint.shelfToSide.startMarginMm": 40,
			"joint.shelfToSide.endMarginMm":   40,
		})
		overlay, err := fx.store.GetActiveOverlayByLibrary(ctx, uuid.MustParse(rlsOrgA), uuid.MustParse(domain.GraneteStandardLibraryID))
		if err != nil {
			return err
		}
		return fx.store.UpdateOverlayOverrides(ctx, overlay.ID, overlay.Version, overrides, nil)
	})
	if err != nil {
		t.Fatalf("policy change: %v", err)
	}

	// 5. R1 is STILL the policy-4 truth, byte for byte.
	d15After, d8After, _, _, r1RawAfter := readFrozen(t, r1.Release.ID)
	if d15After != r1d15 || d8After != r1d8 {
		t.Fatalf("R1 after the policy change: %d/%d holes, want the frozen %d/%d", d15After, d8After, r1d15, r1d8)
	}
	if string(r1RawAfter) != string(r1Raw) {
		t.Fatalf("R1 snapshot bytes changed after an unrelated policy edit")
	}

	// 6-7. R2 under policy 2 freezes the NEW pattern; demand applies the
	// items per planned station (#1065), scaling with the pattern.
	r2 := createRelease("R2")
	r2d15, r2d8, r2Demand, r2Requirements, _ := readFrozen(t, r2.Release.ID)
	// 2 units x 2 contacts x 2 stations: the NEW policy, never R1's.
	if r2d15 != 8 || r2d8 != 8 {
		t.Fatalf("R2 frozen routing must carry exactly the 2-station pattern: d15=%d d8=%d", r2d15, r2d8)
	}
	if r2Demand[hwA] != 8 || r2Requirements[hwA] != 8 {
		t.Fatalf("R2 demand/requirements = %+v / %+v, want the 2-units x 2-contacts x 2-stations demand", r2Demand, r2Requirements)
	}

	// 8. Both releases remain independent frozen truths.
	if r1.Release.ID == r2.Release.ID || r1.Release.ReleaseNumber != 1 || r2.Release.ReleaseNumber != 2 {
		t.Fatalf("release identity/numbering: %+v %+v", r1.Release, r2.Release)
	}
}
