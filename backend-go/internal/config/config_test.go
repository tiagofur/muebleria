package config

import (
	"os"
	"path/filepath"
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

func TestLoadConfig_RequiresIndependentRefreshPepper(t *testing.T) {
	t.Setenv("JWT_SECRET", strings.Repeat("j", 40))
	t.Setenv("REFRESH_TOKEN_PEPPER", "")
	t.Setenv("MEDIA_SIGNING_KEY", strings.Repeat("m", 40))
	_, err := LoadConfig()
	if err == nil || !strings.Contains(err.Error(), "refresh credential pepper") {
		t.Fatalf("expected fail-closed refresh pepper error, got %v", err)
	}
}

// MEDIA_SIGNING_KEY is a mandatory, independently-sized secret (#460 SEC-3):
// media grants must not share a key with session tokens or the refresh
// pepper, and a deployment without one refuses to boot.
func TestLoadConfig_RequiresMediaSigningKey(t *testing.T) {
	t.Setenv("JWT_SECRET", strings.Repeat("j", 40))
	t.Setenv("REFRESH_TOKEN_PEPPER", strings.Repeat("r", 40))
	t.Setenv("MEDIA_SIGNING_KEY", "")
	_, err := LoadConfig()
	if err == nil || !strings.Contains(err.Error(), "media signing key") {
		t.Fatalf("expected fail-closed media signing key error, got %v", err)
	}
}

func TestLoadConfig_RejectsShortMediaSigningKey(t *testing.T) {
	t.Setenv("JWT_SECRET", strings.Repeat("j", 40))
	t.Setenv("REFRESH_TOKEN_PEPPER", strings.Repeat("r", 40))
	t.Setenv("MEDIA_SIGNING_KEY", "short")
	_, err := LoadConfig()
	if err == nil || !strings.Contains(err.Error(), "media signing key") {
		t.Fatalf("expected short media signing key error, got %v", err)
	}
}

func TestLoadConfig_SuccessWithDefaults(t *testing.T) {
	t.Setenv("JWT_SECRET", strings.Repeat("a", 40))
	t.Setenv("REFRESH_TOKEN_PEPPER", strings.Repeat("r", 40))
	t.Setenv("MEDIA_SIGNING_KEY", strings.Repeat("m", 40))
	t.Setenv("PORT", "")                 // exercise default port
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
	t.Setenv("REFRESH_TOKEN_PEPPER", strings.Repeat("r", 40))
	t.Setenv("MEDIA_SIGNING_KEY", strings.Repeat("m", 40))
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
	t.Setenv("REFRESH_TOKEN_PEPPER", strings.Repeat("r", 40))
	t.Setenv("MEDIA_SIGNING_KEY", strings.Repeat("m", 40))
	t.Setenv("RATE_LIMIT_RPS", "not-a-number")

	_, err := LoadConfig()
	if err == nil {
		t.Fatal("expected error for bad RATE_LIMIT_RPS, got nil")
	}
}

// MediaDir defaults to ~/.muebles-media (absolute, outside the repo) when
// MEDIA_DIR is unset. This is the root-cause fix for catalog images going
// missing after a git clean / re-clone: the store must outlive the worktree.
func TestLoadConfig_MediaDirDefaultsToHome(t *testing.T) {
	t.Setenv("JWT_SECRET", strings.Repeat("k", 40))
	t.Setenv("REFRESH_TOKEN_PEPPER", strings.Repeat("r", 40))
	t.Setenv("MEDIA_SIGNING_KEY", strings.Repeat("m", 40))
	t.Setenv("MEDIA_DIR", "")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("UserHomeDir: %v", err)
	}
	want := filepath.Join(home, ".muebles-media")
	if cfg.MediaDir != want {
		t.Errorf("MediaDir = %q, want %q", cfg.MediaDir, want)
	}
	if !filepath.IsAbs(cfg.MediaDir) {
		t.Errorf("MediaDir should be absolute, got %q", cfg.MediaDir)
	}
}

