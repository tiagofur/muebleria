package api

import (
	"errors"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Contrato: tests de sesión — 401 uniforme de login (sin oráculo de
// usuario inexistente vs contraseña).
func TestHandleLogin_Uniform401ForMissingUser(t *testing.T) {
	srv := &Server{
		Store:     &stubStore{getUserByEmailErr: errors.New("user not found")},
		JWTSecret: "test-secret-key-for-jwt-signing-32b",
	}
	body := strings.NewReader(`{"email":"nope@test.com","password":"whatever1","transport":"web"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleLogin(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body=%s)", rr.Code, rr.Body.String())
	}
	msg := errorBody(t, rr)
	if msg != "invalid email or password" {
		t.Errorf("error = %q, want generic invalid credentials", msg)
	}
}

func TestHandleLogin_Uniform401ForPendingUser(t *testing.T) {
	hash, err := mustHash("goodpass1")
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{
		Store: &stubStore{getUserByEmail: &domain.User{
			ID: "u1", Email: "pending@test.com", PasswordHash: hash,
			Name: "P", AccountStatus: domain.AccountStatusDisabled,
		}},
		JWTSecret: "test-secret-key-for-jwt-signing-32b",
	}
	body := strings.NewReader(`{"email":"pending@test.com","password":"goodpass1","transport":"web"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleLogin(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body=%s)", rr.Code, rr.Body.String())
	}
	msg := errorBody(t, rr)
	if strings.Contains(strings.ToLower(msg), "pendiente") || strings.Contains(strings.ToLower(msg), "pending") {
		t.Errorf("must not reveal pending status, got %q", msg)
	}
	if msg != "invalid email or password" {
		t.Errorf("error = %q, want generic invalid credentials", msg)
	}
}

func TestHandleLogin_Uniform401ForWrongPassword(t *testing.T) {
	hash, err := mustHash("goodpass1")
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{
		Store: &stubStore{getUserByEmail: &domain.User{
			ID: "u1", Email: "ok@test.com", PasswordHash: hash,
			Name: "O", AccountStatus: domain.AccountStatusActive,
		}},
		JWTSecret: "test-secret-key-for-jwt-signing-32b",
	}
	body := strings.NewReader(`{"email":"ok@test.com","password":"wrongpass9","transport":"web"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleLogin(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
	if errorBody(t, rr) != "invalid email or password" {
		t.Errorf("unexpected body %s", rr.Body.String())
	}
}

func mustHash(pw string) (string, error) {
	return auth.HashPassword(pw)
}
