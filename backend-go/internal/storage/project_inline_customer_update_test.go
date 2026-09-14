package storage_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #714 — "Editar cotización → Nuevo cliente" must be ONE reliable transition.
// The shell used to mint a local customer UUID, fire the catalog save and the
// PUT /projects/{id} in parallel, so the update hit projects_customer_id_fkey
// (23503) with an unpersisted identity while the customer landed later as an
// orphan. These proofs run on real PostgreSQL: the FK stays intact, the inline
// update is atomic, retried intentions converge and competing updates fail
// with an explicit conflict instead of orphaning customers.

const (
	// Seeded by isolationSetup: org A draft project + its customer.
	inlineUpdateProjectID = "c2000000-0000-0000-0000-00000000000a"
	inlineUpdateBaseCust  = "c1000000-0000-0000-0000-00000000000a"
)

func readProjectCustomerID(t *testing.T, store *storage.PostgresStore, projectID string) string {
	t.Helper()
	var ref *string
	if err := store.Pool.QueryRow(context.Background(),
		`SELECT customer_id FROM projects WHERE id = $1`, projectID).Scan(&ref); err != nil {
		t.Fatalf("read project customer: %v", err)
	}
	if ref == nil {
		return ""
	}
	return *ref
}

func namedInlineUpdateStore(t *testing.T, source *storage.PostgresStore, applicationName string) *storage.PostgresStore {
	t.Helper()
	config := source.Pool.Config().Copy()
	config.ConnConfig.RuntimeParams["application_name"] = applicationName
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return &storage.PostgresStore{Pool: pool}
}

func awaitInlineUpdateResult(t *testing.T, result <-chan error) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-time.After(5 * time.Second):
		t.Fatal("inline update did not finish after the competing lock was released")
		return nil
	}
}

// The exact #714 boundary on the update surface. The shell's parallel PUT
// reached PostgreSQL with a customer id no committed row had and died on
// projects_customer_id_fkey; the storage raises the neutral typed guard
// BEFORE the update and the raw FK itself keeps rejecting the same shape.
func TestProjectInlineUpdate_Boundary_UpdateReferencingUnpersistedCustomerFailsFK(t *testing.T) {
	store, orgA, _ := isolationSetup(t)
	ctx := context.Background()

	current, err := store.GetProjectByID(scoped(ctx, orgA), inlineUpdateProjectID)
	if err != nil {
		t.Fatalf("seeded project: %v", err)
	}
	current.CustomerID = neverPersisted
	if err := store.UpdateProject(scoped(ctx, orgA), inlineUpdateProjectID, current); !errors.Is(err, storage.ErrCustomerNotFound) {
		t.Fatalf("error = %v, want the neutral storage guard (unpersisted customer id)", err)
	}
	if got := readProjectCustomerID(t, store, inlineUpdateProjectID); got != inlineUpdateBaseCust {
		t.Fatalf("customer_id = %q, want the seeded assignment untouched", got)
	}

	// The DB constraint is the last-resort guard and stays untouched: a direct
	// update (bypassing the store method) still violates the FK.
	_, sqlErr := store.Pool.Exec(ctx,
		`UPDATE projects SET customer_id = $1 WHERE id = $2`, neverPersisted, inlineUpdateProjectID)
	if sqlErr == nil {
		t.Fatal("raw update with an unpersisted customer must still violate the FK")
	}
	if !strings.Contains(sqlErr.Error(), "projects_customer_id_fkey") && !strings.Contains(sqlErr.Error(), "23503") {
		t.Fatalf("sql error = %v, want the projects_customer_id_fkey violation (SQLSTATE 23503)", sqlErr)
	}
}

