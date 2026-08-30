package storage_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const (
	commandAdminUser       = "f1000000-0000-0000-0000-000000000001"
	commandAdminMembership = "f2000000-0000-0000-0000-000000000001"
	commandReplacementUser = "f1000000-0000-0000-0000-000000000002"
	commandReplacement     = "f2000000-0000-0000-0000-000000000002"
)

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
		{`UPDATE organizations SET active=TRUE WHERE id=$1`, []any{organizationID}},
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
	store, _, orgID := isolationSetup(t)
	seedCommandAdministrators(t, store, orgID)
	ctx := scoped(context.Background(), orgID)

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
	if err := store.Pool.QueryRow(context.Background(), `SELECT active_admin_count FROM organization_team_state WHERE organization_id=$1`, orgID).Scan(&admins); err != nil || admins != 1 {
		t.Fatalf("admin count=%d err=%v", admins, err)
	}
	if err := store.Pool.QueryRow(context.Background(), `SELECT count(*) FROM security_audit_events WHERE organization_id=$1 AND event_type='organization_admin_transferred' AND details->>'request_id'='request-transfer-1'`, orgID).Scan(&audits); err != nil || audits != 1 {
		t.Fatalf("audit count=%d err=%v", audits, err)
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
	store, _, orgID := isolationSetup(t)
	seedCommandAdministrators(t, store, orgID)
	ctx := scoped(context.Background(), orgID)
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
	store, _, orgID := isolationSetup(t)
	seedCommandAdministrators(t, store, orgID)
	installRejectTeamAuditTrigger(t, store)
	_, err := store.TransferOrganizationAdmin(scoped(context.Background(), orgID), storage.TransferOrganizationAdminCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser,
		SourceMembershipID: commandAdminMembership, TargetMembershipID: commandReplacement,
		ExpectedSourceVersion: 1, ExpectedTargetVersion: 1, DemoteSource: true, Reason: "rollback",
	})
	if err == nil {
		t.Fatal("expected required audit failure")
	}
	var sourceRoles, targetRoles []domain.UserRole
	var sourceVersion, targetVersion int64
	if err := store.Pool.QueryRow(context.Background(), `SELECT roles,version FROM memberships WHERE id=$1`, commandAdminMembership).Scan(&sourceRoles, &sourceVersion); err != nil {
		t.Fatal(err)
	}
	if err := store.Pool.QueryRow(context.Background(), `SELECT roles,version FROM memberships WHERE id=$1`, commandReplacement).Scan(&targetRoles, &targetVersion); err != nil {
		t.Fatal(err)
	}
	if !containsTestRole(sourceRoles, domain.RoleAdmin) || containsTestRole(targetRoles, domain.RoleAdmin) || sourceVersion != 1 || targetVersion != 1 {
		t.Fatalf("audit failure leaked transfer source=%v/%d target=%v/%d", sourceRoles, sourceVersion, targetRoles, targetVersion)
	}
}

func TestChangeMembershipSectors_ValidatesLiveRolesTypeVersionAndScope(t *testing.T) {
	store, orgA, orgID := isolationSetup(t)
	seedCommandAdministrators(t, store, orgID)
	ctx := context.Background()
	if _, err := store.Pool.Exec(ctx, `UPDATE memberships SET roles='{produccion}' WHERE id=$1`, commandReplacement); err != nil {
		t.Fatal(err)
	}

	result, err := store.ChangeMembershipSectors(scoped(ctx, orgID), storage.ChangeMembershipSectorsCommand{
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

	_, err = store.ChangeMembershipSectors(scoped(ctx, orgID), storage.ChangeMembershipSectorsCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: commandReplacement,
		ExpectedMembershipVersion: 1, Sectors: []domain.ProductionSector{domain.SectorShipping},
	})
	if !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("stale sector error=%v", err)
	}
	_, err = store.ChangeMembershipSectors(scoped(ctx, orgA), storage.ChangeMembershipSectorsCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: commandReplacement,
		ExpectedMembershipVersion: 2, Sectors: []domain.ProductionSector{domain.SectorShipping},
	})
	if !errors.Is(err, storage.ErrMembershipNotFound) {
		t.Fatalf("cross-tenant sector error=%v", err)
	}
	if _, err := store.Pool.Exec(ctx, `UPDATE organizations SET type='store' WHERE id=$1`, orgID); err != nil {
		t.Fatal(err)
	}
	_, err = store.ChangeMembershipSectors(scoped(ctx, orgID), storage.ChangeMembershipSectorsCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: commandReplacement,
		ExpectedMembershipVersion: 2, Sectors: []domain.ProductionSector{domain.SectorShipping},
	})
	if !errors.Is(err, storage.ErrSectorAssignmentInvalid) {
		t.Fatalf("store sector error=%v", err)
	}
}

