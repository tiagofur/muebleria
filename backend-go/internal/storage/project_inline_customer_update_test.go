package storage_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
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
	// Seeded by runtimeIsolationSetup: org A draft project + its customer.
	inlineUpdateProjectID = "c2000000-0000-0000-0000-00000000000a"
	inlineUpdateBaseCust  = "c1000000-0000-0000-0000-00000000000a"
)

func readProjectCustomerID(t *testing.T, fixture isolationRuntimeFixture, actor storage.TenantActor, projectID string) string {
	t.Helper()
	var ref *string
	if err := runConnectStoreSQL(t, fixture.store.Pool, actor, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT customer_id FROM projects WHERE id = $1`, projectID).Scan(&ref)
	}); err != nil {
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

func inlineRuntimeError(store *storage.PostgresStore, actor storage.TenantActor, run func(context.Context) error) error {
	return store.WithinTenantTx(storage.WithOrgCtx(context.Background(), actor.OrganizationID), actor, run)
}

func beginInlineRuntimeTx(t *testing.T, store *storage.PostgresStore, actor storage.TenantActor) pgx.Tx {
	t.Helper()
	tx, err := store.Pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(context.Background(), `
		SELECT set_config('app.organization_id', $1, true),
		       set_config('app.user_id', $2, true),
		       set_config('app.membership_id', $3, true),
		       set_config('app.authorized_organization_ids', $1, true)`,
		actor.OrganizationID, actor.UserID, actor.MembershipID); err != nil {
		tx.Rollback(context.Background())
		t.Fatal(err)
	}
	return tx
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
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	current := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
		return store.GetProjectByID(txCtx, inlineUpdateProjectID)
	})
	current.CustomerID = neverPersisted
	err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error {
		return store.UpdateProject(txCtx, inlineUpdateProjectID, current)
	})
	if !errors.Is(err, storage.ErrCustomerNotFound) {
		t.Fatalf("error = %v, want the neutral storage guard (unpersisted customer id)", err)
	}
	if got := readProjectCustomerID(t, fixture, fixture.actorA, inlineUpdateProjectID); got != inlineUpdateBaseCust {
		t.Fatalf("customer_id = %q, want the seeded assignment untouched", got)
	}

	// The DB constraint is the last-resort guard and stays untouched: a direct
	// update (bypassing the store method) still violates the FK.
	sqlErr := runConnectStoreSQL(t, store.Pool, fixture.actorA, func(tx pgx.Tx) error {
		_, err := tx.Exec(context.Background(), `UPDATE projects SET customer_id = $1 WHERE id = $2`, neverPersisted, inlineUpdateProjectID)
		return err
	})
	if sqlErr == nil {
		t.Fatal("raw update with an unpersisted customer must still violate the FK")
	}
	if !strings.Contains(sqlErr.Error(), "projects_customer_id_fkey") && !strings.Contains(sqlErr.Error(), "23503") {
		t.Fatalf("sql error = %v, want the projects_customer_id_fkey violation (SQLSTATE 23503)", sqlErr)
	}
}

func TestProjectInlineUpdate_AtomicUpdateServerOwnedIdentity(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	before := runtimeCustomerCount(t, fixture, fixture.actorA)
	payload := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
		return store.GetProjectByID(txCtx, inlineUpdateProjectID)
	})
	payload.Name, payload.CustomerID = "Cocina editada", ""
	customer := domain.Customer{Name: "Ana López"}
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error {
		return store.UpdateProjectWithInlineCustomer(txCtx, inlineUpdateProjectID, payload, &customer, inlineUpdateBaseCust, payload.UpdatedAt)
	}); err != nil {
		t.Fatalf("UpdateProjectWithInlineCustomer: %v", err)
	}
	if customer.ID == "" {
		t.Fatal("inline customer id must be minted by the server, not the client")
	}
	if payload.CustomerID != customer.ID {
		t.Fatalf("project.customer_id = %q, want the persisted customer id %q", payload.CustomerID, customer.ID)
	}
	if got := readProjectCustomerID(t, fixture, fixture.actorA, inlineUpdateProjectID); got != customer.ID {
		t.Fatalf("projects.customer_id = %q, want %q", got, customer.ID)
	}
	if got := runtimeCustomerCount(t, fixture, fixture.actorA); got != before+1 {
		t.Fatalf("customers = %d, want %d (exactly one new customer)", got, before+1)
	}
	var orgID string
	if err := runConnectStoreSQL(t, store.Pool, fixture.actorA, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT organization_id FROM customers WHERE id = $1`, customer.ID).Scan(&orgID)
	}); err != nil {
		t.Fatalf("read customer org: %v", err)
	}
	if orgID != fixture.orgA {
		t.Fatalf("customer.organization_id = %q, want the project's owning org %q", orgID, fixture.orgA)
	}
	got := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
		return store.GetProjectByID(txCtx, inlineUpdateProjectID)
	})
	if got.CustomerID != customer.ID || got.Name != "Cocina editada" {
		t.Fatalf("GetProjectByID = %+v, want the updated aggregate bound to the new customer", got)
	}
}

