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
	ErrMembershipNotFound = errors.New("membership not found")
	ErrVersionConflict    = errors.New("resource version conflict")
)

const organizationColumns = `id, name, slug, type, license_plan, license_expires_at, active, parent_organization_id, created_at, updated_at, version`

func scanOrganization(row pgx.Row) (*domain.Organization, error) {
	var o domain.Organization
	err := row.Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
		&o.Active, &o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version)
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
	rows, err := s.Pool.Query(ctx, `SELECT `+organizationColumns+` FROM organizations ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Organization{}
	for rows.Next() {
		var o domain.Organization
		if err := rows.Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
			&o.Active, &o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version); err != nil {
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
	return s.db(ctx).QueryRow(ctx, `
		INSERT INTO organizations (name, slug, type, license_plan, license_expires_at, active, parent_organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING `+organizationColumns,
		o.Name, o.Slug, o.Type, plan, o.LicenseExpiresAt, o.Active, o.ParentOrganizationID).
		Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
			&o.Active, &o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version)
}

// ListConnectedOrganizations returns the sales network of a factory: the
// organizations whose parent is the given factory (#326).
func (s *PostgresStore) ListConnectedOrganizations(ctx context.Context, parentOrganizationID string) ([]domain.Organization, error) {
	rows, err := s.Pool.Query(ctx,
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
			&o.Active, &o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

const membershipWithOrgColumns = `
	m.id, m.organization_id, m.user_id, m.roles, m.active, m.created_at, m.updated_at, m.version,
	o.id, o.name, o.slug, o.type, o.license_plan, o.license_expires_at, o.active, o.parent_organization_id, o.created_at, o.updated_at, o.version`

func scanMembershipWithOrg(row pgx.Row) (*domain.MembershipWithOrg, error) {
	var m domain.MembershipWithOrg
	err := row.Scan(&m.ID, &m.OrganizationID, &m.UserID, &m.Roles, &m.Active, &m.CreatedAt, &m.UpdatedAt, &m.Version,
		&m.Organization.ID, &m.Organization.Name, &m.Organization.Slug, &m.Organization.Type,
		&m.Organization.LicensePlan, &m.Organization.LicenseExpiresAt, &m.Organization.Active,
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
	rows, err := s.db(ctx).Query(ctx, `
		SELECT `+membershipWithOrgColumns+`
		FROM memberships m
		JOIN organizations o ON o.id = m.organization_id
		WHERE m.user_id = $1 AND m.active AND o.active
		ORDER BY o.created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.MembershipWithOrg{}
	for rows.Next() {
		var m domain.MembershipWithOrg
		if err := rows.Scan(&m.ID, &m.OrganizationID, &m.UserID, &m.Roles, &m.Active, &m.CreatedAt, &m.UpdatedAt, &m.Version,
			&m.Organization.ID, &m.Organization.Name, &m.Organization.Slug, &m.Organization.Type,
			&m.Organization.LicensePlan, &m.Organization.LicenseExpiresAt, &m.Organization.Active,
			&m.Organization.ParentOrganizationID, &m.Organization.CreatedAt, &m.Organization.UpdatedAt, &m.Organization.Version); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// GetActiveMembership loads one membership (any state) with its organization.
// Callers decide how to react to inactive membership/organization.
func (s *PostgresStore) GetActiveMembership(ctx context.Context, userID, organizationID string) (*domain.MembershipWithOrg, error) {
	return scanMembershipWithOrg(s.Pool.QueryRow(ctx, `
		SELECT `+membershipWithOrgColumns+`
		FROM memberships m
		JOIN organizations o ON o.id = m.organization_id
		WHERE m.user_id = $1 AND m.organization_id = $2`, userID, organizationID))
}

// EnsureMembership inserts a membership if the user has none in the
// organization yet. Used by approval bridging and the admin CLI.
func (s *PostgresStore) EnsureMembership(ctx context.Context, organizationID, userID string, roles []domain.UserRole) error {
	if !domain.IsValidRoleSet(roles) {
		return fmt.Errorf("invalid role set")
	}
	_, err := s.db(ctx).Exec(ctx, `
		INSERT INTO memberships (organization_id, user_id, roles)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, organization_id) DO NOTHING`,
		organizationID, userID, roles)
	return err
}

// SetMembershipRoles replaces the roles of every active membership of the
// user. Transitional single-organization bridge for UpdateUserRole (F170b
// scopes this per membership).
func (s *PostgresStore) SetMembershipRoles(ctx context.Context, userID string, roles []domain.UserRole) error {
	if !domain.IsValidRoleSet(roles) {
		return fmt.Errorf("invalid role set")
	}
	_, err := s.Pool.Exec(ctx, `
		UPDATE memberships SET roles = $2, updated_at = CURRENT_TIMESTAMP
		WHERE user_id = $1`, userID, roles)
	return err
}

// SetPlatformAdmin flips the platform staff flag (ADR-0004 §5).
func (s *PostgresStore) SetPlatformAdmin(ctx context.Context, userID string, admin bool) error {
	result, err := s.Pool.Exec(ctx,
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
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id, event_type, actor_user_id, target_user_id, organization_id, ip, details, created_at
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
			_, _ = s.Pool.Exec(ctx, `
				UPDATE support_sessions SET ended_at = expires_at, ended_via = 'expiry'
				WHERE id = $1 AND ended_at IS NULL AND expires_at <= NOW()`, sessionID)
			return nil, fmt.Errorf("support session not found")
		}
		return nil, err
	}
	return &out, nil
}

// EndOpenSupportSessionsByOrg closes every still-open support session of an
// organization (suspension path — ended_via='org_suspended', B6).
func (s *PostgresStore) EndOpenSupportSessionsByOrg(ctx context.Context, organizationID, via string) (int64, error) {
	result, err := s.Pool.Exec(ctx, `
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
	result, err := s.Pool.Exec(ctx, `
		UPDATE support_sessions SET ended_at = NOW(), ended_via = $3
		WHERE id = $1 AND platform_admin_user_id = $2 AND ended_at IS NULL`,
		sessionID, adminUserID, via)
	if err != nil {
		return false, err
	}
	return result.RowsAffected() > 0, nil
}

// --- Org team & invitations (#326) ---

// OrgTeamMember is the team listing projection for the active organization.
type OrgTeamMember struct {
	UserID        string            `json:"user_id"`
	Email         string            `json:"email"`
	Name          string            `json:"name"`
	AccountActive bool              `json:"account_active"`
	Active        bool              `json:"active"`
	Roles         []domain.UserRole `json:"roles"`
	MemberSince   time.Time         `json:"member_since"`
	Version       int64             `json:"version"`
}

func (s *PostgresStore) ListOrgTeam(ctx context.Context, organizationID string) ([]OrgTeamMember, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT u.id, u.email, u.name, u.active, m.active, m.roles, m.created_at, m.version
		FROM memberships m
		JOIN users u ON u.id = m.user_id
		WHERE m.organization_id = $1
		ORDER BY m.created_at`, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OrgTeamMember{}
	for rows.Next() {
		var t OrgTeamMember
		if err := rows.Scan(&t.UserID, &t.Email, &t.Name, &t.AccountActive, &t.Active, &t.Roles, &t.MemberSince, &t.Version); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// UpdateMembershipRolesByOrg replaces the roles of ONE user's membership in
// the organization (fails when there is no membership).
func (s *PostgresStore) UpdateMembershipRolesByOrg(ctx context.Context, organizationID, userID string, roles []domain.UserRole, expectedVersion int64) (*OrgTeamMember, error) {
	if !domain.IsValidRoleSet(roles) {
		return nil, fmt.Errorf("invalid role set")
	}
	out := &OrgTeamMember{}
	err := s.db(ctx).QueryRow(ctx, `
		UPDATE memberships m SET roles = $3, updated_at = CURRENT_TIMESTAMP, version = version + 1
		FROM users u
		WHERE m.organization_id = $1 AND m.user_id = $2 AND m.version = $4 AND u.id = m.user_id
		RETURNING u.id, u.email, u.name, u.active, m.active, m.roles, m.created_at, m.version`, organizationID, userID, roles, expectedVersion).
		Scan(&out.UserID, &out.Email, &out.Name, &out.AccountActive, &out.Active, &out.Roles, &out.MemberSince, &out.Version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			var exists bool
			if e := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2)`, organizationID, userID).Scan(&exists); e != nil {
				return nil, e
			}
			if exists {
				return nil, ErrVersionConflict
			}
			return nil, ErrMembershipNotFound
		}
		return nil, err
	}
	return out, nil
}

// SetMembershipActive deactivates/reactivates one membership (team offboarding).
func (s *PostgresStore) SetMembershipActive(ctx context.Context, organizationID, userID string, active bool, expectedVersion int64) (*OrgTeamMember, error) {
	out := &OrgTeamMember{}
	err := s.Pool.QueryRow(ctx, `
		UPDATE memberships m SET active = $3, updated_at = CURRENT_TIMESTAMP, version = version + 1
		FROM users u
		WHERE m.organization_id = $1 AND m.user_id = $2 AND m.version = $4 AND u.id = m.user_id
		RETURNING u.id, u.email, u.name, u.active, m.active, m.roles, m.created_at, m.version`, organizationID, userID, active, expectedVersion).
		Scan(&out.UserID, &out.Email, &out.Name, &out.AccountActive, &out.Active, &out.Roles, &out.MemberSince, &out.Version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			var exists bool
			if e := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2)`, organizationID, userID).Scan(&exists); e != nil {
				return nil, e
			}
			if exists {
				return nil, ErrVersionConflict
			}
			return nil, ErrMembershipNotFound
		}
		return nil, err
	}
	return out, nil
}

// Invitation is the org-facing invitation projection.
type Invitation struct {
	ID         string            `json:"id"`
	Email      string            `json:"email"`
	Roles      []domain.UserRole `json:"roles"`
	ExpiresAt  time.Time         `json:"expires_at"`
	InvitedBy  *string           `json:"invited_by,omitempty"`
	AcceptedAt *time.Time        `json:"accepted_at,omitempty"`
	AcceptedBy *string           `json:"accepted_by,omitempty"`
	RevokedAt  *time.Time        `json:"revoked_at,omitempty"`
	CreatedAt  time.Time         `json:"created_at"`
	Version    int64             `json:"version"`
}

func (s *PostgresStore) CreateInvitation(ctx context.Context, organizationID, email string, roles []domain.UserRole, tokenHash string, expiresAt time.Time, invitedBy string) (*Invitation, error) {
	if !domain.IsValidRoleSet(roles) {
		return nil, fmt.Errorf("invalid role set")
	}
	out := &Invitation{}
	err := s.db(ctx).QueryRow(ctx, `
		INSERT INTO invitations (organization_id, email, roles, token_hash, expires_at, invited_by)
		VALUES ($1, $2, $3, $4, $5, nullif($6, '')::uuid)
		RETURNING id, email, roles, expires_at, created_at, version`,
		organizationID, email, roles, tokenHash, expiresAt, invitedBy).
		Scan(&out.ID, &out.Email, &out.Roles, &out.ExpiresAt, &out.CreatedAt, &out.Version)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (s *PostgresStore) ListInvitations(ctx context.Context, organizationID string) ([]Invitation, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, email, roles, expires_at, invited_by::text, accepted_at, accepted_by::text, revoked_at, created_at, version
		FROM invitations
		WHERE organization_id = $1
		ORDER BY created_at DESC`, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Invitation{}
	for rows.Next() {
		var i Invitation
		if err := rows.Scan(&i.ID, &i.Email, &i.Roles, &i.ExpiresAt, &i.InvitedBy, &i.AcceptedAt, &i.AcceptedBy, &i.RevokedAt, &i.CreatedAt, &i.Version); err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

var ErrInvitationNotFound = errors.New("invitation not found")

func (s *PostgresStore) RevokeInvitation(ctx context.Context, organizationID, id string, expectedVersion int64) (*Invitation, error) {
	var out Invitation
	err := s.db(ctx).QueryRow(ctx, `
		UPDATE invitations
		SET revoked_at = NOW(), version = version + 1
		WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL
			AND revoked_at IS NULL AND version = $3
		RETURNING id, email, roles, expires_at, invited_by::text, accepted_at,
			accepted_by::text, revoked_at, created_at, version`,
		id, organizationID, expectedVersion).Scan(
		&out.ID, &out.Email, &out.Roles, &out.ExpiresAt, &out.InvitedBy,
		&out.AcceptedAt, &out.AcceptedBy, &out.RevokedAt, &out.CreatedAt, &out.Version,
	)
	if !errors.Is(err, pgx.ErrNoRows) {
		return &out, err
	}
	var currentVersion int64
	lookupErr := s.db(ctx).QueryRow(ctx, `
		SELECT version FROM invitations
		WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
		id, organizationID).Scan(&currentVersion)
	if lookupErr == nil {
		return nil, ErrVersionConflict
	}
	if errors.Is(lookupErr, pgx.ErrNoRows) {
		return nil, ErrInvitationNotFound
	}
	return nil, lookupErr
}

// OpenInvitationByToken resolves an invitation by token hash when it is still
// open and unexpired, with its organization type for role validation.
type OpenInvitation struct {
	Invitation
	OrganizationID   string                  `json:"organization_id"`
	OrganizationType domain.OrganizationType `json:"organization_type"`
}

func (s *PostgresStore) GetOpenInvitationByToken(ctx context.Context, tokenHash string) (*OpenInvitation, error) {
	var out OpenInvitation
	err := s.db(ctx).QueryRow(ctx, `
		SELECT i.id, i.email, i.roles, i.expires_at, i.invited_by::text, i.accepted_at, i.accepted_by::text, i.revoked_at, i.created_at, i.version, o.id, o.type
		FROM invitations i
		JOIN organizations o ON o.id = i.organization_id
		WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
		  AND i.expires_at > NOW() AND o.active`,
		tokenHash).
		Scan(&out.ID, &out.Email, &out.Roles, &out.ExpiresAt, &out.InvitedBy, &out.AcceptedAt, &out.AcceptedBy, &out.RevokedAt, &out.CreatedAt, &out.Version, &out.OrganizationID, &out.OrganizationType)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("invitation not found")
		}
		return nil, err
	}
	return &out, nil
}

