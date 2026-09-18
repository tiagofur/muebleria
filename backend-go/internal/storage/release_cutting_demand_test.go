package storage_test

import (
	"context"
	"reflect"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #739 — the frozen cutting demand projection engineering prepares against.
// The projection reads exclusively from the private manufacturing snapshot:
// exact physical identities, quantities, dimensions, effective thickness,
// material identity, grain and edge flags. Mutable catalog/project state
// never rebuilds it, and a missing snapshot is unavailable evidence.

// frozen release demand: release P1 over the canonical fixture (2 physical
// units of the same definition — repeated units must keep distinct
// identities with full quantities), with L1 edge flags frozen from the
// component's default edges.
func createCuttingDemandRelease(t *testing.T, fx *releaseFixture) *storage.ReleaseCuttingDemandView {
	t.Helper()
	// Edge flags must be part of the frozen content: give the panel a default
	// L1 edge (resolved through the material's default edge band) BEFORE the
	// release so the snapshot freezes it.
	multiOrgExec(t, fx.admin, `
		UPDATE material_boards SET default_edge_band_id='70000000-0000-0000-0000-000000000003' WHERE id='`+releaseMaterial+`';
		UPDATE components SET default_edges='[{"side":"L1","enabled":true}]' WHERE code='RELEASE-PANEL';`)
	actorA := fiActorA()
	var p1 *storage.ProductionReleaseReadback
	err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var innerErr error
		p1, innerErr = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
			RequestID:        "req-739-cutting-demand",
		})
		return innerErr
	})
	if err != nil {
		t.Fatalf("create release P1: %v", err)
	}
	var demand *storage.ReleaseCuttingDemandView
	if err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var innerErr error
		demand, innerErr = fx.store.GetProjectProductionReleaseCuttingDemand(ctx, fx.projectID, p1.Release.ID)
		return innerErr
	}); err != nil {
		t.Fatalf("read cutting demand: %v", err)
	}
	if demand.ReleaseID != p1.Release.ID || demand.ReleaseNumber != 1 ||
		demand.DesignRevisionID != fx.revR3 || demand.ManufacturingFingerprint != p1.Release.ManufacturingFingerprint {
		t.Fatalf("demand must pin the exact release readback: %+v", demand)
	}
	return demand
}

func TestReleaseCuttingDemand_ExactUnitsAndFrozenFields(t *testing.T) {
	fx := setupReleaseFixture(t)
	demand := createCuttingDemandRelease(t, fx)

	if len(demand.Units) != 2 {
		t.Fatalf("both physical units must be projected, got %d", len(demand.Units))
	}
	seen := map[string]bool{}
	for index, unit := range demand.Units {
		if unit.FurnitureInstanceID == "" || seen[unit.FurnitureInstanceID] {
			t.Fatalf("unit identities must be exact and unique: %+v", unit)
		}
		seen[unit.FurnitureInstanceID] = true
		// #781: the frozen liberation order is the manufacturing occurrence
		// authority — projected as a dense 1-based ordinal sequence.
		if unit.WorkshopOccurrenceOrdinal != index+1 {
			t.Fatalf("workshop occurrence ordinal must follow the frozen unit order: unit %d got ordinal %d", index+1, unit.WorkshopOccurrenceOrdinal)
		}
		if unit.FurnitureDefinitionID != fiModuleA {
			t.Fatalf("definition identity must survive: %+v", unit)
		}
		if len(unit.Pieces) == 0 {
			t.Fatalf("unit %s must carry board pieces", unit.FurnitureInstanceID)
		}
		for _, piece := range unit.Pieces {
			if piece.Quantity < 1 || piece.LengthMm < 1 || piece.WidthMm < 1 {
				t.Fatalf("piece demand must be positive: %+v", piece)
			}
			if piece.ThicknessMm != 18 {
				t.Fatalf("effective thickness must be the material's 18 mm, got %d", piece.ThicknessMm)
			}
			if piece.MaterialID != releaseMaterial {
				t.Fatalf("material identity must be the frozen choice, got %s", piece.MaterialID)
			}
			if piece.Grain != 0 {
				t.Fatalf("grain must come from the material's grain default (false), got %d", piece.Grain)
			}
			if piece.L1 != 1 || piece.L2 != 0 || piece.W1 != 0 || piece.W2 != 0 {
				t.Fatalf("edge flags must mirror the frozen edges (L1 only), got L%d L%d W%d W%d",
					piece.L1, piece.L2, piece.W1, piece.W2)
			}
		}
	}
	// Repeated units of the same definition project the same piece demand per
	// unit — no deduplication, no loss.
	if !reflect.DeepEqual(demand.Units[0].Pieces, demand.Units[1].Pieces) {
		t.Fatalf("identical repeated units must keep identical per-unit demand: %+v vs %+v",
			demand.Units[0].Pieces, demand.Units[1].Pieces)
	}
}