// Happy path (proof B): draft project + inline name → exactly one new customer
// row, project.customer_id == the server-persisted customer.id, customer
// scoped to the project's owning organization.
func TestProjectInlineUpdate_AtomicUpdateServerOwnedIdentity(t *testing.T) {
	store, orgA, _ := isolationSetup(t)
	ctx := context.Background()
	before := countCustomers(t, store, orgA)

	payload, err := store.GetProjectByID(scoped(ctx, orgA), inlineUpdateProjectID)
	if err != nil {
		t.Fatalf("seeded project: %v", err)
	}
	payload.Name = "Cocina editada"
	payload.CustomerID = "" // the UI sends no customer id on the inline path

	customer := domain.Customer{Name: "Ana López"}
	if err := store.UpdateProjectWithInlineCustomer(scoped(ctx, orgA), inlineUpdateProjectID, payload, &customer, inlineUpdateBaseCust, payload.UpdatedAt); err != nil {
		t.Fatalf("UpdateProjectWithInlineCustomer: %v", err)
	}

	if customer.ID == "" {
		t.Fatal("inline customer id must be minted by the server, not the client")
	}
	if payload.CustomerID != customer.ID {
		t.Fatalf("project.customer_id = %q, want the persisted customer id %q", payload.CustomerID, customer.ID)
	}
	if got := readProjectCustomerID(t, store, inlineUpdateProjectID); got != customer.ID {
		t.Fatalf("projects.customer_id = %q, want %q", got, customer.ID)
	}
	if got := countCustomers(t, store, orgA); got != before+1 {
		t.Fatalf("customers = %d, want %d (exactly one new customer)", got, before+1)
	}

	var orgID string
	if err := store.Pool.QueryRow(ctx,
		`SELECT organization_id FROM customers WHERE id = $1`, customer.ID).Scan(&orgID); err != nil {
		t.Fatalf("read customer org: %v", err)
	}
	if orgID != orgA {
		t.Fatalf("customer.organization_id = %q, want the project's owning org %q", orgID, orgA)
	}

	got, err := store.GetProjectByID(scoped(ctx, orgA), inlineUpdateProjectID)
	if err != nil || got.CustomerID != customer.ID || got.Name != "Cocina editada" {
		t.Fatalf("GetProjectByID = (%+v, %v), want the updated aggregate bound to the new customer", got, err)
	}
}

// Base mismatch (§11): a stale base view fails with the explicit typed
// conflict — never a silent overwrite, never an orphan.
func TestProjectInlineUpdate_BaseMismatchFailsExplicitConflict(t *testing.T) {
	store, orgA, _ := isolationSetup(t)
	ctx := context.Background()
	before := countCustomers(t, store, orgA)

	payload, err := store.GetProjectByID(scoped(ctx, orgA), inlineUpdateProjectID)
	if err != nil {
		t.Fatalf("seeded project: %v", err)
	}
	payload.CustomerID = ""
	customer := domain.Customer{Name: "Ana López"}
	err = store.UpdateProjectWithInlineCustomer(scoped(ctx, orgA), inlineUpdateProjectID, payload, &customer, "e7777777-0000-0000-0000-000000000700", payload.UpdatedAt)
	if !errors.Is(err, storage.ErrProjectConcurrentUpdate) {
		t.Fatalf("error = %v, want storage.ErrProjectConcurrentUpdate", err)
	}
	if got := countCustomers(t, store, orgA); got != before {
		t.Fatalf("customers = %d, want %d (no customer from the rejected transition)", got, before)
	}
	if got := readProjectCustomerID(t, store, inlineUpdateProjectID); got != inlineUpdateBaseCust {
		t.Fatalf("customer_id = %q, want the seeded assignment untouched", got)
	}
}

