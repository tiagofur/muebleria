package storage_test

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestDesignRevisionReadModelMigrationFreshUpgradeAndDown(t *testing.T) {
	assert := func(t *testing.T, fresh bool) {
		t.Helper()
		pool := multiOrgFreshDB(t)
		if fresh {
			identityApplyThrough(t, pool, 129)
		} else {
			identityApplyThrough(t, pool, 128)
			up, err := os.ReadFile("../../db/migration/000129_design_revision_read_model.up.sql")
			if err != nil {
				t.Fatal(err)
			}
			if _, err = pool.Exec(context.Background(), string(up)); err != nil {
				t.Fatalf("apply migration: %v", err)
			}
		}
		type policyState struct {
			rationale string
			version   int
		}
		upPolicies := map[string]policyState{}
		for _, table := range []string{"design_revisions", "design_revision_items"} {
			var state policyState
			if err := pool.QueryRow(context.Background(), `SELECT rationale, policy_version FROM rls_policy_inventory WHERE table_name=$1`, table).Scan(&state.rationale, &state.version); err != nil {
				t.Fatalf("read up policy %s: %v", table, err)
			}
			if !strings.Contains(state.rationale, "#639") {
				t.Fatalf("up policy %s does not describe immutable read-model ownership: %q", table, state.rationale)
			}
			upPolicies[table] = state
		}
		for _, column := range []struct{ table, name string }{{"design_working_items", "material_choice_sources"}, {"design_revision_items", "material_choice_sources"}, {"design_revision_items", "presentation_snapshot"}, {"design_revisions", "created_by_display_name"}, {"design_revisions", "approved_by_display_name"}} {
			var exists bool
			if err := pool.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2)`, column.table, column.name).Scan(&exists); err != nil || !exists {
				t.Fatalf("fresh=%v missing %s.%s: %v", fresh, column.table, column.name, err)
			}
		}
		down, err := os.ReadFile("../../db/migration/000129_design_revision_read_model.down.sql")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(context.Background(), string(down)); err != nil {
			t.Fatalf("down migration: %v", err)
		}
		var exists bool
		if err := pool.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='design_revision_items' AND column_name='presentation_snapshot')`).Scan(&exists); err != nil || exists {
			t.Fatalf("down left presentation_snapshot: %v", err)
		}
		expectedRationale := map[string]string{
			"design_revisions":      "Published design revisions are immutable snapshots following project organizations; the owner organization may transition a published revision to approved exactly once (#387 / #395 / I4 / I12 / §17)",
			"design_revision_items": "Design revision items capture the authoring snapshot of furniture instances within an immutable revision (#387 / I4 / I12)",
		}
		for table, expected := range expectedRationale {
			var rationale string
			var version int
			if err := pool.QueryRow(context.Background(), `SELECT rationale, policy_version FROM rls_policy_inventory WHERE table_name=$1`, table).Scan(&rationale, &version); err != nil {
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
