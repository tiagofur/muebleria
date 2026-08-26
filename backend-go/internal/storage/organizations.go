// Organization, membership and security-audit persistence (ADR-0004 / #325).

package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// InitialOrganizationID is the deterministic id of the organization created by
// the multi-org backfill (migration 000081) from the former single-workshop
// deployment. While only one organization exists, approval and role bridges
// target it explicitly.
const InitialOrganizationID = "00000000-0000-0000-0000-000000000001"

const organizationColumns = `id, name, slug, type, license_plan, license_expires_at, active, created_at, updated_at`

func scanOrganization(row pgx.Row) (*domain.Organization, error) {
	var o domain.Organization
	err := row.Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
		&o.Active, &o.CreatedAt, &o.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("organization not found")
		}
		return nil, err
	}
	return &o, nil
}

func (s *PostgresStore) GetOrganizationByID(ctx context.Context, id string) (*domain.Organization, error) {
	return scanOrganization(s.Pool.QueryRow(ctx,
		`SELECT `+organizationColumns+` FROM organizations WHERE id = $1`, id))
}

func (s *PostgresStore) GetOrganizationBySlug(ctx context.Context, slug string) (*domain.Organization, error) {
	return scanOrganization(s.Pool.QueryRow(ctx,
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
			&o.Active, &o.CreatedAt, &o.UpdatedAt); err != nil {
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
	return s.Pool.QueryRow(ctx, `
		INSERT INTO organizations (name, slug, type, license_plan, license_expires_at, active)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING `+organizationColumns,
		o.Name, o.Slug, o.Type, plan, o.LicenseExpiresAt, o.Active).
		Scan(&o.ID, &o.Name, &o.Slug, &o.Type, &o.LicensePlan, &o.LicenseExpiresAt,
			&o.Active, &o.CreatedAt, &o.UpdatedAt)
}

const membershipWithOrgColumns = `
	m.id, m.organization_id, m.user_id, m.roles, m.active, m.created_at, m.updated_at,
	o.id, o.name, o.slug, o.type, o.license_plan, o.license_expires_at, o.active, o.created_at, o.updated_at`

func scanMembershipWithOrg(row pgx.Row) (*domain.MembershipWithOrg, error) {
	var m domain.MembershipWithOrg
	err := row.Scan(&m.ID, &m.OrganizationID, &m.UserID, &m.Roles, &m.Active, &m.CreatedAt, &m.UpdatedAt,
		&m.Organization.ID, &m.Organization.Name, &m.Organization.Slug, &m.Organization.Type,
		&m.Organization.LicensePlan, &m.Organization.LicenseExpiresAt, &m.Organization.Active,
		&m.Organization.CreatedAt, &m.Organization.UpdatedAt)
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
	rows, err := s.Pool.Query(ctx, `
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
		if err := rows.Scan(&m.ID, &m.OrganizationID, &m.UserID, &m.Roles, &m.Active, &m.CreatedAt, &m.UpdatedAt,
			&m.Organization.ID, &m.Organization.Name, &m.Organization.Slug, &m.Organization.Type,
			&m.Organization.LicensePlan, &m.Organization.LicenseExpiresAt, &m.Organization.Active,
			&m.Organization.CreatedAt, &m.Organization.UpdatedAt); err != nil {
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
	_, err := s.Pool.Exec(ctx, `
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
	EventType       string
	ActorUserID     string
	TargetUserID    string
	OrganizationID  string
	IP              string
	Details         map[string]interface{}
}

func (s *PostgresStore) InsertSecurityAuditEvent(ctx context.Context, ev SecurityAuditEvent) error {
	_, err := s.Pool.Exec(ctx, `
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
func (s *PostgresStore) ListSecurityAuditEvents(ctx context.Context, organizationID string, limit int) ([]map[string]interface{}, error) {
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
	out := []map[string]interface{}{}
	for rows.Next() {
		var id, eventType, ip string
		var actor, target, org *string
		var details []byte
		var createdAt time.Time
		if err := rows.Scan(&id, &eventType, &actor, &target, &org, &ip, &details, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]interface{}{
			"id": id, "event_type": eventType, "actor_user_id": actor, "target_user_id": target,
			"organization_id": org, "ip": ip, "details": details, "created_at": createdAt,
		})
	}
	return out, rows.Err()
}
