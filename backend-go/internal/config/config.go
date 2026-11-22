package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/mail"
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
	// MFASecrets protects MFA material (#460 SEC-7): TOTP shared secrets are
	// AES-256-GCM encrypted and recovery codes hash to keyed verifiers under
	// the dedicated MFA_ENCRYPTION_KEYS keyring — disjoint from the JWT keys,
	// the refresh pepper, the media key and the device credential hashes.
	MFASecrets     *auth.MFASecrets
	AllowedOrigins []string // CORS allowlist (reflected per-request); never "*"
	RateLimitRPS   float64  // sustained requests/second for auth endpoints
	RateLimitBurst int      // maximum burst for auth endpoints
	// TrustedProxies (SEC-8, #1191): CIDRs of reverse proxies allowed to
	// speak for clients via X-Forwarded-For/X-Real-IP. Empty trusts nothing:
	// the client IP is the direct peer. Built from GRANETE_TRUSTED_PROXIES.
	TrustedProxies []*net.IPNet
	// MediaDir is the filesystem root for catalog image uploads (F040).
	MediaDir string
	// HardwareAssetLimits are the configurable per-representation byte caps
	// for hardware 3D asset uploads (#667 M1). Nil/absent = package defaults
	// (skp 256 MiB, glb 128 MiB, thumbnail 16 MiB).
	HardwareAssetLimits map[domain.HardwareAssetRepresentation]int64
	// WebRefreshCookieInsecureLocalDev opts the Web refresh cookie out of the
	// Secure attribute (#460 SEC-4A). It may only become true outside
	// production: LoadConfig refuses an insecure Web refresh cookie whenever
	// GRANETE_ENV=production, whatever the input combination.
	WebRefreshCookieInsecureLocalDev bool
	// DevLogPasswordResetLink opts the email-less password-reset delivery
	// adapter into printing the one-time link into the server log (#1242).
	// Default false (link withheld): an unset GRANETE_ENV must never turn
	// into "log the raw credential". Enabling it together with
	// GRANETE_ENV=production refuses the boot.
	DevLogPasswordResetLink bool
	// SMTP is the outbound email transport (#1646). Nil means email delivery
	// is NOT configured: password-reset links and invitation emails are not
	// sent (production logs an explicit warning at boot and the API tells
	// the owner). Built from SMTP_HOST/PORT/USERNAME/PASSWORD/FROM/TLS.
	SMTP *mail.SMTPConfig
	// PublicAppURL is the absolute Web origin (APP_PUBLIC_URL) used to build
	// links inside emails. Required whenever SMTP is configured: a link is
	// never derived from the request Host header.
	PublicAppURL string
	// EmailLocation prints expiry times inside emails (GRANETE_EMAIL_TIMEZONE,
	// default UTC).
	EmailLocation *time.Location
	// EmailOutboxPollInterval is how often the outbox worker looks for due
	// messages (GRANETE_EMAIL_OUTBOX_POLL_INTERVAL, Go duration, 1s–5m,
	// default 10s).
	EmailOutboxPollInterval time.Duration
	// Production mirrors GRANETE_ENV=production.
	Production bool
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
	mfaKeyring, err := parseMFAKeyringEnv()
	if err != nil {
		return Config{}, err
	}
	mfaSecrets, err := auth.NewMFASecrets(mfaKeyring)
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

	// SEC-8 (#1191): reverse proxies allowed to speak for clients via
	// X-Forwarded-For/X-Real-IP. Empty (the default) trusts nothing — client
	// IP is the direct peer — and an invalid entry refuses the boot rather
	// than half-trusting a header.
	trustedProxies, err := parseTrustedProxies(os.Getenv("GRANETE_TRUSTED_PROXIES"))
	if err != nil {
		return Config{}, err
	}

	hardwareAssetLimits := parseHardwareAssetLimitsEnv()

	devLogResetLink, err := parseDevLogPasswordResetLink()
	if err != nil {
		return Config{}, err
	}
	smtpConfig, publicAppURL, err := parseEmailDelivery()
	if err != nil {
		return Config{}, err
	}
	graneteEnv, err := normalizeGraneteEnv()
	if err != nil {
		return Config{}, err
	}
	emailLocation, err := parseEmailLocation()
	if err != nil {
		return Config{}, err
	}
	outboxPoll := 10 * time.Second
	if raw := strings.TrimSpace(os.Getenv("GRANETE_EMAIL_OUTBOX_POLL_INTERVAL")); raw != "" {
		parsed, parseErr := time.ParseDuration(raw)
		if parseErr != nil || parsed < time.Second || parsed > 5*time.Minute {
			return Config{}, fmt.Errorf("GRANETE_EMAIL_OUTBOX_POLL_INTERVAL must be a duration between 1s and 5m, got %q", raw)
		}
		outboxPoll = parsed
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
		MFASecrets:           mfaSecrets,
		AllowedOrigins:       allowed,
		RateLimitRPS:         rps,
		RateLimitBurst:       burst,
		TrustedProxies:       trustedProxies,
		MediaDir:             mediaDir,
		HardwareAssetLimits:  hardwareAssetLimits,

		WebRefreshCookieInsecureLocalDev: cookieInsecure,
		DevLogPasswordResetLink:          devLogResetLink,
		SMTP:                             smtpConfig,
		PublicAppURL:                     publicAppURL,
		EmailLocation:                    emailLocation,
		EmailOutboxPollInterval:          outboxPoll,
		Production:                       graneteEnv == "production",
	}, nil
}

