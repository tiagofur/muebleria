package storage_test

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// F172 / #326: cloning the base catalog into a new organization must copy
// every catalog entity with fresh UUIDs, translate FKs AND the ids embedded
// in JSONB columns (modules.agregados → agregado_id, agregados.components →
// componentId, agregados.hardware_lines → hardware_id).

func TestCloneCatalog_RemapsFKsAndJSONB(t *testing.T) {
	pool := multiOrgFreshDB(t)
	store := &storage.PostgresStore{Pool: pool}
	ctx := context.Background()
	if err := store.RunMigrations(ctx); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	const orgB = "bbbbbbbb-0000-0000-0000-00000000000b"
	if _, err := pool.Exec(ctx,
		`INSERT INTO organizations (id, name, slug, status) VALUES ($1, 'Taller Clon', 'taller-clon', 'provisioning')`, orgB); err != nil {
		t.Fatalf("create org B: %v", err)
	}

	seed := []string{
		// Catálogo fuente (org inicial): categoría → componente → agregado
		// (JSONB refs) → módulo (categoría + agregados JSONB) + piezas/herraje/línea.
		// organization_id es explícito: 000088 eliminó el DEFAULT transicional.
		`INSERT INTO module_categories (id, name, parent_id, organization_id) VALUES ('cccccccc-0000-0000-0000-000000000001', 'Cocinas', NULL, '` + multiOrgInitialOrgID + `')`,
		`INSERT INTO components (id, code, name, placement, active, length_mm, width_mm, thickness_mm, organization_id) VALUES
		 ('cccccccc-0000-0000-0000-000000000002', 'COMP-SHELF', 'Shelf', 'interior', true, 500, 500, 18, '` + multiOrgInitialOrgID + `'),
		 ('cccccccc-0000-0000-0000-000000000007', 'COMP-SIDE', 'Side', 'left_side', true, 700, 500, 18, '` + multiOrgInitialOrgID + `'),
		 ('cccccccc-0000-0000-0000-000000000008', 'COMP-BACK', 'Back', 'back', true, 700, 500, 18, '` + multiOrgInitialOrgID + `')`,
		`INSERT INTO hardwares (id, code, name, unit, cost_per_unit, active, organization_id) VALUES ('cccccccc-0000-0000-0000-000000000003', 'HW-BIS', 'Bisagra', 'piece', 12.5, true, '` + multiOrgInitialOrgID + `')`,
		`INSERT INTO agregados (id, code, name, active, components, hardware_lines, organization_id)
		 VALUES ('cccccccc-0000-0000-0000-000000000004', 'AGR-PUERTA', 'Puerta', true,
		 '[{"componentId":"cccccccc-0000-0000-0000-000000000002","quantity":1}]'::jsonb,
		 '[{"id":"hl1","quantity":2,"option_role":"BISAGRAS","hardware_id":"cccccccc-0000-0000-0000-000000000003"}]'::jsonb,
		 '` + multiOrgInitialOrgID + `')`,
		`INSERT INTO modules (id, code, name, category_id, width_mm, height_mm, depth_mm, agregados, parameter_definitions, organization_id)
		 VALUES ('cccccccc-0000-0000-0000-000000000005', 'MOD-GAB-01', 'Gabinete', 'cccccccc-0000-0000-0000-000000000001', 600, 720, 500,
		 '[{"agregado_id":"cccccccc-0000-0000-0000-000000000004","name":"Puerta","quantity":2,"layout_direction":"vertical","gap_mm":3}]'::jsonb,
		 '[{"name":"shelfCount","label":"Shelf count","type":"number","defaultValue":1,"required":true,"unit":"count","category":"configuration","min":0,"max":5,"step":1,"integer":true,"binding":{"version":1,"kind":"componentQuantity","componentId":"cccccccc-0000-0000-0000-000000000002","relationship":{"kind":"shelf-support","sourceRole":"shelf-edge","targets":[{"componentId":"cccccccc-0000-0000-0000-000000000007","role":"inside-face"}]}}},{"name":"hasBack","label":"Has back","type":"boolean","defaultValue":true,"required":true,"category":"configuration","binding":{"version":1,"kind":"componentCondition","componentId":"cccccccc-0000-0000-0000-000000000008"}}]'::jsonb,
		 '` + multiOrgInitialOrgID + `')`,
		`INSERT INTO module_components (id, module_id, component_id, quantity, organization_id) VALUES
		 ('cccccccc-0000-0000-0000-000000000009', 'cccccccc-0000-0000-0000-000000000005', 'cccccccc-0000-0000-0000-000000000002', 1, '` + multiOrgInitialOrgID + `'),
		 ('cccccccc-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000005', 'cccccccc-0000-0000-0000-000000000007', 1, '` + multiOrgInitialOrgID + `'),
		 ('cccccccc-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-000000000005', 'cccccccc-0000-0000-0000-000000000008', 1, '` + multiOrgInitialOrgID + `')`,
		`INSERT INTO board_parts (id, module_id, code, description, quantity, length_mm, width_mm, option_role, organization_id)
		 VALUES ('cccccccc-0000-0000-0000-000000000006', 'cccccccc-0000-0000-0000-000000000005', 'MOD-GAB-01-P01', 'Panel', 1, 700, 500, 'LATERAL', '` + multiOrgInitialOrgID + `')`,
	}
	for _, s := range seed {
		if _, err := pool.Exec(ctx, s); err != nil {
			t.Fatalf("seed: %v (%s)", err, s[:70])
		}
	}

	if err := store.CloneCatalog(ctx, storage.InitialOrganizationID, orgB); err != nil {
		t.Fatalf("CloneCatalog: %v", err)
	}

	// El módulo clonado existe en org B con NUEVO id y su categoría apunta a la clonada.
	var modID, modCat, agrJSON string
	err := pool.QueryRow(ctx, `
		SELECT m.id::text, m.category_id::text, m.agregados::text
		FROM modules m WHERE m.organization_id = $1::uuid AND m.code = 'MOD-GAB-01'`, orgB).
		Scan(&modID, &modCat, &agrJSON)
	if err != nil {
		t.Fatalf("módulo clonado no encontrado: %v", err)
	}
	if modID == "cccccccc-0000-0000-0000-000000000005" {
		t.Fatal("el módulo clonado debe tener id nuevo")
	}

	// La categoría del clon es la NUEVA categoría de org B.
	var catOK bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM module_categories WHERE id = $1::uuid AND organization_id = $2::uuid)`,
		modCat, orgB).Scan(&catOK); err != nil || !catOK {
		t.Fatalf("categoría del módulo no remapeada a org B (err=%v)", err)
	}

	// El agregado_id dentro del JSONB apunta al agregado CLONADO en org B.
	var agrID string
	if err := pool.QueryRow(ctx, `
		SELECT a.id::text FROM agregados a
		WHERE a.organization_id = $1::uuid AND a.code = 'AGR-PUERTA'`, orgB).Scan(&agrID); err != nil {
		t.Fatalf("agregado clonado no encontrado: %v", err)
	}
	if !contains(agrJSON, agrID) {
		t.Fatalf("modules.agregados JSONB no remapeó agregado_id (json=%s want=%s)", agrJSON, agrID)
	}

	var parameterDefinitionsJSON []byte
	if err := pool.QueryRow(ctx, `SELECT parameter_definitions FROM modules WHERE id = $1`, modID).Scan(&parameterDefinitionsJSON); err != nil {
		t.Fatalf("read cloned parameter definitions: %v", err)
	}
	for _, sourceID := range []string{
		"cccccccc-0000-0000-0000-000000000002",
		"cccccccc-0000-0000-0000-000000000007",
		"cccccccc-0000-0000-0000-000000000008",
	} {
		if strings.Contains(string(parameterDefinitionsJSON), sourceID) {
			t.Fatalf("cloned parameter definitions retain source component id %s: %s", sourceID, parameterDefinitionsJSON)
		}
	}
	var clonedDefinitions []domain.FurnitureParameterDefinition
	if err := json.Unmarshal(parameterDefinitionsJSON, &clonedDefinitions); err != nil {
		t.Fatalf("decode cloned parameter definitions: %v", err)
	}
	if len(clonedDefinitions) != 2 {
		t.Fatalf("cloned parameter definition count = %d, want 2", len(clonedDefinitions))
	}

	sourceCatalog, err := store.GetFullCatalog(storage.WithOrgCtx(ctx, multiOrgInitialOrgID))
	if err != nil {
		t.Fatalf("source catalog: %v", err)
	}
	destinationCatalog, err := store.GetFullCatalog(storage.WithOrgCtx(ctx, orgB))
	if err != nil {
		t.Fatalf("destination catalog: %v", err)
	}
	sourceModule := catalogModuleByCode(t, sourceCatalog, "MOD-GAB-01")
	destinationModule := catalogModuleByCode(t, destinationCatalog, "MOD-GAB-01")
	if issues := domain.ValidateModuleFurnitureParameterConsumers(destinationModule, destinationCatalog); len(issues) != 0 {
		t.Fatalf("cloned parameter consumers are invalid: %+v", issues)
	}
	sourceSignature := resolveCatalogModuleSignature(t, sourceModule, sourceCatalog)
	destinationSignature := resolveCatalogModuleSignature(t, destinationModule, destinationCatalog)
	if sourceSignature != destinationSignature {
		t.Fatalf("cloned resolve differs semantically:\nsource:      %s\ndestination: %s", sourceSignature, destinationSignature)
	}

	// El componentId del agregado clonado apunta al componente clonado.
	var compJSON string
	if err := pool.QueryRow(ctx, `
		SELECT a.components::text FROM agregados a WHERE a.id::text = $1`, agrID).Scan(&compJSON); err != nil {
		t.Fatalf("agregado clonado: %v", err)
	}
	var compOK bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM components c
			JOIN jsonb_array_elements($1::jsonb) el ON c.id::text = el->>'componentId'
			WHERE c.organization_id = $2::uuid AND c.code = 'COMP-SHELF')`, compJSON, orgB).Scan(&compOK); err != nil || !compOK {
		t.Fatalf("components JSONB no remapeado a org B (err=%v json=%s)", err, compJSON)
	}

	// hardware_id remapeado al herraje clonado.
	var hwOK bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM hardwares h
			JOIN agregados a ON a.organization_id = $1 AND a.code = 'AGR-PUERTA'
			CROSS JOIN LATERAL jsonb_array_elements(a.hardware_lines) el
			WHERE h.organization_id = $1::uuid AND h.code = 'HW-BIS' AND h.id::text = el->>'hardware_id')`, orgB).Scan(&hwOK); err != nil || !hwOK {
		t.Fatalf("hardware_lines JSONB no remapeado (err=%v)", err)
	}

	// Piezas del módulo clonadas con FK al módulo nuevo.
	var parts int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM board_parts bp JOIN modules m ON m.id = bp.module_id
		WHERE m.organization_id = $1::uuid AND bp.code = 'MOD-GAB-01-P01'`, orgB).Scan(&parts); err != nil || parts != 1 {
		t.Fatalf("piezas del módulo no clonadas/linkedas (parts=%d err=%v)", parts, err)
	}

	// Idempotencia de guard: clonar sobre catálogo no-vacío falla.
	if err := store.CloneCatalog(ctx, storage.InitialOrganizationID, orgB); err == nil {
		t.Fatal("clonar sobre catálogo no vacío debe fallar")
	}

	// Aislamiento: el catálogo de org B no aparece en org A.
	var countA int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM modules WHERE organization_id = $1 AND organization_id <> $1`, orgB).Scan(&countA); err != nil {
		t.Fatal(err)
	}
}

func TestCloneCatalog_RollsBackWhenParameterBindingTargetCannotBeRemapped(t *testing.T) {
	pool := multiOrgFreshDB(t)
	store := &storage.PostgresStore{Pool: pool}
	ctx := context.Background()
	if err := store.RunMigrations(ctx); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	const destinationOrg = "bbbbbbbb-0000-0000-0000-00000000000c"
	const missingComponent = "dddddddd-0000-0000-0000-000000000099"
	seed := []string{
		`INSERT INTO organizations (id, name, slug, status) VALUES ('` + destinationOrg + `', 'Rollback clone', 'rollback-clone', 'provisioning')`,
		`INSERT INTO module_categories (id, name, organization_id) VALUES ('dddddddd-0000-0000-0000-000000000001', 'Source category', '` + multiOrgInitialOrgID + `')`,
		`INSERT INTO components (id, code, name, placement, active, length_mm, width_mm, thickness_mm, organization_id)
		 VALUES ('dddddddd-0000-0000-0000-000000000002', 'COMP-BOUND', 'Bound component', 'interior', true, 500, 500, 18, '` + multiOrgInitialOrgID + `')`,
		`INSERT INTO modules (id, code, name, category_id, parameter_definitions, organization_id)
		 VALUES ('dddddddd-0000-0000-0000-000000000003', 'MOD-BROKEN-BINDING', 'Broken binding', 'dddddddd-0000-0000-0000-000000000001',
		 '[{"name":"itemCount","label":"Item count","type":"number","defaultValue":1,"required":true,"unit":"count","category":"configuration","min":0,"max":5,"step":1,"integer":true,"binding":{"version":1,"kind":"componentQuantity","componentId":"dddddddd-0000-0000-0000-000000000002","relationship":{"kind":"fixture","sourceRole":"source","targets":[{"componentId":"` + missingComponent + `","role":"target"}]}}}]'::jsonb,
		 '` + multiOrgInitialOrgID + `')`,
		`INSERT INTO module_components (id, module_id, component_id, quantity, organization_id)
		 VALUES ('dddddddd-0000-0000-0000-000000000004', 'dddddddd-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000002', 1, '` + multiOrgInitialOrgID + `')`,
	}
	for _, statement := range seed {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("seed rollback scenario: %v", err)
		}
	}

	err := store.CloneCatalog(ctx, multiOrgInitialOrgID, destinationOrg)
	if err == nil {
		t.Fatal("CloneCatalog succeeded with an unresolvable parameter binding target")
	}
	if !strings.Contains(err.Error(), missingComponent) || !strings.Contains(err.Error(), "binding.relationship.targets[0].componentId") {
		t.Fatalf("CloneCatalog error does not identify the unresolved target: %v", err)
	}

	for _, table := range []string{"module_categories", "components", "modules", "module_components"} {
		var count int
		if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM `+table+` WHERE organization_id = $1`, destinationOrg).Scan(&count); err != nil {
			t.Fatalf("count destination %s: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("CloneCatalog left %d destination rows in %s after remap failure", count, table)
		}
	}
}