func TestProjectInlineUpdate_BaseMismatchFailsExplicitConflict(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	before := runtimeCustomerCount(t, fixture, fixture.actorA)
	payload := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
		return store.GetProjectByID(txCtx, inlineUpdateProjectID)
	})
	payload.CustomerID = ""
	customer := domain.Customer{Name: "Ana López"}
	err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error {
		return store.UpdateProjectWithInlineCustomer(txCtx, inlineUpdateProjectID, payload, &customer, "e7777777-0000-0000-0000-000000000700", payload.UpdatedAt)
	})
	if !errors.Is(err, storage.ErrProjectConcurrentUpdate) {
		t.Fatalf("error = %v, want storage.ErrProjectConcurrentUpdate", err)
	}
	if got := runtimeCustomerCount(t, fixture, fixture.actorA); got != before {
		t.Fatalf("customers = %d, want %d (no customer from the rejected transition)", got, before)
	}
	if got := readProjectCustomerID(t, fixture, fixture.actorA, inlineUpdateProjectID); got != inlineUpdateBaseCust {
		t.Fatalf("customer_id = %q, want the seeded assignment untouched", got)
	}
}

func TestProjectInlineUpdate_UpdateFailureRollsBackCustomer(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	before := runtimeCustomerCount(t, fixture, fixture.actorA)
	payload := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
		return store.GetProjectByID(txCtx, inlineUpdateProjectID)
	})
	payload.CustomerID = ""
	payload.Items = []domain.ProjectItem{{ID: "e3000000-0000-0000-0000-00000000000a", ModuleID: neverPersisted, Quantity: 1}}
	customer := domain.Customer{Name: "Ana López"}
	err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error {
		return store.UpdateProjectWithInlineCustomer(txCtx, inlineUpdateProjectID, payload, &customer, inlineUpdateBaseCust, payload.UpdatedAt)
	})
	if err == nil {
		t.Fatal("the controlled item failure must fail the transition")
	}
	if got := runtimeCustomerCountByName(t, fixture, fixture.actorA, "Ana López"); got != 0 {
		t.Fatalf("orphan customer rows = %d, want 0 (transition rolled back)", got)
	}
	if got := runtimeCustomerCount(t, fixture, fixture.actorA); got != before {
		t.Fatalf("customers = %d, want %d (no residue)", got, before)
	}
	if got := readProjectCustomerID(t, fixture, fixture.actorA, inlineUpdateProjectID); got != inlineUpdateBaseCust {
		t.Fatalf("customer_id = %q, want the original assignment intact", got)
	}
}

func TestProjectInlineUpdate_RetrySameIntentionConverges(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	build := func() (*domain.Project, *domain.Customer) {
		payload := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
			return store.GetProjectByID(txCtx, inlineUpdateProjectID)
		})
		payload.CustomerID = ""
		return payload, &domain.Customer{Name: "Ana López"}
	}
	p1, c1 := build()
	expectedUpdatedAt := p1.UpdatedAt
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error {
		return store.UpdateProjectWithInlineCustomer(txCtx, inlineUpdateProjectID, p1, c1, inlineUpdateBaseCust, expectedUpdatedAt)
	}); err != nil {
		t.Fatalf("first attempt: %v", err)
	}
	p2, c2 := build()
	err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error {
		return store.UpdateProjectWithInlineCustomer(txCtx, inlineUpdateProjectID, p2, c2, inlineUpdateBaseCust, expectedUpdatedAt)
	})
	if !errors.Is(err, storage.ErrProjectConcurrentUpdate) {
		t.Fatalf("replay error = %v, want the explicit conflict (converge, never duplicate)", err)
	}
	if got := runtimeCustomerCountByName(t, fixture, fixture.actorA, "Ana López"); got != 1 {
		t.Fatalf("'Ana López' rows = %d, want exactly 1 (no duplicate from the retry)", got)
	}
	if got := readProjectCustomerID(t, fixture, fixture.actorA, inlineUpdateProjectID); got != c1.ID {
		t.Fatalf("customer_id = %q, want the first committed customer %q", got, c1.ID)
	}
}

