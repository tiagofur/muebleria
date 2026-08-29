package storage_test

import (
	"context"
	"testing"

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
		`INSERT INTO organizations (id, name, slug, active) VALUES ($1, 'Taller Clon', 'taller-clon', FALSE)`, orgB); err != nil {
		t.Fatalf("create org B: %v", err)
	}

	seed := []string{
		// Catálogo fuente (org inicial): categoría → componente → agregado
		// (JSONB refs) → módulo (categoría + agregados JSONB) + piezas/herraje/línea.
		// organization_id es explícito: 000088 eliminó el DEFAULT transicional.
		`INSERT INTO module_categories (id, name, parent_id, organization_id) VALUES ('cccccccc-0000-0000-0000-000000000001', 'Cocinas', NULL, '` + multiOrgInitialOrgID + `')`,
		`INSERT INTO components (id, code, name, placement, active, length_mm, width_mm, thickness_mm, organization_id) VALUES ('cccccccc-0000-0000-0000-000000000002', 'COMP-P', 'Panel', 'interior', true, 700, 500, 18, '` + multiOrgInitialOrgID + `')`,
		`INSERT INTO hardwares (id, code, name, unit, cost_per_unit, active, organization_id) VALUES ('cccccccc-0000-0000-0000-000000000003', 'HW-BIS', 'Bisagra', 'piece', 12.5, true, '` + multiOrgInitialOrgID + `')`,
		`INSERT INTO agregados (id, code, name, active, components, hardware_lines, organization_id)
		 VALUES ('cccccccc-0000-0000-0000-000000000004', 'AGR-PUERTA', 'Puerta', true,
		 '[{"componentId":"cccccccc-0000-0000-0000-000000000002","quantity":1}]'::jsonb,
		 '[{"id":"hl1","quantity":2,"option_role":"BISAGRAS","hardware_id":"cccccccc-0000-0000-0000-000000000003"}]'::jsonb,
		 '` + multiOrgInitialOrgID + `')`,
		`INSERT INTO modules (id, code, name, category_id, agregados, organization_id)
		 VALUES ('cccccccc-0000-0000-0000-000000000005', 'MOD-GAB-01', 'Gabinete', 'cccccccc-0000-0000-0000-000000000001',
		 '[{"agregado_id":"cccccccc-0000-0000-0000-000000000004","name":"Puerta","quantity":2,"layout_direction":"vertical","gap_mm":3}]'::jsonb,
		 '` + multiOrgInitialOrgID + `')`,
		`INSERT INTO board_parts (id, module_id, code, description, quantity, length_mm, width_mm, option_role, organization_id)
		 VALUES ('cccccccc-0000-0000-0000-000000000006', 'cccccccc-0000-0000-0000-000000000005', 'MOD-GAB-01-P01', '', 1, 700, 500, 'LATERAL', '` + multiOrgInitialOrgID + `')`,
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
			WHERE c.organization_id = $2::uuid AND c.code = 'COMP-P')`, compJSON, orgB).Scan(&compOK); err != nil || !compOK {
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
