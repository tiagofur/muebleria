package storage_test

import (
	"context"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1394 — hardware_lines.component_id (vínculo por-copia a un componente)
// debe round-trippear por el mismo Create/Update/Get de módulos que el resto
// de la línea, y fallar EN VOZ ALTA contra el FK cuando el componente no
// existe: NULL silencioso convertiría una línea por-copia en fija y el BOM
// dejaría de escalar con N sin ningún error visible.

func hcsComponent(t *testing.T) string {
	t.Helper()
	componentID := uuid858()
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM components WHERE id = $1`, componentID) })
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateComponent(txCtx, &domain.Component{
			ID: componentID, Code: uniqueID("ENT"), Name: "Entrepaño 1394",
			Placement: domain.PlacementInterno, GeometryKind: "rectangular_board",
			LengthMm: 564, WidthMm: 514, ThicknessMm: 18,
		})
	})
	return componentID
}

func hcsModule(t *testing.T, store *storage.PostgresStore, componentID string, linkSecondLine bool) *domain.Module {
	t.Helper()
	mod := &domain.Module{
		ID:      uuid858(),
		Code:    uniqueID("DES-1394"),
		Name:    "Despensa 1394",
		WidthMm: 600, HeightMm: 2000, DepthMm: 550,
		// OptionRole-only lines keep hardware_id NULL (no hardware FK
		// fixture needed): the subject is the component link.
		HardwareLines: []domain.HardwareLine{
			{ID: uuid858(), Quantity: 4, OptionRole: "SOPORTE", ComponentID: componentID},
			{ID: uuid858(), Quantity: 2, OptionRole: "TIRADOR"},
		},
	}
	if linkSecondLine {
		mod.HardwareLines[1].ComponentID = componentID
	}
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM modules WHERE id = $1`, mod.ID) })
	actor := connectStoreInitialActor
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateModule(txCtx, mod)
	})
	return mod
}

func TestHardwareLineComponentLinkRoundTrip(t *testing.T) {
	componentID := hcsComponent(t)
	store, _ := migratedConnectStore(t)
	mod := hcsModule(t, store, componentID, false)

	read := withinConnectStoreTenantValue(t, store, connectStoreInitialActor, func(txCtx context.Context) (*domain.Module, error) {
		return store.GetModuleByID(txCtx, mod.ID)
	})
	if len(read.HardwareLines) != 2 {
		t.Fatalf("hardware lines = %d, want 2", len(read.HardwareLines))
	}
	if read.HardwareLines[0].ComponentID != componentID {
		t.Fatalf("linked line lost component_id: got %q want %q", read.HardwareLines[0].ComponentID, componentID)
	}
	if read.HardwareLines[1].ComponentID != "" {
		t.Fatalf("unlinked line gained component_id: %q", read.HardwareLines[1].ComponentID)
	}

	// Update path (delete + reinsert): adding the link to the second line
	// must persist exactly the same way.
	mod.HardwareLines[1].ComponentID = componentID
	withinConnectStoreTenant(t, store, connectStoreInitialActor, func(txCtx context.Context) error {
		return store.UpdateModule(txCtx, mod.ID, read.Version, mod)
	})
	updated := withinConnectStoreTenantValue(t, store, connectStoreInitialActor, func(txCtx context.Context) (*domain.Module, error) {
		return store.GetModuleByID(txCtx, mod.ID)
	})
	for _, line := range updated.HardwareLines {
		if line.ComponentID != componentID {
			t.Fatalf("updated line %s lost component_id: got %q", line.ID, line.ComponentID)
		}
	}

	// The catalog-full read shares the same column set.
	catalog := withinConnectStoreTenantValue(t, store, connectStoreInitialActor, func(txCtx context.Context) (*domain.Catalog, error) {
		c, err := store.GetFullCatalog(txCtx)
		return &c, err
	})
	found := false
	for _, m := range catalog.Modules {
		if m.ID != mod.ID {
			continue
		}
		found = true
		for _, line := range m.HardwareLines {
			if line.ComponentID != componentID {
				t.Fatalf("catalog-full line %s lost component_id: got %q", line.ID, line.ComponentID)
			}
		}
	}
	if !found {
		t.Fatalf("module %s missing from full catalog", mod.ID)
	}
}

func TestHardwareLineComponentLinkForeignComponentFailsClosed(t *testing.T) {
	hcsComponent(t) // fixture org must be migrated/active either way
	store, _ := migratedConnectStore(t)

	missing := uuid858() // never inserted: the FK must reject it loudly
	mod := &domain.Module{
		ID:      uuid858(),
		Code:    uniqueID("DES-1394-X"),
		Name:    "Despensa 1394 vínculo roto",
		WidthMm: 600, HeightMm: 2000, DepthMm: 550,
		HardwareLines: []domain.HardwareLine{
			{ID: uuid858(), Quantity: 4, OptionRole: "SOPORTE", ComponentID: missing},
		},
	}
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM modules WHERE id = $1`, mod.ID) })

	err := store.WithinTenantTx(storage.WithOrgCtx(context.Background(), connectStoreInitialActor.OrganizationID), connectStoreInitialActor, func(txCtx context.Context) error {
		return store.CreateModule(txCtx, mod)
	})
	if err == nil {
		t.Fatal("CreateModule with a nonexistent component_id must fail on the FK, not silently NULL the link")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "hardware_lines") && !strings.Contains(err.Error(), "component_id") && !strings.Contains(strings.ToLower(err.Error()), "foreign key") {
		t.Fatalf("expected a foreign-key failure on hardware_lines, got: %v", err)
	}
}
