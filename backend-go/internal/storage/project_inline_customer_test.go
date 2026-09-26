package storage_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #712 — "Nueva cotización → Nuevo cliente" must be ONE reliable transition.
// The shell used to mint a local customer UUID, fire the catalog save
// (customers upserted last) and POST /projects in parallel, so the project
// insert hit projects_customer_id_fkey (23503) while the customer landed
// later as an orphan. These proofs run on real PostgreSQL: the FK stays
// intact, the inline transition is atomic and the customer identity is
// server-owned.

const (
	inlineProjectID = "e2000000-0000-0000-0000-000000000712"
	inlineDupID     = "e2000000-0000-0000-0000-000000000713"
	neverPersisted  = "e7777777-0000-0000-0000-000000000777"
)

func countCustomers(t *testing.T, store *storage.PostgresStore, org string) int {
	t.Helper()
	var n int
	if err := store.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM customers WHERE organization_id = $1`, org).Scan(&n); err != nil {
		t.Fatalf("count customers: %v", err)
	}
	return n
}

func countCustomersByName(t *testing.T, store *storage.PostgresStore, org, name string) int {
	t.Helper()
	var n int
	if err := store.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM customers WHERE organization_id = $1 AND name = $2`, org, name).Scan(&n); err != nil {
		t.Fatalf("count customers by name: %v", err)
	}
	return n
}

func runtimeCustomerCount(t *testing.T, fixture isolationRuntimeFixture, actor storage.TenantActor) int {
	t.Helper()
	var count int
	if err := runConnectStoreSQL(t, fixture.store.Pool, actor, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT count(*) FROM customers WHERE organization_id = $1`, actor.OrganizationID).Scan(&count)
	}); err != nil {
		t.Fatal(err)
	}
	return count
}

func runtimeCustomerCountByName(t *testing.T, fixture isolationRuntimeFixture, actor storage.TenantActor, name string) int {
	t.Helper()
	var count int
	if err := runConnectStoreSQL(t, fixture.store.Pool, actor, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT count(*) FROM customers WHERE organization_id = $1 AND name = $2`, actor.OrganizationID, name).Scan(&count)
	}); err != nil {
		t.Fatal(err)
	}
	return count
}

// The exact #712 boundary, pinned. Before the fix the shell's project insert
// reached PostgreSQL with a customer id no committed row had and died on
// projects_customer_id_fkey (23503) while the customer landed later as an
// orphan. Now the storage raises the neutral typed guard BEFORE the insert —
// and the raw FK itself must keep rejecting the same shape at the SQL level
// (the fix never relaxes it).
func TestProjectInlineCustomer_Boundary_ProjectReferencingUnpersistedCustomerFailsFK(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store

	p := &domain.Project{ID: inlineProjectID, Name: "Cocina Ana", CustomerID: neverPersisted, Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft, Items: []domain.ProjectItem{}}
	err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error { return store.CreateProject(txCtx, p) })
	if !errors.Is(err, storage.ErrCustomerNotFound) {
		t.Fatalf("error = %v, want the neutral storage guard (unpersisted customer id)", err)
	}
	var n int
	if err := runConnectStoreSQL(t, store.Pool, fixture.actorA, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT count(*) FROM projects WHERE id = $1`, inlineProjectID).Scan(&n)
	}); err != nil || n != 0 {
		t.Fatalf("no project row must survive, got count=%d err=%v", n, err)
	}

	// The DB constraint is the last-resort guard and stays untouched: a direct
	// insert (bypassing the store method) still violates the FK.
	sqlErr := runConnectStoreSQL(t, store.Pool, fixture.actorA, func(tx pgx.Tx) error {
		_, err := tx.Exec(context.Background(), `INSERT INTO projects (id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id) VALUES ($1, 'Raw FK', $2, 'draft', $3, $3, $3)`, inlineDupID, neverPersisted, fixture.orgA)
		return err
	})
	if sqlErr == nil {
		t.Fatal("raw insert with an unpersisted customer must still violate the FK")
	}
	if !strings.Contains(sqlErr.Error(), "projects_customer_id_fkey") && !strings.Contains(sqlErr.Error(), "23503") {
		t.Fatalf("sql error = %v, want the projects_customer_id_fkey violation (SQLSTATE 23503)", sqlErr)
	}
}

// Happy path (proof B): empty org → one customer row + one project row,
// project.customer_id == the server-persisted customer.id.
func TestProjectInlineCustomer_AtomicCreateServerOwnedIdentity(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	before := runtimeCustomerCount(t, fixture, fixture.actorA)

	customer := domain.Customer{Name: "Ana López"}
	p := &domain.Project{ID: inlineProjectID, Name: "Cocina Ana", Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft, Items: []domain.ProjectItem{}}
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error { return store.CreateProjectWithInlineCustomer(txCtx, p, &customer) }); err != nil {
		t.Fatalf("CreateProjectWithInlineCustomer: %v", err)
	}
	if customer.ID == "" {
		t.Fatal("inline customer id must be generated by the server, not the client")
	}
	if p.CustomerID != customer.ID {
		t.Fatalf("project.customer_id = %q, want the persisted customer id %q", p.CustomerID, customer.ID)
	}
	if got := runtimeCustomerCount(t, fixture, fixture.actorA); got != before+1 {
		t.Fatalf("customers = %d, want %d (exactly one new customer)", got, before+1)
	}
	list := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) ([]domain.Customer, error) { return store.ListCustomers(txCtx) })
	found := false
	for _, c := range list {
		if c.ID == customer.ID {
			found = true
			if c.Name != "Ana López" || !c.Active {
				t.Fatalf("persisted customer = %+v, want active 'Ana López'", c)
			}
		}
	}
	if !found {
		t.Fatal("the created customer must be visible via ListCustomers")
	}
	var ref string
	if err := runConnectStoreSQL(t, store.Pool, fixture.actorA, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT customer_id FROM projects WHERE id = $1`, inlineProjectID).Scan(&ref)
	}); err != nil {
		t.Fatalf("read project: %v", err)
	}
	if ref != customer.ID {
		t.Fatalf("projects.customer_id = %q, want %q", ref, customer.ID)
	}
	got := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
		return store.GetProjectByID(txCtx, inlineProjectID)
	})
	if got.CustomerID != customer.ID {
		t.Fatalf("GetProjectByID = %+v, want customer %q", got, customer.ID)
	}
}

