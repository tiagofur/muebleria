package storage_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// #955: 000146 is the one change in the hardware-profile chain that WIDENS an
// access surface, so it is proved the only way a widening can be proved —
// direct SQL as granete_app, on the exact branches the migration wrote:
//
//	tenant actor (no marker)     → Granete Standard release is NOT writable
//	platform actor (marker set)  → the same statement IS writable
//	tenant's own draft release   → still writable (the widening did not
//	                               disturb the tenant branch)
//	rollback                     → the previous policies and inventory rows
//	                               come back exactly
//
// A missing OR, a mistyped GUC name, or a down migration that leaves the
// inventory under-reporting the change are all invisible to a happy-path test.
const (
	paOrg              = "b1000000-0000-0000-0000-000000000001"
	paOtherOrg         = "b1000000-0000-0000-0000-000000000002"
	paStandardLibrary  = "00000000-0000-0000-0001-000000000001"
	paStandardRelease  = "00000000-0000-0000-0002-000000000001"
	paOrgLibrary       = "b1000000-0000-0000-0000-0000000000a1"
	paOrgRelease       = "b1000000-0000-0000-0000-0000000000a2"
	paOtherOrgLibrary  = "b1000000-0000-0000-0000-0000000000b1"
	paOtherOrgRelease  = "b1000000-0000-0000-0000-0000000000b2"
	paMigrationVersion = 145
)

// libraryWriteSurface is everything 000146 is allowed to change about the
// library write policies.
type libraryWriteSurface struct {
	qual       string
	withCheck  string
	writeScope string
	rationale  string
	version    int
}

func snapshotLibraryWriteSurface(t *testing.T, pool *pgxpool.Pool) map[string]libraryWriteSurface {
	t.Helper()
	ctx := context.Background()
	surfaces := map[string]libraryWriteSurface{}
	for table, policy := range map[string]string{
		"library_releases":              "library_releases_write",
		"library_release_resource_refs": "library_release_refs_write",
		"library_release_manifests":     "library_release_manifests_write",
	} {
		var state libraryWriteSurface
		if err := pool.QueryRow(ctx, `
			SELECT coalesce(p.qual, ''), coalesce(p.with_check, ''),
			       coalesce(i.write_scope, ''), coalesce(i.rationale, ''),
			       coalesce(i.policy_version, 0)
			FROM pg_policies p
			LEFT JOIN rls_policy_inventory i ON i.table_name = p.tablename
			WHERE p.schemaname = 'public' AND p.tablename = $1 AND p.policyname = $2`,
			table, policy,
		).Scan(&state.qual, &state.withCheck, &state.writeScope, &state.rationale, &state.version); err != nil {
			t.Fatalf("read policy %s/%s: %v", table, policy, err)
		}
		if state.qual == "" && state.withCheck == "" {
			t.Fatalf("policy %s/%s does not exist", table, policy)
		}
		surfaces[table] = state
	}
	return surfaces
}

