package storage

import (
	"context"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1136 — PG real: the grip migration's override scan finds exactly the
// module agregado option overrides selecting a legacy gola handle, is
// org-scoped, and tolerates modules without agregados. Read-only by
// contract: the migration reports these, it never rewrites them.
func TestScanModuleAgregadoOverrides(t *testing.T) {
	store := newMigratedRuntimeStore(t)
	suffix := time.Now().Format("150405.000000")

	withinInitialOrganization(t, store, func(txCtx context.Context) error {
		// Foreign keys need a real structure row for the modules (UUID PK).
		structure := domain.Structure{
			ID:      "11111336-0000-0000-0000-000000000009",
			Code:    uniqueStructureCode("ST-1136"),
			Name:    "Estructura scan 1136",
			WidthMm: 600, HeightMm: 720, DepthMm: 560,
		}
		if err := store.CreateStructure(txCtx, &structure); err != nil {
			return err
		}

		withGola := &domain.Module{
			ID:          "11111336-0000-0000-0000-000000000001",
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
			ID:          "11111336-0000-0000-0000-000000000002",
			Code:        "MOD-1136-VACIO-" + suffix,
			Name:        "Módulo sin agregados",
			StructureID: structure.ID,
		}
		if err := store.CreateModule(txCtx, withoutAgregados); err != nil {
			return err
		}
		otherValue := &domain.Module{
			ID:          "11111336-0000-0000-0000-000000000003",
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

	var hits []OpeningGripOverrideHit
	var scanErr error
	withinInitialOrganization(t, store, func(txCtx context.Context) error {
		hits, scanErr = store.ScanModuleAgregadoOverrides(txCtx, legacyScanTestPrefix())
		return scanErr
	})
	if scanErr != nil {
		t.Fatalf("scan: %v", scanErr)
	}
	found := 0
	for _, hit := range hits {
		if hit.ModuleID != "11111336-0000-0000-0000-000000000001" {
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

func legacyScanTestPrefix() string { return "jaladera-gola%" }