// Atomicity (proof D): a controlled project failure AFTER the customer insert
// must roll the customer back — no orphan residue from the joint intent.
func TestProjectInlineCustomer_ProjectFailureRollsBackCustomer(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	before := runtimeCustomerCount(t, fixture, fixture.actorA)

	existing := &domain.Project{ID: inlineDupID, Name: "Ya existe", CustomerID: "c1000000-0000-0000-0000-00000000000a", Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft, Items: []domain.ProjectItem{}}
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error { return store.CreateProject(txCtx, existing) }); err != nil {
		t.Fatalf("seed existing project: %v", err)
	}
	customer := domain.Customer{Name: "Ana López"}
	dup := &domain.Project{ID: inlineDupID, Name: "Cocina Ana", Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft, Items: []domain.ProjectItem{}}
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error { return store.CreateProjectWithInlineCustomer(txCtx, dup, &customer) }); err == nil {
		t.Fatal("duplicate project id must fail the transition")
	}
	if got := runtimeCustomerCountByName(t, fixture, fixture.actorA, "Ana López"); got != 0 {
		t.Fatalf("orphan customer rows = %d, want 0 (transition rolled back)", got)
	}
	if got := runtimeCustomerCount(t, fixture, fixture.actorA); got != before {
		t.Fatalf("customers = %d, want %d (no residue)", got, before)
	}
}

// Idempotent retry (proof F): re-sending the SAME intention (same project id)
// conflicts on the project and must not duplicate the customer.
func TestProjectInlineCustomer_RetrySameProjectIDDoesNotDuplicateCustomer(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	build := func() (*domain.Project, *domain.Customer) {
		return &domain.Project{ID: inlineProjectID, Name: "Cocina Ana", Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft, Items: []domain.ProjectItem{}}, &domain.Customer{Name: "Ana López"}
	}
	p1, c1 := build()
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error { return store.CreateProjectWithInlineCustomer(txCtx, p1, c1) }); err != nil {
		t.Fatalf("first attempt: %v", err)
	}
	p2, c2 := build()
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error { return store.CreateProjectWithInlineCustomer(txCtx, p2, c2) }); err == nil {
		t.Fatal("replay with the same project id must conflict, not create again")
	}
	if got := runtimeCustomerCountByName(t, fixture, fixture.actorA, "Ana López"); got != 1 {
		t.Fatalf("'Ana López' rows = %d, want exactly 1 (no duplicate from the retry)", got)
	}
}

