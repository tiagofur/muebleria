package mail

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
)

const sealPrefix = "gcm1:"

// Cipher seals outbox messages with AES-256-GCM (#1646). The key is derived
// from an application secret with a dedicated label, so the database (and
// its backups and replicas) never holds a readable one-time link or the
// recipient address.
type Cipher struct {
	gcm cipher.AEAD
}

// NewCipher derives the outbox key from secret. An empty secret is refused.
func NewCipher(secret string) (*Cipher, error) {
	if strings.TrimSpace(secret) == "" {
		return nil, errors.New("mail: outbox cipher needs a secret")
	}
	key := sha256.Sum256([]byte("granete:email-outbox:v1:" + secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Cipher{gcm: gcm}, nil
}

// Seal encodes msg as "gcm1:" + base64(nonce || ciphertext).
func (c *Cipher) Seal(msg Message) (string, error) {
	plain, err := json.Marshal(msg)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, c.gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return sealPrefix + base64.StdEncoding.EncodeToString(c.gcm.Seal(nonce, nonce, plain, nil)), nil
}

// Open reverses Seal. A payload sealed under another key fails closed.
func (c *Cipher) Open(sealed string) (Message, error) {
	if !strings.HasPrefix(sealed, sealPrefix) {
		return Message{}, errors.New("mail: outbox payload is not sealed")
	}
	raw, err := base64.StdEncoding.DecodeString(sealed[len(sealPrefix):])
	if err != nil || len(raw) < c.gcm.NonceSize() {
		return Message{}, errors.New("mail: invalid outbox payload")
	}
	plain, err := c.gcm.Open(nil, raw[:c.gcm.NonceSize()], raw[c.gcm.NonceSize():], nil)
	if err != nil {
		return Message{}, errors.New("mail: outbox payload does not open with this key")
	}
	var msg Message
	if err := json.Unmarshal(plain, &msg); err != nil {
		return Message{}, err
	}
	return msg, nil
}
