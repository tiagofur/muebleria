package storage_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/api"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #385 / DT-1: project-owned furniture identity. These integration tests run
// against real PostgreSQL under the app role. They pin the contract required
// by the issue:
//
//   - identity: two identical physical units never collapse into one ID (I2);
//     the ID is database-allocated, so it cannot be derived from position,
//     name, dimensions, definition or SketchUp locators — the row simply has
//     no such inputs, and identical commands still yield distinct IDs;
//   - ownership: exactly one project, cross-project provenance rejected,
//     creation/removal restricted to the project's owning organization;
//   - lifecycle: active → removed is terminal, versions are optimistic;
//   - durable audit: creation/removal events commit in the same transaction;
//   - RLS: even a deliberately unfiltered query under the app DB role cannot
//     cross organizations (#449 convention).

const (
	fiSharedProject = "40000000-0000-0000-0000-000000000001" // owner org A, manufacturing org B (RLS fixture)
	fiProjectAOnly  = "40000000-0000-0000-0000-000000000003" // owner/sales/manufacturing all org A
	fiProjectB      = "40000000-0000-0000-0000-000000000002" // owner org B
	fiModuleA       = "50000000-0000-0000-0000-000000000001" // org A catalog module
	fiInstanceA     = "51000000-0000-0000-0000-00000000000a" // org A identity (direct-SQL fixture)
	fiInstanceB     = "51000000-0000-0000-0000-00000000000b" // org B identity (direct-SQL fixture)
	fiInstanceAOnly = "51000000-0000-0000-0000-00000000000c" // org A identity in the org-A-only project
)

func furnitureInstancesMigrationSQL(t *testing.T) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000111_project_furniture_instances.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

// The identity migration must apply both on a fresh database and on top of
// the pre-#385 schema (upgrade fixture), and must register the table in the
// RLS policy inventory with FORCE ROW LEVEL SECURITY from the first migration.
func TestFurnitureInstances_MigrationFreshAndUpgrade(t *testing.T) {
	ctx := context.Background()

	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 111)
	assertFurnitureInstancesSchema(t, fresh)

	upgrade := multiOrgFreshDB(t)
	identityApplyThrough(t, upgrade, 110)
	if _, err := upgrade.Exec(ctx, furnitureInstancesMigrationSQL(t)); err != nil {
		t.Fatalf("upgrade apply 000111: %v", err)
	}
	assertFurnitureInstancesSchema(t, upgrade)
}

func assertFurnitureInstancesSchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	var classification, readScope, writeScope string
	if err := pool.QueryRow(ctx,
		`SELECT classification, read_scope, write_scope FROM rls_policy_inventory WHERE table_name='furniture_instances'`,
	).Scan(&classification, &readScope, &writeScope); err != nil {
		t.Fatalf("inventory row: %v", err)
	}
	if classification != "explicitly-shared" || readScope != "project-organizations" || writeScope != "project-organizations" {
		t.Fatalf("inventory = (%q,%q,%q), want explicitly-shared project-organizations", classification, readScope, writeScope)
	}

	var rls, forced bool
	if err := pool.QueryRow(ctx,
		`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='furniture_instances'`,
	).Scan(&rls, &forced); err != nil {
		t.Fatalf("pg_class lookup: %v", err)
	}
	if !rls || !forced {
		t.Fatalf("RLS enabled=%v forced=%v, want both true", rls, forced)
	}

	var policyName string
	if err := pool.QueryRow(ctx, `
		SELECT policyname FROM pg_policies
		WHERE schemaname='public' AND tablename='furniture_instances'`,
	).Scan(&policyName); err != nil || policyName != "project_explicit_organizations" {
		t.Fatalf("policy=%q err=%v, want project_explicit_organizations", policyName, err)
	}

	var triggerCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM information_schema.triggers
		WHERE event_object_table='furniture_instances' AND trigger_name='protect_shared_child_ownership'`,
	).Scan(&triggerCount); err != nil || triggerCount != 1 {
		t.Fatalf("ownership trigger count=%d err=%v, want 1", triggerCount, err)
	}

	var privileges []string
	rows, err := pool.Query(ctx, `
		SELECT privilege_type FROM information_schema.table_privileges
		WHERE table_name='furniture_instances' AND grantee='granete_app' ORDER BY privilege_type`)
	if err != nil {
		t.Fatalf("query privileges: %v", err)
	}
	for rows.Next() {
		var privilege string
		if err := rows.Scan(&privilege); err != nil {
			t.Fatal(err)
		}
		privileges = append(privileges, privilege)
	}
	rows.Close()
	granted := strings.Join(privileges, ",")
	// Identity is never hard-deleted through the runtime role: only the
	// project cascade may remove rows physically.
	for _, needed := range []string{"INSERT", "SELECT", "UPDATE"} {
		if !strings.Contains(granted, needed) {
			t.Fatalf("granete_app privileges=%q missing %s", granted, needed)
		}
	}
	if strings.Contains(granted, "DELETE") {
		t.Fatalf("granete_app must not hold DELETE on furniture_instances: %q", granted)
	}
}

func fiActorA() storage.TenantActor {
	return storage.TenantActor{OrganizationID: rlsOrgA, UserID: rlsUserA}
}

func fiActorB() storage.TenantActor {
	return storage.TenantActor{OrganizationID: rlsOrgB, UserID: rlsUserB}
}

// fiTx runs store work under the app role inside one tenant transaction —
// the same shape the HTTP middleware produces.
func fiTx(t *testing.T, store *storage.PostgresStore, actor storage.TenantActor, run func(ctx context.Context) error) error {
	t.Helper()
	return store.WithinTenantTx(context.Background(), actor, run)
}

func TestFurnitureInstances_IdentityLifecycleAndAudit(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO projects (id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id)
		VALUES
		 ('`+fiProjectB+`', 'Org B own project', '30000000-0000-0000-0000-00000000000b', 'draft',
			'`+rlsOrgB+`', '`+rlsOrgB+`', '`+rlsOrgB+`'),
		 ('`+fiProjectAOnly+`', 'Org A private project', '30000000-0000-0000-0000-00000000000a', 'draft',
			'`+rlsOrgA+`', '`+rlsOrgA+`', '`+rlsOrgA+`')`); err != nil {
		t.Fatal(err)
	}

	base := storage.CreateFurnitureInstanceCommand{
		ProjectID:   fiSharedProject,
		Origin:      domain.FurnitureInstanceOriginManual,
		ActorUserID: rlsUserA,
		IP:          "203.0.113.10",
		RequestID:   "fi-test-create-0001",
	}
	create := func(cmd storage.CreateFurnitureInstanceCommand) (*domain.FurnitureInstance, error) {
		var instance *domain.FurnitureInstance
		err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
			var txErr error
			instance, txErr = fx.store.CreateFurnitureInstance(ctx, cmd)
			return txErr
		})
		return instance, err
	}
	remove := func(actor storage.TenantActor, cmd storage.RemoveFurnitureInstanceCommand) (*domain.FurnitureInstance, error) {
		var instance *domain.FurnitureInstance
		err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
			var txErr error
			instance, txErr = fx.store.RemoveFurnitureInstance(ctx, cmd)
			return txErr
		})
		return instance, err
	}
	list := func(actor storage.TenantActor, projectID string, includeTerminal bool) ([]domain.FurnitureInstance, error) {
		var instances []domain.FurnitureInstance
		err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
			var txErr error
			instances, txErr = fx.store.ListFurnitureInstancesByProject(ctx, projectID, includeTerminal)
			return txErr
		})
		return instances, err
	}
	getByID := func(actor storage.TenantActor, id string) (*domain.FurnitureInstance, error) {
		var instance *domain.FurnitureInstance
		err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
			var txErr error
			instance, txErr = fx.store.GetFurnitureInstanceByID(ctx, id)
			return txErr
		})
		return instance, err
	}

	// I2 — identity independence: two IDENTICAL commands (same project, same
	// definition, same origin, same actor) must yield two distinct IDs. The
	// command carries no position/name/dimension/SketchUp input at all, so
	// this is also the proof that identity cannot be derived from them.
	first, err := create(base)
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	second, err := create(base)
	if err != nil {
		t.Fatalf("create second: %v", err)
	}
	if first.ID == second.ID || !isValidTestUUID(first.ID) || !isValidTestUUID(second.ID) {
		t.Fatalf("identical units collapsed: %q vs %q", first.ID, second.ID)
	}
	for _, instance := range []*domain.FurnitureInstance{first, second} {
		if instance.ProjectID != fiSharedProject || instance.LifecycleStatus != domain.FurnitureInstanceLifecycleActive || instance.Version != 1 {
			t.Fatalf("unexpected initial state: %+v", instance)
		}
		if instance.OrganizationID != rlsOrgA {
			t.Fatalf("instance organization = %q, want project owner %q", instance.OrganizationID, rlsOrgA)
		}
	}

	// Catalog provenance is optional and validated inside the tenant scope.
	defined, err := create(func() storage.CreateFurnitureInstanceCommand {
		cmd := base
		cmd.FurnitureDefinitionID = fiModuleA
		return cmd
	}())
	if err != nil {
		t.Fatalf("create with definition: %v", err)
	}
	if defined.FurnitureDefinitionID != fiModuleA {
		t.Fatalf("definition provenance lost: %+v", defined)
	}
	unknownDefinition := base
	unknownDefinition.FurnitureDefinitionID = "51000000-0000-0000-0000-00000000ff0f"
	if _, err := create(unknownDefinition); !errors.Is(err, storage.ErrFurnitureDefinitionNotFound) {
		t.Fatalf("unknown definition err=%v, want ErrFurnitureDefinitionNotFound", err)
	}

	// A random project UUID cannot attach the identity anywhere: it is simply
	// invisible under the caller's scope.
	randomProject := base
	randomProject.ProjectID = "4ffffff0-0000-0000-0000-000000000f0f"
	if _, err := create(randomProject); !errors.Is(err, storage.ErrFurnitureInstanceNotFound) {
		t.Fatalf("random project err=%v, want ErrFurnitureInstanceNotFound", err)
	}

	// Cross-project linking is rejected server-side: duplicate provenance
	// must reference an instance of the SAME project.
	dup := base
	dup.Origin = domain.FurnitureInstanceOriginDuplicate
	dup.OriginFurnitureInstanceID = first.ID
	foreignDup := dup
	foreignDup.ProjectID = fiProjectAOnly // valid project for A, but the provenance row is elsewhere
	if _, err := create(foreignDup); !errors.Is(err, storage.ErrFurnitureInstanceNotFound) {
		t.Fatalf("cross-project duplicate err=%v, want ErrFurnitureInstanceNotFound", err)
	}
	copied, err := create(dup)
	if err != nil {
		t.Fatalf("same-project duplicate: %v", err)
	}
	if copied.Origin != domain.FurnitureInstanceOriginDuplicate || copied.OriginFurnitureInstanceID != first.ID {
		t.Fatalf("duplicate provenance not persisted: %+v", copied)
	}
	orphanDuplicate := base
	orphanDuplicate.Origin = domain.FurnitureInstanceOriginDuplicate
	if _, err := create(orphanDuplicate); !errors.Is(err, domain.ErrInvalidFurnitureInstanceCommand) {
		t.Fatalf("duplicate without provenance err=%v, want ErrInvalidFurnitureInstanceCommand", err)
	}

	// Explicitly-shared read scope: the manufacturing organization (B) of the
	// shared project sees the identities, but creation/removal stay with the
	// owning organization (A).
	listB, err := list(fiActorB(), fiSharedProject, true)
	if err != nil {
		t.Fatalf("list as manufacturing org: %v", err)
	}
	if len(listB) != 4 {
		t.Fatalf("manufacturing org must read the shared identities, got %d", len(listB))
	}
	if err := fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, err := fx.store.CreateFurnitureInstance(ctx, base)
		return err
	}); !errors.Is(err, domain.ErrFurnitureInstanceProjectNotWritable) {
		t.Fatalf("non-owner create err=%v, want ErrFurnitureInstanceProjectNotWritable", err)
	}
	if _, err := remove(fiActorB(), storage.RemoveFurnitureInstanceCommand{
		FurnitureInstanceID: first.ID, ExpectedVersion: 1, ActorUserID: rlsUserB,
	}); !errors.Is(err, domain.ErrFurnitureInstanceProjectNotWritable) {
		t.Fatalf("non-owner remove err=%v, want ErrFurnitureInstanceProjectNotWritable", err)
	}

	// An org-A-only project's identities are fully invisible to org B even
	// for reads (no shared relationship at all).
	private, err := create(func() storage.CreateFurnitureInstanceCommand {
		cmd := base
		cmd.ProjectID = fiProjectAOnly
		return cmd
	}())
	if err != nil {
		t.Fatalf("create private: %v", err)
	}
	if instance, err := getByID(fiActorB(), private.ID); err != nil || instance != nil {
		t.Fatalf("org B read of org A private identity: (%+v, %v)", instance, err)
	}

	// Optimistic concurrency + terminal lifecycle.
	if _, err := remove(fiActorA(), storage.RemoveFurnitureInstanceCommand{
		FurnitureInstanceID: first.ID, ExpectedVersion: 7, ActorUserID: rlsUserA,
	}); !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("stale remove err=%v, want ErrVersionConflict", err)
	}
	removed, err := remove(fiActorA(), storage.RemoveFurnitureInstanceCommand{
		FurnitureInstanceID: first.ID, ExpectedVersion: 1, ActorUserID: rlsUserA,
		IP: "203.0.113.11", RequestID: "fi-test-remove-0001",
	})
	if err != nil {
		t.Fatalf("remove: %v", err)
	}
	if removed.LifecycleStatus != domain.FurnitureInstanceLifecycleRemoved || removed.Version != 2 {
		t.Fatalf("removed state: %+v", removed)
	}
	if _, err := remove(fiActorA(), storage.RemoveFurnitureInstanceCommand{
		FurnitureInstanceID: first.ID, ExpectedVersion: 2, ActorUserID: rlsUserA,
	}); !errors.Is(err, domain.ErrFurnitureInstanceLifecycleConflict) {
		t.Fatalf("re-remove err=%v, want ErrFurnitureInstanceLifecycleConflict", err)
	}

	listed, err := list(fiActorA(), fiSharedProject, true)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 4 {
		t.Fatalf("terminal list got %d, want 4", len(listed))
	}
	active, err := list(fiActorA(), fiSharedProject, false)
	if err != nil {
		t.Fatalf("list active: %v", err)
	}
	if len(active) != 3 {
		t.Fatalf("active list got %d, want 3", len(active))
	}
	for _, instance := range active {
		if instance.LifecycleStatus != domain.FurnitureInstanceLifecycleActive {
			t.Fatalf("active list leaked terminal identity: %+v", instance)
		}
	}

	// Durable audit: creation/removal events committed with the mutations.
	assertFurnitureInstanceAudit(t, fx, map[string]int{
		"furniture_instance_created": 5,
		"furniture_instance_removed": 1,
	})
}

