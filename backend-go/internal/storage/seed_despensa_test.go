package storage_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1389: the demo seed must offer «Entrepaños» on its despensa exactly like
// the real catalog (MOD-DES v194 binding + COM-ENT-REG v25 formulas) — on a
// fresh seed AND on the upgrade path — without ever grafting the demo row
// onto an authored despensa.

const despensaShelfDescription = "Entrepaño Despensa"

type despensaSeedRows struct {
	moduleID       string
	structureID    *string
	definitions    []domain.FurnitureParameterDefinition
	shelfComponent string
	shelfLinks     int
	shelfQuantity  int
	presets        int
}

func readDespensaSeed(t *testing.T, pool *pgxpool.Pool) despensaSeedRows {
	t.Helper()
	ctx := context.Background()
	var rows despensaSeedRows
	var rawParams []byte
	if err := pool.QueryRow(ctx,
		`SELECT id, structure_id, parameter_definitions FROM modules WHERE code = 'MOD-DES-001'`).
		Scan(&rows.moduleID, &rows.structureID, &rawParams); err != nil {
		t.Fatalf("read MOD-DES-001: %v", err)
	}
	definitions, err := domain.DecodeFurnitureParameterDefinitions(rawParams, domain.FurnitureParameterDefinitionBoundaryPersisted)
	if err != nil {
		t.Fatalf("MOD-DES-001 parameter_definitions no decodifican bajo el contrato persistido: %v", err)
	}
	rows.definitions = definitions
	if err := pool.QueryRow(ctx,
		`SELECT id FROM components WHERE code = 'COM-DES-ENT'`).Scan(&rows.shelfComponent); err != nil {
		t.Fatalf("read COM-DES-ENT: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(MAX(quantity), 0) FROM module_components
		WHERE module_id = $1 AND component_id = $2`, rows.moduleID, rows.shelfComponent).
		Scan(&rows.shelfLinks, &rows.shelfQuantity); err != nil {
		t.Fatalf("count shelf module_components: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM module_presets WHERE module_id = $1`, rows.moduleID).Scan(&rows.presets); err != nil {
		t.Fatalf("count module_presets: %v", err)
	}
	return rows
}

func assertDespensaProvisioned(t *testing.T, pool *pgxpool.Pool) despensaSeedRows {
	t.Helper()
	rows := readDespensaSeed(t, pool)
	if rows.structureID == nil || *rows.structureID == "" {
		t.Fatal("MOD-DES-001 quedó sin cuerpo: structure_id es NULL")
	}
	if len(rows.definitions) != 1 {
		t.Fatalf("MOD-DES-001 debe declarar exactamente el parámetro «Entrepaños», tiene %d", len(rows.definitions))
	}
	def := rows.definitions[0]
	if def.Name != "entrepanos" || def.Type != domain.FurnitureParameterTypeNumber || !def.Integer || !def.Required {
		t.Fatalf("definición inesperada: %+v", def)
	}
	if def.Min == nil || *def.Min != 0 || def.Max == nil || *def.Max != 8 || def.DefaultValue != float64(4) {
		t.Fatalf("rango/default inesperado (quiere 0–8 default 4): min=%v max=%v default=%v", def.Min, def.Max, def.DefaultValue)
	}
	if def.Binding == nil || def.Binding.Kind != domain.FurnitureParameterBindingComponentQuantity ||
		def.Binding.Version != domain.FurnitureParameterBindingVersion || def.Binding.ComponentID != rows.shelfComponent {
		t.Fatalf("el binding debe ser componentQuantity v1 → COM-DES-ENT (%s), es %+v", rows.shelfComponent, def.Binding)
	}
	if rows.shelfLinks != 1 || rows.shelfQuantity != 4 {
		t.Fatalf("la fila de entrepaños debe ser 1 module_component ×4, hay %d links qty %d", rows.shelfLinks, rows.shelfQuantity)
	}
	if rows.presets != 1 {
		t.Fatalf("MOD-DES-001 debe tener 1 preset comercial, tiene %d", rows.presets)
	}
	return rows
}

func despensaCatalogChoices(t *testing.T, catalog domain.Catalog) map[string]string {
	t.Helper()
	choices := map[string]string{}
	for _, m := range catalog.Materials {
		if m.Code == "TAB-ARA-BLA" {
			choices["INTERIOR"] = m.ID
		}
	}
	for _, h := range catalog.Hardware {
		if h.Code == "HER-BIS-CL" {
			choices["BISAGRA"] = h.ID
		}
	}
	if len(choices) != 2 {
		t.Fatalf("el catálogo sembrado no trae TAB-ARA-BLA + HER-BIS-CL: %v", choices)
	}
	return choices
}

func TestSeedDespensaEntrepanosFresh(t *testing.T) {
	store, pool := seedCompositionMigrationStore(t)
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)
	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}
	assertDespensaProvisioned(t, pool)

	// Resolve through the exact path the server uses, over the catalog read
	// under the runtime role (RLS): evaluate → apply bindings → resolveBom.
	runtimeStore, actor := seedCompositionRuntimeStore(t, pool)
	var catalog domain.Catalog
	if err := runtimeStore.WithinTenantTx(storage.WithOrgCtx(context.Background(), actor.OrganizationID), actor, func(txCtx context.Context) error {
		var err error
		catalog, err = runtimeStore.GetFullCatalog(txCtx)
		return err
	}); err != nil {
		t.Fatalf("get full catalog: %v", err)
	}
	var module *domain.Module
	for i := range catalog.Modules {
		if catalog.Modules[i].Code == "MOD-DES-001" {
			module = &catalog.Modules[i]
		}
	}
	if module == nil {
		t.Fatal("MOD-DES-001 no aparece en el catálogo leído bajo el rol runtime")
	}
	if len(module.Presets) != 1 {
		t.Fatalf("MOD-DES-001 debe exponer 1 preset, expone %d", len(module.Presets))
	}
	choices := despensaCatalogChoices(t, catalog)

	// No value → the declared default (4) drives the row.
	defaults, issues, err := domain.EvaluateFurnitureParameters(module.ParameterDefinitions, map[string]any{})
	if err != nil || len(issues) != 0 {
		t.Fatalf("defaults: err=%v issues=%v", err, issues)
	}
	if defaults["entrepanos"] != float64(4) {
		t.Fatalf("default entrepanos = %v, want 4", defaults["entrepanos"])
	}

	for _, count := range []int{0, 4, 8} {
		values, issues, err := domain.EvaluateFurnitureParameters(module.ParameterDefinitions, map[string]any{"entrepanos": float64(count)})
		if err != nil || len(issues) != 0 {
			t.Fatalf("entrepanos=%d: err=%v issues=%v", count, err, issues)
		}
		bound := engine.ApplyEvaluatedComponentBindings(*module, values)
		bom, err := engine.ResolveBom(bound, choices, catalog, module.Presets[0].ID)
		if err != nil {
			t.Fatalf("entrepanos=%d: ResolveBom: %v", count, err)
		}
		var shelves, body int
		for _, part := range bom.BoardParts {
			if part.Description != despensaShelfDescription {
				body++
				continue
			}
			shelves++
			// COM-ENT-REG mirror over ARAUCO BLANCO (T = 15): PW-2T / PD-5-T-35.
			if part.LengthMm != 570 || part.WidthMm != 545 || part.ThicknessMm != 15 || part.Quantity != 1 {
				t.Fatalf("entrepanos=%d: pieza inesperada %+v", count, part)
			}
		}
		if shelves != count {
			t.Fatalf("entrepanos=%d: el despiece trae %d entrepaños", count, shelves)
		}
		if body == 0 {
			t.Fatalf("entrepanos=%d: el cuerpo de la despensa resolvió vacío", count)
		}
	}

	// Out of range is a rejection, never a clamp.
	if _, issues, _ := domain.EvaluateFurnitureParameters(module.ParameterDefinitions, map[string]any{"entrepanos": float64(9)}); len(issues) == 0 {
		t.Fatal("entrepanos=9 debería rechazarse (max 8)")
	}
}

