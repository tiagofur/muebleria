package config

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/mail"
)

func clearEmailEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{"GRANETE_DEV_EMAIL_TRANSPORT", "GRANETE_ENV", "APP_PUBLIC_URL", "SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_TLS"} {
		t.Setenv(key, "")
	}
}

func TestParseEmailDelivery_UnsetMeansNotConfigured(t *testing.T) {
	clearEmailEnv(t)
	cfg, publicURL, err := parseEmailDelivery()
	if err != nil || cfg != nil || publicURL != "" {
		t.Fatalf("unset SMTP must be (nil, \"\", nil), got (%v, %q, %v)", cfg, publicURL, err)
	}
}

func TestParseEmailDelivery_FullConfiguration(t *testing.T) {
	clearEmailEnv(t)
	t.Setenv("GRANETE_ENV", "production")
	t.Setenv("SMTP_HOST", "smtp.example.test")
	t.Setenv("SMTP_USERNAME", "apikey")
	t.Setenv("SMTP_PASSWORD", "secret")
	t.Setenv("SMTP_FROM", "Granete <no-reply@example.test>")
	t.Setenv("APP_PUBLIC_URL", "https://app.example.test/")
	cfg, publicURL, err := parseEmailDelivery()
	if err != nil {
		t.Fatalf("parseEmailDelivery: %v", err)
	}
	if cfg.Port != 587 || cfg.TLS != mail.TLSStartTLS || cfg.Username != "apikey" {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
	if publicURL != "https://app.example.test" {
		t.Fatalf("public URL must be normalized without trailing slash, got %q", publicURL)
	}
}

func TestParseEmailDelivery_ImplicitTLSDefaultsTo465(t *testing.T) {
	clearEmailEnv(t)
	t.Setenv("SMTP_HOST", "smtp.example.test")
	t.Setenv("SMTP_TLS", "tls")
	t.Setenv("SMTP_FROM", "no-reply@example.test")
	t.Setenv("APP_PUBLIC_URL", "http://localhost:5173")
	cfg, _, err := parseEmailDelivery()
	if err != nil || cfg.Port != 465 {
		t.Fatalf("expected port 465, got %+v err=%v", cfg, err)
	}
}

func TestParseEmailDelivery_RefusesHalfConfigurations(t *testing.T) {
	cases := map[string]map[string]string{
		"settings without host":   {"SMTP_FROM": "no-reply@example.test"},
		"host without from":       {"SMTP_HOST": "smtp.example.test", "APP_PUBLIC_URL": "http://localhost:5173"},
		"host without public url": {"SMTP_HOST": "smtp.example.test", "SMTP_FROM": "no-reply@example.test"},
		"username without pass":   {"SMTP_HOST": "smtp.example.test", "SMTP_FROM": "no-reply@example.test", "APP_PUBLIC_URL": "http://localhost:5173", "SMTP_USERNAME": "u"},
		"invalid from":            {"SMTP_HOST": "smtp.example.test", "SMTP_FROM": "not an address", "APP_PUBLIC_URL": "http://localhost:5173"},
		"invalid port":            {"SMTP_HOST": "smtp.example.test", "SMTP_FROM": "no-reply@example.test", "APP_PUBLIC_URL": "http://localhost:5173", "SMTP_PORT": "70000"},
		"unknown tls":             {"SMTP_HOST": "smtp.example.test", "SMTP_FROM": "no-reply@example.test", "APP_PUBLIC_URL": "http://localhost:5173", "SMTP_TLS": "ssl3"},
		"relative public url":     {"APP_PUBLIC_URL": "/app"},
		"public url with query":   {"APP_PUBLIC_URL": "https://app.example.test/?x=1"},
		"plain tls in production": {"GRANETE_ENV": "production", "SMTP_HOST": "mailpit", "SMTP_FROM": "no-reply@example.test", "APP_PUBLIC_URL": "https://app.example.test", "SMTP_TLS": "none"},
		"http url in production":  {"GRANETE_ENV": "production", "APP_PUBLIC_URL": "http://app.example.test"},
	}
	for name, env := range cases {
		t.Run(name, func(t *testing.T) {
			clearEmailEnv(t)
			for k, v := range env {
				t.Setenv(k, v)
			}
			if _, _, err := parseEmailDelivery(); err == nil {
				t.Fatalf("expected a boot refusal for %s", name)
			} else if strings.Contains(err.Error(), "secret") {
				t.Fatalf("error must not echo the SMTP password: %v", err)
			}
		})
	}
}

func TestParseEmailDelivery_PlainTLSAllowedForLocalSink(t *testing.T) {
	clearEmailEnv(t)
	t.Setenv("SMTP_HOST", "127.0.0.1")
	t.Setenv("SMTP_TLS", "none")
	t.Setenv("SMTP_PORT", "1025")
	t.Setenv("SMTP_FROM", "no-reply@granete.test")
	t.Setenv("APP_PUBLIC_URL", "http://localhost:5173")
	cfg, _, err := parseEmailDelivery()
	if err != nil || cfg.Port != 1025 || cfg.TLS != mail.TLSNone {
		t.Fatalf("local sink config: %+v err=%v", cfg, err)
	}
}

func TestParseDevEmailTransport(t *testing.T) {
	clearEmailEnv(t)
	t.Setenv("GRANETE_DEV_EMAIL_TRANSPORT", "log")
	enabled, url, err := parseDevEmailTransport(false, "")
	if err != nil || !enabled || url != "http://localhost:5173" {
		t.Fatalf("dev log transport: enabled=%t url=%q err=%v", enabled, url, err)
	}
	if _, _, err := parseDevEmailTransport(true, "http://localhost:5173"); err == nil {
		t.Fatal("log transport together with SMTP must be refused")
	}
	t.Setenv("GRANETE_ENV", "production")
	if _, _, err := parseDevEmailTransport(false, ""); err == nil {
		t.Fatal("log transport must be refused in production")
	}
	t.Setenv("GRANETE_ENV", "")
	t.Setenv("GRANETE_DEV_EMAIL_TRANSPORT", "stdout")
	if _, _, err := parseDevEmailTransport(false, ""); err == nil {
		t.Fatal("unknown transport must be refused")
	}
}
