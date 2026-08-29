package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

const (
	offboardingTargetUser       = "e1000000-0000-0000-0000-000000000001"
	offboardingTargetMembership = "e2000000-0000-0000-0000-000000000001"
)

func TestMembershipResponsibilityInventory_IsTenantScopedAndClassifiesWork(t *testing.T) {
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()

	seedOffboardingTarget(t, store, orgB)
	seedOffboardingResponsibilities(t, store, orgA, orgB)

	inventory, err := store.GetMembershipResponsibilityInventory(scoped(ctx, orgB), offboardingTargetMembership)
	if err != nil {
		t.Fatalf("GetMembershipResponsibilityInventory: %v", err)
	}
	if inventory.OrganizationID != orgB || inventory.MembershipID != offboardingTargetMembership || inventory.UserID != offboardingTargetUser {
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
	store, _, orgB := isolationSetup(t)
	ctx := context.Background()
	seedOffboardingTarget(t, store, orgB)

	_, err := store.GetMembershipResponsibilityInventory(scoped(ctx, storage.InitialOrganizationID), offboardingTargetMembership)
	if !errors.Is(err, storage.ErrMembershipNotFound) {
		t.Fatalf("foreign membership error = %v, want ErrMembershipNotFound", err)
	}

	_, err = store.GetMembershipResponsibilityInventory(scoped(ctx, orgB), "e2000000-0000-0000-0000-000000000099")
	if !errors.Is(err, storage.ErrMembershipNotFound) {
		t.Fatalf("missing membership error = %v, want ErrMembershipNotFound", err)
	}

	_, err = store.GetMembershipResponsibilityInventory(ctx, offboardingTargetMembership)
	if !errors.Is(err, storage.ErrNoOrgScope) {
		t.Fatalf("unscoped error = %v, want ErrNoOrgScope", err)
	}
}

func seedOffboardingTarget(t *testing.T, store *storage.PostgresStore, orgID string) {
	t.Helper()
	ctx := context.Background()
	if _, err := store.Pool.Exec(ctx, `
		INSERT INTO users (id, email, normalized_email, password_hash, name, account_status)
		VALUES ($1, 'offboarding-target@example.test', 'offboarding-target@example.test', 'x', 'Target', 'active')`, offboardingTargetUser); err != nil {
		t.Fatalf("insert target user: %v", err)
	}
	if _, err := store.Pool.Exec(ctx, `
		INSERT INTO memberships (id, organization_id, user_id, roles, status, joined_at)
		VALUES ($1, $2, $3, '{vendedor}', 'active', NOW())`, offboardingTargetMembership, orgID, offboardingTargetUser); err != nil {
		t.Fatalf("insert target membership: %v", err)
	}
}

func seedOffboardingResponsibilities(t *testing.T, store *storage.PostgresStore, orgA, orgB string) {
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
		if _, err := store.Pool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed responsibility: %v", err)
		}
	}
}
