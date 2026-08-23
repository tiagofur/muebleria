package storage_test

/**
 * F146 / #313 — custom_dims round-trip: sin la columna, el replace completo de
 * project_items borraba silenciosamente la medida "a medida" elegida en
 * Proyectar al guardar desde web. Este test prueba el bug exacto: create con
 * customDims → update → reload → la medida sobrevive.
 */

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestProjectItem_CustomDimsRoundTrip(t *testing.T) {
	store, _ := connectStore(t)
	ctx := context.Background()

	customer := &domain.Customer{
		ID:     uuidv4(t),
		Name:   "Custom Dims S.A.",
		Email:  "dims@example.com",
		Active: true,
	}
	if err := store.CreateCustomer(ctx, customer); err != nil {
		t.Fatalf("CreateCustomer: %v", err)
	}
	t.Cleanup(func() {
		_ = store.DeactivateCustomer(ctx, customer.ID)
	})

	id := uuidv4(t)
	dims := &domain.ItemCustomDims{WidthMm: 900, HeightMm: 800, DepthMm: 500}
	created := &domain.Project{
		ID:           id,
		Name:         "Obra a medida",
		CustomerID:   customer.ID,
		Currency:     "UYU",
		MarginFactor: 1.5,
		Status:       domain.StatusDraft,
		Items: []domain.ProjectItem{{
			ID:              uuidv4(t),
			ModuleID:        "a0000006-0000-0000-0000-000000000003", // módulo del seed (FK)
			Quantity:        1,
			OptionChoices:   map[string]string{"INTERIOR": "a0000006-0000-0000-0000-000000000010"}, // material del seed
			MeasurePresetID: uuidv4(t),
			CustomDims:      dims,
		}},
	}
	if err := store.CreateProject(ctx, created); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	t.Cleanup(func() {
		_ = store.DeleteProject(ctx, id)
	})

	// 1) Reload tras create: la medida sobrevive el INSERT.
	got, err := store.GetProjectByID(ctx, id)
	if err != nil {
		t.Fatalf("GetProjectByID: %v", err)
	}
	if len(got.Items) != 1 || got.Items[0].CustomDims == nil {
		t.Fatalf("customDims se perdió tras create: %+v", got.Items)
	}
	if *got.Items[0].CustomDims != *dims {
		t.Fatalf("customDims round-trip = %+v, want %+v", got.Items[0].CustomDims, dims)
	}

	// 2) Update (replace completo de items) con un valor nuevo y con nil:
	//    nil debe volver a preset (columna NULL), no heredar el valor viejo.
	newDims := &domain.ItemCustomDims{WidthMm: 750, HeightMm: 720, DepthMm: 480}
	got.Items[0].CustomDims = newDims
	if err := store.UpdateProject(ctx, id, got); err != nil {
		t.Fatalf("UpdateProject: %v", err)
	}
	reloaded, err := store.GetProjectByID(ctx, id)
	if err != nil {
		t.Fatalf("GetProjectByID tras update: %v", err)
	}
	if reloaded.Items[0].CustomDims == nil || *reloaded.Items[0].CustomDims != *newDims {
		t.Fatalf("customDims no se actualizó: %+v", reloaded.Items[0].CustomDims)
	}

	reloaded.Items[0].CustomDims = nil
	if err := store.UpdateProject(ctx, id, reloaded); err != nil {
		t.Fatalf("UpdateProject (clear dims): %v", err)
	}
	final, err := store.GetProjectByID(ctx, id)
	if err != nil {
		t.Fatalf("GetProjectByID final: %v", err)
	}
	if final.Items[0].CustomDims != nil {
		t.Fatalf("customDims debía volver a nil (preset), quedó %+v", final.Items[0].CustomDims)
	}
	if final.Items[0].MeasurePresetID == "" {
		t.Fatalf("measurePresetId se perdió: %+v", final.Items[0])
	}
}
