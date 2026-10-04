package api

import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Contrato: operaciones de identidad y sesión — devices, MFA, usuarios,
// sesiones ver5 y credenciales de refresh. Consumido por handlers de auth.
type AuthStore interface {
	// Auth Devices (#460 SEC-6)
	CreateAuthDeviceEnrollment(ctx context.Context, cmd storage.DeviceEnrollmentCommand) (*domain.AuthDeviceEnrollment, error)
	GetAuthDeviceEnrollmentByID(ctx context.Context, id string) (*domain.AuthDeviceEnrollment, error)
	ApproveAuthDeviceEnrollment(ctx context.Context, cmd storage.ApproveDeviceEnrollmentCommand) (*domain.AuthDeviceEnrollment, error)
	ExchangeAuthDeviceEnrollment(ctx context.Context, cmd storage.ExchangeDeviceCommand) (*storage.ExchangedDevice, error)
	ResolveDeviceToken(ctx context.Context, cmd storage.DeviceTokenCommand, execute func(ctx context.Context, result storage.DeviceTokenResult) error) error
	ListAuthDevicesByUser(ctx context.Context, userID string) ([]domain.AuthDevice, error)
	RevokeAuthDevice(ctx context.Context, cmd storage.RevokeDeviceCommand) error

	// Auth MFA / step-up (#460 SEC-7)
	CreateMFAEnrollment(ctx context.Context, cmd storage.CreateMFAEnrollmentCommand) (*domain.MFAFactor, error)
	GetMFAFactor(ctx context.Context, userID, factorID string) (*domain.MFAFactor, error)
	ListMFAFactors(ctx context.Context, userID string) ([]domain.MFAFactor, error)
	CountEnabledMFAFactors(ctx context.Context, userID string) (int, error)
	EnableMFAFactor(ctx context.Context, cmd storage.EnableMFAFactorCommand) (*storage.EnabledMFAFactor, error)
	RevokeMFAFactor(ctx context.Context, cmd storage.RevokeMFAFactorCommand) (*domain.MFAFactor, error)
	RegenerateMFARecoveryCodes(ctx context.Context, cmd storage.RegenerateMFARecoveryCommand) ([]string, error)
	VerifyMFAStepUp(ctx context.Context, cmd storage.MFAStepUpCommand) (*storage.MFAStepUpResult, error)
	GetMFAStepUpFreshness(ctx context.Context, sessionID, userID, scope string) (storage.MFAStepUpFreshness, error)

	// Auth / users
	GetUserByEmail(ctx context.Context, email string) (*domain.User, error)
	// GetUserByID loads the user for JWT re-validation of role/active (issue #16).
	GetUserByID(ctx context.Context, id string) (*domain.User, error)
	CreateUser(ctx context.Context, u *domain.User) error
	UpdateLastLogin(ctx context.Context, id string) error
	UpdateAccountStatus(ctx context.Context, actorID, userID string, status domain.AccountStatus, reason, ip string) (*domain.User, error)
	ListUsers(ctx context.Context) ([]domain.User, error)
	// ListUsersByOrganization scopes the directory to the context's
	// organization (ADR-0005: org admins never see other orgs' users).
	ListUsersByOrganization(ctx context.Context) ([]domain.User, error)

	// Session registry (#460 / SEC-1): revocation and absolute-lifetime
	// authority behind every ver5 token.
	CreateAuthSession(ctx context.Context, cmd storage.CreateAuthSessionCommand) (*domain.AuthSession, error)
	GetAuthSessionForRequest(ctx context.Context, sessionID, expectedUserID string) (*domain.AuthSession, error)
	UpdateAuthSessionScope(ctx context.Context, sessionID, membershipID, organizationID string) error
	RevokeAuthSession(ctx context.Context, sessionID, revokedBy, reason string) (bool, error)
	ListOwnAuthSessions(ctx context.Context, userID string, limit int) ([]storage.AuthSessionDirectoryEntry, error)
	ListMembershipAuthSessions(ctx context.Context, actorUserID, organizationID, membershipID string, limit int) ([]storage.AuthSessionDirectoryEntry, error)
	ListPlatformUserAuthSessions(ctx context.Context, userID string, limit int) ([]storage.AuthSessionDirectoryEntry, error)
	RevokeOwnAuthSession(ctx context.Context, cmd storage.RevokeAuthSessionCommand) (*storage.AuthSessionRevocation, error)
	RevokeMembershipAuthSession(ctx context.Context, cmd storage.RevokeAuthSessionCommand) (*storage.AuthSessionRevocation, error)
	RevokePlatformAuthSession(ctx context.Context, cmd storage.RevokeAuthSessionCommand) (*storage.AuthSessionRevocation, error)
	CreateAuthRefreshCredential(ctx context.Context, cmd storage.CreateAuthRefreshCredentialCommand) (*storage.AuthRefreshCredential, error)
	RotateAuthRefreshCredential(ctx context.Context, cmd storage.RotateAuthRefreshCredentialCommand, execute storage.AuthRefreshRotationCallback) (*storage.AuthRefreshRotation, error)
	LogoutByRefreshCredential(ctx context.Context, verifier []byte, ip, requestID string) error
}
