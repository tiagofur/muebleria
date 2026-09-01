package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"time"
	"unicode"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// BcryptCost is the work factor for password hashes (issue #19).
// DefaultCost is 10; modern guidance is 12+.
const BcryptCost = 12

// MinPasswordLen is the minimum accepted password length on register (issue #19).
const MinPasswordLen = 8

// WebAccessTokenTTL is the short-lived Web access bearer (#460 SEC-4B). The
// Web client keeps it in tab memory ONLY and renews it through the rotating
// HttpOnly refresh cookie, so the exposure window of a leaked bearer is
// minutes, not a workday. Expiry rolls from the MINT instant (now) — never
// from the session origin, which would mint already-expired tokens past the
// first 15 minutes — and is always capped by the session's absolute expiry.
const WebAccessTokenTTL = 15 * time.Minute

// MobileAccessTokenTTL keeps the pre-SEC-4B mobile policy (one login per
// workday) until SEC-5 migrates mobile to short access + secure-store
// refresh. Mobile has no cookie transport: shortening it here would kick
// mobile users out mid-shift with no way to renew.
const MobileAccessTokenTTL = 18 * time.Hour

// LegacyAccessTokenTTL is the historical pre-SEC-4B access policy carried by
// the ver4 transitional window (SEC-9 removes it together with ver4
// validation). GenerateLegacyToken is its only minting site (tests).
const LegacyAccessTokenTTL = 18 * time.Hour

// WebSessionAbsoluteTTL and MobileSessionAbsoluteTTL bound the WHOLE session
// (registry absolute_expires_at): T0 + 18h, refresh never slides it (#441).
const (
	WebSessionAbsoluteTTL    = 18 * time.Hour
	MobileSessionAbsoluteTTL = 18 * time.Hour
)

// SupportTokenTTL bounds platform support sessions ("entrar a taller"):
// short-lived by design, independent of the web/extension token kinds.
const SupportTokenTTL = 2 * time.Hour

// ExtensionClient identifies tokens requested by the SketchUp extension login
// flow. Extension tokens live longer (workshop sessions span days) and are
// restricted to read-only requests by AuthMiddleware.
const ExtensionClient = "sketchup-extension"

// ExtensionTokenTTL is the lifetime of tokens issued for the SketchUp
// extension. Revocation does not wait for expiry: AuthMiddleware re-checks the
// user and session against the DB on every request. #460 SEC-6 replaces this
// password-login credential with a registered, revocable device credential.
const ExtensionTokenTTL = 30 * 24 * time.Hour

// DummyHash is a valid bcrypt hash used only to equalize login timing when the
// user does not exist (issue #19 account enumeration).
// Generated once for the fixed string "dummy-password-for-timing".
var DummyHash string

func init() {
	// Panic on startup if bcrypt fails — better than a silent zero-value hash.
	h, err := bcrypt.GenerateFromPassword([]byte("dummy-password-for-timing"), BcryptCost)
	if err != nil {
		panic("auth: failed to generate DummyHash: " + err.Error())
	}
	DummyHash = string(h)
}

// TokenVersion is the current claims layout (#460 / ADR-0007). Ver5 adds the
// exact-policy credential claims: iss, aud (per client type), typ, sid (server
// session registry id), jti and a kid signing-key header. A ver5 token is only
// valid while its sid resolves to a live auth_sessions row.
const TokenVersion = 5

// LegacyTokenVersion is the pre-#460 claims layout (no iss/aud/typ/sid/jti/kid).
// It remains accepted while deployed clients hold ver4 bearer tokens; the
// acceptance window is finite and is removed with the #460 SEC-9 gate, together
// with GenerateLegacyToken (its only minting site is the test suite).
const LegacyTokenVersion = 4

// DefaultIssuer identifies this API as the token issuer. Overridable with
// JWT_ISSUER for deployments that run more than one issuer.
const DefaultIssuer = "granete-api"

// LegacyKeyID is the key id assigned to a single-secret deployment (JWT_SECRET
// without JWT_KEYRING) and the id a ver4 token implicitly uses: ver4 tokens
// carry no kid header, so they validate against this key ring entry only.
const LegacyKeyID = "legacy"

