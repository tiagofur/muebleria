package storage_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// F171 / #325: cross-organization isolation. Two organizations live in the
// same database; storage calls scoped to one organization must never read or
// write the other's rows. Cross-org access surfaces as the same not-found
// error used for missing rows — never a distinct code that would confirm
// existence (ADR-0004 "tenant_id is not authorization").

func isolationSetup(t *testing.T) (*storage.PostgresStore, string, string) {
	t.Helper()
	pool := multiOrgFreshDB(t)
	store := &storage.PostgresStore{Pool: pool}
	ctx := context.Background()
	if err := store.RunMigrations(ctx); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	// Organization B alongside the backfilled initial organization.
	const orgB = "aaaaaaaa-0000-0000-0000-00000000000b"
	if _, err := pool.Exec(ctx,
		`INSERT INTO organizations (id, name, slug, status) VALUES ($1, 'Taller Beta', 'taller-beta', 'provisioning')`, orgB); err != nil {
		t.Fatalf("create org B: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO workshop_settings (organization_id, default_currency) VALUES ($1, 'BRL')`, orgB); err != nil {
		t.Fatalf("workshop settings org B: %v", err)
	}

	seed := []string{
		// Org A (initial): one customer, one project, one board. The org is
		// explicit — 000088 dropped the transitional DEFAULT so unscoped
		// writes fail loudly.
		`INSERT INTO customers (id, name, organization_id) VALUES ('c1000000-0000-0000-0000-00000000000a', 'Cliente Alfa', '` + multiOrgInitialOrgID + `')`,
		`INSERT INTO projects (id, name, customer_id, status, organization_id) VALUES ('c2000000-0000-0000-0000-00000000000a', 'Obra Alfa', 'c1000000-0000-0000-0000-00000000000a', 'draft', '` + multiOrgInitialOrgID + `')`,
		`INSERT INTO material_boards (id, code, name, width_mm, length_mm, thickness_mm, board_price, organization_id) VALUES ('c3000000-0000-0000-0000-00000000000a', 'TAB-ALFA', 'Tablero Alfa', 1830, 2440, 18, 1000, '` + multiOrgInitialOrgID + `')`,
		// Org B: its own rows (same shape, different world).
		`INSERT INTO customers (id, name, organization_id) VALUES ('c1000000-0000-0000-0000-00000000000b', 'Cliente Beta', '` + orgB + `')`,
		`INSERT INTO projects (id, name, customer_id, status, organization_id) VALUES ('c2000000-0000-0000-0000-00000000000b', 'Obra Beta', 'c1000000-0000-0000-0000-00000000000b', 'draft', '` + orgB + `')`,
		`INSERT INTO material_boards (id, code, name, width_mm, length_mm, thickness_mm, board_price, organization_id) VALUES ('c3000000-0000-0000-0000-00000000000b', 'TAB-BETA', 'Tablero Beta', 1830, 2440, 18, 1000, '` + orgB + `')`,
	}
	for _, s := range seed {
		if _, err := pool.Exec(ctx, s); err != nil {
			t.Fatalf("seed: %v (sql=%s)", err, s[:60])
		}
	}
	return store, multiOrgInitialOrgID, orgB
}

func scoped(ctx context.Context, org string) context.Context {
	return storage.WithOrgCtx(ctx, org)
}

const (
	isolationRuntimeUserA       = "a1000000-0000-0000-0000-0000000000aa"
	isolationRuntimeMembershipA = "a2000000-0000-0000-0000-0000000000aa"
	isolationRuntimeUserB       = "a1000000-0000-0000-0000-0000000000bb"
	isolationRuntimeMembershipB = "a2000000-0000-0000-0000-0000000000bb"
	isolationPlatformUser       = "a3000000-0000-0000-0000-0000000000aa"
)

type isolationRuntimeFixture struct {
	store         *storage.PostgresStore
	orgA          string
	orgB          string
	actorA        storage.TenantActor
	actorB        storage.TenantActor
	platformActor storage.TenantActor
}

// runtimeIsolationSetup deliberately keeps this seven-test runtime slice
// separate from isolationSetup's remaining legacy callers. Migrations and
// fixture-only rows are installed with migration authority; every product
// command below opens a real granete_app tenant transaction.
func runtimeIsolationSetup(t *testing.T) isolationRuntimeFixture {
	t.Helper()
	migrationPool := multiOrgFreshMigrationDB(t)
	migrationStore := &storage.PostgresStore{Pool: migrationPool}
	ctx := context.Background()
	if err := migrationStore.RunMigrations(ctx); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	const orgB = "aaaaaaaa-0000-0000-0000-00000000000b"
	seed := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations (id, name, slug, status) VALUES ($1, 'Taller Beta', 'taller-beta', 'provisioning')`, []any{orgB}},
		{`INSERT INTO workshop_settings (organization_id, default_currency) VALUES ($1, 'BRL')`, []any{orgB}},
		{`INSERT INTO users (id, email, normalized_email, password_hash, name, account_status, platform_admin) VALUES
			($1, 'a@test.com', 'a@test.com', 'x', 'Usuario A', 'active', FALSE),
			($2, 'both@test.com', 'both@test.com', 'x', 'Usuario AB', 'active', FALSE),
			($3, 'isolation-platform@example.test', 'isolation-platform@example.test', 'x', 'Isolation Platform', 'active', TRUE)`, []any{isolationRuntimeUserA, isolationRuntimeUserB, isolationPlatformUser}},
		{`INSERT INTO memberships (id, organization_id, user_id, roles, status, joined_at) VALUES
			($1, $2, $3, '{admin}', 'active', NOW()),
			($4, $2, $5, '{vendedor}', 'active', NOW()),
			($6, $7, $5, '{admin}', 'active', NOW())`, []any{isolationRuntimeMembershipA, multiOrgInitialOrgID, isolationRuntimeUserA, "a2000000-0000-0000-0000-0000000000ab", isolationRuntimeUserB, isolationRuntimeMembershipB, orgB}},
		{`UPDATE organizations SET status='active', status_reason=NULL WHERE id IN ($1, $2)`, []any{multiOrgInitialOrgID, orgB}},
		{`INSERT INTO customers (id, name, organization_id) VALUES
			('c1000000-0000-0000-0000-00000000000a', 'Cliente Alfa', $1),
			('c1000000-0000-0000-0000-00000000000b', 'Cliente Beta', $2)`, []any{multiOrgInitialOrgID, orgB}},
		{`INSERT INTO projects (id, name, customer_id, status, organization_id) VALUES
			('c2000000-0000-0000-0000-00000000000a', 'Obra Alfa', 'c1000000-0000-0000-0000-00000000000a', 'draft', $1),
			('c2000000-0000-0000-0000-00000000000b', 'Obra Beta', 'c1000000-0000-0000-0000-00000000000b', 'draft', $2)`, []any{multiOrgInitialOrgID, orgB}},
		{`INSERT INTO material_boards (id, code, name, width_mm, length_mm, thickness_mm, board_price, organization_id) VALUES
			('c3000000-0000-0000-0000-00000000000a', 'TAB-ALFA', 'Tablero Alfa', 1830, 2440, 18, 1000, $1),
			('c3000000-0000-0000-0000-00000000000b', 'TAB-BETA', 'Tablero Beta', 1830, 2440, 18, 1000, $2)`, []any{multiOrgInitialOrgID, orgB}},
	}
	for _, statement := range seed {
		if _, err := migrationPool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed runtime isolation fixture: %v", err)
		}
	}

	runtimePool, err := pgxpool.New(ctx, storage.TestDatabaseURLForDB(t, migrationPool.Config().ConnConfig.Database))
	if err != nil {
		t.Fatalf("open runtime pool: %v", err)
	}
	t.Cleanup(runtimePool.Close)
	return isolationRuntimeFixture{
		store:         &storage.PostgresStore{Pool: runtimePool},
		orgA:          multiOrgInitialOrgID,
		orgB:          orgB,
		actorA:        storage.TenantActor{OrganizationID: multiOrgInitialOrgID, UserID: isolationRuntimeUserA, MembershipID: isolationRuntimeMembershipA},
		actorB:        storage.TenantActor{OrganizationID: orgB, UserID: isolationRuntimeUserB, MembershipID: isolationRuntimeMembershipB},
		platformActor: storage.TenantActor{UserID: isolationPlatformUser},
	}
}

func isolationRuntimeError(fixture isolationRuntimeFixture, actor storage.TenantActor, run func(context.Context) error) error {
	return fixture.store.WithinTenantTx(storage.WithOrgCtx(context.Background(), actor.OrganizationID), actor, run)
}

func isolationRuntimeValue[T any](t *testing.T, fixture isolationRuntimeFixture, actor storage.TenantActor, run func(context.Context) (T, error)) T {
	t.Helper()
	var value T
	if err := isolationRuntimeError(fixture, actor, func(txCtx context.Context) error {
		var err error
		value, err = run(txCtx)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestIsolation_Customers(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store

	const idA = "c1000000-0000-0000-0000-00000000000a"
	const idB = "c1000000-0000-0000-0000-00000000000b"

	// Lists only see their own organization.
	listA := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) ([]domain.Customer, error) { return store.ListCustomers(txCtx) })
	listB := isolationRuntimeValue(t, fixture, fixture.actorB, func(txCtx context.Context) ([]domain.Customer, error) { return store.ListCustomers(txCtx) })
	if !customerListHas(listA, idA) || customerListHas(listA, idB) {
		t.Fatalf("org A list must contain only A's customer")
	}
	if !customerListHas(listB, idB) || customerListHas(listB, idA) {
		t.Fatalf("org B list must contain only B's customer")
	}

	// Direct fetch of the other org's row: same not-found as a missing row.
	if err := isolationRuntimeError(fixture, fixture.actorB, func(txCtx context.Context) error { _, err := store.GetCustomerByID(txCtx, idA); return err }); err == nil {
		t.Fatal("org B reading org A's customer must fail")
	}
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error { _, err := store.GetCustomerByID(txCtx, idB); return err }); err == nil {
		t.Fatal("org A reading org B's customer must fail")
	}
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error { _, err := store.GetCustomerByID(txCtx, idA); return err }); err != nil {
		t.Fatalf("own read must work: %v", err)
	}

	// Cross-org write attempts must not change anything.
	if err := isolationRuntimeError(fixture, fixture.actorB, func(txCtx context.Context) error { return store.DeactivateCustomer(txCtx, idA) }); err == nil {
		t.Fatal("org B deactivating org A's customer must fail")
	}
	var activeA bool
	if err := runConnectStoreSQL(t, store.Pool, fixture.actorA, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT active FROM customers WHERE id = $1`, idA).Scan(&activeA)
	}); err != nil || !activeA {
		t.Fatalf("org A's customer must remain active (active=%v err=%v)", activeA, err)
	}
}

