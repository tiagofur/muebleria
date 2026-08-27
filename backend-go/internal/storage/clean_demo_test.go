package storage_test

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

// F181: clean-demo-data debe vaciar TODO el rastro del seed y, a la vez,
// conservar cualquier row demo que data real (obras/plantillas del usuario)
// referencie. El paso final (re-seed) es el guard de deriva de las listas de
// códigos: si el seed agrega un código y clean_demo.go no, la base no queda
// vacía y SeedCatalog se salta el seed completo → el test explota.
func TestCleanDemoData(t *testing.T) {
	pool := multiOrgFreshDB(t)
	store := &storage.PostgresStore{Pool: pool}
	if err := store.RunMigrations(context.Background()); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)
	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}

	count := func(sql string, args ...any) int {
		t.Helper()
		var n int
		if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
			t.Fatalf("count %q: %v", sql, err)
		}
		return n
	}
	demoBoards := `SELECT COUNT(*) FROM material_boards WHERE code LIKE 'TAB-%'`
	demoModules := `SELECT COUNT(*) FROM modules WHERE code LIKE 'MOD-%'`

	if n := count(demoBoards); n != 3 {
		t.Fatalf("fixture: esperaba 3 tableros demo del seed, hay %d", n)
	}

	// --- dry-run: reporta pero no toca la base -----------------------------
	dry, err := store.CleanDemoData(ctx, storage.InitialOrganizationID, false)
	if err != nil {
		t.Fatalf("clean dry-run: %v", err)
	}
	if dry.Deleted["material_boards"] != 3 || dry.Deleted["modules"] != 5 {
		t.Fatalf("dry-run: report %+v (quería boards=3, modules=5)", dry.Deleted)
	}
	if n := count(demoBoards); n != 3 {
		t.Fatalf("dry-run modificó la base: quedan %d tableros demo (quería 3 — sin cambios)", n)
	}

	// --- apply: borra todo el rastro del seed --------------------------------
	applied, err := store.CleanDemoData(ctx, storage.InitialOrganizationID, true)
	if err != nil {
		t.Fatalf("clean apply: %v", err)
	}
	for _, check := range []struct{ name, sql string }{
		{"tableros demo", demoBoards},
		{"cantos demo", `SELECT COUNT(*) FROM edge_bands WHERE code LIKE 'CAN-%'`},
		{"herrajes demo", `SELECT COUNT(*) FROM hardwares WHERE code LIKE 'HER-%'`},
		{"módulos demo", demoModules},
		{"estructuras demo", `SELECT COUNT(*) FROM structures WHERE code LIKE 'EST-COMP%'`},
		{"componentes demo", `SELECT COUNT(*) FROM components WHERE code LIKE 'COM-%'`},
		{"grupos de opciones demo", `SELECT COUNT(*) FROM option_groups`},
		{"clientes demo", `SELECT COUNT(*) FROM customers WHERE name IN ('Cliente Plantilla','Cliente Demo')`},
		{"obra demo", `SELECT COUNT(*) FROM projects WHERE name = 'Demo plantilla'`},
		{"template demo", `SELECT COUNT(*) FROM project_templates WHERE name = 'Cocina estándar 3 m'`},
	} {
		if n := count(check.sql); n != 0 {
			t.Fatalf("tras apply quedan %d rows de: %s", n, check.name)
		}
	}
	if len(applied.Skipped) != 0 {
		t.Fatalf("sin data real no debería haber skips, hubo: %v", applied.Skipped)
	}

	// --- re-seed sobre la base limpia (guard de deriva de listas) -----------
	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("re-seed: %v", err)
	}
	if n := count(demoBoards); n != 3 {
		t.Fatalf("re-seed: esperaba 3 tableros demo de vuelta, hay %d — la limpieza dejó rows que bloquean el seed (deriva de listas seed↔clean)", n)
	}

	// --- protección: obra real referencing módulo/tablero demo ---------------
	var modGab, boardArauco string
	if err := pool.QueryRow(ctx, `SELECT id FROM modules WHERE code = 'MOD-GAB-01'`).Scan(&modGab); err != nil {
		t.Fatalf("module MOD-GAB-01: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT id FROM material_boards WHERE code = 'TAB-ARA-BLA'`).Scan(&boardArauco); err != nil {
		t.Fatalf("board TAB-ARA-BLA: %v", err)
	}
	q := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("setup: %v", err)
		}
	}
	q(`INSERT INTO customers (id, organization_id, name, active) VALUES ('c0000000-0000-0000-0000-0000000000a1', $1, 'Cliente Real', true)`, storage.InitialOrganizationID)
	q(`INSERT INTO projects (id, organization_id, name, customer_id, currency, margin_factor, labor_fixed_cost, status)
	   VALUES ('c0000000-0000-0000-0000-0000000000b1', $1, 'Obra Real', 'c0000000-0000-0000-0000-0000000000a1', 'MXN', 1.35, 0, 'draft')`, storage.InitialOrganizationID)
	q(`INSERT INTO project_items (id, organization_id, project_id, module_id, quantity)
	   VALUES ('c0000000-0000-0000-0000-0000000000c1', $1, 'c0000000-0000-0000-0000-0000000000b1', $2, 2)`, storage.InitialOrganizationID, modGab)
	q(`INSERT INTO project_item_choices (organization_id, project_item_id, option_group_code, choice_entity_id)
	   VALUES ($1, 'c0000000-0000-0000-0000-0000000000c1', 'INTERIOR', $2)`, storage.InitialOrganizationID, boardArauco)

	protected, err := store.CleanDemoData(ctx, storage.InitialOrganizationID, true)
	if err != nil {
		t.Fatalf("clean con obra real: %v", err)
	}

	// La obra real queda intacta…
	if n := count(`SELECT COUNT(*) FROM projects WHERE name = 'Obra Real'`); n != 1 {
		t.Fatalf("obra real afectada por la limpieza: %d", n)
	}
	if n := count(`SELECT COUNT(*) FROM customers WHERE name = 'Cliente Real'`); n != 1 {
		t.Fatalf("cliente real afectado por la limpieza: %d", n)
	}
	// …y lo demo que usa sobrevive, reportado como skip.
	if n := count(`SELECT COUNT(*) FROM modules WHERE id = $1`, modGab); n != 1 {
		t.Fatal("módulo demo MOD-GAB-01 usado por una obra real fue borrado — debía conservarse")
	}
	if n := count(`SELECT COUNT(*) FROM material_boards WHERE id = $1`, boardArauco); n != 1 {
		t.Fatal("tablero demo TAB-ARA-BLA elegido por una obra real fue borrado — debía conservarse")
	}
	if len(protected.Skipped) == 0 {
		t.Fatal("esperaba skips reportando los rows conservados por referencias reales")
	}
	// El resto del seed demo sí se fue.
	if n := count(`SELECT COUNT(*) FROM projects WHERE name = 'Demo plantilla'`); n != 0 {
		t.Fatal("obra demo sobrevivió teniendo obra real en la base")
	}
	if n := count(`SELECT COUNT(*) FROM customers WHERE name IN ('Cliente Plantilla','Cliente Demo')`); n != 0 {
		t.Fatal("clientes demo sobrevivieron sin referencias")
	}
}
