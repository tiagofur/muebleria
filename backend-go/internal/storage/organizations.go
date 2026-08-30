// Organization, membership and security-audit persistence (ADR-0004 / #325).

package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// InitialOrganizationID is the deterministic id of the organization created by
// the multi-org backfill (migration 000081) from the former single-workshop
// deployment. While only one organization exists, approval and role bridges
// target it explicitly.
const InitialOrganizationID = "00000000-0000-0000-0000-000000000001"

var (
	ErrMembershipNotFound         = errors.New("membership not found")
	ErrVersionConflict            = errors.New("resource version conflict")
	ErrOrganizationStatusConflict = errors.New("organization status conflict")
)

const organizationColumns = `id, name, slug, type, license_plan, license_expires_at,
	status, credential_version, status_changed_at, status_changed_by::text,
	status_reason, suspended_at, offboarding_started_at, terminated_at,
	parent_organization_id, created_at, updated_at, version`

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func scanOrganization(row pgx.Row) (*domain.Organization, error) {
	var o domain.Organization
	err := row.Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
		&o.Status, &o.CredentialVersion, &o.StatusChangedAt, &o.StatusChangedBy,
		&o.StatusReason, &o.SuspendedAt, &o.OffboardingStartedAt, &o.TerminatedAt,
		&o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("organization not found")
		}
		return nil, err
	}
	return &o, nil
}

func (s *PostgresStore) GetOrganizationByID(ctx context.Context, id string) (*domain.Organization, error) {
	return scanOrganization(s.db(ctx).QueryRow(ctx,
		`SELECT `+organizationColumns+` FROM organizations WHERE id = $1`, id))
}

func (s *PostgresStore) GetOrganizationBySlug(ctx context.Context, slug string) (*domain.Organization, error) {
	return scanOrganization(s.db(ctx).QueryRow(ctx,
		`SELECT `+organizationColumns+` FROM organizations WHERE slug = $1`, slug))
}

func (s *PostgresStore) ListOrganizations(ctx context.Context) ([]domain.Organization, error) {
	rows, err := s.db(ctx).Query(ctx, `SELECT `+organizationColumns+` FROM organizations ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Organization{}
	for rows.Next() {
		var o domain.Organization
		if err := rows.Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
			&o.Status, &o.CredentialVersion, &o.StatusChangedAt, &o.StatusChangedBy,
			&o.StatusReason, &o.SuspendedAt, &o.OffboardingStartedAt, &o.TerminatedAt,
			&o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// CreateOrganization inserts a new organization. Catalog cloning is a service
// concern (F172); this only writes the identity row.
func (s *PostgresStore) CreateOrganization(ctx context.Context, o *domain.Organization) error {
	if o.Type == "" {
		o.Type = domain.OrganizationTypeFactory
	}
	plan := o.LicensePlan
	if plan == "" {
		plan = domain.LicensePlanNone
	}
	status := o.Status
	if status == "" {
		status = domain.OrganizationStatusProvisioning
	}
	if !domain.IsValidOrganizationStatus(status) {
		return fmt.Errorf("invalid organization status")
	}
	statusChangedBy := stringValue(o.StatusChangedBy)
	actor, hasActor := TenantActorFromCtx(ctx)
	if statusChangedBy == "" && hasActor && actor.UserID != "" {
		statusChangedBy = actor.UserID
	}
	err := s.db(ctx).QueryRow(ctx, `
		SELECT `+organizationColumns+`
		FROM command_create_organization(
			$1, $2, $3, $4, $5, $6, $7, nullif($8, '')::uuid, $9
		)`,
		o.Name, o.Slug, o.Type, plan, o.LicenseExpiresAt, status, stringValue(o.StatusReason), statusChangedBy, o.ParentOrganizationID).
		Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
			&o.Status, &o.CredentialVersion, &o.StatusChangedAt, &o.StatusChangedBy,
			&o.StatusReason, &o.SuspendedAt, &o.OffboardingStartedAt, &o.TerminatedAt,
			&o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version)
	if err != nil {
		return err
	}
	// The database command validated the caller and parent before insertion.
	// Extend only this transaction's exact scope: platform gets the new child;
	// Factory keeps its source plus the one child it just created.
	if hasActor && actor.UserID != "" {
		if actor.OrganizationID == "" {
			return authorizeTenantOrganizations(ctx, o.ID)
		}
		if o.ParentOrganizationID != nil && *o.ParentOrganizationID == actor.OrganizationID {
			return authorizeTenantOrganizations(ctx, actor.OrganizationID, o.ID)
		}
	}
	return nil
}

// ListConnectedOrganizations returns the sales network of a factory: the
// organizations whose parent is the given factory (#326).
func (s *PostgresStore) ListConnectedOrganizations(ctx context.Context, parentOrganizationID string) ([]domain.Organization, error) {
	rows, err := s.db(ctx).Query(ctx,
		`SELECT `+organizationColumns+` FROM organizations WHERE parent_organization_id = $1 ORDER BY created_at`,
		parentOrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Organization{}
	for rows.Next() {
		var o domain.Organization
		if err := rows.Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
			&o.Status, &o.CredentialVersion, &o.StatusChangedAt, &o.StatusChangedBy,
			&o.StatusReason, &o.SuspendedAt, &o.OffboardingStartedAt, &o.TerminatedAt,
			&o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

const membershipWithOrgColumns = `
	m.id, m.organization_id, m.user_id, m.roles, m.status, m.joined_at, m.suspended_at, m.suspended_by::text, m.suspension_reason, m.left_at, m.left_by::text, m.leave_reason, m.created_at, m.updated_at, m.version, m.credential_version, m.sessions_revoked_at,
	o.id, o.name, o.slug, o.type, o.license_plan, o.license_expires_at,
	o.status, o.credential_version, o.status_changed_at, o.status_changed_by::text,
	o.status_reason, o.suspended_at, o.offboarding_started_at, o.terminated_at,
	o.parent_organization_id, o.created_at, o.updated_at, o.version`

func scanMembershipWithOrg(row pgx.Row) (*domain.MembershipWithOrg, error) {
	var m domain.MembershipWithOrg
	err := row.Scan(&m.ID, &m.OrganizationID, &m.UserID, &m.Roles, &m.Status, &m.JoinedAt, &m.SuspendedAt, &m.SuspendedBy, &m.SuspensionReason, &m.LeftAt, &m.LeftBy, &m.LeaveReason, &m.CreatedAt, &m.UpdatedAt, &m.Version, &m.CredentialVersion, &m.SessionsRevokedAt,
		&m.Organization.ID, &m.Organization.Name, &m.Organization.Slug, &m.Organization.Type,
		&m.Organization.LicensePlan, &m.Organization.LicenseExpiresAt,
		&m.Organization.Status, &m.Organization.CredentialVersion, &m.Organization.StatusChangedAt,
		&m.Organization.StatusChangedBy, &m.Organization.StatusReason, &m.Organization.SuspendedAt,
		&m.Organization.OffboardingStartedAt, &m.Organization.TerminatedAt,
		&m.Organization.ParentOrganizationID, &m.Organization.CreatedAt, &m.Organization.UpdatedAt, &m.Organization.Version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("membership not found")
		}
		return nil, err
	}
	return &m, nil
}

// ListMembershipsByUser returns the user's memberships with their
// organizations, active memberships of active organizations only.
func (s *PostgresStore) ListMembershipsByUser(ctx context.Context, userID string) ([]domain.MembershipWithOrg, error) {
	if transactionFromContext(ctx) == nil {
		var out []domain.MembershipWithOrg
		err := s.WithinTenantTx(ctx, TenantActor{UserID: userID}, func(txCtx context.Context) error {
			var err error
			out, err = s.ListMembershipsByUser(txCtx, userID)
			return err
		})
		return out, err
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT `+membershipWithOrgColumns+`
		FROM memberships m
		JOIN organizations o ON o.id = m.organization_id
		WHERE m.user_id = $1 AND m.status = 'active' AND o.status = 'active'
		ORDER BY o.created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.MembershipWithOrg{}
	for rows.Next() {
		var m domain.MembershipWithOrg
		if err := rows.Scan(&m.ID, &m.OrganizationID, &m.UserID, &m.Roles, &m.Status, &m.JoinedAt, &m.SuspendedAt, &m.SuspendedBy, &m.SuspensionReason, &m.LeftAt, &m.LeftBy, &m.LeaveReason, &m.CreatedAt, &m.UpdatedAt, &m.Version, &m.CredentialVersion, &m.SessionsRevokedAt,
			&m.Organization.ID, &m.Organization.Name, &m.Organization.Slug, &m.Organization.Type,
			&m.Organization.LicensePlan, &m.Organization.LicenseExpiresAt,
			&m.Organization.Status, &m.Organization.CredentialVersion, &m.Organization.StatusChangedAt,
			&m.Organization.StatusChangedBy, &m.Organization.StatusReason, &m.Organization.SuspendedAt,
			&m.Organization.OffboardingStartedAt, &m.Organization.TerminatedAt,
			&m.Organization.ParentOrganizationID, &m.Organization.CreatedAt, &m.Organization.UpdatedAt, &m.Organization.Version); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// GetActiveMembership loads only an active membership with its organization.
func (s *PostgresStore) GetActiveMembership(ctx context.Context, userID, organizationID string) (*domain.MembershipWithOrg, error) {
	return scanMembershipWithOrg(s.db(ctx).QueryRow(ctx, `
		SELECT `+membershipWithOrgColumns+`
		FROM memberships m
		JOIN organizations o ON o.id = m.organization_id
		WHERE m.user_id = $1 AND m.organization_id = $2 AND m.status = 'active'`, userID, organizationID))
}

// EnsureMembership inserts a membership if the user has none in the
// organization yet. Used by approval bridging and the admin CLI.
func (s *PostgresStore) EnsureMembership(ctx context.Context, organizationID, userID string, roles []domain.UserRole) error {
	if !domain.IsValidRoleSet(roles) {
		return fmt.Errorf("invalid role set")
	}
	_, err := s.db(ctx).Exec(ctx, `
		INSERT INTO memberships (organization_id, user_id, roles, status)
		VALUES ($1, $2, $3, 'active')
		ON CONFLICT (user_id, organization_id) DO NOTHING`,
		organizationID, userID, roles)
	return err
}

// SetPlatformAdmin flips the platform staff flag (ADR-0004 §5).
func (s *PostgresStore) SetPlatformAdmin(ctx context.Context, userID string, admin bool) error {
	result, err := s.db(ctx).Exec(ctx,
		`UPDATE users SET platform_admin = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
		userID, admin)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("user not found")
	}
	return nil
}

