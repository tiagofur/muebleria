package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Stable seed UUIDs — deterministic so cross-references (FKs) stay valid.
// Using the a0…a9 prefix range for seeds. The a1… prefix was already used by
// migration 000016, so we stay clear.
var (
	// Edge bands
	seedEdgeArauco    = "a0000001-0000-0000-0000-000000000001"
	seedEdgeMaderado  = "a0000001-0000-0000-0000-000000000002"
	seedEdgeMdf       = "a0000001-0000-0000-0000-000000000003"
	// Materials
	seedMatArauco   = "a0000002-0000-0000-0000-000000000001"
	seedMatMaderado = "a0000002-0000-0000-0000-000000000002"
	seedMatMdf      = "a0000002-0000-0000-0000-000000000003"
	// Hardware
	seedHwBisagra   = "a0000003-0000-0000-0000-000000000001"
	seedHwJaladera  = "a0000003-0000-0000-0000-000000000002"
	seedHwPata      = "a0000003-0000-0000-0000-000000000003"
	seedHwTornillo  = "a0000003-0000-0000-0000-000000000004"
	seedHwCorredera = "a0000003-0000-0000-0000-000000000005"
	seedHwSoporte   = "a0000003-0000-0000-0000-000000000006"
	// Option groups
	seedOGInterior  = "a0000004-0000-0000-0000-000000000001"
	seedOGFrente    = "a0000004-0000-0000-0000-000000000002"
	seedOGFondo     = "a0000004-0000-0000-0000-000000000003"
	seedOGBisagra   = "a0000004-0000-0000-0000-000000000004"
	seedOGCorredera = "a0000004-0000-0000-0000-000000000005"
	// Customers
	seedCustPlantilla1 = "a0000005-0000-0000-0000-000000000001"
	seedCustPlantilla2 = "a0000005-0000-0000-0000-000000000002"
	// Modules
	seedModGab     = "a0000006-0000-0000-0000-000000000001"
	seedModCaj     = "a0000006-0000-0000-0000-000000000002"
	seedModComp    = "a0000006-0000-0000-0000-000000000003"
	// Structure
	seedStruct    = "a0000007-0000-0000-0000-000000000001"
	seedStructPre = "a0000007-0000-0000-0000-000000000002"
	// Components (different prefix from migration 000016's a1…)
	seedCompPuerta    = "a0000008-0000-0000-0000-000000000001"
	seedCompEntrepano = "a0000008-0000-0000-0000-000000000002"
	seedCompCostado   = "a0000008-0000-0000-0000-000000000003"
	seedCompBase      = "a0000008-0000-0000-0000-000000000004"
	// Project
	seedProj     = "a0000009-0000-0000-0000-000000000001"
	seedProjItem = "a0000009-0000-0000-0000-000000000002"
)

