package storage_test

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const validSha256 = "sha256-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func sampleRecipeR1() domain.AgregadoRecipePayload {
	kitID := "kit-drawer-box"
	return domain.AgregadoRecipePayload{
		WidthMm:                 600,
		HeightMm:                200,
		DepthMm:                 500,
		Notes:                   "Recipe revision 1",
		CommercialKitHardwareID: &kitID,
		RigidMembers: []domain.AgregadoRigidMember{
			{
				MemberID: "runner-left",
				Role:     "runner_left",
				Source: domain.RigidMemberSource{
					Kind:  domain.RigidMemberSourceFixed,
					Fixed: &domain.FixedHardwareSource{HardwareID: "hw-runner-500"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 10},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 20},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 30},
				},
				BOMRole: domain.BOMRoleIncludedInKit,
			},
		},
		Components: []domain.ComponentInstance{
			{
				ComponentID: "bottom-panel",
				Quantity:    1,
				Overrides: &domain.ComponentInstanceOverrides{
					LengthRule: &domain.AssemblyDimensionRule{
						Source:   domain.DimRuleAssemblyDepth,
						OffsetMm: -10,
					},
					WidthRule: &domain.AssemblyDimensionRule{
						Source:   domain.DimRuleAssemblyWidth,
						OffsetMm: -35,
					},
				},
			},
		},
	}
}

func sampleRecipeR2() domain.AgregadoRecipePayload {
	r := sampleRecipeR1()
	r.Notes = "Recipe revision 2 - updated clearance"
	r.WidthMm = 800
	return r
}

func sampleRecipeWithVariants() domain.AgregadoRecipePayload {
	kitID := "kit-merivobox-500"
	return domain.AgregadoRecipePayload{
		WidthMm:                 600,
		HeightMm:                200,
		DepthMm:                 520,
		Notes:                   "Drawer with depth variants",
		CommercialKitHardwareID: &kitID,
		VariantSets: []domain.AgregadoVariantSet{
			{
				ID:        "vs-depth",
				Dimension: "depth",
				Variants: []domain.ProductVariant{
					{
						HardwareID:         "hw-runner-450",
						NominalDimensionMm: 450,
					},
					{
						HardwareID:         "hw-runner-500",
						NominalDimensionMm: 500,
					},
				},
			},
		},
		CompatibilityRules: []domain.AssemblyCompatibilityRule{
			{
				VariantSetID:      "vs-depth",
				ClearanceMm:       10,
				SelectionStrategy: "max_fitting",
			},
		},
		RigidMembers: []domain.AgregadoRigidMember{
			{
				MemberID: "runner-left",
				Role:     "runner_left",
				Source: domain.RigidMemberSource{
					Kind:    domain.RigidMemberSourceVariant,
					Variant: &domain.VariantHardwareSource{VariantSetID: "vs-depth"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0},
				},
				BOMRole: domain.BOMRoleIncludedInKit,
			},
		},
	}
}

func mockVisualAuthority(hardwareID string) (*domain.HardwareMountFrame, string, string, string, error) {
	return &domain.HardwareMountFrame{
		OriginMm: [3]float64{0, 0, 0},
		Basis: domain.HardwareBasis{
			X: [3]float64{1, 0, 0},
			Y: [3]float64{0, 1, 0},
			Z: [3]float64{0, 0, 1},
		},
	}, "asset-" + hardwareID, "rev-1", validSha256, nil
}