// TokenType is the non-interchangeable credential class carried in the `typ`
// claim. Validation rejects a token whose typ does not match its transport, so
// a web access token can never act as a SketchUp device token or vice versa.
const (
	TokenTypeAccessWeb      = "access_web"
	TokenTypeAccessMobile   = "access_mobile"
	TokenTypeDeviceSketchup = "device_sketchup"
	TokenTypeSupportAccess  = "support_access"
)

// Audience values per client type (`aud` claim).
const (
	AudienceWeb      = "granete-web"
	AudienceMobile   = "granete-mobile"
	AudienceSketchup = "granete-sketchup"
	AudienceSupport  = "granete-support"
)

type Claims struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	// Role is the transitional single-role view of Roles[0] for the active
	// organization. The RBAC union sweep (F170b) replaces single-role checks.
	Role string `json:"role"`
	// Roles are the actor's roles in the active organization (membership).
	Roles []string `json:"roles,omitempty"`
	// OrgID is the active organization scope; empty means a platform-level
	// token (console / org selection), never business data access.
	OrgID string `json:"org_id,omitempty"`
	// MembershipID binds an organization-scoped token to exactly one live
	// membership. It is intentionally not inferred from user and organization.
	MembershipID string `json:"membership_id,omitempty"`
	// MembershipCredentialVersion invalidates tokens when Team revokes a
	// membership's sessions. Middleware compares it to the live membership.
	MembershipCredentialVersion int64 `json:"membership_credential_version,omitempty"`
	// OrganizationCredentialVersion is the tenant-wide revocation epoch. It
	// changes at lifecycle boundaries so a token issued before a suspension can
	// never become valid again after reactivation.
	OrganizationCredentialVersion int64 `json:"organization_credential_version,omitempty"`
	// AuthStartedAt is the absolute session origin. Refresh and organization
	// selection preserve it so they cannot extend the 18-hour web/mobile limit.
	AuthStartedAt *jwt.NumericDate `json:"auth_started_at,omitempty"`
	// PlatformAdmin marks platform staff (console + audited support sessions).
	PlatformAdmin bool   `json:"platform_admin,omitempty"`
	Client        string `json:"client,omitempty"`
	// Transport is the canonical client boundary. Client remains only to read
	// pre-#448 SketchUp tokens until their natural 30-day expiry.
	Transport string `json:"transport,omitempty"`
	// Support marks a platform support session into Support.OrgID: effective
	// admin of that organization, real actor = the platform admin (ADR-0005 §5).
	Support *SupportClaims `json:"support,omitempty"`
	// Sid is the auth_sessions registry id (ver5+). The middleware resolves it
	// to a live row on every request: revocation or absolute expiry of the
	// session invalidates the token even before its own exp.
	Sid string `json:"sid,omitempty"`
	// Typ is the token type (ver5+): access_web | access_mobile |
	// device_sketchup | support_access. Not interchangeable across clients.
	Typ string `json:"typ,omitempty"`
	Ver int    `json:"ver"`
	jwt.RegisteredClaims
}

// SupportClaims carries the support-session context (org + session id).
type SupportClaims struct {
	OrgID                         string `json:"org_id"`
	SessionID                     string `json:"session_id"`
	OrganizationCredentialVersion int64  `json:"organization_credential_version"`
	Reason                        string `json:"reason,omitempty"`
}

// ValidatePassword enforces the registration password policy (issue #19):
// length ≥ MinPasswordLen, at least one letter and one digit.
func ValidatePassword(password string) error {
	if len(password) < MinPasswordLen {
		return fmt.Errorf("password must be at least %d characters", MinPasswordLen)
	}
	hasLetter := false
	hasDigit := false
	for _, r := range password {
		if unicode.IsLetter(r) {
			hasLetter = true
		}
		if unicode.IsDigit(r) {
			hasDigit = true
		}
	}
	if !hasLetter || !hasDigit {
		return fmt.Errorf("password must contain at least one letter and one digit")
	}
	return nil
}

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), BcryptCost)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}
	return string(bytes), nil
}

func CheckPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// TokenContext is the organization scope embedded in a token: the active
// membership's roles plus the platform staff flag and the session registry id.
type TokenContext struct {
	Roles                         []string
	OrgID                         string
	MembershipID                  string
	MembershipCredentialVersion   int64
	OrganizationCredentialVersion int64
	PlatformAdmin                 bool
	AuthStartedAt                 time.Time
	// SessionID is the auth_sessions row id (ver5+). Required for every token
	// minted by the Authority.
	SessionID string
}

var kidPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// Keyring holds the symmetric signing secrets keyed by key id (`kid`). New
// tokens are signed with the active kid; validation accepts every registered
// kid so rotation happens without downtime. Rotation with revocation means
// removing a kid from the ring: its tokens stop validating immediately.
type Keyring struct {
	activeKid string
	secrets   map[string]string
}

// NewKeyring validates and builds a key ring. Every secret must be at least 32
// bytes and every key id must match kidPattern.
func NewKeyring(activeKid string, secrets map[string]string) (*Keyring, error) {
	if len(secrets) == 0 {
		return nil, errors.New("keyring requires at least one key")
	}
	if _, ok := secrets[activeKid]; !ok {
		return nil, fmt.Errorf("keyring active kid %q has no secret", activeKid)
	}
	for kid, secret := range secrets {
		if !kidPattern.MatchString(kid) {
			return nil, fmt.Errorf("keyring kid %q must match %s", kid, kidPattern.String())
		}
		if len(secret) < 32 {
			return nil, fmt.Errorf("keyring secret for kid %q must be at least 32 bytes", kid)
		}
	}
	return &Keyring{activeKid: activeKid, secrets: secrets}, nil
}

// SingleKeyKeyring is the implicit ring of a single-secret deployment: the
// JWT_SECRET is registered under LegacyKeyID and is also the active key.
func SingleKeyKeyring(secret string) (*Keyring, error) {
	return NewKeyring(LegacyKeyID, map[string]string{LegacyKeyID: secret})
}

// ActiveKeyID is the kid new tokens are signed with.
func (k *Keyring) ActiveKeyID() string { return k.activeKid }

// SecretForKeyID resolves a registered secret. Unknown kids are rejected, which
// is how a rotated-out key stops validating.
func (k *Keyring) SecretForKeyID(kid string) (string, bool) {
	secret, ok := k.secrets[kid]
	return secret, ok
}

// Authority mints and validates tokens under the exact HS256 policy: pinned
// algorithm, issuer, per-client audience, token type, key id and — for ver5 —
// a server-side session id.
type Authority struct {
	keyring *Keyring
	issuer  string
}

// NewAuthority builds the minting/validation authority. An empty issuer falls
// back to DefaultIssuer.
func NewAuthority(keyring *Keyring, issuer string) (*Authority, error) {
	if keyring == nil {
		return nil, errors.New("authority requires a keyring")
	}
	if issuer == "" {
		issuer = DefaultIssuer
	}
	return &Authority{keyring: keyring, issuer: issuer}, nil
}

// IssueSupportToken issues the short-lived support-session token: org context
// with effective admin role. The middleware re-validates the session rows on
// every request, so logout/expiry cut access immediately.
func (a *Authority) IssueSupportToken(userID string, email string, sc SupportClaims, sid string) (string, error) {
	return a.IssueSupportTokenFrom(userID, email, sc, time.Time{}, sid)
}

// IssueSupportTokenFrom preserves the absolute support-session origin when a
// support token is refreshed. Support remains a separate scoped read-only
// boundary and intentionally carries no membership credentials.
func (a *Authority) IssueSupportTokenFrom(userID string, email string, sc SupportClaims, authStartedAt time.Time, sid string) (string, error) {
	if sc.OrgID == "" || sc.SessionID == "" || sc.OrganizationCredentialVersion < 1 {
		return "", errors.New("support token requires organization, session, and credential version")
	}
	if sid == "" {
		return "", errors.New("support token requires a registry session id")
	}
	now := time.Now()
	if authStartedAt.IsZero() {
		authStartedAt = now
	}
	claims := &Claims{
		UserID:        userID,
		Email:         email,
		Role:          "admin",
		Roles:         []string{"admin"},
		OrgID:         sc.OrgID,
		Transport:     "support",
		Support:       &sc,
		Sid:           sid,
		Typ:           TokenTypeSupportAccess,
		Ver:           TokenVersion,
		AuthStartedAt: jwt.NewNumericDate(authStartedAt),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			Audience:  jwt.ClaimStrings{AudienceSupport},
			Issuer:    a.issuer,
			ID:        newJTI(),
			ExpiresAt: jwt.NewNumericDate(authStartedAt.Add(SupportTokenTTL)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
		},
	}
	return a.sign(claims)
}

