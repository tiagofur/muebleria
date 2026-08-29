package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

func TestHashAndCheckPassword(t *testing.T) {
	password := "mi-contraseña-secreta1"
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}

	if !CheckPasswordHash(password, hash) {
		t.Error("expected password hash check to succeed")
	}

	if CheckPasswordHash("incorrecta", hash) {
		t.Error("expected password hash check to fail for incorrect password")
	}
}

func TestHashPassword_UsesCost12(t *testing.T) {
	hash, err := HashPassword("goodpass1")
	if err != nil {
		t.Fatal(err)
	}
	cost, err := bcrypt.Cost([]byte(hash))
	if err != nil {
		t.Fatal(err)
	}
	if cost != BcryptCost {
		t.Errorf("bcrypt cost = %d, want %d (issue #19)", cost, BcryptCost)
	}
}

func TestValidatePassword(t *testing.T) {
	cases := []struct {
		pw      string
		wantErr bool
	}{
		{"short1a", true},  // 7
		{"12345678", true}, // digits only
		{"abcdefgh", true}, // letters only
		{"pass1234", false},
		{"Passw0rd!", false},
		{"", true},
	}
	for _, c := range cases {
		err := ValidatePassword(c.pw)
		if c.wantErr && err == nil {
			t.Errorf("ValidatePassword(%q): expected error", c.pw)
		}
		if !c.wantErr && err != nil {
			t.Errorf("ValidatePassword(%q): unexpected %v", c.pw, err)
		}
	}
}

func TestValidatePassword_Message(t *testing.T) {
	err := ValidatePassword("ab")
	if err == nil || !strings.Contains(err.Error(), "8") {
		t.Errorf("expected min-length message, got %v", err)
	}
	err = ValidatePassword("abcdefgh")
	if err == nil || !strings.Contains(err.Error(), "letter") && !strings.Contains(err.Error(), "digit") {
		t.Errorf("expected letter/digit message, got %v", err)
	}
}

func TestDummyHash_IsValidBcrypt(t *testing.T) {
	if DummyHash == "" {
		t.Fatal("DummyHash not initialized")
	}
	if !CheckPasswordHash("dummy-password-for-timing", DummyHash) {
		t.Error("DummyHash should verify the known dummy password")
	}
}

func TestJWTTokenLifecycle(t *testing.T) {
	secret := "test-secret-key-12345"
	userID := "user-uuid-123"
	email := "test@example.com"
	role := "vendedor"

	token, err := GenerateToken(userID, email, TokenContext{Roles: []string{role}}, secret)
	if err != nil {
		t.Fatal(err)
	}

	claims, err := ValidateToken(token, secret)
	if err != nil {
		t.Fatal(err)
	}

	if claims.UserID != userID {
		t.Errorf("expected UserID = %s, got %s", userID, claims.UserID)
	}
	if claims.Email != email {
		t.Errorf("expected Email = %s, got %s", email, claims.Email)
	}
	if claims.Role != role {
		t.Errorf("expected Role = %s, got %s", role, claims.Role)
	}
	if claims.ExpiresAt == nil {
		t.Fatal("expected ExpiresAt set")
	}
	// Access token should expire about AccessTokenTTL from now (issue #16).
	ttl := claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time)
	if ttl < AccessTokenTTL-time.Second || ttl > AccessTokenTTL+time.Second {
		t.Errorf("token TTL = %v, want ~%v", ttl, AccessTokenTTL)
	}

	// Probar con una firma incorrecta
	_, err = ValidateToken(token, "wrong-secret-key")
	if err == nil {
		t.Error("expected token validation to fail with incorrect secret key")
	}
}

// TestValidateToken_RejectsWrongVersion locks the one-time token invalidation
// of the multi-org claims (ADR-0004 §6): any token without Ver == TokenVersion
// is refused and the client must re-login.
func TestValidateToken_RejectsWrongVersion(t *testing.T) {
	secret := "test-secret-key-12345"
	claims := &Claims{
		UserID: "u", Email: "e@x.com", Role: "admin", Ver: 1,
	}
	token, err := jwtNewSigned(claims, secret)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateToken(token, secret); err == nil {
		t.Fatal("v1 token must be rejected")
	}
}

// jwtNewSigned signs arbitrary claims for version-rejection tests.
func jwtNewSigned(claims *Claims, secret string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func TestGenerateToken_PreservesAbsoluteSessionLifetimeAndMembershipCredentials(t *testing.T) {
	secret := "test-secret-key-12345"
	started := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Second)
	token, err := GenerateToken("user-1", "user@example.com", TokenContext{
		Roles:                       []string{"admin"},
		OrgID:                       "org-1",
		MembershipID:                "membership-1",
		MembershipCredentialVersion: 7,
		AuthStartedAt:               started,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := ValidateToken(token, secret)
	if err != nil {
		t.Fatal(err)
	}
	if claims.MembershipID != "membership-1" || claims.MembershipCredentialVersion != 7 {
		t.Fatalf("membership claims = %q/%d, want membership-1/7", claims.MembershipID, claims.MembershipCredentialVersion)
	}
	if got := claims.AuthStartedAt.Time; !got.Equal(started) {
		t.Fatalf("auth_started_at = %s, want %s", got, started)
	}
	if want := started.Add(AccessTokenTTL); !claims.ExpiresAt.Time.Equal(want) {
		t.Fatalf("expiry = %s, want %s", claims.ExpiresAt.Time, want)
	}
}

func TestGenerateToken_RejectsOrganizationScopeWithoutMembershipCredentials(t *testing.T) {
	_, err := GenerateToken("user-1", "user@example.com", TokenContext{OrgID: "org-1", Roles: []string{"admin"}}, "secret")
	if err == nil {
		t.Fatal("organization-scoped token without membership credentials must be rejected")
	}
}
