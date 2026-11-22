// Package emailoutbox delivers the durable email outbox (#1646).
//
// The worker leases due messages, sends them through a mail.Sender and
// records the outcome. Logs carry the outbox id, kind, attempt and a masked
// recipient — never the full address, the link, the token or the body.
package emailoutbox

import (
	"context"
	"log/slog"
	"time"

	"github.com/tiagofur/muebles-backend/internal/mail"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Queue is the storage side of the outbox.
type Queue interface {
	ClaimEmailBatch(ctx context.Context, limit int, lease time.Duration) ([]storage.ClaimedEmail, error)
	MarkEmailSent(ctx context.Context, id string) error
	MarkEmailFailed(ctx context.Context, id, sanitizedError string, retryAt time.Time, final bool) error
}

// DefaultBackoff spaces retries; the last step repeats. A reset link lives
// one hour, so its message gets several tries before it expires; an
// invitation (14 days) keeps retrying hourly until MaxAttempts.
var DefaultBackoff = []time.Duration{30 * time.Second, 2 * time.Minute, 10 * time.Minute, 30 * time.Minute, time.Hour}

// Worker polls the outbox. Zero values get safe defaults in Run/RunOnce.
type Worker struct {
	Queue       Queue
	Sender      mail.Sender
	Interval    time.Duration // poll period (default 10s)
	Lease       time.Duration // per-claim lease (default 2m)
	BatchSize   int           // default 20
	MaxAttempts int           // default 10
	Backoff     []time.Duration
	Logger      *slog.Logger
	Now         func() time.Time
}

func (w *Worker) defaults() {
	if w.Interval <= 0 {
		w.Interval = 10 * time.Second
	}
	if w.Lease <= 0 {
		w.Lease = 2 * time.Minute
	}
	if w.BatchSize <= 0 {
		w.BatchSize = 20
	}
	if w.MaxAttempts <= 0 {
		w.MaxAttempts = 10
	}
	if len(w.Backoff) == 0 {
		w.Backoff = DefaultBackoff
	}
	if w.Logger == nil {
		w.Logger = slog.Default()
	}
	if w.Now == nil {
		w.Now = time.Now
	}
}

// Run polls until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) {
	w.defaults()
	w.Logger.Info("email outbox worker started", "transport", w.Sender.Name(), "interval", w.Interval.String())
	ticker := time.NewTicker(w.Interval)
	defer ticker.Stop()
	for {
		if _, err := w.RunOnce(ctx); err != nil && ctx.Err() == nil {
			w.Logger.Warn("email outbox poll failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Result counts one poll's outcomes.
type Result struct {
	Sent, Retrying, Failed int
}

// RunOnce claims one batch and processes it.
func (w *Worker) RunOnce(ctx context.Context) (Result, error) {
	w.defaults()
	var res Result
	batch, err := w.Queue.ClaimEmailBatch(ctx, w.BatchSize, w.Lease)
	if err != nil {
		return res, err
	}
	for _, msg := range batch {
		if ctx.Err() != nil {
			// The lease returns the rest to the queue.
			return res, ctx.Err()
		}
		sendErr := w.Sender.Send(ctx, msg.Message)
		if sendErr == nil {
			if err := w.Queue.MarkEmailSent(ctx, msg.ID); err != nil {
				// Sent but not recorded: the lease will retry it. Logged so an
				// operator can explain a possible duplicate.
				w.Logger.Error("email sent but outbox not updated", "outbox_id", msg.ID, "kind", msg.Kind, "error", err)
				continue
			}
			res.Sent++
			w.Logger.Info("email sent", "outbox_id", msg.ID, "kind", msg.Kind, "to", mail.MaskAddress(msg.Message.To), "attempt", msg.Attempts)
			continue
		}
		summary, permanent := mail.Classify(sendErr)
		final := permanent || msg.Attempts >= w.MaxAttempts
		retryAt := w.Now().Add(w.backoff(msg.Attempts))
		if err := w.Queue.MarkEmailFailed(ctx, msg.ID, summary, retryAt, final); err != nil {
			w.Logger.Error("email outbox failure not recorded", "outbox_id", msg.ID, "kind", msg.Kind, "error", err)
			continue
		}
		if final {
			res.Failed++
			w.Logger.Error("email delivery failed permanently", "outbox_id", msg.ID, "kind", msg.Kind, "to", mail.MaskAddress(msg.Message.To), "attempt", msg.Attempts, "reason", summary)
		} else {
			res.Retrying++
			w.Logger.Warn("email delivery failed; will retry", "outbox_id", msg.ID, "kind", msg.Kind, "to", mail.MaskAddress(msg.Message.To), "attempt", msg.Attempts, "retry_at", retryAt.UTC().Format(time.RFC3339), "reason", summary)
		}
	}
	return res, nil
}

func (w *Worker) backoff(attempt int) time.Duration {
	i := attempt - 1
	if i < 0 {
		i = 0
	}
	if i >= len(w.Backoff) {
		i = len(w.Backoff) - 1
	}
	return w.Backoff[i]
}
