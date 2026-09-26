package storage_test

// F1 hardening (#668/#670 audit): the agregado_revisions /
// published_assembly_snapshots / design_revision_assembly_snapshots family is
// FORCE RLS for granete_app. These tests run everything through the real
// granete_app role (NOBYPASSRLS) so RLS is actually enforced, and prove
// the tenant read boundary contract:
//
//   F1-A org + tenant transaction          -> exact read works
//   F1-B org present, no tenant tx         -> repository enters its own
//                                             pool-safe tenant transaction
//                                             (canonical WithinTenantTx
//                                             self-wrap, design_publish.go
//                                             idiom). The data that exists
//                                             is FOUND — never a silent
//                                             RLS 0-rows "not found".
//   F1-C cross tenant                      -> fail-closed not-found kept
//   F1-D historical path R1->S1->pin       -> readable inside the boundary
//   F1-E pooled connection reuse           -> tenant never leaks across
//                                             transactions on one connection
//   F1-F empty org scope                   -> ErrNoOrgScope (context error),
//                                             never a business not-found

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

type agregadoBoundarySeed struct {
	agregadoID  string
	revisionID  string
	snapshotID  string
	pinID       string
	designID    string
	designRevID string
	instanceID  string
}

// seedAgregadoFamilyBoundary creates, inside one org A tenant transaction
// (the production request shape): agregado + revision R1 + frozen snapshot S1
// + a DesignRevision pin for one furniture instance, with current = R1.
func seedAgregadoFamilyBoundary(t *testing.T, fx *rlsFixture) *agregadoBoundarySeed {
	t.Helper()
	actorA := fiActorA()
	seed := &agregadoBoundarySeed{
		agregadoID:  uniqueID("agr-boundary"),
		designID:    "72000000-0000-0000-0000-0000000000b1",
		designRevID: "73000000-0000-0000-0000-0000000000b1",
		instanceID:  "74000000-0000-0000-0000-0000000000b1",
	}

	multiOrgExec(t, fx.admin, fmt.Sprintf(`
		INSERT INTO designs (id, organization_id, project_id, name)
		VALUES ('%s', '%s', '%s', 'Design Boundary');

		INSERT INTO design_revisions (id, organization_id, project_id, design_id, revision_number, source_type, status)
		VALUES ('%s', '%s', '%s', '%s', 1, 'system', 'published');

		INSERT INTO furniture_instances (id, organization_id, project_id, origin)
		VALUES ('%s', '%s', '%s', 'manual');
	`, seed.designID, actorA.OrganizationID, fiProjectAOnly,
		seed.designRevID, actorA.OrganizationID, fiProjectAOnly, seed.designID,
		seed.instanceID, actorA.OrganizationID, fiProjectAOnly,
	))

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		if err := fx.store.CreateAgregado(ctx, &domain.Agregado{
			ID:       seed.agregadoID,
			Code:     uniqueID("C-BOUND"),
			Name:     "Boundary Agregado",
			WidthMm:  600,
			HeightMm: 200,
			DepthMm:  500,
			Active:   true,
		}); err != nil {
			return fmt.Errorf("CreateAgregado: %w", err)
		}
		r1, err := fx.store.CreateAgregadoRevision(ctx, seed.agregadoID, sampleRecipeR1(), nil)
		if err != nil {
			return fmt.Errorf("CreateAgregadoRevision: %w", err)
		}
		seed.revisionID = r1.ID

		resolved, err := engine.ResolveAgregadoAssembly(r1.Recipe.ToAgregado(seed.agregadoID, "C", "N"), engine.AssemblyResolutionParams{
			WidthMm:  600,
			HeightMm: 200,
			DepthMm:  500,
		})
		if err != nil {
			return fmt.Errorf("resolve: %w", err)
		}
		snap, err := engine.FreezePublishedAssemblySnapshot(resolved, r1.RevisionNumber, mockVisualAuthority)
		if err != nil {
			return fmt.Errorf("freeze: %w", err)
		}
		record := &domain.PublishedAssemblySnapshotRecord{
			AgregadoID:             seed.agregadoID,
			AgregadoRevisionID:     r1.ID,
			AgregadoRevisionNumber: r1.RevisionNumber,
			ResolvedWidthMm:        600,
			ResolvedHeightMm:       200,
			ResolvedDepthMm:        500,
			Snapshot:               snap,
		}
		if err := fx.store.SavePublishedAssemblySnapshot(ctx, record); err != nil {
			return fmt.Errorf("SavePublishedAssemblySnapshot: %w", err)
		}
		seed.snapshotID = record.ID

		pin := &domain.DesignRevisionAssemblySnapshot{
			OrganizationID:      actorA.OrganizationID,
			ProjectID:           fiProjectAOnly,
			DesignRevisionID:    seed.designRevID,
			FurnitureInstanceID: &seed.instanceID,
			AgregadoID:          seed.agregadoID,
			SlotKey:             "cajon_1",
			SnapshotID:          record.ID,
		}
		if err := fx.store.PinDesignRevisionAssemblySnapshot(ctx, pin); err != nil {
			return fmt.Errorf("PinDesignRevisionAssemblySnapshot: %w", err)
		}
		seed.pinID = pin.ID

		return fx.store.SetAgregadoCurrentRevision(ctx, seed.agregadoID, r1.ID)
	})
	if err != nil {
		t.Fatalf("seed org A family: %v", err)
	}
	return seed
}

