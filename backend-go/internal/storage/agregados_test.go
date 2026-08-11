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
		Name:        "Cuerpo 3 Cajones",
		Description: "3 cajones apilables con despiece",
		Active:      true,
		Components: []domain.ComponentInstance{
			{
				ComponentID: "c-frente",
				Quantity:    1,
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
	if got.Code != code || got.Name != "Cuerpo 3 Cajones" || len(got.Components) != 1 {
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
