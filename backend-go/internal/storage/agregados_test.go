package storage_test

import (
	"context"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestAgregados_MigrationIsAdditiveAndReRunSafe(t *testing.T) {
	store, _ := migrationConnectStore(t)
	if err := store.RunMigrations(context.Background()); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
}

func TestAgregados_CRUDRoundTrip(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	id, code := uniqueID("agr-test"), uniqueID("AGR-CAJON")
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM agregados WHERE id = $1`, id) })
	in := &domain.Agregado{ID: id, Code: code, Name: "Puerta con Bisagras", Description: "Puerta batiente con 2 bisagras y 1 jaladera", Active: true, Components: []domain.ComponentInstance{{ComponentID: "c-puerta", Quantity: 1}}, HardwareLines: []domain.HardwareLine{{ID: "hwline-1", Quantity: 2, OptionRole: "BISAGRAS"}, {ID: "hwline-2", Quantity: 1, OptionRole: "JALADERAS"}}}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateAgregado(txCtx, in) })
	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Agregado, error) { return store.GetAgregadoByID(txCtx, id) })
	if got.Code != code || got.Name != "Puerta con Bisagras" || len(got.Components) != 1 || len(got.HardwareLines) != 2 {
		t.Fatalf("mismatch after create: %+v", got)
	}
	list := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) ([]domain.Agregado, error) { return store.ListAgregados(txCtx) })
	if !containsAgregadoID(list, id) {
		t.Fatal("created agregado not found in list")
	}
	upd := *in
	upd.Name = "Cuerpo 3 Cajones Actualizado"
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.UpdateAgregado(txCtx, id, upd.Version, &upd) })
	again := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Agregado, error) { return store.GetAgregadoByID(txCtx, id) })
	if again.Name != "Cuerpo 3 Cajones Actualizado" {
		t.Fatalf("expected updated name, got %q", again.Name)
	}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.DeactivateAgregado(txCtx, id, again.Version) })
	deact := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Agregado, error) { return store.GetAgregadoByID(txCtx, id) })
	if deact.Active {
		t.Fatal("expected active=false after deactivate")
	}
}

func containsAgregadoID(list []domain.Agregado, id string) bool {
	for _, item := range list {
		if item.ID == id {
			return true
		}
	}
	return false
}

// #529: the presentation opening kinematics must survive the storage
// round-trip (create → read → update → read) and a create without one must
// read back nil, never an empty non-nil shell.
func TestAgregados_PresentationMotionRoundTrip(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	id, code := uniqueID("agr-pm"), uniqueID("AGR-PUE-PM")
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM agregados WHERE id = $1`, id) })

	rotate := map[string]any{"kind": "rotate", "pivot": "left", "axis": map[string]any{"x": 0.0, "y": 0.0, "z": 1.0}, "openAngleDeg": 110.0}
	in := &domain.Agregado{ID: id, Code: code, Name: "Puerta Izquierda PM", Active: true, PresentationMotion: rotate}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateAgregado(txCtx, in) })

	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Agregado, error) { return store.GetAgregadoByID(txCtx, id) })
	if got.PresentationMotion == nil || got.PresentationMotion["kind"] != "rotate" || got.PresentationMotion["openAngleDeg"] != 110.0 {
		t.Fatalf("rotate motion lost after create: %+v", got.PresentationMotion)
	}

	upd := *in
	upd.PresentationMotion = map[string]any{"kind": "translate", "axis": map[string]any{"x": 0.0, "y": 1.0, "z": 0.0}, "distanceMm": 400.0}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.UpdateAgregado(txCtx, id, upd.Version, &upd) })
	again := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Agregado, error) { return store.GetAgregadoByID(txCtx, id) })
	if again.PresentationMotion == nil || again.PresentationMotion["kind"] != "translate" || again.PresentationMotion["distanceMm"] != 400.0 {
		t.Fatalf("translate motion lost after update: %+v", again.PresentationMotion)
	}

	noMotion := *again
	noMotion.PresentationMotion = nil
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.UpdateAgregado(txCtx, id, noMotion.Version, &noMotion) })
	cleared := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Agregado, error) { return store.GetAgregadoByID(txCtx, id) })
	if cleared.PresentationMotion != nil {
		t.Fatalf("expected nil presentation motion after clearing update, got %+v", cleared.PresentationMotion)
	}
}

