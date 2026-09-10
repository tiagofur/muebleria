package storage_test

import (
	"context"
	"os"
	"strings"
	"testing"
)

// #642 / QUOTE-AUTH Slice 1: migration 000130 fresh/upgrade/down against real
// PostgreSQL. The commercial-authority columns exist, the RLS inventory row
// records the new ownership, and the hardened trigger enforces snapshot
// immutability + the fail-closed publish gate; the down path restores the
// pre-#642 semantics completely.
func TestQuoteCommercialSnapshotMigrationFreshUpgradeAndDown(t *testing.T) {
	assert := func(t *testing.T, fresh bool) {
		t.Helper()
		pool := multiOrgFreshDB(t)
		if fresh {
			identityApplyThrough(t, pool, 130)
		} else {
			identityApplyThrough(t, pool, 129)
			up, err := os.ReadFile("../../db/migration/000130_quote_commercial_snapshot.up.sql")
			if err != nil {
				t.Fatal(err)
			}
			if _, err = pool.Exec(context.Background(), string(up)); err != nil {
				t.Fatalf("apply migration: %v", err)
			}
		}
		ctx := context.Background()

		for _, column := range []string{"commercial_snapshot", "published_at", "accepted_at"} {
			var exists bool
			if err := pool.QueryRow(ctx,
				`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='quote_revisions' AND column_name=$1)`,
				column).Scan(&exists); err != nil || !exists {
				t.Fatalf("fresh=%v missing quote_revisions.%s: %v", fresh, column, err)
			}
		}

		var rationale string
		var version int
		if err := pool.QueryRow(ctx,
			`SELECT rationale, policy_version FROM rls_policy_inventory WHERE table_name='quote_revisions'`).Scan(&rationale, &version); err != nil {
			t.Fatalf("read policy: %v", err)
		}
		if !strings.Contains(rationale, "#642") || !strings.Contains(rationale, "commercial authority") {
			t.Fatalf("up policy does not record commercial authority: %q", rationale)
		}
		upVersion := version

		// The migration must not weaken the existing RLS posture.
		var rls, forced bool
		if err := pool.QueryRow(ctx,
			`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='quote_revisions'`).Scan(&rls, &forced); err != nil || !rls || !forced {
			t.Fatalf("RLS enabled=%v forced=%v, want both true (err %v)", rls, forced, err)
		}

		// Seed a minimal project + snapshot-less draft, then prove the
		// hardened trigger: publish without a snapshot is rejected.
		if _, err := pool.Exec(ctx, `
			INSERT INTO organizations (id, name, slug, status) VALUES ('a1000000-0000-0000-0000-000000000001', 'Mig Org', 'mig-org', 'provisioning');
			INSERT INTO customers (id, name, organization_id) VALUES ('a2000000-0000-0000-0000-000000000001', 'Mig Customer', 'a1000000-0000-0000-0000-000000000001');
			INSERT INTO projects (id, name, customer_id, status, organization_id) VALUES ('a3000000-0000-0000-0000-000000000001', 'Mig Project', 'a2000000-0000-0000-0000-000000000001', 'draft', 'a1000000-0000-0000-0000-000000000001');
			INSERT INTO quote_revisions (id, organization_id, project_id, revision_number, status)
			VALUES ('a4000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 1, 'draft')`); err != nil {
			t.Fatalf("seed: %v", err)
		}
		if _, err := pool.Exec(ctx,
			`UPDATE quote_revisions SET status='published' WHERE id='a4000000-0000-0000-0000-000000000001'`); err == nil || !strings.Contains(err.Error(), "commercial_snapshot") {
			t.Fatalf("snapshot-less publish must be rejected by the trigger, got %v", err)
		}
		if _, err := pool.Exec(ctx,
			`UPDATE quote_revisions SET commercial_snapshot='{"schema":"x"}'::jsonb WHERE id='a4000000-0000-0000-0000-000000000001'`); err == nil || !strings.Contains(err.Error(), "commercial_snapshot is immutable") {
			t.Fatalf("snapshot injection on update must be rejected, got %v", err)
		}

		// Down: columns disappear and the previous trigger semantics return
		// (a snapshot-less publish is legal again — pre-#642 behavior).
		down, err := os.ReadFile("../../db/migration/000130_quote_commercial_snapshot.down.sql")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(down)); err != nil {
			t.Fatalf("down migration: %v", err)
		}
		var exists bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='quote_revisions' AND column_name='commercial_snapshot')`).Scan(&exists); err != nil || exists {
			t.Fatalf("down left commercial_snapshot: %v", err)
		}
		if _, err := pool.Exec(ctx,
			`UPDATE quote_revisions SET status='published' WHERE id='a4000000-0000-0000-0000-000000000001'`); err != nil {
			t.Fatalf("down must restore pre-#642 publish semantics, got %v", err)
		}
		if err := pool.QueryRow(ctx,
			`SELECT rationale, policy_version FROM rls_policy_inventory WHERE table_name='quote_revisions'`).Scan(&rationale, &version); err != nil {
			t.Fatalf("read down policy: %v", err)
		}
		if version != upVersion-1 || strings.Contains(rationale, "#642") {
			t.Fatalf("down policy = (%q, %d), want version %d without #642 rationale", rationale, version, upVersion-1)
		}
	}
	t.Run("fresh", func(t *testing.T) { assert(t, true) })
	t.Run("upgrade", func(t *testing.T) { assert(t, false) })
}
