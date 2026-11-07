package storage_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1302/#1305 → #1532 — the opening release gate reads the PROJECT GRIP: a
// revision whose units' effective grip (each furniture's override, else the
// project's frozen snapshot) declares a real opening (gola/rebase) must
// resolve it COMPLETELY for production; an opening that cannot resolve
// blocks the command and the read-only preflight with ONE verdict. The
// handle baseline and projects without a grip keep releasing exactly as
// before. The authoring defaults carry no opening anymore (#1532): the grip
// is project state, seeded here through the same style/freeze round trip the
// API serves.

// releaseFixtureWithOpeningHardware builds the canonical release fixture with
// the 8006 gola hardware in the catalog (the hardware the grip's frozen
// profile declares as BOM members).
func releaseFixtureWithOpeningHardware(t *testing.T) *releaseFixture {
	t.Helper()
	return setupReleaseFixtureWithOptions(t, releaseFixtureOptions{
		choices: map[string]string{"BODY": releaseMaterial},
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
}

func openingGateIssue(result *domain.ManufacturingPreflightResult) *domain.ManufacturingPreflightIssue {
	for i := range result.Issues {
		if result.Issues[i].Code == domain.PreflightIssueOpeningReleaseUnresolved {
			return &result.Issues[i]
		}
	}
	return nil
}

// publishApprovedRevisionWithUnitWithoutDims rewrites the design working copy
// so the second unit carries no explicit dimensions, then publishes and
// approves the new revision — the exact immutable snapshot the gate reads.
func publishApprovedRevisionWithUnitWithoutDims(t *testing.T, fx *releaseFixture) string {
	t.Helper()
	var revID string
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		if _, err := UpdateWorkingCopyCurrent(ctx, fx.store, storage.UpdateDesignWorkingCopyCommand{
			DesignID: fx.designID, SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
				{FurnitureInstanceID: fx.fiB, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
			},
		}); err != nil {
			return err
		}
		rev, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID: fx.designID, BaseRevisionID: fx.revR3, SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		revID = rev.ID
		_, err = fx.store.ApproveDesignRevision(ctx, storage.ApproveDesignRevisionCommand{
			DesignID: fx.designID, DesignRevisionID: rev.ID, ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish dims-less revision: %v", err)
	}
	return revID
}

func TestProductionRelease_OpeningSelectionBlocksRelease(t *testing.T) {
	t.Run("gola", func(t *testing.T) {
		fx := releaseFixtureWithOpeningHardware(t)
		seedVerifiedGolaProfile(t, fx.store, openingProfileID)
		applyGripStyle(t, fx.store, fx.projectID, golaStyleForAllTypes("Gola L del taller", openingProfileID))
		actorA := fiActorA()

		// The honest v2 blocker: the project grip stays gola while one
		// published unit loses its explicit dimensions — the opening cannot
		// resolve for that unit, and an unresolvable opening never freezes.
		revNoDims := publishApprovedRevisionWithUnitWithoutDims(t, fx)

		// The read-only preflight answers the blocked verdict as a RESULT.
		var result *domain.ManufacturingPreflightResult
		err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
			var err error
			result, err = fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, revNoDims, "")
			return err
		})
		if err != nil {
			t.Fatalf("evaluate preflight: %v", err)
		}
		if result.Status != domain.ManufacturingPreflightBlocked {
			t.Fatalf("preflight must block a gola revision without dims, got %q (issues: %+v)", result.Status, result.Issues)
		}
		issue := openingGateIssue(result)
		if issue == nil {
			t.Fatalf("blocked verdict must carry %s, got %+v", domain.PreflightIssueOpeningReleaseUnresolved, result.Issues)
		}
		if !strings.Contains(issue.Message, "sin dimensiones explícitas") || !strings.Contains(issue.Message, fx.fiB) {
			t.Fatalf("the opening issue must name the dims-missing unit, got %q", issue.Message)
		}

		// Parity: the release command enforces the SAME verdict. The
		// dims-less revision is not requote-compatible with the accepted Q3,
		// so the command runs under the quote-less release policy (no
		// commercial baseline) — the opening gate verdict is the same one.
		err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
			_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
				ProjectID:        fx.projectID,
				DesignRevisionID: revNoDims,
				ActorUserID:      rlsUserA,
			})
			return err
		})
		var blocked *domain.ReleasePreflightBlockedError
		if !errors.As(err, &blocked) {
			t.Fatalf("gola release must be blocked by the preflight error, got %v", err)
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

// #1531 (A4) → #1532: the overhang millimetres ride the project's frozen
// grip (20 by default), so a bottom_overhang recipe no longer waits for
// field evidence: the opening gate does not block it.
func TestProductionRelease_BottomOverhangResolvesFromGripStyles(t *testing.T) {
	fx := releaseFixtureWithOpeningHardware(t)
	overhang := 40.0
	style := &domain.GripStyle{
		Name: "Rebase del taller", Offered: true,
		ByFurnitureType: map[string]domain.GripStyleRecipe{
			"inferior": {Mode: domain.GripModeBottomOverhang, OverhangMm: &overhang},
			"superior": {Mode: domain.GripModeHandle},
			"alto":     {Mode: domain.GripModeHandle},
		},
	}
	applyGripStyle(t, fx.store, fx.projectID, style)
	var result *domain.ManufacturingPreflightResult
	err := releaseTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		result, err = fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, fx.revR3, "")
		return err
	})
	if err != nil {
		t.Fatalf("evaluate preflight: %v", err)
	}
	if issue := openingGateIssue(result); issue != nil {
		t.Fatalf("a bottom_overhang grip must resolve from the frozen style, got %+v", issue)
	}
}