func assertFurnitureInstanceAudit(t *testing.T, fx *rlsFixture, want map[string]int) {
	t.Helper()
	rows, err := fx.admin.Query(context.Background(), `
		SELECT event_type, details->>'furniture_instance_id', actor_user_id::text, organization_id::text
		FROM security_audit_events
		WHERE event_type IN ('furniture_instance_created', 'furniture_instance_removed')
		ORDER BY created_at, id`)
	if err != nil {
		t.Fatalf("query audit: %v", err)
	}
	defer rows.Close()
	counts := map[string]int{}
	for rows.Next() {
		var eventType, instanceID, actorID, orgID string
		if err := rows.Scan(&eventType, &instanceID, &actorID, &orgID); err != nil {
			t.Fatal(err)
		}
		counts[eventType]++
		if !isValidTestUUID(instanceID) {
			t.Fatalf("audit event %s without instance id: %q", eventType, instanceID)
		}
		if actorID != rlsUserA {
			t.Fatalf("audit actor %q, want %s", actorID, rlsUserA)
		}
		if orgID != rlsOrgA {
			t.Fatalf("audit organization %q, want %s", orgID, rlsOrgA)
		}
	}
	for eventType, wantCount := range want {
		if counts[eventType] != wantCount {
			t.Fatalf("audit %s count=%d, want %d (all=%v)", eventType, counts[eventType], wantCount, counts)
		}
	}
}

func isValidTestUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i, c := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
			continue
		}
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// TestTenantRLS_FurnitureInstancesDirectSQLCrossOrg pins the #385 negative
// proof: with the real app DB role, even a repository query that forgot the
// tenant filter cannot read or mutate another organization's identities.
func TestTenantRLS_FurnitureInstancesDirectSQLCrossOrg(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()

	seed := []string{
		`INSERT INTO projects (id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id)
		 VALUES
			('` + fiProjectB + `', 'Org B own project', '30000000-0000-0000-0000-00000000000b', 'draft',
			 '` + rlsOrgB + `', '` + rlsOrgB + `', '` + rlsOrgB + `'),
			('` + fiProjectAOnly + `', 'Org A private project', '30000000-0000-0000-0000-00000000000a', 'draft',
			 '` + rlsOrgA + `', '` + rlsOrgA + `', '` + rlsOrgA + `')`,
		`INSERT INTO furniture_instances (id, organization_id, project_id, origin, lifecycle_status)
		 VALUES ('` + fiInstanceA + `', '` + rlsOrgA + `', '` + fiSharedProject + `', 'manual', 'active')`,
		`INSERT INTO furniture_instances (id, organization_id, project_id, origin, lifecycle_status)
		 VALUES ('` + fiInstanceB + `', '` + rlsOrgB + `', '` + fiProjectB + `', 'manual', 'active')`,
		`INSERT INTO furniture_instances (id, organization_id, project_id, origin, lifecycle_status)
		 VALUES ('` + fiInstanceAOnly + `', '` + rlsOrgA + `', '` + fiProjectAOnly + `', 'manual', 'active')`,
	}
	for _, statement := range seed {
		if _, err := fx.admin.Exec(ctx, statement); err != nil {
			t.Fatalf("seed: %v\n%s", err, statement)
		}
	}

	withRLSActor(t, fx.app, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
		// Deliberately unfiltered SELECT: RLS must keep org B invisible, and
		// the org-A-only project identity must not leak either direction.
		var ids []string
		rows, err := tx.Query(ctx, `SELECT id::text FROM furniture_instances ORDER BY id`)
		if err != nil {
			t.Fatalf("unfiltered select: %v", err)
		}
		for rows.Next() {
			var id string
			_ = rows.Scan(&id)
			ids = append(ids, id)
		}
		rows.Close()
		if len(ids) != 2 || ids[0] != fiInstanceA || ids[1] != fiInstanceAOnly {
			t.Fatalf("unfiltered SELECT leaked foreign identities: %v", ids)
		}

		if tag, err := tx.Exec(ctx,
			`UPDATE furniture_instances SET lifecycle_status='removed' WHERE id=$1`, fiInstanceB,
		); err != nil || tag.RowsAffected() != 0 {
			t.Fatalf("cross-org UPDATE touched victim: rows=%d err=%v", tag.RowsAffected(), err)
		}

		// Identity is never hard-deleted through the runtime role at all.
		if _, err := tx.Exec(ctx, `DELETE FROM furniture_instances WHERE id=$1`, fiInstanceB); err == nil {
			t.Fatal("app role must not hold DELETE on furniture_instances")
		}

		// Attaching an identity to a foreign-org project fails the WITH CHECK.
		if _, err := tx.Exec(ctx, `
			INSERT INTO furniture_instances (organization_id, project_id, origin)
			VALUES ($1, $2, 'manual')`, rlsOrgA, fiProjectB); err == nil {
			t.Fatal("insert into foreign-org project must fail RLS WITH CHECK")
		}
		// Mis-owning a row inside a visible shared project fails too: the
		// organization must match the project owner.
		if _, err := tx.Exec(ctx, `
			INSERT INTO furniture_instances (organization_id, project_id, origin)
			VALUES ($1, $2, 'manual')`, rlsOrgB, fiSharedProject); err == nil {
			t.Fatal("insert with wrong owning organization must fail RLS WITH CHECK")
		}

		// The project/organization ownership columns are immutable through
		// plain UPDATE even for the owning organization itself.
		if _, err := tx.Exec(ctx,
			`UPDATE furniture_instances SET project_id=$1 WHERE id=$2`, fiProjectB, fiInstanceA,
		); err == nil {
			t.Fatal("project_id reassignment must be blocked by the ownership trigger")
		}
		if _, err := tx.Exec(ctx,
			`UPDATE furniture_instances SET organization_id=$1 WHERE id=$2`, rlsOrgB, fiInstanceA,
		); err == nil {
			t.Fatal("organization_id reassignment must be blocked by the ownership trigger")
		}
	})

	var status string
	var version int64
	if err := fx.admin.QueryRow(ctx,
		`SELECT lifecycle_status, version FROM furniture_instances WHERE id=$1`, fiInstanceB,
	).Scan(&status, &version); err != nil {
		t.Fatal(err)
	}
	if status != "active" || version != 1 {
		t.Fatalf("victim identity mutated through RLS: status=%s version=%d", status, version)
	}
}

