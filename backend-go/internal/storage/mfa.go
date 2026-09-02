package storage

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #460 SEC-7 — MFA and step-up storage. Every verification path is an atomic
// conditional UPDATE: TOTP replay is bounded by the factor's accepted-counter
// high-water mark, recovery codes are single-use rows, and a step-up grant is
// an immutable sid-bound insert whose freshness check joins the live session
// row so revocation cuts it without any cleanup job.

var (
	ErrMFAFactorNotFound      = errors.New("mfa factor not found")
	ErrMFAEnrollmentExpired   = errors.New("mfa enrollment expired")
	ErrMFAInvalidCode         = errors.New("mfa code invalid")
	ErrMFARecoveryInvalid     = errors.New("mfa recovery code invalid")
	ErrMFANoEnabledFactor     = errors.New("no enabled mfa factor")
	ErrMFASecretsUnconfigured = errors.New("mfa secrets authority not configured")
)

const mfaFactorColumns = `id, user_id, factor_type, status, label, encrypted_secret, encryption_kid,
	last_used_counter, last_used_at, pending_expires_at, created_at, enabled_at, revoked_at, updated_at, version`

// MFAEnrollmentTTL is how long a pending (unverified) enrollment stays
// enableable. The provisioning URI lives only inside that window.
const MFAEnrollmentTTL = 15 * time.Minute

// StepUpTTL is how long one successful verification elevates the session for
// exactly one scope (#460 SEC-7: 10 minutes).
const StepUpTTL = 10 * time.Minute

// MFARecoveryCodeCount codes are minted per enable/regenerate.
const MFARecoveryCodeCount = 10

// CreateMFAEnrollmentCommand starts a TOTP enrollment: the secret is sealed
// by the caller (API layer owns the MFASecrets authority) and stored pending.
type CreateMFAEnrollmentCommand struct {
	UserID           string
	FactorID         string
	EncryptedSecret  []byte
	EncryptionKid    string
	Label            string
	PendingExpiresAt time.Time
	IP               string
	RequestID        string
}

func (s *PostgresStore) CreateMFAEnrollment(ctx context.Context, cmd CreateMFAEnrollmentCommand) (*domain.MFAFactor, error) {
	if cmd.UserID == "" || len(cmd.EncryptedSecret) == 0 || cmd.EncryptionKid == "" || !cmd.PendingExpiresAt.After(time.Now()) {
		return nil, fmt.Errorf("mfa enrollment requires user, sealed secret, kid and future expiry")
	}
	var out *domain.MFAFactor
	err := s.WithinTenantTx(ctx, TenantActor{UserID: cmd.UserID}, func(txCtx context.Context) error {
		// Only one live enrollment per user: stale pending factors die here.
		if _, err := s.db(txCtx).Exec(txCtx, `
			UPDATE auth_mfa_factors
			SET status = 'revoked', revoked_at = NOW(), updated_at = NOW(), version = version + 1
			WHERE user_id = $1::uuid AND status = 'pending'`,
			cmd.UserID); err != nil {
			return err
		}
		created, err := scanMFAFactor(s.db(txCtx).QueryRow(txCtx, `
			INSERT INTO auth_mfa_factors (id, user_id, factor_type, status, label, encrypted_secret, encryption_kid, pending_expires_at)
			VALUES ($1::uuid, $2::uuid, 'totp', 'pending', $3, $4, $5, $6)
			RETURNING `+mfaFactorColumns,
			cmd.FactorID, cmd.UserID, cmd.Label, cmd.EncryptedSecret, cmd.EncryptionKid, cmd.PendingExpiresAt))
		if err != nil {
			return err
		}
		out = created
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:   "mfa_enrollment_started",
			ActorUserID: cmd.UserID,
			IP:          cmd.IP,
			Details: map[string]interface{}{
				"factor_id":  created.ID,
				"request_id": cmd.RequestID,
			},
		})
	})
	return out, err
}

