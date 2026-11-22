package mail

import (
	"context"
	"log/slog"
)

// LogSender is the development-only transport (#1646): it prints the whole
// message — including the one-time link — to the server log instead of
// sending it. Config refuses it in production and together with SMTP.
type LogSender struct {
	Logger *slog.Logger
}

func (LogSender) Name() string { return "log" }

func (s LogSender) Send(_ context.Context, msg Message) error {
	if err := msg.Validate(); err != nil {
		return &InvalidMessageError{Err: err}
	}
	logger := s.Logger
	if logger == nil {
		logger = slog.Default()
	}
	logger.Info("DEV email (not sent; GRANETE_DEV_EMAIL_TRANSPORT=log)", "to", msg.To, "subject", msg.Subject, "text", msg.Text)
	return nil
}
