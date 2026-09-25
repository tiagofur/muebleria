package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const (
	offboardingTargetUser       = "e1000000-0000-0000-0000-000000000001"
	offboardingTargetMembership = "e2000000-0000-0000-0000-000000000001"
)

func TestMembershipResponsibilityInventory_IsTenantScopedAndClassifiesWork(t *testing.T) {
	fixture := offboardingInventoryRuntimeSetup(t)
	inventory, err := fixture.inventory(fixture.actorB, offboardingTargetMembership)
	if err != nil {
		t.Fatalf("GetMembershipResponsibilityInventory: %v", err)
	}
	if inventory.OrganizationID != fixture.orgB || inventory.MembershipID != offboardingTargetMembership || inventory.UserID != offboardingTargetUser {
		t.Fatalf("unexpected target identity: %#v", inventory)
	}
	if inventory.CustomerOwnershipCount != 1 || inventory.SalesProjectOwnershipCount != 1 || inventory.EngineerAssignmentCount != 1 || inventory.OpenWarrantyAssignmentCount != 1 || inventory.ActiveProductionClaimCount != 1 {
		t.Fatalf("unexpected inventory: %#v", inventory)
	}
	if inventory.TransferRequiredCount() != 4 {
		t.Fatalf("transfer required count = %d, want 4", inventory.TransferRequiredCount())
	}
	if inventory.BlockingCount() != 1 {
		t.Fatalf("blocking count = %d, want 1", inventory.BlockingCount())
	}
}

func TestMembershipResponsibilityInventory_HidesForeignAndMissingMemberships(t *testing.T) {
	fixture := offboardingInventoryRuntimeSetup(t)
	ctx := context.Background()

	_, err := fixture.inventory(fixture.actorA, offboardingTargetMembership)
	if !errors.Is(err, storage.ErrMembershipNotFound) {
		t.Fatalf("foreign membership error = %v, want ErrMembershipNotFound", err)
	}

	_, err = fixture.inventory(fixture.actorB, "e2000000-0000-0000-0000-000000000099")
	if !errors.Is(err, storage.ErrMembershipNotFound) {
		t.Fatalf("missing membership error = %v, want ErrMembershipNotFound", err)
	}

	_, err = fixture.store.GetMembershipResponsibilityInventory(ctx, offboardingTargetMembership)
	if !errors.Is(err, storage.ErrNoOrgScope) {
		t.Fatalf("unscoped error = %v, want ErrNoOrgScope", err)
	}
}

type offboardingInventoryRuntimeFixture struct {
	store  *storage.PostgresStore
	orgB   string
	actorA storage.TenantActor
	actorB storage.TenantActor
}

