package storage_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// F182 / #421: cross-org isolation for the remaining entity families. The
// original suite (F171) covered customers, projects, boards, settings, user
// directory and connected orgs; F179 added HTTP-level checks. This file pins
// the storage contract for every family that was still untested: stock,
// purchase orders, installation, warranties, internal messages, material
// planning, site survey, picking, project templates, ambient materials and
// ambient categories — plus the WRITE path of the project-scoped mutators
// (quality, part executions) which only had read coverage.
//
// Contract (ADR-0005 "tenant_id is not authorization"): a storage call scoped
// to org X never lists, reads, updates or deletes org Y's rows, and the
// rejection is indistinguishable from "does not exist".

func isolationFamilyActor(t *testing.T, fixture isolationRuntimeFixture, org string) storage.TenantActor {
	t.Helper()
	switch org {
	case fixture.orgA:
		return fixture.actorA
	case fixture.orgB:
		return fixture.actorB
	default:
		t.Fatalf("no runtime actor for organization %s", org)
		return storage.TenantActor{}
	}
}

func isolationFamilyError(t *testing.T, fixture isolationRuntimeFixture, org string, run func(context.Context) error) error {
	t.Helper()
	return isolationRuntimeError(fixture, isolationFamilyActor(t, fixture, org), run)
}

func isolationFamilyValue[T any](t *testing.T, fixture isolationRuntimeFixture, org string, run func(context.Context) (T, error)) T {
	t.Helper()
	return isolationRuntimeValue(t, fixture, isolationFamilyActor(t, fixture, org), run)
}

