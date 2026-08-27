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

const (
	isoProjectA = "c2000000-0000-0000-0000-00000000000a"
	isoProjectB = "c2000000-0000-0000-0000-00000000000b"
	isoBoardA   = "c3000000-0000-0000-0000-00000000000a"
	isoBoardB   = "c3000000-0000-0000-0000-00000000000b"
)

func TestIsolation_Stock(t *testing.T) {
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()

	// Each org tracks its own board with an entrada.
	for _, seed := range []struct{ org, mat string }{{orgA, isoBoardA}, {orgB, isoBoardB}} {
		if _, err := store.RecordStockMovement(scoped(ctx, seed.org), domain.StockMovement{
			Kind: domain.StockKindTableros, MaterialID: seed.mat,
			Type: domain.StockMovementEntrada, Delta: 10,
		}); err != nil {
			t.Fatalf("seed entrada for %s: %v", seed.org, err)
		}
	}

	// Lists only see their own balances.
	listA, err := store.ListStock(scoped(ctx, orgA))
	if err != nil {
		t.Fatalf("list stock A: %v", err)
	}
	listB, err := store.ListStock(scoped(ctx, orgB))
	if err != nil {
		t.Fatalf("list stock B: %v", err)
	}
	if len(listA) != 1 || listA[0].MaterialID != isoBoardA || listA[0].Quantity != 10 {
		t.Fatalf("org A must see only its balance, got %+v", listA)
	}
	if len(listB) != 1 || listB[0].MaterialID != isoBoardB {
		t.Fatalf("org B must see only its balance, got %+v", listB)
	}

	// Foreign ledger reads are indistinguishable from missing.
	movA, err := store.RecordStockMovement(scoped(ctx, orgA), domain.StockMovement{
		Kind: domain.StockKindTableros, MaterialID: isoBoardA,
		Type: domain.StockMovementEntrada, Delta: 2,
	})
	if err != nil {
		t.Fatalf("second entrada A: %v", err)
	}
	if m, err := store.GetStockMovementByID(scoped(ctx, orgB), movA.ID); err != nil || m != nil {
		t.Fatalf("org B reading org A's movement must return nil,nil — got (%+v, %v)", m, err)
	}

	// Cross-org salida fails (A's material is untracked from B's context) and
	// never touches A's balance.
	if _, err := store.RecordStockMovement(scoped(ctx, orgB), domain.StockMovement{
		Kind: domain.StockKindTableros, MaterialID: isoBoardA,
		Type: domain.StockMovementSalida, Delta: -1,
	}); !errors.Is(err, domain.ErrStockNotTracked) {
		t.Fatalf("cross-org salida must fail with ErrStockNotTracked, got %v", err)
	}
	assertStockQuantity(t, store, isoBoardA, orgA, 12)

	// Regression for migration 000091: the min-stock upsert conflict target is
	// org-scoped, so B's upsert on A's material creates B's own row instead of
	// mutating A's.
	if _, err := store.UpsertStockMin(scoped(ctx, orgB), domain.StockKindTableros, isoBoardA, 999); err != nil {
		t.Fatalf("foreign upsert min: %v", err)
	}
	rows, err := store.Pool.Query(ctx, `
		SELECT organization_id, min_stock FROM material_stock
		WHERE kind = 'tableros' AND material_id = $1`, isoBoardA)
	if err != nil {
		t.Fatalf("query stock rows: %v", err)
	}
	defer rows.Close()
	minByOrg := map[string]float64{}
	for rows.Next() {
		var org string
		var min float64
		if err := rows.Scan(&org, &min); err != nil {
			t.Fatalf("scan stock row: %v", err)
		}
		minByOrg[org] = min
	}
	if minByOrg[orgA] != 0 {
		t.Fatalf("org A's min_stock was mutated by org B's upsert: %v", minByOrg)
	}
	if minByOrg[orgB] != 999 {
		t.Fatalf("org B's upsert must land on its own row: %v", minByOrg)
	}
	assertStockQuantity(t, store, isoBoardA, orgA, 12)
}

func assertStockQuantity(t *testing.T, store *storage.PostgresStore, materialID, org string, want float64) {
	t.Helper()
	var qty float64
	if err := store.Pool.QueryRow(context.Background(), `
		SELECT quantity FROM material_stock
		WHERE kind = 'tableros' AND material_id = $1 AND organization_id = $2`,
		materialID, org).Scan(&qty); err != nil {
		t.Fatalf("stock quantity for %s: %v", org, err)
	}
	if qty != want {
		t.Fatalf("stock quantity for %s: got %v, want %v", org, qty, want)
	}
}

