package storage

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

const AuthSessionDirectoryLimit = 100

type AuthSessionDirectoryEntry struct {
	ID                   string
	UserID               string
	MembershipID         *string
	ActiveOrganizationID *string
	ClientType           domain.SessionClientType
	CreatedAt            time.Time
	LastSeenAt           *time.Time
	AbsoluteExpiresAt    time.Time
	RevokedAt            *time.Time
	DeviceHint           *string
	OrganizationName     *string
	OrganizationSlug     *string
}

func (entry AuthSessionDirectoryEntry) Status(now time.Time) string {
	if entry.RevokedAt != nil {
		return "revoked"
	}
	if !entry.AbsoluteExpiresAt.After(now) {
		return "expired"
	}
	return "active"
}

type RevokeAuthSessionCommand struct {
	ActorUserID        string
	TargetUserID       string
	OrganizationID     string
	TargetMembershipID string
	SessionID          string
	Reason             string
	IP                 string
	RequestID          string
}

type AuthSessionRevocation struct {
	Session AuthSessionDirectoryEntry
	Revoked bool
}

func validateSessionDirectoryUUIDs(values ...string) error {
	for _, value := range values {
		if value == "" {
			return ErrAuthSessionNotFound
		}
		if err := validateOptionalUUID("session directory id", value); err != nil {
			return ErrAuthSessionNotFound
		}
	}
	return nil
}

func (s *PostgresStore) ListOwnAuthSessions(ctx context.Context, userID string, limit int) ([]AuthSessionDirectoryEntry, error) {
	if err := validateSessionDirectoryUUIDs(userID); err != nil {
		return nil, err
	}
	return s.listAuthSessions(ctx, `
		SELECT session.id, session.user_id, session.membership_id,
			session.active_organization_id, session.client_type,
			session.created_at, session.last_seen_at,
			session.absolute_expires_at, session.revoked_at,
			session.device_hint, organization.name, organization.slug
		FROM auth_sessions session
		LEFT JOIN organizations organization ON organization.id = session.active_organization_id
		WHERE session.user_id = $1::uuid
		ORDER BY
			CASE
				WHEN session.revoked_at IS NULL AND session.absolute_expires_at > NOW() THEN 0
				WHEN session.revoked_at IS NOT NULL THEN 1
				ELSE 2
			END,
			session.created_at DESC
		LIMIT $2`, userID, boundedAuthSessionLimit(limit))
}

func (s *PostgresStore) ListPlatformUserAuthSessions(ctx context.Context, userID string, limit int) ([]AuthSessionDirectoryEntry, error) {
	return s.ListOwnAuthSessions(ctx, userID, limit)
}

func (s *PostgresStore) ListMembershipAuthSessions(ctx context.Context, actorUserID, organizationID, membershipID string, limit int) ([]AuthSessionDirectoryEntry, error) {
	if err := validateSessionDirectoryUUIDs(actorUserID, organizationID, membershipID); err != nil {
		return nil, err
	}
	return s.listAuthSessions(ctx, `
		SELECT session_id, target_user_id, membership_id,
			active_organization_id, client_type, created_at, last_seen_at,
			absolute_expires_at, revoked_at, device_hint,
			organization_name, organization_slug
		FROM app_list_membership_auth_sessions($1::uuid, $2::uuid, $3::uuid, $4)`,
		actorUserID, organizationID, membershipID, boundedAuthSessionLimit(limit))
}

func boundedAuthSessionLimit(limit int) int {
	if limit <= 0 || limit > AuthSessionDirectoryLimit {
		return AuthSessionDirectoryLimit
	}
	return limit
}

func (s *PostgresStore) listAuthSessions(ctx context.Context, query string, args ...any) ([]AuthSessionDirectoryEntry, error) {
	rows, err := s.db(ctx).Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AuthSessionDirectoryEntry, 0)
	for rows.Next() {
		entry, err := scanAuthSessionDirectoryEntry(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, entry)
	}
	return out, rows.Err()
}

func scanAuthSessionDirectoryEntry(row pgx.Row) (AuthSessionDirectoryEntry, error) {
	var entry AuthSessionDirectoryEntry
	var clientType string
	err := row.Scan(&entry.ID, &entry.UserID, &entry.MembershipID,
		&entry.ActiveOrganizationID, &clientType, &entry.CreatedAt,
		&entry.LastSeenAt, &entry.AbsoluteExpiresAt, &entry.RevokedAt,
		&entry.DeviceHint, &entry.OrganizationName, &entry.OrganizationSlug)
	entry.ClientType = domain.SessionClientType(clientType)
	return entry, err
}

func scanAuthSessionRevocation(row pgx.Row) (*AuthSessionRevocation, error) {
	entry, err := scanAuthSessionDirectoryEntryWithRevoked(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAuthSessionNotFound
		}
		return nil, err
	}
	return entry, nil
}

func scanAuthSessionDirectoryEntryWithRevoked(row pgx.Row) (*AuthSessionRevocation, error) {
	var out AuthSessionRevocation
	var clientType string
	err := row.Scan(&out.Session.ID, &out.Session.UserID, &out.Session.MembershipID,
		&out.Session.ActiveOrganizationID, &clientType, &out.Session.CreatedAt,
		&out.Session.LastSeenAt, &out.Session.AbsoluteExpiresAt,
		&out.Session.RevokedAt, &out.Session.DeviceHint,
		&out.Session.OrganizationName, &out.Session.OrganizationSlug,
		&out.Revoked)
	out.Session.ClientType = domain.SessionClientType(clientType)
	return &out, err
}

func (s *PostgresStore) RevokeOwnAuthSession(ctx context.Context, cmd RevokeAuthSessionCommand) (*AuthSessionRevocation, error) {
	if err := validateSessionDirectoryUUIDs(cmd.ActorUserID, cmd.SessionID); err != nil {
		return nil, err
	}
	return scanAuthSessionRevocation(s.db(ctx).QueryRow(ctx, `
		SELECT * FROM app_revoke_own_auth_session($1::uuid, $2::uuid, $3, $4)`,
		cmd.ActorUserID, cmd.SessionID, cmd.IP, cmd.RequestID))
}

func (s *PostgresStore) RevokeMembershipAuthSession(ctx context.Context, cmd RevokeAuthSessionCommand) (*AuthSessionRevocation, error) {
	if err := validateSessionDirectoryUUIDs(cmd.ActorUserID, cmd.OrganizationID, cmd.TargetMembershipID, cmd.SessionID); err != nil {
		return nil, err
	}
	return scanAuthSessionRevocation(s.db(ctx).QueryRow(ctx, `
		SELECT * FROM app_revoke_membership_auth_session(
			$1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7
		)`, cmd.ActorUserID, cmd.OrganizationID, cmd.TargetMembershipID,
		cmd.SessionID, cmd.Reason, cmd.IP, cmd.RequestID))
}

func (s *PostgresStore) RevokePlatformAuthSession(ctx context.Context, cmd RevokeAuthSessionCommand) (*AuthSessionRevocation, error) {
	if err := validateSessionDirectoryUUIDs(cmd.ActorUserID, cmd.TargetUserID, cmd.SessionID); err != nil {
		return nil, err
	}
	return scanAuthSessionRevocation(s.db(ctx).QueryRow(ctx, `
		SELECT * FROM app_revoke_platform_auth_session(
			$1::uuid, $2::uuid, $3::uuid, $4, $5, $6
		)`, cmd.ActorUserID, cmd.TargetUserID, cmd.SessionID,
		cmd.Reason, cmd.IP, cmd.RequestID))
}