func isolationFamilySQLValue[T any](t *testing.T, fixture isolationRuntimeFixture, org string, run func(pgx.Tx) (T, error)) T {
	t.Helper()
	var value T
	actor := isolationFamilyActor(t, fixture, org)
	if err := runConnectStoreSQL(t, fixture.store.Pool, actor, func(tx pgx.Tx) error {
		var err error
		value, err = run(tx)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return value
}

const (
	isoProjectA = "c2000000-0000-0000-0000-00000000000a"
	isoProjectB = "c2000000-0000-0000-0000-00000000000b"
	isoBoardA   = "c3000000-0000-0000-0000-00000000000a"
	isoBoardB   = "c3000000-0000-0000-0000-00000000000b"
)

func TestIsolation_Stock(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store, orgA, orgB := fixture.store, fixture.orgA, fixture.orgB

	// Each org tracks its own board with an entrada.
	for _, seed := range []struct{ org, mat string }{{orgA, isoBoardA}, {orgB, isoBoardB}} {
		if err := isolationFamilyError(t, fixture, seed.org, func(txCtx context.Context) error {
			_, err := store.RecordStockMovement(txCtx, domain.StockMovement{Kind: domain.StockKindTableros, MaterialID: seed.mat, Type: domain.StockMovementEntrada, Delta: 10})
			return err
		}); err != nil {
			t.Fatalf("seed entrada for %s: %v", seed.org, err)
		}
	}

	listA := isolationFamilyValue(t, fixture, orgA, func(txCtx context.Context) ([]domain.MaterialStock, error) { return store.ListStock(txCtx) })
	listB := isolationFamilyValue(t, fixture, orgB, func(txCtx context.Context) ([]domain.MaterialStock, error) { return store.ListStock(txCtx) })
	if len(listA) != 1 || listA[0].MaterialID != isoBoardA || listA[0].Quantity != 10 {
		t.Fatalf("org A must see only its balance, got %+v", listA)
	}
	if len(listB) != 1 || listB[0].MaterialID != isoBoardB {
		t.Fatalf("org B must see only its balance, got %+v", listB)
	}

	movA := isolationFamilyValue(t, fixture, orgA, func(txCtx context.Context) (domain.StockMovement, error) {
		return store.RecordStockMovement(txCtx, domain.StockMovement{Kind: domain.StockKindTableros, MaterialID: isoBoardA, Type: domain.StockMovementEntrada, Delta: 2})
	})
	foreignMovement := isolationFamilyValue(t, fixture, orgB, func(txCtx context.Context) (*domain.StockMovement, error) {
		return store.GetStockMovementByID(txCtx, movA.ID)
	})
	if foreignMovement != nil {
		t.Fatalf("org B reading org A's movement must return nil,nil — got %+v", foreignMovement)
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error {
		_, err := store.RecordStockMovement(txCtx, domain.StockMovement{Kind: domain.StockKindTableros, MaterialID: isoBoardA, Type: domain.StockMovementSalida, Delta: -1})
		return err
	}); !errors.Is(err, domain.ErrStockNotTracked) {
		t.Fatalf("cross-org salida must fail with ErrStockNotTracked, got %v", err)
	}
	assertStockQuantity(t, store, fixture.actorA, isoBoardA, 12)

	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error {
		_, err := store.UpsertStockMin(txCtx, domain.StockKindTableros, isoBoardA, 999)
		return err
	}); err != nil {
		t.Fatalf("foreign upsert min: %v", err)
	}
	minByOrg := map[string]float64{}
	for _, actor := range []storage.TenantActor{fixture.actorA, fixture.actorB} {
		if err := runConnectStoreSQL(t, store.Pool, actor, func(tx pgx.Tx) error {
			var min float64
			if err := tx.QueryRow(context.Background(), `SELECT min_stock FROM material_stock WHERE kind = 'tableros' AND material_id = $1 AND organization_id = $2`, isoBoardA, actor.OrganizationID).Scan(&min); err != nil {
				return err
			}
			minByOrg[actor.OrganizationID] = min
			return nil
		}); err != nil {
			t.Fatalf("query stock row: %v", err)
		}
	}
	if minByOrg[orgA] != 0 {
		t.Fatalf("org A's min_stock was mutated by org B's upsert: %v", minByOrg)
	}
	if minByOrg[orgB] != 999 {
		t.Fatalf("org B's upsert must land on its own row: %v", minByOrg)
	}
	assertStockQuantity(t, store, fixture.actorA, isoBoardA, 12)
}

func assertStockQuantity(t *testing.T, store *storage.PostgresStore, actor storage.TenantActor, materialID string, want float64) {
	t.Helper()
	var qty float64
	if err := runConnectStoreSQL(t, store.Pool, actor, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT quantity FROM material_stock WHERE kind = 'tableros' AND material_id = $1 AND organization_id = $2`, materialID, actor.OrganizationID).Scan(&qty)
	}); err != nil {
		t.Fatalf("stock quantity for %s: %v", actor.OrganizationID, err)
	}
	if qty != want {
		t.Fatalf("stock quantity for %s: got %v, want %v", actor.OrganizationID, qty, want)
	}
}

func TestIsolation_PurchaseOrders(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store, orgA, orgB := fixture.store, fixture.orgA, fixture.orgB
	const (
		supA  = "c4100000-0000-0000-0000-00000000000a"
		supB  = "c4100000-0000-0000-0000-00000000000b"
		poAID = "c4200000-0000-0000-0000-00000000000a"
		poBID = "c4200000-0000-0000-0000-00000000000b"
	)
	for _, seed := range []struct{ org, sup, po, mat string }{{orgA, supA, poAID, isoBoardA}, {orgB, supB, poBID, isoBoardB}} {
		if err := isolationFamilyError(t, fixture, seed.org, func(txCtx context.Context) error {
			return store.CreateSupplier(txCtx, domain.Supplier{ID: seed.sup, Name: "Proveedor " + seed.org, Active: true})
		}); err != nil {
			t.Fatalf("seed supplier: %v", err)
		}
		if err := isolationFamilyError(t, fixture, seed.org, func(txCtx context.Context) error {
			return store.CreatePurchaseOrder(txCtx, domain.PurchaseOrder{ID: seed.po, SupplierID: seed.sup, Items: []domain.PurchaseOrderItem{{Kind: domain.StockKindTableros, MaterialID: seed.mat, Quantity: 2}}})
		}); err != nil {
			t.Fatalf("seed PO: %v", err)
		}
	}
	listB := isolationFamilyValue(t, fixture, orgB, func(txCtx context.Context) ([]domain.PurchaseOrder, error) { return store.ListPurchaseOrders(txCtx) })
	for _, po := range listB {
		if po.ID == poAID {
			t.Fatal("org A's PO leaked into org B's list")
		}
	}
	foreign := isolationFamilyValue(t, fixture, orgB, func(txCtx context.Context) (*domain.PurchaseOrder, error) {
		return store.GetPurchaseOrderByID(txCtx, poAID)
	})
	if foreign != nil {
		t.Fatalf("org B reading org A's PO must return nil,nil — got %+v", foreign)
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error { _, err := store.EmitPurchaseOrder(txCtx, poAID); return err }); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("cross-org emit must fail with ErrNoRows, got %v", err)
	}
	status := isolationFamilySQLValue(t, fixture, orgA, func(tx pgx.Tx) (string, error) {
		var v string
		err := tx.QueryRow(context.Background(), `SELECT status FROM purchase_orders WHERE id = $1`, poAID).Scan(&v)
		return v, err
	})
	if status != string(domain.POBorrador) {
		t.Fatalf("org A's PO status mutated by org B's emit: %q", status)
	}
}

func TestIsolation_Warranties(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store, orgA, orgB := fixture.store, fixture.orgA, fixture.orgB
	const (
		ticketA = "c4300000-0000-0000-0000-00000000000a"
		ticketB = "c4300000-0000-0000-0000-00000000000b"
	)
	for _, seed := range []struct{ org, id, project string }{{orgA, ticketA, isoProjectA}, {orgB, ticketB, isoProjectB}} {
		if err := isolationFamilyError(t, fixture, seed.org, func(txCtx context.Context) error {
			return store.CreateWarrantyTicket(txCtx, &domain.WarrantyTicket{ID: seed.id, TicketNumber: "1", ProjectID: seed.project, Title: "Puerta rayada", Category: domain.WarrantyCategoryOther, Priority: domain.WarrantyPriorityNormal, Status: domain.WarrantyStatusOpen, RefabricationPieces: []domain.WarrantyRefabricationPiece{}})
		}); err != nil {
			t.Fatalf("seed warranty: %v", err)
		}
	}
	listAll := isolationFamilyValue(t, fixture, orgB, func(txCtx context.Context) ([]domain.WarrantyTicket, error) {
		return store.ListWarrantyTickets(txCtx, "", "", "")
	})
	for _, tk := range listAll {
		if tk.ID == ticketA {
			t.Fatal("org A's ticket leaked into org B's list")
		}
	}
	listForeign := isolationFamilyValue(t, fixture, orgB, func(txCtx context.Context) ([]domain.WarrantyTicket, error) {
		return store.ListWarrantyTickets(txCtx, isoProjectA, "", "")
	})
	if len(listForeign) != 0 {
		t.Fatalf("org B must see no tickets for org A's project, got %d", len(listForeign))
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error { _, err := store.GetWarrantyTicketByID(txCtx, ticketA); return err }); err == nil {
		t.Fatal("org B reading org A's ticket must fail")
	}
	hacked := &domain.WarrantyTicket{ID: ticketA, TicketNumber: "1", ProjectID: isoProjectA, Title: "HACKED", Category: domain.WarrantyCategoryOther, Priority: domain.WarrantyPriorityNormal, Status: domain.WarrantyStatusOpen, RefabricationPieces: []domain.WarrantyRefabricationPiece{}}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error { return store.UpdateWarrantyTicket(txCtx, hacked) }); err == nil {
		t.Fatal("cross-org warranty update must fail")
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error { return store.DeleteWarrantyTicket(txCtx, ticketA) }); err == nil {
		t.Fatal("cross-org warranty delete must fail")
	}
	title := isolationFamilySQLValue(t, fixture, orgA, func(tx pgx.Tx) (string, error) {
		var v string
		err := tx.QueryRow(context.Background(), `SELECT title FROM warranty_tickets WHERE id=$1`, ticketA).Scan(&v)
		return v, err
	})
	if title != "Puerta rayada" {
		t.Fatalf("org A's ticket was mutated: %q", title)
	}
}

func TestIsolation_InternalMessages(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store, orgA, orgB := fixture.store, fixture.orgA, fixture.orgB
	if err := isolationFamilyError(t, fixture, orgA, func(txCtx context.Context) error {
		return store.CreateProjectInternalMessage(txCtx, &domain.ProjectInternalMessage{ProjectID: isoProjectA, SenderName: "Vendedor Alfa", MessageType: domain.InternalMsgComment, Content: "mensaje interno"})
	}); err != nil {
		t.Fatalf("seed message: %v", err)
	}
	msgsB := isolationFamilyValue(t, fixture, orgB, func(txCtx context.Context) ([]domain.ProjectInternalMessage, error) {
		return store.ListProjectInternalMessages(txCtx, isoProjectA)
	})
	if len(msgsB) != 0 {
		t.Fatalf("org B must not see org A's internal messages, got %d", len(msgsB))
	}
	msgsA := isolationFamilyValue(t, fixture, orgA, func(txCtx context.Context) ([]domain.ProjectInternalMessage, error) {
		return store.ListProjectInternalMessages(txCtx, isoProjectA)
	})
	if len(msgsA) != 1 {
		t.Fatalf("org A must see its own message, got %d", len(msgsA))
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error {
		return store.CreateProjectInternalMessage(txCtx, &domain.ProjectInternalMessage{ProjectID: isoProjectA, SenderName: "Intruso", MessageType: domain.InternalMsgComment, Content: "no debe verse en A"})
	}); err != nil {
		t.Fatalf("foreign message create: %v", err)
	}
	msgsAAfter := isolationFamilyValue(t, fixture, orgA, func(txCtx context.Context) ([]domain.ProjectInternalMessage, error) {
		return store.ListProjectInternalMessages(txCtx, isoProjectA)
	})
	if len(msgsAAfter) != 1 {
		t.Fatalf("org A's conversation changed by org B's write: %d messages", len(msgsAAfter))
	}
}

func TestIsolation_ProjectPicking(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store, orgA, orgB := fixture.store, fixture.orgA, fixture.orgB
	marked := time.Now().UTC()
	if err := isolationFamilyError(t, fixture, orgA, func(txCtx context.Context) error {
		return store.UpsertProjectPicking(txCtx, domain.ProjectPicking{ProjectID: isoProjectA, Material: "Tablero Roble", Status: "completo", MarkedAt: &marked})
	}); err != nil {
		t.Fatalf("seed picking: %v", err)
	}
	picksB := isolationFamilyValue(t, fixture, orgB, func(txCtx context.Context) ([]domain.ProjectPicking, error) { return store.ListAllPicking(txCtx) })
	for _, p := range picksB {
		if p.ProjectID == isoProjectA {
			t.Fatal("org A's picking row leaked into org B's list")
		}
	}
	picksA := isolationFamilyValue(t, fixture, orgA, func(txCtx context.Context) ([]domain.ProjectPicking, error) { return store.ListAllPicking(txCtx) })
	if len(picksA) != 1 || picksA[0].ProjectID != isoProjectA || picksA[0].Status != "completo" {
		t.Fatalf("org A must see its picking row, got %+v", picksA)
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error {
		return store.UpsertProjectPicking(txCtx, domain.ProjectPicking{ProjectID: isoProjectA, Material: "Tablero Roble", Status: "pendiente"})
	}); err != nil {
		t.Fatalf("foreign picking upsert: %v", err)
	}
	statusA := isolationFamilySQLValue(t, fixture, orgA, func(tx pgx.Tx) (string, error) {
		var v string
		err := tx.QueryRow(context.Background(), `SELECT status FROM project_picking WHERE project_id=$1 AND material='Tablero Roble' AND organization_id=$2`, isoProjectA, orgA).Scan(&v)
		return v, err
	})
	if statusA != "completo" {
		t.Fatalf("org A's picking row was mutated by org B's upsert: %q", statusA)
	}
}

func TestIsolation_ProjectTemplates(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store, orgA, orgB := fixture.store, fixture.orgA, fixture.orgB
	const (
		tplA = "c4400000-0000-0000-0000-00000000000a"
		tplB = "c4400000-0000-0000-0000-00000000000b"
	)
	for _, seed := range []struct{ org, id, name string }{{orgA, tplA, "Cocina estándar Alfa"}, {orgB, tplB, "Cocina estándar Beta"}} {
		if err := isolationFamilyError(t, fixture, seed.org, func(txCtx context.Context) error {
			return store.CreateProjectTemplate(txCtx, domain.ProjectTemplate{ID: seed.id, Name: seed.name, Currency: "ARS", MarginFactor: 1.35, Items: []domain.ProjectItem{}})
		}); err != nil {
			t.Fatalf("seed template: %v", err)
		}
	}
	listB := isolationFamilyValue(t, fixture, orgB, func(txCtx context.Context) ([]domain.ProjectTemplate, error) {
		return store.ListProjectTemplates(txCtx)
	})
	for _, tpl := range listB {
		if tpl.ID == tplA {
			t.Fatal("org A's template leaked into org B's list")
		}
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error { _, err := store.GetProjectTemplateByID(txCtx, tplA); return err }); err == nil {
		t.Fatal("org B reading org A's template must fail")
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error {
		return store.UpdateProjectTemplate(txCtx, tplA, domain.ProjectTemplate{Name: "HACKED", Currency: "ARS", Items: []domain.ProjectItem{}})
	}); err == nil {
		t.Fatal("cross-org template update must fail")
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error { return store.DeleteProjectTemplate(txCtx, tplA) }); err == nil {
		t.Fatal("cross-org template delete must fail")
	}
	name := isolationFamilySQLValue(t, fixture, orgA, func(tx pgx.Tx) (string, error) {
		var v string
		err := tx.QueryRow(context.Background(), `SELECT name FROM project_templates WHERE id=$1`, tplA).Scan(&v)
		return v, err
	})
	if name != "Cocina estándar Alfa" {
		t.Fatalf("org A's template was mutated: %q", name)
	}
}

func TestIsolation_AmbientCategories(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store, orgA, orgB := fixture.store, fixture.orgA, fixture.orgB
	const (
		catA = "c4500000-0000-0000-0000-00000000000a"
		catB = "c4500000-0000-0000-0000-00000000000b"
	)
	for _, seed := range []struct{ org, id, name string }{{orgA, catA, "Pisos Alfa"}, {orgB, catB, "Pisos Beta"}} {
		if err := isolationFamilyError(t, fixture, seed.org, func(txCtx context.Context) error {
			return store.CreateAmbientCategory(txCtx, &domain.AmbientCategory{ID: seed.id, Name: seed.name, SortOrder: 1})
		}); err != nil {
			t.Fatalf("seed ambient category: %v", err)
		}
	}
	catsB := isolationFamilyValue(t, fixture, orgB, func(txCtx context.Context) ([]domain.AmbientCategory, error) {
		return store.ListAmbientCategories(txCtx)
	})
	for _, c := range catsB {
		if c.ID == catA {
			t.Fatal("org A's category leaked into org B's list")
		}
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error { _, err := store.GetAmbientCategoryByID(txCtx, catA); return err }); err == nil {
		t.Fatal("org B reading org A's category must fail")
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error {
		return store.UpdateAmbientCategory(txCtx, catA, &domain.AmbientCategory{Name: "HACKED", SortOrder: 2})
	}); err == nil {
		t.Fatal("cross-org category update must fail")
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error { return store.DeleteAmbientCategory(txCtx, catA) }); err != nil {
		t.Fatalf("cross-org category delete must surface an error: %v", err)
	}
	count := isolationFamilySQLValue(t, fixture, orgA, func(tx pgx.Tx) (int, error) {
		var v int
		err := tx.QueryRow(context.Background(), `SELECT COUNT(*) FROM ambient_categories WHERE id=$1`, catA).Scan(&v)
		return v, err
	})
	if count != 1 {
		t.Fatalf("org A's category must survive (count=%d)", count)
	}
}

func TestIsolation_AmbientMaterials(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store, orgA, orgB := fixture.store, fixture.orgA, fixture.orgB
	const (
		matA = "c4600000-0000-0000-0000-00000000000a"
		matB = "c4600000-0000-0000-0000-00000000000b"
	)
	for _, seed := range []struct{ org, id, code string }{{orgA, matA, "AMB-ALFA"}, {orgB, matB, "AMB-BETA"}} {
		if err := isolationFamilyError(t, fixture, seed.org, func(txCtx context.Context) error {
			return store.CreateAmbientMaterial(txCtx, &domain.AmbientMaterial{ID: seed.id, Code: seed.code, Name: "Porcelanato", Active: true, SurfaceType: domain.AmbientSurfaceFloor})
		}); err != nil {
			t.Fatalf("seed ambient material: %v", err)
		}
	}
	matsB := isolationFamilyValue(t, fixture, orgB, func(txCtx context.Context) ([]domain.AmbientMaterial, error) {
		return store.ListAmbientMaterials(txCtx)
	})
	for _, m := range matsB {
		if m.ID == matA {
			t.Fatal("org A's ambient material leaked into org B's list")
		}
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error { _, err := store.GetAmbientMaterialByID(txCtx, matA); return err }); err == nil {
		t.Fatal("org B reading org A's ambient material must fail")
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error { return store.DeactivateAmbientMaterial(txCtx, matA) }); err != nil {
		t.Fatalf("cross-org deactivate should be a silent no-op at storage level: %v", err)
	}
	active := isolationFamilySQLValue(t, fixture, orgA, func(tx pgx.Tx) (bool, error) {
		var v bool
		err := tx.QueryRow(context.Background(), `SELECT active FROM ambient_materials WHERE id=$1`, matA).Scan(&v)
		return v, err
	})
	if !active {
		t.Fatal("org A's material must stay active")
	}
}

func TestIsolation_ProjectMutators(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store, orgA, orgB := fixture.store, fixture.orgA, fixture.orgB

	type mutatorCase struct {
		name     string
		notFound error
		mutate   func(org string, project string) (bool, error)
	}

	notCalled := func(t *testing.T, called bool) {
		t.Helper()
		if called {
			t.Fatal("mutator must not run for a foreign org's project")
		}
	}

	cases := []mutatorCase{
		{
			name:     "quality",
			notFound: storage.ErrQualityProjectNotFound,
			mutate: func(org, project string) (bool, error) {
				called := false
				var err error
				err = isolationFamilyError(t, fixture, org, func(txCtx context.Context) error {
					_, err = store.MutateProjectQuality(txCtx, project, func(snap *domain.QualitySnapshot) (*domain.QualityMutation, error) {
						called = true
						return &domain.QualityMutation{}, nil
					})
					return err
				})
				return called, err
			},
		},
		{
			name:     "part_executions",
			notFound: storage.ErrPartExecutionsNotFound,
			mutate: func(org, project string) (bool, error) {
				called := false
				var err error
				err = isolationFamilyError(t, fixture, org, func(txCtx context.Context) error {
					_, err = store.MutateProjectPartExecutions(txCtx, project, func(snap *domain.PartExecutionsSnapshot) (*domain.PartExecutionsMutation, error) {
						called = true
						return &domain.PartExecutionsMutation{}, nil
					})
					return err
				})
				return called, err
			},
		},
		{
			name:     "installation",
			notFound: storage.ErrInstallationProjectNotFound,
			mutate: func(org, project string) (bool, error) {
				called := false
				var err error
				err = isolationFamilyError(t, fixture, org, func(txCtx context.Context) error {
					_, err = store.MutateProjectInstallation(txCtx, project, func(snap *domain.InstallationSnapshot) (*domain.InstallationMutation, error) {
						called = true
						return &domain.InstallationMutation{}, nil
					})
					return err
				})
				return called, err
			},
		},
		{
			name:     "material_planning",
			notFound: storage.ErrMaterialPlanningProjectNotFound,
			mutate: func(org, project string) (bool, error) {
				called := false
				var err error
				err = isolationFamilyError(t, fixture, org, func(txCtx context.Context) error {
					_, err = store.MutateProjectMaterialPlanning(txCtx, project, func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error) {
						called = true
						return &domain.MaterialPlanningMutation{}, nil
					})
					return err
				})
				return called, err
			},
		},
		{
			name:     "site_survey",
			notFound: storage.ErrSiteSurveyProjectNotFound,
			mutate: func(org, project string) (bool, error) {
				called := false
				var err error
				err = isolationFamilyError(t, fixture, org, func(txCtx context.Context) error {
					_, err = store.MutateProjectSurvey(txCtx, project, func(survey *domain.SiteSurvey) (*domain.SiteSurveyMutation, error) {
						called = true
						return &domain.SiteSurveyMutation{}, nil
					})
					return err
				})
				return called, err
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Foreign org: not-found sentinel, mutator never runs.
			called, err := tc.mutate(orgB, isoProjectA)
			if !errors.Is(err, tc.notFound) {
				t.Fatalf("cross-org mutate must fail with %v, got %v", tc.notFound, err)
			}
			notCalled(t, called)

			// Truly missing project: the exact same sentinel — cross-org is
			// indistinguishable from nonexistent.
			called, err = tc.mutate(orgB, "eeeeeeee-0000-0000-0000-00000000000e")
			if !errors.Is(err, tc.notFound) {
				t.Fatalf("missing-project mutate must fail with %v, got %v", tc.notFound, err)
			}
			notCalled(t, called)

			// Owning org: the mutator runs and the call succeeds.
			called, err = tc.mutate(orgA, isoProjectA)
			if err != nil {
				t.Fatalf("own-org mutate must succeed: %v", err)
			}
			if !called {
				t.Fatal("own-org mutate must reach the mutator")
			}
		})
	}
}
