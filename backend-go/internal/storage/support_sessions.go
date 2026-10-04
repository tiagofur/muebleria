package storage

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"time"
)

// Contrato: sesiones de soporte (ADR-0005 §5) — inicio TTL'd, lectura,
// cierre individual y corte masivo por org.
func (s *PostgresStore) StartSupportSession(ctx context.Context, adminUserID, organizationID, reason string, ttl time.Duration, organizationCredentialVersion int64) (*domain.SupportSession, error) {
	if transactionFromContext(ctx) == nil {
		return nil, errors.New("support session start requires an active transaction")
	}
	if err := authorizeTenantOrganizations(ctx, organizationID); err != nil {
		return nil, err
	}
	out := &domain.SupportSession{}
	err := s.db(ctx).QueryRow(ctx, `
		INSERT INTO support_sessions (
			platform_admin_user_id, organization_id, organization_credential_version,
			reason, expires_at
		)
		VALUES ($1, $2, $3, $4, NOW() + $5::interval)
		RETURNING id, platform_admin_user_id, organization_id,
			organization_credential_version, reason, started_at, expires_at`,
		adminUserID, organizationID, organizationCredentialVersion, reason,
		fmt.Sprintf("%d seconds", int(ttl.Seconds()))).
		Scan(&out.ID, &out.PlatformAdminUserID, &out.OrganizationID,
			&out.OrganizationCredentialVersion, &out.Reason, &out.StartedAt, &out.ExpiresAt)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// GetOpenSupportSession returns the session when still open and unexpired.
func (s *PostgresStore) GetOpenSupportSession(ctx context.Context, sessionID string) (*domain.SupportSession, error) {
	var out domain.SupportSession
	err := s.db(ctx).QueryRow(ctx, `
		SELECT session.id, session.platform_admin_user_id, session.organization_id,
			session.organization_credential_version, organization.status,
			organization.credential_version, session.reason, session.started_at,
			session.expires_at
		FROM support_sessions session
		JOIN organizations organization ON organization.id = session.organization_id
		WHERE session.id = $1 AND session.ended_at IS NULL AND session.expires_at > NOW()`, sessionID).
		Scan(&out.ID, &out.PlatformAdminUserID, &out.OrganizationID,
			&out.OrganizationCredentialVersion, &out.LiveOrganizationStatus,
			&out.LiveOrganizationCredentialVersion, &out.Reason, &out.StartedAt, &out.ExpiresAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Lazy close: an open-but-expired session is finalized with
			// ended_via='expiry' so the audit trail records how it ended
			// (access was already cut per-request by the middleware check).
			_, _ = s.db(ctx).Exec(ctx, `
				UPDATE support_sessions SET ended_at = expires_at, ended_via = 'expiry'
				WHERE id = $1 AND ended_at IS NULL AND expires_at <= NOW()`, sessionID)
			return nil, ErrSupportSessionNotFound
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
	if transactionFromContext(ctx) == nil {
		return false, errors.New("support session end requires an active transaction")
	}
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
