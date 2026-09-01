package auth

import (
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// MediaGrantTTL bounds every signed media URL (#460 SEC-3). A media grant is a
// stateless READ credential for exactly one catalog media file: three minutes
// covers a page render plus retries without turning the URL into a secondary
// session. Grants are additionally capped at the minting session's absolute
// expiry, so a grant can never outlive the session that authorized it.
const MediaGrantTTL = 3 * time.Minute

// Media grant credential class. The typ/iss/aud triple is deliberately
// disjoint from every session credential class (access_web, access_mobile,
// device_sketchup, support_access): a media grant authenticates exactly one
// GET of one resource and nothing else. Issuer and audience are their own
// values so a media token is rejected by Authority.Validate (and a session
// token by MediaAuthority.Validate) even in a deployment that mistakenly
// reuses one secret across both authorities.
const (
	TokenTypeMediaRead = "media_read"
	MediaAudience      = "granete-media"
	MediaIssuer        = "granete-media"
	MediaGrantVersion  = 1
	MediaOperationRead = "read"
)

const minMediaSigningKeyBytes = 32

// mediaResourcePrefix and mediaFilenamePattern define the canonical resource
// key every grant signs: "media/<filename>" where filename is the
// server-generated upload name (32 hex characters + extension). The filename
// is part of the signed material, so a grant for one file cannot be replayed
// against another.
const mediaResourcePrefix = "media/"

var mediaFilenamePattern = regexp.MustCompile(`^[0-9a-f]{32}\.(jpg|png|webp)$`)

// MediaResourceKey builds the canonical signed resource key for a catalog
// media filename. Non-canonical input yields "" — callers must refuse to mint
// or accept grants for those.
func MediaResourceKey(filename string) string {
	if !mediaFilenamePattern.MatchString(filename) {
		return ""
	}
	return mediaResourcePrefix + filename
}

// MediaFilenameFromResource recovers the filename of a canonical resource
// key; anything else yields "".
func MediaFilenameFromResource(resource string) string {
	if len(resource) <= len(mediaResourcePrefix) {
		return ""
	}
	filename := resource[len(mediaResourcePrefix):]
	if MediaResourceKey(filename) != resource {
		return ""
	}
	return filename
}

// MediaClaims is the exact claim set of a media_read grant. It intentionally
// does NOT embed auth.Claims: sharing that struct would let a validator accept
// session-shaped tokens (or vice versa) by field overlap instead of by exact
// credential class.
type MediaClaims struct {
	// Resource is the exact canonical resource key ("media/<filename>").
	Resource string `json:"resource"`
	// OrgID is the owning organization partition; the GET resolves the file
	// under this organization only.
	OrgID string `json:"org_id"`
	// Op is the single allowed operation: "read".
	Op string `json:"op"`
	// Typ is the credential class: always "media_read".
	Typ string `json:"typ"`
	// SessionID, when set, records the ver5 session that minted the grant.
	// Consumption is stateless; this is an audit/trace aid and an expiry-cap
	// input, never the authorization itself (that happened before minting).
	SessionID string `json:"sid,omitempty"`
	// UserID records the minting user for the same purpose.
	UserID string `json:"uid,omitempty"`
	Ver    int    `json:"ver"`
	jwt.RegisteredClaims
}

// MediaAuthority mints and validates media_read grants under a dedicated
// signing key (#460 SEC-3). The key is independent from JWT_SECRET/JWT_KEYRING
// and from REFRESH_TOKEN_PEPPER on purpose: no cryptographic primitive is
// shared with any other credential class, which rules out credential-class
// confusion at the signature level in addition to the claim-level checks.
type MediaAuthority struct {
	secret []byte
}

// NewMediaAuthority validates the dedicated media signing key. A short or
// empty key is a configuration error: callers fail closed (production refuses
// to boot; tests construct the authority explicitly).
func NewMediaAuthority(secret string) (*MediaAuthority, error) {
	if len(secret) < minMediaSigningKeyBytes {
		return nil, fmt.Errorf("media signing key must be at least %d bytes", minMediaSigningKeyBytes)
	}
	return &MediaAuthority{secret: []byte(secret)}, nil
}

// MediaIssueRequest is the minting input. ResourceKey must come from
// MediaResourceKey (non-empty), OrgID from the live organization scope, and
// AbsoluteCap (when non-zero) is the minting session's absolute expiry — the
// grant never outlives it.
type MediaIssueRequest struct {
	ResourceKey string
	OrgID       string
	SessionID   string
	UserID      string
	AbsoluteCap time.Time
}

// Issue signs one media_read grant valid for MediaGrantTTL, capped at the
// session's absolute expiry when provided.
func (m *MediaAuthority) Issue(req MediaIssueRequest) (string, *MediaClaims, error) {
	if m == nil {
		return "", nil, errors.New("media authority is not configured")
	}
	if req.ResourceKey == "" || MediaFilenameFromResource(req.ResourceKey) == "" {
		return "", nil, errors.New("media grant requires a canonical resource key")
	}
	if req.OrgID == "" {
		return "", nil, errors.New("media grant requires an organization")
	}
	now := time.Now()
	expiresAt := now.Add(MediaGrantTTL)
	if !req.AbsoluteCap.IsZero() && req.AbsoluteCap.Before(expiresAt) {
		expiresAt = req.AbsoluteCap
	}
	if !expiresAt.After(now) {
		return "", nil, errors.New("media grant expiry must be in the future")
	}
	claims := &MediaClaims{
		Resource:  req.ResourceKey,
		OrgID:     req.OrgID,
		Op:        MediaOperationRead,
		Typ:       TokenTypeMediaRead,
		SessionID: req.SessionID,
		UserID:    req.UserID,
		Ver:       MediaGrantVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   req.ResourceKey,
			Audience:  jwt.ClaimStrings{MediaAudience},
			Issuer:    MediaIssuer,
			ID:        newJTI(),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(m.secret)
	if err != nil {
		return "", nil, fmt.Errorf("failed to sign media grant: %w", err)
	}
	return signed, claims, nil
}

// ErrMediaTokenExpired distinguishes an expired (but otherwise well-formed)
// grant so clients can transparently re-authorize. Every other failure is
// reported as a generic invalid-grant error: signature/key/resource state is
// never disclosed.
var ErrMediaTokenExpired = errors.New("media grant expired")

// Validate enforces the exact media credential policy: HS256 only, the
// dedicated issuer/audience, typ=media_read, ver=1, op=read, a canonical
// resource key in both `resource` and `sub`, and mandatory exp/nbf/iat/jti.
// Absence or tampering of any claim fails closed.
func (m *MediaAuthority) Validate(tokenStr string) (*MediaClaims, error) {
	if m == nil {
		return nil, errors.New("media authority is not configured")
	}
	token, err := jwt.ParseWithClaims(tokenStr, &MediaClaims{}, func(token *jwt.Token) (interface{}, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return m.secret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrMediaTokenExpired
		}
		return nil, errors.New("invalid media grant")
	}
	claims, ok := token.Claims.(*MediaClaims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid media grant")
	}
	if claims.Ver != MediaGrantVersion ||
		claims.Typ != TokenTypeMediaRead ||
		claims.Op != MediaOperationRead ||
		claims.Issuer != MediaIssuer ||
		len(claims.Audience) != 1 || claims.Audience[0] != MediaAudience ||
		claims.ID == "" ||
		claims.IssuedAt == nil || claims.NotBefore == nil || claims.ExpiresAt == nil ||
		claims.Subject != claims.Resource ||
		MediaFilenameFromResource(claims.Resource) == "" ||
		claims.OrgID == "" {
		return nil, errors.New("invalid media grant")
	}
	return claims, nil
}
