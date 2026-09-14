package storage_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #727 — ProductionRelease over a DesignRevision whose items carry explicit
// dimensions while the referenced catalog module owns commercial measure
// presets. The published revision is the frozen physical truth: the release
// resolves from the item dimensions, never from a preset, and the preflight
// verdict can no longer report READY for a snapshot that would not resolve.

// turnReleaseModulePresetBearing converts the fixture module into a commercial
// preset-bearing module AFTER the quote/revision exist — the exact production
// scenario — and makes the panel part follow the unit dimensions (D×W) so the
// resolved BOM reveals which dimensions were authoritative. Preset sizes are
// deliberately different from the revision items' 600×720×560.
func turnReleaseModulePresetBearing(t *testing.T, fx *releaseFixture) {
	t.Helper()
	multiOrgExec(t, fx.admin, `
		INSERT INTO module_presets (id, module_id, name, width_mm, height_mm, depth_mm, organization_id) VALUES
		('72000000-0000-0000-0000-0000000072a1', '`+fiModuleA+`', 'Standard', 800, 900, 600, '`+rlsOrgA+`'),
		('72000000-0000-0000-0000-0000000072a2', '`+fiModuleA+`', 'XL', 1000, 1000, 650, '`+rlsOrgA+`');
		UPDATE components SET length_formula='D', width_formula='W' WHERE code='RELEASE-PANEL';`)
}

