package storage

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

var (
	ErrDeviceNotFound     = errors.New("device not found")
	ErrEnrollmentNotFound = errors.New("enrollment not found")
	ErrEnrollmentConflict = errors.New("enrollment not claimable")
	ErrDeviceRevoked      = errors.New("device revoked")
)

const deviceColumns = `id, user_id, client_type, display_name, credential_hash, current_session_id, last_seen_at, revoked_at, credential_version, metadata, created_at, updated_at, version`
const enrollmentColumns = `id, code, user_id, client_type, display_name, status, expires_at, created_at, updated_at, version`

// DeviceEnrollmentCommand creates an anonymous pending enrollment. There is
// no user yet: the approving user claims the row by code later.
type DeviceEnrollmentCommand struct {
	EnrollmentID string
	Code         string
	ClientType   string
	DisplayName  string
	ExpiresAt    time.Time
	IP           string
	RequestID    string
}

// ApproveDeviceEnrollmentCommand binds a pending enrollment to the approving
// user. The claim is a single conditional UPDATE: a second presentation of
// the same code loses to the first committer.
type ApproveDeviceEnrollmentCommand struct {
	Code          string
	ApprovingUser string
	IP            string
	RequestID     string
}

// ExchangeDeviceCommand consumes an approved enrollment and mints the device
// credential plus its registry session in one transaction. RawSecret exists
// only in the exchange response; the database stores the sha256 hash.
type ExchangeDeviceCommand struct {
	EnrollmentID string
	IP           string
	RequestID    string
}

type ExchangedDevice struct {
	Device    *domain.AuthDevice
	RawSecret string // "<device id>:<64 hex chars>"
	Session   *domain.AuthSession
}

// DeviceTokenCommand re-mints a transport token from the stored device
// secret. The secret never leaves this layer: possession is proven to RLS by
// the app.device_secret_hash scope, and the callback receives the device and
// its live registry session for token minting under the owner actor.
type DeviceTokenCommand struct {
	DeviceID string
	Secret   string
	IP       string
}

// DeviceTokenResult is what the token flow resolves before minting. The
// scope fields mirror login's auto-selection: a user with exactly one active
// membership gets an org-scoped bearer (the extension has no org-picker);
// otherwise the bearer stays org-less and may reach /api/auth/select-org.
type DeviceTokenResult struct {
	Device                        *domain.AuthDevice
	User                          *domain.User
	Session                       *domain.AuthSession
	SessionRefreshed              bool // a new registry session was created (absolute bound passed)
	OrgID                         string
	MembershipID                  string
	MembershipCredentialVersion   int64
	OrganizationCredentialVersion int64
	Roles                         []string
}

// RevokeDeviceCommand revokes a device and cuts its registry session. The
// UPDATE is scoped to the owning user: nobody can revoke someone else's
// device through this path.
type RevokeDeviceCommand struct {
	DeviceID  string
	OwnerUser string
	IP        string
	RequestID string
}

func scanAuthDevice(row pgx.Row) (*domain.AuthDevice, error) {
	var d domain.AuthDevice
	if err := row.Scan(&d.ID, &d.UserID, &d.ClientType, &d.DisplayName, &d.CredentialHash,
		&d.CurrentSessionID, &d.LastSeenAt, &d.RevokedAt, &d.CredentialVersion, &d.Metadata,
		&d.CreatedAt, &d.UpdatedAt, &d.Version); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDeviceNotFound
		}
		return nil, err
	}
	return &d, nil
}

func scanAuthDeviceEnrollment(row pgx.Row) (*domain.AuthDeviceEnrollment, error) {
	var e domain.AuthDeviceEnrollment
	if err := row.Scan(&e.ID, &e.Code, &e.UserID, &e.ClientType, &e.DisplayName,
		&e.Status, &e.ExpiresAt, &e.CreatedAt, &e.UpdatedAt, &e.Version); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrEnrollmentNotFound
		}
		return nil, err
	}
	return &e, nil
}

