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

// Integration: requires isolated test Postgres. Covers #1091 (#443 slice 2):
// every simple catalog family shares the guarded-write contract — create
// starts at version 1, a stale expected version gets ErrVersionConflict
// without mutating, a fresh write bumps the version, and deactivate/delete is
// guarded the same way.
func TestCatalogSimpleFamilies_OptimisticConcurrency(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	unique := fmt.Sprintf("ZZ-S2-%d", time.Now().UnixNano())

	type family struct {
		name string
		// create inserts one row and returns its id with Version populated.
		create func(ctx context.Context) (string, error)
		// refresh re-reads the entity's current version by id.
		refresh func(ctx context.Context, id string) (int64, error)
		// update writes with the expected version; name mutation only.
		update func(ctx context.Context, id string, expected int64) error
		// deactivate/delete guarded write.
		remove func(ctx context.Context, id string, expected int64) error
	}

	families := []family{
		{
			name: "material_boards",
			create: func(ctx context.Context) (string, error) {
				m := &domain.MaterialBoard{Code: unique + "MB", Name: "Tablero S2", WidthMm: 100, LengthMm: 200, ThicknessMm: 15, Active: true}
				if err := store.CreateMaterialBoard(ctx, m); err != nil {
					return "", err
				}
				cleanupConnectStoreFixture(t, "DELETE FROM material_boards WHERE id = $1", m.ID)
				return m.ID, nil
			},
			refresh: func(ctx context.Context, id string) (int64, error) {
				m, err := store.GetMaterialBoardByID(ctx, id)
				if err != nil {
					return 0, err
				}
				return m.Version, nil
			},
			update: func(ctx context.Context, id string, expected int64) error {
				m := &domain.MaterialBoard{Code: unique + "MB", Name: "Tablero S2 editado", WidthMm: 100, LengthMm: 200, ThicknessMm: 15, Active: true}
				return store.UpdateMaterialBoard(ctx, id, expected, m)
			},
			remove: func(ctx context.Context, id string, expected int64) error {
				return store.DeactivateMaterialBoard(ctx, id, expected)
			},
		},
		{
			name: "edge_bands",
			create: func(ctx context.Context) (string, error) {
				e := &domain.EdgeBand{Code: unique + "EB", Name: "Cinta S2", ThicknessMm: 1, CostPerMl: 2, Active: true}
				if err := store.CreateEdgeBand(ctx, e); err != nil {
					return "", err
				}
				cleanupConnectStoreFixture(t, "DELETE FROM edge_bands WHERE id = $1", e.ID)
				return e.ID, nil
			},
			refresh: func(ctx context.Context, id string) (int64, error) {
				e, err := store.GetEdgeBandByID(ctx, id)
				if err != nil {
					return 0, err
				}
				return e.Version, nil
			},
			update: func(ctx context.Context, id string, expected int64) error {
				e := &domain.EdgeBand{Code: unique + "EB", Name: "Cinta S2 editada", ThicknessMm: 1, CostPerMl: 2, Active: true}
				return store.UpdateEdgeBand(ctx, id, expected, e)
			},
			remove: func(ctx context.Context, id string, expected int64) error {
				return store.DeactivateEdgeBand(ctx, id, expected)
			},
		},
		{
			name: "option_groups",
			create: func(ctx context.Context) (string, error) {
				og := &domain.OptionGroup{Code: unique + "OG", Name: "Grupo S2", Kind: "board", Required: true}
				if err := store.CreateOptionGroup(ctx, og); err != nil {
					return "", err
				}
				cleanupConnectStoreFixture(t, "DELETE FROM option_groups WHERE id = $1", og.ID)
				return og.ID, nil
			},
			refresh: func(ctx context.Context, id string) (int64, error) {
				og, err := store.GetOptionGroupByID(ctx, id)
				if err != nil {
					return 0, err
				}
				return og.Version, nil
			},
			update: func(ctx context.Context, id string, expected int64) error {
				og := &domain.OptionGroup{Code: unique + "OG", Name: "Grupo S2 editado", Kind: "board", Required: true}
				return store.UpdateOptionGroup(ctx, id, expected, og)
			},
			remove: func(ctx context.Context, id string, expected int64) error {
				return store.DeleteOptionGroup(ctx, id, expected)
			},
		},
		{
			name: "module_categories",
			create: func(ctx context.Context) (string, error) {
				c := &domain.ModuleCategory{Name: "Categoría S2 " + unique, SortOrder: 99}
				if err := store.CreateCategory(ctx, c); err != nil {
					return "", err
				}
				cleanupConnectStoreFixture(t, "DELETE FROM module_categories WHERE id = $1", c.ID)
				return c.ID, nil
			},
			refresh: func(ctx context.Context, id string) (int64, error) {
				c, err := store.GetCategoryByID(ctx, id)
				if err != nil {
					return 0, err
				}
				return c.Version, nil
			},
			update: func(ctx context.Context, id string, expected int64) error {
				c := &domain.ModuleCategory{Name: "Categoría S2 editada", SortOrder: 98}
				return store.UpdateCategory(ctx, id, expected, c)
			},
			remove: func(ctx context.Context, id string, expected int64) error {
				return store.DeleteCategory(ctx, id, expected)
			},
		},
		{
			name: "customers",
			create: func(ctx context.Context) (string, error) {
				c := &domain.Customer{Name: "Cliente S2 " + unique, Active: true}
				if err := store.CreateCustomer(ctx, c); err != nil {
					return "", err
				}
				cleanupConnectStoreFixture(t, "DELETE FROM customers WHERE id = $1", c.ID)
				return c.ID, nil
			},
			refresh: func(ctx context.Context, id string) (int64, error) {
				c, err := store.GetCustomerByID(ctx, id)
				if err != nil {
					return 0, err
				}
				return c.Version, nil
			},
			update: func(ctx context.Context, id string, expected int64) error {
				c := &domain.Customer{Name: "Cliente S2 editado", Active: true}
				return store.UpdateCustomer(ctx, id, expected, c)
			},
			remove: func(ctx context.Context, id string, expected int64) error {
				return store.DeactivateCustomer(ctx, id, expected)
			},
		},
		{
			name: "material_categories",
			create: func(ctx context.Context) (string, error) {
				c := &domain.MaterialCategory{Name: "Subgrupo S2 " + unique, SortOrder: 99}
				if err := store.CreateMaterialCategory(ctx, c); err != nil {
					return "", err
				}
				cleanupConnectStoreFixture(t, "DELETE FROM material_categories WHERE id = $1", c.ID)
				return c.ID, nil
			},
			refresh: func(ctx context.Context, id string) (int64, error) {
				c, err := store.GetMaterialCategoryByID(ctx, id)
				if err != nil {
					return 0, err
				}
				return c.Version, nil
			},
			update: func(ctx context.Context, id string, expected int64) error {
				c := &domain.MaterialCategory{Name: "Subgrupo S2 editado", SortOrder: 98}
				return store.UpdateMaterialCategory(ctx, id, expected, c)
			},
			remove: func(ctx context.Context, id string, expected int64) error {
				return store.DeleteMaterialCategory(ctx, id, expected)
			},
		},
		{
			name: "ambient_materials",
			create: func(ctx context.Context) (string, error) {
				m := &domain.AmbientMaterial{ID: unique + "AM", Code: unique + "AM", Name: "Ambiental S2", Active: true, SurfaceType: domain.AmbientSurfaceFloor}
				if err := store.CreateAmbientMaterial(ctx, m); err != nil {
					return "", err
				}
				cleanupConnectStoreFixture(t, "DELETE FROM ambient_materials WHERE id = $1", m.ID)
				return m.ID, nil
			},
			refresh: func(ctx context.Context, id string) (int64, error) {
				m, err := store.GetAmbientMaterialByID(ctx, id)
				if err != nil {
					return 0, err
				}
				return m.Version, nil
			},
			update: func(ctx context.Context, id string, expected int64) error {
				m := &domain.AmbientMaterial{ID: unique + "AM", Code: unique + "AM", Name: "Ambiental S2 editado", Active: true, SurfaceType: domain.AmbientSurfaceFloor}
				return store.UpdateAmbientMaterial(ctx, id, expected, m)
			},
			remove: func(ctx context.Context, id string, expected int64) error {
				return store.DeactivateAmbientMaterial(ctx, id, expected)
			},
		},
		{
			name: "ambient_categories",
			create: func(ctx context.Context) (string, error) {
				c := &domain.AmbientCategory{ID: unique + "AC", Name: "Ambiente S2 " + unique, SortOrder: 99}
				if err := store.CreateAmbientCategory(ctx, c); err != nil {
					return "", err
				}
				cleanupConnectStoreFixture(t, "DELETE FROM ambient_categories WHERE id = $1", c.ID)
				return c.ID, nil
			},
			refresh: func(ctx context.Context, id string) (int64, error) {
				c, err := store.GetAmbientCategoryByID(ctx, id)
				if err != nil {
					return 0, err
				}
				return c.Version, nil
			},
			update: func(ctx context.Context, id string, expected int64) error {
				c := &domain.AmbientCategory{Name: "Ambiente S2 editado", SortOrder: 98}
				return store.UpdateAmbientCategory(ctx, id, expected, c)
			},
			remove: func(ctx context.Context, id string, expected int64) error {
				return store.DeleteAmbientCategory(ctx, id, expected)
			},
		},
	}

	for _, fam := range families {
		t.Run(fam.name, func(t *testing.T) {
			var id string
			withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error {
				var err error
				id, err = fam.create(ctx)
				return err
			})

			// Clientes A y B ven la versión actual; A escribe primero.
			v := withinConnectStoreTenantValue(t, store, actor, func(ctx context.Context) (int64, error) {
				return fam.refresh(ctx, id)
			})
			if v != 1 {
				t.Fatalf("versión inicial = %d, want 1", v)
			}

			withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error {
				return fam.update(ctx, id, 1)
			})
			v = withinConnectStoreTenantValue(t, store, actor, func(ctx context.Context) (int64, error) {
				return fam.refresh(ctx, id)
			})
			if v != 2 {
				t.Fatalf("versión tras primer write = %d, want 2", v)
			}

			// B sigue en la versión 1: el write stale falla SIN mutar.
			staleErr := withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
				return fam.update(ctx, id, 1)
			})
			if !errors.Is(staleErr, storage.ErrVersionConflict) {
				t.Fatalf("write stale err = %v, want ErrVersionConflict", staleErr)
			}
			v = withinConnectStoreTenantValue(t, store, actor, func(ctx context.Context) (int64, error) {
				return fam.refresh(ctx, id)
			})
			if v != 2 {
				t.Fatalf("el write stale movió la versión: %d, want 2", v)
			}

			// Deactivate/delete también está guardado.
			removeErr := withinTenantTxErr(t, store, actor, func(ctx context.Context) error {
				return fam.remove(ctx, id, 1)
			})
			if !errors.Is(removeErr, storage.ErrVersionConflict) {
				t.Fatalf("remove stale err = %v, want ErrVersionConflict", removeErr)
			}
			withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error {
				return fam.remove(ctx, id, 2)
			})
		})
	}
}

// withinTenantTxErr ejecuta la unidad de trabajo en tenant y devuelve el
// error (a diferencia de withinConnectStoreTenant, que hace t.Fatal).
func withinTenantTxErr(t *testing.T, store *storage.PostgresStore, actor storage.TenantActor, run func(context.Context) error) error {
	t.Helper()
	ctx := storage.WithOrgCtx(context.Background(), actor.OrganizationID)
	return store.WithinTenantTx(ctx, actor, run)
}
