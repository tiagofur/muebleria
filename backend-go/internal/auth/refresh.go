package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

const (
	refreshCredentialPrefix = "grt_refresh_v1."
	refreshSecretBytes      = 32
	minRefreshPepperBytes   = 32
)

// RefreshCredentials generates high-entropy opaque bearer credentials and
// converts them to keyed, non-reversible lookup verifiers. The pepper is a
// dedicated server secret: JWT signing keys are deliberately not reused.
type RefreshCredentials struct {
	pepper []byte
}

func NewRefreshCredentials(pepper string) (*RefreshCredentials, error) {
	if len(pepper) < minRefreshPepperBytes {
		return nil, fmt.Errorf("refresh credential pepper must be at least %d bytes", minRefreshPepperBytes)
	}
	return &RefreshCredentials{pepper: []byte(pepper)}, nil
}

func (r *RefreshCredentials) Generate() (string, []byte, error) {
	if r == nil {
		return "", nil, errors.New("refresh credential authority is not configured")
	}
	secret := make([]byte, refreshSecretBytes)
	if _, err := rand.Read(secret); err != nil {
		return "", nil, fmt.Errorf("generate refresh credential: %w", err)
	}
	raw := refreshCredentialPrefix + base64.RawURLEncoding.EncodeToString(secret)
	return raw, r.Verifier(raw), nil
}

func (r *RefreshCredentials) Verifier(raw string) []byte {
	if r == nil {
		return nil
	}
	mac := hmac.New(sha256.New, r.pepper)
	_, _ = mac.Write([]byte(raw))
	return mac.Sum(nil)
}

func (r *RefreshCredentials) Validate(raw string) error {
	if !strings.HasPrefix(raw, refreshCredentialPrefix) {
		return errors.New("invalid refresh credential")
	}
	encoded := strings.TrimPrefix(raw, refreshCredentialPrefix)
	secret, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(secret) != refreshSecretBytes {
		return errors.New("invalid refresh credential")
	}
	return nil
}

func (r *RefreshCredentials) Matches(raw string, verifier []byte) bool {
	if r == nil || r.Validate(raw) != nil || len(verifier) != sha256.Size {
		return false
	}
	return hmac.Equal(r.Verifier(raw), verifier)
}
