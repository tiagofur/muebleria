package main

import (
	"strings"
	"testing"
)

func TestValidateEmail(t *testing.T) {
	cases := []struct {
		email string
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

func TestValidatePassword(t *testing.T) {
	cases := []struct {
		pw      string
		wantErr bool
	}{
		{"short", true},                       // < 8
		{"1234567", true},                     // exactly 7
		{"12345678", false},                   // exactly 8
		{"a-very-strong-passphrase!", false},  // strong
		{"", true},
	}
	for _, c := range cases {
		err := validatePassword(c.pw)
		if c.wantErr && err == nil {
			t.Errorf("validatePassword(len=%d): expected error, got nil", len(c.pw))
		}
		if !c.wantErr && err != nil {
			t.Errorf("validatePassword(len=%d): expected nil, got %v", len(c.pw), err)
		}
	}
}

func TestValidatePassword_MessageMentionsMin(t *testing.T) {
	err := validatePassword("x")
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "8") {
		t.Errorf("error should mention minimum length 8, got: %v", err)
	}
}
