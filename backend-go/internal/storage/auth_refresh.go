package storage

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

var (
	ErrRefreshInvalid        = errors.New("refresh credential invalid")
	ErrRefreshExpired        = errors.New("refresh credential expired")
	ErrRefreshRevoked        = errors.New("refresh credential revoked")
	ErrRefreshReused         = errors.New("refresh credential reused")
	ErrRefreshTypeMismatch   = errors.New("refresh credential client type mismatch")
	ErrRefreshSessionRevoked = errors.New("refresh session revoked")
)

// ErrRefreshSessionInvalid may be returned by a rotation callback after live
// account/membership/organization revalidation. The store then atomically
// revokes the family and session instead of allowing refresh to revive scope.
var ErrRefreshSessionInvalid = errors.New("refresh session live authority invalid")

type CreateAuthRefreshCredentialCommand struct {
	SessionID string
	UserID    string
	Verifier  []byte
}

type AuthRefreshCredential struct {
	ID         string
	FamilyID   string
	SessionID  string
	UserID     string
	Generation int64
	ExpiresAt  time.Time
}

type RotateAuthRefreshCredentialCommand struct {
	PresentedVerifier []byte
	NextVerifier      []byte
	ExpectedClient    domain.SessionClientType
	IP                string
	RequestID         string
}

type AuthRefreshRotation struct {
	Session                       domain.AuthSession
	FamilyID                      string
	CurrentID                     string
	NextID                        string
	Generation                    int64
	ExpiresAt                     time.Time
	MembershipCredentialVersion   *int64
	OrganizationCredentialVersion *int64
}

type AuthRefreshRotationCallback func(context.Context, AuthRefreshRotation) error

func (s *PostgresStore) CreateAuthRefreshCredential(ctx context.Context, cmd CreateAuthRefreshCredentialCommand) (*AuthRefreshCredential, error) {
	if cmd.SessionID == "" || cmd.UserID == "" || len(cmd.Verifier) != 32 {
		return nil, ErrRefreshInvalid
	}
	create := func(txCtx context.Context) (*AuthRefreshCredential, error) {
		var out AuthRefreshCredential
		err := s.db(txCtx).QueryRow(txCtx, `
			WITH family AS (
				INSERT INTO auth_refresh_families (
					session_id, user_id, client_type, membership_id, active_organization_id,
					membership_credential_version, organization_credential_version, absolute_expires_at
				)
				SELECT s.id, s.user_id, s.client_type, s.membership_id, s.active_organization_id,
					m.credential_version, o.credential_version, s.absolute_expires_at
				FROM auth_sessions s
				LEFT JOIN memberships m ON m.id = s.membership_id
				LEFT JOIN organizations o ON o.id = s.active_organization_id
				WHERE s.id = $1::uuid AND s.user_id = $2::uuid
				  AND s.client_type IN ('web', 'mobile')
				  AND s.revoked_at IS NULL AND s.absolute_expires_at > NOW()
				RETURNING id, session_id, user_id, absolute_expires_at
			)
			INSERT INTO auth_refresh_credentials (
				family_id, session_id, user_id, secret_verifier, generation, expires_at
			)
			SELECT id, session_id, user_id, $3, 1, absolute_expires_at FROM family
			RETURNING id, family_id, session_id, user_id, generation, expires_at`,
			cmd.SessionID, cmd.UserID, cmd.Verifier).
			Scan(&out.ID, &out.FamilyID, &out.SessionID, &out.UserID, &out.Generation, &out.ExpiresAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRefreshSessionRevoked
		}
		if err != nil {
			return nil, err
		}
		return &out, nil
	}
	if transactionFromContext(ctx) != nil {
		return create(ctx)
	}
	var out *AuthRefreshCredential
	err := s.WithinTenantTx(ctx, TenantActor{UserID: cmd.UserID}, func(txCtx context.Context) error {
		created, err := create(txCtx)
		out = created
		return err
	})
	return out, err
}

