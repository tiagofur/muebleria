// Package mail is the outbound email port (#1646): a provider-agnostic
// Sender, a generic SMTP adapter configured by environment (no secrets in
// git) and Spanish templates. Delivery is durable: messages are enqueued in
// the database outbox in the same transaction as the mutation that creates
// them and a worker sends them with retries (see storage/email_outbox.go).
package mail

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
)

// MaxAttachmentBytes bounds the total attachment size of one message.
const MaxAttachmentBytes = 5 << 20

// Attachment is one file attached to a message (#1650: the exact quote PDF).
type Attachment struct {
	FileName    string
	ContentType string
	Data        []byte
}

// Message is one rendered email.
type Message struct {
	To          string
	Subject     string
	Text        string
	HTML        string
	Attachments []Attachment `json:",omitempty"`
}

// Validate rejects header injection and empty parts before anything is
// queued or sent.
func (m Message) Validate() error {
	if strings.ContainsAny(m.To, "\r\n") || strings.ContainsAny(m.Subject, "\r\n") {
		return errors.New("mail: header injection")
	}
	if !ValidAddress(m.To) {
		return fmt.Errorf("mail: invalid recipient")
	}
	if strings.TrimSpace(m.Subject) == "" || strings.TrimSpace(m.Text) == "" {
		return errors.New("mail: subject and text body are required")
	}
	total := 0
	for _, a := range m.Attachments {
		if a.FileName == "" || len(a.FileName) > 200 || strings.ContainsAny(a.FileName, "\r\n\"/\\") {
			return errors.New("mail: invalid attachment file name")
		}
		if a.ContentType != "application/pdf" {
			return errors.New("mail: unsupported attachment type")
		}
		if len(a.Data) == 0 {
			return errors.New("mail: empty attachment")
		}
		total += len(a.Data)
	}
	if total > MaxAttachmentBytes {
		return errors.New("mail: attachments too large")
	}
	return nil
}

// ValidAddress reports whether addr is a single bare RFC 5322 address (no
// display name, no list) that SMTP can deliver to.
func ValidAddress(addr string) bool {
	if addr == "" || strings.ContainsAny(addr, "\r\n") {
		return false
	}
	parsed, err := mail.ParseAddress(addr)
	return err == nil && parsed.Address == addr
}

// Sender delivers one message. Implementations must never log the body or
// the full recipient address.
type Sender interface {
	Send(ctx context.Context, msg Message) error
	// Name identifies the adapter in logs ("smtp", "log", …).
	Name() string
}

// MaskAddress keeps logs free of the full address: "j***@example.com".
func MaskAddress(addr string) string {
	at := strings.LastIndex(addr, "@")
	if at <= 0 {
		return "***"
	}
	return addr[:1] + "***" + addr[at:]
}