// SecurityAuditEvent is an append-only security trail entry (ADR-0004 §7).
// Actor/target/organization are optional (e.g. failed login has no actor).
type SecurityAuditEvent struct {
	EventType      string
	ActorUserID    string
	TargetUserID   string
	OrganizationID string
	IP             string
	Details        map[string]interface{}
}

func (s *PostgresStore) InsertSecurityAuditEvent(ctx context.Context, ev SecurityAuditEvent) error {
	if transactionFromContext(ctx) == nil {
		return s.WithinTenantTx(ctx, TenantActor{OrganizationID: ev.OrganizationID, UserID: ev.ActorUserID}, func(txCtx context.Context) error {
			return s.InsertSecurityAuditEvent(txCtx, ev)
		})
	}
	_, err := s.db(ctx).Exec(ctx, `
		INSERT INTO security_audit_events (event_type, actor_user_id, target_user_id, organization_id, ip, details)
		VALUES ($1, nullif($2, '')::uuid, nullif($3, '')::uuid, nullif($4, '')::uuid, nullif($5, ''), $6::jsonb)`,
		ev.EventType, ev.ActorUserID, ev.TargetUserID, ev.OrganizationID, ev.IP, marshalDetails(ev.Details))
	return err
}

func marshalDetails(d map[string]interface{}) string {
	if len(d) == 0 {
		return "{}"
	}
	// Best-effort JSON encode; audit must never fail a request on encoding.
	buf, err := json.Marshal(d)
	if err != nil {
		return `{"encode_error": true}`
	}
	return string(buf)
}