func (s *PostgresStore) RotateAuthRefreshCredential(ctx context.Context, cmd RotateAuthRefreshCredentialCommand, execute AuthRefreshRotationCallback) (*AuthRefreshRotation, error) {
	if len(cmd.PresentedVerifier) != 32 || len(cmd.NextVerifier) != 32 || execute == nil {
		return nil, ErrRefreshInvalid
	}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return nil, fmt.Errorf("begin refresh rotation: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT set_config('app.refresh_verifier', $1, true)`, hex.EncodeToString(cmd.PresentedVerifier)); err != nil {
		return nil, fmt.Errorf("set refresh verifier scope: %w", err)
	}

	current, err := findRefreshCredential(ctx, tx, cmd.PresentedVerifier, false)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRefreshInvalid
		}
		return nil, err
	}
	actor := TenantActor{UserID: current.UserID}
	if err := setTenantContext(ctx, tx, actor); err != nil {
		return nil, err
	}
	txCtx := context.WithValue(WithTenantActorCtx(ctx, actor), transactionContextKey{}, tx)
	current, err = findRefreshCredential(txCtx, tx, cmd.PresentedVerifier, true)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRefreshInvalid
		}
		return nil, err
	}

	session, familyRevokedAt, familyClient, membershipVersion, organizationVersion, err := lockRefreshSession(txCtx, tx, current)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRefreshSessionRevoked
		}
		return nil, err
	}
	actor.OrganizationID = refreshStringValue(session.ActiveOrganizationID)
	if err := setTenantContext(txCtx, tx, actor); err != nil {
		return nil, err
	}
	txCtx = context.WithValue(WithTenantActorCtx(txCtx, actor), transactionContextKey{}, tx)

	if current.UsedAt != nil {
		if err := revokeRefreshSession(txCtx, s, session, current.FamilyID, "refresh_reuse_detected", cmd.IP, cmd.RequestID); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit refresh reuse revocation: %w", err)
		}
		return nil, ErrRefreshReused
	}
	if current.RevokedAt != nil || familyRevokedAt != nil {
		return nil, ErrRefreshRevoked
	}
	if !current.ExpiresAt.After(time.Now()) {
		return nil, ErrRefreshExpired
	}
	if session.RevokedAt != nil || !session.AbsoluteExpiresAt.After(time.Now()) {
		if err := revokeRefreshFamily(txCtx, tx, current.FamilyID, "session_revoked"); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit expired refresh family: %w", err)
		}
		return nil, ErrRefreshSessionRevoked
	}
	if familyClient != cmd.ExpectedClient || session.ClientType != cmd.ExpectedClient {
		return nil, ErrRefreshTypeMismatch
	}
	authorityValid, err := refreshSessionAuthorityValid(txCtx, tx, session, membershipVersion, organizationVersion)
	if err != nil {
		return nil, err
	}
	if !authorityValid {
		if err := revokeRefreshSession(txCtx, s, session, current.FamilyID, "refresh_authority_invalid", cmd.IP, cmd.RequestID); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit invalid refresh authority revocation: %w", err)
		}
		return nil, ErrRefreshSessionRevoked
	}

	rotation := AuthRefreshRotation{
		Session: *session, FamilyID: current.FamilyID, CurrentID: current.ID,
		Generation: current.Generation + 1, ExpiresAt: session.AbsoluteExpiresAt,
		MembershipCredentialVersion: membershipVersion, OrganizationCredentialVersion: organizationVersion,
	}
	if err := execute(txCtx, rotation); err != nil {
		if errors.Is(err, ErrRefreshSessionInvalid) {
			if revokeErr := revokeRefreshSession(txCtx, s, session, current.FamilyID, "refresh_authority_invalid", cmd.IP, cmd.RequestID); revokeErr != nil {
				return nil, revokeErr
			}
			if commitErr := tx.Commit(ctx); commitErr != nil {
				return nil, fmt.Errorf("commit invalid refresh session revocation: %w", commitErr)
			}
			return nil, ErrRefreshSessionRevoked
		}
		return nil, err
	}

	if err := tx.QueryRow(txCtx, `
		INSERT INTO auth_refresh_credentials (
			family_id, session_id, user_id, secret_verifier, generation, expires_at, parent_id
		) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid)
		RETURNING id`, current.FamilyID, current.SessionID, current.UserID,
		cmd.NextVerifier, rotation.Generation, rotation.ExpiresAt, current.ID).Scan(&rotation.NextID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(txCtx, `
		UPDATE auth_refresh_credentials
		SET used_at = NOW(), replacement_id = $2::uuid
		WHERE id = $1::uuid AND used_at IS NULL AND revoked_at IS NULL`, current.ID, rotation.NextID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(txCtx, `UPDATE auth_refresh_families SET last_generation = $2 WHERE id = $1::uuid`, current.FamilyID, rotation.Generation); err != nil {
		return nil, err
	}
	if err := s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
		EventType: "refresh_rotated", ActorUserID: session.UserID,
		OrganizationID: refreshStringValue(session.ActiveOrganizationID), IP: cmd.IP,
		Details: map[string]interface{}{"session_id": session.ID, "family_id": current.FamilyID, "generation": rotation.Generation, "request_id": cmd.RequestID},
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit refresh rotation: %w", err)
	}
	return &rotation, nil
}

