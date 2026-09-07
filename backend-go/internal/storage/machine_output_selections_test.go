package storage_test

import (
	"context"
	"errors"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const machineOutputTestOrgB = "00000000-0000-0000-0000-0000000009e1"
const machineOutputRLSRole = "machine_output_rls_test"

func machineOutputValidSelection() domain.MachineOutputSelection {
	return domain.MachineOutputSelection{
		Operation:                   domain.OperationCutting,
		MachineProfileID:            "client-a-machine-b-hpp250",
		MachineProfileRevisionID:    "r1",
		OutputProfileID:             "ptx-generic",
		OutputProfileRevisionID:     "r1",
		AdapterID:                   "granete-ptx",
		AdapterVersion:              "1.0.0",
		AdapterImplementationDigest: "39df10ba24528b5d402a940ac2e6f9fc20b735011468013090cfc78f88511a28",
	}
}

// ensureOrgB creates a second organization for cross-org assertions.
func ensureOrgB(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO organizations (id, name, slug, type) VALUES ($1, 'machine-output-test-org-b', 'machine-output-test-org-b', 'factory')
		ON CONFLICT (id) DO NOTHING
	`, machineOutputTestOrgB); err != nil {
		t.Skipf("seed org B: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM machine_output_selections WHERE organization_id = $1`, machineOutputTestOrgB)
		_, _ = pool.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, machineOutputTestOrgB)
	})
}

func TestMachineOutputSelections_VersionConflictAndList(t *testing.T) {
	store, pool := connectStore(t)
	orgA := storage.InitialOrganizationID
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM machine_output_selections WHERE organization_id = $1`, orgA)
	})
	ctxA := storage.WithOrgCtx(context.Background(), orgA)

	sel := machineOutputValidSelection()
	saved, err := store.UpsertMachineOutputSelection(ctxA, sel, 0, "a@test")
	if err != nil {
		t.Fatalf("initial upsert: %v", err)
	}
	if saved.Version != 1 || saved.UpdatedBy != "a@test" {
		t.Fatalf("saved record = %+v", saved)
	}

	// Editor A moves v1 -> v2.
	saved2, err := store.UpsertMachineOutputSelection(ctxA, sel, 1, "a@test")
	if err != nil {
		t.Fatalf("update to v2: %v", err)
	}
	if saved2.Version != 2 {
		t.Fatalf("version = %d, want 2", saved2.Version)
	}

	// Editor B still on v1: typed conflict, never a silent overwrite.
	if _, err := store.UpsertMachineOutputSelection(ctxA, sel, 1, "b@test"); !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("stale upsert err = %v, want ErrVersionConflict", err)
	}

	records, err := store.ListMachineOutputSelections(ctxA)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(records) != 1 || records[0].Version != 2 || records[0].OutputProfileID != "ptx-generic" {
		t.Fatalf("records = %+v", records)
	}

	// Absence of configuration for a different operation is NO_OUTPUT_CONFIGURED.
	if len(records) != 1 {
		t.Fatalf("expected exactly one selection for the cutting operation")
	}
}

func TestMachineOutputSelections_RLSTenantIsolation(t *testing.T) {
	store, pool := connectStore(t)
	orgA := storage.InitialOrganizationID
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM machine_output_selections WHERE organization_id = $1`, orgA)
	})
	ctxA := storage.WithOrgCtx(context.Background(), orgA)
	if _, err := store.UpsertMachineOutputSelection(ctxA, machineOutputValidSelection(), 0, "a@test"); err != nil {
		t.Fatalf("seed org A selection: %v", err)
	}
	ensureOrgB(t, pool)

	// App role (no BYPASSRLS) scoped to org B: org A's selection is invisible.
	admin, err := pgxpool.New(context.Background(), machineOutputAdminURL(t).String())
	if err != nil {
		t.Skipf("no db: %v", err)
	}
	t.Cleanup(admin.Close)
	if _, err := admin.Exec(context.Background(), `DROP ROLE IF EXISTS `+machineOutputRLSRole); err != nil {
		t.Skipf("drop role: %v", err)
	}
	if _, err := admin.Exec(context.Background(), `CREATE ROLE `+machineOutputRLSRole+` LOGIN PASSWORD 'machine-output-rls'
		NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS IN ROLE granete_app`); err != nil {
		t.Skipf("create app role (granete_app must exist): %v", err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), `DROP ROLE IF EXISTS `+machineOutputRLSRole)
	})

	appURL := machineOutputAdminURL(t)
	appURL.User = url.UserPassword(machineOutputRLSRole, "machine-output-rls")
	app, err := pgxpool.New(context.Background(), appURL.String())
	if err != nil {
		t.Fatalf("connect app role: %v", err)
	}
	t.Cleanup(app.Close)

	ctx := context.Background()
	tx, err := app.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT set_config('app.organization_id', $1, true)`, machineOutputTestOrgB); err != nil {
		t.Fatalf("set org B scope: %v", err)
	}

	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM machine_output_selections`).Scan(&count); err != nil {
		t.Fatalf("rls select: %v", err)
	}
	if count != 0 {
		t.Fatalf("org B saw %d org-A selections: RLS isolation broken", count)
	}

	// Cross-org INSERT for org A under org B scope must be rejected by the
	// policy WITH CHECK.
	if _, err := tx.Exec(ctx, `
		INSERT INTO machine_output_selections (
			organization_id, operation, machine_profile_id, machine_profile_revision_id,
			output_profile_id, output_profile_revision_id, adapter_id, adapter_version,
			adapter_implementation_digest, version, updated_by
		) VALUES ($1, 'cutting', 'client-a-machine-b-hpp250', 'r1', 'ptx-generic', 'r1',
			'granete-ptx', '1.0.0', '39df10ba24528b5d402a940ac2e6f9fc20b735011468013090cfc78f88511a28', 1, 'intruder@test')
	`, orgA); err == nil {
		t.Fatalf("cross-org insert was accepted: RLS WITH CHECK broken")
	}
}

func machineOutputAdminURL(t *testing.T) *url.URL {
	t.Helper()
	dsn := "postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable"
	if env := os.Getenv("DATABASE_URL"); env != "" {
		dsn = env
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse dsn: %v", err)
	}
	return u
}
