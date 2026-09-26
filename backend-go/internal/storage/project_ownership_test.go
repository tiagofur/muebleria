package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// F173 / #327: Project Ownership and multi-organization cooperation.
// Store/Showroom organizations (sales) and Workshop/Factory organizations
// (manufacturing) can share project access safely without leaking other
// organization data.
func TestProjectOwnership_SplitSalesAndManufacturing(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	const (
		orgThird         = "aaaaaaaa-0000-0000-0000-00000000000c"
		thirdUser        = "c2000000-0000-0000-0000-000000000001"
		thirdMembership  = "c2000000-0000-0000-0000-000000000002"
		secondCustomerID = "c1000000-0000-0000-0000-0000000000cc"
		sharedProjectID  = "c2000000-0000-0000-0000-000000000099"
	)

	// The shared project and the unrelated third actor are structural fixtures.
	// Every product read, mutation, and authorization assertion below uses the
	// runtime pool through a real tenant transaction.
	migrationPool, err := pgxpool.New(context.Background(), storage.TestMigrationDatabaseURL(t, fixture.store.Pool.Config().ConnConfig.Database))
	if err != nil {
		t.Fatalf("open migration fixture pool: %v", err)
	}
	t.Cleanup(migrationPool.Close)
	for _, seed := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations (id, name, slug, status) VALUES ($1, 'Taller Gamma', 'taller-gamma', 'provisioning')`, []any{orgThird}},
		{`INSERT INTO users (id, email, normalized_email, password_hash, name, account_status) VALUES ($1, 'third@example.test', 'third@example.test', 'x', 'Third actor', 'active')`, []any{thirdUser}},
		{`INSERT INTO memberships (id, organization_id, user_id, roles, status, joined_at) VALUES ($1, $2, $3, '{admin}', 'active', NOW())`, []any{thirdMembership, orgThird, thirdUser}},
		{`UPDATE organizations SET status = 'active', status_reason = NULL WHERE id = $1`, []any{orgThird}},
		{`INSERT INTO customers (id, name, organization_id) VALUES ($1, 'Cliente Alfa Dos', $2)`, []any{secondCustomerID, fixture.orgA}},
		{`INSERT INTO projects (id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id) VALUES ($1, 'Cocina Compartida Showroom + Fábrica', 'c1000000-0000-0000-0000-00000000000a', 'draft', $2, $2, $3)`, []any{sharedProjectID, fixture.orgA, fixture.orgB}},
	} {
		if _, err := migrationPool.Exec(context.Background(), seed.query, seed.args...); err != nil {
			t.Fatalf("seed ownership fixture: %v", err)
		}
	}
	thirdActor := storage.TenantActor{OrganizationID: orgThird, UserID: thirdUser, MembershipID: thirdMembership}

	pFactory := isolationRuntimeValue(t, fixture, fixture.actorB, func(txCtx context.Context) (*domain.Project, error) {
		return fixture.store.GetProjectByID(txCtx, sharedProjectID)
	})
	if pFactory.ID != sharedProjectID {
		t.Fatalf("factory got project ID %s, want %s", pFactory.ID, sharedProjectID)
	}

	// A Factory actor may update execution detail without looking up the
	// unchanged sales-owned customer.
	pFactory.Notes = "Fabricación iniciada en corte CNC"
	if err := isolationRuntimeError(fixture, fixture.actorB, func(txCtx context.Context) error {
		return fixture.store.UpdateProject(txCtx, sharedProjectID, pFactory)
	}); err != nil {
		t.Fatalf("factory must update shared project without re-pointing customer: %v", err)
	}
	updatedSales := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
		return fixture.store.GetProjectByID(txCtx, sharedProjectID)
	})
	if updatedSales.Notes != pFactory.Notes {
		t.Fatalf("sales must see factory update, got %q", updatedSales.Notes)
	}

	// Factory access never permits re-pointing a sales-owned customer. The
	// failed transaction rolls back; sales sees the original assignment later.
	pFactory.CustomerID = secondCustomerID
	if err := isolationRuntimeError(fixture, fixture.actorB, func(txCtx context.Context) error {
		return fixture.store.UpdateProject(txCtx, sharedProjectID, pFactory)
	}); !errors.Is(err, storage.ErrCustomerNotFound) {
		t.Fatalf("factory re-point must be neutral customer denial, got %v", err)
	}
	unchangedSales := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
		return fixture.store.GetProjectByID(txCtx, sharedProjectID)
	})
	if unchangedSales.CustomerID != "c1000000-0000-0000-0000-00000000000a" {
		t.Fatalf("factory re-point must roll back, got customer %q", unchangedSales.CustomerID)
	}

	// The owning Sales actor remains able to make the legitimate customer move.
	unchangedSales.CustomerID = secondCustomerID
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error {
		return fixture.store.UpdateProject(txCtx, sharedProjectID, unchangedSales)
	}); err != nil {
		t.Fatalf("sales must re-point to its own customer: %v", err)
	}
	movedSales := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
		return fixture.store.GetProjectByID(txCtx, sharedProjectID)
	})
	if movedSales.CustomerID != secondCustomerID {
		t.Fatalf("sales customer move got %q, want %q", movedSales.CustomerID, secondCustomerID)
	}

	if err := isolationRuntimeError(fixture, thirdActor, func(txCtx context.Context) error {
		_, err := fixture.store.GetProjectByID(txCtx, sharedProjectID)
		return err
	}); err == nil {
		t.Fatal("unrelated third actor must not read shared project")
	}

	if err := isolationRuntimeError(fixture, fixture.actorB, func(txCtx context.Context) error {
		return fixture.store.DeleteProject(txCtx, sharedProjectID)
	}); err == nil {
		t.Fatal("factory actor must not delete sales-owned project")
	}
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error {
		return fixture.store.DeleteProject(txCtx, sharedProjectID)
	}); err != nil {
		t.Fatalf("sales actor must delete its project: %v", err)
	}
}