// ListSecurityAuditEvents returns the newest events, optionally filtered by
// organization (empty string = platform-wide, platform console only).
func (s *PostgresStore) ListSecurityAuditEvents(ctx context.Context, organizationID string, limit int) ([]openapi.SecurityAuditEvent, error) {
	if organizationID != "" && transactionFromContext(ctx) != nil {
		if err := authorizeTenantOrganizations(ctx, organizationID); err != nil {
			return nil, err
		}
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db(ctx).Query(ctx, `
		SELECT id, event_type, actor_user_id, target_user_id, organization_id, COALESCE(ip, ''), details, created_at
		FROM security_audit_events
		WHERE ($1 = '' OR organization_id = $1::uuid)
		ORDER BY created_at DESC
		LIMIT $2`, organizationID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []openapi.SecurityAuditEvent{}
	for rows.Next() {
		var id, eventType, ip string
		var actor, target, org *string
		var details []byte
		var createdAt time.Time
		if err := rows.Scan(&id, &eventType, &actor, &target, &org, &ip, &details, &createdAt); err != nil {
			return nil, err
		}
		decoded := map[string]any{}
		if err := json.Unmarshal(details, &decoded); err != nil {
			return nil, err
		}
		out = append(out, openapi.SecurityAuditEvent{ID: id, EventType: eventType, ActorUserID: actor, TargetUserID: target, OrganizationID: org, IP: ip, Details: decoded, CreatedAt: createdAt.UTC().Format(time.RFC3339Nano)})
	}
	return out, rows.Err()
}

// --- Support sessions (ADR-0005 §5 / #326) ---

func (s *PostgresStore) StartSupportSession(ctx context.Context, adminUserID, organizationID, reason string, ttl time.Duration) (*domain.SupportSession, error) {
	if transactionFromContext(ctx) != nil {
		if err := authorizeTenantOrganizations(ctx, organizationID); err != nil {
			return nil, err
		}
	}
	out := &domain.SupportSession{}
	err := s.db(ctx).QueryRow(ctx, `
		INSERT INTO support_sessions (platform_admin_user_id, organization_id, reason, expires_at)
		VALUES ($1, $2, $3, NOW() + $4::interval)
		RETURNING id, platform_admin_user_id, organization_id, reason, started_at, expires_at`,
		adminUserID, organizationID, reason, fmt.Sprintf("%d seconds", int(ttl.Seconds()))).
		Scan(&out.ID, &out.PlatformAdminUserID, &out.OrganizationID, &out.Reason, &out.StartedAt, &out.ExpiresAt)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// GetOpenSupportSession returns the session when still open and unexpired.
func (s *PostgresStore) GetOpenSupportSession(ctx context.Context, sessionID string) (*domain.SupportSession, error) {
	var out domain.SupportSession
	err := s.db(ctx).QueryRow(ctx, `
		SELECT id, platform_admin_user_id, organization_id, reason, started_at, expires_at
		FROM support_sessions
		WHERE id = $1 AND ended_at IS NULL AND expires_at > NOW()`, sessionID).
		Scan(&out.ID, &out.PlatformAdminUserID, &out.OrganizationID, &out.Reason, &out.StartedAt, &out.ExpiresAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Lazy close: an open-but-expired session is finalized with
			// ended_via='expiry' so the audit trail records how it ended
			// (access was already cut per-request by the middleware check).
			_, _ = s.db(ctx).Exec(ctx, `
				UPDATE support_sessions SET ended_at = expires_at, ended_via = 'expiry'
				WHERE id = $1 AND ended_at IS NULL AND expires_at <= NOW()`, sessionID)
			return nil, fmt.Errorf("support session not found")
		}
		return nil, err
	}
	if transactionFromContext(ctx) != nil {
		if err := authorizeTenantOrganizations(ctx, out.OrganizationID); err != nil {
			return nil, err
		}
	}
	return &out, nil
}

// EndOpenSupportSessionsByOrg closes every still-open support session of an
// organization (suspension path — ended_via='org_suspended', B6).
func (s *PostgresStore) EndOpenSupportSessionsByOrg(ctx context.Context, organizationID, via string) (int64, error) {
	if transactionFromContext(ctx) != nil {
		if err := authorizeTenantOrganizations(ctx, organizationID); err != nil {
			return 0, err
		}
	}
	result, err := s.db(ctx).Exec(ctx, `
		UPDATE support_sessions SET ended_at = NOW(), ended_via = $2
		WHERE organization_id = $1 AND ended_at IS NULL`,
		organizationID, via)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

// EndSupportSession closes an open session (idempotent for already-ended).
func (s *PostgresStore) EndSupportSession(ctx context.Context, sessionID, adminUserID, via string) (bool, error) {
	result, err := s.db(ctx).Exec(ctx, `
		UPDATE support_sessions SET ended_at = NOW(), ended_via = $3
		WHERE id = $1 AND platform_admin_user_id = $2 AND ended_at IS NULL`,
		sessionID, adminUserID, via)
	if err != nil {
		return false, err
	}
	return result.RowsAffected() > 0, nil
}

// --- Org team & invitations (#326) ---

// OrgTeamMember is the membership-centric team projection. Historical
// suspended/left memberships remain visible to authorized organization admins.
type OrgTeamMember struct {
	MembershipID             string
	UserID                   string
	Email                    string
	Name                     string
	AccountStatus            domain.AccountStatus
	Status                   domain.MembershipStatus
	Roles                    []domain.UserRole
	JoinedAt                 time.Time
	Version                  int64
	LastActivity             *time.Time
	CredentialVersion        int64
	SessionsRevokedAt        *time.Time
	Sectors                  []domain.ProductionSector
	OffboardingBlockingCount int64
}

func scanOrgTeamMember(row pgx.Row) (*OrgTeamMember, error) {
	var out OrgTeamMember
	err := row.Scan(&out.MembershipID, &out.UserID, &out.Email, &out.Name,
		&out.AccountStatus, &out.Status, &out.Roles, &out.JoinedAt, &out.Version,
		&out.LastActivity, &out.CredentialVersion, &out.SessionsRevokedAt)
	return &out, err
}

// OrgTeamSummary is the tenant-scoped Team read model backed by the
// transactional counters and explicit entitlement authority.
type OrgTeamSummary struct {
	ActiveMembers       int64
	SuspendedMembers    int64
	LeftMembers         int64
	MaxActiveMembers    *int64
	TeamVersion         int64
	EntitlementsVersion int64
}

func (s *PostgresStore) GetOrgTeamSummary(ctx context.Context, organizationID, actorID string) (*OrgTeamSummary, error) {
	if transactionFromContext(ctx) == nil {
		var out *OrgTeamSummary
		err := s.WithinTenantTx(ctx, TenantActor{OrganizationID: organizationID, UserID: actorID}, func(txCtx context.Context) error {
			var inner error
			out, inner = s.GetOrgTeamSummary(txCtx, organizationID, actorID)
			return inner
		})
		return out, err
	}
	out := &OrgTeamSummary{}
	err := s.db(ctx).QueryRow(ctx, `
		SELECT state.active_member_count,
			count(*) FILTER (WHERE membership.status = 'suspended'),
			count(*) FILTER (WHERE membership.status = 'left'),
			entitlement.max_active_members, state.version, entitlement.version
		FROM organization_team_state state
		JOIN organization_entitlements entitlement ON entitlement.organization_id = state.organization_id
		LEFT JOIN memberships membership ON membership.organization_id = state.organization_id
		WHERE state.organization_id = $1
		GROUP BY state.active_member_count, entitlement.max_active_members, state.version, entitlement.version`, organizationID).Scan(
		&out.ActiveMembers, &out.SuspendedMembers, &out.LeftMembers, &out.MaxActiveMembers, &out.TeamVersion, &out.EntitlementsVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrMembershipNotFound
	}
	return out, err
}

func (s *PostgresStore) ListOrgTeam(ctx context.Context, organizationID, actorID string) ([]OrgTeamMember, error) {
	if transactionFromContext(ctx) == nil {
		var out []OrgTeamMember
		err := s.WithinTenantTx(ctx, TenantActor{OrganizationID: organizationID, UserID: actorID}, func(txCtx context.Context) error {
			var inner error
			out, inner = s.ListOrgTeam(txCtx, organizationID, actorID)
			return inner
		})
		return out, err
	}
	rows, err := s.db(ctx).Query(ctx, `SELECT m.id, u.id, u.email, u.name,
		u.account_status, m.status, m.roles, m.joined_at, m.version,
		u.last_login_at, m.credential_version, m.sessions_revoked_at
		FROM memberships m JOIN users u ON u.id=m.user_id
		WHERE m.organization_id=$1 ORDER BY m.joined_at`, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OrgTeamMember{}
	for rows.Next() {
		m, err := scanOrgTeamMember(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	detailRows, err := s.db(ctx).Query(ctx, `
		SELECT m.id,
			COALESCE(array_agg(DISTINCT ms.sector ORDER BY ms.sector) FILTER (WHERE ms.sector IS NOT NULL), '{}'),
			count(DISTINCT pa.id) FILTER (WHERE pa.finished_at IS NULL)
		FROM memberships m
		LEFT JOIN membership_sectors ms ON ms.membership_id=m.id AND ms.organization_id=m.organization_id
		LEFT JOIN production_activities pa ON pa.organization_id=m.organization_id AND pa.operator_id=m.user_id::text AND pa.type='claim'
		WHERE m.organization_id=$1
		GROUP BY m.id`, organizationID)
	if err != nil {
		return nil, err
	}
	defer detailRows.Close()
	details := make(map[string]struct {
		sectors  []domain.ProductionSector
		blockers int64
	})
	for detailRows.Next() {
		var membershipID string
		var sectors []domain.ProductionSector
		var blockers int64
		if err := detailRows.Scan(&membershipID, &sectors, &blockers); err != nil {
			return nil, err
		}
		details[membershipID] = struct {
			sectors  []domain.ProductionSector
			blockers int64
		}{sectors: sectors, blockers: blockers}
	}
	if err := detailRows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		detail := details[out[i].MembershipID]
		out[i].Sectors = detail.sectors
		out[i].OffboardingBlockingCount = detail.blockers
		if out[i].Sectors == nil {
			out[i].Sectors = []domain.ProductionSector{}
		}
	}
	return out, nil
}

func classifyMembershipMiss(ctx context.Context, db dbtx, organizationID, membershipID string) error {
	var version int64
	err := db.QueryRow(ctx, `SELECT version FROM memberships WHERE id=$1 AND organization_id=$2`, membershipID, organizationID).Scan(&version)
	if err == nil {
		return ErrVersionConflict
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrMembershipNotFound
	}
	return err
}

// UpdateMembershipRolesByOrg addresses the tenant-owned membership ID, never
// a globally meaningful user ID.
func (s *PostgresStore) UpdateMembershipRolesByOrg(ctx context.Context, organizationID, membershipID string, roles []domain.UserRole, expectedVersion int64) (*OrgTeamMember, error) {
	if !domain.IsValidRoleSet(roles) {
		return nil, fmt.Errorf("invalid role set")
	}
	var organizationType domain.OrganizationType
	if err := s.db(ctx).QueryRow(ctx, `SELECT type FROM organizations WHERE id=$1`, organizationID).Scan(&organizationType); err != nil {
		return nil, err
	}
	rows, err := s.db(ctx).Query(ctx, `SELECT sector FROM membership_sectors WHERE organization_id=$1 AND membership_id=$2 ORDER BY sector`, organizationID, membershipID)
	if err != nil {
		return nil, err
	}
	sectors := []domain.ProductionSector{}
	for rows.Next() {
		var sector domain.ProductionSector
		if err := rows.Scan(&sector); err != nil {
			rows.Close()
			return nil, err
		}
		sectors = append(sectors, sector)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	if !sectorsCompatibleWithMembership(sectors, roles, organizationType) {
		return nil, ErrSectorAssignmentInvalid
	}
	out, err := scanOrgTeamMember(s.db(ctx).QueryRow(ctx, `
		UPDATE memberships m SET roles=$3, updated_at=NOW(), version=version+1
		FROM users u WHERE m.id=$2 AND m.organization_id=$1 AND m.version=$4 AND u.id=m.user_id
		RETURNING m.id,u.id,u.email,u.name,u.account_status,m.status,m.roles,m.joined_at,m.version,u.last_login_at,m.credential_version,m.sessions_revoked_at`,
		organizationID, membershipID, roles, expectedVersion))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, classifyMembershipMiss(ctx, s.db(ctx), organizationID, membershipID)
	}
	return out, err
}

func (s *PostgresStore) UpdateMembershipStatus(ctx context.Context, organizationID, membershipID string, status domain.MembershipStatus, reason, actorID string, expectedVersion int64) (*OrgTeamMember, error) {
	if status != domain.MembershipStatusActive && status != domain.MembershipStatusSuspended && status != domain.MembershipStatusLeft {
		return nil, fmt.Errorf("invalid membership status")
	}
	out, err := scanOrgTeamMember(s.db(ctx).QueryRow(ctx, `
		UPDATE memberships m SET status=$3,
			suspended_at=CASE WHEN $3='suspended' THEN NOW() ELSE NULL END,
			suspended_by=CASE WHEN $3='suspended' THEN NULLIF($5,'')::uuid ELSE NULL END,
			suspension_reason=CASE WHEN $3='suspended' THEN NULLIF($4,'') ELSE NULL END,
			left_at=CASE WHEN $3='left' THEN NOW() ELSE NULL END,
			left_by=CASE WHEN $3='left' THEN NULLIF($5,'')::uuid ELSE NULL END,
			leave_reason=CASE WHEN $3='left' THEN NULLIF($4,'') ELSE NULL END,
			credential_version=CASE WHEN m.status='active' AND $3 IN ('suspended','left') THEN credential_version+1 ELSE credential_version END,
			sessions_revoked_at=CASE WHEN m.status='active' AND $3 IN ('suspended','left') THEN NOW() ELSE sessions_revoked_at END,
			sessions_revoked_by=CASE WHEN m.status='active' AND $3 IN ('suspended','left') THEN NULLIF($5,'')::uuid ELSE sessions_revoked_by END,
			sessions_revocation_reason=CASE WHEN m.status='active' AND $3 IN ('suspended','left') THEN NULLIF($4,'') ELSE sessions_revocation_reason END,
			updated_at=NOW(), version=version+1
		FROM users u WHERE m.id=$2 AND m.organization_id=$1 AND m.version=$6 AND u.id=m.user_id
		RETURNING m.id,u.id,u.email,u.name,u.account_status,m.status,m.roles,m.joined_at,m.version,u.last_login_at,m.credential_version,m.sessions_revoked_at`,
		organizationID, membershipID, status, reason, actorID, expectedVersion))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, classifyMembershipMiss(ctx, s.db(ctx), organizationID, membershipID)
	}
	return out, err
}

// RevokeMembershipSessions invalidates every token issued for a tenant-scoped
// membership without changing its lifecycle state.
func (s *PostgresStore) RevokeMembershipSessions(ctx context.Context, organizationID, membershipID, actorID, reason string, expectedVersion int64) (*OrgTeamMember, error) {
	out, err := scanOrgTeamMember(s.db(ctx).QueryRow(ctx, `
		UPDATE memberships m SET credential_version=credential_version+1,
			sessions_revoked_at=NOW(), sessions_revoked_by=NULLIF($3,'')::uuid,
			sessions_revocation_reason=NULLIF($4,''), updated_at=NOW(), version=version+1
		FROM users u WHERE m.id=$2 AND m.organization_id=$1 AND m.version=$5 AND u.id=m.user_id
		RETURNING m.id,u.id,u.email,u.name,u.account_status,m.status,m.roles,m.joined_at,m.version,u.last_login_at,m.credential_version,m.sessions_revoked_at`,
		organizationID, membershipID, actorID, reason, expectedVersion))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, classifyMembershipMiss(ctx, s.db(ctx), organizationID, membershipID)
	}
	return out, err
}

type Invitation struct {
	ID              string
	OrganizationID  string
	Email           string
	NormalizedEmail string
	Roles           []domain.UserRole
	Status          string
	ExpiresAt       time.Time
	InvitedBy       *string
	AcceptedAt      *time.Time
	AcceptedBy      *string
	RevokedAt       *time.Time
	RevokedBy       *string
	RevokedReason   *string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	Version         int64
}

const invitationColumns = `id,organization_id,email,normalized_email,roles,status,expires_at,
	invited_by::text,accepted_at,accepted_by::text,revoked_at,revoked_by::text,revoked_reason,created_at,updated_at,version`

func scanInvitation(row pgx.Row) (*Invitation, error) {
	var i Invitation
	err := row.Scan(&i.ID, &i.OrganizationID, &i.Email, &i.NormalizedEmail, &i.Roles, &i.Status, &i.ExpiresAt,
		&i.InvitedBy, &i.AcceptedAt, &i.AcceptedBy, &i.RevokedAt, &i.RevokedBy, &i.RevokedReason, &i.CreatedAt, &i.UpdatedAt, &i.Version)
	return &i, err
}

var (
	ErrInvitationNotFound           = errors.New("invitation not found")
	ErrInvitationExpired            = errors.New("invitation expired")
	ErrInvitationRevoked            = errors.New("invitation revoked")
	ErrInvitationAlreadyUsed        = errors.New("invitation already used")
	ErrInvitationTokenRotated       = errors.New("invitation token rotated")
	ErrAccountDisabled              = errors.New("account disabled")
	ErrInvalidInvitationCredentials = errors.New("invalid invitation credentials")
	ErrInvitationNameRequired       = errors.New("invitation name required")
	ErrInvitationPasswordInvalid    = errors.New("invitation password invalid")
	ErrMembershipAlreadyActive      = errors.New("membership already active")
)

func (s *PostgresStore) expireOpenInvitations(ctx context.Context, organizationID, normalizedEmail, actorID string) error {
	rows, err := s.db(ctx).Query(ctx, `UPDATE invitations SET status='expired',updated_at=NOW(),version=version+1
		WHERE organization_id=$1 AND ($2='' OR normalized_email=$2) AND status IN ('pending','delivered','opened') AND expires_at<=NOW()
		RETURNING id`, organizationID, normalizedEmail)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{EventType: "invitation_expired", ActorUserID: actorID, OrganizationID: organizationID, Details: map[string]interface{}{"invitation_id": id}}); err != nil {
			return err
		}
	}
	return rows.Err()
}

func (s *PostgresStore) CreateInvitation(ctx context.Context, organizationID, email string, roles []domain.UserRole, tokenHash string, expiresAt time.Time, invitedBy string) (*Invitation, error) {
	if !domain.IsValidRoleSet(roles) {
		return nil, fmt.Errorf("invalid role set")
	}
	normalized := domain.NormalizeEmail(email)
	if err := s.expireOpenInvitations(ctx, organizationID, normalized, invitedBy); err != nil {
		return nil, err
	}
	return scanInvitation(s.db(ctx).QueryRow(ctx, `INSERT INTO invitations
		(organization_id,email,normalized_email,roles,status,token_hash,expires_at,invited_by)
		VALUES ($1,$2,$3,$4,'pending',$5,$6,NULLIF($7,'')::uuid) RETURNING `+invitationColumns,
		organizationID, strings.TrimSpace(email), normalized, roles, tokenHash, expiresAt, invitedBy))
}

func (s *PostgresStore) ListInvitations(ctx context.Context, organizationID, actorID string) ([]Invitation, error) {
	if transactionFromContext(ctx) == nil {
		var out []Invitation
		err := s.WithinTenantTx(ctx, TenantActor{OrganizationID: organizationID, UserID: actorID}, func(txCtx context.Context) error {
			var inner error
			out, inner = s.ListInvitations(txCtx, organizationID, actorID)
			return inner
		})
		return out, err
	}
	if err := s.expireOpenInvitations(ctx, organizationID, "", actorID); err != nil {
		return nil, err
	}
	rows, err := s.db(ctx).Query(ctx, `SELECT `+invitationColumns+` FROM invitations WHERE organization_id=$1 ORDER BY created_at DESC`, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Invitation{}
	for rows.Next() {
		i, err := scanInvitation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *i)
	}
	return out, rows.Err()
}

func (s *PostgresStore) ResendInvitation(ctx context.Context, organizationID, id, tokenHash string, expiresAt time.Time, expectedVersion int64) (*Invitation, error) {
	out, err := scanInvitation(s.db(ctx).QueryRow(ctx, `UPDATE invitations SET token_hash=$3,status='pending',expires_at=$4,
		previous_token_hashes=array_append(previous_token_hashes,token_hash),
		accepted_at=NULL,accepted_by=NULL,revoked_at=NULL,revoked_by=NULL,revoked_reason=NULL,updated_at=NOW(),version=version+1
		WHERE id=$2 AND organization_id=$1 AND version=$5 AND status IN ('pending','delivered','opened','expired') RETURNING `+invitationColumns,
		organizationID, id, tokenHash, expiresAt, expectedVersion))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, classifyInvitationMiss(ctx, s.db(ctx), organizationID, id)
	}
	return out, err
}

