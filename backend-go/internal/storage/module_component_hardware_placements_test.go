package storage_test

import (
	"context"
	"crypto/rand"
	"fmt"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// uuid858 mints a random UUID-shaped row id (modules/structures ids are uuid).
func uuid858() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

/**
 * #858 — module_components must round-trip the FULL ComponentInstanceOverrides
 * contract, including a bag whose only meaningful content is hardwarePlacements.
 *
 * The trajectory E2E proved the loss end to end: a module component instance
 * hosting a hinge (BIS-CL110 — a versioned manual machining profile) loses the
 * placement during catalog persistence, the release resolve derives no
 * drilling, and P1 freezes cncRequired=false. structure_components already
 * honors the contract; these regressions pin module_components to the SAME
 * emptiness semantics so the twin serializers cannot diverge again.
 */

func hwPlacement858(hardwareID string, xMm, yMm float64) domain.HardwarePlacement {
	return domain.HardwarePlacement{
		HardwareID: hardwareID,
		AnchorFace: "front",
		RelativePosition: domain.HardwareRelPosition{
			XMm: xMm,
			YMm: yMm,
		},
	}
}

func module858(id string, components ...domain.ComponentInstance) *domain.Module {
	return &domain.Module{
		ID:         id,
		Code:       "MOD-858-" + id,
		Name:       "Módulo 858 Herrajes",
		WidthMm:    600,
		HeightMm:   720,
		DepthMm:    590,
		Components: components,
	}
}

// seedComponent858 inserts the one catalog component every module instance
// references (module_components.component_id carries a real FK).
func seedComponent858(t *testing.T, componentID string) {
	t.Helper()
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM components WHERE id = $1`, componentID) })
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateComponent(txCtx, &domain.Component{
			ID: componentID, Code: "COMP-858-" + componentID[:8], Name: "Panel 858",
			Placement: domain.PlacementInterno, GeometryKind: "rectangular_board",
			LengthMm: 590, WidthMm: 600, ThicknessMm: 18,
		})
	})
}

func createModule858(t *testing.T, mod *domain.Module) {
	t.Helper()
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM modules WHERE id = $1`, mod.ID) })
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateModule(txCtx, mod) })
}

func readModule858(t *testing.T, id string) *domain.Module {
	t.Helper()
	store, _ := migratedConnectStore(t)
	return withinConnectStoreTenantValue(t, store, connectStoreInitialActor, func(txCtx context.Context) (*domain.Module, error) {
		return store.GetModuleByID(txCtx, id)
	})
}

func updateModule858(t *testing.T, mod *domain.Module) {
	t.Helper()
	store, _ := migratedConnectStore(t)
	withinConnectStoreTenant(t, store, connectStoreInitialActor, func(txCtx context.Context) error { return store.UpdateModule(txCtx, mod.ID, mod) })
}

func overrideRow858(t *testing.T, moduleID, componentID string) *string {
	t.Helper()
	_, pool := migratedConnectStore(t)
	var raw []byte
	err := pool.QueryRow(context.Background(),
		`SELECT overrides FROM module_components WHERE module_id = $1 AND component_id = $2`,
		moduleID, componentID).Scan(&raw)
	if err != nil {
		t.Fatalf("reading module_components.overrides: %v", err)
	}
	if raw == nil {
		return nil
	}
	str := string(raw)
	return &str
}

func assertPlacement858(t *testing.T, where string, got []domain.HardwarePlacement) {
	t.Helper()
	if len(got) != 1 {
		t.Fatalf("%s: expected 1 hardware placement to survive, got %d", where, len(got))
	}
	p := got[0]
	if p.HardwareID != "hw-858-hinge" || p.AnchorFace != "front" ||
		p.RelativePosition.XMm != 300 || p.RelativePosition.YMm != 100 {
		t.Fatalf("%s: placement drifted: %+v", where, p)
	}
}

// A. Create: a hardwarePlacements-only bag persists and reads back.
func TestModuleComponents_HardwarePlacementsOnlyRoundTrip_Create(t *testing.T) {
	id := uuid858()
	componentID := uuid858()
	seedComponent858(t, componentID)
	createModule858(t, module858(id,
		domain.ComponentInstance{
			ComponentID: componentID,
			Quantity:    1,
			Overrides: &domain.ComponentInstanceOverrides{
				HardwarePlacements: []domain.HardwarePlacement{hwPlacement858("hw-858-hinge", 300, 100)},
			},
		},
	))

	got := readModule858(t, id)
	if len(got.Components) != 1 {
		t.Fatalf("expected 1 component instance, got %d", len(got.Components))
	}
	ov := got.Components[0].Overrides
	if ov == nil {
		t.Fatal("hardwarePlacements-only override bag was dropped on the module create round-trip")
	}
	assertPlacement858(t, "create readback", ov.HardwarePlacements)
}

// B. Update: the same bag survives replaceModuleComponents (PUT semantics).
func TestModuleComponents_HardwarePlacementsOnlyRoundTrip_Update(t *testing.T) {
	id := uuid858()
	componentID := uuid858()
	seedComponent858(t, componentID)
	mod := module858(id, domain.ComponentInstance{ComponentID: componentID, Quantity: 1})
	createModule858(t, mod)

	mod.Components = []domain.ComponentInstance{{
		ComponentID: componentID,
		Quantity:    1,
		Overrides: &domain.ComponentInstanceOverrides{
			HardwarePlacements: []domain.HardwarePlacement{hwPlacement858("hw-858-hinge", 300, 100)},
		},
	}}
	updateModule858(t, mod)

	got := readModule858(t, id)
	ov := got.Components[0].Overrides
	if ov == nil {
		t.Fatal("hardwarePlacements-only override bag was dropped on the module update round-trip")
	}
	assertPlacement858(t, "update readback", ov.HardwarePlacements)
}