func TestProjectInlineUpdate_ConcurrentCompetingUpdatesSerializeExplicitly(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	before := runtimeCustomerCount(t, fixture, fixture.actorA)
	build := func(name string) (*domain.Project, *domain.Customer) {
		payload := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
			return store.GetProjectByID(txCtx, inlineUpdateProjectID)
		})
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
			err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error {
				return store.UpdateProjectWithInlineCustomer(txCtx, inlineUpdateProjectID, p, c, inlineUpdateBaseCust, p.UpdatedAt)
			})
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
	if got := runtimeCustomerCount(t, fixture, fixture.actorA); got != before+1 {
		t.Fatalf("customers = %d, want %d (exactly one — no orphan from the losers)", got, before+1)
	}
	if got := readProjectCustomerID(t, fixture, fixture.actorA, inlineUpdateProjectID); got != winnerCustomer {
		t.Fatalf("customer_id = %q, want the winner's customer %q", got, winnerCustomer)
	}
}

func TestProjectInlineUpdate_LifecycleChangeCommittedWhileWaitingFailsConflict(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	payload := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
		return store.GetProjectByID(txCtx, inlineUpdateProjectID)
	})
	payload.CustomerID = ""
	before := runtimeCustomerCount(t, fixture, fixture.actorA)
	winner := beginInlineRuntimeTx(t, store, fixture.actorA)
	defer winner.Rollback(context.Background())
	if _, err := winner.Exec(context.Background(), `SELECT id FROM projects WHERE id=$1 FOR UPDATE`, inlineUpdateProjectID); err != nil {
		t.Fatal(err)
	}
	if _, err := winner.Exec(context.Background(), `UPDATE projects SET status='quoted', updated_at=clock_timestamp() WHERE id=$1`, inlineUpdateProjectID); err != nil {
		t.Fatal(err)
	}
	const applicationName = "project-inline-lifecycle-race"
	tracingStore := namedInlineUpdateStore(t, store, applicationName)
	result := make(chan error, 1)
	go func() {
		customer := &domain.Customer{Name: "Lifecycle loser"}
		result <- inlineRuntimeError(tracingStore, fixture.actorA, func(txCtx context.Context) error {
			return tracingStore.UpdateProjectWithInlineCustomer(txCtx, inlineUpdateProjectID, payload, customer, inlineUpdateBaseCust, payload.UpdatedAt)
		})
	}()
	waitForOrganizationLockWait(t, store.Pool, applicationName)
	if err := winner.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := awaitInlineUpdateResult(t, result); !errors.Is(err, storage.ErrProjectConcurrentUpdate) {
		t.Fatalf("inline update error = %v, want concurrent conflict after lifecycle winner", err)
	}
	var status, customerID string
	if err := runConnectStoreSQL(t, store.Pool, fixture.actorA, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT status, customer_id FROM projects WHERE id=$1`, inlineUpdateProjectID).Scan(&status, &customerID)
	}); err != nil {
		t.Fatal(err)
	}
	if status != "quoted" || customerID != inlineUpdateBaseCust {
		t.Fatalf("winner state status/customer = %q/%q, want quoted/%q", status, customerID, inlineUpdateBaseCust)
	}
	if got := runtimeCustomerCount(t, fixture, fixture.actorA); got != before {
		t.Fatalf("customers = %d, want %d (loser must not create one)", got, before)
	}
}

func TestProjectInlineUpdate_MetadataChangeWithSameCustomerIsNotOverwritten(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	payload := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
		return store.GetProjectByID(txCtx, inlineUpdateProjectID)
	})
	payload.CustomerID = ""
	before := runtimeCustomerCount(t, fixture, fixture.actorA)
	winner := beginInlineRuntimeTx(t, store, fixture.actorA)
	defer winner.Rollback(context.Background())
	if _, err := winner.Exec(context.Background(), `SELECT id FROM projects WHERE id=$1 FOR UPDATE`, inlineUpdateProjectID); err != nil {
		t.Fatal(err)
	}
	if _, err := winner.Exec(context.Background(), `UPDATE projects SET name='Cocina modificada', notes='B', updated_at=clock_timestamp() + interval '1 second' WHERE id=$1`, inlineUpdateProjectID); err != nil {
		t.Fatal(err)
	}
	const applicationName = "project-inline-metadata-race"
	tracingStore := namedInlineUpdateStore(t, store, applicationName)
	result := make(chan error, 1)
	go func() {
		customer := &domain.Customer{Name: "Metadata loser"}
		result <- inlineRuntimeError(tracingStore, fixture.actorA, func(txCtx context.Context) error {
			return tracingStore.UpdateProjectWithInlineCustomer(txCtx, inlineUpdateProjectID, payload, customer, inlineUpdateBaseCust, payload.UpdatedAt)
		})
	}()
	waitForOrganizationLockWait(t, store.Pool, applicationName)
	if err := winner.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := awaitInlineUpdateResult(t, result); !errors.Is(err, storage.ErrProjectConcurrentUpdate) {
		t.Fatalf("inline update error = %v, want concurrent conflict after metadata winner", err)
	}
	var name, notes, customerID string
	if err := runConnectStoreSQL(t, store.Pool, fixture.actorA, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT name, notes, customer_id FROM projects WHERE id=$1`, inlineUpdateProjectID).Scan(&name, &notes, &customerID)
	}); err != nil {
		t.Fatal(err)
	}
	if name != "Cocina modificada" || notes != "B" || customerID != inlineUpdateBaseCust {
		t.Fatalf("winner state name/notes/customer = %q/%q/%q", name, notes, customerID)
	}
	if got := runtimeCustomerCount(t, fixture, fixture.actorA); got != before {
		t.Fatalf("customers = %d, want %d (stale write must fail before insert)", got, before)
	}
}