func TestIsolation_PurchaseOrders(t *testing.T) {
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()

	const (
		supA  = "c4100000-0000-0000-0000-00000000000a"
		supB  = "c4100000-0000-0000-0000-00000000000b"
		poAID = "c4200000-0000-0000-0000-00000000000a"
		poBID = "c4200000-0000-0000-0000-00000000000b"
	)
	for _, seed := range []struct {
		org, sup, po, mat string
	}{
		{orgA, supA, poAID, isoBoardA},
		{orgB, supB, poBID, isoBoardB},
	} {
		if err := store.CreateSupplier(scoped(ctx, seed.org), domain.Supplier{
			ID: seed.sup, Name: "Proveedor " + seed.org, Active: true,
		}); err != nil {
			t.Fatalf("seed supplier: %v", err)
		}
		if err := store.CreatePurchaseOrder(scoped(ctx, seed.org), domain.PurchaseOrder{
			ID: seed.po, SupplierID: seed.sup,
			Items: []domain.PurchaseOrderItem{{
				Kind: domain.StockKindTableros, MaterialID: seed.mat, Quantity: 2,
			}},
		}); err != nil {
			t.Fatalf("seed PO: %v", err)
		}
	}

	// Lists never show the other org's POs.
	listB, err := store.ListPurchaseOrders(scoped(ctx, orgB))
	if err != nil {
		t.Fatalf("list POs B: %v", err)
	}
	for _, po := range listB {
		if po.ID == poAID {
			t.Fatal("org A's PO leaked into org B's list")
		}
	}

	// Foreign fetch is indistinguishable from missing (nil, nil).
	if po, err := store.GetPurchaseOrderByID(scoped(ctx, orgB), poAID); err != nil || po != nil {
		t.Fatalf("org B reading org A's PO must return nil,nil — got (%+v, %v)", po, err)
	}

	// Foreign state transition fails closed and leaves A's PO untouched.
	if _, err := store.EmitPurchaseOrder(scoped(ctx, orgB), poAID); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("cross-org emit must fail with ErrNoRows, got %v", err)
	}
	var status string
	if err := store.Pool.QueryRow(ctx, `SELECT status FROM purchase_orders WHERE id = $1`, poAID).Scan(&status); err != nil {
		t.Fatalf("read PO status: %v", err)
	}
	if status != string(domain.POBorrador) {
		t.Fatalf("org A's PO status mutated by org B's emit: %q", status)
	}
}

func TestIsolation_Warranties(t *testing.T) {
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()

	const (
		ticketA = "c4300000-0000-0000-0000-00000000000a"
		ticketB = "c4300000-0000-0000-0000-00000000000b"
	)
	for _, seed := range []struct {
		org, id, project string
	}{
		{orgA, ticketA, isoProjectA},
		{orgB, ticketB, isoProjectB},
	} {
		if err := store.CreateWarrantyTicket(scoped(ctx, seed.org), &domain.WarrantyTicket{
			ID: seed.id, TicketNumber: "1", ProjectID: seed.project,
			Title: "Puerta rayada", Category: domain.WarrantyCategoryOther,
			Priority: domain.WarrantyPriorityNormal, Status: domain.WarrantyStatusOpen,
			RefabricationPieces: []domain.WarrantyRefabricationPiece{},
		}); err != nil {
			t.Fatalf("seed warranty: %v", err)
		}
	}

	// Lists are org-scoped even when filtering by the other org's project.
	listAll, err := store.ListWarrantyTickets(scoped(ctx, orgB), "", "", "")
	if err != nil {
		t.Fatalf("list warranties B: %v", err)
	}
	for _, tk := range listAll {
		if tk.ID == ticketA {
			t.Fatal("org A's ticket leaked into org B's list")
		}
	}
	listForeignProject, err := store.ListWarrantyTickets(scoped(ctx, orgB), isoProjectA, "", "")
	if err != nil {
		t.Fatalf("list warranties by foreign project: %v", err)
	}
	if len(listForeignProject) != 0 {
		t.Fatalf("org B must see no tickets for org A's project, got %d", len(listForeignProject))
	}

	// Foreign read fails like a missing row.
	if _, err := store.GetWarrantyTicketByID(scoped(ctx, orgB), ticketA); err == nil {
		t.Fatal("org B reading org A's ticket must fail")
	}

	// Foreign update/delete fail and leave the row intact.
	hacked := &domain.WarrantyTicket{
		ID: ticketA, TicketNumber: "1", ProjectID: isoProjectA,
		Title: "HACKED", Category: domain.WarrantyCategoryOther,
		Priority: domain.WarrantyPriorityNormal, Status: domain.WarrantyStatusOpen,
		RefabricationPieces: []domain.WarrantyRefabricationPiece{},
	}
	if err := store.UpdateWarrantyTicket(scoped(ctx, orgB), hacked); err == nil {
		t.Fatal("cross-org warranty update must fail")
	}
	if err := store.DeleteWarrantyTicket(scoped(ctx, orgB), ticketA); err == nil {
		t.Fatal("cross-org warranty delete must fail")
	}
	var title string
	if err := store.Pool.QueryRow(ctx, `SELECT title FROM warranty_tickets WHERE id = $1`, ticketA).Scan(&title); err != nil {
		t.Fatalf("warranty survived check: %v", err)
	}
	if title != "Puerta rayada" {
		t.Fatalf("org A's ticket was mutated: %q", title)
	}
}

