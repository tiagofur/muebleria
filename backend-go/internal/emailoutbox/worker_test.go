package emailoutbox

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/textproto"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/mail"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

type failure struct {
	summary string
	retryAt time.Time
	final   bool
}

type fakeQueue struct {
	batch  []storage.ClaimedEmail
	sent   []string
	failed map[string]failure
}

func (q *fakeQueue) ClaimEmailBatch(context.Context, int, time.Duration) ([]storage.ClaimedEmail, error) {
	out := q.batch
	q.batch = nil
	return out, nil
}
func (q *fakeQueue) MarkEmailSent(ctx context.Context, id, lease string) (bool, error) {
	if ctx.Err() != nil {
		return false, ctx.Err()
	}
	if lease != "lease-"+id {
		return false, nil
	}
	q.sent = append(q.sent, id)
	return true, nil
}
func (q *fakeQueue) MarkEmailFailed(ctx context.Context, id, lease, summary string, retryAt time.Time, final bool) (bool, error) {
	if ctx.Err() != nil {
		return false, ctx.Err()
	}
	if q.failed == nil {
		q.failed = map[string]failure{}
	}
	q.failed[id] = failure{summary, retryAt, final}
	return true, nil
}

type scriptedSender struct{ errs map[string]error }

func (s scriptedSender) Name() string { return "fake" }
func (s scriptedSender) Send(_ context.Context, m mail.Message) error {
	return s.errs[m.To]
}

const secretLink = "https://app.granete.test/reset-password?token=deadbeefcafe"

func claimed(id, to string, attempts int) storage.ClaimedEmail {
	return storage.ClaimedEmail{ID: id, Kind: storage.EmailKindPasswordReset, Attempts: attempts, LeaseToken: "lease-" + id,
		Message: mail.Message{To: to, Subject: "Restablecer", Text: "Abrí " + secretLink}}
}

func TestWorkerSendsRetriesAndGivesUpWithoutLeakingSecrets(t *testing.T) {
	var logs bytes.Buffer
	now := time.Date(2026, 11, 21, 10, 0, 0, 0, time.UTC)
	rcptRejected := &mail.SendError{Stage: "rcpt", Err: &textproto.Error{Code: 550, Msg: "5.1.1 <gone@taller.test> unknown user"}}
	authRejected := &mail.SendError{Stage: "auth", Err: &textproto.Error{Code: 535, Msg: "bad credentials for ana@taller.test"}}
	q := &fakeQueue{batch: []storage.ClaimedEmail{
		claimed("ok", "ana@taller.test", 1),
		claimed("transient", "beto@taller.test", 1),
		claimed("permanent", "gone@taller.test", 1),
		claimed("exhausted", "caro@taller.test", 3),
	}}
	w := &Worker{
		Queue:       q,
		Sender:      scriptedSender{errs: map[string]error{"beto@taller.test": authRejected, "gone@taller.test": rcptRejected, "caro@taller.test": errors.New("dial tcp: connection refused")}},
		MaxAttempts: 3,
		Backoff:     []time.Duration{time.Minute, 5 * time.Minute},
		Logger:      slog.New(slog.NewTextHandler(&logs, nil)),
		Now:         func() time.Time { return now },
	}
	res, err := w.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if res != (Result{Sent: 1, Retrying: 1, Failed: 2}) {
		t.Fatalf("unexpected result %+v", res)
	}
	if len(q.sent) != 1 || q.sent[0] != "ok" {
		t.Fatalf("sent = %v", q.sent)
	}
	if f := q.failed["transient"]; f.final || !f.retryAt.Equal(now.Add(time.Minute)) || f.summary != "smtp auth: respuesta 535" {
		t.Fatalf("auth failure must retry after the first backoff step with a sanitized summary, got %+v", f)
	}
	if f := q.failed["permanent"]; !f.final || f.summary != "smtp rcpt: respuesta 550" {
		t.Fatalf("a 5xx at RCPT is permanent, got %+v", f)
	}
	if f := q.failed["exhausted"]; !f.final {
		t.Fatalf("attempts exhausted must be final, got %+v", f)
	}
	out := logs.String()
	for _, leak := range []string{"ana@taller.test", "beto@taller.test", "gone@taller.test", "deadbeefcafe", "unknown user", "bad credentials"} {
		if strings.Contains(out, leak) {
			t.Fatalf("worker log leaked %q:\n%s", leak, out)
		}
	}
	for _, f := range q.failed {
		if strings.Contains(f.summary, "@") {
			t.Fatalf("stored error leaked an address: %q", f.summary)
		}
	}
	if !strings.Contains(out, "a***@taller.test") {
		t.Fatalf("expected a masked recipient in the log:\n%s", out)
	}
}

func TestWorkerBackoffRepeatsLastStep(t *testing.T) {
	w := &Worker{Backoff: []time.Duration{time.Second, time.Minute}}
	if w.backoff(1) != time.Second || w.backoff(2) != time.Minute || w.backoff(9) != time.Minute {
		t.Fatal("backoff must step through and then repeat the last value")
	}
}

type cancellingSender struct{ cancel context.CancelFunc }

func (cancellingSender) Name() string { return "fake" }
func (s cancellingSender) Send(context.Context, mail.Message) error {
	s.cancel() // shutdown arrives while the provider is accepting the message
	return nil
}

func TestWorkerRecordsAcceptedSendEvenWhenShutdownCancelsMidSend(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	q := &fakeQueue{batch: []storage.ClaimedEmail{claimed("ok", "ana@taller.test", 1)}}
	w := &Worker{Queue: q, Sender: cancellingSender{cancel: cancel}, Logger: slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))}
	_, _ = w.RunOnce(ctx)
	if len(q.sent) != 1 {
		t.Fatalf("an accepted message must be marked sent despite cancellation, sent=%v", q.sent)
	}
}

func TestWorkerUnreadablePayloadFailsFinal(t *testing.T) {
	c := claimed("bad", "ana@taller.test", 1)
	c.OpenErr = errors.New("does not open")
	q := &fakeQueue{batch: []storage.ClaimedEmail{c}}
	w := &Worker{Queue: q, Sender: scriptedSender{}, Logger: slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))}
	if _, err := w.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f := q.failed["bad"]; !f.final {
		t.Fatalf("unreadable payload must fail for good, got %+v", f)
	}
}
