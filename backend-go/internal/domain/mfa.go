package domain

import "time"

// #460 SEC-7 — MFA factor and step-up domain shapes.

// MFA factor lifecycle: a factor generated but not verified is Pending and
// authorizes nothing; only a verified TOTP transition makes it Enabled;
// Revoked is terminal.
const (
	MFAFactorStatusPending = "pending"
	MFAFactorStatusEnabled = "enabled"
	MFAFactorStatusRevoked = "revoked"
)

// MFA factor types. SEC-7 ships TOTP; WebAuthn/passkeys remain a future
// evolution (explicitly out of this slice's scope).
const MFAFactorTypeTOTP = "totp"

// Step-up scopes (#460 SEC-7 least privilege): one verification authorizes
// exactly one scope, never every sensitive action at once.
const (
	StepUpScopeDeviceEnrollment  = "device_enrollment"
	StepUpScopeSupportAccess     = "support_access"
	StepUpScopeSecurityAdmin     = "security_admin"
	StepUpScopeOrganizationAdmin = "organization_admin"
	StepUpScopePlatformAdmin     = "platform_admin"
)

// StepUpMethod is how the fresh identity proof was provided.
const (
	StepUpMethodTOTP     = "totp"
	StepUpMethodRecovery = "recovery"
)

// MFAFactor is a user's authentication factor. EncryptedSecret is the sealed
// TOTP secret (storage-only: API projections always nil it out).
type MFAFactor struct {
	ID               string
	UserID           string
	FactorType       string
	Status           string
	Label            string
	EncryptedSecret  []byte
	EncryptionKid    string
	LastUsedCounter  *int64
	LastUsedAt       *time.Time
	PendingExpiresAt *time.Time
	CreatedAt        time.Time
	EnabledAt        *time.Time
	RevokedAt        *time.Time
	UpdatedAt        time.Time
	Version          int64
}

// MFARecoveryCode is a single-use recovery verifier. Verifier is the keyed
// HMAC (storage-only; the plaintext exists exactly once at generation).
type MFARecoveryCode struct {
	ID            string
	UserID        string
	Verifier      []byte
	EncryptionKid string
	UsedAt        *time.Time
	RevokedAt     *time.Time
	CreatedAt     time.Time
}

// MFAStepUpGrant is the server-side elevated-authority record bound to one
// registry session, user and scope.
type MFAStepUpGrant struct {
	ID            string
	AuthSessionID string
	UserID        string
	Scope         string
	Method        string
	CreatedAt     time.Time
	ExpiresAt     time.Time
}

// ValidStepUpScope reports whether a scope is one of the defined least
// -privilege step-up scopes.
func ValidStepUpScope(scope string) bool {
	switch scope {
	case StepUpScopeDeviceEnrollment, StepUpScopeSupportAccess, StepUpScopeSecurityAdmin,
		StepUpScopeOrganizationAdmin, StepUpScopePlatformAdmin:
		return true
	}
	return false
}
