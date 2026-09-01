package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/auth"
)

// Config holds all server configuration sourced from the environment.
//
// Secret handling is fail-closed: JWT_SECRET is mandatory and must meet a
// minimum length. The server refuses to boot otherwise — there is no insecure
// fallback. See docs/security (#1) and the .env.example at the repo root.
type Config struct {
	Port                 string
	DatabaseURL          string
	MigrationDatabaseURL string
	JWTSecret            string
	// JWTIssuer is the `iss` claim every ver5 token carries and validation
	// requires (#460). Default "granete-api".
	JWTIssuer string
	// JWTAuthority mints and validates tokens under the exact HS256 policy:
	// pinned algorithm, issuer, per-client audience, token type and key id.
	// Built from JWT_KEYRING when present, otherwise from the single
	// JWT_SECRET registered under the legacy key id.
	JWTAuthority *auth.Authority
	// RefreshCredentials hashes opaque refresh secrets with a dedicated
	// pepper. It is intentionally independent from every JWT signing key.
	RefreshCredentials *auth.RefreshCredentials
	// MediaAuthority signs resource-scoped media read grants (#460 SEC-3)
	// with the dedicated MEDIA_SIGNING_KEY. It shares no cryptographic
	// primitive with the JWT keyring or the refresh pepper: a media grant can
	// never validate as a session credential and vice versa.
	MediaAuthority *auth.MediaAuthority
	AllowedOrigins []string // CORS allowlist (reflected per-request); never "*"
	RateLimitRPS   float64  // sustained requests/second for auth endpoints
	RateLimitBurst int      // maximum burst for auth endpoints
	// MediaDir is the filesystem root for catalog image uploads (F040).
	MediaDir string
	// WebRefreshCookieInsecureLocalDev opts the Web refresh cookie out of the
	// Secure attribute (#460 SEC-4A). It may only become true outside
	// production: LoadConfig refuses an insecure Web refresh cookie whenever
	// GRANETE_ENV=production, whatever the input combination.
	WebRefreshCookieInsecureLocalDev bool
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
		dbURL = "postgres://granete_app:granete_app@localhost:5445/muebles?sslmode=disable"
	}
	migrationDBURL := os.Getenv("MIGRATION_DATABASE_URL")
	if migrationDBURL == "" {
		migrationDBURL = "postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable"
	}
	if dbURL == migrationDBURL {
		return Config{}, fmt.Errorf("DATABASE_URL and MIGRATION_DATABASE_URL must use separate database roles")
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		return Config{}, fmt.Errorf("JWT_SECRET is required (set it to a random string of at least %d bytes)", minJWTSecretBytes)
	}
	if len(jwtSecret) < minJWTSecretBytes {
		return Config{}, fmt.Errorf("JWT_SECRET is too short: got %d bytes, need at least %d", len(jwtSecret), minJWTSecretBytes)
	}

	keyring, issuer, err := parseJWTKeyring(jwtSecret)
	if err != nil {
		return Config{}, err
	}
	authority, err := auth.NewAuthority(keyring, issuer)
	if err != nil {
		return Config{}, fmt.Errorf("building token authority: %w", err)
	}
	refreshCredentials, err := auth.NewRefreshCredentials(os.Getenv("REFRESH_TOKEN_PEPPER"))
	if err != nil {
		return Config{}, err
	}
	mediaAuthority, err := auth.NewMediaAuthority(os.Getenv("MEDIA_SIGNING_KEY"))
	if err != nil {
		return Config{}, err
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

	cookieInsecure, err := parseWebRefreshCookieSecurity(allowed)
	if err != nil {
		return Config{}, err
	}

	mediaDir := os.Getenv("MEDIA_DIR")
	if strings.TrimSpace(mediaDir) == "" {
		// Default to an absolute path OUTSIDE the repo (~/.muebles-media).
		// The previous default ("data/media" relative to CWD) sat inside the
		// working tree and was gitignored, so any git clean / re-clone / machine
		// change silently wiped uploaded catalog images while the DB kept
		// referencing them — the catalog then showed broken <img> tags with no
		// error. A user-home dir survives those operations. Override with
		// MEDIA_DIR (absolute or relative) when you need a different location.
		home, err := os.UserHomeDir()
		if err != nil {
			return Config{}, fmt.Errorf("resolving home dir for media store: %w", err)
		}
		mediaDir = filepath.Join(home, ".muebles-media")
	}

	return Config{
		Port:                 port,
		DatabaseURL:          dbURL,
		MigrationDatabaseURL: migrationDBURL,
		JWTSecret:            jwtSecret,
		JWTIssuer:            issuer,
		JWTAuthority:         authority,
		RefreshCredentials:   refreshCredentials,
		MediaAuthority:       mediaAuthority,
		AllowedOrigins:       allowed,
		RateLimitRPS:         rps,
		RateLimitBurst:       burst,
		MediaDir:             mediaDir,

		WebRefreshCookieInsecureLocalDev: cookieInsecure,
	}, nil
}

