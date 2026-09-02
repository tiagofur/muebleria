package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"golang.org/x/crypto/hkdf"
)

// #460 SEC-7: MFA secret protection. TOTP shared secrets are stored under
// authenticated encryption (AES-256-GCM) with a DEDICATED keyring — disjoint
// from JWT signing keys, the refresh pepper, the media signing key and the
// SketchUp device credential material. Recovery codes store only keyed
// HMAC-SHA256 verifiers. Subkeys are derived per purpose via HKDF-SHA256 so
// the stored bytes of one purpose can never be reused against another.
//
// Key rotation mirrors the JWT keyring: MFA_ENCRYPTION_KEYS holds
// {"active_kid","keys":{kid:base64}}; new material encrypts under the active
// kid while stored kid-pinned values stay decryptable until their kid is
// removed from the ring (which fails those factors closed).

const (
	minMFAKeyBytes = 32

	// mfaDefaultKID is the kid a single-secret deployment (MFA_ENCRYPTION_KEY
	// without MFA_ENCRYPTION_KEYS) is registered under.
	mfaDefaultKID = "primary"

	mfaTotpSecretInfo     = "granete/mfa/totp-secret/v1"
	mfaRecoveryVerifyInfo = "granete/mfa/recovery-verifier/v1"
)

// totpSecretAAD domain-separates the GCM layer: a ciphertext produced for any
// other purpose can never decrypt here even under the same key.
var totpSecretAAD = []byte("granete-mfa-totp-secret")

// MFAKeyring holds the 32-byte MFA encryption keys keyed by kid.
type MFAKeyring struct {
	activeKid string
	keys      map[string][]byte
}

// NewMFAKeyring validates and builds the MFA key ring. Every key must decode
// from base64 to at least 32 bytes and kids reuse the JWT kid grammar.
func NewMFAKeyring(activeKid string, keys map[string][]byte) (*MFAKeyring, error) {
	if len(keys) == 0 {
		return nil, errors.New("mfa keyring requires at least one key")
	}
	if _, ok := keys[activeKid]; !ok {
		return nil, fmt.Errorf("mfa keyring active kid %q has no key", activeKid)
	}
	for kid, key := range keys {
		if !kidPattern.MatchString(kid) {
			return nil, fmt.Errorf("mfa keyring kid %q must match %s", kid, kidPattern.String())
		}
		if len(key) < minMFAKeyBytes {
			return nil, fmt.Errorf("mfa keyring key for kid %q must be at least %d bytes", kid, minMFAKeyBytes)
		}
	}
	return &MFAKeyring{activeKid: activeKid, keys: keys}, nil
}

// ParseMFAKeyringSecrets parses {"active_kid":string,"keys":{kid:base64key}}.
// A single raw base64 secret is accepted for single-key deployments.
func ParseMFAKeyringSecrets(raw string) (*MFAKeyring, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("mfa encryption keys are required")
	}
	if strings.HasPrefix(trimmed, "{") {
		var parsed struct {
			ActiveKID string            `json:"active_kid"`
			Keys      map[string]string `json:"keys"`
		}
		if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
			return nil, fmt.Errorf("MFA_ENCRYPTION_KEYS must be JSON {\"active_kid\":string,\"keys\":map}: %w", err)
		}
		if len(parsed.Keys) == 0 {
			return nil, errors.New("MFA_ENCRYPTION_KEYS requires at least one key")
		}
		keys := make(map[string][]byte, len(parsed.Keys))
		for kid, encoded := range parsed.Keys {
			key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
			if err != nil {
				return nil, fmt.Errorf("MFA_ENCRYPTION_KEYS key for kid %q must be base64: %w", kid, err)
			}
			keys[kid] = key
		}
		return NewMFAKeyring(parsed.ActiveKID, keys)
	}
	key, err := base64.StdEncoding.DecodeString(trimmed)
	if err != nil {
		return nil, fmt.Errorf("MFA_ENCRYPTION_KEY must be base64: %w", err)
	}
	return NewMFAKeyring(mfaDefaultKID, map[string][]byte{mfaDefaultKID: key})
}

// ActiveKeyID is the kid new secrets are encrypted under.
func (k *MFAKeyring) ActiveKeyID() string { return k.activeKid }

// HasKeyID reports whether stored kid-pinned material is still decryptable.
func (k *MFAKeyring) HasKeyID(kid string) bool {
	_, ok := k.keys[kid]
	return ok
}