func classifyInvitationMiss(ctx context.Context, db dbtx, organizationID, id string) error {
	var version int64
	err := db.QueryRow(ctx, `SELECT version FROM invitations WHERE id=$1 AND organization_id=$2`, id, organizationID).Scan(&version)
	if err == nil {
		return ErrVersionConflict
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvitationNotFound
	}
	return err
}

func (s *PostgresStore) RevokeInvitation(ctx context.Context, organizationID, id, reason, actorID string, expectedVersion int64) (*Invitation, error) {
	out, err := scanInvitation(s.db(ctx).QueryRow(ctx, `UPDATE invitations SET status='revoked',revoked_at=NOW(),revoked_by=NULLIF($4,'')::uuid,
		revoked_reason=$3,updated_at=NOW(),version=version+1 WHERE id=$2 AND organization_id=$1 AND version=$5
		AND status IN ('pending','delivered','opened','expired') RETURNING `+invitationColumns, organizationID, id, reason, actorID, expectedVersion))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, classifyInvitationMiss(ctx, s.db(ctx), organizationID, id)
	}
	return out, err
}

type AcceptInvitationCommand struct{ TokenHash, Password, NewPasswordHash, Name, IP string }
type AcceptInvitationResult struct {
	User                     domain.User
	Membership               domain.Membership
	Organization             domain.Organization
	CreatedUser, Reactivated bool
}

