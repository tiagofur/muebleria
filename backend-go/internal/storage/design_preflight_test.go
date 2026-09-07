package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #502 / WEB-DT-3 storage proofs for the read-only authoritative preflight
// evaluation. The core invariant: EvaluateDesignRevisionPreflight returns
// EXACTLY the verdict the release command enforces — same inputs, same
// domain function — and creates nothing.

func TestEvaluateDesignRevisionPreflight_ReadyParityWithReleaseGate(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	var result *domain.ManufacturingPreflightResult
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		result, err = fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, fx.revR3)
		return err
	})
	if err != nil {
		t.Fatalf("evaluate preflight: %v", err)
	}
	if result.Scope != domain.ManufacturingPreflightScope {
		t.Fatalf("scope must be the release gate scope %q, got %q", domain.ManufacturingPreflightScope, result.Scope)
	}
	if result.Status != domain.ManufacturingPreflightReady {
		t.Fatalf("clean fixture revision must be ready, got %q (issues: %v)", result.Status, result.Issues)
	}
	if len(result.Items) == 0 {
		t.Fatalf("ready result must list the validated items")
	}

	// Parity: the release command accepts the same revision — one verdict,
	// two surfaces.
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
		t.Fatalf("release must succeed when the evaluation said ready: %v", err)
	}
	if release.Release.DesignRevisionID != fx.revR3 || release.Release.QuoteRevisionID != fx.quoteQ3 {
		t.Fatalf("release must pin the exact revisions")
	}

	// Read-only: evaluating never creates release rows by itself.
	var evaluatedOnly int
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM production_releases WHERE project_id = $1`, fx.projectID,
	).Scan(&evaluatedOnly); err != nil {
		t.Fatal(err)
	}
	if evaluatedOnly != 1 {
		t.Fatalf("evaluation must not create releases; expected 1 (the explicit command), got %d", evaluatedOnly)
	}
}

func TestEvaluateDesignRevisionPreflight_BlockedParityWithReleaseGate(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	// Publish + approve a revision whose parameters violate the catalog
	// contract (widthMm as a string) — approval is orthogonal to preflight,
	// so the release gate is what must fail closed.
	var blockedRevID string
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		if _, err := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   fx.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": "seiscientos", "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		rev, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       fx.designID,
			BaseRevisionID: fx.revR3,
			SourceType:     domain.DesignRevisionSourceSketchup,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		blockedRevID = rev.ID
		_, err = fx.store.ApproveDesignRevision(ctx, storage.ApproveDesignRevisionCommand{
			DesignID:         fx.designID,
			DesignRevisionID: rev.ID,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish+approve parameter-violating revision: %v", err)
	}

	var result *domain.ManufacturingPreflightResult
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		result, err = fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, blockedRevID)
		return err
	})
	if err != nil {
		t.Fatalf("evaluate blocked preflight: %v", err)
	}
	if result.Status != domain.ManufacturingPreflightBlocked {
		t.Fatalf("parameter violation must block, got %q", result.Status)
	}
	sawInvalidParameters := false
	for _, issue := range result.Issues {
		if issue.Code == domain.PreflightIssueInvalidParameters {
			sawInvalidParameters = true
		}
		if issue.FurnitureInstanceID != fx.fiA && issue.FurnitureInstanceID != "" {
			t.Fatalf("issue must point at the exact physical unit, got %q", issue.FurnitureInstanceID)
		}
	}
	if !sawInvalidParameters {
		t.Fatalf("expected invalid_parameters issue, got %+v", result.Issues)
	}

	// Parity negative proof: the release command rejects the same revision
	// with the SAME authoritative verdict — a UI showing "blocked" can never
	// be bypassed by force-calling the release. (No quote pin: the commercial
	// gate runs first and this fixture's parameter change is also commercial;
	// the preflight parity is what this proof isolates.)
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: blockedRevID,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	var blocked *domain.ReleasePreflightBlockedError
	if !errors.As(err, &blocked) {
		t.Fatalf("release must be blocked by the same preflight, got %v", err)
	}
	if blocked.Result.Status != result.Status || len(blocked.Result.Issues) != len(result.Issues) {
		t.Fatalf("gate verdict must equal the read-only evaluation: read=%+v gate=%+v", result, blocked.Result)
	}
}

func TestEvaluateDesignRevisionPreflight_ExactRevisionFailClosed(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	// Nonexistent revision.
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, "4eeeeeee-0000-0000-0000-00000000000e")
		return err
	})
	if !errors.Is(err, domain.ErrDesignRevisionNotFound) {
		t.Fatalf("nonexistent revision must fail closed 404, got %v", err)
	}

	// Foreign design: a valid revision id under a different design id must
	// answer the uniform 404 — never evaluate someone else's pin.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.EvaluateDesignRevisionPreflight(ctx, "3ddddddd-0000-0000-0000-00000000000d", fx.revR3)
		return err
	})
	if !errors.Is(err, domain.ErrDesignRevisionNotFound) {
		t.Fatalf("cross-design revision must fail closed 404, got %v", err)
	}

	// Invalid UUIDs.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.EvaluateDesignRevisionPreflight(ctx, "not-uuid", fx.revR3)
		return err
	})
	if !errors.Is(err, domain.ErrInvalidReleaseCommand) {
		t.Fatalf("invalid ids must reject, got %v", err)
	}
}

func TestEvaluateDesignRevisionPreflight_OrgReadScope(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	// A revision on a PRIVATE org-A project: org B has no project
	// relationship, so RLS hides the revision behind the uniform 404.
	var privateDesignID, privateRevID string
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		d, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiProjectAOnly,
			Name:        "Org A private design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		privateDesignID = d.ID
		// Empty working copy: publish is allowed; the preflight would flag
		// empty_revision — but org B must never reach the verdict at all.
		rev, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:    d.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		privateRevID = rev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("publish private revision: %v", err)
	}

	err = fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, err := fx.store.EvaluateDesignRevisionPreflight(ctx, privateDesignID, privateRevID)
		return err
	})
	if !errors.Is(err, domain.ErrDesignRevisionNotFound) {
		t.Fatalf("org without project access must get the uniform 404, got %v", err)
	}
}