// 1. Tests A, B, C, D: Sequence, Historical Retrieval, Current Pointer
func TestAgregadoRevisions_AppendOnlySequenceAndHistoricalRetrieval(t *testing.T) {
	store, pool := connectStore(t)
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)

	agregadoID := uniqueID("agr-seq")
	code := uniqueID("CODE")
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM agregados WHERE id = $1`, agregadoID)
	})

	// Create base Agregado
	err := store.CreateAgregado(ctx, &domain.Agregado{
		ID:       agregadoID,
		Code:     code,
		Name:     "Parametric Drawer Box",
		WidthMm:  600,
		HeightMm: 200,
		DepthMm:  500,
		Active:   true,
	})
	if err != nil {
		t.Fatalf("CreateAgregado failed: %v", err)
	}

	// Case A: Create revision 1
	r1, err := store.CreateAgregadoRevision(ctx, agregadoID, sampleRecipeR1(), nil)
	if err != nil {
		t.Fatalf("CreateAgregadoRevision R1 failed: %v", err)
	}
	if r1.RevisionNumber != 1 {
		t.Errorf("R1 RevisionNumber = %d, want 1", r1.RevisionNumber)
	}
	if r1.AgregadoID != agregadoID {
		t.Errorf("R1 AgregadoID = %s, want %s", r1.AgregadoID, agregadoID)
	}

	// Case B: Create revision 2 -> R1 remains intact
	r2, err := store.CreateAgregadoRevision(ctx, agregadoID, sampleRecipeR2(), nil)
	if err != nil {
		t.Fatalf("CreateAgregadoRevision R2 failed: %v", err)
	}
	if r2.RevisionNumber != 2 {
		t.Errorf("R2 RevisionNumber = %d, want 2", r2.RevisionNumber)
	}

	// Verify R1 by ID and by Number is completely intact
	fetchR1, err := store.GetAgregadoRevisionByID(ctx, r1.ID)
	if err != nil {
		t.Fatalf("GetAgregadoRevisionByID R1: %v", err)
	}
	if fetchR1.RevisionNumber != 1 || fetchR1.Recipe.Notes != "Recipe revision 1" {
		t.Errorf("fetchR1 corrupted: %+v", fetchR1)
	}

	fetchR1ByNum, err := store.GetAgregadoRevisionByNumber(ctx, agregadoID, 1)
	if err != nil {
		t.Fatalf("GetAgregadoRevisionByNumber 1: %v", err)
	}
	if fetchR1ByNum.ID != r1.ID {
		t.Errorf("fetchR1ByNum ID mismatch: %s vs %s", fetchR1ByNum.ID, r1.ID)
	}

	// Case C: Current pointer updates to R2
	if err := store.SetAgregadoCurrentRevision(ctx, agregadoID, r2.ID); err != nil {
		t.Fatalf("SetAgregadoCurrentRevision R2: %v", err)
	}

	// GetAgregadoByID reads current_revision_id
	agr, err := store.GetAgregadoByID(ctx, agregadoID)
	if err != nil {
		t.Fatalf("GetAgregadoByID: %v", err)
	}
	if agr.CurrentRevisionID == nil || *agr.CurrentRevisionID != r2.ID {
		t.Errorf("agregado CurrentRevisionID = %v, want %s", agr.CurrentRevisionID, r2.ID)
	}

	currRev, err := store.GetAgregadoCurrentRevision(ctx, agregadoID)
	if err != nil {
		t.Fatalf("GetAgregadoCurrentRevision: %v", err)
	}
	if currRev.ID != r2.ID || currRev.RevisionNumber != 2 {
		t.Errorf("GetAgregadoCurrentRevision mismatch: %+v", currRev)
	}

	// Cross-agregado current revision foreign key protection
	otherAgregadoID := uniqueID("agr-other")
	err = store.CreateAgregado(ctx, &domain.Agregado{
		ID:       otherAgregadoID,
		Code:     uniqueID("OTHER"),
		Name:     "Other Agregado",
		WidthMm:  400,
		HeightMm: 150,
		DepthMm:  400,
		Active:   true,
	})
	if err != nil {
		t.Fatalf("Create other agregado: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM agregados WHERE id = $1`, otherAgregadoID)
	})

	// Attempting to point otherAgregado to r2 (which belongs to agregadoID) must fail via fk_agregados_current_revision
	err = store.SetAgregadoCurrentRevision(ctx, otherAgregadoID, r2.ID)
	if err == nil {
		t.Fatal("SetAgregadoCurrentRevision pointing to another agregado's revision must fail, got nil")
	}

	// Case D: ListAgregadoRevisions returns revisions ordered ascending
	revs, err := store.ListAgregadoRevisions(ctx, agregadoID)
	if err != nil {
		t.Fatalf("ListAgregadoRevisions: %v", err)
	}
	if len(revs) != 2 {
		t.Fatalf("expected 2 revisions, got %d", len(revs))
	}
	if revs[0].RevisionNumber != 1 || revs[1].RevisionNumber != 2 {
		t.Errorf("revisions not ordered ascending: %+v", revs)
	}
}