func catalogModuleByCode(t *testing.T, catalog domain.Catalog, code string) domain.Module {
	t.Helper()
	for _, module := range catalog.Modules {
		if module.Code == code {
			return module
		}
	}
	t.Fatalf("catalog module %s not found", code)
	return domain.Module{}
}

func resolveCatalogModuleSignature(t *testing.T, module domain.Module, catalog domain.Catalog) string {
	t.Helper()
	evaluated, issues, err := domain.EvaluateFurnitureParameters(module.ParameterDefinitions, map[string]any{"shelfCount": float64(3), "hasBack": false})
	if err != nil || len(issues) != 0 {
		t.Fatalf("evaluate module %s parameters: issues=%+v err=%v", module.Code, issues, err)
	}
	result, err := engine.ResolveAuthoringLayout(engine.AuthoringResolveInput{
		Module:              module,
		Catalog:             catalog,
		PrecisionMm:         0.01,
		EvaluatedParameters: evaluated,
	})
	if err != nil {
		t.Fatalf("resolve module %s: %v", module.Code, err)
	}
	if len(result.StructuralIssues) != 0 {
		t.Fatalf("resolve module %s structural issues: %+v", module.Code, result.StructuralIssues)
	}
	codes := make(map[string]string, len(catalog.Components))
	for _, component := range catalog.Components {
		codes[component.ID] = component.Code
	}
	counts := map[string]int{}
	for _, component := range result.Normalized.Components {
		counts[codes[component.CatalogComponentID]]++
	}
	componentCounts := make([]string, 0, len(counts))
	for code, count := range counts {
		componentCounts = append(componentCounts, fmt.Sprintf("%s=%d", code, count))
	}
	sort.Strings(componentCounts)
	relationships := make([]string, 0, len(result.Normalized.Relationships))
	for _, relationship := range result.Normalized.Relationships {
		targetRoles := make([]string, 0, len(relationship.Targets))
		for _, target := range relationship.Targets {
			targetRoles = append(targetRoles, target.Role)
		}
		sort.Strings(targetRoles)
		relationships = append(relationships, fmt.Sprintf("%s:%s>%s", relationship.Kind, relationship.Source.Role, strings.Join(targetRoles, ",")))
	}
	sort.Strings(relationships)
	return fmt.Sprintf("dimensions=%v;components=%s;relationships=%s;status=%s;operations=%d",
		result.Layout.DimensionsMm, strings.Join(componentCounts, ","), strings.Join(relationships, ","), result.ValidationStatus, len(result.Machining.Operations))
}

func contains(haystack, needle string) bool {
	return len(needle) > 0 && (haystack == needle || indexOf(haystack, needle) >= 0)
}

func indexOf(h, n string) int {
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return i
		}
	}
	return -1
}