func TestStructureAndModule_AgregadosRoundTrip(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	structIn := &domain.Structure{Code: uniqueID("ST-AGR"), Name: "Estructura con Agregados", WidthMm: 800, HeightMm: 720, DepthMm: 560, Active: true, Revision: 1, Agregados: []domain.ModuleAgregadoInstance{{ID: "inst-1", AgregadoID: "agr-1", Name: "Puerta Izq", Quantity: 1, LayoutDirection: "vertical", GapMm: 3, Mirrored: true, Position: &domain.AgregadoPosition{ZFormula: "100"}, Dimensions: &domain.AgregadoDimensions{WidthFormula: "W - 36", HeightFormula: "600"}}}}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateStructure(txCtx, structIn) })
	structID := structIn.ID
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM structures WHERE id = $1`, structID) })
	structGot := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Structure, error) { return store.GetStructureByID(txCtx, structID) })
	if len(structGot.Agregados) != 1 || structGot.Agregados[0].Name != "Puerta Izq" || !structGot.Agregados[0].Mirrored {
		t.Fatalf("mismatch on structure agregado: %+v", structGot.Agregados)
	}
	structIn.Agregados[0].Name = "Puerta Izq Modificada"
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.UpdateStructure(txCtx, structID, structIn.Version, structIn) })
	structUpd := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Structure, error) { return store.GetStructureByID(txCtx, structID) })
	if len(structUpd.Agregados) != 1 || structUpd.Agregados[0].Name != "Puerta Izq Modificada" {
		t.Fatalf("mismatch after structure update: %+v", structUpd.Agregados)
	}

	modIn := &domain.Module{Code: uniqueID("MOD-AGR"), Name: "Mueble con Agregados", WidthMm: 800, HeightMm: 720, DepthMm: 560, Agregados: []domain.ModuleAgregadoInstance{{ID: "inst-mod-1", AgregadoID: "agr-cajones", Name: "3 Cajones", Quantity: 3, LayoutDirection: "vertical", GapMm: 2}}}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateModule(txCtx, modIn) })
	modID := modIn.ID
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM modules WHERE id = $1`, modID) })
	modGot := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Module, error) { return store.GetModuleByID(txCtx, modID) })
	if len(modGot.Agregados) != 1 || modGot.Agregados[0].Name != "3 Cajones" || modGot.Agregados[0].Quantity != 3 {
		t.Fatalf("mismatch on module agregado: %+v", modGot.Agregados)
	}
	modIn.Agregados[0].Quantity = 4
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.UpdateModule(txCtx, modID, modIn.Version, modIn) })
		modUpd := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Module, error) { return store.GetModuleByID(txCtx, modID) })
		if len(modUpd.Agregados) != 1 || modUpd.Agregados[0].Quantity != 4 {
			t.Fatalf("mismatch after module update: %+v", modUpd.Agregados)
		}
	}

// #1168: deleting an agregado with historical revisions must safely cascade
// through delete_catalog_agregado, removing both the parent row and its
// revision records while refusing deletion when referenced by in-use structures
// or modules.
func TestAgregados_CascadeDeleteWithRevisions(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	id, code := uniqueID("agr-del-rev"), uniqueID("AGR-DEL-REV")

	in := &domain.Agregado{
		ID: id, Code: code, Name: "Agregado Para Borrar", Active: true,
	}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateAgregado(txCtx, in)
	})

	// Create revision via UpdateAgregadoWithRevision
	upd := *in
	upd.Name = "Agregado Para Borrar v2"
	userID := actor.UserID
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.UpdateAgregadoWithRevision(txCtx, id, 1, &upd, &userID)
	})

	stored := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Agregado, error) {
		return store.GetAgregadoByID(txCtx, id)
	})
	if stored.CurrentRevisionID == nil {
		t.Fatal("expected current_revision_id to be set after update with revision")
	}
	r1ID := *stored.CurrentRevisionID

	// Delete with expectedVersion == 2 should succeed and cascade
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.DeleteAgregado(txCtx, id, 2)
	})

	// Agregado is gone
	err := withinTenantTxErr(t, store, actor, func(txCtx context.Context) error {
		_, err := store.GetAgregadoByID(txCtx, id)
		return err
	})
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("expected agregado to be not found, got err: %v", err)
	}

	// Revision is also gone
	err = withinTenantTxErr(t, store, actor, func(txCtx context.Context) error {
		_, err := store.GetAgregadoRevisionByID(txCtx, r1ID)
		return err
	})
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("expected revision to be deleted with parent, got err: %v", err)
	}
}