// F1-A: the exact-transaction read path keeps working through the app role.
func TestAgregadoFamily_TenantBoundary_F1A_ReadInsideTenantTx(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	seed := seedAgregadoFamilyBoundary(t, fx)
	actorA := fiActorA()

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		rev, err := fx.store.GetAgregadoRevisionByID(ctx, seed.revisionID)
		if err != nil {
			return fmt.Errorf("GetAgregadoRevisionByID: %w", err)
		}
		if rev.ID != seed.revisionID || rev.RevisionNumber != 1 {
			return fmt.Errorf("revision mismatch: %+v", rev)
		}
		byNumber, err := fx.store.GetAgregadoRevisionByNumber(ctx, seed.agregadoID, 1)
		if err != nil {
			return fmt.Errorf("GetAgregadoRevisionByNumber: %w", err)
		}
		if byNumber.ID != seed.revisionID {
			return fmt.Errorf("by-number mismatch: %s", byNumber.ID)
		}
		revs, err := fx.store.ListAgregadoRevisions(ctx, seed.agregadoID)
		if err != nil {
			return fmt.Errorf("ListAgregadoRevisions: %w", err)
		}
		if len(revs) != 1 {
			return fmt.Errorf("ListAgregadoRevisions len = %d, want 1", len(revs))
		}
		current, err := fx.store.GetAgregadoCurrentRevision(ctx, seed.agregadoID)
		if err != nil {
			return fmt.Errorf("GetAgregadoCurrentRevision: %w", err)
		}
		if current.ID != seed.revisionID {
			return fmt.Errorf("current mismatch: %s", current.ID)
		}
		snap, err := fx.store.GetPublishedAssemblySnapshotByID(ctx, seed.snapshotID)
		if err != nil {
			return fmt.Errorf("GetPublishedAssemblySnapshotByID: %w", err)
		}
		if snap.AgregadoRevisionID != seed.revisionID {
			return fmt.Errorf("snapshot revision mismatch: %+v", snap)
		}
		pin, err := fx.store.GetDesignRevisionAssemblySnapshotForInstance(ctx, fiProjectAOnly, seed.designRevID, seed.instanceID, "cajon_1")
		if err != nil {
			return fmt.Errorf("GetDesignRevisionAssemblySnapshotForInstance: %w", err)
		}
		if pin.SnapshotID != seed.snapshotID {
			return fmt.Errorf("pin snapshot mismatch: %s", pin.SnapshotID)
		}
		pins, err := fx.store.ListDesignRevisionAssemblySnapshots(ctx, fiProjectAOnly, seed.designRevID)
		if err != nil {
			return fmt.Errorf("ListDesignRevisionAssemblySnapshots: %w", err)
		}
		if len(pins) != 1 || pins[0].ID != seed.pinID {
			return fmt.Errorf("pins mismatch: %+v", pins)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("F1-A: %v", err)
	}
}

