package storage_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const (
	commandAdminUser        = "f1000000-0000-0000-0000-000000000001"
	commandAdminMembership  = "f2000000-0000-0000-0000-000000000001"
	commandReplacementUser  = "f1000000-0000-0000-0000-000000000002"
	commandReplacement      = "f2000000-0000-0000-0000-000000000002"
	transferCommandOrgID    = "f3000000-0000-0000-0000-000000000001"
	sectorCommandOrgID      = "f4000000-0000-0000-0000-000000000001"
	sectorCommandOrgAMember = "f2000000-0000-0000-0000-000000000003"
	offboardCommandOrgID    = "f5000000-0000-0000-0000-000000000001"
)

type transferAdminRuntimeFixture struct {
	store         *storage.PostgresStore
	migrationPool *pgxpool.Pool
	organization  string
	actor         storage.TenantActor
}

// transferAdminRuntimeSetup keeps migration/bootstrap authority out of the
// runtime team-command proof.
func transferAdminRuntimeSetup(t *testing.T) transferAdminRuntimeFixture {
	t.Helper()
	ctx := context.Background()
	migrationPool := multiOrgFreshMigrationDB(t)
	migrationStore := &storage.PostgresStore{Pool: migrationPool}
	if err := migrationStore.RunMigrations(ctx); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations (id, name, slug, status) VALUES ($1, 'Transfer Team', 'transfer-team', 'provisioning')`, []any{transferCommandOrgID}},
		{`INSERT INTO users (id,email,normalized_email,password_hash,name,account_status) VALUES
			($1,'command-admin@example.test','command-admin@example.test','x','Command Admin','active'),
			($2,'command-replacement@example.test','command-replacement@example.test','x','Command Replacement','active')`, []any{commandAdminUser, commandReplacementUser}},
		{`INSERT INTO memberships (id,organization_id,user_id,roles,status,joined_at) VALUES
			($1,$2,$3,'{admin,gerente_ventas}','active',NOW()),
			($4,$2,$5,'{ingeniero}','active',NOW())`, []any{commandAdminMembership, transferCommandOrgID, commandAdminUser, commandReplacement, commandReplacementUser}},
		{`UPDATE organizations SET status='active', status_reason=NULL WHERE id=$1`, []any{transferCommandOrgID}},
	} {
		if _, err := migrationPool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed transfer command fixture: %v", err)
		}
	}
	runtimePool, err := pgxpool.New(ctx, storage.TestDatabaseURLForDB(t, migrationPool.Config().ConnConfig.Database))
	if err != nil {
		t.Fatalf("open runtime pool: %v", err)
	}
	t.Cleanup(runtimePool.Close)
	return transferAdminRuntimeFixture{
		store:         &storage.PostgresStore{Pool: runtimePool},
		migrationPool: migrationPool,
		organization:  transferCommandOrgID,
		actor: storage.TenantActor{
			OrganizationID: transferCommandOrgID,
			UserID:         commandAdminUser,
			MembershipID:   commandAdminMembership,
		},
	}
}

func transferAdminRuntimeRead(t *testing.T, fixture transferAdminRuntimeFixture, run func(pgx.Tx) error) {
	t.Helper()
	if err := runConnectStoreSQL(t, fixture.store.Pool, fixture.actor, run); err != nil {
		t.Fatal(err)
	}
}

func installRejectTransferAuditTrigger(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION reject_transfer_command_audit() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.event_type = 'organization_admin_transferred' THEN
				RAISE EXCEPTION 'required audit unavailable';
			END IF;
			RETURN NEW;
		END $$;
		CREATE TRIGGER reject_transfer_command_audit BEFORE INSERT ON security_audit_events
		FOR EACH ROW EXECUTE FUNCTION reject_transfer_command_audit()`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DROP TRIGGER IF EXISTS reject_transfer_command_audit ON security_audit_events; DROP FUNCTION IF EXISTS reject_transfer_command_audit()`)
	})
}

type sectorCommandRuntimeFixture struct {
	store         *storage.PostgresStore
	migrationPool *pgxpool.Pool
	orgA          string
	organization  string
	actorA        storage.TenantActor
	actor         storage.TenantActor
}

// sectorCommandRuntimeSetup keeps sector/role runtime coverage independent
// from the transfer fixture.
func sectorCommandRuntimeSetup(t *testing.T) sectorCommandRuntimeFixture {
	t.Helper()
	ctx := context.Background()
	migrationPool := multiOrgFreshMigrationDB(t)
	migrationStore := &storage.PostgresStore{Pool: migrationPool}
	if err := migrationStore.RunMigrations(ctx); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations (id, name, slug, status) VALUES ($1, 'Sector Team', 'sector-team', 'provisioning')`, []any{sectorCommandOrgID}},
		{`INSERT INTO users (id,email,normalized_email,password_hash,name,account_status) VALUES
			($1,'command-admin@example.test','command-admin@example.test','x','Command Admin','active'),
			($2,'command-replacement@example.test','command-replacement@example.test','x','Command Replacement','active')`, []any{commandAdminUser, commandReplacementUser}},
		{`INSERT INTO memberships (id,organization_id,user_id,roles,status,joined_at) VALUES
			($1,$2,$3,'{admin,gerente_ventas}','active',NOW()),
			($4,$5,$3,'{admin,gerente_ventas}','active',NOW()),
			($6,$5,$7,'{ingeniero}','active',NOW())`, []any{sectorCommandOrgAMember, multiOrgInitialOrgID, commandAdminUser, commandAdminMembership, sectorCommandOrgID, commandReplacement, commandReplacementUser}},
		{`UPDATE organizations SET status='active', status_reason=NULL WHERE id IN ($1, $2)`, []any{multiOrgInitialOrgID, sectorCommandOrgID}},
	} {
		if _, err := migrationPool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed sector command fixture: %v", err)
		}
	}
	runtimePool, err := pgxpool.New(ctx, storage.TestDatabaseURLForDB(t, migrationPool.Config().ConnConfig.Database))
	if err != nil {
		t.Fatalf("open runtime pool: %v", err)
	}
	t.Cleanup(runtimePool.Close)
	return sectorCommandRuntimeFixture{
		store:         &storage.PostgresStore{Pool: runtimePool},
		migrationPool: migrationPool,
		orgA:          multiOrgInitialOrgID,
		organization:  sectorCommandOrgID,
		actorA: storage.TenantActor{
			OrganizationID: multiOrgInitialOrgID, UserID: commandAdminUser, MembershipID: sectorCommandOrgAMember,
		},
		actor: storage.TenantActor{
			OrganizationID: sectorCommandOrgID, UserID: commandAdminUser, MembershipID: commandAdminMembership,
		},
	}
}

