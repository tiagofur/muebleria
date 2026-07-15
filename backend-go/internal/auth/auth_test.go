package auth

import (
	"testing"
)

func TestHashAndCheckPassword(t *testing.T) {
	password := "mi-contraseña-secreta"
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

	// Probar con una firma incorrecta
	_, err = ValidateToken(token, "wrong-secret-key")
	if err == nil {
		t.Error("expected token validation to fail with incorrect secret key")
	}
}