func customerListHas(list []domain.Customer, id string) bool {
	for _, c := range list {
		if c.ID == id {
			return true
		}
	}
	return false
}

func TestIsolation_Projects(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store

	const idA = "c2000000-0000-0000-0000-00000000000a"
	const idB = "c2000000-0000-0000-0000-00000000000b"

	listA := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) ([]domain.Project, error) { return store.ListProjects(txCtx) })
	listB := isolationRuntimeValue(t, fixture, fixture.actorB, func(txCtx context.Context) ([]domain.Project, error) { return store.ListProjects(txCtx) })
	if len(listA) != 1 || listA[0].ID != idA {
		t.Fatalf("org A must see only its project, got %d", len(listA))
	}
	if len(listB) != 1 || listB[0].ID != idB {
		t.Fatalf("org B must see only its project, got %d", len(listB))
	}

	if err := isolationRuntimeError(fixture, fixture.actorB, func(txCtx context.Context) error { _, err := store.GetProjectByID(txCtx, idA); return err }); err == nil {
		t.Fatal("org B reading org A's project must fail")
	}
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error { _, err := store.GetProjectByID(txCtx, idA); return err }); err != nil {
		t.Fatalf("own read must work: %v", err)
	}
}

func TestIsolation_CatalogBoards(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store

	const idA = "c3000000-0000-0000-0000-00000000000a"

	listB := isolationRuntimeValue(t, fixture, fixture.actorB, func(txCtx context.Context) ([]domain.MaterialBoard, error) { return store.ListMaterialBoards(txCtx) })
	for _, m := range listB {
		if m.ID == idA || m.Code == "TAB-ALFA" {
			t.Fatal("org B's catalog must not include org A's board")
		}
	}
	if err := isolationRuntimeError(fixture, fixture.actorB, func(txCtx context.Context) error { _, err := store.GetMaterialBoardByID(txCtx, idA); return err }); err == nil {
		t.Fatal("org B reading org A's board must fail")
	}
	listA := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) ([]domain.MaterialBoard, error) { return store.ListMaterialBoards(txCtx) })
	if len(listA) != 1 || listA[0].Code != "TAB-ALFA" {
		t.Fatalf("org A must see its board, got %d", len(listA))
	}
}

