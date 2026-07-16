package auth

import (
	"strings"
	"testing"
	"time"

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
		{"short1a", true},    // 7
		{"12345678", true},   // digits only
		{"abcdefgh", true},   // letters only
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

	token, err := GenerateToken(userID, email, role, secret)
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