// offboardingInventoryRuntimeSetup prepares the historical work inventory with
// migration authority, then exposes it only through the real runtime role.
func offboardingInventoryRuntimeSetup(t *testing.T) offboardingInventoryRuntimeFixture {
	t.Helper()
	ctx := context.Background()
	migrationPool := multiOrgFreshMigrationDB(t)
	migrationStore := &storage.PostgresStore{Pool: migrationPool}
	if err := migrationStore.RunMigrations(ctx); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	const (
		orgB         = "aaaaaaaa-0000-0000-0000-00000000000b"
		actorUserA   = "e1000000-0000-0000-0000-00000000000a"
		actorUserB   = "e1000000-0000-0000-0000-00000000000b"
		actorMemberA = "e2000000-0000-0000-0000-00000000000a"
		actorMemberB = "e2000000-0000-0000-0000-00000000000b"
	)
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations (id, name, slug, status) VALUES ($1, 'Offboarding Beta', 'offboarding-beta', 'provisioning')`, []any{orgB}},
		{`INSERT INTO workshop_settings (organization_id, default_currency) VALUES ($1, 'BRL')`, []any{orgB}},
		{`INSERT INTO users (id, email, normalized_email, password_hash, name, account_status) VALUES
			($1, 'offboarding-actor-a@example.test', 'offboarding-actor-a@example.test', 'x', 'Actor A', 'active'),
			($2, 'offboarding-actor-b@example.test', 'offboarding-actor-b@example.test', 'x', 'Actor B', 'active'),
			($3, 'offboarding-target@example.test', 'offboarding-target@example.test', 'x', 'Target', 'active')`, []any{actorUserA, actorUserB, offboardingTargetUser}},
		{`INSERT INTO memberships (id, organization_id, user_id, roles, status, joined_at) VALUES
			($1, $2, $3, '{admin}', 'active', NOW()),
			($4, $5, $6, '{admin}', 'active', NOW()),
			($7, $5, $8, '{vendedor}', 'active', NOW())`, []any{actorMemberA, multiOrgInitialOrgID, actorUserA, actorMemberB, orgB, actorUserB, offboardingTargetMembership, offboardingTargetUser}},
		{`UPDATE organizations SET status='active', status_reason=NULL WHERE id IN ($1, $2)`, []any{multiOrgInitialOrgID, orgB}},
	}
	for _, statement := range statements {
		if _, err := migrationPool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed offboarding inventory fixture: %v", err)
		}
	}
	seedOffboardingResponsibilities(t, migrationPool, multiOrgInitialOrgID, orgB)

	runtimePool, err := pgxpool.New(ctx, storage.TestDatabaseURLForDB(t, migrationPool.Config().ConnConfig.Database))
	if err != nil {
		t.Fatalf("open runtime pool: %v", err)
	}
	t.Cleanup(runtimePool.Close)
	return offboardingInventoryRuntimeFixture{
		store:  &storage.PostgresStore{Pool: runtimePool},
		orgB:   orgB,
		actorA: storage.TenantActor{OrganizationID: multiOrgInitialOrgID, UserID: actorUserA, MembershipID: actorMemberA},
		actorB: storage.TenantActor{OrganizationID: orgB, UserID: actorUserB, MembershipID: actorMemberB},
	}
}

func (f offboardingInventoryRuntimeFixture) inventory(actor storage.TenantActor, membershipID string) (*storage.MembershipResponsibilityInventory, error) {
	var inventory *storage.MembershipResponsibilityInventory
	err := f.store.WithinTenantTx(storage.WithOrgCtx(context.Background(), actor.OrganizationID), actor, func(txCtx context.Context) error {
		var err error
		inventory, err = f.store.GetMembershipResponsibilityInventory(txCtx, membershipID)
		return err
	})
	return inventory, err
}

func seedOffboardingResponsibilities(t *testing.T, pool *pgxpool.Pool, orgA, orgB string) {
	t.Helper()
	ctx := context.Background()
	const (
		customerB = "e3000000-0000-0000-0000-000000000001"
		projectB  = "e4000000-0000-0000-0000-000000000001"
	)
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO customers (id, name, owner_user_id, organization_id) VALUES ($1, 'Owned customer', $2, $3)`, []any{customerB, offboardingTargetUser, orgB}},
		{`INSERT INTO projects (id, name, customer_id, owner_user_id, assigned_engineer_id, status, organization_id, sales_organization_id, manufacturing_organization_id) VALUES ($1, 'Owned project', $2, $3, $3, 'draft', $4, $4, $4)`, []any{projectB, customerB, offboardingTargetUser, orgB}},
		{`INSERT INTO warranty_tickets (id, ticket_number, project_id, customer_id, title, assigned_technician_id, status, organization_id) VALUES ('e5000000-0000-0000-0000-000000000001', 'W-OPEN', $1, $2, 'Open', $3, 'open', $4)`, []any{projectB, customerB, offboardingTargetUser, orgB}},
		{`INSERT INTO warranty_tickets (id, ticket_number, project_id, customer_id, title, assigned_technician_id, status, organization_id) VALUES ('e5000000-0000-0000-0000-000000000002', 'W-DONE', $1, $2, 'Done', $3, 'resolved', $4)`, []any{projectB, customerB, offboardingTargetUser, orgB}},
		{`INSERT INTO production_activities (id, project_id, project_name, item_id, sector, type, operator_id, organization_id) VALUES ('claim-active', $1, 'Owned project', 'item-1', 'cutting', 'claim', $2, $3)`, []any{projectB, offboardingTargetUser, orgB}},
		{`INSERT INTO production_activities (id, project_id, project_name, item_id, sector, type, operator_id, finished_at, organization_id) VALUES ('claim-finished', $1, 'Owned project', 'item-2', 'cutting', 'claim', $2, NOW(), $3)`, []any{projectB, offboardingTargetUser, orgB}},
		{`UPDATE customers SET owner_user_id=$1 WHERE id='c1000000-0000-0000-0000-00000000000a' AND organization_id=$2`, []any{offboardingTargetUser, orgA}},
		{`UPDATE projects SET owner_user_id=$1, assigned_engineer_id=$1 WHERE id='c2000000-0000-0000-0000-00000000000a' AND organization_id=$2`, []any{offboardingTargetUser, orgA}},
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed responsibility: %v", err)
		}
	}
}