func TestIsolation_WorkshopSettings(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store

	wsA := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (domain.WorkshopSettings, error) { return store.GetWorkshopSettings(txCtx) })
	wsB := isolationRuntimeValue(t, fixture, fixture.actorB, func(txCtx context.Context) (domain.WorkshopSettings, error) { return store.GetWorkshopSettings(txCtx) })
	if wsB.DefaultCurrency == wsA.DefaultCurrency {
		t.Fatalf("settings must be per organization (both %q)", wsB.DefaultCurrency)
	}
	if wsB.DefaultCurrency != "BRL" {
		t.Fatalf("org B currency = %q, want BRL", wsB.DefaultCurrency)
	}
}

// #327 hardening: the org user directory must be scoped — an org admin never
// sees other organizations' users. The global ListUsers stays reserved for
// the platform console.
func TestIsolation_UserDirectoryByOrganization(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	ctx := context.Background()

	// The fixture creates user A only in org A and user AB in both orgs.
	listA := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) ([]domain.User, error) { return store.ListUsersByOrganization(txCtx) })
	listB := isolationRuntimeValue(t, fixture, fixture.actorB, func(txCtx context.Context) ([]domain.User, error) { return store.ListUsersByOrganization(txCtx) })
	if len(listA) != 2 {
		t.Fatalf("org A directory must have 2 members, got %d", len(listA))
	}
	if len(listB) != 1 || listB[0].Email != "both@test.com" {
		t.Fatalf("org B directory must see only its own member, got %d", len(listB))
	}

	// Unscoped listing fails closed instead of leaking the whole table.
	if _, err := store.ListUsersByOrganization(ctx); err == nil {
		t.Fatal("unscoped directory listing must fail (no organization scope)")
	}
}