func sectorCommandContext(fixture sectorCommandRuntimeFixture) context.Context {
	return storage.WithTenantActorCtx(scoped(context.Background(), fixture.organization), fixture.actor)
}

func sectorCommandRuntimeRead(t *testing.T, fixture sectorCommandRuntimeFixture, run func(pgx.Tx) error) {
	t.Helper()
	if err := runConnectStoreSQL(t, fixture.store.Pool, fixture.actor, run); err != nil {
		t.Fatal(err)
	}
}

func installRejectSectorAuditTrigger(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION reject_sector_command_audit() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.event_type = 'membership_sectors_changed' THEN
				RAISE EXCEPTION 'required audit unavailable';
			END IF;
			RETURN NEW;
		END $$;
		CREATE TRIGGER reject_sector_command_audit BEFORE INSERT ON security_audit_events
		FOR EACH ROW EXECUTE FUNCTION reject_sector_command_audit()`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DROP TRIGGER IF EXISTS reject_sector_command_audit ON security_audit_events; DROP FUNCTION IF EXISTS reject_sector_command_audit()`)
	})
}

type offboardCommandRuntimeFixture struct {
	store         *storage.PostgresStore
	migrationPool *pgxpool.Pool
	organization  string
	actor         storage.TenantActor
}

// offboardCommandRuntimeSetup provides only the historical work inventory
// needed by OffboardMember; it does not alter legacy isolation helpers.
func offboardCommandRuntimeSetup(t *testing.T) offboardCommandRuntimeFixture {
	t.Helper()
	ctx := context.Background()
	migrationPool := multiOrgFreshMigrationDB(t)
	migrationStore := &storage.PostgresStore{Pool: migrationPool}
	if err := migrationStore.RunMigrations(ctx); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations (id, name, slug, status) VALUES ($1, 'Offboard Team', 'offboard-team', 'provisioning')`, []any{offboardCommandOrgID}},
		{`INSERT INTO users (id,email,normalized_email,password_hash,name,account_status) VALUES
			($1,'command-admin@example.test','command-admin@example.test','x','Command Admin','active'),
			($2,'command-replacement@example.test','command-replacement@example.test','x','Command Replacement','active'),
			($3,'offboarding-target@example.test','offboarding-target@example.test','x','Target','active')`, []any{commandAdminUser, commandReplacementUser, offboardingTargetUser}},
		{`INSERT INTO memberships (id,organization_id,user_id,roles,status,joined_at) VALUES
			($1,$2,$3,'{admin,gerente_ventas}','active',NOW()),
			($4,$2,$5,'{ingeniero}','active',NOW()),
			($6,$2,$7,'{vendedor}','active',NOW())`, []any{commandAdminMembership, offboardCommandOrgID, commandAdminUser, commandReplacement, commandReplacementUser, offboardingTargetMembership, offboardingTargetUser}},
		{`UPDATE organizations SET status='active', status_reason=NULL WHERE id=$1`, []any{offboardCommandOrgID}},
		{`INSERT INTO customers (id, name, owner_user_id, organization_id) VALUES ('e3000000-0000-0000-0000-000000000001', 'Owned customer', $1, $2)`, []any{offboardingTargetUser, offboardCommandOrgID}},
		{`INSERT INTO projects (id, name, customer_id, owner_user_id, assigned_engineer_id, status, organization_id, sales_organization_id, manufacturing_organization_id) VALUES ('e4000000-0000-0000-0000-000000000001', 'Owned project', 'e3000000-0000-0000-0000-000000000001', $1, $1, 'draft', $2, $2, $2)`, []any{offboardingTargetUser, offboardCommandOrgID}},
		{`INSERT INTO warranty_tickets (id, ticket_number, project_id, customer_id, title, assigned_technician_id, status, organization_id) VALUES
			('e5000000-0000-0000-0000-000000000001', 'W-OPEN', 'e4000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'Open', $1, 'open', $2),
			('e5000000-0000-0000-0000-000000000002', 'W-DONE', 'e4000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'Done', $1, 'resolved', $2)`, []any{offboardingTargetUser, offboardCommandOrgID}},
		{`INSERT INTO production_activities (id, project_id, project_name, item_id, sector, type, operator_id, organization_id) VALUES ('claim-active', 'e4000000-0000-0000-0000-000000000001', 'Owned project', 'item-1', 'cutting', 'claim', $1, $2)`, []any{offboardingTargetUser, offboardCommandOrgID}},
		{`INSERT INTO production_activities (id, project_id, project_name, item_id, sector, type, operator_id, finished_at, organization_id) VALUES ('claim-finished', 'e4000000-0000-0000-0000-000000000001', 'Owned project', 'item-2', 'cutting', 'claim', $1, NOW(), $2)`, []any{offboardingTargetUser, offboardCommandOrgID}},
	} {
		if _, err := migrationPool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed offboard command fixture: %v", err)
		}
	}
	runtimePool, err := pgxpool.New(ctx, storage.TestDatabaseURLForDB(t, migrationPool.Config().ConnConfig.Database))
	if err != nil {
		t.Fatalf("open runtime pool: %v", err)
	}
	t.Cleanup(runtimePool.Close)
	return offboardCommandRuntimeFixture{
		store:         &storage.PostgresStore{Pool: runtimePool},
		migrationPool: migrationPool,
		organization:  offboardCommandOrgID,
		actor: storage.TenantActor{
			OrganizationID: offboardCommandOrgID, UserID: commandAdminUser, MembershipID: commandAdminMembership,
		},
	}
}

