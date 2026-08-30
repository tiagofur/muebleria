package storage_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func organizationLifecycleMigrationSQL(t *testing.T, version int, suffix string) string {
	t.Helper()
	name := map[int]string{
		100: "organization_lifecycle_foundations",
		101: "remove_organization_active",
	}[version]
	contents, err := os.ReadFile(fmt.Sprintf("../../db/migration/%06d_%s.%s.sql", version, name, suffix))
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func TestOrganizationLifecycleMigration_BackfillsCanonicalStatusAndEntitlements(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 101)
	ctx := context.Background()

	var status string
	var credentialVersion int64
	if err := pool.QueryRow(ctx, `SELECT status, credential_version FROM organizations WHERE id=$1`, multiOrgInitialOrgID).
		Scan(&status, &credentialVersion); err != nil {
		t.Fatal(err)
	}
	if status != "suspended" || credentialVersion != 1 {
		t.Fatalf("backfill status=%s credential_version=%d", status, credentialVersion)
	}
	var activeExists bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema='public' AND table_name='organizations' AND column_name='active'
		)`).Scan(&activeExists); err != nil || activeExists {
		t.Fatalf("legacy active exists=%v err=%v", activeExists, err)
	}
	var maxPartners, sketchupSeats int64
	var manufacturing, salesNetwork, advancedAudit bool
	var source, revision string
	if err := pool.QueryRow(ctx, `
		SELECT max_sales_partners, manufacturing_enabled, sales_network_enabled,
			sketchup_seats, advanced_audit_enabled, source, defaults_revision
		FROM organization_entitlements WHERE organization_id=$1`, multiOrgInitialOrgID).
		Scan(&maxPartners, &manufacturing, &salesNetwork, &sketchupSeats,
			&advancedAudit, &source, &revision); err != nil {
		t.Fatal(err)
	}
	if maxPartners != 0 || manufacturing || salesNetwork || sketchupSeats != 0 || advancedAudit || source != "legacy_unlimited" || revision != "legacy-v1" {
		t.Fatalf("unexpected legacy entitlements partners=%d manufacturing=%v sales=%v sketchup=%d audit=%v source=%s revision=%s",
			maxPartners, manufacturing, salesNetwork, sketchupSeats, advancedAudit, source, revision)
	}
}

func TestOrganizationLifecycleMigration_NormalizesHistoricalPartialFixture(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 99)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		ALTER TABLE organization_team_state DROP COLUMN admin_bootstrap_pending;
		ALTER TABLE invitations DROP COLUMN previous_token_hashes
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, organizationLifecycleMigrationSQL(t, 100, "up")); err != nil {
		t.Fatalf("migration 100 against historical partial fixture: %v", err)
	}
	var bootstrapColumnExists bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema='public'
			  AND table_name='organization_team_state'
			  AND column_name='admin_bootstrap_pending'
		)`).Scan(&bootstrapColumnExists); err != nil || !bootstrapColumnExists {
		t.Fatalf("bootstrap marker restored=%v err=%v", bootstrapColumnExists, err)
	}
}

