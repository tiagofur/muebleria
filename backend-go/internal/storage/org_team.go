package storage

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"strings"
	"time"
)

// Contrato: equipo de la org e invitaciones (#326) — team directory,
// roles/status con versión esperada e invitaciones completas.
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
		SELECT membership_id, user_id, email, name, account_status,
			membership_status, roles, joined_at, version, last_login_at,
			credential_version, sessions_revoked_at
		FROM app_revoke_membership_auth_sessions(
			$1::uuid, $2::uuid, $3::uuid, $4, $5
		)`, actorID, organizationID, membershipID, reason, expectedVersion))
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
