package storage

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Contrato: membresías — scan con org, listado por usuario, membership
// activa, ensure y flag de plataforma admin.
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
			return nil, ErrMembershipNotFound
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
	SchemaVersion  int
	RequestID      string
	ActorUserID    string
	TargetUserID   string
	OrganizationID string
	IP             string
	Details        map[string]interface{}
}
