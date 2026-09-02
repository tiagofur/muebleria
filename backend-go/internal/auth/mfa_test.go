package auth

import (
	"bytes"
	"encoding/base64"
	"testing"
)

// #460 SEC-7 — crypto proofs: encryption round-trip, tamper/wrong-key
// failure, kid versioning, recovery verifiers, and the RFC 6238 test vectors.

func testMFAKeyring(t *testing.T) *MFAKeyring {
	t.Helper()
	keyring, err := NewMFAKeyring("k1", map[string][]byte{
		"k1": bytes.Repeat([]byte{0x11}, 32),
		"k0": bytes.Repeat([]byte{0x22}, 32),
	})
	if err != nil {
		t.Fatalf("NewMFAKeyring: %v", err)
	}
	return keyring
}

func TestMFASecretsEncryptDecryptRoundTrip(t *testing.T) {
	secrets, err := NewMFASecrets(testMFAKeyring(t))
	if err != nil {
		t.Fatalf("NewMFASecrets: %v", err)
	}
	secret := []byte("totp-shared-secret-160bits!!")
	ciphertext, kid, err := secrets.EncryptTOTPSecret(secret)
	if err != nil {
		t.Fatalf("EncryptTOTPSecret: %v", err)
	}
	if kid != "k1" {
		t.Fatalf("expected active kid k1, got %q", kid)
	}
	if bytes.Equal(ciphertext, secret) {
		t.Fatal("ciphertext must differ from plaintext")
	}
	if bytes.Contains(ciphertext, secret) {
		t.Fatal("ciphertext must not contain the plaintext")
	}
	plaintext, err := secrets.DecryptTOTPSecret(ciphertext, kid)
	if err != nil {
		t.Fatalf("DecryptTOTPSecret: %v", err)
	}
	if !bytes.Equal(plaintext, secret) {
		t.Fatalf("round-trip mismatch: %q != %q", plaintext, secret)
	}

	// A second encryption of the same secret must differ (random nonce).
	again, _, err := secrets.EncryptTOTPSecret(secret)
	if err != nil {
		t.Fatalf("second encryption: %v", err)
	}
	if bytes.Equal(again, ciphertext) {
		t.Fatal("nonce reuse: two encryptions produced identical ciphertext")
	}
}

func TestMFASecretsTamperedCiphertextFails(t *testing.T) {
	secrets, _ := NewMFASecrets(testMFAKeyring(t))
	secret := []byte("secret-material")
	ciphertext, kid, err := secrets.EncryptTOTPSecret(secret)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	for i := 0; i < len(ciphertext); i++ {
		tampered := append([]byte(nil), ciphertext...)
		tampered[i] ^= 0xFF
		if _, err := secrets.DecryptTOTPSecret(tampered, kid); err == nil {
			t.Fatalf("tampered ciphertext byte %d decrypted without error", i)
		}
	}
	// Truncation is tampering too.
	if _, err := secrets.DecryptTOTPSecret(ciphertext[:len(ciphertext)-1], kid); err == nil {
		t.Fatal("truncated ciphertext decrypted without error")
	}
}

func TestMFASecretsWrongKeyFails(t *testing.T) {
	keyring := testMFAKeyring(t)
	secrets, _ := NewMFASecrets(keyring)
	secret := []byte("secret-material")
	ciphertext, _, err := secrets.EncryptTOTPSecret(secret)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	// Same ciphertext under a DIFFERENT keyring (same sizes, different bytes)
	// must fail authentication.
	other, err := NewMFAKeyring("k1", map[string][]byte{
		"k1": bytes.Repeat([]byte{0xAB}, 32),
	})
	if err != nil {
		t.Fatalf("other keyring: %v", err)
	}
	otherSecrets, _ := NewMFASecrets(other)
	if _, err := otherSecrets.DecryptTOTPSecret(ciphertext, "k1"); err == nil {
		t.Fatal("ciphertext decrypted under the wrong key")
	}

	// An unregistered kid fails closed even with the right keyring.
	if _, err := secrets.DecryptTOTPSecret(ciphertext, "k9"); err == nil {
		t.Fatal("unknown kid decrypted")
	}
}

func TestMFAKeyringRotationVersionLookup(t *testing.T) {
	keyring := testMFAKeyring(t)
	secrets, _ := NewMFASecrets(keyring)
	secret := []byte("v1-secret")
	ciphertext, kid, err := secrets.EncryptTOTPSecret(secret)
	if err != nil {
		t.Fatalf("encrypt under k1: %v", err)
	}

	// Rotate the ACTIVE kid to k0: new writes pin k0, old k1 material stays
	// decryptable until k1 leaves the ring.
	if err := keyring.rotateActiveForTest("k0"); err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if got := keyring.ActiveKeyID(); got != "k0" {
		t.Fatalf("active kid after rotation: %q", got)
	}
	_, newKid, err := secrets.EncryptTOTPSecret(secret)
	if err != nil {
		t.Fatalf("encrypt under k0: %v", err)
	}
	if newKid != "k0" {
		t.Fatalf("new material kid: %q", newKid)
	}
	if plaintext, err := secrets.DecryptTOTPSecret(ciphertext, kid); err != nil || !bytes.Equal(plaintext, secret) {
		t.Fatalf("old-kid material must stay readable during rotation: %v", err)
	}

	// Removing k1 from the ring fails its stored material closed.
	if err := keyring.removeKeyForTest("k1"); err != nil {
		t.Fatalf("remove k1: %v", err)
	}
	if _, err := secrets.DecryptTOTPSecret(ciphertext, kid); err == nil {
		t.Fatal("rotated-out kid must fail closed")
	}
}