// GetMFAFactor loads one factor owned by the user.
func (s *PostgresStore) GetMFAFactor(ctx context.Context, userID, factorID string) (*domain.MFAFactor, error) {
	var out *domain.MFAFactor
	err := s.withUserTx(ctx, userID, func(txCtx context.Context) error {
		factor, err := scanMFAFactor(s.db(txCtx).QueryRow(txCtx,
			`SELECT `+mfaFactorColumns+` FROM auth_mfa_factors WHERE id = $1::uuid AND user_id = $2::uuid`,
			factorID, userID))
		out = factor
		return err
	})
	return out, err
}

// ListMFAFactors returns the owner's factors, metadata only — the sealed
// secret never leaves this layer.
func (s *PostgresStore) ListMFAFactors(ctx context.Context, userID string) ([]domain.MFAFactor, error) {
	var out []domain.MFAFactor
	err := s.withUserTx(ctx, userID, func(txCtx context.Context) error {
		rows, err := s.db(txCtx).Query(txCtx, `
			SELECT `+mfaFactorColumns+` FROM auth_mfa_factors
			WHERE user_id = $1::uuid AND status <> 'revoked'
			ORDER BY created_at DESC`, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			f, err := scanMFAFactor(rows)
			if err != nil {
				return err
			}
			f.EncryptedSecret = nil
			out = append(out, *f)
		}
		return rows.Err()
	})
	return out, err
}

// CountEnabledMFAFactors backs the MFA_REQUIRED decision: a user with no
// enabled factor cannot step up and must enroll first.
func (s *PostgresStore) CountEnabledMFAFactors(ctx context.Context, userID string) (int, error) {
	count := 0
	err := s.withUserTx(ctx, userID, func(txCtx context.Context) error {
		return s.db(txCtx).QueryRow(txCtx,
			`SELECT COUNT(*) FROM auth_mfa_factors WHERE user_id = $1::uuid AND status = 'enabled'`,
			userID).Scan(&count)
	})
	return count, err
}

// EnableMFAFactorCommand verifies a pending enrollment's TOTP and enables the
// factor in one transaction: decrypt → verify code → atomic pending→enabled
// transition with the accepted counter as the replay high-water mark → mint
// recovery codes → audit. The plaintext recovery codes exist only in the
// returned result.
type EnableMFAFactorCommand struct {
	UserID    string
	FactorID  string
	Code      string
	Secrets   *auth.MFASecrets
	IP        string
	RequestID string
}

type EnabledMFAFactor struct {
	Factor        *domain.MFAFactor
	RecoveryCodes []string
}

func (s *PostgresStore) EnableMFAFactor(ctx context.Context, cmd EnableMFAFactorCommand) (*EnabledMFAFactor, error) {
	if cmd.UserID == "" || cmd.FactorID == "" || cmd.Code == "" {
		return nil, fmt.Errorf("mfa enable requires user, factor and code")
	}
	if cmd.Secrets == nil {
		return nil, ErrMFASecretsUnconfigured
	}
	var out *EnabledMFAFactor
	err := s.WithinTenantTx(ctx, TenantActor{UserID: cmd.UserID}, func(txCtx context.Context) error {
		factor, err := lockMFAFactor(txCtx, s, cmd.UserID, cmd.FactorID)
		if err != nil {
			return err
		}
		if factor.Status != domain.MFAFactorStatusPending {
			return ErrMFAFactorNotFound
		}
		if !factor.PendingExpiresAt.After(time.Now()) {
			// An expired enrollment can never be enabled (#460 SEC-7 §8).
			return ErrMFAEnrollmentExpired
		}
		secret, err := cmd.Secrets.DecryptTOTPSecret(factor.EncryptedSecret, factor.EncryptionKid)
		if err != nil {
			return err
		}
		verification, err := auth.VerifyTOTP(secret, cmd.Code, time.Now())
		if err != nil {
			// Failed attempts are audited (no code material, ids only).
			if auditErr := s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
				EventType:   "mfa_verification_failed",
				ActorUserID: cmd.UserID,
				IP:          cmd.IP,
				Details: map[string]interface{}{
					"purpose":    "enroll_verify",
					"factor_id":  factor.ID,
					"request_id": cmd.RequestID,
				},
			}); auditErr != nil {
				return auditErr
			}
			return ErrMFAInvalidCode
		}
		updated, err := s.advanceFactorCounter(txCtx, factor.ID, verification.Counter, domain.MFAFactorStatusPending)
		if err != nil {
			return err
		}
		codes, err := s.insertRecoveryCodes(txCtx, cmd.UserID, cmd.Secrets, cmd.IP, cmd.RequestID, factor.ID, "mfa_factor_enabled")
		if err != nil {
			return err
		}
		if err := s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:   "mfa_factor_enabled",
			ActorUserID: cmd.UserID,
			IP:          cmd.IP,
			Details: map[string]interface{}{
				"factor_id":      factor.ID,
				"factor_type":    factor.FactorType,
				"recovery_count": len(codes),
				"request_id":     cmd.RequestID,
			},
		}); err != nil {
			return err
		}
		out = &EnabledMFAFactor{Factor: updated, RecoveryCodes: codes}
		return nil
	})
	return out, err
}

