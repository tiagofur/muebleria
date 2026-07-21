package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/auth"
)

func TestValidateEmail(t *testing.T) {
	cases := []struct {
		email   string
		wantErr bool
	}{
		{"admin@test.com", false},
		{"x@y.z", false},
		{"", true},
		{"   ", true},
		{"no-at-sign", true},
	}
	for _, c := range cases {
		err := validateEmail(c.email)
		if c.wantErr && err == nil {
			t.Errorf("validateEmail(%q): expected error, got nil", c.email)
		}
		if !c.wantErr && err != nil {
			t.Errorf("validateEmail(%q): expected nil, got %v", c.email, err)
		}
	}
}

func TestValidatePassword_UsesAuthPolicy(t *testing.T) {
	// Admin CLI shares auth.ValidatePassword (issue #19): letter + digit, len ≥ 8.
	cases := []struct {
		pw      string
		wantErr bool
	}{
		{"short", true},
		{"12345678", true},    // digits only
		{"abcdefgh", true},    // letters only
		{"pass1234", false},
		{"a-very-strong-pass1!", false},
		{"", true},
	}
	for _, c := range cases {
		err := auth.ValidatePassword(c.pw)
		if c.wantErr && err == nil {
			t.Errorf("ValidatePassword(%q): expected error, got nil", c.pw)
		}
		if !c.wantErr && err != nil {
			t.Errorf("ValidatePassword(%q): expected nil, got %v", c.pw, err)
		}
	}
}

func TestValidatePassword_MessageMentionsMin(t *testing.T) {
	err := auth.ValidatePassword("x")
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "8") {
		t.Errorf("error should mention minimum length 8, got: %v", err)
	}
}

// resolveMediaDir and mediaFilenameFromURL mirror the server's behavior. They
// are duplicated here on purpose to keep the admin CLI decoupled from the HTTP
// package; these tests guard against drift between the two copies.

func TestResolveMediaDir_DefaultsToHome(t *testing.T) {
	t.Setenv("MEDIA_DIR", "")
	got := resolveMediaDir()
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("UserHomeDir: %v", err)
	}
	want := filepath.Join(home, ".muebles-media")
	if got != want {
		t.Errorf("resolveMediaDir() = %q, want %q", got, want)
	}
}

func TestResolveMediaDir_Override(t *testing.T) {
	t.Setenv("MEDIA_DIR", "/srv/custom-media")
	if got := resolveMediaDir(); got != "/srv/custom-media" {
		t.Errorf("resolveMediaDir() = %q, want /srv/custom-media", got)
	}
}

func TestResolveMediaDir_WhitespaceFallsBack(t *testing.T) {
	t.Setenv("MEDIA_DIR", "   ")
	home, _ := os.UserHomeDir()
	want := filepath.Join(home, ".muebles-media")
	if got := resolveMediaDir(); got != want {
		t.Errorf("resolveMediaDir() = %q, want default %q", got, want)
	}
}

func TestAdminMediaFilenameFromURL(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", ""},
		{"/api/media/abc.png", "abc.png"},
		{"/api/media/abc.png?token=x", "abc.png"},
		{"http://h/api/media/a.webp", "a.webp"},
		{"https://cdn/x.png", ""},
		{"/api/media/../etc", ""},
	}
	for _, c := range cases {
		if got := mediaFilenameFromURL(c.in); got != c.want {
			t.Errorf("mediaFilenameFromURL(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
