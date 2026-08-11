package storage_test

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestAgregados_MigrationIsAdditiveAndReRunSafe(t *testing.T) {
	store, _ := connectStore(t)
	ctx := context.Background()

	if err := store.RunMigrations(ctx); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
}

func TestAgregados_CRUDRoundTrip(t *testing.T) {
	store, _ := connectStore(t)
	ctx := context.Background()

	id := uniqueID("agr-test")
	code := uniqueID("AGR-CAJON")

	in := &domain.Agregado{
		ID:          id,
		Code:        code,
		Name:        "Puerta con Bisagras",
		Description: "Puerta batiente con 2 bisagras y 1 jaladera",
		Active:      true,
		Components: []domain.ComponentInstance{
			{
				ComponentID: "c-puerta",
				Quantity:    1,
			},
		},
		HardwareLines: []domain.HardwareLine{
			{
				ID:         "hwline-1",
				Quantity:   2,
				OptionRole: "BISAGRAS",
			},
			{
				ID:         "hwline-2",
				Quantity:   1,
				OptionRole: "JALADERAS",
			},
		},
	}

	if err := store.CreateAgregado(ctx, in); err != nil {
		t.Fatalf("CreateAgregado failed: %v", err)
	}

	got, err := store.GetAgregadoByID(ctx, id)
	if err != nil {
		t.Fatalf("GetAgregadoByID failed: %v", err)
	}
	if got.Code != code || got.Name != "Puerta con Bisagras" || len(got.Components) != 1 || len(got.HardwareLines) != 2 {
		t.Fatalf("mismatch after create: %+v", got)
	}

	list, err := store.ListAgregados(ctx)
	if err != nil {
		t.Fatalf("ListAgregados failed: %v", err)
	}
	if !containsAgregadoID(list, id) {
		t.Fatalf("created agregado not found in list")
	}

	upd := *in
	upd.Name = "Cuerpo 3 Cajones Actualizado"
	if err := store.UpdateAgregado(ctx, id, &upd); err != nil {
		t.Fatalf("UpdateAgregado failed: %v", err)
	}

	again, err := store.GetAgregadoByID(ctx, id)
	if err != nil {
		t.Fatalf("GetAgregadoByID after update failed: %v", err)
	}
	if again.Name != "Cuerpo 3 Cajones Actualizado" {
		t.Fatalf("expected updated name, got %q", again.Name)
	}

	if err := store.DeactivateAgregado(ctx, id); err != nil {
		t.Fatalf("DeactivateAgregado failed: %v", err)
	}

	deact, err := store.GetAgregadoByID(ctx, id)
	if err != nil {
		t.Fatalf("GetAgregadoByID after deactivate failed: %v", err)
	}
	if deact.Active {
		t.Fatalf("expected active=false after deactivate, got true")
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

func TestStructureAndModule_AgregadosRoundTrip(t *testing.T) {
	store, _ := connectStore(t)
	ctx := context.Background()

	// 1. Structure with agregados
	structIn := &domain.Structure{
		Code:     uniqueID("ST-AGR"),
		Name:     "Estructura con Agregados",
		WidthMm:  800,
		HeightMm: 720,
		DepthMm:  560,
		Active:   true,
		Revision: 1,
		Agregados: []domain.ModuleAgregadoInstance{
			{
				ID:              "inst-1",
				AgregadoID:      "agr-1",
				Name:            "Puerta Izq",
				Quantity:        1,
				LayoutDirection: "vertical",
				GapMm:           3.0,
				Mirrored:        true,
				Position:        &domain.AgregadoPosition{ZFormula: "100"},
				Dimensions:      &domain.AgregadoDimensions{WidthFormula: "W - 36", HeightFormula: "600"},
			},
		},
	}

	if err := store.CreateStructure(ctx, structIn); err != nil {
		t.Fatalf("CreateStructure failed: %v", err)
	}
	structID := structIn.ID

	structGot, err := store.GetStructureByID(ctx, structID)
	if err != nil {
		t.Fatalf("GetStructureByID failed: %v", err)
	}
	if len(structGot.Agregados) != 1 {
		t.Fatalf("expected 1 agregado on structure, got %d", len(structGot.Agregados))
	}
	if structGot.Agregados[0].Name != "Puerta Izq" || !structGot.Agregados[0].Mirrored {
		t.Fatalf("mismatch on structure agregado: %+v", structGot.Agregados[0])
	}

	// Update structure agregados
	structIn.Agregados[0].Name = "Puerta Izq Modificada"
	if err := store.UpdateStructure(ctx, structID, structIn); err != nil {
		t.Fatalf("UpdateStructure failed: %v", err)
	}

	structUpd, err := store.GetStructureByID(ctx, structID)
	if err != nil {
		t.Fatalf("GetStructureByID after update failed: %v", err)
	}
	if len(structUpd.Agregados) != 1 || structUpd.Agregados[0].Name != "Puerta Izq Modificada" {
		t.Fatalf("mismatch after structure update: %+v", structUpd.Agregados)
	}

	// 2. Module with agregados
	modIn := &domain.Module{
		Code:     uniqueID("MOD-AGR"),
		Name:     "Mueble con Agregados",
		WidthMm:  800,
		HeightMm: 720,
		DepthMm:  560,
		Agregados: []domain.ModuleAgregadoInstance{
			{
				ID:              "inst-mod-1",
				AgregadoID:      "agr-cajones",
				Name:            "3 Cajones",
				Quantity:        3,
				LayoutDirection: "vertical",
				GapMm:           2.0,
			},
		},
	}

	if err := store.CreateModule(ctx, modIn); err != nil {
		t.Fatalf("CreateModule failed: %v", err)
	}
	modID := modIn.ID

	modGot, err := store.GetModuleByID(ctx, modID)
	if err != nil {
		t.Fatalf("GetModuleByID failed: %v", err)
	}
	if len(modGot.Agregados) != 1 {
		t.Fatalf("expected 1 agregado on module, got %d", len(modGot.Agregados))
	}
	if modGot.Agregados[0].Name != "3 Cajones" || modGot.Agregados[0].Quantity != 3 {
		t.Fatalf("mismatch on module agregado: %+v", modGot.Agregados[0])
	}

	// Update module agregados
	modIn.Agregados[0].Quantity = 4
	if err := store.UpdateModule(ctx, modID, modIn); err != nil {
		t.Fatalf("UpdateModule failed: %v", err)
	}

	modUpd, err := store.GetModuleByID(ctx, modID)
	if err != nil {
		t.Fatalf("GetModuleByID after update failed: %v", err)
	}
	if len(modUpd.Agregados) != 1 || modUpd.Agregados[0].Quantity != 4 {
		t.Fatalf("mismatch after module update: %+v", modUpd.Agregados)
	}
}