func TestReleaseCuttingDemand_IgnoresMutableCatalogAndProject(t *testing.T) {
	fx := setupReleaseFixture(t)
	demand := createCuttingDemandRelease(t, fx)

	// The catalog moves on after the release: rename the material, flip grain,
	// resize the module and its component. None of that may rebuild the frozen
	// demand (acceptance: divergent Project/catalog never changes the pieces
	// engineering prepares against).
	multiOrgExec(t, fx.admin, `
		UPDATE material_boards SET name='Renamed board', grain_default=TRUE, thickness_mm=25 WHERE id='`+releaseMaterial+`';
		UPDATE modules SET width_mm=999, height_mm=999, depth_mm=999 WHERE id='`+fiModuleA+`';
		UPDATE components SET length_mm=111, width_mm=222, default_edges='[{"side":"W2","enabled":true}]' WHERE code='RELEASE-PANEL';`)

	var after *storage.ReleaseCuttingDemandView
	if err := releaseTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var innerErr error
		after, innerErr = fx.store.GetProjectProductionReleaseCuttingDemand(ctx, fx.projectID, demand.ReleaseID)
		return innerErr
	}); err != nil {
		t.Fatalf("re-read cutting demand after catalog divergence: %v", err)
	}
	if !reflect.DeepEqual(demand, after) {
		t.Fatalf("catalog/project mutation must not alter the frozen cutting demand:\nbefore=%+v\nafter=%+v", demand, after)
	}
}