// RevokeMFAFactorCommand removes a factor. The API layer enforces the
// security_admin step-up before reaching here; removing the LAST enabled
// factor also revokes every outstanding recovery code (MFA off ⇒ no fallback
// credentials either).
type RevokeMFAFactorCommand struct {
	UserID    string
	FactorID  string
	IP        string
	RequestID string
}

func (s *PostgresStore) RevokeMFAFactor(ctx context.Context, cmd RevokeMFAFactorCommand) (*domain.MFAFactor, error) {
	if cmd.UserID == "" || cmd.FactorID == "" {
		return nil, fmt.Errorf("mfa revoke requires user and factor")
	}
	var out *domain.MFAFactor
	err := s.WithinTenantTx(ctx, TenantActor{UserID: cmd.UserID}, func(txCtx context.Context) error {
		factor, err := lockMFAFactor(txCtx, s, cmd.UserID, cmd.FactorID)
		if err != nil {
			return err
		}
		if factor.Status == domain.MFAFactorStatusRevoked {
			return ErrMFAFactorNotFound
		}
		updated, err := scanMFAFactor(s.db(txCtx).QueryRow(txCtx, `
			UPDATE auth_mfa_factors
			SET status = 'revoked', revoked_at = NOW(), updated_at = NOW(), version = version + 1
			WHERE id = $1::uuid AND user_id = $2::uuid AND status = $3
			RETURNING `+mfaFactorColumns,
			cmd.FactorID, cmd.UserID, factor.Status))
		if err != nil {
			return err
		}
		remaining := 0
		if err := s.db(txCtx).QueryRow(txCtx,
			`SELECT COUNT(*) FROM auth_mfa_factors WHERE user_id = $1::uuid AND status = 'enabled'`,
			cmd.UserID).Scan(&remaining); err != nil {
			return err
		}
		if remaining == 0 {
			if _, err := s.db(txCtx).Exec(txCtx, `
				UPDATE auth_mfa_recovery_codes
				SET revoked_at = NOW()
				WHERE user_id = $1::uuid AND revoked_at IS NULL`, cmd.UserID); err != nil {
				return err
			}
		}
		out = updated
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:   "mfa_factor_removed",
			ActorUserID: cmd.UserID,
			IP:          cmd.IP,
			Details: map[string]interface{}{
				"factor_id":        factor.ID,
				"was_last_factor":  remaining == 0,
				"recovery_revoked": remaining == 0,
				"request_id":       cmd.RequestID,
			},
		})
	})
	return out, err
}