func (s *PostgresStore) LogoutByRefreshCredential(ctx context.Context, verifier []byte, ip, requestID string) error {
	if len(verifier) != 32 {
		return nil
	}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT set_config('app.refresh_verifier', $1, true)`, hex.EncodeToString(verifier)); err != nil {
		return err
	}
	current, err := findRefreshCredential(ctx, tx, verifier, false)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	actor := TenantActor{UserID: current.UserID}
	if err := setTenantContext(ctx, tx, actor); err != nil {
		return err
	}
	txCtx := context.WithValue(WithTenantActorCtx(ctx, actor), transactionContextKey{}, tx)
	current, err = findRefreshCredential(txCtx, tx, verifier, true)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	session, _, _, _, _, err := lockRefreshSession(txCtx, tx, current)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	actor.OrganizationID = refreshStringValue(session.ActiveOrganizationID)
	if err := setTenantContext(txCtx, tx, actor); err != nil {
		return err
	}
	txCtx = context.WithValue(WithTenantActorCtx(txCtx, actor), transactionContextKey{}, tx)
	if session.RevokedAt == nil {
		if err := revokeRefreshSession(txCtx, s, session, current.FamilyID, "logout", ip, requestID); err != nil {
			return err
		}
	} else {
		// Logout closes both resources even when another policy already closed
		// the session. Only the first family transition emits the logout event,
		// keeping repeated logout state- and audit-idempotent.
		familyRevoked, err := revokeOpenRefreshFamily(txCtx, tx, current.FamilyID, "logout")
		if err != nil {
			return err
		}
		if familyRevoked {
			if err := s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
				EventType: "logout", ActorUserID: session.UserID,
				OrganizationID: refreshStringValue(session.ActiveOrganizationID), IP: ip,
				Details: map[string]interface{}{"session_id": session.ID, "family_id": current.FamilyID, "reason": "logout", "request_id": requestID},
			}); err != nil {
				return err
			}
		}
	}
	return tx.Commit(ctx)
}

type lockedRefreshCredential struct {
	ID, FamilyID, SessionID, UserID string
	Generation                      int64
	ExpiresAt                       time.Time
	UsedAt, RevokedAt               *time.Time
}

func findRefreshCredential(ctx context.Context, tx pgx.Tx, verifier []byte, lock bool) (*lockedRefreshCredential, error) {
	var row lockedRefreshCredential
	query := `
		SELECT id, family_id, session_id, user_id, generation, expires_at, used_at, revoked_at
		FROM auth_refresh_credentials WHERE secret_verifier = $1`
	if lock {
		query += ` FOR UPDATE`
	}
	err := tx.QueryRow(ctx, query, verifier).
		Scan(&row.ID, &row.FamilyID, &row.SessionID, &row.UserID, &row.Generation, &row.ExpiresAt, &row.UsedAt, &row.RevokedAt)
	return &row, err
}

func lockRefreshSession(ctx context.Context, tx pgx.Tx, current *lockedRefreshCredential) (*domain.AuthSession, *time.Time, domain.SessionClientType, *int64, *int64, error) {
	var session domain.AuthSession
	var familyRevokedAt *time.Time
	var familyClient domain.SessionClientType
	var membershipVersion, organizationVersion *int64
	err := tx.QueryRow(ctx, `
		SELECT s.id, s.user_id, s.membership_id, s.active_organization_id, s.support_session_id,
			s.client_type, s.created_at, s.absolute_expires_at, s.last_seen_at, s.revoked_at,
			s.revoked_by, s.revoke_reason, s.device_hint, f.revoked_at, f.client_type,
			f.membership_credential_version, f.organization_credential_version
		FROM auth_sessions s
		JOIN auth_refresh_families f ON f.session_id = s.id
		WHERE s.id = $1::uuid AND s.user_id = $2::uuid AND f.id = $3::uuid
		FOR UPDATE OF s, f`, current.SessionID, current.UserID, current.FamilyID).
		Scan(&session.ID, &session.UserID, &session.MembershipID, &session.ActiveOrganizationID, &session.SupportSessionID,
			&session.ClientType, &session.CreatedAt, &session.AbsoluteExpiresAt, &session.LastSeenAt, &session.RevokedAt,
			&session.RevokedBy, &session.RevokeReason, &session.DeviceHint, &familyRevokedAt, &familyClient,
			&membershipVersion, &organizationVersion)
	return &session, familyRevokedAt, familyClient, membershipVersion, organizationVersion, err
}

func revokeRefreshFamily(ctx context.Context, tx pgx.Tx, familyID, reason string) error {
	_, err := revokeOpenRefreshFamily(ctx, tx, familyID, reason)
	return err
}

func revokeOpenRefreshFamily(ctx context.Context, tx pgx.Tx, familyID, reason string) (bool, error) {
	tag, err := tx.Exec(ctx, `
		UPDATE auth_refresh_families
		SET revoked_at = NOW(), revoke_reason = $2
		WHERE id = $1::uuid AND revoked_at IS NULL`, familyID, reason)
	return tag.RowsAffected() > 0, err
}

func refreshSessionAuthorityValid(ctx context.Context, tx pgx.Tx, session *domain.AuthSession, membershipVersion, organizationVersion *int64) (bool, error) {
	var userActive bool
	if err := tx.QueryRow(ctx, `SELECT account_status = 'active' FROM users WHERE id=$1::uuid`, session.UserID).Scan(&userActive); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	if !userActive {
		return false, nil
	}
	if session.ActiveOrganizationID == nil {
		return session.MembershipID == nil && membershipVersion == nil && organizationVersion == nil, nil
	}
	if session.MembershipID == nil || membershipVersion == nil || organizationVersion == nil {
		return false, nil
	}
	var valid bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM memberships m
			JOIN organizations o ON o.id=m.organization_id
			WHERE m.id=$1::uuid AND m.user_id=$2::uuid AND m.organization_id=$3::uuid
			  AND m.status='active' AND o.status='active'
			  AND m.credential_version=$4 AND o.credential_version=$5
		)`, *session.MembershipID, session.UserID, *session.ActiveOrganizationID, *membershipVersion, *organizationVersion).Scan(&valid)
	return valid, err
}

func revokeRefreshSession(ctx context.Context, s *PostgresStore, session *domain.AuthSession, familyID, reason, ip, requestID string) error {
	if _, err := s.RevokeAuthSession(ctx, session.ID, session.UserID, reason); err != nil {
		return err
	}
	if err := revokeRefreshFamily(ctx, transactionFromContext(ctx), familyID, reason); err != nil {
		return err
	}
	event := "session_revoked"
	if reason == "refresh_reuse_detected" {
		event = "refresh_reuse_detected"
	} else if reason == "logout" {
		event = "logout"
	}
	return s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType: event, ActorUserID: session.UserID,
		OrganizationID: refreshStringValue(session.ActiveOrganizationID), IP: ip,
		Details: map[string]interface{}{"session_id": session.ID, "family_id": familyID, "reason": reason, "request_id": requestID},
	})
}

func refreshStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