// A demo DB seeded before #1389 never had a despensa in the Go seed at all:
// the upgrade path (SeedCatalog on an already-seeded database) must provision
// the whole set, and running it again must not duplicate anything.
func TestSeedDespensaEntrepanosUpgrade(t *testing.T) {
	store, pool := seedCompositionMigrationStore(t)
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)
	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `
		DELETE FROM module_components WHERE module_id IN (SELECT id FROM modules WHERE code = 'MOD-DES-001');
		DELETE FROM module_presets WHERE module_id IN (SELECT id FROM modules WHERE code = 'MOD-DES-001');
		DELETE FROM hardware_lines WHERE module_id IN (SELECT id FROM modules WHERE code = 'MOD-DES-001');
		DELETE FROM modules WHERE code = 'MOD-DES-001';
		DELETE FROM structure_components WHERE structure_id IN (SELECT id FROM structures WHERE code = 'EST-DES-600');
		DELETE FROM structure_presets WHERE structure_id IN (SELECT id FROM structures WHERE code = 'EST-DES-600');
		DELETE FROM structures WHERE code = 'EST-DES-600';
		DELETE FROM components WHERE code LIKE 'COM-DES-%';`); err != nil {
		t.Fatalf("simulate pre-#1389 demo DB: %v", err)
	}
	var remaining int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM modules WHERE code = 'MOD-DES-001'`).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("la despensa debería haberse borrado: count=%d err=%v", remaining, err)
	}

	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("re-seed (upgrade path): %v", err)
	}
	first := assertDespensaProvisioned(t, pool)

	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("third seed (idempotency): %v", err)
	}
	second := assertDespensaProvisioned(t, pool)
	if first.moduleID != second.moduleID || first.shelfComponent != second.shelfComponent {
		t.Fatalf("re-sembrar cambió identidades: %+v vs %+v", first, second)
	}
	var components, structures int
	if err := pool.QueryRow(context.Background(),
		`SELECT (SELECT COUNT(*) FROM components WHERE code LIKE 'COM-DES-%'), (SELECT COUNT(*) FROM structures WHERE code = 'EST-DES-600')`).
		Scan(&components, &structures); err != nil {
		t.Fatalf("count despensa rows: %v", err)
	}
	if components != 4 || structures != 1 {
		t.Fatalf("re-sembrar duplicó filas: %d componentes COM-DES-* (quiere 4), %d estructuras (quiere 1)", components, structures)
	}
}

// A workshop that authored its own MOD-DES-001 (parameters present) owns its
// composition: the upgrade never grafts the demo parameter or shelf row.
func TestSeedUpgradeDoesNotGraftOntoAuthoredDespensa(t *testing.T) {
	store, pool := seedCompositionMigrationStore(t)
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)
	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}
	authored := `[{"name":"nota_taller","label":"Nota del taller","type":"string","category":"metadata","required":false,"maxLength":64}]`
	if _, err := pool.Exec(context.Background(),
		`UPDATE modules SET parameter_definitions = $1::jsonb WHERE code = 'MOD-DES-001'`, authored); err != nil {
		t.Fatalf("author the despensa: %v", err)
	}
	if _, err := pool.Exec(context.Background(),
		`DELETE FROM module_components WHERE module_id IN (SELECT id FROM modules WHERE code = 'MOD-DES-001')`); err != nil {
		t.Fatalf("drop the authored shelf row: %v", err)
	}

	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("re-seed (upgrade path): %v", err)
	}
	rows := readDespensaSeed(t, pool)
	if len(rows.definitions) != 1 || rows.definitions[0].Name != "nota_taller" {
		t.Fatalf("el upgrade pisó los parámetros autorados: %+v", rows.definitions)
	}
	if rows.shelfLinks != 0 {
		t.Fatalf("el upgrade injertó la fila de entrepaños sobre una despensa autorada (%d links)", rows.shelfLinks)
	}
}