func TestChangeMembershipSectors_AuditFailureRollsBack(t *testing.T) {
	store, _, orgID := isolationSetup(t)
	seedCommandAdministrators(t, store, orgID)
	ctx := context.Background()
	if _, err := store.Pool.Exec(ctx, `UPDATE memberships SET roles='{produccion}' WHERE id=$1`, commandReplacement); err != nil {
		t.Fatal(err)
	}
	installRejectTeamAuditTrigger(t, store)

	_, err := store.ChangeMembershipSectors(scoped(ctx, orgID), storage.ChangeMembershipSectorsCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: commandReplacement,
		ExpectedMembershipVersion: 1, Sectors: []domain.ProductionSector{domain.SectorCutting},
	})
	if err == nil {
		t.Fatal("expected required audit failure")
	}
	var sectors int
	var version int64
	if err := store.Pool.QueryRow(ctx, `SELECT count(*) FROM membership_sectors WHERE membership_id=$1`, commandReplacement).Scan(&sectors); err != nil {
		t.Fatal(err)
	}
	if err := store.Pool.QueryRow(ctx, `SELECT version FROM memberships WHERE id=$1`, commandReplacement).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if sectors != 0 || version != 1 {
		t.Fatalf("audit failure leaked mutation sectors=%d version=%d", sectors, version)
	}
}

