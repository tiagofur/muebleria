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
	seedHwZocloPerfil = "a0000003-0000-0000-0000-000000000007"
	seedHwZocloBronce = "a0000003-0000-0000-0000-000000000008"
	seedHwZocloNegro  = "a0000003-0000-0000-0000-000000000009"
	// F127 CNC drilling seeds
	seedHwPlacaBis = "a0000003-0000-0000-0000-000000000010"
	seedHwTaquete  = "a0000003-0000-0000-0000-000000000011"
	seedHwMinifix  = "a0000003-0000-0000-0000-000000000012"
	// Option groups
	seedOGInterior  = "a0000004-0000-0000-0000-000000000001"
	seedOGFrente    = "a0000004-0000-0000-0000-000000000002"
	seedOGFondo     = "a0000004-0000-0000-0000-000000000003"
	seedOGBisagra   = "a0000004-0000-0000-0000-000000000004"
	seedOGCorredera = "a0000004-0000-0000-0000-000000000005"
	seedOGZoclo       = "a0000004-0000-0000-0000-000000000006"
	seedOGZocloPerfil = "a0000004-0000-0000-0000-000000000007"
	// Customers
	seedCustPlantilla1 = "a0000005-0000-0000-0000-000000000001"
	seedCustPlantilla2 = "a0000005-0000-0000-0000-000000000002"
	// Modules
	seedModGab     = "a0000006-0000-0000-0000-000000000001"
	seedModCaj     = "a0000006-0000-0000-0000-000000000002"
	seedModComp    = "a0000006-0000-0000-0000-000000000003"
	seedModBajoZoclo  = "a0000006-0000-0000-0000-000000000004"
	seedModBajoPerfil = "a0000006-0000-0000-0000-000000000005"
	// Structure
	seedStruct    = "a0000007-0000-0000-0000-000000000001"
	seedStructPre = "a0000007-0000-0000-0000-000000000002"
	// Components (different prefix from migration 000016's a1…)
	seedCompPuerta    = "a0000008-0000-0000-0000-000000000001"
	seedCompEntrepano = "a0000008-0000-0000-0000-000000000002"
	seedCompCostado   = "a0000008-0000-0000-0000-000000000003"
	seedCompBase      = "a0000008-0000-0000-0000-000000000004"
	seedCompZoclo     = "a0000008-0000-0000-0000-000000000005"
	// Project
	seedProj     = "a0000009-0000-0000-0000-000000000001"
	seedProjItem = "a0000009-0000-0000-0000-000000000002"
	// Project template (#110 / H15) — project_templates.id is UUID; the old
	// text slug id could never insert on a fresh database (found by the
	// pilot readiness suite, F179).
	seedProjectTemplate = "a0000009-0000-0000-0000-000000000003"
)

// F127 machining footprints — mirror plantillaDemo.ts values (parity golden:
// the drilling pipeline must resolve the same holes in both stacks). Defaults
// follow the 32mm system; the shop adjusts per real hardware in the catalog.
func seedF64(v float64) *float64 { return &v }