func TestReleaseCuttingDemand_UnavailableAndIsolated(t *testing.T) {
	fx := setupReleaseFixture(t)
	demand := createCuttingDemandRelease(t, fx)

	// Unknown release → unavailable evidence, never a fallback.
	if err := releaseTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := fx.store.GetProjectProductionReleaseCuttingDemand(ctx, fx.projectID, "00000000-0000-0000-0000-0000000000ff")
		return err
	}); err != storage.ErrReleaseSnapshotUnavailable {
		t.Fatalf("unknown release must fail with ErrReleaseSnapshotUnavailable, got %v", err)
	}

	// Cross-org actor sees nothing (organization_id-scoped read, no leak).
	err := releaseTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, err := fx.store.GetProjectProductionReleaseCuttingDemand(ctx, fx.projectID, demand.ReleaseID)
		return err
	})
	if err != storage.ErrReleaseSnapshotUnavailable {
		t.Fatalf("foreign organization must fail closed, got %v", err)
	}

	// Reading the demand is a pure projection: no release state changes.
	var releaseStatus string
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT status FROM production_releases WHERE id=$1`, demand.ReleaseID).Scan(&releaseStatus); err != nil {
		t.Fatal(err)
	}
	if releaseStatus != "active" {
		t.Fatalf("reading the demand must not mutate the release, got status=%s", releaseStatus)
	}
}

func mustProjectWorkshopOccurrences(t *testing.T, fx *releaseFixture, releaseID string) *storage.WorkshopOccurrenceProjectionView {
	t.Helper()
	var view *storage.WorkshopOccurrenceProjectionView
	if err := releaseTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var innerErr error
		view, innerErr = fx.store.GetProjectWorkshopOccurrences(ctx, fx.projectID, releaseID)
		return innerErr
	}); err != nil {
		t.Fatalf("workshop occurrence projection must succeed: %v", err)
	}
	return view
}

func assignmentByInstance(view *storage.WorkshopOccurrenceProjectionView, instanceID string) *storage.WorkshopOccurrenceAssignmentView {
	for i := range view.Assignments {
		if view.Assignments[i].FurnitureInstanceID == instanceID {
			return &view.Assignments[i]
		}
	}
	return nil
}

// #781 micro-task #2 — CoversAllCurrentInstances is a BIDIRECTIONAL exact
// set equality: {frozen instance ids} == {current linked instance ids}.
// Frozen ⊊ current, frozen ⊋ current, and unlinked frozen units ALL force
// false — while the frozen assignments stay reported as evidence. Each case
// runs on its own fresh released fixture so every direction is isolated.
func TestProjectWorkshopOccurrences_BidirectionalCoverage(t *testing.T) {
	setupReleased := func(t *testing.T) (*releaseFixture, *storage.ReleaseCuttingDemandView) {
		t.Helper()
		fx := setupReleaseFixture(t)
		return fx, createCuttingDemandRelease(t, fx)
	}

	// Case A — exact equality: frozen {fiA,fiB} == current {fiA,fiB} → true.
	fxA, demandA := setupReleased(t)
	viewA := mustProjectWorkshopOccurrences(t, fxA, demandA.ReleaseID)
	if !viewA.CoversAllCurrentInstances {
		t.Fatalf("exact frozen/current equality must cover: %+v", viewA)
	}
	if len(viewA.Assignments) != 2 {
		t.Fatalf("frozen evidence must carry both units, got %d", len(viewA.Assignments))
	}
	for _, instanceID := range []string{fxA.fiA, fxA.fiB} {
		assignment := assignmentByInstance(viewA, instanceID)
		if assignment == nil {
			t.Fatalf("frozen instance %s must be reported", instanceID)
		}
		if assignment.ProjectItemID == "" {
			t.Fatalf("linked frozen instance %s must carry its project item: %+v", instanceID, assignment)
		}
	}

	// Case B — current extra: a third live link the release never froze.
	// Frozen {fiA,fiB} ⊂ current {fiA,fiB,fiC} → false; frozen evidence stays 2.
	fxB, demandB := setupReleased(t)
	fiC := "60000000-0000-0000-0000-0000000000c3"
	var quoteLineID string
	if err := fxB.admin.QueryRow(context.Background(),
		`SELECT quote_line_id FROM quote_line_furniture_instances WHERE project_id=$1 AND state='current' LIMIT 1`,
		fxB.projectID).Scan(&quoteLineID); err != nil {
		t.Fatalf("read fixture quote line: %v", err)
	}
	multiOrgExec(t, fxB.admin, `
		INSERT INTO furniture_instances (id, organization_id, project_id, furniture_definition_id, origin)
		VALUES ('`+fiC+`', '`+rlsOrgA+`', '`+fxB.projectID+`', '`+fiModuleA+`', 'manual');
		INSERT INTO quote_line_furniture_instances (organization_id, project_id, quote_line_id, furniture_instance_id, state)
		VALUES ('`+rlsOrgA+`', '`+fxB.projectID+`', '`+quoteLineID+`', '`+fiC+`', 'current');`)
	viewB := mustProjectWorkshopOccurrences(t, fxB, demandB.ReleaseID)
	if viewB.CoversAllCurrentInstances {
		t.Fatalf("a current instance the release never covered must break coverage: %+v", viewB)
	}
	if len(viewB.Assignments) != 2 {
		t.Fatalf("frozen evidence must stay exactly the frozen units, got %d", len(viewB.Assignments))
	}
	if assignmentByInstance(viewB, fiC) != nil {
		t.Fatalf("an unfrozen current instance must not appear in the frozen evidence")
	}

	// Case C — frozen without current link: supersede fiB on a fresh release.
	// Frozen {fiA,fiB} ⊋ current {fiA} → false; B stays reported with "".
	fxC, demandC := setupReleased(t)
	multiOrgExec(t, fxC.admin, `
		UPDATE quote_line_furniture_instances SET state='superseded'
		WHERE project_id='`+fxC.projectID+`' AND furniture_instance_id='`+fxC.fiB+`';`)
	viewC := mustProjectWorkshopOccurrences(t, fxC, demandC.ReleaseID)
	if viewC.CoversAllCurrentInstances {
		t.Fatalf("a frozen unit without a current link must break coverage: %+v", viewC)
	}
	unlinked := assignmentByInstance(viewC, fxC.fiB)
	if unlinked == nil {
		t.Fatalf("the unlinked frozen unit must still be reported for traceability")
	}
	if unlinked.ProjectItemID != "" {
		t.Fatalf("the unlinked frozen unit must carry an empty project item, got %+v", unlinked)
	}
	linked := assignmentByInstance(viewC, fxC.fiA)
	if linked == nil || linked.ProjectItemID == "" {
		t.Fatalf("the still-linked frozen unit must keep its project item: %+v", linked)
	}
}

func TestProjectWorkshopOccurrences_FrozenLatestReleaseOrder(t *testing.T) {
	fx := setupReleaseFixture(t)
	demand := createCuttingDemandRelease(t, fx)

	var view *storage.WorkshopOccurrenceProjectionView
	err := releaseTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var innerErr error
		view, innerErr = fx.store.GetProjectWorkshopOccurrences(ctx, fx.projectID, demand.ReleaseID)
		return innerErr
	})
	if err != nil {
		t.Fatalf("workshop occurrence projection must succeed: %v", err)
	}
	if view.ReleaseID == "" || view.ReleaseNumber < 1 {
		t.Fatalf("projection must identify the frozen release: %+v", view)
	}
	// The frozen unit order IS the occurrence authority: dense 1-based
	// ordinals in snapshot order, every instance linked to its project item.
	seen := map[string]bool{}
	for index, assignment := range view.Assignments {
		if assignment.Ordinal != index+1 {
			t.Fatalf("ordinal must follow the frozen snapshot order: got %d at position %d", assignment.Ordinal, index+1)
		}
		if assignment.FurnitureInstanceID == "" || seen[assignment.FurnitureInstanceID] {
			t.Fatalf("assignments must carry unique physical identities: %+v", assignment)
		}
		seen[assignment.FurnitureInstanceID] = true
		if assignment.ProjectItemID == "" {
			t.Fatalf("every frozen unit must map to its project item via the current link: %+v", assignment)
		}
	}
	if len(view.Assignments) < 2 {
		t.Fatalf("fixture must liberate repeated units, got %d", len(view.Assignments))
	}
	if !view.CoversAllCurrentInstances {
		t.Fatalf("an unmodified released project must be fully covered: %+v", view)
	}

	// No liberation at all → unavailable (never a live ordering).
	fx2 := setupReleaseFixture(t)
	err2 := releaseTx(t, fx2.store, fiActorA(), func(ctx context.Context) error {
		_, innerErr := fx2.store.GetProjectWorkshopOccurrences(ctx, fx2.projectID, "00000000-0000-0000-0000-000000000000")
		return innerErr
	})
	if err2 == nil {
		t.Fatalf("a project without releases must not produce an occurrence authority")
	}
}
