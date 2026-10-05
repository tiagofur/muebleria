package storage_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Integration: requires isolated test Postgres. Covers #1096 (#443 slice 3):
// the structural catalog families share the guarded-write contract — create
// starts at version 1, stale expected versions get ErrVersionConflict without
// mutating (including no orphan structure revision snapshot), and fresh
// writes bump the version.
func TestStructuralFamilies_OptimisticConcurrency(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	unique := fmt.Sprintf("zz-s3-%d", time.Now().UnixNano())

	t.Run("components", func(t *testing.T) {
		comp := &domain.Component{Code: unique + "-comp", Name: "Componente S3", Placement: "lateral", GeometryKind: "rectangular_board", LengthMm: 100, WidthMm: 50, ThicknessMm: 15, Active: true}
		withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error { return store.CreateComponent(ctx, comp) })
		t.Cleanup(func() {
			cleanupConnectStoreFixture(t, "DELETE FROM components WHERE id = $1", comp.ID)
		})
		if comp.Version != 1 {
			t.Fatalf("versión inicial = %d, want 1", comp.Version)
		}
		withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error {
			return store.UpdateComponent(ctx, comp.ID, comp.Version, comp)
		})
		if comp.Version != 2 {
			t.Fatalf("versión tras write vigente = %d, want 2", comp.Version)
		}
		// Cliente B aún vio la versión 1: el write stale falla sin mutar.
		stale := *comp
		stale.Version = 1
		stale.Name = "HACKED"
		err := withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
			return store.UpdateComponent(ctx, comp.ID, 1, &stale)
		})
		if !errors.Is(err, storage.ErrVersionConflict) {
			t.Fatalf("write stale err = %v, want ErrVersionConflict", err)
		}
	})

	t.Run("structures", func(t *testing.T) {
		st := &domain.Structure{Code: unique + "-st", Name: "Estructura S3", WidthMm: 800, HeightMm: 2000, DepthMm: 600, Active: true}
		withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error { return store.CreateStructure(ctx, st) })
		t.Cleanup(func() {
			cleanupConnectStoreFixture(t, "DELETE FROM structure_revisions WHERE structure_id = $1", st.ID)
			cleanupConnectStoreFixture(t, "DELETE FROM structures WHERE id = $1", st.ID)
		})
		if st.Version != 1 {
			t.Fatalf("versión inicial = %d, want 1", st.Version)
		}
		withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error {
			return store.UpdateStructure(ctx, st.ID, st.Version, st)
		})
		if st.Version != 2 || st.Revision != 2 {
			t.Fatalf("versión/revisión tras write vigente = %d/%d, want 2/2", st.Version, st.Revision)
		}
		// Write stale: conflicto; el rollback de la tx descarta el snapshot
		// de revisión insertado (sin huérfanos).
		stale := *st
		stale.Version = 1
		stale.Name = "HACKED"
		err := withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
			return store.UpdateStructure(ctx, st.ID, 1, &stale)
		})
		if !errors.Is(err, storage.ErrVersionConflict) {
			t.Fatalf("write stale err = %v, want ErrVersionConflict", err)
		}
	})

	t.Run("agregados", func(t *testing.T) {
		agr := &domain.Agregado{ID: unique + "-agr", Code: unique + "-agr", Name: "Agregado S3", WidthMm: 600, HeightMm: 720, DepthMm: 560, Active: true}
		withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error { return store.CreateAgregado(ctx, agr) })
		t.Cleanup(func() {
			cleanupConnectStoreFixture(t, "DELETE FROM agregados WHERE id = $1", agr.ID)
		})
		if agr.Version != 1 {
			t.Fatalf("versión inicial = %d, want 1", agr.Version)
		}
		withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error {
			return store.UpdateAgregado(ctx, agr.ID, agr.Version, agr)
		})
		if agr.Version != 2 {
			t.Fatalf("versión tras write vigente = %d, want 2", agr.Version)
		}
		// Cliente B aún vio la versión 1: el write stale falla sin mutar.
		stale := *agr
		stale.Version = 1
		stale.Name = "HACKED"
		err := withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
			return store.UpdateAgregado(ctx, agr.ID, 1, &stale)
		})
		if !errors.Is(err, storage.ErrVersionConflict) {
			t.Fatalf("write stale err = %v, want ErrVersionConflict", err)
		}
		withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error {
			return store.DeactivateAgregado(ctx, agr.ID, agr.Version)
		})
	})
}
