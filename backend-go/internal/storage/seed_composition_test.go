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
