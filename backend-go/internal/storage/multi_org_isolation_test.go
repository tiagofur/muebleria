package storage_test

import (
	"context"
	"testing"

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
		`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Taller Beta', 'taller-beta')`, orgB); err != nil {
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

func TestIsolation_Customers(t *testing.T) {
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()

	const idA = "c1000000-0000-0000-0000-00000000000a"
	const idB = "c1000000-0000-0000-0000-00000000000b"

	// Lists only see their own organization.
	listA, err := store.ListCustomers(scoped(ctx, orgA))
	if err != nil {
		t.Fatalf("list A: %v", err)
	}
	listB, err := store.ListCustomers(scoped(ctx, orgB))
	if err != nil {
		t.Fatalf("list B: %v", err)
	}
	if !customerListHas(listA, idA) || customerListHas(listA, idB) {
		t.Fatalf("org A list must contain only A's customer")
	}
	if !customerListHas(listB, idB) || customerListHas(listB, idA) {
		t.Fatalf("org B list must contain only B's customer")
	}

	// Direct fetch of the other org's row: same not-found as a missing row.
	if _, err := store.GetCustomerByID(scoped(ctx, orgB), idA); err == nil {
		t.Fatal("org B reading org A's customer must fail")
	}
	if _, err := store.GetCustomerByID(scoped(ctx, orgA), idB); err == nil {
		t.Fatal("org A reading org B's customer must fail")
	}
	if _, err := store.GetCustomerByID(scoped(ctx, orgA), idA); err != nil {
		t.Fatalf("own read must work: %v", err)
	}

	// Cross-org write attempts must not change anything.
	if err := store.DeactivateCustomer(scoped(ctx, orgB), idA); err == nil {
		t.Fatal("org B deactivating org A's customer must fail")
	}
	var activeA bool
	if err := store.Pool.QueryRow(ctx, `SELECT active FROM customers WHERE id = $1`, idA).Scan(&activeA); err != nil || !activeA {
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
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()

	const idA = "c2000000-0000-0000-0000-00000000000a"
	const idB = "c2000000-0000-0000-0000-00000000000b"

	listA, err := store.ListProjects(scoped(ctx, orgA))
	if err != nil {
		t.Fatalf("list A: %v", err)
	}
	listB, err := store.ListProjects(scoped(ctx, orgB))
	if err != nil {
		t.Fatalf("list B: %v", err)
	}
	if len(listA) != 1 || listA[0].ID != idA {
		t.Fatalf("org A must see only its project, got %d", len(listA))
	}
	if len(listB) != 1 || listB[0].ID != idB {
		t.Fatalf("org B must see only its project, got %d", len(listB))
	}

	if _, err := store.GetProjectByID(scoped(ctx, orgB), idA); err == nil {
		t.Fatal("org B reading org A's project must fail")
	}
	if _, err := store.GetProjectByID(scoped(ctx, orgA), idA); err != nil {
		t.Fatalf("own read must work: %v", err)
	}
}

func TestIsolation_CatalogBoards(t *testing.T) {
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()

	const idA = "c3000000-0000-0000-0000-00000000000a"

	listB, err := store.ListMaterialBoards(scoped(ctx, orgB))
	if err != nil {
		t.Fatalf("list B: %v", err)
	}
	for _, m := range listB {
		if m.ID == idA || m.Code == "TAB-ALFA" {
			t.Fatal("org B's catalog must not include org A's board")
		}
	}
	if _, err := store.GetMaterialBoardByID(scoped(ctx, orgB), idA); err == nil {
		t.Fatal("org B reading org A's board must fail")
	}
	listA, err := store.ListMaterialBoards(scoped(ctx, orgA))
	if err != nil {
		t.Fatalf("list A: %v", err)
	}
	if len(listA) != 1 || listA[0].Code != "TAB-ALFA" {
		t.Fatalf("org A must see its board, got %d", len(listA))
	}
}

func TestIsolation_WorkshopSettings(t *testing.T) {
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()

	wsA, err := store.GetWorkshopSettings(scoped(ctx, orgA))
	if err != nil {
		t.Fatalf("settings A: %v", err)
	}
	wsB, err := store.GetWorkshopSettings(scoped(ctx, orgB))
	if err != nil {
		t.Fatalf("settings B: %v", err)
	}
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
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()

	// Two users: u-a belongs only to org A, u-both belongs to A and B.
	seed := []string{
		`INSERT INTO users (id, email, name, role, active, password_hash) VALUES
		 ('a1000000-0000-0000-0000-0000000000aa', 'a@test.com', 'Usuario A', 'admin', true, 'x'),
		 ('a1000000-0000-0000-0000-0000000000bb', 'both@test.com', 'Usuario AB', 'user', true, 'x')`,
		`INSERT INTO memberships (organization_id, user_id, roles) VALUES
		 ('` + orgA + `', 'a1000000-0000-0000-0000-0000000000aa', '{admin}'),
		 ('` + orgA + `', 'a1000000-0000-0000-0000-0000000000bb', '{vendedor}'),
		 ('` + orgB + `', 'a1000000-0000-0000-0000-0000000000bb', '{admin}')`,
	}
	for _, s := range seed {
		if _, err := store.Pool.Exec(ctx, s); err != nil {
			t.Fatalf("seed: %v (%s)", err, s[:60])
		}
	}

	listA, err := store.ListUsersByOrganization(scoped(ctx, orgA))
	if err != nil {
		t.Fatalf("list A: %v", err)
	}
	listB, err := store.ListUsersByOrganization(scoped(ctx, orgB))
	if err != nil {
		t.Fatalf("list B: %v", err)
	}
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