// #326: connected sales organizations — the parent link round-trips and
// ListConnectedOrganizations returns exactly the factory's network.
func TestConnectedOrganizations_ParentAndListing(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store

	factory := &domain.Organization{
		Name: "Fábrica Alpha", Slug: "fabrica-alpha",
		Type: domain.OrganizationTypeFactory, Status: domain.OrganizationStatusProvisioning,
	}
	if err := isolationRuntimeError(fixture, fixture.platformActor, func(txCtx context.Context) error { return store.CreateOrganization(txCtx, factory) }); err != nil {
		t.Fatalf("create factory: %v", err)
	}

	tienda := &domain.Organization{
		Name: "Tienda GDL", Slug: "tienda-gdl",
		Type: domain.OrganizationTypeStore, Status: domain.OrganizationStatusProvisioning,
		ParentOrganizationID: &factory.ID,
	}
	if err := isolationRuntimeError(fixture, fixture.platformActor, func(txCtx context.Context) error { return store.CreateOrganization(txCtx, tienda) }); err != nil {
		t.Fatalf("create store: %v", err)
	}

	independent := &domain.Organization{
		Name: "Taller Independiente", Slug: "taller-independiente",
		Type: domain.OrganizationTypeFactory, Status: domain.OrganizationStatusProvisioning,
	}
	if err := isolationRuntimeError(fixture, fixture.platformActor, func(txCtx context.Context) error { return store.CreateOrganization(txCtx, independent) }); err != nil {
		t.Fatalf("create independent: %v", err)
	}

	got := isolationRuntimeValue(t, fixture, fixture.platformActor, func(txCtx context.Context) (*domain.Organization, error) {
		return store.GetOrganizationByID(txCtx, tienda.ID)
	})
	if got == nil {
		t.Fatal("get store returned nil")
	}
	if got.ParentOrganizationID == nil || *got.ParentOrganizationID != factory.ID {
		t.Fatalf("parent round-trip = %v, want %s", got.ParentOrganizationID, factory.ID)
	}

	list := isolationRuntimeValue(t, fixture, fixture.platformActor, func(txCtx context.Context) ([]domain.Organization, error) {
		return store.ListConnectedOrganizations(txCtx, factory.ID)
	})
	if len(list) != 1 || list[0].ID != tienda.ID {
		t.Fatalf("connected list must contain only the store, got %+v", list)
	}
	if list[0].ParentOrganizationID == nil || *list[0].ParentOrganizationID != factory.ID {
		t.Fatalf("connected listing lost the parent link")
	}
}

