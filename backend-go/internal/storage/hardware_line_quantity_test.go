package storage_test

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #442: hardware_lines.quantity widened INT → DOUBLE PRECISION so the zoclo
// strip profile's fractional meter consumption (TS HardwareLine.quantity is a
// number) survives the round-trip. Pins the column type AND the store
// write/read path for a fractional line.
func TestHardwareLineQuantityDoublePrecision(t *testing.T) {
	pool := multiOrgFreshDB(t)
	store := &storage.PostgresStore{Pool: pool}
	if err := store.RunMigrations(context.Background()); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)

	var dataType string
	if err := pool.QueryRow(context.Background(), `
		SELECT data_type FROM information_schema.columns
		WHERE table_name = 'hardware_lines' AND column_name = 'quantity'`,
	).Scan(&dataType); err != nil {
		t.Fatalf("read column type: %v", err)
	}
	if dataType != "double precision" {
		t.Fatalf("hardware_lines.quantity debe ser double precision tras 000104 (got %q)", dataType)
	}

	// Write + read a module carrying a fractional strip line (0.6 ml).
	// Foreign keys need a real hardware + org-scoped module row.
	if err := store.SeedCatalog(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}
	var hardwareID, structureID string
	if err := pool.QueryRow(context.Background(),
		`SELECT id FROM hardwares LIMIT 1`).Scan(&hardwareID); err != nil {
		t.Fatalf("find a seeded hardware: %v", err)
	}
	if err := pool.QueryRow(context.Background(),
		`SELECT id FROM structures LIMIT 1`).Scan(&structureID); err != nil {
		t.Fatalf("find a seeded structure: %v", err)
	}

	module := &domain.Module{
		ID:          "11111111-4442-0000-0000-000000000001",
		Code:        "MOD-442-FRAC",
		Name:        "Bajo perfil fraccional 442",
		StructureID: structureID,
		BaseMode:    "plinth_strip",
		HardwareLines: []domain.HardwareLine{{
			ID:         "hl-442-perfil",
			Quantity:   0.6,
			OptionRole: "ZOCLO_PERFIL",
			HardwareID: hardwareID,
		}},
	}
	if err := store.CreateModule(ctx, module); err != nil {
		t.Fatalf("create module: %v", err)
	}

	catalog, err := store.GetFullCatalog(ctx)
	if err != nil {
		t.Fatalf("get full catalog: %v", err)
	}
	// El store genera UUIDs para ids no-UUID: matchear por rol.
	var found *domain.HardwareLine
	for i := range catalog.Modules {
		if catalog.Modules[i].Code != "MOD-442-FRAC" {
			continue
		}
		for j := range catalog.Modules[i].HardwareLines {
			if catalog.Modules[i].HardwareLines[j].OptionRole == "ZOCLO_PERFIL" {
				found = &catalog.Modules[i].HardwareLines[j]
			}
		}
	}
	if found == nil {
		t.Fatal("el módulo MOD-442-FRAC no volvió del catálogo con su línea ZOCLO_PERFIL")
	}
	if found.Quantity != 0.6 {
		t.Fatalf("cantidad fraccional no preservada: got %v, want 0.6", found.Quantity)
	}
	if found.HardwareID != hardwareID {
		t.Fatalf("hardware id no preservado: got %v, want %v", found.HardwareID, hardwareID)
	}
}
