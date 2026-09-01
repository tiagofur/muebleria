package storage

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ErrAuthSessionNotFound means the registry has no live row for the id (never
// minted, revoked-and-pruned context, or belongs to another user).
var ErrAuthSessionNotFound = errors.New("auth session not found")

// ErrAuthSessionScopeIncoherent means the requested scope violates the
// registry's membership/user/organization coherence: the membership must
// belong to the session's user and to the session's active organization, the
// scope shape must be org-less/scoped/support, and support never carries a
// normal membership. The database enforces this (composite FKs + scope-shape
// CHECK in migration 000105); this typed error is the storage-boundary
// translation.
var ErrAuthSessionScopeIncoherent = errors.New("auth session scope is inconsistent with membership, user, or organization")

func mapAuthSessionScopeError(err error) error {
	var pgErr *pgconn.PgError
	// 23503 = foreign_key_violation, 23514 = check_violation.
	if errors.As(err, &pgErr) && (pgErr.Code == "23503" || pgErr.Code == "23514") {
		return ErrAuthSessionScopeIncoherent
	}
	return err
}

// authSessionTouchInterval throttles last_seen_at writes: the middleware
// resolves the session row on every request, but only stamps activity at most
// once per minute so hot paths do not turn reads into constant writes.
const authSessionTouchInterval = time.Minute

// CreateAuthSessionCommand inserts one registry row. An empty
// membership/organization is the org-less selection phase; select-org updates
// the scope in place keeping the same session id.
type CreateAuthSessionCommand struct {
	UserID            string
	MembershipID      string
	OrganizationID    string
	SupportSessionID  string
	ClientType        domain.SessionClientType
	AbsoluteExpiresAt time.Time
	DeviceHint        string
}

// CreateAuthSession inserts a session registry row and returns it with its
// server-generated id. On the real store this must run inside a tenant
// transaction with the owning user as actor (RLS: app.user_id = user_id), which
// login establishes right after password validation.
func (s *PostgresStore) CreateAuthSession(ctx context.Context, cmd CreateAuthSessionCommand) (*domain.AuthSession, error) {
	if cmd.UserID == "" || cmd.ClientType == "" || cmd.AbsoluteExpiresAt.IsZero() {
		return nil, errors.New("auth session requires user, client type, and absolute expiry")
	}
	var out domain.AuthSession
	err := s.db(ctx).QueryRow(ctx, `
		INSERT INTO auth_sessions (
			user_id, membership_id, active_organization_id, support_session_id,
			client_type, absolute_expires_at, device_hint
		)
		VALUES (NULLIF($1, '')::uuid, NULLIF($2, '')::uuid, NULLIF($3, '')::uuid, NULLIF($4, '')::uuid, $5, $6, NULLIF($7, ''))
		RETURNING id, user_id, membership_id, active_organization_id, support_session_id,
			client_type, created_at, absolute_expires_at, last_seen_at, revoked_at,
			revoked_by, revoke_reason, device_hint`,
		cmd.UserID, cmd.MembershipID, cmd.OrganizationID, cmd.SupportSessionID,
		string(cmd.ClientType), cmd.AbsoluteExpiresAt, cmd.DeviceHint).
		Scan(&out.ID, &out.UserID, &out.MembershipID, &out.ActiveOrganizationID, &out.SupportSessionID,
			&out.ClientType, &out.CreatedAt, &out.AbsoluteExpiresAt, &out.LastSeenAt, &out.RevokedAt,
			&out.RevokedBy, &out.RevokeReason, &out.DeviceHint)
	if err != nil {
		return nil, mapAuthSessionScopeError(err)
	}
	out.ClientType = domain.SessionClientType(out.ClientType)
	return &out, nil
}

// GetAuthSessionForRequest resolves a session for per-request validation and
// stamps last_seen_at at most once per authSessionTouchInterval. The caller
// still enforces revocation/absolute expiry/client type; this method only
// reads. expectedUserID is a defense-in-depth check against presenting another
// user's sid with a self-consistent token.
func (s *PostgresStore) GetAuthSessionForRequest(ctx context.Context, sessionID, expectedUserID string) (*domain.AuthSession, error) {
	if sessionID == "" || expectedUserID == "" {
		return nil, ErrAuthSessionNotFound
	}
	var out domain.AuthSession
	err := s.db(ctx).QueryRow(ctx, `
		WITH touch AS (
			UPDATE auth_sessions SET last_seen_at = NOW()
			WHERE id = $1::uuid
			  AND (last_seen_at IS NULL OR last_seen_at < NOW() - $3::text::interval)
			RETURNING id, last_seen_at
		)
		SELECT s.id, s.user_id, s.membership_id, s.active_organization_id, s.support_session_id,
			s.client_type, s.created_at, s.absolute_expires_at,
			COALESCE(touch.last_seen_at, s.last_seen_at), s.revoked_at,
			s.revoked_by, s.revoke_reason, s.device_hint
		FROM auth_sessions s
		LEFT JOIN touch ON touch.id = s.id
		WHERE s.id = $1::uuid AND s.user_id = $2::uuid`,
		sessionID, expectedUserID, fmt.Sprintf("%d seconds", int(authSessionTouchInterval.Seconds()))).
		Scan(&out.ID, &out.UserID, &out.MembershipID, &out.ActiveOrganizationID, &out.SupportSessionID,
			&out.ClientType, &out.CreatedAt, &out.AbsoluteExpiresAt, &out.LastSeenAt, &out.RevokedAt,
			&out.RevokedBy, &out.RevokeReason, &out.DeviceHint)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAuthSessionNotFound
		}
		return nil, err
	}
	out.ClientType = domain.SessionClientType(out.ClientType)
	return &out, nil
}

