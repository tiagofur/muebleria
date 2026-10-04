package api

// Contrato: stub del stubStore espejo de store_auth (store_auth.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_auth.go
import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"time"
)

func (s *stubStore) CreateAuthDeviceEnrollment(ctx context.Context, cmd storage.DeviceEnrollmentCommand) (*domain.AuthDeviceEnrollment, error) {
	return &domain.AuthDeviceEnrollment{ID: cmd.EnrollmentID, Code: cmd.Code, Status: domain.EnrollmentStatusPending, ExpiresAt: cmd.ExpiresAt}, nil
}

func (s *stubStore) GetAuthDeviceEnrollmentByID(ctx context.Context, id string) (*domain.AuthDeviceEnrollment, error) {
	return nil, storage.ErrEnrollmentNotFound
}

func (s *stubStore) ApproveAuthDeviceEnrollment(ctx context.Context, cmd storage.ApproveDeviceEnrollmentCommand) (*domain.AuthDeviceEnrollment, error) {
	captured := cmd
	s.approveDeviceReceived = &captured
	return &domain.AuthDeviceEnrollment{Code: cmd.Code, Status: domain.EnrollmentStatusApproved}, nil
}

func (s *stubStore) ExchangeAuthDeviceEnrollment(ctx context.Context, cmd storage.ExchangeDeviceCommand) (*storage.ExchangedDevice, error) {
	return nil, storage.ErrEnrollmentConflict
}

func (s *stubStore) ResolveDeviceToken(ctx context.Context, cmd storage.DeviceTokenCommand, execute func(ctx context.Context, result storage.DeviceTokenResult) error) error {
	if s.resolveDeviceResult != nil {
		return execute(ctx, *s.resolveDeviceResult)
	}
	return storage.ErrDeviceNotFound
}

func (s *stubStore) ListAuthDevicesByUser(ctx context.Context, userID string) ([]domain.AuthDevice, error) {
	return nil, nil
}

func (s *stubStore) RevokeAuthDevice(ctx context.Context, cmd storage.RevokeDeviceCommand) error {
	return nil
}

// MFA / step-up stubs (#460 SEC-7): the default answers model a user with no
// factors and no grants so step-up-gated routes fail closed exactly like a
// fresh account; specific tests override the hooks they need.

// MFA / step-up stubs (#460 SEC-7): the default answers model a user with no
// factors and no grants so step-up-gated routes fail closed exactly like a
// fresh account; specific tests override the hooks they need.
func (s *stubStore) CreateMFAEnrollment(ctx context.Context, cmd storage.CreateMFAEnrollmentCommand) (*domain.MFAFactor, error) {
	if s.mfaEnrollFn != nil {
		return s.mfaEnrollFn(ctx, cmd)
	}
	panic("stubStore: CreateMFAEnrollment not configured for this test")
}

func (s *stubStore) GetMFAFactor(ctx context.Context, userID, factorID string) (*domain.MFAFactor, error) {
	return nil, storage.ErrMFAFactorNotFound
}

func (s *stubStore) ListMFAFactors(ctx context.Context, userID string) ([]domain.MFAFactor, error) {
	return nil, nil
}

func (s *stubStore) CountEnabledMFAFactors(ctx context.Context, userID string) (int, error) {
	return s.mfaEnabledFactors, nil
}

func (s *stubStore) EnableMFAFactor(ctx context.Context, cmd storage.EnableMFAFactorCommand) (*storage.EnabledMFAFactor, error) {
	if s.mfaEnableFn != nil {
		return s.mfaEnableFn(ctx, cmd)
	}
	panic("stubStore: EnableMFAFactor not configured for this test")
}

func (s *stubStore) RevokeMFAFactor(ctx context.Context, cmd storage.RevokeMFAFactorCommand) (*domain.MFAFactor, error) {
	if s.mfaRevokeFn != nil {
		return s.mfaRevokeFn(ctx, cmd)
	}
	panic("stubStore: RevokeMFAFactor not configured for this test")
}

func (s *stubStore) RegenerateMFARecoveryCodes(ctx context.Context, cmd storage.RegenerateMFARecoveryCommand) ([]string, error) {
	if s.mfaRegenFn != nil {
		return s.mfaRegenFn(ctx, cmd)
	}
	panic("stubStore: RegenerateMFARecoveryCodes not configured for this test")
}

func (s *stubStore) VerifyMFAStepUp(ctx context.Context, cmd storage.MFAStepUpCommand) (*storage.MFAStepUpResult, error) {
	if s.mfaStepUpFn != nil {
		return s.mfaStepUpFn(ctx, cmd)
	}
	panic("stubStore: VerifyMFAStepUp not configured for this test")
}

func (s *stubStore) GetMFAStepUpFreshness(ctx context.Context, sessionID, userID, scope string) (storage.MFAStepUpFreshness, error) {
	return s.mfaStepUpFreshness, nil
}

// The remaining Store methods are not exercised by the duplicate-key tests.
func (s *stubStore) GetUserByEmail(context.Context, string) (*domain.User, error) {
	return s.getUserByEmail, s.getUserByEmailErr
}

func (s *stubStore) GetUserByID(context.Context, string) (*domain.User, error) {
	if s.getUserByEmail != nil {
		return s.getUserByEmail, s.getUserByEmailErr
	}
	return nil, s.getUserByEmailErr
}

func (s *stubStore) UpdateLastLogin(context.Context, string) error { return nil }

func (s *stubStore) UpdateAccountStatus(_ context.Context, _, userID string, status domain.AccountStatus, _, _ string) (*domain.User, error) {
	return &domain.User{ID: userID, AccountStatus: status, UpdatedAt: time.Now()}, nil
}

func (s *stubStore) CreateUser(context.Context, *domain.User) error {
	return s.createUserErr
}

func (s *stubStore) ListUsers(context.Context) ([]domain.User, error) {
	if s.listUsers != nil {
		return s.listUsers, nil
	}
	return []domain.User{}, nil
}

func (s *stubStore) ListUsersByOrganization(context.Context) ([]domain.User, error) {
	if s.listUsers != nil {
		return s.listUsers, nil
	}
	return []domain.User{}, nil
}

// --- Organizations / memberships / security audit (ADR-0004) ---

// GetOrganizationByID mirrors the stub's single-user world onto the scoped
// organization: the furniture license gate moved from the user to the
// organization (ADR-0004), so legacy license tests keep their intent when the
// org carries the same plan/expiry as the configured user.