var (
	seedMachiningBisagra = &domain.HardwareMachiningProfile{
		Parts: []domain.HardwareMachiningPart{{
			ID: "cup", Role: "cup",
			Operations: []domain.MachiningOperation{
				{ID: "cup-35", Kind: "blind_hole", DiameterMm: 35, DepthMm: seedF64(12.5), XMm: 0, YMm: 0, Face: "anchor", Label: "Taza 35 mm"},
				{ID: "cup-fix-1", Kind: "screw_pilot", DiameterMm: 5, DepthMm: seedF64(10), XMm: 0, YMm: -22.5, Face: "anchor", Label: "Fijación taza 1"},
				{ID: "cup-fix-2", Kind: "screw_pilot", DiameterMm: 5, DepthMm: seedF64(10), XMm: 0, YMm: 22.5, Face: "anchor", Label: "Fijación taza 2"},
			},
		}},
	}
	seedMachiningTornillo = &domain.HardwareMachiningProfile{
		Parts: []domain.HardwareMachiningPart{{
			ID: "screw", Role: "screw",
			Operations: []domain.MachiningOperation{
				{ID: "pilot", Kind: "screw_pilot", DiameterMm: 3, DepthMm: seedF64(35), XMm: 0, YMm: 0, Face: "anchor", Label: "Piloto tornillo"},
			},
		}},
	}
	seedMachiningTaquete = &domain.HardwareMachiningProfile{
		Parts: []domain.HardwareMachiningPart{{
			ID: "dowel", Role: "dowel",
			Operations: []domain.MachiningOperation{
				{ID: "dowel-8", Kind: "blind_hole", DiameterMm: 8, DepthMm: seedF64(15), XMm: 0, YMm: 0, Face: "anchor", Label: "Perforación por lado"},
			},
		}},
	}
	seedMachiningMinifix = &domain.HardwareMachiningProfile{
		Parts: []domain.HardwareMachiningPart{
			{
				ID: "cam", Role: "cam",
				Operations: []domain.MachiningOperation{
					{ID: "cam-15", Kind: "blind_hole", DiameterMm: 15, DepthMm: seedF64(13), XMm: 0, YMm: 0, Face: "anchor", Label: "Cazuela minifix"},
				},
			},
			{
				ID: "bolt", Role: "bolt",
				Operations: []domain.MachiningOperation{
					{ID: "bolt-pilot", Kind: "screw_pilot", DiameterMm: 5, DepthMm: seedF64(12), XMm: 0, YMm: 0, Face: "anchor", Label: "Piloto perno"},
				},
			},
		},
	}
	seedMachiningPlacaBis = &domain.HardwareMachiningProfile{
		Parts: []domain.HardwareMachiningPart{{
			ID: "plate", Role: "plate",
			Operations: []domain.MachiningOperation{
				{ID: "plate-fix-1", Kind: "screw_pilot", DiameterMm: 5, DepthMm: seedF64(10), XMm: 0, YMm: -16, Face: "anchor", Label: "Fijación placa 1"},
				{ID: "plate-fix-2", Kind: "screw_pilot", DiameterMm: 5, DepthMm: seedF64(10), XMm: 0, YMm: 16, Face: "anchor", Label: "Fijación placa 2"},
			},
		}},
	}
)