// CreateAuthDeviceEnrollment saves a new anonymous enrollment request. The
// RLS insert policy only admits the pending NULL-owner shape. Creation is
// audited so abuse of the unauthenticated endpoint stays traceable.
func (s *PostgresStore) CreateAuthDeviceEnrollment(ctx context.Context, cmd DeviceEnrollmentCommand) (*domain.AuthDeviceEnrollment, error) {
	if cmd.EnrollmentID == "" || len(cmd.Code) != 6 || cmd.ClientType == "" || cmd.DisplayName == "" || !cmd.ExpiresAt.After(time.Now()) {
		return nil, fmt.Errorf("device enrollment requires id, code, client type, display name and future expiry")
	}
	var out *domain.AuthDeviceEnrollment
	err := s.WithinTenantTx(ctx, TenantActor{}, func(txCtx context.Context) error {
		// INSERT ... RETURNING under FORCE RLS also runs the SELECT policies:
		// scope the keyed arm to the row this server is minting so the
		// returning projection is visible without any user identity.
		if _, err := transactionFromContext(txCtx).Exec(txCtx,
			`SELECT set_config('app.device_enrollment_id', $1, true)`, cmd.EnrollmentID); err != nil {
			return fmt.Errorf("set enrollment scope: %w", err)
		}
		created, err := scanAuthDeviceEnrollment(s.db(txCtx).QueryRow(txCtx, `
			INSERT INTO auth_device_enrollments (id, code, client_type, display_name, expires_at)
			VALUES ($1::uuid, $2, $3, $4, $5)
			RETURNING `+enrollmentColumns,
			cmd.EnrollmentID, cmd.Code, cmd.ClientType, cmd.DisplayName, cmd.ExpiresAt))
		if err != nil {
			return err
		}
		out = created
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType: "device_enrollment_created",
			IP:        cmd.IP,
			Details: map[string]interface{}{
				"enrollment_id": cmd.EnrollmentID,
				"client_type":   cmd.ClientType,
				"display_name":  cmd.DisplayName,
				"request_id":    cmd.RequestID,
			},
		})
	})
	return out, err
}

// GetAuthDeviceEnrollmentByID looks up an enrollment by the id that was
// minted for the enrolling device. The read is scoped to that exact row via
// the app.device_enrollment_id RLS arm — a bare id is a capability, never a
// broad grant.
func (s *PostgresStore) GetAuthDeviceEnrollmentByID(ctx context.Context, id string) (*domain.AuthDeviceEnrollment, error) {
	var out *domain.AuthDeviceEnrollment
	err := s.WithinTenantTx(ctx, TenantActor{}, func(txCtx context.Context) error {
		tx := transactionFromContext(txCtx)
		if _, err := tx.Exec(txCtx, `SELECT set_config('app.device_enrollment_id', $1, true)`, id); err != nil {
			return fmt.Errorf("set enrollment scope: %w", err)
		}
		enrollment, err := scanAuthDeviceEnrollment(s.db(txCtx).QueryRow(txCtx,
			`SELECT `+enrollmentColumns+` FROM auth_device_enrollments WHERE id = $1::uuid`, id))
		out = enrollment
		return err
	})
	return out, err
}

// ApproveAuthDeviceEnrollment claims a pending enrollment for the approving
// user. It joins the ambient authenticated transaction when the caller is
// behind auth middleware; the code GUC scopes RLS to the single row the
// approver named.
func (s *PostgresStore) ApproveAuthDeviceEnrollment(ctx context.Context, cmd ApproveDeviceEnrollmentCommand) (*domain.AuthDeviceEnrollment, error) {
	if cmd.Code == "" || cmd.ApprovingUser == "" {
		return nil, fmt.Errorf("device enrollment approval requires code and approving user")
	}
	var approved *domain.AuthDeviceEnrollment
	execute := func(txCtx context.Context) error {
		if _, err := transactionFromContext(txCtx).Exec(txCtx,
			`SELECT set_config('app.device_enrollment_code', $1, true)`, cmd.Code); err != nil {
			return fmt.Errorf("set enrollment code scope: %w", err)
		}
		claimed, err := scanAuthDeviceEnrollment(s.db(txCtx).QueryRow(txCtx, `
			UPDATE auth_device_enrollments
			SET status = $1, user_id = $2::uuid, updated_at = NOW(), version = version + 1
			WHERE code = $3 AND status = $4 AND expires_at > NOW()
			RETURNING `+enrollmentColumns,
			domain.EnrollmentStatusApproved, cmd.ApprovingUser, cmd.Code, domain.EnrollmentStatusPending))
		if errors.Is(err, ErrEnrollmentNotFound) {
			return ErrEnrollmentConflict
		}
		if err != nil {
			return err
		}
		approved = claimed
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:   "device_enrollment_approved",
			ActorUserID: cmd.ApprovingUser,
			IP:          cmd.IP,
			Details: map[string]interface{}{
				"enrollment_id": claimed.ID,
				"client_type":   claimed.ClientType,
				"request_id":    cmd.RequestID,
			},
		})
	}
	if transactionFromContext(ctx) != nil {
		return approved, execute(ctx)
	}
	err := s.WithinTenantTx(ctx, TenantActor{UserID: cmd.ApprovingUser}, execute)
	return approved, err
}

