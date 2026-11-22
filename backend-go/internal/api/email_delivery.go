package api

// #1646 email delivery wiring: link building and outbox enqueueing. The
// outbox row is written inside the caller's transaction (idempotent command
// or the reset issuance), so an email exists if and only if the credential
// it carries was committed. Links are built from APP_PUBLIC_URL, never from
// the request Host header.

import (
	"context"
	"net/url"
	"time"

	"github.com/tiagofur/muebles-backend/internal/mail"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const (
	emailDeliveryQueued        = "queued"
	emailDeliveryNotConfigured = "not_configured"
)

// EmailDeliveryConfig is the API-side view of a configured email transport.
type EmailDeliveryConfig struct {
	// PublicAppURL is the absolute Web origin (validated by config).
	PublicAppURL string
	// Location prints expiry times inside emails.
	Location *time.Location
}

func (c *EmailDeliveryConfig) link(path, token string) string {
	return c.PublicAppURL + path + "?token=" + url.QueryEscape(token)
}

func (c *EmailDeliveryConfig) passwordResetMessage(recipient string, issuance storage.PasswordResetIssuance) mail.Message {
	return mail.PasswordResetMessage(recipient, c.link("/reset-password", issuance.Token), issuance.ExpiresAt, c.Location)
}

func (s *Server) emailDeliveryState() string {
	if s.EmailDelivery != nil {
		return emailDeliveryQueued
	}
	return emailDeliveryNotConfigured
}

// enqueueInvitationEmail queues the invitation email when delivery is
// configured; a no-op otherwise (the copy-link path stays the fallback).
func (s *Server) enqueueInvitationEmail(ctx context.Context, organizationID, organizationName string, inv *storage.Invitation, token string) error {
	if s.EmailDelivery == nil {
		return nil
	}
	_, err := s.Store.EnqueueEmail(ctx, storage.OutboundEmail{
		Kind:           storage.EmailKindInvitation,
		OrganizationID: organizationID,
		Message:        mail.InvitationMessage(inv.Email, organizationName, s.EmailDelivery.link("/accept-invitation", token), inv.ExpiresAt, s.EmailDelivery.Location),
		ExpiresAt:      inv.ExpiresAt,
	})
	return err
}
