package domain

import "time"

// #499 / DT-SU-1: one-time Web-to-SketchUp pairing grants. A grant is
// created by an authenticated organization user against an exact
// Project/Design and exchanged exactly once by the SketchUp extension
// credential. The raw code never persists: storage keeps only its SHA-256
// hash, and audit details never carry code or hash.
type DesignPairingGrant struct {
	ID             string    `json:"id" db:"id"`
	OrganizationID string    `json:"organization_id" db:"organization_id"`
	ProjectID      string    `json:"project_id" db:"project_id"`
	DesignID       string    `json:"design_id" db:"design_id"`
	BaseRevisionID *string   `json:"base_revision_id" db:"base_revision_id"`
	Action         string    `json:"action" db:"action"`
	CodeHash       []byte    `json:"-" db:"code_hash"`
	Status         string    `json:"status" db:"status"` // pending, exchanged, cancelled
	ExpiresAt      time.Time `json:"expires_at" db:"expires_at"`
	CreatedBy      string    `json:"created_by" db:"created_by"`
	// CreatedBySessionID is the creating web session's registry sid — full
	// provenance alongside CreatedBy, never a token or secret.
	CreatedBySessionID   string     `json:"created_by_session_id" db:"created_by_session_id"`
	ExchangedAt          *time.Time `json:"exchanged_at" db:"exchanged_at"`
	ExchangedBySessionID *string    `json:"exchanged_by_session_id" db:"exchanged_by_session_id"`
	CreatedAt            time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at" db:"updated_at"`
	Version              int64      `json:"version" db:"version"`
}

const (
	PairingActionOpenDesign     = "open_design"
	PairingGrantStatusPending   = "pending"
	PairingGrantStatusExchanged = "exchanged"
	PairingGrantStatusCancelled = "cancelled"
	// PairingGrantStatusExpired is derived at read time only (a pending
	// grant past its expiry, mirroring the device-enrollment poll); it is
	// never stored and the CHECK constraint excludes it.
	PairingGrantStatusExpired = "expired"
)

// IsValidPairingAction keeps the action enum explicit: a new action must be
// added here (and to the column CHECK) before any client can request it.
func IsValidPairingAction(action string) bool {
	return action == PairingActionOpenDesign
}

// DerivedPairingStatus resolves the user-facing status of a stored grant:
// expiry is a read-time derivation, never a stored state.
func DerivedPairingStatus(grant DesignPairingGrant, now time.Time) string {
	if grant.Status == PairingGrantStatusPending && now.After(grant.ExpiresAt) {
		return PairingGrantStatusExpired
	}
	return grant.Status
}