// TestFurnitureInstancesHTTP_Postgres exercises the generated-contract HTTP
// surface against real PostgreSQL under the app role: retry-safe creation,
// random-project rejection, stale-version conflict and terminal removal.
func TestFurnitureInstancesHTTP_Postgres(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()

	const secret = "furniture-instances-http-test-secret-minimum"
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

	request := func(method, path, key, ifMatch, body string) *httptest.ResponseRecorder {
		t.Helper()
		var reader *bytes.Reader
		if body == "" {
			reader = bytes.NewReader(nil)
		} else {
			reader = bytes.NewReader([]byte(body))
		}
		req := httptest.NewRequest(method, path, reader)
		req.Header.Set("Authorization", "Bearer "+token)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if key != "" {
			req.Header.Set("Idempotency-Key", key)
		}
		if ifMatch != "" {
			req.Header.Set("If-Match", ifMatch)
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		return recorder
	}

	body := `{"furniture_definition_id":"` + fiModuleA + `"}`

	// Retry-safe creation: the same Idempotency-Key replays the SAME identity
	// instead of creating a second one.
	first := request(http.MethodPost, "/api/projects/"+fiSharedProject+"/furniture-instances",
		"dt1-retry-key-000000001", "", body)
	if first.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", first.Code, first.Body.String())
	}
	var created struct {
		ID             string `json:"id"`
		ProjectID      string `json:"project_id"`
		Origin         string `json:"origin"`
		Lifecycle      string `json:"lifecycle_status"`
		Version        int64  `json:"version"`
		FurnitureDefID string `json:"furniture_definition_id"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Origin != "manual" || created.Lifecycle != "active" || created.Version != 1 || created.FurnitureDefID != fiModuleA {
		t.Fatalf("created DTO: %+v", created)
	}

	retry := request(http.MethodPost, "/api/projects/"+fiSharedProject+"/furniture-instances",
		"dt1-retry-key-000000001", "", body)
	if retry.Code != http.StatusCreated {
		t.Fatalf("retry status=%d body=%s", retry.Code, retry.Body.String())
	}
	if retry.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatalf("retry must be marked replayed, headers=%v", retry.Header())
	}
	var replayed struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(retry.Body.Bytes(), &replayed); err != nil {
		t.Fatal(err)
	}
	if replayed.ID != created.ID {
		t.Fatalf("retry created a second identity: %q vs %q", replayed.ID, created.ID)
	}
	var count int
	if err := fx.admin.QueryRow(ctx,
		`SELECT count(*) FROM furniture_instances WHERE project_id=$1`, fiSharedProject,
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("retry produced %d identities, want exactly 1", count)
	}

	// A different key is a different command → a second identity.
	second := request(http.MethodPost, "/api/projects/"+fiSharedProject+"/furniture-instances",
		"dt1-retry-key-000000002", "", body)
	if second.Code != http.StatusCreated {
		t.Fatalf("second create status=%d body=%s", second.Code, second.Body.String())
	}
	var secondInstance struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &secondInstance); err != nil {
		t.Fatal(err)
	}
	if secondInstance.ID == created.ID {
		t.Fatal("two units must keep distinct identities")
	}

	list := request(http.MethodGet, "/api/projects/"+fiSharedProject+"/furniture-instances", "", "", "")
	if list.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", list.Code, list.Body.String())
	}
	var instances []map[string]any
	if err := json.Unmarshal(list.Body.Bytes(), &instances); err != nil {
		t.Fatal(err)
	}
	if len(instances) != 2 {
		t.Fatalf("list got %d instances, want 2", len(instances))
	}

	// A random project UUID (even a well-formed one from another org) cannot
	// attach an identity: it is invisible under the caller's tenant scope.
	random := request(http.MethodPost, "/api/projects/4ffffff1-0000-0000-0000-0000000000f1/furniture-instances",
		"dt1-retry-key-000000003", "", body)
	if random.Code != http.StatusNotFound {
		t.Fatalf("random project status=%d body=%s", random.Code, random.Body.String())
	}

	// Stale If-Match → typed VERSION_CONFLICT; correct version → removed.
	stale := request(http.MethodPost, "/api/furniture-instances/"+created.ID+":remove",
		"dt1-remove-key-00000001", `"v99"`, "")
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale remove status=%d body=%s", stale.Code, stale.Body.String())
	}
	if !strings.Contains(stale.Body.String(), "VERSION_CONFLICT") {
		t.Fatalf("stale remove must return the typed code, got %s", stale.Body.String())
	}
	removed := request(http.MethodPost, "/api/furniture-instances/"+created.ID+":remove",
		"dt1-remove-key-00000002", `"v1"`, "")
	if removed.Code != http.StatusOK {
		t.Fatalf("remove status=%d body=%s", removed.Code, removed.Body.String())
	}
	var removedDTO struct {
		Lifecycle string `json:"lifecycle_status"`
		Version   int64  `json:"version"`
	}
	if err := json.Unmarshal(removed.Body.Bytes(), &removedDTO); err != nil {
		t.Fatal(err)
	}
	if removedDTO.Lifecycle != "removed" || removedDTO.Version != 2 {
		t.Fatalf("removed DTO: %+v", removedDTO)
	}
	replayRemove := request(http.MethodPost, "/api/furniture-instances/"+created.ID+":remove",
		"dt1-remove-key-00000002", `"v1"`, "")
	if replayRemove.Code != http.StatusOK || replayRemove.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatalf("remove retry status=%d replayed=%q body=%s",
			replayRemove.Code, replayRemove.Header().Get("Idempotency-Replayed"), replayRemove.Body.String())
	}
	var lifecycle string
	if err := fx.admin.QueryRow(ctx,
		`SELECT lifecycle_status FROM furniture_instances WHERE id=$1`, created.ID,
	).Scan(&lifecycle); err != nil {
		t.Fatal(err)
	}
	if lifecycle != "removed" {
		t.Fatalf("lifecycle after replayed remove: %s", lifecycle)
	}

	assertFurnitureInstanceAudit(t, fx, map[string]int{
		"furniture_instance_created": 2,
		"furniture_instance_removed": 1,
	})
}

// TestFurnitureInstances_ListSummariesDisplay (#389 / DT-5): the summary list
// composes the server-side presentation block — catalog label from modules,
// dimensions preferring the CURRENT quote-line custom_dims over module
// defaults — while identity rows stay verbatim. Presentation never leaks
// across the tenant boundary: a foreign org still sees nothing.
func TestFurnitureInstances_ListSummariesDisplay(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()

	const moduleWithDims = "50000000-0000-0000-0000-000000000002"
	const quotedLine = "60000000-0000-0000-0000-000000000002"
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO modules (id, code, name, width_mm, height_mm, depth_mm, organization_id)
		VALUES ('`+moduleWithDims+`', 'BASE-600', 'Gabinete Base 600', 600, 720, 560, '`+rlsOrgA+`')`); err != nil {
		t.Fatal(err)
	}

	create := func(cmd storage.CreateFurnitureInstanceCommand) (*domain.FurnitureInstance, error) {
		var instance *domain.FurnitureInstance
		err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
			var txErr error
			instance, txErr = fx.store.CreateFurnitureInstance(ctx, cmd)
			return txErr
		})
		return instance, err
	}
	base := storage.CreateFurnitureInstanceCommand{
		ProjectID:   fiSharedProject,
		Origin:      domain.FurnitureInstanceOriginQuote,
		ActorUserID: rlsUserA,
	}

	// Quoted unit: linked to a quote line whose custom_dims win over the
	// module defaults (quoted 650 vs module 600).
	quoted, err := create(func() storage.CreateFurnitureInstanceCommand {
		cmd := base
		cmd.FurnitureDefinitionID = moduleWithDims
		return cmd
	}())
	if err != nil {
		t.Fatalf("create quoted: %v", err)
	}
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO project_items (id, project_id, module_id, quantity, custom_dims, organization_id)
		VALUES ('`+quotedLine+`', '`+fiSharedProject+`', '`+moduleWithDims+`', 1,
			'{"widthMm":650,"heightMm":720,"depthMm":560}'::jsonb, '`+rlsOrgA+`')`); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO quote_line_furniture_instances (organization_id, project_id, quote_line_id, furniture_instance_id, state)
		VALUES ('`+rlsOrgA+`', '`+fiSharedProject+`', '`+quotedLine+`', '`+quoted.ID+`', 'current')`); err != nil {
		t.Fatal(err)
	}

	// Unlinked unit on the same module: falls back to module default dims.
	unlinked, err := create(func() storage.CreateFurnitureInstanceCommand {
		cmd := base
		cmd.FurnitureDefinitionID = moduleWithDims
		return cmd
	}())
	if err != nil {
		t.Fatalf("create unlinked: %v", err)
	}

	// Definition-less unit: no presentation at all.
	bare, err := create(base)
	if err != nil {
		t.Fatalf("create bare: %v", err)
	}

	summaries := func(actor storage.TenantActor) []storage.FurnitureInstanceSummary {
		t.Helper()
		var out []storage.FurnitureInstanceSummary
		if err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
			var txErr error
			out, txErr = fx.store.ListFurnitureInstanceSummariesByProject(ctx, fiSharedProject, false)
			return txErr
		}); err != nil {
			t.Fatalf("list summaries: %v", err)
		}
		return out
	}

	byID := func(rows []storage.FurnitureInstanceSummary) map[string]storage.FurnitureInstanceSummary {
		t.Helper()
		index := map[string]storage.FurnitureInstanceSummary{}
		for _, row := range rows {
			index[row.Instance.ID] = row
		}
		return index
	}

	got := byID(summaries(fiActorA()))
	if len(got) != 3 {
		t.Fatalf("summary rows = %d, want 3 (%+v)", len(got), got)
	}
	if row := got[quoted.ID]; row.DisplayName != "Gabinete Base 600" ||
		row.DisplayDims == nil || row.DisplayDims.WidthMm != 650 || row.DisplayDims.HeightMm != 720 || row.DisplayDims.DepthMm != 560 {
		t.Fatalf("quoted summary = %+v, want quoted custom dims (650×720×560) to win", row)
	}
	if row := got[unlinked.ID]; row.DisplayName != "Gabinete Base 600" ||
		row.DisplayDims == nil || row.DisplayDims.WidthMm != 600 {
		t.Fatalf("unlinked summary = %+v, want module default dims", row)
	}
	if row := got[bare.ID]; row.DisplayName != "" || row.DisplayDims != nil {
		t.Fatalf("bare summary = %+v, want no invented presentation", row)
	}
}

