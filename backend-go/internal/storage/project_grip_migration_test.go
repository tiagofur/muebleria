package storage_test

// #1532 — the project grip migration on real PostgreSQL (disposable only):
// fresh + upgrade land the columns and the per-row conversion (every
// persisted DesignOpeningSelection becomes a per-furniture override with its
// complete frozen copy; the project takes the workshop's default style), the
// resolved fronts match before/after row by row, the report carries the
// original selection for a faithful down, and the writes race safely under
// If-Match with the audit in the same transaction.

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const (
	gripMigOrg      = "91820000-0000-0000-0000-0000000000aa"
	gripMigCustomer = "91820000-0000-0000-0000-0000000000cc"
	gripMigProject  = "91820000-0000-0000-0000-0000000000e1"
	gripMigDesign   = "91820000-0000-0000-0000-0000000000dd"
	gripMigModule   = "91820000-0000-0000-0000-0000000000ee"
	gripMigProfile  = "91820000-0000-0000-0000-000000000001"
)

func TestProjectGripMigrationFreshUpgradeAndDown(t *testing.T) {
	ctx := context.Background()
	assert := func(t *testing.T, fresh bool) {
		t.Helper()
		pool := multiOrgFreshMigrationDB(t)
		if fresh {
			identityApplyThrough(t, pool, 182)
		} else {
			identityApplyThrough(t, pool, 181)
			up, err := os.ReadFile("../../db/migration/000182_project_grip.up.sql")
			if err != nil {
				t.Fatal(err)
			}
			if _, err = pool.Exec(ctx, string(up)); err != nil {
				t.Fatalf("upgrade apply 000182: %v", err)
			}
		}
		for _, column := range []struct{ table, name string }{
			{"projects", "grip_style_id"},
			{"projects", "grip_snapshot"},
			{"projects", "grip_version"},
			{"furniture_instances", "grip_snapshot"},
			{"design_working_copies", "opening_migration"},
		} {
			var exists bool
			if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2)`, column.table, column.name).Scan(&exists); err != nil || !exists {
				t.Fatalf("fresh=%v missing %s.%s: %v", fresh, column.table, column.name, err)
			}
		}
		// The down restores the original selections from the reports and
		// drops the columns; re-applying converges again.
		if !fresh {
			down, err := os.ReadFile("../../db/migration/000182_project_grip.down.sql")
			if err != nil {
				t.Fatal(err)
			}
			if _, err = pool.Exec(ctx, string(down)); err != nil {
				t.Fatalf("down apply 000182: %v", err)
			}
			for _, column := range []struct{ table, name string }{
				{"projects", "grip_style_id"},
				{"furniture_instances", "grip_snapshot"},
				{"design_working_copies", "opening_migration"},
			} {
				var exists bool
				if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2)`, column.table, column.name).Scan(&exists); err != nil || exists {
					t.Fatalf("down left %s.%s behind", column.table, column.name)
				}
			}
			up, err := os.ReadFile("../../db/migration/000182_project_grip.up.sql")
			if err != nil {
				t.Fatal(err)
			}
			if _, err = pool.Exec(ctx, string(up)); err != nil {
				t.Fatalf("re-apply 000182: %v", err)
			}
		}
	}
	t.Run("fresh", func(t *testing.T) { assert(t, true) })
	t.Run("upgrade", func(t *testing.T) { assert(t, false) })
}