// 2. Tests B, G, H (Immutability): UPDATE & DELETE direct SQL rejected by trigger
func TestAgregadoRevisions_ImmutabilityGuards(t *testing.T) {
	store, pool := connectStore(t)
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)

	agregadoID := uniqueID("agr-imm")
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM agregados WHERE id = $1`, agregadoID)
	})

	err := store.CreateAgregado(ctx, &domain.Agregado{
		ID:       agregadoID,
		Code:     uniqueID("C-IMM"),
		Name:     "Immutability Test",
		WidthMm:  600,
		HeightMm: 200,
		DepthMm:  500,
		Active:   true,
	})
	if err != nil {
		t.Fatalf("CreateAgregado: %v", err)
	}

	r1, err := store.CreateAgregadoRevision(ctx, agregadoID, sampleRecipeR1(), nil)
	if err != nil {
		t.Fatalf("CreateAgregadoRevision: %v", err)
	}

	// 1. Direct UPDATE on agregado_revisions must fail by trigger
	_, err = pool.Exec(ctx, `UPDATE agregado_revisions SET recipe = '{}' WHERE id = $1`, r1.ID)
	if err == nil || !strings.Contains(err.Error(), "is immutable once written") {
		t.Fatalf("direct UPDATE on agregado_revisions must fail with immutability error, got: %v", err)
	}

	// 2. Direct DELETE on agregado_revisions must fail by trigger
	_, err = pool.Exec(ctx, `DELETE FROM agregado_revisions WHERE id = $1`, r1.ID)
	if err == nil || !strings.Contains(err.Error(), "is immutable once written") {
		t.Fatalf("direct DELETE on agregado_revisions must fail with immutability error, got: %v", err)
	}
}

// 3. Test E: Concurrent Revision Number Allocation & Unique Constraint
func TestAgregadoRevisions_ConcurrentAllocationAndUniqueness(t *testing.T) {
	store, pool := connectStore(t)
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)

	agregadoID := uniqueID("agr-conc")
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM agregados WHERE id = $1`, agregadoID)
	})

	err := store.CreateAgregado(ctx, &domain.Agregado{
		ID:       agregadoID,
		Code:     uniqueID("C-CONC"),
		Name:     "Concurrency Agregado",
		WidthMm:  600,
		HeightMm: 200,
		DepthMm:  500,
		Active:   true,
	})
	if err != nil {
		t.Fatalf("CreateAgregado: %v", err)
	}

	const goroutines = 8
	var wg sync.WaitGroup
	errs := make(chan error, goroutines)
	revNums := make(chan int, goroutines)

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			recipe := sampleRecipeR1()
			recipe.Notes = fmt.Sprintf("Goroutine %d", idx)
			rev, err := store.CreateAgregadoRevision(ctx, agregadoID, recipe, nil)
			if err != nil {
				errs <- err
				return
			}
			revNums <- rev.RevisionNumber
		}(i)
	}

	wg.Wait()
	close(errs)
	close(revNums)

	for err := range errs {
		t.Fatalf("concurrent CreateAgregadoRevision failed: %v", err)
	}

	seen := make(map[int]bool)
	for num := range revNums {
		if seen[num] {
			t.Errorf("duplicate revision number allocated concurrently: %d", num)
		}
		seen[num] = true
	}

	if len(seen) != goroutines {
		t.Fatalf("expected %d distinct revision numbers, got %d", goroutines, len(seen))
	}
	for i := 1; i <= goroutines; i++ {
		if !seen[i] {
			t.Errorf("missing revision number in sequence: %d", i)
		}
	}
}