// MFASecrets encrypts TOTP secrets and computes recovery verifiers under the
// dedicated MFA keyring. A nil MFASecrets fails closed everywhere.
type MFASecrets struct {
	keyring *MFAKeyring
}

// NewMFASecrets builds the MFA secret authority. The keyring must not be nil.
func NewMFASecrets(keyring *MFAKeyring) (*MFASecrets, error) {
	if keyring == nil {
		return nil, errors.New("mfa secrets require a keyring")
	}
	return &MFASecrets{keyring: keyring}, nil
}

// EncryptTOTPSecret seals the raw secret under AES-256-GCM with the ACTIVE
// kid. Layout: nonce(12) || ciphertext||tag. The returned kid pins the key
// version stored with the factor.
func (m *MFASecrets) EncryptTOTPSecret(secret []byte) (ciphertext []byte, kid string, err error) {
	if m == nil {
		return nil, "", errors.New("mfa secrets authority is not configured")
	}
	gcm, err := m.aeadFor(m.keyring.activeKid)
	if err != nil {
		return nil, "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, "", fmt.Errorf("mfa encryption nonce: %w", err)
	}
	sealed := gcm.Seal(nil, nonce, secret, totpSecretAAD)
	return append(nonce, sealed...), m.keyring.activeKid, nil
}

// DecryptTOTPSecret opens a kid-pinned ciphertext. A rotated-out kid or a
// tampered ciphertext is an error — never plaintext passthrough.
func (m *MFASecrets) DecryptTOTPSecret(ciphertext []byte, kid string) ([]byte, error) {
	if m == nil {
		return nil, errors.New("mfa secrets authority is not configured")
	}
	gcm, err := m.aeadFor(kid)
	if err != nil {
		return nil, err
	}
	if len(ciphertext) < gcm.NonceSize()+gcm.Overhead() {
		return nil, errors.New("mfa ciphertext too short")
	}
	nonce, body := ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, body, totpSecretAAD)
	if err != nil {
		return nil, errors.New("mfa ciphertext authentication failed")
	}
	return plaintext, nil
}

func (m *MFASecrets) aeadFor(kid string) (cipher.AEAD, error) {
	root, ok := m.keyring.keys[kid]
	if !ok {
		return nil, fmt.Errorf("mfa key id %q is not registered", kid)
	}
	key := m.derive(root, mfaTotpSecretInfo)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm, nil
}

// RecoveryVerifier derives the keyed verifier of a recovery code under the
// ACTIVE kid. The DB stores verifier+kid, never the code.
func (m *MFASecrets) RecoveryVerifier(code string) (verifier []byte, kid string, err error) {
	if m == nil {
		return nil, "", errors.New("mfa secrets authority is not configured")
	}
	key := m.derive(m.keyring.keys[m.keyring.activeKid], mfaRecoveryVerifyInfo)
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(normalizeRecoveryCode(code)))
	return mac.Sum(nil), m.keyring.activeKid, nil
}

// RecoveryMatches checks a presented code against a kid-pinned verifier in
// constant time.
func (m *MFASecrets) RecoveryMatches(code string, kid string, verifier []byte) bool {
	if m == nil || len(verifier) != sha256.Size {
		return false
	}
	root, ok := m.keyring.keys[kid]
	if !ok {
		return false
	}
	key := m.derive(root, mfaRecoveryVerifyInfo)
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(normalizeRecoveryCode(code)))
	return hmac.Equal(mac.Sum(nil), verifier)
}

// derive expands a root key into a purpose-bound subkey (HKDF-SHA256,
// 32 bytes). Saltless HKDF with a fixed info is the documented construction
// for deriving independent keys from an already-uniform 32-byte secret.
func (m *MFASecrets) derive(root []byte, info string) []byte {
	reader := hkdf.New(sha256.New, root, nil, []byte(info))
	key := make([]byte, 32)
	if _, err := io.ReadFull(reader, key); err != nil {
		// HKDF-SHA256 cannot fail before 32 bytes on any supported platform.
		panic("auth: hkdf expand failed: " + err.Error())
	}
	return key
}

// normalizeRecoveryCode strips presentation separators (spaces/dashes) and
// upper-cases, mirroring how users re-type stored codes. The normalized form
// is what the verifier keys on.
func normalizeRecoveryCode(raw string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(raw) {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// NormalizeRecoveryCodeInput exposes the canonical normalization for callers
// verifying typed recovery codes.
func NormalizeRecoveryCodeInput(raw string) string { return normalizeRecoveryCode(raw) }