// writeLibraryRelease runs one UPDATE as granete_app inside a tenant
// transaction whose app.platform_admin marker is exactly the value given. The
// returned row count is the policy verdict: 0 means the row was filtered out.
func writeLibraryRelease(t *testing.T, runtimePool *pgxpool.Pool, orgID, releaseID, marker string) int64 {
	t.Helper()
	ctx := context.Background()
	tx, err := runtimePool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin runtime transaction: %v", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		SELECT set_config('app.organization_id', $1, true),
		       set_config('app.platform_admin', $2, true),
		       set_config('row_security', 'on', true)`, orgID, marker); err != nil {
		t.Fatalf("set tenant context: %v", err)
	}
	tag, err := tx.Exec(ctx, `
		UPDATE library_releases SET changelog = 'policy probe' WHERE id = $1`, releaseID)
	if err != nil {
		t.Fatalf("runtime update with marker=%q: %v", marker, err)
	}
	rows := tag.RowsAffected()
	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback runtime transaction: %v", err)
	}
	return rows
}

func TestPlatformAdminLibraryWrites_WideningIsTenantBoundAndReversible(t *testing.T) {
	migrationPool, runtimePool := multiOrgFreshMigrationAndRuntimeDB(t)
	ctx := context.Background()

	identityApplyThrough(t, migrationPool, paMigrationVersion)
	before := snapshotLibraryWriteSurface(t, migrationPool)

	up, err := os.ReadFile("../../db/migration/000146_platform_admin_library_writes.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := migrationPool.Exec(ctx, string(up)); err != nil {
		t.Fatalf("apply 000146: %v", err)
	}
	after := snapshotLibraryWriteSurface(t, migrationPool)

	for table, state := range after {
		previous := before[table]
		if !strings.Contains(state.qual, "app_platform_admin()") {
			t.Fatalf("%s USING no longer admits platform staff: %q", table, state.qual)
		}
		if !strings.Contains(state.withCheck, "app_platform_admin()") {
			t.Fatalf("%s WITH CHECK no longer admits platform staff: %q", table, state.withCheck)
		}
		// The tenant branch must survive intact. A widening that quietly
		// relaxed or narrowed the old predicate is a different change, so
		// each surviving condition is asserted on its own.
		assertTenantBranchPreserved(t, table, state.qual)
		if state.version != previous.version+1 {
			t.Fatalf("%s inventory policy_version = %d, want %d", table, state.version, previous.version+1)
		}
		if !strings.Contains(state.rationale, "#955") {
			t.Fatalf("%s inventory does not record #955: %q", table, state.rationale)
		}
	}

	// Fixture: 000139 already seeds the owner-less Granete Standard library and its
	// draft release, so the probes reuse those rows; only the two organization
	// libraries are new here. Seeded as the migration authority; the probes
	// below are the runtime role.
	if _, err := migrationPool.Exec(ctx, `
		INSERT INTO organizations (id, name, slug) VALUES
			($1, 'PA Org', 'pa-org'),
			($2, 'PA Other', 'pa-other')`, paOrg, paOtherOrg); err != nil {
		t.Fatalf("seed organizations: %v", err)
	}
	if _, err := migrationPool.Exec(ctx, `
		INSERT INTO manufacturing_libraries (id, code, kind, owner_organization_id) VALUES
			($1, 'PA-ORG', 'organization_overlay', $2),
			($3, 'PA-OTHER', 'organization_overlay', $4)`,
		paOrgLibrary, paOrg, paOtherOrgLibrary, paOtherOrg); err != nil {
		t.Fatalf("seed libraries: %v", err)
	}
	if _, err := migrationPool.Exec(ctx, `
		INSERT INTO library_releases (id, library_id, version, status) VALUES
			($1, $2, '0.1.0', 'draft'),
			($3, $4, '0.1.0', 'draft')`,
		paOrgRelease, paOrgLibrary,
		paOtherOrgRelease, paOtherOrgLibrary); err != nil {
		t.Fatalf("seed releases: %v", err)
	}
	var standardOwner *string
	if err := migrationPool.QueryRow(ctx,
		`SELECT owner_organization_id::text FROM manufacturing_libraries WHERE id = $1`,
		paStandardLibrary).Scan(&standardOwner); err != nil {
		t.Fatalf("read seeded Standard library: %v", err)
	}
	if standardOwner != nil {
		t.Fatalf("the probe needs the owner-less Standard library, got owner %q", *standardOwner)
	}

	// 1. The tenant branch is unchanged: a tenant still cannot write the
	// owner-less Standard release, and still cannot reach another org's.
	if rows := writeLibraryRelease(t, runtimePool, paOrg, paStandardRelease, "false"); rows != 0 {
		t.Fatalf("tenant actor wrote the Granete Standard release (%d rows); the widening leaked", rows)
	}
	if rows := writeLibraryRelease(t, runtimePool, paOrg, paOtherOrgRelease, "false"); rows != 0 {
		t.Fatalf("tenant actor wrote another organization's release (%d rows)", rows)
	}
	// 2. The tenant branch did not regress: a tenant still writes its own draft.
	if rows := writeLibraryRelease(t, runtimePool, paOrg, paOrgRelease, "false"); rows != 1 {
		t.Fatalf("tenant actor could not write its own draft release (%d rows)", rows)
	}
	// 3. The new branch works, and it is the only thing that opens Standard.
	if rows := writeLibraryRelease(t, runtimePool, paOrg, paStandardRelease, "true"); rows != 1 {
		t.Fatalf("platform actor could not write the Standard release (%d rows)", rows)
	}

	// 4. Published release immutability (#772): once published, even platform
	// staff CANNOT modify the release or its resource refs.
	if _, err := migrationPool.Exec(ctx, `
		UPDATE library_releases SET status = 'published' WHERE id = $1`, paStandardRelease); err != nil {
		t.Fatalf("set status to published: %v", err)
	}
	if rows := writeLibraryRelease(t, runtimePool, paOrg, paStandardRelease, "true"); rows != 0 {
		t.Fatalf("platform actor wrote to an already-published release (%d rows); immutability violated", rows)
	}
	// A published release with an authoritative manifest row is also strictly immutable.
	const paPublishedWithManifest = "b1000000-0000-0000-0000-0000000000f1"
	if _, err := migrationPool.Exec(ctx, `
		INSERT INTO library_releases (id, library_id, version, status) VALUES ($1, $2, '0.9.0', 'published')`,
		paPublishedWithManifest, paStandardLibrary); err != nil {
		t.Fatalf("insert published standard: %v", err)
	}
	if _, err := migrationPool.Exec(ctx, `
		INSERT INTO library_release_manifests (release_id, manifest_hash, manifest_json)
		VALUES ($1, 'sha256:1111111111111111111111111111111111111111111111111111111111111111', '{}')`,
		paPublishedWithManifest); err != nil {
		t.Fatalf("insert manifest: %v", err)
	}
	if rows := writeLibraryRelease(t, runtimePool, paOrg, paPublishedWithManifest, "true"); rows != 0 {
		t.Fatalf("platform actor wrote to a published release with manifest (%d rows); immutability violated", rows)
	}
	if _, err := migrationPool.Exec(ctx, `
		UPDATE library_releases SET status = 'draft' WHERE id = $1`, paStandardRelease); err != nil {
		t.Fatalf("restore status to draft: %v", err)
	}

	// 4b. Placeholder fixture reset (#955): a placeholder flip (published
	// status, placeholder hash, no manifest row) can be reset to draft by
	// platform admin, but NEVER by a tenant.
	const placeholderHash = "sha256:0000000000000000000000000000000000000000000000000000000000000001"
	if _, err := migrationPool.Exec(ctx, `
		UPDATE library_releases
		SET status = 'published', manifest_hash = $2
		WHERE id = $1`, paStandardRelease, placeholderHash); err != nil {
		t.Fatalf("set status to placeholder: %v", err)
	}

	resetProbe := func(marker string) (int64, error) {
		tx, err := runtimePool.Begin(ctx)
		if err != nil {
			return 0, err
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `
			SELECT set_config('app.organization_id', $1, true),
			       set_config('app.platform_admin', $2, true),
			       set_config('row_security', 'on', true)`, paOrg, marker); err != nil {
			return 0, err
		}
		tag, err := tx.Exec(ctx, `
			UPDATE library_releases
			SET status = 'draft', manifest_hash = NULL, published_at = NULL,
			    published_by = NULL, updated_at = NOW()
			WHERE id = $1 AND status = 'published'
			  AND NOT EXISTS (SELECT 1 FROM library_release_manifests WHERE release_id = $1)`, paStandardRelease)
		if err != nil {
			return 0, err
		}
		if tag.RowsAffected() == 0 {
			return 0, tx.Rollback(ctx)
		}
		return tag.RowsAffected(), tx.Commit(ctx)
	}

	if rows, err := resetProbe("false"); err != nil || rows != 0 {
		t.Fatalf("tenant actor reset placeholder release (rows=%d, err=%v)", rows, err)
	}
	if rows, err := resetProbe("true"); err != nil || rows != 1 {
		t.Fatalf("platform actor could not reset placeholder release (rows=%d, err=%v)", rows, err)
	}
	var resetStatus string
	if err := migrationPool.QueryRow(ctx, `SELECT status FROM library_releases WHERE id = $1`, paStandardRelease).Scan(&resetStatus); err != nil {
		t.Fatalf("query reset status: %v", err)
	}
	if resetStatus != "draft" {
		t.Fatalf("release status after reset = %q, want draft", resetStatus)
	}

	// 5. Column-level privilege and draft ref updates: granete_app can update
	// definition_hash, resource_revision, and package_kind on draft refs.
	const refID = "b1000000-0000-0000-0000-000000000099"
	if _, err := migrationPool.Exec(ctx, `
		INSERT INTO library_release_resource_refs
			(id, release_id, resource_kind, resource_id, resource_revision, package_kind)
		VALUES ($1, $2, 'hardware_profile', $3, 'rev-0', 'standard')`,
		refID, paStandardRelease, "b1000000-0000-0000-0000-000000000088"); err != nil {
		t.Fatalf("insert draft ref: %v", err)
	}

	writeRef := func(marker string) (int64, error) {
		tx, err := runtimePool.Begin(ctx)
		if err != nil {
			return 0, err
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `
			SELECT set_config('app.organization_id', $1, true),
			       set_config('app.platform_admin', $2, true),
			       set_config('row_security', 'on', true)`, paOrg, marker); err != nil {
			return 0, err
		}
		tag, err := tx.Exec(ctx, `
			UPDATE library_release_resource_refs
			SET definition_hash = 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
			    resource_revision = 'rev-1',
			    package_kind = 'free'
			WHERE id = $1`, refID)
		if err != nil {
			return 0, err
		}
		return tag.RowsAffected(), tx.Rollback(ctx)
	}

	if rows, err := writeRef("true"); err != nil || rows != 1 {
		t.Fatalf("platform actor could not update draft ref (rows=%d, err=%v)", rows, err)
	}
	if rows, err := writeRef("false"); err != nil || rows != 0 {
		t.Fatalf("tenant actor updated standard draft ref (rows=%d, err=%v)", rows, err)
	}

	if _, err := migrationPool.Exec(ctx, `
		UPDATE library_releases SET status = 'published' WHERE id = $1`, paStandardRelease); err != nil {
		t.Fatalf("set status to published: %v", err)
	}
	if rows, err := writeRef("true"); err != nil || rows != 0 {
		t.Fatalf("platform actor updated ref on published release (rows=%d, err=%v); immutability violated", rows, err)
	}
	if _, err := migrationPool.Exec(ctx, `
		UPDATE library_releases SET status = 'draft' WHERE id = $1`, paStandardRelease); err != nil {
		t.Fatalf("restore status to draft: %v", err)
	}

	down, err := os.ReadFile("../../db/migration/000146_platform_admin_library_writes.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := migrationPool.Exec(ctx, string(down)); err != nil {
		t.Fatalf("revert 000146: %v", err)
	}
	restored := snapshotLibraryWriteSurface(t, migrationPool)
	for table, state := range restored {
		previous := before[table]
		if state.qual != previous.qual || state.withCheck != previous.withCheck {
			t.Fatalf("%s policy after rollback is not the pre-000146 policy:\n got %q / %q\nwant %q / %q",
				table, state.qual, state.withCheck, previous.qual, previous.withCheck)
		}
		if state.writeScope != previous.writeScope || state.rationale != previous.rationale {
			t.Fatalf("%s inventory row after rollback = (%q, %q), want (%q, %q)",
				table, state.writeScope, state.rationale, previous.writeScope, previous.rationale)
		}
		if state.version != previous.version {
			t.Fatalf("%s inventory policy_version after rollback = %d, want %d",
				table, state.version, previous.version)
		}
	}
	// And the rollback actually closes the widening again.
	if rows := writeLibraryRelease(t, runtimePool, paOrg, paStandardRelease, "true"); rows != 0 {
		t.Fatalf("after rollback the platform marker still writes Standard releases (%d rows)", rows)
	}
}

// assertTenantBranchPreserved checks the discriminating conditions of the
// pre-000146 tenant predicate, against the normalized text PostgreSQL stores
// (whitespace removed, and the release status read as status='draft').
// library_release_manifests is deliberately exempt from the draft condition —
// 000140 never had one, and adding it would break a tenant publishing its own
// library, whose manifest row is written after the status flip.
func assertTenantBranchPreserved(t *testing.T, table, qual string) {
	t.Helper()
	normalized := strings.ToLower(qual)
	normalized = strings.NewReplacer(" ", "", "\n", "", "\t", "", "\r", "").Replace(normalized)
	normalized = strings.ReplaceAll(normalized, "'draft'::text", "'draft'")
	required := []string{
		"owner_organization_idisnotnull",
		"owner_organization_id=app_current_organization_id()",
	}
	if table != "library_release_manifests" {
		required = append(required, "status='draft'")
	}
	for _, clause := range required {
		if !strings.Contains(normalized, clause) {
			t.Fatalf("%s USING dropped the tenant condition %q: %q", table, clause, qual)
		}
	}
	if table == "library_release_manifests" && strings.Contains(normalized, "status='draft'") {
		t.Fatalf("library_release_manifests USING gained a draft condition that000140 never had: %q", qual)
	}
}