// RecordInvitationAcceptanceFailure resolves only the exact token row through
// the narrow SECURITY DEFINER boundary and stores no credential, email, token
// or token hash in audit details.
func (s *PostgresStore) RecordInvitationAcceptanceFailure(ctx context.Context, tokenHash, reason, ip string) error {
	if transactionFromContext(ctx) == nil {
		tx, err := s.Pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)
		txCtx := context.WithValue(ctx, transactionContextKey{}, tx)
		if err := s.RecordInvitationAcceptanceFailure(txCtx, tokenHash, reason, ip); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	var id, organizationID string
	var discard [13]interface{}
	var organizationType string
	var currentToken bool
	row := s.db(ctx).QueryRow(ctx, `SELECT id,normalized_email,roles,status,expires_at,invited_by,accepted_at,accepted_by,revoked_at,revoked_by,revoked_reason,created_at,updated_at,version,organization_id,organization_type,current_token FROM lock_open_invitation_by_hash($1)`, tokenHash)
	args := []interface{}{&id}
	for i := range discard {
		args = append(args, &discard[i])
	}
	args = append(args, &organizationID, &organizationType, &currentToken)
	if err := row.Scan(args...); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	if tx := transactionFromContext(ctx); tx != nil {
		if err := setTenantContext(ctx, tx, TenantActor{OrganizationID: organizationID}); err != nil {
			return err
		}
	}
	if reason == "INVITATION_EXPIRED" && currentToken {
		tag, err := s.db(ctx).Exec(ctx, `UPDATE invitations
			SET status='expired',updated_at=NOW(),version=version+1
			WHERE id=$1 AND status IN ('pending','delivered','opened') AND expires_at<=NOW()`, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 1 {
			if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{EventType: "invitation_expired", OrganizationID: organizationID, Details: map[string]interface{}{"invitation_id": id}}); err != nil {
				return err
			}
		}
	}
	if reason == "SEAT_LIMIT_REACHED" {
		if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{EventType: "seat_limit_blocked", OrganizationID: organizationID, IP: ip, Details: map[string]interface{}{"invitation_id": id, "command": "accept_invitation"}}); err != nil {
			return err
		}
	}
	return s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{EventType: "invitation_acceptance_failed", OrganizationID: organizationID, IP: ip, Details: map[string]interface{}{"invitation_id": id, "reason": reason}})
}