func offboardCommandContext(fixture offboardCommandRuntimeFixture) context.Context {
	return storage.WithTenantActorCtx(scoped(context.Background(), fixture.organization), fixture.actor)
}

func offboardCommandRuntimeRead(t *testing.T, fixture offboardCommandRuntimeFixture, run func(pgx.Tx) error) {
	t.Helper()
	if err := runConnectStoreSQL(t, fixture.store.Pool, fixture.actor, run); err != nil {
		t.Fatal(err)
	}
}

func installRejectOffboardAuditTrigger(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION reject_offboard_command_audit() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.event_type = 'membership_offboarded' THEN
				RAISE EXCEPTION 'required audit unavailable';
			END IF;
			RETURN NEW;
		END $$;
		CREATE TRIGGER reject_offboard_command_audit BEFORE INSERT ON security_audit_events
		FOR EACH ROW EXECUTE FUNCTION reject_offboard_command_audit()`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DROP TRIGGER IF EXISTS reject_offboard_command_audit ON security_audit_events; DROP FUNCTION IF EXISTS reject_offboard_command_audit()`)
	})
}

func seedCommandAdministrators(t *testing.T, store *storage.PostgresStore, organizationID string) {
	t.Helper()
	ctx := context.Background()
	tx, err := store.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id,email,normalized_email,password_hash,name,account_status) VALUES ($1,'command-admin@example.test','command-admin@example.test','x','Command Admin','active')`, []any{commandAdminUser}},
		{`INSERT INTO users (id,email,normalized_email,password_hash,name,account_status) VALUES ($1,'command-replacement@example.test','command-replacement@example.test','x','Command Replacement','active')`, []any{commandReplacementUser}},
		{`INSERT INTO memberships (id,organization_id,user_id,roles,status,joined_at) VALUES ($1,$2,$3,'{admin,gerente_ventas}','active',NOW())`, []any{commandAdminMembership, organizationID, commandAdminUser}},
		{`INSERT INTO memberships (id,organization_id,user_id,roles,status,joined_at) VALUES ($1,$2,$3,'{ingeniero}','active',NOW())`, []any{commandReplacement, organizationID, commandReplacementUser}},
		{`UPDATE organizations SET status='active', status_reason=NULL WHERE id=$1`, []any{organizationID}},
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement.query, statement.args...); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestTransferOrganizationAdmin_IsAtomicVersionedAndAudited(t *testing.T) {
	fixture := transferAdminRuntimeSetup(t)
	store, orgID := fixture.store, fixture.organization
	ctx := storage.WithTenantActorCtx(scoped(context.Background(), orgID), fixture.actor)

	result, err := store.TransferOrganizationAdmin(ctx, storage.TransferOrganizationAdminCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser,
		SourceMembershipID: commandAdminMembership, TargetMembershipID: commandReplacement,
		ExpectedSourceVersion: 1, ExpectedTargetVersion: 1, DemoteSource: true,
		Reason: "planned transfer", RequestID: "request-transfer-1",
	})
	if err != nil {
		t.Fatalf("TransferOrganizationAdmin: %v", err)
	}
	if result.Source.Version != 2 || result.Target.Version != 2 || containsTestRole(result.Source.Roles, domain.RoleAdmin) || !containsTestRole(result.Target.Roles, domain.RoleAdmin) {
		t.Fatalf("unexpected transfer result: %#v", result)
	}
	var admins, audits int
	transferAdminRuntimeRead(t, fixture, func(tx pgx.Tx) error {
		if err := tx.QueryRow(context.Background(), `SELECT active_admin_count FROM organization_team_state WHERE organization_id=$1`, orgID).Scan(&admins); err != nil {
			return err
		}
		return tx.QueryRow(context.Background(), `SELECT count(*) FROM security_audit_events WHERE organization_id=$1 AND event_type='organization_admin_transferred' AND details->>'request_id'='request-transfer-1'`, orgID).Scan(&audits)
	})
	if admins != 1 || audits != 1 {
		t.Fatalf("admin count=%d audit count=%d", admins, audits)
	}

	_, err = store.TransferOrganizationAdmin(ctx, storage.TransferOrganizationAdminCommand{
		OrganizationID: orgID, ActorUserID: commandReplacementUser,
		SourceMembershipID: commandReplacement, TargetMembershipID: commandAdminMembership,
		ExpectedSourceVersion: 1, ExpectedTargetVersion: 1, DemoteSource: true,
	})
	if !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("stale transfer error=%v", err)
	}
}

func TestTransferOrganizationAdmin_ConcurrentReplayHasSingleWinner(t *testing.T) {
	fixture := transferAdminRuntimeSetup(t)
	store, orgID := fixture.store, fixture.organization
	ctx := storage.WithTenantActorCtx(scoped(context.Background(), orgID), fixture.actor)
	command := storage.TransferOrganizationAdminCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser,
		SourceMembershipID: commandAdminMembership, TargetMembershipID: commandReplacement,
		ExpectedSourceVersion: 1, ExpectedTargetVersion: 1, DemoteSource: true, Reason: "race",
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	var ready sync.WaitGroup
	ready.Add(2)
	for range 2 {
		go func() {
			ready.Done()
			<-start
			_, err := store.TransferOrganizationAdmin(ctx, command)
			results <- err
		}()
	}
	ready.Wait()
	close(start)
	successes, conflicts := 0, 0
	for range 2 {
		err := <-results
		switch {
		case err == nil:
			successes++
		case errors.Is(err, storage.ErrVersionConflict):
			conflicts++
		default:
			t.Fatalf("unexpected concurrent result: %v", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("successes=%d conflicts=%d", successes, conflicts)
	}
}

func TestTransferOrganizationAdmin_AuditFailureRollsBackBothMemberships(t *testing.T) {
	fixture := transferAdminRuntimeSetup(t)
	store, orgID := fixture.store, fixture.organization
	installRejectTransferAuditTrigger(t, fixture.migrationPool)
	_, err := store.TransferOrganizationAdmin(storage.WithTenantActorCtx(scoped(context.Background(), orgID), fixture.actor), storage.TransferOrganizationAdminCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser,
		SourceMembershipID: commandAdminMembership, TargetMembershipID: commandReplacement,
		ExpectedSourceVersion: 1, ExpectedTargetVersion: 1, DemoteSource: true, Reason: "rollback",
	})
	if err == nil {
		t.Fatal("expected required audit failure")
	}
	var sourceRoles, targetRoles []domain.UserRole
	var sourceVersion, targetVersion int64
	transferAdminRuntimeRead(t, fixture, func(tx pgx.Tx) error {
		if err := tx.QueryRow(context.Background(), `SELECT roles,version FROM memberships WHERE id=$1`, commandAdminMembership).Scan(&sourceRoles, &sourceVersion); err != nil {
			return err
		}
		return tx.QueryRow(context.Background(), `SELECT roles,version FROM memberships WHERE id=$1`, commandReplacement).Scan(&targetRoles, &targetVersion)
	})
	if !containsTestRole(sourceRoles, domain.RoleAdmin) || containsTestRole(targetRoles, domain.RoleAdmin) || sourceVersion != 1 || targetVersion != 1 {
		t.Fatalf("audit failure leaked transfer source=%v/%d target=%v/%d", sourceRoles, sourceVersion, targetRoles, targetVersion)
	}
}

func TestChangeMembershipSectors_ValidatesLiveRolesTypeVersionAndScope(t *testing.T) {
	fixture := sectorCommandRuntimeSetup(t)
	store, orgA, orgID := fixture.store, fixture.orgA, fixture.organization
	ctx := context.Background()
	if _, err := fixture.migrationPool.Exec(ctx, `UPDATE memberships SET roles='{produccion}' WHERE id=$1`, commandReplacement); err != nil {
		t.Fatal(err)
	}

	result, err := store.ChangeMembershipSectors(sectorCommandContext(fixture), storage.ChangeMembershipSectorsCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: commandReplacement,
		ExpectedMembershipVersion: 1, Sectors: []domain.ProductionSector{domain.SectorCutting, domain.SectorAssembly, domain.SectorCutting},
		Reason: "floor assignment", RequestID: "request-sector-1",
	})
	if err != nil {
		t.Fatalf("ChangeMembershipSectors: %v", err)
	}
	if result.Member.Version != 2 || len(result.Sectors) != 2 {
		t.Fatalf("unexpected sector result: %#v", result)
	}

	_, err = store.ChangeMembershipSectors(sectorCommandContext(fixture), storage.ChangeMembershipSectorsCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: commandReplacement,
		ExpectedMembershipVersion: 1, Sectors: []domain.ProductionSector{domain.SectorShipping},
	})
	if !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("stale sector error=%v", err)
	}
	_, err = store.ChangeMembershipSectors(storage.WithTenantActorCtx(scoped(ctx, orgA), fixture.actorA), storage.ChangeMembershipSectorsCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: commandReplacement,
		ExpectedMembershipVersion: 2, Sectors: []domain.ProductionSector{domain.SectorShipping},
	})
	if !errors.Is(err, storage.ErrMembershipNotFound) {
		t.Fatalf("cross-tenant sector error=%v", err)
	}
	result, err = store.ChangeMembershipSectors(sectorCommandContext(fixture), storage.ChangeMembershipSectorsCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: commandReplacement,
		ExpectedMembershipVersion: 2, Sectors: []domain.ProductionSector{}, Reason: "clear before type change",
	})
	if err != nil || result.Member.Version != 3 {
		t.Fatalf("clear sectors before type change result=%#v err=%v", result, err)
	}
	if _, err := fixture.migrationPool.Exec(ctx, `UPDATE organizations SET type='store' WHERE id=$1`, orgID); err != nil {
		t.Fatal(err)
	}
	_, err = store.ChangeMembershipSectors(sectorCommandContext(fixture), storage.ChangeMembershipSectorsCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: commandReplacement,
		ExpectedMembershipVersion: 3, Sectors: []domain.ProductionSector{domain.SectorShipping},
	})
	if !errors.Is(err, storage.ErrSectorAssignmentInvalid) {
		t.Fatalf("store sector error=%v", err)
	}
}

func TestChangeMembershipSectors_AuditFailureRollsBack(t *testing.T) {
	fixture := sectorCommandRuntimeSetup(t)
	store, orgID := fixture.store, fixture.organization
	ctx := context.Background()
	if _, err := fixture.migrationPool.Exec(ctx, `UPDATE memberships SET roles='{produccion}' WHERE id=$1`, commandReplacement); err != nil {
		t.Fatal(err)
	}
	installRejectSectorAuditTrigger(t, fixture.migrationPool)

	_, err := store.ChangeMembershipSectors(sectorCommandContext(fixture), storage.ChangeMembershipSectorsCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: commandReplacement,
		ExpectedMembershipVersion: 1, Sectors: []domain.ProductionSector{domain.SectorCutting},
	})
	if err == nil {
		t.Fatal("expected required audit failure")
	}
	var sectors int
	var version int64
	sectorCommandRuntimeRead(t, fixture, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM membership_sectors WHERE membership_id=$1`, commandReplacement).Scan(&sectors); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT version FROM memberships WHERE id=$1`, commandReplacement).Scan(&version)
	})
	if sectors != 0 || version != 1 {
		t.Fatalf("audit failure leaked mutation sectors=%d version=%d", sectors, version)
	}
}

func TestUpdateMembershipRolesRejectsResidualIncompatibleSectors(t *testing.T) {
	fixture := sectorCommandRuntimeSetup(t)
	store, orgID := fixture.store, fixture.organization
	ctx := sectorCommandContext(fixture)
	if _, err := fixture.migrationPool.Exec(context.Background(), `UPDATE memberships SET roles='{produccion}' WHERE id=$1`, commandReplacement); err != nil {
		t.Fatal(err)
	}
	result, err := store.ChangeMembershipSectors(ctx, storage.ChangeMembershipSectorsCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: commandReplacement,
		ExpectedMembershipVersion: 1, Sectors: []domain.ProductionSector{domain.SectorCutting}, Reason: "floor assignment",
	})
	if err != nil {
		t.Fatal(err)
	}
	err = store.WithinTenantTx(ctx, fixture.actor, func(txCtx context.Context) error {
		_, updateErr := store.UpdateMembershipRolesByOrg(txCtx, orgID, commandReplacement, []domain.UserRole{domain.RoleIngeniero}, result.Member.Version)
		return updateErr
	})
	if !errors.Is(err, storage.ErrSectorAssignmentInvalid) {
		t.Fatalf("incompatible residual sectors error=%v", err)
	}
}

func TestOffboardMember_ReassignsAllResponsibilitiesAndRevokesCredentials(t *testing.T) {
	fixture := offboardCommandRuntimeSetup(t)
	store, orgID := fixture.store, fixture.organization
	ctx := context.Background()
	if _, err := fixture.migrationPool.Exec(ctx, `UPDATE memberships SET roles='{admin,ingeniero,gerente_ventas,gerente_produccion}' WHERE id=$1`, commandReplacement); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.migrationPool.Exec(ctx, `UPDATE production_activities SET finished_at=NOW() WHERE organization_id=$1 AND operator_id=$2`, orgID, offboardingTargetUser); err != nil {
		t.Fatal(err)
	}

	preview, version, impactVersion, err := store.GetMembershipOffboardingImpact(offboardCommandContext(fixture), orgID, offboardingTargetMembership, commandAdminUser)
	if err != nil || preview.TransferRequiredCount() != 4 || preview.BlockingCount() != 0 {
		t.Fatalf("preview=%#v version=%d impact=%q err=%v", preview, version, impactVersion, err)
	}
	result, err := store.OffboardMember(offboardCommandContext(fixture), storage.OffboardMemberCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: offboardingTargetMembership,
		ExpectedMembershipVersion: version, ExpectedImpactVersion: impactVersion, Reason: "employment ended",
		Plan: storage.MembershipReassignmentPlan{
			CustomerOwnerMembershipID: commandReplacement, SalesProjectOwnerMembershipID: commandReplacement,
			EngineerMembershipID: commandReplacement, WarrantyTechnicianMembershipID: commandReplacement,
		}, RequestID: "request-offboard-1",
	})
	if err != nil {
		t.Fatalf("OffboardMember: %v", err)
	}
	if result.Member.Status != domain.MembershipStatusLeft || result.Member.Version != version+1 {
		t.Fatalf("unexpected offboarded member: %#v", result.Member)
	}
	var remaining, credentialVersion, audits int
	offboardCommandRuntimeRead(t, fixture, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			SELECT
			 (SELECT count(*) FROM customers WHERE organization_id=$1 AND owner_user_id=$2) +
			 (SELECT count(*) FROM projects WHERE sales_organization_id=$1 AND owner_user_id=$2) +
			 (SELECT count(*) FROM projects WHERE manufacturing_organization_id=$1 AND assigned_engineer_id=$2) +
			 (SELECT count(*) FROM warranty_tickets WHERE organization_id=$1 AND assigned_technician_id=$2 AND status IN ('open','visit_scheduled','in_progress'))`, orgID, offboardingTargetUser).Scan(&remaining); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT credential_version FROM memberships WHERE id=$1`, offboardingTargetMembership).Scan(&credentialVersion); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE organization_id=$1 AND event_type='membership_offboarded' AND details->>'request_id'='request-offboard-1'`, orgID).Scan(&audits)
	})
	if remaining != 0 || credentialVersion != 2 || audits != 1 {
		t.Fatalf("remaining=%d credential_version=%d audits=%d", remaining, credentialVersion, audits)
	}
}