// Tenant isolation (proof E): a valid customer id from another org must NOT
// pass the logical FK — neutral not-found, no project row, RLS untouched.
func TestProjectInlineCustomer_TenantIsolation_CustomerFromOtherOrgRejected(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	const customerB = "c1000000-0000-0000-0000-00000000000b"
	p := &domain.Project{ID: inlineProjectID, Name: "Cross", CustomerID: customerB, Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft, Items: []domain.ProjectItem{}}
	err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error { return store.CreateProject(txCtx, p) })
	if !errors.Is(err, storage.ErrCustomerNotFound) {
		t.Fatalf("error = %v, want storage.ErrCustomerNotFound (neutral, tenant A cannot bind tenant B's customer)", err)
	}
	var n int
	if err := runConnectStoreSQL(t, store.Pool, fixture.actorA, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT count(*) FROM projects WHERE id = $1`, inlineProjectID).Scan(&n)
	}); err != nil || n != 0 {
		t.Fatalf("project rows = %d err = %v, want 0", n, err)
	}
}

// The inline customer itself stays scoped to the CALLING org.
func TestProjectInlineCustomer_TenantIsolation_InlineCustomerBelongsToCallingOrg(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	customer := domain.Customer{Name: "Sólo Beta"}
	p := &domain.Project{ID: inlineProjectID, Name: "Obra Beta", Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft, Items: []domain.ProjectItem{}}
	if err := isolationRuntimeError(fixture, fixture.actorB, func(txCtx context.Context) error { return store.CreateProjectWithInlineCustomer(txCtx, p, &customer) }); err != nil {
		t.Fatalf("inline create in org B: %v", err)
	}
	var orgID string
	if err := runConnectStoreSQL(t, store.Pool, fixture.actorB, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT organization_id FROM customers WHERE id = $1`, customer.ID).Scan(&orgID)
	}); err != nil {
		t.Fatalf("read customer org: %v", err)
	}
	if orgID != fixture.orgB {
		t.Fatalf("customer.organization_id = %q, want org B %q", orgID, fixture.orgB)
	}
	listA := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) ([]domain.Customer, error) { return store.ListCustomers(txCtx) })
	for _, c := range listA {
		if c.ID == customer.ID {
			t.Fatal("org A must never see org B's inline customer")
		}
	}
}

// Existing-customer path (proof C) stays byte-identical: no customer created,
// project references exactly the selected id.
func TestProjectInlineCustomer_ExistingCustomerPathUnchanged(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	before := runtimeCustomerCount(t, fixture, fixture.actorA)
	const existingA = "c1000000-0000-0000-0000-00000000000a"
	p := &domain.Project{ID: inlineProjectID, Name: "Con cliente existente", CustomerID: existingA, Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft, Items: []domain.ProjectItem{}}
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error { return store.CreateProject(txCtx, p) }); err != nil {
		t.Fatalf("CreateProject with existing customer: %v", err)
	}
	if p.CustomerID != existingA {
		t.Fatalf("customer_id = %q, want the selected customer untouched", p.CustomerID)
	}
	if got := runtimeCustomerCount(t, fixture, fixture.actorA); got != before {
		t.Fatalf("customers = %d, want %d (existing path never creates customers)", got, before)
	}
}

// A well-formed but missing customer id surfaces as the same neutral
// not-found used everywhere — never a distinct cross-org oracle.
func TestProjectInlineCustomer_MissingCustomerIsNeutralNotFound(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	p := &domain.Project{ID: inlineProjectID, Name: "Fantasma", CustomerID: neverPersisted, Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft, Items: []domain.ProjectItem{}}
	err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error { return store.CreateProject(txCtx, p) })
	if !errors.Is(err, storage.ErrCustomerNotFound) {
		t.Fatalf("error = %v, want storage.ErrCustomerNotFound", err)
	}
}

// §8 on the update surface too: PUT rewrites customer_id, so a cross-org
// customer must be rejected there with the same neutral error.
func TestProjectInlineCustomer_UpdateCannotBindOtherOrgCustomer(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	const projectID = "c2000000-0000-0000-0000-00000000000a"
	const customerB = "c1000000-0000-0000-0000-00000000000b"
	current := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) { return store.GetProjectByID(txCtx, projectID) })
	current.CustomerID = customerB
	err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error { return store.UpdateProject(txCtx, projectID, current) })
	if !errors.Is(err, storage.ErrCustomerNotFound) {
		t.Fatalf("error = %v, want storage.ErrCustomerNotFound (update cannot bind another org's customer)", err)
	}
	var ref string
	if err := runConnectStoreSQL(t, store.Pool, fixture.actorA, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT customer_id FROM projects WHERE id = $1`, projectID).Scan(&ref)
	}); err != nil {
		t.Fatalf("read project: %v", err)
	}
	if ref == customerB {
		t.Fatal("the rejected update must not have landed")
	}
}