// SeedCatalog populates the database with plantilla seed data.
// Idempotent — skips full plantilla if materials already exist, but always
// ensures plinth/zoclo catalog entities (option groups, component, demo modules).
func (s *PostgresStore) SeedCatalog(ctx context.Context) error {
	var count int
	err := s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM material_boards`).Scan(&count)
	if err != nil {
		return fmt.Errorf("seed check: %w", err)
	}
	if count > 0 {
		// Existing DB: still upsert zoclo demo entities so upgrades get them.
		return s.ensurePlinthCatalog(ctx)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	now := time.Now().UTC()

	// F179: the seed writes the caller's scoped organization explicitly —
	// 000083 made catalog codes unique per (organization, code) and 000088
	// dropped the transitional DEFAULTs, so bare `code` conflicts and
	// organization-less inserts no longer resolve. CLI callers reach this
	// through the OrgFromCtx fallback (initial organization).
	org := OrgFromCtx(ctx)

	// --- EDGE BANDS ---
	// F116 C3/A4: fractional thickness matching the TS seed (0.5 / 2 / 0).
	for _, e := range []struct {
		id, code, name string
		thickness      float64
		costPerMl      float64
	}{
		{seedEdgeArauco, "CAN-ARA-BLA", "ARAUCO BLANCO", 0.5, 12},
		{seedEdgeMaderado, "CAN-MAD-FRE", "MADERADO FRENTE", 2, 25},
		{seedEdgeMdf, "CAN-MDF-3", "MDF 3MM", 0, 0},
	} {
		_, err = tx.Exec(ctx, `
			INSERT INTO edge_bands (id, organization_id, code, name, thickness_mm, cost_per_ml, active, created_at, updated_at)
			VALUES ($1,$8,$2,$3,$4,$5,true,$6,$7)
			ON CONFLICT (organization_id, code) DO NOTHING`,
			e.id, e.code, e.name, e.thickness, e.costPerMl, now, now, org)
		if err != nil {
			return fmt.Errorf("seed edge %s: %w", e.code, err)
		}
	}

	// --- MATERIAL BOARDS ---
	for _, m := range []struct {
		id, code, name, previewColor string
		w, l, t                       int
		grain                         bool
		boardPrice                    float64
		defaultEdgeID                 string
	}{
		{seedMatArauco, "TAB-ARA-BLA", "ARAUCO BLANCO", "#F5F5F0", 1830, 2440, 15, false, 714.43, seedEdgeArauco},
		{seedMatMaderado, "TAB-MAD-FRE", "MADERADO FRENTE", "#C4A574", 1830, 2440, 18, true, 1294.91, seedEdgeMaderado},
		{seedMatMdf, "TAB-MDF-3", "MDF 3MM", "#8B7355", 1830, 2440, 3, false, 334.89, seedEdgeMdf},
	} {
		_, err = tx.Exec(ctx, `
			INSERT INTO material_boards (id, organization_id, code, name, width_mm, length_mm, thickness_mm, grain_default, board_price, waste_percent, default_edge_band_id, preview_color, active, created_at, updated_at)
			VALUES ($1,$13,$2,$3,$4,$5,$6,$7,$8,0,$9,NULLIF($10,''),true,$11,$12)`,
			m.id, m.code, m.name, m.w, m.l, m.t, m.grain, m.boardPrice, m.defaultEdgeID, m.previewColor, now, now, org)
		if err != nil {
			return fmt.Errorf("seed material %s: %w", m.code, err)
		}
	}

	// --- HARDWARE ---
	// F116 A4: preview_* fields mirror the TS seed (plantillaDemo.ts) so demo
	// herrajes render in 3D in backend mode too — without them they are
	// cost-only and invisible in the scene (VH-09).
	// F127: machining footprints mirror plantillaDemo.ts (parity golden) so
	// the drilling pipeline resolves the same holes in both stacks.
	for _, h := range []struct {
		id, code, name, unit, previewShape, previewColor string
		costPerUnit                                      float64
		sizeMm, diameterMm, projectionMm                 float64
		roughness, metalness                             float64
		machining                                        *domain.HardwareMachiningProfile
	}{
		{seedHwBisagra, "HER-BIS-CL", "Bisagra Cierre Lento", "piece", "hinge", "#9aa0a6", 35, 35, 0, 12, 0.3, 0.85, seedMachiningBisagra},
		{seedHwJaladera, "HER-JAL-INOX", "Jaladera Acero Inox", "piece", "bar-pull", "#c8ccd0", 45, 128, 12, 28, 0.18, 0.9, nil},
		{seedHwPata, "HER-PATA-REG", "Pata Regulable Plastica", "piece", "leg", "#1a1a1a", 15, 120, 30, 0, 0.6, 0.3, nil},
		{seedHwTornillo, "HER-TOR-4X50", "Tornillo 4x50 mm", "piece", "", "", 0.5, 0, 0, 0, 0, 0, seedMachiningTornillo},
		{seedHwCorredera, "HER-CORR-500", "Corredera Telescópica 500mm", "set", "slide", "#6a7080", 120, 500, 18, 0, 0.35, 0.7, nil},
		{seedHwSoporte, "HER-SOP-ENT", "Soporte de Entrepaño", "piece", "", "", 2, 0, 0, 0, 0, 0, nil},
		{seedHwTaquete, "HER-TAQ-8X30", "Taquete Madera 8x30 mm", "piece", "", "", 0.8, 0, 0, 0, 0, 0, seedMachiningTaquete},
		{seedHwMinifix, "HER-MIN-15", "Minifix 15 mm (juego)", "set", "", "", 4.5, 0, 0, 0, 0, 0, seedMachiningMinifix},
		{seedHwPlacaBis, "HER-PLACA-BIS", "Placa Base Bisagra", "piece", "", "", 6, 0, 0, 0, 0, 0, seedMachiningPlacaBis},
		{seedHwZocloPerfil, "HER-ZOC-ALU", "Zoclo perfil aluminio natural", "meter", "", "#c0c5cb", 18, 0, 0, 0, 0, 0, nil},
		{seedHwZocloBronce, "HER-ZOC-BRO", "Zoclo perfil bronce", "meter", "", "#8d6e42", 22, 0, 0, 0, 0, 0, nil},
		{seedHwZocloNegro, "HER-ZOC-NEG", "Zoclo perfil negro", "meter", "", "#2c2f34", 22, 0, 0, 0, 0, 0, nil},
	} {
		_, err = tx.Exec(ctx, `
			INSERT INTO hardwares (id, organization_id, code, name, unit, cost_per_unit, preview_shape, preview_size_mm, preview_diameter_mm, preview_projection_mm, preview_color, preview_roughness, preview_metalness, machining, active, created_at, updated_at)
			VALUES ($1,$16,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,0),NULLIF($8,0),NULLIF($9,0),NULLIF($10,''),NULLIF($11,0),NULLIF($12,0),$13,true,$14,$15)`,
			h.id, h.code, h.name, h.unit, h.costPerUnit, h.previewShape, h.sizeMm, h.diameterMm, h.projectionMm, h.previewColor, h.roughness, h.metalness, hardwareMachiningArg(h.machining), now, now, org)
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
		{seedOGZoclo, "ZOCLO", "Melamina de zoclo", "board", false, []string{seedMatMaderado, seedMatArauco}},
		{seedOGZocloPerfil, "ZOCLO_PERFIL", "Zoclo perfil (ml)", "hardware", false, []string{seedHwZocloPerfil, seedHwZocloBronce, seedHwZocloNegro}},
	} {
		_, err := tx.Exec(ctx, `
			INSERT INTO option_groups (id, organization_id, code, name, kind, required)
			VALUES ($1,$6,$2,$3,$4,$5)`,
			og.id, og.code, og.name, og.kind, og.required, org)
		if err != nil {
			return fmt.Errorf("seed option_group %s: %w", og.code, err)
		}
		for _, eid := range og.optIDs {
			_, err = tx.Exec(ctx, `
				INSERT INTO option_group_members (organization_id, option_group_id, entity_id) VALUES ($1,$2,$3)`,
				org, og.id, eid)
			if err != nil {
				return fmt.Errorf("seed og member %s: %w", og.code, err)
			}
		}
	}

	// --- CUSTOMERS ---
	_, err = tx.Exec(ctx, `INSERT INTO customers (id, organization_id, name, active, created_at, updated_at) VALUES ($1,$5,$2,true,$3,$4)`,
		seedCustPlantilla1, "Cliente Plantilla", now, now, org)
	if err != nil {
		return fmt.Errorf("seed customer 1: %w", err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO customers (id, organization_id, name, active, created_at, updated_at) VALUES ($1,$5,$2,true,$3,$4)`,
		seedCustPlantilla2, "Cliente Demo", now, now, org)
	if err != nil {
		return fmt.Errorf("seed customer 2: %w", err)
	}

	// --- MOD-GAB-01 ---
	err = insertModuleTx(ctx, tx, org, seedModGab, "MOD-GAB-01", "Gabinete 1 Puerta 300 x 720 x 590 mm",
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
	err = insertModuleTx(ctx, tx, org, seedModCaj, "MOD-CAJ-01", "Cajonera 4 Cajones 500 x 720 x 590 mm",
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
		INSERT INTO structures (id, organization_id, code, name, width_mm, height_mm, depth_mm, notes, active, created_at, updated_at)
		VALUES ($1,$10,$2,$3,$4,$5,$6,$7,true,$8,$9)`,
		seedStruct, "EST-COMP-600", "Estructura Compuesta 600",
		600, 720, 560, "", now, now, org)
	if err != nil {
		return fmt.Errorf("seed structure: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO structure_presets (id, organization_id, structure_id, name, width_mm, height_mm, depth_mm)
		VALUES ($1,$7,$2,$3,$4,$5,$6)`,
		seedStructPre, seedStruct, "Ancho 600", 600, 720, 560, org)
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
		INSERT INTO components (id, organization_id, code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm, default_edges, option_roles, active, created_at, updated_at)
		VALUES ($1,$13,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12)
		ON CONFLICT (organization_id, code) DO NOTHING`,
		seedCompPuerta, "COM-PUE-01", "Puerta", "puerta", "rectangular_board",
		717, 296, 18, allEdges, []string{"FRENTE"}, now, now, org)
	if err != nil {
		return fmt.Errorf("seed component puerta: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO components (id, organization_id, code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm, default_edges, option_roles, active, created_at, updated_at)
		VALUES ($1,$13,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12)
		ON CONFLICT (organization_id, code) DO NOTHING`,
		seedCompEntrepano, "COM-ENT-01", "Entrepaño Regulable", "interno", "rectangular_board",
		462, 550, 15, wOnlyEdges, []string{"INTERIOR"}, now, now, org)
	if err != nil {
		return fmt.Errorf("seed component entrepano: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO components (id, organization_id, code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm, default_edges, option_roles, active, created_at, updated_at)
		VALUES ($1,$13,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12)
		ON CONFLICT (organization_id, code) DO NOTHING`,
		seedCompCostado, "COM-COS-01", "Costado Lateral", "lateral_izquierdo", "rectangular_board",
		720, 560, 18, noEdges, []string{"INTERIOR"}, now, now, org)
	if err != nil {
		return fmt.Errorf("seed component costado: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO components (id, organization_id, code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm, default_edges, option_roles, active, created_at, updated_at)
		VALUES ($1,$13,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12)
		ON CONFLICT (organization_id, code) DO NOTHING`,
		seedCompBase, "COM-BAS-01", "Base Estructura", "base", "rectangular_board",
		564, 560, 18, noEdges, []string{"INTERIOR"}, now, now, org)
	if err != nil {
		return fmt.Errorf("seed component base: %w", err)
	}
	// Frontal melamine plinth (zoclo): PW × B, role ZOCLO.
	frontEdgeOnly, _ := json.Marshal([]domain.EdgeAssignment{
		{Side: "L1", Enabled: true}, {Side: "L2", Enabled: false},
		{Side: "W1", Enabled: false}, {Side: "W2", Enabled: false},
	})
	_, err = tx.Exec(ctx, `
		INSERT INTO components (id, organization_id, code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm,
			length_formula, width_formula, x_formula, y_formula, z_formula,
			default_edges, option_roles, active, created_at, updated_at)
		VALUES ($1,$18,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true,$16,$17)
		ON CONFLICT (organization_id, code) DO NOTHING`,
		seedCompZoclo, "COM-ZOC-01", "Zoclo frontal", "custom", "rectangular_board",
		600, 100, 18, "PW", "B", "0", "0", "0",
		frontEdgeOnly, []string{"ZOCLO"}, now, now, org)
	if err != nil {
		return fmt.Errorf("seed component zoclo: %w", err)
	}

	// --- LINK STRUCTURE ↔ COMPONENTS (F053) ---
	// The structure body composes costado×2 + base×1; doors/shelves are added
	// per-module (below) so different modules can share the same body.
	_, err = tx.Exec(ctx, `
		INSERT INTO structure_components (organization_id, structure_id, component_id, quantity, placement_override)
		VALUES ($5,$1,$2,$3,$4)`,
		seedStruct, seedCompCostado, 2, "lateral_izquierdo", org)
	if err != nil {
		return fmt.Errorf("seed structure_components costado: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO structure_components (organization_id, structure_id, component_id, quantity, placement_override)
		VALUES ($5,$1,$2,$3,$4)`,
		seedStruct, seedCompBase, 1, "base", org)
	if err != nil {
		return fmt.Errorf("seed structure_components base: %w", err)
	}

	// --- COMPOSED MODULE (references structure + module-level components) ---
	err = insertModuleTx(ctx, tx, org, seedModComp, "MOD-COMP-001", "Gabinete Compuesto 600",
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
		INSERT INTO module_components (organization_id, module_id, component_id, quantity, placement_override)
		VALUES ($5,$1,$2,$3,$4)`,
		seedModComp, seedCompPuerta, 1, "puerta", org)
	if err != nil {
		return fmt.Errorf("seed module_components puerta: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO module_components (organization_id, module_id, component_id, quantity, placement_override)
		VALUES ($5,$1,$2,$3,$4)`,
		seedModComp, seedCompEntrepano, 2, "interno", org)
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
			INSERT INTO module_presets (organization_id, module_id, name, width_mm, height_mm, depth_mm)
			VALUES ($6,$1,$2,$3,$4,$5)`,
			seedModComp, pr.name, pr.w, pr.h, pr.d, org)
		if err != nil {
			return fmt.Errorf("seed module_presets %s: %w", pr.name, err)
		}
	}

	// --- PLINTH DEMO MODULES (zoclo melamina + perfil) ---
	if err := seedPlinthModulesTx(ctx, tx, org, now); err != nil {
		return err
	}

	// --- DEMO PROJECT ---
	_, err = tx.Exec(ctx, `
		INSERT INTO projects (id, organization_id, name, customer_id, currency, margin_factor, labor_fixed_cost, status, created_at, updated_at)
		VALUES ($1,$10,$2,$3,$4,$5,$6,$7,$8,$9)`,
		seedProj, "Demo plantilla", seedCustPlantilla2,
		"MXN", 1.35, 1200, "draft", now, now, org)
	if err != nil {
		return fmt.Errorf("seed project: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO project_items (id, organization_id, project_id, module_id, quantity)
		VALUES ($1,$5,$2,$3,$4)`,
		seedProjItem, seedProj, seedModGab, 1, org)
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
			INSERT INTO project_item_choices (organization_id, project_item_id, option_group_code, choice_entity_id)
			VALUES ($1,$2,$3,$4)`,
			org, seedProjItem, optGroup, choiceEntity)
		if err != nil {
			return fmt.Errorf("seed project item choice %s: %w", optGroup, err)
		}
	}

	// #110 / H15: seed a "Cocina estándar 3 m" project template. Items stored
	// as JSONB (mirrors the table shape). 2 gabinetes + 1 cajonera, defaults
	// inferiores (depth 590). Idempotent: skip if a template row exists.
	var templateCount int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM project_templates WHERE organization_id = $1`, org).Scan(&templateCount); err != nil {
		return fmt.Errorf("seed template count: %w", err)
	}
	if templateCount == 0 {
		itemsJSON := fmt.Sprintf(`[
			{"id":"%s","module_id":"%s","quantity":2,"option_choices":{"INTERIOR":"%s","FRENTE":"%s","FONDO":"%s","BISAGRA":"%s"}},
			{"id":"%s","module_id":"%s","quantity":1,"option_choices":{"INTERIOR":"%s","FRENTE":"%s","FONDO":"%s","BISAGRA":"%s"}}
		]`, "tmpl-item-1", seedModGab, seedMatArauco, seedMatMaderado, seedMatMdf, seedHwBisagra,
			"tmpl-item-2", seedModCaj, seedMatArauco, seedMatMaderado, seedMatMdf, seedHwBisagra)
		measureDefaults := `{"inferior":{"depth":590,"height":720}}`
		_, err = tx.Exec(ctx, `
			INSERT INTO project_templates (id, organization_id, name, currency, margin_factor, labor_fixed_cost, measure_defaults, items, notes, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
			seedProjectTemplate, org,
			"Cocina estándar 3 m",
			"MXN", 1.35, 1200.0,
			measureDefaults,
			itemsJSON,
			"Plantilla demo: 2 gabinetes + 1 cajonera (inferiores).",
		)
		if err != nil {
			return fmt.Errorf("seed project template: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	// Also run ensure for any plinth bits that use ON CONFLICT paths.
	return s.ensurePlinthCatalog(ctx)
}

// ensurePlinthCatalog upserts zoclo option groups, profile hardware, component,
// and demo modules. Safe on existing DBs (seed early-return path).
func (s *PostgresStore) ensurePlinthCatalog(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	now := time.Now().UTC()
	org := OrgFromCtx(ctx)

	// Hardware profiles (ml), package 4 m bars. Catalog-driven finishes:
	// aluminio / bronce / negro — the workshop manages its own from here.
	for _, hw := range []struct {
		id, code, name, previewColor string
		cost                         float64
	}{
		{seedHwZocloPerfil, "HER-ZOC-ALU", "Zoclo perfil aluminio natural", "#c0c5cb", 18.0},
		{seedHwZocloBronce, "HER-ZOC-BRO", "Zoclo perfil bronce", "#8d6e42", 22.0},
		{seedHwZocloNegro, "HER-ZOC-NEG", "Zoclo perfil negro", "#2c2f34", 22.0},
	} {
		_, err = tx.Exec(ctx, `
			INSERT INTO hardwares (id, organization_id, code, name, unit, cost_per_unit, package_size, preview_color, notes, active, created_at, updated_at)
			VALUES ($1,$9,$2,$3,'meter',$4,4.0,NULLIF($5,''),$6,true,$7,$8)
			ON CONFLICT (organization_id, code) DO NOTHING`,
			hw.id, hw.code, hw.name, hw.cost, hw.previewColor,
			"Barra comercial 4 m — lista de compra redondea a barras.",
			now, now, org)
		if err != nil {
			return fmt.Errorf("ensure plinth hardware: %w", err)
		}
	}

	// Resolve material ids for option group members (may differ if not seed UUIDs).
	var matFrente, matInterior string
	_ = tx.QueryRow(ctx, `SELECT id FROM material_boards WHERE code = 'TAB-MAD-FRE' AND organization_id = $1 LIMIT 1`, org).Scan(&matFrente)
	_ = tx.QueryRow(ctx, `SELECT id FROM material_boards WHERE code = 'TAB-ARA-BLA' AND organization_id = $1 LIMIT 1`, org).Scan(&matInterior)
	if matFrente == "" {
		matFrente = seedMatMaderado
	}
	if matInterior == "" {
		matInterior = seedMatArauco
	}

	for _, og := range []struct {
		id, code, name, kind string
		required             bool
		optIDs               []string
	}{
		{seedOGZoclo, "ZOCLO", "Melamina de zoclo", "board", false, []string{matFrente, matInterior}},
		{seedOGZocloPerfil, "ZOCLO_PERFIL", "Zoclo perfil (ml)", "hardware", false, []string{seedHwZocloPerfil, seedHwZocloBronce, seedHwZocloNegro}},
	} {
		_, err = tx.Exec(ctx, `
			INSERT INTO option_groups (id, organization_id, code, name, kind, required)
			VALUES ($1,$6,$2,$3,$4,$5)
			ON CONFLICT (organization_id, code) DO UPDATE SET
				name = EXCLUDED.name,
				kind = EXCLUDED.kind,
				required = EXCLUDED.required`,
			og.id, og.code, og.name, og.kind, og.required, org)
		if err != nil {
			return fmt.Errorf("ensure og %s: %w", og.code, err)
		}
		var ogID string
		if err := tx.QueryRow(ctx, `SELECT id FROM option_groups WHERE code = $1 AND organization_id = $2`, og.code, org).Scan(&ogID); err != nil {
			return fmt.Errorf("ensure og id %s: %w", og.code, err)
		}
		for _, eid := range og.optIDs {
			if eid == "" {
				continue
			}
			_, err = tx.Exec(ctx, `
				INSERT INTO option_group_members (organization_id, option_group_id, entity_id)
				VALUES ($3,$1,$2) ON CONFLICT DO NOTHING`,
				ogID, eid, org)
			if err != nil {
				return fmt.Errorf("ensure og member %s: %w", og.code, err)
			}
		}
	}

	frontEdgeOnly, _ := json.Marshal([]domain.EdgeAssignment{
		{Side: "L1", Enabled: true}, {Side: "L2", Enabled: false},
		{Side: "W1", Enabled: false}, {Side: "W2", Enabled: false},
	})
	_, err = tx.Exec(ctx, `
		INSERT INTO components (id, organization_id, code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm,
			length_formula, width_formula, x_formula, y_formula, z_formula,
			default_edges, option_roles, active, created_at, updated_at)
		VALUES ($1,$18,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true,$16,$17)
		ON CONFLICT (organization_id, code) DO UPDATE SET
			name = EXCLUDED.name,
			length_formula = EXCLUDED.length_formula,
			width_formula = EXCLUDED.width_formula,
			option_roles = EXCLUDED.option_roles,
			updated_at = EXCLUDED.updated_at`,
		seedCompZoclo, "COM-ZOC-01", "Zoclo frontal", "custom", "rectangular_board",
		600, 100, 18, "PW", "B", "0", "0", "0",
		frontEdgeOnly, []string{"ZOCLO"}, now, now, org)
	if err != nil {
		return fmt.Errorf("ensure component zoclo: %w", err)
	}

	if err := seedPlinthModulesTx(ctx, tx, org, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func seedPlinthModulesTx(ctx context.Context, tx pgx.Tx, org string, now time.Time) error {
	// Prefer existing composed structure if present.
	structID := seedStruct
	var existingStruct string
	if err := tx.QueryRow(ctx, `SELECT id FROM structures WHERE code = 'EST-COMP-600' AND organization_id = $1 LIMIT 1`, org).Scan(&existingStruct); err == nil && existingStruct != "" {
		structID = existingStruct
	}

	var compZocloID, compPuertaID, hwZocloID string
	_ = tx.QueryRow(ctx, `SELECT id FROM components WHERE code = 'COM-ZOC-01' AND organization_id = $1 LIMIT 1`, org).Scan(&compZocloID)
	_ = tx.QueryRow(ctx, `SELECT id FROM components WHERE code = 'COM-PUE-01' AND organization_id = $1 LIMIT 1`, org).Scan(&compPuertaID)
	_ = tx.QueryRow(ctx, `SELECT id FROM hardwares WHERE code = 'HER-ZOC-ALU' AND organization_id = $1 LIMIT 1`, org).Scan(&hwZocloID)
	if compZocloID == "" {
		compZocloID = seedCompZoclo
	}
	if compPuertaID == "" {
		compPuertaID = seedCompPuerta
	}
	if hwZocloID == "" {
		hwZocloID = seedHwZocloPerfil
	}

	// Melamina zoclo module
	b := 100
	_, err := tx.Exec(ctx, `
		INSERT INTO modules (id, organization_id, code, name, base_labor_cost, width_mm, height_mm, depth_mm, notes,
			furniture_type, structure_id, base_mode, base_clearance_mm, created_at, updated_at)
		VALUES ($1,$13,$2,$3,$4,$5,$6,$7,$8,'inferior',$9,'plinth_board',$10,$11,$12)
		ON CONFLICT (organization_id, code) DO UPDATE SET
			name = EXCLUDED.name,
			base_mode = EXCLUDED.base_mode,
			base_clearance_mm = EXCLUDED.base_clearance_mm,
			structure_id = EXCLUDED.structure_id,
			updated_at = EXCLUDED.updated_at`,
		seedModBajoZoclo, "MOD-BAJO-ZOCLO-600", "Bajo 600 con zoclo melamina",
		0, 600, 720, 560,
		"Demo zoclo melamina: baseMode=plinth_board, B=100, COM-ZOC-01 (rol ZOCLO → fallback FRENTE).",
		structID, b, now, now, org)
	if err != nil {
		return fmt.Errorf("seed module bajo zoclo: %w", err)
	}
	var modZocloID string
	if err := tx.QueryRow(ctx, `SELECT id FROM modules WHERE code = 'MOD-BAJO-ZOCLO-600' AND organization_id = $1`, org).Scan(&modZocloID); err != nil {
		return err
	}
	// Replace module components (idempotent)
	if _, err := tx.Exec(ctx, `DELETE FROM module_components WHERE module_id = $1`, modZocloID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO module_components (organization_id, module_id, component_id, quantity, placement_override)
		VALUES ($4,$1,$2,1,'puerta'), ($4,$1,$3,1,'custom')`,
		modZocloID, compPuertaID, compZocloID, org); err != nil {
		return fmt.Errorf("seed module_components zoclo: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM hardware_lines WHERE module_id = $1`, modZocloID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO hardware_lines (organization_id, module_id, quantity, option_role)
		VALUES ($2, $1, 2, 'BISAGRA')`, modZocloID, org); err != nil {
		return fmt.Errorf("seed hw lines zoclo: %w", err)
	}

	// Perfil (ml) module
	_, err = tx.Exec(ctx, `
		INSERT INTO modules (id, organization_id, code, name, base_labor_cost, width_mm, height_mm, depth_mm, notes,
			furniture_type, structure_id, base_mode, base_clearance_mm, created_at, updated_at)
		VALUES ($1,$13,$2,$3,$4,$5,$6,$7,$8,'inferior',$9,'plinth_strip',$10,$11,$12)
		ON CONFLICT (organization_id, code) DO UPDATE SET
			name = EXCLUDED.name,
			base_mode = EXCLUDED.base_mode,
			base_clearance_mm = EXCLUDED.base_clearance_mm,
			structure_id = EXCLUDED.structure_id,
			updated_at = EXCLUDED.updated_at`,
		seedModBajoPerfil, "MOD-BAJO-PERFIL-600", "Bajo 600 con zoclo perfil (ml)",
		0, 600, 720, 560,
		"Demo zoclo perfil: baseMode=plinth_strip; herraje HER-ZOC-ALU en ml = W/1000.",
		structID, b, now, now, org)
	if err != nil {
		return fmt.Errorf("seed module bajo perfil: %w", err)
	}
	var modPerfilID string
	if err := tx.QueryRow(ctx, `SELECT id FROM modules WHERE code = 'MOD-BAJO-PERFIL-600' AND organization_id = $1`, org).Scan(&modPerfilID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM module_components WHERE module_id = $1`, modPerfilID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO module_components (organization_id, module_id, component_id, quantity, placement_override)
		VALUES ($3,$1,$2,1,'puerta')`,
		modPerfilID, compPuertaID, org); err != nil {
		return fmt.Errorf("seed module_components perfil: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM hardware_lines WHERE module_id = $1`, modPerfilID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO hardware_lines (organization_id, module_id, quantity, option_role, hardware_id, description_override)
		VALUES ($3, $1, 2, 'BISAGRA', NULL, NULL),
		       ($3, $1, 1, 'ZOCLO_PERFIL', $2, 'Zoclo perfil (ml frontal)')`,
		modPerfilID, hwZocloID, org); err != nil {
		return fmt.Errorf("seed hw lines perfil: %w", err)
	}
	return nil
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

func insertModuleTx(ctx context.Context, tx pgx.Tx, org, id, code, name string, baseLaborCost, w, h, d int,
	notes string, now time.Time, parts []boardPartSeed, hwLines []hwLineSeed) error {

	var notesArg interface{} = nil
	if notes != "" {
		notesArg = notes
	}

	// All seed modules are base cabinets (inferior). furniture_type defaults to
	// '' → 'inferior' on read (#109). Explicit here for clarity.
	_, err := tx.Exec(ctx, `
		INSERT INTO modules (id, organization_id, code, name, base_labor_cost, width_mm, height_mm, depth_mm, notes, furniture_type, created_at, updated_at)
		VALUES ($1,$11,$2,$3,$4,$5,$6,$7,$8,'inferior',$9,$10)`,
		id, code, name, baseLaborCost, w, h, d, notesArg, now, now, org)
	if err != nil {
		return fmt.Errorf("seed module %s: %w", code, err)
	}

	for _, p := range parts {
		_, err := tx.Exec(ctx, `
			INSERT INTO board_parts (id, organization_id, module_id, code, description, quantity, length_mm, width_mm, option_role, edge_l1, edge_l2, edge_w1, edge_w2)
			VALUES ($1,$13,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			p.id, id, p.code, p.desc, p.qty, p.len, p.wid, p.role,
			p.l1, p.l2, p.w1, p.w2, org)
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
			INSERT INTO hardware_lines (id, organization_id, module_id, quantity, description_override, option_role, hardware_id)
			VALUES ($1,$7,$2,$3,$4,$5,$6)`,
			hl.id, id, hl.qty, hl.descOverride, hl.optRole, hwIDArg, org)
		if err != nil {
			return fmt.Errorf("seed hw line %s->%s: %w", code, hl.id, err)
		}
	}

	return nil
}