// RegenerateMFARecoveryCodes revokes every outstanding code and mints a fresh
// batch. Requires at least one enabled factor — recovery codes are the MFA
// fallback, not a credential class of their own.
type RegenerateMFARecoveryCommand struct {
	UserID    string
	Secrets   *auth.MFASecrets
	IP        string
	RequestID string
}

func (s *PostgresStore) RegenerateMFARecoveryCodes(ctx context.Context, cmd RegenerateMFARecoveryCommand) ([]string, error) {
	if cmd.UserID == "" {
		return nil, fmt.Errorf("mfa recovery regeneration requires user")
	}
	if cmd.Secrets == nil {
		return nil, ErrMFASecretsUnconfigured
	}
	var codes []string
	err := s.WithinTenantTx(ctx, TenantActor{UserID: cmd.UserID}, func(txCtx context.Context) error {
		enabled := 0
		if err := s.db(txCtx).QueryRow(txCtx,
			`SELECT COUNT(*) FROM auth_mfa_factors WHERE user_id = $1::uuid AND status = 'enabled'`,
			cmd.UserID).Scan(&enabled); err != nil {
			return err
		}
		if enabled == 0 {
			return ErrMFANoEnabledFactor
		}
		if _, err := s.db(txCtx).Exec(txCtx, `
			UPDATE auth_mfa_recovery_codes
			SET revoked_at = NOW()
			WHERE user_id = $1::uuid AND revoked_at IS NULL`, cmd.UserID); err != nil {
			return err
		}
		generated, err := s.insertRecoveryCodes(txCtx, cmd.UserID, cmd.Secrets, cmd.IP, cmd.RequestID, "", "mfa_recovery_codes_generated")
		if err != nil {
			return err
		}
		codes = generated
		return nil
	})
	return codes, err
}

// insertRecoveryCodes mints the single-use verifier rows. The `codes`
// plaintext exists only in the returned slice.
func (s *PostgresStore) insertRecoveryCodes(txCtx context.Context, userID string, secrets *auth.MFASecrets, ip, requestID, factorID, auditEvent string) ([]string, error) {
	raw, err := auth.GenerateRecoveryCodes(MFARecoveryCodeCount)
	if err != nil {
		return nil, err
	}
	for _, code := range raw {
		verifier, kid, err := secrets.RecoveryVerifier(code)
		if err != nil {
			return nil, err
		}
		if _, err := s.db(txCtx).Exec(txCtx, `
			INSERT INTO auth_mfa_recovery_codes (user_id, verifier, encryption_kid)
			VALUES ($1::uuid, $2, $3)`,
			userID, verifier, kid); err != nil {
			return nil, err
		}
	}
	details := map[string]interface{}{
		"count":      len(raw),
		"request_id": requestID,
	}
	if factorID != "" {
		details["factor_id"] = factorID
	}
	if err := s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
		EventType:   auditEvent,
		ActorUserID: userID,
		IP:          ip,
		Details:     details,
	}); err != nil {
		return nil, err
	}
	return raw, nil
}

// MFAStepUpCommand verifies a second factor and elevates the session for ONE
// scope. TOTP path: every enabled factor is tried under a row lock; the
// accepted counter is advanced atomically so the same time-step can never
// create a second step-up. Recovery path: single-use verifier consumption.
type MFAStepUpCommand struct {
	UserID    string
	SessionID string
	Scope     string
	Method    string // totp | recovery
	Code      string
	Secrets   *auth.MFASecrets
	IP        string
	RequestID string
}

type MFAStepUpResult struct {
	Scope     string
	Method    string
	ExpiresAt time.Time
}

