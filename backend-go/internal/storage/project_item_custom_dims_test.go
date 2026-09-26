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
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestProjectItem_CustomDimsRoundTrip(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	customer := &domain.Customer{ID: uuidv4(t), Name: "Custom Dims S.A.", Email: "dims-" + time.Now().Format("20060102-150405.000000") + "@example.com", Active: true}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateCustomer(txCtx, customer) })
	mod := &domain.Module{Code: "MOD-DIMS-" + time.Now().Format("20060102-150405.000000"), Name: "Custom Dims Test Module", BaseLaborCost: 10, BoardParts: []domain.BoardPart{}, HardwareLines: []domain.HardwareLine{}}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateModule(txCtx, mod) })
	id := uuidv4(t)
	dims := &domain.ItemCustomDims{WidthMm: 900, HeightMm: 800, DepthMm: 500}
	created := &domain.Project{ID: id, Name: "Obra a medida", CustomerID: customer.ID, Currency: "UYU", MarginFactor: 1.5, Status: domain.StatusDraft, Items: []domain.ProjectItem{{ID: uuidv4(t), ModuleID: mod.ID, Quantity: 1, OptionChoices: map[string]string{}, MeasurePresetID: uuidv4(t), CustomDims: dims}}}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.CreateProject(txCtx, created) })
	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Project, error) { return store.GetProjectByID(txCtx, id) })
	if len(got.Items) != 1 || got.Items[0].CustomDims == nil || *got.Items[0].CustomDims != *dims {
		t.Fatalf("customDims se perdió tras create: %+v", got.Items)
	}
	newDims := &domain.ItemCustomDims{WidthMm: 750, HeightMm: 720, DepthMm: 480}
	got.Items[0].CustomDims = newDims
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.UpdateProject(txCtx, id, got) })
	reloaded := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Project, error) { return store.GetProjectByID(txCtx, id) })
	if reloaded.Items[0].CustomDims == nil || *reloaded.Items[0].CustomDims != *newDims {
		t.Fatalf("customDims no se actualizó: %+v", reloaded.Items[0].CustomDims)
	}
	reloaded.Items[0].CustomDims = nil
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error { return store.UpdateProject(txCtx, id, reloaded) })
	final := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Project, error) { return store.GetProjectByID(txCtx, id) })
	if final.Items[0].CustomDims != nil {
		t.Fatalf("customDims debía volver a nil (preset), quedó %+v", final.Items[0].CustomDims)
	}
	if final.Items[0].MeasurePresetID == "" {
		t.Fatalf("measurePresetId se perdió: %+v", final.Items[0])
	}
}