// ExchangeAuthDeviceEnrollment consumes the approved enrollment and creates
// the device credential, its registry session and the audit record in ONE
// transaction: the conditional approved→exchanged UPDATE makes a replayed
// exchange lose atomically instead of minting a second secret.
func (s *PostgresStore) ExchangeAuthDeviceEnrollment(ctx context.Context, cmd ExchangeDeviceCommand) (*ExchangedDevice, error) {
	if cmd.EnrollmentID == "" {
		return nil, fmt.Errorf("device exchange requires enrollment id")
	}
	secretBytes := make([]byte, 32)
	if _, err := rand.Read(secretBytes); err != nil {
		return nil, fmt.Errorf("device secret entropy: %w", err)
	}
	rawSecret := hex.EncodeToString(secretBytes)
	hash := sha256.Sum256([]byte(rawSecret))

	var result *ExchangedDevice
	err := s.WithinTenantTx(ctx, TenantActor{}, func(txCtx context.Context) error {
		tx := transactionFromContext(txCtx)
		if _, err := tx.Exec(txCtx, `SELECT set_config('app.device_enrollment_id', $1, true)`, cmd.EnrollmentID); err != nil {
			return fmt.Errorf("set enrollment scope: %w", err)
		}
		enrollment, err := scanAuthDeviceEnrollment(s.db(txCtx).QueryRow(txCtx,
			`SELECT `+enrollmentColumns+` FROM auth_device_enrollments WHERE id = $1::uuid`, cmd.EnrollmentID))
		if err != nil {
			return err
		}
		if enrollment.Status != domain.EnrollmentStatusApproved || enrollment.UserID == nil || !enrollment.ExpiresAt.After(time.Now()) {
			return ErrEnrollmentConflict
		}
		// The keyed read above proved possession of the enrollment id; from
		// here the flow runs as the enrolled owner, exactly like refresh
		// rotation installs the credential row's user.
		owner := *enrollment.UserID
		if err := setTenantContext(txCtx, tx, TenantActor{UserID: owner}); err != nil {
			return err
		}
		txCtx = context.WithValue(WithTenantActorCtx(txCtx, TenantActor{UserID: owner}), transactionContextKey{}, tx)

		consumed, err := s.db(txCtx).Exec(txCtx, `
			UPDATE auth_device_enrollments
			SET status = $1, updated_at = NOW(), version = version + 1
			WHERE id = $2::uuid AND status = $3 AND user_id = $4::uuid`,
			domain.EnrollmentStatusExchanged, cmd.EnrollmentID, domain.EnrollmentStatusApproved, owner)
		if err != nil {
			return err
		}
		if consumed.RowsAffected() == 0 {
			return ErrEnrollmentConflict
		}

		// INSERT ... RETURNING under FORCE RLS also runs the SELECT policies:
		// the owner arm cannot see the row before it exists, so scope the
		// secret-hash arm to the credential this exchange is minting.
		if _, err := tx.Exec(txCtx, `SELECT set_config('app.device_secret_hash', $1, true)`, hex.EncodeToString(hash[:])); err != nil {
			return fmt.Errorf("set device secret scope: %w", err)
		}
		device, err := scanAuthDevice(s.db(txCtx).QueryRow(txCtx, `
			INSERT INTO auth_devices (id, user_id, client_type, display_name, credential_hash)
			VALUES ($1::uuid, $2::uuid, $3, $4, $5)
			RETURNING `+deviceColumns,
			uuid.NewString(), owner, enrollment.ClientType, enrollment.DisplayName, hash[:]))
		if err != nil {
			return err
		}

		// The registry session adopts login's auto-selection scope so the
		// first bearer is org-scoped for single-membership workshops (the
		// extension has no org picker).
		exchangeMembershipID, exchangeOrganizationID := s.scopeForDeviceSession(txCtx, owner)
		session, err := s.CreateAuthSession(txCtx, CreateAuthSessionCommand{
			UserID:            owner,
			MembershipID:      exchangeMembershipID,
			OrganizationID:    exchangeOrganizationID,
			ClientType:        domain.SessionClientSketchup,
			AbsoluteExpiresAt: time.Now().Add(auth.TransportSessionTTL(string(domain.SessionClientSketchup))).UTC(),
			DeviceHint:        sanitizeDeviceHintForRegistry(enrollment.DisplayName),
		})
		if err != nil {
			return err
		}
		device, err = scanAuthDevice(s.db(txCtx).QueryRow(txCtx, `
			UPDATE auth_devices SET current_session_id = $1::uuid, updated_at = NOW(), version = version + 1
			WHERE id = $2::uuid
			RETURNING `+deviceColumns,
			session.ID, device.ID))
		if err != nil {
			return err
		}

		if err := s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:   "device_exchanged",
			ActorUserID: owner,
			IP:          cmd.IP,
			Details: map[string]interface{}{
				"device_id":     device.ID,
				"session_id":    session.ID,
				"enrollment_id": cmd.EnrollmentID,
				"request_id":    cmd.RequestID,
			},
		}); err != nil {
			return err
		}
		result = &ExchangedDevice{Device: device, RawSecret: device.ID + ":" + rawSecret, Session: session}
		return nil
	})
	return result, err
}