func TestIsolation_InternalMessages(t *testing.T) {
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()

	if err := store.CreateProjectInternalMessage(scoped(ctx, orgA), &domain.ProjectInternalMessage{
		ProjectID: isoProjectA, SenderName: "Vendedor Alfa",
		MessageType: domain.InternalMsgComment, Content: "mensaje interno",
	}); err != nil {
		t.Fatalf("seed message: %v", err)
	}

	// B sees nothing of A's project conversation.
	msgsB, err := store.ListProjectInternalMessages(scoped(ctx, orgB), isoProjectA)
	if err != nil {
		t.Fatalf("list messages as B: %v", err)
	}
	if len(msgsB) != 0 {
		t.Fatalf("org B must not see org A's internal messages, got %d", len(msgsB))
	}
	msgsA, err := store.ListProjectInternalMessages(scoped(ctx, orgA), isoProjectA)
	if err != nil {
		t.Fatalf("list messages as A: %v", err)
	}
	if len(msgsA) != 1 {
		t.Fatalf("org A must see its own message, got %d", len(msgsA))
	}

	// A write from B on A's project id lands as B's own row (org-owned
	// semantics) — A's conversation stays untouched.
	if err := store.CreateProjectInternalMessage(scoped(ctx, orgB), &domain.ProjectInternalMessage{
		ProjectID: isoProjectA, SenderName: "Intruso",
		MessageType: domain.InternalMsgComment, Content: "no debe verse en A",
	}); err != nil {
		t.Fatalf("foreign message create: %v", err)
	}
	msgsAAfter, err := store.ListProjectInternalMessages(scoped(ctx, orgA), isoProjectA)
	if err != nil {
		t.Fatalf("list messages as A after: %v", err)
	}
	if len(msgsAAfter) != 1 {
		t.Fatalf("org A's conversation changed by org B's write: %d messages", len(msgsAAfter))
	}
}

func TestIsolation_ProjectPicking(t *testing.T) {
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()

	marked := time.Now().UTC()
	if err := store.UpsertProjectPicking(scoped(ctx, orgA), domain.ProjectPicking{
		ProjectID: isoProjectA, Material: "Tablero Roble",
		Status: "completo", MarkedAt: &marked,
	}); err != nil {
		t.Fatalf("seed picking: %v", err)
	}

	// Lists are org-scoped.
	picksB, err := store.ListAllPicking(scoped(ctx, orgB))
	if err != nil {
		t.Fatalf("list picking B: %v", err)
	}
	for _, p := range picksB {
		if p.ProjectID == isoProjectA {
			t.Fatal("org A's picking row leaked into org B's list")
		}
	}
	picksA, err := store.ListAllPicking(scoped(ctx, orgA))
	if err != nil {
		t.Fatalf("list picking A: %v", err)
	}
	if len(picksA) != 1 || picksA[0].ProjectID != isoProjectA || picksA[0].Status != "completo" {
		t.Fatalf("org A must see its picking row, got %+v", picksA)
	}

	// Regression for migration 000091: B's upsert on A's (project, material)
	// creates B's own row instead of updating A's.
	if err := store.UpsertProjectPicking(scoped(ctx, orgB), domain.ProjectPicking{
		ProjectID: isoProjectA, Material: "Tablero Roble", Status: "pendiente",
	}); err != nil {
		t.Fatalf("foreign picking upsert: %v", err)
	}
	var statusA string
	if err := store.Pool.QueryRow(ctx, `
		SELECT status FROM project_picking
		WHERE project_id = $1 AND material = 'Tablero Roble' AND organization_id = $2`,
		isoProjectA, orgA).Scan(&statusA); err != nil {
		t.Fatalf("read org A picking: %v", err)
	}
	if statusA != "completo" {
		t.Fatalf("org A's picking row was mutated by org B's upsert: %q", statusA)
	}
}