// Atomicity (proof C): a controlled project failure AFTER the customer insert
// must roll the customer back — no orphan residue from the joint intent.
func TestProjectInlineUpdate_UpdateFailureRollsBackCustomer(t *testing.T) {
	store, orgA, _ := isolationSetup(t)
	ctx := context.Background()
	before := countCustomers(t, store, orgA)

	payload, err := store.GetProjectByID(scoped(ctx, orgA), inlineUpdateProjectID)
	if err != nil {
		t.Fatalf("seeded project: %v", err)
	}
	payload.CustomerID = ""
	// Controlled failure inside the update half: project_items.module_id has a
	// hard FK to modules, so an unpersisted module id fails AFTER the customer
	// insert inside the same transaction.
	payload.Items = []domain.ProjectItem{{
		ID: "e3000000-0000-0000-0000-00000000000a", ModuleID: neverPersisted, Quantity: 1,
	}}

	customer := domain.Customer{Name: "Ana López"}
	if err := store.UpdateProjectWithInlineCustomer(scoped(ctx, orgA), inlineUpdateProjectID, payload, &customer, inlineUpdateBaseCust, payload.UpdatedAt); err == nil {
		t.Fatal("the controlled item failure must fail the transition")
	}
	if got := countCustomersByName(t, store, orgA, "Ana López"); got != 0 {
		t.Fatalf("orphan customer rows = %d, want 0 (transition rolled back)", got)
	}
	if got := countCustomers(t, store, orgA); got != before {
		t.Fatalf("customers = %d, want %d (no residue)", got, before)
	}
	if got := readProjectCustomerID(t, store, inlineUpdateProjectID); got != inlineUpdateBaseCust {
		t.Fatalf("customer_id = %q, want the original assignment intact", got)
	}
}

// Idempotent retry (proof G, storage level): the same intention replayed after
// a lost response still carries the SAME base view; the stored assignment has
// moved, so the replay conflicts explicitly and mints nothing.
func TestProjectInlineUpdate_RetrySameIntentionConverges(t *testing.T) {
	store, orgA, _ := isolationSetup(t)
	ctx := context.Background()

	build := func() (*domain.Project, *domain.Customer) {
		payload, err := store.GetProjectByID(scoped(ctx, orgA), inlineUpdateProjectID)
		if err != nil {
			t.Fatalf("seeded project: %v", err)
		}
		payload.CustomerID = ""
		return payload, &domain.Customer{Name: "Ana López"}
	}

	p1, c1 := build()
	expectedUpdatedAt := p1.UpdatedAt
	if err := store.UpdateProjectWithInlineCustomer(scoped(ctx, orgA), inlineUpdateProjectID, p1, c1, inlineUpdateBaseCust, expectedUpdatedAt); err != nil {
		t.Fatalf("first attempt: %v", err)
	}

	// Response lost; the client replays the exact same intention (same base).
	p2, c2 := build()
	err := store.UpdateProjectWithInlineCustomer(scoped(ctx, orgA), inlineUpdateProjectID, p2, c2, inlineUpdateBaseCust, expectedUpdatedAt)
	if !errors.Is(err, storage.ErrProjectConcurrentUpdate) {
		t.Fatalf("replay error = %v, want the explicit conflict (converge, never duplicate)", err)
	}
	if got := countCustomersByName(t, store, orgA, "Ana López"); got != 1 {
		t.Fatalf("'Ana López' rows = %d, want exactly 1 (no duplicate from the retry)", got)
	}
	if got := readProjectCustomerID(t, store, inlineUpdateProjectID); got != c1.ID {
		t.Fatalf("customer_id = %q, want the first committed customer %q", got, c1.ID)
	}
}

// Concurrency (proof H): two competing inline updates serialize on the row
// lock; exactly one commits, the loser gets the explicit conflict, exactly one
// customer exists afterwards — no arbitrary last-write orphan.
func TestProjectInlineUpdate_ConcurrentCompetingUpdatesSerializeExplicitly(t *testing.T) {
	store, orgA, _ := isolationSetup(t)
	ctx := context.Background()
	before := countCustomers(t, store, orgA)

	build := func(name string) (*domain.Project, *domain.Customer) {
		payload, err := store.GetProjectByID(scoped(ctx, orgA), inlineUpdateProjectID)
		if err != nil {
			t.Fatalf("seeded project: %v", err)
		}
		payload.CustomerID = ""
		return payload, &domain.Customer{Name: name}
	}

	const rounds = 8
	var conflicts, successes int
	var winnerCustomer string
	type result struct {
		err        error
		customerID string
	}
	results := make(chan result, rounds)
	for i := 0; i < rounds; i++ {
		p, c := build("Competidora")
		go func() {
			err := store.UpdateProjectWithInlineCustomer(scoped(ctx, orgA), inlineUpdateProjectID, p, c, inlineUpdateBaseCust, p.UpdatedAt)
			results <- result{err: err, customerID: c.ID}
		}()
	}
	for i := 0; i < rounds; i++ {
		outcome := <-results
		switch {
		case outcome.err == nil:
			successes++
			winnerCustomer = outcome.customerID
		case errors.Is(outcome.err, storage.ErrProjectConcurrentUpdate):
			conflicts++
		default:
			t.Fatalf("unexpected error: %v", outcome.err)
		}
	}

	if successes != 1 || conflicts != rounds-1 {
		t.Fatalf("successes=%d conflicts=%d, want exactly 1 success and %d explicit conflicts", successes, conflicts, rounds-1)
	}
	if got := countCustomers(t, store, orgA); got != before+1 {
		t.Fatalf("customers = %d, want %d (exactly one — no orphan from the losers)", got, before+1)
	}
	if got := readProjectCustomerID(t, store, inlineUpdateProjectID); got != winnerCustomer {
		t.Fatalf("customer_id = %q, want the winner's customer %q", got, winnerCustomer)
	}
}