// F1-B: org scope present but NO tenant transaction in context. The
// repository must enter the canonical tenant boundary itself (WithinTenantTx
// self-wrap) and FIND the data. Under the unfixed code the same call runs on
// the pool with no app.organization_id, FORCE RLS filters every row and the
// application gets a false business not-found — exactly the audited defect.
func TestAgregadoFamily_TenantBoundary_F1B_OrgPresentWithoutTenantTx(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	seed := seedAgregadoFamilyBoundary(t, fx)

	// No fiTx here on purpose: org scope only, like a future background job
	// or CLI caller that forgot the boundary.
	ctx := storage.WithOrgCtx(context.Background(), rlsOrgA)

	rev, err := fx.store.GetAgregadoRevisionByID(ctx, seed.revisionID)
	if err != nil {
		t.Fatalf("F1-B GetAgregadoRevisionByID must find existing data, got %v (not-found would be the audited false negative)", err)
	}
	if rev.ID != seed.revisionID {
		t.Fatalf("F1-B revision mismatch: %+v", rev)
	}
	if errors.Is(err, domain.ErrAgregadoRevisionNotFound) {
		t.Fatal("F1-B must never report business not-found for existing data")
	}

	byNumber, err := fx.store.GetAgregadoRevisionByNumber(ctx, seed.agregadoID, 1)
	if err != nil || byNumber.ID != seed.revisionID {
		t.Fatalf("F1-B GetAgregadoRevisionByNumber: %v", err)
	}
	revs, err := fx.store.ListAgregadoRevisions(ctx, seed.agregadoID)
	if err != nil || len(revs) != 1 {
		t.Fatalf("F1-B ListAgregadoRevisions: %v (len %d)", err, len(revs))
	}
	current, err := fx.store.GetAgregadoCurrentRevision(ctx, seed.agregadoID)
	if err != nil || current.ID != seed.revisionID {
		t.Fatalf("F1-B GetAgregadoCurrentRevision: %v", err)
	}
	snap, err := fx.store.GetPublishedAssemblySnapshotByID(ctx, seed.snapshotID)
	if err != nil || snap.ID != seed.snapshotID {
		t.Fatalf("F1-B GetPublishedAssemblySnapshotByID: %v", err)
	}
	pins, err := fx.store.ListDesignRevisionAssemblySnapshots(ctx, fiProjectAOnly, seed.designRevID)
	if err != nil || len(pins) != 1 {
		t.Fatalf("F1-B ListDesignRevisionAssemblySnapshots: %v (len %d) — RLS-only table must not silently hide existing pins", err, len(pins))
	}
	pin, err := fx.store.GetDesignRevisionAssemblySnapshotForInstance(ctx, fiProjectAOnly, seed.designRevID, seed.instanceID, "cajon_1")
	if err != nil || pin.SnapshotID != seed.snapshotID {
		t.Fatalf("F1-B GetDesignRevisionAssemblySnapshotForInstance: %v", err)
	}
}

