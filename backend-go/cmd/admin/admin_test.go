package main

import (
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
