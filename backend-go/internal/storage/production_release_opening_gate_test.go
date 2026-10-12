package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1302 — the opening production-integration gate. The release snapshot
// resolves WITHOUT the design opening (fronts/members/body modifiers), so a
// revision whose frozen selection declares a real opening system (gola,
// bottom_overhang) must not freeze a release: the command and the read-only
// preflight share ONE verdict. The handle baseline (the resolve's own
// no-opening semantics) and legacy revisions without a snapshot keep
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
		if result.Issues[i].Code == domain.PreflightIssueOpeningReleaseUnsupported {
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
				t.Fatalf("blocked verdict must carry %s, got %+v", domain.PreflightIssueOpeningReleaseUnsupported, result.Issues)
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
				t.Fatalf("blocked command must carry %s, got %+v", domain.PreflightIssueOpeningReleaseUnsupported, blocked.Result.Issues)
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