// An explicit MEDIA_DIR wins (back-compat for existing deployments).
func TestLoadConfig_MediaDirOverride(t *testing.T) {
	t.Setenv("JWT_SECRET", strings.Repeat("k", 40))
	t.Setenv("REFRESH_TOKEN_PEPPER", strings.Repeat("r", 40))
	t.Setenv("MEDIA_SIGNING_KEY", strings.Repeat("m", 40))
	t.Setenv("MEDIA_DIR", "/var/lib/muebles/media")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if cfg.MediaDir != "/var/lib/muebles/media" {
		t.Errorf("MediaDir = %q, want explicit override", cfg.MediaDir)
	}
}

// Whitespace-only MEDIA_DIR falls back to the default (operator typo defense).
func TestLoadConfig_MediaDirWhitespaceFallsBack(t *testing.T) {
	t.Setenv("JWT_SECRET", strings.Repeat("k", 40))
	t.Setenv("REFRESH_TOKEN_PEPPER", strings.Repeat("r", 40))
	t.Setenv("MEDIA_SIGNING_KEY", strings.Repeat("m", 40))
	t.Setenv("MEDIA_DIR", "   ")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	home, _ := os.UserHomeDir()
	want := filepath.Join(home, ".muebles-media")
	if cfg.MediaDir != want {
		t.Errorf("MediaDir = %q, want default %q", cfg.MediaDir, want)
	}
}

// #460 SEC-4A: the Web refresh cookie's Secure attribute resolves fail-closed.
// Production (GRANETE_ENV=production) can never end up with Secure=false —
// neither by explicit opt-out nor by the loopback-only "auto" heuristic.
func TestWebRefreshCookieSecurityResolution(t *testing.T) {
	cases := []struct {
		name       string
		env        string
		secure     string
		origins    string
		wantErr    bool
		wantSecure bool // value of cfg.WebRefreshCookieInsecureLocalDev (inverted)
	}{
		// Explicit false is a local-dev-only opt-out.
		{name: "dev explicit insecure", env: "development", secure: "false", wantSecure: true},
		{name: "default env explicit insecure", env: "", secure: "false", wantSecure: true},
		{name: "production explicit insecure", env: "production", secure: "false", wantErr: true},
		// auto: Secure unless every origin is loopback HTTP.
		{name: "dev loopback auto", env: "development", secure: "auto", origins: "http://localhost:5173,http://127.0.0.1:4173", wantSecure: true},
		{name: "default env loopback auto", env: "", secure: "", origins: "http://localhost:5173", wantSecure: true},
		{name: "production loopback auto", env: "production", secure: "auto", origins: "http://localhost:5173", wantErr: true},
		{name: "production https auto", env: "production", secure: "auto", origins: "https://granete.example", wantSecure: false},
		{name: "dev real origin auto", env: "development", secure: "auto", origins: "http://workshop.lan", wantSecure: false},
		{name: "mixed loopback and real auto", env: "development", secure: "auto", origins: "http://localhost:5173,https://granete.example", wantSecure: false},
		// Explicit true always wins.
		{name: "dev explicit secure", env: "development", secure: "true", wantSecure: false},
		{name: "production explicit secure", env: "production", secure: "true", wantSecure: false},
		// Garbage is rejected everywhere.
		{name: "invalid flag", env: "development", secure: "maybe", wantErr: true},
		{name: "invalid env", env: "staging", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("JWT_SECRET", strings.Repeat("j", 40))
			t.Setenv("REFRESH_TOKEN_PEPPER", strings.Repeat("r", 40))
			t.Setenv("MEDIA_SIGNING_KEY", strings.Repeat("m", 40))
			t.Setenv("GRANETE_ENV", tc.env)
			t.Setenv("WEB_REFRESH_COOKIE_SECURE", tc.secure)
			t.Setenv("CORS_ALLOWED_ORIGINS", tc.origins)
			cfg, err := LoadConfig()
			if tc.wantErr {
				if err == nil || !strings.Contains(err.Error(), "Secure Web refresh cookie") && !strings.Contains(err.Error(), "WEB_REFRESH_COOKIE_SECURE") && !strings.Contains(err.Error(), "GRANETE_ENV") {
					t.Fatalf("expected fail-closed error, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if cfg.WebRefreshCookieInsecureLocalDev != tc.wantSecure {
				t.Fatalf("insecure-local-dev=%v, want %v", cfg.WebRefreshCookieInsecureLocalDev, tc.wantSecure)
			}
		})
	}
}