// SeedCatalog populates the database with plantilla seed data.
// Idempotent — skips if materials already exist.
func (s *PostgresStore) SeedCatalog(ctx context.Context) error {
	var count int
	err := s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM material_boards`).Scan(&count)
	if err != nil {
		return fmt.Errorf("seed check: %w", err)
	}
	if count > 0 {
		return nil
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	now := time.Now().UTC()

	// --- EDGE BANDS ---
	for _, e := range []struct {
		id, code, name string
		thickness      int
		costPerMl      float64
	}{
		{seedEdgeArauco, "CAN-ARA-BLA", "ARAUCO BLANCO", 1, 12},
		{seedEdgeMaderado, "CAN-MAD-FRE", "MADERADO FRENTE", 2, 25},
		{seedEdgeMdf, "CAN-MDF-3", "MDF 3MM", 1, 0},
	} {
		_, err = tx.Exec(ctx, `
			INSERT INTO edge_bands (id, code, name, thickness_mm, cost_per_ml, active, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,true,$6,$7)
			ON CONFLICT (code) DO UPDATE SET id = EXCLUDED.id`,
			e.id, e.code, e.name, e.thickness, e.costPerMl, now, now)
		if err != nil {
			return fmt.Errorf("seed edge %s: %w", e.code, err)
		}
	}

	// --- MATERIAL BOARDS ---
	for _, m := range []struct {
		id, code, name       string
		w, l, t              int
		grain                 bool
		boardPrice            float64
		defaultEdgeID         string
	}{
		{seedMatArauco, "TAB-ARA-BLA", "ARAUCO BLANCO", 1830, 2440, 15, false, 714.43, seedEdgeArauco},
		{seedMatMaderado, "TAB-MAD-FRE", "MADERADO FRENTE", 1830, 2440, 18, true, 1294.91, seedEdgeMaderado},
		{seedMatMdf, "TAB-MDF-3", "MDF 3MM", 1830, 2440, 3, false, 334.89, seedEdgeMdf},
	} {
		_, err = tx.Exec(ctx, `
			INSERT INTO material_boards (id, code, name, width_mm, length_mm, thickness_mm, grain_default, board_price, waste_percent, default_edge_band_id, active, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,true,$10,$11)`,
			m.id, m.code, m.name, m.w, m.l, m.t, m.grain, m.boardPrice, m.defaultEdgeID, now, now)
		if err != nil {
			return fmt.Errorf("seed material %s: %w", m.code, err)
		}
	}

	// --- HARDWARE ---
	for _, h := range []struct {
		id, code, name, unit string
		costPerUnit          float64
	}{
		{seedHwBisagra, "HER-BIS-CL", "Bisagra Cierre Lento", "piece", 35},
		{seedHwJaladera, "HER-JAL-INOX", "Jaladera Acero Inox", "piece", 45},
		{seedHwPata, "HER-PATA-REG", "Pata Regulable Plastica", "piece", 15},
		{seedHwTornillo, "HER-TOR-4X50", "Tornillo 4x50 mm", "piece", 0.5},
		{seedHwCorredera, "HER-CORR-500", "Corredera Telescópica 500mm", "set", 120},
		{seedHwSoporte, "HER-SOP-ENT", "Soporte de Entrepaño", "piece", 2},
	} {
		_, err = tx.Exec(ctx, `
			INSERT INTO hardwares (id, code, name, unit, cost_per_unit, active, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,true,$6,$7)`,
			h.id, h.code, h.name, h.unit, h.costPerUnit, now, now)
		if err != nil {
			return fmt.Errorf("seed hardware %s: %w", h.code, err)
		}
	}

	// --- OPTION GROUPS ---
	for _, og := range []struct {
		id, code, name, kind string
		required             bool
		optIDs               []string
	}{
		{seedOGInterior, "INTERIOR", "Melamina de Interiores", "board", true, []string{seedMatArauco}},
		{seedOGFrente, "FRENTE", "Melamina de Frentes", "board", true, []string{seedMatMaderado}},
		{seedOGFondo, "FONDO", "Fondos delgados", "board", true, []string{seedMatMdf}},
		{seedOGBisagra, "BISAGRA", "Bisagras", "hardware", true, []string{seedHwBisagra}},
		{seedOGCorredera, "CORREDERA", "Correderas", "hardware", true, []string{seedHwCorredera}},
	} {
		_, err := tx.Exec(ctx, `
			INSERT INTO option_groups (id, code, name, kind, required)
			VALUES ($1,$2,$3,$4,$5)`,
			og.id, og.code, og.name, og.kind, og.required)
		if err != nil {
			return fmt.Errorf("seed option_group %s: %w", og.code, err)
		}
		for _, eid := range og.optIDs {
			_, err = tx.Exec(ctx, `
				INSERT INTO option_group_members (option_group_id, entity_id) VALUES ($1,$2)`,
				og.id, eid)
			if err != nil {
				return fmt.Errorf("seed og member %s: %w", og.code, err)
			}
		}
	}

	// --- CUSTOMERS ---
	_, err = tx.Exec(ctx, `INSERT INTO customers (id, name, active, created_at, updated_at) VALUES ($1,$2,true,$3,$4)`,
		seedCustPlantilla1, "Cliente Plantilla", now, now)
	if err != nil {
		return fmt.Errorf("seed customer 1: %w", err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO customers (id, name, active, created_at, updated_at) VALUES ($1,$2,true,$3,$4)`,
		seedCustPlantilla2, "Cliente Demo", now, now)
	if err != nil {
		return fmt.Errorf("seed customer 2: %w", err)
	}

	// --- MOD-GAB-01 ---
	err = insertModuleTx(ctx, tx, seedModGab, "MOD-GAB-01", "Gabinete 1 Puerta 300 x 720 x 590 mm",
		0, 300, 720, 590, "", now,
		[]boardPartSeed{
			{id: "a00000b0-0001-0000-0000-000000000001", code: "MOD-GAB-01-P01", desc: "Costado Derecho", qty: 1, len: 720, wid: 590, role: "INTERIOR", l1: true, l2: true, w1: true, w2: true},
			{id: "a00000b0-0001-0000-0000-000000000002", code: "MOD-GAB-01-P02", desc: "Costado Izquierdo", qty: 1, len: 720, wid: 590, role: "INTERIOR", l1: true, l2: true, w1: true, w2: true},
			{id: "a00000b0-0001-0000-0000-000000000003", code: "MOD-GAB-01-P03", desc: "Respaldo Gabinete", qty: 1, len: 689, wid: 269, role: "INTERIOR"},
			{id: "a00000b0-0001-0000-0000-000000000004", code: "MOD-GAB-01-P04", desc: "Piso Gabinete", qty: 1, len: 590, wid: 269, role: "INTERIOR", w1: true, w2: true},
			{id: "a00000b0-0001-0000-0000-000000000005", code: "MOD-GAB-01-P05", desc: "Entrepano Gabinete", qty: 1, len: 520, wid: 269, role: "INTERIOR", w2: true},
			{id: "a00000b0-0001-0000-0000-000000000006", code: "MOD-GAB-01-P06", desc: "Manguete Frontal", qty: 1, len: 269, wid: 120, role: "INTERIOR", l1: true, l2: true},
			{id: "a00000b0-0001-0000-0000-000000000007", code: "MOD-GAB-01-P07", desc: "Manguete Posterior", qty: 1, len: 269, wid: 120, role: "INTERIOR", l1: true, l2: true},
			{id: "a00000b0-0001-0000-0000-000000000008", code: "MOD-GAB-01-P08", desc: "Puerta Gabinete", qty: 1, len: 717, wid: 296, role: "FRENTE", l1: true, l2: true, w1: true, w2: true},
		},
		[]hwLineSeed{
			{id: "a00000c0-0001-0000-0000-000000000001", qty: 2, optRole: "BISAGRA"},
			{id: "a00000c0-0001-0000-0000-000000000002", qty: 1, optRole: "FIXED", hwID: seedHwJaladera},
			{id: "a00000c0-0001-0000-0000-000000000003", qty: 4, optRole: "FIXED", hwID: seedHwPata},
			{id: "a00000c0-0001-0000-0000-000000000004", qty: 40, optRole: "FIXED", hwID: seedHwTornillo},
			{id: "a00000c0-0001-0000-0000-000000000005", qty: 4, optRole: "FIXED", hwID: seedHwSoporte},
		})
	if err != nil {
		return err
	}

	// --- MOD-CAJ-01 ---
	err = insertModuleTx(ctx, tx, seedModCaj, "MOD-CAJ-01", "Cajonera 4 Cajones 500 x 720 x 590 mm",
		0, 500, 720, 590, "", now,
		[]boardPartSeed{
			{id: "a00000b0-0002-0000-0000-000000000001", code: "MOD-CAJ-01-P01", desc: "Costado Derecho", qty: 1, len: 720, wid: 590, role: "INTERIOR", l1: true, l2: true, w1: true, w2: true},
			{id: "a00000b0-0002-0000-0000-000000000002", code: "MOD-CAJ-01-P02", desc: "Costado Izquierdo", qty: 1, len: 720, wid: 590, role: "INTERIOR", l1: true, l2: true, w1: true, w2: true},
			{id: "a00000b0-0002-0000-0000-000000000003", code: "MOD-CAJ-01-P03", desc: "Piso Gabinete", qty: 1, len: 590, wid: 469, role: "INTERIOR", w1: true, w2: true},
			{id: "a00000b0-0002-0000-0000-000000000004", code: "MOD-CAJ-01-P04", desc: "Respaldo Gabinete", qty: 1, len: 689, wid: 469, role: "INTERIOR"},
			{id: "a00000b0-0002-0000-0000-000000000005", code: "MOD-CAJ-01-P05", desc: "Frente de Cajón", qty: 4, len: 175, wid: 496, role: "FRENTE", l1: true, l2: true, w1: true, w2: true},
			{id: "a00000b0-0002-0000-0000-000000000006", code: "MOD-CAJ-01-P06", desc: "Lateral de Cajón", qty: 8, len: 500, wid: 120, role: "INTERIOR", l1: true},
			{id: "a00000b0-0002-0000-0000-000000000007", code: "MOD-CAJ-01-P07", desc: "Frente/Tras Cajón", qty: 4, len: 412, wid: 120, role: "INTERIOR", l1: true},
			{id: "a00000b0-0002-0000-0000-000000000008", code: "MOD-CAJ-01-P08", desc: "Fondo de Cajón (MDF)", qty: 4, len: 500, wid: 442, role: "FONDO"},
		},
		[]hwLineSeed{
			{id: "a00000c0-0002-0000-0000-000000000001", qty: 4, optRole: "CORREDERA"},
			{id: "a00000c0-0002-0000-0000-000000000002", qty: 4, optRole: "FIXED", hwID: seedHwJaladera},
			{id: "a00000c0-0002-0000-0000-000000000003", qty: 4, optRole: "FIXED", hwID: seedHwPata},
			{id: "a00000c0-0002-0000-0000-000000000004", qty: 60, optRole: "FIXED", hwID: seedHwTornillo},
		})
	if err != nil {
		return err
	}

	// --- STRUCTURE ---
	_, err = tx.Exec(ctx, `
		INSERT INTO structures (id, code, name, width_mm, height_mm, depth_mm, notes, active, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9)`,
		seedStruct, "EST-COMP-600", "Estructura Compuesta 600",
		600, 720, 560, "", now, now)
	if err != nil {
		return fmt.Errorf("seed structure: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO structure_presets (id, structure_id, name, width_mm, height_mm, depth_mm)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		seedStructPre, seedStruct, "Ancho 600", 600, 720, 560)
	if err != nil {
		return fmt.Errorf("seed struct preset: %w", err)
	}

	// --- COMPONENTS (skip if already seeded by migration 000016) ---
	allEdges, _ := json.Marshal([]domain.EdgeAssignment{
		{Side: "L1", Enabled: true}, {Side: "L2", Enabled: true},
		{Side: "W1", Enabled: true}, {Side: "W2", Enabled: true},
	})
	wOnlyEdges, _ := json.Marshal([]domain.EdgeAssignment{
		{Side: "L1", Enabled: false}, {Side: "L2", Enabled: false},
		{Side: "W1", Enabled: false}, {Side: "W2", Enabled: true},
	})
	noEdges, _ := json.Marshal([]domain.EdgeAssignment{
		{Side: "L1", Enabled: false}, {Side: "L2", Enabled: false},
		{Side: "W1", Enabled: false}, {Side: "W2", Enabled: false},
	})

	// Use ON CONFLICT DO NOTHING in case migration 000016 already inserted components
	_, err = tx.Exec(ctx, `
		INSERT INTO components (id, code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm, default_edges, option_roles, active, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12)
		ON CONFLICT (code) DO NOTHING`,
		seedCompPuerta, "COM-PUE-01", "Puerta", "puerta", "rectangular_board",
		717, 296, 18, allEdges, []string{"FRENTE"}, now, now)
	if err != nil {
		return fmt.Errorf("seed component puerta: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO components (id, code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm, default_edges, option_roles, active, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12)
		ON CONFLICT (code) DO NOTHING`,
		seedCompEntrepano, "COM-ENT-01", "Entrepaño Regulable", "interno", "rectangular_board",
		462, 550, 15, wOnlyEdges, []string{"INTERIOR"}, now, now)
	if err != nil {
		return fmt.Errorf("seed component entrepano: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO components (id, code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm, default_edges, option_roles, active, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12)
		ON CONFLICT (code) DO NOTHING`,
		seedCompCostado, "COM-COS-01", "Costado Lateral", "lateral_izquierdo", "rectangular_board",
		720, 560, 18, noEdges, []string{"INTERIOR"}, now, now)
	if err != nil {
		return fmt.Errorf("seed component costado: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO components (id, code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm, default_edges, option_roles, active, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12)
		ON CONFLICT (code) DO NOTHING`,
		seedCompBase, "COM-BAS-01", "Base Estructura", "base", "rectangular_board",
		564, 560, 18, noEdges, []string{"INTERIOR"}, now, now)
	if err != nil {
		return fmt.Errorf("seed component base: %w", err)
	}

	// --- LINK STRUCTURE ↔ COMPONENTS (F053) ---
	// The structure body composes costado×2 + base×1; doors/shelves are added
	// per-module (below) so different modules can share the same body.
	_, err = tx.Exec(ctx, `
		INSERT INTO structure_components (structure_id, component_id, quantity, placement_override)
		VALUES ($1,$2,$3,$4)`,
		seedStruct, seedCompCostado, 2, "lateral_izquierdo")
	if err != nil {
		return fmt.Errorf("seed structure_components costado: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO structure_components (structure_id, component_id, quantity, placement_override)
		VALUES ($1,$2,$3,$4)`,
		seedStruct, seedCompBase, 1, "base")
	if err != nil {
		return fmt.Errorf("seed structure_components base: %w", err)
	}

	// --- COMPOSED MODULE (references structure + module-level components) ---
	err = insertModuleTx(ctx, tx, seedModComp, "MOD-COMP-001", "Gabinete Compuesto 600",
		0, 600, 720, 560, "Mueble compuesto demo: estructura + puerta + entrepaños", now,
		nil, nil)
	if err != nil {
		return err
	}
	// Link the module to its structure body (F054).
	_, err = tx.Exec(ctx, `UPDATE modules SET structure_id = $1 WHERE id = $2`, seedStruct, seedModComp)
	if err != nil {
		return fmt.Errorf("seed module structure_id: %w", err)
	}
	// Module-level components: puerta×1 + entrepaño×2 (beyond the body).
	_, err = tx.Exec(ctx, `
		INSERT INTO module_components (module_id, component_id, quantity, placement_override)
		VALUES ($1,$2,$3,$4)`,
		seedModComp, seedCompPuerta, 1, "puerta")
	if err != nil {
		return fmt.Errorf("seed module_components puerta: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO module_components (module_id, component_id, quantity, placement_override)
		VALUES ($1,$2,$3,$4)`,
		seedModComp, seedCompEntrepano, 2, "interno")
	if err != nil {
		return fmt.Errorf("seed module_components entrepano: %w", err)
	}
	// Commercial multi-size options for quote (H09 / #104).
	for _, pr := range []struct {
		name string
		w, h, d int
	}{
		{"Ancho 300", 300, 720, 560},
		{"Ancho 400", 400, 720, 560},
		{"Ancho 600", 600, 720, 560},
	} {
		_, err = tx.Exec(ctx, `
			INSERT INTO module_presets (module_id, name, width_mm, height_mm, depth_mm)
			VALUES ($1,$2,$3,$4,$5)`,
			seedModComp, pr.name, pr.w, pr.h, pr.d)
		if err != nil {
			return fmt.Errorf("seed module_presets %s: %w", pr.name, err)
		}
	}

	// --- DEMO PROJECT ---
	_, err = tx.Exec(ctx, `
		INSERT INTO projects (id, name, customer_id, currency, margin_factor, labor_fixed_cost, status, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		seedProj, "Demo plantilla", seedCustPlantilla2,
		"MXN", 1.35, 1200, "draft", now, now)
	if err != nil {
		return fmt.Errorf("seed project: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO project_items (id, project_id, module_id, quantity)
		VALUES ($1,$2,$3,$4)`,
		seedProjItem, seedProj, seedModGab, 1)
	if err != nil {
		return fmt.Errorf("seed project item: %w", err)
	}
	for optGroup, choiceEntity := range map[string]string{
		"INTERIOR":  seedMatArauco,
		"FRENTE":    seedMatMaderado,
		"FONDO":     seedMatMdf,
		"BISAGRA":   seedHwBisagra,
		"CORREDERA": seedHwCorredera,
	} {
		_, err = tx.Exec(ctx, `
			INSERT INTO project_item_choices (project_item_id, option_group_code, choice_entity_id)
			VALUES ($1,$2,$3)`,
			seedProjItem, optGroup, choiceEntity)
		if err != nil {
			return fmt.Errorf("seed project item choice %s: %w", optGroup, err)
		}
	}

	return tx.Commit(ctx)
}

// --- helpers ---

type boardPartSeed struct {
	id, code, desc                    string
	qty, len, wid                     int
	role, lenFormula, widFormula      string
	l1, l2, w1, w2                    bool
}

type hwLineSeed struct {
	id                                          string
	qty                                         int
	descOverride, optRole, hwID                 string
}

func insertModuleTx(ctx context.Context, tx pgx.Tx, id, code, name string, baseLaborCost, w, h, d int,
	notes string, now time.Time, parts []boardPartSeed, hwLines []hwLineSeed) error {

	var notesArg interface{} = nil
	if notes != "" {
		notesArg = notes
	}

	// All seed modules are base cabinets (inferior). furniture_type defaults to
	// '' → 'inferior' on read (#109). Explicit here for clarity.
	_, err := tx.Exec(ctx, `
		INSERT INTO modules (id, code, name, base_labor_cost, width_mm, height_mm, depth_mm, notes, furniture_type, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'inferior',$9,$10)`,
		id, code, name, baseLaborCost, w, h, d, notesArg, now, now)
	if err != nil {
		return fmt.Errorf("seed module %s: %w", code, err)
	}

	for _, p := range parts {
		_, err := tx.Exec(ctx, `
			INSERT INTO board_parts (id, module_id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			p.id, id, p.code, p.desc, p.qty, p.len, p.wid, p.role,
			p.l1, p.l2, p.w1, p.w2)
		if err != nil {
			return fmt.Errorf("seed board part %s->%s: %w", code, p.code, err)
		}
	}

	for _, hl := range hwLines {
		var hwIDArg interface{} = nil
		if hl.hwID != "" {
			hwIDArg = hl.hwID
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO hardware_lines (id, module_id, quantity, description_override, option_role, hardware_id)
			VALUES ($1,$2,$3,$4,$5,$6)`,
			hl.id, id, hl.qty, hl.descOverride, hl.optRole, hwIDArg)
		if err != nil {
			return fmt.Errorf("seed hw line %s->%s: %w", code, hl.id, err)
		}
	}

	return nil
}