// 4. Test F: Tenant Isolation (RLS)
func TestAgregadoRevisions_TenantIsolationRLS(t *testing.T) {
	fx := newRLSFixture(t)
	actorA := fiActorA()
	actorB := fiActorB()

	agregadoID := uniqueID("agr-rls")

	// Org A creates an agregado and revision R1
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		err := fx.store.CreateAgregado(ctx, &domain.Agregado{
			ID:       agregadoID,
			Code:     uniqueID("C-RLS-A"),
			Name:     "Org A Agregado",
			WidthMm:  600,
			HeightMm: 200,
			DepthMm:  500,
			Active:   true,
		})
		if err != nil {
			return err
		}
		_, err = fx.store.CreateAgregadoRevision(ctx, agregadoID, sampleRecipeR1(), nil)
		return err
	})
	if err != nil {
		t.Fatalf("Org A setup failed: %v", err)
	}

	// Org B attempts to read Org A's revision: must return not found
	err = fiTx(t, fx.store, actorB, func(ctx context.Context) error {
		_, err := fx.store.GetAgregadoRevisionByNumber(ctx, agregadoID, 1)
		if err == nil {
			t.Fatal("Org B was able to read Org A's revision by number!")
		}
		revs, err := fx.store.ListAgregadoRevisions(ctx, agregadoID)
		if err != nil {
			return err
		}
		if len(revs) != 0 {
			t.Fatalf("Org B saw Org A's revisions: %+v", revs)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("Org B read check failed: %v", err)
	}
}

// 5. Test H: Legacy Agregado Compatibility
func TestAgregadoRevisions_LegacyAgregadoCompatibility(t *testing.T) {
	store, pool := connectStore(t)
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)

	agregadoID := uniqueID("agr-legacy")
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM agregados WHERE id = $1`, agregadoID)
	})

	// Legacy insert directly without current_revision_id
	_, err := pool.Exec(ctx, `
		INSERT INTO agregados (id, organization_id, code, name, width_mm, height_mm, depth_mm, active)
		VALUES ($1, $2, $3, $4, 600, 200, 500, true)
	`, agregadoID, storage.InitialOrganizationID, uniqueID("LEGACY"), "Legacy Agregado")
	if err != nil {
		t.Fatalf("direct insert legacy agregado: %v", err)
	}

	// GetAgregadoByID must succeed with CurrentRevisionID == nil
	agr, err := store.GetAgregadoByID(ctx, agregadoID)
	if err != nil {
		t.Fatalf("GetAgregadoByID legacy: %v", err)
	}
	if agr.CurrentRevisionID != nil {
		t.Errorf("legacy agregado should have nil CurrentRevisionID, got %v", agr.CurrentRevisionID)
	}

	// Soft-deleting an agregado does not delete its historical revisions
	r1, err := store.CreateAgregadoRevision(ctx, agregadoID, sampleRecipeR1(), nil)
	if err != nil {
		t.Fatalf("add revision to legacy agregado: %v", err)
	}

	// Soft-delete / deactivate agregado
	if err := store.DeactivateAgregado(ctx, agregadoID); err != nil {
		t.Fatalf("deactivate agregado: %v", err)
	}

	// Deactivated agregado: active is false
	deactivated, err := store.GetAgregadoByID(ctx, agregadoID)
	if err != nil {
		t.Fatalf("GetAgregadoByID after deactivate: %v", err)
	}
	if deactivated.Active {
		t.Errorf("expected agregado to be inactive after deactivation")
	}

	// R1 is still present in history
	fetchedR1, err := store.GetAgregadoRevisionByID(ctx, r1.ID)
	if err != nil {
		t.Fatalf("GetAgregadoRevisionByID after deactivation: %v", err)
	}
	if fetchedR1.ID != r1.ID {
		t.Errorf("fetched revision ID mismatch after deactivation")
	}

	// Physical hard delete is blocked while revisions exist
	err = store.DeleteAgregado(ctx, agregadoID)
	if err == nil {
		t.Fatal("physical DeleteAgregado must fail while historical revisions exist (ON DELETE RESTRICT)")
	}
}

// 6. Tests G, I, J, K, L, M, O: Published Assembly Snapshots, Zero-Scaling, Historical Freezing
func TestPublishedAssemblySnapshots_FreezeRoundtripAndZeroScaling(t *testing.T) {
	store, pool := connectStore(t)
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)

	agregadoID := uniqueID("agr-snap")
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM agregados WHERE id = $1`, agregadoID)
	})

	err := store.CreateAgregado(ctx, &domain.Agregado{
		ID:       agregadoID,
		Code:     uniqueID("C-SNAP"),
		Name:     "Snapshot Agregado",
		WidthMm:  600,
		HeightMm: 200,
		DepthMm:  520,
		Active:   true,
	})
	if err != nil {
		t.Fatalf("CreateAgregado: %v", err)
	}

	// Create revision 1
	r1, err := store.CreateAgregadoRevision(ctx, agregadoID, sampleRecipeWithVariants(), nil)
	if err != nil {
		t.Fatalf("CreateAgregadoRevision R1: %v", err)
	}
	_ = store.SetAgregadoCurrentRevision(ctx, agregadoID, r1.ID)

	// Resolve assembly against dimensions (W=600, H=200, D=520)
	// Depth is 520; clearance is 10 -> max allowed 510; selects 500mm variant
	resolved, err := engine.ResolveAgregadoAssembly(r1.Recipe.ToAgregado(agregadoID, "C", "N"), engine.AssemblyResolutionParams{
		WidthMm:  600,
		HeightMm: 200,
		DepthMm:  520,
	})
	if err != nil {
		t.Fatalf("ResolveAgregadoAssembly: %v", err)
	}

	// Freeze published assembly snapshot with authoritative revision number 1
	snapshot, err := engine.FreezePublishedAssemblySnapshot(resolved, r1.RevisionNumber, mockVisualAuthority)
	if err != nil {
		t.Fatalf("FreezePublishedAssemblySnapshot: %v", err)
	}

	// Validate zero-scaling: all rigid members must have basis determinant == +1.0
	for _, m := range snapshot.RigidMembers {
		det := m.LocalTransform.Basis.X[0]*(m.LocalTransform.Basis.Y[1]*m.LocalTransform.Basis.Z[2]-m.LocalTransform.Basis.Y[2]*m.LocalTransform.Basis.Z[1]) -
			m.LocalTransform.Basis.X[1]*(m.LocalTransform.Basis.Y[0]*m.LocalTransform.Basis.Z[2]-m.LocalTransform.Basis.Y[2]*m.LocalTransform.Basis.Z[0]) +
			m.LocalTransform.Basis.X[2]*(m.LocalTransform.Basis.Y[0]*m.LocalTransform.Basis.Z[1]-m.LocalTransform.Basis.Y[1]*m.LocalTransform.Basis.Z[0])
		if det < 0.999 || det > 1.001 {
			t.Fatalf("rigid member %s basis determinant is %g, want +1.0 (zero-scaling)", m.MemberID, det)
		}
		if m.AssetID == nil || m.AssetRevisionID == nil || m.SHA256 == nil {
			t.Fatalf("rigid member %s missing visual pins", m.MemberID)
		}
	}

	// Save snapshot S1 to PostgreSQL
	record := domain.PublishedAssemblySnapshotRecord{
		AgregadoID:             agregadoID,
		AgregadoRevisionID:     r1.ID,
		AgregadoRevisionNumber: r1.RevisionNumber,
		ResolvedWidthMm:        600,
		ResolvedHeightMm:       200,
		ResolvedDepthMm:        520,
		Snapshot:               snapshot,
	}
	if err := store.SavePublishedAssemblySnapshot(ctx, &record); err != nil {
		t.Fatalf("SavePublishedAssemblySnapshot: %v", err)
	}
	if record.ID == "" || record.PayloadHash == "" {
		t.Fatalf("record missing ID or PayloadHash after save: %+v", record)
	}

	// Case O: Deduplication / Idempotency
	// Saving the exact same snapshot with identical payload_hash returns the existing record
	duplicateRecord := record
	duplicateRecord.ID = ""
	if err := store.SavePublishedAssemblySnapshot(ctx, &duplicateRecord); err != nil {
		t.Fatalf("idempotent SavePublishedAssemblySnapshot failed: %v", err)
	}
	if duplicateRecord.ID != record.ID {
		t.Errorf("duplicate save returned different ID: %s vs %s", duplicateRecord.ID, record.ID)
	}

	// Case H: Snapshot immutability guard
	_, err = pool.Exec(ctx, `UPDATE published_assembly_snapshots SET resolved_width_mm = 999 WHERE id = $1`, record.ID)
	if err == nil || !strings.Contains(err.Error(), "is immutable once written") {
		t.Fatalf("direct UPDATE on published_assembly_snapshots must fail with immutability error, got: %v", err)
	}
	_, err = pool.Exec(ctx, `DELETE FROM published_assembly_snapshots WHERE id = $1`, record.ID)
	if err == nil || !strings.Contains(err.Error(), "is immutable once written") {
		t.Fatalf("direct DELETE on published_assembly_snapshots must fail with immutability error, got: %v", err)
	}

	// Case J, K, L: Mutate catalog (create R2, change current to R2, change variant sets)
	r2Recipe := sampleRecipeWithVariants()
	r2Recipe.VariantSets[0].Variants[1].NominalDimensionMm = 550
	r2, err := store.CreateAgregadoRevision(ctx, agregadoID, r2Recipe, nil)
	if err != nil {
		t.Fatalf("create R2: %v", err)
	}
	if err := store.SetAgregadoCurrentRevision(ctx, agregadoID, r2.ID); err != nil {
		t.Fatalf("set current to R2: %v", err)
	}

	// Case M: Snapshot readback does NOT re-evaluate resolver; S1 is 100% frozen
	readback, err := store.GetPublishedAssemblySnapshotByID(ctx, record.ID)
	if err != nil {
		t.Fatalf("GetPublishedAssemblySnapshotByID: %v", err)
	}

	if readback.AgregadoRevisionNumber != 1 {
		t.Errorf("readback AgregadoRevisionNumber = %d, want 1", readback.AgregadoRevisionNumber)
	}
	if len(readback.Snapshot.SelectedVariants) == 0 {
		t.Fatal("readback missing selected variants")
	}
	// Verify selected variant preserved 500mm, not 550mm
	if readback.Snapshot.SelectedVariants[0].NominalDimensionMm != 500 {
		t.Errorf("readback variant nominal dimension altered: got %g, want 500", readback.Snapshot.SelectedVariants[0].NominalDimensionMm)
	}
	// Verify visual pins preserved
	if *readback.Snapshot.RigidMembers[0].AssetRevisionID != "rev-1" {
		t.Errorf("readback visual pin altered: got %s, want rev-1", *readback.Snapshot.RigidMembers[0].AssetRevisionID)
	}
}

