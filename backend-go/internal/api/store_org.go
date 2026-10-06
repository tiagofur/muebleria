package api

import (
	"context"
	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"time"
)

// Contrato: organizaciones, membresías, auditoría de seguridad, sesiones de
// soporte, equipo e invitaciones (ADR-0004/0005, #326).
type OrgStore interface {
	// Organizations / memberships / security audit (ADR-0004)
	GetOrganizationByID(ctx context.Context, id string) (*domain.Organization, error)
	GetOrganizationBySlug(ctx context.Context, slug string) (*domain.Organization, error)
	ListOrganizations(ctx context.Context) ([]domain.Organization, error)
	CreateOrganization(ctx context.Context, o *domain.Organization) error
	ListMembershipsByUser(ctx context.Context, userID string) ([]domain.MembershipWithOrg, error)
	// ListConnectedOrganizations returns the sales network of a factory (#326).
	ListConnectedOrganizations(ctx context.Context, parentOrganizationID string) ([]domain.Organization, error)
	GetActiveMembership(ctx context.Context, userID, organizationID string) (*domain.MembershipWithOrg, error)
	EnsureMembership(ctx context.Context, organizationID, userID string, roles []domain.UserRole) error
	SetPlatformAdmin(ctx context.Context, userID string, admin bool) error
	InsertSecurityAuditEvent(ctx context.Context, ev storage.SecurityAuditEvent) error
	UpdateOrganization(ctx context.Context, o *domain.Organization) error
	UpdateOrganizationVersion(ctx context.Context, o *domain.Organization, expectedVersion int64) error
	CloneCatalog(ctx context.Context, srcOrg, dstOrg string) error

	// Support sessions (ADR-0005 §5)
	StartSupportSession(ctx context.Context, adminUserID, organizationID, reason string, ttl time.Duration, organizationCredentialVersion int64) (*domain.SupportSession, error)
	GetOpenSupportSession(ctx context.Context, sessionID string) (*domain.SupportSession, error)
	EndSupportSession(ctx context.Context, sessionID, adminUserID, via string) (bool, error)
	// EndOpenSupportSessionsByOrg cuts every open support session of an org
	// (suspension path, ADR-0005 §5).
	EndOpenSupportSessionsByOrg(ctx context.Context, organizationID, via string) (int64, error)

	// Org team & invitations (#326)
	ListOrgTeam(ctx context.Context, organizationID, actorID string) ([]storage.OrgTeamMember, error)
	GetOrgTeamSummary(ctx context.Context, organizationID, actorID string) (*storage.OrgTeamSummary, error)
	UpdateMembershipRolesByOrg(ctx context.Context, organizationID, membershipID string, roles []domain.UserRole, expectedVersion int64) (*storage.OrgTeamMember, error)
	UpdateMembershipStatus(ctx context.Context, organizationID, membershipID string, status domain.MembershipStatus, reason, actorID string, expectedVersion int64) (*storage.OrgTeamMember, error)
	RevokeMembershipSessions(ctx context.Context, organizationID, membershipID, actorID, reason string, expectedVersion int64) (*storage.OrgTeamMember, error)
	GetMembershipResponsibilityInventory(ctx context.Context, membershipID string) (*storage.MembershipResponsibilityInventory, error)
	CreateInvitation(ctx context.Context, organizationID, email string, roles []domain.UserRole, tokenHash string, expiresAt time.Time, invitedBy string) (*storage.Invitation, error)
	ListInvitations(ctx context.Context, organizationID, actorID string) ([]storage.Invitation, error)
	ResendInvitation(ctx context.Context, organizationID, id, tokenHash string, expiresAt time.Time, expectedVersion int64) (*storage.Invitation, error)
	RevokeInvitation(ctx context.Context, organizationID, id, reason, actorID string, expectedVersion int64) (*storage.Invitation, error)
	AcceptInvitation(ctx context.Context, cmd storage.AcceptInvitationCommand, verifyPassword func(string, string) bool, validateNewPassword func(string) error) (*storage.AcceptInvitationResult, error)
	PreviewInvitation(ctx context.Context, tokenHash string) (*storage.InvitationPreview, error)
	// Password reset (#1178): one-time token lifecycle + user-level session cut.
	RequestPasswordReset(ctx context.Context, email, ip, requestID string) (*storage.PasswordResetIssuance, error)
	IssuePasswordResetToken(ctx context.Context, userID, issuedVia string, issuedBy *string, ttl time.Duration, ip, requestID string) (*storage.PasswordResetIssuance, error)
	ConfirmPasswordReset(ctx context.Context, cmd storage.ConfirmPasswordResetCommand) (int, error)
	ListSecurityAuditEvents(ctx context.Context, organizationID string, limit int) ([]openapi.SecurityAuditEvent, error)
	GetUserByEmailAnyState(ctx context.Context, email string) (*domain.User, error)
}