func TestOffboardMember_RejectsBlockersAndChangedImpact(t *testing.T) {
	fixture := offboardCommandRuntimeSetup(t)
	store, orgID := fixture.store, fixture.organization
	ctx := context.Background()
	_, version, impactVersion, err := store.GetMembershipOffboardingImpact(offboardCommandContext(fixture), orgID, offboardingTargetMembership, commandAdminUser)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.OffboardMember(offboardCommandContext(fixture), storage.OffboardMemberCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: offboardingTargetMembership,
		ExpectedMembershipVersion: version, ExpectedImpactVersion: impactVersion, Reason: "blocked",
	})
	var blocked *storage.OffboardingBlockedError
	if !errors.As(err, &blocked) || blocked.Inventory.BlockingCount() != 1 {
		t.Fatalf("blocker error=%v", err)
	}
	_, err = store.OffboardMember(offboardCommandContext(fixture), storage.OffboardMemberCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: offboardingTargetMembership,
		ExpectedMembershipVersion: version + 1, ExpectedImpactVersion: impactVersion, Reason: "stale membership",
	})
	if !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("stale membership error=%v", err)
	}

	if _, err := fixture.migrationPool.Exec(ctx, `UPDATE production_activities SET finished_at=NOW() WHERE organization_id=$1 AND operator_id=$2`, orgID, offboardingTargetUser); err != nil {
		t.Fatal(err)
	}
	_, version, impactVersion, err = store.GetMembershipOffboardingImpact(offboardCommandContext(fixture), orgID, offboardingTargetMembership, commandAdminUser)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.migrationPool.Exec(ctx, `UPDATE customers SET owner_user_id=NULL WHERE organization_id=$1 AND owner_user_id=$2`, orgID, offboardingTargetUser); err != nil {
		t.Fatal(err)
	}
	_, err = store.OffboardMember(offboardCommandContext(fixture), storage.OffboardMemberCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: offboardingTargetMembership,
		ExpectedMembershipVersion: version, ExpectedImpactVersion: impactVersion, Reason: "stale impact",
	})
	if !errors.Is(err, storage.ErrImpactVersionConflict) {
		t.Fatalf("changed impact error=%v", err)
	}
	var status domain.MembershipStatus
	offboardCommandRuntimeRead(t, fixture, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT status FROM memberships WHERE id=$1`, offboardingTargetMembership).Scan(&status)
	})
	if status != domain.MembershipStatusActive {
		t.Fatalf("status=%s", status)
	}
}

func TestOffboardMember_AuditFailureRollsBackReassignmentsAndStatus(t *testing.T) {
	fixture := offboardCommandRuntimeSetup(t)
	store, orgID := fixture.store, fixture.organization
	ctx := context.Background()
	if _, err := fixture.migrationPool.Exec(ctx, `UPDATE memberships SET roles='{admin,ingeniero,gerente_ventas,gerente_produccion}' WHERE id=$1`, commandReplacement); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.migrationPool.Exec(ctx, `UPDATE production_activities SET finished_at=NOW() WHERE organization_id=$1 AND operator_id=$2`, orgID, offboardingTargetUser); err != nil {
		t.Fatal(err)
	}
	_, version, impactVersion, err := store.GetMembershipOffboardingImpact(offboardCommandContext(fixture), orgID, offboardingTargetMembership, commandAdminUser)
	if err != nil {
		t.Fatal(err)
	}
	installRejectOffboardAuditTrigger(t, fixture.migrationPool)
	_, err = store.OffboardMember(offboardCommandContext(fixture), storage.OffboardMemberCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: offboardingTargetMembership,
		ExpectedMembershipVersion: version, ExpectedImpactVersion: impactVersion, Reason: "rollback proof",
		Plan: storage.MembershipReassignmentPlan{
			CustomerOwnerMembershipID: commandReplacement, SalesProjectOwnerMembershipID: commandReplacement,
			EngineerMembershipID: commandReplacement, WarrantyTechnicianMembershipID: commandReplacement,
		},
	})
	if err == nil {
		t.Fatal("expected required audit failure")
	}
	var owned int
	var status domain.MembershipStatus
	offboardCommandRuntimeRead(t, fixture, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM customers WHERE organization_id=$1 AND owner_user_id=$2`, orgID, offboardingTargetUser).Scan(&owned); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT status FROM memberships WHERE id=$1`, offboardingTargetMembership).Scan(&status)
	})
	if owned != 1 || status != domain.MembershipStatusActive {
		t.Fatalf("audit failure leaked offboarding owned=%d status=%s", owned, status)
	}
}

func installRejectTeamAuditTrigger(t *testing.T, store *storage.PostgresStore) {
	t.Helper()
	ctx := context.Background()
	if _, err := store.Pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION reject_team_command_audit() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.event_type IN ('organization_admin_transferred','membership_sectors_changed','membership_offboarded') THEN
				RAISE EXCEPTION 'required audit unavailable';
			END IF;
			RETURN NEW;
		END $$;
		CREATE TRIGGER reject_team_command_audit BEFORE INSERT ON security_audit_events
		FOR EACH ROW EXECUTE FUNCTION reject_team_command_audit()`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool.Exec(context.Background(), `DROP TRIGGER IF EXISTS reject_team_command_audit ON security_audit_events; DROP FUNCTION IF EXISTS reject_team_command_audit()`)
	})
}

func containsTestRole(roles []domain.UserRole, wanted domain.UserRole) bool {
	for _, role := range roles {
		if role == wanted {
			return true
		}
	}
	return false
}
