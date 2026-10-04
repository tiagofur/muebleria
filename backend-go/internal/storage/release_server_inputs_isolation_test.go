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

// #963 review pass: the shared resolve-inputs loader is tenant-exact. Under
// real disposable PostgreSQL with the granete_app role and real tenant
// transactions: factory A's side assignment synthesizes A's recipe and A's
// overlay policy reaches the loader; factory B NEVER sees A's assignment,
// recipe or policy — its cross-org reference attempt is rejected as missing
// (never leaked), and its own assignment synthesizes nothing because its own
// profile is not pinned in the published Standard release. The overlay is
// filtered by the explicit org argument; the assignments by the tenant
// transaction's organization (WHERE organization_id + RLS) — this test pins
// both under the same loader.
func TestReleaseServerInputsTenantIsolation(t *testing.T) {
	migrationPool := multiOrgFreshMigrationDB(t)
	adminStore := &storage.PostgresStore{Pool: migrationPool}
	ctx := context.Background()
	if err := adminStore.RunMigrations(ctx); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	const orgA = multiOrgInitialOrgID
	const orgB = "aaaaaaaa-0000-0000-0000-0000000000f1"
	const userA = "aaaaaaaa-0000-0000-0000-0000000000f2"
	const userB = "aaaaaaaa-0000-0000-0000-0000000000f3"
	const membershipA = "aaaaaaaa-0000-0000-0000-0000000000f4"
	const membershipB = "aaaaaaaa-0000-0000-0000-0000000000f5"
	const hwA = "aaaaaaaa-0000-0000-0000-0000000000f6"
	const profileA = "aaaaaaaa-0000-0000-0000-0000000000f7"
	const compA = "aaaaaaaa-0000-0000-0000-0000000000f8"
	const compB = "aaaaaaaa-0000-0000-0000-0000000000f9"
	seed := []struct {
		query string
		args  []any
	}{
		// orgA is the migration-seeded initial organization; only orgB is new.
		{`INSERT INTO organizations (id, name, slug, status) VALUES ($1, 'Taller B Loader', 'taller-b-loader', 'provisioning')`, []any{orgB}},
		{`INSERT INTO workshop_settings (organization_id, default_currency) VALUES ($1, 'BRL')`, []any{orgB}},
		{`INSERT INTO users (id, email, normalized_email, password_hash, name, account_status, platform_admin) VALUES
			($1, 'loader-a@test.com', 'loader-a@test.com', 'x', 'Usuario Loader A', 'active', FALSE),
			($2, 'loader-b@test.com', 'loader-b@test.com', 'x', 'Usuario Loader B', 'active', FALSE)`, []any{userA, userB}},
		{`INSERT INTO memberships (id, organization_id, user_id, roles, status, joined_at) VALUES
			($1, $2, $3, '{admin}', 'active', NOW()),
			($4, $5, $6, '{admin}', 'active', NOW())`, []any{membershipA, orgA, userA, membershipB, orgB, userB}},
		{`UPDATE organizations SET status='active', status_reason=NULL WHERE id IN ($1, $2)`, []any{orgA, orgB}},
		{`INSERT INTO hardwares (id, code, name, unit, cost_per_unit, organization_id)
		  VALUES ($1, 'HW-LOADER-A', 'Tornillo loader A', 'piece', 10, $2)`, []any{hwA, orgA}},
		{`INSERT INTO components (id, organization_id, code, name, placement, length_mm, width_mm, thickness_mm, active)
		  VALUES ($1, $2, 'LOADER-A', 'Costado A', 'lateral_izquierdo', 720, 560, 18, TRUE),
		         ($3, $4, 'LOADER-B', 'Costado B', 'lateral_izquierdo', 720, 560, 18, TRUE)`, []any{compA, orgA, compB, orgB}},
	}
	for _, statement := range seed {
		if _, err := migrationPool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	// Org A's profile row (with a recipe body) BEFORE publication: the
	// publisher freezes it into the Standard release the loader pins.
	actorA := storage.TenantActor{OrganizationID: orgA, UserID: userA, MembershipID: membershipA}
	actorB := storage.TenantActor{OrganizationID: orgB, UserID: userB, MembershipID: membershipB}
	tenantPool, err := pgxpool.New(ctx, storage.TestDatabaseURLForDB(t, migrationPool.Config().ConnConfig.Database))
	if err != nil {
		t.Fatalf("open tenant pool: %v", err)
	}
	t.Cleanup(tenantPool.Close)
	tenantStore := &storage.PostgresStore{Pool: tenantPool}

	if err := tenantStore.WithinTenantTx(storage.WithOrgCtx(ctx, orgA), actorA, func(txCtx context.Context) error {
		return tenantStore.CreateHardwareProfile(txCtx, &domain.HardwareProfile{
			ID: profileA, Code: "PERF-LOADER-A", Name: "Unión loader A", Revision: "rev-1", Active: true,
			Items: []domain.HardwareProfileItem{{HardwareID: hwA, Quantity: 2, ApplicationRole: "screw"}},
			Recipe: &domain.ProfileRecipeBody{RecipeID: "test:loader-fixed-shelf", RecipeRevision: "rev-1",
				Variants: []domain.ProfileRecipeVariant{{
					TargetFace: "back",
					Rules: []domain.ProfileRuleSpec{
						{RuleID: "rule-loader-a", RuleRevision: "1", ParticipantRole: "A", OperationRole: "drill", EntryFace: "front", Axis: [3]float64{0, 1, 0}, DiameterMm: 8, DepthMm: 12},
						{RuleID: "rule-loader-b", RuleRevision: "1", ParticipantRole: "B", OperationRole: "drill", EntryFace: "back", Axis: [3]float64{0, 1, 0}, DiameterMm: 8, DepthMm: 12},
					},
				}}},
		})
	}); err != nil {
		t.Fatalf("create org A profile: %v", err)
	}

	// Publish the Standard release from the seeded draft: the loader's pinned
	// profiles come from THIS manifest.
	draftID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)
	if _, err := migrationPool.Exec(ctx, `UPDATE library_releases SET version = '0.1.0-loader-iso' WHERE id = $1`, draftID); err != nil {
		t.Fatalf("retarget draft: %v", err)
	}
	if _, err := application.PublishStandardRelease(ctx, adminStore, draftID, uuid.MustParse(userA)); err != nil {
		t.Fatalf("publish: %v", err)
	}

	// Assignments under real tenant transactions.
	if err := tenantStore.WithinTenantTx(storage.WithOrgCtx(ctx, orgA), actorA, func(txCtx context.Context) error {
		return tenantStore.SetComponentSideAssignment(txCtx, &domain.ComponentSideAssignment{ComponentID: compA, Side: "back", ProfileID: profileA})
	}); err != nil {
		t.Fatalf("org A assignment: %v", err)
	}
	// B referencing A's pinned profile is rejected as MISSING — never leaked.
	if err := tenantStore.WithinTenantTx(storage.WithOrgCtx(ctx, orgB), actorB, func(txCtx context.Context) error {
		return tenantStore.SetComponentSideAssignment(txCtx, &domain.ComponentSideAssignment{ComponentID: compB, Side: "back", ProfileID: profileA})
	}); err == nil {
		t.Fatalf("cross-org profile reference must be rejected")
	}
	// B's own profile row (created AFTER publication: not pinned in the
	// release) and its own assignment are valid.
	if err := tenantStore.WithinTenantTx(storage.WithOrgCtx(ctx, orgB), actorB, func(txCtx context.Context) error {
		return tenantStore.CreateHardwareProfile(txCtx, &domain.HardwareProfile{
			Code: "PERF-LOADER-B", Name: "Unión loader B", Revision: "rev-1", Active: true,
			Items: []domain.HardwareProfileItem{{HardwareID: hwA, Quantity: 5, ApplicationRole: "screw"}},
		})
	}); err != nil {
		t.Fatalf("create org B profile: %v", err)
	}
	var ownB []domain.HardwareProfile
	if err := tenantStore.WithinTenantTx(storage.WithOrgCtx(ctx, orgB), actorB, func(txCtx context.Context) error {
		var listErr error
		ownB, listErr = tenantStore.ListHardwareProfiles(txCtx)
		return listErr
	}); err != nil || len(ownB) == 0 {
		t.Fatalf("org B profile row: %+v, %v", ownB, err)
	}
	if err := tenantStore.WithinTenantTx(storage.WithOrgCtx(ctx, orgB), actorB, func(txCtx context.Context) error {
		return tenantStore.SetComponentSideAssignment(txCtx, &domain.ComponentSideAssignment{ComponentID: compB, Side: "back", ProfileID: ownB[0].ID})
	}); err != nil {
		t.Fatalf("org B assignment: %v", err)
	}

	// Overlays: A governs 4 stations, B governs 2 — same Standard, different
	// factories.
	release, err := adminStore.GetCurrentPublishedRelease(ctx, uuid.MustParse(domain.GraneteStandardLibraryID))
	if err != nil {
		t.Fatalf("published release: %v", err)
	}
	saveOverlay := func(actor storage.TenantActor, org string, stations int) {
		t.Helper()
		overrides, _ := json.Marshal(map[string]any{
			"joint.floorToSide.systemId":      "screw-only",
			"joint.floorToSide.stationsCount": stations,
			"joint.floorToSide.startMarginMm": 40,
			"joint.floorToSide.endMarginMm":   40,
		})
		if err := tenantStore.WithinTenantTx(storage.WithOrgCtx(ctx, org), actor, func(txCtx context.Context) error {
			_, err := tenantStore.CreateOverlay(txCtx, &domain.LibraryOverlay{
				OrganizationID: uuid.MustParse(org), LibraryID: uuid.MustParse(domain.GraneteStandardLibraryID),
				BaseReleaseID: release.ID, Status: "active", Overrides: overrides,
			})
			return err
		}); err != nil {
			t.Fatalf("overlay %d: %v", stations, err)
		}
	}
	saveOverlay(actorA, orgA, 4)
	saveOverlay(actorB, orgB, 2)

	// THE loader, per factory, under real tenant transactions.
	var inputsA *engine.ReleaseServerInputs
	if err := tenantStore.WithinTenantTx(storage.WithOrgCtx(ctx, orgA), actorA, func(txCtx context.Context) error {
		var loadErr error
		inputsA, loadErr = tenantStore.ReleaseServerResolveInputs(txCtx, orgA)
		return loadErr
	}); err != nil {
		t.Fatalf("loader A: %v", err)
	}
	if len(inputsA.SideRecipes) != 1 || inputsA.SideRecipes[0].CatalogComponentID != compA ||
		inputsA.SideRecipes[0].TechnicalProfileID != profileA {
		t.Fatalf("org A must synthesize exactly its own recipe: %+v", inputsA.SideRecipes)
	}
	if inputsA.Policy == nil || inputsA.Policy.FloorToSide == nil || inputsA.Policy.FloorToSide.StationsCount != 4 {
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
	if len(inputsB.SideRecipes) != 0 {
		t.Fatalf("org B's unpinned profile synthesizes no recipe: %+v", inputsB.SideRecipes)
	}
	if inputsB.Policy == nil || inputsB.Policy.FloorToSide == nil || inputsB.Policy.FloorToSide.StationsCount != 2 {
		t.Fatalf("org B policy = %+v", inputsB.Policy)
	}
}