// IssueTransportToken records the validated API transport in the token so
// select-org, refresh and /me preserve the same canonical session boundary.
func (a *Authority) IssueTransportToken(userID string, email string, tc TokenContext, transport string) (string, error) {
	return a.issueTransportTokenUntil(userID, email, tc, transport, time.Time{})
}

// IssueTransportTokenUntil additionally caps exp at the registry's absolute
// expiry. Refresh uses this even though the normal origin-derived limit should
// match, making the server-side bound explicit and impossible to overshoot.
// WEB tokens REQUIRE the cap (SEC-4B): their 15-minute window rolls from now,
// so only the registry row keeps exp <= absolute_expires_at structurally true.
func (a *Authority) IssueTransportTokenUntil(userID string, email string, tc TokenContext, transport string, absoluteExpiresAt time.Time) (string, error) {
	if absoluteExpiresAt.IsZero() || !absoluteExpiresAt.After(time.Now()) {
		return "", errors.New("token requires a future absolute session expiry")
	}
	return a.issueTransportTokenUntil(userID, email, tc, transport, absoluteExpiresAt)
}

func (a *Authority) issueTransportTokenUntil(userID string, email string, tc TokenContext, transport string, absoluteExpiresAt time.Time) (string, error) {
	// SEC-4B structural invariant: a web access bearer is ALWAYS registry-
	// capped (exp <= absolute_expires_at), whichever entry point mints it.
	if transport == "web" && absoluteExpiresAt.IsZero() {
		return "", errors.New("web access token requires the session's absolute expiry cap")
	}
	client, ttl := "", accessTokenTTLFor(transport)
	if ttl == 0 {
		return "", fmt.Errorf("invalid login transport %q", transport)
	}
	if transport == "sketchup" {
		client = ExtensionClient
	}
	if tc.SessionID == "" {
		return "", errors.New("token requires a registry session id")
	}
	return a.issueToken(userID, email, tc, client, transport, ttl, absoluteExpiresAt)
}

// accessTokenTTLFor resolves the access-token lifetime per transport. Web is
// the short rolling bearer; mobile keeps the workday policy until SEC-5; the
// SketchUp extension keeps its workshop-spanning credential until SEC-6.
func accessTokenTTLFor(transport string) time.Duration {
	switch transport {
	case "web":
		return WebAccessTokenTTL
	case "mobile":
		return MobileAccessTokenTTL
	case "sketchup":
		return ExtensionTokenTTL
	}
	return 0
}

// PrimaryRole resolves the transitional single role: the first role of the
// active membership's set. Callers must pass a non-empty validated set.
func PrimaryRole(roles []string) string {
	if len(roles) == 0 {
		return ""
	}
	return roles[0]
}

// TransportSessionTTL is the ABSOLUTE session bound per client type (distinct
// from the access-token TTL: the web session lives 18h while each access
// bearer lives 15 minutes). It seeds the registry's absolute_expires_at,
// which refresh never extends.
func TransportSessionTTL(transport string) time.Duration {
	switch transport {
	case "web":
		return WebSessionAbsoluteTTL
	case "mobile":
		return MobileSessionAbsoluteTTL
	case "sketchup":
		return ExtensionTokenTTL
	case "support":
		return SupportTokenTTL
	default:
		return MobileSessionAbsoluteTTL
	}
}

// AccessTokenExpiry reports the exact instant an access token minted at now
// for the transport will expire, using the same arithmetic as the minting
// path (#460 SEC-4A: `access_expires_at` metadata must come from the server
// clock behind minting, never from client-side JWT decoding). A zero
// authStartedAt means "now", matching issueToken; a non-zero
// absoluteExpiresAt caps the result exactly like IssueTransportTokenUntil.
// Web bearers roll from `now` (short access); every other transport stays
// origin-derived. Support tokens have no registry cap: their live session
// row is the authority (GetOpenSupportSession).
func AccessTokenExpiry(now, authStartedAt time.Time, transport string, absoluteExpiresAt time.Time) (time.Time, error) {
	ttl := accessTokenTTLFor(transport)
	if transport == "support" {
		if authStartedAt.IsZero() {
			authStartedAt = now
		}
		return authStartedAt.Add(SupportTokenTTL), nil
	}
	if ttl == 0 {
		return time.Time{}, fmt.Errorf("invalid login transport %q", transport)
	}
	return transportTokenExpiry(now, authStartedAt, transport, ttl, absoluteExpiresAt), nil
}

