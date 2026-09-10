package storage_test

import (
	"context"
	"os"
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
	}
	t.Run("fresh", func(t *testing.T) { assert(t, true) })
	t.Run("upgrade", func(t *testing.T) { assert(t, false) })
}