// normalizeGraneteEnv resolves the deployment signal shared by every
// production-sensitive option: "" and the development spellings normalize to
// "development", "prod" to "production", anything else refuses the boot.
func normalizeGraneteEnv() (string, error) {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("GRANETE_ENV")))
	switch env {
	case "", "development", "dev":
		return "development", nil
	case "production", "prod":
		return "production", nil
	default:
		return "", fmt.Errorf("GRANETE_ENV must be \"production\" or \"development\", got %q", env)
	}
}

// parseDevLogPasswordResetLink resolves GRANETE_DEV_LOG_PASSWORD_RESET_LINK
// (#1242). Withholding the raw one-time reset credential is the DEFAULT —
// only an explicit boolean opt-in logs it, and never under production.
func parseDevLogPasswordResetLink() (bool, error) {
	env, err := normalizeGraneteEnv()
	if err != nil {
		return false, err
	}
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("GRANETE_DEV_LOG_PASSWORD_RESET_LINK")))
	enabled := false
	switch raw {
	case "", "0", "false", "no":
	case "1", "true", "yes":
		enabled = true
	default:
		return false, fmt.Errorf("GRANETE_DEV_LOG_PASSWORD_RESET_LINK must be a boolean, got %q", raw)
	}
	if enabled && env == "production" {
		return false, errors.New("production (GRANETE_ENV=production) must never log the raw password-reset link: GRANETE_DEV_LOG_PASSWORD_RESET_LINK cannot be enabled")
	}
	return enabled, nil
}

