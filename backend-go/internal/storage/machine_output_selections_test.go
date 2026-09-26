package storage_test

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const (
	machineOutputTestOrgA = "00000000-0000-0000-0000-0000000009e0"
	machineOutputTestOrgB = "00000000-0000-0000-0000-0000000009e1"
)

func machineOutputValidSelection() domain.MachineOutputSelection {
	return domain.MachineOutputSelection{
		Operation:                domain.OperationCutting,
		MachineProfileID:         "client-a-machine-b-hpp250",
		MachineProfileRevisionID: "r1",
		OutputProfileID:          "ptx-generic",
		OutputProfileRevisionID:  "r1",
		OutputProfileDigest: func() *string {
			value := "d05d279e6c1e40ccb1fc9995d5e5d6c1b54112af5b62e91ba2275912872d4595"
			return &value
		}(),
		AdapterID:                   "granete-ptx",
		AdapterVersion:              "1.0.0",
		AdapterImplementationDigest: "39df10ba24528b5d402a940ac2e6f9fc20b735011468013090cfc78f88511a28",
	}
}

func TestMachineOutputProfileDigestMigrationFreshAndUpgrade(t *testing.T) {
	const orgID = "00000000-0000-0000-0000-000000000692"
	ctx := context.Background()

	fresh := multiOrgFreshMigrationDB(t)
	identityApplyThrough(t, fresh, 132)
	var nullable string
	if err := fresh.QueryRow(ctx, `
		SELECT is_nullable FROM information_schema.columns
		WHERE table_name='machine_output_selections' AND column_name='output_profile_digest'
	`).Scan(&nullable); err != nil || nullable != "YES" {
		t.Fatalf("fresh digest column nullable=%q err=%v", nullable, err)
	}

	upgrade := multiOrgFreshMigrationDB(t)
	identityApplyThrough(t, upgrade, 131)
	if _, err := upgrade.Exec(ctx, `
		INSERT INTO organizations (id, name, slug, type)
		VALUES ($1, 'Issue 692 migration', 'issue-692-migration', 'factory')
	`, orgID); err != nil {
		t.Fatalf("seed pre-132 organization: %v", err)
	}
	if _, err := upgrade.Exec(ctx, `
		INSERT INTO machine_output_selections (
			organization_id, operation, machine_profile_id, machine_profile_revision_id,
			output_profile_id, output_profile_revision_id,
			adapter_id, adapter_version, adapter_implementation_digest
		) VALUES ($1, 'cutting', 'machine', 'r1', 'ptx-cadmatic-4', 'r2', 'adapter', '1.1.0', 'historical')
	`, orgID); err != nil {
		t.Fatalf("seed pre-132 historical selection: %v", err)
	}
	contents, err := os.ReadFile("../../db/migration/000132_machine_output_profile_digest.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := upgrade.Exec(ctx, string(contents)); err != nil {
		t.Fatalf("upgrade apply 000132: %v", err)
	}
	var digest *string
	if err := upgrade.QueryRow(ctx, `
		SELECT output_profile_digest FROM machine_output_selections
		WHERE organization_id=$1 AND operation='cutting'
	`, orgID).Scan(&digest); err != nil || digest != nil {
		t.Fatalf("historical digest=%v err=%v, want NULL", digest, err)
	}
	if _, err := upgrade.Exec(ctx, `
		UPDATE machine_output_selections SET output_profile_digest='not-a-digest'
		WHERE organization_id=$1 AND operation='cutting'
	`, orgID); err == nil {
		t.Fatal("malformed profile digest must fail the migration constraint")
	}
}

// migratedMachineOutputStoreWithTenantFixtures creates only isolated tenant
// fixtures with migration authority. All product behavior below uses the runtime pool.
func migratedMachineOutputStoreWithTenantFixtures(t *testing.T) (*storage.PostgresStore, *pgxpool.Pool, storage.TenantActor, storage.TenantActor) {
	t.Helper()
	store, pool := migratedConnectStore(t)
	migrationStore, _ := migrationConnectStore(t)
	ctx := context.Background()
	tx, err := migrationStore.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	orgAActor := storage.TenantActor{OrganizationID: machineOutputTestOrgA, UserID: "93000000-0000-0000-0000-0000000009e0", MembershipID: "94000000-0000-0000-0000-0000000009e0"}
	orgBActor := storage.TenantActor{OrganizationID: machineOutputTestOrgB, UserID: "93000000-0000-0000-0000-0000000009e1", MembershipID: "94000000-0000-0000-0000-0000000009e1"}
	seedMachineOutputActor(t, tx, orgAActor, "machine-output-test-org-a", "machine-output-org-a@example.test")
	seedMachineOutputActor(t, tx, orgBActor, "machine-output-test-org-b", "machine-output-org-b@example.test")
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit tenant fixtures: %v", err)
	}
	return store, pool, orgAActor, orgBActor
}

