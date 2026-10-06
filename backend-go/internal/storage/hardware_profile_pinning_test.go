package storage_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #918 acceptance, exercised against a real disposable PostgreSQL: profiles
// travel inside immutable Standard releases as kind hardware_profile, the
// pinned read resolves the exact release (no latest), a hardware PRICE
// change never rewrites the pinned profile blob (commercial/technical
// separation), and a technical change (recipe revision) produces a
// different pinned definition hash.
//
// The publish flow runs on the migration (admin) pool on purpose: it is the
// Granete-staff cross-org authority, not a tenant-scoped call. The org seed
// satisfies the active-team-invariant trigger (an active admin membership)
// before flipping the organization to active.
func TestHardwareProfilePinningThroughStandardRelease(t *testing.T) {
	migrationPool := multiOrgFreshMigrationDB(t)
	adminStore := &storage.PostgresStore{Pool: migrationPool}
	ctx := context.Background()
	if err := adminStore.RunMigrations(ctx); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	const orgA = "f9180000-0000-0000-0000-00000000000a"
	const adminUser = "f9180000-0000-0000-0000-000000000001"
	const adminMembership = "f9180000-0000-0000-0000-000000000002"
	seed := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations (id, name, slug, status) VALUES ($1, 'Taller Pinning', 'taller-pinning', 'provisioning')`, []any{orgA}},
		{`INSERT INTO workshop_settings (organization_id, default_currency) VALUES ($1, 'BRL')`, []any{orgA}},
		{`INSERT INTO users (id, email, normalized_email, password_hash, name, account_status, platform_admin)
		  VALUES ($1, 'pinning@test.com', 'pinning@test.com', 'x', 'Admin Pinning', 'active', FALSE)`, []any{adminUser}},
		{`INSERT INTO memberships (id, organization_id, user_id, roles, status, joined_at)
		  VALUES ($1, $2, $3, '{admin}', 'active', NOW())`, []any{adminMembership, orgA, adminUser}},
		{`UPDATE organizations SET status='active', status_reason=NULL WHERE id = $1`, []any{orgA}},
	}
	for _, statement := range seed {
		if _, err := migrationPool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	// One hardware in org A and one Granete-authored profile referencing it.
	const hwID = "f9180000-0000-0000-0000-000000000003"
	if _, err := migrationPool.Exec(ctx, `
		INSERT INTO hardwares (id, organization_id, code, name, unit, cost_per_unit, active)
		VALUES ($1, $2, 'HW-PIN-1', 'Tornillo pinning', 'piece', 12.50, TRUE)
	`, hwID, orgA); err != nil {
		t.Fatalf("seed hardware: %v", err)
	}
	const profileID = "f9180000-0000-0000-0000-000000000004"
	insertPinningProfile := func(recipeRevision string) {
		t.Helper()
		itemsJSON := `[{"hardwareId":"` + hwID + `","quantity":2,"applicationRole":"screw"}]`
		recipeJSON := `{"recipeId":"test:synthetic-fixed-shelf","recipeRevision":"` + recipeRevision + `"}`
		if _, err := migrationPool.Exec(ctx, `
			INSERT INTO hardware_profiles (id, organization_id, code, name, revision, items, recipe_ref, active)
			VALUES ($1, $2, 'PERF-PIN', 'Unión pinning', 'rev-1', $3::jsonb, $4::jsonb, TRUE)
			ON CONFLICT (id) DO UPDATE SET recipe_ref = EXCLUDED.recipe_ref, updated_at = NOW()
		`, profileID, orgA, itemsJSON, recipeJSON); err != nil {
			t.Fatalf("seed profile: %v", err)
		}
	}
	insertPinningProfile("test-1")

	// Publish release R1 from the seeded draft.
	r1ID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)
	if _, err := migrationPool.Exec(ctx, `UPDATE library_releases SET version = '0.1.0-pinning-r1' WHERE id = $1`, r1ID); err != nil {
		t.Fatalf("retarget seeded draft: %v", err)
	}
	r1Result, err := application.PublishStandardRelease(storage.WithOrgCtx(ctx, orgA), adminStore, r1ID, uuid.MustParse(adminUser))
	if err != nil {
		t.Fatalf("publish R1: %v", err)
	}

	// The pinned read resolves the profile at R1 — exact release, no latest.
	r1Profiles, err := adminStore.HardwareProfilesForRelease(ctx, r1ID)
	if err != nil {
		t.Fatalf("pinned read R1: %v", err)
	}
	if len(r1Profiles) != 1 || r1Profiles[0].Code != "PERF-PIN" ||
		r1Profiles[0].RecipeRef == nil || r1Profiles[0].RecipeRef.RecipeRevision != "test-1" {
		t.Fatalf("R1 pinned profiles = %+v", r1Profiles)
	}

	// Technical change: bump the recipe revision and publish R2 — the pinned
	// definition hash MUST move.
	insertPinningProfile("test-2")
	r2Rel, err := adminStore.CreateDraftRelease(ctx, storage.CreateDraftReleaseParams{
		LibraryID:     uuid.MustParse(domain.GraneteStandardLibraryID),
		Version:       "0.1.0-pinning-r2",
		SchemaVersion: domain.LibraryManifestSchemaVersion,
	})
	if err != nil {
		t.Fatalf("create R2 draft: %v", err)
	}
	r2ID := r2Rel.ID
	r2Result, err := application.PublishStandardRelease(storage.WithOrgCtx(ctx, orgA), adminStore, r2ID, uuid.MustParse(adminUser))
	if err != nil {
		t.Fatalf("publish R2: %v", err)
	}
	if r1Result.ManifestHash == r2Result.ManifestHash {
		t.Fatalf("recipe revision bump did not move the manifest hash")
	}

	// R1 STILL resolves v1 — history never retargets, no latest anywhere.
	r1After, err := adminStore.HardwareProfilesForRelease(ctx, r1ID)
	if err != nil {
		t.Fatalf("pinned read R1 after R2: %v", err)
	}
	if r1After[0].RecipeRef.RecipeRevision != "test-1" {
		t.Fatalf("R1 pin mutated after R2: %+v", r1After[0])
	}
	r2Profiles, err := adminStore.HardwareProfilesForRelease(ctx, r2ID)
	if err != nil || r2Profiles[0].RecipeRef.RecipeRevision != "test-2" {
		t.Fatalf("R2 pinned profiles = %+v err=%v", r2Profiles, err)
	}

	// Commercial change: a hardware PRICE update must NOT move the profile
	// definition hash (profiles carry ids, never prices).
	if _, err := migrationPool.Exec(ctx, `UPDATE hardwares SET cost_per_unit = 99.99 WHERE id = $1`, hwID); err != nil {
		t.Fatalf("price update: %v", err)
	}
	r3Rel, err := adminStore.CreateDraftRelease(ctx, storage.CreateDraftReleaseParams{
		LibraryID:     uuid.MustParse(domain.GraneteStandardLibraryID),
		Version:       "0.1.0-pinning-r3",
		SchemaVersion: domain.LibraryManifestSchemaVersion,
	})
	if err != nil {
		t.Fatalf("create R3 draft: %v", err)
	}
	r3ID := r3Rel.ID
	r3Result, err := application.PublishStandardRelease(storage.WithOrgCtx(ctx, orgA), adminStore, r3ID, uuid.MustParse(adminUser))
	if err != nil {
		t.Fatalf("publish R3: %v", err)
	}
	r2ProfileHash := profileDefinitionHash(t, r2Result, profileID)
	r3ProfileHash := profileDefinitionHash(t, r3Result, profileID)
	if r2ProfileHash != r3ProfileHash {
		t.Fatalf("price change moved the pinned profile definition hash: %s vs %s", r2ProfileHash, r3ProfileHash)
	}
}

// profileDefinitionHash extracts one profile's pinned definition hash from a
// compiled result (independent of the read path helper).
func profileDefinitionHash(t *testing.T, result *application.CompilationResult, profileID string) string {
	t.Helper()
	for _, ref := range result.Manifest.Resources {
		if ref.Kind == "hardware_profile" && ref.ID.String() == profileID {
			return ref.DefinitionHash
		}
	}
	t.Fatalf("profile %s not pinned in the manifest", profileID)
	return ""
}
