package storage_test

import (
	"context"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1136 — PG real: the grip migration's override scan finds exactly the
// module agregado option overrides selecting a legacy gola handle, is
// org-scoped, and tolerates modules without agregados. Read-only by
// contract: the migration reports these, it never rewrites them.
//
// The test shares the initial organization with org-wide golden
// projections, so every fixture row registers a cleanup and never leaks
// into later tests.
func TestScanModuleAgregadoOverrides(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	suffix := time.Now().Format("150405.000000")

	moduleIDs := []string{
		"11111336-0000-0000-0000-000000000001",
		"11111336-0000-0000-0000-000000000002",
		"11111336-0000-0000-0000-000000000003",
	}
	structureID := "11111336-0000-0000-0000-000000000009"
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, `DELETE FROM modules WHERE id = ANY($1)`, moduleIDs)
		cleanupConnectStoreFixture(t, `DELETE FROM structures WHERE id = $1`, structureID)
	})

	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		// Foreign keys need a real structure row for the modules (UUID PK).
		structure := domain.Structure{
			ID:      structureID,
			Code:    "ST-1136-" + suffix,
			Name:    "Estructura scan 1136",
			WidthMm: 600, HeightMm: 720, DepthMm: 560,
		}
		if err := store.CreateStructure(txCtx, &structure); err != nil {
			return err
		}

		withGola := &domain.Module{
			ID:          moduleIDs[0],
			Code:        "MOD-1136-GOLA-" + suffix,
			Name:        "Módulo con gola legada",
			StructureID: structure.ID,
			Agregados: []domain.ModuleAgregadoInstance{{
				ID:              "agr-1136-a",
				AgregadoID:      "agr-def-puerta",
				Quantity:        1,
				OptionOverrides: map[string]string{"JALADERA": "jaladera-gola-256"},
			}},
		}
		if err := store.CreateModule(txCtx, withGola); err != nil {
			return err
		}
		withoutAgregados := &domain.Module{
			ID:          moduleIDs[1],
			Code:        "MOD-1136-VACIO-" + suffix,
			Name:        "Módulo sin agregados",
			StructureID: structure.ID,
		}
		if err := store.CreateModule(txCtx, withoutAgregados); err != nil {
			return err
		}
		otherValue := &domain.Module{
			ID:          moduleIDs[2],
			Code:        "MOD-1136-OTRO-" + suffix,
			Name:        "Módulo con jaladera común",
			StructureID: structure.ID,
			Agregados: []domain.ModuleAgregadoInstance{{
				ID:              "agr-1136-b",
				AgregadoID:      "agr-def-puerta",
				Quantity:        1,
				OptionOverrides: map[string]string{"JALADERA": "HER-JAL-INOX"},
			}},
		}
		return store.CreateModule(txCtx, otherValue)
	})

	var hits []storage.OpeningGripOverrideHit
	var scanErr error
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		hits, scanErr = store.ScanModuleAgregadoOverrides(txCtx, "jaladera-gola%")
		return scanErr
	})
	if scanErr != nil {
		t.Fatalf("scan: %v", scanErr)
	}
	found := 0
	for _, hit := range hits {
		if hit.ModuleID != moduleIDs[0] {
			continue
		}
		found++
		if hit.OptionRole != "JALADERA" || hit.Value != "jaladera-gola-256" || hit.AgregadoID != "agr-1136-a" {
			t.Fatalf("hit drifted: %+v", hit)
		}
		if hit.ModuleCode == "" {
			t.Fatal("the hit must carry the module code for the review report")
		}
	}
	if found != 1 {
		t.Fatalf("hits for the gola module = %d, want 1 (all: %+v)", found, hits)
	}
}
