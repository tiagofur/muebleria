package auth

import (
	"errors"
	"fmt"
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

// AccessTokenTTL is how long a JWT remains valid before re-login (issue #16).
// One login per workday (18h covers a full shift plus overtime): 15-minute
// tokens kicked users out mid-design and mid-client session. Revocation does
// NOT wait for expiry — Role/active/membership/org are re-checked against the
// DB on every request, and manual logout clears the token immediately.
const AccessTokenTTL = 18 * time.Hour

// SupportTokenTTL bounds platform support sessions ("entrar a taller"):
// short-lived by design, independent of the web/extension token kinds.
const SupportTokenTTL = 2 * time.Hour

// ExtensionClient identifies tokens requested by the SketchUp extension login
// flow. Extension tokens live longer (workshop sessions span days) and are
// restricted to read-only requests by AuthMiddleware.
const ExtensionClient = "sketchup-extension"

// ExtensionTokenTTL is the lifetime of tokens issued for the SketchUp
// extension. Revocation does not wait for expiry: AuthMiddleware re-checks
// the user (active/role/license) against the DB on every request.
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

// TokenVersion identifies the claims layout. Tokens with any other version
// are rejected: the multi-org claims (org context, roles[], platform_admin)
// are a one-time breaking change and every client re-logs in once (ADR-0004 §6).
const TokenVersion = 4

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
	Ver     int            `json:"ver"`
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
// membership's roles plus the platform staff flag.
type TokenContext struct {
	Roles                         []string
	OrgID                         string
	MembershipID                  string
	MembershipCredentialVersion   int64
	OrganizationCredentialVersion int64
	PlatformAdmin                 bool
	AuthStartedAt                 time.Time
}

// GenerateSupportToken issues the short-lived support-session token: org
// context with effective admin role. The middleware re-validates the session
// row on every request, so logout/expiry cut access immediately.
func GenerateSupportToken(userID string, email string, sc SupportClaims, secret string) (string, error) {
	return GenerateSupportTokenFrom(userID, email, sc, time.Time{}, secret)
}

// GenerateSupportTokenFrom preserves the absolute support-session origin when
// a support token is refreshed. Support remains a separate scoped read-only
// boundary and intentionally carries no membership credentials.
func GenerateSupportTokenFrom(userID string, email string, sc SupportClaims, authStartedAt time.Time, secret string) (string, error) {
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
		Ver:           TokenVersion,
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

func GenerateToken(userID string, email string, tc TokenContext, secret string) (string, error) {
	return GenerateTransportToken(userID, email, tc, "web", secret)
}

// GenerateTransportToken records the validated API transport in the token so
// select-org, refresh and /me preserve the same canonical session boundary.
func GenerateTransportToken(userID string, email string, tc TokenContext, transport string, secret string) (string, error) {
	client, ttl := "", AccessTokenTTL
	switch transport {
	case "web", "mobile":
	case "sketchup":
		client, ttl = ExtensionClient, ExtensionTokenTTL
	default:
		return "", fmt.Errorf("invalid login transport %q", transport)
	}
	return generateToken(userID, email, tc, client, transport, ttl, secret)
}

// GenerateExtensionToken issues a long-lived token carrying the extension
// client claim. AuthMiddleware restricts these tokens to GET requests (plus
// /api/auth/refresh) so a leaked extension token cannot mutate workshop data.
func GenerateExtensionToken(userID string, email string, tc TokenContext, secret string) (string, error) {
	return generateToken(userID, email, tc, ExtensionClient, "sketchup", ExtensionTokenTTL, secret)
}

// PrimaryRole resolves the transitional single role: the first role of the
// active membership's set. Callers must pass a non-empty validated set.
func PrimaryRole(roles []string) string {
	if len(roles) == 0 {
		return ""
	}
	return roles[0]
}

func generateToken(userID string, email string, tc TokenContext, client, transport string, ttl time.Duration, secret string) (string, error) {
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
		Ver:                           TokenVersion,
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

func ValidateToken(tokenStr string, secret string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(secret), nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token claims")
	}
	if claims.Ver != TokenVersion {
		return nil, fmt.Errorf("unsupported token version")
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