// F1-C: cross-tenant reads stay fail-closed (true business not-found) both
// inside a tenant transaction and through the self-wrap boundary.
func TestAgregadoFamily_TenantBoundary_F1C_CrossTenantFailClosed(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	seed := seedAgregadoFamilyBoundary(t, fx)

	err := fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		if _, err := fx.store.GetAgregadoRevisionByID(ctx, seed.revisionID); !errors.Is(err, domain.ErrAgregadoRevisionNotFound) {
			return fmt.Errorf("org B reading org A revision by exact ID: err=%v, want ErrAgregadoRevisionNotFound", err)
		}
		if _, err := fx.store.GetPublishedAssemblySnapshotByID(ctx, seed.snapshotID); !errors.Is(err, domain.ErrAssemblySnapshotNotFound) {
			return fmt.Errorf("org B reading org A snapshot: err=%v, want ErrAssemblySnapshotNotFound", err)
		}
		pins, err := fx.store.ListDesignRevisionAssemblySnapshots(ctx, fiProjectAOnly, seed.designRevID)
		if err != nil {
			return err
		}
		if len(pins) != 0 {
			return fmt.Errorf("org B saw org A project pins: %+v", pins)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("F1-C in-tx: %v", err)
	}

	// Same probes without a tenant transaction (org B scope only).
	ctxB := storage.WithOrgCtx(context.Background(), rlsOrgB)
	if _, err := fx.store.GetAgregadoRevisionByID(ctxB, seed.revisionID); !errors.Is(err, domain.ErrAgregadoRevisionNotFound) {
		t.Fatalf("F1-C self-wrap cross-tenant: err=%v, want ErrAgregadoRevisionNotFound", err)
	}
	pins, err := fx.store.ListDesignRevisionAssemblySnapshots(ctxB, fiProjectAOnly, seed.designRevID)
	if err != nil || len(pins) != 0 {
		t.Fatalf("F1-C self-wrap pins: %v (len %d)", err, len(pins))
	}
}

// F1-D: the productive historical path — revision R1 -> published snapshot S1
// -> DesignRevision pin -> current pointer moves to R2 — remains exactly
// readable inside the tenant boundary.
func TestAgregadoFamily_TenantBoundary_F1D_HistoricalPath(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	agregadoID := uniqueID("agr-hist")
	designRevID := "73000000-0000-0000-0000-0000000000b2"
	instanceID := "74000000-0000-0000-0000-0000000000b2"

	multiOrgExec(t, fx.admin, fmt.Sprintf(`
		INSERT INTO designs (id, organization_id, project_id, name)
		VALUES ('72000000-0000-0000-0000-0000000000b2', '%s', '%s', 'Design Historical');
		INSERT INTO design_revisions (id, organization_id, project_id, design_id, revision_number, source_type, status)
		VALUES ('%s', '%s', '%s', '72000000-0000-0000-0000-0000000000b2', 1, 'system', 'published');
		INSERT INTO furniture_instances (id, organization_id, project_id, origin)
		VALUES ('%s', '%s', '%s', 'manual');
	`, actorA.OrganizationID, fiProjectAOnly,
		designRevID, actorA.OrganizationID, fiProjectAOnly,
		instanceID, actorA.OrganizationID, fiProjectAOnly,
	))

	var r1ID, s1ID string
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		if err := fx.store.CreateAgregado(ctx, &domain.Agregado{
			ID: agregadoID, Code: uniqueID("C-HIST"), Name: "Historical Agregado",
			WidthMm: 600, HeightMm: 200, DepthMm: 500, Active: true,
		}); err != nil {
			return err
		}
		r1, err := fx.store.CreateAgregadoRevision(ctx, agregadoID, sampleRecipeR1(), nil)
		if err != nil {
			return err
		}
		r1ID = r1.ID
		r2, err := fx.store.CreateAgregadoRevision(ctx, agregadoID, sampleRecipeR1(), nil)
		if err != nil {
			return err
		}

		resolved, err := engine.ResolveAgregadoAssembly(r1.Recipe.ToAgregado(agregadoID, "C", "N"), engine.AssemblyResolutionParams{
			WidthMm: 600, HeightMm: 200, DepthMm: 500,
		})
		if err != nil {
			return err
		}
		snap, err := engine.FreezePublishedAssemblySnapshot(resolved, r1.RevisionNumber, mockVisualAuthority)
		if err != nil {
			return err
		}
		record := &domain.PublishedAssemblySnapshotRecord{
			AgregadoID: agregadoID, AgregadoRevisionID: r1.ID, AgregadoRevisionNumber: r1.RevisionNumber,
			ResolvedWidthMm: 600, ResolvedHeightMm: 200, ResolvedDepthMm: 500, Snapshot: snap,
		}
		if err := fx.store.SavePublishedAssemblySnapshot(ctx, record); err != nil {
			return err
		}
		s1ID = record.ID
		pin := &domain.DesignRevisionAssemblySnapshot{
			OrganizationID: actorA.OrganizationID, ProjectID: fiProjectAOnly, DesignRevisionID: designRevID,
			FurnitureInstanceID: &instanceID, AgregadoID: agregadoID, SlotKey: "cajon_1", SnapshotID: record.ID,
		}
		if err := fx.store.PinDesignRevisionAssemblySnapshot(ctx, pin); err != nil {
			return err
		}
		return fx.store.SetAgregadoCurrentRevision(ctx, agregadoID, r2.ID)
	})
	if err != nil {
		t.Fatalf("F1-D seed: %v", err)
	}

	// Historical readback in a fresh tenant transaction.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		r1, err := fx.store.GetAgregadoRevisionByID(ctx, r1ID)
		if err != nil || r1.RevisionNumber != 1 {
			return fmt.Errorf("historical R1: %v", err)
		}
		s1, err := fx.store.GetPublishedAssemblySnapshotByID(ctx, s1ID)
		if err != nil || s1.AgregadoRevisionID != r1ID || s1.AgregadoRevisionNumber != 1 {
			return fmt.Errorf("historical S1: %v %+v", err, s1)
		}
		pin, err := fx.store.GetDesignRevisionAssemblySnapshotForInstance(ctx, fiProjectAOnly, designRevID, instanceID, "cajon_1")
		if err != nil || pin.SnapshotID != s1ID {
			return fmt.Errorf("historical pin: %v", err)
		}
		current, err := fx.store.GetAgregadoCurrentRevision(ctx, agregadoID)
		if err != nil || current.RevisionNumber != 2 {
			return fmt.Errorf("current must be R2: %v", err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("F1-D: %v", err)
	}
}

