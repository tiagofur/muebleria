package storage_test

import (
	"context"
	"os"
	"strings"
	"testing"
)

// #784 migration: fresh and upgrade paths both land the new columns, the
// conservative backfill (every existing materialized working role → override)
// and the 000129-shape down migration; the RLS inventory rationale records
// the new ownership story for the four touched tables.
func TestDesignAuthoringDefaultsMigrationFreshUpgradeAndDown(t *testing.T) {
	assert := func(t *testing.T, fresh bool) {
		t.Helper()
		pool := multiOrgFreshMigrationDB(t)
		if fresh {
			identityApplyThrough(t, pool, 138)
		} else {
			identityApplyThrough(t, pool, 137)
			up, err := os.ReadFile("../../db/migration/000138_design_authoring_defaults.up.sql")
			if err != nil {
				t.Fatal(err)
			}
			if _, err = pool.Exec(context.Background(), string(up)); err != nil {
				t.Fatalf("upgrade apply 000138: %v", err)
			}
		}
		ctx := context.Background()

		type policyState struct {
			rationale string
			version   int
		}
		upPolicies := map[string]policyState{}
		for _, table := range []string{"design_working_copies", "design_working_items", "design_revisions", "design_revision_items"} {
			var state policyState
			if err := pool.QueryRow(ctx, `SELECT rationale, policy_version FROM rls_policy_inventory WHERE table_name=$1`, table).Scan(&state.rationale, &state.version); err != nil {
				t.Fatalf("read up policy %s: %v", table, err)
			}
			if !strings.Contains(state.rationale, "#784") {
				t.Fatalf("up policy %s does not describe the #784 ownership story: %q", table, state.rationale)
			}
			upPolicies[table] = state
		}

		for _, column := range []struct{ table, name string }{
			{"design_working_copies", "authoring_defaults"},
			{"design_working_items", "material_choice_modes"},
			{"design_revisions", "authoring_defaults_snapshot"},
			{"design_revision_items", "material_choice_modes"},
		} {
			var exists bool
			if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2)`, column.table, column.name).Scan(&exists); err != nil || !exists {
				t.Fatalf("fresh=%v missing %s.%s: %v", fresh, column.table, column.name, err)
			}
		}

		// Immutability of the frozen defaults snapshot: the trigger must
		// reject changing authoring_defaults_snapshot on a published row.
		if _, err := pool.Exec(ctx, `
			INSERT INTO organizations (id, name, slug) VALUES
			 ('90000000-0000-0000-0000-0000000000aa', 'Migr Org', 'migr-org')`); err != nil {
			t.Fatalf("seed org: %v", err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO customers (id, organization_id, name) VALUES
			 ('90000000-0000-0000-0000-0000000000cc', '90000000-0000-0000-0000-0000000000aa', 'Cliente Migr')`); err != nil {
			t.Fatalf("seed customer: %v", err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO projects (id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id)
			VALUES ('90000000-0000-0000-0000-0000000000e1', 'Migr Project', '90000000-0000-0000-0000-0000000000cc', 'draft',
				'90000000-0000-0000-0000-0000000000aa', '90000000-0000-0000-0000-0000000000aa', '90000000-0000-0000-0000-0000000000aa')`); err != nil {
			t.Fatalf("seed project: %v", err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO designs (id, organization_id, project_id, name, status)
			VALUES ('90000000-0000-0000-0000-0000000000dd', '90000000-0000-0000-0000-0000000000aa', '90000000-0000-0000-0000-0000000000e1', 'Migr Design', 'active')`); err != nil {
			t.Fatalf("seed design: %v", err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO furniture_instances (id, organization_id, project_id, origin)
			VALUES ('90000000-0000-0000-0000-0000000000f1', '90000000-0000-0000-0000-0000000000aa', '90000000-0000-0000-0000-0000000000e1', 'quote')`); err != nil {
			t.Fatalf("seed furniture instance: %v", err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO design_working_copies (design_id, organization_id, project_id, base_revision_id, source_type, authoring_defaults)
			VALUES ('90000000-0000-0000-0000-0000000000dd', '90000000-0000-0000-0000-0000000000aa', '90000000-0000-0000-0000-0000000000e1', NULL, 'manual', '{"materialChoices":{"INTERIOR":"mat-a"}}')`); err != nil {
			t.Fatalf("seed working copy: %v", err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO design_revisions (id, organization_id, project_id, design_id, revision_number, source_type, status, authoring_defaults_snapshot)
			VALUES ('90000000-0000-0000-0000-0000000000ef', '90000000-0000-0000-0000-0000000000aa', '90000000-0000-0000-0000-0000000000e1', '90000000-0000-0000-0000-0000000000dd', 1, 'manual', 'published', '{"materialChoices":{"INTERIOR":"mat-a"}}')`); err != nil {
			t.Fatalf("seed revision: %v", err)
		}
		if _, err := pool.Exec(ctx, `
			UPDATE design_revisions SET authoring_defaults_snapshot = '{"materialChoices":{"INTERIOR":"mat-b"}}'
			WHERE id = '90000000-0000-0000-0000-0000000000ef'`); err == nil {
			t.Fatal("authoring_defaults_snapshot must be immutable on published revisions")
		}

		// Backfill probe: legacy working rows (materialized roles, no modes)
		// upgrade to explicit override for every materialized role.
		if !fresh {
			// (upgrade probe seeds a row before applying the migration below)
		}
		down, err := os.ReadFile("../../db/migration/000138_design_authoring_defaults.down.sql")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(down)); err != nil {
			t.Fatalf("down migration: %v", err)
		}
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='design_working_copies' AND column_name='authoring_defaults')`).Scan(&exists); err != nil || exists {
			t.Fatalf("down left authoring_defaults: %v", err)
		}
		expectedRationale := map[string]string{
			"design_working_copies": "Design working copy tracks the mutable authoring draft of a design (#387 / ADR-0003)",
			"design_working_items":  "Design working items represent the draft furniture instance positions and parameters in the working copy (#387 / ADR-0003)",
			"design_revisions":      "Immutable design revisions freeze human-readable presentation and actor provenance; legacy rows remain explicitly unavailable (#639)",
			"design_revision_items": "Immutable design revisions freeze human-readable presentation and actor provenance; legacy rows remain explicitly unavailable (#639)",
		}
		for table, expected := range expectedRationale {
			var rationale string
			var version int
			if err := pool.QueryRow(ctx, `SELECT rationale, policy_version FROM rls_policy_inventory WHERE table_name=$1`, table).Scan(&rationale, &version); err != nil {
				t.Fatalf("read down policy %s: %v", table, err)
			}
			if rationale != expected || version != upPolicies[table].version-1 {
				t.Fatalf("down policy %s = (%q, %d), want (%q, %d)", table, rationale, version, expected, upPolicies[table].version-1)
			}
		}
	}
	t.Run("fresh", func(t *testing.T) { assert(t, true) })
	t.Run("upgrade", func(t *testing.T) { assert(t, false) })
}

// The conservative backfill is the upgrade path's central act: a row that
// existed before the contract, carrying materialized roles with no lineage
// statement, must upgrade to explicit override — never to design, never by
// comparing values with anything.
func TestDesignAuthoringDefaultsMigration_BackfillLegacyRolesOverride(t *testing.T) {
	pool := multiOrgFreshMigrationDB(t)
	identityApplyThrough(t, pool, 137)
	ctx := context.Background()

	if _, err := pool.Exec(ctx, `
		INSERT INTO organizations (id, name, slug) VALUES
		 ('90000000-0000-0000-0000-0000000000aa', 'Backfill Org', 'backfill-org')`); err != nil {
		t.Fatalf("seed org: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO customers (id, organization_id, name) VALUES
		 ('90000000-0000-0000-0000-0000000000cc', '90000000-0000-0000-0000-0000000000aa', 'Cliente Backfill')`); err != nil {
		t.Fatalf("seed customer: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO projects (id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id)
		VALUES ('90000000-0000-0000-0000-0000000000e1', 'Backfill Project', '90000000-0000-0000-0000-0000000000cc', 'draft',
			'90000000-0000-0000-0000-0000000000aa', '90000000-0000-0000-0000-0000000000aa', '90000000-0000-0000-0000-0000000000aa')`); err != nil {
		t.Fatalf("seed project: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO designs (id, organization_id, project_id, name, status)
		VALUES ('90000000-0000-0000-0000-0000000000dd', '90000000-0000-0000-0000-0000000000aa', '90000000-0000-0000-0000-0000000000e1', 'Backfill Design', 'active')`); err != nil {
		t.Fatalf("seed design: %v", err)
	}
	// Pre-000138 shapes: legacy working item with two materialized roles, and
	// a legacy revision item the immutability trigger keeps NULL-modes.
	if _, err := pool.Exec(ctx, `
		INSERT INTO furniture_instances (id, organization_id, project_id, origin)
		VALUES ('90000000-0000-0000-0000-0000000000f1', '90000000-0000-0000-0000-0000000000aa', '90000000-0000-0000-0000-0000000000e1', 'quote')`); err != nil {
		t.Fatalf("seed furniture instance: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO design_working_copies (design_id, organization_id, project_id, base_revision_id, source_type)
		VALUES ('90000000-0000-0000-0000-0000000000dd', '90000000-0000-0000-0000-0000000000aa', '90000000-0000-0000-0000-0000000000e1', NULL, 'manual')`); err != nil {
		t.Fatalf("seed working copy: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO design_working_items (organization_id, project_id, design_id, furniture_instance_id, material_choices, transform)
		VALUES ('90000000-0000-0000-0000-0000000000aa', '90000000-0000-0000-0000-0000000000e1', '90000000-0000-0000-0000-0000000000dd',
			'90000000-0000-0000-0000-0000000000f1', '{"INTERIOR":"mat-blanco","FRENTES":"mat-negro"}', '{"translationMm":[0,0,0],"rotationDeg":[0,0,0]}')`); err != nil {
		t.Fatalf("seed legacy working item: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO design_revisions (id, organization_id, project_id, design_id, revision_number, source_type, status)
		VALUES ('90000000-0000-0000-0000-0000000000ef', '90000000-0000-0000-0000-0000000000aa', '90000000-0000-0000-0000-0000000000e1', '90000000-0000-0000-0000-0000000000dd', 1, 'manual', 'published')`); err != nil {
		t.Fatalf("seed revision: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO design_revision_items (organization_id, project_id, design_revision_id, furniture_instance_id, material_choices, transform)
		VALUES ('90000000-0000-0000-0000-0000000000aa', '90000000-0000-0000-0000-0000000000e1', '90000000-0000-0000-0000-0000000000ef',
			'90000000-0000-0000-0000-0000000000f1', '{"INTERIOR":"mat-blanco"}', '{"translationMm":[0,0,0],"rotationDeg":[0,0,0]}')`); err != nil {
		t.Fatalf("seed legacy revision item: %v", err)
	}

	up, err := os.ReadFile("../../db/migration/000138_design_authoring_defaults.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(up)); err != nil {
		t.Fatalf("apply 000138 over legacy rows: %v", err)
	}

	var modes string
	if err := pool.QueryRow(ctx, `
		SELECT material_choice_modes::text FROM design_working_items
		WHERE design_id='90000000-0000-0000-0000-0000000000dd' AND furniture_instance_id='90000000-0000-0000-0000-0000000000f1'
	`).Scan(&modes); err != nil {
		t.Fatalf("read backfilled modes: %v", err)
	}
	// Deterministic comparison via jsonb normalization.
	var normalized string
	if err := pool.QueryRow(ctx, `SELECT ($1::jsonb = '{"FRENTES":"override","INTERIOR":"override"}'::jsonb)::text`, modes).Scan(&normalized); err != nil {
		t.Fatal(err)
	}
	if normalized != "true" {
		t.Fatalf("backfilled modes = %s, want every materialized role as override", modes)
	}

	var revModes *string
	if err := pool.QueryRow(ctx, `
		SELECT material_choice_modes::text FROM design_revision_items
		WHERE design_revision_id='90000000-0000-0000-0000-0000000000ef'
	`).Scan(&revModes); err != nil {
		t.Fatalf("read revision modes: %v", err)
	}
	if revModes != nil {
		t.Fatalf("historical revision items must stay NULL (never backfilled), got %s", *revModes)
	}
}