// transportTokenExpiry is the single expiry computation shared by minting and
// the reported metadata so the two can never drift. Web access bearers roll
// from the MINT instant (SEC-4B short access): computing them from the
// session origin would mint already-expired tokens after minute 15. Every
// other transport keeps the origin-derived semantics. A known absolute
// session bound always caps the result.
func transportTokenExpiry(now, authStartedAt time.Time, transport string, ttl time.Duration, absoluteExpiresAt time.Time) time.Time {
	base := authStartedAt
	if transport == "web" {
		base = now
	}
	if base.IsZero() {
		base = now
	}
	expiresAt := base.Add(ttl)
	if !absoluteExpiresAt.IsZero() && absoluteExpiresAt.Before(expiresAt) {
		expiresAt = absoluteExpiresAt
	}
	return expiresAt
}

func (a *Authority) issueToken(userID string, email string, tc TokenContext, client, transport string, ttl time.Duration, absoluteExpiresAt time.Time) (string, error) {
	now := time.Now()
	authStartedAt := tc.AuthStartedAt
	if authStartedAt.IsZero() {
		authStartedAt = now
	}
	if tc.OrgID != "" && tc.MembershipID == "" {
		return "", errors.New("organization-scoped token requires membership id")
	}
	if tc.OrgID != "" && tc.MembershipCredentialVersion < 1 {
		return "", errors.New("organization-scoped token requires membership credential version")
	}
	if tc.OrgID != "" && tc.OrganizationCredentialVersion < 1 {
		return "", errors.New("organization-scoped token requires organization credential version")
	}
	expiresAt := transportTokenExpiry(now, authStartedAt, transport, ttl, absoluteExpiresAt)
	claims := &Claims{
		UserID:                        userID,
		Email:                         email,
		Role:                          PrimaryRole(tc.Roles),
		Roles:                         tc.Roles,
		OrgID:                         tc.OrgID,
		MembershipID:                  tc.MembershipID,
		MembershipCredentialVersion:   tc.MembershipCredentialVersion,
		OrganizationCredentialVersion: tc.OrganizationCredentialVersion,
		PlatformAdmin:                 tc.PlatformAdmin,
		Client:                        client,
		Transport:                     transport,
		Sid:                           tc.SessionID,
		Typ:                           typForTransport(transport),
		Ver:                           TokenVersion,
		AuthStartedAt:                 jwt.NewNumericDate(authStartedAt),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			Audience:  jwt.ClaimStrings{audienceForTransport(transport)},
			Issuer:    a.issuer,
			ID:        newJTI(),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
		},
	}

	return a.sign(claims)
}

func (a *Authority) sign(claims *Claims) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	token.Header["kid"] = a.keyring.ActiveKeyID()
	tokenString, err := token.SignedString([]byte(a.keyring.secrets[a.keyring.activeKid]))
	if err != nil {
		return "", fmt.Errorf("failed to sign token: %w", err)
	}
	return tokenString, nil
}

func typForTransport(transport string) string {
	switch transport {
	case "web":
		return TokenTypeAccessWeb
	case "mobile":
		return TokenTypeAccessMobile
	case "sketchup":
		return TokenTypeDeviceSketchup
	case "support":
		return TokenTypeSupportAccess
	}
	return ""
}

func audienceForTransport(transport string) string {
	switch transport {
	case "web":
		return AudienceWeb
	case "mobile":
		return AudienceMobile
	case "sketchup":
		return AudienceSketchup
	case "support":
		return AudienceSupport
	}
	return ""
}

// newJTI mints a unique token id for the jti claim (ver5+).
func newJTI() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		panic("auth: crypto/rand unavailable: " + err.Error())
	}
	return hex.EncodeToString(buf)
}

