package storage

import (
	"context"
	"fmt"
	"sort"
)

// Comando de limpieza del catálogo demo (F181). El seed (cmd/admin seed /
// POST /api/seed) es la ÚNICA fuente de estos rows; migraciones y arranque
// nunca insertan ítems (F180, TestMigrations_NoBusinessData). Esta limpieza
// existe para recuperar bases de prueba —o cualquier instalación— donde el
// seed corrió y ya no se quiere esa basura.
//
// Identificación: por códigos/nombres EXACTOS del seed. Los clones de
// catálogo (CloneCatalog) preservan los códigos, así que la limpieza también
// funciona por-org tras clonar.
//
// Seguridad:
//   - dry-run por defecto: todo corre en una transacción que se revierte;
//     el reporte es idéntico al de --apply;
//   - un row demo sólo se borra si NINGÚN row sobreviviente lo referencia
//     (obras reales, plantillas reales, módulos del usuario…). Lo referenciado
//     se reporta como skipped con el motivo.

// Deben reflejar internal/storage/seed.go. TestCleanDemoData pinea esta
// lista contra el seed real: el ciclo seed→clean→seed debe dejar la base
// como si el seed nunca hubiera corrido.
var (
	demoCustomerNames  = []string{"Cliente Plantilla", "Cliente Demo"}
	demoProjectName    = "Demo plantilla"
	demoTemplateName   = "Cocina estándar 3 m"
	demoModuleCodes    = []string{"MOD-GAB-01", "MOD-CAJ-01", "MOD-COMP-001", "MOD-BAJO-ZOCLO-600", "MOD-BAJO-PERFIL-600"}
	demoStructureCodes = []string{"EST-COMP-600", "EST-GAB-01"}
	demoComponentCodes = []string{
		"COM-PUE-01", "COM-ENT-01", "COM-COS-01", "COM-BAS-01", "COM-ZOC-01",
		"COM-GAB-COS", "COM-GAB-RES", "COM-GAB-PIS", "COM-GAB-MAN", "COM-GAB-PUE", "COM-GAB-ENT",
	}
	demoHardwareCodes    = []string{"HER-BIS-CL", "HER-JAL-INOX", "HER-PATA-REG", "HER-TOR-4X50", "HER-CORR-500", "HER-SOP-ENT", "HER-TAQ-8X30", "HER-MIN-15", "HER-PLACA-BIS", "HER-ZOC-ALU", "HER-ZOC-BRO", "HER-ZOC-NEG"}
	demoBoardCodes       = []string{"TAB-ARA-BLA", "TAB-MAD-FRE", "TAB-MDF-3"}
	demoEdgeCodes        = []string{"CAN-ARA-BLA", "CAN-MAD-FRE", "CAN-MDF-3"}
	demoOptionGroupCodes = []string{"INTERIOR", "FRENTE", "FONDO", "BISAGRA", "CORREDERA", "ZOCLO", "ZOCLO_PERFIL"}
)

// CleanDemoOrgResult is the per-organization outcome of CleanDemoData.
type CleanDemoOrgResult struct {
	OrgID   string
	OrgName string
	// Deleted maps table → rows removed (or that --apply would remove).
	Deleted map[string]int
	// Skipped lists demo rows kept because surviving data references them.
	Skipped []string
}

type demoRow struct{ id, code string }

