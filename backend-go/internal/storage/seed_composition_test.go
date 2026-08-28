package storage_test

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Pre-demo audit P0-2d: the seed's MOD-GAB-01 was created flat (no
// structure_id, no module_components) while the TS engine only resolves
// composed modules — Demo plantilla's despiece came out empty and its quote
// priced hardware only. This pins the seed composition AND the resolved BOM
// so the gap cannot reopen silently.
func TestSeedDemoProjectResolvesRealBom(t *testing.T) {
	pool := multiOrgFreshDB(t)
	store := &storage.PostgresStore{Pool: pool}
	if err := store.RunMigrations(context.Background()); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)
	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Composition parity with the TS fixture (plantillaDemo struct-gab-01).
	var structID *string
	if err := pool.QueryRow(context.Background(),
		`SELECT structure_id FROM modules WHERE code = 'MOD-GAB-01'`).Scan(&structID); err != nil {
		t.Fatalf("read MOD-GAB-01 structure_id: %v", err)
	}
	if structID == nil || *structID == "" {
		t.Fatal("MOD-GAB-01 sigue flat: structure_id es NULL — el despiece de la Demo plantilla resolvería vacío")
	}

	// The Demo plantilla project must resolve a non-empty BOM through the
	// engine (≥1 board part, no error) — the exact path /calculate uses.
	project, err := store.GetProjectByID(ctx, "a0000009-0000-0000-0000-000000000001")
	if err != nil {
		t.Fatalf("get seed project: %v", err)
	}
	catalog, err := store.GetFullCatalog(ctx)
	if err != nil {
		t.Fatalf("get full catalog: %v", err)
	}
	item := project.Items[0]
	var module *domain.Module
	for i := range catalog.Modules {
		if catalog.Modules[i].ID == item.ModuleID {
			module = &catalog.Modules[i]
			break
		}
	}
	if module == nil {
		t.Fatalf("module %s not in catalog", item.ModuleID)
	}
	bom, err := engine.ResolveBom(*module, item.OptionChoices, catalog, item.MeasurePresetID)
	if err != nil {
		t.Fatalf("ResolveBom for Demo plantilla: %v", err)
	}
	if len(bom.BoardParts) == 0 {
		t.Fatal("Demo plantilla resolvió un despiece vacío — el seed debe componer MOD-GAB-01")
	}
	if len(bom.HardwareLines) == 0 {
		t.Fatal("Demo plantilla resolvió 0 herrajes")
	}
}

