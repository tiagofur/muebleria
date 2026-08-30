package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

var (
	ErrAdminTransferInvalid    = errors.New("invalid organization admin transfer")
	ErrSectorAssignmentInvalid = errors.New("invalid membership sector assignment")
	ErrOffboardingBlocked      = errors.New("membership offboarding blocked")
	ErrImpactVersionConflict   = errors.New("membership responsibility impact changed")
	ErrReassignmentInvalid     = errors.New("invalid membership reassignment plan")
)

// TransferOrganizationAdminCommand promotes TargetMembershipID and can demote
// SourceMembershipID in one tenant transaction. Both versions are required so
// the command cannot overwrite a concurrent membership change.
type TransferOrganizationAdminCommand struct {
	OrganizationID        string
	ActorUserID           string
	SourceMembershipID    string
	TargetMembershipID    string
	ExpectedSourceVersion int64
	ExpectedTargetVersion int64
	DemoteSource          bool
	Reason                string
	RequestID             string
	IP                    string
}

type AdminTransferResult struct {
	Source *OrgTeamMember
	Target *OrgTeamMember
}

// ChangeMembershipSectorsCommand replaces the complete sector set for one
// exact membership. The membership version, rather than a global user ID,
// supplies the optimistic concurrency boundary.
type ChangeMembershipSectorsCommand struct {
	OrganizationID            string
	ActorUserID               string
	MembershipID              string
	ExpectedMembershipVersion int64
	Sectors                   []domain.ProductionSector
	Reason                    string
	RequestID                 string
	IP                        string
}

type MembershipSectorChangeResult struct {
	Member  OrgTeamMember
	Sectors []domain.ProductionSector
}

// MembershipReassignmentPlan is explicit by responsibility class. Empty
// destinations never mean "pick an admin"; they are rejected when work exists.
type MembershipReassignmentPlan struct {
	CustomerOwnerMembershipID      string
	SalesProjectOwnerMembershipID  string
	EngineerMembershipID           string
	WarrantyTechnicianMembershipID string
}

type OffboardMemberCommand struct {
	OrganizationID            string
	ActorUserID               string
	MembershipID              string
	ExpectedMembershipVersion int64
	ExpectedImpactVersion     string
	Reason                    string
	Plan                      MembershipReassignmentPlan
	RequestID                 string
	IP                        string
}

type OffboardMemberResult struct {
	Member    OrgTeamMember
	Inventory MembershipResponsibilityInventory
}

// OffboardingBlockedError preserves the actionable inventory for transport
// adapters while still matching ErrOffboardingBlocked with errors.Is.
type OffboardingBlockedError struct {
	Inventory MembershipResponsibilityInventory
}

func (e *OffboardingBlockedError) Error() string {
	return fmt.Sprintf("%v: %d active production claims", ErrOffboardingBlocked, e.Inventory.BlockingCount())
}

func (e *OffboardingBlockedError) Unwrap() error { return ErrOffboardingBlocked }

func validateTeamCommandScope(ctx context.Context, organizationID string) error {
	scopedOrganizationID, err := RequireOrgFromCtx(ctx)
	if err != nil {
		return err
	}
	if scopedOrganizationID != organizationID {
		return ErrMembershipNotFound
	}
	return nil
}

func (s *PostgresStore) withTeamCommandTx(ctx context.Context, organizationID, actorUserID string, execute func(context.Context) error) error {
	if err := validateTeamCommandScope(ctx, organizationID); err != nil {
		return err
	}
	return s.WithinTenantTx(ctx, TenantActor{OrganizationID: organizationID, UserID: actorUserID}, execute)
}

// RecordTeamInvariantBlocked persists denial lineage only after the rejected
// business transaction has rolled back and the protected state is safe.
func (s *PostgresStore) RecordTeamInvariantBlocked(ctx context.Context, organizationID, actorUserID, eventType, commandPath, ip, requestID string) error {
	if eventType != "last_admin_blocked" && eventType != "seat_limit_blocked" {
		return errors.New("invalid team invariant audit event")
	}
	return s.withTeamCommandTx(ctx, organizationID, actorUserID, func(txCtx context.Context) error {
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType: eventType, ActorUserID: actorUserID, OrganizationID: organizationID, IP: ip,
			Details: map[string]interface{}{"command_path": commandPath, "request_id": requestID},
		})
	})
}

