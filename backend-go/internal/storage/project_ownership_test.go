package storage_test

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// F173 / #327: Project Ownership and multi-organization cooperation.
// Store/Showroom organizations (sales) and Workshop/Factory organizations
// (manufacturing) can share project access safely without leaking other
// organization data.
func TestProjectOwnership_SplitSalesAndManufacturing(t *testing.T) {
	store, orgSales, orgMfg := isolationSetup(t)
	ctx := context.Background()

	// Third organization (unrelated third party)
	const orgThird = "aaaaaaaa-0000-0000-0000-00000000000c"
	if _, err := store.Pool.Exec(ctx,
		`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Taller Gamma', 'taller-gamma')`, orgThird); err != nil {
		t.Fatalf("create org Gamma: %v", err)
	}

	// Module in orgSales catalog
	const modID = "a1000000-0000-0000-0000-00000000000a"
	if _, err := store.Pool.Exec(ctx,
		`INSERT INTO modules (id, code, name, organization_id) VALUES ($1, 'MOD-1', 'Módulo Base', $2)`, modID, orgSales); err != nil {
		t.Fatalf("create module: %v", err)
	}

	const itemID = "d1000000-0000-0000-0000-000000000001"

	// Create project in Store Org (orgSales) with Workshop Org (orgMfg) as manufacturing_organization_id
	sharedProject := domain.Project{
		ID:                          "c2000000-0000-0000-0000-000000000099",
		Name:                        "Cocina Compartida Showroom + Fábrica",
		CustomerID:                  "c1000000-0000-0000-0000-00000000000a",
		Currency:                    "MXN",
		MarginFactor:                1.35,
		LaborFixedCost:              500,
		Status:                      domain.StatusDraft,
		SalesOrganizationID:         orgSales,
		ManufacturingOrganizationID: orgMfg,
		Items: []domain.ProjectItem{
			{
				ID:       itemID,
				ModuleID: modID,
				Quantity: 2,
			},
		},
	}

	// Create in orgSales
	if err := store.CreateProject(scoped(ctx, orgSales), &sharedProject); err != nil {
		t.Fatalf("CreateProject in sales org: %v", err)
	}

	// 1. Sales Org can read the project
	pSales, err := store.GetProjectByID(scoped(ctx, orgSales), sharedProject.ID)
	if err != nil {
		t.Fatalf("sales org must be able to read shared project: %v", err)
	}
	if pSales.SalesOrganizationID != orgSales || pSales.ManufacturingOrganizationID != orgMfg {
		t.Fatalf("unexpected org IDs in sales view: sales=%q, mfg=%q", pSales.SalesOrganizationID, pSales.ManufacturingOrganizationID)
	}

	// 2. Manufacturing Org can also read the project
	pMfg, err := store.GetProjectByID(scoped(ctx, orgMfg), sharedProject.ID)
	if err != nil {
		t.Fatalf("mfg org must be able to read shared project: %v", err)
	}
	if pMfg.ID != sharedProject.ID {
		t.Fatalf("mfg org got project ID %s, want %s", pMfg.ID, sharedProject.ID)
	}
	if len(pMfg.Items) != 1 || pMfg.Items[0].ID != itemID {
		t.Fatalf("mfg org must see project line items, got %d items", len(pMfg.Items))
	}

	// 3. Both orgs see it in ListProjects
	listSales, err := store.ListProjects(scoped(ctx, orgSales))
	if err != nil {
		t.Fatalf("ListProjects sales: %v", err)
	}
	if !projectListHas(listSales, sharedProject.ID) {
		t.Fatalf("sales org must list shared project")
	}

	listMfg, err := store.ListProjects(scoped(ctx, orgMfg))
	if err != nil {
		t.Fatalf("ListProjects mfg: %v", err)
	}
	if !projectListHas(listMfg, sharedProject.ID) {
		t.Fatalf("mfg org must list shared project")
	}

	// 4. Third unrelated org CANNOT see the project (anti-leakage)
	if _, err := store.GetProjectByID(scoped(ctx, orgThird), sharedProject.ID); err == nil {
		t.Fatal("unrelated org Gamma must NOT be able to read shared project")
	}
	listThird, err := store.ListProjects(scoped(ctx, orgThird))
	if err != nil {
		t.Fatalf("ListProjects third: %v", err)
	}
	if projectListHas(listThird, sharedProject.ID) {
		t.Fatal("unrelated org Gamma must NOT list shared project")
	}

	// 5. Manufacturing Org can update project notes / execution details
	pMfg.Notes = "Fabricación iniciada en corte CNC"
	if err := store.UpdateProject(scoped(ctx, orgMfg), pMfg.ID, pMfg); err != nil {
		t.Fatalf("mfg org must be able to update shared project: %v", err)
	}

	updatedSales, err := store.GetProjectByID(scoped(ctx, orgSales), sharedProject.ID)
	if err != nil {
		t.Fatalf("sales re-read: %v", err)
	}
	if updatedSales.Notes != "Fabricación iniciada en corte CNC" {
		t.Fatalf("sales org must see updated notes, got %q", updatedSales.Notes)
	}

	// 6. Delete restricted to sales/owning org
	if err := store.DeleteProject(scoped(ctx, orgMfg), sharedProject.ID); err == nil {
		// Mfg is not sales or owning organization (owning is orgSales)
		// Wait, DeleteProject allows (organization_id = $2 OR sales_organization_id = $2)
		// Since orgMfg is neither organization_id nor sales_organization_id, it should fail
		t.Fatal("mfg org should not be able to delete project owned by sales org")
	}

	if err := store.DeleteProject(scoped(ctx, orgSales), sharedProject.ID); err != nil {
		t.Fatalf("sales org must be able to delete its project: %v", err)
	}
}

func projectListHas(list []domain.Project, id string) bool {
	for _, p := range list {
		if p.ID == id {
			return true
		}
	}
	return false
}
