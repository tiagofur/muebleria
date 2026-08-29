package storage_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/db"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// These are integration tests against the local Postgres used by the backend
// (DATABASE_URL or localhost:5445). They skip gracefully when no DB is up, like
// material_tile_persist_test.go. Each test cleans up the rows it inserts.

func connectStore(t *testing.T) (*storage.PostgresStore, *pgxpool.Pool) {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable"
	}
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Skipf("no db: %v", err)
	}
	t.Cleanup(pool.Close)
	store := &storage.PostgresStore{Pool: pool}
	// Ensure the schema is current (idempotent) so the tests do not depend on
	// run order or on a server having started before the suite. Mirrors what
	// happens automatically on server start.
	if err := store.RunMigrations(ctx); err != nil {
		t.Skipf("run migrations: %v", err)
	}
	return store, pool
}

// uniqueID mints a test-only id/code suffix so parallel/ repeatable runs never
// collide on the UNIQUE(code) constraint.
func uniqueID(prefix string) string {
	return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
}

func fptr(v float64) *float64 { return &v }

// Server-start path applies the new migration; applying the embedded SQL a
// second time directly must be safe (IF NOT EXISTS guards) — spec #4150.
func TestAmbientMaterials_MigrationIsAdditiveAndReRunSafe(t *testing.T) {
	store, pool := connectStore(t)
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)

	if err := store.RunMigrations(ctx); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'ambient_materials'`,
	).Scan(&n); err != nil {
		t.Fatalf("query information_schema: %v", err)
	}
	if n != 1 {
		t.Fatalf("ambient_materials table missing (count=%d)", n)
	}

	migs, err := db.EmbeddedMigrations()
	if err != nil {
		t.Fatalf("embedded migrations: %v", err)
	}
	var ambientSQL string
	for _, m := range migs {
		if m.Name == "ambient_materials" {
			ambientSQL = m.SQL
			break
		}
	}
	if ambientSQL == "" {
		t.Fatal("ambient_materials migration not embedded")
	}
	// Re-applying the exact shipped SQL must not error.
	if _, err := pool.Exec(ctx, ambientSQL); err != nil {
		t.Fatalf("re-running migration SQL must be safe (IF NOT EXISTS): %v", err)
	}
}

func TestAmbientMaterials_CRUDRoundTrip(t *testing.T) {
	store, pool := connectStore(t)
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)

	id := uniqueID("amb-crud")
	code := uniqueID("FLR")
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM ambient_materials WHERE id = $1`, id) })

	in := &domain.AmbientMaterial{
		ID: id, Code: code, Name: "Roble", Active: true,
		SurfaceType:       domain.AmbientSurfaceFloor,
		PreviewColor:      "#8b5a2b",
		PreviewTextureURL: "/api/media/oak.webp",
	}
	if err := store.CreateAmbientMaterial(ctx, in); err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := store.GetAmbientMaterialByID(ctx, id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Code != code || got.Name != "Roble" || got.SurfaceType != domain.AmbientSurfaceFloor {
		t.Fatalf("get round-trip mismatch: %#v", got)
	}
	if got.PreviewColor != "#8b5a2b" || got.PreviewTextureURL != "/api/media/oak.webp" {
		t.Fatalf("preview fields not persisted: %#v", got)
	}
	if !got.Active {
		t.Error("expected Active=true after create")
	}

	list, err := store.ListAmbientMaterials(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if !containsID(list, id) {
		t.Fatalf("list does not contain created row")
	}

	upd := *got
	upd.Name = "Roble Premium"
	upd.PreviewTextureURL = ""
	if err := store.UpdateAmbientMaterial(ctx, id, &upd); err != nil {
		t.Fatalf("update: %v", err)
	}
	again, err := store.GetAmbientMaterialByID(ctx, id)
	if err != nil {
		t.Fatalf("get after update: %v", err)
	}
	if again.Name != "Roble Premium" || again.PreviewTextureURL != "" {
		t.Fatalf("update not persisted: %#v", again)
	}

	if err := store.DeactivateAmbientMaterial(ctx, id); err != nil {
		t.Fatalf("deactivate: %v", err)
	}
	deact, err := store.GetAmbientMaterialByID(ctx, id)
	if err != nil {
		t.Fatalf("get after deactivate: %v", err)
	}
	if deact.Active {
		t.Error("expected Active=false after deactivate")
	}
}

// The core nullable-PBR requirement: NULL (unset) must round-trip distinct
// from 0. previewRoughness===0 is a real value, not "unset" (spec #4150).
func TestAmbientMaterials_NullablePBR_NullVsZero(t *testing.T) {
	store, pool := connectStore(t)
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)

	id := uniqueID("amb-pbr")
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM ambient_materials WHERE id = $1`, id) })

	// Create with roughness UNSET (nil) and metalness = 0.5.
	in := &domain.AmbientMaterial{
		ID: id, Code: uniqueID("PBR"), Name: "PBR", Active: true,
		SurfaceType:      domain.AmbientSurfaceFloor,
		PreviewMetalness: fptr(0.5),
	}
	if err := store.CreateAmbientMaterial(ctx, in); err != nil {
		t.Fatalf("create: %v", err)
	}
	got, err := store.GetAmbientMaterialByID(ctx, id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.PreviewRoughness != nil {
		t.Fatalf("unset roughness must stay nil, got %v", *got.PreviewRoughness)
	}
	if got.PreviewMetalness == nil || *got.PreviewMetalness != 0.5 {
		t.Fatalf("metalness=0.5 not preserved: %#v", got.PreviewMetalness)
	}

	// Update roughness to exactly 0 — must come back as a non-nil *0.
	upd := *got
	upd.PreviewRoughness = fptr(0)
	if err := store.UpdateAmbientMaterial(ctx, id, &upd); err != nil {
		t.Fatalf("update: %v", err)
	}
	zero, err := store.GetAmbientMaterialByID(ctx, id)
	if err != nil {
		t.Fatalf("get after zero update: %v", err)
	}
	if zero.PreviewRoughness == nil {
		t.Fatal("roughness=0 must NOT be NULL — it is a real value distinct from unset")
	}
	if *zero.PreviewRoughness != 0 {
		t.Fatalf("roughness = %v, want 0", *zero.PreviewRoughness)
	}
}

func TestAmbientMaterials_UniqueCodeConstraint(t *testing.T) {
	store, pool := connectStore(t)
	ctx := storage.WithOrgCtx(context.Background(), storage.InitialOrganizationID)

	code := uniqueID("UNIQ")
	id1 := uniqueID("amb-uniq-1")
	id2 := uniqueID("amb-uniq-2")
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM ambient_materials WHERE id IN ($1, $2)`, id1, id2)
	})

	mk := func(id string) *domain.AmbientMaterial {
		return &domain.AmbientMaterial{ID: id, Code: code, Name: "Dup", Active: true, SurfaceType: domain.AmbientSurfaceWall}
	}
	if err := store.CreateAmbientMaterial(ctx, mk(id1)); err != nil {
		t.Fatalf("first create: %v", err)
	}
	err := store.CreateAmbientMaterial(ctx, mk(id2))
	if err == nil {
		t.Fatal("expected duplicate-key error on repeated code, got nil")
	}
	if !strings.Contains(err.Error(), "duplicate key") && !strings.Contains(err.Error(), "unique constraint") {
		t.Fatalf("error must mention duplicate/unique constraint, got: %v", err)
	}
}

func containsID(list []domain.AmbientMaterial, id string) bool {
	for _, m := range list {
		if m.ID == id {
			return true
		}
	}
	return false
}