func TestProjectInlineUpdate_LifecycleChangeCommittedWhileWaitingFailsConflict(t *testing.T) {
	store, orgA, _ := isolationSetup(t)
	ctx := context.Background()
	payload, err := store.GetProjectByID(scoped(ctx, orgA), inlineUpdateProjectID)
	if err != nil {
		t.Fatal(err)
	}
	payload.CustomerID = ""
	before := countCustomers(t, store, orgA)

	winner, err := store.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer winner.Rollback(ctx)
	if _, err := winner.Exec(ctx, `SELECT id FROM projects WHERE id=$1 FOR UPDATE`, inlineUpdateProjectID); err != nil {
		t.Fatal(err)
	}
	if _, err := winner.Exec(ctx, `UPDATE projects SET status='quoted', updated_at=clock_timestamp() WHERE id=$1`, inlineUpdateProjectID); err != nil {
		t.Fatal(err)
	}

	const applicationName = "project-inline-lifecycle-race"
	tracingStore := namedInlineUpdateStore(t, store, applicationName)
	result := make(chan error, 1)
	go func() {
		customer := &domain.Customer{Name: "Lifecycle loser"}
		result <- tracingStore.UpdateProjectWithInlineCustomer(scoped(ctx, orgA), inlineUpdateProjectID, payload, customer, inlineUpdateBaseCust, payload.UpdatedAt)
	}()
	waitForOrganizationLockWait(t, store.Pool, applicationName)
	if err := winner.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := awaitInlineUpdateResult(t, result); !errors.Is(err, storage.ErrProjectConcurrentUpdate) {
		t.Fatalf("inline update error = %v, want concurrent conflict after lifecycle winner", err)
	}

	var status, customerID string
	if err := store.Pool.QueryRow(ctx, `SELECT status, customer_id FROM projects WHERE id=$1`, inlineUpdateProjectID).Scan(&status, &customerID); err != nil {
		t.Fatal(err)
	}
	if status != "quoted" || customerID != inlineUpdateBaseCust {
		t.Fatalf("winner state status/customer = %q/%q, want quoted/%q", status, customerID, inlineUpdateBaseCust)
	}
	if got := countCustomers(t, store, orgA); got != before {
		t.Fatalf("customers = %d, want %d (loser must not create one)", got, before)
	}
}