// F1-E: one pooled connection, two tenants, sequential requests. After org
// A's transaction commits, the very same connection must serve org B with no
// residual tenant context, and org B can never observe org A's rows.
func TestAgregadoFamily_TenantBoundary_F1E_PooledConnectionReuse(t *testing.T) {
	// The fixture only prepares the migrated database; this test drives its own
	// single-connection canonical runtime pool.
	fx := setupDesignsTestFixture(t)

	appURL := fx.DatabaseURL(t)
	cfg, err := pgxpool.ParseConfig(appURL.String())
	if err != nil {
		t.Fatalf("parse app url: %v", err)
	}
	cfg.MaxConns = 1
	cfg.MinConns = 1
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("single-conn pool: %v", err)
	}
	defer pool.Close()
	single := &storage.PostgresStore{Pool: pool}

	actorA, actorB := fiActorA(), fiActorB()
	agregadoID := uniqueID("agr-reuse")
	var revisionID string

	// Request A: org A creates the revision and commits.
	err = fiTx(t, single, actorA, func(ctx context.Context) error {
		if err := single.CreateAgregado(ctx, &domain.Agregado{
			ID: agregadoID, Code: uniqueID("C-REUSE"), Name: "Reuse Agregado",
			WidthMm: 600, HeightMm: 200, DepthMm: 500, Active: true,
		}); err != nil {
			return err
		}
		r1, err := single.CreateAgregadoRevision(ctx, agregadoID, sampleRecipeR1(), nil)
		if err != nil {
			return err
		}
		revisionID = r1.ID
		return nil
	})
	if err != nil {
		t.Fatalf("F1-E org A tx: %v", err)
	}

	// The tenant GUC must have died with the transaction: the shared
	// connection carries no organization afterwards.
	var residual *string
	if err := pool.QueryRow(context.Background(), `SELECT NULLIF(current_setting('app.organization_id', TRUE), '')`).Scan(&residual); err != nil {
		t.Fatalf("F1-E read residual GUC: %v", err)
	}
	if residual != nil && *residual != "" {
		t.Fatalf("F1-E tenant GUC leaked past transaction end: %q", *residual)
	}

	// Request B on the SAME connection: org B cannot see org A's revision.
	err = fiTx(t, single, actorB, func(ctx context.Context) error {
		if _, err := single.GetAgregadoRevisionByID(ctx, revisionID); !errors.Is(err, domain.ErrAgregadoRevisionNotFound) {
			return fmt.Errorf("org B observed org A revision on reused connection: err=%v", err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("F1-E org B tx: %v", err)
	}

	// Request A again on the same connection still finds its own data.
	err = fiTx(t, single, actorA, func(ctx context.Context) error {
		rev, err := single.GetAgregadoRevisionByID(ctx, revisionID)
		if err != nil || rev.ID != revisionID {
			return fmt.Errorf("org A lost its own revision after reuse: %v", err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("F1-E org A re-read: %v", err)
	}
}

// F1-F: no organization scope at all is a caller programming error and must
// surface as the typed context error ErrNoOrgScope — never as a business
// not-found that would masquerade as missing data.
func TestAgregadoFamily_TenantBoundary_F1F_EmptyOrgExplicitError(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	ctx := context.Background() // no org scope anywhere

	dummyUUID := "00000000-0000-0000-0000-000000000000"
	calls := map[string]func() error{
		"CreateAgregadoRevision": func() error {
			_, err := fx.store.CreateAgregadoRevision(ctx, "agr", sampleRecipeR1(), nil)
			return err
		},
		"GetAgregadoRevisionByID": func() error {
			_, err := fx.store.GetAgregadoRevisionByID(ctx, dummyUUID)
			return err
		},
		"GetAgregadoRevisionByNumber": func() error {
			_, err := fx.store.GetAgregadoRevisionByNumber(ctx, "agr", 1)
			return err
		},
		"ListAgregadoRevisions": func() error {
			_, err := fx.store.ListAgregadoRevisions(ctx, "agr")
			return err
		},
		"GetAgregadoCurrentRevision": func() error {
			_, err := fx.store.GetAgregadoCurrentRevision(ctx, "agr")
			return err
		},
		"SetAgregadoCurrentRevision": func() error {
			return fx.store.SetAgregadoCurrentRevision(ctx, "agr", dummyUUID)
		},
		"SavePublishedAssemblySnapshot": func() error {
			return fx.store.SavePublishedAssemblySnapshot(ctx, &domain.PublishedAssemblySnapshotRecord{})
		},
		"GetPublishedAssemblySnapshotByID": func() error {
			_, err := fx.store.GetPublishedAssemblySnapshotByID(ctx, dummyUUID)
			return err
		},
		"PinDesignRevisionAssemblySnapshot": func() error {
			return fx.store.PinDesignRevisionAssemblySnapshot(ctx, &domain.DesignRevisionAssemblySnapshot{})
		},
		"ListDesignRevisionAssemblySnapshots": func() error {
			_, err := fx.store.ListDesignRevisionAssemblySnapshots(ctx, dummyUUID, dummyUUID)
			return err
		},
		"GetDesignRevisionAssemblySnapshot": func() error {
			_, err := fx.store.GetDesignRevisionAssemblySnapshot(ctx, dummyUUID, dummyUUID, "agr", "slot")
			return err
		},
		"GetDesignRevisionAssemblySnapshotForInstance": func() error {
			_, err := fx.store.GetDesignRevisionAssemblySnapshotForInstance(ctx, dummyUUID, dummyUUID, dummyUUID, "slot")
			return err
		},
	}
	for name, call := range calls {
		err := call()
		if err == nil {
			t.Errorf("F1-F %s: expected ErrNoOrgScope, got nil", name)
			continue
		}
		if !errors.Is(err, storage.ErrNoOrgScope) {
			t.Errorf("F1-F %s: err=%v, want errors.Is(storage.ErrNoOrgScope)", name, err)
		}
		if errors.Is(err, domain.ErrAgregadoRevisionNotFound) || errors.Is(err, domain.ErrAssemblySnapshotNotFound) {
			t.Errorf("F1-F %s: business not-found must never mask a missing org scope (err=%v)", name, err)
		}
	}
}
