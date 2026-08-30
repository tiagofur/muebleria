package storage_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/db"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestModuleParameterDefinitionsMigrationFreshAndUpgrade(t *testing.T) {
	t.Run("fresh schema has an empty authoritative definition list", func(t *testing.T) {
		pool := multiOrgFreshDB(t)
		identityApplyThrough(t, pool, 100)

		var defaultValue string
		var nullable string
		err := pool.QueryRow(context.Background(), `
			SELECT column_default, is_nullable
			FROM information_schema.columns
			WHERE table_name = 'modules' AND column_name = 'parameter_definitions'
		`).Scan(&defaultValue, &nullable)
		if err != nil {
			t.Fatalf("parameter_definitions column: %v", err)
		}
		if defaultValue != "'[]'::jsonb" || nullable != "NO" {
			t.Fatalf("column contract default=%q nullable=%q", defaultValue, nullable)
		}
	})

	t.Run("upgrade preserves an existing legacy module", func(t *testing.T) {
		pool := multiOrgFreshDB(t)
		identityApplyThrough(t, pool, 99)
		ctx := context.Background()
		const moduleID = "f1970000-0000-0000-0000-000000000001"
		if _, err := pool.Exec(ctx, `
			INSERT INTO modules (id, organization_id, code, name, width_mm, height_mm, depth_mm)
			VALUES ($1, $2, 'LEGACY-F197', 'Legacy dimensions', 600, 720, 590)
		`, moduleID, multiOrgInitialOrgID); err != nil {
			t.Fatalf("seed legacy module: %v", err)
		}

		applyModuleParameterDefinitionsMigration(t, pool, ctx)

		var width, height, depth int
		var parameters string
		if err := pool.QueryRow(ctx, `
			SELECT width_mm, height_mm, depth_mm, parameter_definitions::text
			FROM modules WHERE id = $1
		`, moduleID).Scan(&width, &height, &depth, &parameters); err != nil {
			t.Fatalf("read upgraded module: %v", err)
		}
		if width != 600 || height != 720 || depth != 590 || parameters != "[]" {
			t.Fatalf("upgrade changed legacy module: dims=%dx%dx%d parameters=%s", width, height, depth, parameters)
		}
	})
}

func TestModuleParameterDefinitionsStorageRoundTrip(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 100)
	store := &storage.PostgresStore{Pool: pool}
	ctx := storage.WithOrgCtx(context.Background(), multiOrgInitialOrgID)
	min, max, step := 0.0, 5.0, 1.0
	module := &domain.Module{
		ID: "f1970000-0000-0000-0000-000000000002", Code: "F197-TYPED", Name: "Typed module",
		WidthMm: 600, HeightMm: 720, DepthMm: 590,
		ParameterDefinitions: []domain.FurnitureParameterDefinition{{
			Name: "shelfCount", Label: "Shelf count", Type: domain.FurnitureParameterTypeNumber,
			DefaultValue: float64(1), Required: true, Unit: domain.FurnitureParameterUnitCount,
			Category: domain.FurnitureParameterCategoryConfiguration,
			Min:      &min, Max: &max, Step: &step, Integer: true,
		}},
	}
	if err := store.CreateModule(ctx, module); err != nil {
		t.Fatalf("create module: %v", err)
	}
	got, err := store.GetModuleByID(ctx, module.ID)
	if err != nil {
		t.Fatalf("get module: %v", err)
	}
	if len(got.ParameterDefinitions) != 1 || got.ParameterDefinitions[0].Name != "shelfCount" || got.ParameterDefinitions[0].DefaultValue != float64(1) {
		t.Fatalf("parameter definitions did not round-trip: %+v", got.ParameterDefinitions)
	}

	got.ParameterDefinitions[0].DefaultValue = float64(2)
	if err := store.UpdateModule(ctx, got.ID, got); err != nil {
		t.Fatalf("update module: %v", err)
	}
	listed, err := store.ListModules(ctx)
	if err != nil {
		t.Fatalf("list modules: %v", err)
	}
	if len(listed) != 1 || listed[0].ParameterDefinitions[0].DefaultValue != float64(2) {
		t.Fatalf("updated definitions not listed: %+v", listed)
	}
}

func applyModuleParameterDefinitionsMigration(t *testing.T, pool *pgxpool.Pool, ctx context.Context) {
	t.Helper()
	migrations, err := db.EmbeddedMigrations()
	if err != nil {
		t.Fatalf("embedded migrations: %v", err)
	}
	for _, migration := range migrations {
		if migration.Version == 100 {
			if _, err := pool.Exec(ctx, migration.SQL); err != nil {
				t.Fatalf("apply migration 100: %v", err)
			}
			return
		}
	}
	t.Fatal("migration 100 is not embedded")
}