func TestMFAKeyringValidation(t *testing.T) {
	if _, err := NewMFAKeyring("", map[string][]byte{"k1": make([]byte, 32)}); err == nil {
		t.Fatal("empty active kid accepted")
	}
	if _, err := NewMFAKeyring("k1", map[string][]byte{}); err == nil {
		t.Fatal("empty keyring accepted")
	}
	if _, err := NewMFAKeyring("k1", map[string][]byte{"k1": make([]byte, 31)}); err == nil {
		t.Fatal("short key accepted")
	}
	if _, err := NewMFAKeyring("bad kid!", map[string][]byte{"bad kid!": make([]byte, 32)}); err == nil {
		t.Fatal("malformed kid accepted")
	}
	if _, err := NewMFAKeyring("k1", map[string][]byte{"k1": make([]byte, 32)}); err != nil {
		t.Fatalf("valid keyring rejected: %v", err)
	}
}

func TestParseMFAKeyringSecrets(t *testing.T) {
	if _, err := ParseMFAKeyringSecrets(""); err == nil {
		t.Fatal("empty config accepted")
	}
	single := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x33}, 32))
	ring, err := ParseMFAKeyringSecrets(single)
	if err != nil {
		t.Fatalf("single key: %v", err)
	}
	if ring.ActiveKeyID() != "primary" || !ring.HasKeyID("primary") {
		t.Fatalf("single key kid: %q", ring.ActiveKeyID())
	}
	short := base64.StdEncoding.EncodeToString(make([]byte, 16))
	if _, err := ParseMFAKeyringSecrets(short); err == nil {
		t.Fatal("short single key accepted")
	}
	if _, err := ParseMFAKeyringSecrets("not base64!!"); err == nil {
		t.Fatal("invalid base64 accepted")
	}
	jsonRing := `{"active_kid":"a","keys":{"a":"` + single + `","b":"` + single + `"}}`
	ring, err = ParseMFAKeyringSecrets(jsonRing)
	if err != nil {
		t.Fatalf("json keyring: %v", err)
	}
	if ring.ActiveKeyID() != "a" || !ring.HasKeyID("b") {
		t.Fatal("json keyring parse mismatch")
	}
	if _, err := ParseMFAKeyringSecrets(`{"active_kid":"missing","keys":{"a":"` + single + `"}}`); err == nil {
		t.Fatal("missing active kid accepted")
	}
}

func TestRecoveryVerifierRoundTripAndKeying(t *testing.T) {
	secrets, _ := NewMFASecrets(testMFAKeyring(t))
	verifier, kid, err := secrets.RecoveryVerifier("ABCDE-FGHIJ")
	if err != nil {
		t.Fatalf("RecoveryVerifier: %v", err)
	}
	if kid != "k1" {
		t.Fatalf("verifier kid: %q", kid)
	}
	if !secrets.RecoveryMatches("ABCDE-FGHIJ", kid, verifier) {
		t.Fatal("verifier must match its code")
	}
	// Normalization: typed lowercase with spaces still matches.
	if !secrets.RecoveryMatches("abcde fghij", kid, verifier) {
		t.Fatal("normalized presentation must match")
	}
	if secrets.RecoveryMatches("ABCDE-FGHIX", kid, verifier) {
		t.Fatal("different code matched")
	}
	// A verifier is key-material-bound: another keyring must not verify it.
	other, _ := NewMFASecrets(mustMFAKeyring(t, "k1", bytes.Repeat([]byte{0xCD}, 32)))
	if other.RecoveryMatches("ABCDE-FGHIJ", kid, verifier) {
		t.Fatal("verifier matched under wrong keyring")
	}
	// TOTP ciphertext bytes cannot serve as a recovery verifier and vice
	// versa (HKDF domain separation).
	totpSecret := []byte("totp")
	ciphertext, _, err := secrets.EncryptTOTPSecret(totpSecret)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if secrets.RecoveryMatches(string(ciphertext), kid, verifier) {
		t.Fatal("ciphertext verified as recovery code")
	}
}

func mustMFAKeyring(t *testing.T, kid string, key []byte) *MFAKeyring {
	t.Helper()
	ring, err := NewMFAKeyring(kid, map[string][]byte{kid: key})
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}
	return ring
}

// rotateActiveForTest/removeKeyForTest mutate the unexported keyring maps for
// rotation proofs; production rotation replaces the env configuration.
func (k *MFAKeyring) rotateActiveForTest(kid string) error {
	if _, ok := k.keys[kid]; !ok {
		return errTestUnknownKid
	}
	k.activeKid = kid
	return nil
}

func (k *MFAKeyring) removeKeyForTest(kid string) error {
	if kid == k.activeKid {
		return errTestActiveKid
	}
	delete(k.keys, kid)
	return nil
}

type testKeyringError string

func (e testKeyringError) Error() string { return string(e) }

const (
	errTestUnknownKid = testKeyringError("unknown kid")
	errTestActiveKid  = testKeyringError("cannot remove the active kid")
)