func TestProjectInlineUpdate_MetadataChangeWithSameCustomerIsNotOverwritten(t *testing.T) {
	store, orgA, _ := isolationSetup(t)
	ctx := context.Background()
	payload, err := store.GetProjectByID(scoped(ctx, orgA), inlineUpdateProjectID)
	if err != nil {
		t.Fatal(err)
	}
	payload.CustomerID = ""
	before := countCustomers(t, store, orgA)

	winner, err := store.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer winner.Rollback(ctx)
	if _, err := winner.Exec(ctx, `SELECT id FROM projects WHERE id=$1 FOR UPDATE`, inlineUpdateProjectID); err != nil {
		t.Fatal(err)
	}
	if _, err := winner.Exec(ctx, `UPDATE projects SET name='Cocina modificada', notes='B', updated_at=clock_timestamp() + interval '1 second' WHERE id=$1`, inlineUpdateProjectID); err != nil {
		t.Fatal(err)
	}

	const applicationName = "project-inline-metadata-race"
	tracingStore := namedInlineUpdateStore(t, store, applicationName)
	result := make(chan error, 1)
	go func() {
		customer := &domain.Customer{Name: "Metadata loser"}
		result <- tracingStore.UpdateProjectWithInlineCustomer(scoped(ctx, orgA), inlineUpdateProjectID, payload, customer, inlineUpdateBaseCust, payload.UpdatedAt)
	}()
	waitForOrganizationLockWait(t, store.Pool, applicationName)
	if err := winner.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := awaitInlineUpdateResult(t, result); !errors.Is(err, storage.ErrProjectConcurrentUpdate) {
		t.Fatalf("inline update error = %v, want concurrent conflict after metadata winner", err)
	}

	var name, notes, customerID string
	if err := store.Pool.QueryRow(ctx, `SELECT name, notes, customer_id FROM projects WHERE id=$1`, inlineUpdateProjectID).Scan(&name, &notes, &customerID); err != nil {
		t.Fatal(err)
	}
	if name != "Cocina modificada" || notes != "B" || customerID != inlineUpdateBaseCust {
		t.Fatalf("winner state name/notes/customer = %q/%q/%q", name, notes, customerID)
	}
	if got := countCustomers(t, store, orgA); got != before {
		t.Fatalf("customers = %d, want %d (stale write must fail before insert)", got, before)
	}
}

// Tenant isolation (proof I): another org's caller cannot run the transition
// on this project — neutral not-found, nothing persisted on either side.
func TestProjectInlineUpdate_TenantIsolation_CrossOrgUpdateRejected(t *testing.T) {
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()
	beforeA := countCustomers(t, store, orgA)
	beforeB := countCustomers(t, store, orgB)

	payload, err := store.GetProjectByID(scoped(ctx, orgA), inlineUpdateProjectID)
	if err != nil {
		t.Fatalf("seeded project: %v", err)
	}
	payload.CustomerID = ""
	customer := domain.Customer{Name: "Intrusa"}
	err = store.UpdateProjectWithInlineCustomer(scoped(ctx, orgB), inlineUpdateProjectID, payload, &customer, inlineUpdateBaseCust, payload.UpdatedAt)
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("error = %v, want the neutral not-found (org B cannot touch org A's project)", err)
	}
	if got := countCustomers(t, store, orgA); got != beforeA {
		t.Fatalf("org A customers = %d, want %d", got, beforeA)
	}
	if got := countCustomers(t, store, orgB); got != beforeB {
		t.Fatalf("org B customers = %d, want %d (nothing minted in the caller org either)", got, beforeB)
	}
	if got := readProjectCustomerID(t, store, inlineUpdateProjectID); got != inlineUpdateBaseCust {
		t.Fatalf("customer_id = %q, want the seeded assignment untouched", got)
	}
}

// Existing-customer path (proof D) stays byte-identical: the plain update
// never creates customers and keeps the selected assignment.
func TestProjectInlineUpdate_ExistingCustomerPathUnchanged(t *testing.T) {
	store, orgA, _ := isolationSetup(t)
	ctx := context.Background()
	before := countCustomers(t, store, orgA)

	payload, err := store.GetProjectByID(scoped(ctx, orgA), inlineUpdateProjectID)
	if err != nil {
		t.Fatalf("seeded project: %v", err)
	}
	payload.Name = "Con cliente existente"
	payload.CustomerID = inlineUpdateBaseCust
	if err := store.UpdateProject(scoped(ctx, orgA), inlineUpdateProjectID, payload); err != nil {
		t.Fatalf("plain update with existing customer: %v", err)
	}
	if got := countCustomers(t, store, orgA); got != before {
		t.Fatalf("customers = %d, want %d (existing path never creates customers)", got, before)
	}
	if got := readProjectCustomerID(t, store, inlineUpdateProjectID); got != inlineUpdateBaseCust {
		t.Fatalf("customer_id = %q, want the selected customer untouched", got)
	}
}