// C. Combined: hardwarePlacements coexists with the already-supported
// families and nothing of either side disappears.
func TestModuleComponents_CombinedOverridesRoundTrip(t *testing.T) {
	id := uuid858()
	componentID := uuid858()
	seedComponent858(t, componentID)
	rotate := 15
	createModule858(t, module858(id,
		domain.ComponentInstance{
			ComponentID: componentID,
			Quantity:    1,
			Overrides: &domain.ComponentInstanceOverrides{
				Edges: []domain.EdgeAssignment{
					{Side: "L1", Enabled: true},
					{Side: "L2", Enabled: false},
				},
				XFormula:           "W / 2",
				RotateZ:            &rotate,
				HardwarePlacements: []domain.HardwarePlacement{hwPlacement858("hw-858-hinge", 300, 100)},
			},
		},
	))

	got := readModule858(t, id)
	ov := got.Components[0].Overrides
	if ov == nil {
		t.Fatal("combined override bag was dropped on the module round-trip")
	}
	if len(ov.Edges) != 2 || !ov.Edges[0].Enabled || ov.Edges[0].Side != "L1" {
		t.Fatalf("edges drifted: %+v", ov.Edges)
	}
	if ov.XFormula != "W / 2" {
		t.Fatalf("xFormula drifted: %q", ov.XFormula)
	}
	if ov.RotateZ == nil || *ov.RotateZ != 15 {
		t.Fatalf("rotateZ drifted: %+v", ov.RotateZ)
	}
	assertPlacement858(t, "combined readback", ov.HardwarePlacements)
}

// D. Empty stays empty: a genuinely empty bag keeps the historical NULL
// semantics (nothing becomes a stored `{}`).
func TestModuleComponents_EmptyOverridesStayNull(t *testing.T) {
	id := uuid858()
	componentID := uuid858()
	seedComponent858(t, componentID)
	createModule858(t, module858(id,
		domain.ComponentInstance{ComponentID: componentID, Quantity: 1, Overrides: &domain.ComponentInstanceOverrides{}},
		domain.ComponentInstance{ComponentID: componentID, Quantity: 2, Overrides: nil},
	))

	if raw := overrideRow858(t, id, componentID); raw != nil && *raw != "null" {
		t.Fatalf("empty/nil override bags must keep NULL semantics, stored %q", *raw)
	}
	got := readModule858(t, id)
	for _, c := range got.Components {
		if c.Overrides != nil {
			t.Fatalf("empty/nil bag must not resurrect as an override struct: %+v", c.Overrides)
		}
	}
}

// E. Negative proof (behavioral): EVERY override family that makes a bag
// non-empty keeps it alive on the module round-trip. A future manual
// emptiness check that forgets one family fails here — no source grep needed.
func TestModuleComponents_EveryOverrideFamilyKeepsBagAlive(t *testing.T) {
	rotate := 90
	families := []struct {
		name string
		ov   *domain.ComponentInstanceOverrides
	}{
		{"edges", &domain.ComponentInstanceOverrides{Edges: []domain.EdgeAssignment{{Side: "L1", Enabled: true}}}},
		{"xFormula", &domain.ComponentInstanceOverrides{XFormula: "37"}},
		{"rotateZ", &domain.ComponentInstanceOverrides{RotateZ: &rotate}},
		{"hardwarePlacements", &domain.ComponentInstanceOverrides{
			HardwarePlacements: []domain.HardwarePlacement{hwPlacement858("hw-858-hinge", 300, 100)},
		}},
	}
	for _, family := range families {
		t.Run(family.name, func(t *testing.T) {
			id := uuid858()
			familyComponentID := uuid858()
			seedComponent858(t, familyComponentID)
			createModule858(t, module858(id,
				domain.ComponentInstance{ComponentID: familyComponentID, Quantity: 1, Overrides: family.ov},
			))
			got := readModule858(t, id)
			if got.Components[0].Overrides == nil {
				t.Fatalf("override bag with only %s was dropped on the module round-trip", family.name)
			}
		})
	}
}

// Structure non-regression: the already-correct twin keeps the contract.
func TestStructureComponents_HardwarePlacementsOnlyRoundTrip(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	id, code := uuid858(), uniqueID("ST-858")
	componentID := uuid858()
	seedComponent858(t, componentID)
	in := &domain.Structure{
		ID: id, Code: code, Name: "Estructura 858",
		WidthMm: 600, HeightMm: 720, DepthMm: 590, Active: true, Revision: 1,
		Components: []domain.ComponentInstance{{
			ComponentID: componentID,
			Quantity:    1,
			Overrides: &domain.ComponentInstanceOverrides{
				HardwarePlacements: []domain.HardwarePlacement{hwPlacement858("hw-858-hinge", 300, 100)},
			},
		}},
	}
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM structures WHERE id = $1`, id) })
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateStructure(txCtx, in) })
	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Structure, error) {
		return store.GetStructureByID(txCtx, id)
	})
	if len(got.Components) != 1 || got.Components[0].Overrides == nil {
		t.Fatal("structure hardwarePlacements-only bag regression (twin path)")
	}
	assertPlacement858(t, "structure readback", got.Components[0].Overrides.HardwarePlacements)
}

// Compile-time guard: the store surface used by these regressions.
var _ = storage.ErrPartExecutionsNotFound
