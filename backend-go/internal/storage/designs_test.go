package storage_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #387 / DT-3: Design aggregate and immutable DesignRevision snapshots
// (ADR-0003, digital-thread §§7-10).

func designMigrationSQL(t *testing.T) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000113_design_and_design_revisions.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func TestDesigns_MigrationFreshAndUpgrade(t *testing.T) {
	ctx := context.Background()

	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 113)
	assertDesignSchema(t, fresh)

	upgrade := multiOrgFreshDB(t)
	identityApplyThrough(t, upgrade, 112)
	if _, err := upgrade.Exec(ctx, designMigrationSQL(t)); err != nil {
		t.Fatalf("upgrade apply 00113: %v", err)
	}
	assertDesignSchema(t, upgrade)
}

func assertDesignSchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	for _, table := range []string{"designs", "design_revisions", "design_revision_items"} {
		var classification, readScope, writeScope string
		if err := pool.QueryRow(ctx,
			`SELECT classification, read_scope, write_scope FROM rls_policy_inventory WHERE table_name=$1`,
			table,
		).Scan(&classification, &readScope, &writeScope); err != nil {
			t.Fatalf("inventory row for %s: %v", table, err)
		}
		if classification != "explicitly-shared" || readScope != "project-organizations" {
			t.Fatalf("inventory for %s = (%q,%q,%q), want explicitly-shared project-organizations",
				table, classification, readScope, writeScope)
		}

		var rls, forced bool
		if err := pool.QueryRow(ctx,
			`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname=$1`,
			table,
		).Scan(&rls, &forced); err != nil {
			t.Fatalf("pg_class lookup for %s: %v", table, err)
		}
		if !rls || !forced {
			t.Fatalf("RLS for %s enabled=%v forced=%v, want both true", table, rls, forced)
		}
	}

	// Structural composite anchors.
	for _, index := range []string{
		"uq_designs_id_project",
		"uq_design_revisions_design_number",
		"uq_design_revisions_id_design",
		"uq_design_revisions_id_project",
		"uq_design_revision_items_revision_instance",
	} {
		var exists bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname=$1)`, index).Scan(&exists); err != nil || !exists {
			t.Fatalf("index %s exists=%v err=%v", index, exists, err)
		}
	}

	// Grants & immutability: design_revisions and design_revision_items have NO UPDATE or DELETE grant for granete_app.
	for _, table := range []string{"design_revisions", "design_revision_items"} {
		privileges := map[string]bool{}
		rows, err := pool.Query(ctx, `
			SELECT privilege_type FROM information_schema.table_privileges
			WHERE table_name=$1 AND grantee='granete_app'`, table)
		if err != nil {
			t.Fatalf("query privileges for %s: %v", table, err)
		}
		for rows.Next() {
			var privilege string
			if err := rows.Scan(&privilege); err != nil {
				t.Fatal(err)
			}
			privileges[privilege] = true
		}
		rows.Close()

		if !privileges["SELECT"] || !privileges["INSERT"] {
			t.Fatalf("granete_app missing SELECT or INSERT on %s: %v", table, privileges)
		}
		if privileges["UPDATE"] || privileges["DELETE"] {
			t.Fatalf("granete_app must NOT have UPDATE or DELETE on %s: %v", table, privileges)
		}
	}
}

func setupDesignsTestFixture(t *testing.T) *rlsFixture {
	t.Helper()
	fx := newRLSFixture(t)
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO projects (id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id)
		VALUES
		 ('`+fiProjectB+`', 'Org B own project', '30000000-0000-0000-0000-00000000000b', 'draft',
			'`+rlsOrgB+`', '`+rlsOrgB+`', '`+rlsOrgB+`'),
		 ('`+fiProjectAOnly+`', 'Org A private project', '30000000-0000-0000-0000-00000000000a', 'draft',
			'`+rlsOrgA+`', '`+rlsOrgA+`', '`+rlsOrgA+`')
		ON CONFLICT (id) DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	return fx
}

func TestDesigns_ProjectAggregateAndRevisions(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	actorB := fiActorB()

	// 1. Create multiple designs on the same project (0..N designs per project).
	var design1, design2 *domain.Design
	quoteRevID := "70000000-0000-0000-0000-000000000001"

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		design1, err = fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Cocina Principal",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		design2, err = fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:             fiSharedProject,
			Name:                  "Cocina Alternativa Isla",
			SourceQuoteRevisionID: quoteRevID,
			ActorUserID:           rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("create designs: %v", err)
	}

	if design1.ProjectID != fiSharedProject || design1.Name != "Cocina Principal" || design1.Status != domain.DesignStatusActive {
		t.Fatalf("design1 properties mismatch: %+v", design1)
	}
	if design2.SourceQuoteRevisionID != quoteRevID {
		t.Fatalf("design2 sourceQuoteRevisionId = %q, want %q", design2.SourceQuoteRevisionID, quoteRevID)
	}

	// List designs by project.
	var designs []domain.Design
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		designs, err = fx.store.ListDesignsByProject(ctx, fiSharedProject)
		return err
	})
	if err != nil {
		t.Fatalf("list designs: %v", err)
	}
	if len(designs) != 2 {
		t.Fatalf("designs count = %d, want 2", len(designs))
	}

	// Get design by ID.
	var fetched *domain.Design
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		fetched, err = fx.store.GetDesignByID(ctx, design1.ID)
		return err
	})
	if err != nil {
		t.Fatalf("get design by ID: %v", err)
	}
	if fetched.ID != design1.ID {
		t.Fatalf("fetched ID = %s, want %s", fetched.ID, design1.ID)
	}

	// Create 2 FurnitureInstances in Project A.
	var fi1, fi2 *domain.FurnitureInstance
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		fi1, err = fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:   fiSharedProject,
			Origin:      domain.FurnitureInstanceOriginQuote,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		fi2, err = fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:   fiSharedProject,
			Origin:      domain.FurnitureInstanceOriginQuote,
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("create furniture instances: %v", err)
	}

	// 2. Publish R1.
	var rev1 *domain.DesignRevision
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		rev1, err = fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:   design1.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.PublishDesignRevisionItemCommand{
				{
					FurnitureInstanceID: fi1.ID,
					Parameters:          map[string]any{"widthMm": 600.0, "heightMm": 720.0},
					MaterialChoices:     map[string]string{"CARCASS": "WHITE-18"},
					Transform: domain.Transform3D{
						TranslationMm: [3]float64{100, 200, 0},
						RotationDeg:   [3]float64{0, 0, 90},
					},
					RoomID: "kitchen",
					TechnicalClientLocator: &domain.TechnicalClientLocator{
						Kind:  "sketchup_persistent_id",
						Value: "12345",
					},
				},
				{
					FurnitureInstanceID: fi2.ID,
					Parameters:          map[string]any{"widthMm": 800.0, "heightMm": 720.0},
					MaterialChoices:     map[string]string{"CARCASS": "WHITE-18"},
					Transform: domain.Transform3D{
						TranslationMm: [3]float64{700, 200, 0},
						RotationDeg:   [3]float64{0, 0, 0},
					},
				},
			},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish rev1: %v", err)
	}
	if rev1.RevisionNumber != 1 {
		t.Fatalf("rev1 revisionNumber = %d, want 1", rev1.RevisionNumber)
	}
	if rev1.ParentRevisionID != "" {
		t.Fatalf("rev1 parentRevisionId = %q, want empty", rev1.ParentRevisionID)
	}
	if len(rev1.Items) != 2 {
		t.Fatalf("rev1 items count = %d, want 2", len(rev1.Items))
	}
	if rev1.Items[0].TechnicalClientLocator == nil || rev1.Items[0].TechnicalClientLocator.Value != "12345" {
		t.Fatalf("rev1 item locator mismatch: %+v", rev1.Items[0].TechnicalClientLocator)
	}

	// 3. Subsequent publish R2 based on R1.
	// Invariant I9: configuration changes preserve physical identity by default.
	var rev2 *domain.DesignRevision
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		rev2, err = fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       design1.ID,
			BaseRevisionID: rev1.ID,
			SourceType:     domain.DesignRevisionSourceSketchup,
			Items: []storage.PublishDesignRevisionItemCommand{
				{
					FurnitureInstanceID: fi1.ID, // Same physical identity!
					Parameters:          map[string]any{"widthMm": 650.0, "heightMm": 720.0}, // modified width
					MaterialChoices:     map[string]string{"CARCASS": "WHITE-18"},
					Transform: domain.Transform3D{
						TranslationMm: [3]float64{150, 200, 0},
						RotationDeg:   [3]float64{0, 0, 90},
					},
				},
			},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish rev2: %v", err)
	}
	if rev2.RevisionNumber != 2 {
		t.Fatalf("rev2 revisionNumber = %d, want 2", rev2.RevisionNumber)
	}
	if rev2.ParentRevisionID != rev1.ID {
		t.Fatalf("rev2 parentRevisionId = %s, want %s", rev2.ParentRevisionID, rev1.ID)
	}
	if rev2.Items[0].FurnitureInstanceID != fi1.ID {
		t.Fatalf("rev2 item FI ID = %s, want preserved %s (I9)", rev2.Items[0].FurnitureInstanceID, fi1.ID)
	}

	// 4. Stale base revision conflict (Optimistic Concurrency / §18).
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       design1.ID,
			BaseRevisionID: rev1.ID, // STALE! Latest is rev2.
			SourceType:     domain.DesignRevisionSourceSketchup,
			Items: []storage.PublishDesignRevisionItemCommand{
				{FurnitureInstanceID: fi1.ID, Parameters: map[string]any{"widthMm": 600.0}},
			},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrDesignRevisionConflict) {
		t.Fatalf("publish with stale base error = %v, want %v", err, domain.ErrDesignRevisionConflict)
	}

	// 5. Cross-design parent rejection.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:         design2.ID,
			ParentRevisionID: rev1.ID, // Belongs to design1, not design2!
			SourceType:       domain.DesignRevisionSourceSketchup,
			Items:            []storage.PublishDesignRevisionItemCommand{},
			ActorUserID:      rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrInvalidParentRevision) {
		t.Fatalf("publish cross-design parent error = %v, want %v", err, domain.ErrInvalidParentRevision)
	}

	// 6. Duplicate FurnitureInstance within one revision (Invariant §11).
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       design1.ID,
			BaseRevisionID: rev2.ID,
			SourceType:     domain.DesignRevisionSourceSketchup,
			Items: []storage.PublishDesignRevisionItemCommand{
				{FurnitureInstanceID: fi1.ID, Parameters: map[string]any{"widthMm": 600.0}},
				{FurnitureInstanceID: fi1.ID, Parameters: map[string]any{"widthMm": 700.0}}, // DUPLICATE!
			},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrDuplicateFurnitureInstanceInRevision) {
		t.Fatalf("publish duplicate FI error = %v, want %v", err, domain.ErrDuplicateFurnitureInstanceInRevision)
	}

	// 7. Cross-project FurnitureInstance rejection (Invariant §10).
	var fiInProjectB *domain.FurnitureInstance
	err = fiTx(t, fx.store, actorB, func(ctx context.Context) error {
		var err error
		fiInProjectB, err = fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:   fiProjectB,
			Origin:      domain.FurnitureInstanceOriginManual,
			ActorUserID: rlsUserB,
		})
		return err
	})
	if err != nil {
		t.Fatalf("create fi in project B: %v", err)
	}

	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       design1.ID,
			BaseRevisionID: rev2.ID,
			SourceType:     domain.DesignRevisionSourceSketchup,
			Items: []storage.PublishDesignRevisionItemCommand{
				{FurnitureInstanceID: fiInProjectB.ID}, // FI belongs to project B!
			},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrCrossProjectFurnitureInstance) && !errors.Is(err, storage.ErrFurnitureInstanceNotFound) {
		t.Fatalf("publish cross-project FI error = %v, want ErrCrossProjectFurnitureInstance or NotFound", err)
	}

	// 8. List revisions & Get revision with items.
	var revs []domain.DesignRevision
	var gotRev1 *domain.DesignRevision
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		revs, err = fx.store.ListDesignRevisions(ctx, design1.ID)
		if err != nil {
			return err
		}
		gotRev1, err = fx.store.GetDesignRevision(ctx, design1.ID, rev1.ID)
		return err
	})
	if err != nil {
		t.Fatalf("query revisions: %v", err)
	}
	if len(revs) != 2 {
		t.Fatalf("revs count = %d, want 2", len(revs))
	}
	if len(gotRev1.Items) != 2 {
		t.Fatalf("gotRev1 items count = %d, want 2", len(gotRev1.Items))
	}
}

// Published revisions and items are immutable: direct UPDATE or DELETE must fail.
func TestDesigns_Immutability(t *testing.T) {
	ctx := context.Background()
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	var design *domain.Design
	var fi *domain.FurnitureInstance
	var rev *domain.DesignRevision

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		design, err = fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Immutable Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		fi, err = fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:   fiSharedProject,
			Origin:      domain.FurnitureInstanceOriginQuote,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		rev, err = fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:   design.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.PublishDesignRevisionItemCommand{
				{
					FurnitureInstanceID: fi.ID,
					Parameters:          map[string]any{"widthMm": 600.0},
				},
			},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("setup design and revision: %v", err)
	}

	// Attempt direct SQL UPDATE on design_revisions via superuser/pool: trigger must reject!
	_, err = fx.admin.Exec(ctx, `
		UPDATE design_revisions
		SET status = 'superseded'
		WHERE id = $1
	`, rev.ID)
	if err == nil {
		t.Fatal("direct UPDATE on design_revisions succeeded, want error from trigger")
	}

	// Attempt direct SQL DELETE on design_revisions.
	_, err = fx.admin.Exec(ctx, `
		DELETE FROM design_revisions
		WHERE id = $1
	`, rev.ID)
	if err == nil {
		t.Fatal("direct DELETE on design_revisions succeeded, want error from trigger")
	}

	// Attempt direct SQL UPDATE on design_revision_items.
	_, err = fx.admin.Exec(ctx, `
		UPDATE design_revision_items
		SET parameters = '{"widthMm": 999}'::jsonb
		WHERE id = $1
	`, rev.Items[0].ID)
	if err == nil {
		t.Fatal("direct UPDATE on design_revision_items succeeded, want error from trigger")
	}

	// Attempt direct SQL DELETE on design_revision_items.
	_, err = fx.admin.Exec(ctx, `
		DELETE FROM design_revision_items
		WHERE id = $1
	`, rev.Items[0].ID)
	if err == nil {
		t.Fatal("direct DELETE on design_revision_items succeeded, want error from trigger")
	}
}

// Concurrent publish attempts on the same design serialize via row lock and allocate
// sequential revision numbers, never duplicate numbers.
func TestDesigns_ConcurrentPublishNumbering(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	var design *domain.Design
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		design, err = fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Concurrent Design",
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("create design: %v", err)
	}

	const concurrency = 5
	var wg sync.WaitGroup
	errs := make([]error, concurrency)
	revs := make([]*domain.DesignRevision, concurrency)

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
				var pErr error
				revs[idx], pErr = fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
					DesignID:   design.ID,
					SourceType: domain.DesignRevisionSourceSystem,
					Items:      []storage.PublishDesignRevisionItemCommand{},
				})
				return pErr
			})
			errs[idx] = err
		}(i)
	}
	wg.Wait()

	seenNumbers := make(map[int]bool)
	for i := 0; i < concurrency; i++ {
		if errs[i] != nil {
			t.Fatalf("publish goroutine %d failed: %v", i, errs[i])
		}
		num := revs[i].RevisionNumber
		if seenNumbers[num] {
			t.Fatalf("duplicate revision number %d detected across concurrent publishes!", num)
		}
		seenNumbers[num] = true
	}

	if len(seenNumbers) != concurrency {
		t.Fatalf("allocated revision numbers count = %d, want %d", len(seenNumbers), concurrency)
	}
	for i := 1; i <= concurrency; i++ {
		if !seenNumbers[i] {
			t.Fatalf("missing expected sequential revision number R%d", i)
		}
	}
}

// Cross-org RLS: Org B cannot see Org A's private designs or revisions even without tenant filter.
func TestDesigns_CrossOrgRLS(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	actorB := fiActorB()

	var designA *domain.Design
	var revA *domain.DesignRevision

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		designA, err = fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiProjectAOnly,
			Name:        "Org A Private Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		revA, err = fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:   designA.ID,
			SourceType: domain.DesignRevisionSourceSystem,
			Items:      []storage.PublishDesignRevisionItemCommand{},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("create design and revision under Org A: %v", err)
	}

	// Try reading designA and revA under Org B's context.
	err = fiTx(t, fx.store, actorB, func(ctx context.Context) error {
		_, err := fx.store.GetDesignByID(ctx, designA.ID)
		if !errors.Is(err, domain.ErrDesignNotFound) {
			return fmt.Errorf("Org B reading Org A design: error = %v, want ErrDesignNotFound", err)
		}

		_, err = fx.store.GetDesignRevision(ctx, designA.ID, revA.ID)
		if !errors.Is(err, domain.ErrDesignRevisionNotFound) && !errors.Is(err, domain.ErrDesignNotFound) {
			return fmt.Errorf("Org B reading Org A revision: error = %v, want ErrDesignRevisionNotFound", err)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	// Query under app role directly in a transaction with Org B tenant context:
	ctx := context.Background()
	tx, err := fx.app.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	setRLSActor(t, tx, rlsOrgB, rlsUserB, "")

	var count int
	// Deliberately omit organization filter to test RLS!
	if err := tx.QueryRow(ctx, `
		SELECT count(*) FROM designs WHERE id = $1
	`, designA.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("RLS leak: Org B saw %d rows of Org A's design", count)
	}

	if err := tx.QueryRow(ctx, `
		SELECT count(*) FROM design_revisions WHERE id = $1
	`, revA.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("RLS leak: Org B saw %d rows of Org A's revision", count)
	}
}

// Draft quote decrease is blocked when an instance is referenced in a DesignRevision (durable history).
func TestDesigns_DurableHistoryBlocksQuoteDecrease(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	// Seed quote line with qty 3 on shared project.
	seedQuoteLines(t, fx, fiSharedProject, map[string]int{qlfiLineQty3: 3})

	// Materialize 3 units on QuoteLineQty3.
	mat, err := materialize(t, fx, actorA, fiSharedProject, qlfiLineQty3)
	if err != nil {
		t.Fatalf("initial materialize: %v", err)
	}
	if len(mat.Instances) != 3 {
		t.Fatalf("initial instances count = %d, want 3", len(mat.Instances))
	}

	// Create design and publish revision containing the newest instance (instance[2]).
	targetInstance := mat.Instances[2].FurnitureInstance
	var design *domain.Design
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		design, err = fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Design with Quoted Furniture",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		_, err = fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:   design.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.PublishDesignRevisionItemCommand{
				{FurnitureInstanceID: targetInstance.ID},
			},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish revision with instance: %v", err)
	}

	// Now lower quantity in project_items from 3 to 2, and try to materialize.
	setLineQuantity(t, fx, qlfiLineQty3, 2)

	_, err = materialize(t, fx, actorA, fiSharedProject, qlfiLineQty3)
	if !errors.Is(err, domain.ErrFurnitureInstanceDurableHistory) {
		t.Fatalf("materialize quote decrease error = %v, want ErrFurnitureInstanceDurableHistory", err)
	}
}

// Durable security audit events are recorded for design_created and design_revision_published.
func TestDesigns_DurableAuditRecorded(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	var design *domain.Design
	var rev *domain.DesignRevision

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		design, err = fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Audited Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}

		rev, err = fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:    design.ID,
			SourceType:  domain.DesignRevisionSourceSystem,
			Items:       []storage.PublishDesignRevisionItemCommand{},
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}

	// Verify events in security_audit_events.
	ctx := context.Background()
	var countDesignCreated int
	if err := fx.admin.QueryRow(ctx, `
		SELECT count(*) FROM security_audit_events
		WHERE event_type = 'design_created' AND details->>'design_id' = $1
	`, design.ID).Scan(&countDesignCreated); err != nil || countDesignCreated != 1 {
		t.Fatalf("design_created audit event count = %d, want 1 (err=%v)", countDesignCreated, err)
	}

	var countRevisionPublished int
	if err := fx.admin.QueryRow(ctx, `
		SELECT count(*) FROM security_audit_events
		WHERE event_type = 'design_revision_published' AND details->>'design_revision_id' = $1
	`, rev.ID).Scan(&countRevisionPublished); err != nil || countRevisionPublished != 1 {
		t.Fatalf("design_revision_published audit event count = %d, want 1 (err=%v)", countRevisionPublished, err)
	}
}