func TestProductionRelease_HandleSelectionAndLegacyRevisionsRelease(t *testing.T) {
	fx := releaseFixtureWithOpeningHardware(t)
	// The v2 handle baseline: the project's grip consumes nothing, so the
	// resolve keeps its no-opening semantics.
	applyGripStyle(t, fx.store, fx.projectID, handleStyleForAllTypes("Jaladera del taller"))
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
		t.Fatalf("handle grip must not block the preflight, got %q (issues: %+v)", result.Status, result.Issues)
	}
	if openingGateIssue(result) != nil {
		t.Fatalf("handle grip must not carry the opening issue")
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

	// The legacy revision path (a project without any grip) is the shared
	// fixture every existing release test runs: one canonical proof here.
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
		t.Fatalf("legacy revision without a grip must release: %v", err)
	}
}

// #1305 → #1532: a COMPLETE gola grip resolves for production — the release
// freezes, and its requirements carry the member demand the same
// ResolveProjectGripBOM priced into the quote. One governed resolve, never a
// parallel one. Exact expectations from the fixture: the grip is project
// state, so BOTH 600 mm units resolve their own run — 600 − 2×18 = 564 mm
// interior each → 0.564 m of profile, ceil(564/400)+1 = 3 supports and 2
// exposed ends per unit, doubled by the two-unit collection: 1.128 m / 6 / 4.
// Single-row furniture: no between run exists, so nothing beyond the top
// boundary appears.
func TestProductionRelease_GolaSelectionReleasesWiredOpening(t *testing.T) {
	fx := releaseFixtureWithOpeningHardware(t)
	seedVerifiedGolaProfile(t, fx.store, openingProfileID)
	applyGripStyle(t, fx.store, fx.projectID, golaStyleForAllTypes("Gola L del taller", openingProfileID))
	actorA := fiActorA()

	// The read-only preflight answers READY: the frozen grip resolves.
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
		t.Fatalf("complete gola grip must stay ready, got %q (issues: %+v)", result.Status, result.Issues)
	}
	if openingGateIssue(result) != nil {
		t.Fatalf("complete gola grip must not carry the opening issue")
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
		t.Fatalf("complete gola grip must release: %v", err)
	}

	// The frozen snapshot's requirements carry the member demand with the
	// exact quantities ONE ResolveProjectGripBOM produced for every unit.
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
	if len(quantities) != 3 {
		t.Fatalf("a single-row front adds no between run: herrajes = %+v", quantities)
	}
}