// parseEmailDelivery resolves the outbound email transport (#1646). An unset
// SMTP_HOST means "not configured" (nil, no error); a half configuration
// (SMTP_* values without a host, a host without a sender, credentials
// without a password, a link base that is not an absolute URL) refuses the
// boot instead of silently dropping mail. Plain-text SMTP (SMTP_TLS=none)
// exists only for local test sinks and is refused in production.
func parseEmailDelivery() (*mail.SMTPConfig, string, error) {
	env, err := normalizeGraneteEnv()
	if err != nil {
		return nil, "", err
	}
	production := env == "production"
	publicURL, err := parsePublicAppURL(os.Getenv("APP_PUBLIC_URL"), production)
	if err != nil {
		return nil, "", err
	}
	host := strings.TrimSpace(os.Getenv("SMTP_HOST"))
	if host == "" {
		for _, key := range []string{"SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_TLS"} {
			if strings.TrimSpace(os.Getenv(key)) != "" {
				return nil, "", fmt.Errorf("%s is set but SMTP_HOST is empty: configure the SMTP host or remove the partial SMTP settings", key)
			}
		}
		return nil, publicURL, nil
	}
	tlsMode := mail.TLSMode(strings.ToLower(strings.TrimSpace(os.Getenv("SMTP_TLS"))))
	if tlsMode == "" {
		tlsMode = mail.TLSStartTLS
	}
	defaultPort := 587
	switch tlsMode {
	case mail.TLSStartTLS:
	case mail.TLSImplicit:
		defaultPort = 465
	case mail.TLSNone:
		if production {
			return nil, "", errors.New("production (GRANETE_ENV=production) must not send email in plain text: SMTP_TLS=none is only for local test mailboxes")
		}
		defaultPort = 25
	default:
		return nil, "", fmt.Errorf("SMTP_TLS must be \"starttls\", \"tls\" or \"none\", got %q", tlsMode)
	}
	port := defaultPort
	if raw := strings.TrimSpace(os.Getenv("SMTP_PORT")); raw != "" {
		parsed, convErr := strconv.Atoi(raw)
		if convErr != nil || parsed <= 0 || parsed > 65535 {
			return nil, "", fmt.Errorf("SMTP_PORT must be a TCP port, got %q", raw)
		}
		port = parsed
	}
	username := strings.TrimSpace(os.Getenv("SMTP_USERNAME"))
	password := os.Getenv("SMTP_PASSWORD")
	if username != "" && password == "" {
		return nil, "", errors.New("SMTP_USERNAME is set but SMTP_PASSWORD is empty")
	}
	if username == "" && password != "" {
		return nil, "", errors.New("SMTP_PASSWORD is set but SMTP_USERNAME is empty")
	}
	from := strings.TrimSpace(os.Getenv("SMTP_FROM"))
	if from == "" {
		return nil, "", errors.New("SMTP_FROM is required when SMTP_HOST is set (for example \"Granete <no-reply@tu-dominio.com>\")")
	}
	if publicURL == "" {
		return nil, "", errors.New("APP_PUBLIC_URL is required when SMTP_HOST is set: email links are built from it, never from the request Host header")
	}
	cfg := mail.SMTPConfig{
		Host:     host,
		Port:     port,
		Username: username,
		Password: password,
		From:     from,
		TLS:      tlsMode,
	}
	// NewSMTPSender validates the sender address and the remaining fields.
	if _, err := mail.NewSMTPSender(cfg); err != nil {
		return nil, "", fmt.Errorf("invalid SMTP configuration: %w", err)
	}
	return &cfg, publicURL, nil
}