func TestOrganizationLifecycleStorage_TransitionsEpochAndReadiness(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 101)
	ctx := context.Background()
	store := &storage.PostgresStore{Pool: pool}
	const (
		orgID  = "c2000000-0000-0000-0000-000000000100"
		userID = "c1000000-0000-0000-0000-000000000100"
	)
	organization := &domain.Organization{
		Name: "Lifecycle", Slug: "lifecycle-100", Type: domain.OrganizationTypeFactory,
		Status: domain.OrganizationStatusProvisioning,
	}
	if err := store.CreateOrganization(ctx, organization); err != nil {
		t.Fatal(err)
	}
	if organization.Status != domain.OrganizationStatusProvisioning || organization.CredentialVersion != 1 {
		t.Fatalf("created organization=%+v", organization)
	}
	readiness, err := store.GetOrganizationReadiness(ctx, organization.ID)
	if err != nil || readiness.Ready() {
		t.Fatalf("readiness before bootstrap=%+v err=%v", readiness, err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO users (id,email,normalized_email,password_hash,name,account_status) VALUES ($1,'lifecycle@example.test','lifecycle@example.test','x','Lifecycle Admin','active')`, userID); err != nil {
		t.Fatal(err)
	}
	if err := store.EnsureMembership(ctx, organization.ID, userID, []domain.UserRole{domain.RoleAdmin}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpsertWorkshopSettingsForOrganization(ctx, organization.ID, domain.DefaultWorkshopSettings()); err != nil {
		t.Fatal(err)
	}
	readiness, err = store.GetOrganizationReadiness(ctx, organization.ID)
	if err != nil || !readiness.Ready() {
		t.Fatalf("readiness after bootstrap=%+v err=%v", readiness, err)
	}
	active, err := store.TransitionOrganizationStatus(ctx, organization.ID,
		domain.OrganizationStatusProvisioning, domain.OrganizationStatusActive,
		userID, "", organization.Version)
	if err != nil {
		t.Fatal(err)
	}
	suspended, err := store.TransitionOrganizationStatus(ctx, organization.ID,
		domain.OrganizationStatusActive, domain.OrganizationStatusSuspended,
		userID, "security hold", active.Version)
	if err != nil {
		t.Fatal(err)
	}
	if suspended.Status != domain.OrganizationStatusSuspended || suspended.CredentialVersion != 3 || suspended.SuspendedAt == nil || suspended.StatusReason == nil {
		t.Fatalf("suspended organization=%+v", suspended)
	}
	if _, err := store.TransitionOrganizationStatus(ctx, organization.ID,
		domain.OrganizationStatusSuspended, domain.OrganizationStatusTerminated,
		userID, "invalid", suspended.Version); err == nil {
		t.Fatal("invalid transition must fail")
	}
}

func TestOrganizationOffboardingPreviewCountsExecutableProductionAndInstallationWork(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `
		UPDATE projects
		SET part_instances = '[{"required_operations":[{"status":"in_progress"},{"status":"blocked"},{"status":"completed"},{"status":"skipped"}]}]'::jsonb,
		    module_units = '[{"status":"assembly"},{"status":"installed"}]'::jsonb,
		    installation = '{
		      "visits":[{"status":"scheduled"},{"status":"in_progress"},{"status":"completed"},{"status":"cancelled"}],
		      "field_issues":[{"status":"open"},{"status":"action_required"},{"status":"blocked"},{"status":"resolved"},{"status":"verified"}],
		      "punch_items":[{"status":"open"},{"status":"closed"}]
		    }'::jsonb
		WHERE id='40000000-0000-0000-0000-000000000001'
	`); err != nil {
		t.Fatal(err)
	}
	preview, err := (&storage.PostgresStore{Pool: fx.admin}).GetOrganizationOffboardingPreview(ctx, rlsOrgB)
	if err != nil {
		t.Fatal(err)
	}
	if preview.OpenProjectCount != 1 ||
		preview.ActivePartOperationCount != 2 ||
		preview.ActiveModuleUnitCount != 1 ||
		preview.ActiveInstallationVisitCount != 2 ||
		preview.OpenInstallationFieldIssueCount != 3 ||
		preview.OpenInstallationPunchItemCount != 1 {
		t.Fatalf("unexpected executable blockers: %+v", preview)
	}
	if preview.BlockingCount() != 10 {
		t.Fatalf("blocking count=%d preview=%+v", preview.BlockingCount(), preview)
	}
}

func TestOrganizationLifecycleMigration_DownFailsClosedAfterLifecycleFact(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 101)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `UPDATE organizations SET credential_version=2 WHERE id=$1`, multiOrgInitialOrgID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, organizationLifecycleMigrationSQL(t, 101, "down")); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, organizationLifecycleMigrationSQL(t, 100, "down")); err == nil || !strings.Contains(err.Error(), "lifecycle facts") {
		t.Fatalf("unsafe lifecycle down error=%v", err)
	}
}

func TestOrganizationLifecycleMigration_RollbackAndReapplyWithoutFacts(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 101)
	ctx := context.Background()
	for _, step := range []struct {
		version int
		suffix  string
	}{
		{101, "down"},
		{100, "down"},
		{100, "up"},
		{101, "up"},
	} {
		if _, err := pool.Exec(ctx, organizationLifecycleMigrationSQL(t, step.version, step.suffix)); err != nil {
			t.Fatalf("migration %d %s: %v", step.version, step.suffix, err)
		}
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM organizations WHERE id=$1`, multiOrgInitialOrgID).Scan(&status); err != nil || status != "suspended" {
		t.Fatalf("reapplied status=%q err=%v", status, err)
	}
}

func TestOrganizationLifecycleRLS_NonActiveTenantCanReadButCannotMutateDirectSQL(t *testing.T) {
	for _, status := range []domain.OrganizationStatus{
		domain.OrganizationStatusSuspended,
		domain.OrganizationStatusOffboarding,
	} {
		t.Run(string(status), func(t *testing.T) {
			fx := newRLSFixture(t)
			ctx := context.Background()
			adminStore := &storage.PostgresStore{Pool: fx.admin}
			organization, err := adminStore.GetOrganizationByID(ctx, rlsOrgA)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := adminStore.TransitionOrganizationStatus(ctx, rlsOrgA,
				domain.OrganizationStatusActive, status,
				rlsUserA, "lifecycle hold", organization.Version); err != nil {
				t.Fatal(err)
			}

			withRLSActor(t, fx.app, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
				var visible int
				if err := tx.QueryRow(ctx, `SELECT count(*) FROM customers`).Scan(&visible); err != nil || visible != 1 {
					t.Fatalf("%s read visible=%d err=%v", status, visible, err)
				}
			})

			assertDenied := func(name, query string, args ...any) {
				t.Helper()
				withRLSActor(t, fx.app, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
					tag, execErr := tx.Exec(ctx, query, args...)
					if execErr == nil && tag.RowsAffected() != 0 {
						t.Fatalf("%s %s unexpectedly affected %d rows", status, name, tag.RowsAffected())
					}
				})
			}
			assertDenied("insert", `INSERT INTO customers (id,name,organization_id) VALUES ('30000000-0000-0000-0000-0000000000aa','Blocked',$1)`, rlsOrgA)
			assertDenied("update", `UPDATE customers SET name='Blocked' WHERE id='30000000-0000-0000-0000-00000000000a'`)
			assertDenied("delete", `DELETE FROM customers WHERE id='30000000-0000-0000-0000-00000000000a'`)
			assertDenied("upsert", `
				INSERT INTO customers (id,name,organization_id)
				VALUES ('30000000-0000-0000-0000-00000000000a','Blocked',$1)
				ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`, rlsOrgA)

			var name string
			var count int
			if err := fx.admin.QueryRow(ctx, `SELECT name FROM customers WHERE id='30000000-0000-0000-0000-00000000000a'`).Scan(&name); err != nil || name != "Customer A" {
				t.Fatalf("%s mutation changed customer name=%q err=%v", status, name, err)
			}
			if err := fx.admin.QueryRow(ctx, `SELECT count(*) FROM customers WHERE organization_id=$1`, rlsOrgA).Scan(&count); err != nil || count != 1 {
				t.Fatalf("%s mutation changed customer count=%d err=%v", status, count, err)
			}
		})
	}
}
