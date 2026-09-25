package storage_test

import (
	"context"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// F116 C3: fractional edge thickness (0.4/0.5/0.8 mm) must round-trip — the
// old INT column + CHECK (> 0) rejected the TS default 0.5 and seed value 0.
func TestEdgeBand_FractionalThicknessRoundTrip(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor

	for _, thickness := range []float64{0.5, 0.8, 0, 2} {
		e := &domain.EdgeBand{
			ID:          uuidv4(t),
			Code:        uniqueID("TEST-EDGE-F116"),
			Name:        "Test edge F116",
			ThicknessMm: thickness,
			CostPerMl:   1.5,
			Active:      true,
		}
		withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
			return store.CreateEdgeBand(txCtx, e)
		})
		got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.EdgeBand, error) {
			return store.GetEdgeBandByID(txCtx, e.ID)
		})
		if got.ThicknessMm != thickness {
			t.Fatalf("thickness round-trip: want %v, got %v", thickness, got.ThicknessMm)
		}
	}
}

// F116 C4: deleteAgregado hard-deletes unreferenced rows and refuses rows
// still referenced from a module's agregados JSONB.
func TestAgregado_HardDeleteWithUseGuard(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	a := domain.Agregado{
		ID:       uniqueID("agr-f116"),
		Code:     uniqueID("TEST-AGG-F116"),
		Name:     "Test agregado F116",
		WidthMm:  600,
		HeightMm: 400,
		DepthMm:  500,
		Active:   true,
	}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateAgregado(txCtx, &a)
	})

	mod := &domain.Module{
		Code: uniqueID("TEST-MOD-F116-AGG"),
		Name: "Test module F116",
		Agregados: []domain.ModuleAgregadoInstance{{
			ID: "i1", AgregadoID: a.ID, Quantity: 1,
		}},
	}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateModule(txCtx, mod)
	})

	ctx := context.Background()
	err := store.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
		return store.DeleteAgregado(txCtx, a.ID)
	})
	if err == nil {
		t.Fatal("delete of in-use agregado must fail")
	}
	if got := err.Error(); !strings.Contains(got, "in use") {
		t.Fatalf("want in-use error, got: %s", got)
	}

	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.DeleteModule(txCtx, mod.ID)
	})
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.DeleteAgregado(txCtx, a.ID)
	})

	err = store.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
		_, err := store.GetAgregadoByID(txCtx, a.ID)
		return err
	})
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("get hard-deleted agregado err = %v, want not found", err)
	}
}