// Validate enforces the exact HS256 policy and returns the claims. The error
// is never sent to clients verbatim: handlers log it and answer with a generic
// 401 so parser/identity state is not disclosed.
//
// For ver5 every registered claim is REQUIRED and cross-checked: alg, kid
// (header present, a string, registered), iss, exactly one aud matching the
// client type, sub (== user_id), exp, nbf, iat (presence AND not in the
// future), jti, plus sid/typ/ver. Absence of any claim fails closed — a
// correctly signed token with stripped or tampered claims is not a valid
// credential regardless of how the minting helpers behave. The kidless
// fallback exists ONLY for ver4 during its transitional window (ADR-0007,
// EOL SEC-9): a ver5 token without a kid header is rejected even when it
// happens to verify against the legacy key.
func (a *Authority) Validate(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		// Exact-algorithm policy: HS256 only. WithValidMethods below already
		// rejects every other alg family; this check pins the instance.
		if token.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method")
		}
		// A kid header, when present, must be a non-empty string — a malformed
		// key id is not a key selection we are willing to guess.
		kid := ""
		if kidRaw, present := token.Header["kid"]; present {
			value, isString := kidRaw.(string)
			if !isString || value == "" {
				return nil, fmt.Errorf("malformed key id")
			}
			kid = value
		} else {
			// Kidless tokens are the pre-#460 shape: they resolve against the
			// legacy secret entry only. Whether such a token is still ACCEPTED
			// is decided after parsing, by version (ver4 window only).
			kid = LegacyKeyID
		}
		secret, ok := a.keyring.SecretForKeyID(kid)
		if !ok {
			return nil, fmt.Errorf("unknown key id")
		}
		return []byte(secret), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithExpirationRequired(), jwt.WithIssuedAt())

	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token claims")
	}

	transport := claims.Transport
	if claims.Support != nil {
		transport = "support"
	}

	switch claims.Ver {
	case TokenVersion:
		// The kid header is part of the ver5 credential shape: present, a
		// non-empty string, and registered (the keyfunc already resolved it to
		// verify the signature — this rejects the kidless token that only
		// happened to sign with the legacy key).
		if _, present := token.Header["kid"]; !present {
			return nil, errors.New("token missing key id")
		}
		if claims.Sid == "" {
			return nil, errors.New("token missing session id")
		}
		if claims.Typ == "" || claims.Typ != typForTransport(transport) {
			return nil, errors.New("token type mismatch")
		}
		if claims.Issuer != a.issuer {
			return nil, errors.New("token issuer mismatch")
		}
		// Exactly ONE audience, equal to the client type's audience: minting
		// emits a single-entry aud, so anything wider is a tampered token.
		if len(claims.Audience) != 1 || claims.Audience[0] != audienceForTransport(transport) {
			return nil, errors.New("token audience mismatch")
		}
		if claims.ID == "" {
			return nil, errors.New("token missing jti")
		}
		// Registered timestamps are mandatory: exp/nbf/iat freshness is
		// enforced by the parser validators above (WithExpirationRequired and
		// WithIssuedAt reject a missing exp and a future iat), but their
		// ABSENCE must fail closed instead of being silently optional.
		if claims.IssuedAt == nil {
			return nil, errors.New("token missing iat")
		}
		if claims.NotBefore == nil {
			return nil, errors.New("token missing nbf")
		}
		if claims.Subject == "" {
			return nil, errors.New("token missing sub")
		}
		if claims.Subject != claims.UserID {
			return nil, errors.New("token subject mismatch")
		}
	case LegacyTokenVersion:
		// Transitional acceptance (removed with #460 SEC-9): ver4 tokens carry
		// no sid/typ/iss/aud/jti and no kid. They still pass the coherence
		// checks below and the middleware's live membership/org revalidation.
	default:
		return nil, fmt.Errorf("unsupported token version")
	}

	if claims.UserID == "" {
		return nil, errors.New("token missing user id")
	}
	if claims.AuthStartedAt == nil {
		return nil, errors.New("token missing auth start")
	}
	if claims.Support != nil && (claims.OrgID == "" || claims.Support.OrgID != claims.OrgID ||
		claims.Support.SessionID == "" || claims.Support.OrganizationCredentialVersion < 1) {
		return nil, errors.New("token missing support session credentials")
	}
	if claims.Support == nil && claims.OrgID != "" && (claims.MembershipID == "" || claims.MembershipCredentialVersion < 1 || claims.OrganizationCredentialVersion < 1) {
		return nil, errors.New("token missing membership credentials")
	}

	return claims, nil
}

