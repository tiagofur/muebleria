package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds all server configuration sourced from the environment.
//
// Secret handling is fail-closed: JWT_SECRET is mandatory and must meet a
// minimum length. The server refuses to boot otherwise — there is no insecure
// fallback. See docs/security (#1) and the .env.example at the repo root.
type Config struct {
	Port           string
	DatabaseURL    string
	JWTSecret      string
	AllowedOrigins []string // CORS allowlist (reflected per-request); never "*"
	RateLimitRPS   float64  // sustained requests/second for auth endpoints
	RateLimitBurst int      // maximum burst for auth endpoints
}

const minJWTSecretBytes = 32

// LoadConfig reads configuration from the environment.
//
// It returns an error (rather than falling back to an insecure default) when a
// required secret is missing or too short, so that the caller can refuse to
// start the server.
func LoadConfig() (Config, error) {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		// Default for local development only (sslmode=disable).
		// Production MUST set DATABASE_URL with sslmode=require (or verify-full).
		dbURL = "postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable"
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		return Config{}, fmt.Errorf("JWT_SECRET is required (set it to a random string of at least %d bytes)", minJWTSecretBytes)
	}
	if len(jwtSecret) < minJWTSecretBytes {
		return Config{}, fmt.Errorf("JWT_SECRET is too short: got %d bytes, need at least %d", len(jwtSecret), minJWTSecretBytes)
	}

	allowed := parseOrigins(os.Getenv("CORS_ALLOWED_ORIGINS"))
	if len(allowed) == 0 {
		// Local dev defaults (Vite dev server + preview). Production MUST override.
		allowed = []string{"http://localhost:5173", "http://localhost:4173"}
	}

	rps, burst, err := parseRateLimit()
	if err != nil {
		return Config{}, err
	}

	return Config{
		Port:           port,
		DatabaseURL:    dbURL,
		JWTSecret:      jwtSecret,
		AllowedOrigins: allowed,
		RateLimitRPS:   rps,
		RateLimitBurst: burst,
	}, nil
}

func parseOrigins(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if o := strings.TrimSpace(p); o != "" {
			out = append(out, o)
		}
	}
	return out
}

func parseRateLimit() (float64, int, error) {
	const (
		defaultRPS   = 0.2 // ~1 request every 5 seconds sustained
		defaultBurst = 5
	)

	rps := defaultRPS
	if raw := os.Getenv("RATE_LIMIT_RPS"); raw != "" {
		v, err := strconv.ParseFloat(raw, 64)
		if err != nil || v <= 0 {
			return 0, 0, fmt.Errorf("RATE_LIMIT_RPS must be a positive number, got %q", raw)
		}
		rps = v
	}

	burst := defaultBurst
	if raw := os.Getenv("RATE_LIMIT_BURST"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || v <= 0 {
			return 0, 0, fmt.Errorf("RATE_LIMIT_BURST must be a positive integer, got %q", raw)
		}
		burst = v
	}

	return rps, burst, nil
}