// parsePublicAppURL validates APP_PUBLIC_URL: an absolute http(s) origin
// (optionally with a base path), https in production, normalized without a
// trailing slash. Empty is allowed here; parseEmailDelivery requires it when
// SMTP is configured.
func parsePublicAppURL(raw string, production bool) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", fmt.Errorf("APP_PUBLIC_URL must be an absolute http(s) URL, got %q", raw)
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil || strings.Trim(parsed.Path, "/") != "" {
		return "", fmt.Errorf("APP_PUBLIC_URL must be the Web origin only (no path, credentials, query or fragment), got %q", raw)
	}
	if production && parsed.Scheme != "https" {
		return "", errors.New("production (GRANETE_ENV=production) requires an https APP_PUBLIC_URL")
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

// parseEmailLocation resolves GRANETE_EMAIL_TIMEZONE (IANA name, for example
// America/Argentina/Buenos_Aires) used to print expiry times inside emails.
// Unset means UTC; the rendered time always carries its zone label.
func parseEmailLocation() (*time.Location, error) {
	raw := strings.TrimSpace(os.Getenv("GRANETE_EMAIL_TIMEZONE"))
	if raw == "" {
		return time.UTC, nil
	}
	loc, err := time.LoadLocation(raw)
	if err != nil {
		return nil, fmt.Errorf("GRANETE_EMAIL_TIMEZONE must be an IANA time zone, got %q", raw)
	}
	return loc, nil
}

// parseHardwareAssetLimitsEnv reads the optional HARDWARE_ASSET_MAX_*_BYTES
// overrides (#667 M1). Invalid or non-positive values fall back to the
// package defaults instead of failing boot: they are operational caps, not
// security boundaries.
func parseHardwareAssetLimitsEnv() map[domain.HardwareAssetRepresentation]int64 {
	envs := map[domain.HardwareAssetRepresentation]string{
		domain.HardwareAssetRepresentationSKP:       "HARDWARE_ASSET_MAX_SKP_BYTES",
		domain.HardwareAssetRepresentationGLB:       "HARDWARE_ASSET_MAX_GLB_BYTES",
		domain.HardwareAssetRepresentationThumbnail: "HARDWARE_ASSET_MAX_THUMBNAIL_BYTES",
	}
	var limits map[domain.HardwareAssetRepresentation]int64
	for rep, env := range envs {
		raw := strings.TrimSpace(os.Getenv(env))
		if raw == "" {
			continue
		}
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v <= 0 {
			continue
		}
		if limits == nil {
			limits = map[domain.HardwareAssetRepresentation]int64{}
		}
		limits[rep] = v
	}
	return limits
}

// parseMFAKeyringEnv resolves the MFA secret keyring (#460 SEC-7).
// MFA_ENCRYPTION_KEYS is the rotation-shaped form:
// {"active_kid":"k1","keys":{"k1":"<base64 32B>","k0":"..."}}. A deployment
// without rotation may set the single MFA_ENCRYPTION_KEY (base64, ≥32 bytes)
// instead. Missing/invalid configuration fails boot — MFA secrets have no
// insecure fallback, exactly like the refresh pepper.
func parseMFAKeyringEnv() (*auth.MFAKeyring, error) {
	if raw := strings.TrimSpace(os.Getenv("MFA_ENCRYPTION_KEYS")); raw != "" {
		return auth.ParseMFAKeyringSecrets(raw)
	}
	return auth.ParseMFAKeyringSecrets(strings.TrimSpace(os.Getenv("MFA_ENCRYPTION_KEY")))
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
	env, err := normalizeGraneteEnv()
	if err != nil {
		return false, err
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

// parseTrustedProxies (SEC-8, #1191) parses GRANETE_TRUSTED_PROXIES: a
// comma-separated list of CIDR blocks or bare IPs (a bare IP becomes /32 or
// /128). Empty input trusts nothing; any unparseable entry is a boot error —
// a typo must never silently downgrade to "trust the header from anyone" or
// "ignore the real proxy".
func parseTrustedProxies(raw string) ([]*net.IPNet, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	out := make([]*net.IPNet, 0, len(parts))
	for _, p := range parts {
		entry := strings.TrimSpace(p)
		if entry == "" {
			continue
		}
		if strings.Contains(entry, "/") {
			_, cidr, err := net.ParseCIDR(entry)
			if err != nil {
				return nil, fmt.Errorf("GRANETE_TRUSTED_PROXIES: %q is not a valid CIDR: %w", entry, err)
			}
			out = append(out, cidr)
			continue
		}
		ip := net.ParseIP(entry)
		if ip == nil {
			return nil, fmt.Errorf("GRANETE_TRUSTED_PROXIES: %q is not a valid IP or CIDR", entry)
		}
		bits := 32
		if ip.To4() == nil {
			bits = 128
		}
		out = append(out, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
	}
	return out, nil
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