// parseWebRefreshCookieSecurity resolves whether the Web refresh cookie may
// drop the Secure attribute (#460 SEC-4A). The resolution is fail-closed:
//
//   - WEB_REFRESH_COOKIE_SECURE=true  → always Secure.
//   - WEB_REFRESH_COOKIE_SECURE=false → allowed only when GRANETE_ENV is not
//     "production"; a production deployment that asks for an insecure refresh
//     cookie refuses to boot instead of shipping one.
//   - WEB_REFRESH_COOKIE_SECURE=auto (the default) → Secure unless EVERY
//     configured CORS origin is a loopback HTTP origin (the local dev/gate
//     shape). Any real origin keeps the cookie Secure even over plain HTTP,
//     where browsers then refuse it — degraded, never insecure.
//
// GRANETE_ENV is an explicit deployment signal, not a Host-header guess;
// docker-compose.prod.yml pins it to "production".
func parseWebRefreshCookieSecurity(allowedOrigins []string) (bool, error) {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("GRANETE_ENV")))
	switch env {
	case "", "development", "dev":
		env = "development"
	case "production", "prod":
		env = "production"
	default:
		return false, fmt.Errorf("GRANETE_ENV must be \"production\" or \"development\", got %q", env)
	}

	raw := strings.ToLower(strings.TrimSpace(os.Getenv("WEB_REFRESH_COOKIE_SECURE")))
	secure := true
	switch raw {
	case "", "auto":
		secure = !allOriginsLoopbackHTTP(allowedOrigins)
	case "true":
	case "false":
		secure = false
	default:
		return false, fmt.Errorf("WEB_REFRESH_COOKIE_SECURE must be \"auto\", \"true\" or \"false\", got %q", raw)
	}

	if env == "production" && !secure {
		return false, errors.New("production (GRANETE_ENV=production) requires a Secure Web refresh cookie: WEB_REFRESH_COOKIE_SECURE must not be \"false\"" + map[bool]string{true: " and CORS origins must not be loopback-only under \"auto\"", false: ""}[raw == "auto" || raw == ""])
	}
	return !secure, nil
}

// allOriginsLoopbackHTTP reports whether every origin is plain HTTP on a
// loopback host — the local development/gates shape (Vite on localhost against
// a local backend). An empty list is not loopback: fail toward Secure.
func allOriginsLoopbackHTTP(origins []string) bool {
	if len(origins) == 0 {
		return false
	}
	for _, o := range origins {
		u, err := url.Parse(strings.TrimSpace(o))
		if err != nil || u.Scheme != "http" {
			return false
		}
		switch u.Hostname() {
		case "localhost", "127.0.0.1", "::1":
		default:
			return false
		}
	}
	return true
}

// parseJWTKeyring resolves the signing key ring and issuer. Without
// JWT_KEYRING the single JWT_SECRET is registered under the legacy key id
// (ver4 tokens carry no kid and validate against that entry). With JWT_KEYRING
// the active key signs new tokens while every registered key stays valid for
// validation, so rotation needs no downtime; removing a key revokes its tokens
// immediately.
//
// Format: {"active_kid":"k1","keys":{"k1":"...","k0":"..."}}. Deployments
// rotating away from a bare JWT_SECRET must register that old secret under kid
// "legacy" or outstanding ver4 tokens fail closed.
func parseJWTKeyring(jwtSecret string) (*auth.Keyring, string, error) {
	issuer := strings.TrimSpace(os.Getenv("JWT_ISSUER"))
	if issuer == "" {
		issuer = auth.DefaultIssuer
	}

	raw := strings.TrimSpace(os.Getenv("JWT_KEYRING"))
	if raw == "" {
		keyring, err := auth.SingleKeyKeyring(jwtSecret)
		if err != nil {
			return nil, "", fmt.Errorf("building default keyring: %w", err)
		}
		return keyring, issuer, nil
	}

	var parsed struct {
		ActiveKID string            `json:"active_kid"`
		Keys      map[string]string `json:"keys"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil, "", fmt.Errorf("JWT_KEYRING must be JSON {\"active_kid\":string,\"keys\":map}: %w", err)
	}
	keyring, err := auth.NewKeyring(parsed.ActiveKID, parsed.Keys)
	if err != nil {
		return nil, "", fmt.Errorf("JWT_KEYRING: %w", err)
	}
	return keyring, issuer, nil
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