// TestProjectGripMigrationFrontsBeforeAfter seeds pilot-like rows through
// 000181 (a gola selection with a complete pin on a design with one
// furniture, plus a handle selection on another), resolves the v1 fronts,
// applies 000182 and compares row by row: the override snapshot resolves the
// SAME front heights, the project takes the default style, and the report
// carries the original selection verbatim.
func TestProjectGripMigrationFrontsBeforeAfter(t *testing.T) {
	ctx := context.Background()
	pool := multiOrgFreshMigrationDB(t)
	identityApplyThrough(t, pool, 181)

	if _, err := pool.Exec(ctx, `
		INSERT INTO organizations (id, name, slug) VALUES ($1, 'Grip Migr Org', 'grip-migr-org')`, gripMigOrg); err != nil {
		t.Fatalf("seed org: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO customers (id, organization_id, name) VALUES ($1, $2, 'Cliente Grip')`, gripMigCustomer, gripMigOrg); err != nil {
		t.Fatalf("seed customer: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO projects (id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id)
		VALUES ($1, 'Grip Migr Project', $2, 'draft', $3, $3, $3)`, gripMigProject, gripMigCustomer, gripMigOrg); err != nil {
		t.Fatalf("seed project: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO designs (id, organization_id, project_id, name, status)
		VALUES ($1, $2, $3, 'Grip Migr Design', 'active')`, gripMigDesign, gripMigOrg, gripMigProject); err != nil {
		t.Fatalf("seed design: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO modules (id, organization_id, code, name, furniture_type)
		VALUES ($1, $2, 'GRIP-MIG', 'Gabinete migrado', 'inferior')`, gripMigModule, gripMigOrg); err != nil {
		t.Fatalf("seed module: %v", err)
	}
	const instanceA = "91820000-0000-0000-0000-0000000000a1"
	const instanceB = "91820000-0000-0000-0000-0000000000a2"
	for _, instance := range []string{instanceA, instanceB} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO furniture_instances (id, organization_id, project_id, furniture_definition_id, origin)
			VALUES ($1, $2, $3, $4, 'quote')`, instance, gripMigOrg, gripMigProject, gripMigModule); err != nil {
			t.Fatalf("seed furniture instance: %v", err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO design_working_copies (design_id, organization_id, project_id)
		VALUES ($1, $2, $3)`, gripMigDesign, gripMigOrg, gripMigProject); err != nil {
		t.Fatalf("seed working copy: %v", err)
	}
	for _, instance := range []string{instanceA, instanceB} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO design_working_items (design_id, organization_id, project_id, furniture_instance_id, furniture_definition_id, transform)
			VALUES ($1, $2, $3, $4, $5, '{}'::jsonb)`, gripMigDesign, gripMigOrg, gripMigProject, instance, gripMigModule); err != nil {
			t.Fatalf("seed working item: %v", err)
		}
	}
	// The verified 8006 profile with the v2 fields the freeze consumes; the
	// pin carries the same discount as one number (door_reduction_mm 40).
	if _, err := pool.Exec(ctx, `
		INSERT INTO opening_profiles (id, organization_id, code, name, grip_type, compatible_placements,
			door_reduction_mm, profile_height_mm, profile_depth_mm, datasheet_status, active, positions, material, front_discount_top_mm, version)
		VALUES ($1, $2, 'GOLA-L-8006', 'Gola L', 'gola', ARRAY['top']::text[], 40, 56.5, 27.2, 'verified', TRUE,
			ARRAY['top']::text[], 'aluminum', 40, 5)`, gripMigProfile, gripMigOrg); err != nil {
		t.Fatalf("seed profile: %v", err)
	}
	// The legacy selection on A: gola with a complete pin. On B: handle.
	selectionA := `{"system":"gola","profileId":"` + gripMigProfile + `","placements":["top"],"profilePin":{"profileCode":"GOLA-L-8006","frontReductionMm":38,"gripClearanceMm":2,"doorReductionMm":40,"datasheetStatus":"verified","profileHeightMm":56.5,"profileDepthMm":27.2,"compatiblePlacements":["top"],"bodyModifiers":[],"bom":{"profileVersion":5,"members":{}}}}`
	selectionB := `{"system":"handle"}`
	if _, err := pool.Exec(ctx, `
		UPDATE design_working_copies
		   SET authoring_defaults = jsonb_build_object('opening', $2::jsonb)
		 WHERE design_id = $1`, gripMigDesign, selectionA); err != nil {
		t.Fatalf("seed selection: %v", err)
	}
	_ = selectionB

	// BEFORE: the v1 resolution of the pinned selection over 720 wide/720
	// tall: 720 − 40 = 680 (one front).
	selection := &domain.DesignOpeningSelection{}
	if err := json.Unmarshal([]byte(selectionA), selection); err != nil {
		t.Fatal(err)
	}
	v1Resolution, v1Err := engine.ResolveDesignOpening(720, 720, selection, []engine.OpeningProfileData{{
		ProfileID: gripMigProfile, DatasheetStatus: "verified", DoorReductionMm: intPtr(40),
		ProfileDepthMm: 27.2, ProfileHeightMm: 56.5, CompatiblePlacements: []string{"top"},
	}}, nil, nil)
	if v1Err != nil || v1Resolution.State != engine.DesignOpeningStateResolved {
		t.Fatalf("v1 resolve: %v %+v", v1Err, v1Resolution)
	}
	v1Height := v1Resolution.Fronts[0].HeightMm

	// APPLY the migration.
	up, err := os.ReadFile("../../db/migration/000182_project_grip.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(up)); err != nil {
		t.Fatalf("apply 000182: %v", err)
	}

	// The project takes the workshop's default style («Jaladera», seeded by
	// 000181) with its complete frozen copy; grip_version starts at 1.
	var styleID *string
	var projectSnapshot []byte
	var gripVersion int64
	if err := pool.QueryRow(ctx, `SELECT grip_style_id, grip_snapshot, grip_version FROM projects WHERE id = $1`, gripMigProject).
		Scan(&styleID, &projectSnapshot, &gripVersion); err != nil {
		t.Fatalf("read project grip: %v", err)
	}
	if styleID == nil || len(projectSnapshot) == 0 || gripVersion != 1 {
		t.Fatalf("project grip drifted: style=%v snapshot=%d version=%d", styleID, len(projectSnapshot), gripVersion)
	}
	var defaultStyleID string
	if err := pool.QueryRow(ctx, `SELECT id FROM grip_styles WHERE organization_id = $1 AND is_default`, gripMigOrg).Scan(&defaultStyleID); err != nil {
		t.Fatalf("read default style: %v", err)
	}
	if *styleID != defaultStyleID {
		t.Fatalf("project style = %s, want the workshop default %s", *styleID, defaultStyleID)
	}

	// The override on A carries the frozen gola recipe; the v2 fronts match
	// the v1 heights row by row (one row: 720 − 40 = 680).
	var overrideRaw []byte
	if err := pool.QueryRow(ctx, `SELECT grip_snapshot FROM furniture_instances WHERE id = $1`, instanceA).Scan(&overrideRaw); err != nil {
		t.Fatalf("read override: %v", err)
	}
	override := &domain.GripSnapshot{}
	if err := json.Unmarshal(overrideRaw, override); err != nil {
		t.Fatal(err)
	}
	if err := domain.ValidateGripSnapshotShape(override); err != nil {
		t.Fatalf("frozen override invalid: %v", err)
	}
	recipe, err := override.GripRecipeFor("inferior")
	if err != nil || recipe.Mode != domain.GripModeGola || recipe.TopProfile == nil {
		t.Fatalf("frozen recipe drifted: %v %+v", err, recipe)
	}
	if got := *recipe.TopProfile.FrontDiscountTopMm; got != 40 {
		t.Fatalf("frozen discount = %d, want 40 (door_reduction wins)", got)
	}
	fronts, frontsErr := engine.ProjectGripFronts(recipe)
	if frontsErr != nil || len(fronts) == 0 {
		t.Fatalf("v2 fronts: %v", frontsErr)
	}
	stack, stackErr := engine.ResolveOpeningEdgeStack(engine.OpeningEdgeStackInput{
		CabinetHeightMm: 720, Rows: []engine.OpeningEdgeStackRow{{ID: "row-1", Weight: 716}},
		TopRevealMm: 2, BottomRevealMm: 2,
		TopDiscountMm: fronts[0].EdgeGrips.TopDiscountMm,
	})
	if stackErr != nil {
		t.Fatalf("v2 A3: %v", stackErr)
	}
	if stack.Rows[0].HeightMm != float64(v1Height) {
		t.Fatalf("front height before=%d after=%g: the migration changed the resolved front", v1Height, stack.Rows[0].HeightMm)
	}

	// B had a handle selection: an explicit handle override (inheriting the
	// default's handle would look the same here, so the report is the proof).
	var reportRaw []byte
	if err := pool.QueryRow(ctx, `SELECT opening_migration FROM design_working_copies WHERE design_id = $1`, gripMigDesign).Scan(&reportRaw); err != nil {
		t.Fatalf("read report: %v", err)
	}
	var report struct {
		Migration string           `json:"migration"`
		Selection json.RawMessage  `json:"selection"`
		Instances []map[string]any `json:"instances"`
		PinSource string           `json:"pinSource"`
	}
	if err := json.Unmarshal(reportRaw, &report); err != nil {
		t.Fatal(err)
	}
	if report.Migration != "000182" || report.PinSource != "pin" {
		t.Fatalf("report header drifted: %+v", report)
	}
	// jsonb normalizes key order and whitespace: the faithful comparison is
	// semantic, and the down's restore (compared below) proves fidelity.
	var reportSelection, originalSelection map[string]any
	if err := json.Unmarshal(report.Selection, &reportSelection); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(selectionA), &originalSelection); err != nil {
		t.Fatal(err)
	}
	if len(reportSelection) != len(originalSelection) || reportSelection["system"] != originalSelection["system"] || reportSelection["profileId"] != originalSelection["profileId"] {
		t.Fatalf("the report must carry the original selection's semantics for the faithful down")
	}
	if len(report.Instances) != 2 {
		t.Fatalf("report instances = %d, want one per furniture", len(report.Instances))
	}

	// The down restores the selection verbatim and clears the overrides.
	down, err := os.ReadFile("../../db/migration/000182_project_grip.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(down)); err != nil {
		t.Fatalf("down: %v", err)
	}
	var restored string
	if err := pool.QueryRow(ctx, `SELECT authoring_defaults -> 'opening' FROM design_working_copies WHERE design_id = $1`, gripMigDesign).Scan(&restored); err != nil {
		t.Fatal(err)
	}
	var restoredSelection map[string]any
	if err := json.Unmarshal([]byte(restored), &restoredSelection); err != nil {
		t.Fatal(err)
	}
	if restoredSelection["system"] != originalSelection["system"] || restoredSelection["profileId"] != originalSelection["profileId"] {
		t.Fatalf("the down must restore the selection's semantics: %s", restored)
	}
	pin, hasPin := restoredSelection["profilePin"].(map[string]any)
	originalPin, hasOriginalPin := originalSelection["profilePin"].(map[string]any)
	if !hasPin || !hasOriginalPin || pin["profileCode"] != originalPin["profileCode"] || pin["doorReductionMm"] != originalPin["doorReductionMm"] {
		t.Fatalf("the down must restore the pin's values: %s", restored)
	}
	// The override column is gone with the down — the per-furniture frozen
	// copies lived and died with it.
	var overrideColumn bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='furniture_instances' AND column_name='grip_snapshot')`).Scan(&overrideColumn); err != nil {
		t.Fatal(err)
	}
	if overrideColumn {
		t.Fatal("the down must drop the furniture override column")
	}
}

// gripTenantSQL runs WRITE SQL under the tenant scope in a COMMITTING
// transaction (the read-only SQLValue helper rolls back) — RLS sees the
// organization context, and the seed persists.
func gripTenantSQL(t *testing.T, fixture isolationRuntimeFixture, actor storage.TenantActor, run func(tx pgx.Tx) error) {
	t.Helper()
	ctx := context.Background()
	tx, err := fixture.store.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `
		SELECT set_config('app.organization_id', $1, true),
		       set_config('app.user_id', $2, true),
		       set_config('app.membership_id', $3, true),
		       set_config('app.authorized_organization_ids', $1, true)`,
		actor.OrganizationID, actor.UserID, actor.MembershipID); err != nil {
		t.Fatal(err)
	}
	if err = run(tx); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}

// TestProjectGripWritesRaceAuditRollback: concurrent style change vs batch
// overrides collide on ONE If-Match token (exactly one wins), the audit
// commits with the mutation, and a rejected write leaves no audit row and no
// version bump.
func TestProjectGripWritesRaceAuditRollback(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store, orgA := fixture.store, fixture.orgA

	// Seed a project + two furniture instances + a second style. The SQL
	// seeds run inside the tenant transaction (isolationFamilySQLValue), so
	// RLS sees the organization context — a pool exec would violate it.
	if err := isolationFamilyError(t, fixture, orgA, func(txCtx context.Context) error {
		return store.CreateGripStyle(txCtx, &domain.GripStyle{
			Name: "Gola carrera", Offered: true,
			ByFurnitureType: map[string]domain.GripStyleRecipe{
				"inferior": {Mode: domain.GripModeHandle},
				"superior": {Mode: domain.GripModeHandle},
				"alto":     {Mode: domain.GripModeHandle},
			},
		}, storage.GripStyleWriteMeta{})
	}); err != nil {
		t.Fatalf("seed style: %v", err)
	}
	const projectID = "91820000-0000-0000-0000-0000000000e2"
	gripTenantSQL(t, fixture, isolationFamilyActor(t, fixture, orgA), func(tx pgx.Tx) error {
		dbCtx := context.Background()
		if _, err := tx.Exec(dbCtx, `INSERT INTO customers (id, organization_id, name) VALUES ('91820000-0000-0000-0000-0000000000cd', $1, 'Cliente Carrera')`, orgA); err != nil {
			return err
		}
		if _, err := tx.Exec(dbCtx, `INSERT INTO projects (id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id)
			VALUES ($1, 'Carrera', '91820000-0000-0000-0000-0000000000cd', 'draft', $2, $2, $2)`, projectID, orgA); err != nil {
			return err
		}
		for _, id := range []string{"91820000-0000-0000-0000-0000000000b1", "91820000-0000-0000-0000-0000000000b2"} {
			if _, err := tx.Exec(dbCtx, `INSERT INTO furniture_instances (id, organization_id, project_id, origin) VALUES ($1, $2, $3, 'quote')`, id, orgA, projectID); err != nil {
				return err
			}
		}
		return nil
	})

	styles := isolationFamilyValue(t, fixture, orgA, func(txCtx context.Context) ([]domain.GripStyle, error) {
		return store.ListGripStyles(txCtx)
	})
	var gola string
	for _, style := range styles {
		if style.Name == "Gola carrera" {
			gola = style.ID
		}
	}

	// The race: both writes take the SAME expected version; exactly one wins
	// and the other answers the version conflict.
	grip := isolationFamilyValue(t, fixture, orgA, func(txCtx context.Context) (*storage.ProjectGrip, error) {
		return store.GetProjectGrip(txCtx, projectID)
	})
	var wg sync.WaitGroup
	results := make(chan error, 2)
	run := func(write func(ctx context.Context) error) {
		defer wg.Done()
		err := isolationFamilyError(t, fixture, orgA, write)
		results <- err
	}
	wg.Add(2)
	go run(func(txCtx context.Context) error {
		_, err := store.SetProjectGrip(txCtx, projectID, gola, grip.Version, storage.ProjectGripWriteMeta{})
		return err
	})
	go run(func(txCtx context.Context) error {
		return store.SetFurnitureGripOverrides(txCtx, projectID, []storage.FurnitureGripOverrideCommand{
			{FurnitureInstanceID: "91820000-0000-0000-0000-0000000000b1"},
		}, grip.Version, storage.ProjectGripWriteMeta{})
	})
	wg.Wait()
	close(results)
	wins, conflicts := 0, 0
	for err := range results {
		switch {
		case err == nil:
			wins++
		case errors.Is(err, storage.ErrVersionConflict):
			conflicts++
		default:
			t.Fatalf("unexpected write error: %v", err)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatalf("exactly one write survives the If-Match race: wins=%d conflicts=%d", wins, conflicts)
	}

	// The winner's audit event committed with the mutation.
	audits := isolationFamilySQLValue(t, fixture, orgA, func(tx pgx.Tx) (int, error) {
		dbCtx := context.Background()
		var count int
		err := tx.QueryRow(dbCtx, `SELECT count(*) FROM security_audit_events
			WHERE event_type IN ('project_grip_updated','project_furniture_grip_updated')
			  AND details ->> 'project_id' = $1`, projectID).Scan(&count)
		return count, err
	})
	if audits != 1 {
		t.Fatalf("audit rows = %d, want exactly the winner's", audits)
	}

	// Rollback: a rejected write (unknown style) leaves no audit row and no
	// version bump.
	current := isolationFamilyValue(t, fixture, orgA, func(txCtx context.Context) (*storage.ProjectGrip, error) {
		return store.GetProjectGrip(txCtx, projectID)
	})
	if err := isolationFamilyError(t, fixture, orgA, func(txCtx context.Context) error {
		_, err := store.SetProjectGrip(txCtx, projectID, "no-existe", current.Version, storage.ProjectGripWriteMeta{})
		return err
	}); err == nil {
		t.Fatal("an unknown style must be rejected")
	}
	after := isolationFamilyValue(t, fixture, orgA, func(txCtx context.Context) (*storage.ProjectGrip, error) {
		return store.GetProjectGrip(txCtx, projectID)
	})
	if after.Version != current.Version {
		t.Fatalf("a rejected write must not bump the version: %d → %d", current.Version, after.Version)
	}
}