// AcceptInvitationTx marks the invitation accepted and ensures the user's
// membership with its roles, atomically. Returns the user id.
func (s *PostgresStore) AcceptInvitationTx(ctx context.Context, invitationID, userID string) error {
	tx, owned, err := s.beginOrUseTx(ctx)
	if err != nil {
		return err
	}
	if owned {
		defer tx.Rollback(ctx)
	}

	var orgID string
	var roles []domain.UserRole
	err = tx.QueryRow(ctx, `
		UPDATE invitations SET accepted_at = NOW(), accepted_by = $2
		WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
		RETURNING organization_id, roles`, invitationID, userID).Scan(&orgID, &roles)
	if err != nil {
		return fmt.Errorf("invitation not found")
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO memberships (organization_id, user_id, roles) VALUES ($1, $2, $3)
		ON CONFLICT (user_id, organization_id) DO UPDATE SET roles = $3, active = TRUE, updated_at = CURRENT_TIMESTAMP`,
		orgID, userID, roles); err != nil {
		return err
	}
	if owned {
		return tx.Commit(ctx)
	}
	return nil
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

// UpdateOrganization persists mutable fields (name/license/active). The
// parent link is NOT mutable here — it is set at creation (#326) and only
// returned by the scan.
func (s *PostgresStore) UpdateOrganization(ctx context.Context, o *domain.Organization) error {
	return s.Pool.QueryRow(ctx, `
		UPDATE organizations SET name = $2, license_plan = $3, license_expires_at = $4,
			active = $5, updated_at = CURRENT_TIMESTAMP, version = version + 1
		WHERE id = $1
		RETURNING `+organizationColumns,
		o.ID, o.Name, o.LicensePlan, o.LicenseExpiresAt, o.Active).
		Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
			&o.Active, &o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version)
}

func (s *PostgresStore) UpdateOrganizationVersion(ctx context.Context, o *domain.Organization, expectedVersion int64) error {
	err := s.Pool.QueryRow(ctx, `
		UPDATE organizations SET name=$2, license_plan=$3, license_expires_at=$4,
			active=$5, updated_at=CURRENT_TIMESTAMP, version=version+1
		WHERE id=$1 AND version=$6
		RETURNING `+organizationColumns,
		o.ID, o.Name, o.LicensePlan, o.LicenseExpiresAt, o.Active, expectedVersion).
		Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
			&o.Active, &o.ParentOrganizationID, &o.CreatedAt, &o.UpdatedAt, &o.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrVersionConflict
	}
	return err
}