// B1 regression: UpdateOrganization's RETURNING scan must match
// organizationColumns (parent_organization_id was added by 000089) — a
// mismatch made every platform org PATCH (rename/license/suspend) 500.
func TestUpdateOrganization_ScanMatchesColumns(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store

	org := &domain.Organization{
		Name: "Fábrica Update", Slug: "fabrica-update",
		Type: domain.OrganizationTypeFactory, Status: domain.OrganizationStatusProvisioning,
	}
	if err := isolationRuntimeError(fixture, fixture.platformActor, func(txCtx context.Context) error { return store.CreateOrganization(txCtx, org) }); err != nil {
		t.Fatalf("create: %v", err)
	}
	current := isolationRuntimeValue(t, fixture, fixture.platformActor, func(txCtx context.Context) (*domain.Organization, error) {
		return store.GetOrganizationByID(txCtx, org.ID)
	})
	if current == nil {
		t.Fatal("current organization returned nil")
	}

	org.Name = "Fábrica Renombrada"
	if err := isolationRuntimeError(fixture, fixture.platformActor, func(txCtx context.Context) error {
		return store.UpdateOrganizationVersion(txCtx, org, current.Version)
	}); err != nil {
		t.Fatalf("update rename: %v", err)
	}
	if org.Name != "Fábrica Renombrada" || org.Status != domain.OrganizationStatusProvisioning || org.Version != current.Version+1 {
		t.Fatalf("scan did not round-trip: %+v", org)
	}

	got := isolationRuntimeValue(t, fixture, fixture.platformActor, func(txCtx context.Context) (*domain.Organization, error) {
		return store.GetOrganizationByID(txCtx, org.ID)
	})
	if got == nil {
		t.Fatal("re-read returned nil")
	}
	if got.Name != "Fábrica Renombrada" || got.Status != domain.OrganizationStatusProvisioning || got.Version != current.Version+1 {
		t.Fatalf("update did not persist: %+v", got)
	}
}
