package domain

import (
	"time"
)

// AuthDevice represents a persistent device credential, e.g. SketchUp,
// that is enrolled by a user and can exchange its device_secret for short
// access tokens.
type AuthDevice struct {
	ID                string    `json:"id" db:"id"`
	UserID            string    `json:"user_id" db:"user_id"`
	ClientType        string    `json:"client_type" db:"client_type"`
	DisplayName       string    `json:"display_name" db:"display_name"`
	CredentialHash    []byte    `json:"-" db:"credential_hash"`
	LastSeenAt        *time.Time `json:"last_seen_at" db:"last_seen_at"`
	RevokedAt         *time.Time `json:"revoked_at" db:"revoked_at"`
	CredentialVersion int64     `json:"credential_version" db:"credential_version"`
	Metadata          string    `json:"metadata" db:"metadata"` // JSONB stored as string
	CreatedAt         time.Time `json:"created_at" db:"created_at"`
	UpdatedAt         time.Time `json:"updated_at" db:"updated_at"`
	Version           int64     `json:"version" db:"version"`
}

// AuthDeviceEnrollment represents a short-lived request by a device to be
// enrolled. The code is shown to the user who approves it in the web console.
type AuthDeviceEnrollment struct {
	ID          string    `json:"id" db:"id"`
	Code        string    `json:"code" db:"code"`
	UserID      *string   `json:"user_id" db:"user_id"`
	ClientType  string    `json:"client_type" db:"client_type"`
	DisplayName string    `json:"display_name" db:"display_name"`
	Status      string    `json:"status" db:"status"` // pending, approved, exchanged, expired
	ExpiresAt   time.Time `json:"expires_at" db:"expires_at"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
	Version     int64     `json:"version" db:"version"`
}

const (
	EnrollmentStatusPending   = "pending"
	EnrollmentStatusApproved  = "approved"
	EnrollmentStatusExchanged = "exchanged"
	EnrollmentStatusExpired   = "expired"
)