func seedMachineOutputActor(t *testing.T, tx pgx.Tx, actor storage.TenantActor, slug, email string) {
	t.Helper()
	ctx := context.Background()
	if _, err := tx.Exec(ctx, `
		INSERT INTO organizations (id, name, slug, type)
		VALUES ($1, $2, $2, 'factory')
		ON CONFLICT (id) DO NOTHING`, actor.OrganizationID, slug); err != nil {
		t.Fatalf("seed organization %s: %v", actor.OrganizationID, err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, name, account_status, normalized_email)
		VALUES ($1, $2, 'x', $3, 'active', $2)
		ON CONFLICT (id) DO NOTHING`, actor.UserID, email, slug); err != nil {
		t.Fatalf("seed user %s: %v", actor.UserID, err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO memberships (id, organization_id, user_id, roles)
		VALUES ($1, $2, $3, ARRAY['admin']::text[])
		ON CONFLICT (user_id, organization_id) DO NOTHING`, actor.MembershipID, actor.OrganizationID, actor.UserID); err != nil {
		t.Fatalf("seed membership %s: %v", actor.MembershipID, err)
	}
	if _, err := tx.Exec(ctx, `UPDATE organizations SET status='active', status_reason=NULL WHERE id=$1`, actor.OrganizationID); err != nil {
		t.Fatalf("activate organization %s: %v", actor.OrganizationID, err)
	}
}

func TestMachineOutputSelections_VersionConflictAndList(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	sel := machineOutputValidSelection()
	saved := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (domain.MachineOutputSelectionRecord, error) {
		return store.UpsertMachineOutputSelection(txCtx, sel, 0, "a@test")
	})
	if saved.Version != 1 || saved.UpdatedBy != "a@test" {
		t.Fatalf("saved record = %+v", saved)
	}

	// Editor A moves v1 -> v2 in a separate request transaction.
	saved2 := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (domain.MachineOutputSelectionRecord, error) {
		return store.UpsertMachineOutputSelection(txCtx, sel, 1, "a@test")
	})
	if saved2.Version != 2 {
		t.Fatalf("version = %d, want 2", saved2.Version)
	}

	// Editor B still on v1: the error rolls back its own transaction.
	ctx := storage.WithOrgCtx(context.Background(), actor.OrganizationID)
	err := store.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
		_, err := store.UpsertMachineOutputSelection(txCtx, sel, 1, "b@test")
		return err
	})
	if !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("stale upsert err = %v, want ErrVersionConflict", err)
	}

	records := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) ([]domain.MachineOutputSelectionRecord, error) {
		return store.ListMachineOutputSelections(txCtx)
	})
	if len(records) != 1 || records[0].Version != 2 || records[0].OutputProfileID != "ptx-generic" {
		t.Fatalf("records = %+v", records)
	}
	if records[0].OutputProfileDigest == nil || *records[0].OutputProfileDigest != *sel.OutputProfileDigest {
		t.Fatalf("profile digest was not preserved: %+v", records[0].OutputProfileDigest)
	}
}

func TestMachineOutputSelections_RLSTenantIsolation(t *testing.T) {
	store, pool, orgAActor, orgBActor := migratedMachineOutputStoreWithTenantFixtures(t)
	orgASelection := machineOutputValidSelection()
	withinConnectStoreTenant(t, store, orgAActor, func(txCtx context.Context) error {
		_, err := store.UpsertMachineOutputSelection(txCtx, orgASelection, 0, "a@test")
		return err
	})

	// The real runtime role under org B cannot observe org A's selection.
	orgBRecords := withinConnectStoreTenantValue(t, store, orgBActor, func(txCtx context.Context) ([]domain.MachineOutputSelectionRecord, error) {
		return store.ListMachineOutputSelections(txCtx)
	})
	if len(orgBRecords) != 0 {
		t.Fatalf("org B saw %d org-A selections: RLS isolation broken", len(orgBRecords))
	}

	// A direct cross-org INSERT reaches PostgreSQL under org B's legitimate
	// runtime scope and is rejected by the policy WITH CHECK. It rolls back
	// before the next independently scoped read.
	err := runConnectStoreSQL(t, pool, orgBActor, func(tx pgx.Tx) error {
		_, err := tx.Exec(context.Background(), `
			INSERT INTO machine_output_selections (
				organization_id, operation, machine_profile_id, machine_profile_revision_id,
				output_profile_id, output_profile_revision_id, adapter_id, adapter_version,
				adapter_implementation_digest, version, updated_by
			) VALUES ($1, 'cutting', 'client-a-machine-b-hpp250', 'r1', 'ptx-generic', 'r1',
				'granete-ptx', '1.0.0', '39df10ba24528b5d402a940ac2e6f9fc20b735011468013090cfc78f88511a28', 1, 'intruder@test')
		`, orgAActor.OrganizationID)
		return err
	})
	if err == nil {
		t.Fatal("cross-org insert was accepted: RLS WITH CHECK broken")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
		t.Fatalf("cross-org insert error = %v, want RLS SQLSTATE 42501", err)
	}

	orgBRecords = withinConnectStoreTenantValue(t, store, orgBActor, func(txCtx context.Context) ([]domain.MachineOutputSelectionRecord, error) {
		return store.ListMachineOutputSelections(txCtx)
	})
	if len(orgBRecords) != 0 {
		t.Fatalf("org B saw %d selections after rejected insert", len(orgBRecords))
	}
}