func TestProjectInlineUpdate_TenantIsolation_CrossOrgUpdateRejected(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	beforeA, beforeB := runtimeCustomerCount(t, fixture, fixture.actorA), runtimeCustomerCount(t, fixture, fixture.actorB)
	payload := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
		return store.GetProjectByID(txCtx, inlineUpdateProjectID)
	})
	payload.CustomerID = ""
	customer := domain.Customer{Name: "Intrusa"}
	err := isolationRuntimeError(fixture, fixture.actorB, func(txCtx context.Context) error {
		return store.UpdateProjectWithInlineCustomer(txCtx, inlineUpdateProjectID, payload, &customer, inlineUpdateBaseCust, payload.UpdatedAt)
	})
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("error = %v, want the neutral not-found (org B cannot touch org A's project)", err)
	}
	if got := runtimeCustomerCount(t, fixture, fixture.actorA); got != beforeA {
		t.Fatalf("org A customers = %d, want %d", got, beforeA)
	}
	if got := runtimeCustomerCount(t, fixture, fixture.actorB); got != beforeB {
		t.Fatalf("org B customers = %d, want %d (nothing minted in the caller org either)", got, beforeB)
	}
	if got := readProjectCustomerID(t, fixture, fixture.actorA, inlineUpdateProjectID); got != inlineUpdateBaseCust {
		t.Fatalf("customer_id = %q, want the seeded assignment untouched", got)
	}
}

func TestProjectInlineUpdate_ExistingCustomerPathUnchanged(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	before := runtimeCustomerCount(t, fixture, fixture.actorA)
	payload := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
		return store.GetProjectByID(txCtx, inlineUpdateProjectID)
	})
	payload.Name, payload.CustomerID = "Con cliente existente", inlineUpdateBaseCust
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error { return store.UpdateProject(txCtx, inlineUpdateProjectID, payload) }); err != nil {
		t.Fatalf("plain update with existing customer: %v", err)
	}
	if got := runtimeCustomerCount(t, fixture, fixture.actorA); got != before {
		t.Fatalf("customers = %d, want %d (existing path never creates customers)", got, before)
	}
	if got := readProjectCustomerID(t, fixture, fixture.actorA, inlineUpdateProjectID); got != inlineUpdateBaseCust {
		t.Fatalf("customer_id = %q, want the selected customer untouched", got)
	}
}