// GenerateLegacyToken mints a ver4 token for the transitional test suite only:
// existing api-package tests exercise the legacy credential path that stays
// accepted until the #460 SEC-9 gate removes LegacyTokenVersion validation
// together with this function. Production code never mints ver4.
func GenerateLegacyToken(userID string, email string, tc TokenContext, transport string, secret string) (string, error) {
	client, ttl := "", LegacyAccessTokenTTL
	switch transport {
	case "web", "mobile":
	case "sketchup":
		client, ttl = ExtensionClient, ExtensionTokenTTL
	default:
		return "", fmt.Errorf("invalid login transport %q", transport)
	}
	return signLegacy(userID, email, tc, client, transport, ttl, secret)
}

// GenerateLegacyWebToken mints a ver4 web token (transitional tests).
func GenerateLegacyWebToken(userID string, email string, tc TokenContext, secret string) (string, error) {
	return GenerateLegacyToken(userID, email, tc, "web", secret)
}

// GenerateLegacyExtensionToken mints a ver4 SketchUp extension token
// (transitional tests).
func GenerateLegacyExtensionToken(userID string, email string, tc TokenContext, secret string) (string, error) {
	return GenerateLegacyToken(userID, email, tc, "sketchup", secret)
}

// GenerateLegacySupportToken mints a ver4 support token (transitional tests).
func GenerateLegacySupportToken(userID string, email string, sc SupportClaims, secret string) (string, error) {
	return GenerateLegacySupportTokenFrom(userID, email, sc, time.Time{}, secret)
}

// GenerateLegacySupportTokenFrom preserves the support origin (transitional tests).
func GenerateLegacySupportTokenFrom(userID string, email string, sc SupportClaims, authStartedAt time.Time, secret string) (string, error) {
	if sc.OrgID == "" || sc.SessionID == "" || sc.OrganizationCredentialVersion < 1 {
		return "", errors.New("support token requires organization, session, and credential version")
	}
	now := time.Now()
	if authStartedAt.IsZero() {
		authStartedAt = now
	}
	claims := &Claims{
		UserID:        userID,
		Email:         email,
		Role:          "admin",
		Roles:         []string{"admin"},
		OrgID:         sc.OrgID,
		Transport:     "support",
		Support:       &sc,
		Ver:           LegacyTokenVersion,
		AuthStartedAt: jwt.NewNumericDate(authStartedAt),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(authStartedAt.Add(SupportTokenTTL)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", fmt.Errorf("failed to sign token: %w", err)
	}
	return tokenString, nil
}

func signLegacy(userID string, email string, tc TokenContext, client, transport string, ttl time.Duration, secret string) (string, error) {
	now := time.Now()
	authStartedAt := tc.AuthStartedAt
	if authStartedAt.IsZero() {
		authStartedAt = now
	}
	if tc.OrgID != "" && tc.MembershipID == "" {
		return "", errors.New("organization-scoped token requires membership id")
	}
	if tc.OrgID != "" && tc.MembershipCredentialVersion < 1 {
		return "", errors.New("organization-scoped token requires membership credential version")
	}
	if tc.OrgID != "" && tc.OrganizationCredentialVersion < 1 {
		return "", errors.New("organization-scoped token requires organization credential version")
	}
	claims := &Claims{
		UserID:                        userID,
		Email:                         email,
		Role:                          PrimaryRole(tc.Roles),
		Roles:                         tc.Roles,
		OrgID:                         tc.OrgID,
		MembershipID:                  tc.MembershipID,
		MembershipCredentialVersion:   tc.MembershipCredentialVersion,
		OrganizationCredentialVersion: tc.OrganizationCredentialVersion,
		PlatformAdmin:                 tc.PlatformAdmin,
		Client:                        client,
		Transport:                     transport,
		Ver:                           LegacyTokenVersion,
		AuthStartedAt:                 jwt.NewNumericDate(authStartedAt),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(authStartedAt.Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", fmt.Errorf("failed to sign token: %w", err)
	}
	return tokenString, nil
}
