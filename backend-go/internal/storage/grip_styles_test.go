package storage_test

// #1531 — grip styles on real PostgreSQL (disposable database only):
// migration 000181 fresh + upgrade with the blob conversion and its report,
// down + re-apply, RLS isolation and runtime-role direct SQL, the single
// default under a race, audit in the same transaction, and rollback.

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func handleRecipes() map[string]domain.GripStyleRecipe {
	return map[string]domain.GripStyleRecipe{
		"inferior": {Mode: domain.GripModeHandle},
		"superior": {Mode: domain.GripModeHandle},
		"alto":     {Mode: domain.GripModeHandle},
	}
}

func overhangRecipes(mm float64) map[string]domain.GripStyleRecipe {
	recipes := handleRecipes()
	recipes["superior"] = domain.GripStyleRecipe{Mode: domain.GripModeBottomOverhang, OverhangMm: &mm}
	return recipes
}

func TestGripStylesMigrationFreshAndUpgrade(t *testing.T) {
	ctx := context.Background()

	t.Run("fresh schema: RLS, inventory, single default and the seed trigger", func(t *testing.T) {
		pool := multiOrgFreshMigrationDB(t)
		identityApplyThrough(t, pool, 181)
		var rls, forced bool
		var classification string
		if err := pool.QueryRow(ctx, `
			SELECT c.relrowsecurity, c.relforcerowsecurity, i.classification
			FROM pg_class c JOIN rls_policy_inventory i ON i.table_name = c.relname
			WHERE c.relname = 'grip_styles'`).Scan(&rls, &forced, &classification); err != nil {
			t.Fatal(err)
		}
		if !rls || !forced || classification != "tenant-owned" {
			t.Fatalf("grip_styles RLS drifted: rls=%v forced=%v class=%q", rls, forced, classification)
		}
		// Every existing organization has exactly one default «Jaladera».
		var orgs, defaults int
		if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM organizations),
			(SELECT count(*) FROM grip_styles WHERE is_default AND name = 'Jaladera')`).Scan(&orgs, &defaults); err != nil {
			t.Fatal(err)
		}
		if orgs == 0 || orgs != defaults {
			t.Fatalf("each organization needs its default Jaladera: orgs=%d defaults=%d", orgs, defaults)
		}
		// A new organization gets it from the trigger.
		const newOrg = "aaaaaaaa-0000-0000-0000-0000000001f1"
		if _, err := pool.Exec(ctx, `INSERT INTO organizations (id, name, slug, status) VALUES ($1, 'Taller 1531', 'taller-1531', 'provisioning')`, newOrg); err != nil {
			t.Fatalf("insert organization: %v", err)
		}
		var seeded string
		if err := pool.QueryRow(ctx, `SELECT name FROM grip_styles WHERE organization_id = $1 AND is_default`, newOrg).Scan(&seeded); err != nil || seeded != "Jaladera" {
			t.Fatalf("new organization seed: %q %v", seeded, err)
		}
		// The database refuses a second default and a style without a type.
		_, err := pool.Exec(ctx, `INSERT INTO grip_styles (organization_id, name, is_default, by_furniture_type)
			VALUES ($1, 'Otro', TRUE, '{"inferior":{"mode":"handle"},"superior":{"mode":"handle"},"alto":{"mode":"handle"}}')`, newOrg)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.ConstraintName != "grip_styles_one_default_per_org" {
			t.Fatalf("a second default must hit the unique index: %v", err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO grip_styles (organization_id, name, by_furniture_type)
			VALUES ($1, 'Incompleto', '{"inferior":{"mode":"handle"}}')`, newOrg); err == nil {
			t.Fatal("a style must declare every furniture type")
		}
	})

	t.Run("upgrade converts the pilot blobs with a report, removes them, down restores, re-apply is stable", func(t *testing.T) {
		pool := multiOrgFreshMigrationDB(t)
		identityApplyThrough(t, pool, 180)
		const orgB = "aaaaaaaa-0000-0000-0000-0000000001f2"
		if _, err := pool.Exec(ctx, `INSERT INTO organizations (id, name, slug, status) VALUES ($1, 'Taller rebase', 'taller-rebase', 'provisioning')`, orgB); err != nil {
			t.Fatal(err)
		}
		// A usable gola L (v2 fields) and an unusable one in the initial org.
		if _, err := pool.Exec(ctx, `INSERT INTO opening_profiles
			(id, organization_id, code, name, grip_type, cross_section_shape, compatible_placements, datasheet_status,
			 material, positions, front_discount_top_mm, profile_height_mm, profile_depth_mm, active)
			VALUES ('p-l', $1, 'GOLA-L', 'Gola L', 'gola', 'L', '{top}', 'verified', 'aluminum', '{top}', 40, 56.5, 27.2, TRUE),
			       ('p-x', $1, 'GOLA-X', 'Gola X', 'gola', 'L', '{top}', 'pending', 'aluminum', '{top}', NULL, 56.5, 27.2, TRUE)`,
			multiOrgInitialOrgID); err != nil {
			t.Fatalf("seed profiles: %v", err)
		}
		caps := `{"version":1,"grips":{"handle":{"enabled":true},"gola":{"enabled":true,"default":true,"profiles":["p-x","p-l"],"standardProfiles":{"L":"p-l"}},"bottom_overhang":{"enabled":true}},"byFurnitureType":{"superior":{"grips":{"bottom_overhang":{"default":true}}}}}`
		if _, err := pool.Exec(ctx, `INSERT INTO library_overlays (id, organization_id, library_id, base_release_id, status, overrides)
			VALUES ('11111111-0000-0000-0000-000000001531', $1, $2, $3, 'active',
			        jsonb_build_object('opening.capabilities', $4::jsonb, 'opening.bottom-overhang', '{"version":1,"overhangMm":40}'::jsonb, 'joint.keep', 'yes')),
			       ('22222222-0000-0000-0000-000000001531', $5, $2, $3, 'active',
			        jsonb_build_object('opening.bottom-overhang', '{"version":1,"overhangMm":25}'::jsonb))`,
			multiOrgInitialOrgID, domain.GraneteStandardLibraryID, domain.GraneteStandardDraftReleaseID, caps, orgB); err != nil {
			t.Fatalf("seed overlays: %v", err)
		}

		applyMigrationFile(t, pool, "000181_grip_styles.up.sql")

		type row struct {
			Name      string
			IsDefault bool
			Recipes   map[string]map[string]any
			Report    map[string]any
		}
		read := func(org string) map[string]row {
			rows, err := pool.Query(ctx, `SELECT name, is_default, by_furniture_type, COALESCE(migration_report, 'null'::jsonb)
				FROM grip_styles WHERE organization_id = $1`, org)
			if err != nil {
				t.Fatal(err)
			}
			defer rows.Close()
			out := map[string]row{}
			for rows.Next() {
				var r row
				var recipes, report []byte
				if err := rows.Scan(&r.Name, &r.IsDefault, &recipes, &report); err != nil {
					t.Fatal(err)
				}
				_ = json.Unmarshal(recipes, &r.Recipes)
				_ = json.Unmarshal(report, &r.Report)
				out[r.Name] = r
			}
			return out
		}

		a := read(multiOrgInitialOrgID)
		migrated, ok := a["Agarre del taller (migrado)"]
		if !ok || !migrated.IsDefault || a["Jaladera"].IsDefault {
			t.Fatalf("initial org: the converted style must be the default: %+v", a)
		}
		if migrated.Recipes["inferior"]["mode"] != "gola" || migrated.Recipes["inferior"]["topProfileId"] != "p-l" {
			t.Fatalf("the unusable p-x must be skipped and the standard p-l used: %+v", migrated.Recipes["inferior"])
		}
		if migrated.Recipes["superior"]["mode"] != "bottom_overhang" || migrated.Recipes["superior"]["overhangMm"] != float64(40) {
			t.Fatalf("superior must keep the 40 mm overhang: %+v", migrated.Recipes["superior"])
		}
		if migrated.Report["action"] != "converted" || migrated.Report["overlayId"] == nil || migrated.Report["capabilities"] == nil {
			t.Fatalf("the per-row report must carry the source blobs: %+v", migrated.Report)
		}
		b := read(orgB)
		if !b["Jaladera"].IsDefault || b["Rebase (migrado)"].Recipes["superior"]["overhangMm"] != float64(25) {
			t.Fatalf("org B: Jaladera default plus the 25 mm overhang kept as a style: %+v", b)
		}
		var leftover int
		var keepKey string
		if err := pool.QueryRow(ctx, `SELECT
			(SELECT count(*) FROM library_overlays WHERE overrides ? 'opening.capabilities' OR overrides ? 'opening.bottom-overhang'),
			(SELECT overrides->>'joint.keep' FROM library_overlays WHERE id = '11111111-0000-0000-0000-000000001531')`).Scan(&leftover, &keepKey); err != nil {
			t.Fatal(err)
		}
		if leftover != 0 || keepKey != "yes" {
			t.Fatalf("blobs must be removed and foreign keys kept: leftover=%d keep=%q", leftover, keepKey)
		}

		applyMigrationFile(t, pool, "000181_grip_styles.down.sql")
		var restored int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM library_overlays
			WHERE overrides ? 'opening.capabilities' OR overrides ? 'opening.bottom-overhang'`).Scan(&restored); err != nil {
			t.Fatal(err)
		}
		if restored != 2 {
			t.Fatalf("down must put the blobs back on both overlays, got %d", restored)
		}

		applyMigrationFile(t, pool, "000181_grip_styles.up.sql")
		again := read(multiOrgInitialOrgID)
		if !again["Agarre del taller (migrado)"].IsDefault {
			t.Fatalf("re-apply drifted: %+v", again)
		}
	})
}

func TestGripStylesRuntimeRLSRaceAuditRollback(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store, orgA, orgB := fixture.store, fixture.orgA, fixture.orgB
	ctx := context.Background()

	list := func(org string) []domain.GripStyle {
		return isolationFamilyValue(t, fixture, org, func(txCtx context.Context) ([]domain.GripStyle, error) {
			return store.ListGripStyles(txCtx)
		})
	}
	defaults := func(org string) int {
		count := 0
		for _, style := range list(org) {
			if style.IsDefault {
				count++
			}
		}
		return count
	}
	if defaults(orgA) != 1 || defaults(orgB) != 1 {
		t.Fatalf("every organization starts with one default: A=%d B=%d", defaults(orgA), defaults(orgB))
	}

	// Validation: overhang rules and unknown profiles answer validation errors.
	for _, mm := range []float64{0, -5, 12.5} {
		style := &domain.GripStyle{Name: "Malo", Offered: true, ByFurnitureType: overhangRecipes(mm)}
		err := isolationFamilyError(t, fixture, orgA, func(txCtx context.Context) error {
			return store.CreateGripStyle(txCtx, style, storage.GripStyleWriteMeta{})
		})
		var invalid *domain.GripStyleValidationError
		if !errors.As(err, &invalid) {
			t.Fatalf("overhang %g must be rejected, got %v", mm, err)
		}
	}
	unknown := &domain.GripStyle{Name: "Gola fantasma", Offered: true, ByFurnitureType: handleRecipes()}
	unknown.ByFurnitureType["inferior"] = domain.GripStyleRecipe{Mode: domain.GripModeGola, TopProfileID: "no-existe"}
	if err := isolationFamilyError(t, fixture, orgA, func(txCtx context.Context) error {
		return store.CreateGripStyle(txCtx, unknown, storage.GripStyleWriteMeta{})
	}); err == nil || !strings.Contains(err.Error(), "no existe") {
		t.Fatalf("an unknown profile must be rejected in Spanish: %v", err)
	}

	// Create in A with the default 20 mm, audited in the same transaction.
	style := &domain.GripStyle{Name: "Rebase 1531", Offered: true, ByFurnitureType: handleRecipes()}
	style.ByFurnitureType["superior"] = domain.GripStyleRecipe{Mode: domain.GripModeBottomOverhang}
	if err := isolationFamilyError(t, fixture, orgA, func(txCtx context.Context) error {
		return store.CreateGripStyle(txCtx, style, storage.GripStyleWriteMeta{RequestID: "req-1531"})
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if got := style.OverhangMmFor("superior"); got == nil || *got != 20 {
		t.Fatalf("the overhang defaults to 20 (A4): %v", got)
	}
	var audits int
	if err := runConnectStoreSQL(t, store.Pool, fixture.actorA, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM security_audit_events
			WHERE event_type = 'grip_style_created' AND details->>'grip_style_id' = $1 AND actor_user_id IS NOT NULL`, style.ID).Scan(&audits)
	}); err != nil || audits != 1 {
		t.Fatalf("the create must be audited once with its actor: %d %v", audits, err)
	}

	// Rollback: a failure after the write leaves neither the row nor its audit.
	rolledBack := &domain.GripStyle{Name: "Fantasma", Offered: true, ByFurnitureType: handleRecipes()}
	sentinel := errors.New("rollback 1531")
	err := store.WithinTenantTx(storage.WithOrgCtx(ctx, orgA), fixture.actorA, func(txCtx context.Context) error {
		if err := store.CreateGripStyle(txCtx, rolledBack, storage.GripStyleWriteMeta{}); err != nil {
			return err
		}
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("rollback scenario: %v", err)
	}
	for _, existing := range list(orgA) {
		if existing.Name == "Fantasma" {
			t.Fatal("a rolled-back style must not exist")
		}
	}
	if err := runConnectStoreSQL(t, store.Pool, fixture.actorA, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM security_audit_events
			WHERE event_type = 'grip_style_created' AND details->>'name' = 'Fantasma'`).Scan(&audits)
	}); err != nil || audits != 0 {
		t.Fatalf("a rolled-back audit must not exist: %d %v", audits, err)
	}

	// RLS: B never lists, reads, updates or deletes A's style.
	for _, other := range list(orgB) {
		if other.ID == style.ID {
			t.Fatal("org B listed org A's style")
		}
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error {
		_, err := store.GetGripStyle(txCtx, style.ID)
		return err
	}); !errors.Is(err, storage.ErrGripStyleNotFound) {
		t.Fatalf("org B read: %v", err)
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error {
		update := *style
		return store.UpdateGripStyle(txCtx, style.ID, style.Version, &update, storage.GripStyleWriteMeta{})
	}); !errors.Is(err, storage.ErrGripStyleNotFound) {
		t.Fatalf("org B update: %v", err)
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error {
		return store.DeleteGripStyle(txCtx, style.ID, style.Version, storage.GripStyleWriteMeta{})
	}); !errors.Is(err, storage.ErrGripStyleNotFound) {
		t.Fatalf("org B delete: %v", err)
	}

	// Direct SQL under the runtime role (no BYPASSRLS): B cannot see, write
	// or forge A's rows, and a second default in A hits the unique index.
	var bypass bool
	if err := runConnectStoreSQL(t, store.Pool, fixture.actorB, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`).Scan(&bypass)
	}); err != nil || bypass {
		t.Fatalf("the runtime role must not bypass RLS: %v %v", bypass, err)
	}
	if err := runConnectStoreSQL(t, store.Pool, fixture.actorB, func(tx pgx.Tx) error {
		var visible int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM grip_styles WHERE id::text = $1`, style.ID).Scan(&visible); err != nil {
			return err
		}
		if visible != 0 {
			t.Fatal("RLS breach: B sees A's style through direct SQL")
		}
		tag, err := tx.Exec(ctx, `UPDATE grip_styles SET name = 'hack' WHERE id::text = $1`, style.ID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 0 {
			t.Fatal("RLS breach: B updated A's style")
		}
		_, err = tx.Exec(ctx, `INSERT INTO grip_styles (organization_id, name, by_furniture_type)
			VALUES ($1, 'Forjado', '{"inferior":{"mode":"handle"},"superior":{"mode":"handle"},"alto":{"mode":"handle"}}')`, orgA)
		if err == nil {
			t.Fatal("RLS breach: B inserted a row for A")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := runConnectStoreSQL(t, store.Pool, fixture.actorA, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE grip_styles SET is_default = TRUE WHERE id::text = $1`, style.ID)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.ConstraintName != "grip_styles_one_default_per_org" {
			t.Fatalf("a second default by direct SQL must hit the unique index: %v", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	// Race: two writers make two different styles the default at the same
	// time — both commit in order, and exactly one default remains.
	second := &domain.GripStyle{Name: "Jaladera bis", Offered: true, ByFurnitureType: handleRecipes()}
	if err := isolationFamilyError(t, fixture, orgA, func(txCtx context.Context) error {
		return store.CreateGripStyle(txCtx, second, storage.GripStyleWriteMeta{})
	}); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, target := range []*domain.GripStyle{style, second} {
		wg.Add(1)
		go func(i int, target domain.GripStyle) {
			defer wg.Done()
			update := target
			update.IsDefault = true
			errs[i] = isolationFamilyError(t, fixture, orgA, func(txCtx context.Context) error {
				return store.UpdateGripStyle(txCtx, target.ID, target.Version, &update, storage.GripStyleWriteMeta{})
			})
		}(i, *target)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil && !errors.Is(err, storage.ErrVersionConflict) {
			t.Fatalf("writer %d: %v", i, err)
		}
	}
	if defaults(orgA) != 1 {
		t.Fatalf("exactly one default must remain after the race, got %d", defaults(orgA))
	}

	// The default cannot be deleted, nor stop being the default by itself.
	var current domain.GripStyle
	for _, candidate := range list(orgA) {
		if candidate.IsDefault {
			current = candidate
		}
	}
	err = isolationFamilyError(t, fixture, orgA, func(txCtx context.Context) error {
		return store.DeleteGripStyle(txCtx, current.ID, current.Version, storage.GripStyleWriteMeta{})
	})
	var invalid *domain.GripStyleValidationError
	if !errors.As(err, &invalid) || !strings.Contains(invalid.Message, "elige otro") {
		t.Fatalf("deleting the default must be refused in Spanish: %v", err)
	}
	unset := current
	unset.IsDefault = false
	if err := isolationFamilyError(t, fixture, orgA, func(txCtx context.Context) error {
		return store.UpdateGripStyle(txCtx, current.ID, current.Version, &unset, storage.GripStyleWriteMeta{})
	}); !errors.As(err, &invalid) {
		t.Fatalf("the default cannot stop being the default by itself: %v", err)
	}

	// The projection: capabilities and overhang come from the styles.
	rule := isolationFamilyValue(t, fixture, orgA, func(txCtx context.Context) (*domain.OpeningOverhangRule, error) {
		return store.GetOpeningOverhangRule(txCtx)
	})
	if rule == nil || rule.OverhangMm != 20 {
		t.Fatalf("overhang projection: %+v", rule)
	}
	caps := isolationFamilyValue(t, fixture, orgA, func(txCtx context.Context) (*domain.OpeningCapabilities, error) {
		return store.GetOpeningCapabilities(txCtx)
	})
	if caps == nil || !caps.Grips[domain.OpeningGripSystemHandle].Enabled || !caps.Grips[domain.OpeningGripSystemBottomOverhang].Enabled {
		t.Fatalf("capabilities projection: %+v", caps)
	}
}
