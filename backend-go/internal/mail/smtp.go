package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

// TLSMode selects how the SMTP connection is protected.
type TLSMode string

const (
	TLSStartTLS TLSMode = "starttls" // port 587: plain connect + STARTTLS (required)
	TLSImplicit TLSMode = "tls"      // port 465: TLS from the first byte
	TLSNone     TLSMode = "none"     // local test sinks (mailpit); refused in production
)

// SMTPConfig is the generic provider configuration (any SMTP service:
// Gmail Workspace, SES, SendGrid, Mailgun, the hosting's own relay…).
type SMTPConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string // "Granete <no-reply@example.com>"
	TLS      TLSMode
	Timeout  time.Duration
}

// SMTPSender implements Sender over net/smtp.
type SMTPSender struct {
	cfg SMTPConfig
}

// NewSMTPSender validates the configuration.
func NewSMTPSender(cfg SMTPConfig) (*SMTPSender, error) {
	if strings.TrimSpace(cfg.Host) == "" || cfg.Port <= 0 {
		return nil, errors.New("smtp: host and port are required")
	}
	if strings.TrimSpace(cfg.From) == "" {
		return nil, errors.New("smtp: from address is required")
	}
	if _, err := parseAddress(cfg.From); err != nil {
		return nil, fmt.Errorf("smtp: invalid from address: %w", err)
	}
	switch cfg.TLS {
	case TLSStartTLS, TLSImplicit, TLSNone:
	default:
		return nil, fmt.Errorf("smtp: unknown TLS mode %q", cfg.TLS)
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 20 * time.Second
	}
	return &SMTPSender{cfg: cfg}, nil
}

func (s *SMTPSender) Name() string { return "smtp" }

// Send delivers one message, honoring ctx and the configured timeout.
func (s *SMTPSender) Send(ctx context.Context, msg Message) error {
	if err := msg.Validate(); err != nil {
		return &InvalidMessageError{Err: err}
	}
	fromAddr, err := parseAddress(s.cfg.From)
	if err != nil {
		return err
	}
	body, err := buildMIME(s.cfg.From, msg)
	if err != nil {
		return err
	}
	addr := net.JoinHostPort(s.cfg.Host, strconv.Itoa(s.cfg.Port))
	dialer := &net.Dialer{Timeout: s.cfg.Timeout}
	deadline := time.Now().Add(s.cfg.Timeout)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	tlsCfg := &tls.Config{ServerName: s.cfg.Host, MinVersion: tls.VersionTLS12}

	var conn net.Conn
	if s.cfg.TLS == TLSImplicit {
		conn, err = tls.DialWithDialer(dialer, "tcp", addr, tlsCfg)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return stageError("connect", err)
	}
	_ = conn.SetDeadline(deadline)
	client, err := smtp.NewClient(conn, s.cfg.Host)
	if err != nil {
		conn.Close()
		return stageError("handshake", err)
	}
	defer client.Close()
	if s.cfg.TLS == TLSStartTLS {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return stageError("starttls", errors.New("server does not offer STARTTLS"))
		}
		if err := client.StartTLS(tlsCfg); err != nil {
			return stageError("starttls", err)
		}
	}
	if s.cfg.Username != "" {
		if ok, _ := client.Extension("AUTH"); !ok {
			return stageError("auth", errors.New("server does not offer AUTH"))
		}
		if err := client.Auth(smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, s.cfg.Host)); err != nil {
			return stageError("auth", err)
		}
	}
	if err := client.Mail(fromAddr); err != nil {
		return stageError("mail from", err)
	}
	if err := client.Rcpt(msg.To); err != nil {
		return stageError("rcpt", err)
	}
	w, err := client.Data()
	if err != nil {
		return stageError("data", err)
	}
	if _, err := w.Write(body); err != nil {
		return stageError("write", err)
	}
	if err := w.Close(); err != nil {
		return stageError("close data", err)
	}
	// The server accepted the message at the end of DATA: a QUIT failure
	// must not turn a delivered email into a retry (duplicate link).
	_ = client.Quit()
	return nil
}

func parseAddress(from string) (string, error) {
	if i := strings.LastIndex(from, "<"); i >= 0 && strings.HasSuffix(strings.TrimSpace(from), ">") {
		return strings.TrimSuffix(strings.TrimSpace(from[i+1:]), ">"), nil
	}
	if strings.Contains(from, "@") {
		return strings.TrimSpace(from), nil
	}
	return "", errors.New("smtp: invalid from address")
}

// buildMIME renders a multipart/alternative message (text + optional HTML),
// quoted-printable UTF-8, with RFC 2047 encoded subject.
func newBoundary() (string, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "granete-" + hex.EncodeToString(b), nil
}

func buildMIME(from string, msg Message) ([]byte, error) {
	var buf bytes.Buffer
	alt, err := newBoundary()
	if err != nil {
		return nil, err
	}
	header := func(k, v string) { fmt.Fprintf(&buf, "%s: %s\r\n", k, v) }
	header("From", from)
	header("To", msg.To)
	header("Subject", mime.QEncoding.Encode("utf-8", msg.Subject))
	header("Date", time.Now().UTC().Format(time.RFC1123Z))
	header("MIME-Version", "1.0")
	header("Auto-Submitted", "auto-generated")
	textPart := func(contentType, content string) error {
		fmt.Fprintf(&buf, "--%s\r\n", alt)
		fmt.Fprintf(&buf, "Content-Type: %s; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n", contentType)
		qp := quotedprintable.NewWriter(&buf)
		if _, err := qp.Write([]byte(content)); err != nil {
			return err
		}
		if err := qp.Close(); err != nil {
			return err
		}
		buf.WriteString("\r\n")
		return nil
	}
	mixed := ""
	if len(msg.Attachments) > 0 {
		if mixed, err = newBoundary(); err != nil {
			return nil, err
		}
		header("Content-Type", fmt.Sprintf("multipart/mixed; boundary=%q", mixed))
		buf.WriteString("\r\n")
		fmt.Fprintf(&buf, "--%s\r\n", mixed)
	}
	header("Content-Type", fmt.Sprintf("multipart/alternative; boundary=%q", alt))
	buf.WriteString("\r\n")
	if err := textPart("text/plain", msg.Text); err != nil {
		return nil, err
	}
	if strings.TrimSpace(msg.HTML) != "" {
		if err := textPart("text/html", msg.HTML); err != nil {
			return nil, err
		}
	}
	fmt.Fprintf(&buf, "--%s--\r\n", alt)
	for _, a := range msg.Attachments {
		fmt.Fprintf(&buf, "--%s\r\n", mixed)
		name := mime.QEncoding.Encode("utf-8", a.FileName)
		fmt.Fprintf(&buf, "Content-Type: %s; name=%q\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=%q\r\n\r\n", a.ContentType, name, name)
		encoded := base64.StdEncoding.EncodeToString(a.Data)
		for len(encoded) > 76 {
			buf.WriteString(encoded[:76] + "\r\n")
			encoded = encoded[76:]
		}
		buf.WriteString(encoded + "\r\n")
	}
	if mixed != "" {
		fmt.Fprintf(&buf, "--%s--\r\n", mixed)
	}
	return buf.Bytes(), nil
}