func TestOffboardMember_ReassignsAllResponsibilitiesAndRevokesCredentials(t *testing.T) {
	store, orgA, orgID := isolationSetup(t)
	seedOffboardingTarget(t, store, orgID)
	seedOffboardingResponsibilities(t, store, orgA, orgID)
	seedCommandAdministrators(t, store, orgID)
	ctx := context.Background()
	if _, err := store.Pool.Exec(ctx, `UPDATE memberships SET roles='{admin,ingeniero,gerente_ventas,gerente_produccion}' WHERE id=$1`, commandReplacement); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Pool.Exec(ctx, `UPDATE production_activities SET finished_at=NOW() WHERE organization_id=$1 AND operator_id=$2`, orgID, offboardingTargetUser); err != nil {
		t.Fatal(err)
	}

	preview, version, impactVersion, err := store.GetMembershipOffboardingImpact(scoped(ctx, orgID), orgID, offboardingTargetMembership, commandAdminUser)
	if err != nil || preview.TransferRequiredCount() != 4 || preview.BlockingCount() != 0 {
		t.Fatalf("preview=%#v version=%d impact=%q err=%v", preview, version, impactVersion, err)
	}
	result, err := store.OffboardMember(scoped(ctx, orgID), storage.OffboardMemberCommand{
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
	if err := store.Pool.QueryRow(ctx, `
		SELECT
		 (SELECT count(*) FROM customers WHERE organization_id=$1 AND owner_user_id=$2) +
		 (SELECT count(*) FROM projects WHERE sales_organization_id=$1 AND owner_user_id=$2) +
		 (SELECT count(*) FROM projects WHERE manufacturing_organization_id=$1 AND assigned_engineer_id=$2) +
		 (SELECT count(*) FROM warranty_tickets WHERE organization_id=$1 AND assigned_technician_id=$2 AND status IN ('open','visit_scheduled','in_progress'))`, orgID, offboardingTargetUser).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if err := store.Pool.QueryRow(ctx, `SELECT credential_version FROM memberships WHERE id=$1`, offboardingTargetMembership).Scan(&credentialVersion); err != nil {
		t.Fatal(err)
	}
	if err := store.Pool.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE organization_id=$1 AND event_type='membership_offboarded' AND details->>'request_id'='request-offboard-1'`, orgID).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 || credentialVersion != 2 || audits != 1 {
		t.Fatalf("remaining=%d credential_version=%d audits=%d", remaining, credentialVersion, audits)
	}
}

func TestOffboardMember_RejectsBlockersAndChangedImpact(t *testing.T) {
	store, orgA, orgID := isolationSetup(t)
	seedOffboardingTarget(t, store, orgID)
	seedOffboardingResponsibilities(t, store, orgA, orgID)
	seedCommandAdministrators(t, store, orgID)
	ctx := context.Background()
	_, version, impactVersion, err := store.GetMembershipOffboardingImpact(scoped(ctx, orgID), orgID, offboardingTargetMembership, commandAdminUser)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.OffboardMember(scoped(ctx, orgID), storage.OffboardMemberCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: offboardingTargetMembership,
		ExpectedMembershipVersion: version, ExpectedImpactVersion: impactVersion, Reason: "blocked",
	})
	var blocked *storage.OffboardingBlockedError
	if !errors.As(err, &blocked) || blocked.Inventory.BlockingCount() != 1 {
		t.Fatalf("blocker error=%v", err)
	}
	_, err = store.OffboardMember(scoped(ctx, orgID), storage.OffboardMemberCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: offboardingTargetMembership,
		ExpectedMembershipVersion: version + 1, ExpectedImpactVersion: impactVersion, Reason: "stale membership",
	})
	if !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("stale membership error=%v", err)
	}

	if _, err := store.Pool.Exec(ctx, `UPDATE production_activities SET finished_at=NOW() WHERE organization_id=$1 AND operator_id=$2`, orgID, offboardingTargetUser); err != nil {
		t.Fatal(err)
	}
	_, version, impactVersion, err = store.GetMembershipOffboardingImpact(scoped(ctx, orgID), orgID, offboardingTargetMembership, commandAdminUser)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Pool.Exec(ctx, `UPDATE customers SET owner_user_id=NULL WHERE organization_id=$1 AND owner_user_id=$2`, orgID, offboardingTargetUser); err != nil {
		t.Fatal(err)
	}
	_, err = store.OffboardMember(scoped(ctx, orgID), storage.OffboardMemberCommand{
		OrganizationID: orgID, ActorUserID: commandAdminUser, MembershipID: offboardingTargetMembership,
		ExpectedMembershipVersion: version, ExpectedImpactVersion: impactVersion, Reason: "stale impact",
	})
	if !errors.Is(err, storage.ErrImpactVersionConflict) {
		t.Fatalf("changed impact error=%v", err)
	}
	var status domain.MembershipStatus
	if err := store.Pool.QueryRow(ctx, `SELECT status FROM memberships WHERE id=$1`, offboardingTargetMembership).Scan(&status); err != nil || status != domain.MembershipStatusActive {
		t.Fatalf("status=%s err=%v", status, err)
	}
}

func TestOffboardMember_AuditFailureRollsBackReassignmentsAndStatus(t *testing.T) {
	store, orgA, orgID := isolationSetup(t)
	seedOffboardingTarget(t, store, orgID)
	seedOffboardingResponsibilities(t, store, orgA, orgID)
	seedCommandAdministrators(t, store, orgID)
	ctx := context.Background()
	if _, err := store.Pool.Exec(ctx, `UPDATE memberships SET roles='{admin,ingeniero,gerente_ventas,gerente_produccion}' WHERE id=$1`, commandReplacement); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Pool.Exec(ctx, `UPDATE production_activities SET finished_at=NOW() WHERE organization_id=$1 AND operator_id=$2`, orgID, offboardingTargetUser); err != nil {
		t.Fatal(err)
	}
	_, version, impactVersion, err := store.GetMembershipOffboardingImpact(scoped(ctx, orgID), orgID, offboardingTargetMembership, commandAdminUser)
	if err != nil {
		t.Fatal(err)
	}
	installRejectTeamAuditTrigger(t, store)
	_, err = store.OffboardMember(scoped(ctx, orgID), storage.OffboardMemberCommand{
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
	if err := store.Pool.QueryRow(ctx, `SELECT count(*) FROM customers WHERE organization_id=$1 AND owner_user_id=$2`, orgID, offboardingTargetUser).Scan(&owned); err != nil {
		t.Fatal(err)
	}
	if err := store.Pool.QueryRow(ctx, `SELECT status FROM memberships WHERE id=$1`, offboardingTargetMembership).Scan(&status); err != nil {
		t.Fatal(err)
	}
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