// CleanDemoData removes the demo/plantilla seed rows of one organization,
// protecting anything referenced by surviving (real) data. With apply=false
// the whole run happens inside a transaction that is rolled back — the
// returned report is exactly what apply=true would do.
func (s *PostgresStore) CleanDemoData(ctx context.Context, orgID string, apply bool) (*CleanDemoOrgResult, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	res := &CleanDemoOrgResult{OrgID: orgID, Deleted: map[string]int{}}
	if err := tx.QueryRow(ctx, `SELECT name FROM organizations WHERE id = $1`, orgID).Scan(&res.OrgName); err != nil {
		return nil, fmt.Errorf("clean demo: org %s: %w", orgID, err)
	}

	del := func(table, sql string, args ...any) error {
		tag, err := tx.Exec(ctx, sql, args...)
		if err != nil {
			return fmt.Errorf("clean demo %s: %w", table, err)
		}
		if n := int(tag.RowsAffected()); n > 0 {
			res.Deleted[table] += n
		}
		return nil
	}
	count := func(sql string, args ...any) (int, error) {
		var n int
		if err := tx.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
			return 0, err
		}
		return n, nil
	}
	skip := func(kind, code string, refs int, refKind string) {
		res.Skipped = append(res.Skipped, fmt.Sprintf("%s %s: conservado, %d %s lo referencian", kind, code, refs, refKind))
	}
	candidates := func(table string, codes []string) ([]demoRow, error) {
		rows, err := tx.Query(ctx,
			`SELECT id, code FROM `+table+` WHERE organization_id = $1 AND code = ANY($2)`, orgID, codes)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := []demoRow{}
		for rows.Next() {
			var r demoRow
			if err := rows.Scan(&r.id, &r.code); err != nil {
				return nil, err
			}
			out = append(out, r)
		}
		return out, rows.Err()
	}

	// --- 1. Obra y plantilla demo (cascadan items/choices/eventos/fotos) ---
	demoProjectIDs := []string{}
	rows, err := tx.Query(ctx, `
		SELECT id FROM projects
		WHERE organization_id = $1
		  AND (name = $2 OR customer_id IN (
		      SELECT id FROM customers WHERE organization_id = $1 AND name = ANY($3)))`,
		orgID, demoProjectName, demoCustomerNames)
	if err != nil {
		return nil, fmt.Errorf("clean demo: demo projects: %w", err)
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		demoProjectIDs = append(demoProjectIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(demoProjectIDs) > 0 {
		if err := del("projects", `DELETE FROM projects WHERE id = ANY($1::uuid[])`, demoProjectIDs); err != nil {
			return nil, err
		}
	}
	if err := del("project_templates",
		`DELETE FROM project_templates WHERE organization_id = $1 AND name = $2`, orgID, demoTemplateName); err != nil {
		return nil, err
	}

	// --- 2. Módulos demo (board_parts/hardware_lines/module_* cascadan) ----
	mods, err := candidates("modules", demoModuleCodes)
	if err != nil {
		return nil, fmt.Errorf("clean demo: modules: %w", err)
	}
	for _, m := range mods {
		itemRefs, err := count(`
			SELECT COUNT(*) FROM project_items pi
			JOIN projects p ON p.id = pi.project_id
			WHERE pi.module_id = $1 AND p.organization_id = $2`, m.id, orgID)
		if err != nil {
			return nil, err
		}
		// Templates guardan los module_id dentro de items JSONB (sin FK).
		tmplRefs, err := count(`
			SELECT COUNT(*) FROM project_templates
			WHERE organization_id = $1 AND items::text LIKE '%' || $2 || '%'`, orgID, m.id)
		if err != nil {
			return nil, err
		}
		if refs := itemRefs + tmplRefs; refs > 0 {
			skip("módulo", m.code, refs, "ítems/plantillas reales")
			continue
		}
		if err := del("modules", `DELETE FROM modules WHERE id = $1`, m.id); err != nil {
			return nil, err
		}
	}

	// --- 3. Estructuras demo (presets/components cascadan) ------------------
	structs, err := candidates("structures", demoStructureCodes)
	if err != nil {
		return nil, fmt.Errorf("clean demo: structures: %w", err)
	}
	for _, st := range structs {
		refs, err := count(`SELECT COUNT(*) FROM modules WHERE structure_id = $1 AND organization_id = $2`, st.id, orgID)
		if err != nil {
			return nil, err
		}
		if refs > 0 {
			skip("estructura", st.code, refs, "módulos reales")
			continue
		}
		if err := del("structures", `DELETE FROM structures WHERE id = $1`, st.id); err != nil {
			return nil, err
		}
	}

	// --- 4. Componentes demo (FKs sin CASCADE desde module/structure_components)
	comps, err := candidates("components", demoComponentCodes)
	if err != nil {
		return nil, fmt.Errorf("clean demo: components: %w", err)
	}
	for _, c := range comps {
		refs, err := count(`
			SELECT (SELECT COUNT(*) FROM module_components mc JOIN modules m ON m.id = mc.module_id
			         WHERE mc.component_id = $1 AND m.organization_id = $2)
			     + (SELECT COUNT(*) FROM structure_components sc JOIN structures st ON st.id = sc.structure_id
			         WHERE sc.component_id = $1 AND st.organization_id = $2)`, c.id, orgID)
		if err != nil {
			return nil, err
		}
		if refs > 0 {
			skip("componente", c.code, refs, "módulos/estructuras reales")
			continue
		}
		if err := del("components", `DELETE FROM components WHERE id = $1`, c.id); err != nil {
			return nil, err
		}
	}

	// --- 5. Grupos de opciones demo (members cascadan) ----------------------
	// Referenciados POR CÓDIGO (sin FK) desde piezas/herrajes/módulos y las
	// choices de obras reales.
	for _, code := range demoOptionGroupCodes {
		refs, err := count(`
			SELECT (SELECT COUNT(*) FROM board_parts bp JOIN modules m ON m.id = bp.module_id
			         WHERE m.organization_id = $1 AND bp.option_role = $2)
			     + (SELECT COUNT(*) FROM hardware_lines hl JOIN modules m ON m.id = hl.module_id
			         WHERE m.organization_id = $1 AND hl.option_role = $2)
			     + (SELECT COUNT(*) FROM project_item_choices pic
			         JOIN project_items pi ON pi.id = pic.project_item_id
			         JOIN projects p ON p.id = pi.project_id
			         WHERE p.organization_id = $1 AND pic.option_group_code = $2)
			     + (SELECT COUNT(*) FROM project_level_choices plc
			         JOIN projects p ON p.id = plc.project_id
			         WHERE p.organization_id = $1 AND plc.option_group_code = $2)`, orgID, code)
		if err != nil {
			return nil, err
		}
		if refs > 0 {
			skip("grupo de opciones", code, refs, "rows reales")
			continue
		}
		if err := del("option_groups",
			`DELETE FROM option_groups WHERE organization_id = $1 AND code = $2`, orgID, code); err != nil {
			return nil, err
		}
	}

	// --- 6. Herrajes y tableros demo (misma forma de referencias) ----------
	// Nota: choice_entity_id vive como UUID en project_item_choices y como
	// VARCHAR en project_level_choices — se compara casteando la COLUMNA a
	// text para que $1 resuelva a un único tipo.
	for _, table := range []struct {
		name      string
		codes     []string
		kind      string
		extraRefs string
	}{
		{"hardwares", demoHardwareCodes, "herraje", `
			     + (SELECT COUNT(*) FROM hardware_lines hl JOIN modules m ON m.id = hl.module_id
			         WHERE hl.hardware_id::text = $1 AND m.organization_id = $2)`},
		{"material_boards", demoBoardCodes, "tablero", ""},
	} {
		rows, err := candidates(table.name, table.codes)
		if err != nil {
			return nil, fmt.Errorf("clean demo: %s: %w", table.name, err)
		}
		for _, r := range rows {
			refs, err := count(`
				SELECT (SELECT COUNT(*) FROM option_group_members ogm
			         JOIN option_groups og ON og.id = ogm.option_group_id
			         WHERE ogm.entity_id::text = $1 AND og.organization_id = $2)
			     + (SELECT COUNT(*) FROM project_item_choices pic
			         JOIN project_items pi ON pi.id = pic.project_item_id
			         JOIN projects p ON p.id = pi.project_id
			         WHERE pic.choice_entity_id::text = $1 AND p.organization_id = $2)
			     + (SELECT COUNT(*) FROM project_level_choices plc
			         JOIN projects p ON p.id = plc.project_id
			         WHERE plc.choice_entity_id = $1 AND p.organization_id = $2)`+table.extraRefs,
				r.id, orgID)
			if err != nil {
				return nil, err
			}
			if refs > 0 {
				skip(table.kind, r.code, refs, "rows reales")
				continue
			}
			if err := del(table.name, `DELETE FROM `+table.name+` WHERE id = $1`, r.id); err != nil {
				return nil, err
			}
		}
	}

	// --- 7. Cantos demo: default_edge_band_id de tableros sobrevivientes ----
	edges, err := candidates("edge_bands", demoEdgeCodes)
	if err != nil {
		return nil, fmt.Errorf("clean demo: edge_bands: %w", err)
	}
	for _, e := range edges {
		refs, err := count(`SELECT COUNT(*) FROM material_boards WHERE default_edge_band_id = $1 AND organization_id = $2`, e.id, orgID)
		if err != nil {
			return nil, err
		}
		if refs > 0 {
			skip("canto", e.code, refs, "tableros reales")
			continue
		}
		if err := del("edge_bands", `DELETE FROM edge_bands WHERE id = $1`, e.id); err != nil {
			return nil, err
		}
	}

	// --- 8. Clientes demo (último: sin obras sobrevivientes que los usen) ---
	if err := del("customers", `
		DELETE FROM customers c
		WHERE c.organization_id = $1 AND c.name = ANY($2)
		  AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.customer_id = c.id)`,
		orgID, demoCustomerNames); err != nil {
		return nil, err
	}

	sort.Strings(res.Skipped)
	if apply {
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
	}
	return res, nil
}