func (s *PostgresStore) VerifyMFAStepUp(ctx context.Context, cmd MFAStepUpCommand) (*MFAStepUpResult, error) {
	if cmd.UserID == "" || cmd.SessionID == "" || !domain.ValidStepUpScope(cmd.Scope) || cmd.Code == "" {
		return nil, fmt.Errorf("step-up requires user, session, scope and code")
	}
	if cmd.Secrets == nil {
		return nil, ErrMFASecretsUnconfigured
	}
	var out *MFAStepUpResult
	err := s.WithinTenantTx(ctx, TenantActor{UserID: cmd.UserID}, func(txCtx context.Context) error {
		// The session must be live and owned by the user: step-up authority is
		// sid-bound and dies with the session.
		var sessionUserID string
		var revokedAt, absoluteExpires *time.Time
		if err := s.db(txCtx).QueryRow(txCtx, `
			SELECT user_id, revoked_at, absolute_expires_at FROM auth_sessions
			WHERE id = $1::uuid`, cmd.SessionID).Scan(&sessionUserID, &revokedAt, &absoluteExpires); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrMFAFactorNotFound
			}
			return err
		}
		if sessionUserID != cmd.UserID || revokedAt != nil || !absoluteExpires.After(time.Now()) {
			return ErrMFAFactorNotFound
		}

		switch cmd.Method {
		case domain.StepUpMethodTOTP:
			if err := s.stepUpWithTOTP(txCtx, cmd); err != nil {
				return err
			}
		case domain.StepUpMethodRecovery:
			if err := s.stepUpWithRecovery(txCtx, cmd); err != nil {
				return err
			}
		default:
			return fmt.Errorf("unknown step-up method %q", cmd.Method)
		}

		expiresAt := time.Now().Add(StepUpTTL).UTC()
		// Never outlive the session's own absolute bound.
		if absoluteExpires.Before(expiresAt) {
			expiresAt = absoluteExpires.UTC()
		}
		if _, err := s.db(txCtx).Exec(txCtx, `
			INSERT INTO auth_step_up_grants (auth_session_id, user_id, scope, method, expires_at)
			VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
			cmd.SessionID, cmd.UserID, cmd.Scope, cmd.Method, expiresAt); err != nil {
			return err
		}
		// Freshness hint on the registry row (000105 reserved this column for
		// SEC-7): the grants table stays the scope-aware authority; this marks
		// the last successful verification for humans/directories.
		if _, err := s.db(txCtx).Exec(txCtx, `
			UPDATE auth_sessions SET step_up_at = NOW(), version = version + 1 WHERE id = $1::uuid`,
			cmd.SessionID); err != nil {
			return err
		}
		if err := s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:   "step_up_succeeded",
			ActorUserID: cmd.UserID,
			IP:          cmd.IP,
			Details: map[string]interface{}{
				"session_id": cmd.SessionID,
				"scope":      cmd.Scope,
				"method":     cmd.Method,
				"expires_at": expiresAt.Format(time.RFC3339),
				"request_id": cmd.RequestID,
			},
		}); err != nil {
			return err
		}
		out = &MFAStepUpResult{Scope: cmd.Scope, Method: cmd.Method, ExpiresAt: expiresAt}
		return nil
	})
	return out, err
}

func (s *PostgresStore) stepUpWithTOTP(txCtx context.Context, cmd MFAStepUpCommand) error {
	rows, err := s.db(txCtx).Query(txCtx, `
		SELECT `+mfaFactorColumns+` FROM auth_mfa_factors
		WHERE user_id = $1::uuid AND status = 'enabled'
		ORDER BY created_at ASC
		FOR UPDATE`, cmd.UserID)
	if err != nil {
		return err
	}
	factors := []*domain.MFAFactor{}
	for rows.Next() {
		f, err := scanMFAFactor(rows)
		if err != nil {
			rows.Close()
			return err
		}
		factors = append(factors, f)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if len(factors) == 0 {
		return ErrMFANoEnabledFactor
	}
	matched := false
	for _, factor := range factors {
		secret, err := cmd.Secrets.DecryptTOTPSecret(factor.EncryptedSecret, factor.EncryptionKid)
		if err != nil {
			// A rotated-out kid fails its factor closed; other factors may
			// still verify.
			continue
		}
		verification, err := auth.VerifyTOTP(secret, cmd.Code, time.Now())
		if err != nil {
			continue
		}
		if factor.LastUsedCounter != nil && verification.Counter <= *factor.LastUsedCounter {
			continue // replay of an accepted time-step
		}
		if _, err := s.advanceFactorCounter(txCtx, factor.ID, verification.Counter, domain.MFAFactorStatusEnabled); err == nil {
			matched = true
			break
		}
	}
	if !matched {
		return s.stepUpFailure(txCtx, cmd, "invalid_code")
	}
	return nil
}

func (s *PostgresStore) stepUpWithRecovery(txCtx context.Context, cmd MFAStepUpCommand) error {
	enabled := 0
	if err := s.db(txCtx).QueryRow(txCtx,
		`SELECT COUNT(*) FROM auth_mfa_factors WHERE user_id = $1::uuid AND status = 'enabled'`,
		cmd.UserID).Scan(&enabled); err != nil {
		return err
	}
	if enabled == 0 {
		return ErrMFANoEnabledFactor
	}
	normalized := auth.NormalizeRecoveryCodeInput(cmd.Code)
	if len(normalized) == 0 {
		return s.stepUpFailure(txCtx, cmd, "invalid_code")
	}
	rows, err := s.db(txCtx).Query(txCtx, `
		SELECT id, user_id, verifier, encryption_kid, used_at, revoked_at, created_at
		FROM auth_mfa_recovery_codes
		WHERE user_id = $1::uuid AND used_at IS NULL AND revoked_at IS NULL
		FOR UPDATE`, cmd.UserID)
	if err != nil {
		return err
	}
	codes := []*domain.MFARecoveryCode{}
	for rows.Next() {
		c := &domain.MFARecoveryCode{}
		if err := rows.Scan(&c.ID, &c.UserID, &c.Verifier, &c.EncryptionKid, &c.UsedAt, &c.RevokedAt, &c.CreatedAt); err != nil {
			rows.Close()
			return err
		}
		codes = append(codes, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, code := range codes {
		if !cmd.Secrets.RecoveryMatches(normalized, code.EncryptionKid, code.Verifier) {
			continue
		}
		consumed, err := s.db(txCtx).Exec(txCtx, `
			UPDATE auth_mfa_recovery_codes
			SET used_at = NOW()
			WHERE id = $1::uuid AND used_at IS NULL AND revoked_at IS NULL`,
			code.ID)
		if err != nil {
			return err
		}
		if consumed.RowsAffected() == 0 {
			continue // lost the single-use race
		}
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:   "mfa_recovery_code_used",
			ActorUserID: cmd.UserID,
			IP:          cmd.IP,
			Details: map[string]interface{}{
				"recovery_code_id": code.ID,
				"session_id":       cmd.SessionID,
				"scope":            cmd.Scope,
				"request_id":       cmd.RequestID,
			},
		})
	}
	return s.stepUpFailure(txCtx, cmd, "invalid_recovery_code")
}

// stepUpFailure writes the required audit record and returns the typed error.
func (s *PostgresStore) stepUpFailure(txCtx context.Context, cmd MFAStepUpCommand, reason string) error {
	auditErr := s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
		EventType:   "step_up_failed",
		ActorUserID: cmd.UserID,
		IP:          cmd.IP,
		Details: map[string]interface{}{
			"session_id": cmd.SessionID,
			"scope":      cmd.Scope,
			"method":     cmd.Method,
			"reason":     reason,
			"request_id": cmd.RequestID,
		},
	})
	if auditErr != nil {
		return auditErr
	}
	if cmd.Method == domain.StepUpMethodRecovery {
		return ErrMFARecoveryInvalid
	}
	return ErrMFAInvalidCode
}

// advanceFactorCounter is the atomic replay guard: the UPDATE only lands when
// the row is still in `status` and the accepted counter is strictly newer
// than the stored high-water mark. A lost race returns ErrMFAInvalidCode.
func (s *PostgresStore) advanceFactorCounter(txCtx context.Context, factorID string, counter int64, status string) (*domain.MFAFactor, error) {
	updated, err := scanMFAFactor(s.db(txCtx).QueryRow(txCtx, `
		UPDATE auth_mfa_factors
		SET last_used_counter = $1, last_used_at = NOW(),
		    status = CASE WHEN $2 = 'pending' THEN 'enabled' ELSE status END,
		    enabled_at = CASE WHEN $2 = 'pending' THEN NOW() ELSE enabled_at END,
		    updated_at = NOW(), version = version + 1
		WHERE id = $3::uuid AND status = $2
		  AND (last_used_counter IS NULL OR last_used_counter < $1)
		RETURNING `+mfaFactorColumns,
		counter, status, factorID))
	if errors.Is(err, ErrMFAFactorNotFound) {
		return nil, ErrMFAInvalidCode
	}
	return updated, err
}

// MFAStepUpFreshness is the middleware's view of one (session, scope).
type MFAStepUpFreshness struct {
	Valid   bool
	Expired bool
}

// GetMFAStepUpFreshness resolves whether the session holds a live grant for
// the scope. Validity joins the live session row (revocation cuts the grant);
// Expired distinguishes "had one, TTL passed" for the typed client contract.
func (s *PostgresStore) GetMFAStepUpFreshness(ctx context.Context, sessionID, userID, scope string) (MFAStepUpFreshness, error) {
	var freshness MFAStepUpFreshness
	exec := func(txCtx context.Context) error {
		return s.db(txCtx).QueryRow(txCtx, `
			SELECT
				EXISTS (
					SELECT 1 FROM auth_step_up_grants g
					JOIN auth_sessions s ON s.id = g.auth_session_id
					WHERE g.auth_session_id = $1::uuid AND g.user_id = $2::uuid AND g.scope = $3
					  AND g.expires_at > NOW()
					  AND s.revoked_at IS NULL AND s.absolute_expires_at > NOW()
				) AS valid,
				EXISTS (
					SELECT 1 FROM auth_step_up_grants g
					WHERE g.auth_session_id = $1::uuid AND g.user_id = $2::uuid AND g.scope = $3
					  AND g.expires_at <= NOW()
				) AS expired`,
			sessionID, userID, scope).Scan(&freshness.Valid, &freshness.Expired)
	}
	if transactionFromContext(ctx) != nil {
		return freshness, exec(ctx)
	}
	err := s.WithinTenantTx(ctx, TenantActor{UserID: userID}, func(txCtx context.Context) error {
		return exec(txCtx)
	})
	return freshness, err
}

// withUserTx runs fn as the user actor, joining the ambient authenticated
// transaction when the caller is inside one.
func (s *PostgresStore) withUserTx(ctx context.Context, userID string, fn func(txCtx context.Context) error) error {
	if transactionFromContext(ctx) != nil {
		return fn(ctx)
	}
	return s.WithinTenantTx(ctx, TenantActor{UserID: userID}, fn)
}

func lockMFAFactor(ctx context.Context, s *PostgresStore, userID, factorID string) (*domain.MFAFactor, error) {
	return scanMFAFactor(s.db(ctx).QueryRow(ctx, `
		SELECT `+mfaFactorColumns+` FROM auth_mfa_factors
		WHERE id = $1::uuid AND user_id = $2::uuid
		FOR UPDATE`, factorID, userID))
}

func scanMFAFactor(row pgx.Row) (*domain.MFAFactor, error) {
	var f domain.MFAFactor
	if err := row.Scan(&f.ID, &f.UserID, &f.FactorType, &f.Status, &f.Label, &f.EncryptedSecret, &f.EncryptionKid,
		&f.LastUsedCounter, &f.LastUsedAt, &f.PendingExpiresAt, &f.CreatedAt, &f.EnabledAt, &f.RevokedAt,
		&f.UpdatedAt, &f.Version); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrMFAFactorNotFound
		}
		return nil, err
	}
	return &f, nil
}