// Happy path (#727 entrega E): preset-bearing module + DesignRevision items
// with explicit dimensions and NO preset reference anywhere → preflight READY
// (including the release snapshot resolution) → CreateProductionRelease
// SUCCESS with the BOM pinned to the item's exact dimensions.
func TestProductionRelease_ExplicitDimensionsPresetModule(t *testing.T) {
	fx := setupReleaseFixture(t)
	turnReleaseModulePresetBearing(t, fx)
	actorA := fiActorA()

	// Preflight↔release parity (positive): the exact snapshot resolution runs
	// inside the readiness evaluation, so READY means releasable.
	var preflight *domain.ManufacturingPreflightResult
	if err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		preflight, err = fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, fx.revR3)
		return err
	}); err != nil {
		t.Fatalf("evaluate preflight: %v", err)
	}
	if preflight.Status != domain.ManufacturingPreflightReady {
		t.Fatalf("explicit-dimension revision over preset module must be READY, got %+v", preflight)
	}

	var p1 *storage.ProductionReleaseReadback
	err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		p1, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
			RequestID:        "req-727-preset-release",
		})
		return err
	})
	if err != nil {
		t.Fatalf("release over preset module with explicit dimensions must succeed: %v", err)
	}
	if p1.Release.ReleaseNumber != 1 || p1.Release.DesignRevisionID != fx.revR3 ||
		p1.Release.QuoteRevisionID != fx.quoteQ3 || p1.Staleness.ManufacturingStale {
		t.Fatalf("P1 pins mismatch: %+v", p1.Release)
	}
	if !strings.HasPrefix(p1.Release.ManufacturingFingerprint, "sha256-") {
		t.Fatalf("P1 fingerprint must be sha256-…: %s", p1.Release.ManufacturingFingerprint)
	}

	// Exactly one release row; Project.status never participates.
	var releaseCount int
	var projectStatus string
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT (SELECT count(*) FROM production_releases WHERE project_id=$1), status FROM projects WHERE id=$1`,
		fx.projectID).Scan(&releaseCount, &projectStatus); err != nil {
		t.Fatal(err)
	}
	if releaseCount != 1 || projectStatus != "draft" {
		t.Fatalf("expected exactly one release and Project.status untouched (draft), got %d releases, status=%s", releaseCount, projectStatus)
	}

	// The frozen manufacturing snapshot proves dimension authority: the same
	// physical identities, the item parameters, and board parts derived from
	// the ITEM's 600×720×560 (part 560×600) — never the preset 800×900×600
	// (which would produce 600×800).
	var snapshot *storage.ReleaseManufacturingSnapshot
	if err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		snapshot, err = fx.store.GetProductionReleaseManufacturingSnapshot(ctx, fx.projectID, p1.Release.ID)
		return err
	}); err != nil {
		t.Fatalf("read manufacturing snapshot: %v", err)
	}
	if len(snapshot.Units) != 2 {
		t.Fatalf("snapshot must freeze both physical units, got %d", len(snapshot.Units))
	}
	seen := map[string]bool{}
	for _, unit := range snapshot.Units {
		seen[unit.Resolved.FurnitureInstanceID] = true
		if unit.Resolved.FurnitureDefinitionID != fiModuleA {
			t.Fatalf("definition identity must survive: %+v", unit.Resolved)
		}
		if unit.Parameters["widthMm"] != 600.0 || unit.Parameters["heightMm"] != 720.0 || unit.Parameters["depthMm"] != 560.0 {
			t.Fatalf("snapshot parameters must be the item's explicit dimensions: %+v", unit.Parameters)
		}
		for _, part := range unit.Resolved.BOM.BoardParts {
			if part.LengthMm != 560 || part.WidthMm != 600 {
				t.Fatalf("BOM part %s must derive from the item dimensions (560×600), got %d×%d — preset leaked?",
					part.ID, part.LengthMm, part.WidthMm)
			}
		}
	}
	if !seen[fx.fiA] || !seen[fx.fiB] {
		t.Fatalf("snapshot must pin the exact FurnitureInstance identities %s/%s, got %v", fx.fiA, fx.fiB, seen)
	}
	if len(snapshot.Requirements) == 0 {
		t.Fatal("snapshot must freeze material requirements")
	}

	// Existing retry semantics preserved: a second command creates release #2
	// with the same pins — no idempotency regression.
	var p2 *storage.ProductionReleaseReadback
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		p2, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
			RequestID:        "req-727-preset-release-retry",
		})
		return err
	})
	if err != nil || p2.Release.ReleaseNumber != 2 {
		t.Fatalf("retry must keep the existing numbered-release semantics (release #2), got %+v, %v", p2, err)
	}
}

// Negative parity proof (#727 entregas C+D+E): a revision whose exact snapshot
// cannot resolve (the structure lost its only component, so the unit has no
// manufacturing demand) is BLOCKED by the preflight verdict BEFORE any
// approval or release can present it as ready, and both commands reject with
// the typed, actionable resolution failure.
func TestProductionRelease_PreflightParityBlocksUnresolvableRevision(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	// Catalog drift after authoring: the structure keeps existing (preflight
	// definition/parameter/material checks stay green) but resolves to zero
	// manufacturing demand — exactly the class of blocker only the release
	// snapshot resolution catches.
	multiOrgExec(t, fx.admin, `DELETE FROM structure_components WHERE structure_id='71000000-0000-0000-0000-000000000001';`)

	// Publish R4 with items identical to the accepted Q3 (reconciliation stays
	// clean, so ONLY the resolution gate can reject).
	var revR4 string
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		if _, err := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   fx.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
				{FurnitureInstanceID: fx.fiB, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
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
		revR4 = rev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("publish R4: %v", err)
	}

	// PARITY: the read-only preflight verdict is BLOCKED with the exact typed
	// issue — it can never again report READY for this revision.
	var preflight *domain.ManufacturingPreflightResult
	if err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		preflight, err = fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, revR4)
		return err
	}); err != nil {
		t.Fatalf("evaluate preflight: %v", err)
	}
	if preflight.Status != domain.ManufacturingPreflightBlocked || len(preflight.Issues) == 0 {
		t.Fatalf("unresolvable revision must be BLOCKED with issues, got %+v", preflight)
	}
	foundResolutionIssue := false
	for _, issue := range preflight.Issues {
		if issue.Code == domain.PreflightIssueSnapshotResolution {
			foundResolutionIssue = true
			if issue.FurnitureInstanceID == "" || issue.FurnitureDefinitionID != fiModuleA || strings.TrimSpace(issue.Message) == "" {
				t.Fatalf("resolution issue must carry exact identities and a safe reason: %+v", issue)
			}
		}
	}
	if !foundResolutionIssue {
		t.Fatalf("blocked preflight must include a release_snapshot_resolution issue: %+v", preflight.Issues)
	}

	// The production approval gate rejects with the SAME typed failure (the
	// commercial gates pass: Q3 accepted, reconciliation clean).
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ApproveDesignRevisionForProduction(ctx, storage.ApproveDesignRevisionForProductionCommand{
			ProjectID:        fx.projectID,
			DesignID:         fx.designID,
			DesignRevisionID: revR4,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if !errors.Is(err, storage.ErrReleaseSnapshotResolution) {
		t.Fatalf("production approval must reject with the typed resolution failure, got %v", err)
	}
	var approvalFailure *domain.ReleaseUnitResolutionFailure
	if !errors.As(err, &approvalFailure) {
		t.Fatalf("approval rejection must carry ReleaseUnitResolutionFailure, got %T %v", err, err)
	}

	// Design-first release path (no commercial baseline) is blocked by the
	// same resolution gate: generic approval (no commercial gates) + release
	// without a pinned quote.
	if err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ApproveDesignRevision(ctx, storage.ApproveDesignRevisionCommand{
			DesignID:         fx.designID,
			DesignRevisionID: revR4,
			ActorUserID:      rlsUserA,
		})
		return err
	}); err != nil {
		t.Fatalf("generic approval: %v", err)
	}
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: revR4,
			ActorUserID:      rlsUserA,
			RequestID:        "req-727-unresolvable",
		})
		return err
	})
	if !errors.Is(err, storage.ErrReleaseSnapshotResolution) {
		t.Fatalf("release must reject with the typed resolution failure, got %v", err)
	}
	var releaseFailure *domain.ReleaseUnitResolutionFailure
	if !errors.As(err, &releaseFailure) {
		t.Fatalf("release rejection must carry ReleaseUnitResolutionFailure, got %T %v", err, err)
	}
	if releaseFailure.FurnitureInstanceID == "" || releaseFailure.FurnitureDefinitionID != fiModuleA ||
		strings.TrimSpace(releaseFailure.Reason) == "" ||
		strings.Contains(strings.ToUpper(releaseFailure.Reason), "SELECT") ||
		strings.Contains(releaseFailure.Reason, "sql:") {
		t.Fatalf("typed failure must be business-safe and actionable: %+v", releaseFailure)
	}

	// No release row ever committed.
	var releaseCount int
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT count(*) FROM production_releases WHERE project_id=$1`, fx.projectID).Scan(&releaseCount); err != nil {
		t.Fatal(err)
	}
	if releaseCount != 0 {
		t.Fatalf("no release may commit for an unresolvable revision, found %d", releaseCount)
	}
}