func (s *PostgresStore) lockTeamState(ctx context.Context, organizationID string) error {
	var locked string
	err := s.db(ctx).QueryRow(ctx, `SELECT organization_id FROM organization_team_state WHERE organization_id=$1 FOR UPDATE`, organizationID).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrMembershipNotFound
	}
	return err
}

func (s *PostgresStore) lockTeamMember(ctx context.Context, organizationID, membershipID string) (*OrgTeamMember, error) {
	member, err := scanOrgTeamMember(s.db(ctx).QueryRow(ctx, `
		SELECT m.id,u.id,u.email,u.name,u.account_status,m.status,m.roles,m.joined_at,m.version
		FROM memberships m JOIN users u ON u.id=m.user_id
		WHERE m.organization_id=$1 AND m.id=$2
		FOR UPDATE OF m`, organizationID, membershipID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrMembershipNotFound
	}
	return member, err
}

func containsRole(roles []domain.UserRole, wanted domain.UserRole) bool {
	for _, role := range roles {
		if role == wanted {
			return true
		}
	}
	return false
}

func addRole(roles []domain.UserRole, wanted domain.UserRole) []domain.UserRole {
	out := append([]domain.UserRole(nil), roles...)
	if !containsRole(out, wanted) {
		out = append(out, wanted)
	}
	return out
}

func removeRole(roles []domain.UserRole, unwanted domain.UserRole) []domain.UserRole {
	out := make([]domain.UserRole, 0, len(roles))
	for _, role := range roles {
		if role != unwanted {
			out = append(out, role)
		}
	}
	return out
}

// TransferOrganizationAdmin is the only primitive that promotes one admin and
// optionally demotes another as a single auditable mutation.
func (s *PostgresStore) TransferOrganizationAdmin(ctx context.Context, command TransferOrganizationAdminCommand) (*AdminTransferResult, error) {
	if command.SourceMembershipID == "" || command.TargetMembershipID == "" || command.SourceMembershipID == command.TargetMembershipID || command.ExpectedSourceVersion < 1 || command.ExpectedTargetVersion < 1 {
		return nil, ErrAdminTransferInvalid
	}
	var result AdminTransferResult
	err := s.withTeamCommandTx(ctx, command.OrganizationID, command.ActorUserID, func(txCtx context.Context) error {
		if err := s.lockTeamState(txCtx, command.OrganizationID); err != nil {
			return err
		}
		source, err := s.lockTeamMember(txCtx, command.OrganizationID, command.SourceMembershipID)
		if err != nil {
			return err
		}
		target, err := s.lockTeamMember(txCtx, command.OrganizationID, command.TargetMembershipID)
		if err != nil {
			return err
		}
		if source.Version != command.ExpectedSourceVersion || target.Version != command.ExpectedTargetVersion {
			return ErrVersionConflict
		}
		if source.Status != domain.MembershipStatusActive || !containsRole(source.Roles, domain.RoleAdmin) || target.Status != domain.MembershipStatusActive {
			return ErrAdminTransferInvalid
		}

		targetBefore := append([]domain.UserRole(nil), target.Roles...)
		targetRoles := addRole(target.Roles, domain.RoleAdmin)
		result.Target, err = s.UpdateMembershipRolesByOrg(txCtx, command.OrganizationID, target.MembershipID, targetRoles, target.Version)
		if err != nil {
			return err
		}
		result.Source = source
		if command.DemoteSource {
			sourceRoles := removeRole(source.Roles, domain.RoleAdmin)
			if !domain.IsValidRoleSet(sourceRoles) {
				return ErrAdminTransferInvalid
			}
			result.Source, err = s.UpdateMembershipRolesByOrg(txCtx, command.OrganizationID, source.MembershipID, sourceRoles, source.Version)
			if err != nil {
				return err
			}
		}
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType: "organization_admin_transferred", ActorUserID: command.ActorUserID,
			TargetUserID: target.UserID, OrganizationID: command.OrganizationID, IP: command.IP,
			Details: map[string]interface{}{
				"source_membership_id": source.MembershipID, "target_membership_id": target.MembershipID,
				"source_roles_before": source.Roles, "source_roles_after": result.Source.Roles,
				"target_roles_before": targetBefore, "target_roles_after": result.Target.Roles,
				"demote_source": command.DemoteSource, "reason": command.Reason, "request_id": command.RequestID,
			},
		})
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}

func normalizedSectors(sectors []domain.ProductionSector) ([]domain.ProductionSector, error) {
	unique := make(map[domain.ProductionSector]struct{}, len(sectors))
	for _, sector := range sectors {
		if !domain.IsValidSector(sector) {
			return nil, ErrSectorAssignmentInvalid
		}
		unique[sector] = struct{}{}
	}
	out := make([]domain.ProductionSector, 0, len(unique))
	for sector := range unique {
		out = append(out, sector)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out, nil
}

func sectorsCompatibleWithMembership(sectors []domain.ProductionSector, roles []domain.UserRole, organizationType domain.OrganizationType) bool {
	if len(sectors) == 0 {
		return true
	}
	if organizationType != domain.OrganizationTypeFactory || !domain.RolesAllScopedBySector(roles) {
		return false
	}
	for _, sector := range sectors {
		for _, role := range roles {
			if !domain.SectorAllowedForRole(role, sector) {
				return false
			}
		}
	}
	return true
}

// ChangeMembershipSectors checks the live organization type and live role set,
// then replaces assignments and appends audit in the same transaction.
func (s *PostgresStore) ChangeMembershipSectors(ctx context.Context, command ChangeMembershipSectorsCommand) (*MembershipSectorChangeResult, error) {
	if command.MembershipID == "" || command.ExpectedMembershipVersion < 1 {
		return nil, ErrSectorAssignmentInvalid
	}
	sectors, err := normalizedSectors(command.Sectors)
	if err != nil {
		return nil, err
	}
	var result MembershipSectorChangeResult
	err = s.withTeamCommandTx(ctx, command.OrganizationID, command.ActorUserID, func(txCtx context.Context) error {
		member, err := s.lockTeamMember(txCtx, command.OrganizationID, command.MembershipID)
		if err != nil {
			return err
		}
		if member.Version != command.ExpectedMembershipVersion {
			return ErrVersionConflict
		}
		var organizationType domain.OrganizationType
		if err := s.db(txCtx).QueryRow(txCtx, `SELECT type FROM organizations WHERE id=$1`, command.OrganizationID).Scan(&organizationType); err != nil {
			return err
		}
		if !sectorsCompatibleWithMembership(sectors, member.Roles, organizationType) {
			return ErrSectorAssignmentInvalid
		}

		rows, err := s.db(txCtx).Query(txCtx, `SELECT sector FROM membership_sectors WHERE organization_id=$1 AND membership_id=$2 ORDER BY sector`, command.OrganizationID, member.MembershipID)
		if err != nil {
			return err
		}
		before := []domain.ProductionSector{}
		for rows.Next() {
			var sector domain.ProductionSector
			if err := rows.Scan(&sector); err != nil {
				rows.Close()
				return err
			}
			before = append(before, sector)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		if _, err := s.db(txCtx).Exec(txCtx, `DELETE FROM membership_sectors WHERE organization_id=$1 AND membership_id=$2`, command.OrganizationID, member.MembershipID); err != nil {
			return err
		}
		for _, sector := range sectors {
			if _, err := s.db(txCtx).Exec(txCtx, `INSERT INTO membership_sectors (membership_id,organization_id,sector,assigned_by_user_id) VALUES ($1,$2,$3,NULLIF($4,'')::uuid)`, member.MembershipID, command.OrganizationID, sector, command.ActorUserID); err != nil {
				return err
			}
		}
		updated, err := scanOrgTeamMember(s.db(txCtx).QueryRow(txCtx, `
			UPDATE memberships m SET version=version+1,updated_at=NOW() FROM users u
			WHERE m.id=$2 AND m.organization_id=$1 AND m.version=$3 AND u.id=m.user_id
			RETURNING m.id,u.id,u.email,u.name,u.account_status,m.status,m.roles,m.joined_at,m.version`, command.OrganizationID, member.MembershipID, member.Version))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrVersionConflict
		}
		if err != nil {
			return err
		}
		result.Member = *updated
		result.Sectors = append([]domain.ProductionSector(nil), sectors...)
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType: "membership_sectors_changed", ActorUserID: command.ActorUserID,
			TargetUserID: member.UserID, OrganizationID: command.OrganizationID, IP: command.IP,
			Details: map[string]interface{}{
				"membership_id": member.MembershipID, "sectors_before": before, "sectors_after": sectors,
				"reason": command.Reason, "request_id": command.RequestID,
			},
		})
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}

type offboardingImpactRows struct {
	customers []string
	projects  []string
	engineer  []string
	warranty  []string
	claims    []string
}

func (r offboardingImpactRows) fingerprint(inventory MembershipResponsibilityInventory, membershipVersion int64) string {
	parts := []string{inventory.OrganizationID, inventory.MembershipID, inventory.UserID, fmt.Sprint(membershipVersion)}
	parts = append(parts, r.customers...)
	parts = append(parts, "|")
	parts = append(parts, r.projects...)
	parts = append(parts, "|")
	parts = append(parts, r.engineer...)
	parts = append(parts, "|")
	parts = append(parts, r.warranty...)
	parts = append(parts, "|")
	parts = append(parts, r.claims...)
	digest := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(digest[:])
}

func scanStringRows(rows pgx.Rows) ([]string, error) {
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s *PostgresStore) lockOffboardingImpact(ctx context.Context, organizationID, userID string) (offboardingImpactRows, error) {
	var out offboardingImpactRows
	queries := []struct {
		destination *[]string
		query       string
		args        []any
	}{
		{&out.customers, `SELECT id::text FROM customers WHERE organization_id=$1 AND owner_user_id=$2 ORDER BY id FOR UPDATE`, []any{organizationID, userID}},
		{&out.projects, `SELECT id::text FROM projects WHERE sales_organization_id=$1 AND owner_user_id=$2 ORDER BY id FOR UPDATE`, []any{organizationID, userID}},
		{&out.engineer, `SELECT id::text FROM projects WHERE manufacturing_organization_id=$1 AND assigned_engineer_id=$2 ORDER BY id FOR UPDATE`, []any{organizationID, userID}},
		{&out.warranty, `SELECT id::text FROM warranty_tickets WHERE organization_id=$1 AND assigned_technician_id=$2 AND status IN ('open','visit_scheduled','in_progress') ORDER BY id FOR UPDATE`, []any{organizationID, userID}},
		{&out.claims, `SELECT id FROM production_activities WHERE organization_id=$1 AND operator_id=$2 AND type='claim' AND finished_at IS NULL ORDER BY id FOR UPDATE`, []any{organizationID, userID}},
	}
	for _, item := range queries {
		rows, err := s.db(ctx).Query(ctx, item.query, item.args...)
		if err != nil {
			return out, err
		}
		*item.destination, err = scanStringRows(rows)
		if err != nil {
			return out, err
		}
	}
	return out, nil
}

func inventoryFromImpact(organizationID, membershipID, userID string, rows offboardingImpactRows) MembershipResponsibilityInventory {
	return MembershipResponsibilityInventory{
		OrganizationID: organizationID, MembershipID: membershipID, UserID: userID,
		CustomerOwnershipCount: len(rows.customers), SalesProjectOwnershipCount: len(rows.projects),
		EngineerAssignmentCount: len(rows.engineer), OpenWarrantyAssignmentCount: len(rows.warranty),
		ActiveProductionClaimCount: len(rows.claims),
	}
}

// GetMembershipOffboardingImpact returns the authoritative preview token used
// by OffboardMember. Its short-lived transaction locks the inspected rows for
// a consistent snapshot and releases them without mutation before returning.
func (s *PostgresStore) GetMembershipOffboardingImpact(ctx context.Context, organizationID, membershipID, actorUserID string) (*MembershipResponsibilityInventory, int64, string, error) {
	if err := validateTeamCommandScope(ctx, organizationID); err != nil {
		return nil, 0, "", err
	}
	var inventory MembershipResponsibilityInventory
	var version int64
	var impactVersion string
	err := s.WithinTenantTx(ctx, TenantActor{OrganizationID: organizationID, UserID: actorUserID}, func(txCtx context.Context) error {
		member, err := s.lockTeamMember(txCtx, organizationID, membershipID)
		if err != nil {
			return err
		}
		rows, err := s.lockOffboardingImpact(txCtx, organizationID, member.UserID)
		if err != nil {
			return err
		}
		inventory = inventoryFromImpact(organizationID, membershipID, member.UserID, rows)
		version = member.Version
		impactVersion = rows.fingerprint(inventory, version)
		return nil
	})
	if err != nil {
		return nil, 0, "", err
	}
	return &inventory, version, impactVersion, nil
}

type reassignmentTarget struct {
	membershipID string
	userID       string
	roles        []domain.UserRole
}

func roleSetContainsAny(roles []domain.UserRole, allowed ...domain.UserRole) bool {
	for _, role := range roles {
		if containsRole(allowed, role) {
			return true
		}
	}
	return false
}

func (s *PostgresStore) resolveReassignmentTarget(ctx context.Context, organizationID, targetMembershipID, offboardedMembershipID string, allowedRoles ...domain.UserRole) (*reassignmentTarget, error) {
	if targetMembershipID == "" || targetMembershipID == offboardedMembershipID {
		return nil, ErrReassignmentInvalid
	}
	member, err := s.lockTeamMember(ctx, organizationID, targetMembershipID)
	if err != nil {
		return nil, ErrReassignmentInvalid
	}
	if member.Status != domain.MembershipStatusActive || !roleSetContainsAny(member.Roles, allowedRoles...) {
		return nil, ErrReassignmentInvalid
	}
	return &reassignmentTarget{membershipID: member.MembershipID, userID: member.UserID, roles: member.Roles}, nil
}

// OffboardMember revalidates the preview token, rejects workflow blockers,
// applies each explicit reassignment, transitions the membership to left,
// revokes its credentials and appends the audit event atomically.
func (s *PostgresStore) OffboardMember(ctx context.Context, command OffboardMemberCommand) (*OffboardMemberResult, error) {
	if command.MembershipID == "" || command.ExpectedMembershipVersion < 1 || strings.TrimSpace(command.ExpectedImpactVersion) == "" || strings.TrimSpace(command.Reason) == "" {
		return nil, ErrReassignmentInvalid
	}
	var result OffboardMemberResult
	err := s.withTeamCommandTx(ctx, command.OrganizationID, command.ActorUserID, func(txCtx context.Context) error {
		if err := s.lockTeamState(txCtx, command.OrganizationID); err != nil {
			return err
		}
		member, err := s.lockTeamMember(txCtx, command.OrganizationID, command.MembershipID)
		if err != nil {
			return err
		}
		if member.Version != command.ExpectedMembershipVersion {
			return ErrVersionConflict
		}
		if member.Status != domain.MembershipStatusActive {
			return ErrReassignmentInvalid
		}
		impact, err := s.lockOffboardingImpact(txCtx, command.OrganizationID, member.UserID)
		if err != nil {
			return err
		}
		inventory := inventoryFromImpact(command.OrganizationID, member.MembershipID, member.UserID, impact)
		result.Inventory = inventory
		if impact.fingerprint(inventory, member.Version) != command.ExpectedImpactVersion {
			return ErrImpactVersionConflict
		}
		if inventory.BlockingCount() > 0 {
			return &OffboardingBlockedError{Inventory: inventory}
		}

		var customerTarget, salesTarget, engineerTarget, warrantyTarget *reassignmentTarget
		if inventory.CustomerOwnershipCount > 0 {
			customerTarget, err = s.resolveReassignmentTarget(txCtx, command.OrganizationID, command.Plan.CustomerOwnerMembershipID, member.MembershipID, domain.RoleAdmin, domain.RoleGerenteVentas, domain.RoleVendedor)
			if err != nil {
				return err
			}
		}
		if inventory.SalesProjectOwnershipCount > 0 {
			salesTarget, err = s.resolveReassignmentTarget(txCtx, command.OrganizationID, command.Plan.SalesProjectOwnerMembershipID, member.MembershipID, domain.RoleAdmin, domain.RoleGerenteVentas, domain.RoleVendedor)
			if err != nil {
				return err
			}
		}
		if inventory.EngineerAssignmentCount > 0 {
			engineerTarget, err = s.resolveReassignmentTarget(txCtx, command.OrganizationID, command.Plan.EngineerMembershipID, member.MembershipID, domain.RoleAdmin, domain.RoleIngeniero)
			if err != nil {
				return err
			}
		}
		if inventory.OpenWarrantyAssignmentCount > 0 {
			warrantyTarget, err = s.resolveReassignmentTarget(txCtx, command.OrganizationID, command.Plan.WarrantyTechnicianMembershipID, member.MembershipID, domain.RoleAdmin, domain.RoleGerenteProduccion, domain.RoleProduccion)
			if err != nil {
				return err
			}
		}

		if customerTarget != nil {
			if _, err := s.db(txCtx).Exec(txCtx, `UPDATE customers SET owner_user_id=$3,updated_at=NOW() WHERE organization_id=$1 AND owner_user_id=$2`, command.OrganizationID, member.UserID, customerTarget.userID); err != nil {
				return err
			}
		}
		if salesTarget != nil {
			if _, err := s.db(txCtx).Exec(txCtx, `UPDATE projects SET owner_user_id=$3,updated_at=NOW() WHERE sales_organization_id=$1 AND owner_user_id=$2`, command.OrganizationID, member.UserID, salesTarget.userID); err != nil {
				return err
			}
		}
		if engineerTarget != nil {
			if _, err := s.db(txCtx).Exec(txCtx, `UPDATE projects SET assigned_engineer_id=$3,updated_at=NOW() WHERE manufacturing_organization_id=$1 AND assigned_engineer_id=$2`, command.OrganizationID, member.UserID, engineerTarget.userID); err != nil {
				return err
			}
		}
		if warrantyTarget != nil {
			if _, err := s.db(txCtx).Exec(txCtx, `UPDATE warranty_tickets SET assigned_technician_id=$3,updated_at=NOW() WHERE organization_id=$1 AND assigned_technician_id=$2 AND status IN ('open','visit_scheduled','in_progress')`, command.OrganizationID, member.UserID, warrantyTarget.userID); err != nil {
				return err
			}
		}
		updated, err := s.UpdateMembershipStatus(txCtx, command.OrganizationID, member.MembershipID, domain.MembershipStatusLeft, strings.TrimSpace(command.Reason), command.ActorUserID, member.Version)
		if err != nil {
			return err
		}
		result.Member = *updated
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType: "membership_offboarded", ActorUserID: command.ActorUserID,
			TargetUserID: member.UserID, OrganizationID: command.OrganizationID, IP: command.IP,
			Details: map[string]interface{}{
				"membership_id": member.MembershipID, "reason": strings.TrimSpace(command.Reason),
				"request_id": command.RequestID, "impact_version": command.ExpectedImpactVersion,
				"membership_before":                 map[string]interface{}{"status": member.Status, "roles": member.Roles, "version": member.Version},
				"membership_after":                  map[string]interface{}{"status": updated.Status, "roles": updated.Roles, "version": updated.Version},
				"customer_owner_membership_id":      command.Plan.CustomerOwnerMembershipID,
				"sales_project_owner_membership_id": command.Plan.SalesProjectOwnerMembershipID,
				"engineer_membership_id":            command.Plan.EngineerMembershipID,
				"warranty_technician_membership_id": command.Plan.WarrantyTechnicianMembershipID,
				"inventory":                         inventory,
			},
		})
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}