// Upgrades must convert an existing flat MOD-GAB-01 too: SeedCatalog on an
// already-seeded database goes through ensurePlinthCatalog, not the full tx.
func TestSeedUpgradeConvertsFlatGab(t *testing.T) {
	pool := multiOrgFreshDB(t)
	store := &storage.PostgresStore{Pool: pool}
	if err := store.RunMigrations(context.Background()); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)

	// Simulate a pre-fix database: full seed, then flatten MOD-GAB-01 back.
	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `
		UPDATE modules SET structure_id = NULL WHERE code = 'MOD-GAB-01';
		DELETE FROM module_components WHERE module_id = (SELECT id FROM modules WHERE code = 'MOD-GAB-01');`); err != nil {
		t.Fatalf("flatten GAB: %v", err)
	}

	// Re-run the seed: it takes the upgrade path (materials exist).
	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("re-seed (upgrade path): %v", err)
	}

	var structID *string
	if err := pool.QueryRow(context.Background(),
		`SELECT structure_id FROM modules WHERE code = 'MOD-GAB-01'`).Scan(&structID); err != nil {
		t.Fatalf("read structure_id: %v", err)
	}
	if structID == nil || *structID == "" {
		t.Fatal("el camino de upgrade no convirtió MOD-GAB-01 a compuesto")
	}
	var links int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM module_components
		WHERE module_id = (SELECT id FROM modules WHERE code = 'MOD-GAB-01')`).Scan(&links); err != nil {
		t.Fatalf("count module_components: %v", err)
	}
	if links < 2 {
		t.Fatalf("MOD-GAB-01 debería tener puerta + entrepaño como module_components, hay %d", links)
	}
}

func TestSeedUpgradeResolvesExistingCodesWithDifferentIDs(t *testing.T) {
	pool := multiOrgFreshDB(t)
	store := &storage.PostgresStore{Pool: pool}
	if err := store.RunMigrations(context.Background()); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)
	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}

	const altStructureID = "b0000007-0000-0000-0000-000000000003"
	const altDoorID = "b0000008-0000-0000-0000-00000000000a"
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(context.Background(), query, args...); err != nil {
			t.Fatalf("prepare partial catalog: %v", err)
		}
	}
	exec(`UPDATE modules SET structure_id = NULL WHERE code = 'MOD-GAB-01'`)
	exec(`DELETE FROM module_components WHERE module_id = (SELECT id FROM modules WHERE code = 'MOD-GAB-01')`)
	exec(`UPDATE structures SET code = 'EST-GAB-OLD' WHERE code = 'EST-GAB-01'`)
	exec(`INSERT INTO structures (id, organization_id, code, name, width_mm, height_mm, depth_mm, notes, active, created_at, updated_at)
		SELECT $1, organization_id, 'EST-GAB-01', name, width_mm, height_mm, depth_mm, notes, active, created_at, updated_at
		FROM structures WHERE code = 'EST-GAB-OLD'`, altStructureID)
	exec(`UPDATE components SET code = 'COM-GAB-PUE-OLD' WHERE code = 'COM-GAB-PUE'`)
	exec(`INSERT INTO components (id, organization_id, code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm,
			length_formula, width_formula, default_edges, option_roles, active, created_at, updated_at)
		SELECT $1, organization_id, 'COM-GAB-PUE', name, placement, geometry_kind, length_mm, width_mm, thickness_mm,
			length_formula, width_formula, default_edges, option_roles, active, created_at, updated_at
		FROM components WHERE code = 'COM-GAB-PUE-OLD'`, altDoorID)

	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("re-seed partial catalog: %v", err)
	}

	var gotStructureID string
	if err := pool.QueryRow(context.Background(),
		`SELECT structure_id FROM modules WHERE code = 'MOD-GAB-01'`).Scan(&gotStructureID); err != nil {
		t.Fatalf("read upgraded structure: %v", err)
	}
	if gotStructureID != altStructureID {
		t.Fatalf("structure_id = %s, want existing code id %s", gotStructureID, altStructureID)
	}
	var gotDoorID string
	if err := pool.QueryRow(context.Background(), `
		SELECT mc.component_id FROM module_components mc
		JOIN components c ON c.id = mc.component_id
		WHERE mc.module_id = (SELECT id FROM modules WHERE code = 'MOD-GAB-01') AND c.code = 'COM-GAB-PUE'`).Scan(&gotDoorID); err != nil {
		t.Fatalf("read upgraded door link: %v", err)
	}
	if gotDoorID != altDoorID {
		t.Fatalf("door component_id = %s, want existing code id %s", gotDoorID, altDoorID)
	}
}

func TestSeedUpgradeDoesNotOverwriteCustomGabComposition(t *testing.T) {
	pool := multiOrgFreshDB(t)
	store := &storage.PostgresStore{Pool: pool}
	if err := store.RunMigrations(context.Background()); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)
	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}

	const customStructureID = "c0000007-0000-0000-0000-000000000001"
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(context.Background(), query, args...); err != nil {
			t.Fatalf("prepare custom composition: %v", err)
		}
	}
	exec(`INSERT INTO structures (id, organization_id, code, name, width_mm, height_mm, depth_mm, notes, active, created_at, updated_at)
		SELECT $1, organization_id, 'EST-GAB-CUSTOM', 'Composición personalizada', width_mm, height_mm, depth_mm, notes, active, created_at, updated_at
		FROM structures WHERE code = 'EST-GAB-01'`, customStructureID)
	exec(`UPDATE modules SET structure_id = $1 WHERE code = 'MOD-GAB-01'`, customStructureID)
	exec(`DELETE FROM module_components WHERE module_id = (SELECT id FROM modules WHERE code = 'MOD-GAB-01')`)
	exec(`INSERT INTO module_components (organization_id, module_id, component_id, quantity, placement_override)
		SELECT m.organization_id, m.id, c.id, 7, 'personalizado'
		FROM modules m CROSS JOIN components c
		WHERE m.code = 'MOD-GAB-01' AND c.code = 'COM-GAB-PUE'`)

	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("re-seed custom composition: %v", err)
	}

	var structureID string
	var links int
	var quantity int
	if err := pool.QueryRow(context.Background(), `
		SELECT structure_id,
			(SELECT COUNT(*) FROM module_components mc WHERE mc.module_id = modules.id),
			(SELECT quantity FROM module_components mc WHERE mc.module_id = modules.id LIMIT 1)
		FROM modules WHERE code = 'MOD-GAB-01'`).Scan(&structureID, &links, &quantity); err != nil {
		t.Fatalf("read custom composition: %v", err)
	}
	if structureID != customStructureID || links != 1 || quantity != 7 {
		t.Fatalf("custom composition changed: structure=%s links=%d quantity=%d", structureID, links, quantity)
	}
}