// AcceptInvitation atomically locks the exact invitation before identity lookup,
// creates or verifies the identity, creates/reactivates only the inviting
// organization's membership, consumes the invitation and writes required audit.
func (s *PostgresStore) AcceptInvitation(ctx context.Context, cmd AcceptInvitationCommand, verifyPassword func(string, string) bool, validateNewPassword func(string) error) (*AcceptInvitationResult, error) {
	tx, owned, err := s.beginOrUseTx(ctx)
	if err != nil {
		return nil, err
	}
	if owned {
		defer tx.Rollback(ctx)
	}
	ctx = context.WithValue(ctx, transactionContextKey{}, tx)
	var inv Invitation
	var orgType domain.OrganizationType
	var currentToken bool
	err = tx.QueryRow(ctx, `SELECT id,normalized_email,roles,status,expires_at,
		invited_by::text,accepted_at,accepted_by::text,revoked_at,revoked_by::text,revoked_reason,created_at,updated_at,version,organization_id,organization_type
		,current_token
		FROM lock_open_invitation_by_hash($1)`, cmd.TokenHash).Scan(&inv.ID, &inv.NormalizedEmail, &inv.Roles, &inv.Status, &inv.ExpiresAt,
		&inv.InvitedBy, &inv.AcceptedAt, &inv.AcceptedBy, &inv.RevokedAt, &inv.RevokedBy, &inv.RevokedReason, &inv.CreatedAt, &inv.UpdatedAt, &inv.Version, &inv.OrganizationID, &orgType, &currentToken)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvitationNotFound
	}
	if err != nil {
		return nil, err
	}
	if !currentToken {
		return nil, ErrInvitationTokenRotated
	}
	switch inv.Status {
	case "accepted":
		return nil, ErrInvitationAlreadyUsed
	case "revoked":
		return nil, ErrInvitationRevoked
	case "expired":
		return nil, ErrInvitationExpired
	}
	if !inv.ExpiresAt.After(time.Now()) {
		return nil, ErrInvitationExpired
	}
	if !domain.RolesAllowedInOrg(inv.Roles, orgType) {
		return nil, fmt.Errorf("invitation role set invalid")
	}
	inv.Email = inv.NormalizedEmail
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, inv.NormalizedEmail); err != nil {
		return nil, err
	}
	if err = setTenantContext(ctx, tx, TenantActor{OrganizationID: inv.OrganizationID}); err != nil {
		return nil, err
	}

	result := &AcceptInvitationResult{}
	u, lookupErr := scanUser(tx.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE normalized_email=$1 FOR UPDATE`, inv.NormalizedEmail))
	if lookupErr != nil && !errors.Is(lookupErr, ErrUserNotFound) {
		return nil, lookupErr
	}
	if u == nil {
		if strings.TrimSpace(cmd.Name) == "" {
			return nil, ErrInvitationNameRequired
		}
		if cmd.NewPasswordHash == "" {
			return nil, ErrInvalidInvitationCredentials
		}
		if validateNewPassword == nil || validateNewPassword(cmd.Password) != nil {
			return nil, ErrInvitationPasswordInvalid
		}
		u = &domain.User{Email: inv.NormalizedEmail, NormalizedEmail: inv.NormalizedEmail, Name: strings.TrimSpace(cmd.Name), PasswordHash: cmd.NewPasswordHash, AccountStatus: domain.AccountStatusActive}
		err = tx.QueryRow(ctx, `INSERT INTO users(email,normalized_email,password_hash,name,account_status) VALUES($1,$2,$3,$4,'active') RETURNING `+userColumns,
			u.Email, u.NormalizedEmail, u.PasswordHash, u.Name).Scan(&u.ID, &u.Email, &u.NormalizedEmail, &u.PasswordHash, &u.Name, &u.AccountStatus, &u.EmailVerifiedAt, &u.LastLoginAt, &u.PlatformAdmin, &u.CreatedAt, &u.UpdatedAt)
		if err != nil {
			return nil, err
		}
		result.CreatedUser = true
	} else {
		if u.AccountStatus != domain.AccountStatusActive {
			return nil, ErrAccountDisabled
		}
		if verifyPassword == nil || !verifyPassword(cmd.Password, u.PasswordHash) {
			return nil, ErrInvalidInvitationCredentials
		}
	}
	ctx, err = s.SetTenantActor(ctx, TenantActor{OrganizationID: inv.OrganizationID, UserID: u.ID})
	if err != nil {
		return nil, err
	}

	var previousStatus domain.MembershipStatus
	previousErr := tx.QueryRow(ctx, `SELECT status FROM memberships WHERE organization_id=$1 AND user_id=$2 FOR UPDATE`, inv.OrganizationID, u.ID).Scan(&previousStatus)
	if previousErr != nil && !errors.Is(previousErr, pgx.ErrNoRows) {
		return nil, previousErr
	}
	var m domain.Membership
	err = tx.QueryRow(ctx, `INSERT INTO memberships(organization_id,user_id,roles,status) VALUES($1,$2,$3,'active')
		ON CONFLICT(user_id,organization_id) DO UPDATE SET roles=EXCLUDED.roles,status='active',suspended_at=NULL,suspended_by=NULL,suspension_reason=NULL,left_at=NULL,left_by=NULL,leave_reason=NULL,updated_at=NOW(),version=memberships.version+1
		RETURNING id,organization_id,user_id,roles,status,joined_at,created_at,updated_at,version,credential_version`, inv.OrganizationID, u.ID, inv.Roles).
		Scan(&m.ID, &m.OrganizationID, &m.UserID, &m.Roles, &m.Status, &m.JoinedAt, &m.CreatedAt, &m.UpdatedAt, &m.Version, &m.CredentialVersion)
	if err != nil {
		return nil, err
	}
	result.Reactivated = previousErr == nil && previousStatus != domain.MembershipStatusActive
	if previousErr == nil && previousStatus == domain.MembershipStatusActive {
		return nil, ErrMembershipAlreadyActive
	}
	if _, err = tx.Exec(ctx, `UPDATE users SET last_login_at=NOW(),updated_at=NOW() WHERE id=$1`, u.ID); err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `UPDATE invitations SET status='accepted',accepted_at=NOW(),accepted_by=$2,updated_at=NOW(),version=version+1 WHERE id=$1 AND status IN ('pending','delivered','opened')`, inv.ID, u.ID); err != nil {
		return nil, err
	}
	membershipEvent := "membership_created"
	if result.Reactivated {
		membershipEvent = "membership_reactivated"
	}
	for _, event := range []string{"invitation_accepted", membershipEvent} {
		if err = s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{EventType: event, ActorUserID: u.ID, TargetUserID: u.ID, OrganizationID: inv.OrganizationID, IP: cmd.IP, Details: map[string]interface{}{"invitation_id": inv.ID, "membership_id": m.ID}}); err != nil {
			return nil, err
		}
	}
	org, err := scanOrganization(tx.QueryRow(ctx, `SELECT `+organizationColumns+` FROM organizations WHERE id=$1`, inv.OrganizationID))
	if err != nil {
		return nil, err
	}
	result.User = *u
	result.Membership = m
	result.Organization = *org
	if owned {
		if err = tx.Commit(ctx); err != nil {
			return nil, err
		}
	}
	return result, nil
}

// jsonbRemapKey returns a SQL expression that rewrites `key` inside every
// element of a JSONB array of objects using an old→new id map table.
// F179: jsonb_agg over an EMPTY array yields NULL, but columns like
// structures.agregados / modules.agregados are NOT NULL ('[]' is the common
// real-world value) — COALESCE keeps empty arrays empty instead of failing
// the clone.
func jsonbRemapKey(col, key, mapTable string) string {
	return fmt.Sprintf(`CASE WHEN s.%[1]s IS NULL THEN NULL ELSE COALESCE((
		SELECT jsonb_agg(jsonb_set(el, '{%[2]s}',
			COALESCE((SELECT to_jsonb(mt.new_id::text) FROM %[3]s mt WHERE mt.old_id::text = el->>'%[2]s'), el->'%[2]s')))
		FROM jsonb_array_elements(s.%[1]s) el), '[]'::jsonb) END`, col, key, mapTable)
}

// CloneCatalog copies an organization's entire catalog (categories, boards,
// edges, hardwares, components, agregados, option groups, structures,
// modules + children) into a destination organization with fresh UUIDs and
// full FK/JSONB id remapping (ADR-0005 §4: cloned catalogs, every row owned).
// structure_revisions history is intentionally NOT cloned — the current
// revision travels with the structures row.
func (s *PostgresStore) CloneCatalog(ctx context.Context, srcOrg, dstOrg string) error {
	tx, owned, err := s.beginOrUseTx(ctx)
	if err != nil {
		return err
	}
	if owned {
		defer tx.Rollback(ctx)
		ctx = context.WithValue(ctx, transactionContextKey{}, tx)
	}
	if err := authorizeTenantOrganizations(ctx, srcOrg, dstOrg); err != nil {
		return err
	}

	maps := []struct{ name, table string }{
		{"tmp_matcat", "material_categories"},
		{"tmp_modcat", "module_categories"},
		{"tmp_ambcat", "ambient_categories"},
		{"tmp_boards", "material_boards"},
		{"tmp_edges", "edge_bands"},
		{"tmp_hw", "hardwares"},
		{"tmp_comp", "components"},
		{"tmp_agr", "agregados"},
		{"tmp_struct", "structures"},
		{"tmp_optgrp", "option_groups"},
		{"tmp_modules", "modules"},
	}

	// The destination must be empty across EVERY table the clone writes —
	// both the mapped roots and the child tables the steps populate
	// (ambient_materials, board_parts, structure children…). Checking only
	// the roots let a destination with stray child rows pass the guard and
	// fail mid-transaction on UNIQUE(organization_id, code).
	dstTables := []string{
		"material_categories", "module_categories", "ambient_categories",
		"material_boards", "edge_bands", "hardwares", "components", "agregados",
		"option_groups", "option_group_members", "structures",
		"structure_components", "structure_presets", "modules",
		"board_parts", "hardware_lines", "module_components", "module_presets",
		"ambient_materials",
	}
	for _, table := range dstTables {
		var existing int
		if err := tx.QueryRow(ctx,
			`SELECT COUNT(*) FROM `+table+` WHERE organization_id = $1`, dstOrg).Scan(&existing); err != nil {
			return err
		}
		if existing > 0 {
			return fmt.Errorf("destination catalog is not empty: %s", table)
		}
	}
	for _, m := range maps {
		// F179: ON COMMIT DROP — temp tables live for the whole pooled
		// SESSION, so a second clone reusing the same server connection
		// crashed with "relation already exists" (the pilot onboarding of a
		// second organization on a long-lived server). Scope them to the
		// transaction instead.
		if _, err := tx.Exec(ctx, fmt.Sprintf(`CREATE TEMP TABLE %s ON COMMIT DROP AS
			SELECT id AS old_id, uuid_generate_v4() AS new_id FROM %s WHERE organization_id = $1`, m.name, m.table), srcOrg); err != nil {
			return fmt.Errorf("map %s: %w", m.name, err)
		}
		if _, err := tx.Exec(ctx, fmt.Sprintf(`CREATE UNIQUE INDEX ON %s(old_id)`, m.name)); err != nil {
			return err
		}
	}

	steps := []struct {
		name   string
		params int // 2 = (src, dst); 1 = (dst) — src filtering already in temp maps
		sql    string
	}{
		{"material_categories", 1, `INSERT INTO material_categories (id, organization_id, name, parent_id, sort_order)
			SELECT m.new_id, $2, s.name, pm.new_id, s.sort_order
			FROM material_categories s
			JOIN tmp_matcat m ON m.old_id = s.id
			LEFT JOIN tmp_matcat pm ON pm.old_id = s.parent_id`},
		{"module_categories", 1, `INSERT INTO module_categories (id, organization_id, name, parent_id, sort_order)
			SELECT m.new_id, $2, s.name, pm.new_id, s.sort_order
			FROM module_categories s
			JOIN tmp_modcat m ON m.old_id = s.id
			LEFT JOIN tmp_modcat pm ON pm.old_id = s.parent_id`},
		{"ambient_categories", 1, `INSERT INTO ambient_categories (id, organization_id, name, parent_id, sort_order)
			SELECT m.new_id, $2, s.name, pm.new_id, s.sort_order
			FROM ambient_categories s
			JOIN tmp_ambcat m ON m.old_id = s.id
			LEFT JOIN tmp_ambcat pm ON pm.old_id = s.parent_id`},
		{"edge_bands", 1, `INSERT INTO edge_bands (id, organization_id, code, name, thickness_mm, cost_per_ml, notes, active, preview_color)
			SELECT m.new_id, $2, s.code, s.name, s.thickness_mm, s.cost_per_ml, s.notes, s.active, s.preview_color
			FROM edge_bands s JOIN tmp_edges m ON m.old_id = s.id`},
		{"hardwares", 1, `INSERT INTO hardwares (id, organization_id, code, name, unit, cost_per_unit, notes, active, image_url, package_size,
				preview_shape, preview_size_mm, preview_projection_mm, preview_diameter_mm, preview_color, preview_roughness,
				preview_metalness, preview_clearcoat, part_finishes, machining)
			SELECT m.new_id, $2, s.code, s.name, s.unit, s.cost_per_unit, s.notes, s.active, s.image_url, s.package_size,
				s.preview_shape, s.preview_size_mm, s.preview_projection_mm, s.preview_diameter_mm, s.preview_color, s.preview_roughness,
				s.preview_metalness, s.preview_clearcoat, s.part_finishes, s.machining
			FROM hardwares s JOIN tmp_hw m ON m.old_id = s.id`},
		{"components", 1, `INSERT INTO components (id, organization_id, code, name, placement, geometry_kind, length_mm, width_mm, thickness_mm,
				default_edges, option_roles, notes, active, length_formula, width_formula, x_formula, y_formula, z_formula,
				rotate_x, rotate_y, rotate_z)
			SELECT m.new_id, $2, s.code, s.name, s.placement, s.geometry_kind, s.length_mm, s.width_mm, s.thickness_mm,
				s.default_edges, s.option_roles, s.notes, s.active, s.length_formula, s.width_formula, s.x_formula, s.y_formula, s.z_formula,
				s.rotate_x, s.rotate_y, s.rotate_z
			FROM components s JOIN tmp_comp m ON m.old_id = s.id`},
		{"agregados", 1, fmt.Sprintf(`INSERT INTO agregados (id, organization_id, code, name, description, components, active, notes,
				width_mm, height_mm, depth_mm, hardware_lines)
			SELECT m.new_id, $2, s.code, s.name, s.description, %s, s.active, s.notes,
				s.width_mm, s.height_mm, s.depth_mm, %s
			FROM agregados s JOIN tmp_agr m ON m.old_id = s.id`,
			jsonbRemapKey("components", "componentId", "tmp_comp"),
			jsonbRemapKey("hardware_lines", "hardware_id", "tmp_hw"))},
		{"ambient_materials", 2, `INSERT INTO ambient_materials (id, organization_id, code, name, active, surface_type, preview_color,
				preview_texture_url, preview_texture_tile_width_mm, preview_texture_tile_length_mm, preview_roughness,
				preview_metalness, preview_clearcoat, category_id)
			SELECT gen_random_uuid(), $2, s.code, s.name, s.active, s.surface_type, s.preview_color,
				s.preview_texture_url, s.preview_texture_tile_width_mm, s.preview_texture_tile_length_mm, s.preview_roughness,
				s.preview_metalness, s.preview_clearcoat, cm.new_id
			FROM ambient_materials s
			LEFT JOIN tmp_ambcat cm ON cm.old_id = s.category_id
			WHERE s.organization_id = $1`},
		{"material_boards", 1, `INSERT INTO material_boards (id, organization_id, code, name, width_mm, length_mm, thickness_mm, board_price,
				waste_percent, notes, active, default_edge_band_id, grain_default, image_url, preview_color, preview_texture_url,
				preview_texture_tile_width_mm, preview_texture_tile_length_mm, preview_roughness, preview_metalness,
				preview_clearcoat, manufacturer, category_id)
			SELECT m.new_id, $2, s.code, s.name, s.width_mm, s.length_mm, s.thickness_mm, s.board_price,
				s.waste_percent, s.notes, s.active, em.new_id, s.grain_default, s.image_url, s.preview_color, s.preview_texture_url,
				s.preview_texture_tile_width_mm, s.preview_texture_tile_length_mm, s.preview_roughness, s.preview_metalness,
				s.preview_clearcoat, s.manufacturer, cm.new_id
			FROM material_boards s
			JOIN tmp_boards m ON m.old_id = s.id
			LEFT JOIN tmp_edges em ON em.old_id = s.default_edge_band_id
			LEFT JOIN tmp_matcat cm ON cm.old_id = s.category_id`},
		{"option_groups", 1, `INSERT INTO option_groups (id, organization_id, code, name, kind, required)
			SELECT m.new_id, $2, s.code, s.name, s.kind, s.required
			FROM option_groups s JOIN tmp_optgrp m ON m.old_id = s.id`},
		{"option_group_members", 1, `INSERT INTO option_group_members (option_group_id, entity_id, organization_id)
			SELECT gm.new_id,
				COALESCE(b.new_id, h.new_id, e.new_id, om.entity_id), $2
			FROM option_group_members om
			JOIN option_groups s ON s.id = om.option_group_id AND s.organization_id = $1
			JOIN tmp_optgrp gm ON gm.old_id = om.option_group_id
			LEFT JOIN tmp_boards b ON s.kind = 'board' AND b.old_id = om.entity_id
			LEFT JOIN tmp_hw h ON s.kind = 'hardware' AND h.old_id = om.entity_id
			LEFT JOIN tmp_edges e ON s.kind = 'edge' AND e.old_id = om.entity_id`},
		{"structures", 1, fmt.Sprintf(`INSERT INTO structures (id, organization_id, code, name, width_mm, height_mm, depth_mm, notes,
				active, revision, agregados, joint_drilling_rules)
			SELECT m.new_id, $2, s.code, s.name, s.width_mm, s.height_mm, s.depth_mm, s.notes,
				s.active, s.revision, %s, s.joint_drilling_rules
			FROM structures s JOIN tmp_struct m ON m.old_id = s.id`,
			jsonbRemapKey("agregados", "agregado_id", "tmp_agr"))},
		{"structure_components", 1, `INSERT INTO structure_components (id, organization_id, structure_id, component_id, quantity,
				placement_override, overrides)
			SELECT gen_random_uuid(), $2, sm.new_id, cm.new_id, s.quantity, s.placement_override, s.overrides
			FROM structure_components s
			JOIN tmp_struct sm ON sm.old_id = s.structure_id
			LEFT JOIN tmp_comp cm ON cm.old_id = s.component_id`},
		{"structure_presets", 1, `INSERT INTO structure_presets (id, organization_id, structure_id, name, width_mm, height_mm, depth_mm)
			SELECT gen_random_uuid(), $2, sm.new_id, s.name, s.width_mm, s.height_mm, s.depth_mm
			FROM structure_presets s JOIN tmp_struct sm ON sm.old_id = s.structure_id`},
		{"modules", 1, fmt.Sprintf(`INSERT INTO modules (id, organization_id, code, name, base_labor_cost, width_mm, height_mm, depth_mm,
				notes, category_id, image_url, structure_id, furniture_type, base_mode, base_clearance_mm, agregados)
			SELECT m.new_id, $2, s.code, s.name, s.base_labor_cost, s.width_mm, s.height_mm, s.depth_mm,
				s.notes, cm.new_id, s.image_url, st.new_id, s.furniture_type, s.base_mode, s.base_clearance_mm, %s
			FROM modules s
			JOIN tmp_modules m ON m.old_id = s.id
			LEFT JOIN tmp_modcat cm ON cm.old_id = s.category_id
			LEFT JOIN tmp_struct st ON st.old_id = s.structure_id`,
			jsonbRemapKey("agregados", "agregado_id", "tmp_agr"))},
		{"board_parts", 1, `INSERT INTO board_parts (id, organization_id, module_id, code, description, quantity, length_mm, width_mm, option_role,
				edge_l1, edge_l2, edge_w1, edge_w2)
			SELECT gen_random_uuid(), $2, mm.new_id, s.code, s.description, s.quantity, s.length_mm, s.width_mm, s.option_role,
				s.edge_l1, s.edge_l2, s.edge_w1, s.edge_w2
			FROM board_parts s JOIN tmp_modules mm ON mm.old_id = s.module_id`},
		{"hardware_lines", 1, `INSERT INTO hardware_lines (id, organization_id, module_id, quantity, description_override, option_role, hardware_id)
			SELECT gen_random_uuid(), $2, mm.new_id, s.quantity, s.description_override, s.option_role, hm.new_id
			FROM hardware_lines s
			JOIN tmp_modules mm ON mm.old_id = s.module_id
			LEFT JOIN tmp_hw hm ON hm.old_id = s.hardware_id`},
		{"module_components", 1, `INSERT INTO module_components (id, organization_id, module_id, component_id, quantity, placement_override,
				length_formula, width_formula, overrides)
			SELECT gen_random_uuid(), $2, mm.new_id, cm.new_id, s.quantity, s.placement_override,
				s.length_formula, s.width_formula, s.overrides
			FROM module_components s
			JOIN tmp_modules mm ON mm.old_id = s.module_id
			LEFT JOIN tmp_comp cm ON cm.old_id = s.component_id`},
		{"module_presets", 1, `INSERT INTO module_presets (id, organization_id, module_id, name, width_mm, height_mm, depth_mm)
			SELECT gen_random_uuid(), $2, mm.new_id, s.name, s.width_mm, s.height_mm, s.depth_mm
			FROM module_presets s JOIN tmp_modules mm ON mm.old_id = s.module_id`},
	}

	for _, st := range steps {
		var err error
		if st.params == 2 {
			_, err = tx.Exec(ctx, st.sql, srcOrg, dstOrg)
		} else {
			// Single-param statements only reference the destination org.
			_, err = tx.Exec(ctx, strings.ReplaceAll(st.sql, "$2", "$1"), dstOrg)
		}
		if err != nil {
			return fmt.Errorf("clone %s: %w", st.name, err)
		}
	}
	if owned {
		return tx.Commit(ctx)
	}
	return nil
}

// UpdateOrganization persists mutable metadata. Lifecycle mutations must use
// TransitionOrganizationStatus so the credential epoch and audit boundary
// cannot be bypassed. The
// parent link is NOT mutable here — it is set at creation (#326) and only
// returned by the scan.
func (s *PostgresStore) UpdateOrganization(ctx context.Context, o *domain.Organization) error {
	return s.db(ctx).QueryRow(ctx, `
		SELECT `+organizationColumns+`
		FROM command_update_organization_metadata($1, $2, $3, $4, NULL)`,
		o.ID, o.Name, o.LicensePlan, o.LicenseExpiresAt).
		Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
			&o.Status, &o.CredentialVersion, &o.StatusChangedAt, &o.StatusChangedBy,
			&o.StatusReason, &o.SuspendedAt, &o.OffboardingStartedAt, &o.TerminatedAt,
			&o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version)
}

func (s *PostgresStore) UpdateOrganizationVersion(ctx context.Context, o *domain.Organization, expectedVersion int64) error {
	err := s.db(ctx).QueryRow(ctx, `
		SELECT `+organizationColumns+`
		FROM command_update_organization_metadata($1, $2, $3, $4, $5)`,
		o.ID, o.Name, o.LicensePlan, o.LicenseExpiresAt, expectedVersion).
		Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
			&o.Status, &o.CredentialVersion, &o.StatusChangedAt, &o.StatusChangedBy,
			&o.StatusReason, &o.SuspendedAt, &o.OffboardingStartedAt, &o.TerminatedAt,
			&o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrVersionConflict
	}
	return err
}

func (s *PostgresStore) TransitionOrganizationStatus(
	ctx context.Context,
	id string,
	from, to domain.OrganizationStatus,
	actorID, reason string,
	expectedVersion int64,
) (*domain.Organization, error) {
	if !domain.CanTransitionOrganizationStatus(from, to) {
		return nil, ErrOrganizationStatusConflict
	}
	if to != domain.OrganizationStatusActive && strings.TrimSpace(reason) == "" {
		return nil, fmt.Errorf("organization lifecycle reason is required")
	}
	tx, owned, err := s.beginOrUseTx(ctx)
	if err != nil {
		return nil, err
	}
	if owned {
		defer tx.Rollback(ctx)
	}
	row := tx.QueryRow(ctx, `
		SELECT `+organizationColumns+`
		FROM command_transition_organization_status(
			$1, $2, $3, nullif($4, '')::uuid, $5, $6
		)`, id, from, to, actorID, strings.TrimSpace(reason), expectedVersion)
	organization, err := scanOrganization(row)
	if errors.Is(err, pgx.ErrNoRows) {
		var currentStatus domain.OrganizationStatus
		var currentVersion int64
		lookupErr := tx.QueryRow(ctx, `SELECT status, version FROM organizations WHERE id=$1`, id).
			Scan(&currentStatus, &currentVersion)
		if errors.Is(lookupErr, pgx.ErrNoRows) {
			return nil, fmt.Errorf("organization not found")
		}
		if lookupErr != nil {
			return nil, lookupErr
		}
		if currentVersion != expectedVersion {
			return nil, ErrVersionConflict
		}
		return nil, ErrOrganizationStatusConflict
	}
	if err != nil {
		return nil, err
	}
	if owned {
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
	}
	return organization, nil
}

func (s *PostgresStore) GetOrganizationEntitlements(ctx context.Context, organizationID string) (*domain.OrganizationEntitlements, error) {
	out := &domain.OrganizationEntitlements{}
	err := s.db(ctx).QueryRow(ctx, `
		SELECT organization_id, max_active_members, max_sales_partners,
			manufacturing_enabled, sales_network_enabled, sketchup_seats,
			advanced_audit_enabled, source, defaults_revision, version, updated_at
		FROM organization_entitlements WHERE organization_id=$1`, organizationID).
		Scan(&out.OrganizationID, &out.MaxActiveMembers, &out.MaxSalesPartners,
			&out.ManufacturingEnabled, &out.SalesNetworkEnabled, &out.SketchupSeats,
			&out.AdvancedAuditEnabled, &out.Source, &out.DefaultsRevision,
			&out.Version, &out.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("organization entitlements not found")
	}
	return out, err
}

func (s *PostgresStore) UpdateOrganizationEntitlementsVersion(
	ctx context.Context,
	entitlements domain.OrganizationEntitlements,
	expectedVersion int64,
) (*domain.OrganizationEntitlements, error) {
	if entitlements.MaxActiveMembers != nil && *entitlements.MaxActiveMembers < 1 {
		return nil, fmt.Errorf("max active members must be positive")
	}
	if entitlements.MaxSalesPartners < 0 || entitlements.SketchupSeats < 0 || strings.TrimSpace(entitlements.DefaultsRevision) == "" {
		return nil, fmt.Errorf("invalid organization entitlements")
	}
	err := s.db(ctx).QueryRow(ctx, `
		UPDATE organization_entitlements
		SET max_active_members=$2, max_sales_partners=$3,
			manufacturing_enabled=$4, sales_network_enabled=$5,
			sketchup_seats=$6, advanced_audit_enabled=$7, source=$8,
			defaults_revision=$9, version=version+1, updated_at=NOW()
		WHERE organization_id=$1 AND version=$10
		RETURNING organization_id, max_active_members, max_sales_partners,
			manufacturing_enabled, sales_network_enabled, sketchup_seats,
			advanced_audit_enabled, source, defaults_revision, version, updated_at`,
		entitlements.OrganizationID, entitlements.MaxActiveMembers, entitlements.MaxSalesPartners,
		entitlements.ManufacturingEnabled, entitlements.SalesNetworkEnabled,
		entitlements.SketchupSeats, entitlements.AdvancedAuditEnabled,
		entitlements.Source, strings.TrimSpace(entitlements.DefaultsRevision), expectedVersion).
		Scan(&entitlements.OrganizationID, &entitlements.MaxActiveMembers, &entitlements.MaxSalesPartners,
			&entitlements.ManufacturingEnabled, &entitlements.SalesNetworkEnabled,
			&entitlements.SketchupSeats, &entitlements.AdvancedAuditEnabled,
			&entitlements.Source, &entitlements.DefaultsRevision,
			&entitlements.Version, &entitlements.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrVersionConflict
	}
	return &entitlements, err
}
