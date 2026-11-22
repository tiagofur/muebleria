package mail

import (
	"bufio"
	"context"
	"io"
	"mime"
	"mime/quotedprintable"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeSMTP is a minimal in-process SMTP sink (no TLS, no auth) that records
// the envelope and the DATA payload of each message.
type fakeSMTP struct {
	ln       net.Listener
	mu       sync.Mutex
	from, to string
	data     string
	failRcpt bool
}

func startFakeSMTP(t *testing.T) *fakeSMTP {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeSMTP{ln: ln}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go f.serve(conn)
		}
	}()
	t.Cleanup(func() { ln.Close() })
	return f
}

func (f *fakeSMTP) port() int { return f.ln.Addr().(*net.TCPAddr).Port }

func (f *fakeSMTP) serve(conn net.Conn) {
	defer conn.Close()
	r := bufio.NewReader(conn)
	w := func(s string) { conn.Write([]byte(s + "\r\n")) }
	w("220 fake ESMTP")
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		cmd := strings.ToUpper(strings.TrimSpace(line))
		switch {
		case strings.HasPrefix(cmd, "EHLO"), strings.HasPrefix(cmd, "HELO"):
			w("250 fake")
		case strings.HasPrefix(cmd, "MAIL FROM:"):
			f.mu.Lock()
			f.from = strings.TrimSpace(line[len("MAIL FROM:"):])
			f.mu.Unlock()
			w("250 ok")
		case strings.HasPrefix(cmd, "RCPT TO:"):
			if f.failRcpt {
				w("550 no such user")
				continue
			}
			f.mu.Lock()
			f.to = strings.TrimSpace(line[len("RCPT TO:"):])
			f.mu.Unlock()
			w("250 ok")
		case cmd == "DATA":
			w("354 go ahead")
			var sb strings.Builder
			for {
				l, err := r.ReadString('\n')
				if err != nil {
					return
				}
				if l == ".\r\n" {
					break
				}
				sb.WriteString(l)
			}
			f.mu.Lock()
			f.data = sb.String()
			f.mu.Unlock()
			w("250 queued")
		case cmd == "QUIT":
			w("221 bye")
			return
		default:
			w("250 ok")
		}
	}
}

func TestSMTPSenderDeliversMultipartSpanishMessage(t *testing.T) {
	srv := startFakeSMTP(t)
	sender, err := NewSMTPSender(SMTPConfig{Host: "127.0.0.1", Port: srv.port(), From: "Granete <no-reply@granete.test>", TLS: TLSNone, Timeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	msg := PasswordResetMessage("ana@taller.test", "https://app.granete.test/reset-password?token=abc123", time.Date(2026, 11, 21, 18, 0, 0, 0, time.UTC), time.UTC)
	if err := sender.Send(context.Background(), msg); err != nil {
		t.Fatalf("send: %v", err)
	}
	srv.mu.Lock()
	defer srv.mu.Unlock()
	if srv.from != "<no-reply@granete.test>" || srv.to != "<ana@taller.test>" {
		t.Fatalf("envelope from=%q to=%q", srv.from, srv.to)
	}
	dec := new(mime.WordDecoder)
	var subject string
	for _, line := range strings.Split(srv.data, "\r\n") {
		if strings.HasPrefix(line, "Subject: ") {
			subject, _ = dec.DecodeHeader(strings.TrimPrefix(line, "Subject: "))
		}
	}
	if subject != "Restablecer tu contraseña de Granete" {
		t.Fatalf("subject = %q", subject)
	}
	body, _ := io.ReadAll(quotedprintable.NewReader(strings.NewReader(srv.data)))
	if !strings.Contains(string(body), "https://app.granete.test/reset-password?token=abc123") || !strings.Contains(string(body), "multipart/alternative") {
		t.Fatalf("body missing link or multipart:\n%s", body)
	}
}

func TestSMTPSenderSurfacesProviderRejection(t *testing.T) {
	srv := startFakeSMTP(t)
	srv.failRcpt = true
	sender, _ := NewSMTPSender(SMTPConfig{Host: "127.0.0.1", Port: srv.port(), From: "no-reply@granete.test", TLS: TLSNone, Timeout: 5 * time.Second})
	err := sender.Send(context.Background(), PasswordResetMessage("ana@taller.test", "https://x.test/r", time.Now(), nil))
	if err == nil || !strings.Contains(err.Error(), "rcpt") {
		t.Fatalf("want rcpt rejection, got %v", err)
	}
}

func TestSMTPSenderRequiresStartTLSWhenConfigured(t *testing.T) {
	srv := startFakeSMTP(t) // offers no STARTTLS
	sender, _ := NewSMTPSender(SMTPConfig{Host: "127.0.0.1", Port: srv.port(), From: "no-reply@granete.test", TLS: TLSStartTLS, Timeout: 5 * time.Second})
	err := sender.Send(context.Background(), PasswordResetMessage("ana@taller.test", "https://x.test/r", time.Now(), nil))
	if err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("starttls mode must refuse a server without STARTTLS, got %v", err)
	}
}

func TestMessageValidationAndMasking(t *testing.T) {
	bad := []Message{
		{To: "a@b.test\r\nBcc: x@y.test", Subject: "s", Text: "t"},
		{To: "a@b.test", Subject: "s\r\nBcc: x@y.test", Text: "t"},
		{To: "not-an-address", Subject: "s", Text: "t"},
		{To: "a@b.test", Subject: "", Text: "t"},
	}
	for _, m := range bad {
		if m.Validate() == nil {
			t.Fatalf("must reject %+v", m)
		}
	}
	if got := MaskAddress("ana@taller.test"); got != "a***@taller.test" {
		t.Fatalf("mask = %q", got)
	}
	if _, err := NewSMTPSender(SMTPConfig{Host: "h", Port: 25, From: "x@y.test", TLS: "ssl3"}); err == nil {
		t.Fatalf("unknown TLS mode must be refused")
	}
	inv := InvitationMessage("b@t.test", "Taller <Pérez>", "https://x.test/accept?token=z", time.Now(), nil)
	if !strings.Contains(inv.HTML, "Taller &lt;Pérez&gt;") || !strings.Contains(inv.Subject, "Taller <Pérez>") {
		t.Fatalf("invitation escaping: %+v", inv)
	}
	_ = strconv.Itoa
}
