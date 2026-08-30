package storage_test

import (
	"context"
	"errors"
	"os"
	"strings"
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
		if _, err := pool.Exec(context.Background(), `INSERT INTO modules (id,organization_id,code,name,parameter_definitions) VALUES (gen_random_uuid(),$1,'BAD-SHAPE','Bad shape','{}'::jsonb)`, multiOrgInitialOrgID); err == nil {
			t.Fatal("database accepted a non-array parameter definition payload")
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

func TestModuleParameterDefinitionsMigrationDownRemovesColumn(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 100)
	downSQL, err := os.ReadFile("../../db/migration/000100_module_parameter_definitions.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), string(downSQL)); err != nil {
		t.Fatalf("execute down migration: %v", err)
	}
	var exists bool
	if err := pool.QueryRow(context.Background(), `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='modules' AND column_name='parameter_definitions')`).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("down migration left parameter_definitions behind")
	}
}

func TestGetFullCatalogRejectsDirectSQLInvalidParameterDefinitions(t *testing.T) {
	oversized := "[" + strings.TrimSuffix(strings.Repeat(`{"name":"metadata","label":"Metadata","type":"string","required":false,"category":"metadata"},`, domain.MaxFurnitureParameterDefinitions+1), ",") + "]"
	tests := []struct{ name, raw string }{
		{"duplicate", `[{"name":"x","label":"X","type":"string","required":false,"category":"metadata"},{"name":"x","label":"X","type":"string","required":false,"category":"metadata"}]`},
		{"reserved dimension", `[{"name":"widthMm","label":"Width","type":"number","defaultValue":600,"required":true,"unit":"mm","category":"dimension","integer":true,"binding":{"version":1,"kind":"dimensionColumn","dimension":"widthMm"}}]`},
		{"invalid type", `[{"name":"x","label":"X","type":"decimal","required":false,"category":"metadata"}]`},
		{"invalid default", `[{"name":"enabled","label":"Enabled","type":"boolean","defaultValue":"false","required":false,"category":"metadata"}]`},
		{"invalid enum", `[{"name":"style","label":"Style","type":"enum","defaultValue":"bad","required":true,"category":"metadata","options":["classic"]}]`},
		{"definition limit", oversized},
		{"unknown field", `[{"name":"note","label":"Note","type":"string","required":false,"category":"metadata","unexpected":true}]`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pool := multiOrgFreshDB(t)
			identityApplyThrough(t, pool, 100)
			_, err := pool.Exec(context.Background(), `INSERT INTO modules (id,organization_id,code,name,parameter_definitions) VALUES (gen_random_uuid(),$1,$2,$2,$3::jsonb)`, multiOrgInitialOrgID, "BAD-"+tt.name, tt.raw)
			if err != nil {
				t.Fatalf("seed direct SQL: %v", err)
			}
			store := &storage.PostgresStore{Pool: pool}
			_, err = store.GetFullCatalog(storage.WithOrgCtx(context.Background(), multiOrgInitialOrgID))
			var definitionErr *domain.FurnitureParameterDefinitionsError
			if !errors.As(err, &definitionErr) || len(definitionErr.Issues) == 0 {
				t.Fatalf("expected typed definition error, got %v", err)
			}
		})
	}
}

func TestGetFullCatalogParameterDefinitionsStayTenantScoped(t *testing.T) {
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()
	for _, row := range []struct{ org, id, code, defaultValue string }{{orgA, "f1970000-0000-0000-0000-00000000000a", "PARAM-A", "alpha"}, {orgB, "f1970000-0000-0000-0000-00000000000b", "PARAM-B", "beta"}} {
		raw := `[{"name":"label","label":"Label","type":"string","defaultValue":"` + row.defaultValue + `","required":false,"category":"metadata"}]`
		if _, err := store.Pool.Exec(ctx, `INSERT INTO modules (id,organization_id,code,name,parameter_definitions) VALUES ($1,$2,$3,$3,$4::jsonb)`, row.id, row.org, row.code, raw); err != nil {
			t.Fatal(err)
		}
	}
	for _, tt := range []struct{ org, want, notWant string }{{orgA, "alpha", "beta"}, {orgB, "beta", "alpha"}} {
		catalog, err := store.GetFullCatalog(storage.WithOrgCtx(ctx, tt.org))
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, module := range catalog.Modules {
			for _, definition := range module.ParameterDefinitions {
				if definition.DefaultValue == tt.notWant {
					t.Fatalf("tenant %s saw %s", tt.org, tt.notWant)
				}
				if definition.DefaultValue == tt.want {
					found = true
				}
			}
		}
		if !found {
			t.Fatalf("tenant %s missing own definition", tt.org)
		}
	}
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
			Category: domain.FurnitureParameterCategoryMetadata,
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
