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

// AccessTokenTTL is how long a JWT remains valid before re-login or refresh
// (issue #16). Role/active are also re-checked against the DB on every request.
const AccessTokenTTL = 15 * time.Minute

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
const TokenVersion = 2

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
	// PlatformAdmin marks platform staff (console + audited support sessions).
	PlatformAdmin bool `json:"platform_admin,omitempty"`
	Client        string `json:"client,omitempty"`
	// Support marks a platform support session into Support.OrgID: effective
	// admin of that organization, real actor = the platform admin (ADR-0005 §5).
	Support       *SupportClaims `json:"support,omitempty"`
	Ver           int            `json:"ver"`
	jwt.RegisteredClaims
}

// SupportClaims carries the support-session context (org + session id).
type SupportClaims struct {
	OrgID     string `json:"org_id"`
	SessionID string `json:"session_id"`
	Reason    string `json:"reason,omitempty"`
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
	Roles         []string
	OrgID         string
	PlatformAdmin bool
}

// GenerateSupportToken issues the short-lived support-session token: org
// context with effective admin role. The middleware re-validates the session
// row on every request, so logout/expiry cut access immediately.
func GenerateSupportToken(userID string, email string, sc SupportClaims, secret string) (string, error) {
	now := time.Now()
	claims := &Claims{
		UserID: userID,
		Email:  email,
		Role:   "admin",
		Roles:  []string{"admin"},
		OrgID:  sc.OrgID,
		Support: &sc,
		Ver:    TokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(now.Add(SupportTokenTTL)),
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
	return generateToken(userID, email, tc, "", AccessTokenTTL, secret)
}

// GenerateExtensionToken issues a long-lived token carrying the extension
// client claim. AuthMiddleware restricts these tokens to GET requests (plus
// /api/auth/refresh) so a leaked extension token cannot mutate workshop data.
func GenerateExtensionToken(userID string, email string, tc TokenContext, secret string) (string, error) {
	return generateToken(userID, email, tc, ExtensionClient, ExtensionTokenTTL, secret)
}

// PrimaryRole resolves the transitional single role: the first role of the
// active membership's set. Callers must pass a non-empty validated set.
func PrimaryRole(roles []string) string {
	if len(roles) == 0 {
		return ""
	}
	return roles[0]
}

func generateToken(userID string, email string, tc TokenContext, client string, ttl time.Duration, secret string) (string, error) {
	now := time.Now()
	claims := &Claims{
		UserID:        userID,
		Email:         email,
		Role:          PrimaryRole(tc.Roles),
		Roles:         tc.Roles,
		OrgID:         tc.OrgID,
		PlatformAdmin: tc.PlatformAdmin,
		Client:        client,
		Ver:           TokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
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

	return claims, nil
}