// ResolveDeviceToken validates the presented device secret and resolves the
// live registry session that backs the next transport token. RLS sees the
// sha256 of the presented secret (app.device_secret_hash): a wrong secret
// leaves the row invisible and surfaces as ErrDeviceNotFound. When the
// current session passed its absolute bound or was revoked, a NEW session is
// minted — the absolute bound never slides.
func (s *PostgresStore) ResolveDeviceToken(ctx context.Context, cmd DeviceTokenCommand, execute func(txCtx context.Context, result DeviceTokenResult) error) error {
	if cmd.DeviceID == "" || cmd.Secret == "" {
		return ErrDeviceNotFound
	}
	hash := sha256.Sum256([]byte(cmd.Secret))
	return s.WithinTenantTx(ctx, TenantActor{}, func(txCtx context.Context) error {
		tx := transactionFromContext(txCtx)
		if _, err := tx.Exec(txCtx, `SELECT set_config('app.device_secret_hash', $1, true)`, hex.EncodeToString(hash[:])); err != nil {
			return fmt.Errorf("set device secret scope: %w", err)
		}
		device, err := scanAuthDevice(s.db(txCtx).QueryRow(txCtx,
			`SELECT `+deviceColumns+` FROM auth_devices WHERE id = $1::uuid AND revoked_at IS NULL`, cmd.DeviceID))
		if err != nil {
			return err
		}
		if err := setTenantContext(txCtx, tx, TenantActor{UserID: device.UserID}); err != nil {
			return err
		}
		txCtx = context.WithValue(WithTenantActorCtx(txCtx, TenantActor{UserID: device.UserID}), transactionContextKey{}, tx)

		user, err := s.GetUserByID(txCtx, device.UserID)
		if err != nil || user == nil || user.AccountStatus != domain.AccountStatusActive {
			return ErrDeviceNotFound
		}

		session, refreshed, err := s.deviceSessionForToken(txCtx, device, user)
		if err != nil {
			return err
		}
		if _, err := s.db(txCtx).Exec(txCtx,
			`UPDATE auth_devices SET last_seen_at = NOW(), updated_at = NOW() WHERE id = $1::uuid`, device.ID); err != nil {
			return err
		}
		result := DeviceTokenResult{Device: device, User: user, Session: session, SessionRefreshed: refreshed}
		// The bearer mirrors the session's CURRENT scope: org-scoped when the
		// single-membership auto-selection holds, org-less for the selection
		// phase. Membership roles/versions are re-read live so a revoked
		// membership cuts the very token minted after it.
		if session.ActiveOrganizationID != nil && session.MembershipID != nil {
			m, err := s.GetActiveMembership(txCtx, user.ID, *session.ActiveOrganizationID)
			if err != nil || m == nil || m.ID != *session.MembershipID ||
				m.Status != domain.MembershipStatusActive || m.Organization.Status != domain.OrganizationStatusActive || len(m.Roles) == 0 {
				return ErrDeviceNotFound
			}
			result.OrgID = m.OrganizationID
			result.MembershipID = m.ID
			result.MembershipCredentialVersion = m.CredentialVersion
			result.OrganizationCredentialVersion = m.Organization.CredentialVersion
			for _, role := range m.Roles {
				result.Roles = append(result.Roles, string(role))
			}
		}
		return execute(txCtx, result)
	})
}

