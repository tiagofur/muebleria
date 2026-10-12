package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1302/#1305 — the opening release gate. A revision whose frozen selection
// declares a real opening system (gola, bottom_overhang) must resolve it
// COMPLETELY for production: an opening that cannot resolve (no pinned
// profile slice, blocked state, underivable BOM) blocks the command and the
// read-only preflight with ONE verdict. The handle baseline (the resolve's
// own no-opening semantics) and legacy revisions without a snapshot keep
// releasing exactly as before.

func releaseFixtureWithOpening(t *testing.T, opening *domain.DesignOpeningSelection) *releaseFixture {
	t.Helper()
	defaults := &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{}, Opening: opening}
	return setupReleaseFixtureWithOptions(t, releaseFixtureOptions{
		choices:           map[string]string{"BODY": releaseMaterial},
		authoringDefaults: defaults,
	})
}

func openingGateIssue(result *domain.ManufacturingPreflightResult) *domain.ManufacturingPreflightIssue {
	for i := range result.Issues {
		if result.Issues[i].Code == domain.PreflightIssueOpeningReleaseUnresolved {
			return &result.Issues[i]
		}
	}
	return nil
}

func TestProductionRelease_OpeningSelectionBlocksRelease(t *testing.T) {
	for _, tc := range []struct {
		name      string
		selection *domain.DesignOpeningSelection
	}{
		{
			name:      "gola",
			selection: &domain.DesignOpeningSelection{System: domain.OpeningGripSystemGola, ProfileID: "gola-l-8006", Placements: []string{"top"}},
		},
		{
			name:      "bottom_overhang",
			selection: &domain.DesignOpeningSelection{System: domain.OpeningGripSystemBottomOverhang, Placements: []string{"bottom"}},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fx := releaseFixtureWithOpening(t, tc.selection)
			actorA := fiActorA()

			// The read-only preflight answers the blocked verdict as a RESULT.
			var result *domain.ManufacturingPreflightResult
			err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
				var err error
				result, err = fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, fx.revR3, "")
				return err
			})
			if err != nil {
				t.Fatalf("evaluate preflight: %v", err)
			}
			if result.Status != domain.ManufacturingPreflightBlocked {
				t.Fatalf("preflight must block a %s revision, got %q (issues: %+v)", tc.name, result.Status, result.Issues)
			}
			issue := openingGateIssue(result)
			if issue == nil {
				t.Fatalf("blocked verdict must carry %s, got %+v", domain.PreflightIssueOpeningReleaseUnresolved, result.Issues)
			}

			// Parity: the release command enforces the SAME verdict.
			err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
				_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
					ProjectID:        fx.projectID,
					DesignRevisionID: fx.revR3,
					QuoteRevisionID:  fx.quoteQ3,
					ActorUserID:      rlsUserA,
				})
				return err
			})
			var blocked *domain.ReleasePreflightBlockedError
			if !errors.As(err, &blocked) {
				t.Fatalf("%s release must be blocked by the preflight error, got %v", tc.name, err)
			}
			if openingGateIssue(blocked.Result) == nil {
				t.Fatalf("blocked command must carry %s, got %+v", domain.PreflightIssueOpeningReleaseUnresolved, blocked.Result.Issues)
			}

			// Nothing leaked: no release row may exist for the blocked project.
			var releases int
			if err := fx.admin.QueryRow(context.Background(),
				`SELECT COUNT(*) FROM production_releases WHERE project_id = $1`, fx.projectID,
			).Scan(&releases); err != nil {
				t.Fatal(err)
			}
			if releases != 0 {
				t.Fatalf("blocked revision must not freeze a release, found %d", releases)
			}
		})
	}
}

func TestProductionRelease_HandleSelectionAndLegacyRevisionsRelease(t *testing.T) {
	fx := releaseFixtureWithOpening(t, &domain.DesignOpeningSelection{System: domain.OpeningGripSystemHandle})
	actorA := fiActorA()

	// The handle baseline is the resolve's own no-opening semantics: the
	// preflight stays ready and the release freezes exactly as before.
	var result *domain.ManufacturingPreflightResult
	err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		result, err = fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, fx.revR3, "")
		return err
	})
	if err != nil {
		t.Fatalf("evaluate preflight: %v", err)
	}
	if result.Status != domain.ManufacturingPreflightReady {
		t.Fatalf("handle selection must not block the preflight, got %q (issues: %+v)", result.Status, result.Issues)
	}
	if openingGateIssue(result) != nil {
		t.Fatalf("handle selection must not carry the opening issue")
	}

	var release *storage.ProductionReleaseReadback
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		release, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("handle revision must release: %v", err)
	}
	if release.Release.DesignRevisionID != fx.revR3 {
		t.Fatalf("release must pin the exact revision")
	}

	// The legacy revision path (nil opening snapshot) is the shared fixture
	// every existing release test runs: one canonical proof here.
	legacy := setupReleaseFixture(t)
	err = releaseTx(t, legacy.store, actorA, func(ctx context.Context) error {
		_, err := legacy.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        legacy.projectID,
			DesignRevisionID: legacy.revR3,
			QuoteRevisionID:  legacy.quoteQ3,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("legacy revision without opening snapshot must release: %v", err)
	}
}