// 7. Test N: Fail-Closed on Corrupt Data
func TestPublishedAssemblySnapshots_FailClosedOnCorruptData(t *testing.T) {
	store, pool := connectStore(t)
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)

	agregadoID := uniqueID("agr-corrupt")
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM agregados WHERE id = $1`, agregadoID)
	})

	_ = store.CreateAgregado(ctx, &domain.Agregado{
		ID:       agregadoID,
		Code:     uniqueID("C-CORR"),
		Name:     "Corrupt Agregado",
		WidthMm:  600,
		HeightMm: 200,
		DepthMm:  500,
		Active:   true,
	})
	r1, _ := store.CreateAgregadoRevision(ctx, agregadoID, sampleRecipeR1(), nil)

	// Attempting to save invalid snapshot (e.g. basis det != 1.0 or unpinned member) fails closed before insert
	invalidSnap := domain.PublishedAssemblySnapshot{
		AgregadoID:             agregadoID,
		AgregadoRevisionNumber: 1,
		ResolvedDimensionsMm:   [3]float64{600, 200, 500},
		RigidMembers: []domain.ResolvedRigidMember{
			{
				MemberID:   "m1",
				Role:       "r",
				HardwareID: "hw",
				// Missing visual pins
			},
		},
	}
	err := store.SavePublishedAssemblySnapshot(ctx, &domain.PublishedAssemblySnapshotRecord{
		AgregadoID:             agregadoID,
		AgregadoRevisionID:     r1.ID,
		AgregadoRevisionNumber: 1,
		Snapshot:               invalidSnap,
	})
	if err == nil {
		t.Fatal("SavePublishedAssemblySnapshot must reject invalid unpinned snapshot")
	}

	// Now save a valid snapshot first
	resolved, _ := engine.ResolveAgregadoAssembly(r1.Recipe.ToAgregado(agregadoID, "C", "N"), engine.AssemblyResolutionParams{
		WidthMm:  600,
		HeightMm: 200,
		DepthMm:  500,
	})
	validSnap, err := engine.FreezePublishedAssemblySnapshot(resolved, 1, mockVisualAuthority)
	if err != nil {
		t.Fatalf("freeze: %v", err)
	}

	rec := domain.PublishedAssemblySnapshotRecord{
		AgregadoID:             agregadoID,
		AgregadoRevisionID:     r1.ID,
		AgregadoRevisionNumber: 1,
		ResolvedWidthMm:        600,
		ResolvedHeightMm:       200,
		ResolvedDepthMm:        500,
		Snapshot:               validSnap,
	}
	if err := store.SavePublishedAssemblySnapshot(ctx, &rec); err != nil {
		t.Fatalf("save valid: %v", err)
	}

	// Corrupting JSON directly in DB (simulating bit rot / DB manual tampering)
	// We disable the trigger inside an admin block or direct SQL to simulate raw corruption
	_, err = pool.Exec(ctx, `ALTER TABLE published_assembly_snapshots DISABLE TRIGGER protect_published_assembly_snapshots_immutable`)
	if err != nil {
		t.Fatalf("disable trigger: %v", err)
	}
	_, err = pool.Exec(ctx, `UPDATE published_assembly_snapshots SET snapshot = jsonb_set(snapshot, '{resolvedDimensionsMm,0}', '-999') WHERE id = $1`, rec.ID)
	if err != nil {
		t.Fatalf("corrupt snapshot: %v", err)
	}
	_, err = pool.Exec(ctx, `ALTER TABLE published_assembly_snapshots ENABLE TRIGGER protect_published_assembly_snapshots_immutable`)
	if err != nil {
		t.Fatalf("enable trigger: %v", err)
	}

	// Readback must fail closed with ErrCorruptAssemblySnapshot
	_, err = store.GetPublishedAssemblySnapshotByID(ctx, rec.ID)
	if err == nil || !strings.Contains(err.Error(), "readback validation failed") {
		t.Fatalf("readback of corrupted snapshot must fail closed, got: %v", err)
	}
}

// 8. Test J, K, O: DesignRevision Assembly Snapshot Pins & Multi-Instance
func TestDesignRevisionAssemblySnapshots_PinningAndMultiInstance(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	agregadoID := uniqueID("agr-pin")
	designID := "72000000-0000-0000-0000-000000000099"
	designRevID := "73000000-0000-0000-0000-000000000099"
	inst1ID := "74000000-0000-0000-0000-000000000091"
	inst2ID := "74000000-0000-0000-0000-000000000092"

	multiOrgExec(t, fx.admin, fmt.Sprintf(`
		INSERT INTO designs (id, organization_id, project_id, name)
		VALUES ('%s', '%s', '%s', 'Design With Assemblies');

		INSERT INTO design_revisions (id, organization_id, project_id, design_id, revision_number, source_type, status)
		VALUES ('%s', '%s', '%s', '%s', 1, 'system', 'published');

		INSERT INTO furniture_instances (id, organization_id, project_id, origin)
		VALUES
		 ('%s', '%s', '%s', 'manual'),
		 ('%s', '%s', '%s', 'manual');
	`, designID, actorA.OrganizationID, fiProjectAOnly,
		designRevID, actorA.OrganizationID, fiProjectAOnly, designID,
		inst1ID, actorA.OrganizationID, fiProjectAOnly,
		inst2ID, actorA.OrganizationID, fiProjectAOnly,
	))

	var rec1ID, rec2ID, pin1ID string

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		err := fx.store.CreateAgregado(ctx, &domain.Agregado{
			ID:       agregadoID,
			Code:     uniqueID("C-PIN"),
			Name:     "Pinned Agregado",
			WidthMm:  600,
			HeightMm: 200,
			DepthMm:  500,
			Active:   true,
		})
		if err != nil {
			return fmt.Errorf("CreateAgregado: %w", err)
		}
		r1, err := fx.store.CreateAgregadoRevision(ctx, agregadoID, sampleRecipeR1(), nil)
		if err != nil {
			return fmt.Errorf("CreateAgregadoRevision: %w", err)
		}

		// Create 2 snapshots: S1 (600mm) and S2 (800mm)
		resolved600, err := engine.ResolveAgregadoAssembly(r1.Recipe.ToAgregado(agregadoID, "C", "N"), engine.AssemblyResolutionParams{
			WidthMm:  600,
			HeightMm: 200,
			DepthMm:  500,
		})
		if err != nil {
			return fmt.Errorf("resolve 600: %w", err)
		}
		snap600, err := engine.FreezePublishedAssemblySnapshot(resolved600, 1, mockVisualAuthority)
		if err != nil {
			return fmt.Errorf("freeze 600: %w", err)
		}
		rec1 := domain.PublishedAssemblySnapshotRecord{
			AgregadoID:             agregadoID,
			AgregadoRevisionID:     r1.ID,
			AgregadoRevisionNumber: 1,
			ResolvedWidthMm:        600,
			ResolvedHeightMm:       200,
			ResolvedDepthMm:        500,
			Snapshot:               snap600,
		}
		if err := fx.store.SavePublishedAssemblySnapshot(ctx, &rec1); err != nil {
			return fmt.Errorf("save rec1: %w", err)
		}
		rec1ID = rec1.ID

		resolved800, err := engine.ResolveAgregadoAssembly(r1.Recipe.ToAgregado(agregadoID, "C", "N"), engine.AssemblyResolutionParams{
			WidthMm:  800,
			HeightMm: 200,
			DepthMm:  500,
		})
		if err != nil {
			return fmt.Errorf("resolve 800: %w", err)
		}
		snap800, err := engine.FreezePublishedAssemblySnapshot(resolved800, 1, mockVisualAuthority)
		if err != nil {
			return fmt.Errorf("freeze 800: %w", err)
		}
		rec2 := domain.PublishedAssemblySnapshotRecord{
			AgregadoID:             agregadoID,
			AgregadoRevisionID:     r1.ID,
			AgregadoRevisionNumber: 1,
			ResolvedWidthMm:        800,
			ResolvedHeightMm:       200,
			ResolvedDepthMm:        500,
			Snapshot:               snap800,
		}
		if err := fx.store.SavePublishedAssemblySnapshot(ctx, &rec2); err != nil {
			return fmt.Errorf("save rec2: %w", err)
		}
		rec2ID = rec2.ID

		// Case K: Multiple instances in the same DesignRevision point to different snapshots for the same slot_key
		pin1 := domain.DesignRevisionAssemblySnapshot{
			OrganizationID:      actorA.OrganizationID,
			ProjectID:           fiProjectAOnly,
			DesignRevisionID:    designRevID,
			FurnitureInstanceID: &inst1ID,
			AgregadoID:          agregadoID,
			SlotKey:             "cajon_1",
			SnapshotID:          rec1.ID,
		}
		if err := fx.store.PinDesignRevisionAssemblySnapshot(ctx, &pin1); err != nil {
			return fmt.Errorf("PinDesignRevisionAssemblySnapshot pin1: %w", err)
		}
		pin1ID = pin1.ID

		pin2 := domain.DesignRevisionAssemblySnapshot{
			OrganizationID:      actorA.OrganizationID,
			ProjectID:           fiProjectAOnly,
			DesignRevisionID:    designRevID,
			FurnitureInstanceID: &inst2ID,
			AgregadoID:          agregadoID,
			SlotKey:             "cajon_1",
			SnapshotID:          rec2.ID,
		}
		if err := fx.store.PinDesignRevisionAssemblySnapshot(ctx, &pin2); err != nil {
			return fmt.Errorf("PinDesignRevisionAssemblySnapshot pin2: %w", err)
		}

		// Read pins back
		p1Read, err := fx.store.GetDesignRevisionAssemblySnapshotForInstance(ctx, fiProjectAOnly, designRevID, inst1ID, "cajon_1")
		if err != nil {
			return fmt.Errorf("get pin1: %w", err)
		}
		if p1Read.SnapshotID != rec1ID {
			t.Errorf("pin1 snapshot mismatch: %s vs %s", p1Read.SnapshotID, rec1ID)
		}

		p2Read, err := fx.store.GetDesignRevisionAssemblySnapshotForInstance(ctx, fiProjectAOnly, designRevID, inst2ID, "cajon_1")
		if err != nil {
			return fmt.Errorf("get pin2: %w", err)
		}
		if p2Read.SnapshotID != rec2ID {
			t.Errorf("pin2 snapshot mismatch: %s vs %s", p2Read.SnapshotID, rec2ID)
		}

		list, err := fx.store.ListDesignRevisionAssemblySnapshots(ctx, fiProjectAOnly, designRevID)
		if err != nil {
			return fmt.Errorf("list pins: %w", err)
		}
		if len(list) != 2 {
			t.Errorf("expected 2 pinned snapshots, got %d", len(list))
		}
		return nil
	})
	if err != nil {
		t.Fatalf("fiTx failed: %v", err)
	}

	// Pin immutability
	_, err = fx.admin.Exec(context.Background(), `UPDATE design_revision_assembly_snapshots SET slot_key = 'hacked' WHERE id = $1`, pin1ID)
	if err == nil || !strings.Contains(err.Error(), "is immutable once written") {
		t.Fatalf("direct UPDATE on design_revision_assembly_snapshots must fail with immutability error, got: %v", err)
	}
	_, err = fx.admin.Exec(context.Background(), `DELETE FROM design_revision_assembly_snapshots WHERE id = $1`, pin1ID)
	if err == nil || !strings.Contains(err.Error(), "is immutable once written") {
		t.Fatalf("direct DELETE on design_revision_assembly_snapshots must fail with immutability error, got: %v", err)
	}
}