// TestFurnitureInstances_Duplicate (#391 / DT-7): copies an existing project
// furniture instance within the same project. The new row receives origin='duplicate'
// and origin_furniture_instance_id referencing the source instance, inheriting
// its catalog definition provenance. Terminal sources and cross-project sources
// are rejected.
func TestFurnitureInstances_Duplicate(t *testing.T) {
	fx := newRLSFixture(t)

	// Create a source instance in fiSharedProject owned by org A
	var source *domain.FurnitureInstance
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var txErr error
		source, txErr = fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginDesign,
			ActorUserID:           rlsUserA,
		})
		return txErr
	}); err != nil {
		t.Fatalf("create source: %v", err)
	}

	// 1. Happy path: duplicate within same project
	var dup *domain.FurnitureInstance
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var txErr error
		dup, txErr = fx.store.DuplicateFurnitureInstance(ctx, storage.DuplicateFurnitureInstanceCommand{
			ProjectID:                 fiSharedProject,
			SourceFurnitureInstanceID: source.ID,
			ActorUserID:               rlsUserA,
		})
		return txErr
	}); err != nil {
		t.Fatalf("duplicate source: %v", err)
	}

	if dup.ID == source.ID {
		t.Fatalf("duplicated instance must receive a distinct ID, got %s", dup.ID)
	}
	if dup.ProjectID != fiSharedProject {
		t.Fatalf("project_id = %s, want %s", dup.ProjectID, fiSharedProject)
	}
	if dup.Origin != domain.FurnitureInstanceOriginDuplicate {
		t.Fatalf("origin = %s, want duplicate", dup.Origin)
	}
	if dup.OriginFurnitureInstanceID != source.ID {
		t.Fatalf("origin_furniture_instance_id = %s, want %s", dup.OriginFurnitureInstanceID, source.ID)
	}
	if dup.FurnitureDefinitionID != fiModuleA {
		t.Fatalf("definition = %s, want %s", dup.FurnitureDefinitionID, fiModuleA)
	}
	if dup.LifecycleStatus != domain.FurnitureInstanceLifecycleActive {
		t.Fatalf("status = %s, want active", dup.LifecycleStatus)
	}

	// 2. Cross-project duplicate attempt: fiSharedProject source cannot be duplicated into fiProjectB
	if err := fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, txErr := fx.store.DuplicateFurnitureInstance(ctx, storage.DuplicateFurnitureInstanceCommand{
			ProjectID:                 fiProjectB,
			SourceFurnitureInstanceID: source.ID,
			ActorUserID:               rlsUserB,
		})
		return txErr
	}); !errors.Is(err, storage.ErrFurnitureInstanceNotFound) {
		t.Fatalf("cross-project duplicate err = %v, want ErrFurnitureInstanceNotFound", err)
	}

	// 3. Terminal source rejection: remove source, then attempt duplicate
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, txErr := fx.store.RemoveFurnitureInstance(ctx, storage.RemoveFurnitureInstanceCommand{
			FurnitureInstanceID: source.ID,
			ExpectedVersion:     source.Version,
			ActorUserID:         rlsUserA,
		})
		return txErr
	}); err != nil {
		t.Fatalf("remove source: %v", err)
	}

	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, txErr := fx.store.DuplicateFurnitureInstance(ctx, storage.DuplicateFurnitureInstanceCommand{
			ProjectID:                 fiSharedProject,
			SourceFurnitureInstanceID: source.ID,
			ActorUserID:               rlsUserA,
		})
		return txErr
	}); !errors.Is(err, domain.ErrFurnitureInstanceLifecycleConflict) {
		t.Fatalf("duplicate terminal source err = %v, want ErrFurnitureInstanceLifecycleConflict", err)
	}
}
