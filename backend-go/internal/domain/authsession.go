package domain

import "time"

// SessionClientType is the canonical client boundary for credentials and
// sessions (#460 / ADR-0007). Token types are never interchangeable between
// client types: a web access token cannot act as a SketchUp device token and
// neither can open a support session.
type SessionClientType string

const (
	SessionClientWeb      SessionClientType = "web"
	SessionClientMobile   SessionClientType = "mobile"
	SessionClientSketchup SessionClientType = "sketchup"
	SessionClientSupport  SessionClientType = "support"
)

// AuthSession is the server-side session registry row (#460 / SEC-1). It is
// the revocation and absolute-lifetime authority behind every ver5 token: the
// middleware resolves the token's sid to a live row on every request, so
// revocation cuts access immediately even with an unexpired JWT, and
// AbsoluteExpiresAt keeps the session bounded (18h web/mobile, #441/#445).
//
// The scope fields hold the CURRENT organization context and are updated in
// place by select-org so the session id stays stable across an organization
// switch.
type AuthSession struct {
	ID                   string
	UserID               string
	MembershipID         *string
	ActiveOrganizationID *string
	SupportSessionID     *string
	ClientType           SessionClientType
	CreatedAt            time.Time
	AbsoluteExpiresAt    time.Time
	LastSeenAt           *time.Time
	RevokedAt            *time.Time
	RevokedBy            *string
	RevokeReason         *string
	DeviceHint           *string
}
