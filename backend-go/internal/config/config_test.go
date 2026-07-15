package config

import (
	"strings"
	"testing"
)

func TestLoadConfig_RequiresJWTSecret(t *testing.T) {
	// Force JWT_SECRET empty to trigger the fail-closed path.
	t.Setenv("JWT_SECRET", "")
	// t.Setenv cannot unset, but empty string is treated as missing by our check.
	// To truly simulate "unset", we verify the empty-string branch below too.

	_, err := LoadConfig()
	if err == nil {
		t.Fatal("expected error when JWT_SECRET is empty, got nil")
	}
	if !strings.Contains(err.Error(), "JWT_SECRET") {
		t.Errorf("error should mention JWT_SECRET, got: %v", err)
	}
}

func TestLoadConfig_RejectsShortSecret(t *testing.T) {
	t.Setenv("JWT_SECRET", "too-short")
	_, err := LoadConfig()
	if err == nil {
		t.Fatal("expected error for short JWT_SECRET, got nil")
	}
	if !strings.Contains(err.Error(), "too short") {
		t.Errorf("error should mention length, got: %v", err)
	}
}

func TestLoadConfig_SuccessWithDefaults(t *testing.T) {
	t.Setenv("JWT_SECRET", strings.Repeat("a", 40))
	t.Setenv("CORS_ALLOWED_ORIGINS", "") // exercise default dev allowlist
	t.Setenv("RATE_LIMIT_RPS", "")
	t.Setenv("RATE_LIMIT_BURST", "")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if cfg.JWTSecret != strings.Repeat("a", 40) {
		t.Errorf("JWTSecret mismatch")
	}
	if cfg.Port != "8080" {
		t.Errorf("expected default port 8080, got %s", cfg.Port)
	}
	// Default dev allowlist when CORS_ALLOWED_ORIGINS unset.
	if len(cfg.AllowedOrigins) != 2 {
		t.Errorf("expected 2 default origins, got %v", cfg.AllowedOrigins)
	}
	if cfg.RateLimitRPS <= 0 || cfg.RateLimitBurst <= 0 {
		t.Errorf("expected positive rate limit defaults, got rps=%v burst=%d", cfg.RateLimitRPS, cfg.RateLimitBurst)
	}
}

func TestLoadConfig_ParsesOriginsList(t *testing.T) {
	t.Setenv("JWT_SECRET", strings.Repeat("k", 40))
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://a.test, https://b.test ,https://c.test")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	want := []string{"https://a.test", "https://b.test", "https://c.test"}
	if len(cfg.AllowedOrigins) != len(want) {
		t.Fatalf("expected %d origins, got %v", len(want), cfg.AllowedOrigins)
	}
	for i, o := range want {
		if cfg.AllowedOrigins[i] != o {
			t.Errorf("origin[%d] = %q, want %q", i, cfg.AllowedOrigins[i], o)
		}
	}
}

func TestLoadConfig_RejectsBadRateLimit(t *testing.T) {
	t.Setenv("JWT_SECRET", strings.Repeat("k", 40))
	t.Setenv("RATE_LIMIT_RPS", "not-a-number")

	_, err := LoadConfig()
	if err == nil {
		t.Fatal("expected error for bad RATE_LIMIT_RPS, got nil")
	}
}
