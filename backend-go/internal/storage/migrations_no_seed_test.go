package storage_test

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

// F180: obligar a que las migraciones NUNCA inserten datos de negocio o demo
// (materiales, componentes, módulos, clientes, cotizaciones…). Una base fresca
// tras RunMigrations contiene schema + la organización inicial estructural y
// nada más. Los datos demo se siembran exclusivamente con el comando explícito
// (`cmd/admin seed` / `POST /api/seed`) — docs/deployment.md §4.5. Sin este
// pin, un INSERT "inofensivo" en una migración obligatoria vuelve a llenar de
// basura las bases de prueba de todos.
func TestMigrations_NoBusinessData(t *testing.T) {
	pool := multiOrgFreshDB(t)
	store := &storage.PostgresStore{Pool: pool}
	if err := store.RunMigrations(context.Background()); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	ctx := context.Background()

	zero := []string{
		// Catálogo
		"material_categories", "module_categories", "ambient_categories",
		"material_boards", "edge_bands", "hardwares", "components", "agregados",
		"option_groups", "option_group_members",
		"structures", "structure_presets", "structure_components", "structure_revisions",
		"modules", "board_parts", "hardware_lines", "module_components", "module_presets",
		"ambient_materials",
		// CRM / cotizaciones
		"customers", "projects", "project_items", "project_item_choices",
		"project_events", "project_photos", "project_templates",
		"project_internal_messages", "project_level_choices",
		"warranty_tickets", "warranty_ticket_photos",
		// Compras / almacén / producción
		"suppliers", "purchase_orders", "purchase_order_items",
		"material_stock", "stock_movements", "project_picking",
		"production_activities", "damage_reports",
		// Identidad (los usuarios se crean por registro/invitación/CLI, nunca por migración)
		"users", "memberships", "invitations", "user_sectors", "support_sessions",
	}
	for _, table := range zero {
		var n int
		if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM `+table).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if n != 0 {
			t.Fatalf("la migración insertó datos de negocio: %s tiene %d filas tras un RunMigrations fresco — el seed demo es un comando explícito (cmd/admin seed / POST /api/seed)", table, n)
		}
	}

	// Excepciones ESTRUCTURALES (no son ítems de negocio):
	// - organizations: exactamente la organización inicial determinística que
	//   ancla el modelo multi-org (000081); sin ella los FK de installaciones
	//   single-tenant no resuelven.
	var orgs int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM organizations`).Scan(&orgs); err != nil {
		t.Fatalf("count organizations: %v", err)
	}
	if orgs != 1 {
		t.Fatalf("organizaciones tras migrar: %d (quiero exactamente 1: la inicial estructural)", orgs)
	}

	// - workshop_settings: a lo sumo el singleton de defaults de fábrica
	//   (000013) — es configuración, no un ítem, y GetWorkshopSettings lo
	//   recrea lazy con los mismos defaults de todos modos.
	var settings int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM workshop_settings`).Scan(&settings); err != nil {
		t.Fatalf("count workshop_settings: %v", err)
	}
	if settings > 1 {
		t.Fatalf("workshop_settings tras migrar: %d (a lo sumo 1 singleton de defaults)", settings)
	}
}