// scopeForDeviceSession mirrors login's auto-selection: exactly one active
// membership (active organization) scopes the device session; zero or
// several leave it org-less for the explicit selection phase.
func (s *PostgresStore) scopeForDeviceSession(txCtx context.Context, userID string) (membershipID, organizationID string) {
	memberships, err := s.ListMembershipsByUser(txCtx, userID)
	if err != nil || len(memberships) != 1 {
		return "", ""
	}
	m := memberships[0]
	if m.Status != domain.MembershipStatusActive || m.Organization.Status != domain.OrganizationStatusActive || m.ID == "" {
		return "", ""
	}
	return m.ID, m.OrganizationID
}

// deviceSessionForToken returns the device's live registry session, minting a
// new one when the previous passed its absolute bound or was revoked. The
// caller runs inside the owner-actor transaction.
func (s *PostgresStore) deviceSessionForToken(txCtx context.Context, device *domain.AuthDevice, user *domain.User) (*domain.AuthSession, bool, error) {
	if device.CurrentSessionID != nil {
		var session domain.AuthSession
		err := s.db(txCtx).QueryRow(txCtx, `
			SELECT id, user_id, membership_id, active_organization_id, support_session_id,
				client_type, created_at, absolute_expires_at, last_seen_at, revoked_at,
				revoked_by, revoke_reason, device_hint
			FROM auth_sessions
			WHERE id = $1::uuid AND user_id = $2::uuid AND client_type = $3`,
			*device.CurrentSessionID, device.UserID, domain.SessionClientSketchup).
			Scan(&session.ID, &session.UserID, &session.MembershipID, &session.ActiveOrganizationID, &session.SupportSessionID,
				&session.ClientType, &session.CreatedAt, &session.AbsoluteExpiresAt, &session.LastSeenAt, &session.RevokedAt,
				&session.RevokedBy, &session.RevokeReason, &session.DeviceHint)
		if err == nil && session.RevokedAt == nil && session.AbsoluteExpiresAt.After(time.Now()) {
			return &session, false, nil
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, false, err
		}
	}
	// A new registry session adopts login's auto-selection scope: exactly
	// one active membership scopes it; zero or several stay org-less.
	membershipID, organizationID := s.scopeForDeviceSession(txCtx, device.UserID)
	created, err := s.CreateAuthSession(txCtx, CreateAuthSessionCommand{
		UserID:            device.UserID,
		MembershipID:      membershipID,
		OrganizationID:    organizationID,
		ClientType:        domain.SessionClientSketchup,
		AbsoluteExpiresAt: time.Now().Add(auth.TransportSessionTTL(string(domain.SessionClientSketchup))).UTC(),
		DeviceHint:        sanitizeDeviceHintForRegistry(device.DisplayName),
	})
	if err != nil {
		return nil, false, err
	}
	if _, err := s.db(txCtx).Exec(txCtx, `
		UPDATE auth_devices SET current_session_id = $1::uuid, updated_at = NOW(), version = version + 1
		WHERE id = $2::uuid`, created.ID, device.ID); err != nil {
		return nil, false, err
	}
	return created, true, nil
}

