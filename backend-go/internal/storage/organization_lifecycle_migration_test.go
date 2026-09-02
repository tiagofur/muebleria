package storage_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/api"
	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func organizationLifecycleMigrationSQL(t *testing.T, version int, suffix string) string {
	t.Helper()
	name := map[int]string{
		100: "organization_lifecycle_foundations",
		101: "remove_organization_active",
		102: "support_session_credential_epoch",
	}[version]
	contents, err := os.ReadFile(fmt.Sprintf("../../db/migration/%06d_%s.%s.sql", version, name, suffix))
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func newNamedRuntimeOrganizationStore(t *testing.T, applicationName string) *storage.PostgresStore {
	t.Helper()
	config, err := pgxpool.ParseConfig(rlsDatabaseURL(t).String())
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.User = rlsAppRole
	config.ConnConfig.Password = "rls-test-password"
	config.ConnConfig.RuntimeParams["application_name"] = applicationName
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return &storage.PostgresStore{Pool: pool}
}

func waitForOrganizationLockWait(t *testing.T, admin *pgxpool.Pool, applicationName string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var waiting bool
		err := admin.QueryRow(context.Background(), `
			SELECT EXISTS (
				SELECT 1 FROM pg_stat_activity
				WHERE application_name=$1 AND wait_event_type='Lock'
			)`, applicationName).Scan(&waiting)
		if err == nil && waiting {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("%s did not block on the organization lock", applicationName)
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

	failedOrganization := &domain.Organization{
		Name: "Failed lifecycle", Slug: "failed-lifecycle-100", Type: domain.OrganizationTypeStore,
		Status: domain.OrganizationStatusProvisioning,
	}
	if err := store.CreateOrganization(ctx, failedOrganization); err != nil {
		t.Fatal(err)
	}
	failed, err := store.TransitionOrganizationStatus(ctx, failedOrganization.ID,
		domain.OrganizationStatusProvisioning, domain.OrganizationStatusProvisioningFailed,
		userID, "bootstrap failed", failedOrganization.Version)
	if err != nil {
		t.Fatal(err)
	}
	terminated, err := store.TransitionOrganizationStatus(ctx, failedOrganization.ID,
		domain.OrganizationStatusProvisioningFailed, domain.OrganizationStatusTerminated,
		userID, "abandon failed provisioning", failed.Version)
	if err != nil {
		t.Fatal(err)
	}
	if terminated.Status != domain.OrganizationStatusTerminated || terminated.TerminatedAt == nil {
		t.Fatalf("terminated failed provisioning=%+v", terminated)
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

func TestOrganizationLifecyclePrivileges_DirectOrganizationDMLDeniedButCommandAllowed(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	for _, mutation := range []struct {
		name string
		sql  string
	}{
		{"insert", `INSERT INTO organizations (name,slug,type,status) VALUES ('Direct','direct-org','store','provisioning')`},
		{"update own", `UPDATE organizations SET status='suspended',version=version+1,credential_version=credential_version+1 WHERE id='` + rlsOrgA + `'`},
		{"update other", `UPDATE organizations SET status='suspended',version=version+1,credential_version=credential_version+1 WHERE id='` + rlsOrgB + `'`},
		{"delete own", `DELETE FROM organizations WHERE id='` + rlsOrgA + `'`},
		{"delete other", `DELETE FROM organizations WHERE id='` + rlsOrgB + `'`},
	} {
		t.Run(mutation.name, func(t *testing.T) {
			withRLSActor(t, fx.app, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
				if _, err := tx.Exec(ctx, mutation.sql); err == nil {
					t.Fatalf("direct organization %s unexpectedly succeeded", mutation.name)
				}
			})
		})
	}
	for _, command := range []struct {
		name string
		sql  string
	}{
		{"create function", `SELECT * FROM command_create_organization('Unauthorized','unauthorized-org','factory','none',NULL,'provisioning',NULL,$1,NULL)`},
		{"metadata function", `SELECT * FROM command_update_organization_metadata($1,'Unauthorized','none',NULL,1)`},
		{"transition function", `SELECT * FROM command_transition_organization_status($1,'active','suspended',$2,'unauthorized',1)`},
	} {
		t.Run(command.name, func(t *testing.T) {
			withRLSActor(t, fx.app, rlsOrgB, rlsUserB, func(tx pgx.Tx) {
				args := []any{rlsOrgB}
				if command.name == "create function" {
					args = []any{rlsUserB}
				} else if command.name == "transition function" {
					args = append(args, rlsUserB)
				}
				if _, err := tx.Exec(ctx, command.sql, args...); err == nil {
					t.Fatalf("direct inherited-login %s unexpectedly succeeded", command.name)
				}
			})
		})
	}

	adminStore := &storage.PostgresStore{Pool: fx.admin}
	before, err := adminStore.GetOrganizationByID(ctx, rlsOrgA)
	if err != nil {
		t.Fatal(err)
	}
	runtimeStore := &storage.PostgresStore{Pool: fx.app}
	err = runtimeStore.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA}, func(txCtx context.Context) error {
		_, transitionErr := runtimeStore.TransitionOrganizationStatus(
			txCtx, rlsOrgA, domain.OrganizationStatusActive, domain.OrganizationStatusSuspended,
			rlsUserA, "platform command proof", before.Version,
		)
		return transitionErr
	})
	if err != nil {
		t.Fatalf("authoritative lifecycle command: %v", err)
	}
	after, err := adminStore.GetOrganizationByID(ctx, rlsOrgA)
	if err != nil {
		t.Fatal(err)
	}
	if after.Status != domain.OrganizationStatusSuspended || after.Version != before.Version+1 || after.CredentialVersion != before.CredentialVersion+1 {
		t.Fatalf("authoritative transition=%+v before=%+v", after, before)
	}
}

func TestFactoryProvisioningHTTPPostgresRuntimeRoleSuccessRollbackAndReplay(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	const (
		secret = "organization-runtime-role-test-secret"
		slug   = "factory-runtime-child"
		key    = "factory-runtime-child-key"
	)
	var membershipID string
	var membershipCredentialVersion, organizationCredentialVersion int64
	if err := fx.admin.QueryRow(ctx, `
		SELECT membership.id, membership.credential_version, organization.credential_version
		FROM memberships membership
		JOIN organizations organization ON organization.id=membership.organization_id
		WHERE membership.organization_id=$1 AND membership.user_id=$2`, rlsOrgA, rlsUserA).
		Scan(&membershipID, &membershipCredentialVersion, &organizationCredentialVersion); err != nil {
		t.Fatal(err)
	}
	token, err := auth.GenerateLegacyWebToken(rlsUserA, "rls-a@example.test", auth.TokenContext{
		Roles: []string{string(domain.RoleAdmin)}, OrgID: rlsOrgA, MembershipID: membershipID,
		MembershipCredentialVersion:   membershipCredentialVersion,
		OrganizationCredentialVersion: organizationCredentialVersion,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	handler := api.RegisterRoutes(api.NewServer(fx.store, secret, nil, 100, 100))
	request := func() *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/organizations", strings.NewReader(
			`{"name":"Runtime Child","slug":"`+slug+`","type":"store","license_plan":"none"}`,
		))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", key)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		return recorder
	}

	if _, err := fx.admin.Exec(ctx, `
		CREATE FUNCTION fail_runtime_child_settings() RETURNS TRIGGER
		LANGUAGE plpgsql AS $$
		BEGIN
			IF EXISTS (SELECT 1 FROM organizations WHERE id=NEW.organization_id AND slug='`+slug+`') THEN
				RAISE EXCEPTION 'injected child settings failure';
			END IF;
			RETURN NEW;
		END $$;
		CREATE TRIGGER fail_runtime_child_settings
		BEFORE INSERT ON workshop_settings
		FOR EACH ROW EXECUTE FUNCTION fail_runtime_child_settings()
	`); err != nil {
		t.Fatal(err)
	}
	failed := request()
	if failed.Code != http.StatusInternalServerError {
		t.Fatalf("failure status=%d body=%s", failed.Code, failed.Body.String())
	}
	var count int
	if err := fx.admin.QueryRow(ctx, `SELECT count(*) FROM organizations WHERE slug=$1`, slug).Scan(&count); err != nil || count != 0 {
		t.Fatalf("failed provisioning leaked organizations=%d err=%v", count, err)
	}
	if _, err := fx.admin.Exec(ctx, `
		DROP TRIGGER fail_runtime_child_settings ON workshop_settings;
		DROP FUNCTION fail_runtime_child_settings()
	`); err != nil {
		t.Fatal(err)
	}

	created := request()
	if created.Code != http.StatusCreated || created.Header().Get("Idempotency-Replayed") != "" {
		t.Fatalf("create status=%d replay=%q body=%s", created.Code, created.Header().Get("Idempotency-Replayed"), created.Body.String())
	}
	replayed := request()
	if replayed.Code != http.StatusCreated || replayed.Header().Get("Idempotency-Replayed") != "true" || replayed.Body.String() != created.Body.String() {
		t.Fatalf("replay status=%d replay=%q body=%s", replayed.Code, replayed.Header().Get("Idempotency-Replayed"), replayed.Body.String())
	}
	var childID, status, parentID string
	if err := fx.admin.QueryRow(ctx, `SELECT id::text,status,parent_organization_id::text FROM organizations WHERE slug=$1`, slug).
		Scan(&childID, &status, &parentID); err != nil {
		t.Fatal(err)
	}
	if status != "active" || parentID != rlsOrgA {
		t.Fatalf("child status=%s parent=%s", status, parentID)
	}
	if err := fx.admin.QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM memberships WHERE organization_id=$1),
			(SELECT count(*) FROM workshop_settings WHERE organization_id=$1),
			(SELECT count(*) FROM organization_entitlements WHERE organization_id=$1),
			(SELECT count(*) FROM modules WHERE organization_id=$1)
	`, childID).Scan(new(int), new(int), new(int), &count); err != nil || count == 0 {
		t.Fatalf("child provisioning materialization catalog=%d err=%v", count, err)
	}
}

func TestSupportSessionStartAndOrganizationSuspendSerializeOnOrganizationLock(t *testing.T) {
	tests := []struct {
		name         string
		startFirst   bool
		wantStartErr error
	}{
		{name: "start commits before suspension and is closed", startFirst: true},
		{name: "suspension commits before start and start is rejected", wantStartErr: application.ErrOrganizationStatusConflict},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fx := newRLSFixture(t)
			ctx := context.Background()
			adminStore := &storage.PostgresStore{Pool: fx.admin}
			organization, err := adminStore.GetOrganizationByID(ctx, rlsOrgA)
			if err != nil {
				t.Fatal(err)
			}
			firstName := "support-race-first"
			secondName := "support-race-second"
			startStore := newNamedRuntimeOrganizationStore(t, firstName)
			suspendStore := newNamedRuntimeOrganizationStore(t, secondName)
			if !test.startFirst {
				startStore, suspendStore = newNamedRuntimeOrganizationStore(t, secondName), newNamedRuntimeOrganizationStore(t, firstName)
			}
			startService := application.NewOrganizationService(startStore)
			suspendService := application.NewOrganizationService(suspendStore)

			blocker, err := fx.admin.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer blocker.Rollback(ctx)
			if _, err := blocker.Exec(ctx, `SELECT id FROM organizations WHERE id=$1 FOR UPDATE`, rlsOrgA); err != nil {
				t.Fatal(err)
			}

			startResult := make(chan error, 1)
			suspendResult := make(chan error, 1)
			start := func() {
				_, startErr := startService.StartSupportSession(ctx, application.StartSupportSessionCommand{
					OrganizationID: rlsOrgA, ActorUserID: rlsUserA,
					Reason: "concurrent lifecycle proof", TTL: time.Hour,
				})
				startResult <- startErr
			}
			suspend := func() {
				_, suspendErr := suspendService.SuspendOrganization(ctx, application.LifecycleCommand{
					OrganizationID: rlsOrgA, ActorUserID: rlsUserA,
					Reason: "concurrent lifecycle proof", ExpectedVersion: organization.Version,
				})
				suspendResult <- suspendErr
			}
			if test.startFirst {
				go start()
			} else {
				go suspend()
			}
			waitForOrganizationLockWait(t, fx.admin, firstName)
			if test.startFirst {
				go suspend()
			} else {
				go start()
			}
			waitForOrganizationLockWait(t, fx.admin, secondName)
			if err := blocker.Commit(ctx); err != nil {
				t.Fatal(err)
			}

			startErr := <-startResult
			suspendErr := <-suspendResult
			if !errors.Is(startErr, test.wantStartErr) {
				t.Fatalf("start error=%v want=%v", startErr, test.wantStartErr)
			}
			if suspendErr != nil {
				t.Fatalf("suspend error=%v", suspendErr)
			}
			var status domain.OrganizationStatus
			var openSessions int
			if err := fx.admin.QueryRow(ctx, `SELECT status FROM organizations WHERE id=$1`, rlsOrgA).Scan(&status); err != nil {
				t.Fatal(err)
			}
			if err := fx.admin.QueryRow(ctx, `SELECT count(*) FROM support_sessions WHERE organization_id=$1 AND ended_at IS NULL`, rlsOrgA).Scan(&openSessions); err != nil {
				t.Fatal(err)
			}
			if status != domain.OrganizationStatusSuspended || openSessions != 0 {
				t.Fatalf("status=%s open support sessions=%d", status, openSessions)
			}
		})
	}
}

func TestPlatformLifecycleHTTPPostgresInheritedRuntimeRole(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	const (
		secret = "platform-lifecycle-runtime-test-secret"
		orgID  = "c2000000-0000-0000-0000-000000000200"
	)
	adminStore := &storage.PostgresStore{Pool: fx.admin}
	organization := &domain.Organization{
		ID: orgID, Name: "Platform Lifecycle", Slug: "platform-lifecycle-runtime",
		Type: domain.OrganizationTypeFactory, Status: domain.OrganizationStatusProvisioning,
	}
	if err := adminStore.CreateOrganization(ctx, organization); err != nil {
		t.Fatal(err)
	}
	if err := adminStore.EnsureMembership(ctx, organization.ID, rlsUserA, []domain.UserRole{domain.RoleAdmin}); err != nil {
		t.Fatal(err)
	}
	if _, err := adminStore.UpsertWorkshopSettingsForOrganization(ctx, organization.ID, domain.DefaultWorkshopSettings()); err != nil {
		t.Fatal(err)
	}
	organization, err := adminStore.TransitionOrganizationStatus(
		ctx, organization.ID, domain.OrganizationStatusProvisioning, domain.OrganizationStatusActive,
		rlsUserA, "fixture activation", organization.Version,
	)
	if err != nil {
		t.Fatal(err)
	}
	// #460 SEC-7: the lifecycle commands and support entry are step-up gated,
	// and step-up authority binds to a ver5 registry session — a legacy ver4
	// bearer can never be elevated. Mint the session, enroll a real TOTP
	// factor and grant the scopes this flow exercises.
	var session *domain.AuthSession
	err = fx.store.WithinTenantTx(ctx, storage.TenantActor{UserID: rlsUserA}, func(txCtx context.Context) error {
		created, err := fx.store.CreateAuthSession(txCtx, storage.CreateAuthSessionCommand{
			UserID:            rlsUserA,
			ClientType:        domain.SessionClientWeb,
			AbsoluteExpiresAt: time.Now().Add(time.Hour).UTC(),
		})
		session = created
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	keyring, err := auth.NewMFAKeyring("test", map[string][]byte{"test": []byte(strings.Repeat("mfa-lifecycle-", 3))})
	if err != nil {
		t.Fatal(err)
	}
	mfaSecrets, err := auth.NewMFASecrets(keyring)
	if err != nil {
		t.Fatal(err)
	}
	rawTOTP, _, err := auth.GenerateTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	sealedTOTP, sealedKid, err := mfaSecrets.EncryptTOTPSecret(rawTOTP)
	if err != nil {
		t.Fatal(err)
	}
	pending, err := fx.store.CreateMFAEnrollment(ctx, storage.CreateMFAEnrollmentCommand{
		UserID:           rlsUserA,
		FactorID:         "d0000000-0000-0000-0000-0000000000a1",
		EncryptedSecret:  sealedTOTP,
		EncryptionKid:    sealedKid,
		PendingExpiresAt: time.Now().Add(storage.MFAEnrollmentTTL).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	totpCounter := auth.TOTPCounter(time.Now())
	if _, err := fx.store.EnableMFAFactor(ctx, storage.EnableMFAFactorCommand{
		UserID:   rlsUserA,
		FactorID: pending.ID,
		Code:     auth.TOTPCode(rawTOTP, totpCounter),
		Secrets:  mfaSecrets,
	}); err != nil {
		t.Fatal(err)
	}
	for _, scope := range []string{domain.StepUpScopeSupportAccess, domain.StepUpScopePlatformAdmin} {
		// First non-replayed counter; the ±1 acceptance window allows at most
		// one future slot, so a second scope in the same interval waits for
		// the next one instead of tripping replay protection.
		next := totpCounter + 1
		current := auth.TOTPCounter(time.Now())
		if next > current+1 {
			time.Sleep(time.Until(time.Unix((next-1)*int64(auth.TOTPPeriod.Seconds()), 0)) + 100*time.Millisecond)
		}
		totpCounter = next
		if _, err := fx.store.VerifyMFAStepUp(ctx, storage.MFAStepUpCommand{
			UserID:    rlsUserA,
			SessionID: session.ID,
			Scope:     scope,
			Method:    domain.StepUpMethodTOTP,
			Code:      auth.TOTPCode(rawTOTP, totpCounter),
			Secrets:   mfaSecrets,
		}); err != nil {
			t.Fatal(err)
		}
	}
	jwtKeyring, err := auth.SingleKeyKeyring(secret)
	if err != nil {
		t.Fatal(err)
	}
	authority, err := auth.NewAuthority(jwtKeyring, "")
	if err != nil {
		t.Fatal(err)
	}
	token, err := authority.IssueTransportTokenUntil(rlsUserA, "rls-a@example.test", auth.TokenContext{
		PlatformAdmin: true,
		SessionID:     session.ID,
	}, "web", session.AbsoluteExpiresAt)
	if err != nil {
		t.Fatal(err)
	}
	handler := api.RegisterRoutes(api.NewServer(fx.store, secret, nil, 100, 100))
	get := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		return recorder
	}
	readinessResponse := get("/api/organizations/" + organization.ID + "/readiness")
	if readinessResponse.Code != http.StatusOK {
		t.Fatalf("readiness status=%d body=%s", readinessResponse.Code, readinessResponse.Body.String())
	}
	var readiness struct {
		OrganizationID string `json:"organization_id"`
		Checks         []struct {
			Code  string `json:"code"`
			Ready bool   `json:"ready"`
		} `json:"checks"`
	}
	if err := json.Unmarshal(readinessResponse.Body.Bytes(), &readiness); err != nil || readiness.OrganizationID != organization.ID {
		t.Fatalf("readiness body=%s err=%v", readinessResponse.Body.String(), err)
	}
	readyChecks := map[string]bool{}
	for _, check := range readiness.Checks {
		readyChecks[check.Code] = check.Ready
	}
	for _, code := range []string{"bootstrap_admin", "workshop_settings", "entitlements"} {
		if !readyChecks[code] {
			t.Fatalf("readiness check %s hidden by RLS: %+v", code, readiness.Checks)
		}
	}
	entitlementsResponse := get("/api/organizations/" + organization.ID + "/entitlements")
	if entitlementsResponse.Code != http.StatusOK {
		t.Fatalf("entitlements status=%d body=%s", entitlementsResponse.Code, entitlementsResponse.Body.String())
	}
	var entitlements struct {
		OrganizationID string `json:"organization_id"`
		Version        int64  `json:"version"`
	}
	if err := json.Unmarshal(entitlementsResponse.Body.Bytes(), &entitlements); err != nil || entitlements.OrganizationID != organization.ID || entitlements.Version < 1 {
		t.Fatalf("entitlements body=%s err=%v", entitlementsResponse.Body.String(), err)
	}
	const missingOrganizationID = "c2000000-0000-0000-0000-000000000999"
	for _, path := range []string{
		"/api/organizations/" + missingOrganizationID + "/readiness",
		"/api/organizations/" + missingOrganizationID + "/entitlements",
	} {
		if response := get(path); response.Code == http.StatusOK {
			t.Fatalf("missing target %s unexpectedly returned 200: %s", path, response.Body.String())
		}
	}
	command := func(action, body, key string, version int64) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/organizations/"+organization.ID+":"+action, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", key)
		req.Header.Set("If-Match", api.FormatVersionETag(version))
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", action, recorder.Code, recorder.Body.String())
		}
		return recorder
	}
	preview := func() (string, int64) {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/organizations/"+organization.ID+"/offboarding-preview", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusOK {
			t.Fatalf("preview status=%d body=%s", recorder.Code, recorder.Body.String())
		}
		var body struct {
			ImpactVersion       string `json:"impact_version"`
			OrganizationVersion int64  `json:"organization_version"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil || body.ImpactVersion == "" {
			t.Fatalf("preview body=%s err=%v", recorder.Body.String(), err)
		}
		return body.ImpactVersion, body.OrganizationVersion
	}
	load := func(want domain.OrganizationStatus) *domain.Organization {
		t.Helper()
		current, err := adminStore.GetOrganizationByID(ctx, organization.ID)
		if err != nil || current.Status != want {
			t.Fatalf("status=%v want=%s err=%v", current, want, err)
		}
		return current
	}
	startSupport := func(key string) (string, string) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/platform/organizations/"+organization.ID+"/support-session", strings.NewReader(`{"reason":"lifecycle support proof"}`))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", key)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusCreated {
			t.Fatalf("start support status=%d body=%s", recorder.Code, recorder.Body.String())
		}
		var response struct {
			Token     string `json:"token"`
			SessionID string `json:"session_id"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Token == "" || response.SessionID == "" {
			t.Fatalf("start support body=%s err=%v", recorder.Body.String(), err)
		}
		return response.Token, response.SessionID
	}
	supportRequestStatus := func(supportToken string) int {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/customers", nil)
		req.Header.Set("Authorization", "Bearer "+supportToken)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		return recorder.Code
	}

	firstSupportToken, _ := startSupport("platform-support-before-suspend")
	if status := supportRequestStatus(firstSupportToken); status != http.StatusOK {
		t.Fatalf("active support request status=%d", status)
	}
	command("suspend", `{"reason":"platform suspension"}`, "platform-suspend", organization.Version)
	organization = load(domain.OrganizationStatusSuspended)
	if status := supportRequestStatus(firstSupportToken); status != http.StatusUnauthorized {
		t.Fatalf("suspended support request status=%d", status)
	}
	command("reactivate", `{"reason":"platform reactivation"}`, "platform-reactivate", organization.Version)
	organization = load(domain.OrganizationStatusActive)
	if status := supportRequestStatus(firstSupportToken); status != http.StatusUnauthorized {
		t.Fatalf("reactivated old support request status=%d", status)
	}
	secondSupportToken, secondSupportSessionID := startSupport("platform-support-before-offboarding")
	if status := supportRequestStatus(secondSupportToken); status != http.StatusOK {
		t.Fatalf("second active support request status=%d", status)
	}
	impact, version := preview()
	command("begin-offboarding", `{"reason":"platform offboarding","impact_version":"`+impact+`"}`, "platform-offboarding", version)
	organization = load(domain.OrganizationStatusOffboarding)
	if status := supportRequestStatus(secondSupportToken); status != http.StatusUnauthorized {
		t.Fatalf("offboarding support request status=%d", status)
	}
	var endedVia string
	if err := fx.admin.QueryRow(ctx, `SELECT ended_via FROM support_sessions WHERE id=$1`, secondSupportSessionID).Scan(&endedVia); err != nil || endedVia != "org_offboarding" {
		t.Fatalf("offboarding support ended_via=%q err=%v", endedVia, err)
	}
	impact, version = preview()
	command("terminate", `{"reason":"platform termination","impact_version":"`+impact+`"}`, "platform-terminate", version)
	load(domain.OrganizationStatusTerminated)
}