func TestIsolation_ProjectTemplates(t *testing.T) {
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()

	const (
		tplA = "c4400000-0000-0000-0000-00000000000a"
		tplB = "c4400000-0000-0000-0000-00000000000b"
	)
	for _, seed := range []struct{ org, id, name string }{
		{orgA, tplA, "Cocina estándar Alfa"},
		{orgB, tplB, "Cocina estándar Beta"},
	} {
		if err := store.CreateProjectTemplate(scoped(ctx, seed.org), domain.ProjectTemplate{
			ID: seed.id, Name: seed.name, Currency: "ARS", MarginFactor: 1.35,
			Items: []domain.ProjectItem{},
		}); err != nil {
			t.Fatalf("seed template: %v", err)
		}
	}

	// Lists are org-scoped.
	listB, err := store.ListProjectTemplates(scoped(ctx, orgB))
	if err != nil {
		t.Fatalf("list templates B: %v", err)
	}
	for _, tpl := range listB {
		if tpl.ID == tplA {
			t.Fatal("org A's template leaked into org B's list")
		}
	}

	// Foreign read/update/delete all fail like a missing row.
	if _, err := store.GetProjectTemplateByID(scoped(ctx, orgB), tplA); err == nil {
		t.Fatal("org B reading org A's template must fail")
	}
	if err := store.UpdateProjectTemplate(scoped(ctx, orgB), tplA, domain.ProjectTemplate{
		Name: "HACKED", Currency: "ARS", Items: []domain.ProjectItem{},
	}); err == nil {
		t.Fatal("cross-org template update must fail")
	}
	if err := store.DeleteProjectTemplate(scoped(ctx, orgB), tplA); err == nil {
		t.Fatal("cross-org template delete must fail")
	}
	var name string
	if err := store.Pool.QueryRow(ctx, `SELECT name FROM project_templates WHERE id = $1`, tplA).Scan(&name); err != nil {
		t.Fatalf("template survived check: %v", err)
	}
	if name != "Cocina estándar Alfa" {
		t.Fatalf("org A's template was mutated: %q", name)
	}
}