// sanitizeDeviceHintForRegistry collapses free-form labels to the registry's
// sanitized-hint policy (no PII beyond what the user chose to name).
func sanitizeDeviceHintForRegistry(label string) string {
	hint := strings.Join(strings.Fields(label), " ")
	runes := []rune(hint)
	if len(runes) > 120 {
		runes = runes[:120]
	}
	return string(runes)
}

// ListAuthDevicesByUser returns the owner's devices, newest first. It
// establishes the owner actor itself so the read works with or without the
// ambient authenticated transaction. The credential hash NEVER leaves this
// layer: the API surface is metadata only.
func (s *PostgresStore) ListAuthDevicesByUser(ctx context.Context, userID string) ([]domain.AuthDevice, error) {
	if transactionFromContext(ctx) != nil {
		return listAuthDevices(ctx, s, userID)
	}
	var out []domain.AuthDevice
	err := s.WithinTenantTx(ctx, TenantActor{UserID: userID}, func(txCtx context.Context) error {
		devices, err := listAuthDevices(txCtx, s, userID)
		out = devices
		return err
	})
	return out, err
}

func listAuthDevices(ctx context.Context, s *PostgresStore, userID string) ([]domain.AuthDevice, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT `+deviceColumns+` FROM auth_devices WHERE user_id = $1::uuid
		ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var res []domain.AuthDevice
	for rows.Next() {
		d, err := scanAuthDevice(rows)
		if err != nil {
			return nil, err
		}
		d.CredentialHash = nil
		res = append(res, *d)
	}
	return res, rows.Err()
}

// RevokeAuthDevice revokes the owner's device and cuts its live registry
// session in the same transaction. Ownership is enforced by the UPDATE
// itself: another user's device id updates zero rows.
func (s *PostgresStore) RevokeAuthDevice(ctx context.Context, cmd RevokeDeviceCommand) error {
	if cmd.DeviceID == "" || cmd.OwnerUser == "" {
		return fmt.Errorf("device revocation requires device id and owner")
	}
	return s.WithinTenantTx(ctx, TenantActor{UserID: cmd.OwnerUser}, func(txCtx context.Context) error {
		revoked, err := s.db(txCtx).Exec(txCtx, `
			UPDATE auth_devices
			SET revoked_at = NOW(), updated_at = NOW(), version = version + 1
			WHERE id = $1::uuid AND user_id = $2::uuid AND revoked_at IS NULL`,
			cmd.DeviceID, cmd.OwnerUser)
		if err != nil {
			return err
		}
		if revoked.RowsAffected() == 0 {
			// Idempotent re-revoke of an already-revoked own device is fine;
			// anything else (foreign id / unknown) is a not-found.
			var exists int
			if err := s.db(txCtx).QueryRow(txCtx,
				`SELECT 1 FROM auth_devices WHERE id = $1::uuid AND user_id = $2::uuid AND revoked_at IS NOT NULL`,
				cmd.DeviceID, cmd.OwnerUser).Scan(&exists); err != nil {
				return ErrDeviceNotFound
			}
			return nil
		}
		if _, err := s.db(txCtx).Exec(txCtx, `
			UPDATE auth_sessions s
			SET revoked_at = NOW(), revoked_by = $2::uuid, revoke_reason = 'device_revoked'
			WHERE s.id = (SELECT d.current_session_id FROM auth_devices d
			              WHERE d.id = $1::uuid AND d.current_session_id IS NOT NULL)`,
			cmd.DeviceID, cmd.OwnerUser); err != nil {
			return err
		}
		return s.InsertSecurityAuditEvent(txCtx, SecurityAuditEvent{
			EventType:   "device_revoked",
			ActorUserID: cmd.OwnerUser,
			IP:          cmd.IP,
			Details: map[string]interface{}{
				"device_id":  cmd.DeviceID,
				"request_id": cmd.RequestID,
			},
		})
	})
}
