package storage_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #964: per-org provisioning of the recipe-bearing demo profile. The FIXED
// seed ids are global PKs over org-scoped rows (T1 pins the collision behind
// the /seed 500); deterministic per-org ids provision idempotently (T2); one
// publication carries every org's profile and each org's loader resolves its
// OWN recipes (T3).
func TestProvisionDemoProfileMultiOrg(t *testing.T) {
	migrationPool := multiOrgFreshMigrationDB(t)
	adminStore := &storage.PostgresStore{Pool: migrationPool}
	ctx := context.Background()
	if err := adminStore.RunMigrations(ctx); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	const orgB = "aaaaaaaa-9640-0000-0000-0000000000b1"
	const userA = "aaaaaaaa-9640-0000-0000-0000000000a1"
	const userB = "aaaaaaaa-9640-0000-0000-0000000000b2"
	const membershipA = "aaaaaaaa-9640-0000-0000-0000000000a2"
	const membershipB = "aaaaaaaa-9640-0000-0000-0000000000b3"
	seed := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations (id, name, slug, status) VALUES ($1, 'Taller B 964', 'taller-b-964', 'provisioning')`, []any{orgB}},
		{`INSERT INTO workshop_settings (organization_id, default_currency) VALUES ($1, 'BRL')`, []any{orgB}},
		{`INSERT INTO users (id, email, normalized_email, password_hash, name, account_status, platform_admin) VALUES
			($1, 'prov-a@test.com', 'prov-a@test.com', 'x', 'Usuario Prov A', 'active', FALSE),
			($2, 'prov-b@test.com', 'prov-b@test.com', 'x', 'Usuario Prov B', 'active', FALSE)`, []any{userA, userB}},
		{`INSERT INTO memberships (id, organization_id, user_id, roles, status, joined_at) VALUES
			($1, $2, $3, '{admin}', 'active', NOW()),
			($4, $5, $6, '{admin}', 'active', NOW())`, []any{membershipA, multiOrgInitialOrgID, userA, membershipB, orgB, userB}},
		{`UPDATE organizations SET status='active', status_reason=NULL WHERE id IN ($1, $2)`, []any{multiOrgInitialOrgID, orgB}},
	}
	for _, statement := range seed {
		if _, err := migrationPool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	// T1 — the pinned root cause: the FIXED demo profile id is a global PK;
	// a second org inserting it collides (the /seed 500). The row is
	// otherwise valid so the later publication accepts it.
	const fixedHW = "aaaaaaaa-9640-0000-0000-0000000000d1"
	if _, err := migrationPool.Exec(ctx, `
		INSERT INTO hardwares (id, organization_id, code, name, unit, cost_per_unit, active)
		VALUES ($1, $2, 'HW-FIXED', 'Herraje fijo', 'piece', 1, TRUE)`, fixedHW, multiOrgInitialOrgID); err != nil {
		t.Fatalf("seed fixed hardware: %v", err)
	}
	fixed := application.SeedDemoProfileID
	if _, err := migrationPool.Exec(ctx, `
		INSERT INTO hardware_profiles (id, organization_id, code, name, revision, items, active)
		VALUES ($1, $2, 'PERF-FIXED', 'Demo fijo', 'rev-1',
		'[{"hardwareId":"`+fixedHW+`","quantity":1,"applicationRole":"screw"}]'::jsonb, TRUE)
		ON CONFLICT (id) DO NOTHING`, fixed, multiOrgInitialOrgID); err != nil {
		t.Fatalf("seed fixed profile in A: %v", err)
	}
	if _, err := migrationPool.Exec(ctx, `
		INSERT INTO hardware_profiles (id, organization_id, code, name, revision, items, active)
		VALUES ($1, $2, 'PERF-FIXED-B', 'Demo fijo B', 'rev-1',
		'[{"hardwareId":"`+fixedHW+`","quantity":1,"applicationRole":"screw"}]'::jsonb, TRUE)`, fixed, orgB); err == nil {
		t.Fatalf("the fixed demo profile id must collide across orgs (the /seed 500)")
	}

	// Tenant store + actors.
	tenantPool, err := pgxpool.New(ctx, storage.TestDatabaseURLForDB(t, migrationPool.Config().ConnConfig.Database))
	if err != nil {
		t.Fatalf("open tenant pool: %v", err)
	}
	t.Cleanup(tenantPool.Close)
	tenantStore := &storage.PostgresStore{Pool: tenantPool}
	actorA := storage.TenantActor{OrganizationID: multiOrgInitialOrgID, UserID: userA, MembershipID: membershipA}
	actorB := storage.TenantActor{OrganizationID: orgB, UserID: userB, MembershipID: membershipB}
	provision := func(actor storage.TenantActor, org string) (application.ProvisionedDemoIDs, error) {
		var ids application.ProvisionedDemoIDs
		err := tenantStore.WithinTenantTx(storage.WithOrgCtx(ctx, org), actor, func(txCtx context.Context) error {
			ids = application.ProvisionedDemoIDsForOrg(org)
			return application.ProvisionDemoProfileForOrg(txCtx, tenantStore, org)
		})
		return ids, err
	}

	// T2 — deterministic + idempotent per org; distinct across orgs.
	idsA1, err := provision(actorA, multiOrgInitialOrgID)
	if err != nil {
		t.Fatalf("provision A: %v", err)
	}
	idsA2, err := provision(actorA, multiOrgInitialOrgID)
	if err != nil {
		t.Fatalf("re-provision A: %v", err)
	}
	if idsA1 != idsA2 {
		t.Fatalf("re-provisioning the same org must be idempotent: %+v vs %+v", idsA1, idsA2)
	}
	idsB, err := provision(actorB, orgB)
	if err != nil {
		t.Fatalf("provision B: %v", err)
	}
	if idsB.ProfileID == idsA1.ProfileID || idsB.MinifixHardwareID == idsA1.MinifixHardwareID {
		t.Fatalf("per-org ids must differ: %+v vs %+v", idsA1, idsB)
	}

	// T3 — ONE publication carries BOTH orgs' profiles; each org's loader
	// resolves its OWN recipes only.
	draftID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)
	if _, err := migrationPool.Exec(ctx, `UPDATE library_releases SET version = '0.1.0-prov-964' WHERE id = $1`, draftID); err != nil {
		t.Fatalf("retarget draft: %v", err)
	}
	if _, err := application.PublishStandardRelease(ctx, adminStore, draftID, uuid.MustParse(userA)); err != nil {
		t.Fatalf("publish: %v", err)
	}
	release, err := adminStore.GetCurrentPublishedRelease(ctx, uuid.MustParse(domain.GraneteStandardLibraryID))
	if err != nil {
		t.Fatalf("current release: %v", err)
	}

	// Each org needs a REAL component row for its assignment (the reference
	// check is org-exact by design).
	const compA = "aaaaaaaa-9640-0000-0000-0000000000c1"
	const compB = "aaaaaaaa-9640-0000-0000-0000000000c2"
	for _, row := range []struct {
		org  string
		comp string
	}{{multiOrgInitialOrgID, compA}, {orgB, compB}} {
		if _, err := migrationPool.Exec(ctx, `
			INSERT INTO components (id, organization_id, code, name, placement, length_mm, width_mm, thickness_mm, active)
			VALUES ($1, $2, 'COMP-964', 'Costado 964', 'lateral_izquierdo', 720, 560, 18, TRUE)
		`, row.comp, row.org); err != nil {
			t.Fatalf("seed component %s: %v", row.org, err)
		}
	}
	for _, row := range []struct {
		actor   storage.TenantActor
		org     string
		comp    string
		profile string
	}{{actorA, multiOrgInitialOrgID, compA, idsA1.ProfileID}, {actorB, orgB, compB, idsB.ProfileID}} {
		if err := tenantStore.WithinTenantTx(storage.WithOrgCtx(ctx, row.org), row.actor, func(txCtx context.Context) error {
			return tenantStore.SetComponentSideAssignment(txCtx, &domain.ComponentSideAssignment{
				ComponentID: row.comp, Side: "back", ProfileID: row.profile})
		}); err != nil {
			t.Fatalf("assignment %s: %v", row.org, err)
		}
	}

	// Overlays so the governance state is per-org too.
	for _, row := range []struct {
		actor    storage.TenantActor
		org      string
		stations int
	}{{actorA, multiOrgInitialOrgID, 4}, {actorB, orgB, 2}} {
		overrides, _ := json.Marshal(map[string]any{
			"joint.shelfToSide.systemId": "minifix-dowel", "joint.shelfToSide.stationsCount": row.stations,
		})
		if err := tenantStore.WithinTenantTx(storage.WithOrgCtx(ctx, row.org), row.actor, func(txCtx context.Context) error {
			_, err := tenantStore.CreateOverlay(txCtx, &domain.LibraryOverlay{
				OrganizationID: uuid.MustParse(row.org), LibraryID: uuid.MustParse(domain.GraneteStandardLibraryID),
				BaseReleaseID: release.ID, Status: "active", Overrides: overrides,
			})
			return err
		}); err != nil {
			t.Fatalf("overlay %d: %v", row.stations, err)
		}
	}

	var inputsA *engine.ReleaseServerInputs
	if err := tenantStore.WithinTenantTx(storage.WithOrgCtx(ctx, multiOrgInitialOrgID), actorA, func(txCtx context.Context) error {
		var loadErr error
		inputsA, loadErr = tenantStore.ReleaseServerResolveInputs(txCtx, multiOrgInitialOrgID)
		return loadErr
	}); err != nil {
		t.Fatalf("loader A: %v", err)
	}
	if len(inputsA.SideRecipes) != 1 || inputsA.SideRecipes[0].CatalogComponentID != compA ||
		inputsA.SideRecipes[0].TechnicalProfileID != idsA1.ProfileID {
		t.Fatalf("org A must resolve only its own recipe: %+v", inputsA.SideRecipes)
	}
	if inputsA.Policy == nil || inputsA.Policy.ShelfToSide == nil || inputsA.Policy.ShelfToSide.StationsCount != 4 {
		t.Fatalf("org A policy = %+v", inputsA.Policy)
	}

	var inputsB *engine.ReleaseServerInputs
	if err := tenantStore.WithinTenantTx(storage.WithOrgCtx(ctx, orgB), actorB, func(txCtx context.Context) error {
		var loadErr error
		inputsB, loadErr = tenantStore.ReleaseServerResolveInputs(txCtx, orgB)
		return loadErr
	}); err != nil {
		t.Fatalf("loader B: %v", err)
	}
	for _, recipe := range inputsB.SideRecipes {
		if recipe.CatalogComponentID == compA {
			t.Fatalf("org B must never see org A's recipe: %+v", inputsB.SideRecipes)
		}
	}
	if inputsB.Policy == nil || inputsB.Policy.ShelfToSide == nil || inputsB.Policy.ShelfToSide.StationsCount != 2 {
		t.Fatalf("org B policy = %+v", inputsB.Policy)
	}
}