// UpdateAuthSessionScope changes the active membership/organization of a live
// session (select-org). The session id stays stable across the switch so the
// registry keeps one row per login, not per organization. Coherence is the
// database's call: the composite FKs reject a membership from another user or
// organization (translated to ErrAuthSessionScopeIncoherent), and the storage
// guard refuses half-empty scopes before touching the row.
func (s *PostgresStore) UpdateAuthSessionScope(ctx context.Context, sessionID, membershipID, organizationID string) error {
	if (membershipID == "") != (organizationID == "") {
		return ErrAuthSessionScopeIncoherent
	}
	// Session scope and refresh-family scope are one PostgreSQL statement, not
	// merely two statements inside an ambient transaction. A trigger/constraint
	// failure while updating the family therefore rolls the session update back
	// even when an HTTP handler later renders a non-5xx response.
	var updated, scopeFound, sessionEligible bool
	err := s.db(ctx).QueryRow(ctx, `
		WITH target_scope AS (
			SELECT m.id AS membership_id, m.organization_id,
				m.credential_version AS membership_credential_version,
				o.credential_version AS organization_credential_version
			FROM memberships m
			JOIN organizations o ON o.id = m.organization_id
			WHERE m.id = NULLIF($2, '')::uuid
			  AND m.organization_id = NULLIF($3, '')::uuid
			UNION ALL
			SELECT NULL::uuid, NULL::uuid, NULL::bigint, NULL::bigint
			WHERE $2 = '' AND $3 = ''
		), updated_session AS (
			UPDATE auth_sessions s
			SET membership_id = scope.membership_id,
				active_organization_id = scope.organization_id,
				version = s.version + 1
			FROM target_scope scope
			WHERE s.id = $1::uuid
			  AND s.revoked_at IS NULL
			  AND s.absolute_expires_at > NOW()
			RETURNING s.id
		), updated_family AS (
			UPDATE auth_refresh_families f
			SET membership_id = scope.membership_id,
				active_organization_id = scope.organization_id,
				membership_credential_version = scope.membership_credential_version,
				organization_credential_version = scope.organization_credential_version
			FROM target_scope scope, updated_session session
			WHERE f.session_id = session.id
			RETURNING f.session_id
		)
		SELECT EXISTS (SELECT 1 FROM updated_session),
			EXISTS (SELECT 1 FROM target_scope),
			EXISTS (
				SELECT 1 FROM auth_sessions
				WHERE id = $1::uuid AND revoked_at IS NULL AND absolute_expires_at > NOW()
			)
		FROM (SELECT count(*) FROM updated_family) AS family_write`,
		sessionID, membershipID, organizationID).Scan(&updated, &scopeFound, &sessionEligible)
	if err != nil {
		return mapAuthSessionScopeError(err)
	}
	if sessionEligible && !scopeFound {
		return ErrAuthSessionScopeIncoherent
	}
	if !updated {
		return ErrAuthSessionNotFound
	}
	return nil
}

// RevokeAuthSession marks a session revoked. It is idempotent for already
// revoked rows and returns whether this call performed the transition. The
// middleware cuts access on the next request even though the JWT itself has
// not expired.
func (s *PostgresStore) RevokeAuthSession(ctx context.Context, sessionID, revokedBy, reason string) (bool, error) {
	tag, err := s.db(ctx).Exec(ctx, `
		UPDATE auth_sessions
		SET revoked_at = NOW(), revoked_by = NULLIF($2, '')::uuid, revoke_reason = NULLIF($3, ''), version = version + 1
		WHERE id = $1::uuid AND revoked_at IS NULL`,
		sessionID, revokedBy, reason)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
