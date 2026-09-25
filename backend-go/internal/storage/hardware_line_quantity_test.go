package storage_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const (
	hardwareLineQuantityUser       = "44200000-0000-0000-0000-000000000001"
	hardwareLineQuantityMembership = "44200000-0000-0000-0000-000000000002"
)

func hardwareLineQuantityRuntimeStore(t *testing.T, migrationPool *pgxpool.Pool) (*storage.PostgresStore, storage.TenantActor) {
	t.Helper()
	ctx := context.Background()
	actor := storage.TenantActor{
		OrganizationID: multiOrgInitialOrgID,
		UserID:         hardwareLineQuantityUser,
		MembershipID:   hardwareLineQuantityMembership,
	}
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id, email, normalized_email, password_hash, name, account_status)
			VALUES ($1, 'hardware-line-quantity@example.test', 'hardware-line-quantity@example.test', 'x', 'Hardware line quantity', 'active')`, []any{actor.UserID}},
		{`INSERT INTO memberships (id, organization_id, user_id, roles, status, joined_at)
			VALUES ($1, $2, $3, '{admin}', 'active', NOW())`, []any{actor.MembershipID, actor.OrganizationID, actor.UserID}},
		{`UPDATE organizations SET status='active', status_reason=NULL WHERE id=$1`, []any{actor.OrganizationID}},
	} {
		if _, err := migrationPool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed hardware line quantity runtime actor: %v", err)
		}
	}

	runtimePool, err := pgxpool.New(ctx, storage.TestDatabaseURLForDB(t, migrationPool.Config().ConnConfig.Database))
	if err != nil {
		t.Fatalf("open runtime pool: %v", err)
	}
	t.Cleanup(runtimePool.Close)
	return &storage.PostgresStore{Pool: runtimePool}, actor
}

// #442: hardware_lines.quantity widened INT → DOUBLE PRECISION so the zoclo
// strip profile's fractional meter consumption (TS HardwareLine.quantity is a
// number) survives the round-trip. Pins the column type AND the store
// write/read path for a fractional line.
func TestHardwareLineQuantityDoublePrecision(t *testing.T) {
	migrationPool := multiOrgFreshMigrationDB(t)
	migrationStore := &storage.PostgresStore{Pool: migrationPool}
	if err := migrationStore.RunMigrations(context.Background()); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	var dataType string
	if err := migrationPool.QueryRow(context.Background(), `
		SELECT data_type FROM information_schema.columns
		WHERE table_name = 'hardware_lines' AND column_name = 'quantity'`,
	).Scan(&dataType); err != nil {
		t.Fatalf("read column type: %v", err)
	}
	if dataType != "double precision" {
		t.Fatalf("hardware_lines.quantity debe ser double precision tras 000104 (got %q)", dataType)
	}

	// Write + read a module carrying a fractional strip line (0.6 ml).
	// Foreign keys need a real hardware + org-scoped module row.
	if err := migrationStore.SeedCatalog(storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)); err != nil {
		t.Fatalf("seed: %v", err)
	}
	store, actor := hardwareLineQuantityRuntimeStore(t, migrationPool)

	var hardwareID, structureID string
	var seededCatalog domain.Catalog
	if err := store.WithinTenantTx(storage.WithOrgCtx(context.Background(), actor.OrganizationID), actor, func(txCtx context.Context) error {
		var err error
		seededCatalog, err = store.GetFullCatalog(txCtx)
		if err != nil {
			return err
		}
		return nil
	}); err != nil {
		t.Fatalf("read seeded catalog: %v", err)
	}
	if len(seededCatalog.Hardware) == 0 || len(seededCatalog.Structures) == 0 {
		t.Fatal("seed catalog must provide hardware and structures")
	}
	hardwareID = seededCatalog.Hardware[0].ID
	structureID = seededCatalog.Structures[0].ID

	module := &domain.Module{
		ID:          "11111111-4442-0000-0000-000000000001",
		Code:        "MOD-442-FRAC",
		Name:        "Bajo perfil fraccional 442",
		StructureID: structureID,
		BaseMode:    "plinth_strip",
		HardwareLines: []domain.HardwareLine{{
			ID:         "hl-442-perfil",
			Quantity:   0.6,
			OptionRole: "ZOCLO_PERFIL",
			HardwareID: hardwareID,
		}},
	}
	if err := store.WithinTenantTx(storage.WithOrgCtx(context.Background(), actor.OrganizationID), actor, func(txCtx context.Context) error {
		return store.CreateModule(txCtx, module)
	}); err != nil {
		t.Fatalf("create module: %v", err)
	}

	var catalog domain.Catalog
	if err := store.WithinTenantTx(storage.WithOrgCtx(context.Background(), actor.OrganizationID), actor, func(txCtx context.Context) error {
		var err error
		catalog, err = store.GetFullCatalog(txCtx)
		return err
	}); err != nil {
		t.Fatalf("get full catalog: %v", err)
	}
	// El store genera UUIDs para ids no-UUID: matchear por rol.
	var found *domain.HardwareLine
	for i := range catalog.Modules {
		if catalog.Modules[i].Code != "MOD-442-FRAC" {
			continue
		}
		for j := range catalog.Modules[i].HardwareLines {
			if catalog.Modules[i].HardwareLines[j].OptionRole == "ZOCLO_PERFIL" {
				found = &catalog.Modules[i].HardwareLines[j]
			}
		}
	}
	if found == nil {
		t.Fatal("el módulo MOD-442-FRAC no volvió del catálogo con su línea ZOCLO_PERFIL")
	}
	if found.Quantity != 0.6 {
		t.Fatalf("cantidad fraccional no preservada: got %v, want 0.6", found.Quantity)
	}
	if found.HardwareID != hardwareID {
		t.Fatalf("hardware id no preservado: got %v, want %v", found.HardwareID, hardwareID)
	}
}
