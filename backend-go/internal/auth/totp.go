package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" // #nosec G505 -- RFC 6238 TOTP with SHA1 is the interoperable standard every authenticator implements.
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// #460 SEC-7: RFC 6238 TOTP baseline. Parameters are fixed to the universal
// authenticator defaults — SHA1, 6 digits, 30-second period, ±1 interval
// acceptance window — so any standard app (Google Authenticator, Authy, 1Password,
// Aegis, …) provisions from the otpauth:// URI without configuration.

const (
	TOTPPeriod    = 30 * time.Second
	TOTPDigits    = 6
	TOTPSkew      = 1 // accepted intervals: now-1, now, now+1
	TOTPSecretLen = 20

	totpAlgoName = "SHA1"
)

var totpBase32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// GenerateTOTPSecret draws 20 cryptographically random bytes (160 bits) and
// returns the base32 encoding authenticators expect in the provisioning URI.
func GenerateTOTPSecret() (raw []byte, encoded string, err error) {
	raw = make([]byte, TOTPSecretLen)
	if _, err := rand.Read(raw); err != nil {
		return nil, "", fmt.Errorf("totp secret entropy: %w", err)
	}
	return raw, totpBase32.EncodeToString(raw), nil
}

// TOTPCounter converts an instant to the RFC 6238 time-step counter.
func TOTPCounter(at time.Time) int64 {
	return int64(at.UTC().Unix()) / int64(TOTPPeriod.Seconds())
}

// TOTPCode computes the RFC 4226 HOTP value for a counter under the raw
// secret (SHA1, 6 digits, dynamic truncation).
func TOTPCode(raw []byte, counter int64) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(counter))
	mac := hmac.New(sha1.New, raw)
	_, _ = mac.Write(msg[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := (uint32(sum[offset])&0x7f)<<24 |
		uint32(sum[offset+1])<<16 |
		uint32(sum[offset+2])<<8 |
		uint32(sum[offset+3])
	mod := uint32(1)
	for i := 0; i < TOTPDigits; i++ {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", TOTPDigits, value%mod)
}

// TOTPVerification is a successful match: the accepted counter is the replay
// token — callers must persist it atomically as the factor's high-water mark.
type TOTPVerification struct {
	Counter int64
}

// VerifyTOTP checks a 6-digit code against the secret within the ±1 window
// around `now` and returns the accepted counter — the replay token callers
// must persist atomically as the factor's high-water mark (storage rejects a
// counter at or below the stored one). Comparison is constant-time.
func VerifyTOTP(raw []byte, code string, now time.Time) (TOTPVerification, error) {
	normalized := normalizeTOTPCode(code)
	if len(normalized) != TOTPDigits {
		return TOTPVerification{}, errors.New("totp code must be 6 digits")
	}
	current := TOTPCounter(now)
	// Candidates ordered NEWEST first: accepting the freshest interval keeps
	// the high-water mark as high as possible under clock drift.
	for offset := int64(TOTPSkew); offset >= -int64(TOTPSkew); offset-- {
		candidate := current + offset
		if candidate < 0 {
			continue
		}
		expected := TOTPCode(raw, candidate)
		if subtle.ConstantTimeCompare([]byte(expected), []byte(normalized)) == 1 {
			return TOTPVerification{Counter: candidate}, nil
		}
	}
	return TOTPVerification{}, errors.New("totp code did not match")
}

// normalizeTOTPCode strips separators/spaces users may paste with.
func normalizeTOTPCode(code string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(code) {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// NormalizeTOTPCodeInput exposes the canonical normalization for handlers.
func NormalizeTOTPCodeInput(code string) string { return normalizeTOTPCode(code) }

// BuildTOTPProvisioningURI renders the otpauth:// URI authenticators scan.
// The URI exists once in the enrollment response; it is never logged or
// persisted server-side.
func BuildTOTPProvisioningURI(accountName, issuer, encodedSecret string) string {
	label := url.PathEscape(issuer) + ":" + url.PathEscape(accountName)
	q := url.Values{}
	q.Set("secret", encodedSecret)
	q.Set("issuer", issuer)
	q.Set("algorithm", totpAlgoName)
	q.Set("digits", fmt.Sprintf("%d", TOTPDigits))
	q.Set("period", fmt.Sprintf("%d", int(TOTPPeriod.Seconds())))
	return "otpauth://totp/" + label + "?" + q.Encode()
}

// GenerateRecoveryCodes draws `count` high-entropy single-use codes from the
// 32-symbol no-confusion alphabet (unbiased: 256%32==0). Plaintext exists only
// in the generation response; the DB stores keyed verifiers.
func GenerateRecoveryCodes(count int) ([]string, error) {
	if count <= 0 {
		return nil, errors.New("recovery code count must be positive")
	}
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	codes := make([]string, 0, count)
	buf := make([]byte, 10)
	for i := 0; i < count; i++ {
		if _, err := rand.Read(buf); err != nil {
			return nil, fmt.Errorf("recovery code entropy: %w", err)
		}
		out := make([]byte, len(buf))
		for j, b := range buf {
			out[j] = alphabet[int(b)%len(alphabet)]
		}
		codes = append(codes, string(out[:5])+"-"+string(out[5:]))
	}
	return codes, nil
}