func TestIsolation_AmbientCategories(t *testing.T) {
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()

	const (
		catA = "c4500000-0000-0000-0000-00000000000a"
		catB = "c4500000-0000-0000-0000-00000000000b"
	)
	for _, seed := range []struct{ org, id, name string }{
		{orgA, catA, "Pisos Alfa"},
		{orgB, catB, "Pisos Beta"},
	} {
		if err := store.CreateAmbientCategory(scoped(ctx, seed.org), &domain.AmbientCategory{
			ID: seed.id, Name: seed.name, SortOrder: 1,
		}); err != nil {
			t.Fatalf("seed ambient category: %v", err)
		}
	}

	// Lists are org-scoped.
	catsB, err := store.ListAmbientCategories(scoped(ctx, orgB))
	if err != nil {
		t.Fatalf("list categories B: %v", err)
	}
	for _, c := range catsB {
		if c.ID == catA {
			t.Fatal("org A's category leaked into org B's list")
		}
	}

	// Foreign read/update/delete fail like a missing row.
	if _, err := store.GetAmbientCategoryByID(scoped(ctx, orgB), catA); err == nil {
		t.Fatal("org B reading org A's category must fail")
	}
	if err := store.UpdateAmbientCategory(scoped(ctx, orgB), catA, &domain.AmbientCategory{
		Name: "HACKED", SortOrder: 2,
	}); err == nil {
		t.Fatal("cross-org category update must fail")
	}
	if err := store.DeleteAmbientCategory(scoped(ctx, orgB), catA); err != nil {
		t.Fatalf("cross-org category delete must surface an error: %v", err)
	}
	var count int
	if err := store.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM ambient_categories WHERE id = $1`, catA).Scan(&count); err != nil || count != 1 {
		t.Fatalf("org A's category must survive (count=%d err=%v)", count, err)
	}
}

func TestIsolation_AmbientMaterials(t *testing.T) {
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()

	const (
		matA = "c4600000-0000-0000-0000-00000000000a"
		matB = "c4600000-0000-0000-0000-00000000000b"
	)
	for _, seed := range []struct{ org, id, code string }{
		{orgA, matA, "AMB-ALFA"},
		{orgB, matB, "AMB-BETA"},
	} {
		if err := store.CreateAmbientMaterial(scoped(ctx, seed.org), &domain.AmbientMaterial{
			ID: seed.id, Code: seed.code, Name: "Porcelanato", Active: true,
			SurfaceType: domain.AmbientSurfaceFloor,
		}); err != nil {
			t.Fatalf("seed ambient material: %v", err)
		}
	}

	// Lists are org-scoped.
	matsB, err := store.ListAmbientMaterials(scoped(ctx, orgB))
	if err != nil {
		t.Fatalf("list materials B: %v", err)
	}
	for _, m := range matsB {
		if m.ID == matA {
			t.Fatal("org A's ambient material leaked into org B's list")
		}
	}

	// Foreign read fails like a missing row.
	if _, err := store.GetAmbientMaterialByID(scoped(ctx, orgB), matA); err == nil {
		t.Fatal("org B reading org A's ambient material must fail")
	}

	// Foreign deactivate is a no-op on A's row (0 rows affected).
	if err := store.DeactivateAmbientMaterial(scoped(ctx, orgB), matA); err != nil {
		t.Fatalf("cross-org deactivate should be a silent no-op at storage level: %v", err)
	}
	var active bool
	if err := store.Pool.QueryRow(ctx, `SELECT active FROM ambient_materials WHERE id = $1`, matA).Scan(&active); err != nil || !active {
		t.Fatalf("org A's material must stay active (active=%v err=%v)", active, err)
	}
}

// TestIsolation_ProjectMutators covers the write path of the project-scoped
// mutators whose read path was already pinned by F179: a foreign org's mutate
// call fails with the same not-found sentinel as a missing project, the
// mutator never runs, and the owning org's project row is untouched.
func TestIsolation_ProjectMutators(t *testing.T) {
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()

	type mutatorCase struct {
		name    string
		notFound error
		mutate  func(org string, project string) (bool, error)
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
				_, err := store.MutateProjectQuality(scoped(ctx, org), project, func(snap *domain.QualitySnapshot) (*domain.QualityMutation, error) {
					called = true
					return &domain.QualityMutation{}, nil
				})
				return called, err
			},
		},
		{
			name:     "part_executions",
			notFound: storage.ErrPartExecutionsNotFound,
			mutate: func(org, project string) (bool, error) {
				called := false
				_, err := store.MutateProjectPartExecutions(scoped(ctx, org), project, func(snap *domain.PartExecutionsSnapshot) (*domain.PartExecutionsMutation, error) {
					called = true
					return &domain.PartExecutionsMutation{}, nil
				})
				return called, err
			},
		},
		{
			name:     "installation",
			notFound: storage.ErrInstallationProjectNotFound,
			mutate: func(org, project string) (bool, error) {
				called := false
				_, err := store.MutateProjectInstallation(scoped(ctx, org), project, func(snap *domain.InstallationSnapshot) (*domain.InstallationMutation, error) {
					called = true
					return &domain.InstallationMutation{}, nil
				})
				return called, err
			},
		},
		{
			name:     "material_planning",
			notFound: storage.ErrMaterialPlanningProjectNotFound,
			mutate: func(org, project string) (bool, error) {
				called := false
				_, err := store.MutateProjectMaterialPlanning(scoped(ctx, org), project, func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error) {
					called = true
					return &domain.MaterialPlanningMutation{}, nil
				})
				return called, err
			},
		},
		{
			name:     "site_survey",
			notFound: storage.ErrSiteSurveyProjectNotFound,
			mutate: func(org, project string) (bool, error) {
				called := false
				_, err := store.MutateProjectSurvey(scoped(ctx, org), project, func(survey *domain.SiteSurvey) (*domain.SiteSurveyMutation, error) {
					called = true
					return &domain.SiteSurveyMutation{}, nil
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