// #1305: a COMPLETE pinned gola selection resolves for production — the
// release freezes, and its requirements carry the member demand the same
// ResolveDesignOpening output priced into the quote. One governed resolve,
// never a parallel one. Exact expectations from the fixture: the opening
// belongs to the DESIGN (#1275), so BOTH 600 mm units resolve their own run
// — 600 − 2×18 = 564 mm interior each → 0.564 m of profile, ceil(564/400)+1
// = 3 supports and 2 exposed ends per unit, doubled by the two-unit
// collection: 1.128 m / 6 / 4.
func TestProductionRelease_GolaSelectionReleasesWiredOpening(t *testing.T) {
	fx := setupReleaseFixtureWithOptions(t, releaseFixtureOptions{
		choices: map[string]string{"BODY": releaseMaterial},
		authoringDefaults: &domain.DesignAuthoringDefaults{
			MaterialChoices: map[string]string{},
			Opening:         pinnedGolaSelection(6),
		},
		seedCatalog: func(t *testing.T, admin *pgxpool.Pool) {
			multiOrgExec(t, admin, `
				INSERT INTO components (id, code, name, placement, length_mm, width_mm, thickness_mm, option_roles, construction, organization_id) VALUES
				('71000000-0000-0000-0000-0000000000a1','OPEN-LAT-L','Lateral apertura','lateral_izquierdo',720,560,18,'{BODY}','{"constructive_role":"lateral"}'::jsonb,'`+rlsOrgA+`'),
				('71000000-0000-0000-0000-0000000000a2','OPEN-LAT-R','Lateral apertura der','lateral_derecho',720,560,18,'{BODY}','{"constructive_role":"lateral"}'::jsonb,'`+rlsOrgA+`'),
				('71000000-0000-0000-0000-0000000000a3','OPEN-DOOR','Puerta apertura','puerta',716,560,18,'{BODY}',NULL,'`+rlsOrgA+`');
				INSERT INTO structure_components (structure_id, component_id, quantity, organization_id) VALUES
				('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-0000000000a1',1,'`+rlsOrgA+`'),
				('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-0000000000a2',1,'`+rlsOrgA+`'),
				('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-0000000000a3',1,'`+rlsOrgA+`');
				INSERT INTO hardwares (id, code, name, unit, cost_per_unit, organization_id)
				VALUES ('`+openingHWProfile+`', '8006', 'Perfil GOLA L 8006', 'meter', 100, '`+rlsOrgA+`'),
				       ('`+openingHWSupport+`', 'SU116', 'Soporte GOLA atornillar', 'piece', 10, '`+rlsOrgA+`'),
				       ('`+openingHWCap+`', 'CF8006TP', 'Juego tapas terminales', 'piece', 5, '`+rlsOrgA+`');`)
		},
	})
	actorA := fiActorA()

	// The read-only preflight answers READY: the pinned selection resolves.
	var result *domain.ManufacturingPreflightResult
	err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		result, err = fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, fx.revR3, "")
		return err
	})
	if err != nil {
		t.Fatalf("evaluate preflight: %v", err)
	}
	if result.Status != domain.ManufacturingPreflightReady {
		t.Fatalf("complete pinned gola must stay ready, got %q (issues: %+v)", result.Status, result.Issues)
	}
	if openingGateIssue(result) != nil {
		t.Fatalf("complete pinned gola must not carry the opening issue")
	}

	var release *storage.ProductionReleaseReadback
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		release, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("complete pinned gola must release: %v", err)
	}

	// The frozen snapshot's requirements carry the member demand with the
	// exact quantities ONE ResolveDesignOpening produced for every unit.
	var payload struct {
		Requirements []domain.MaterialRequirementLine `json:"requirements"`
	}
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT payload FROM production_release_manufacturing_snapshots WHERE release_id = $1`,
		release.Release.ID,
	).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	quantities := map[string]float64{}
	for _, line := range payload.Requirements {
		if line.Kind == "herrajes" {
			quantities[line.MaterialID] = line.Quantity
		}
	}
	if quantities[openingHWProfile] != 1.128 {
		t.Fatalf("frozen requirements must carry 2×0.564 m of profile, got %+v", quantities)
	}
	if quantities[openingHWSupport] != 6 {
		t.Fatalf("frozen requirements must carry 2×3 supports, got %+v", quantities)
	}
	if quantities[openingHWCap] != 4 {
		t.Fatalf("frozen requirements must carry 2×2 exposed-end caps, got %+v", quantities)
	}
}
